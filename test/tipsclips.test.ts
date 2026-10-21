// The tips' films (GuideSpec, "Demonstrations"; scripts/tips-record.mjs): the tour, one film of a
// review in thirteen chapters with captions, kept out of the repository (a release's asset) — what
// the repository keeps of it is its data (its file's name, digest, size and length, its chapters, its
// captions), its captions as WebVTT and a still per chapter; the phone's gestures, one clip, light;
// each made by a storyboard that still fits the page — the controls it presses, the keys it types,
// the showcase's declarations and views it plays on — checked here without a browser, since
// recording needs the projects' builds. A film whose storyboard no longer fits is recorded again
// (CONTRIBUTING.md, "Scripts").

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FOLLOWED, YOURS } from "../src/web/src/surfaces.ts";
import { chaptersOf, FILM, storyboards } from "../scripts/tips-record.mjs";
import { tourVtt } from "../src/server/media.ts";
import type { Caption } from "../scripts/tips-record.mjs";
import { boxes, mp4, readMp4 } from "../scripts/tips/mp4.mjs";
import { groups, join as joinFilm, split } from "../scripts/tips/film.mjs";

const ROOT = join(import.meta.dirname, "..");
const CLIPS = join(ROOT, "src", "assets", "tips");
const SHOWCASE = join(ROOT, "showcase", "flt-regular");

/** The tour's chapters, in their order (GuideSpec, "The tour film"). */
const TOUR = ["target", "view", "arrange", "source", "keys", "checks", "review", "project", "share", "agent", "library", "export", "artwork"];

/** The budgets: what the repository keeps of the tour travels in the package. */
const STILL_MAX = 200 * 1024;
const CAPTION_MAX = 60;

const VERBS = ["camera", "move", "click", "choose", "pdf", "tap", "key", "type", "drag", "swipe", "pinch", "wheel", "scroll", "wait", "waitFor", "hide", "poster", "filmPoster", "fade", "caption", "agent", "eval"];

/** The page's own text: its skeleton, its code and its style, where every control it makes is named. */
const WEB = join(ROOT, "src", "web");
const pageText = [
  readFileSync(join(WEB, "index.html"), "utf8"),
  readFileSync(join(WEB, "style.css"), "utf8"),
  ...readdirSync(join(WEB, "src")).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(WEB, "src", f), "utf8")),
].join("\n");

/** The page's keys (web/src/surfaces.ts), and those of the fields and windows a storyboard types in:
 *  Escape, Enter, and Ctrl Enter that keeps a note. */
const KEYS = new Set<string>([...FOLLOWED, ...YOURS].flatMap((p) => ("keys" in p && p.keys ? [...p.keys] : [])));
for (const k of ["Escape", "Enter", "Control+Enter"]) KEYS.add(k);

/** Where every name of the showcase is: its story and the site it made. */
const showcaseText = (() => {
  const out: string[] = [readFileSync(join(SHOWCASE, "story.ts"), "utf8")];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.(json|jsonl)$/.test(e.name)) out.push(readFileSync(join(d, e.name), "utf8"));
    }
  };
  walk(join(SHOWCASE, "site"));
  return out.join("\n");
})();
const VIEWS = new Set((JSON.parse(readFileSync(join(SHOWCASE, "site", "views.json"), "utf8")).views as { id: string }[]).map((v) => v.id));

/** What of a selector must be the page's: its ids, classes and data attributes (not what an
 *  attribute's value holds: a declaration's name, dots and all). */
