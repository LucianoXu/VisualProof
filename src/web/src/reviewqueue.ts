// The review wherever it has a focus (ReviewSpec, "What the page shows"; ViewSpec decisions 5 and
// 28): the order in which to read the declarations a target rests on, how far its review has come
// and why a declaration is in the TCB at all. What a target's review holds is its review set, the
// non-standard axioms it rests on included, whatever the board holds, and the strip, the panel and
// the Targets list count exactly that (decided 2026-10-08). The queue and the chain are pure
// functions of the graph (shared/reviewqueue.ts); the class below keeps them for the review on show
// and the last few graphs shown — the Time Machine goes back and forth between builds' graphs, and
// working them out again holds each step a tenth of a second — and draws them in the view's review
// strip and the panel.
//
// The strip is one line of progress, with nothing to press but the target's name (the owner's
// decision of 2026-10-12): people review by following names in the source window, so the page has
// no "Next to review" to walk them. What agents comment on is where people start (AgentSpec decision
// 6): the strip says how many declarations of the TCB an agent comments on, and the review list marks
// them. Their advice is never counted here: the progress and what the reader reviewed are people's.
//
// Key declarations come first in reading (ExportSpec decision 4): progress has two levels, key
// (approved of the key declarations that need review, the target among them, those trusted told
// apart as "+N trusted") and all (approved of the review). They are marked ◆ in the review list,
// which can show them alone, the trusted ones among them (the owner's decision of 2026-10-19: a key
// declaration is a member of the TCB, trusted or not); what each supports is shared/keys.ts.
//
// The list can keep to the reader's own review (the owner's decision of 2026-10-20): what they have
// not reviewed, where theirs is stale, or what they commented on — a reading preference of theirs,
// as the order is, by their own opinions alone (shared/review.ts, ownStatus). The strip's progress
// stays the team's: there is no personal progress beside it.

import { SITE_STMT } from "../../shared/graph.ts";
import { advice, adviceOf, fresh, ownStatus, statusOf } from "../../shared/review.ts";
import type { Author, Progress, ReviewData } from "../../shared/review.ts";
import { keyCounts, keyGraph } from "../../shared/keys.ts";
import type { KeyCounts, KeyGraph } from "../../shared/keys.ts";
import { keyMarks, trustedBy } from "../../shared/review.ts";
import { inTargets, nonStandardAxiom, offBoard, queueProgress, reviewQueue, settled, TCB_SITES, whyChain } from "../../shared/reviewqueue.ts";
import type { Queue, QueueAxiom } from "../../shared/reviewqueue.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { BOT } from "./agentmark.ts";
import { escapeHtml } from "./highlight.ts";
import { SHIELD } from "./trust.ts";

export interface ReviewFlowHooks {
  graph(): Graph;
  review(): ReviewData;
  /** the reader's name; null before they give one */
  reader(): string | null;
  /** the reader as their opinions are kept: by their personal link where they came by one, else
   *  their name; null without one (web/src/pagescheme.ts, readerAuthor) */
  me?(): Author | null;
}

/** What a target's review list keeps to, of the reader's own review (the owner's decision of
 *  2026-10-20): what they have not reviewed, where theirs is stale, what they commented on; null for
 *  all of it. */
export type OwnFilter = "none" | "stale" | "commented";
export const OWN_FILTERS: readonly OwnFilter[] = ["none", "stale", "commented"];
const OWN_WORDS: Record<OwnFilter, { label: string; title: string; note: string }> = {
  none: { label: "Not reviewed", title: "Only what you have given no opinion on (none, or one withdrawn)", note: "you have not reviewed" },
  stale: { label: "Stale", title: "Only where your opinion is on an earlier version: it changed since", note: "where your opinion is stale" },
  commented: { label: "Commented", title: "Only what your current opinion comments on", note: "you commented on" },
};

/** How a declaration reads in a chain: with its namespace's last part, which tells `Module.env`
 *  from `ModExpr.env`. */
function chainName(g: Graph, i: number): string {
  return g.nodes[i].name.split(".").slice(-2).join(".");
}

/** how many graphs' review queues are kept: the graph of now and a few builds' */
const KEEP_FLOWS = 4;

/** What is worked out for one graph and one set of targets and trusted modules: the review queues
 *  per target, their TCBs, and the key graphs per target with the marks each was worked out for. */
interface FlowState {
  g: Graph;
  review: string;
  orders: Map<number, Queue>;
  tcbs: Map<number, Uint8Array>;
  shared: Uint16Array | null;
  keyGraphs: Map<number, { marks: string; kg: KeyGraph }>;
}

