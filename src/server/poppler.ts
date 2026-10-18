// What the server reads of a PDF (AttachmentSpec, "Implementation notes"): poppler's tools, run on
// the file in the library's store — `pdfinfo` for its title, its pages and their sizes,
// `pdftotext -bbox-layout` for its words and where each is on its page, `pdftoppm` for a page as an
// image and for a clip, a region of a page (what a note will carry, decision 12). The words are read
// once per file, every page at a time, and kept; images are kept by file, page, region and width,
// so that the same request is answered from the disk.
//
// Every place is in the page's own fractions (0–1, from its top left), as a link's region is
// (shared/library.ts), so that nothing depends on how large the page is drawn. A PDF is untrusted
// input: the tools are run without a shell, on a path of the server's own, with a time limit, and at
// most two at once.

import { execFile } from "node:child_process";
import { tracked } from "./children.ts";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { plainPunctuation, wordsText } from "../shared/library.ts";
import type { Region, Word } from "../shared/library.ts";

/** A page's size in points, as it is shown: turned where the page is rotated. */
export interface PageSize {
  w: number;
  h: number;
}

/** What `pdfinfo` says of a PDF: its own title, if it has one, its pages and their sizes. */
export interface PdfInfo {
  title: string | null;
  pages: number;
  sizes: PageSize[];
}

/** A word on a page: its text and its box, in the page's fractions (shared/library.ts, which the
 *  reference window reads a page's words with too). */
export type { Word };

/** A page's words, in reading order, each line's words together; `lines[k]` is where line k
 *  starts among them. */
export interface PageWords {
  page: number;
  /** the page's size in points */
  width: number;
  height: number;
  words: Word[];
  lines: number[];
}

/** the longest each tool may run, in ms */
const INFO_MS = 20_000;
const TEXT_MS = 120_000;
const IMAGE_MS = 60_000;
/** the most the tools' output is read, in bytes: the words of a long paper, a large page */
const MAX_OUT = 256 * 1024 * 1024;
/** how many of the tools run at once */
const AT_ONCE = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Run a tool, at most AT_ONCE at a time; its standard output, or why it failed. */
async function run(cmd: string, args: string[], ms: number): Promise<Buffer> {
  if (running >= AT_ONCE) await new Promise<void>((ok) => waiting.push(ok));
  running++;
  try {
    return await new Promise<Buffer>((ok, no) => {
      tracked(
        execFile(cmd, args, { timeout: ms, maxBuffer: MAX_OUT, encoding: "buffer", windowsHide: true }, (err, out, errOut) => {
          if (err) no(new Error(`${cmd} failed: ${(errOut?.toString("utf8").trim().split("\n").pop() ?? "") || err.message}`));
          else ok(out);
        }),
      );
    });
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A PDF's own title (where it has one that says something), its pages, and each page's size. */
export async function pdfInfo(file: string): Promise<PdfInfo> {
  const first = (await run("pdfinfo", ["-enc", "UTF-8", file], INFO_MS)).toString("utf8");
  const pages = Number(/^Pages:[ \t]+(\d+)/m.exec(first)?.[1] ?? "0");
  const title = /^Title:[ \t]*(.*)$/m.exec(first)?.[1]?.trim() || null;
  const sizes: PageSize[] = [];
  if (pages > 0) {
    // every page's size and rotation, so that a region in a page's fractions is read on that page
    const all = (await run("pdfinfo", ["-f", "1", "-l", String(pages), file], INFO_MS)).toString("utf8");
    const size = new Map<number, PageSize>();
    const rot = new Map<number, number>();
    for (const m of all.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) size.set(Number(m[1]), { w: Number(m[2]), h: Number(m[3]) });
    for (const m of all.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)) rot.set(Number(m[1]), Number(m[2]));
    for (let p = 1; p <= pages; p++) {
      const s = size.get(p) ?? size.get(1) ?? { w: 612, h: 792 };
      sizes.push((rot.get(p) ?? 0) % 180 ? { w: s.h, h: s.w } : s);
    }
  }
  return { title: usefulTitle(title), pages, sizes };
}

/** A title a PDF gives itself that says something: not empty, not a file name or a word-processor's
 *  placeholder, nor only an identifier (an arXiv paper's, a DOI), which names a paper without saying
 *  what it is. */
export function usefulTitle(t: string | null): string | null {
  if (!t) return null;
  const s = t.replace(/\s+/g, " ").trim();
  if (!s || /^(untitled|microsoft word - .*|.*\.(docx?|tex|dvi|pdf))$/i.test(s) || IDENTIFIER.test(s)) return null;
  return s.length > 300 ? s.slice(0, 299) + "…" : s;
}

/** A paper's identifier alone: arXiv's, new style (`1910.09336`, `1910.09336v1`) or old
 *  (`math/0211159v1`, `math.GT/0309136`), maybe as `arXiv:…` and with its category after it in
 *  brackets, as arXiv stamps it; or a DOI, bare, as `doi:…` or as its address. */
const IDENTIFIER = /^(?:(?:arxiv:\s*)?(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?(?:\s*\[[^\]]+\])?|(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+)$/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? "",
  );
const frac = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;

/** `pdftotext -bbox-layout`'s XHTML, read: every page's words with their boxes. */
export function parseBboxLayout(xhtml: string): PageWords[] {
  const out: PageWords[] = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  for (let m = pageRe.exec(xhtml), p = 1; m; m = pageRe.exec(xhtml), p++) {
    const width = Number(m[1]), height = Number(m[2]);
    const words: Word[] = [];
    const lines: number[] = [];
    for (const line of m[3].matchAll(/<line[^>]*>([\s\S]*?)<\/line>/g)) {
      lines.push(words.length);
      for (const w of line[1].matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g)) {
        // a glyph its font maps to no character comes as a control character: no text
        const text = unescapeXml(w[5]).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
        if (text) words.push([text, frac(Number(w[1]) / width), frac(Number(w[2]) / height), frac(Number(w[3]) / width), frac(Number(w[4]) / height)]);
      }
    }
    out.push({ page: p, width, height, words, lines });
  }
  return out;
}

