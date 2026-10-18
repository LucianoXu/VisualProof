// The library (AttachmentSpec decisions 1–3): the project's references, PDFs and images, opened from
// the bar's Library. A file is added by anyone who can write a note — uploaded (chosen, or dropped
// on the list), or by URL, which the server fetches once and keeps (an arXiv abstract's address
// gives its PDF) — and listed with its record: its title (the PDF's own, else the file's name;
// renamed here), its type, size and pages, who added it and when (written in English whatever the
// browser's language, the owner's decision of 2026-10-11: `libraryDate`), and where it came from. Opening one shows it in the reference window
// (web/src/paperwin.ts). Removing a file archives it: it leaves the list, its links say so, and it
// is restored from "Archived". A file whose record came through the review's logs from another
// server, and whose bytes this one lacks, says so and takes only bytes of its hash.
//
// From a declaration's or a cluster's panel, "Link to a reference…" opens the library to choose the
// file (`choose`), then the reference window links that subject; from a note's menu, "Attach…" opens
// it to choose a file to attach to the note (AttachmentSpec decision 12).

import { filesOf, MAX_FILE, sizeWords, subjectWords } from "../../shared/library.ts";
import type { FileRecord } from "../../shared/library.ts";
import type { ReviewChange, ReviewData } from "../../shared/review.ts";
import { escapeHtml } from "./highlight.ts";

/** What a file is chosen for: a subject to link to a place in it (a panel's Link to a reference…), or
 *  a note to attach it to (the note's Attach…, its first words for the list's head). */
export type Choosing = { link: string } | { attach: string; label: string };

/** What adding a file to the library answered: the file's record and whether it was there already,
 *  with the review's change to apply at once; or why it was refused (its type, its size, the
 *  library's limit, no name). */
export type Uploaded = { ok: true; file: FileRecord; existed: boolean; change?: ReviewChange } | { ok: false; error: string; who?: boolean };

/** Add a file dropped or pasted on the canvas to the library (POST /api/library/upload), under the
 *  reader's name (`headers`). The page writes the note that carries it, at the spot (`note=0`): the
 *  server writes none on the ring, as it does for a file added otherwise. */
export async function uploadFile(file: File, headers: Record<string, string>): Promise<Uploaded> {
  if (file.size > MAX_FILE) return { ok: false, error: `${file.name} is ${sizeWords(file.size)}: a file of the library is at most ${sizeWords(MAX_FILE)}.` };
  const r = await fetch(`/api/library/upload?name=${encodeURIComponent(file.name)}&note=0`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: file }).catch(() => null);
  const b = (await r?.json().catch(() => null)) as { error?: string; hint?: string; who?: boolean; file?: FileRecord; existed?: boolean; change?: ReviewChange } | null;
  if (!r?.ok || !b?.file) return { ok: false, error: b?.error ? `${b.error}${b.hint ? ` ${b.hint}` : ""}` : "The server could not be reached.", ...(b?.who ? { who: true } : {}) };
  return { ok: true, file: b.file, existed: !!b.existed, ...(b.change ? { change: b.change } : {}) };
}

export interface LibraryHooks {
  review(): ReviewData;
  takeChange(c: ReviewChange): void;
  headers(): Record<string, string>;
  ensureName(): Promise<boolean>;
  /** open a file in the reference window, or, where one is chosen for something, do that with it */
  open(sha: string, choosing: Choosing | null): void;
  /** links into a file, counted */
  links(sha: string): number;
  say(text: string): void;
  /** why nothing can be added here (a snapshot of the page), or null */
  cannot(): string | null;
}

interface Listed {
  files: (FileRecord & { have: boolean; links: number })[];
  archived: (FileRecord & { have: boolean; links: number })[];
  used: number;
  limit: number;
}

/** When a file was added, as the library writes it: in English, whatever the browser's language
 *  (the owner's decision of 2026-10-11) — "Oct 11, 2026". */
export function libraryDate(at: string): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
}

/** The popover's head: its title — the Library, with what it holds, or what a file is being chosen
 *  for — which wraps where it is long, then Cancel (choosing) and ✕, which stay on its first line. */
