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
//                          b8a5f23> --film <dir> [--cache <dir>] [<id>…] [--out <dir>]
//                          [--url <server>] [--hashes] [--frames <dir>] [--boards <dir>]
//
// --sphere, --showcase: the projects' builds, as a storyboard's `on` asks for one (the showcase:
// showcase/flt-regular/setup.sh). The server is started on it for each film, on a site of its own
// made anew (the showcase's: a copy of its committed site), so that every film starts from the same
// review, the server's clock following the film's (scripts/tips/serverclock.mjs).
// --cache: the caches it reads (made once, then reused: an extraction takes minutes).
// --url: a server already serving the project, with full access, instead (its site is then
// whatever it is: for trying a storyboard, not for the films kept). Without ids named, all of them.
// --film: where a film the repository does not keep goes (the tour, published as a release's asset):
// <dir>/<id>.mp4 and <dir>/<id>.mp4.sha256. What the repository keeps goes to src/assets/tips/ (--out):
// for the tour <id>.json (the film's name, digest, size and length, its chapters, its captions),
// <id>.en.vtt (the captions), <id>.webp (its first frame) and <id>-<chapter>.webp (each chapter's key
// frame); for a clip kept whole, <id>.light.mp4 and <id>.light.webp. For writing a storyboard:
// --hashes writes <id>.frames.txt beside the film, a digest per frame (two recordings compared);
// --frames <dir> every frame as a JPEG; --boards <dir> takes storyboards from another folder.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inPage } from "./tips/inpage.mjs";
import { mp4 } from "./tips/mp4.mjs";

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
  // the pointer's pace, px a second, and a caption's: characters a second, the least seconds shown
  pace: 600,
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

