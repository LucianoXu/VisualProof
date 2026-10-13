// From a project to what the page loads: extraction (or a saved one), then the view, both cached
// in the project's cache directory by the extraction's fingerprint (server/dirs.ts); the memory of
// the layout last served is the site's.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import type { ClusterMode, RawUsage, ViewMeta } from "../shared/graph.ts";
import { LAYOUT_VERSION } from "../shared/graph.ts";
import { cachedExtraction, extract, loadSaved, prune } from "./extract.ts";
import type { Extraction } from "./extract.ts";
import { memoryOf } from "../shared/layout.ts";
import type { LayoutMemory } from "../shared/layout.ts";
import type { Project } from "./project.ts";
import { buildView } from "./view.ts";
import { cacheHome } from "./dirs.ts";
import type { Dirs } from "./dirs.ts";

/** the tool's own folder, `src/`; the repository is above it */
export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(SRC, "..");
export const WEB = join(SRC, "web");

/** The page's bundle under a cache root: one folder per checkout of the tool, so that two never
 *  write over each other's. */
export function bundleDirIn(cacheRoot: string): string {
  return join(cacheRoot, "web", createHash("sha1").update(SRC).digest("hex").slice(0, 8));
}

let bundle: string | null = null;
/** Where the page's bundle is made and served from: set once at start, from `--cache`. */
export function useBundleDir(dir: string): void {
  bundle = dir;
}
export function bundleDir(): string {
  return (bundle ??= bundleDirIn(cacheHome()));
}

/** Bumped when the page data derived from an extraction changes shape or layout, so cached
 *  views from an older server are rebuilt rather than served. 7: a notation unit's statement is
 *  its command's text. 8: notation units carry their Lean constant, display form, what they
 *  interpret and their rules. 9: a node's hash is its version, beside the kernel's
 *  (server/versions.ts). */
const VIEW_VERSION = 9;

export interface Prepared {
  fingerprint: string;
  cached: boolean;
  metaGz: Buffer;
  edgesGz: Buffer;
  /** what the usage pass found, where it was merged into the extraction (server/usage.ts): the
   *  exact contexts the server serves with each source */
  usage?: RawUsage | null;
}

/** The layout last served, so the next one can keep everything that survived in place. */
interface StoredMemory {
  /** LAYOUT_VERSION it was made under; another version's memory is not used */
  version?: number;
  fingerprint: string;
  layouts: Partial<Record<ClusterMode, LayoutMemory>>;
}

function loadMemory(siteDir: string): StoredMemory | null {
  try {
    const mem: StoredMemory = JSON.parse(readFileSync(join(siteDir, "layout-memory.json"), "utf8"));
    return mem.version === LAYOUT_VERSION ? mem : null;
  } catch {
    return null;
  }
}

function saveMemory(siteDir: string, fingerprint: string, meta: ViewMeta): void {
  const mem: StoredMemory = { version: LAYOUT_VERSION, fingerprint, layouts: {} };
  for (const mode of ["namespace", "module"] as ClusterMode[]) mem.layouts[mode] = memoryOf(meta.layouts[mode], meta.nodes);
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(join(siteDir, "layout-memory.json"), JSON.stringify(mem));
}

