// The tips the film does not show, as the sheet lists them (GuideSpec decisions 5–8): one row each in
// their groups, its title and its first line; one open at a time, with its words, Show me and More,
// and on a phone the clip of its gestures (light only, as the film is).

import { escapeHtml } from "./highlight.ts";
import { GROUPS, TIPS } from "./tips.ts";
import type { Tip } from "./tips.ts";
import { newer } from "./tipstate.ts";
import { reducedMotion } from "./theme.ts";

export interface TipsContext {
  /** a read-only reader, or a snapshot: no tip that needs changing the review (decision 10) */
  readOnly: boolean;
  phone: boolean;
  /** the clips the server has (`/tips/index.json`: the film, `tour`, and the phone's gestures);
   *  none in a snapshot */
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

export { reducedMotion };

/** A tip's or a chapter's actions: Show me where it can be done here, More into the manual. */
export function actsHtml(showMe: string | undefined, manual: string | undefined, ctx: Pick<TipsContext, "canShow" | "manual">, attr: string): string {
  const acts = [
    showMe && ctx.canShow(showMe) ? `<button class="link" ${attr}>Show me</button>` : "",
    manual ? `<a class="link" href="${ctx.manual}#${manual}" target="_blank" rel="noopener noreferrer">More</a>` : "",
  ].filter(Boolean);
  return acts.length ? `<div class="tip-acts">${acts.join("")}</div>` : "";
}

/** One row: its title and its first line; open, its words, its clip (the phone's gestures, on a
 *  phone, light only) and its actions. */
function rowHtml(t: Tip, ctx: TipsContext, open: boolean): string {
  const isNew = ctx.newSince !== null && newer(t.since, ctx.newSince);
  const clip = open && ctx.phone && t.clip && ctx.clips.has(t.clip)
    ? `<div class="ref-clip"><video muted loop playsinline preload="auto" poster="/tips/${t.clip}.light.webp" src="/tips/${t.clip}.light.mp4"${reducedMotion() ? " controls" : " autoplay"} aria-label="${escapeHtml(t.title)}: a short clip"></video></div>`
    : "";
  return (
    `<div class="ref${open ? " open" : ""}" data-tip="${t.id}">` +
    `<button class="ref-head" data-ref-toggle="${t.id}" aria-expanded="${open}"><span class="ref-title">${escapeHtml(t.title)}${isNew ? ` <span class="tip-new">New</span>` : ""}</span>` +
    `<span class="ref-line">${escapeHtml(plain(t.text))}</span></button>` +
    (open ? `<div class="ref-body"><div class="tip-text">${t.text}</div>${clip}${actsHtml(t.showMe, t.manual, ctx, `data-tip-show="${t.id}"`)}</div>` : "") +
    `</div>`
  );
}

/** The tips the film does not show, that match the filter, one row each in their groups, `open` the
 *  one open; a line when none matches. */
export function refsHtml(ctx: TipsContext, filter: string, open: string | null): string {
  const mine = tipsFor(ctx).filter((t) => matches(t, filter));
  if (!mine.length) return `<div class="tips-none help-note">No tip says that. The <b>Keys</b> tab lists every key.</div>`;
  return GROUPS.map((g) => {
    const of = mine.filter((t) => t.group === g.id);
    return of.length ? `<section class="tips-group"><div class="help-h">${g.title}</div><div class="refs">${of.map((t) => rowHtml(t, ctx, t.id === open)).join("")}</div></section>` : "";
  }).join("");
}
