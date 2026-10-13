// What is trusted without review (ReviewSpec decision 3), chosen from the page: the trusted
// prefixes listed in a popover from the side panel's Trusted button, each with a way to stop
// trusting it, and a way to trust a cluster from its row in the outline. Each asks first, and says
// what it means and what it changes: how many declarations the prefix covers, and how many each
// target then counts for review.

import type { Cluster, ClusterMode } from "../../shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { covers, DEFAULT_TRUSTED, OUTSIDE, prefixLabel, under, validPrefix } from "../../shared/review.ts";
import type { ReviewData, ReviewRequest } from "../../shared/review.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";

/** A declaration as the review reads it (shared/review.ts, progressOf). */
export interface Member {
  name: string;
  module: string;
  ext: boolean;
  hash?: string;
}

/** The declarations of a set of the graph, as the review reads them. */
export function membersOf(g: Graph, set: Uint8Array): Member[] {
  const out: Member[] = [];
  for (let j = 0; j < set.length; j++) if (set[j]) out.push({ name: g.nodes[j].name, module: g.nodes[j].module, ext: g.isExt(j), hash: g.nodes[j].hash });
  return out;
}

/** A target's TCB, the target included, as the panel and the Targets list read it:
 *  statement and body edges. */
export function tcbMembers(g: Graph, roots: number[]): Member[] {
  return membersOf(g, g.reach(roots, SITE_STMT | SITE_BODY, "out"));
}

const EXT = "⟨external⟩";

/** The prefix a cluster of the outline stands for, or null where trust cannot name it. A cluster of
 *  the project is a namespace or a folder of files, and its key is the prefix either way; one
 *  outside the project only when clustered by file, since the outside world is trusted by module
 *  (clustered by namespace, its clusters are names, which say nothing of where they come from). */
export function clusterPrefix(c: Cluster, mode: ClusterMode): string | null {
  if (!c.ext) return validPrefix(c.key) ? c.key : null;
  // the outside world as a whole, in either clustering
  if (c.key === EXT) return OUTSIDE;
  if (mode !== "module" || !c.key.startsWith(EXT + ".")) return null;
  const p = c.key.slice(EXT.length + 1);
  return validPrefix(p) ? p : null;
}

/** A target as trusting reads it: how many members its review counts under a review `d`
 *  (shared/reviewqueue.ts: its review set, and the axioms beside it). */
export interface TargetCount {
  name: string;
  count(d: ReviewData): number;
}

/** What trusting a prefix (or no longer trusting it) changes: how many of the graph's declarations
 *  it covers, in the project and outside it, and each target's count for review before and after. */
export function effectOf(g: Graph, d: ReviewData, prefix: string, on: boolean, targets: TargetCount[]) {
  let own = 0, outside = 0;
  for (let j = 0; j < g.n; j++) {
    const v = g.nodes[j];
    if (covers(prefix, v.name, v.module, g.isExt(j))) g.isExt(j) ? outside++ : own++;
  }
  // the same review with the list changed (its opinions and targets shared, not copied)
  const next: ReviewData = { ...d, trusted: on ? [...d.trusted, prefix].sort() : d.trusted.filter((p) => p !== prefix) };
  const counts = targets.map((t) => ({ name: t.name, before: t.count(d), after: t.count(next) })).filter((t) => t.before !== t.after);
  return { own, outside, targets: counts };
}

export const SHIELD = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 3 3.6v3.9c0 3.1 2.1 5.5 5 6.7 2.9-1.2 5-3.6 5-6.7V3.6z"/></svg>`;

export interface TrustHooks {
  /** the review as it stands, and whether it can be changed here: `blocked` says why this reader's
   *  log takes nothing until it is fixed by hand, `note` why it is read-only here (a board of a past
   *  build), said where trust would be changed */
  review(): { data: ReviewData; blocked: string | null; readOnly: boolean; note?: string };
  graph(): Graph;
  /** the targets in the graph, each counting its review */
  targets(): TargetCount[];
  /** the reader's name; asks for it (a modal window) when there is none yet; null if they decline */
  ensureReviewer(): Promise<string | null>;
  /** record something; resolves to why it was refused, or null */
  submit(op: ReviewRequest): Promise<string | null>;
  /** show what a prefix covers on the canvas */
  show(prefix: string): void;
}

