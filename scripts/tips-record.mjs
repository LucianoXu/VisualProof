#!/usr/bin/env node
// The tips' films (GuideSpec, "Demonstrations"): the real page, a drawn pointer doing what a tip
// teaches, framed on what it is about. The tour is one film of a review in chapters, with captions,
// on Sphere-Packing-Lean, from an empty site; the phone's gestures one short clip, on the
// flt-regular showcase. Each is played by a storyboard (scripts/tips/storyboards/<id>.mjs) on a
// server of this checkout, in a headless Chromium whose clock is faked: every frame is the page at an
// exact time, so a film made twice is the same film. Frames are encoded by the browser itself as they
// are taken (WebCodecs, H.264) and put in an MP4 here (scripts/tips/mp4.mjs); the stills are WebPs.
// Light theme, the Kind palette. A tool for development, not part of the package: it needs
// Playwright (CONTRIBUTING.md, "Scripts").
//
//   npm run tips:record -- --sphere <Sphere-Packing-Lean, built> --showcase <flt-regular built at
//                          b8a5f23> --film <dir> [--cache <dir>] [<id>…] [--chapters <c>,…]
//                          [--jobs <n>] [--preview] [--out <dir>] [--url <server>] [--hashes]
//                          [--frames <dir>] [--boards <dir>]
//
// A film is recorded chapter by chapter, by several processes at once (--jobs; by default as many as
// the machine's threads and memory allow): each has a server on a new site and a Chromium of its own,
// plays the storyboard from its start, without taking frames, up to the chapters it was given — the
// page doing all it does when they are taken, but for drawing the board (scripts/tips/inpage.mjs) —
// then takes those, each encoded on its own from a key frame. The film is their samples one after
// another, nothing encoded again (scripts/tips/film.mjs), its chapters' times and its captions moved
// by the chapters before them. A chapter recorded so is the chapter recorded in sequence, to within
// the few pixels two recordings differ by (CONTRIBUTING.md). --chapters <c>,… records those chapters
// alone and splices them into the film that was (<film>/<id>.mp4, which <out>/<id>.json must pin),
// the others kept to the byte; only the recorded chapters' stills are written. --preview makes a
// quick film for writing a storyboard, never for a release (PREVIEW): beside the film, never into
// the repository. TIPS_PROFILE=1: where each process's time went.
//
// --sphere, --showcase: the projects' builds, as a storyboard's `on` asks for one (the showcase:
// showcase/flt-regular/setup.sh). A server is started on it for each process, on a site of its own
// made anew (the showcase's: a copy of its committed site), so that every film starts from the same
// review, the server's clock following the film's (scripts/tips/serverclock.mjs).
// --cache: the caches it reads (made once, then reused: an extraction takes minutes).
// --url: a server already serving the project, with full access, instead (its site is then
// whatever it is, one process: for trying a storyboard, not for the films kept). Without ids
// named, all of them.
// --film: where a film the repository does not keep goes (the tour, published as a release's asset):
// <dir>/<id>.mp4 and <dir>/<id>.mp4.sha256. What the repository keeps goes to src/assets/tips/ (--out):
// for the tour <id>.json (the film's name, digest, size and length, its chapters, its captions),
// <id>.webp (its poster) and <id>-<chapter>.webp (each chapter's key frame); for a clip kept whole,
// <id>.light.mp4 and <id>.light.webp. For writing a storyboard: --hashes writes <id>.frames.txt
// beside the film, a digest per frame taken, by chapter (two recordings compared); --frames <dir>
// every frame taken as a JPEG, <dir>/<id>/<chapter>/ by its number in the chapter and <dir>/<id>/
// by its number in the film; --boards <dir> takes storyboards from another folder.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { availableParallelism, freemem, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inPage } from "./tips/inpage.mjs";
import { groups, join as joinFilm, split } from "./tips/film.mjs";
import { mp4, readMp4 } from "./tips/mp4.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BOARDS = join(REPO, "scripts", "tips", "storyboards");

/** What every film is, unless its storyboard says otherwise: the page's window, the film's size and
 *  pace, the bits a second the encoder aims at (it gives more where much moves). */
export const FILM = {
  viewport: { width: 1440, height: 900 },
  // twice the 1280×800 the frame holds most of the time
  out: { width: 2560, height: 1600 },
  fps: 30,
  bitrate: 2_400_000,
  // a key frame at least this often, for scrubbing, beside one at each chapter's start
  keyEvery: 2,
  // the time the page believes it is when a film begins
  now: "2026-10-16T09:00:00Z",
  // the pointer's pace, px a second; the typing's, characters a second; and a caption's: characters
  // a second, the least seconds shown
  pace: 600,
  typing: 24,
  reading: 15,
  shownAtLeast: 2,
  // a film larger than this is said to be
  warnAbove: 80 * 1024 * 1024,
  // a still at most this large: its quality lowered until it is
  stillMax: 195 * 1024,
};

/** How long a caption is shown at least: as long as it takes to read, and never under two seconds. */
export function readingTime(text) {
  return Math.max(FILM.shownAtLeast, text.length / FILM.reading);
}

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

/** The storyboards, by id: the repository's, or a folder's (drafts). */
export async function storyboards(dir = BOARDS) {
  const out = new Map();
  // `_`: what storyboards share, no film of its own
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).sort()) {
    const b = (await import(pathToFileURL(join(dir, f)).href)).default;
    out.set(b.id, b);
  }
  return out;
}

/** A storyboard's chapters: its own, or its steps as one. */
export function chaptersOf(board) {
  return board.chapters ?? [{ id: board.id, steps: board.steps }];
}

/** A preview (--preview), for writing a storyboard and never for a release: half the size, half the
 *  frame rate, written beside the film (`<id>.preview.mp4`, `<id>.preview/`), never into the
 *  repository. Its times are not the film's (typing is slower, holds and glides are sampled more
 *  coarsely), and the page is drawn at its CSS pixels (SCALE), so that it is laid out to the pixel
 *  otherwise in places. */
export const PREVIEW = { scale: 0.5, fps: 15 };

/** WebGL in software (SwiftShader), the page's other drawing on one thread, which makes two
 *  recordings of a film the same to within a few pixels a few levels apart (SwiftShader's own
 *  threads); the page's layers put together in software too, not by SwiftShader, which spent some
 *  seven cores a recording on it (2026-10-21: 1,252 s of CPU in the GPU process for 848 frames, 197 s
 *  without; the frames the same to the eye, a few thousand pixels of four million a few levels off
 *  at the edges of text). */
const BROWSER = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--num-raster-threads=1", "--disable-gpu-rasterization", "--disable-gpu-compositing"];

const USAGE = "usage: npm run tips:record -- --sphere <dir> --showcase <dir> --film <dir> [--cache <dir>] [<id>…] [--chapters <c>,…] [--jobs <n>] [--preview] [--out <dir>] [--url <server>] [--hashes] [--frames <dir>] [--boards <dir>]";

/** How many processes record at once, unless --jobs says: each holds a server, a Chromium drawing
 *  in software and, once a source window has asked, Lean's language server — some 4 GB and a few
 *  cores between them. */
function autoJobs() {
  return Math.max(1, Math.min(Math.floor(availableParallelism() / 4), Math.floor((freemem() - 4e9) / 4e9)));
}

