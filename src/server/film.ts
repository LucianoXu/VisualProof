// The tips' tour film (UpdateSpec decision 14, the owner's of 2026-10-17): 3½–4 minutes at
// 2560×1600, too large for the package and for git, so it is an asset of the repository's GitHub
// prerelease `tour-1`, and the package pins it (assets/tips/tour.json: its file, sha256 and size).
// The server fetches it the first time a page asks for it (GET /tips/tour.mp4), one download for
// every request, checks its size and sha256, keeps it in the caches' root, and serves it from there
// with byte ranges: no reader's browser reaches GitHub. Under `--updates off` it is never fetched,
// and the page shows the tour's stills and captions alone.
//
//   <cache root>/media/                    the user's alone (0700), as versions/ is
//   <cache root>/media/<sha256>.mp4        the film, checked, moved into place once whole
//   <cache root>/media/.<sha256>.tmp-<pid> a download under way (that process's)
//
// VISUALPROOF_TOUR_FILM names a local file served in its place (a film being made: the checkout
// that makes it); VISUALPROOF_MEDIA_BASE another address to fetch it from, honoured only where it is
// a loopback address (the tests' asset server).

import { createHash } from "node:crypto";
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { WEBFONTS } from "./pipeline.ts";
import { alive, private_ } from "./updates.ts";
import type { UpdateMode } from "./updates.ts";

/** where the film is published: the repository's prerelease `tour-1` */
export const FILM_BASE = "https://github.com/LucianoXu/VisualProof/releases/download/tour-1/";

/** the hosts a fetch of the film may be redirected to: GitHub's own, which keeps a release's
 *  assets on its asset hosts (UpdateSpec decision 14) */
export const FILM_HOSTS: ReadonlySet<string> = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"]);

/** The film as the package pins it. */
export interface FilmPin {
  file: string;
  sha256: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** What the server knows of the film (GET /api/updates `film`, full readers alone):
 *  `cached` — checked and kept, served from the cache; `fetching` — the one download under way;
 *  `unavailable` — it could not be had (why, and when it is tried again); `local` — a file named by
 *  VISUALPROOF_TOUR_FILM; `off` — `--updates off`: never fetched; `none` — no film pinned (a
 *  checkout without one), or not asked for yet (`waiting`: fetched on the first play). */
export interface FilmStatus {
  state: "cached" | "fetching" | "unavailable" | "local" | "off" | "none" | "waiting";
  sha256?: string;
  size?: number;
  why?: string;
  /** when an unavailable film is tried again */
  retry?: string;
}

/** The film the package pins: `film` of assets/tips/tour.json, or null. */
export function filmPin(file = join(dirname(WEBFONTS), "tips", "tour.json")): FilmPin | null {
  try {
    const f = (JSON.parse(readFileSync(file, "utf8")) as { film?: Partial<FilmPin> } | null)?.film;
    if (!f || typeof f.file !== "string" || !/^[\w.-]+\.mp4$/.test(f.file) || typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || (f.size as number) <= 0) return null;
    return f as FilmPin;
  } catch {
    return null;
  }
}

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//;

/** The address the film is fetched from: VISUALPROOF_MEDIA_BASE where it is a loopback address (a
 *  test's asset server), else the release's. */
export function filmBase(env: NodeJS.ProcessEnv = process.env): string {
  const b = env.VISUALPROOF_MEDIA_BASE;
  return b && LOOPBACK.test(b.endsWith("/") ? b : `${b}/`) ? (b.endsWith("/") ? b : `${b}/`) : FILM_BASE;
}

/** a download that got nothing for this long is given up */
const IDLE_MS = 60_000;
/** nor may a download take longer than this, whatever comes */
const WHOLE_MS = 30 * 60_000;
/** tried again after this, where it could not be had */
export const RETRY_MS = 3600_000;
/** and after this where what came was not the film (another size, another hash) */
export const MISMATCH_RETRY_MS = 24 * 3600_000;

export interface FilmOptions {
  /** the root of the caches: the film is kept in its `media/` */
  cacheRoot: string;
  /** --updates: under off, never fetched */
  mode: UpdateMode;
  /** the pinned film; null where the package pins none */
  pin: FilmPin | null;
  /** where it is fetched from (a folder's address, ending in /) */
  base?: string;
  /** a local file served in its place (VISUALPROOF_TOUR_FILM) */
  local?: string | null;
  log?: (line: string) => void;
  now?: () => number;
  /** fetch, for a test's own */
  fetch?: typeof fetch;
}

/** Whether `url` is one a fetch of the film may go to: https on GitHub's hosts, or, where the film
 *  is fetched from a loopback address (a test's), that address's host. */
function allowed(url: URL, base: URL): boolean {
  if (LOOPBACK.test(base.href)) return url.host === base.host;
  return url.protocol === "https:" && FILM_HOSTS.has(url.hostname);
}

/** The tour film, fetched once on demand, checked, kept and served (UpdateSpec decision 14). */
export class Film {
  private o: FilmOptions;
  private now: () => number;
  private base: string;
  readonly dir: string;
  /** the one download (or the one check of what is kept) under way, which every request shares */
  private work: Promise<void> | null = null;
  private failure: { why: string; until: number } | null = null;
  /** checked in this process: what is kept is hashed once, then trusted */
  private checked = false;

