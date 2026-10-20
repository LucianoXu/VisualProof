// The legend, at the bottom left of the canvas (CanvasSpec, "Colour schemes", decided 2026-10-08):
// folded, a small chip naming the colour scheme in force; open, the switch between the schemes —
// Kind, Status, and Mine (the owner's decision of 2026-10-20): Status's review states from the
// reader's own opinions alone —, what each colour means with how many of the board's declarations
// have it — by status or by one's own, the review's progress on this board — and the key of the
// edges, the key graph's among them while the tool is the Keys step of Rests on (ViewSpec decision
// 20). The scheme is a reading preference, the reader's own (web/src/store.ts), as the edges and the
// theme are.

import { escapeHtml } from "./highlight.ts";
import { keepFocus } from "./keepfocus.ts";
import { KINDS } from "./canvas.ts";
import { MINE_STATES, mineHint, ST_APPROVED, ST_COMMENTED, ST_STALE, ST_TRUSTED, STATUS_HINT, STATUS_LABEL, STATUSES, SCHEMES_SHOWN } from "./status.ts";
import type { Scheme } from "./status.ts";

export interface LegendHooks {
  /** the scheme in force, and choosing the other one */
  scheme(): Scheme;
  setScheme(s: Scheme): void;
  /** what is on the board, per state of the Status scheme and per kind (GraphCanvas.counts) */
  counts(): { status: number[]; kinds: number[] };
  /** whether the legend is open, and opening or folding it; kept in this browser */
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** the tool is Keys: what is lit is joined by the key graph's edges, dashed */
  keyEdges(): boolean;
  /** whose opinions Mine shows where they are not the reader's: the followed reader's name */
  mineWhose(): string | null;
  /** whether Mine has nobody's to show: a reader without a name */
  mineNone(): boolean;
}

const NAME: Record<Scheme, string> = { kind: "Kind", status: "Status", mine: "Mine" };
const WHAT: Record<Scheme, string> = { kind: "kind", status: "status", mine: "your own review: your opinions alone" };

export class Legend {
  private el: HTMLElement;
  private hooks: LegendHooks;