export class ReviewFlow {
  private hooks: ReviewFlowHooks;
  /** per graph, the most recently used last */
  private states: FlowState[] = [];

  constructor(hooks: ReviewFlowHooks) {
    this.hooks = hooks;
  }

  isTarget(i: number): boolean {
    return Object.hasOwn(this.hooks.review().targets, this.hooks.graph().nodes[i].name);
  }

  /** `root`'s review (shared/reviewqueue.ts): its review set, in review order, and the axioms it
   *  rests on. It depends on the graph, the targets (what is shared) and the trusted
   *  prefixes (what needs review), not on the opinions: it is worked out again only when one of
   *  those changed. */
  queue(root: number): Queue {
    const st = this.state();
    let q = st.orders.get(root);
    if (!q) {
      const { g } = st;
      const d = this.hooks.review();
      const targets = Object.keys(d.targets).map((n) => g.byName.get(n)).filter((i): i is number => i !== undefined);
      st.shared ??= inTargets(g, targets);
      q = reviewQueue(g, d, root, st.shared);
      st.orders.set(root, q);
    }
    return q;
  }

  /** What is worked out for the graph on show, under the targets and trusted modules of now. */
  private state(): FlowState {
    const g = this.hooks.graph();
    const d = this.hooks.review();
    const review = Object.keys(d.targets).sort().join("\n") + "\n\n" + d.trusted.join("\n");
    const k = this.states.findIndex((s) => s.g === g);
    let st = k >= 0 ? this.states.splice(k, 1)[0] : null;
    if (!st || st.review !== review) st = { g, review, orders: new Map(), tcbs: new Map(), shared: null, keyGraphs: new Map() };
    this.states.push(st);
    if (this.states.length > KEEP_FLOWS) this.states.shift();
    return st;
  }

  /** `root`'s review set in review order. */
  order(root: number): number[] {
    return this.queue(root).order;
  }

  /** `root`'s key declarations, what each supports and the key graph (shared/keys.ts): worked out
   *  again when its queue is, or its marks change. */
  keys(root: number): KeyGraph {
    const q = this.queue(root);
    const st = this.state();
    const marks = keyMarks(this.hooks.review(), this.hooks.graph().nodes[root].name).join("\n");
    const was = st.keyGraphs.get(root);
    if (was && was.marks === marks) return was.kg;
    const kg = keyGraph(this.hooks.graph(), this.hooks.review(), root, q.order);
    st.keyGraphs.set(root, { marks, kg });
    return kg;
  }

  /** Whether `i` is a key declaration of `root` (the target itself is one). */
  isKey(root: number, i: number): boolean {
    return i === root || this.keys(root).keys.includes(i);
  }

  /** Whether `i` is a key declaration of `root` that needs no review: trusted. */
  isTrustedKey(root: number, i: number): boolean {
    return this.keys(root).trusted.includes(i);
  }

  /** Whether `i` is in what `root`'s review holds. */
  inReview(root: number, i: number): boolean {
    return this.queue(root).order.includes(i);
  }

  /** `root`'s TCB: statement and body reach. */
  private tcb(root: number): Uint8Array {
    const st = this.state();
    let t = st.tcbs.get(root);
    if (!t) st.tcbs.set(root, (t = st.g.reach([root], TCB_SITES, "out")));
    return t;
  }

  /** Whether `i` can be marked key for `root` (ExportSpec decision 1, the owner's decision of
   *  2026-10-19): a member of its TCB, trusted or not, in the project or outside it, or of its review
   *  set (a non-standard axiom reached through proofs alone) — never the target itself. */
  keyable(root: number, i: number): boolean {
    return i !== root && (this.tcb(root)[i] === 1 || this.inReview(root, i));
  }

  /** How far the review of `root`'s key declarations has come: approved of those that need review
   *  (K, the target among them), the trusted ones counted apart. */
  keyProgress(root: number): KeyCounts {
    return keyCounts(this.hooks.graph(), this.hooks.review(), this.keys(root));
  }

  /** How far `root`'s review has come: its review set, and the axioms beside it. */
  progress(root: number): Progress {
    return queueProgress(this.hooks.graph(), this.hooks.review(), this.queue(root));
  }

  /** Whether the reader is done with `i`: they gave an opinion on its present version, and a
   *  non-standard axiom is approved besides (shared/reviewqueue.ts, settled). */
  done(i: number): boolean {
    const g = this.hooks.graph();
    const v = g.nodes[i];
    return settled(this.hooks.review(), this.hooks.reader(), v.name, v.hash, nonStandardAxiom(g, i));
  }

