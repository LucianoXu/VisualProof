// The detail panel: everything about the selected declaration, and what each mode makes of it.
// What a reader needs each time is always shown — what it is and where, its statement, its doc and
// its review; the rest folds away, each part as the reader leaves it (decided 2026-10-08, the page
// made simpler; kept in this browser, as the side panel's sections are).

import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { ALL_SITES, shortName } from "../../shared/viewgraph.ts";
import type { FileStatus } from "../../shared/build.ts";
import { escapeHtml, highlightLean, renderDoc } from "./highlight.ts";
import { markOf } from "../../shared/review.ts";
import type { ReviewData } from "../../shared/review.ts";
import type { ReviewBox } from "./reviewbox.ts";
import { editorAnchor } from "./editor.ts";
import { sectionHead } from "./targetlist.ts";

export interface PanelHooks {
  /** go to a declaration: a click there with the tool (web/src/selection.ts), and the view flies
   *  there (CanvasSpec, "Navigation") */
  go(i: number): void;
  /** a row of a target's review list: walking its TCB, the declaration alone (main.ts) */
  walk(i: number): void;
  /** ring a declaration on the canvas without moving there; null takes the ring away */
  preview(i: number | null): void;
  /** the review, for the status of each row */
  reviewData(): ReviewData;
  /** open the source window on a declaration */
  openSource(i: number): void;
  unpin(i: number): void;
  isPinned(i: number): boolean;
  close(): void;
  /** the build status of the file a node comes from, when the page is live */
  fileOf(i: number): FileStatus | undefined;
  /** who else is looking at it (CollabSpec "In the panel"), as HTML; "" when nobody */
  alsoHere(i: number): string;
  /** where the review has a focus, why the declaration is in its TCB, as HTML; "" otherwise
   *  (web/src/reviewqueue.ts) */
  why(i: number): string;
  /** a target's TCB in review order, as HTML — its key declarations alone with `keyOnly`; null
   *  when the declaration is not a target */
  queue(i: number, keyOnly?: boolean): string | null;
  /** whether a target's TCB is listed in review order, by kind, or its key declarations alone, and
   *  changing it */
  listOrder(): "review" | "kind" | "key";
  setListOrder(order: "review" | "kind" | "key"): void;
  /** the link that opens it in the reader's editor, at its compiled place; null when there is none */
  editorLink(i: number): string | null;
  /** whether a part of the panel is folded, and folding or opening it (web/src/store.ts) */
  shut(section: string): boolean;
  toggle(section: string): void;
  /** on a past graph (the Time Machine, a view kept at a past build): what the panel says of the
   *  build it shows, of its source then, and of the declaration against now, as HTML; null on the
   *  graph of now. The panel then shows what the snapshot holds — its statement, its doc — and its
   *  Source opens the text of then (HistorySpec decision 23); the reader's editor, which opens the
   *  file as it is now, is not offered */
  then?(i: number): string | null;
  /** the places in papers it is linked to, and Link to a paper…, as HTML (AttachmentSpec decision 7;
   *  web/src/paperlinks.ts, which answers its clicks); "" for none */
  links?(i: number): string;
}

/** The parts of the panel that fold, by the key the reader's browser keeps them under. Why it is in
 *  the TCB starts open (it is one line, and only where the review has a focus); the counts, the axioms and the
 *  TCB's list start folded (store.ts, SHUT_FIRST), their headings saying what is in them. */
export const PANEL_SECTIONS = { why: "p-why", stats: "p-stats", axioms: "p-axioms", tcb: "p-tcb" } as const;

/** What the reader should know about the file before trusting what the card shows. */
export function banner(f: FileStatus | undefined): string {
  if (!f) return "";
  const when = f.builtAt ? new Date(f.builtAt).toLocaleString() : "";
  const list = (xs?: string[]) => (xs ?? []).slice(0, 3).map(escapeHtml).join(", ") + ((xs?.length ?? 0) > 3 ? ", …" : "");
  switch (f.state) {
    case "failed":
      return `<div class="banner bad">This file failed to compile in the last build. Shown as it was last built${when ? ` (${when})` : ""}.</div>`;
    case "unbuilt":
      return `<div class="banner bad">This file has never been built.</div>`;
    case "blocked":
      return `<div class="banner warn">Not rebuilt: ${list(f.because)} failed underneath. Shown as built${when ? ` ${when}` : ""}.</div>`;
    case "stale":
      return f.because
        ? `<div class="banner warn">Out of date: ${list(f.because)} changed since this was built.</div>`
        : `<div class="banner warn">The source changed since this was built; the card shows the build${when ? ` of ${when}` : ""}.</div>`;
    case "queued":
      return `<div class="banner info">Waiting to be rebuilt.</div>`;
    case "building":
      return `<div class="banner info">Being compiled right now.</div>`;
    case "sorry":
      return `<div class="banner warn">This file uses <code>sorry</code>.</div>`;
    default:
      return "";
  }
}

