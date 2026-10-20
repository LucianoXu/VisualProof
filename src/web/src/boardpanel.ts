// The board's settings, in the ⚙ Board popover beside the side panel (ViewSpec decisions 8 and 17):
// which view this is and whether it is kept, and its scope as chips — the set it starts from, then
// each condition — that anyone on the board can add to, take from, or rewrite as text; a change is
// everyone's at once. The Project's is said alone: it always holds everything (ViewSpec decision 5). Below them in the popover, the clustering, the depth and Re-layout (pagetoolbar.ts);
// the side panel keeps the cluster tree, with a note over it (`#board-note`).

import { chainOf, describe, describeCondition, fromChain, parseQuery, printQuery, QueryError } from "../../shared/query.ts";
import type { Condition, Query } from "../../shared/query.ts";
import { fixedScope, PROJECT, PROJECT_SCOPE } from "../../shared/views.ts";
import type { ViewData } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import { sectionHead } from "./targetlist.ts";

export interface BoardPanelHooks {
  /** the view on show, what it is called, and what its scope holds: declarations of the project
   *  and of the outside world */
  view(): { rec: ViewData; title: string; own: number; outside: number } | null;
  /** change the board's scope, for everyone; resolves to why it was refused, or null */
  setScope(q: Query): Promise<string | null>;
  /** a snapshot: the boards are as they were, and nobody else is on them */
  snapshot(): boolean;
  /** whether a section of the side panel is folded, and folding or opening it */
  shut(section: string): boolean;
  toggle(section: string): void;
}

/** Conditions offered by "+": the External switch that was, trust, review statuses, one's own review
 *  (`mine(none)`: each reader sees what they have not reviewed, the owner's decision of 2026-10-20),
 *  kinds, sorry. */
const OFFERED: { label: string; c: Condition }[] = [
  { label: "Without the outside world", c: { op: "except", q: { op: "external" } } },
  { label: "Except what is trusted", c: { op: "except", q: { op: "trusted" } } },
  { label: "Only not yet reviewed", c: { op: "and", q: { op: "status", statuses: ["unreviewed"] } } },
  { label: "Only stale", c: { op: "and", q: { op: "status", statuses: ["stale"] } } },
  { label: "Only commented", c: { op: "and", q: { op: "status", statuses: ["commented"] } } },
  { label: "Except approved", c: { op: "except", q: { op: "status", statuses: ["approved"] } } },
  { label: "Only not reviewed by me", c: { op: "and", q: { op: "mine", statuses: ["none"] } } },
  { label: "Only what an agent comments on", c: { op: "and", q: { op: "advice", verdicts: ["comment"] } } },
  { label: "Only theorems", c: { op: "and", q: { op: "kind", kinds: ["theorem"] } } },
  { label: "Only definitions", c: { op: "and", q: { op: "kind", kinds: ["def"] } } },
  { label: "Only with sorry", c: { op: "and", q: { op: "sorry" } } },
  { label: "Only with non-standard axioms", c: { op: "and", q: { op: "nonstandard" } } },
];

const text = (c: Condition) => `${c.op} ${printQuery(c.q)}`;