  constructor(el: HTMLElement, hooks: LegendHooks) {
    this.el = el;
    this.hooks = hooks;
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const s = t.closest<HTMLElement>("[data-scheme]");
      if (s) return this.hooks.setScheme(s.dataset.scheme as Scheme);
      if (t.closest("[data-lg-open]")) return this.toggle(true);
      if (t.closest("[data-lg-close]")) this.toggle(false);
    });
  }

  private toggle(open: boolean): void {
    this.hooks.setOpen(open);
    this.render();
  }

  /** Drawn again, the focus kept on what had it (a scheme chosen from the keyboard), or, opened or
   *  folded, on the scheme in use, or the chip again. */
  render(): void {
    keepFocus(this.el, () => this.draw(), this.hooks.isOpen() ? "[data-scheme].on" : "[data-lg-open]");
  }

  private draw(): void {
    const scheme = this.hooks.scheme();
    const { status, kinds } = this.hooks.counts();
    const n = (x: number) => x.toLocaleString();
    // by status or by one's own review: the states' colours, and the review's progress
    const byReview = scheme !== "kind";
    // Mine shows the reader's own opinions, or the followed reader's; a reader without a name has none
    const whose = scheme === "mine" ? this.hooks.mineWhose() : null;
    const none = scheme === "mine" && this.hooks.mineNone();
    // what needs review on this board (all but what is trusted), and how much of it is approved
    const counted = status.reduce((a, b) => a + b, 0) - status[ST_TRUSTED];
    const share = (k: number) => (counted ? (100 * status[k]) / counted : 0);
    const progress = `${n(status[ST_APPROVED])} of ${n(counted)} approved${scheme === "mine" ? ` by ${whose ?? "you"}` : ""}`;
    const name = whose ? `${whose}'s` : NAME[scheme];
    const tip = `Colour by kind, by status or by your own review (c). ${byReview && !none ? `On this board: ${progress}. ` : ""}Click for the legend.`;
    if (!this.hooks.isOpen()) {
      // folded: the scheme by name, its swatch a pie of the board's review when by status or one's own
      const pie =
        byReview && !none
          ? `background: conic-gradient(var(--status-approved) 0 ${share(ST_APPROVED)}%, var(--status-commented) 0 ${share(ST_APPROVED) + share(ST_COMMENTED)}%, ` +
            `var(--status-stale) 0 ${share(ST_APPROVED) + share(ST_COMMENTED) + share(ST_STALE)}%, var(--status-unreviewed) 0)`
          : "";
      this.el.innerHTML =
        `<button class="lg-chip" data-lg-open aria-expanded="false" title="${escapeHtml(tip)}">` +
        `<span class="lg-swatch lg-${scheme}"${pie ? ` style="${pie}"` : ""}></span>${escapeHtml(name)}` +
        (byReview && !none ? `<span class="lg-chip-n">${n(status[ST_APPROVED])}/${n(counted)}</span>` : "") +
        `<span class="lg-chev" aria-hidden="true">▾</span></button>`;
      return;
    }
    const row = (dot: string, name: string, count: number, title: string) =>
      `<div class="lg-row${count ? "" : " none"}" title="${escapeHtml(title)}">${dot}<span class="lg-name">${escapeHtml(name)}</span><span class="lg-n">${n(count)}</span></div>`;
    const rows =
      scheme === "status"
        ? STATUSES.map((st, k) => row(`<span class="dot ss s-${st}"></span>`, STATUS_LABEL[st], status[k], STATUS_HINT[st])).join("")
        : scheme === "mine"
          ? MINE_STATES.map((k) => row(`<span class="dot ss s-${STATUSES[k]}"></span>`, STATUS_LABEL[STATUSES[k]], status[k], mineHint(k, whose))).join("")
          : [...KINDS, "external"].map((k, j) => row(`<span class="dot k-${k}"></span>`, k === "external" ? "outside the project" : k, kinds[j], k === "axiom" ? "axiom: its point ringed, in every scheme" : k)).join("");
    // by status or by one's own, the review's progress on this board: what is approved, commented and
    // stale, of what needs review
    const summary =
      byReview && !none
        ? `<div class="lg-prog" title="Of the ${n(counted)} declarations on this board that need review (all but what is trusted)">` +
          `<div class="rv-bar"><i class="ok" style="width:${share(ST_APPROVED).toFixed(1)}%"></i><i class="commented" style="width:${share(ST_COMMENTED).toFixed(1)}%"></i><i class="stale" style="width:${share(ST_STALE).toFixed(1)}%"></i></div>` +
          `<span>${progress}</span></div>`
        : "";
    // whose Mine is: the reader's own, said; the followed reader's; or nobody's yet
    const mineLine =
      scheme !== "mine"
        ? ""
        : none
          ? `<div class="lg-mine lg-none">You have no name yet, so no opinions of your own to show: give one (your name, top right) and the board is coloured by what you said.</div>`
          : `<div class="lg-mine">${whose ? `${escapeHtml(whose)}'s own opinions, as you follow ${escapeHtml(whose)}` : "Your own opinions alone: what others said is not here"}</div>`;
    this.el.innerHTML =
      `<div class="lg-card" role="group" aria-label="Legend">` +
      `<div class="lg-head"><nav class="seg mini" aria-label="Colour by">` +
      SCHEMES_SHOWN.map((s) => `<button data-scheme="${s}" class="${s === scheme ? "on" : ""}" aria-pressed="${s === scheme}" title="Colour the points by ${WHAT[s]} (c)">${NAME[s]}</button>`).join("") +
      `</nav><button class="lg-x" data-lg-close aria-expanded="true" title="Fold the legend" aria-label="Fold the legend">▾</button></div>` +
      mineLine +
      summary +
      `<div class="lg-rows">${rows}</div>` +
      // by status or one's own, what says an axiom where its colour does not: its ring (by kind, its
      // row's dot)
      (byReview ? `<div class="lg-edge lg-ring" title="An axiom's point is ringed, in every scheme"><span class="dot axiom"></span>ringed: an axiom</div>` : "") +
      `<div class="lg-edge" title="An edge runs from the declaration that uses to the one it uses">uses<span class="edge-key"></span>used</div>` +
      (this.hooks.keyEdges()
        ? `<div class="lg-edge lg-keys" title="Under Keys, what is lit is joined by the key graph: an edge from A to B says A rests on B through declarations that are not key">` +
          `<span class="lg-keys-l">rests on<span class="edge-key dashed"></span>key</span><span class="lg-keys-n">the key graph: through what is not key</span></div>`
        : "") +
      `</div>`;
  }
}