export class Panel {
  private el: HTMLElement;
  g: Graph;
  private hooks: PanelHooks;
  private current: number | null = null;
  /** the review section, shared with the source window */
  private box: ReviewBox;

  constructor(el: HTMLElement, g: Graph, box: ReviewBox, hooks: PanelHooks) {
    this.el = el;
    this.g = g;
    this.box = box;
    this.hooks = hooks;
    // the element is the cluster panel's too (web/src/clusterpanel.ts): while it tells of a
    // cluster, nothing here answers
    el.addEventListener("click", (e) => {
      if (this.current === null) return;
      const t = e.target as HTMLElement;
      const sec = t.closest<HTMLElement>("[data-sec]");
      if (sec) {
        this.hooks.toggle(sec.dataset.sec!);
        this.show(this.current);
        return;
      }
      const step = t.closest<HTMLElement>("[data-walk]");
      if (step) return this.hooks.walk(Number(step.dataset.walk));
      const row = t.closest<HTMLElement>("[data-go]");
      if (row) return this.hooks.go(Number(row.dataset.go));
      const ref = t.closest<HTMLElement>("[data-ref]");
      if (ref) {
        const i = this.g.byName.get(ref.dataset.ref!);
        if (i !== undefined) this.hooks.go(i);
        return;
      }
      const order = t.closest<HTMLElement>("[data-tcb-order]");
      if (order && this.current !== null) {
        const o = order.dataset.tcbOrder;
        this.hooks.setListOrder(o === "kind" || o === "key" ? o : "review");
        this.show(this.current);
        return;
      }
      if (this.current !== null && this.box.click(t, this.current, this.el)) return;
      if (t.closest("[data-unpin]") && this.current !== null) {
        this.hooks.unpin(this.current);
        this.show(this.current);
        return;
      }
      if (t.closest("[data-source]") && this.current !== null) return this.hooks.openSource(this.current);
      if (t.closest("[data-close]")) this.hooks.close();
    });
    // a row under the pointer is ringed where it lies
    el.addEventListener("mouseover", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-go], [data-walk], [data-ref]");
      if (!row || this.current === null) return;
      const at = row.dataset.go ?? row.dataset.walk;
      const i = at !== undefined ? Number(at) : this.g.byName.get(row.dataset.ref!);
      if (i !== undefined) this.hooks.preview(i);
    });
    el.addEventListener("mouseout", (e) => {
      if (this.current !== null && (e.target as HTMLElement).closest("[data-go], [data-walk], [data-ref]")) this.hooks.preview(null);
    });
    el.addEventListener("input", (e) => {
      if (this.current !== null) this.box.input(e.target as HTMLElement, this.current);
    });
  }

  /** The declaration being shown, by name, so it survives a new graph. */
  get currentName(): string | null {
    return this.current === null ? null : this.g.nodes[this.current]?.name ?? null;
  }

  hide(): void {
    if (this.current === null) return;
    this.current = null;
    this.el.classList.remove("open");
  }

  /** Who else is looking at the declaration on show, changed in place: the panel is not drawn
   *  again, so nothing being typed or scrolled is lost. */
  refreshAlsoHere(): void {
    const el = this.el.querySelector<HTMLElement>(".p-also");
    if (!el || this.current === null) return;
    const html = this.hooks.alsoHere(this.current);
    el.innerHTML = html;
    el.hidden = !html;
  }

  show(i: number | null): void {
    if (i === null) return this.hide();
    const same = i === this.current && this.el.classList.contains("open");
    const keepScroll = this.el.scrollTop;
    // the comment box or whom one speaks for (ReviewSpec decision 8), being typed into
    const typing = document.activeElement?.matches?.("#panel [data-rv-comment], #panel [data-rv-for]") ? (document.activeElement as HTMLInputElement | HTMLTextAreaElement) : null;
    const hadFocus = typing ? { sel: typing.matches("[data-rv-for]") ? "[data-rv-for]" : "[data-rv-comment]", from: typing.selectionStart, to: typing.selectionEnd } : null;
    this.current = i;
    const g = this.g;
    const v = g.nodes[i];
    const ext = g.isExt(i);
    const parts = v.name.split(".");
    const ns = parts.slice(0, -1).join(".");
    const kind = ext ? "external" : v.kind;

    const tcb = g.reach([i], SITE_STMT | SITE_BODY, "out");
    const deps = g.reach([i], ALL_SITES, "out");
    const apps = g.reach([i], ALL_SITES, "in");
    const count = (s: Uint8Array) => {
      let p = 0, x = 0;
      for (let j = 0; j < s.length; j++) if (s[j] && j !== i) g.isExt(j) ? x++ : p++;
      return [p, x] as const;
    };
    const [tcbP, tcbX] = count(tcb);
    const [depP, depX] = count(deps);
    const [appP] = count(apps);
    const axioms = g.axiomsOf(i);

    // the TCB's definitions, grouped by kind: what a reviewer has to read
    const groups = new Map<string, number[]>();
    for (let j = 0; j < tcb.length; j++) {
      if (!tcb[j] || j === i || g.isExt(j)) continue;
      const k = g.nodes[j].kind;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(j);
    }
    const order = ["axiom", "opaque", "structure", "class", "inductive", "def", "abbrev", "instance", "notation", "theorem"];
    const tcbList = [...groups.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([k, xs]) => {
        xs.sort((a, b) => (g.nodes[a].name < g.nodes[b].name ? -1 : 1));
        return (
          `<div class="grp"><div class="grp-h"><span class="dot k-${k}"></span>${k} <span class="muted">${xs.length}</span></div>` +
          xs
            .map((j) => `<button class="row rv-${markOf(this.hooks.reviewData(), g.nodes[j].name, g.nodes[j].module, false, g.nodes[j].hash)}" data-go="${j}" title="Go to ${escapeHtml(g.nodes[j].name)}">${escapeHtml(g.nodes[j].name)}</button>`)
            .join("") +
          `</div>`
        );
      })
      .join("");

    // a target's TCB is what its review goes through: in review order unless the reader asked for
    // the kinds
    const listOrder = this.hooks.listOrder();
    const keyOnly = listOrder === "key";
    const queue = this.hooks.queue(i, keyOnly);
    const inOrder = queue !== null && listOrder !== "kind";
    const orderSwitch =
      queue === null
        ? `<span class="muted">— reached from the statement, proofs skipped</span>`
        : `<span class="seg mini"><button data-tcb-order="review" class="${inOrder && !keyOnly ? "on" : ""}" title="Bottom-up: what a declaration uses before it">Review order</button>` +
          `<button data-tcb-order="key" class="${keyOnly ? "on" : ""}" title="The key declarations alone, in review order">◆ Key</button>` +
          `<button data-tcb-order="kind" class="${inOrder ? "" : "on"}" title="Grouped by kind, by name">By kind</button></span>`;

    // a part that folds: its heading, saying what is in it, and its body while open
    const part = (key: string, title: string, aside: string, body: () => string) => {
      const shut = this.hooks.shut(key);
      return `<div class="p-sec">${sectionHead(key, shut, title, aside)}${shut ? "" : `<div class="p-sec-body">${body()}</div>`}</div>`;
    };
    const flags = (v.flags ?? []).map((f) => `<span class="chip ${f === "opaque" || f === "unsafe" || f === "partial" || f === "implemented_by" || f === "extern" ? "warn" : ""}">${f}</span>`).join("");
    const line = v.range ? `:${v.range[0]}` : "";
    const editor = this.hooks.editorLink(i);
    const nonStd = axioms.filter((a) => !["propext", "Classical.choice", "Quot.sound"].includes(a));
    const why = this.hooks.why(i);
    const then = this.hooks.then?.(i) ?? null;

    this.el.innerHTML = `
      ${banner(this.hooks.fileOf(i))}
      ${then ?? ""}
      <div class="p-head">
        <div class="p-kind k-${kind}"><span class="dot"></span>${kind}${flags}</div>
        <button class="icon" data-close title="Close (Esc)">✕</button>
      </div>
      <h1 class="p-name">${escapeHtml(v.display ?? parts[parts.length - 1])}</h1>
      <div class="p-ns">${escapeHtml(ns)}</div>
      <div class="p-also"${this.hooks.alsoHere(i) ? "" : " hidden"}>${this.hooks.alsoHere(i)}</div>
      <div class="p-mod">${escapeHtml(v.module)}${line}
        ${!ext && v.range ? `<button class="link" data-source title="${then === null ? "The source, with its review (Space)" : "The source at this build (Space)"}">Source</button>` : ""}
        ${then === null && editor ? editorAnchor(editor) : ""}
        ${this.hooks.isPinned(i) ? `<button class="link" data-unpin>Unpin</button>` : ""}
      </div>
      ${v.leanName ? `<div class="p-gen p-lean" title="The Lean constant this unit is made of: what #print and hovers know it by">Lean: <code>${escapeHtml(v.leanName)}</code></div>` : ""}
      ${interpretsHtml(g, i)}
      ${v.also?.length ? `<div class="p-gen p-decls">Also declares: ${alsoList(v.name, v.also)}</div>` : v.gen !== undefined ? `<div class="p-gen">${genNote()}</div>` : ""}
      ${v.type ? `<pre class="code sig">${highlightLean(v.type, (w) => w !== v.name && g.byName.has(w))}</pre>` : ""}
      ${v.doc ? `<div class="doc">${renderDoc(v.doc)}</div>` : ""}
      ${this.hooks.links?.(i) ?? ""}
      ${this.box.html(i, true, tcb)}
      ${why ? part(PANEL_SECTIONS.why, "Why in the TCB", "", () => why) : ""}
      ${part(PANEL_SECTIONS.stats, "Counts", `${tcbP} in TCB · ${depP} uses · ${appP} used by`, () => `
      <div class="stats">
        <div class="stat"><div class="n grad-tcb">${tcbP}</div><div class="l">in TCB<br><span class="muted">+${tcbX} external</span></div></div>
        <div class="stat"><div class="n grad-dep">${depP}</div><div class="l">uses<br><span class="muted">+${depX} external</span></div></div>
        <div class="stat"><div class="n grad-app">${appP}</div><div class="l">used by</div></div>
      </div>`)}
      ${part(
        PANEL_SECTIONS.axioms,
        "Axioms",
        // what must not be missed while folded: an axiom beyond the standard three
        nonStd.length ? `<span class="chip bad">${nonStd.map(escapeHtml).join(", ")}</span>` : String(axioms.length),
        () => `<div class="axioms">${axioms.length ? axioms.map((a) => `<span class="chip ${nonStd.includes(a) ? "bad" : ""}">${escapeHtml(a)}</span>`).join("") : `<span class="muted">none</span>`}</div>`,
      )}
      ${notationHtml(g, i)}
      ${tcbP ? part(PANEL_SECTIONS.tcb, "Trusted definitions", `${tcbP}${queue === null ? "" : keyOnly ? " · key declarations" : inOrder ? " · in review order" : " · by kind"}`, () => `<div class="sec-tcb p-order">${orderSwitch}</div><div class="tcb-list">${inOrder ? queue : tcbList}</div>`) : ""}
    `;
    this.el.classList.add("open");
    if (!same) this.el.scrollTop = 0;
    else this.el.scrollTop = keepScroll;
    if (same && hadFocus) {
      const box = this.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(hadFocus.sel);
      box?.focus();
      if (hadFocus.from !== null && hadFocus.to !== null) box?.setSelectionRange(hadFocus.from, hadFocus.to);
    }
    // a quoted opinion being gone to, now that it is drawn
    this.box.reveal(this.el);
  }
}

