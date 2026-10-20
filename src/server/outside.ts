// Where a declaration outside the project is written (ReviewSpec, "The source window", the owner's
// decision of 2026-10-20): in a package of the project's lake-manifest (`.lake/packages/`), or in
// Lean's core (`Init`, `Std`, `Lean`, `Lake`), whose sources the toolchain carries in `src/lean/`.
// The source window shows it as it shows the project's files, with Lean's hovers, and links it to
// GitHub at the package's revision (DeploySpec decision 13).
//
// A module is found as Lake and Lean find it, never by a path a request gives: the package whose
// build holds its `.olean` (Lean's search path is the packages' `lib/lean` folders, then the
// toolchain's), then its source under that package's source folders as its lakefile sets them (the
// package's `srcDir`, and each library's under it: Lake's layout), the libraries that hold the
// module first; for core, the toolchain's `src/lean/`. Only a `.lean` file that is there, resolved
// with its symbolic links, inside the package's folder (or the toolchain's sources) is ever read: a
// module name is checked part by part before it is made a path, and the server asks only of modules
// the graph's outside declarations are in (server/live.ts, `outsideFile`). The lakefiles are read
// as text, never elaborated (server/project.ts).
//
// The revisions are what the lake-manifest pins (`rev`), and for core the toolchain: a past build's
// outside source is the present one only where its package is at the same revision now (HistorySpec
// decision 24; server/history.ts keeps each build's).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { splitName } from "../shared/layout.ts";
import type { OutsideWhere } from "../shared/outside.ts";
import { childEnv } from "./children.ts";
import { parseRemote } from "./deploy.ts";
import { readLakefileLean, readLakefileToml } from "./project.ts";
import type { Lakefile, LeanLib } from "./project.ts";
import { lakeTextHash } from "./status.ts";

/** A place outside sources come from: a package the manifest lists, or Lean's core. */
export interface OutsidePackage {
  /** its name in the manifest; "Lean" for the core */
  name: string;
  core: boolean;
  /** its folder, resolved: what no file read of it may leave */
  dir: string;
  /** where its `.olean` files are (its build's `lib/lean`): the module is its where Lean finds it there */
  libDirs: string[];
  /** its source folders, resolved, with the libraries whose modules they hold: the package's own
   *  `srcDir` last, holding any */
  srcDirs: { dir: string; libs: LeanLib[] | null }[];
  /** the revision the manifest pins (a commit), or the toolchain's (`v4.35.0`); null where none is
   *  known (a path dependency) */
  rev: string | null;
  /** `owner/repo` where the package is a repository on GitHub, and the folder of it the package is
   *  (`subDir`; core: `src`) */
  github: { repo: string; dir: string } | null;
}

/** An outside module's file, found. */
export interface OutsideFile {
  module: string;
  /** the file, resolved */
  path: string;
  /** where it is in its package's folder, `/`-separated: what the window says (`Mathlib/Logic/Basic.lean`) */
  file: string;
  package: { name: string; core: boolean; rev: string | null };
  /** the file's lines on GitHub, at the package's revision: its repository, the revision and the
   *  path there (shared/deploy.ts, `githubBlob`); null where the package is not on GitHub or its
   *  revision is not a commit or a release */
  github: { repo: string; rev: string; path: string } | null;
}

/** The lake-manifest's view of a dependency, as much of it as is read. */
interface ManifestPackage {
  name?: unknown;
  type?: unknown;
  dir?: unknown;
  url?: unknown;
  rev?: unknown;
  subDir?: unknown;
  configFile?: unknown;
}

/** A module name's parts as a path's: each a name Lake would make a file of, never `.`, `..`, a
 *  separator or a control character; null where one is not. */
export function modulePath(module: string): string[] | null {
  if (!module || module.length > 1000) return null;
  const parts = splitName(module).map((p) => (p.startsWith("«") && p.endsWith("»") ? p.slice(1, -1) : p));
  for (const p of parts) if (!p || p === "." || p === ".." || /[/\\\0-\x1f\x7f«»]/.test(p) || p.length > 255) return null;
  return parts;
}

