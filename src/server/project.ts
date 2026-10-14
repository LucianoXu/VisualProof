// What the server knows about the codebase it shows, found by reading files only.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export interface Project {
  root: string;
  name: string;
  toolchain: string;
  /** modules the extractor imports; everything they reach inside the project is shown */
  roots: string[];
  /** what was asked for, as it was named: the default libraries of the lakefile, or the modules of
   *  `--root`; what says which the roots are, where a library stands for many modules (absent: the
   *  roots themselves) */
  targets?: string[];
  /** where Lake writes this package's .olean files */
  libDir: string;
  /** module name → source file, relative to root */
  files: Map<string, string>;
}

export class ProjectError extends Error {}

/** A library as its lakefile declares it: its name, its roots, its globs as Lake writes them in
 *  TOML (`A`: the module; `A.+`: its submodules; `A.*`: the module and its submodules). */
export interface LeanLib {
  name: string;
  roots?: string[];
  globs?: string[];
}

/** What a lakefile says of the package: its name, its default targets, its libraries. */
export interface Lakefile {
  name?: string;
  defaultTargets?: string[];
  libs: LeanLib[];
}

/** `defaultTargets`, the package's name and its `[[lean_lib]]` tables from a lakefile.toml, without
 *  a TOML parser: the keys read are single-line strings or arrays of strings in every lakefile Lake
 *  writes, an array over several lines included. */
export function readLakefileToml(text: string): Lakefile {
  const out: Lakefile = { libs: [] };
  const strings = (v: string) => [...v.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // only the part before the first table header is the package itself
  const head = text.split(/^\s*\[/m)[0];
  const name = head.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (name) out.name = name[1];
  const dt = head.match(/^\s*defaultTargets\s*=\s*\[([^\]]*)\]/m);
  if (dt) out.defaultTargets = strings(dt[1]);
  for (const table of text.split(/^(?=\s*\[)/m)) {
    if (!/^\s*\[\[\s*lean_lib\s*\]\]/.test(table)) continue;
    const lib = table.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (!lib) continue;
    const roots = table.match(/^\s*roots\s*=\s*\[([^\]]*)\]/m);
    const globs = table.match(/^\s*globs\s*=\s*\[([^\]]*)\]/m);
    out.libs.push({ name: lib[1], ...(roots ? { roots: strings(roots[1]) } : {}), ...(globs ? { globs: strings(globs[1]) } : {}) });
  }
  return out;
}

/** The modules a library builds, as Lake decides them: its globs, by default one of each of its
 *  roots, by default its name; a glob of submodules matched against `known`, the modules there are.
 *  A module named alone is kept even unknown, so that what is missing is said. */
export function libModules(lib: LeanLib, known: Iterable<string>): string[] {
  const all = [...known].sort();
  const out = new Set<string>();
  for (const g of lib.globs ?? lib.roots ?? [lib.name]) {
    const glob = /^(.*)\.([+*])$/.exec(g);
    if (!glob) {
      out.add(g);
      continue;
    }
    const [, base, which] = glob;
    if (which === "*" && all.includes(base)) out.add(base);
    for (const m of all) if (m.startsWith(`${base}.`)) out.add(m);
  }
  return [...out];
}

/** The same from a lakefile.lean, read as text, never elaborated (Lake would write into the project
 *  and run its code): the package's name, its libraries with the `roots := #[…]` and
 *  `globs := #[…]` they give, and those marked `@[default_target]`. What a lakefile computes is not
 *  seen; `--root` says it then. */
export function readLakefileLean(text: string): Lakefile {
  const out: Lakefile = { libs: [] };
  const code = stripLeanComments(text);
  // a name: its parts, each plain or in «», joined by dots
  const part = String.raw`(?:«[^»]+»|[A-Za-z_][\w'!?]*)`;
  const ident = String.raw`(${part}(?:\.${part})*)`;
  const unquote = (n: string) => n.replace(/[«»]/g, "");
  const name = code.match(new RegExp(String.raw`^package\s+${ident}`, "m"));
  if (name) out.name = unquote(name[1]);
  const targets: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`(@\[[^\]]*\]\s*)?lean_lib\s+${ident}`, "g"))) {
    // the library's declaration runs to the next line that starts at the margin
    const rest = code.slice(m.index + m[0].length);
    const block = rest.slice(0, rest.search(/\n(?=\S)/) + 1 || rest.length);
    const lib: LeanLib = { name: unquote(m[2]) };
    const roots = block.match(/\broots\s*:=\s*#\[([^\]]*)\]/);
    if (roots) lib.roots = [...roots[1].matchAll(new RegExp("`" + ident, "g"))].map((r) => unquote(r[1]));
    const globs = block.match(/\bglobs\s*:=\s*#\[([^\]]*)\]/);
    if (globs) {
      const kinds: Record<string, string> = { one: "", submodules: ".+", andSubmodules: ".*" };
      lib.globs = [...globs[1].matchAll(new RegExp(String.raw`(?:Glob)?\.(one|submodules|andSubmodules)\s+\x60` + ident, "g"))].map((g) => unquote(g[2]) + kinds[g[1]]);
    }
    out.libs.push(lib);
    if (m[1] && /\bdefault_target\b/.test(m[1])) targets.push(lib.name);
  }
  if (targets.length) out.defaultTargets = targets;
  return out;
}

/** Lean source without its comments: `--` to the end of the line, `/- … -/` nested. Strings are
 *  not looked into: a lakefile's strings hold no comment marks that matter here. */
function stripLeanComments(text: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("/-", i)) {
      depth++;
      i++;
    } else if (depth > 0 && text.startsWith("-/", i)) {
      depth--;
      i++;
    } else if (depth > 0) {
      if (text[i] === "\n") out += "\n";
    } else if (text.startsWith("--", i)) {
      const nl = text.indexOf("\n", i);
      if (nl < 0) break;
      i = nl - 1;
    } else out += text[i];
  }
  return out;
}

