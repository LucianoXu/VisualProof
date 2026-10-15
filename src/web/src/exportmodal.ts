// Export (ExportSpec decisions 5–18, and the owner's of 2026-10-12): beside Share, a window at the right that
// makes the document of the view on show, typeset with LaTeX on the server. The view is the
// specification, and its board the document's outline: the window says which view it exports, that
// the document follows the board's order and prints the notes it shows, and what it holds — its declarations of the project, in the sections its
// cluster structure gives (shared/doc/sections.ts, as the server builds them), and what it holds from
// outside the project, which is not printed — then the common settings (shared/doc/settings.ts; the
// rest keep their defaults), Generate, and the PDF and its LaTeX sources, with what the export notes
// about how it was made. To print something else, the reader changes the view, or exports another.
//
// The title and the author line are the view's too (ExportSpec decisions 14 and 15): the window shows
// them as they will print — the view's title, and the people who left a trace on it, which the server
// says (who dropped each pin is never sent to pages) — and says how each changes.
//
// A board of a past build makes that build's document (ExportSpec decision 16): a view kept at a past
// build, or the Time Machine's preview of a view at another build than its own, which the request
// names. The window says which build.
//
// The settings are this reader's own, kept in their browser with the page's other preferences
// (web/src/store.ts).

import { MAX_DOC_DECLS } from "../../shared/doc/sections.ts";
import type { DocPlan } from "../../shared/doc/sections.ts";
import { DEFAULT_SETTINGS } from "../../shared/doc/settings.ts";
import type { DocSettings } from "../../shared/doc/settings.ts";
import { escapeHtml } from "./highlight.ts";

/** The view on show, as the window tells of it: its id, its title (and what the page says of it under
 *  the pointer: its scope in full), its document's title, whether its name is fixed (the Project's),
 *  what its document holds, and the build it is of. */
export interface ExportView {
  id: string;
  title: string;
  tip?: string;
  /** the document's title (shared/views.ts, docTitle) */
  heading: string;
  fixed: boolean;
  plan: Pick<DocPlan, "count" | "sectionCount" | "outside">;
  /** a preview of the view at another build than its own (the Time Machine): that build, a
   *  snapshot's id, or null for the latest; absent, the view's own build */
  version?: number | null;
  /** the past build the board shows, in a few words; absent on the latest build */
  when?: string;
}

/** What heads the document, as the server says it will print (GET /api/export/head). */
export interface ExportHead {
  title: string;
  author: string;
}

/** A typesetting job, as the server says it is doing (server/export.ts). */
export interface ExportJobState {
  id: string;
  state: "running" | "done" | "failed";
  error?: string;
  log?: string;
  pages?: number;
  ms?: number;
  runs?: number;
  /** what the document does not say about how it was made (shared/doc/build.ts, `docNotes`) */
  notes?: string[];
}

export interface ExportHooks {
  /** the view on show and what its document holds; null where there is none */
  view(): ExportView | null;
  /** the settings this reader chose last time, and keeping them */
  saved(): { settings?: Partial<DocSettings> } | undefined;
  save(v: { settings: Partial<DocSettings> }): void;
  /** the document's title and author line as they will print at the build `version` names (left
   *  out, the view's own), or why they cannot be had */
  head(view: string, version?: number | null): Promise<ExportHead | string>;
  /** start typesetting; the job, or why it was refused */
  start(body: { view: string; settings: Partial<DocSettings>; version?: number | null }): Promise<ExportJobState | string>;
  /** how a job is doing */
  poll(id: string): Promise<ExportJobState | string>;
  /** the window opened or closed: the board is drawn in the linear form while it is open
   *  (ExportSpec decision 18) */
  shown?(open: boolean): void;
  /** the Artwork tab: the window closes into the artwork mode (ExportSpec decision 19) */
  artwork?(): void;
  /** no document can be made here (a snapshot of the page): Export goes straight to the artwork */
  artworkOnly?(): boolean;
}

