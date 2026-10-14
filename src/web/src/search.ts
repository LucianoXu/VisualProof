// The search box (`/`) and its list. What is found, and how it ranks, is shared/search.ts: the page
// and the agent API (server/agent.ts) search the same way. The lost-and-found's Attach to… asks for a
// declaration with it (`pick`): the one chosen is handed back instead of gone to.

import { escapeHtml } from "./highlight.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { lowerKeepingOffsets, marked, narrows, PLACES, search, SearchIndex, snippet } from "../../shared/search.ts";
import type { Found, Hit, Piece, Where } from "../../shared/search.ts";
import { composing } from "./ime.ts";

export function piecesHtml(pieces: readonly Piece[]): string {
  return pieces.map((p) => (p.mark ? `<mark>${escapeHtml(p.text)}</mark>` : escapeHtml(p.text))).join("");
}

/** How many rows the list shows: each place gets up to EACH first, then what is left goes to the
 *  places in order, names first. */
const ROWS = 18;
const EACH = 6;

/** How many of each place's hits are shown. */
export function quota(counts: Record<Where, number>, rows = ROWS, each = EACH): Record<Where, number> {
  const out = { name: 0, statement: 0, doc: 0 };
  let left = rows;
  for (const w of PLACES) {
    out[w] = Math.min(counts[w], each);
    left -= out[w];
  }
  for (const w of PLACES) {
    const more = Math.min(left, counts[w] - out[w]);
    out[w] += more;
    left -= more;
  }
  return out;
}

const WHERE_LABEL: Record<Where, string> = { name: "name", statement: "statement", doc: "docstring" };
const MORE_LABEL: Record<Where, string> = { name: "by name", statement: "in statements", doc: "in docstrings" };

export interface SearchHooks {
  /** go to the declaration chosen */
  go(i: number): void;
}

/** The search field in the bar and its list. */
export class SearchBox {
  private g: Graph;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private hooks: SearchHooks;
  /** built when the field is first focused on a graph (a moment on a large one: 16 ms on the
   *  showcase's), so that the first keystroke does not wait for it */
  private index: SearchIndex | null = null;
  private found: Found | null = null;
  /** the declarations the list shows, in its order */
  private rows: number[] = [];
  private cursor = 0;
  /** a pick asked for (`pick`): what to tell it, the declaration chosen or null */
  private picking: ((i: number | null) => void) | null = null;

