// What the server knows about the codebase it shows, found by reading files only.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export interface Project {
  root: string;
  name: string;
  toolchain: string;
  /** modules the extractor imports; everything they reach inside the project is shown */
  roots: string[];
  /** where Lake writes this package's .olean files */
  libDir: string;
  /** module name → source file, relative to root */
  files: Map<string, string>;
}

export class ProjectError extends Error {}

/** `defaultTargets` and the package name from a lakefile.toml, without a TOML parser: the two
 *  keys are top-level and single-line in every lakefile Lake writes. */
export function readLakefileToml(text: string): { name?: string; defaultTargets?: string[] } {
  const out: { name?: string; defaultTargets?: string[] } = {};
  // only the part before the first table header is the package itself
  const head = text.split(/^\s*\[/m)[0];
  const name = head.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (name) out.name = name[1];
  const dt = head.match(/^\s*defaultTargets\s*=\s*\[([^\]]*)\]/m);
  if (dt) out.defaultTargets = [...dt[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return out;
}

/** The same from a lakefile.lean, read as text, never elaborated (Lake would write into the project
 *  and run its code): the package's name, and the libraries marked `@[default_target]`, each its
 *  `roots := #[…]` if it gives them, else its own name. What a lakefile computes is not seen;
 *  `--root` says it then. */
export function readLakefileLean(text: string): { name?: string; defaultTargets?: string[] } {
  const out: { name?: string; defaultTargets?: string[] } = {};
  const code = stripLeanComments(text);
  // a name: its parts, each plain or in «», joined by dots
  const part = String.raw`(?:«[^»]+»|[A-Za-z_][\w'!?]*)`;
  const ident = String.raw`(${part}(?:\.${part})*)`;
  const unquote = (n: string) => n.replace(/[«»]/g, "");
  const name = code.match(new RegExp(String.raw`^package\s+${ident}`, "m"));
  if (name) out.name = unquote(name[1]);
  const targets: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`@\[[^\]]*\bdefault_target\b[^\]]*\]\s*lean_lib\s+${ident}`, "g"))) {
    // the library's declaration runs to the next line that starts at the margin
    const rest = code.slice(m.index + m[0].length);
    const block = rest.slice(0, rest.search(/\n(?=\S)/) + 1 || rest.length);
    const roots = block.match(/\broots\s*:=\s*#\[([^\]]*)\]/);
    if (roots) targets.push(...[...roots[1].matchAll(new RegExp("`" + ident, "g"))].map((r) => unquote(r[1])));
    else targets.push(unquote(m[1]));
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
  const toml = join(root, "lakefile.toml");
  const lean = join(root, "lakefile.lean");
  const lf = existsSync(toml) ? readLakefileToml(readFileSync(toml, "utf8")) : existsSync(lean) ? readLakefileLean(readFileSync(lean, "utf8")) : {};
  if (lf.name) name = lf.name;
  if (roots.length === 0 && lf.defaultTargets) roots = lf.defaultTargets;
  if (roots.length === 0) {
    throw new ProjectError(
      "cannot tell which modules to read: pass --root <Module> (the lakefile names no default " +
        "library: no defaultTargets in lakefile.toml, no @[default_target] lean_lib in lakefile.lean)",
    );
  }
  const libDir = join(root, ".lake", "build", "lib", "lean");
  for (const r of requireBuild ? roots : []) {
    const olean = join(libDir, ...r.split(".")) + ".olean";
    if (!existsSync(olean)) {
      throw new ProjectError(
        `${r} has not been built (${relative(root, olean)} is missing). ` +
          "VisualProof reads what `lake build` produced and never builds itself.",
      );
    }
  }
  return { root, name, toolchain, roots, libDir, files: indexSources(root) };
}