/** The settings the modal sets; the others keep their defaults. */
type Common = Pick<DocSettings, "paper" | "fontSize" | "codeSize" | "contents">;
const COMMON: readonly (keyof Common)[] = ["paper", "fontSize", "codeSize", "contents"];

const CODE_SIZES = [7, 7.5, 8, 8.5, 9, 9.5, 10];

/** The common settings of `s`, over the defaults: what an older page kept (a colour scheme, line
 *  numbers, the context, the key graph, the appendix, a title and an author line) is left behind. */
function common(s: Partial<DocSettings> | undefined): Common {
  const out = Object.fromEntries(COMMON.map((k) => [k, DEFAULT_SETTINGS[k]])) as Common;
  for (const k of COMMON) if (s && s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

/** `n` things, with the plural where it is more than one. */
const count = (n: number, one: string, many = `${one}s`) => `<b>${n.toLocaleString()}</b> ${n === 1 ? one : many}`;

export class ExportModal {
  private btn: HTMLElement;
  private el: HTMLElement;
  private hooks: ExportHooks;
  private settings: Common = common(undefined);
  /** the view on show when the window opened: the window exports that one */
  private view: ExportView | null = null;
  /** its document's title and author line as the server says them; a string while they are asked
   *  for ("") or where they could not be had (why) */
  private head: ExportHead | string = "";
  /** the job being typeset or done, and the turn of the last request (a later one wins) */
  private job: ExportJobState | null = null;
  private turn = 0;
  private started = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(btn: HTMLElement, el: HTMLElement, hooks: ExportHooks) {
    this.btn = btn;
    this.el = el;
    this.hooks = hooks;
    btn.addEventListener("click", () => {
      // a page with no document to make (a snapshot: its documents are the server's) makes pictures
      if (hooks.artworkOnly?.()) return hooks.artwork?.();
      if (el.hidden) this.open();
      else this.close();
    });
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === el || t.closest("[data-ex-close]")) return this.close();
      if (t.closest("[data-ex-art]")) {
        this.close();
        return this.hooks.artwork?.();
      }
      if (t.closest("[data-ex-go]")) return void this.generate();
    });
    el.addEventListener("change", (e) => this.changed(e.target as HTMLInputElement));
    // the page's keys stand aside while the window is open; Esc closes it
    el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.settings = common(this.hooks.saved()?.settings);
    this.view = this.hooks.view();
    this.job = null;
    this.head = "";
    this.el.hidden = false;
    this.btn.classList.add("on");
    this.render();
    this.hooks.shown?.(true);
    this.el.querySelector<HTMLElement>(".ex-box")?.focus();
    const v = this.view;
    if (v)
      void this.hooks.head(v.id, v.version).then((h) => {
        // the window still shows that view
        if (this.view !== v || this.el.hidden) return;
        this.head = h;
        this.render();
      });
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.btn.classList.remove("on");
    this.stopTimer();
    this.hooks.shown?.(false);
  }

  private changed(t: HTMLInputElement): void {
    const k = t.dataset.set as keyof Common | undefined;
    if (!k) return;
    const s = this.settings as Record<string, unknown>;
    if (k === "fontSize" || k === "codeSize") s[k] = Number(t.value);
    else if (k === "contents") s[k] = t.checked;
    else s[k] = t.value;
    this.render();
  }

  /** Why the view makes no document, or null. */
  private refusal(): string | null {
    const v = this.view;
    if (!v) return "There is no view to export.";
    const n = v.plan.count;
    if (!n) return "Nothing of the project on this view to print.";
    if (n > MAX_DOC_DECLS) return `A document prints at most ${MAX_DOC_DECLS.toLocaleString()} declarations; this view has ${n.toLocaleString()}. Narrow it, or export a target's Key view.`;
    return null;
  }

  /** Which view is exported, and what its document holds. */
  private summary(): string {
    const v = this.view;
    if (!v) return "";
    const esc = escapeHtml;
    const p = v.plan;
    const by = p.outside.by.map((b) => `${b.name} ${b.count.toLocaleString()}`).join(", ");
    const out = p.outside.count ? `<div class="ex-sum muted" title="${esc(by)}">${count(p.outside.count, "declaration")} from outside the project, not printed.</div>` : "";
    // a preview's build, which its title does not say (a view's own past build, its title does)
    const at = v.version === undefined ? "" : v.when ? ` at the build of <b>${esc(v.when)}</b>` : " at the latest build";
    return (
      `<div class="ex-sum">Export the view <b${v.tip ? ` title="${esc(v.tip)}"` : ""}>“${esc(v.title)}”</b>${at}: ${count(p.count, "declaration")} in ${count(p.sectionCount, "section")}.</div>` +
      out
    );
  }

  /** What the document of a board of a past build is, or of a preview at another build than the
   *  view's own: that build's (ExportSpec decision 16). Empty on the view's own latest build. */
  private buildText(): string {
    const v = this.view;
    if (!v || (v.version === undefined && !v.when)) return "";
    const esc = escapeHtml;
    const build = v.when ? `the build of <b>${esc(v.when)}</b>` : "the latest build";
    return `<div class="modal-text">As of ${build}.</div>`;
  }

  private render(): void {
    const esc = escapeHtml;
    const s = this.settings;
    // the window is drawn again whole: where it was scrolled to stays
    const box = this.el.querySelector<HTMLElement>(".ex-box");
    const scroll = box?.scrollTop ?? 0;
    const opt = <T extends string | number>(value: T, label: string, cur: T) => `<option value="${value}"${value === cur ? " selected" : ""}>${label}</option>`;
    const job = this.job;
    const busy = job?.state === "running";
    const refused = this.refusal();
    const result = !job
      ? ""
      : job.state === "running"
        ? `<div class="ex-prog"><div class="ex-bar"><i></i></div><span>Typesetting with XeLaTeX… <span class="ex-secs">${this.elapsed()}</span></span></div>`
        : job.state === "failed"
          ? `<div class="banner bad">Typesetting failed: ${esc(job.error ?? "XeLaTeX stopped")}.</div>` + (job.log ? `<details class="ex-log"><summary>XeLaTeX's log</summary><pre>${esc(job.log)}</pre></details>` : "")
          : `<div class="ex-done"><div><b>${job.pages ?? "?"} page${job.pages === 1 ? "" : "s"}</b>, typeset in ${((job.ms ?? 0) / 1000).toFixed(1)} s.</div>` +
            `<div class="ex-dl"><a class="rv-btn primary" href="/api/export/file?id=${job.id}&what=pdf" download>Download PDF</a>` +
            `<a class="rv-btn" href="/api/export/file?id=${job.id}&what=zip" download title="The .tex, the style file visualproof.sty and the fonts: typeset it yourself, or make the style your own">LaTeX sources (.zip)</a>` +
            `<a class="link" href="/api/export/file?id=${job.id}&what=tex" download>.tex</a><a class="link" href="/api/export/file?id=${job.id}&what=sty" download>.sty</a></div>` +
            // how the document was made, which it does not say itself: folded, for the curious
            (job.notes?.length ? `<details class="ex-log ex-notes"><summary>Notes (${job.notes.length})</summary><ul>${job.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : "") +
            `</div>`;
    this.el.innerHTML =
      `<div class="modal-box glass ex-box" role="dialog" aria-label="Export a document" tabindex="-1">` +
      `<div class="ex-head"><div class="modal-title">Export a document</div><button class="icon" data-ex-close title="Close (Esc)">✕</button></div>` +
      // the document, or the board as a picture (ExportSpec decision 19), which the page frames
      (this.hooks.artwork ? `<div class="sh-tabs ex-tabs" role="tablist"><button role="tab" aria-selected="true">Document</button><button role="tab" aria-selected="false" data-ex-art title="The board as a picture, PNG or SVG, at the size you choose: frame it, then save it">Artwork</button></div>` : "") +
      `<div class="ex-sec">${this.summary()}</div>` +
      `<div class="modal-text">Sections and order follow the board: drag to reorder. Proofs and the review are not printed.</div>` +
      this.buildText() +
      (refused ? `<div class="banner warn ex-warn">${esc(refused)}</div>` : "") +
      this.headRows() +
      `<div class="ex-sec ex-grid">` +
      `<label class="ex-field">Paper<select data-set="paper">${opt("a4", "A4", s.paper)}${opt("letter", "Letter", s.paper)}</select></label>` +
      `<label class="ex-field">Text<select data-set="fontSize">${[10, 11, 12].map((n) => opt(n, `${n} pt`, s.fontSize)).join("")}</select></label>` +
      `<label class="ex-field">Code<select data-set="codeSize">${CODE_SIZES.map((n) => opt(n, `${n} pt`, s.codeSize)).join("")}</select></label>` +
      `<div class="ex-checks"><label class="ex-check" title="The sections with their pages (and the declarations, where the document is short), in two columns after the head card"><input type="checkbox" data-set="contents"${s.contents ? " checked" : ""}> Table of contents</label></div>` +
      `</div>` +
      result +
      `<div class="modal-actions"><button class="rv-btn" data-ex-close>Close</button>` +
      `<button class="rv-btn primary" data-ex-go${refused || busy ? " disabled" : ""}>${busy ? "Generating…" : job?.state === "done" ? "Generate again" : "Generate"}</button></div>` +
      `</div>`;
    const again = this.el.querySelector<HTMLElement>(".ex-box");
    if (again) again.scrollTop = scroll;
  }

  /** The title and the author line as the document will print them, each with how it changes. */
  private headRows(): string {
    const v = this.view;
    if (!v) return "";
    const esc = escapeHtml;
    const h = this.head;
    const title = typeof h === "string" ? v.heading : h.title;
    const titleHint = v.fixed ? "Duplicate the view to print another title." : "";
    const author =
      typeof h === "string"
        ? `<span class="muted">${h ? `Not known: ${esc(h)}` : "…"}</span>`
        : h.author
          ? esc(h.author)
          : `<span class="muted">None</span>`;

    return (
      `<div class="ex-sec ex-meta">` +
      `<div class="ex-row"><span class="ex-label">Title</span><div><div class="ex-value ex-title">${esc(title)}</div>${titleHint ? `<div class="ex-hint">${esc(titleHint)}</div>` : ""}</div></div>` +
      `<div class="ex-row"><span class="ex-label" title="Who made, arranged, annotated or reviewed this view, first first; agents are not named">Author</span><div><div class="ex-value">${author}</div></div></div>` +
      `</div>`
    );
  }

  private elapsed(): string {
    return `${((Date.now() - this.started) / 1000).toFixed(0)} s`;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Typeset the view's document, and follow the job until it is done. */
  private async generate(): Promise<void> {
    const v = this.view;
    if (!v || this.refusal()) return;
    const settings: Partial<DocSettings> = { ...this.settings };
    this.hooks.save({ settings });
    const turn = ++this.turn;
    this.started = Date.now();
    this.job = { id: "", state: "running" };
    this.render();
    this.stopTimer();
    this.timer = setInterval(() => {
      const secs = this.el.querySelector(".ex-secs");
      if (secs) secs.textContent = this.elapsed();
    }, 500);
    let j = await this.hooks.start({ view: v.id, settings, ...(v.version !== undefined ? { version: v.version } : {}) });
    while (typeof j !== "string" && j.state === "running" && turn === this.turn && !this.el.hidden) {
      await new Promise((ok) => setTimeout(ok, 700));
      j = await this.hooks.poll(j.id);
    }
    if (turn !== this.turn) return;
    this.stopTimer();
    this.job = typeof j === "string" ? { id: "", state: "failed", error: j } : j;
    if (!this.el.hidden) this.render();
  }
}
