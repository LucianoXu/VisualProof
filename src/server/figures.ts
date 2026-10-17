// The figures of an exported document (the owner's decisions of 2026-10-12): the images and the PDF
// clips the notes it prints carry. An image comes from the library's bytes, a PNG or a JPEG as it is
// — what XeLaTeX reads — and a WebP or a GIF turned into a PNG by ImageMagick where the server has it
// (its first frame, for a GIF that moves), and so is a PNG of 16 bits a channel, which XeLaTeX's PDF
// driver draws blank where it has transparency (TeX Live 2023's xdvipdfmx, seen on a whiteboard
// photo); a clip from the server's clip renderer (server/poppler.ts, the one GET /api/library/clip
// answers from, with its cache) at print resolution. What cannot be drawn — a file whose bytes this
// server lacks, an image no tool here can turn into a PNG — prints as a reference instead, and the
// export's notes say so.

import { spawn, spawnSync } from "node:child_process";
import { childEnv, DETACH, end, grouped } from "./children.ts";
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocFiles } from "../shared/doc/build.ts";
import { figureAssets } from "../shared/doc/latex.ts";
import type { DocModel } from "../shared/doc/model.ts";
import { fileOf } from "../shared/library.ts";
import type { FileType, LibraryData } from "../shared/library.ts";
import type { NoteCarry } from "../shared/sticky.ts";
import type { Library } from "./library.ts";
import type { PageSize } from "./poppler.ts";

/** how long turning one image into a PNG may take */
const CONVERT_MS = 20_000;

let tool: string | null | undefined;
/** ImageMagick's command where the server has it (`magick`, else `convert`), asked once; null
 *  without it. */
export function imageTool(): string | null {
  if (tool === undefined) {
    tool = null;
    for (const t of ["magick", "convert"]) {
      const r = spawnSync(t, ["-version"], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
      if (r.status === 0 && /ImageMagick/i.test(r.stdout?.toString() ?? "")) {
        tool = t;
        break;
      }
    }
  }
  return tool;
}

/** Whether the PNG at `path` has 16 bits a channel (its header's bit depth). */
function deepPng(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const head = Buffer.alloc(25);
      readSync(fd, head, 0, 25, 0);
      return head.toString("latin1", 12, 16) === "IHDR" && head[24] === 16;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Whether an image needs turning into a PNG before XeLaTeX reads it: a WebP, a GIF, a PNG of 16 bits
 *  a channel. */
const needsTurning = (path: string, type: string): boolean => type === "webp" || type === "gif" || (type === "png" && deepPng(path));

/** Whether the image `sha` of the library (`path`), of `type`, can be drawn into a document here. */
export function drawable(path: string, type: FileType): boolean {
  if (type !== "png" && type !== "jpeg" && type !== "webp" && type !== "gif") return false;
  return !needsTurning(path, type) || imageTool() !== null;
}

/** What the builder needs to know of the library's files for the figures of the notes `carried`
 *  (every note a document may print): whether the server has each file, whether an image can be
 *  drawn, and the size of each page a clip is of, read with `pdfinfo` (cached per file) before the
 *  document is built. */
export async function docFiles(library: Library | undefined, carried: Iterable<readonly NoteCarry[] | undefined>): Promise<DocFiles> {
  const sizes = new Map<string, PageSize[]>();
  if (library) {
    const pdfs = new Set<string>();
    for (const cs of carried) for (const c of cs ?? []) if (c.region && library.has(c.file)) pdfs.add(c.file);
    await Promise.all(
      [...pdfs].map(async (sha) => {
        try {
          sizes.set(sha, (await library.pdf.info(sha, library.path(sha))).sizes);
        } catch {
          // a PDF poppler cannot read: its clips print at the width of the text, or fail as figures
        }
      }),
    );
  }
  return {
    has: (sha) => library?.has(sha) ?? false,
    drawable: (sha, type) => !!library?.has(sha) && drawable(library.path(sha), type),
    pageSize: (sha, page) => sizes.get(sha)?.[page - 1] ?? null,
  };
}

/** A figure's file as the typesetting writes it beside the document: its name, and how it is made. */
export interface FigureFile {
  name: string;
  make(): Promise<Buffer>;
}

/** The figures document `doc` prints, each as the file the .tex names (shared/doc/latex.ts,
 *  figureAssets), made from the library when it is typeset. */
export function figureFiles(doc: DocModel, library: Library | undefined): FigureFile[] {
  return figureAssets(doc).map((a) => ({
    name: a.name,
    make: async () => {
      if (!library?.has(a.file)) throw new Error("this server does not have the file");
      const path = library.path(a.file);
      if (a.region && a.page) {
        const info = await library.pdf.info(a.file, path);
        return library.pdf.clip(a.file, path, a.page, info.sizes[a.page - 1] ?? { w: 612, h: 792 }, a.region, a.px ?? 2000);
      }
      return needsTurning(path, a.type) ? toPng(path, a.type) : readFileSync(path);
    },
  }));
}

/** An image of the library turned into a PNG of 8 bits a channel by ImageMagick: read as the type
 *  the library found in its bytes, never as what its content might claim (`webp:`, `gif:`, `png:`),
 *  its first frame alone. */
async function toPng(path: string, type: string): Promise<Buffer> {
  const t = imageTool();
  if (!t || (type !== "webp" && type !== "gif" && type !== "png")) throw new Error(`a ${type} image cannot be drawn here`);
  const dir = mkdtempSync(join(tmpdir(), "vp-fig-"));
  const out = join(dir, "out.png");
  try {
    await new Promise<void>((ok, no) => {
      const p = grouped(spawn(t, ["-limit", "memory", "256MiB", "-limit", "disk", "1GiB", `${type}:${path}[0]`, "-depth", "8", `png:${out}`], { stdio: ["ignore", "ignore", "ignore"], detached: DETACH, env: childEnv() }));
      const timer = setTimeout(() => end(p, "SIGKILL"), CONVERT_MS);
      p.on("error", (e) => {
        clearTimeout(timer);
        no(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) ok();
        else no(new Error(`ImageMagick could not read the ${type} image`));
      });
    });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What an export's notes say of the images and clips the notes it prints carry (`notes`, those its
 *  view shows, every one of which it prints) that print as references rather than figures: those
 *  whose file this server lacks, and the images it cannot draw. */
export function figureNotes(notes: readonly { note: { carries?: NoteCarry[] } }[], d: LibraryData, files: DocFiles): string[] {
  const lacks = new Set<string>();
  const cannot = new Set<string>();
  for (const { note } of notes)
    for (const c of note.carries ?? []) {
      const f = fileOf(d, c.file);
      // a whole PDF prints as a reference anyway
      if (!f || (f.type === "pdf" && !c.region)) continue;
      if (!files.has(f.sha)) lacks.add(f.title);
      else if (f.type !== "pdf" && !files.drawable(f.sha, f.type)) cannot.add(f.title);
    }
  const out: string[] = [];
  if (lacks.size) out.push(`This server does not have the file${lacks.size === 1 ? "" : "s"} of ${[...lacks].join(", ")}: the images and clips the notes carry of ${lacks.size === 1 ? "it are" : "them are"} printed as references, not as figures.`);
  if (cannot.size) out.push(`${[...cannot].join(", ")} cannot be drawn into the document here (turning ${cannot.size === 1 ? "it" : "them"} into a PNG needs ImageMagick): printed as a reference, not as a figure.`);
  return out;
}