/** Every .lean file outside .lake, indexed by each module name it could be: a file
 *  `ThirdParty/Vendored/X.lean` can be `ThirdParty.Vendored.X` or `Vendored.X` depending on the
 *  library's srcDir. The shortest path wins a tie, which is the usual layout. */
export function indexSources(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith(".lean") && !ent.name.startsWith("lakefile")) {
        const rel = relative(root, p);
        const parts = rel.slice(0, -".lean".length).split(sep);
        for (let i = 0; i < parts.length; i++) {
          const mod = parts.slice(i).join(".");
          const prev = files.get(mod);
          if (prev === undefined || prev.length > rel.length) files.set(mod, rel);
        }
      }
    }
  };
  walk(root);
  return files;
}

/** The project's modules a library's globs are matched against: those Lake built (an `.olean` in
 *  `libDir`) that have a source, and, for a project not built yet, those whose source sits where
 *  the module's name says, under the project's folder. */
function knownModules(libDir: string, files: Map<string, string>): Set<string> {
  const known = new Set<string>();
  for (const [mod, rel] of files) if (rel === mod.split(".").join(sep) + ".lean") known.add(mod);
  const walk = (dir: string, prefix: string[]) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(join(dir, ent.name), [...prefix, ent.name]);
      else if (ent.name.endsWith(".olean")) {
        const mod = [...prefix, ent.name.slice(0, -".olean".length)].join(".");
        if (files.has(mod)) known.add(mod);
      }
    }
  };
  walk(libDir, []);
  return known;
}

/** What a project's modules to read are, in words: its targets, and how many modules they stand
 *  for where that is more. */
export function targetsInWords(p: Pick<Project, "roots" | "targets">): string {
  const t = p.targets ?? p.roots;
  return t.join(", ") + (p.roots.length > t.length ? `: ${p.roots.length} modules` : "");
}

export function openProject(path: string, rootsOverride: string[], requireBuild = true): Project {
  const root = resolve(path);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new ProjectError(`${root} is not a directory`);
  }
  const tcFile = join(root, "lean-toolchain");
  if (!existsSync(tcFile)) throw new ProjectError(`no lean-toolchain in ${root}: not a Lean project`);
  const toolchain = readFileSync(tcFile, "utf8").trim();

  let name = basename(root);
  let roots = rootsOverride;
  let targets = rootsOverride;
  const toml = join(root, "lakefile.toml");
  const lean = join(root, "lakefile.lean");
  const lf: Lakefile = existsSync(toml) ? readLakefileToml(readFileSync(toml, "utf8")) : existsSync(lean) ? readLakefileLean(readFileSync(lean, "utf8")) : { libs: [] };
  if (lf.name) name = lf.name;
  const libDir = join(root, ".lake", "build", "lib", "lean");
  const files = indexSources(root);
  if (roots.length === 0 && lf.defaultTargets) {
    // a default target that is a library stands for the modules it builds; any other, for a module
    targets = lf.defaultTargets;
    const known = knownModules(libDir, files);
    const out = new Set<string>();
    for (const t of targets) {
      const lib = lf.libs.find((l) => l.name === t);
      const mods = lib ? libModules(lib, known) : [t];
      // a library with nothing built nor written is named, so that it is said to be unbuilt
      for (const m of mods.length ? mods : [t]) out.add(m);
    }
    roots = [...out];
  }
  if (roots.length === 0) {
    throw new ProjectError(
      "cannot tell which modules to read: pass --root <Module> (the lakefile names no default " +
        "library: no defaultTargets in lakefile.toml, no @[default_target] lean_lib in lakefile.lean)",
    );
  }
  for (const r of requireBuild ? roots : []) {
    const olean = join(libDir, ...r.split(".")) + ".olean";
    if (!existsSync(olean)) {
      throw new ProjectError(
        `${r} has not been built (${relative(root, olean)} is missing). ` +
          "VisualProof reads what `lake build` produced and never builds itself.",
      );
    }
  }
  return { root, name, toolchain, roots, targets, libDir, files };
}