async function main() {
  if (args[0] === "--worker") return worker(args[1]);
  const t0 = Date.now();
  const projects = { sphere: flag("--sphere"), showcase: flag("--showcase") };
  const cache = flag("--cache");
  const urlArg = flag("--url");
  // a digest of every frame beside the film, to tell two recordings apart frame by frame
  const hashes = takeSwitch("--hashes");
  const preview = takeSwitch("--preview");
  // every frame as a JPEG, for looking at a storyboard frame by frame
  const framesDir = flag("--frames");
  const outDir = resolve(flag("--out") ?? join(REPO, "src", "assets", "tips"));
  const filmArg = flag("--film");
  const boardsDir = flag("--boards");
  const only = flag("--chapters")?.split(",").map((c) => c.trim()).filter(Boolean) ?? null;
  const jobsArg = flag("--jobs");
  const jobs = urlArg ? 1 : jobsArg ? Math.max(1, Number(jobsArg) | 0) : autoJobs();
  if (args.some((a) => a.startsWith("--"))) {
    console.error(`What is ${args.find((a) => a.startsWith("--"))}?\n${USAGE}`);
    process.exit(2);
  }
  try {
    await import("playwright");
  } catch {
    console.error("This script needs Playwright: npm install --no-save playwright && npx playwright install chromium");
    process.exit(2);
  }
  const all = await storyboards(boardsDir ? resolve(boardsDir) : BOARDS);
  const wanted = args.length ? args : [...all.keys()];
  // a preview goes beside the film, or into the system's temporary folder: never into the repository
  const filmDir = filmArg ? resolve(filmArg) : preview ? join(tmpdir(), "visualproof-tips-preview") : null;
  for (const id of wanted) {
    const b = all.get(id);
    if (!b) {
      console.error(`No storyboard ${id} in ${boardsDir ?? BOARDS}.`);
      process.exit(2);
    }
    if (b.kept === false && !filmDir) {
      console.error(`${id}'s film is not kept in the repository: give --film <dir> for it.`);
      process.exit(2);
    }
    if (!urlArg && !projects[b.on]) {
      console.error(`${id} plays on ${b.on}: give --${b.on} <its build>.\n${USAGE}`);
      process.exit(2);
    }
    if (only) {
      if (wanted.length !== 1 || !b.chapters) {
        console.error("--chapters names chapters of one film in chapters (the tour).");
        process.exit(2);
      }
      const ids = b.chapters.map((c) => c.id);
      const unknown = only.filter((c) => !ids.includes(c));
      if (unknown.length) {
        console.error(`${id} has no chapter ${unknown.join(", ")}: ${ids.join(", ")}.`);
        process.exit(2);
      }
    }
  }
  let failed = 0;
  for (const id of wanted) {
    const board = all.get(id);
    try {
      await make(board, { projects, cache, url: urlArg?.replace(/\/+$/, "") ?? null, boardsDir: boardsDir ? resolve(boardsDir) : null, outDir, filmDir, framesDir: framesDir && join(resolve(framesDir), id), only, jobs, preview, hashes });
    } catch (e) {
      failed++;
      console.error(`${id}: ${e instanceof Error ? e.stack : e}`);
    }
  }
  if (wanted.length > 1) console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s in all`);
  process.exit(failed ? 1 : 0);
}

function takeSwitch(f) {
  const i = args.indexOf(f);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
}

/** Where a film and what the page needs of it are written: the film itself (`file`), its data and
 *  its stills (`about`, `still(c)`, `poster`), for a release or for a preview. */
function placesOf(board, { outDir, filmDir, preview }) {
  const id = board.id;
  if (preview) {
    const dir = join(filmDir, `${id}.preview`);
    return { file: join(filmDir, `${id}.preview.mp4`), about: join(dir, `${id}.json`), poster: join(dir, `${id}.webp`), still: (c) => join(dir, `${id}-${c}.webp`) };
  }
  if (board.kept === false) return { file: join(filmDir, `${id}.mp4`), about: join(outDir, `${id}.json`), poster: join(outDir, `${id}.webp`), still: (c) => join(outDir, `${id}-${c}.webp`) };
  return { file: join(outDir, `${id}.light.mp4`), about: null, poster: join(outDir, `${id}.light.webp`), still: () => null };
}

/** A film made: its chapters recorded in groups, each by a process of its own (`worker`), at once;
 *  with --chapters, those alone, the others taken from the film that was; then joined
 *  (scripts/tips/film.mjs) and written. */
async function make(board, o) {
  const t0 = Date.now();
  const id = board.id;
  const ids = chaptersOf(board).map((c) => c.id);
  const places = placesOf(board, o);
  const full = board.out ?? FILM.out;
  const out = o.preview ? { width: full.width * PREVIEW.scale, height: full.height * PREVIEW.scale } : full;
  const fps = o.preview ? PREVIEW.fps : board.fps ?? FILM.fps;
  // the film that was: its chapters' lengths, to share the work out; with --chapters, its chapters
  let before = null;
  try {
    if (places.about) before = JSON.parse(readFileSync(places.about, "utf8"));
  } catch {
    // none yet
  }
  let kept = null;
  if (o.only) {
    if (!before) throw new Error(`no ${places.about} to record chapters into: record the whole film first`);
    let buf;
    try {
      buf = readFileSync(places.file);
    } catch {
      throw new Error(`no ${places.file} to record chapters into: --film is where the film that ${places.about} pins is`);
    }
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== before.film.sha256) throw new Error(`${places.file} is not the film ${places.about} pins (${before.film.sha256.slice(0, 12)}, not ${sha.slice(0, 12)})`);
    if (before.chapters.map((c) => c.id).join() !== ids.join()) throw new Error(`${places.about}'s chapters are not the storyboard's: record the whole film`);
    const file = readMp4(buf);
    if (file.fps !== fps || file.width !== out.width || file.height !== out.height) throw new Error(`${places.file} is ${file.width}×${file.height} at ${file.fps} frames a second, not ${out.width}×${out.height} at ${fps}`);
    kept = new Map(split(file, before).map((c) => [c.id, c]));
  }
  const want = o.only ?? ids;
  // each chapter's length as the film that was has it, to share the chapters out; else a guess
  const was = new Map((before?.chapters ?? []).map((c) => [c.id, c.end - c.start]));
  const seconds = new Map(ids.map((c) => [c, was.get(c) ?? 15]));
  const plan = groups(ids, seconds, want, o.jobs);
  console.log(`${id}: ${plan.length === 1 ? "one process" : `${plan.length} processes`}: ${plan.map((g) => g.join(" ")).join(" | ")}`);
  if (o.framesDir) for (const c of want) rmSync(join(o.framesDir, c), { recursive: true, force: true });
  const results = await Promise.all(plan.map((g, i) => runWorker(board, g, `${plan.length > 1 ? `[${i + 1}] ` : ""}`, o)));
  const taken = new Map();
  let late = 0;
  for (const r of results) {
    late += r.late;
    for (const c of r.chapters) if (c.samples) taken.set(c.id, c);
  }
  const parts = ids.map((c) => taken.get(c) ?? kept?.get(c));
  const missing = ids.filter((c, i) => !parts[i]);
  if (missing.length) throw new Error(`no ${missing.join(", ")}`);
  const film = joinFilm(parts, fps);
  const bytes = mp4({ ...out, fps, avcC: film.avcC, samples: film.samples });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // the film, and what the page needs of it
  mkdirSync(dirname(places.file), { recursive: true });
  writeFileSync(places.file, bytes);
  if (places.about) {
    mkdirSync(dirname(places.about), { recursive: true });
    writeFileSync(`${places.file}.sha256`, `${sha256}  ${basename(places.file)}\n`);
    const about = { film: { file: `${id}-${sha256.slice(0, 12)}.mp4`, sha256, size: bytes.length, width: out.width, height: out.height, duration: film.duration }, chapters: film.chapters, captions: film.captions };
    writeFileSync(places.about, JSON.stringify(about, null, 1) + "\n");
  }
  const poster = results.find((r) => r.poster)?.poster;
  // a film of one chapter: its still is its poster
  if (!board.chapters) writeFileSync(places.poster, taken.get(id).still);
  else {
    if (poster) writeFileSync(places.poster, poster);
    for (const [c, part] of taken) if (part.still) writeFileSync(places.still(c), part.still);
  }
  // the frames taken, also under their number in the film, for the trailer and contact sheets
  if (o.framesDir) {
    for (const f of readdirSync(o.framesDir).filter((f) => f.endsWith(".jpg"))) rmSync(join(o.framesDir, f));
    for (const c of film.chapters) {
      const dir = join(o.framesDir, c.id);
      let names;
      try {
        names = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
      } catch {
        // a chapter kept from the film that was, its frames not taken now
        continue;
      }
      const from = Math.round(c.start * fps);
      for (const f of names) linkSync(join(dir, f), join(o.framesDir, `${String(from + Number(f.slice(0, -4))).padStart(5, "0")}.jpg`));
    }
  }
  if (o.hashes) writeFileSync(join(dirname(places.file), `${id}${o.preview ? ".preview" : ""}.frames.txt`), ids.flatMap((c) => [`# ${c}`, ...(taken.get(c)?.hashes ?? ["(kept)"])]).join("\n") + "\n");
  const mb = (bytes.length / 1024 / 1024).toFixed(1);
  const rate = ((bytes.length * 8) / film.duration / 1e6).toFixed(2);
  const times = board.chapters ? `; ${film.chapters.map((c) => `${c.id} ${c.start.toFixed(1)}${taken.has(c.id) ? "" : " (kept)"}`).join(", ")}` : "";
  console.log(`${id}${o.preview ? " (preview)" : ""}: ${film.frames} frames, ${film.duration.toFixed(1)} s, ${mb} MB (${rate} Mbit/s), sha256 ${sha256.slice(0, 12)}, ${((Date.now() - t0) / 1000).toFixed(0)} s to make${late ? `; ${late} frames waited past the bound` : ""}${times}`);
  console.log(`${id}: ${places.file}${places.about ? `, ${places.about}` : ""}`);
  if (bytes.length > FILM.warnAbove) console.warn(`${id}: ${mb} MB, more than ${FILM.warnAbove / 1024 / 1024} MB: lower the bitrate or shorten it`);
}