export class BoardPanel {
  private el: HTMLElement;
  /** where a note about someone else's change shows: beside the board, not redrawn with it */
  private noteEl: HTMLElement;
  private hooks: BoardPanelHooks;
  /** what is being done to the scope: nothing, choosing a condition, or writing it as text */
  private editing: "add" | "text" | null = null;
  private error: string | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement, noteEl: HTMLElement, hooks: BoardPanelHooks) {
    this.el = el;
    this.noteEl = noteEl;
    this.hooks = hooks;
    el.addEventListener("click", (e) => void this.clicked(e));
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const input = form.querySelector<HTMLInputElement>("input")!;
      if (form.dataset.form === "text") return void this.write(input.value);
      // a namespace or a file prefix, as a condition
      const v = input.value.trim();
      if (v) void this.add({ op: "and", q: { op: form.dataset.form === "ns" ? "ns" : "file", prefix: v } });
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.editing) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  render(): void {
    const v = this.hooks.view();
    if (!v) {
      this.el.innerHTML = "";
      return;
    }
    const { base, conditions } = chainOf(v.rec.scope);
    const kept = v.rec.kept;
    const tag = this.hooks.snapshot()
      ? "As it was when the snapshot was taken"
      : v.rec.id === PROJECT
        ? "Shared with everyone on it · always kept"
        : kept
          ? "Shared with everyone on it · kept"
          : "Shared with everyone on it · not kept yet";
    // a view nobody keeps that a click on a target with no view linked to it: the link goes with it
    // (ViewSpec decision 29, the owner's decision of 2026-10-11)
    const links = !kept && v.rec.targets ? `, and the link of ${v.rec.targets.map((t) => `★${t.split(".").pop()}`).join(" and ")} to it with it` : "";
    const tagTip = kept
      ? "Everyone on this view sees the same board: its scope, clustering, pins and folds"
      : `Everyone on this view sees the same board. Nobody has arranged or named it yet: it goes when everyone has closed it${links}. Pin, fold or name it to keep it.`;
    let html =
      `<div class="board-h"><span class="board-k">Board</span><span class="board-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span></div>` +
      `<div class="board-tag${kept || this.hooks.snapshot() ? "" : " loose"}" title="${escapeHtml(tagTip)}">${tag}</div>`;
    // short enough to sit beside "Filter": the whole count is in the tooltip of the section
    const count = v.outside ? `${v.own.toLocaleString()} + ${v.outside.toLocaleString()} outside` : `${v.own.toLocaleString()} declaration${v.own === 1 ? "" : "s"}`;
    // folded, as it starts: the heading alone, with how much the board holds
    const shut = this.hooks.shut("filter");
    // every board's scope is changed here, a target's view's too (ViewSpec decision 28)
    html += sectionHead("filter", shut, "Filter", escapeHtml(count));
    if (!shut && fixedScope(v.rec)) {
      // the Project is never rescoped (ViewSpec decision 5): its scope is said, and nothing offered
      html +=
        `<div class="scope" role="group" aria-label="Scope"><span class="schip" title="${escapeHtml(printQuery(v.rec.scope))}">${escapeHtml(describe(base))}</span></div>` +
        `<div class="scope-help muted">${escapeHtml(PROJECT_SCOPE)}</div>`;
    } else if (!shut && this.editing === "text") {
      html +=
        `<form class="scope-edit" data-form="text"><input class="scope-input" value="${escapeHtml(printQuery(v.rec.scope))}" spellcheck="false" autocomplete="off" aria-label="The scope, as a query">` +
        `<div class="scope-help muted">all, tcb(A), uses(A), usedBy(A), decl(A), ns(P), file(P), trusted, external, kind(theorem), status(unreviewed), advice(comment), mine(none), sorry, nonstandard — joined by and, or, except. Enter applies it for everyone; Esc leaves it.</div>` +
        (this.error ? `<div class="modal-err">${escapeHtml(this.error)}</div>` : "") +
        `</form>`;
    } else if (!shut) {
      html +=
        `<div class="scope" role="group" aria-label="Scope">` +
        `<button class="schip base" data-text title="${escapeHtml(printQuery(v.rec.scope))} — click to write the scope as a query">${escapeHtml(describe(base))}</button>` +
        conditions
          .map((c, k) => `<span class="schip" title="${escapeHtml(text(c))}">${escapeHtml(describeCondition(c))}<button class="schip-x" data-rm="${k}" title="Take this condition off, for everyone" aria-label="Remove">×</button></span>`)
          .join("") +
        `<button class="schip add${this.editing === "add" ? " on" : ""}" data-add title="Add a condition, for everyone">+</button></div>`;
      if (this.editing === "add") {
        const have = new Set(conditions.map(text));
        html +=
          `<div class="scope-add">` +
          OFFERED.map((o, k) => `<button class="sa-row" data-offer="${k}"${have.has(text(o.c)) ? " disabled" : ""}>${escapeHtml(o.label)}</button>`).join("") +
          `<form class="sa-form" data-form="ns"><input placeholder="Only in namespace…" spellcheck="false" autocomplete="off" aria-label="Only in namespace"></form>` +
          `<form class="sa-form" data-form="file"><input placeholder="Only in files under…" spellcheck="false" autocomplete="off" aria-label="Only in files under"></form>` +
          `<button class="sa-row" data-text>Write the scope as a query…</button>` +
          `</div>`;
      }
      if (this.error) html += `<div class="modal-err">${escapeHtml(this.error)}</div>`;
    }
    this.el.innerHTML = html;
    if (this.editing === "text") {
      const f = this.el.querySelector<HTMLInputElement>(".scope-input")!;
      f.focus();
    }
  }

  /** Someone else changed the board: a short note under the scope ("Carol changed the scope"). */
  note(html: string): void {
    const el = this.noteEl;
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove("fade");
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      el.classList.add("fade");
      this.noteTimer = setTimeout(() => (el.hidden = true), 600);
    }, 4000);
  }

  private close(): void {
    this.reset();
    this.render();
  }

  /** The popover closed: what was being done to the scope is left, so that it opens on the chips
   *  again, not on a list of conditions or a refusal from before. */
  reset(): void {
    this.editing = null;
    this.error = null;
  }

  private async clicked(e: MouseEvent): Promise<void> {
    const t = e.target as HTMLElement;
    const v = this.hooks.view();
    if (!v) return;
    if (t.closest("[data-sec]")) {
      this.editing = null;
      return this.hooks.toggle("filter");
    }
    if (t.closest("[data-text]")) {
      this.editing = "text";
      this.error = null;
      return this.render();
    }
    if (t.closest("[data-add]")) {
      this.editing = this.editing === "add" ? null : "add";
      this.error = null;
      return this.render();
    }
    const rm = t.closest<HTMLElement>("[data-rm]");
    if (rm) {
      const { base, conditions } = chainOf(v.rec.scope);
      conditions.splice(Number(rm.dataset.rm), 1);
      return this.apply(fromChain(base, conditions));
    }
    const offer = t.closest<HTMLButtonElement>("[data-offer]");
    if (offer && !offer.disabled) return this.add(OFFERED[Number(offer.dataset.offer)].c);
  }

  private add(c: Condition): Promise<void> {
    const v = this.hooks.view();
    if (!v) return Promise.resolve();
    const { base, conditions } = chainOf(v.rec.scope);
    return this.apply(fromChain(base, [...conditions, c]));
  }

  private async write(s: string): Promise<void> {
    let q: Query;
    try {
      q = parseQuery(s);
    } catch (e) {
      this.error = e instanceof QueryError ? `At ${e.at + 1}: ${e.message}.` : String(e);
      return this.render();
    }
    return this.apply(q);
  }

  private async apply(q: Query): Promise<void> {
    const why = await this.hooks.setScope(q);
    this.error = why;
    if (!why) this.editing = null;
    this.render();
  }
}