/** The notation a unit's text is written in (TCBSpec.md, decision 2), as part of what it uses.
 *  First the macros and elaborators that interpret it — the notation units with an implementation,
 *  and declarations registered for a syntax kind — each with where it is used: statement and body,
 *  which its TCB holds, or only proofs, which it does not. Then, muted, the grammar: the syntax it
 *  is written with, which fixes only the form of the tree and is not in its TCB. For a notation
 *  unit, what its implementation is written with and emits. */
export function notationHtml(g: Graph, i: number): string {
  const impl = new Map<number, number>();
  const grammar = new Map<number, number>();
  for (let e = g.outStart[i]; e < g.outStart[i + 1]; e++) {
    const j = g.outDst[e];
    if (j === i || g.isExt(j)) continue;
    const v = g.nodes[j];
    if (g.isGrammar(j)) grammar.set(j, (grammar.get(j) ?? 0) | g.outSite[e]);
    else if (v.kind === "notation" || v.interprets?.length) impl.set(j, (impl.get(j) ?? 0) | g.outSite[e]);
  }
  if (!impl.size && !grammar.size) return "";
  const where = (s: number) => [s & SITE_STMT ? "statement" : "", s & SITE_BODY ? "body" : "", s & SITE_PROOF ? "proof" : ""].filter(Boolean).join(" · ");
  const byName = (a: [number, number], b: [number, number]) => (g.short(a[0]) < g.short(b[0]) ? -1 : 1);
  const inTcb = (s: number) => !!(s & (SITE_STMT | SITE_BODY));
  const implRows = [...impl]
    .sort((a, b) => Number(!inTcb(a[1])) - Number(!inTcb(b[1])) || byName(a, b))
    .map(
      ([j, s]) =>
        `<button class="row${inTcb(s) ? "" : " p-proof-only"}" data-go="${j}" title="${escapeHtml(g.nodes[j].name)}${inTcb(s) ? "" : ": used in proofs only, so not in its TCB"}">` +
        `<span class="dot k-${g.nodes[j].kind}"></span>${escapeHtml(g.short(j))} <span class="muted">${where(s)}</span></button>`,
    )
    .join("");
  const grammarRows = [...grammar]
    .sort(byName)
    .map(
      ([j, s]) =>
        `<button class="row p-grammar" data-go="${j}" title="${escapeHtml(g.nodes[j].name)}: grammar — what its trees mean is the rule's that interprets them, so it is not in the TCB">` +
        `<span class="dot k-notation"></span>${escapeHtml(g.short(j))}${s & SITE_GRAMMAR ? "" : ` <span class="muted">proof</span>`}</button>`,
    )
    .join("");
  const what = g.nodes[i].kind === "notation" || g.nodes[i].interprets?.length ? "what its implementation is written with and emits" : "what its text is written with";
  return (
    `<div class="sec">Notation <span class="muted">— ${what}</span></div><div class="p-notation">${implRows}` +
    (grammarRows ? `<div class="p-grammar-h muted">Grammar <span title="Syntax that only fixes the form of the text: not in the TCB">— not in the TCB</span></div>${grammarRows}` : "") +
    `</div>`
  );
}

