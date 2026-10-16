// The tour film (GuideSpec decision 6, the owner's decision of 2026-10-16, night): one film of a
// review in eleven scenes, light only, played in the sheet beside its chapters — a card each, one row,
// the one playing open with its words, Show me and More — and under it a bar of one segment per
// chapter, the one playing filling. It plays muted and inline, from the chapter asked for, and
// stops at its last frame; a card, a segment, or Enter or Space on a card goes to its chapter and
// plays it. With reduced motion nothing plays by itself: a card shows its chapter's key frame, with
// a button that plays from there. Without the film (not recorded, a snapshot), the cards are their
// words alone. The recording names where each chapter starts and ends (`/tips/tour.chapters.json`).

import { escapeHtml } from "./highlight.ts";
import type { Chapter } from "./tips.ts";

/** Where each chapter is in the film, in seconds. */
export interface FilmTimes {
  duration: number;
  chapters: { id: string; start: number; end: number }[];
}

/** The recording's times, as the page can use them: every chapter of the tour named, in its order,
 *  each within the film and after the one before; null for anything else (the film is then not
 *  shown, and the cards are their words). */
export function filmTimes(raw: unknown, tour: readonly Chapter[]): FilmTimes | null {
  const o = raw as { duration?: unknown; chapters?: unknown } | null;
  if (!o || typeof o.duration !== "number" || !(o.duration > 0) || !Array.isArray(o.chapters)) return null;
  const byId = new Map<string, { start: number; end: number }>();
  for (const c of o.chapters as { id?: unknown; start?: unknown; end?: unknown }[])
    if (c && typeof c.id === "string" && typeof c.start === "number" && typeof c.end === "number" && c.end > c.start) byId.set(c.id, { start: c.start, end: c.end });
  const chapters: FilmTimes["chapters"] = [];
  let at = 0;
  for (const c of tour) {
    const t = byId.get(c.id);
    if (!t || t.start < at - 0.05 || t.end > o.duration + 0.05) return null;
    chapters.push({ id: c.id, ...t });
    at = t.end;
  }
  return { duration: o.duration, chapters };
}

export interface FilmOptions {
  /** reduced motion: nothing plays by itself */
  still: boolean;
  /** a chapter's actions (Show me, More), as the sheet writes them */
  acts(c: Chapter): string;
}

const FILM = "/tips/tour.light.mp4";
const POSTER = "/tips/tour.light.webp";
const frameOf = (id: string) => `/tips/tour-${id}.light.webp`;

export class TourFilm {
  private root: HTMLElement;
  private tour: readonly Chapter[];
  private times: FilmTimes | null;
  private opts: FilmOptions;
  /** the chapter open: playing, or shown */
  private at = 0;
  private video: HTMLVideoElement | null = null;
  private frame = 0;