  constructor(o: FilmOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.base = o.base ?? filmBase();
    this.dir = join(o.cacheRoot, "media");
  }

  /** the film kept, where it is */
  private get kept(): string | null {
    return this.o.pin ? join(this.dir, `${this.o.pin.sha256}.mp4`) : null;
  }

  status(): FilmStatus {
    const pin = this.o.pin;
    if (this.o.local) return { state: "local" };
    if (!pin) return { state: "none" };
    const of = { sha256: pin.sha256, size: pin.size };
    if (this.o.mode === "off") return { state: "off", ...of };
    if (this.work) return { state: "fetching", ...of };
    if (this.checked) return { state: "cached", ...of };
    if (this.failure && this.now() < this.failure.until) return { state: "unavailable", ...of, why: this.failure.why, retry: new Date(this.failure.until).toISOString() };
    return { state: "waiting", ...of };
  }

  /** The film's file, checked; null where there is none to serve now — `--updates off`, none
   *  pinned, being fetched, or unavailable for a while. The first ask starts the one download (or
   *  the one check of a film kept before), in the background: it outlives the request that started
   *  it, and later asks share it. */
  async file(): Promise<string | null> {
    if (this.o.local) return existsSync(this.o.local) ? this.o.local : null;
    const pin = this.o.pin;
    const kept = this.kept;
    if (!pin || !kept || this.o.mode === "off") return null;
    if (this.checked && existsSync(kept)) return kept;
    this.checked = false;
    if (this.work) return null;
    if (this.failure && this.now() < this.failure.until) return null;
    this.work = this.get(pin, kept).finally(() => (this.work = null));
    return null;
  }

  /** The download or check under way, done (for a test, and for whoever waits on it). */
  async settled(): Promise<void> {
    await this.work;
  }

  private fail(why: string, ms: number): void {
    this.failure = { why, until: this.now() + ms };
    this.o.log?.(`tour film: ${why}; tried again ${ms >= MISMATCH_RETRY_MS ? "in a day" : "in an hour"}`);
  }