export async function prepare(
  project: Project,
  dirs: Dirs,
  saved: string | null,
  log: (line: string) => void,
  opts: { freshLayout?: boolean; reuse?: string; extraction?: Extraction } = {},
): Promise<Prepared> {
  // `reuse`: lay out an extraction already held, without reading the build (which may be
  // half-written right now); `extraction`: one in hand (the usage pass's, merged)
  const held = opts.extraction ?? (opts.reuse ? cachedExtraction(dirs.cache, opts.reuse) : null);
  if (opts.reuse && !held) throw new Error("the graph on screen is no longer cached; it is laid out afresh at the next build");
  const ex = held ?? (saved ? loadSaved(saved) : await extract(project, dirs, log));
  if (!opts.extraction) log(ex.cached ? `extraction ${ex.fingerprint} reused` : `extraction ${ex.fingerprint} done`);
  const usage = ex.graph.usage ?? null;
  const viewDir = join(dirs.cache, "view");
  mkdirSync(viewDir, { recursive: true });
  const metaFile = join(viewDir, `${ex.fingerprint}-v${VIEW_VERSION}.meta.json.gz`);
  const edgeFile = join(viewDir, `${ex.fingerprint}-v${VIEW_VERSION}.edges.bin.gz`);
  const memory = opts.freshLayout ? null : loadMemory(dirs.site);
  // a cached view is only right if it is the one last served: otherwise lay out again, from
  // the memory of what was last served
  const current = !memory || memory.fingerprint === ex.fingerprint;
  if (!opts.freshLayout && current && existsSync(metaFile) && existsSync(edgeFile)) {
    return { fingerprint: ex.fingerprint, cached: ex.cached, metaGz: readFileSync(metaFile), edgesGz: readFileSync(edgeFile), usage };
  }
  const view = buildView(project, ex, log, memory?.layouts ?? null);
  saveMemory(dirs.site, ex.fingerprint, view.meta);
  const metaGz = gzipSync(JSON.stringify(view.meta));
  const edgesGz = gzipSync(Buffer.from(view.edges.buffer, view.edges.byteOffset, view.edges.byteLength));
  writeFileSync(metaFile, metaGz);
  writeFileSync(edgeFile, edgesGz);
  prune(viewDir, /\.meta\.json\.gz$/, 3);
  prune(viewDir, /\.edges\.bin\.gz$/, 3);
  return { fingerprint: ex.fingerprint, cached: ex.cached, metaGz, edgesGz, usage };
}

function readdirRec(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...readdirRec(p));
    else out.push(p);
  }
  return out;
}

/** The page is bundled when its sources are newer than the bundle, so a checkout runs without a
 *  separate build step. What the page shares with the server (shared/) is its source too. Beside the
 *  page, the workers that lay out the Time Machine's past graphs (web/src/layoutworker.ts) and choose
 *  the overview's edges (web/src/edgeworker.ts) off the page's thread. Bundled into a folder of
 *  its own beside the bundle's, then moved into it a file at a time: a server reading the bundle
 *  meanwhile never reads a file half written. */
export async function ensureBundle(): Promise<void> {
  const dist = bundleDir();
  const out = join(dist, "app.js");
  const srcDir = join(WEB, "src");
  let newest = 0;
  for (const f of [...readdirRec(srcDir), ...readdirRec(join(SRC, "shared"))]) newest = Math.max(newest, statSync(f).mtimeMs);
  const beside = ["layout.js", "edges.js", "pdfworker.js"].every((f) => existsSync(join(dist, f)));
  if (existsSync(out) && beside && statSync(out).mtimeMs >= newest) return;
  const esbuild = await import("esbuild");
  mkdirSync(dirname(dist), { recursive: true });
  const tmp = mkdtempSync(`${dist}.tmp-`);
  try {
    await esbuild.build({
      // pdf.js's worker, which reads the library's PDFs for the reference window (AttachmentSpec
      // decision 11), is bundled beside the page's own workers and served as they are: no outside
      // service. Its legacy build, as the page's, for browsers that lack what the modern one uses
      entryPoints: { app: join(srcDir, "main.ts"), layout: join(srcDir, "layoutworker.ts"), edges: join(srcDir, "edgeworker.ts"), pdfworker: fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")) },
      bundle: true,
      format: "esm",
      // the owner reads in Safari: what Safari 16 lacks of the syntax (pdf.js's class static blocks; a
      // regular expression's lookbehind, read at run time instead) is lowered, as in `build:web`
      target: ["es2022", "safari16"],
      sourcemap: true,
      outdir: tmp,
      logLevel: "warning",
    });
    mkdirSync(dist, { recursive: true });
    for (const f of readdirSync(tmp)) renameSync(join(tmp, f), join(dist, f));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
