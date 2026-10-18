// The exported document, compiled (ExportSpec decision 6): a .tex made by shared/doc/latex.ts,
// typeset by XeLaTeX with the style file and the fonts this repository holds (assets/latex/,
// assets/fonts/). Typesetting takes seconds for a large document, so a request starts a job and
// is answered at once; the page asks how the job is doing and fetches the PDF once it is done.
//
// XeLaTeX runs in a temporary directory of its own under the project's cache, never in the project:
// with -no-shell-escape (no program is ever run), -halt-on-error, nothing read from the terminal,
// TeX's paranoid file access (openin_any=p, openout_any=p: nothing read or written by an absolute
// path or outside that directory, beyond TeX's own trees), and a time limit after which it is
// killed. The .tex itself holds nothing a reader wrote that LaTeX would read as a command (its
// escaping, shared/doc/latex.ts); these are a second wall. The directory goes once the run is over,
// whatever happened.
//
// A document is known by a hash of its .tex and the style file: the same request again is the same
// job, running or done, and a done one is kept in a cache of the last few under the project's cache
// (`export/cache/<hash>/`), so that a reader downloading the sources after the PDF, or a second
// reader asking for the same document, does not typeset it again. Its figures (the images and clips
// its notes carry, server/figures.ts) are written beside it in `figures/` before XeLaTeX runs, kept
// with it in the cache and in the sources' zip; their names say what they are drawn from, so the
// .tex names them too.

import { spawn, spawnSync } from "node:child_process";
import { childEnv, DETACH, end, grouped } from "./children.ts";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { FigureFile } from "./figures.ts";

/** The repository's assets: the style file and the fonts it loads. */
const ASSETS = resolve(import.meta.dirname, "..", "assets");
export const STYLE_FILE = join(ASSETS, "latex", "visualproof.sty");
export const FONTS_DIR = join(ASSETS, "fonts");

/** How many runs of XeLaTeX one document may take: the second resolves page references and the
 *  bookmarks; a third only where the second moved a page break. */
const MAX_RUNS = 3;
/** How much of XeLaTeX's log a failed job keeps, in characters: its end, where the error is. */
const LOG_TAIL = 4000;
/** What stands in for a figure that could not be made: a white pixel, so that the rest still prints
 *  and the job's notes say which. */
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC", "base64");
/** A figure's name as the .tex gives it (shared/doc/latex.ts, figureAsset): nothing else is written. */
const FIGURE_NAME = /^(?:fig|clip)-[0-9a-z-]{1,200}\.(?:png|jpg)$/;

/** A document being typeset, or typeset. */
export interface ExportJob {
  /** the hash of its .tex and the style file */
  id: string;
  state: "running" | "done" | "failed";
  /** when it was asked for, ISO */
  at: string;
  /** why it failed, in a few words */
  error?: string;
  /** the end of XeLaTeX's log, where it failed */
  log?: string;
  pages?: number;
  /** how long the typesetting took, all runs together */
  ms?: number;
  runs?: number;
  /** answered from the cache, not typeset for this request */
  cached?: boolean;
  /** what the document does not say about how it was made, for whoever wants to know
   *  (shared/doc/build.ts, `docNotes`): the definitions whose proofs were found by reading their
   *  text, and why. The last request's, where two ask for the same document. */
  notes?: string[];
}

/** A file of a done job, as a response sends it. */
export interface ExportFile {
  body: Buffer;
  type: string;
  name: string;
}

export interface ExporterOptions {
  /** the longest the typesetting of one document may take, all runs together */
  timeoutMs?: number;
  /** the XeLaTeX to run */
  xelatex?: string;
  /** how many done documents the cache keeps */
  maxCached?: number;
  /** how many documents are typeset at once; the rest wait their turn */
  concurrent?: number;
}

export class Exporter {
  readonly dir: string;
  private cacheDir: string;
  private timeoutMs: number;
  private xelatex: string;
  private maxCached: number;
  private concurrent: number;
  private jobs = new Map<string, ExportJob>();
  /** the jobs' ends, for whoever waits on one */
  private ends = new Map<string, Promise<ExportJob>>();
  private running = 0;
  private queue: (() => void)[] = [];
  private found: boolean | null = null;

