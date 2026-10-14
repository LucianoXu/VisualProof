// Run the Lean extractor against a project, or reuse its last result when nothing it reads has
// changed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawGraph } from "../shared/graph.ts";
import type { Project } from "./project.ts";
import type { Dirs } from "./dirs.ts";

export const EXTRACTOR = join(dirname(fileURLToPath(import.meta.url)), "..", "extractor", "Extract.lean");
/** The usage pass's worker (server/usage.ts). */
export const USAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "extractor", "Usage.lean");

/** Mixed into the fingerprint. Bumped when extractions filed before must not be reused, even under
 *  the current Extract.lean's fingerprint: a server started before an update of the extractor runs
 *  the binary it built at start, and files that binary's output under the new source's
 *  fingerprint. 2: axiom sets reach through theorems' proofs. 3: a declaration Lean generated
 *  from a command (`gen`) names the declaration that command writes. 4: units — a declaration
 *  Lean generated from a command folds into the one that command writes (`also`), with its
 *  references, axioms and hash; instances of classes whose instances are all equal are left out
 *  of TCBs as proofs are (TCBSpec.md, decisions 1, 3 and 5). 5: meta-level declarations are
 *  units, and syntax extension commands units of kind `notation` (decision 2). 6: grammar leaves
 *  the TCB (the grammar site), notation units are named after what they declare or interpret. 7:
 *  every unit has a name of its own — a declaration two modules list is taken once, local notation
 *  is qualified with its module's last part, and a name still shared is numbered. 8: each unit's
 *  shape and references, which versions are made from (server/versions.ts). */
const EXTRACTION_VERSION = 8;

/** A fingerprint of everything the extraction depends on: the extractor itself, the toolchain,
 *  the roots, and every .olean of the project (path, size, mtime). Dependencies are pinned by
 *  lake-manifest.json, so it stands in for their builds. */
export function fingerprint(p: Project): string {
  const h = createHash("sha256");
  h.update(`extraction ${EXTRACTION_VERSION}\0`);
  h.update(readFileSync(EXTRACTOR));
  h.update(p.toolchain + "\0" + p.roots.join(",") + "\0");
  const manifest = join(p.root, "lake-manifest.json");
  if (existsSync(manifest)) h.update(readFileSync(manifest));
  const walk = (dir: string) => {
    const ents = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const ent of ents) {
      const f = join(dir, ent.name);
      if (ent.isDirectory()) walk(f);
      else if (ent.name.endsWith(".olean")) {
        const st = statSync(f);
        h.update(`${relative(p.libDir, f)}\0${st.size}\0${st.mtimeMs}\n`);
      }
    }
  };
  walk(p.libDir);
  return h.digest("hex").slice(0, 16);
}

export interface Extraction {
  graph: RawGraph;
  fingerprint: string;
  at: string;
  cached: boolean;
}

/** A Lean program of this tool's (the extractor, the usage pass's worker), compiled with the
 *  project's own toolchain, once per toolchain and version of its source, under the cache's folder
 *  for Lean programs (server/dirs.ts; never in the project): `<lean>/<dir>/<toolchain>/<source
 *  hash>/`, so that checkouts of different versions share the cache without building over each
 *  other. It is built in a folder of its own beside that one and moved into place when done: a
 *  build another server finished first is the one used, and a failed build leaves nothing behind.
 *  Native code runs the extractor's edge walk about three times faster than `lean --run`; if the
 *  build fails, null, and the caller interprets the source or does without. */
export interface LeanProgram {
  /** its folder under the Lean programs' root */
  dir: string;
  source: string;
  /** the executable's name and its root module */
  exe: string;
  root: string;
}

export const EXTRACT_PROGRAM: LeanProgram = { dir: "extractor", source: EXTRACTOR, exe: "vp-extract", root: "Extract" };
export const USAGE_PROGRAM: LeanProgram = { dir: "usage", source: USAGE, exe: "vp-usage", root: "Usage" };

const built = new Map<string, Promise<string | null>>();

export function leanProgram(prog: LeanProgram, toolchain: string, leanRoot: string, log: (l: string) => void): Promise<string | null> {
  const source = readFileSync(prog.source);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const key = [prog.exe, toolchain, hash, leanRoot].join("\0");
  let p = built.get(key);
  if (p) return p;
  p = new Promise((resolveP) => {
    const parent = join(leanRoot, prog.dir, toolchain.replace(/[^A-Za-z0-9.]+/g, "-"));
    const dir = join(parent, hash);
    const bin = join(dir, ".lake", "build", "bin", prog.exe);
    if (existsSync(bin)) return resolveP(bin);
    mkdirSync(parent, { recursive: true });
    const work = mkdtempSync(join(parent, `${hash}.tmp-`));
    writeFileSync(join(work, `${prog.root}.lean`), source);
    writeFileSync(join(work, "lean-toolchain"), toolchain + "\n");
    writeFileSync(join(work, "lakefile.toml"), `name = "${prog.exe.replace(/-/g, "")}"\n\n[[lean_exe]]\nname = "${prog.exe}"\nroot = "${prog.root}"\nsupportInterpreter = true\n`);
    log(`building ${prog.exe} for ${toolchain}…`);
    const child = spawn("lake", ["build", prog.exe], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    child.stdout.on("data", (b: Buffer) => (tail = (tail + b).slice(-2000)));
    child.stderr.on("data", (b: Buffer) => (tail = (tail + b).slice(-2000)));
    let finished = false;
    const done = (ok: boolean) => {
      // a child that failed to start may report both `error` and `close`
      if (finished) return;
      finished = true;
      if (ok) {
        try {
          renameSync(work, dir);
        } catch {
          // another server moved its build of the same source into place first
        }
      } else log(`could not build ${prog.exe}:\n${tail}`);
      rmSync(work, { recursive: true, force: true });
      resolveP(existsSync(bin) ? bin : null);
    };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0 && existsSync(join(work, ".lake", "build", "bin", prog.exe))));
  });
  built.set(key, p);
  return p;
}