async function main() {
  const projects = { sphere: flag("--sphere"), showcase: flag("--showcase") };
  const cache = flag("--cache");
  const urlArg = flag("--url");
  // a digest of every frame beside the film, to tell two recordings apart frame by frame
  const hashes = args.includes("--hashes");
  if (hashes) args.splice(args.indexOf("--hashes"), 1);
  // every frame as a JPEG, for looking at a storyboard frame by frame
  const framesDir = flag("--frames");
  const outDir = resolve(flag("--out") ?? join(REPO, "src", "assets", "tips"));
  const filmDir = flag("--film");
  const boardsDir = flag("--boards");
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error("This script needs Playwright: npm install --no-save playwright && npx playwright install chromium");
    process.exit(2);
  }
  const all = await storyboards(boardsDir ? resolve(boardsDir) : BOARDS);
  const wanted = args.length ? args : [...all.keys()];
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
      console.error(`${id} plays on ${b.on}: give --${b.on} <its build>.\nusage: npm run tips:record -- --sphere <dir> --showcase <dir> --film <dir> [--cache <dir>] [<id>…] [--out <dir>] [--url <server>] [--hashes] [--frames <dir>] [--boards <dir>]`);
      process.exit(2);
    }
  }
  mkdirSync(outDir, { recursive: true });
  // WebGL in software; the page's other drawing on one thread, which makes two recordings of a film
  // the same to within a few pixels a few levels apart (SwiftShader's own threads), and is faster
  const browser = await playwright.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--num-raster-threads=1", "--disable-gpu-rasterization"] });
  let failed = 0;
  try {
    for (const id of wanted) {
      const board = all.get(id);
      const work = mkdtempSync(join(tmpdir(), "visualproof-tips-"));
      const clock = join(work, "clock");
      writeFileSync(clock, FILM.now);
      const server = urlArg ? { url: urlArg.replace(/\/+$/, ""), stop: async () => {} } : await serve(board.on, projects[board.on], cache, work, clock);
      try {
        const t0 = Date.now();
        const files = buildFiles(board, work);
        const film = await record(browser, server.url, board, { clock, files, framesDir: framesDir && join(resolve(framesDir), id) });
        const sha256 = createHash("sha256").update(film.mp4).digest("hex");
        if (board.kept === false) {
          // the film elsewhere; what the page needs of it here
          const dir = resolve(filmDir);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${id}.mp4`), film.mp4);
          writeFileSync(join(dir, `${id}.mp4.sha256`), `${sha256}  ${id}.mp4\n`);
          const { width, height } = board.out ?? FILM.out;
          const about = { film: { file: `${id}-${sha256.slice(0, 12)}.mp4`, sha256, size: film.mp4.length, width, height, duration: film.duration }, chapters: film.chapters, captions: film.captions };
          writeFileSync(join(outDir, `${id}.json`), JSON.stringify(about, null, 1) + "\n");
          writeFileSync(join(outDir, `${id}.webp`), film.poster);
          for (const [c, still] of film.stills) writeFileSync(join(outDir, `${id}-${c}.webp`), still);
          if (hashes) writeFileSync(join(dir, `${id}.frames.txt`), film.hashes.join("\n") + "\n");
        } else {
          writeFileSync(join(outDir, `${id}.light.mp4`), film.mp4);
          writeFileSync(join(outDir, `${id}.light.webp`), film.poster);
          if (hashes) writeFileSync(join(outDir, `${id}.frames.txt`), film.hashes.join("\n") + "\n");
        }
        const mb = (film.mp4.length / 1024 / 1024).toFixed(1);
        const rate = ((film.mp4.length * 8) / film.duration / 1e6).toFixed(2);
        const chapters = board.chapters ? `; ${film.chapters.map((c) => `${c.id} ${c.start.toFixed(1)}`).join(", ")}` : "";
        console.log(`${id}: ${film.frames} frames, ${film.duration.toFixed(1)} s, ${mb} MB (${rate} Mbit/s), sha256 ${sha256.slice(0, 12)}, ${((Date.now() - t0) / 1000).toFixed(0)} s to make${film.late ? `; ${film.late} frames waited past the bound` : ""}${chapters}`);
        if (film.mp4.length > FILM.warnAbove) console.warn(`${id}: ${mb} MB, more than ${FILM.warnAbove / 1024 / 1024} MB: lower the bitrate or shorten it`);
      } catch (e) {
        failed++;
        console.error(`${id}: ${e instanceof Error ? e.stack : e}`);
      } finally {
        await server.stop();
        rmSync(work, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
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

/** When, on the page's clock, a film's page has loaded (ms after the clock was installed). */
const LOADED_BY = 30_000;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sleep = (ms) => new Promise((d) => setTimeout(d, ms));

/** A film: its MP4, its poster, its chapters' key frames and times. */
export async function record(browser, url, board, { clock, files = {}, framesDir = null }) {
  const fps = board.fps ?? FILM.fps;
  const DT = 1000 / fps;
  const V = board.viewport ?? FILM.viewport;
  // TIPS_PREVIEW: a film at half the size, quicker, for writing a storyboard (never kept)
  const full = board.out ?? FILM.out;
  const out = process.env.TIPS_PREVIEW ? { width: full.width / 2, height: full.height / 2 } : full;
  // light, and times and dates written the same on every machine
  const ctx = await browser.newContext({ viewport: V, deviceScaleFactor: 2, colorScheme: "light", hasTouch: !!board.phone, isMobile: !!board.phone, reducedMotion: "no-preference", timezoneId: "UTC", locale: "en-US" });
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
    const E = (window.__enc = { chunks: [], description: null, error: null, n: 0 });
    E.encoder = new VideoEncoder({
      output: (chunk, md) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        E.chunks.push({ data, key: chunk.type === "key", pts: chunk.timestamp });
        if (md?.decoderConfig?.description) E.description = new Uint8Array(md.decoderConfig.description);
      },
      error: (e) => (E.error = String(e)),
    });
    // H.264 High, level 4.0 up to 8,192 macroblocks a frame (1920×1080), 5.0 beyond (1920×1200)
    const level = Math.ceil(width / 16) * Math.ceil(height / 16) > 8192 ? "32" : "28";
    E.encoder.configure({ codec: `avc1.6400${level}`, width, height, bitrate, framerate: fps, bitrateMode: "variable", avc: { format: "avc" } });
    const b64 = (u8) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    // what has been encoded so far, handed over and let go
    E.drain = () => E.chunks.splice(0).map((c) => ({ data: b64(c.data), key: c.key, pts: c.pts }));
    E.avcC = () => (E.description ? b64(E.description) : null);
  }, { ...out, fps, bitrate: board.bitrate ?? FILM.bitrate });
  const samples = [];
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
  const cam = { x: V.width / 2, y: V.height / 2, vx: 0, vy: 0, gx: V.width / 2, gy: V.height / 2, follow: false };
  let late = 0;
  let tick = 0;
  let recording = false;
  let frames = 0;
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
    if (!r) throw new Error(`${board.id}${chapter ? ` (${chapter})` : ""}: nothing shown at ${JSON.stringify(target)}`);
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
    const n = await page.evaluate(() => window.__tips.beats());
    if (n !== beats) {
      beats = n;
      await sleep(700);
    }
    for (let t0 = Date.now(); !(await page.evaluate(() => window.__tips.quiet())); ) {
      // what the page waits on longest: Lean's language server, started for a hover; a document
      // typeset; a paper read
      if (Date.now() - t0 > (board.patience ?? 15_000)) {
        late++;
        break;
      }
      await sleep(10);
    }
  };
  const shotClip = () => ({ x: cam.x - camW / 2, y: cam.y - camH / 2, width: camW, height: camH, scale: out.width / camW });
  /** What the frame shows now, as a WebP no larger than a still may be: its quality lowered until it
   *  is not. */
  const still = async () => {
    let q = 70, b;
    do {
      b = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "webp", quality: q, clip: shotClip() })).data, "base64");
      q -= 8;
    } while (b.length > FILM.stillMax && q > 20);
    return b;
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
    await advance(Math.round(tick * DT) - Math.round((tick - 1) * DT));
    await settle();
    if (ring > 0) ring = Math.max(0, ring - DT / 450);
    if (key) {
      keyT = keyHeld ? Math.min(keyT + DT, 120) : keyT + DT;
      if (keyT > 1100) key = "";
    }
    const keyAlpha = Math.min(1, keyT / 120, Math.max(0, (1100 - keyT) / 250));
    await page.evaluate((p) => {
      window.__tips.pointer(p);
      window.__tips.sync();
    }, { x: px, y: py, finger: !!board.phone, ring, ringX, ringY, key, keyAlpha, hidden, second });
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
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 95, clip: shotClip() }).catch((e) => {
      throw new Error(`${board.id}: no frame of ${JSON.stringify(shotClip())}: ${e.message}`);
    });
    hashes.push(createHash("sha256").update(shot.data).digest("hex").slice(0, 16));
    if (framesDir) writeFileSync(join(framesDir, `${String(frames).padStart(5, "0")}.jpg`), Buffer.from(shot.data, "base64"));
    const keyFrame = keyNext || frames % Math.round(fps * (board.keyEvery ?? FILM.keyEvery)) === 0;
    keyNext = false;
    await enc.evaluate(async ({ f, i, dt, keyFrame }) => {
      const E = window.__enc;
      const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${f}`)).blob());
      const vf = new VideoFrame(bmp, { timestamp: Math.round(i * dt * 1000), duration: Math.round(dt * 1000) });
      E.encoder.encode(vf, { keyFrame });
      vf.close();
      bmp.close();
      // the encoder kept from running far ahead of what it has written
      while (E.encoder.encodeQueueSize > 8) await new Promise((d) => setTimeout(d, 5));
    }, { f: shot.data, i: frames, dt: DT, keyFrame });
    frames++;
    if (frames % 30 === 0) await drain();
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
  const agent = { token: null, inbox: [], stop: null, busy: false };
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
    /** Text typed at a pace that can be read along (`cps` characters a second, 12 unless said;
     *  `every`: frames a character instead). */
    async type(s) {
      const every = s.every ?? Math.max(1, Math.round(fps / (s.cps ?? 12)));
      for (const ch of s.type) {
        await page.keyboard.type(ch);
        for (let i = 0; i < every; i++) await frame();
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
      stills.set(chapter, await still());
    },
    /** The agent of the film (an AI agent's token made on the page, its API driven from here):
     *  `join` takes the token the page shows and starts listening; `await` waits for what a person
     *  wrote to it; `status`, `view`, `reply` are its requests (`body` or `text`). Each is done
     *  between two frames, and what the server pushes for it reaches the page before the next. */
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
        await agentApi("POST", s.agent, s.body ?? { text: s.text });
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
    await run(1500);
    await play(board.before ?? []);
    await run(board.settle ?? 1200);
    recording = true;
    const chapters = [];
    for (const c of chaptersOf(board)) {
      chapter = c.id;
      keyNext = true;
      const start = frames;
      if (!chapters.length) poster = await still();
      await play(c.steps);
      // a caption of the chapter is read before it ends, and ends with it
      await closeCue();
      if (!stills.has(c.id)) await steps.poster();
      chapters.push({ id: c.id, start: start / fps, end: frames / fps });
    }
    agent.stop?.abort();
    if (!board.chapters) poster = stills.get(board.id);
    stills.delete(board.id);
    await enc.evaluate(() => window.__enc.encoder.flush());
    await drain();
    const [error, avcC] = await enc.evaluate(() => [window.__enc.error, window.__enc.avcC()]);
    if (error) throw new Error(`${board.id}: the encoder: ${error}`);
    if (!avcC) throw new Error(`${board.id}: the encoder gave no avcC`);
    const duration = frames / fps;
    return { mp4: mp4({ ...out, fps, avcC: Buffer.from(avcC, "base64"), samples }), poster, stills, chapters, captions, duration, frames, late, hashes };
  } finally {
    agent.stop?.abort();
    await ctx.close();
  }
}

if (import.meta.main) await main();