  /** The same for an axiom the graph has no declaration for on the board. */
  private axiomDone(a: QueueAxiom): boolean {
    return settled(this.hooks.review(), this.hooks.reader(), a.name, undefined, true);
  }

  /** What is left of `root`'s review for this reader. */
  left(root: number): number {
    const q = this.queue(root);
    return q.order.filter((i) => !this.done(i)).length + offBoard(q).filter((a) => !this.axiomDone(a)).length;
  }

  /** What is left of `root`'s key declarations for this reader: those that need review. */
  keysLeft(root: number): number {
    const kg = this.keys(root);
    return kg.keys.filter((i) => !kg.trusted.includes(i) && !this.done(i)).length;
  }

  /** The declarations of `root`'s TCB that an agent comments on (advice on the present version), in
   *  review order. */
  agentComments(root: number): number[] {
    const g = this.hooks.graph();
    const d = this.hooks.review();
    return this.order(root).filter((i) => adviceOf(d, g.nodes[i].name, g.nodes[i].hash) === "comment");
  }

  /** The review strip, wherever the review's focus is `root` (ViewSpec decision 28): one line of
   *  progress, "Reviewing ★root · ◆ 2 / 9 · 3 / 160 approved · 1 commented", the target's name the
   *  way back to it, and nothing else to press (the owner's decision of 2026-10-12). What it counts
   *  is the focus's review set, whatever the board holds. */
  renderStrip(root: number): void {
    const g = this.hooks.graph();
    const d = this.hooks.review();
    const p = this.progress(root);
    const left = this.left(root);
    const title = document.querySelector<HTMLElement>("#lens-title")!;
    title.innerHTML =
      `<span class="lens-rv">Reviewing</span><button class="lens-target" data-go="${root}" title="${escapeHtml(g.nodes[root].name)}: back to the target, its progress and its TCB in review order">` +
      `<span class="star">★</span>${escapeHtml(g.short(root))}</button>`;
    title.title = "";
    const meta = document.querySelector<HTMLElement>("#lens-meta")!;
    const q = this.queue(root);
    const ext = q.order.filter((i) => g.isExt(i)).length;
    const off = offBoard(q).length;
    // two levels: the key declarations, then everything
    const k = this.keyProgress(root);
    const keysLeft = this.keysLeft(root);
    // what agents comment on, where people start: how many, as advice beside the counts, never in them
    const commented = this.agentComments(root);
    const who = [...new Set(commented.flatMap((i) => advice(d, g.nodes[i].name).filter((o) => o.verdict === "comment" && fresh(o, g.nodes[i].hash)).map((o) => o.by)))].sort();
    const adv = commented.length
      ? ` · <span class="lens-adv" title="${escapeHtml(`${who.join(", ")} (agent${who.length === 1 ? "" : "s"}) ${who.length === 1 ? "comments" : "comment"} on ${commented.length} declaration${commented.length === 1 ? "" : "s"} here — advice, not counted; the target's review list marks them`)}">${BOT}${escapeHtml(who.length === 1 ? `${who[0]} comments on` : "Agents comment on")} ${commented.length}</span>`
      : "";
    meta.innerHTML =
      `· <span class="lens-key" title="${escapeHtml(`Key declarations: ${k.approved} of the ${k.total} that need review approved (the target among them) · ${keysLeft} not yet reviewed by you${k.trusted ? ` · ${k.trusted} more trusted, needing no review` : ""}`)}"><span class="key-mark">◆</span>${k.approved} / ${k.total}${k.trusted ? ` <span class="muted">+${k.trusted} trusted</span>` : ""}</span>` +
      ` · ${p.approved} / ${p.total} approved` + (p.commented ? ` · ${p.commented} commented` : "") + (p.stale ? ` · ${p.stale} stale` : "") + adv +
      // the reader's own part done: an opinion on every one, every non-standard axiom approved
      (left ? "" : ` · <span class="lens-done">All reviewed ✓</span>`);
    meta.title =
      `To review · ${(q.order.length - ext).toLocaleString()} declarations` + (ext ? ` + ${ext.toLocaleString()} external` : "") +
      (off ? ` + ${off} axiom${off === 1 ? "" : "s"} outside the graph` : "") +
      (left ? ` · ${left} not yet reviewed by you` : " · you have given an opinion on every one, and every non-standard axiom in it is approved");
  }

