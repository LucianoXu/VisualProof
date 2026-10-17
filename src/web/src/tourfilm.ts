// The tour film (GuideSpec decision 6, the owner's decisions of 2026-10-16, night, and 2026-10-17):
// one film of a review in thirteen scenes, light only, played in the sheet beside its chapters — a
// card each, one row, the one playing open with its words, Show me and More — and under it a bar of
// one segment per chapter, the one playing filling. Its captions are the recording's data
// (`/tips/tour.json`), drawn over it by the page, on unless the reader turned them off (CC); a
// WebVTT track of the same words is there for assistive technology, its own rendering hidden. It
// plays muted and inline, from the chapter asked for, and stops at its last frame; a card, a
// segment, Enter or Space on a card goes to its chapter and plays it. ⤢ makes it as large as the
// sheet, then the screen; Esc steps back. With the film's area focused: Space plays or pauses, ←
// and → go to the chapter before or after, c turns the captions on or off.
//
// The film is not in the package: the server fetches it on the first ask (server/film.ts), answering
// 503 while it comes and 404 where it cannot have it. The player asks for it while the sheet shows
// (FilmWaiter): meanwhile it says, quietly, that the film is loading, and shows each chapter's still,
// the open card its captions; when it comes, it plays from the chapter the reader is on, unless they
// paused it or motion is reduced. Where the server has none (404), the stills and captions stay. With
// reduced motion nothing plays by itself: a card shows its chapter's still, its captions listed, and
// the play button plays from there. In a snapshot there is no film: the cards are their words.

import { escapeHtml } from "./highlight.ts";
import type { Chapter } from "./tips.ts";

/** A caption: its words, from `start` to `end` in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** What the recording says of the film. */
export interface TourData {
  duration: number;
  width: number;
  height: number;
  chapters: { id: string; start: number; end: number }[];
  captions: Cue[];
}

/** The recording's data, as the page can use it: every chapter of the tour named, in its order,
 *  each within the film and after the one before (else null: the cards are their words); its
 *  captions in order, each within the film, its words text alone and short (the others dropped). */
export function tourData(raw: unknown, tour: readonly Chapter[]): TourData | null {
  const o = raw as { film?: { duration?: unknown; width?: unknown; height?: unknown }; chapters?: unknown; captions?: unknown } | null;
  const f = o?.film;
  if (!f || typeof f.duration !== "number" || !(f.duration > 0) || !Array.isArray(o.chapters)) return null;
  const duration = f.duration;
  const byId = new Map<string, { start: number; end: number }>();
  for (const c of o.chapters as { id?: unknown; start?: unknown; end?: unknown }[])
    if (c && typeof c.id === "string" && typeof c.start === "number" && typeof c.end === "number" && c.end > c.start) byId.set(c.id, { start: c.start, end: c.end });
  const chapters: TourData["chapters"] = [];
  let at = 0;
  for (const c of tour) {
    const t = byId.get(c.id);
    if (!t || t.start < at - 0.05 || t.end > duration + 0.05) return null;
    chapters.push({ id: c.id, ...t });
    at = t.end;
  }
  const captions = (Array.isArray(o.captions) ? (o.captions as Partial<Cue>[]) : [])
    .filter((c): c is Cue => !!c && typeof c.start === "number" && typeof c.end === "number" && c.end > c.start && c.start >= 0 && c.end <= duration + 0.05 && typeof c.text === "string" && !!c.text.trim() && c.text.length <= 200)
    .map((c) => ({ start: c.start, end: c.end, text: c.text.trim() }))
    .sort((a, b) => a.start - b.start);
  const w = typeof f.width === "number" && f.width > 0 ? f.width : 16;
  const h = typeof f.height === "number" && f.height > 0 ? f.height : 10;
  return { duration, width: w, height: h, chapters, captions };
}

