// My personal link (CollabSpec decision 9, the owner's decision of 2026-10-19): the link a reader
// came by, shown to them alone, in the name's window, from the menu under their name
// (web/src/whomenu.ts) — so that they can open the site as themselves in another browser, on another
// device. The link, Copy, and one line: whoever has it is them. Nobody else is offered it, nor shown
// it: not whoever made it, not a guest, a read-only reader or an agent (the server refuses them).
//
// *Make my link anew*: a new secret for the same link — the same person, log and names. The old link,
// and every browser it let in, are cut off at once (said before it is done); this browser stays in,
// given the new cookie, and this page's event stream stays open. A link made before 0.6.0, of which
// the server kept only a digest, cannot be shown: its holder is offered this instead. And it is
// offered under any link, for a holder who thinks theirs leaked.
//
// The link is never copied by itself, as Share copies the links it makes: this one is a credential,
// copied when its holder asks.

import type { PersonInvite } from "../../shared/collab.ts";
import type { DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { copy } from "./share.ts";

/** What the window shows: the link asked for, the link — as it was, or just made anew (`made`) —,
 *  a link that cannot be shown (made before 0.6.0), the question before making it anew, or why it
 *  could not be had. */
export type MyLinkState =
  | { kind: "loading" }
  | { kind: "link"; link: string; made: boolean; copied: boolean | null }
  | { kind: "old" }
  | { kind: "confirm"; busy: boolean; error: string | null }
  | { kind: "error"; error: string };

/** What making the link anew does, said before it is done. */
export const ANEW =
  "You get a new link and stay who you are: your name, its ✓ and what you recorded stay yours. Your current link stops working at once, and every browser it let you in — on your other devices too — is cut off; this browser stays in.";

/** The window's content for `s`. */
export function myLinkHtml(s: MyLinkState): string {
  const title = (t: string) => `<div class="modal-title" id="mylink-title">${t}</div>`;
  const actions = (...bs: string[]) => `<div class="modal-actions">${bs.join("")}</div>`;
  const close = `<button type="button" class="rv-btn" data-ml-close>Close</button>`;
  switch (s.kind) {
    case "loading":
      return title("My personal link") + `<div class="modal-text">…</div>` + actions(close);
    case "error":
      return title("My personal link") + `<div class="modal-err">${escapeHtml(s.error)}</div>` + actions(close);
    case "link":
      return (
        title(s.made ? "Your new personal link" : "My personal link") +
        `<input class="sh-url ml-url" readonly value="${escapeHtml(s.link)}" aria-label="Your personal link" spellcheck="false">` +
        `<div class="modal-text">${s.made ? "Made anew: the old link lets nobody in any more. Open this one in your other browsers. " : ""}Whoever has this link comes in as you: keep it to yourself.</div>` +
        (s.copied === false ? `<div class="sh-note muted">Select it and copy it: this browser will not.</div>` : "") +
        `<div class="ml-anew"><span>Think someone else has it?</span><button type="button" class="rv-btn" data-ml-anew>Make it anew…</button></div>` +
        actions(close, `<button type="button" class="rv-btn primary" data-ml-copy>${s.copied ? "Copied" : "Copy"}</button>`)
      );
    case "old":
      return (
        title("My personal link") +
        `<div class="modal-text">Your link was made before VisualProof 0.6.0, when the server kept only a digest of it: it cannot be shown. Make it anew to have it here.</div>` +
        actions(close, `<button type="button" class="rv-btn primary" data-ml-anew>Make my link anew…</button>`)
      );
    case "confirm":
      return (
        title("Make your link anew?") +
        `<div class="modal-text">${ANEW}</div>` +
        (s.error ? `<div class="modal-err">${escapeHtml(s.error)}</div>` : "") +
        actions(`<button type="button" class="rv-btn" data-ml-cancel>Cancel</button>`, `<button type="button" class="rv-btn bad" data-ml-confirm${s.busy ? " disabled" : ""}>Make it anew</button>`)
      );
  }
}

export interface MyLinkHooks {
  data: Pick<DataSource, "myLink" | "renewMyLink">;
  /** this page's event stream's secret (`hello`), which stays open when the link is made anew; null
   *  before the stream said hello */
  stream(): string | null;
  /** the link was made anew: the same person, as the server says it now */
  renewed?(invite: PersonInvite): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The window, in the name's window's place (`#modal`): its box, `#mylink`, instead of the name's
 *  form while it shows. */
export class MyLink {
  private hooks: MyLinkHooks;
  private state: MyLinkState = { kind: "loading" };
  /** the state the question was asked from, to go back to on Cancel */
  private before: MyLinkState = { kind: "loading" };

  constructor(hooks: MyLinkHooks) {
    this.hooks = hooks;
    $("#mylink").addEventListener("click", (e) => {
      const t = e.target as Element;
      if (t.closest("[data-ml-close]")) this.close();
      else if (t.closest("[data-ml-copy]")) void this.copy();
      else if (t.closest("[data-ml-anew]")) this.ask();
      else if (t.closest("[data-ml-cancel]")) this.show(this.before);
      else if (t.closest("[data-ml-confirm]")) void this.renew();
    });
  }

  get isOpen(): boolean {
    return !$("#mylink").hidden;
  }

  /** Open the window and ask the server for the link. */
  async open(): Promise<void> {
    const modal = $("#modal");
    $("#who-form").hidden = true;
    $("#mylink").hidden = false;
    modal.hidden = false;
    modal.onkeydown = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      this.close();
    };
    // a click outside the box closes it
    modal.onpointerdown = (e) => {
      if (e.target === modal) this.close();
    };
    this.show({ kind: "loading" });
    const r = await this.hooks.data.myLink();
    if (!this.isOpen) return;
    if ("error" in r) return this.show({ kind: "error", error: r.error });
    this.show(r.link ? { kind: "link", link: r.link, made: false, copied: null } : { kind: "old" });
  }

  /** Close it, the focus back on the name, whose menu opened it. */
  close(): void {
    const modal = $("#modal");
    modal.hidden = true;
    modal.onkeydown = null;
    modal.onpointerdown = null;
    $("#mylink").hidden = true;
    $("#who-form").hidden = false;
    $("#who").focus();
  }

  /** Draw `s`, and put the focus where it is to be used: the link selected, to be copied; on the
   *  question, Cancel, so that no key makes the link anew by itself. */
  private show(s: MyLinkState): void {
    this.state = s;
    const box = $("#mylink");
    box.innerHTML = myLinkHtml(s);
    if (s.kind === "link") {
      const input = box.querySelector<HTMLInputElement>(".ml-url");
      input?.focus();
      input?.select();
    } else if (s.kind === "confirm") box.querySelector<HTMLElement>(s.busy ? "[data-ml-confirm]" : "[data-ml-cancel]")?.focus();
    else box.querySelector<HTMLElement>(".modal-actions .rv-btn:last-child")?.focus();
  }

  /** Ask before making the link anew. */
  private ask(): void {
    this.before = this.state;
    this.show({ kind: "confirm", busy: false, error: null });
  }

  private async renew(): Promise<void> {
    const s = this.state;
    if (s.kind !== "confirm" || s.busy) return;
    this.show({ ...s, busy: true, error: null });
    const r = await this.hooks.data.renewMyLink(this.hooks.stream());
    if (!this.isOpen) return;
    if ("error" in r) return this.show({ ...s, busy: false, error: r.error });
    this.before = { kind: "loading" };
    this.hooks.renewed?.(r.invite);
    this.show({ kind: "link", link: r.link, made: true, copied: null });
  }

  private async copy(): Promise<void> {
    const s = this.state;
    if (s.kind !== "link") return;
    const ok = await copy(s.link);
    this.show({ ...s, copied: ok });
  }
}