/** Whether `path` is `dir` or inside it, both resolved. */
const inside = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** The resolved path of what is there, or null. */
function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** A toolchain's revision in Lean's repository: a release's tag (`leanprover/lean4:v4.35.0`, or
 *  `v4.35.0` alone); null for any other (a nightly, a pull request's build). */
export function toolchainTag(toolchain: string): string | null {
  const m = /^(?:leanprover\/lean4:)?(v\d+\.\d+\.\d+(?:-rc\d+)?)$/.exec(toolchain.trim());
  return m ? m[1] : null;
}

/** Whether a library holds a module, as Lake decides it: a root is a prefix of it, or a glob
 *  matches it. */
function holds(lib: LeanLib, module: string): boolean {
  const under = (base: string) => module === base || module.startsWith(`${base}.`);
  if ((lib.roots ?? [lib.name]).some(under)) return true;
  return (lib.globs ?? []).some((g) => {
    const m = /^(.*)\.([+*])$/.exec(g);
    return m ? (m[2] === "*" ? under(m[1]) : module.startsWith(`${m[1]}.`)) : module === g;
  });
}

/** The project's packages and Lean's core as places of outside sources, read again when the
 *  manifest or the toolchain changes (a branch followed builds a new commit), and each module's
 *  file once found. */
export class OutsideSources {
  private root: string;
  private toolchain: () => string;
  /** the manifest's packages as read, and of what: its time and size */
  private read: { key: string; packages: OutsidePackage[] } | null = null;
  /** the core, per toolchain: found only when a module of it is asked for */
  private cores = new Map<string, OutsidePackage | null>();
  private found = new Map<string, OutsideFile | null>();
  private foundFor = "";
  /** how the toolchain's folder is found (`toolchainDir`; a test gives its own) */
  private sysroot: (root: string, toolchain: string) => string | null;

  constructor(root: string, toolchain: () => string, sysroot: (root: string, toolchain: string) => string | null = toolchainDir) {
    this.root = root;
    this.toolchain = toolchain;
    this.sysroot = sysroot;
  }

  /** Forget what was read and found: a new graph is read (a build may have fetched a package, or
   *  installed a toolchain, the manifest unchanged), and what was not found may be there now. */
  forget(): void {
    this.read = null;
    this.cores.clear();
    this.found.clear();
  }

  /** The packages the manifest lists, read again where it changed since. */
  packages(): OutsidePackage[] {
    const manifest = join(this.root, "lake-manifest.json");
    let stamp = "none";
    try {
      const st = statSync(manifest);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // no manifest: no packages, the core alone
    }
    if (this.read?.key === stamp) return this.read.packages;
    this.read = { key: stamp, packages: this.fromManifest(manifest) };
    return this.read.packages;
  }

  /** The packages the manifest lists, each where Lake keeps it: `packagesDir/<name>` (and its
   *  `subDir`) for a git dependency, `dir` for a path one. One that is not there, or whose folder
   *  cannot be resolved, is left out. */
  private fromManifest(file: string): OutsidePackage[] {
    let m: { packagesDir?: unknown; packages?: unknown };
    try {
      m = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
    const packagesDir = typeof m.packagesDir === "string" ? m.packagesDir : join(".lake", "packages");
    const out: OutsidePackage[] = [];
    for (const p of (Array.isArray(m.packages) ? m.packages : []) as ManifestPackage[]) {
      if (typeof p?.name !== "string" || !p.name) continue;
      const str = (x: unknown) => (typeof x === "string" && x ? x : null);
      const sub = str(p.subDir);
      const repoDir = p.type === "path" ? str(p.dir) && resolve(this.root, str(p.dir)!) : resolve(this.root, packagesDir, p.name);
      if (!repoDir) continue;
      const dir = real(sub ? join(repoDir, sub) : repoDir);
      if (!dir) continue;
      const rev = str(p.rev);
      const remote = p.type === "git" && str(p.url) ? parseRemote(str(p.url)!) : null;
      const repo = remote && !("error" in remote) ? remote.github : null;
      out.push({
        name: p.name,
        core: false,
        dir,
        ...this.layout(dir, str(p.configFile)),
        rev,
        github: repo && rev && /^[0-9a-f]{7,64}$/.test(rev) ? { repo, dir: sub ? sub.replace(/\\/g, "/").replace(/^\.\/|\/$/g, "") : "" } : null,
      });
    }
    return out;
  }

  /** A package's layout from its lakefile, read as text: where Lake builds it (`buildDir`, by
   *  default `.lake/build`) and its source folders — each library's `srcDir` under the package's
   *  own, and the package's — resolved, those that leave its folder left out. */
  private layout(dir: string, configFile: string | null): Pick<OutsidePackage, "libDirs" | "srcDirs"> {
    const pick = [configFile, "lakefile.toml", "lakefile.lean"].find((f) => f && /^lakefile\.(toml|lean)$/.test(f) && existsSync(join(dir, f)));
    let lf: Lakefile = { libs: [] };
    try {
      if (pick) lf = (pick.endsWith(".toml") ? readLakefileToml : readLakefileLean)(readFileSync(join(dir, pick), "utf8"));
    } catch {
      // an unreadable lakefile: Lake's defaults
    }
    const within = (p: string) => {
      const r = real(p);
      return r && inside(r, dir) ? r : null;
    };
    const libDirs = [...new Set([lf.buildDir, join(".lake", "build")].filter((b): b is string => !!b).map((b) => join(dir, b, "lib", "lean")))];
    const pkgSrc = join(dir, lf.srcDir ?? ".");
    const srcDirs: OutsidePackage["srcDirs"] = [];
    const add = (p: string, libs: LeanLib[] | null) => {
      const r = within(p);
      if (!r) return;
      const had = srcDirs.find((s) => s.dir === r);
      if (!had) srcDirs.push({ dir: r, libs });
      else if (had.libs && libs) had.libs.push(...libs);
    };
    for (const lib of lf.libs) add(join(pkgSrc, lib.srcDir ?? "."), [lib]);
    add(pkgSrc, null);
    return { libDirs, srcDirs };
  }

  /** Lean's core: the toolchain's `lib/lean` and its sources, `src/lean/` (Lake's own under
   *  `src/lean/lake/`), at the toolchain's release in `leanprover/lean4`, whose `src/` they are;
   *  none where the toolchain's folder is not found. */
  private core(): OutsidePackage | null {
    const tc = this.toolchain();
    if (this.cores.has(tc)) return this.cores.get(tc)!;
    const sys = this.sysroot(this.root, tc);
    const dir = sys ? real(join(sys, "src", "lean")) : null;
    const tag = toolchainTag(tc);
    const core: OutsidePackage | null =
      sys && dir
        ? {
            name: "Lean",
            core: true,
            dir,
            libDirs: [join(sys, "lib", "lean")],
            srcDirs: [dir, real(join(dir, "lake"))].filter((d): d is string => !!d && inside(d, dir)).map((d) => ({ dir: d, libs: null })),
            rev: tag,
            github: tag ? { repo: "leanprover/lean4", dir: "src" } : null,
          }
        : null;
    this.cores.set(tc, core);
    return core;
  }

  /** Module `module`'s file: in the package whose build holds its `.olean`, under the source folder
   *  of the library that holds it (else any of the package's), resolved inside the package's
   *  folder; null where there is none. */
  find(module: string): OutsideFile | null {
    const pkgs = this.packages();
    // what was found is for this manifest and toolchain
    const key = `${this.read?.key}\0${this.toolchain()}`;
    if (key !== this.foundFor) {
      this.found.clear();
      this.foundFor = key;
    }
    if (this.found.has(module)) return this.found.get(module)!;
    const parts = modulePath(module);
    const result = parts ? this.locate(pkgs, module, parts) : null;
    this.found.set(module, result);
    if (this.found.size > 50_000) this.found.delete(this.found.keys().next().value!);
    return result;
  }

  private locate(pkgs: OutsidePackage[], module: string, parts: string[]): OutsideFile | null {
    const rel = join(...parts);
    // Lean's search path: the packages' builds, then the toolchain's
    const has = (p: OutsidePackage) => p.libDirs.some((d) => existsSync(`${join(d, rel)}.olean`));
    let pkg = pkgs.find(has);
    if (!pkg) {
      const core = this.core();
      pkg = core && has(core) ? core : undefined;
    }
    if (!pkg) return null;
    // the folders of the libraries that hold it first, then the others, the package's own last
    const order = [...pkg.srcDirs.filter((s) => s.libs?.some((l) => holds(l, module))), ...pkg.srcDirs.filter((s) => !s.libs?.some((l) => holds(l, module)))];
    for (const s of order) {
      const path = real(`${join(s.dir, rel)}.lean`);
      if (!path || !path.endsWith(".lean") || !inside(path, pkg.dir)) continue;
      try {
        if (!statSync(path).isFile()) continue;
      } catch {
        continue;
      }
      const file = relative(pkg.dir, path).split(sep).join("/");
      const repoPath = pkg.github ? [pkg.github.dir, file].filter(Boolean).join("/") : null;
      return {
        module,
        path,
        file,
        package: { name: pkg.name, core: pkg.core, rev: pkg.rev },
        github: pkg.github && pkg.rev && repoPath ? { repo: pkg.github.repo, rev: pkg.rev, path: repoPath } : null,
      };
    }
    return null;
  }

  /** The package that holds module `module` now, by name (core: "Lean"), and its revision: what a
   *  past build's outside source is compared by (HistorySpec decision 24). */
  packageOf(module: string): { name: string; core: boolean; rev: string | null } | null {
    return this.find(module)?.package ?? null;
  }

  /** Each package's revision as the manifest pins it now: what a snapshot records (HistorySpec
   *  decision 24); the core's is the toolchain, which a snapshot has already. */
  revisions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.packages()) if (p.rev) out[p.name] = p.rev;
    return out;
  }
}