function selectorNames(sel: string): string[] {
  const bare = sel.replace(/'[^']*'|"[^"]*"/g, "");
  return [...bare.matchAll(/#([\w-]+)|\.([\w-]+)|\[(data-[\w-]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Every place a step points at: as a selector, a declaration, a text in a part of the page. */
function targets(step: Record<string, unknown>): unknown[] {
  return ["camera", "move", "drag", "swipe", "pinch", "tap", "scroll", "choose", "pdf", "waitFor"].flatMap((k) => (k in step && typeof step[k] !== "boolean" ? [step[k]] : [])).concat(step.to ? [step.to] : []);
}

/** An MP4's frame size, from its boxes. */
function sizeOf(f: Buffer): [number, number] {
  const avc1 = f.indexOf(Buffer.from("avc1"), f.indexOf(Buffer.from("stsd")));
  return [f.readUInt16BE(avc1 + 28), f.readUInt16BE(avc1 + 30)];
}

/** The sync samples of an MP4 (stss), numbered from 1. */
function syncSamples(f: Buffer): number[] {
  const at = f.indexOf(Buffer.from("stss"));
  const n = f.readUInt32BE(at + 8);
  return Array.from({ length: n }, (_, i) => f.readUInt32BE(at + 12 + 4 * i));
}

interface Tour {
  film: { file: string; sha256: string; size: number; width: number; height: number; duration: number };
  chapters: { id: string; start: number; end: number }[];
  captions: Caption[];
}
const tour = (): Tour => JSON.parse(readFileSync(join(CLIPS, "tour.json"), "utf8"));

test("the storyboards: the tour in its thirteen chapters, on Sphere-Packing-Lean, not kept here; the phone's gestures on the showcase", async () => {
  const boards = await storyboards();
  assert.deepEqual([...boards.keys()].sort(), ["phone-fingers", "tour"]);
  const t = boards.get("tour")!;
  assert.equal(t.on, "sphere");
  assert.equal(t.kept, false);
  assert.deepEqual(chaptersOf(t).map((c) => c.id), TOUR);
  assert.equal(boards.get("phone-fingers")!.on, "showcase");
  for (const tex of Object.values(t.files ?? {})) assert.ok(existsSync(join(ROOT, "scripts", "tips", tex)), `the tour typesets ${tex}`);
});

test("a storyboard plays what the page has: its controls, its keys, the showcase's declarations and views; its captions are short", async () => {
  for (const [id, b] of await storyboards()) {
    const steps = [...(b.before ?? []), ...chaptersOf(b).flatMap((c) => c.steps)];
    for (const s of steps) {
      const verbs = VERBS.filter((v) => v in s);
      assert.equal(verbs.length, 1, `${id}: a step is one thing done: ${JSON.stringify(s)}`);
      if ("key" in s) assert.ok(KEYS.has(s.key), `${id}: the page has no key ${s.key}`);
      if ("caption" in s && s.caption) assert.ok(s.caption.length <= CAPTION_MAX, `${id}: a caption of ${s.caption.length} characters: ${s.caption}`);
      for (const t of targets(s)) {
        if (typeof t === "string" && t.startsWith("decl:")) {
          const name = t.slice(5);
          // the showcase's names are in the repository; Sphere-Packing-Lean's are not
          if (b.on === "showcase") assert.ok(showcaseText.includes(name), `${id}: the showcase has no ${name}`);
          else assert.ok(/^[\p{L}_][\p{L}\p{N}_'.]*$/u.test(name), `${id}: ${name} is no Lean name`);
        } else if (typeof t === "string" && t !== "lit" && t !== "pointer") {
          for (const n of selectorNames(t)) assert.ok(pageText.includes(n), `${id}: the page makes no ${n} (${t})`);
        } else if (t && typeof t === "object" && "text" in t) {
          const { in: inside } = t as { in: string; text: string };
          for (const n of selectorNames(inside)) assert.ok(pageText.includes(n), `${id}: the page makes no ${n} (${inside})`);
        }
      }
    }
    const view = new URLSearchParams(b.address ?? "").get("v");
    if (view && b.on === "showcase") assert.ok(VIEWS.has(view), `${id}: the showcase has no view ${view}`);
  }
});

test("the tour's data: its film by name and digest, its thirteen chapters covering it in order", () => {
  const { film, chapters } = tour();
  assert.match(film.sha256, /^[0-9a-f]{64}$/);
  assert.equal(film.file, `tour-${film.sha256.slice(0, 12)}.mp4`);
  assert.ok(Number.isInteger(film.size) && film.size > 0);
  assert.deepEqual([film.width, film.height], [FILM.out.width, FILM.out.height]);
  assert.deepEqual(chapters.map((c) => c.id), TOUR);
  assert.equal(chapters[0].start, 0);
  assert.equal(chapters.at(-1)!.end, film.duration);
  chapters.forEach((c, i) => {
    assert.ok(c.end > c.start, `${c.id} has no length`);
    if (i) assert.equal(c.start, chapters[i - 1].end, `${c.id} starts where ${chapters[i - 1].id} ended`);
  });
});

test("the tour's captions: in order, none over another, short, each within the film and shown long enough to read", () => {
  const { film, captions } = tour();
  assert.ok(captions.length >= TOUR.length * 2, `${captions.length} captions`);
  captions.forEach((c, i) => {
    assert.ok(c.text.length > 0 && c.text.length <= CAPTION_MAX, `"${c.text}": ${c.text.length} characters`);
    assert.ok(c.start >= 0 && c.end <= film.duration + 1e-9 && c.end > c.start, `"${c.text}" is not within the film`);
    assert.ok(c.end - c.start >= Math.max(FILM.shownAtLeast, c.text.length / FILM.reading) - 1 / FILM.fps, `"${c.text}" is shown ${(c.end - c.start).toFixed(2)} s`);
    if (i) assert.ok(c.start >= captions[i - 1].end - 1e-9, `"${c.text}" over "${captions[i - 1].text}"`);
  });
  // the WebVTT the server makes of them holds every one (server/media.ts)
  const vtt = tourVtt(tour());
  assert.ok(vtt?.startsWith("WEBVTT"));
  assert.equal(vtt!.split(" --> ").length - 1, captions.length);
});

test("the tour's stills: its poster and each chapter's, WebPs within 200 KB", () => {
  for (const still of ["tour.webp", ...TOUR.map((c) => `tour-${c}.webp`)]) {
    const f = join(CLIPS, still);
    assert.ok(existsSync(f), `${still} is missing`);
    const p = readFileSync(f);
    assert.equal(p.toString("latin1", 0, 4), "RIFF");
    assert.equal(p.toString("latin1", 8, 12), "WEBP");
    assert.ok(p.length <= STILL_MAX, `${still}: ${p.length} bytes`);
  }
});

test("the phone's clip, light, at its own size; nothing else in the folder, no film of the tour", async () => {
  const b = (await storyboards()).get("phone-fingers")!;
  const film = readFileSync(join(CLIPS, "phone-fingers.light.mp4"));
  assert.ok(existsSync(join(CLIPS, "phone-fingers.light.webp")));
  assert.deepEqual(sizeOf(film), [b.out!.width, b.out!.height]);
  const files = readdirSync(CLIPS).filter((f) => statSync(join(CLIPS, f)).isFile());
  const expected = ["tour.json", "tour.webp", ...TOUR.map((c) => `tour-${c}.webp`), "phone-fingers.light.mp4", "phone-fingers.light.webp"];
  assert.deepEqual(files.sort(), expected.sort());
});


test("the muxer: an index whose chunk offset finds the first sample, sync samples listed, offsets only for reordered frames", () => {
  const samples = [
    { data: Uint8Array.from([1, 2, 3, 4]), key: true, pts: 0 },
    { data: Uint8Array.from([5, 6]), key: false, pts: 1000 },
    { data: Uint8Array.from([7, 8, 9]), key: true, pts: 2000 },
  ];
  const f = mp4({ width: 16, height: 8, fps: 30, avcC: Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe0, 0]), samples });
  assert.deepEqual(boxes(f).map((x) => x.type), ["ftyp", "moov", "mdat"]);
  const stco = f.indexOf(Buffer.from("stco"));
  const offset = f.readUInt32BE(stco + 12);
  assert.deepEqual([...f.subarray(offset, offset + 9)], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(syncSamples(f), [1, 3]);
  assert.equal(f.indexOf(Buffer.from("ctts")), -1);
  const reordered = mp4({ width: 16, height: 8, fps: 30, avcC: Uint8Array.from([1]), samples: [samples[0], { ...samples[2], pts: 2000 }, { ...samples[1], pts: 1000 }] });
  assert.ok(reordered.indexOf(Buffer.from("ctts")) > 0);
});

test("the muxer: a chunk a second, so that a player reading a chunk whole streams the film", () => {
  // 75 frames at 30 a second: chunks of 30, 30 and 15, each found where its first sample is
  const samples = Array.from({ length: 75 }, (_, i) => ({ data: Uint8Array.from([i, i]), key: i % 30 === 0, pts: i * 1000 }));
  const f = mp4({ width: 16, height: 8, fps: 30, avcC: Uint8Array.from([1]), samples });
  const stsc = f.indexOf(Buffer.from("stsc"));
  const entries = f.readUInt32BE(stsc + 8);
  assert.deepEqual(Array.from({ length: entries }, (_, k) => [0, 4, 8].map((d) => f.readUInt32BE(stsc + 12 + 12 * k + d))), [[1, 30, 1], [3, 15, 1]]);
  const stco = f.indexOf(Buffer.from("stco"));
  const chunks = f.readUInt32BE(stco + 8);
  assert.equal(chunks, 3);
  for (let c = 0; c < chunks; c++) assert.equal(f[f.readUInt32BE(stco + 12 + 4 * c)], 30 * c, `chunk ${c + 1} starts at its first sample`);
  // a film of whole seconds has one stsc entry
  const even = mp4({ width: 16, height: 8, fps: 30, avcC: Uint8Array.from([1]), samples: samples.slice(0, 60) });
  assert.equal(even.readUInt32BE(even.indexOf(Buffer.from("stsc")) + 8), 1);
});

test("the reader: a file the muxer wrote, read back to the same samples, and written again to the same bytes", () => {
  const samples = Array.from({ length: 75 }, (_, i) => ({ data: Uint8Array.from([i, 255 - i, i % 7]), key: i % 30 === 0, pts: i * 1000 }));
  const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe0, 0]);
  const f = mp4({ width: 32, height: 16, fps: 30, avcC, samples });
  const r = readMp4(f);
  assert.deepEqual([r.width, r.height, r.fps], [32, 16, 30]);
  assert.deepEqual([...r.avcC], [...avcC]);
  assert.deepEqual(r.samples.map((s) => [[...s.data], s.key, s.pts]), samples.map((s) => [[...s.data], s.key, s.pts]));
  assert.ok(mp4({ width: r.width, height: r.height, fps: r.fps, avcC: r.avcC, samples: r.samples }).equals(f));
  // the phone's clip, as the recorder made it
  const clip = readFileSync(join(CLIPS, "phone-fingers.light.mp4"));
  const c = readMp4(clip);
  assert.ok(mp4({ width: c.width, height: c.height, fps: c.fps, avcC: c.avcC, samples: c.samples }).equals(clip));
});

/** A film of chapters as the recorder makes one: each chapter's first sample a key frame. */
function filmOf(lengths: number[], avcC = Uint8Array.from([1, 2, 3])) {
  const fps = 30;
  const samples: { data: Uint8Array; key: boolean; pts: number }[] = [];
  const chapters: { id: string; start: number; end: number }[] = [];
  const captions: Caption[] = [];
  let n = 0;
  lengths.forEach((len, k) => {
    for (let i = 0; i < len; i++) samples.push({ data: Uint8Array.from([k, i & 255]), key: i % 60 === 0, pts: (n + i) * 1000 });
    chapters.push({ id: `c${k}`, start: n / fps, end: (n + len) / fps });
    captions.push({ start: n / fps + 0.2, end: (n + len) / fps, text: `chapter ${k}` });
    n += len;
  });
  const file = mp4({ width: 32, height: 16, fps, avcC, samples });
  return { file, about: { film: { duration: n / fps }, chapters, captions } };
}

test("a film of chapters taken apart and put together again: the same bytes; a chapter recorded again moves those after it", () => {
  const { file, about } = filmOf([70, 45, 90]);
  const parts = split(readMp4(file), about);
  assert.deepEqual(parts.map((p) => [p.id, p.frames, p.captions.length]), [["c0", 70, 1], ["c1", 45, 1], ["c2", 90, 1]]);
  const whole = joinFilm(parts, 30);
  assert.ok(mp4({ width: 32, height: 16, fps: 30, avcC: whole.avcC, samples: whole.samples }).equals(file));
  assert.deepEqual(whole.chapters, about.chapters);
  assert.deepEqual(whole.captions, about.captions);
  // the middle chapter recorded again, 15 frames longer: the last moves by half a second, its samples kept
  const again = { id: "c1", frames: 60, captions: [{ start: 0.1, end: 2, text: "again" }], avcC: Uint8Array.from([1, 2, 3]), samples: Array.from({ length: 60 }, (_, i) => ({ data: Uint8Array.from([9, i]), key: i === 0, pts: i * 1000 })) };
  const spliced = joinFilm([parts[0], again, parts[2]], 30);
  assert.deepEqual(spliced.chapters.map((c) => [c.id, +c.start.toFixed(4), +c.end.toFixed(4)]), [["c0", 0, 2.3333], ["c1", 2.3333, 4.3333], ["c2", 4.3333, 7.3333]]);
  assert.deepEqual(spliced.captions.map((c) => c.text), ["chapter 0", "again", "chapter 2"]);
  assert.ok(Math.abs(spliced.captions[2].start - (130 / 30 + 0.2)) < 1e-9);
  const out = readMp4(mp4({ width: 32, height: 16, fps: 30, avcC: spliced.avcC, samples: spliced.samples }));
  assert.equal(out.samples.length, 220);
  assert.deepEqual([...out.samples[130].data], [2, 0], "the last chapter's first sample, kept");
  assert.ok(out.samples[70].key && out.samples[130].key);
  // what cannot be joined: another encoder's description; a chapter that does not begin on a key frame
  assert.throws(() => joinFilm([parts[0], { ...again, avcC: Uint8Array.from([7]) }], 30), /encoded otherwise/);
  assert.throws(() => split(readMp4(file), { ...about, chapters: [{ id: "c0", start: 0, end: 1 }, { id: "c1", start: 1, end: about.film.duration }] }), /key frame/);
});

test("the chapters shared out between processes: contiguous groups, in order, as many as help", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const seconds = new Map([["a", 10], ["b", 10], ["c", 40], ["d", 10], ["e", 10]]);
  assert.deepEqual(groups(ids, seconds, ids, 1), [ids]);
  for (const jobs of [2, 3, 4, 8]) {
    const g = groups(ids, seconds, ids, jobs);
    assert.ok(g.length <= jobs && g.length >= 1);
    assert.deepEqual(g.flat(), ids, "every chapter once, in order");
  }
  // the long chapter alone
  assert.ok(groups(ids, seconds, ids, 4).some((g) => g.length === 1 && g[0] === "c"));
  // only some chapters: only those, in order
  assert.deepEqual(groups(ids, seconds, ["e", "b"], 4).flat(), ["b", "e"]);
});