  constructor(cacheDir: string, o: ExporterOptions = {}) {
    this.dir = join(cacheDir, "export");
    this.cacheDir = join(this.dir, "cache");
    this.timeoutMs = o.timeoutMs ?? 120_000;
    this.xelatex = o.xelatex ?? "xelatex";
    this.maxCached = o.maxCached ?? 20;
    this.concurrent = o.concurrent ?? 2;
  }

  /** Whether a document is being typeset, or waits its turn: no moment to restart in (UpdateSpec
   *  decision 6). */
  get busy(): boolean {
    return this.running > 0 || this.queue.length > 0;
  }

  /** Whether XeLaTeX can be run here: asked once. */
  available(): boolean {
    if (this.found === null) {
      const r = spawnSync(this.xelatex, ["--version"], { stdio: "ignore", timeout: 10_000 });
      this.found = r.status === 0;
    }
    return this.found;
  }

  /** The style file as it is now: part of what names a document, so that a changed style typesets
   *  again. */
  private style(): string {
    return readFileSync(STYLE_FILE, "utf8");
  }

  /** Typeset `tex`: the job that does it, at once — the one already running or done for the same
   *  document, else a new one. `notes`: what the job says besides the document (`ExportJob.notes`).
   *  `figures`: the files the .tex includes from `figures/`, made when it is typeset. */
  compile(tex: string, notes: string[] = [], figures: FigureFile[] = []): ExportJob {
    const sty = this.style();
    const id = createHash("sha256").update(tex).update("\u0000").update(sty).digest("hex").slice(0, 32);
    const note = (j: ExportJob): ExportJob => {
      if (notes.length) j.notes = [...notes];
      else delete j.notes;
      return j;
    };
    const known = this.jobs.get(id);
    if (known && known.state !== "failed") return note(known);
    const kept = this.fromCache(id);
    if (kept) {
      this.remember(note(kept));
      this.ends.set(id, Promise.resolve(kept));
      return kept;
    }
    const job: ExportJob = note({ id, state: "running", at: new Date().toISOString() });
    this.remember(job);
    this.ends.set(
      id,
      this.turn().then(async () => {
        try {
          await this.run(job, tex, sty, figures);
        } catch (e) {
          job.state = "failed";
          job.error = e instanceof Error ? e.message : String(e);
        } finally {
          this.running--;
          this.queue.shift()?.();
        }
        return job;
      }),
    );
    return job;
  }

  /** A job by its id: one this server knows, or one the cache holds. */
  job(id: string): ExportJob | null {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    const j = this.jobs.get(id) ?? this.fromCache(id);
    if (j) this.remember(j);
    return j;
  }

  /** The job once it is over. */
  wait(id: string): Promise<ExportJob | null> {
    return this.ends.get(id) ?? Promise.resolve(this.job(id));
  }

  /** A file of a done job: the PDF, the .tex, the style file, or a zip of everything needed to
   *  typeset it again (the .tex, the style file, the fonts, a README). Null where the job is not
   *  done, or no longer in the cache. */
  file(id: string, what: "pdf" | "tex" | "sty" | "zip"): ExportFile | null {
    const j = this.job(id);
    if (!j || j.state !== "done") return null;
    const at = join(this.cacheDir, id);
    try {
      switch (what) {
        case "pdf":
          return { body: readFileSync(join(at, "doc.pdf")), type: "application/pdf", name: "visualproof-export.pdf" };
        case "tex":
          return { body: readFileSync(join(at, "doc.tex")), type: "application/x-tex; charset=utf-8", name: "visualproof-export.tex" };
        case "sty":
          return { body: readFileSync(join(at, "visualproof.sty")), type: "application/x-tex; charset=utf-8", name: "visualproof.sty" };
        case "zip": {
          const file = join(at, "sources.zip");
          if (!existsSync(file)) writeFileSync(file, this.sources(at));
          return { body: readFileSync(file), type: "application/zip", name: "visualproof-export-sources.zip" };
        }
      }
    } catch {
      // gone from the cache meanwhile
      return null;
    }
  }