/** One group of chapters recorded by a process of its own (this script, `--worker`): what it took,
 *  read back from the folder it wrote. */
async function runWorker(board, chapters, label, o) {
  const dir = mkdtempSync(join(tmpdir(), "visualproof-tips-part-"));
  try {
    const spec = { id: board.id, boardsDir: o.boardsDir, project: o.projects[board.on] && resolve(o.projects[board.on]), cache: o.cache && resolve(o.cache), url: o.url, capture: chapters, upTo: chapters.at(-1), preview: o.preview, framesDir: o.framesDir, result: dir };
    writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
    const t0 = Date.now();
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", join(dir, "spec.json")], { stdio: ["ignore", "pipe", "pipe"] });
    const relay = (stream, to) => {
      let rest = "";
      stream.on("data", (d) => {
        const lines = (rest + d).split("\n");
        rest = lines.pop();
        for (const l of lines) to.write(`${label}${l}\n`);
      });
      stream.on("end", () => rest && to.write(`${label}${rest}\n`));
    };
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    const code = await new Promise((d) => child.on("exit", d));
    if (code !== 0) throw new Error(`${label}${chapters.join(", ")}: the recording ended (${code})`);
    const r = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
    for (const c of r.chapters) {
      if (!c.samples) continue;
      const data = readFileSync(join(dir, `${c.id}.bin`));
      let at = 0;
      c.samples = c.samples.map((s) => {
        const sample = { data: data.subarray(at, at + s.size), key: s.key, pts: s.pts };
        at += s.size;
        return sample;
      });
      c.avcC = Buffer.from(c.avcC, "base64");
      c.still = c.still ? readFileSync(join(dir, `${c.id}.webp`)) : null;
    }
    r.poster = r.poster ? readFileSync(join(dir, "poster.webp")) : null;
    console.log(`${label}${chapters.join(", ")}: ${r.chapters.filter((c) => c.samples).reduce((n, c) => n + c.frames, 0)} frames taken, ${r.ticks} played, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A process recording a group of chapters (`--worker <spec.json>`): a server of its own on a new
 *  site, a Chromium of its own, the storyboard played from the start, the group's chapters taken;
 *  what it took written into the spec's folder. */
async function worker(specFile) {
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const board = (await storyboards(spec.boardsDir ?? BOARDS)).get(spec.id);
  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({ args: BROWSER });
  const work = mkdtempSync(join(tmpdir(), "visualproof-tips-"));
  const clock = join(work, "clock");
  writeFileSync(clock, FILM.now);
  let server = null;
  try {
    server = spec.url ? { url: spec.url, stop: async () => {} } : await serve(board.on, spec.project, spec.cache, work, clock);
    const files = buildFiles(board, work);
    const r = await record(browser, server.url, board, { clock, files, framesDir: spec.framesDir, capture: spec.capture, upTo: spec.upTo, preview: spec.preview });
    const result = { chapters: [], ticks: r.ticks, late: r.late, poster: false };
    for (const c of r.chapters) {
      const e = { id: c.id, frames: c.frames, captions: c.captions };
      if (c.samples) {
        writeFileSync(join(spec.result, `${c.id}.bin`), Buffer.concat(c.samples.map((x) => Buffer.from(x.data.buffer, x.data.byteOffset, x.data.byteLength))));
        Object.assign(e, { samples: c.samples.map((x) => ({ size: x.data.byteLength, key: x.key, pts: x.pts })), avcC: c.avcC.toString("base64"), still: !!c.still, hashes: c.hashes });
        if (c.still) writeFileSync(join(spec.result, `${c.id}.webp`), c.still);
      }
      result.chapters.push(e);
    }
    if (r.poster) {
      writeFileSync(join(spec.result, "poster.webp"), r.poster);
      result.poster = true;
    }
    writeFileSync(join(spec.result, "result.json"), JSON.stringify(result));
    if (PROFILE) {
      const taken = r.chapters.filter((c) => c.samples).reduce((n, c) => n + c.frames, 0);
      const sum = [...PROFILE.values()].reduce((a, b) => a + b, 0);
      console.log(`where the time went (${taken} frames taken, ${r.ticks} played; ms a frame taken):`);
      for (const [k, v] of [...PROFILE].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${(v / 1000).toFixed(1).padStart(7)} s  ${(v / Math.max(1, taken)).toFixed(1).padStart(6)} ms`);
      console.log(`  ${"(measured)".padEnd(12)} ${(sum / 1000).toFixed(1).padStart(7)} s`);
    }
  } finally {
    await server?.stop();
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

/** What a storyboard hands the page (`files`: a name, then the .tex in scripts/tips/ a PDF is typeset
 *  from, by XeLaTeX, for this recording): name → path. */
function buildFiles(board, work) {
  const out = {};
  for (const [name, tex] of Object.entries(board.files ?? {})) {
    const src = join(REPO, "scripts", "tips", tex);
    // dated by the film, so that the PDF is the same file in every recording
    const env = { ...process.env, SOURCE_DATE_EPOCH: String(Date.parse(FILM.now) / 1000), FORCE_SOURCE_DATE: "1" };
    for (let i = 0; i < 2; i++) execFileSync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", `-output-directory=${work}`, src], { cwd: work, stdio: "ignore", env });
    out[name] = join(work, basename(tex).replace(/\.tex$/, ".pdf"));
  }
  return out;
}

/** A port nobody listens on. */
function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

/** A server of this checkout for a film, ready once its graph is read and the usage pass has passed
 *  (from the cache): Sphere-Packing-Lean on an empty site, or the showcase on a new copy of its
 *  site. Its clock is the film's (`clock`, scripts/tips/serverclock.mjs). */
async function serve(on, project, cache, work, clock) {
  const port = await freePort();
  const site = join(work, "site");
  const env = { ...process.env, TIPS_CLOCK: clock, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(join(REPO, "scripts", "tips", "serverclock.mjs")).href}`.trim() };
  const common = ["--site", site, ...(cache ? ["--cache", resolve(cache)] : []), "--port", String(port), "--jobs", "2"];
  const argv = on === "showcase" ? [join(REPO, "scripts", "showcase.mjs"), resolve(project), ...common] : [join(REPO, "src", "server", "main.ts"), "serve", resolve(project), ...common];
  const child = spawn(process.execPath, argv, { stdio: ["ignore", "ignore", "inherit"], env });
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((d) => child.once("exit", d));
    }
  };
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server ended (${child.exitCode})`);
    try {
      const s = await (await fetch(`${url}/api/status`)).json();
      if (s.state === "ready" && s.usage?.state === "done") return { url, stop };
    } catch {
      // not listening yet
    }
    if (Date.now() - t0 > 20 * 60_000) {
      await stop();
      throw new Error("the server was not ready within 20 minutes");
    }
    await new Promise((d) => setTimeout(d, 500));
  }
}