  /** The panel's list of a target's review in review order: numbered, the review status of each,
   *  the ones the reader reviewed faded. A non-standard axiom says so, and
   *  where it is used; one the graph has no declaration for on the board is listed first, and goes
   *  to the target, whose panel approves it. `keyOnly` (◆ Key): the key declarations alone, in their
   *  order (shared/keys.ts, keySet) — the trusted ones first, marked trusted and unnumbered, since
   *  they are not in the review order; then the rest, numbered as in the review order. `own`: only
   *  those where the reader's own review stands so (OwnFilter), the trusted key declarations, which
   *  need none, left out; the filter's switch heads the list where the reader has a name. */
  listHtml(root: number, keyOnly = false, own: OwnFilter | null = null): string {
    const g = this.hooks.graph();
    const d = this.hooks.review();
    const q = this.queue(root);
    const kg = this.keys(root);
    const keys = new Set(kg.keys);
    const me = this.hooks.me?.() ?? null;
    // where the reader's own review of each stands, by name (an axiom off the board has no version)
    const ownOf = (name: string, hash: string | undefined) => (me ? ownStatus(d, name, me, hash) : "none");
    const position0 = new Set(q.order);
    const allOff = keyOnly ? [] : offBoard(q);
    const allOrder = keyOnly ? kg.keys : q.order;
    // the counts each filter would show, of what needs review in the list
    const counts = new Map<string, number>();
    for (const a of allOff) counts.set(ownOf(a.name, undefined), (counts.get(ownOf(a.name, undefined)) ?? 0) + 1);
    for (const i of allOrder) if (position0.has(i)) counts.set(ownOf(g.nodes[i].name, g.nodes[i].hash), (counts.get(ownOf(g.nodes[i].name, g.nodes[i].hash)) ?? 0) + 1);
    const filter = me ? own : null;
    const keep = (name: string, hash: string | undefined) => filter === null || ownOf(name, hash) === filter;
    const off = allOff.filter((a) => keep(a.name, undefined));
    // the positions are the review order's, also where only the key declarations are listed
    const order = filter === null ? allOrder : allOrder.filter((i) => position0.has(i) && keep(g.nodes[i].name, g.nodes[i].hash));
    const position = new Map(q.order.map((i, k) => [i, k]));
    const offN = offBoard(q).length;
    const where = (a: QueueAxiom) => (a.via.length ? ` · used in ${a.via.map((j) => chainName(g, j)).join(", ")}` : "");
    const axiomOf = new Map(q.axioms.filter((a) => a.node !== null).map((a) => [a.node!, a]));
    const offRows = off.map(
      (a, k) =>
        `<button class="row q-row rv-${statusOf(d, a.name, undefined)}${this.axiomDone(a) ? " q-mine" : ""}" data-walk="${root}" title="${escapeHtml(`${a.name}: a non-standard axiom the target rests on, which the graph has no declaration for${where(a)} — approve it or comment on it in the target's panel`)}">` +
        `<span class="q-n">${k + 1}</span>axiom ${escapeHtml(a.name)}<span class="muted">${escapeHtml(where(a))}</span></button>`,
    );
    const kp = this.keyProgress(root);
    const shown = order.length + off.length;
    const note =
      filter !== null
        ? shown
          ? `${shown} of ${allOrder.filter((i) => position0.has(i)).length + allOff.length} ${OWN_WORDS[filter].note}, in review order.`
          : `Nothing here ${OWN_WORDS[filter].note}.`
        : keyOnly
          ? `The key declarations, ◆, ${kp.trusted ? `${kp.trusted} trusted first, needing no review, then the rest ` : ""}in review order: ${kp.approved} of ${kp.total} approved, ${this.keysLeft(root)} not yet reviewed by you.`
          : `Non-standard axioms first, then bottom-up: what a declaration uses comes before it; ` +
            `${this.left(root)} of ${q.order.length + offN} not yet reviewed by you.`;
    // the filter by one's own review: All, then each with how many it keeps; a reader without a name
    // has no review of their own to keep to
    const switcher = me
      ? `<div class="q-own" role="group" aria-label="Only by your own review"><span class="muted">Yours:</span><span class="seg mini">` +
        `<button data-q-own="" class="${filter === null ? "on" : ""}" aria-pressed="${filter === null}" title="Everything in the list">All</button>` +
        OWN_FILTERS.map(
          (f) =>
            `<button data-q-own="${f}" class="${filter === f ? "on" : ""}" aria-pressed="${filter === f}" title="${OWN_WORDS[f].title}">${OWN_WORDS[f].label} <span class="q-own-n">${counts.get(f) ?? 0}</span></button>`,
        ).join("") +
        `</span></div>`
      : "";
    return (
      switcher +
      `<div class="q-note muted">${note}</div>` +
      `<div class="q-list">` +
      offRows.join("") +
      order
        .map((i) => {
          const v = g.nodes[i];
          const at = position.get(i);
          // a trusted key declaration: read with the others, in need of no review, so no status and
          // no place in the review order (ExportSpec decision 1)
          if (at === undefined) {
            const by = trustedBy(d, v.name, v.module, g.isExt(i));
            return (
              `<button class="row q-row q-key rv-trusted" data-walk="${i}" title="${escapeHtml(`Go to ${v.name} — a key declaration, trusted without review${by.length ? `, under ${by.join(" and ")}` : ""}: it is read with the others and needs no opinion`)}">` +
              `<span class="q-n q-trusted" aria-label="trusted">${SHIELD}</span>${i === root ? `<span class="star">★</span>` : `<span class="key-mark">◆</span>`}${escapeHtml(v.name)}<span class="muted"> · trusted</span></button>`
            );
          }
          const mine = this.done(i);
          const cls = `row q-row rv-${statusOf(d, v.name, v.hash)}${mine ? " q-mine" : ""}`;
          const what = mine ? " — you reviewed it" : "";
          // an agent's advice, beside the row's status: a mark, never the status
          const adv = adviceOf(d, v.name, v.hash);
          const mark = adv ? `<span class="q-adv q-adv-${adv}" title="${adv === "approve" ? "An agent suggests approving it" : "An agent comments on it"}">${BOT}</span>` : "";
          const ax = axiomOf.get(i);
          const key = i !== root && keys.has(i);
          return (
            `<button class="${cls}${key ? " q-key" : ""}" data-walk="${i}" title="Go to ${escapeHtml(v.name)}${what}${key ? " — a key declaration" : ""}${ax ? escapeHtml(` — a non-standard axiom${where(ax)}`) : ""}">` +
            `<span class="q-n">${offN + at + 1}</span>${i === root ? `<span class="star">★</span>` : key ? `<span class="key-mark">◆</span>` : ""}${ax ? "axiom " : ""}${escapeHtml(v.name)}${ax ? `<span class="muted">${escapeHtml(where(ax))}</span>` : ""}${mark}</button>`
          );
        })
        .join("") +
      `</div>`
    );
  }