/** The extractor, compiled (`leanProgram`); null when it could not be, and it is interpreted. */
export function extractorBinary(toolchain: string, leanRoot: string, log: (l: string) => void): Promise<string | null> {
  return leanProgram(EXTRACT_PROGRAM, toolchain, leanRoot, log);
}

/** `lake env` puts the project's own toolchain and package paths in place, so the extractor
 *  always matches the .olean format it reads. */
function runExtractor(
  p: Project,
  out: string,
  opts: { bin: string | null; cache: string; salt: string },
  log: (line: string) => void,
): Promise<void> {
  return new Promise((resolveP, reject) => {
    const tail_ = ["--cache", opts.cache, "--salt", opts.salt];
    const args = opts.bin
      ? ["env", opts.bin, out, p.libDir, ...p.roots, ...tail_]
      : ["env", "lean", "--run", EXTRACTOR, out, p.libDir, ...p.roots, ...tail_];
    const child = spawn("lake", args, { cwd: p.root, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      tail = (tail + text).slice(-4000);
      for (const line of text.split("\n")) if (line.trim()) log(line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => reject(new Error(`could not start lake: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolveP();
      const missing = tail.match(/object file '[^']*' of module (\S+) does not exist/);
      if (missing) {
        return reject(new Error(
          `the build is incomplete: ${missing[1]} has no .olean. A \`lake build\` is running or ` +
            "failed; VisualProof reads only what a finished build left behind. Retry when it is done.",
        ));
      }
      // modules a project never imports together (two versions of one file, a library of reference
      // statements beside its proofs): Lean cannot import them into one environment
      const clash = tail.match(/import (\S+) failed, environment already contains '([^']+)' from (\S+)/);
      if (clash) {
        return reject(new Error(
          `${clash[1]} and ${clash[3]} cannot be read together: both declare ${clash[2]}. Read fewer: ` +
            "`--root` names the libraries or modules to read (repeatable).",
        ));
      }
      reject(new Error(`extractor exited with ${code}:\n${tail}`));
    });
  });
}

/** Keep the newest `keep` files of a cache directory that match `pattern`; a live session
 *  writes one extraction per build and would otherwise fill the disk. */
export function prune(dir: string, pattern: RegExp, keep: number): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => pattern.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) unlinkSync(join(dir, f));
  } catch {
    // pruning is housekeeping; never a reason to fail
  }
}

/** A saved extraction, served as it is: for a snapshot of a project that is not on this
 *  machine, or not built right now. */
export function loadSaved(file: string): Extraction {
  const text = readFileSync(file, "utf8");
  return {
    graph: JSON.parse(text),
    fingerprint: createHash("sha256").update(text).digest("hex").slice(0, 16),
    at: statSync(file).mtime.toISOString(),
    cached: true,
  };
}

/** An extraction the project's cache already holds, by fingerprint. */
export function cachedExtraction(cacheDir: string, fp: string): Extraction | null {
  const file = join(cacheDir, "extract", `${fp}.json`);
  if (!existsSync(file)) return null;
  return { graph: JSON.parse(readFileSync(file, "utf8")), fingerprint: fp, at: statSync(file).mtime.toISOString(), cached: true };
}

export async function extract(
  p: Project,
  dirs: Pick<Dirs, "cache" | "lean">,
  log: (line: string) => void,
): Promise<Extraction> {
  const fp = fingerprint(p);
  const dir = join(dirs.cache, "extract");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${fp}.json`);
  if (existsSync(file)) {
    return {
      graph: JSON.parse(readFileSync(file, "utf8")),
      fingerprint: fp,
      at: statSync(file).mtime.toISOString(),
      cached: true,
    };
  }
  const tmp = `${file}.tmp`;
  const bin = await extractorBinary(p.toolchain, dirs.lean, log);
  // the per-module cache is only valid for one extractor, toolchain and set of dependencies
  const salt = createHash("sha256")
    .update(readFileSync(EXTRACTOR))
    .update(p.toolchain)
    .update(existsSync(join(p.root, "lake-manifest.json")) ? readFileSync(join(p.root, "lake-manifest.json")) : "")
    .digest("hex")
    .slice(0, 16);
  await runExtractor(p, tmp, { bin, cache: join(dirs.cache, "modules"), salt }, log);
  renameSync(tmp, file);
  prune(dir, /^[0-9a-f]{16}\.json$/, 3);
  return { graph: JSON.parse(readFileSync(file, "utf8")), fingerprint: fp, at: new Date().toISOString(), cached: false };
}