  /** What is kept, checked once; else the film fetched, checked and moved into place. */
  private async get(pin: FilmPin, kept: string): Promise<void> {
    const bad = this.ensure();
    if (bad) return this.fail(bad, RETRY_MS);
    if (existsSync(kept)) {
      if (statSync(kept).size === pin.size && (await sha256Of(kept)) === pin.sha256) {
        this.checked = true;
        return;
      }
      rmSync(kept, { force: true });
    }
    this.sweep();
    const tmp = join(this.dir, `.${pin.sha256}.tmp-${process.pid}`);
    try {
      const why = await this.download(pin, tmp);
      if (why) {
        rmSync(tmp, { force: true });
        return this.fail(why.text, why.mismatch ? MISMATCH_RETRY_MS : RETRY_MS);
      }
      renameSync(tmp, kept);
      this.checked = true;
      this.failure = null;
      this.o.log?.(`tour film: ${pin.file} fetched and checked (${(pin.size / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      rmSync(tmp, { force: true });
      this.fail(`it could not be kept: ${e instanceof Error ? e.message : String(e)}`, RETRY_MS);
    }
  }

  /** The folder made where it is not, the user's alone (0700); why it cannot be used, else null. */
  private ensure(): string | null {
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        chmodSync(this.dir, 0o700);
      }
    } catch (e) {
      return `${this.dir} cannot be made: ${(e as Error).message}`;
    }
    return private_(this.dir) ? null : `${this.dir} is not this user's alone (another owns it, or others may write it)`;
  }

  /** Remove the downloads left by servers that died midway. */
  private sweep(): void {
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const n of names) {
      const m = /^\.[0-9a-f]{64}\.tmp-(\d+)$/.exec(n);
      if (m && !alive(Number(m[1]))) rmSync(join(this.dir, n), { force: true });
    }
  }

  /** Fetch the pinned file into `tmp`: redirects followed only to where the film may be (allowed),
   *  at most five; no more bytes than the pin's size; given up after a minute with nothing or half
   *  an hour in all; the size and sha256 checked. Why not, else null. */
  private async download(pin: FilmPin, tmp: string): Promise<{ text: string; mismatch?: true } | null> {
    const get = this.o.fetch ?? fetch;
    const base = new URL(this.base);
    let url = new URL(pin.file, base);
    const stop = new AbortController();
    const whole = setTimeout(() => stop.abort(new Error("it took more than half an hour")), WHOLE_MS);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const quiet = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => stop.abort(new Error("nothing came for a minute")), IDLE_MS);
    };
    try {
      quiet();
      let res: Response | null = null;
      for (let hops = 0; ; hops++) {
        if (!allowed(url, base)) return { text: `it was sent to ${url.origin}, which is not where the film is kept: not followed` };
        res = await get(url, { redirect: "manual", signal: stop.signal, headers: { "user-agent": "VisualProof (the tips' tour film)" } });
        if (res.status < 300 || res.status >= 400) break;
        const to = res.headers.get("location");
        await res.body?.cancel();
        if (!to || hops >= 5) return { text: `${hops >= 5 ? "too many redirects" : "a redirect without an address"} at ${url.origin}` };
        url = new URL(to, url);
      }
      if (!res.ok || !res.body) return { text: `${url.origin} answered ${res.status}` };
      const length = Number(res.headers.get("content-length"));
      if (Number.isFinite(length) && length > 0 && length !== pin.size) {
        await res.body.cancel();
        return { text: `it is ${length} bytes, not the ${pin.size} pinned`, mismatch: true };
      }
      const hash = createHash("sha256");
      let got = 0;
      const out = createWriteStream(tmp, { mode: 0o600 });
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          quiet();
          got += value.byteLength;
          // never more than the pin's size on the disk
          if (got > pin.size) {
            await reader.cancel();
            return { text: `more than the ${pin.size} bytes pinned came`, mismatch: true };
          }
          hash.update(value);
          if (!out.write(value)) await new Promise<void>((ok) => out.once("drain", () => ok()));
        }
      } finally {
        await new Promise<void>((ok) => out.end(ok));
      }
      if (got !== pin.size) return { text: `${got} bytes came, not the ${pin.size} pinned`, mismatch: true };
      const sum = hash.digest("hex");
      if (sum !== pin.sha256) return { text: `its sha256 is ${sum.slice(0, 12)}…, not the ${pin.sha256.slice(0, 12)}… pinned`, mismatch: true };
      return null;
    } catch (e) {
      const why = stop.signal.aborted && stop.signal.reason instanceof Error ? stop.signal.reason.message : e instanceof Error ? e.message : String(e);
      return { text: `it could not be fetched: ${why}` };
    } finally {
      clearTimeout(whole);
      if (idle) clearTimeout(idle);
    }
  }
}

function sha256Of(file: string): Promise<string> {
  return new Promise((ok, no) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (b) => h.update(b))
      .on("end", () => ok(h.digest("hex")))
      .on("error", no);
  });
}

// ---------------------------------------------------------------- the server's one film

let film: Film | null = null;

/** Set the server's film up (server/main.ts, as it serves): its cache, its mode, the package's pin,
 *  VISUALPROOF_TOUR_FILM. */
export function useFilm(o: Omit<FilmOptions, "pin" | "local"> & { pin?: FilmPin | null; local?: string | null }): Film {
  film = new Film({ ...o, pin: o.pin === undefined ? filmPin() : o.pin, local: o.local === undefined ? process.env.VISUALPROOF_TOUR_FILM || null : o.local });
  return film;
}

/** The film's file to serve, or null (filmStatus says why): what GET /tips/tour.mp4 serves. */
export function filmFile(): Promise<string | null> {
  return film ? film.file() : Promise.resolve(null);
}

export function filmStatus(): FilmStatus {
  return film ? film.status() : { state: "none" };
}

/** GET /tips/tour.mp4, whole (UpdateSpec decision 14): the film with byte ranges (`send`, the media
 *  route's), or 503 with Retry-After while it is fetched (the first ask starts it), or 404 where
 *  there is none to serve (`--updates off`, none pinned, unavailable for a while): the page shows
 *  the stills and captions then. */
export async function serveFilm(req: IncomingMessage, res: ServerResponse, send: (req: IncomingMessage, res: ServerResponse, file: string) => void): Promise<void> {
  const file = await filmFile();
  if (file) return send(req, res, file);
  const st = filmStatus();
  const head = { "content-type": "application/json", "cache-control": "no-store" };
  if (st.state === "fetching" || st.state === "waiting") {
    res.writeHead(503, { ...head, "retry-after": "10" });
    return void res.end(JSON.stringify({ film: st.state === "waiting" ? "fetching" : st.state }));
  }
  res.writeHead(404, head);
  res.end(JSON.stringify({ film: st.state, ...(st.why ? { why: st.why } : {}) }));
}