  /** A turn to typeset: at most `concurrent` at once, the rest in order. */
  private turn(): Promise<void> {
    if (this.running < this.concurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((ok) =>
      this.queue.push(() => {
        this.running++;
        ok();
      }),
    );
  }

  /** Keep a job among those this server knows, the last hundred. */
  private remember(j: ExportJob): void {
    this.jobs.delete(j.id);
    this.jobs.set(j.id, j);
    while (this.jobs.size > 100) {
      const first = this.jobs.keys().next().value!;
      this.jobs.delete(first);
      this.ends.delete(first);
    }
  }

  /** A done job the cache holds, as a job. */
  private fromCache(id: string): ExportJob | null {
    try {
      const meta = JSON.parse(readFileSync(join(this.cacheDir, id, "job.json"), "utf8")) as ExportJob;
      if (!existsSync(join(this.cacheDir, id, "doc.pdf"))) return null;
      return { id, state: "done", at: meta.at, pages: meta.pages, ms: meta.ms, runs: meta.runs, cached: true, ...(meta.notes?.length ? { notes: meta.notes } : {}) };
    } catch {
      return null;
    }
  }

  /** Typeset in a directory of its own, as often as the log asks (at most MAX_RUNS), then keep
   *  the result in the cache. The directory goes whatever happens. */
  private async run(job: ExportJob, tex: string, sty: string, figures: FigureFile[] = []): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const tmp = mkdtempSync(join(this.dir, "run-"));
    const start = Date.now();
    try {
      writeFileSync(join(tmp, "doc.tex"), tex);
      writeFileSync(join(tmp, "visualproof.sty"), sty);
      // the fonts as the style file loads them, from fonts/ beside the document
      symlinkSync(FONTS_DIR, join(tmp, "fonts"), "dir");
      // the figures the .tex includes; one that cannot be made is a blank, and the job says which
      if (figures.length) mkdirSync(join(tmp, "figures"));
      const failed: string[] = [];
      for (const f of figures) {
        if (!FIGURE_NAME.test(f.name)) continue;
        let bytes: Buffer;
        try {
          bytes = await f.make();
        } catch (e) {
          failed.push(`${f.name} (${e instanceof Error ? e.message : String(e)})`);
          bytes = BLANK_PNG;
        }
        writeFileSync(join(tmp, "figures", f.name), bytes);
      }
      if (failed.length) job.notes = [...(job.notes ?? []), `${failed.length === 1 ? "A figure" : `${failed.length} figures`} could not be drawn and ${failed.length === 1 ? "is" : "are"} left blank: ${failed.join("; ")}.`];
      let log = "";
      let runs = 0;
      for (;;) {
        runs++;
        const left = this.timeoutMs - (Date.now() - start);
        const r = await this.xetex(tmp, left);
        log = readLog(tmp);
        if (r === "timeout") throw Object.assign(new Error(`Typesetting took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped.`), { log });
        if (r !== 0 || !existsSync(join(tmp, "doc.pdf"))) throw Object.assign(new Error(firstError(log) ?? `XeLaTeX failed (exit ${r}).`), { log });
        if (runs >= MAX_RUNS || !rerun(log)) break;
      }
      const at = join(this.cacheDir, job.id);
      mkdirSync(at, { recursive: true });
      for (const f of ["doc.pdf", "doc.tex", "visualproof.sty"]) writeFileSync(join(at, f), readFileSync(join(tmp, f)));
      if (figures.length) cpSync(join(tmp, "figures"), join(at, "figures"), { recursive: true });
      job.state = "done";
      job.pages = pagesOf(log) ?? undefined;
      job.runs = runs;
      job.ms = Date.now() - start;
      writeFileSync(join(at, "job.json"), JSON.stringify({ at: job.at, pages: job.pages, ms: job.ms, runs, ...(job.notes ? { notes: job.notes } : {}) }));
      this.prune();
    } catch (e) {
      job.state = "failed";
      job.error = e instanceof Error ? e.message : String(e);
      const log = (e as { log?: string }).log;
      if (log) job.log = log.slice(-LOG_TAIL);
      job.ms = Date.now() - start;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** One run of XeLaTeX on doc.tex in `cwd`: its exit code, or "timeout" when it was killed. */
  private xetex(cwd: string, timeoutMs: number): Promise<number | "timeout"> {
    return new Promise((ok) => {
      if (timeoutMs <= 0) return ok("timeout");
      const p = grouped(spawn(this.xelatex, ["-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "doc.tex"], {
        cwd,
        // TeX's paranoid file access; and a log whose lines are not wrapped, so that it reads back
        env: childEnv({ openin_any: "p", openout_any: "p", shell_escape: "f", max_print_line: "10000" }),
        stdio: ["ignore", "ignore", "ignore"],
        detached: DETACH,
      }));
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        end(p, "SIGKILL");
      }, timeoutMs);
      p.on("error", () => {
        clearTimeout(timer);
        ok(127);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        ok(killed ? "timeout" : (code ?? 1));
      });
    });
  }