export class Trust {
  private list: HTMLElement;
  private pop: HTMLElement;
  private hooks: TrustHooks;
  /** what the open question is about */
  private asking: { prefix: string; on: boolean } | null = null;

  constructor(list: HTMLElement, pop: HTMLElement, hooks: TrustHooks) {
    this.list = list;
    this.pop = pop;
    this.hooks = hooks;
    list.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const off = t.closest<HTMLElement>("[data-untrust]");
      if (off) return this.ask(off.dataset.untrust!, false, off);
      const on = t.closest<HTMLElement>("[data-retrust]");
      if (on) return this.ask(on.dataset.retrust!, true, on);
      const show = t.closest<HTMLElement>("[data-show]");
      if (show) this.hooks.show(show.dataset.show!);
    });
    pop.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-tp-cancel]")) this.close();
      else if (t.closest("[data-tp-ok]")) void this.confirm();
    });
    // a click anywhere else is a no; one on another trust action asks about that instead
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (this.asking && !pop.contains(t) && !t.closest("[data-trust], [data-untrust], [data-retrust]") && !t.closest("#modal")) this.close();
    });
  }

  get open(): boolean {
    return this.asking !== null;
  }

  private writable(): boolean {
    const R = this.hooks.review();
    return !R.readOnly && !R.blocked;
  }

  /** The list in its popover: every trusted prefix, and the defaults no longer trusted, which
   *  can be trusted again from here (the outline names only what the graph holds). */
  render(): void {
    const d = this.hooks.review().data;
    const g = this.hooks.graph();
    const can = this.writable();
    const esc = escapeHtml;
    const count = (p: string) => {
      let n = 0;
      for (let j = 0; j < g.n; j++) if (covers(p, g.nodes[j].name, g.nodes[j].module, g.isExt(j))) n++;
      return n;
    };
    const chip = (p: string) => {
      const n = count(p);
      const own = !DEFAULT_TRUSTED.includes(p);
      return (
        `<span class="tl-chip${own ? " own" : ""}${p === OUTSIDE ? " world" : ""}">` +
        `<button class="tl-name" data-show="${esc(p)}" title="${esc(prefixLabel(p))}: ${n.toLocaleString()} declaration${n === 1 ? "" : "s"} here trusted without review — click to show ${own ? "them" : "it"}">${esc(prefixLabel(p))}</button>` +
        (can ? `<button class="tl-x" data-untrust="${esc(p)}" title="Stop trusting ${esc(prefixLabel(p))}…" aria-label="Stop trusting ${esc(prefixLabel(p))}">✕</button>` : "") +
        `</span>`
      );
    };
    // a default taken off stays in sight, so that it can be put back
    const gone = DEFAULT_TRUSTED.filter((p) => !d.trusted.includes(p));
    const off = (p: string) =>
      `<span class="tl-chip off"><button class="tl-name" data-show="${esc(p)}" title="${esc(p)}: one of the defaults, not trusted now — its declarations count for review">${esc(p)}</button>` +
      (can ? `<button class="tl-x" data-retrust="${esc(p)}" title="Trust ${esc(p)} again…" aria-label="Trust ${esc(p)} again">+</button>` : "") +
      `</span>`;
    this.list.innerHTML =
      `<div class="tl-h"><span class="tl-t">Trusted</span><span class="muted">not reviewed, not counted · the same on every board</span></div>` +
      `<div class="tl-chips">${d.trusted.map(chip).join("")}${gone.map(off).join("")}</div>` +
      (can && !d.trusted.includes(OUTSIDE)
        ? `<button class="tl-all" data-retrust="${OUTSIDE}" title="Trust every declaration outside the project, whatever its module…">Trust the whole outside world</button>`
        : "") +
      (can ? `<div class="tl-hint muted">To trust a namespace or a folder, use <span class="tl-shield">${SHIELD}</span> on its row in the side panel.</div>` : "") +
      (this.hooks.review().note ? `<div class="tl-hint muted">${esc(this.hooks.review().note!)}</div>` : "");
  }

  /** A cluster row's trust mark and action in the outline, as HTML: a shield where a trusted prefix
   *  covers the cluster, and on the row under the pointer a shield to trust it. */
  cell(c: Cluster, mode: ClusterMode): string {
    const p = clusterPrefix(c, mode);
    if (!p) return "";
    const d = this.hooks.review().data;
    const esc = escapeHtml;
    const by = d.trusted.filter((t) => under(p, t) || (t === OUTSIDE && c.ext));
    const can = this.writable();
    // a trusted one's shield is its mark and its action
    if (by.includes(p))
      return can
        ? `<button class="o-trust on" data-trust title="${esc(prefixLabel(p))} is trusted without review — click to stop trusting it">${SHIELD}</button>`
        : `<span class="o-trust on" title="${esc(prefixLabel(p))} is trusted without review">${SHIELD}</span>`;
    // a broader prefix covers it: taking that one off is done where it is
    if (by.length) return `<span class="o-trust on under" title="Trusted without review, under ${esc(prefixLabel(by[0]))}">${SHIELD}</span>`;
    return can ? `<button class="o-trust" data-trust title="Trust ${esc(prefixLabel(p))}: its declarations are not counted in reviews and need no opinion…" aria-label="Trust ${esc(prefixLabel(p))}">${SHIELD}</button>` : "";
  }

  /** Whether a cluster is trusted without review, as its panel says it (web/src/clusterpanel.ts):
   *  the prefix it stands for (null where trust cannot name it), whether that prefix is trusted
   *  itself, the broader trusted prefix that covers it otherwise, whether this page may change it,
   *  and why not where the review is read-only here. */
  state(c: Cluster, mode: ClusterMode): { prefix: string | null; on: boolean; by: string | null; can: boolean; note?: string } {
    const p = clusterPrefix(c, mode);
    const can = this.writable();
    const note = this.hooks.review().note;
    if (!p) return { prefix: null, on: false, by: null, can };
    const by = this.hooks.review().data.trusted.filter((t) => under(p, t) || (t === OUTSIDE && c.ext));
    return { prefix: p, on: by.includes(p), by: by.includes(p) ? null : by[0] ?? null, can, ...(note ? { note } : {}) };
  }

  /** A click on a cluster row's action: trust it, or stop trusting it. */
  clicked(c: Cluster, mode: ClusterMode, anchor: HTMLElement): void {
    const p = clusterPrefix(c, mode);
    if (p && this.writable()) this.ask(p, !this.hooks.review().data.trusted.includes(p), anchor);
  }

  /** Ask before trusting a prefix or no longer trusting it: what it means, and what it changes.
   *  Beside `anchor`, or (the canvas's menu) at a point of the window, kept inside it. */
  ask(prefix: string, on: boolean, anchor: HTMLElement | { x: number; y: number }): void {
    if (!this.writable()) return;
    this.asking = { prefix, on };
    const g = this.hooks.graph();
    const d = this.hooks.review().data;
    const esc = escapeHtml;
    const code = prefix === OUTSIDE ? "everything outside the project" : `<code>${esc(prefix)}</code>`;
    const e = effectOf(g, d, prefix, on, this.hooks.targets());
    const n = (x: number) => x.toLocaleString();
    const one = e.own + e.outside === 1;
    const which =
      prefix === OUTSIDE
        ? `${n(e.outside)} declaration${one ? "" : "s"} outside the project`
        : e.own && e.outside
        ? `${n(e.own)} declarations of the project whose name or module starts with ${code}, and the ${n(e.outside)} outside it whose module does,`
        : e.outside
          ? `${n(e.outside)} declaration${one ? "" : "s"} outside the project whose module starts with ${code}`
          : `${n(e.own)} declaration${one ? "" : "s"} whose name or module starts with ${code}`;
    const text = on
      ? `The ${which} ${one ? "is" : "are"} then trusted without review: not counted in any target's progress, and in need of no opinion. Opinions given on ${one ? "it" : "them"} are kept.`
      : `The ${which} then need${one ? "s" : ""} review again, unless another trusted prefix covers ${one ? "it" : "them"}: counted in each target's progress.`;
    const effect = e.targets.length
      ? `<div class="tp-effect"><div class="muted">Counted for review</div>` +
        e.targets.map((t) => `<div><span class="star">★</span>${esc(t.name.split(".").pop()!)} <b>${n(t.before)} → ${n(t.after)}</b></div>`).join("") +
        `</div>`
      : `<div class="tp-effect muted">No target's count changes.</div>`;
    const deflt = DEFAULT_TRUSTED.includes(prefix) && !on ? `<div class="tp-text">${code} is one of the defaults: what a review of a Lean project usually takes on trust.</div>` : "";
    this.pop.innerHTML =
      `<div class="tp-title">${on ? "Trust" : "Stop trusting"} ${code}?</div>` +
      `<div class="tp-text">${text}</div>${deflt}${effect}` +
      `<div class="tp-note muted">For everyone on this server, recorded under your name in the review; Activity says who did it. ${on ? "Undo it from Trusted in the side panel." : "It stays listed under Trusted, to be trusted again."}</div>` +
      `<div class="rv-err" hidden></div>` +
      `<div class="modal-actions"><button class="rv-btn" data-tp-cancel>Cancel</button>` +
      `<button class="rv-btn primary" data-tp-ok>${on ? "Trust" : "Stop trusting"}</button></div>`;
    this.pop.hidden = false;
    if (!(anchor instanceof HTMLElement)) {
      const w = this.pop.offsetWidth, hh = this.pop.offsetHeight;
      this.pop.style.left = `${Math.round(Math.max(12, Math.min(anchor.x, innerWidth - w - 12)))}px`;
      this.pop.style.top = `${Math.round(Math.max(70, Math.min(anchor.y, innerHeight - hh - 12)))}px`;
      return;
    }
    // beside the panel it was asked from — the side panel's right (or the Trusted popover's), the
    // cluster panel's left — level with what was clicked, inside the window
    const right = anchor.closest("#panel");
    const side = (anchor.closest("#trust-list:not([hidden])") ?? anchor.closest("#side") ?? right ?? anchor).getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    const h = this.pop.offsetHeight;
    this.pop.style.left = `${Math.round(right ? Math.max(12, side.left - 10 - this.pop.offsetWidth) : side.right + 10)}px`;
    this.pop.style.top = `${Math.round(Math.max(70, Math.min(innerHeight - h - 12, at.top - 12)))}px`;
  }

  /** The review changed: the list follows, and a question someone else has answered meanwhile
   *  goes away. */
  reviewChanged(): void {
    this.render();
    if (this.asking && this.hooks.review().data.trusted.includes(this.asking.prefix) === this.asking.on) this.close();
  }

  close(): void {
    this.asking = null;
    this.pop.hidden = true;
  }

  private async confirm(): Promise<void> {
    const q = this.asking;
    if (!q) return;
    const me = await this.hooks.ensureReviewer();
    if (!me || this.asking !== q) return;
    // one answer per question: a second click while the first is on its way does nothing
    const ok = this.pop.querySelector<HTMLButtonElement>("[data-tp-ok]");
    if (ok) ok.disabled = true;
    const why = await this.hooks.submit({ op: "trust", prefix: q.prefix, on: q.on });
    if (ok) ok.disabled = false;
    if (!why) return this.close();
    const err = this.pop.querySelector<HTMLElement>(".rv-err");
    if (err) {
      err.textContent = why;
      err.hidden = false;
    }
  }
}
