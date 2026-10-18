// `visualproof doctor [<lean-project>]`: what this machine, and a project, need for VisualProof to
// run, each checked, with what to do where it falls short; and whether a newer VisualProof is out,
// asked of the npm registry through npm (UpdateSpec decision 1). It changes nothing: it runs no Lake
// (in a project's folder that would install its toolchain, and Lake may build), and makes no folder.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { filmPin } from "./film.ts";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { cacheHome, projectDirs, siteHolder } from "./dirs.ts";
import { cmp, packageVersion, parseVersion, satisfies } from "./version.ts";
import { choose, FROM_PACKAGE, installCommand, newerThan, newest, notesOf, npmCommand, PACKAGE_ROOT, readInfo, sameMinor, Versions } from "./updates.ts";

export { packageVersion, satisfies };
import { ProjectError, openProject, targetsInWords } from "./project.ts";

/** ok; fail: VisualProof cannot run until it is fixed; warn: it runs, without something; info: optional */
export type Level = "ok" | "fail" | "warn" | "info";

export interface Check {
  level: Level;
  what: string;
  /** what to do, where it falls short */
  fix?: string;
}

export interface Report {
  checks: Check[];
  /** what is known of VisualProof's newer releases, in a line */
  updates: string;
  /** the tips' tour film: kept, or fetched on its first play, or never (UpdateSpec decision 14) */
  film: string;
  /** the command that serves the project, when nothing failed */
  ready: string | null;
}

/** What the doctor asks of the machine: a program's output (run in `cwd`, where one is said), or
 *  null when it cannot be run. */
export type Run = (cmd: string, args: string[], cwd?: string) => string | null;

export const run: Run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"], ...(cwd ? { cwd } : {}) });
  return r.error || r.status !== 0 ? null : `${r.stdout}${r.stderr}`;
};

/** The package's own file, read where both a checkout and the installed package have it. */
function packageFile(rel: string): string {
  return join(import.meta.dirname, "..", "..", rel);
}

/** A toolchain as elan names it: `leanprover/lean4:v4.33.1`, whether the project writes it so, or
 *  as a bare version, or elan lists it as its folder's name (`leanprover--lean4---v4.33.1`). */
export function toolchainName(t: string): string {
  const s = t.trim().replace(/\s+\(.*\)$/, "");
  if (/^[\w.-]+--[\w.-]+---/.test(s)) return s.replace("---", ":").replace("--", "/");
  return s.includes(":") ? s : `leanprover/lean4:${s.startsWith("v") ? s : `v${s}`}`;
}

/** The Lean versions supported (test/toolchains.json): the oldest, and the newest tested. */
export function supportedToolchains(): { floor: string; newest: string } {
  const t = JSON.parse(readFileSync(packageFile("test/toolchains.json"), "utf8")) as { floor: string; toolchains: string[] };
  const newest = [...t.toolchains].sort((a, b) => cmp(parseVersion(a)!, parseVersion(b)!)).at(-1)!;
  return { floor: t.floor, newest };
}

/** Where a toolchain stands: before the oldest supported, within what is tested, or after it. A
 *  release candidate counts as its release. */
export function toolchainSupport(toolchain: string, s = supportedToolchains()): "old" | "tested" | "new" | "other" {
  const name = toolchainName(toolchain);
  if (!name.startsWith("leanprover/lean4:")) return "other";
  const v = parseVersion(name);
  if (!v) return "other";
  if (cmp(v, parseVersion(s.floor)!) < 0) return "old";
  return cmp(v, parseVersion(s.newest)!) > 0 ? "new" : "tested";
}