/** Where a frame's time goes (TIPS_PROFILE=1): milliseconds by stage, summed over a film. */
const PROFILE = process.env.TIPS_PROFILE ? new Map() : null;
const timed = async (stage, work) => {
  if (!PROFILE) return work;
  const t0 = performance.now();
  try {
    return await work;
  } finally {
    PROFILE.set(stage, (PROFILE.get(stage) ?? 0) + performance.now() - t0);
  }
};

/** The page's pixels to a CSS pixel (its context's deviceScaleFactor), at which every frame is taken;
 *  a preview's are the CSS pixels themselves, a quarter as many to draw. */
const SCALE = 2;

/** When, on the page's clock, a film's page has loaded (ms after the clock was installed). */
const LOADED_BY = 30_000;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sleep = (ms) => new Promise((d) => setTimeout(d, ms));

/** A film's chapters, played in order from the film's start: those `capture` names (all, without it)
 *  taken frame by frame and encoded, each by an encoder of its own from a key frame, so that a
 *  chapter is the same however it was recorded — alone, after the film before it played without a
 *  frame taken, or in sequence; the others played as fast as the page allows, their frames counted
 *  but not taken. Playing stops after `upTo`. Each chapter played: its id, its length in frames and
 *  its captions (seconds from its start); each taken, its samples (scripts/tips/film.mjs), the
 *  encoder's description, its still, its frames' digests. With `preview`, at half the size and half
 *  the frame rate (PREVIEW). */
