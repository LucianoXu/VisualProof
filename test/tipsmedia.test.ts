// The tips' clips (GuideSpec decision 6; server/media.ts): a file as it is, a range of it, what cannot
// be given; a file that cannot be read answered, never the server brought down; a reader gone in the
// middle of a clip leaving no file open; which clips there are; and a read-only reader let in to them.

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sendMedia, TIP_PATH, tipClips, tourVtt } from "../src/server/media.ts";
import { readOnlyAllows } from "../src/server/readonlygate.ts";
import { site } from "./site.ts";

/** A folder of clips, served as the server serves them. */
async function clips(files: Record<string, number>) {
  const dir = mkdtempSync(join(tmpdir(), "vp-tips-"));
  for (const [name, size] of Object.entries(files)) writeFileSync(join(dir, name), Buffer.alloc(size, 7));
  const server = createServer((req, res) => sendMedia(req, res, join(dir, req.url!.slice(1))));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { dir, base, close: () => new Promise<void>((ok) => server.close(() => (rmSync(dir, { recursive: true, force: true }), ok()))) };
}

/** this process's open files (where the system shows them) */
const open = (): number | null => {
  try {
    return readdirSync("/dev/fd").length;
  } catch {
    return null;
  }
};

test("a clip is given whole, or the range asked for, or 416; unchanged, 304; none, 404", async () => {
  const C = await clips({ "a.light.mp4": 1000 });
  try {
    const whole = await fetch(`${C.base}/a.light.mp4`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("accept-ranges"), "bytes");
    assert.equal(whole.headers.get("content-type"), "video/mp4");
    assert.equal((await whole.arrayBuffer()).byteLength, 1000);
    const part = await fetch(`${C.base}/a.light.mp4`, { headers: { range: "bytes=0-99" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 0-99/1000");
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    const tail = await fetch(`${C.base}/a.light.mp4`, { headers: { range: "bytes=-10" } });
    assert.equal(tail.headers.get("content-range"), "bytes 990-999/1000");
    assert.equal((await tail.arrayBuffer()).byteLength, 10);
    const beyond = await fetch(`${C.base}/a.light.mp4`, { headers: { range: "bytes=2000-" } });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get("content-range"), "bytes */1000");
    const again = await fetch(`${C.base}/a.light.mp4`, { headers: { "if-none-match": whole.headers.get("etag")! } });
    assert.equal(again.status, 304);
    assert.equal((await fetch(`${C.base}/b.light.mp4`)).status, 404);
  } finally {
    await C.close();
  }
});

test("a reader gone in the middle of a clip leaves no file open; a file that cannot be read is answered", async () => {
  const C = await clips({ "big.light.mp4": 32 << 20, "shut.dark.mp4": 100 });
  try {
    const before = open();
    for (let k = 0; k < 20; k++)
      await new Promise<void>((done) => {
        const r = get(`${C.base}/big.light.mp4`, (res) => res.once("data", () => (r.destroy(), done())));
        r.on("error", () => done());
      });
    if (before !== null) {
      // the server's side of each connection and its file close once it sees the reader gone
      const deadline = Date.now() + 5000;
      while (open()! > before && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 50));
      assert.ok(open()! <= before, `files left open: ${open()! - before}`);
    }
    // opened after it was found: refused by the system (where the system refuses its owner)
    chmodSync(join(C.dir, "shut.dark.mp4"), 0o000);
    const shut = await fetch(`${C.base}/shut.dark.mp4`);
    assert.ok(shut.status === 404 || shut.status === 200, `answered: ${shut.status}`);
    await shut.arrayBuffer();
    // and the server still answers
    assert.equal((await fetch(`${C.base}/big.light.mp4`, { headers: { range: "bytes=0-0" } })).status, 206);
  } finally {
    await C.close();
  }
});

test("the clips there are: those in the light theme; the addresses of clips, the film's data, poster and stills alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-tips-"));
  try {
    for (const f of ["tour.json", "tour.webp", "tour-checks.webp", "phone-fingers.light.mp4", "phone-fingers.light.webp", "notes.txt"]) writeFileSync(join(dir, f), "x");
    assert.deepEqual(tipClips(dir), ["phone-fingers"]);
    assert.deepEqual(tipClips(join(dir, "none")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const p of ["/tips/tour.json", "/tips/tour.webp", "/tips/tour-checks.webp", "/tips/phone-fingers.light.mp4", "/tips/phone-fingers.light.webp"]) assert.ok(TIP_PATH.test(p), p);
  // the film is not a file of the package (server/media.ts, tourFilmFile), nor are its captions
  for (const p of ["/tips/tour.mp4", "/tips/tour.en.vtt", "/tips/../package.json", "/tips/tcb.mp4", "/tips/TCB.light.mp4", "/tips/a/b.light.mp4", "/tips/tcb.light.mp4.map", "/tips/other.json", "/tips/tour.json.bak"]) assert.ok(!TIP_PATH.test(p), p);
});

test("the film's data is served as JSON; its captions as WebVTT, nothing in them read as markup", async () => {
  const C = await clips({ "tour.json": 0 });
  try {
    writeFileSync(join(C.dir, "tour.json"), JSON.stringify({ film: { duration: 10 }, chapters: [], captions: [] }));
    const r = await fetch(`${C.base}/tour.json`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), { film: { duration: 10 }, chapters: [], captions: [] });
  } finally {
    await C.close();
  }
  const vtt = tourVtt({ captions: [{ start: 1.5, end: 4, text: "TCB <b>lights</b> & --> what\nit rests on" }, { start: 3661.25, end: 3662, text: "an hour on" }, { start: 5, end: 4, text: "dropped" }] })!;
  assert.equal(vtt, "WEBVTT\n\n00:00:01.500 --> 00:00:04.000\nTCB &lt;b&gt;lights&lt;/b&gt; &amp; → what it rests on\n\n01:01:01.250 --> 01:01:02.000\nan hour on\n");
  assert.equal(tourVtt({}), null);
  assert.equal(tourVtt(null), null);
});

test("the server lists its clips at /tips/index.json, and lets a read-only reader read them", async () => {
  const S = await site();
  try {
    const r = await fetch(`${S.base}/tips/index.json`);
    assert.equal(r.status, 200);
    const j = (await r.json()) as { clips: unknown };
    assert.ok(Array.isArray(j.clips) && j.clips.every((c) => typeof c === "string"));
    assert.equal((await fetch(`${S.base}/tips/none.light.mp4`)).status, 404);
  } finally {
    await S.close();
  }
  assert.ok(readOnlyAllows("GET", "/tips/index.json") && readOnlyAllows("GET", "/tips/tcb.light.mp4") && readOnlyAllows("HEAD", "/tips/tcb.dark.webp"));
  assert.ok(!readOnlyAllows("POST", "/tips/tcb.light.mp4"));
});
