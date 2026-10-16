// What the sheet's tips play (GuideSpec decision 6): the tour film, assets/tips/tour.light.mp4, its
// poster and each chapter's key frame (tour-<chapter>.light.webp), where its chapters are
// (tour.chapters.json), and the phone's gestures (phone-fingers.light.mp4) — served as they are
// (they are compressed already) and with byte ranges, which Safari needs to play a video at all;
// and which clips there are.

import { closeSync, createReadStream, fstatSync, openSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream";
import { WEBFONTS } from "./pipeline.ts";

/** where the clips are: beside the artworks' fonts, in the checkout's src/assets or the package's dist/assets */
export const TIPS_DIR = join(dirname(WEBFONTS), "tips");

/** a clip's, a key frame's or the chapters' address */
export const TIP_PATH = /^\/tips\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\.(?:light|dark)\.(?:mp4|webp)|tour\.chapters\.json)$/;

const TYPES: Record<string, string> = { mp4: "video/mp4", webp: "image/webp", json: "application/json" };

/** The clips there are: those recorded in the light theme (the film is light only). */
export function tipClips(dir = TIPS_DIR): string[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.light\.mp4$/.exec(f);
    return m ? [m[1]] : [];
  });
}

/** Whether the request already has the content `etag` names. */
function fresh(req: IncomingMessage, etag: string): boolean {
  const have = req.headers["if-none-match"];
  return !!have && have.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

function answer(res: ServerResponse, code: number, headers: Record<string, string | number> = {}): void {
  res.writeHead(code, headers);
  res.end();
}

/** A clip or a key frame: the whole file, or the range asked for (206), or what cannot be given
 *  (416). The file is opened before anything is answered, so that one that cannot be read is a
 *  404 rather than a cut connection; it is closed however the answer ends — sent, refused, or the
 *  reader gone in the middle of it. */
export function sendMedia(req: IncomingMessage, res: ServerResponse, file: string): void {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return answer(res, 404, { "content-type": "application/json", "cache-control": "no-store" });
  }
  let size: number, mtime: number;
  try {
    ({ size, mtimeMs: mtime } = fstatSync(fd));
  } catch {
    closeSync(fd);
    return answer(res, 404);
  }
  const etag = `"${size.toString(36)}-${Math.round(mtime).toString(36)}"`;
  const head = { "content-type": TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream", "cache-control": "no-cache", etag, "accept-ranges": "bytes" };
  const done = (code: number, headers: Record<string, string | number>) => {
    closeSync(fd);
    answer(res, code, headers);
  };
  if (fresh(req, etag)) return done(304, head);
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? "").trim());
  let start = 0, end = size - 1;
  if (m && (m[1] || m[2])) {
    // from a byte to another (or to the end), or the last so many
    if (m[1]) [start, end] = [Number(m[1]), m[2] ? Math.min(Number(m[2]), size - 1) : size - 1];
    else start = Math.max(0, size - Number(m[2]));
    if (start > end) return done(416, { "content-range": `bytes */${size}` });
    res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
  } else res.writeHead(200, { ...head, "content-length": size });
  if (req.method === "HEAD" || size === 0) {
    closeSync(fd);
    return void res.end();
  }
  // the stream owns the descriptor from here: pipeline destroys it, and so closes the file, when
  // the answer is sent, fails, or the reader goes away
  pipeline(createReadStream(file, { fd, start, end, autoClose: true }), res, () => {});
}