/** The caption shown at `t`, if one is. */
export function cueAt(captions: readonly Cue[], t: number): Cue | null {
  let lo = 0, hi = captions.length - 1, found: Cue | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (captions[mid].start <= t) {
      found = captions[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found && t < found.end ? found : null;
}

/** A chapter's captions: those that begin in it. */
export function cuesOf(captions: readonly Cue[], ch: { start: number; end: number }): Cue[] {
  return captions.filter((c) => c.start >= ch.start - 0.01 && c.start < ch.end);
}

/** What the server says to an ask for the film: its status, and how long it asks to wait (Retry-After,
 *  in seconds). */
export interface FilmAnswer {
  status: number;
  retryAfter: number | null;
}

/** how often the film is asked for at first, and for how long; then as often as Retry-After says
 *  (10 s where it says nothing) */
export const POLL_FIRST_MS = 2000;
export const POLL_QUICK_FOR_MS = 30_000;
export const POLL_LATER_S = 10;

/** A clock the waiter runs on: the page's, or a test's. */
export interface WaitClock {
  now(): number;
  after(f: () => void, ms: number): unknown;
  cancel(t: unknown): void;
}

const PAGE_CLOCK: WaitClock = { now: () => Date.now(), after: (f, ms) => setTimeout(f, ms), cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

/** Asks for the film until the server has it (200, 206: ready) or says it never will (404:
 *  absent); while it is fetched (503, or no answer) it says so (loading) and asks again — every 2 s
 *  for the first 30 s, then as Retry-After says. `stop` pauses it (the sheet closed), `start`
 *  resumes it. */
export class FilmWaiter {
  private ask: () => Promise<FilmAnswer>;
  private told: (state: "loading" | "ready" | "absent") => void;
  private clock: WaitClock;
  private timer: unknown = null;
  /** when the asking began, for the first quick ones */
  private since: number | null = null;
  private running = false;
  private done = false;

  constructor(ask: () => Promise<FilmAnswer>, told: (state: "loading" | "ready" | "absent") => void, clock: WaitClock = PAGE_CLOCK) {
    this.ask = ask;
    this.told = told;
    this.clock = clock;
  }

  start(): void {
    if (this.running || this.done) return;
    this.running = true;
    this.since ??= this.clock.now();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    this.timer = null;
    let a: FilmAnswer;
    try {
      a = await this.ask();
    } catch {
      // no answer: as if it were still being fetched
      a = { status: 0, retryAfter: null };
    }
    if (!this.running) return;
    if (a.status === 200 || a.status === 206 || a.status === 404) {
      this.done = true;
      this.running = false;
      return this.told(a.status === 404 ? "absent" : "ready");
    }
    this.told("loading");
    const quick = this.clock.now() - this.since! < POLL_QUICK_FOR_MS;
    this.timer = this.clock.after(() => void this.tick(), quick ? POLL_FIRST_MS : Math.max(POLL_FIRST_MS, (a.retryAfter ?? POLL_LATER_S) * 1000));
  }
}

/** Ask the server for the film's first byte: whether it has it. */
async function askFilm(): Promise<FilmAnswer> {
  const r = await fetch(FILM, { headers: { range: "bytes=0-0" }, cache: "no-store" });
  void r.body?.cancel().catch(() => {});
  const after = Number(r.headers.get("retry-after"));
  return { status: r.status, retryAfter: Number.isFinite(after) && after > 0 ? after : null };
}

/** The film's own keys, while its area has the focus (web/src/surfaces.ts declares them). */
export const FILM_KEYS = [" ", "ArrowLeft", "ArrowRight", "c"] as const;

export interface FilmOptions {
  /** reduced motion: nothing plays by itself */
  still: boolean;
  /** a chapter's actions (Show me, More), as the sheet writes them */
  acts(c: Chapter): string;
  /** the sheet, which the film fills in its large mode */
  sheet: HTMLElement;
}

const FILM = "/tips/tour.mp4";
const POSTER = "/tips/tour.webp";
const VTT = "/tips/tour.en.vtt";
const stillOf = (id: string) => `/tips/tour-${id}.webp`;
/** whether the captions are off, kept per browser */
const CC_KEY = "visualproof:cc";

function ccOn(): boolean {
  try {
    return localStorage.getItem(CC_KEY) !== "off";
  } catch {
    return true;
  }
}

export class TourFilm {
  private root: HTMLElement;
  private tour: readonly Chapter[];
  private data: TourData | null;
  private opts: FilmOptions;
  /** the chapter open: playing, or shown */
  private at = 0;
  private video: HTMLVideoElement | null = null;
  /** whether the film is here: not yet known, being fetched by the server, there, or not (404) */
  private film: "unknown" | "loading" | "ok" | "absent" = "unknown";
  /** whether the reader wants it playing: not after they paused it, nor with reduced motion */
  private wantPlay: boolean;
  private waiter: FilmWaiter | null = null;
  private cc = ccOn();
  /** normal, as large as the sheet, the whole screen */
  private size: 0 | 1 | 2 = 0;
  private frame = 0;
  private onFullscreen = () => {
    if (this.size === 2 && !document.fullscreenElement) this.resize(1);
  };

  constructor(root: HTMLElement, tour: readonly Chapter[], data: TourData | null, opts: FilmOptions) {
    this.root = root;
    this.tour = tour;
    this.data = data;
    this.opts = opts;
    this.wantPlay = !opts.still;
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest<HTMLElement>("[data-chapter]");
      if (t.closest("[data-film-play]")) this.toggle();
      else if (t.closest("[data-film-cc]")) this.setCc(!this.cc);
      else if (t.closest("[data-film-large]")) this.resize(this.size === 0 ? 1 : this.size === 1 ? 2 : 1);
      else if (t.closest("[data-film-list]")) root.querySelector(".film")?.classList.toggle("list-hidden");
      else if (go && !t.closest("a, [data-tour-show]")) this.go(this.index(go.dataset.chapter!), true);
    });
    root.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>(".film-card[data-chapter]");
      if (card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        return this.go(this.index(card.dataset.chapter!), true);
      }
      // the film's keys, its area focused; a button keeps its own Space and Enter
      if (!this.data || t.closest("button, a, input") || !(FILM_KEYS as readonly string[]).includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === " ") this.toggle();
      else if (e.key === "c") this.setCc(!this.cc);
      else this.go(Math.max(0, Math.min(this.tour.length - 1, this.at + (e.key === "ArrowLeft" ? -1 : 1))), !!this.video && !this.video.paused);
    });
    document.addEventListener("fullscreenchange", this.onFullscreen);
    this.render();
  }

  private index(id: string): number {
    return Math.max(0, this.tour.findIndex((c) => c.id === id));
  }

  /** Whether it is larger than the sheet's own place: Esc steps it back (`back`). */
  get large(): boolean {
    return this.size > 0;
  }

  /** Esc: from the whole screen to the sheet, from the sheet to its place. True where it stepped. */
  back(): boolean {
    if (this.size === 0) return false;
    this.resize((this.size - 1) as 0 | 1);
    return true;
  }

  /** The words of an open card: its text, its captions where the film is not playing them (no film,
   *  reduced motion), its actions. */
  private body(c: Chapter, k: number): string {
    const ch = this.data?.chapters[k];
    const cues = ch && (this.film === "absent" || this.film === "loading" || this.opts.still) ? cuesOf(this.data!.captions, ch) : [];
    const list = cues.length ? `<ol class="film-cues" aria-label="Captions">${cues.map((q) => `<li>${escapeHtml(q.text)}</li>`).join("")}</ol>` : "";
    return `<div class="tip-text">${c.text}</div>${list}${this.opts.acts(c)}`;
  }

  private render(): void {
    const cards = this.tour
      .map((c, k) => {
        const on = k === this.at;
        return (
          `<li class="film-item${on ? " on" : ""}"><div class="film-card" data-chapter="${c.id}" role="button" tabindex="0" aria-expanded="${on}"${on ? ` aria-current="step"` : ""}>` +
          `<span class="film-n">${k + 1}</span><span class="film-title">${escapeHtml(c.title)}</span></div>` +
          `<div class="film-body"${on ? "" : " hidden"}>${on ? this.body(c, k) : ""}</div></li>`
        );
      })
      .join("");
    const name = `A review in ${this.tour.length === 13 ? "thirteen" : this.tour.length} scenes`;
    if (!this.data) {
      this.root.innerHTML = `<ol class="film-list words" aria-label="${name}">${cards}</ol>`;
      this.video = null;
      return;
    }
    const d = this.data;
    const segs = d.chapters
      .map((t, k) => `<button class="film-seg" data-chapter="${t.id}" style="flex-grow: ${(t.end - t.start).toFixed(2)}" aria-label="${k + 1}. ${escapeHtml(this.tour[k].title)}" title="${escapeHtml(this.tour[k].title)}"><span class="film-track"><span class="film-fill"></span></span></button>`)
      .join("");
    const fs = typeof document.documentElement.requestFullscreen === "function";
    this.root.innerHTML =
      `<div class="film"><div class="film-stage" tabindex="0" aria-label="${name}: Space plays or pauses, the arrows go to the chapter before or after, c turns the captions on or off">` +
      `<div class="film-frame" style="aspect-ratio: ${d.width} / ${d.height}">` +
      `<video class="film-video" muted playsinline preload="metadata" poster="${POSTER}" aria-label="${name}: the film">` +
      `<track kind="captions" src="${VTT}" srclang="en" label="English" default></video>` +
      `<img class="film-still" alt="" hidden>` +
      `<div class="film-wait" role="status" hidden>Loading the film…</div>` +
      `<div class="film-cc" aria-hidden="true" hidden></div>` +
      `<div class="film-controls"><button data-film-play aria-label="Play" title="Play">▶</button><span class="film-gap"></span>` +
      `<button data-film-cc aria-pressed="${this.cc}" title="Captions (c)">CC</button>` +
      `<button data-film-large aria-label="Larger" title="Larger">⤢</button></div></div>` +
      `<div class="film-bar" role="group" aria-label="Chapters">${segs}</div></div>` +
      `<div class="film-side"><button class="film-list-btn" data-film-list title="Show or hide the chapters">Chapters</button>` +
      `<ol class="film-list" aria-label="Chapters">${cards}</ol></div></div>`;
    if (!fs) this.root.querySelector<HTMLElement>("[data-film-large]")!.dataset.noFull = "";
    const v = this.root.querySelector<HTMLVideoElement>("video")!;
    this.video = v;
    // its own rendering of the captions hidden: the page draws them (they are there for assistive
    // technology)
    const hide = () => {
      for (const tt of Array.from(v.textTracks)) tt.mode = "hidden";
    };
    v.textTracks.addEventListener?.("addtrack", hide);
    v.addEventListener("loadedmetadata", hide);
    hide();
    // the film, once the server has it: from the chapter the reader is on, playing unless they
    // paused it or motion is reduced
    v.addEventListener("loadedmetadata", () => {
      if (this.film !== "unknown") return;
      this.film = "ok";
      v.currentTime = this.data!.chapters[this.at].start;
      if (this.wantPlay && !this.opts.still) {
        this.hideStill();
        void v.play().catch(() => {});
      } else if (this.opts.still) this.showStill(this.at);
      else this.hideStill();
      this.show();
    });
    // what was had cannot be read: its stills and captions
    v.addEventListener("error", () => {
      if (!v.getAttribute("src")) return;
      this.film = "absent";
      this.show();
    });
    this.waiter = new FilmWaiter(askFilm, (state) => {
      if (state === "ready") {
        this.film = "unknown";
        v.src = FILM;
        v.load();
      } else this.film = state;
      this.show();
    });
    v.addEventListener("play", () => this.sync());
    v.addEventListener("pause", () => this.sync());
    v.addEventListener("ended", () => this.sync());
    v.addEventListener("timeupdate", () => this.follow());
    v.addEventListener("seeked", () => this.follow());
  }

  /** Begin at a chapter (the first by default): it plays, unless motion is reduced — once the server
   *  has the film, which is asked for while the sheet shows. */
  start(id?: string): void {
    this.go(id ? this.index(id) : 0, !this.opts.still);
    this.waiter?.start();
  }

  /** Chapter `k` open, the film at its start: playing if `play`; else (reduced motion, no film)
   *  the chapter's still, and the play button plays from there. */
  go(k: number, play: boolean): void {
    this.open(k);
    const v = this.video;
    if (!v || !this.data) return;
    if (play && !this.opts.still) this.wantPlay = true;
    if (this.film === "ok") v.currentTime = this.data.chapters[k].start;
    if (this.opts.still || this.film !== "ok" || !play) {
      v.pause();
      if (this.opts.still || this.film !== "ok") this.showStill(k);
    } else {
      this.hideStill();
      void v.play().catch(() => {});
    }
    this.sync();
  }

  private showStill(k: number): void {
    const still = this.root.querySelector<HTMLImageElement>(".film-still");
    if (!still) return;
    still.src = stillOf(this.tour[k].id);
    still.hidden = false;
  }

  private hideStill(): void {
    const still = this.root.querySelector<HTMLImageElement>(".film-still");
    if (still) still.hidden = true;
  }

  /** The film found, coming, or not: the open card again (its captions listed or not), its still,
   *  the quiet word that it is loading. */
  private show(): void {
    this.open(this.at, true);
    if (this.film === "absent" || this.film === "loading" || this.opts.still) this.showStill(this.at);
    const wait = this.root.querySelector<HTMLElement>(".film-wait");
    if (wait) wait.hidden = this.film !== "loading";
    this.sync();
  }

  /** The play button: play or pause; at the end, again from the start; while the film comes, to
   *  play it when it does; without one here, nothing. */
  private toggle(): void {
    const v = this.video;
    if (!v || !this.data) return;
    if (this.film !== "ok") {
      if (this.film !== "absent" && !this.opts.still) this.wantPlay = !this.wantPlay;
      return this.sync();
    }
    if (v.ended || v.currentTime >= this.data.duration - 0.05) {
      v.currentTime = 0;
      this.open(0);
    }
    if (v.paused) {
      this.wantPlay = true;
      this.hideStill();
      void v.play().catch(() => {});
    } else {
      this.wantPlay = false;
      v.pause();
    }
  }

  private setCc(on: boolean): void {
    this.cc = on;
    try {
      if (on) localStorage.removeItem(CC_KEY);
      else localStorage.setItem(CC_KEY, "off");
    } catch {
      // not kept
    }
    this.root.querySelector("[data-film-cc]")?.setAttribute("aria-pressed", String(on));
    this.follow();
  }

  /** Normal, as large as the sheet, or the whole screen (the browser's fullscreen). */
  private resize(size: 0 | 1 | 2): void {
    const stage = this.root.querySelector<HTMLElement>(".film-stage");
    if (size === 2 && (!stage || typeof stage.requestFullscreen !== "function")) size = 1;
    if (size === 2) void stage!.requestFullscreen().catch(() => {});
    else if (this.size === 2 && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.size = size;
    this.opts.sheet.classList.toggle("film-large", size > 0);
    const b = this.root.querySelector<HTMLElement>("[data-film-large]");
    if (b) {
      const label = size === 0 ? "Larger" : size === 1 ? "The whole screen" : "Back to the sheet";
      b.textContent = size === 2 ? "⤡" : "⤢";
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    this.root.querySelector<HTMLElement>(".film-stage")?.focus();
  }

  /** The card of chapter `k` open, the others one row each. */
  private open(k: number, again = false): void {
    if (k === this.at && !again && this.root.querySelector(".film-item.on")) return;
    this.at = k;
    const items = this.root.querySelectorAll<HTMLElement>(".film-item");
    items.forEach((li, j) => {
      const on = j === k;
      li.classList.toggle("on", on);
      const card = li.querySelector<HTMLElement>(".film-card")!;
      card.setAttribute("aria-expanded", String(on));
      if (on) card.setAttribute("aria-current", "step");
      else card.removeAttribute("aria-current");
      const body = li.querySelector<HTMLElement>(".film-body")!;
      body.hidden = !on;
      body.innerHTML = on ? this.body(this.tour[j], j) : "";
    });
    // the open card in sight in the list, not the sheet scrolled for it
    const list = this.root.querySelector<HTMLElement>(".film-list");
    const li = items[k];
    if (list && li && list.scrollHeight > list.clientHeight) {
      const top = li.offsetTop - list.offsetTop, bottom = top + li.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
  }

  /** The card that follows the film, the bar filled as far as it played, the caption of now. */
  private follow(): void {
    const v = this.video;
    if (!v || !this.data) return;
    const t = v.currentTime;
    const cs = this.data.chapters;
    if (this.film === "ok") {
      let k = cs.findIndex((c) => t < c.end);
      if (k < 0) k = cs.length - 1;
      if (k !== this.at) this.open(k);
    }
    this.root.querySelectorAll<HTMLElement>(".film-fill").forEach((f, j) => {
      const c = cs[j];
      const at = this.film !== "ok" ? (j < this.at ? 1 : 0) : t >= c.end ? 1 : t <= c.start ? 0 : (t - c.start) / (c.end - c.start);
      f.style.transform = `scaleX(${at.toFixed(4)})`;
    });
    const box = this.root.querySelector<HTMLElement>(".film-cc");
    if (box) {
      // over the film, not over a still (no film, reduced motion before it is played)
      const still = this.root.querySelector<HTMLElement>(".film-still");
      const cue = this.cc && this.film === "ok" && (!still || still.hidden) ? cueAt(this.data.captions, t) : null;
      if (cue) {
        if (box.textContent !== cue.text) box.textContent = cue.text;
        box.hidden = false;
      } else box.hidden = true;
    }
  }

  /** The play button as the film is, and the bar and captions following it while it plays. */
  private sync(): void {
    const v = this.video;
    if (!v) return;
    const b = this.root.querySelector<HTMLElement>("[data-film-play]")!;
    const end = v.ended;
    // while it comes, the button says what the reader wants of it then
    const playing = this.film === "ok" ? !v.paused : this.wantPlay && !this.opts.still;
    b.textContent = end ? "↻" : playing ? "❚❚" : "▶";
    b.toggleAttribute("disabled", this.film === "absent");
    const label = this.film === "absent" ? "The film is not on this server" : end ? "Play again from the start" : playing ? "Pause" : "Play";
    b.setAttribute("aria-label", label);
    b.title = label;
    cancelAnimationFrame(this.frame);
    const tick = () => {
      this.follow();
      if (this.video && !this.video.paused) this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.waiter?.stop();
    this.video?.pause();
    if (this.size) this.resize(0);
    document.removeEventListener("fullscreenchange", this.onFullscreen);
  }
}
