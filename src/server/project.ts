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
function readLakefileToml(text: string): { name?: string; defaultTargets?: string[] } {
  const out: { name?: string; defaultTargets?: string[] } = {};
  // only the part before the first table header is the package itself
  const head = text.split(/^\s*\[/m)[0];
  const name = head.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (name) out.name = name[1];
  const dt = head.match(/^\s*defaultTargets\s*=\s*\[([^\]]*)\]/m);
  if (dt) out.defaultTargets = [...dt[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
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
  if (existsSync(toml)) {
    const lf = readLakefileToml(readFileSync(toml, "utf8"));
    if (lf.name) name = lf.name;
    if (roots.length === 0 && lf.defaultTargets) roots = lf.defaultTargets;
  }
  if (roots.length === 0) {
    throw new ProjectError(
      "cannot tell which modules to read: pass --root <Module> (the lakefile is not TOML, " +
        "or it names no defaultTargets)",
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