  constructor(input: HTMLInputElement, results: HTMLElement, g: Graph, hooks: SearchHooks) {
    this.input = input;
    this.results = results;
    this.g = g;
    this.hooks = hooks;
    input.addEventListener("focus", () => void this.indexed());
    input.addEventListener("input", () => this.update());
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") this.move(Math.min(this.rows.length - 1, this.cursor + 1));
      else if (e.key === "ArrowUp") this.move(Math.max(0, this.cursor - 1));
      else if (e.key === "Enter" && !composing(e) && this.rows[this.cursor] !== undefined) return this.choose(this.rows[this.cursor]);
      else if (e.key === "Escape") {
        input.blur();
        results.hidden = true;
        this.endPick(null);
        return;
      } else return;
      e.preventDefault();
    });
    results.addEventListener("mousedown", (e) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>(".hit");
      // a click on the list keeps the field's focus, so it does not close under the pointer
      e.preventDefault();
      if (hit) this.choose(Number(hit.dataset.i));
    });
    // a pick the reader left the field without making is given up
    input.addEventListener("blur", () =>
      setTimeout(() => {
        results.hidden = true;
        if (document.activeElement !== input) this.endPick(null);
      }, 120),
    );
  }

  /** Ask for a declaration (Attach to…): the field says what for, and the next one chosen is handed
   *  back rather than gone to; null where the reader leaves the field without choosing. A pick asked
   *  for while another is open gives the other up. */
  pick(prompt: string): Promise<number | null> {
    this.endPick(null);
    const wrap = this.input.closest(".search-wrap");
    const placeholder = this.input.placeholder;
    this.input.value = "";
    this.input.placeholder = prompt;
    this.input.title = `${prompt} Type a name; Esc gives up.`;
    wrap?.classList.add("picking");
    return new Promise((ok) => {
      this.picking = (i) => {
        this.input.placeholder = placeholder;
        this.input.title = "Search names, statements and docstrings (/)";
        wrap?.classList.remove("picking");
        ok(i);
      };
      this.input.focus();
    });
  }

  private endPick(i: number | null): boolean {
    const p = this.picking;
    if (!p) return false;
    this.picking = null;
    p(i);
    return true;
  }

  /** A new graph: the index is built again, and a list on show is searched again. */
  setGraph(g: Graph): void {
    this.g = g;
    this.index = null;
    this.found = null;
    if (!this.results.hidden) this.update();
    else this.rows = [];
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  private update(): void {
    const q = this.input.value.trim();
    this.cursor = 0;
    if (q.length < 2) {
      this.found = null;
      this.rows = [];
      this.results.hidden = true;
      return;
    }
    const prev = this.found;
    this.found = search(this.indexed(), q, prev && narrows(prev.query, q) ? prev.matched : undefined);
    this.render();
    this.results.scrollTop = 0;
  }

  private indexed(): SearchIndex {
    return (this.index ??= new SearchIndex(this.g.nodes, this.g.projectCount));
  }

  private render(): void {
    const f = this.found;
    if (!f) return;
    const g = this.g;
    const ix = this.index!;
    const counts = { name: f.hits.name.length, statement: f.hits.statement.length, doc: f.hits.doc.length };
    const shown = quota(counts);
    const hits = PLACES.flatMap((w) => f.hits[w].slice(0, shown[w]));
    this.rows = hits.map((h) => h.i);
    if (!hits.length) {
      const what = f.words.length > 1 ? "all of these words" : `“${escapeHtml(f.query)}”`;
      this.results.innerHTML = `<div class="h-none">Nothing has ${what} in its name, statement or docstring.</div>`;
      this.results.hidden = false;
      return;
    }
    const row = (h: Hit, k: number) => {
      const v = g.nodes[h.i];
      const name = ix.text[0][h.i], lower = ix.lower[0][h.i];
      const dot = name.lastIndexOf(".");
      let html =
        `<div class="hit${k === this.cursor ? " on" : ""}" data-i="${h.i}"><div class="h-line">` +
        `<span class="dot k-${g.isExt(h.i) ? "external" : v.kind}"></span>` +
        `<span class="h-name">${piecesHtml(marked(name, lower, f.words, dot + 1))}</span>` +
        `<span class="h-ns">${piecesHtml(marked(name, lower, f.words, 0, Math.max(0, dot)))}</span></div>`;
      if (h.via !== undefined) {
        // found by a name Lean generated from its command, which it folds
        const via = h.via;
        html +=
          `<div class="h-snip h-also"><span class="h-where">also declares</span>` +
          `<span class="h-text">${piecesHtml(marked(via, lowerKeepingOffsets(via), f.words))}</span></div>`;
      } else if (h.where !== "name") {
        const p = h.where === "statement" ? 1 : 2;
        const s = snippet(ix.text[p][h.i], ix.lower[p][h.i], f.words, h.word);
        html +=
          `<div class="h-snip h-${h.where}"><span class="h-where">${WHERE_LABEL[h.where]}</span>` +
          `<span class="h-text">${s.before ? "…" : ""}${piecesHtml(s.pieces)}${s.after ? "…" : ""}</span></div>`;
      }
      return html + `</div>`;
    };
    const more = PLACES.filter((w) => counts[w] > shown[w]).map((w) => `${(counts[w] - shown[w]).toLocaleString()} more ${MORE_LABEL[w]}`);
    this.results.innerHTML =
      hits.map(row).join("") + (more.length ? `<div class="h-more">${more.join(" · ")} — add a word to narrow it down</div>` : "");
    this.results.hidden = false;
  }

  /** The cursor on another row, brought into view. */
  private move(k: number): void {
    if (k < 0 || k === this.cursor) return;
    const rows = this.results.querySelectorAll<HTMLElement>(".hit");
    rows[this.cursor]?.classList.remove("on");
    this.cursor = k;
    rows[k]?.classList.add("on");
    rows[k]?.scrollIntoView({ block: "nearest" });
  }

  private choose(i: number): void {
    if (this.endPick(i)) {
      this.input.value = "";
      this.results.hidden = true;
      this.input.blur();
      return;
    }
    this.input.blur();
    this.results.hidden = true;
    this.hooks.go(i);
  }
}