/** A page's text as its words make it: a line's words joined by spaces, lines by line breaks; and
 *  where each word starts in it. */
export function pageText(p: PageWords): { text: string; starts: number[] } {
  return wordsText(p.words, p.lines);
}

/** A match of a search: its page, the words it spans with their boxes, and the text around it. */
export interface Match {
  page: number;
  boxes: Region[];
  text: string;
  before: string;
  after: string;
}

/** Find `q` in every page's text: case, runs of white space and typographic quotes and dashes read
 *  loosely; at most `most` matches, in page order. */
export function searchWords(pages: PageWords[], q: string, most = 100): { matches: Match[]; more: boolean } {
  // typed as a keyboard types it: ' finds ’, - finds – (shared/library.ts, plainPunctuation)
  const want = plainPunctuation(q.replace(/\s+/g, " ").trim().toLowerCase());
  const matches: Match[] = [];
  if (!want) return { matches, more: false };
  for (const p of pages) {
    const { text, starts } = pageText(p);
    const flat = plainPunctuation(text.replace(/\n/g, " ").toLowerCase());
    for (let at = flat.indexOf(want); at >= 0; at = flat.indexOf(want, at + 1)) {
      if (matches.length >= most) return { matches, more: true };
      const end = at + want.length;
      const first = Math.max(0, upper(starts, at));
      const last = Math.max(first, upper(starts, end - 1));
      const boxes = p.words.slice(first, last + 1).map(([, x0, y0, x1, y1]) => [x0, y0, x1, y1] as Region);
      matches.push({ page: p.page, boxes, text: text.slice(at, end), before: text.slice(Math.max(0, at - 60), at).replace(/\s+/g, " "), after: text.slice(end, end + 60).replace(/\s+/g, " ") });
    }
  }
  return { matches, more: false };
}

/** The index of the last start at or before `at`. */
function upper(starts: number[], at: number): number {
  let lo = 0, hi = starts.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= at) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** The widths a page or a clip is drawn at: a few, so that what is kept stays small. */
const WIDTHS = [400, 800, 1200, 1600, 2000];
export const clampWidth = (w: number) => WIDTHS.find((x) => x >= w) ?? WIDTHS[WIDTHS.length - 1];