  /** Keep the newest `maxCached` documents of the cache; the rest go. */
  private prune(): void {
    let entries: { dir: string; t: number }[];
    try {
      entries = readdirSync(this.cacheDir).map((d) => ({ dir: join(this.cacheDir, d), t: statSync(join(this.cacheDir, d)).mtimeMs }));
    } catch {
      return;
    }
    entries.sort((a, b) => b.t - a.t);
    for (const e of entries.slice(this.maxCached)) rmSync(e.dir, { recursive: true, force: true });
  }

  /** The zip of a cached document's sources: what anyone needs to typeset it again. */
  private sources(at: string): Buffer {
    const files: { name: string; data: Buffer }[] = [
      { name: "doc.tex", data: readFileSync(join(at, "doc.tex")) },
      { name: "visualproof.sty", data: readFileSync(join(at, "visualproof.sty")) },
      { name: "README.txt", data: Buffer.from(README, "utf8") },
    ];
    const figures = join(at, "figures");
    if (existsSync(figures)) for (const f of readdirSync(figures).sort()) files.push({ name: `figures/${f}`, data: readFileSync(join(figures, f)) });
    for (const f of readdirSync(FONTS_DIR).sort()) files.push({ name: `fonts/${f}`, data: readFileSync(join(FONTS_DIR, f)) });
    return zip(files);
  }
}

/** The sources' README: how to typeset them again, and the macros a document is written in, each
 *  one the style file defines (a test checks it). */
export const README = `This is a document VisualProof exported, as LaTeX.

Typeset it with XeLaTeX, twice (the second run resolves page references and bookmarks):

    xelatex doc.tex
    xelatex doc.tex

doc.tex holds the content only, as semantic macros (\\vpSection, \\begin{vpDecl}, \\vpFullName, \\begin{vpCode}, ...).
How it looks is visualproof.sty's: change it, replace it, or load a package of your own after it
and \\renewcommand what you want different. Its head lists every macro a document uses.

fonts/ holds JuliaMono (SIL Open Font License, fonts/LICENSE-JuliaMono.txt), the code's font, which
visualproof.sty loads from there. figures/, where there is one, holds the images and the clips of
papers the document's notes carry. The text is set in Libertinus (TeX Live), or Latin Modern where
Libertinus is not installed.
`;

/** XeLaTeX's log, as far as there is one. */
function readLog(dir: string): string {
  try {
    return readFileSync(join(dir, "doc.log"), "latin1");
  } catch {
    return "";
  }
}

/** Whether the log asks for another run: references or labels not yet resolved. */
export function rerun(log: string): boolean {
  return /Rerun to get|Label\(s\) may have changed|There were undefined references|Rerun LaTeX|rerunfilecheck Warning: File .* has changed/.test(log);
}

/** How many pages the log says were written. */
export function pagesOf(log: string): number | null {
  const m = /Output written on .*?\((\d+) pages?/.exec(log.replace(/\n/g, ""));
  return m ? Number(m[1]) : null;
}

/** The first error in a log, in a line: TeX's `! …`. */
function firstError(log: string): string | null {
  const m = /^! (.*)$/m.exec(log);
  return m ? `XeLaTeX: ${m[1].slice(0, 300)}` : null;
}

// ---------------------------------------------------------------- a zip, without a dependency

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32, as zip files check their entries with. */
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of `files`, each deflated, its name in UTF-8; dated now, as DOS times go. */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // the name is UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // no extra field, no comment, disk 0, no attributes
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
