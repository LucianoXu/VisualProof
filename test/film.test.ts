// The tips' tour film (UpdateSpec decision 14, server/film.ts), fetched from an asset server of the
// test's own: the film whose size and sha256 match is kept and served, with byte ranges; one that does
// not is refused, removed and not asked again for a while; requests while it downloads are answered
// 503 and share the one download; more bytes than pinned are never kept; redirects only to where
// the film may be; never fetched under --updates off, where the address answers 404.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Film, FILM_BASE, filmBase, serveFilm, useFilm } from "../src/server/film.ts";
import type { FilmPin } from "../src/server/film.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-film-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = (name: string) => join(tmp, `${name}-${n++}`);

const FILM = Buffer.from(Buffer.alloc(200_000, 7).map((b, i) => (b + i * 31) & 255));
const pin = (bytes = FILM): FilmPin => ({ file: "tour-abc.mp4", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, width: 2560, height: 1600, duration: 230 });

/** an asset server: what each path answers, and how many times each was asked; `hold` keeps the
 *  film's answer back until it is let go */
async function assets(routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void>) {
  const asked: Record<string, number> = {};
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    asked[path] = (asked[path] ?? 0) + 1;
    (routes[path] ?? ((_q, r: ServerResponse) => (r.writeHead(404), r.end())))(req, res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return { base, asked, close: () => new Promise((ok) => server.close(ok)) };
}

const bytes = (b: Buffer, length = true) => (_q: IncomingMessage, r: ServerResponse) => {
  r.writeHead(200, { "content-type": "video/mp4", ...(length ? { "content-length": b.length } : {}) });
  r.end(b);
};

test("the address: the release's, or a loopback one a test gives; nothing else", () => {
  assert.equal(filmBase({}), FILM_BASE);
  assert.equal(filmBase({ VISUALPROOF_MEDIA_BASE: "http://127.0.0.1:9999/films" }), "http://127.0.0.1:9999/films/");
  assert.equal(filmBase({ VISUALPROOF_MEDIA_BASE: "https://evil.example/films/" }), FILM_BASE);
  assert.equal(filmBase({ VISUALPROOF_MEDIA_BASE: "http://127.0.0.1.evil.example/" }), FILM_BASE);
});

test("the film whose size and sha256 match is fetched once, on the first ask, kept 0700 and served thereafter; the asks meanwhile share it", async () => {
  let release = () => {};
  const held = new Promise<void>((ok) => (release = ok));
  const A = await assets({ "/tour-abc.mp4": (q, r) => void held.then(() => bytes(FILM)(q, r)) });
  const cache = fresh("ok");
  const film = new Film({ cacheRoot: cache, mode: "auto", pin: pin(), base: A.base });
  assert.equal(film.status().state, "waiting");
  // not at start: nothing asked until a page asks
  assert.equal(A.asked["/tour-abc.mp4"], undefined);
  const asks = await Promise.all([1, 2, 3, 4, 5].map(() => film.file()));
  assert.deepEqual(asks, [null, null, null, null, null]);
  assert.equal(film.status().state, "fetching");
  release();
  await film.settled();
  const kept = await film.file();
  assert.equal(kept, join(cache, "media", `${pin().sha256}.mp4`));
  assert.ok(statSync(kept!).size === FILM.length);
  assert.equal(statSync(join(cache, "media")).mode & 0o777, 0o700);
  assert.equal(A.asked["/tour-abc.mp4"], 1, "one download for every ask");
  assert.deepEqual(film.status(), { state: "cached", sha256: pin().sha256, size: FILM.length });
  // a new server finds it kept: checked once, not fetched again
  const again = new Film({ cacheRoot: cache, mode: "auto", pin: pin(), base: A.base });
  assert.equal(await again.file(), null);
  await again.settled();
  assert.equal(await again.file(), kept);
  assert.equal(A.asked["/tour-abc.mp4"], 1);
  await A.close();
});

test("what is not the film is refused and removed, and not asked again for a while: another hash, another length said, more bytes than pinned", async () => {
  const other = Buffer.from(FILM).fill(1, 0, 10);
  const A = await assets({ "/tour-abc.mp4": bytes(other), "/long.mp4": bytes(Buffer.concat([FILM, Buffer.alloc(5)])), "/chunked.mp4": bytes(Buffer.concat([FILM, Buffer.alloc(5)]), false) });
  let t = Date.now();
  const logs: string[] = [];
  const cache = fresh("bad");
  const film = new Film({ cacheRoot: cache, mode: "auto", pin: pin(), base: A.base, now: () => t, log: (l) => logs.push(l) });
  await film.file();
  await film.settled();
  assert.equal(await film.file(), null);
  const st = film.status();
  assert.equal(st.state, "unavailable");
  assert.match(st.why!, /its sha256 is .*, not the .* pinned/);
  assert.deepEqual(readdirSync(join(cache, "media")), [], "nothing kept, nothing half kept");
  assert.equal(A.asked["/tour-abc.mp4"], 1, "not asked again meanwhile");
  assert.ok(logs.some((l) => /tour film: its sha256 is .*; tried again in a day/.test(l)), logs.join("\n"));
  t += 25 * 3600_000;
  await film.file();
  await film.settled();
  assert.equal(A.asked["/tour-abc.mp4"], 2, "a day on, asked again");
  // a length said larger than pinned: refused before a byte is kept
  const long = new Film({ cacheRoot: fresh("long"), mode: "auto", pin: { ...pin(), file: "long.mp4" }, base: A.base });
  await long.file();
  await long.settled();
  assert.match(long.status().why!, /is 200005 bytes, not the 200000 pinned/);
  // no length said, more bytes coming: cut at the pinned size, never more on the disk
  const chunked = new Film({ cacheRoot: fresh("chunked"), mode: "auto", pin: { ...pin(), file: "chunked.mp4" }, base: A.base });
  await chunked.file();
  await chunked.settled();
  assert.match(chunked.status().why!, /more than the 200000 bytes pinned came/);
  await A.close();
});

test("redirects: followed where the film may be (here, the test's host); refused elsewhere", async () => {
  const A = await assets({
    "/tour-abc.mp4": (_q, r) => (r.writeHead(302, { location: "/assets/blob" }), r.end()),
    "/assets/blob": bytes(FILM),
    "/away.mp4": (_q, r) => (r.writeHead(302, { location: "https://example.org/blob" }), r.end()),
  });
  const film = new Film({ cacheRoot: fresh("redir"), mode: "auto", pin: pin(), base: A.base });
  await film.file();
  await film.settled();
  assert.equal(film.status().state, "cached");
  const away = new Film({ cacheRoot: fresh("away"), mode: "auto", pin: { ...pin(), file: "away.mp4" }, base: A.base });
  await away.file();
  await away.settled();
  assert.match(away.status().why!, /sent to https:\/\/example\.org, which is not where the film is kept/);
  await A.close();
});

test("GET /tips/tour.mp4: 503 while the film is fetched, then the film with byte ranges; under --updates off, 404 and nothing fetched; a local file served in its place", async () => {
  let release = () => {};
  const held = new Promise<void>((ok) => (release = ok));
  const A = await assets({ "/tour-abc.mp4": (q, r) => void held.then(() => bytes(FILM)(q, r)) });
  // a send as the media route's: the file, or the range asked
  const send = (req: IncomingMessage, res: ServerResponse, file: string) => {
    const size = statSync(file).size;
    const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
    if (m) {
      res.writeHead(206, { "content-range": `bytes ${m[1]}-${m[2]}/${size}`, "content-length": Number(m[2]) - Number(m[1]) + 1 });
      return void createReadStream(file, { start: Number(m[1]), end: Number(m[2]) }).pipe(res);
    }
    res.writeHead(200, { "content-length": size });
    createReadStream(file).pipe(res);
  };
  const server = createServer((req, res) => void serveFilm(req, res, send));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tips/tour.mp4`;
  try {
    const film = useFilm({ cacheRoot: fresh("route"), mode: "auto", pin: pin(), base: A.base, local: null });
    const first = await fetch(at);
    assert.deepEqual([first.status, first.headers.get("retry-after")], [503, "10"]);
    // the reader goes away; another asks meanwhile: still the one download
    const gone = new AbortController();
    void fetch(at, { signal: gone.signal }).catch(() => {});
    gone.abort();
    assert.equal((await fetch(at)).status, 503);
    release();
    await film.settled();
    assert.equal(A.asked["/tour-abc.mp4"], 1);
    const whole = await fetch(at);
    assert.deepEqual([whole.status, Buffer.from(await whole.arrayBuffer()).equals(FILM)], [200, true]);
    const part = await fetch(at, { headers: { range: "bytes=10-19" } });
    assert.deepEqual([part.status, Buffer.from(await part.arrayBuffer()).equals(FILM.subarray(10, 20))], [206, true]);
    // off: never reaches the network
    const before = A.asked["/tour-abc.mp4"];
    useFilm({ cacheRoot: fresh("off"), mode: "off", pin: pin(), base: A.base, local: null });
    const off = await fetch(at);
    assert.deepEqual([off.status, await off.json()], [404, { film: "off" }]);
    assert.equal(A.asked["/tour-abc.mp4"], before);
    // a film being made: the local file, under off too
    const local = join(tmp, "local.mp4");
    writeFileSync(local, FILM.subarray(0, 100));
    useFilm({ cacheRoot: fresh("local"), mode: "off", pin: null, local });
    const l = await fetch(at);
    assert.deepEqual([l.status, (await l.arrayBuffer()).byteLength], [200, 100]);
    // none pinned (a checkout without one): 404
    useFilm({ cacheRoot: fresh("none"), mode: "auto", pin: null, local: null });
    assert.equal((await fetch(at)).status, 404);
    assert.ok(!existsSync(join(tmp, "none-media")));
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
    await A.close();
  }
});
