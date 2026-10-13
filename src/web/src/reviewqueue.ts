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
// (approved of the key declarations, the target among them) and all (approved of the review). They
// are marked ◆ in the review list, which can show them alone; what each supports is shared/keys.ts.

import { SITE_STMT } from "../../shared/graph.ts";
import { advice, adviceOf, fresh, statusOf } from "../../shared/review.ts";
import type { Progress, ReviewData } from "../../shared/review.ts";
import { keyGraph, statusCounts } from "../../shared/keys.ts";
import type { KeyGraph, StatusCounts } from "../../shared/keys.ts";
import { keyMarks } from "../../shared/review.ts";
import { inTargets, nonStandardAxiom, offBoard, queueProgress, reviewQueue, settled, whyChain } from "../../shared/reviewqueue.ts";
import type { Queue, QueueAxiom } from "../../shared/reviewqueue.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { BOT } from "./agentmark.ts";
import { escapeHtml } from "./highlight.ts";

export interface ReviewFlowHooks {
  graph(): Graph;
  review(): ReviewData;
  /** the reader's name; null before they give one */
  reader(): string | null;
}

/** How a declaration reads in a chain: with its namespace's last part, which tells `Module.env`
 *  from `ModExpr.env`. */
function chainName(g: Graph, i: number): string {
  return g.nodes[i].name.split(".").slice(-2).join(".");
}

/** how many graphs' review queues are kept: the graph of now and a few builds' */
const KEEP_FLOWS = 4;

/** What is worked out for one graph and one set of targets and trusted modules: the review queues
 *  per target, and the key graphs per target with the marks each was worked out for. */
interface FlowState {
  g: Graph;
  review: string;
  orders: Map<number, Queue>;
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
    if (!st || st.review !== review) st = { g, review, orders: new Map(), shared: null, keyGraphs: new Map() };
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

  /** Whether `i` is in what `root`'s review holds: what can be marked key for it. */
  inReview(root: number, i: number): boolean {
    return this.queue(root).order.includes(i);
  }

  /** How far the review of `root`'s key declarations has come: approved of K, the target among
   *  them. */
  keyProgress(root: number): StatusCounts {
    return statusCounts(this.hooks.graph(), this.hooks.review(), this.keys(root).keys);
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

  /** What is left of `root`'s key declarations for this reader. */
  keysLeft(root: number): number {
    return this.keys(root).keys.filter((i) => !this.done(i)).length;
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
      `· <span class="lens-key" title="${escapeHtml(`Key declarations: ${k.approved} of ${k.total} approved (the target among them) · ${keysLeft} not yet reviewed by you`)}"><span class="key-mark">◆</span>${k.approved} / ${k.total}</span>` +
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
   *  to the target, whose panel approves it. */
  listHtml(root: number, keyOnly = false): string {
    const g = this.hooks.graph();
    const d = this.hooks.review();
    const q = this.queue(root);
    const keys = new Set(this.keys(root).keys);
    const off = keyOnly ? [] : offBoard(q);
    // the positions are the review order's, also where only the key declarations are listed
    const order = keyOnly ? q.order.filter((i) => keys.has(i)) : q.order;
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
    const note = keyOnly
      ? `The key declarations, ◆, in review order: ${kp.approved} of ${kp.total} approved, ${this.keysLeft(root)} not yet reviewed by you.`
      : `Non-standard axioms first, then bottom-up: what a declaration uses comes before it; ` +
        `${this.left(root)} of ${q.order.length + offN} not yet reviewed by you.`;
    return (
      `<div class="q-note muted">${note}</div>` +
      `<div class="q-list">` +
      offRows.join("") +
      order
        .map((i, k) => {
          const v = g.nodes[i];
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
            `<span class="q-n">${offN + position.get(i)! + 1}</span>${i === root ? `<span class="star">★</span>` : key ? `<span class="key-mark">◆</span>` : ""}${ax ? "axiom " : ""}${escapeHtml(v.name)}${ax ? `<span class="muted">${escapeHtml(where(ax))}</span>` : ""}${mark}</button>`
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
