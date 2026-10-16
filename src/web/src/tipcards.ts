// The tips as the sheet shows them (GuideSpec decisions 5–8): cards in their groups, each its words,
// its clip and its Show me and More; and the player of the clips — the page's theme, muted, looping,
// playing while it is in view, its key frame alone with reduced motion until asked (decision 6).

import { escapeHtml } from "./highlight.ts";
import { GROUPS, TIPS } from "./tips.ts";
import type { Tip } from "./tips.ts";
import { newer } from "./tipstate.ts";

export interface TipsContext {
  /** a read-only reader, or a snapshot: no tip that needs changing the review (decision 10) */
  readOnly: boolean;
  phone: boolean;
  /** the clips the server has (`/tips/index.json`); none in a snapshot */
  clips: ReadonlySet<string>;
  /** tips newer than this release are New (decision 11) */
  newSince: string | null;
  /** the manual's address, whose headings a tip's More links to */
  manual: string;
  /** whether a tip is about something this page has at all */
  applies: (t: Tip) => boolean;
  /** whether a Show me can be done here; false in a snapshot */
  canShow: (action: string) => boolean;
}

/** The tips for this reader on this screen. */
export function tipsFor(ctx: Pick<TipsContext, "readOnly" | "phone" | "applies">, tips: readonly Tip[] = TIPS): Tip[] {
  return tips.filter((t) => !(ctx.readOnly && t.who === "full") && (t.where === "both" || t.where === (ctx.phone ? "phone" : "desktop")) && ctx.applies(t));
}

/** A tip's words as text: what the filter reads. */
export function plain(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Whether a tip's words have every word of the filter. */
export function matches(t: Tip, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${t.title} ${plain(t.text)}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

export const theme = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One card. */
export function cardHtml(t: Tip, ctx: TipsContext): string {
  const isNew = ctx.newSince !== null && newer(t.since, ctx.newSince);
  const clip = t.clip && ctx.clips.has(t.clip) ? t.clip : null;
  // on a larger screen the clip in a card is small: a click on it, or Enter or Space, opens it large
  // in the sheet (bigHtml); a phone's is the sheet's width already
  const big = ctx.phone ? "" : ` data-tip-big="${t.id}" tabindex="0" role="button" aria-label="${escapeHtml(t.title)}: the clip, larger" title="Larger"`;
  const media = clip
    ? `<div class="tip-media"${big}><video class="tip-clip" data-clip="${clip}" muted loop playsinline preload="none" poster="/tips/${clip}.${theme()}.webp" aria-hidden="true"></video>` +
      `<button class="tip-play" data-tip-play aria-label="Play" title="Play" hidden${ctx.phone ? "" : ` tabindex="-1"`}>▶</button></div>`
    : "";
  const acts = [
    t.showMe && ctx.canShow(t.showMe) ? `<button class="link" data-tip-show="${t.id}">Show me</button>` : "",
    t.manual ? `<a class="link" href="${ctx.manual}#${t.manual}" target="_blank" rel="noopener noreferrer">More</a>` : "",
  ].filter(Boolean);
  return (
    `<article class="tip-card${clip ? "" : " words"}" data-tip="${t.id}">${media}` +
    `<div class="tip-body"><div class="tip-title">${escapeHtml(t.title)}${isNew ? ` <span class="tip-new">New</span>` : ""}</div>` +
    `<div class="tip-text">${t.text}</div>${acts.length ? `<div class="tip-acts">${acts.join("")}</div>` : ""}</div></article>`
  );
}

/** A tip's clip opened large in the sheet (GuideSpec decision 6): the clip at up to its recorded size,
 *  its title and words under it, Show me and More; ✕ (or Esc, or a press beside it) goes back. With
 *  reduced motion it is the clip's key frame, with a button that plays it. */
export function bigHtml(t: Tip, ctx: TipsContext): string {
  const clip = t.clip!;
  const acts = [
    t.showMe && ctx.canShow(t.showMe) ? `<button class="link" data-tip-show="${t.id}">Show me</button>` : "",
    t.manual ? `<a class="link" href="${ctx.manual}#${t.manual}" target="_blank" rel="noopener noreferrer">More</a>` : "",
  ].filter(Boolean);
  return (
    `<div class="tip-big-box" role="group" aria-label="${escapeHtml(t.title)}">` +
    `<div class="tip-big-head"><div class="tip-title">${escapeHtml(t.title)}</div><button class="icon" data-tip-big-close title="Back to the tips (Esc)" aria-label="Back to the tips">✕</button></div>` +
    `<div class="tip-big-media"><video class="tip-big-clip" muted loop playsinline preload="auto" poster="/tips/${clip}.${theme()}.webp" src="/tips/${clip}.${theme()}.mp4" aria-label="${escapeHtml(t.title)}: a short clip"></video>` +
    `<button class="tip-play" data-tip-big-play aria-label="Play" title="Play" hidden>▶</button></div>` +
    `<div class="tip-text">${t.text}</div>${acts.length ? `<div class="tip-acts">${acts.join("")}</div>` : ""}</div>`
  );
}

/** The cards of the tips that match the filter, in their groups; a line when none does. */
export function cardsHtml(ctx: TipsContext, filter: string): string {
  const mine = tipsFor(ctx).filter((t) => matches(t, filter));
  if (!mine.length) return `<div class="tips-none help-note">No tip says that. The <b>Keys</b> tab lists every key.</div>`;
  return GROUPS.map((g) => {
    const of = mine.filter((t) => t.group === g.id);
    return of.length ? `<section class="tips-group"><div class="help-h">${g.title}</div><div class="tips-cards">${of.map((t) => cardHtml(t, ctx)).join("")}</div></section>` : "";
  }).join("");
}

/** Plays the clips of the cards in `root` while they are in view of `scroller`. */
export class ClipPlayer {
  private seen: IntersectionObserver | null = null;
  private root: HTMLElement;
  private scroller: HTMLElement;

  constructor(root: HTMLElement, scroller: HTMLElement) {
    this.root = root;
    this.scroller = scroller;
    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip-play]");
      // a card's clip that opens large: the sheet opens it (web/src/guide.ts)
      if (!b || b.closest("[data-tip-big]")) return;
      const v = b.parentElement?.querySelector<HTMLVideoElement>("video");
      if (!v) return;
      if (v.paused) this.play(v);
      else v.pause();
      b.hidden = !v.paused;
    });
  }

  /** Watch the clips there now (after the cards were drawn). */
  start(): void {
    this.stop();
    const vids = [...this.root.querySelectorAll<HTMLVideoElement>("video.tip-clip")];
    if (!vids.length) return;
    const still = reducedMotion();
    for (const v of vids) {
      // a clip that cannot be read leaves its words alone
      v.addEventListener("error", () => v.closest(".tip-media")?.remove(), { once: true });
      if (still) v.parentElement!.querySelector<HTMLElement>("[data-tip-play]")!.hidden = false;
    }
    if (still || typeof IntersectionObserver !== "function") return;
    this.seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) this.play(v);
          else v.pause();
        }
      },
      { root: this.scroller, threshold: 0.6 },
    );
    for (const v of vids) this.seen.observe(v);
  }

  private play(v: HTMLVideoElement): void {
    const src = `/tips/${v.dataset.clip}.${theme()}.mp4`;
    if (!v.src.endsWith(src)) v.src = src;
    void v.play().catch(() => {});
  }

  stop(): void {
    this.seen?.disconnect();
    this.seen = null;
    for (const v of this.root.querySelectorAll<HTMLVideoElement>("video.tip-clip")) v.pause();
  }
}