export async function record(browser, url, board, { clock, files = {}, framesDir = null, capture = null, upTo = null, preview = false }) {
  const fps = preview ? PREVIEW.fps : board.fps ?? FILM.fps;
  const DT = 1000 / fps;
  const V = board.viewport ?? FILM.viewport;
  const full = board.out ?? FILM.out;
  const out = preview ? { width: full.width * PREVIEW.scale, height: full.height * PREVIEW.scale } : full;
  // light, and times and dates written the same on every machine
  const scale = preview ? 1 : SCALE;
  const ctx = await browser.newContext({ viewport: V, deviceScaleFactor: scale, colorScheme: "light", hasTouch: !!board.phone, isMobile: !!board.phone, reducedMotion: "no-preference", timezoneId: "UTC", locale: "en-US" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  const page = await ctx.newPage();
  const meta = await (await fetch(`${url}/api/meta`)).json();
  // the reader as the page keeps them: a name given, the tour taken, light, the Kind palette
  await page.addInitScript(
    ({ key, store }) => {
      localStorage.setItem(key, JSON.stringify(store));
      localStorage.removeItem("visualproof:theme");
    },
    { key: `visualproof:${meta.project.root}`, store: { reviewer: board.reader ?? "Alice", guided: true, scheme: { review: "kind", other: "kind" }, ...(board.store ?? {}) } },
  );
  await page.addInitScript(inPage);
  // the page's clock stopped, then moved by each frame alone (runFor): installed, it would run on in
  // real time, a frame lasting as long as the frame took to make
  let now = Date.parse(FILM.now) + 1000;
  await page.clock.install({ time: new Date(FILM.now) });
  await page.clock.pauseAt(new Date(now));
  const cdp = await ctx.newCDPSession(page);
  // the compositor's clock stopped: an animation begun stays at its start until the frame's own time
  // is given it (scripts/tips/inpage.mjs, `sync`), rather than running a few real milliseconds first,
  // which a script reading the page meanwhile (where the panel is as it slides in) would see
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await page.goto(`${url}/${board.address ? `#${board.address}` : ""}`, { waitUntil: "load" });
  // the document's own timeline, which the navigation made anew
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  const advance = async (ms) => {
    await page.clock.runFor(ms);
    now += ms;
    // the server's clock: the film's (scripts/tips/serverclock.mjs reads it within 10 ms)
    writeFileSync(clock, new Date(now).toISOString());
  };

  // the encoder: a page of the same server (a secure context, which WebCodecs needs), given each
  // frame as it is taken
  const enc = await ctx.newPage();
  await enc.goto(`${url}/api/status`);
  await enc.evaluate(({ width, height, fps, bitrate }) => {
    const E = (window.__enc = { chunks: [], description: null, error: null, encoder: null });
    // H.264 High, level 4.0 up to 8,192 macroblocks a frame (1920×1080), 5.0 beyond (1920×1200)
    const level = Math.ceil(width / 16) * Math.ceil(height / 16) > 8192 ? "32" : "28";
    // an encoder for each chapter taken, new, so that what it makes of a chapter's frames does not
    // depend on what came before them
    E.start = () => {
      E.chunks = [];
      E.description = null;
      E.encoder = new VideoEncoder({
        output: (chunk, md) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          E.chunks.push({ data, key: chunk.type === "key", pts: chunk.timestamp });
          if (md?.decoderConfig?.description) E.description = new Uint8Array(md.decoderConfig.description);
        },
        error: (e) => (E.error = String(e)),
      });
      E.encoder.configure({ codec: `avc1.6400${level}`, width, height, bitrate, framerate: fps, bitrateMode: "variable", avc: { format: "avc" } });
    };
    E.finish = async () => {
      await E.encoder.flush();
      E.encoder.close();
    };
    const b64 = (E.b64 = (u8) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    });
    // what has been encoded so far, handed over and let go
    E.drain = () => E.chunks.splice(0).map((c) => ({ data: b64(c.data), key: c.key, pts: c.pts }));
    E.avcC = () => (E.description ? b64(E.description) : null);
  }, { ...out, fps, bitrate: board.bitrate ?? FILM.bitrate });
  let samples = [];
  const drain = async () => {
    for (const c of await enc.evaluate(() => window.__enc.drain())) samples.push({ data: Buffer.from(c.data, "base64"), key: c.key, pts: (c.pts / 1e6) * fps * 1000 });
  };

  // the film's state: the pointer, the camera, the frames
  const aspect = out.height / out.width;
  let camW = Math.min(board.width ?? V.width, V.width);
  let camH = Math.min(camW * aspect, V.height);
  let px = board.pointer?.x ?? V.width * 0.55, py = board.pointer?.y ?? V.height * 0.6;
  let ring = 0, ringX = px, ringY = py, key = "", keyT = 0, keyHeld = false, hidden = !!board.hidePointer || !!board.phone;
  // a pinch's other finger, while it is down
  let second = null;
  // the film's title over the page (scripts/tips/inpage.mjs, `title`)
  const title = { cover: 0, title: 0 };
  const cam = { x: V.width / 2, y: V.height / 2, vx: 0, vy: 0, gx: V.width / 2, gy: V.height / 2, follow: false };
  let late = 0;
  let tick = 0;
  // a frame of the film (not while loading, before it, or cut away from); taken, or only counted
  let recording = false;
  let capturing = false;
  let frames = 0;
  // the frame the chapter being played began at
  let chapterStart = 0;
  // frames handed to the encoder, in order, while the next is taken; at most a few waiting
  let encoding = Promise.resolve();
  let waiting = 0;
  let encodeError = null;
  // the next frame encoded as a key frame (a chapter's first)
  let keyNext = true;
  const hashes = [];
  let poster = null;
  const stills = new Map();
  let chapter = null;
  if (framesDir) mkdirSync(framesDir, { recursive: true });

  const clampCam = (x, y) => [Math.min(Math.max(x, camW / 2), V.width - camW / 2), Math.min(Math.max(y, camH / 2), V.height - camH / 2)];
  const rectOf = async (target) => {
    const r = await page.evaluate((t) => window.__tips.rect(t), target);
    if (!r) {
      // what the page showed instead, for the storyboard's writer
      const shot = join(tmpdir(), `visualproof-tips-${board.id}-${chapter ?? "before"}-${Date.now()}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`${board.id}${chapter ? ` (${chapter})` : ""}: nothing shown at ${JSON.stringify(target)} (the page then: ${shot})`);
    }
    return r;
  };
  /** The middle of what a step points at, moved by the step's `dx`, `dy`. */
  const pointOf = async (target, s = {}) => {
    const r = await rectOf(target);
    return { x: r.x + r.w / 2 + (s.dx ?? 0), y: r.y + r.h / 2 + (s.dy ?? 0) };
  };
  /** Wait until nothing is on its way to the page, then let what came reach it (between frames).
   *  After a heartbeat, what the server pushes for it is waited for too. */
  let beats = 0;
  const settle = async () => {
    let [n, quiet] = await page.evaluate(() => [window.__tips.beats(), window.__tips.quiet()]);
    if (n !== beats) {
      beats = n;
      await timed("heartbeat", sleep(700));
      quiet = await page.evaluate(() => window.__tips.quiet());
    }
    for (let t0 = Date.now(); !quiet; quiet = await page.evaluate(() => window.__tips.quiet())) {
      // what the page waits on longest: Lean's language server, started for a hover; a document
      // typeset; a paper read
      if (Date.now() - t0 > (board.patience ?? 15_000)) {
        late++;
        break;
      }
      await sleep(2);
    }
  };
  // What the frame looks at, taken at the page's own pixels (twice the CSS pixel) and brought to the
  // film's size by the encoder's page where they differ (a frame on the whole window): a capture at
  // another scale lays the page out again at that scale, and the pixel it rounds differently there
  // stays in the page after it (a panel's height), so that a film played without taking frames
  // would not be the film taken.
  const shotClip = () => ({ x: cam.x - camW / 2, y: cam.y - camH / 2, width: camW, height: camH });
  // through Playwright, whose session set the page's metrics: its pixels as they are, nothing laid out
  // again (a capture of DevTools' own at a scale lays the page out at that scale for it)
  const takeShot = async (type) => (await page.screenshot({ type, ...(type === "jpeg" ? { quality: 95 } : {}), clip: shotClip(), caret: "initial", animations: "allow", scale: "device", timeout: 60_000 })).toString("base64");
  const native = () => Math.abs(camW * scale - out.width) < 0.5;
  /** What the frame shows now, as a WebP no larger than a still may be: its quality lowered until it
   *  is not. */
  const still = async () => {
    const png = await takeShot("png");
    const webp = await enc.evaluate(async ({ png, w, h, max }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob(), { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close();
      let q = 0.7, b;
      do {
        b = await c.convertToBlob({ type: "image/webp", quality: q });
        q -= 0.08;
      } while (b.size > max && q > 0.2);
      return window.__enc.b64(new Uint8Array(await b.arrayBuffer()));
    }, { png, w: out.width, h: out.height, max: FILM.stillMax });
    return Buffer.from(webp, "base64");
  };
  // the captions: those given, and the one on screen
  const captions = [];
  let cue = null;
  /** The caption on screen ended here, once it has been shown as long as it takes to read. */
  const closeCue = async () => {
    if (!cue) return;
    const least = cue.start + readingTime(cue.text);
    if (frames / fps < least) await run((least - frames / fps) * 1000);
    captions.push({ start: cue.start, end: frames / fps, text: cue.text });
    cue = null;
  };

  /** One frame: the page a frame later, once nothing is on its way, its animations at that time,
   *  the pointer drawn, the camera moved; taken and encoded while recording. */
  const frame = async () => {
    // whole milliseconds (the faked clock's), 33 or 34 of them at 30 a second
    tick++;
    await timed("clock", advance(Math.round(tick * DT) - Math.round((tick - 1) * DT)));
    await timed("settle", settle());
    if (ring > 0) ring = Math.max(0, ring - DT / 450);
    if (key) {
      keyT = keyHeld ? Math.min(keyT + DT, 120) : keyT + DT;
      if (keyT > 1100) key = "";
    }
    const keyAlpha = Math.min(1, keyT / 120, Math.max(0, (1100 - keyT) / 250));
    await timed("pointer", page.evaluate(([p, t]) => {
      window.__tips.pointer(p);
      window.__tips.title(t);
      window.__tips.sync();
    }, [{ x: px, y: py, finger: !!board.phone, ring, ringX, ringY, key, keyAlpha, hidden, second }, title]));
    if (cam.follow) {
      // the pointer near an edge of the frame brings the frame along
      const mx = camW * 0.3, my = camH * 0.3;
      if (px < cam.gx - mx) cam.gx = px + mx;
      if (px > cam.gx + mx) cam.gx = px - mx;
      if (py < cam.gy - my) cam.gy = py + my;
      if (py > cam.gy + my) cam.gy = py - my;
    }
    [cam.gx, cam.gy] = clampCam(cam.gx, cam.gy);
    // a critically damped spring: it glides to where it is sent, never past it
    const w = (2 * Math.PI) / 0.9, dt = DT / 1000;
    for (const k of ["x", "y"]) {
      const v = cam[`v${k}`] + (w * w * (cam[`g${k}`] - cam[k]) - 2 * w * cam[`v${k}`]) * dt;
      cam[`v${k}`] = v;
      cam[k] += v * dt;
    }
    if (!recording) return;
    if (!capturing) {
      frames++;
      return;
    }
    const shot = { data: await timed("screenshot", takeShot("jpeg").catch((e) => {
      throw new Error(`${board.id}: no frame of ${JSON.stringify(shotClip())}: ${e.message}`);
    })) };
    // the frame's number in its chapter
    const at = frames - chapterStart;
    const t0 = PROFILE && performance.now();
    hashes.push(createHash("sha256").update(shot.data).digest("hex").slice(0, 16));
    const file = framesDir && join(framesDir, chapter, `${String(at).padStart(5, "0")}.jpg`);
    // taken at the film's size, the frame kept as it is; else as the encoder's page brings it there
    const resize = !native();
    if (file && !resize) writeFileSync(file, Buffer.from(shot.data, "base64"));
    if (PROFILE) PROFILE.set("write", (PROFILE.get("write") ?? 0) + performance.now() - t0);
    const keyFrame = keyNext || at % Math.round(fps * (board.keyEvery ?? FILM.keyEvery)) === 0;
    keyNext = false;
    // the encoder takes the frame while the next is made; the page waits only when it falls behind
    if (waiting > 3) await timed("encode", encoding);
    waiting++;
    encoding = encoding
      .then(() =>
        enc.evaluate(async ({ f, i, dt, keyFrame, resize, keep, w, h }) => {
          const E = window.__enc;
          const blob = await (await fetch(`data:image/jpeg;base64,${f}`)).blob();
          const bmp = await createImageBitmap(blob, resize ? { resizeWidth: w, resizeHeight: h, resizeQuality: "high" } : undefined);
          let kept = null;
          if (keep) {
            const c = new OffscreenCanvas(w, h);
            c.getContext("2d").drawImage(bmp, 0, 0);
            kept = E.b64(new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.95 })).arrayBuffer()));
          }
          const vf = new VideoFrame(bmp, { timestamp: Math.round(i * dt * 1000), duration: Math.round(dt * 1000) });
          E.encoder.encode(vf, { keyFrame });
          vf.close();
          bmp.close();
          // the encoder kept from running far ahead of what it has written
          while (E.encoder.encodeQueueSize > 8) await new Promise((d) => setTimeout(d, 5));
          return kept;
        }, { f: shot.data, i: at, dt: DT, keyFrame, resize, keep: !!file && resize, w: out.width, h: out.height }),
      )
      .then((kept) => kept && writeFileSync(file, Buffer.from(kept, "base64")))
      .catch((e) => (encodeError ??= e))
      .finally(() => waiting--);
    if (encodeError) throw new Error(`${board.id}: the encoder: ${encodeError.message ?? encodeError}`);
    frames++;
    if ((frames - chapterStart) % 30 === 0) await timed("drain", drain());
  };
  const run = async (ms) => {
    for (let t = 0; t < ms - 1e-6; t += DT) await frame();
  };
  /** Frames, one after another, until what the page is making is there (a picture saved, a document
   *  downloaded). */
  const until = async (promise) => {
    let done = false, value, error;
    promise.then((v) => ((done = true), (value = v)), (e) => ((done = true), (error = e)));
    for (let n = 0; !done; n++) {
      if (n > 30 * 60) throw new Error(`${board.id}: nothing came within a minute of the film`);
      await frame();
      await sleep(5);
    }
    if (error) throw error;
    return value;
  };

  // the agent of the film: its token read from the page, its API driven from here, between frames
  const agent = { token: null, inbox: [], stop: null, busy: false, link: null };
  const agentApi = async (method, path, body) => {
    const r = await fetch(`${url}/api/agent/${path}`, { method, headers: { authorization: `Bearer ${agent.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: agent.stop?.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${board.id}: the agent's ${method} ${path}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  /** What the page shows once the server has said it: the events it pushes, given between frames. */
  const pushed = async (types, ms = 5000) => {
    const before = await page.evaluate(() => ({ ...window.__tips.events }));
    return async () => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) {
        const n = await page.evaluate(() => window.__tips.events);
        if (types.every((t) => (n[t] ?? 0) > (before[t] ?? 0))) return;
      }
    };
  };

  const steps = {
    /** Where the frame looks: an element, a declaration, what is lit or a point, glided to (a cut
     *  with `cut`, which may also change its width), or the pointer, followed. */
    async camera(s) {
      if (s.camera === "pointer") {
        cam.follow = true;
        return;
      }
      cam.follow = false;
      if (s.width && (s.cut || !recording)) {
        camW = Math.min(s.width, V.width);
        camH = Math.min(camW * aspect, V.height);
      }
      const p = await pointOf(s.camera, s);
      [cam.gx, cam.gy] = clampCam(p.x, p.y);
      if (s.cut || !recording) {
        [cam.x, cam.y] = [cam.gx, cam.gy];
        cam.vx = cam.vy = 0;
      }
      if (s.ms) await run(s.ms);
    },
    /** The pointer goes to a place along a slight arc, the page told of every step (hovers happen),
     *  in `ms` or as long as the way asks. */
    async move(s) {
      const to = await pointOf(s.move, s);
      const [x0, y0] = [px, py];
      const d = Math.hypot(to.x - x0, to.y - y0);
      // at the film's pace, a short way not too quick nor a long one too slow
      const ms = s.ms ?? Math.min(2000, Math.max(450, (d / (board.pace ?? FILM.pace)) * 1000));
      // the arc's middle, off the straight line by a little
      const bend = Math.min(60, d * 0.12) * (s.bend ?? 1);
      const [nx, ny] = d ? [-(to.y - y0) / d, (to.x - x0) / d] : [0, 0];
      const [mx, my] = [(x0 + to.x) / 2 + nx * bend, (y0 + to.y) / 2 + ny * bend];
      const n = Math.max(1, Math.round(ms / DT));
      hidden = false;
      for (let i = 1; i <= n; i++) {
        const t = easeInOut(i / n);
        px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * to.x;
        py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * to.y;
        await page.mouse.move(px, py);
        await frame();
      }
    },
    /** A click where the pointer is (`count: 2` for a double one, `button: "right"`, a key held
     *  `with`), a ring left where it pressed. With `download`, what it saves is waited for, frame by
     *  frame, and shown as the browser would (`shown`, for `toast` ms). */
    async click(s) {
      const opts = s.button ? { button: s.button } : {};
      const saved = s.download ? page.waitForEvent("download", { timeout: 180_000 }) : null;
      for (let c = 0; c < (s.count ?? 1); c++) {
        if (s.with) await page.keyboard.down(s.with);
        await page.mouse.down(opts);
        [ring, ringX, ringY] = [1, px, py];
        await frame();
        await page.mouse.up(opts);
        if (s.with) await page.keyboard.up(s.with);
        await frame();
      }
      if (saved) {
        const d = await until(saved);
        const bytes = statSync(await d.path()).size;
        const size = bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
        await page.evaluate((w) => window.__tips.shown(w), { saved: d.suggestedFilename(), size });
        await run(s.toast ?? 1400);
        await page.evaluate(() => window.__tips.shown(null));
      }
      await run(s.ms ?? 300);
    },
    /** A click on a link that downloads a PDF (a document typeset), then its first pages shown as a
     *  PDF viewer would (rendered by Poppler's pdftoppm), for `ms`, the frame on the whole window;
   *  with `still`, the chapter's key frame. */
    async pdf(s) {
      await steps.move({ move: s.pdf, dx: s.dx, dy: s.dy });
      const saved = page.waitForEvent("download", { timeout: 180_000 });
      await page.mouse.down();
      [ring, ringX, ringY] = [1, px, py];
      await frame();
      await page.mouse.up();
      const d = await until(saved);
      const file = await d.path();
      const dir = mkdtempSync(join(tmpdir(), "visualproof-tips-pdf-"));
      try {
        const count = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))?.[1] ?? 1);
        execFileSync("pdftoppm", ["-r", "150", "-png", "-f", "1", "-l", String(s.pages ?? 2), file, join(dir, "p")]);
        const pages = readdirSync(dir).sort().map((f) => `data:image/png;base64,${readFileSync(join(dir, f)).toString("base64")}`);
        await page.evaluate((w) => window.__tips.shown(w), { pdf: d.suggestedFilename(), pages, count });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const [w0, x0, y0] = [camW, cam.x, cam.y];
      [camW, camH] = [V.width, Math.min(V.width * aspect, V.height)];
      [cam.x, cam.y, cam.gx, cam.gy, cam.vx, cam.vy] = [V.width / 2, V.height / 2, V.width / 2, V.height / 2, 0, 0];
      hidden = true;
      await run(s.ms ?? 2500);
      if (s.still) await steps.poster();
      await page.evaluate(() => window.__tips.shown(null));
      [camW, camH] = [w0, Math.min(w0 * aspect, V.height)];
      [cam.x, cam.y, cam.gx, cam.gy] = [x0, y0, x0, y0];
      hidden = false;
    },
    /** A click on what opens a file chooser, given the file a storyboard names (`files`). */
    async choose(s) {
      await steps.move({ move: s.choose, dx: s.dx, dy: s.dy });
      const chosen = page.waitForEvent("filechooser", { timeout: 10_000 });
      await page.mouse.down();
      [ring, ringX, ringY] = [1, px, py];
      await frame();
      await page.mouse.up();
      await (await chosen).setFiles(files[s.file] ?? s.file);
      await run(s.ms ?? 300);
    },
    /** A finger's tap on a place (a phone's film): the finger shown as it comes down. */
    async tap(s) {
      const p = await pointOf(s.tap, s);
      [px, py, hidden] = [p.x, p.y, false];
      await run(250);
      await page.touchscreen.tap(px, py);
      [ring, ringX, ringY] = [1, px, py];
      await run(150);
      hidden = true;
      await run(s.ms ?? 350);
    },
    /** A key pressed, its cap shown beside the pointer (`cap`: what it says). */
    async key(s) {
      await page.keyboard.press(s.key);
      key = s.cap ?? s.key;
      keyT = 0;
      await run(s.ms ?? 500);
    },
    /** Text typed at a typist's pace (`cps` characters a second, FILM.typing unless said; `every`:
     *  frames a character instead), each character at the frame of its time: a pace the frame rate
     *  does not divide (24 at 30 frames a second) is kept to on average, a frame at least each. */
    async type(s) {
      const every = s.every ?? fps / (s.cps ?? FILM.typing);
      let n = 0;
      for (const [i, ch] of [...s.type].entries()) {
        await page.keyboard.type(ch);
        for (const end = Math.max(n + 1, Math.round((i + 1) * every)); n < end; n++) await frame();
      }
      await run(s.ms ?? 300);
    },
    /** A caption from now (the film's captions are data, which the page shows over it): the one
     *  before is shown as long as it takes to read first, then ends here. `caption: null` ends it. */
    async caption(s) {
      await closeCue();
      if (s.caption) cue = { start: frames / fps, text: s.caption };
    },
    /** A drag from where the pointer is to a place (with a key held, `with`, its cap shown while
     *  it is: `cap`). */
    async drag(s) {
      if (s.with) {
        await page.keyboard.down(s.with);
        [key, keyT, keyHeld] = [s.cap ?? s.with, 0, true];
        await run(250);
      }
      await page.mouse.down();
      [ring, ringX, ringY] = [1, px, py];
      await run(100);
      await steps.move({ move: s.drag, dx: s.dx, dy: s.dy, ms: s.ms, bend: s.bend ?? 0.3 });
      await run(100);
      await page.mouse.up();
      if (s.with) {
        await page.keyboard.up(s.with);
        [keyT, keyHeld] = [700, false];
      }
      await run(s.after ?? 300);
    },
    /** One finger on a phone's screen, from where it is put (`swipe`) by `by` {x, y}. */
    async swipe(s) {
      const from = await pointOf(s.swipe, s);
      const n = Math.max(1, Math.round((s.ms ?? 500) / DT));
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
      [px, py, hidden] = [from.x, from.y, false];
      await touch("touchStart", px, py);
      await frame();
      for (let i = 1; i <= n; i++) {
        const t = easeInOut(i / n);
        [px, py] = [from.x + s.by.x * t, from.y + s.by.y * t];
        await touch("touchMove", px, py);
        await frame();
      }
      await touch("touchEnd");
      hidden = true;
      await run(s.after ?? 250);
    },
    /** Two fingers about a place (`pinch`), from `apart` px apart to `scale` times as far. */
    async pinch(s) {
      const c = await pointOf(s.pinch, s);
      const d0 = (s.apart ?? 90) / 2;
      const n = Math.max(1, Math.round((s.ms ?? 700) / DT));
      const at = (d) => [{ x: c.x - d * 0.6, y: c.y - d * 0.8, id: 1 }, { x: c.x + d * 0.6, y: c.y + d * 0.8, id: 2 }];
      const show = (P) => {
        [px, py, hidden] = [P[0].x, P[0].y, false];
        second = { x: P[1].x, y: P[1].y };
      };
      let P = at(d0);
      show(P);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: P });
      await frame();
      for (let i = 1; i <= n; i++) {
        P = at(d0 * (1 + ((s.scale ?? 2) - 1) * easeInOut(i / n)));
        show(P);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: P });
        await frame();
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      [hidden, second] = [true, null];
      await run(s.after ?? 300);
    },
    /** The wheel, turned over a few frames (zooms the board). */
    async wheel(s) {
      const n = s.frames ?? 8;
      for (let i = 0; i < n; i++) {
        await page.mouse.wheel(0, s.wheel / n);
        await frame();
      }
    },
    /** The title over the page faded over `ms`: `cover` (the page's background) and `title` (the
     *  wordmark), each from its first value to its second (one value: held there). */
    async fade(s) {
      const from = { ...title };
      const to = {};
      for (const k of ["cover", "title"]) {
        const v = s.fade[k];
        if (Array.isArray(v)) [from[k], to[k]] = v;
        else to[k] = v ?? title[k];
      }
      const n = Math.round((s.ms ?? 0) / DT);
      Object.assign(title, n ? from : to);
      for (let i = 1; i <= n; i++) {
        const t = easeInOut(i / n);
        for (const k of ["cover", "title"]) title[k] = from[k] + (to[k] - from[k]) * t;
        await frame();
      }
    },
    /** This frame is the film's poster (else its first). */
    async filmPoster() {
      if (capturing) poster = await still();
    },
    /** A panel scrolled over `ms` so that what `to` finds stands in its middle (a reader's wheel). */
    async scroll(s) {
      const [from, by] = await page.evaluate(([box, to]) => {
        const c = document.querySelector(box), t = document.querySelector(to);
        if (!c || !t) return [0, 0];
        const r = c.getBoundingClientRect(), q = t.getBoundingClientRect();
        return [c.scrollTop, q.top + q.height / 2 - (r.top + r.height / 2)];
      }, [s.scroll, s.to]);
      const n = Math.max(1, Math.round((s.ms ?? 500) / DT));
      for (let i = 1; i <= n; i++) {
        await page.evaluate(([box, y]) => (document.querySelector(box).scrollTop = y), [s.scroll, from + by * easeInOut(i / n)]);
        await frame();
      }
    },
    async wait(s) {
      await run(s.wait);
    },
    /** Until the page shows what `waitFor` finds (a document typeset, which the page polls for): the
     *  clock moves on meanwhile, and with `cut` no frame is taken, so that the film cuts from before
     *  to after. */
    async waitFor(s) {
      const was = recording;
      if (s.cut) recording = false;
      for (const t0 = Date.now(); !(await page.evaluate((t) => !!window.__tips.rect(t), s.waitFor)); await sleep(50)) {
        if (Date.now() - t0 > (board.patience ?? 15_000)) throw new Error(`${board.id} (${chapter}): ${JSON.stringify(s.waitFor)} never came`);
        await frame();
      }
      recording = was;
      if (s.cut) keyNext = true;
      await run(s.ms ?? 0);
    },
    /** The pointer gone (it reads better without it at times) or back. */
    async hide(s) {
      hidden = s.hide !== false;
    },
    /** This frame is the chapter's key frame (the film's poster, for a film of one chapter). */
    async poster() {
      if (capturing) stills.set(chapter, await still());
    },
    /** The agent of the film (an AI agent's token made on the page, its API driven from here):
     *  `join` takes the token the page shows and starts listening; `await` waits for what a person
     *  wrote to it; `status`, `view`, `view/link`, `reply` are its requests (`body` or `text`), a
     *  `{link}` in a text being the link `view/link` made last. Each is done between two frames, and
     *  what the server pushes for it reaches the page before the next. */
    async agent(s) {
      if (s.agent === "join") {
        agent.token = await page.evaluate(() => {
          const texts = [document.body.innerText, ...[...document.querySelectorAll("textarea, input")].map((e) => e.value)];
          for (const t of texts) {
            const m = /vpa_[A-Za-z0-9_-]+/.exec(t);
            if (m) return m[0];
          }
          return null;
        });
        if (!agent.token) throw new Error(`${board.id}: no agent token on the page to join with`);
        agent.stop = new AbortController();
        const seen = await pushed(["presence"]);
        await agentApi("GET", "inbox?wait=0");
        // listening, from now on: what people write is kept for `await`; handed a message, the agent
        // thinks and works until it has replied, then listens again, as an agent does
        void (async () => {
          while (!agent.stop.signal.aborted) {
            if (agent.busy) {
              await sleep(20);
              continue;
            }
            try {
              const r = await agentApi("GET", "inbox?wait=50");
              const said = (r.messages ?? []).filter((m) => m.kind === "person");
              if (said.length) agent.busy = true;
              agent.inbox.push(...said);
            } catch {
              if (!agent.stop.signal.aborted) await sleep(200);
            }
          }
        })();
        await seen();
      } else if (s.agent === "await") {
        for (const t0 = Date.now(); !agent.inbox.length; await sleep(20)) if (Date.now() - t0 > 30_000) throw new Error(`${board.id}: nothing came to the agent`);
        agent.inbox.shift();
        // the agent's state (thinking) as the server tells it
        await sleep(600);
      } else {
        const seen = await pushed(s.expect ?? [], s.within ?? 3000);
        const r = await agentApi("POST", s.agent, s.body ?? { text: s.text.replaceAll("{link}", agent.link ?? "") });
        if (s.agent === "view/link") agent.link = r.link;
        if (s.agent === "reply") agent.busy = false;
        await seen();
        // what the server says of it a moment later (its presence, at most every 500 ms), given to
        // the page before anything else is done or taken
        await sleep(s.settle ?? 650);
        await settle();
      }
      await run(s.ms ?? 0);
    },
    /** Anything else the page must do, by its own code; what it answers is printed (for writing a
     *  storyboard). */
    async eval(s) {
      const r = await page.evaluate(s.eval);
      if (r !== undefined) console.log(`${board.id}: ${typeof r === "string" ? r : JSON.stringify(r, null, 1)}`);
    },
  };
  const play = async (list) => {
    for (const s of list) {
      const verb = Object.keys(steps).find((k) => k in s);
      if (!verb) throw new Error(`${board.id}: a step does nothing: ${JSON.stringify(s)}`);
      await steps[verb](s);
    }
  };

  try {
    // the page read and laid out, then left to settle before anything happens
    for (let t0 = Date.now(); !(await page.evaluate(() => window.__tips.quiet() && !!window.visualproof && !!document.getElementById("loader")?.classList.contains("gone"))); ) {
      if (Date.now() - t0 > 120_000) throw new Error(`${board.id}: the page did not load`);
      await advance(100);
      await sleep(50);
    }
    // the page's clock at the same time in every recording, however long loading took: animation
    // frames come every 16 ms from when the clock was installed, and a flight begun at another phase
    // of them is somewhere else at a frame
    const loaded = await page.evaluate(() => performance.now());
    if (loaded > LOADED_BY) throw new Error(`${board.id}: the page took ${Math.round(loaded)} ms of its clock to load, more than ${LOADED_BY}`);
    await advance(Math.ceil(LOADED_BY - loaded));
    // the board drawn only in the chapters taken (scripts/tips/inpage.mjs, `drawing`)
    await page.evaluate(() => window.__tips.drawing(false));
    // pdf.js's worker, which the page runs on its own thread here (no Worker), loaded now rather than
    // when the first paper opens: its loading takes the machine's time, not the film's, which a film
    // played without taking frames, many frames to the machine's second, would outrun (pdf.js takes
    // a worker already loaded from `pdfjsWorker`)
    await page.evaluate(async () => {
      window.pdfjsWorker = await import("/pdfworker.js");
    });
    await run(1500);
    await play(board.before ?? []);
    await run(board.settle ?? 1200);
    recording = true;
    const played = [];
    for (const c of chaptersOf(board)) {
      chapter = c.id;
      keyNext = true;
      capturing = !capture || capture.includes(c.id);
      chapterStart = frames;
      const fromCaption = captions.length;
      // the board drawn again from each chapter's start, whether this chapter is taken or not, so
      // that the page does the same whichever chapters a recording takes
      await page.evaluate((on) => {
        window.__tips.drawing(on);
        window.visualproof?.canvas?.request();
      }, capturing);
      if (capturing) {
        samples = [];
        hashes.length = 0;
        if (framesDir) mkdirSync(join(framesDir, c.id), { recursive: true });
        await enc.evaluate(() => window.__enc.start());
        if (!played.length) poster = await still();
      }
      await play(c.steps);
      // a caption of the chapter is read before it ends, and ends with it
      await closeCue();
      const part = { id: c.id, frames: frames - chapterStart, captions: captions.slice(fromCaption).map((k) => ({ start: k.start - chapterStart / fps, end: k.end - chapterStart / fps, text: k.text })) };
      if (capturing) {
        if (!stills.has(c.id)) await steps.poster();
        await timed("encode", encoding);
        if (encodeError) throw new Error(`${board.id}: the encoder: ${encodeError.message ?? encodeError}`);
        await enc.evaluate(() => window.__enc.finish());
        await drain();
        const [error, avcC] = await enc.evaluate(() => [window.__enc.error, window.__enc.avcC()]);
        if (error) throw new Error(`${board.id} (${c.id}): the encoder: ${error}`);
        if (!avcC) throw new Error(`${board.id} (${c.id}): the encoder gave no avcC`);
        Object.assign(part, { samples, avcC: Buffer.from(avcC, "base64"), still: stills.get(c.id), hashes: [...hashes] });
      }
      played.push(part);
      if (c.id === upTo) break;
    }
    agent.stop?.abort();
    return { chapters: played, poster, fps, out, ticks: tick, late };
  } finally {
    agent.stop?.abort();
    await ctx.close();
  }
}

if (import.meta.main) await main();