/** Whether a folder could be made and written here: it, or the nearest folder above it that is. */
function writable(dir: string): boolean {
  let d = resolve(dir);
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  try {
    accessSync(d, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function install(what: "poppler" | "xelatex", platform: NodeJS.Platform): string {
  if (what === "poppler") return platform === "darwin" ? "brew install poppler" : "install poppler-utils (Debian, Ubuntu: sudo apt install poppler-utils)";
  return platform === "darwin" ? "install MacTeX, or brew install --cask mactex-no-gui" : "install TeX Live's XeLaTeX (Debian, Ubuntu: sudo apt install texlive-xetex texlive-latex-extra)";
}

export interface DoctorOptions {
  /** the Lean project, if one is to be checked */
  path: string | null;
  roots: string[];
  site: string | null;
  cache: string | null;
  run?: Run;
  node?: string;
  platform?: NodeJS.Platform;
  /** whether this is an installed package's doctor, whose releases are npm's (a test says) */
  fromPackage?: boolean;
  /** the updates' mode, as VISUALPROOF_UPDATES says it (off: the registry is not asked) */
  updates?: string;
}

/** What the registry says of the releases beyond this one, in a line (UpdateSpec decisions 1–4, 7):
 *  asked through npm under this Node, unless updates are off (VISUALPROOF_UPDATES=off); with what
 *  this machine's servers set aside. */
function updatesLine(exec: Run, node: string, fromPackage: boolean, cacheRoot: string, mode: string | undefined, site: string | null): string {
  const running = packageVersion();
  if (!fromPackage) return "a checkout: its updates are git's, not npm's";
  if (mode === "off") return "not asked (VISUALPROOF_UPDATES=off)";
  // what is set aside now (for the project's site, where one is checked), and where its patches are paused
  const kept = new Versions(cacheRoot);
  const held = kept.reasons(Date.now(), site);
  const paused = kept.paused(site);
  const bad = new Map(held.map((h) => [h.version, h]));
  const aside =
    (held.length ? `; set aside here: ${held.map((h) => `${h.version} (${h.why})`).join(", ")}` : "") +
    (paused ? `; this site's patches up to ${paused.upTo} are not taken (${paused.why})` : "");
  const { cmd, args } = npmCommand();
  // run where no project's .npmrc applies: the caches' root, else the temporary folder
  const cwd = existsSync(cacheRoot) ? cacheRoot : tmpdir();
  const ask = (more: string[]) => exec(cmd, [...args, ...more, "--fetch-timeout=15000", "--fetch-retries=1"], cwd);
  // npm's own warnings come after its answer: the answer alone is read
  const json = (out: string | null, re: RegExp): unknown => {
    const m = out === null ? null : re.exec(out)?.[0];
    try {
      return m ? JSON.parse(m) : undefined;
    } catch {
      return undefined;
    }
  };
  const v = json(ask(["view", "visualproof", "versions", "--json"]), /\[[^\]]*\]|"[^"\n]*"/);
  if (v === undefined) return `the npm registry could not be asked (offline, or npm not found): not checked${aside}`;
  const versions = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
  // the engines of the newest beyond this one: those the doctor would name
  const engines = new Map<string, string>();
  const deprecated = new Set<string>();
  const first = choose(running, versions, { bad: new Set(bad.keys()) });
  for (const c of [first.patch, first.release]) {
    if (!c || engines.has(c)) continue;
    const out = ask(["view", `visualproof@${c}`, "engines", "deprecated", "--json"]);
    const info = out === null ? null : readInfo(/^[\s\S]*?(\{[\s\S]*\}|"[^"\n]*")/.exec(out)?.[1] ?? "");
    if (!info) continue;
    engines.set(c, info.engines);
    if (info.deprecated) deprecated.add(c);
  }
  // only versions npm said the engines and deprecation of are named: one it could not say of is not
  const { patch, release } = choose(running, versions.filter((x) => engines.has(x)), { node, bad: new Set(bad.keys()), engines: (x) => engines.get(x), deprecated });
  const skipped = newest(versions.filter((x) => newerThan(x, running)));
  const unsaid = [first.patch, first.release].find((c) => c && !engines.has(c));
  if (release && !sameMinor(release, running)) return `${release} is out: ${installCommand(PACKAGE_ROOT, release)} (${notesOf(release)}); a server restarts into it by itself${aside}`;
  // the pause is said in `aside`: no server here takes this one
  if (patch && paused && !newerThan(patch, paused.upTo)) return `${patch} is out, not taken${aside}, for a day or until a newer patch`;
  if (patch) return `${patch} is out: a server takes it by itself (--updates auto), or ${installCommand(PACKAGE_ROOT, patch)}${aside}`;
  if (unsaid) return `${unsaid} is out, but npm could not say what it needs: not checked${aside}`;
  if (skipped && deprecated.has(skipped)) return `${skipped} is out, but deprecated by its publisher${aside}`;
  if (skipped && engines.has(skipped)) return `${skipped} is out, but needs Node ${engines.get(skipped)}; this is ${node}${aside}`;
  return `the latest release${aside}`;
}

/** The tips' tour film, in a line: kept in the cache, or fetched on its first play, or never. */
function filmLine(cacheRoot: string, mode: string | undefined): string {
  if (process.env.VISUALPROOF_TOUR_FILM) return `the local file ${process.env.VISUALPROOF_TOUR_FILM} (VISUALPROOF_TOUR_FILM)`;
  const pin = filmPin();
  if (!pin) return "none pinned in this package";
  const kept = join(cacheRoot, "media", `${pin.sha256}.mp4`);
  try {
    if (statSync(kept).size === pin.size) return `kept (${kept})`;
  } catch {
    // not kept yet
  }
  if (mode === "off") return "never fetched (VISUALPROOF_UPDATES=off): the tour shows its stills and captions";
  return `fetched from the project's GitHub release on its first play (${(pin.size / 1e6).toFixed(0)} MB)`;
}

export function doctor(o: DoctorOptions): Report {
  const exec = o.run ?? run;
  const node = o.node ?? process.versions.node;
  const platform = o.platform ?? process.platform;
  const checks: Check[] = [];
  const engines: string = JSON.parse(readFileSync(packageFile("package.json"), "utf8")).engines?.node ?? "";
  checks.push(
    satisfies(node, engines)
      ? { level: "ok", what: `Node ${node}` }
      : { level: "fail", what: `Node ${node}: VisualProof needs ${engines.replace(/\s*\|\|\s*/g, " or ")}`, fix: "install a newer Node (https://nodejs.org), the current LTS" },
  );

  const elan = exec("elan", ["--version"]);
  const installed = new Set(
    (elan ? (exec("elan", ["toolchain", "list"]) ?? "") : "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^no installed toolchains/i.test(l))
      .map(toolchainName),
  );
  checks.push(
    elan
      ? { level: "ok", what: `${elan.trim().split("\n")[0].replace(/\s+\(.*\)$/, "")}, ${installed.size} toolchain(s) installed` }
      : { level: "fail", what: "elan not found: it runs each project's Lean and Lake", fix: "install elan: https://github.com/leanprover/elan" },
  );

  const poppler = ["pdfinfo", "pdftotext", "pdftoppm"].filter((p) => exec(p, ["-v"]) === null);
  checks.push(
    poppler.length === 0
      ? { level: "ok", what: `Poppler ${/version\s+([\d.]+)/.exec(exec("pdfinfo", ["-v"]) ?? "")?.[1] ?? ""}`.trimEnd() }
      : { level: "warn", what: `Poppler: ${poppler.join(", ")} not found: the library cannot read PDFs`, fix: install("poppler", platform) },
  );
  const xelatex = exec("xelatex", ["--version"]);
  checks.push(
    xelatex
      ? { level: "ok", what: `XeLaTeX (${/TeX Live \d+|MiKTeX[^\s)]*/.exec(xelatex)?.[0] ?? "found"})` }
      : { level: "info", what: "XeLaTeX not found: needed only for the printed document (Export)", fix: install("xelatex", platform) },
  );
  if (exec("git", ["--version"]) === null) {
    checks.push({ level: "info", what: "git not found: builds are kept without their commit, and past sources only as the builds kept them; a branch cannot be followed (serve <git URL>)" });
  }

  const film = filmLine(o.cache ? resolve(o.cache) : cacheHome(), o.updates ?? process.env.VISUALPROOF_UPDATES);
  const updates = updatesLine(exec, node, o.fromPackage ?? FROM_PACKAGE, o.cache ? resolve(o.cache) : cacheHome(), o.updates ?? process.env.VISUALPROOF_UPDATES, o.path === null ? null : projectDirs(resolve(o.path), o.site, o.cache).site);
  if (o.path === null) return { checks, updates, film, ready: null };

  let project;
  try {
    project = openProject(o.path, o.roots, false);
  } catch (e) {
    if (!(e instanceof ProjectError)) throw e;
    checks.push({ level: "fail", what: e.message });
    return { checks, updates, film, ready: null };
  }
  const { root, toolchain, roots, libDir } = project;
  const name = toolchainName(toolchain);
  const support = toolchainSupport(name);
  const range = supportedToolchains();
  checks.push(
    support === "tested"
      ? { level: "ok", what: `${name}: supported (${range.floor} to ${range.newest} are tested)` }
      : support === "old"
        ? { level: "fail", what: `${name}: older than ${range.floor}, the oldest Lean VisualProof reads`, fix: "update the project's toolchain, or use it with a Lean VisualProof supports" }
        : support === "new"
          ? { level: "warn", what: `${name}: newer than ${range.newest}, the newest tested; it probably works`, fix: "if the graph cannot be read, report it: https://github.com/LucianoXu/VisualProof/issues" }
          : { level: "warn", what: `${name}: not a release of leanprover/lean4; VisualProof is tested on releases` },
  );
  if (elan && !installed.has(name)) {
    checks.push({ level: "warn", what: `${name} is not installed: elan downloads it when VisualProof first runs Lake here`, fix: `elan toolchain install ${name}` });
  }
  const from = o.roots.length ? "--root" : existsSync(join(root, "lakefile.toml")) ? "lakefile.toml" : "lakefile.lean";
  const missing = roots.filter((r) => !existsSync(join(libDir, ...r.split(".")) + ".olean"));
  const mathlib = ["lakefile.toml", "lakefile.lean", "lake-manifest.json"].some((f) => existsSync(join(root, f)) && /mathlib/i.test(readFileSync(join(root, f), "utf8")));
  checks.push(
    missing.length === 0
      ? { level: "ok", what: `built: ${targetsInWords(project)} (from ${from})` }
      : {
          level: "fail",
          what: `not built: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""} (${relative(root, join(libDir, ...missing[0].split("."))) + ".olean"} is missing; from ${from})`,
          fix: `in ${root}: ${mathlib ? "lake exe cache get && " : ""}lake build${o.roots.length === 0 && from === "lakefile.lean" ? ", or name the modules to read with --root" : ""}`,
        },
  );
  const dirs = projectDirs(root, o.site, o.cache);
  for (const [what, dir] of [["site", dirs.site], ["cache", dirs.cache]] as const) {
    if (!writable(dir)) checks.push({ level: "fail", what: `the ${what} ${dir} cannot be written`, fix: `give --${what} a folder of your own` });
  }
  const holder = siteHolder(dirs.site);
  checks.push(
    holder === null
      ? { level: "ok", what: `site ${dirs.site}` }
      : { level: "info", what: `site ${dirs.site}: a server (process ${holder}) is serving it; another needs a --site of its own` },
  );
  const failed = checks.some((c) => c.level === "fail");
  const args = [o.path, ...o.roots.flatMap((r) => ["--root", r]), ...(o.site ? ["--site", o.site] : []), ...(o.cache ? ["--cache", o.cache] : [])];
  return { checks, updates, film, ready: failed ? null : `visualproof serve ${args.map((a) => (/^[\w./:@%+=-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}` };
}

const MARK: Record<Level, string> = { ok: "✓", fail: "✗", warn: "!", info: "·" };

export function printReport(r: Report, project: string | null): string {
  const lines = [`VisualProof ${packageVersion()}`];
  for (const c of r.checks) {
    lines.push(`  ${MARK[c.level]} ${c.what}`);
    if (c.fix && c.level !== "ok") lines.push(`      ${c.fix}`);
  }
  lines.push(`  updates: ${r.updates}`, `  tour film: ${r.film}`);
  if (r.ready) lines.push("", `Ready: ${r.ready}`);
  else if (project === null && !r.checks.some((c) => c.level === "fail")) lines.push("", "To check a project too: visualproof doctor <lean-project>");
  return lines.join("\n");
}