/** Where an outside file is, as the page and the agents are told it; `changed`: its package is at
 *  another revision than when the graph was read. */
export function whereOf(f: OutsideFile, changed = false): OutsideWhere {
  return { package: f.package.name, core: f.package.core, rev: f.package.rev, github: f.github, ...(changed ? { changed: true as const } : {}) };
}

/** An outside module's text as GET /api/source answers it, as it does a project file's: its file in
 *  its package, the text, its Lake hash, and where it is (shared/outside.ts); null where it cannot be
 *  read. */
export function outsideSource(f: OutsideFile, changed = false): { module: string; file: string; text: string; hash: string; outside: OutsideWhere } | null {
  let text: string;
  try {
    text = readFileSync(f.path, "utf8");
  } catch {
    return null;
  }
  return { module: f.module, file: f.file, text, hash: lakeTextHash(text), outside: whereOf(f, changed) };
}

/** The toolchain's folder (Lean's sysroot): elan's, where elan installed it (`$ELAN_HOME`, by
 *  default `~/.elan`, `toolchains/<its name>`: `leanprover/lean4:v4.35.0` is
 *  `leanprover--lean4---v4.35.0`); else what `lean --print-prefix` says in the project's folder, a
 *  Lean of its own, never one elan would install first. Null where neither is there. */
export function toolchainDir(root: string, toolchain: string): string | null {
  const full = /^v?\d+\.\d+\.\d+/.test(toolchain) ? `leanprover/lean4:${toolchain.startsWith("v") ? toolchain : `v${toolchain}`}` : toolchain;
  const elan = process.env.ELAN_HOME || join(homedir(), ".elan");
  const dir = join(elan, "toolchains", full.replace(/\//g, "--").replace(/:/g, "---"));
  if (existsSync(join(dir, "lib", "lean"))) return dir;
  if (existsSync(join(elan, "toolchains"))) return null;
  const r = spawnSync("lean", ["--print-prefix"], { cwd: root, encoding: "utf8", timeout: 60_000, env: childEnv() });
  const out = r.status === 0 ? r.stdout.trim() : "";
  return out && existsSync(join(out, "lib", "lean")) ? out : null;
}