export function libraryHead(c: Choosing | null): string {
  const e = escapeHtml;
  const title = !c
    ? `<b>Library</b>`
    : "link" in c
      ? `<b>Link ${e(subjectWords(c.link))} to a reference</b>`
      : `<b>Attach to the note “${e(c.label)}”</b>`;
  return (
    `<div class="lb-head"><div class="lb-head-t">${title}</div>` +
    (c ? `<button class="link" data-lb-cancel>Cancel</button>` : "") +
    `<button class="icon" data-lb-close aria-label="Close" title="Close (Esc)">✕</button></div>` +
    // attaching, what becomes of the file chosen, on a line of its own under the head
    (c && "attach" in c ? `<div class="muted lb-hint">An image is attached whole, a paper whole or by a clip of it.</div>` : "")
  );
}

/** The host of the address a file came from; the address itself where it is none (a log written
 *  by hand), rather than a list that cannot be drawn. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** A file's row in the library: its title (a field while it is renamed), its record in a line, and
 *  what can be done with it — opened (or chosen, choosing a file for something), renamed, archived or
 *  restored, its bytes added where this server lacks them; nothing that would be refused where the
 *  page changes nothing (`readOnly`: a read-only reader, a snapshot of the page). */
export function libraryRow(f: FileRecord & { have: boolean; links: number }, archived: boolean, s: { renaming: string | null; choosing: Choosing | null; readOnly: boolean }): string {
  const e = escapeHtml;
  const from = f.url ? `<a href="${e(f.url)}" target="_blank" rel="noopener noreferrer" title="${e(f.url)}">${e(hostOf(f.url))}</a>` : f.name ? `uploaded as ${e(f.name)}` : "uploaded";
  const meta = [f.type === "pdf" ? `PDF${f.pages ? ` · ${f.pages} p.` : ""}` : f.type.toUpperCase(), sizeWords(f.size), `${f.agent ? "🤖 " : ""}${e(f.by)}, ${libraryDate(f.at)}`, from, f.links ? `${f.links} link${f.links === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const title =
    s.renaming === f.sha
      ? `<form data-lb-rename="${f.sha}" class="lb-rename"><input value="${e(f.title)}" maxlength="300" aria-label="Title"><button class="rv-btn primary">Save</button></form>`
      : `<button class="lb-title" data-lb-open="${f.sha}" title="${!s.choosing ? "Open it in the reference window" : "link" in s.choosing ? "Link to a place in it" : f.type === "pdf" ? "Attach it to the note, whole or a clip of it" : "Attach it to the note"}">${f.type === "pdf" ? "📄" : "🖼"} ${e(f.title)}</button>`;
  // where nothing can be changed (a read-only reader, a snapshot of the page) nothing is offered
  // that would be refused: the list says why, once, under its head
  const no = s.readOnly;
  const acts = no
    ? ""
    : archived
      ? `<button class="link" data-lb-restore="${f.sha}">Restore</button>`
      : s.choosing
        ? ""
        : `<button class="link" data-lb-rename-start="${f.sha}">Rename</button><button class="link" data-lb-archive="${f.sha}" title="Archive: it leaves the library, its links say so; restored from Archived">Archive</button>`;
  const missing = f.have
    ? ""
    : `<div class="lb-missing">This server does not have this file.${no ? "" : ` <label class="link">Add it…<input type="file" data-lb-upload="${f.sha}" hidden></label> <span class="muted">(only a file of exactly this content)</span>`}</div>`;
  return `<div class="lb-row${archived ? " archived" : ""}">${title}<div class="lb-meta">${meta}</div>${missing}<div class="lb-acts">${acts}</div></div>`;
}

export class Library {
  private btn: HTMLElement;
  private pop: HTMLElement;
  private hooks: LibraryHooks;
  /** choosing a file: the one a subject is linked to, from a panel, or one to attach to a note */
  private choosing: Choosing | null = null;
  private listed: Listed | null = null;
  private busy = "";
  private error = "";
  private renaming: string | null = null;
  private showArchived = false;

  constructor(btn: HTMLElement, pop: HTMLElement, hooks: LibraryHooks) {
    this.btn = btn;
    this.pop = pop;
    this.hooks = hooks;
    btn.addEventListener("click", () => (this.pop.hidden ? this.show(null) : this.hide()));
    // a press anywhere else closes it, as the bar's other popovers
    document.addEventListener("pointerdown", (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !this.btn.contains(e.target as Node)) this.hide();
    });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (this.renaming) {
          this.renaming = null;
          return this.render();
        }
        this.hide();
        this.btn.focus();
      }
    });
    pop.addEventListener("click", (e) => this.clicked(e));
    pop.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      if (f.dataset.lbUrl !== undefined) void this.addUrl(f.querySelector("input")!.value);
      else if (f.dataset.lbRename !== undefined) void this.rename(f.dataset.lbRename, f.querySelector("input")!.value);
    });
    pop.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.lbUpload !== undefined && t.files?.length) void this.upload([...t.files], t.dataset.lbUpload || null);
    });
    // a file dropped on the list is added (dropped on the canvas, it makes a note: web/src/main.ts)
    pop.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        pop.classList.add("lb-drop");
      }
    });
    pop.addEventListener("dragleave", (e) => {
      if (!pop.contains(e.relatedTarget as Node)) pop.classList.remove("lb-drop");
    });
    pop.addEventListener("drop", (e) => {
      pop.classList.remove("lb-drop");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.upload(files, null);
    });
  }

  get open(): boolean {
    return !this.pop.hidden;
  }

  /** Open the library; choosing, for a panel's "Link to a reference…", the file a subject is linked to,
   *  or for a note's "Attach…", the file to attach to it. */
  show(choosing: Choosing | null): void {
    this.choosing = choosing;
    this.pop.hidden = false;
    this.btn.setAttribute("aria-expanded", "true");
    this.render();
    void this.load();
  }

  hide(): void {
    this.pop.hidden = true;
    this.choosing = null;
    this.renaming = null;
    this.btn.setAttribute("aria-expanded", "false");
  }

  /** The review changed: the list again, where it is open. */
  refresh(): void {
    if (this.open) void this.load();
  }

  private async load(): Promise<void> {
    const r = await fetch("/api/library").catch(() => null);
    this.listed = r?.ok ? ((await r.json()) as Listed) : null;
    if (this.open) this.render();
  }

  /** Answer a write: the change applied at once, or why it was refused. */
  private async post(path: string, init: RequestInit, what: string): Promise<{ file?: FileRecord & { have: boolean }; existed?: boolean; restored?: boolean } | null> {
    const no = this.hooks.cannot();
    if (no) {
      this.error = no;
      this.render();
      return null;
    }
    if (!(await this.hooks.ensureName())) return null;
    this.busy = what;
    this.error = "";
    this.render();
    const r = await fetch(path, { method: "POST", ...init, headers: { ...this.hooks.headers(), ...(init.headers as Record<string, string> | undefined) } }).catch(() => null);
    const b = (await r?.json().catch(() => null)) as { error?: string; hint?: string; change?: ReviewChange; file?: FileRecord & { have: boolean }; existed?: boolean; restored?: boolean } | null;
    this.busy = "";
    if (!r?.ok || !b) {
      this.error = b?.error ? `${b.error}${b.hint ? ` ${b.hint}` : ""}` : "The server could not be reached.";
      this.render();
      return null;
    }
    if (b.change) this.hooks.takeChange(b.change);
    await this.load();
    return b;
  }

  private async upload(files: File[], expect: string | null): Promise<void> {
    // what was refused, said once all are done: each file's request clears the word before it, and
    // a file refused before one taken was said for no time at all
    const refused: string[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE) {
        this.error = `${file.name} is ${sizeWords(file.size)}: a file of the library is at most ${sizeWords(MAX_FILE)}.`;
        refused.push(this.error);
        this.render();
        continue;
      }
      const b = await this.post(`/api/library/upload?name=${encodeURIComponent(file.name)}${expect ? `&sha=${expect}` : ""}`, { body: file, headers: { "content-type": "application/octet-stream" } }, `Adding ${file.name}…`);
      if (b?.file) this.added(b.file, !!b.existed, !!b.restored);
      else if (this.error) refused.push(files.length > 1 ? `${file.name}: ${this.error}` : this.error);
    }
    if (refused.length && this.open) {
      this.error = refused.join(" ");
      this.render();
    }
  }

  private async addUrl(url: string): Promise<void> {
    if (!url.trim()) return;
    const b = await this.post("/api/library/url", { body: JSON.stringify({ url: url.trim() }) }, "Fetching…");
    if (b?.file) this.added(b.file, !!b.existed, !!b.restored);
  }

  private added(f: FileRecord, existed: boolean, restored: boolean): void {
    this.hooks.say(restored ? `${f.title} is back in the library.` : existed ? `${f.title} is in the library already: the same file is kept once.` : `Added ${f.title}.`);
    // choosing a file to link to or attach: the one just added is it
    if (this.choosing) this.pick(f.sha);
  }

  private async rename(sha: string, title: string): Promise<void> {
    this.renaming = null;
    await this.post("/api/library/edit", { body: JSON.stringify({ sha, title }) }, "Renaming…");
  }

  private pick(sha: string): void {
    const s = this.choosing;
    this.hide();
    this.hooks.open(sha, s);
  }

  private clicked(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const at = (a: string) => t.closest<HTMLElement>(`[${a}]`)?.getAttribute(a) ?? null;
    if (t.closest("[data-lb-close]")) return this.hide();
    const open = at("data-lb-open");
    if (open) return this.pick(open);
    const ren = at("data-lb-rename-start");
    if (ren) {
      this.renaming = ren;
      this.render();
      this.pop.querySelector<HTMLInputElement>("[data-lb-rename] input")?.select();
      return;
    }
    const arch = at("data-lb-archive");
    if (arch) return void this.post("/api/library/archive", { body: JSON.stringify({ sha: arch, on: true }) }, "Archiving…");
    const back = at("data-lb-restore");
    if (back) return void this.post("/api/library/archive", { body: JSON.stringify({ sha: back, on: false }) }, "Restoring…");
    if (t.closest("[data-lb-archived]")) {
      this.showArchived = !this.showArchived;
      return this.render();
    }
    if (t.closest("[data-lb-cancel]")) {
      this.choosing = null;
      return this.render();
    }
  }

  private row(f: Listed["files"][number], archived: boolean): string {
    return libraryRow(f, archived, { renaming: this.renaming, choosing: this.choosing, readOnly: !!this.hooks.cannot() });
  }

  private render(): void {
    const l = this.listed;
    const e = escapeHtml;
    const files = l?.files ?? filesOf(this.hooks.review()).filter((f) => !f.archived).map((f) => ({ ...f, have: true, links: this.hooks.links(f.sha) }));
    const archived = l?.archived ?? [];
    const no = this.hooks.cannot();
    const c = this.choosing;
    this.pop.innerHTML =
      libraryHead(c) +
      (no
        ? `<div class="muted lb-note">${e(no)}</div>`
        : `<div class="lb-add"><label class="rv-btn primary lb-upload">Upload a file…<input type="file" data-lb-upload="" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/png,image/jpeg,image/webp,image/gif" hidden></label>` +
          `<span class="muted lb-dropnote">or drop PDFs and images here</span></div>` +
          `<form class="lb-url" data-lb-url><input type="url" placeholder="Add by URL: a PDF, an image, or an arXiv abstract" spellcheck="false" autocomplete="off" aria-label="The file's address"><button class="rv-btn">Add</button></form>`) +
      (this.busy ? `<div class="lb-busy">${e(this.busy)}</div>` : "") +
      (this.error ? `<div class="act-warn">${e(this.error)}</div>` : "") +
      `<div class="lb-list">${files.length ? files.map((f) => this.row(f, false)).join("") : `<div class="muted lb-none">Empty.</div>`}</div>` +
      (archived.length
        ? `<button class="link lb-arch-t" data-lb-archived>${this.showArchived ? "▾" : "▸"} Archived (${archived.length})</button>` + (this.showArchived ? `<div class="lb-list">${archived.map((f) => this.row(f, true)).join("")}</div>` : "")
        : "") +
      (l ? `<div class="muted lb-used">${sizeWords(l.used)} of ${sizeWords(l.limit)} · ${sizeWords(MAX_FILE)} a file at most</div>` : "");
  }
}