/** For a macro or elaborator, the syntax it interprets; for a syntax, what interprets it — linked,
 *  so that a reviewer reads them side by side. */
export function interpretsHtml(g: Graph, i: number): string {
  const v = g.nodes[i];
  const link = (name: string) => {
    const j = g.byName.get(name);
    return j === undefined
      ? `<code>${escapeHtml(name)}</code>`
      : `<button class="link p-ref" data-ref="${escapeHtml(name)}" title="${escapeHtml(name)}">${escapeHtml(g.short(j))}</button>`;
  };
  const out: string[] = [];
  if (v.interprets?.length) out.push(`<div class="p-gen p-interprets">Interprets: ${v.interprets.map(link).join(", ")}</div>`);
  if (v.rules?.length && g.isGrammar(i)) out.push(`<div class="p-gen p-interprets">Interpreted by: ${v.rules.map(link).join(", ")}</div>`);
  return out.join("");
}

/** What a declaration Lean generated from a command is, when no declaration that command writes
 *  was found to fold it into (ViewNode.gen): it has no text of its own, and its source is the
 *  command's. */
export function genNote(): string {
  return "Generated by Lean from the command at this place: not written in the source.";
}

/** The declarations Lean generated from a unit's command (ViewNode.also), by their names under
 *  the unit's (`Name`, `instDecidableEqName`), each with its full name on hover. */
export function alsoList(unit: string, also: readonly string[]): string {
  return also
    .map((a) => {
      const short = a.startsWith(unit + ".") ? a.slice(unit.length + 1) : a.split(".").pop()!;
      return `<span class="p-decl" title="${escapeHtml(a)}: generated by Lean from the command that writes ${escapeHtml(unit)}, and part of it">${escapeHtml(short)}</span>`;
    })
    .join(", ");
}