  constructor(root: HTMLElement, tour: readonly Chapter[], times: FilmTimes | null, opts: FilmOptions) {
    this.root = root;
    this.tour = tour;
    this.times = times;
    this.opts = opts;
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const go = t.closest<HTMLElement>("[data-chapter]");
      if (t.closest("[data-film-play]")) this.toggle();
      else if (go && !t.closest("a, [data-tour-show]")) this.go(this.index(go.dataset.chapter!), true);
    });
    root.addEventListener("keydown", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".film-card[data-chapter]");
      if (!card || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      e.stopPropagation();
      this.go(this.index(card.dataset.chapter!), true);
    });
    this.render();
  }

  private index(id: string): number {
    return Math.max(0, this.tour.findIndex((c) => c.id === id));
  }

  /** Whether the film is there to play. */
  get playing(): boolean {
    return !!this.video;
  }

  private render(): void {
    const cards = this.tour
      .map((c, k) => {
        const on = k === this.at;
        return (
          `<li class="film-item${on ? " on" : ""}"><div class="film-card" data-chapter="${c.id}" role="button" tabindex="0" aria-expanded="${on}"${on ? ` aria-current="step"` : ""}>` +
          `<span class="film-n">${k + 1}</span><span class="film-title">${escapeHtml(c.title)}</span></div>` +
          `<div class="film-body"${on ? "" : " hidden"}><div class="tip-text">${c.text}</div>${this.opts.acts(c)}</div></li>`
        );
      })
      .join("");
    if (!this.times) {
      this.root.innerHTML = `<ol class="film-list words" aria-label="A review in eleven scenes">${cards}</ol>`;
      this.video = null;
      return;
    }
    const segs = this.times.chapters
      .map((t, k) => `<button class="film-seg" data-chapter="${t.id}" style="flex-grow: ${(t.end - t.start).toFixed(2)}" aria-label="${k + 1}. ${escapeHtml(this.tour[k].title)}" title="${escapeHtml(this.tour[k].title)}"><span class="film-track"><span class="film-fill"></span></span></button>`)
      .join("");
    this.root.innerHTML =
      `<div class="film"><div class="film-stage"><div class="film-frame">` +
      `<video class="film-video" muted playsinline preload="auto" poster="${POSTER}" src="${FILM}" aria-label="A review in eleven scenes: the film"></video>` +
      `<img class="film-still" alt="" hidden>` +
      `<button class="film-play" data-film-play aria-label="Play" title="Play">▶</button></div>` +
      `<div class="film-bar" role="group" aria-label="Chapters">${segs}</div></div>` +
      `<ol class="film-list" aria-label="Chapters">${cards}</ol></div>`;
    const v = this.root.querySelector<HTMLVideoElement>("video")!;
    this.video = v;
    // the film cannot be read: its chapters are their words
    v.addEventListener("error", () => {
      this.stop();
      this.times = null;
      this.render();
    }, { once: true });
    v.addEventListener("play", () => this.sync());
    v.addEventListener("pause", () => this.sync());
    v.addEventListener("ended", () => this.sync());
    v.addEventListener("timeupdate", () => this.follow());
    v.addEventListener("seeked", () => this.follow());
  }

  /** Begin at a chapter (the first by default): it plays, unless motion is reduced. */
  start(id?: string): void {
    this.go(id ? this.index(id) : 0, !this.opts.still);
  }

  /** Chapter `k` open, the film at its start: playing if `play`; with reduced motion never by
   *  itself — the chapter's key frame shows, and the play button plays from there. */
  go(k: number, play: boolean): void {
    this.open(k);
    const v = this.video;
    if (!v || !this.times) return;
    v.currentTime = this.times.chapters[k].start;
    const still = this.root.querySelector<HTMLImageElement>(".film-still")!;
    if (this.opts.still) {
      v.pause();
      still.src = frameOf(this.tour[k].id);
      still.hidden = false;
    } else {
      still.hidden = true;
      if (play) void v.play().catch(() => {});
    }
    this.sync();
  }

  /** The play button: play or pause; at the end, again from the start. */
  private toggle(): void {
    const v = this.video;
    if (!v || !this.times) return;
    if (v.ended || v.currentTime >= this.times.duration - 0.05) {
      v.currentTime = 0;
      this.open(0);
    }
    if (v.paused) {
      this.root.querySelector<HTMLElement>(".film-still")!.hidden = true;
      void v.play().catch(() => {});
    } else v.pause();
  }

  /** The card of chapter `k` open, the others one row each. */
  private open(k: number): void {
    if (k === this.at && this.root.querySelector(".film-item.on")) return;
    this.at = k;
    const items = this.root.querySelectorAll<HTMLElement>(".film-item");
    items.forEach((li, j) => {
      const on = j === k;
      li.classList.toggle("on", on);
      const card = li.querySelector<HTMLElement>(".film-card")!;
      card.setAttribute("aria-expanded", String(on));
      if (on) card.setAttribute("aria-current", "step");
      else card.removeAttribute("aria-current");
      li.querySelector<HTMLElement>(".film-body")!.hidden = !on;
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

  /** The card that follows the film, and the bar's segments filled as far as it played. */
  private follow(): void {
    const v = this.video;
    if (!v || !this.times) return;
    const t = v.currentTime;
    const cs = this.times.chapters;
    let k = cs.findIndex((c) => t < c.end);
    if (k < 0) k = cs.length - 1;
    if (k !== this.at) this.open(k);
    this.root.querySelectorAll<HTMLElement>(".film-fill").forEach((f, j) => {
      const c = cs[j];
      const fill = t >= c.end ? 1 : t <= c.start ? 0 : (t - c.start) / (c.end - c.start);
      f.style.transform = `scaleX(${fill.toFixed(4)})`;
    });
  }

  /** The play button as the film is, and the bar following it smoothly while it plays. */
  private sync(): void {
    const v = this.video;
    if (!v) return;
    const b = this.root.querySelector<HTMLElement>("[data-film-play]")!;
    const end = v.ended;
    b.textContent = end ? "↻" : v.paused ? "▶" : "❚❚";
    const label = end ? "Play again from the start" : v.paused ? "Play" : "Pause";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.classList.toggle("playing", !v.paused && !end);
    cancelAnimationFrame(this.frame);
    const tick = () => {
      this.follow();
      if (this.video && !this.video.paused) this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.video?.pause();
  }
}