  /** Why `i` is in `root`'s review, for the panel: the shortest chain of references from the
   *  target to it, each step a link — or, for a non-standard axiom reached through a proof, where
   *  it is used; and where it comes in the review order. "" when it is not in it. */
  whyHtml(root: number, i: number): string {
    const g = this.hooks.graph();
    const path = i === root ? null : whyChain(g, root, i);
    const q = this.queue(root);
    const at = q.order.indexOf(i);
    const ax = q.axioms.find((a) => a.node === i);
    // the target as everywhere else, the others with enough of their namespace to tell them apart
    const label = (j: number) => (j === root ? g.short(j) : chainName(g, j));
    const step = (j: number) =>
      `<button class="why-step${j === i ? " here" : ""}" data-go="${j}" title="${escapeHtml(g.nodes[j].name)}">` +
      (j === root ? `<span class="star">★</span>` : "") + `${escapeHtml(label(j))}</button>`;
    const pos = at >= 0 ? `<span class="muted"> · ${at + 1} of ${q.order.length} in review order</span>` : "";
    if (!path) {
      if (!ax) return "";
      return (
        `<div class="why"><div class="why-h">Why in the review of ${step(root)}${pos}</div>` +
        `<div class="why-chain"><span class="muted">A non-standard axiom it rests on (through a proof): it needs review whatever is trusted${ax.via.length ? "; used in " : "."}</span>` +
        ax.via.map((j) => step(j)).join(" ") +
        `</div></div>`
      );
    }
    // where the reference sits in the declaration that makes it
    const how = (u: number, v: number) => {
      let s = 0;
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) if (g.outDst[e] === v) s |= g.outSite[e];
      return s & SITE_STMT ? "in the statement of" : "in the body of";
    };
    const arrow = (u: number, v: number) => `<span class="why-arrow" title="${escapeHtml(`${label(v)} is used ${how(u, v)} ${label(u)}`)}">→</span>`;
    return (
      `<div class="why"><div class="why-h">Why in the TCB of ${step(root)}${pos}</div>` +
      `<div class="why-chain">${path.map((j, k) => (k ? arrow(path[k - 1], j) : "") + step(j)).join("")}</div></div>`
    );
  }
}