/** A PDF's words, pages and images, kept in `cacheDir/<sha>/`. */
export class PdfReader {
  readonly cacheDir: string;
  private words = new Map<string, Promise<PageWords[]>>();
  private infos = new Map<string, Promise<PdfInfo>>();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private dir(sha: string): string {
    const d = join(this.cacheDir, sha);
    mkdirSync(d, { recursive: true });
    return d;
  }

  /** What `pdfinfo` says of it, once per run. */
  info(sha: string, file: string): Promise<PdfInfo> {
    let p = this.infos.get(sha);
    if (!p) {
      p = pdfInfo(file);
      p.catch(() => this.infos.delete(sha));
      this.infos.set(sha, p);
    }
    return p;
  }

  /** Every page's words: read once, kept on disk (gzipped JSON) and in memory for the last few. */
  allWords(sha: string, file: string): Promise<PageWords[]> {
    let p = this.words.get(sha);
    if (!p) {
      p = (async () => {
        const kept = join(this.dir(sha), "words.json.gz");
        if (existsSync(kept)) {
          try {
            return JSON.parse(gunzipSync(readFileSync(kept)).toString("utf8")) as PageWords[];
          } catch {
            // a file cut short: read again
          }
        }
        const xhtml = (await run("pdftotext", ["-bbox-layout", "-enc", "UTF-8", file, "-"], TEXT_MS)).toString("utf8");
        const pages = parseBboxLayout(xhtml);
        writeAtomic(kept, gzipSync(JSON.stringify(pages)));
        return pages;
      })();
      p.catch(() => this.words.delete(sha));
      if (this.words.size >= 8) this.words.delete(this.words.keys().next().value!);
      this.words.set(sha, p);
    }
    return p;
  }

  /** A page drawn as a PNG `width` pixels wide (one of a few widths). */
  async page(sha: string, file: string, page: number, width: number): Promise<Buffer> {
    const w = clampWidth(width);
    const kept = join(this.dir(sha), `page-${page}-w${w}.png`);
    if (existsSync(kept)) return readFileSync(kept);
    const tmp = join(this.dir(sha), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
      await run("pdftoppm", ["-png", "-f", String(page), "-l", String(page), "-singlefile", "-scale-to-x", String(w), "-scale-to-y", "-1", file, tmp], IMAGE_MS);
      renameSync(`${tmp}.png`, kept);
    } finally {
      rmSync(`${tmp}.png`, { force: true });
    }
    return readFileSync(kept);
  }

  /** A region of a page drawn as a PNG about `width` pixels wide: what a clip shows. */
  async clip(sha: string, file: string, page: number, size: PageSize, region: Region, width: number): Promise<Buffer> {
    const w = clampWidth(width);
    const r = region.map((x) => Math.round(x * 1e4) / 1e4);
    const kept = join(this.dir(sha), `clip-${page}-${r.join("_")}-w${w}.png`);
    if (existsSync(kept)) return readFileSync(kept);
    // the resolution at which the region is `w` pixels wide, within reason
    const dpi = Math.min(600, Math.max(36, (w / ((r[2] - r[0]) * size.w)) * 72));
    const px = (v: number, of: number) => Math.round((v * of * dpi) / 72);
    const x = px(r[0], size.w), y = px(r[1], size.h);
    const W = Math.max(1, px(r[2], size.w) - x), H = Math.max(1, px(r[3], size.h) - y);
    const tmp = join(this.dir(sha), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
      await run("pdftoppm", ["-png", "-f", String(page), "-l", String(page), "-singlefile", "-r", dpi.toFixed(2), "-x", String(x), "-y", String(y), "-W", String(W), "-H", String(H), file, tmp], IMAGE_MS);
      renameSync(`${tmp}.png`, kept);
    } finally {
      rmSync(`${tmp}.png`, { force: true });
    }
    return readFileSync(kept);
  }

  /** What is kept of a file goes (its bytes purged). */
  forget(sha: string): void {
    this.words.delete(sha);
    this.infos.delete(sha);
    rmSync(join(this.cacheDir, sha), { recursive: true, force: true });
  }
}

/** Write a file whole or not at all: to a name of its own first, then renamed into place. */
export function writeAtomic(path: string, data: Buffer | string): void {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
