// The conversation's box (CollabSpec decision 13, the owner's decisions of 2026-10-19): where a
// message is written. A link of this site never shows there as its address: pasted, dropped or
// inserted (the box's button: a link to what the reader sees), it is its chip, as in a message
// (web/src/chatlinks.ts), and stands for the link when the message is sent. `@` and the start of a
// name offers the people online and the agents listed to complete it (shared/mentions.ts).
//
// So the box is an editable element rather than a text field: its text is text nodes, a chip is an
// element it cannot edit (`contenteditable=false`) holding its link, and what it says is read back as
// text (`textOf`), each chip its link, apart from the words around it. What comes in is plain text
// whatever it was — a paste, a drop —, never the writer's HTML, and the browser's formatting keys do
// nothing. Enter sends and Shift+Enter makes a new line, but an Enter that commits an input method's
// composition only commits it (web/src/ime.ts); Esc closes the completions first, then leaves the box.

import { completions, typingMention } from "../../shared/mentions.ts";
import type { Mentionable } from "../../shared/mentions.ts";
import { segments } from "./chatlinks.ts";
import { escapeHtml } from "./highlight.ts";
import { composing } from "./ime.ts";

/** A node of the box as the reader of its text sees it: a text node, a chip (its link in
 *  `data-href`), a line break, or an element holding others (what a browser may make on its own). */
export interface BoxNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<BoxNode>;
  dataset?: { href?: string; end?: string };
}

const BLOCK = new Set(["DIV", "P", "LI"]);

/** What the box says, as text: its text, each chip as its link — kept apart from the words beside it
 *  by a space, so that the link reads back as one — and a line for each break. */
export function textOf(root: BoxNode): string {
  let out = "";
  const add = (s: string) => (out += s);
  const walk = (n: BoxNode, first: boolean) => {
    if (n.nodeType === 3) return add(n.textContent ?? "");
    if (n.nodeType !== 1) return;
    const href = n.dataset?.href;
    if (href) {
      if (out && !/\s$/.test(out)) add(" ");
      add(href);
      add(" ");
      return;
    }
    // a line break, but the one that only lets the caret stand on an empty last line
    if (n.nodeName === "BR") return n.dataset?.end === undefined ? add("\n") : undefined;
    if (BLOCK.has(n.nodeName) && !first && out && !out.endsWith("\n")) add("\n");
    Array.from(n.childNodes).forEach((c, k) => walk(c, k === 0));
  };
  Array.from(root.childNodes).forEach((c, k) => walk(c, k === 0));
  // the space a chip was given at the end, or before a line break, says nothing
  return out.replace(/ +(\n|$)/g, "$1");
}

export interface InputHooks {
  /** a link of this site as its chip's inner HTML, or null for a link it is not (or cannot read) */
  chip(url: string): string | null;
  /** `text` with every link of this site that lets in made keyless (web/src/chatlinks.ts,
   *  `withoutKeys`) */
  unkeyed(text: string): string;
  /** Enter: send what the box says */
  send(): void;
  /** what the box says changed (its draft is kept) */
  changed(): void;
  /** the names a mention may be completed with: the people online, the agents listed */
  names(): Mentionable[];
}

export class ChatInput {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private hooks: InputHooks;
  /** the completions shown, the one chosen, and the mention they complete: its text node, its `@` */
  private choices: Mentionable[] = [];
  private at = 0;
  private typed: { node: Text; start: number; end: number } | null = null;

  constructor(el: HTMLElement, list: HTMLElement, hooks: InputHooks) {
    this.el = el;
    this.list = list;
    this.hooks = hooks;
    el.addEventListener("keydown", (e) => this.key(e));
    el.addEventListener("input", () => {
      // emptied: no line break a browser left, so that the placeholder shows
      if (!el.textContent && !el.querySelector("[data-href]")) el.replaceChildren();
      this.complete();
      this.hooks.changed();
    });
    // the caret moved: the completions follow it
    el.addEventListener("keyup", (e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) this.complete();
    });
    el.addEventListener("click", () => this.complete());
    el.addEventListener("blur", () => setTimeout(() => !this.el.contains(document.activeElement) && this.closeList(), 150));
    // what comes in is plain text, its links of this site as chips
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      this.insertText(e.clipboardData?.getData("text/plain") ?? "");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const t = e.dataTransfer?.getData("text/plain") ?? "";
      if (!t) return;
      // where it was dropped
      const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (at) setSelection(at);
      this.insertText(t);
    });
    // the browser's own formatting (bold, italics…) is no part of a message: Markdown is
    el.addEventListener("beforeinput", (e) => {
      if (e.inputType.startsWith("format") || e.inputType === "insertFromDrop" || e.inputType === "insertFromPaste") e.preventDefault();
    });
    list.addEventListener("pointerdown", (e) => {
      // the box keeps the focus
      e.preventDefault();
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
      if (b) this.choose(Number(b.dataset.k));
    });
  }

  /** What the box says, as text (`textOf`). */
  get text(): string {
    return textOf(this.el as unknown as BoxNode);
  }

  /** The box says `text`, its links of this site as chips. */
  set text(text: string) {
    const nodes = this.nodesOf(text);
    if (nodes.at(-1)?.nodeName === "BR") {
      const end = document.createElement("br");
      end.dataset.end = "";
      nodes.push(end);
    }
    this.el.replaceChildren(...nodes);
    this.closeList();
  }

  /** Whether it can be written in, and what it says while empty. */
  enable(on: boolean, placeholder: string): void {
    this.el.contentEditable = on ? "true" : "false";
    this.el.setAttribute("aria-disabled", String(!on));
    this.el.dataset.placeholder = placeholder;
    this.el.classList.toggle("off", !on);
    if (!on) this.closeList();
  }

  focus(): void {
    this.el.focus();
  }

  /** Put `text` where the caret is (at the end, where it is not in the box): its links of this site
   *  as chips; the caret after it. */
  insertText(text: string): void {
    const nodes = this.nodesOf(text.replace(/\r\n?/g, "\n"));
    if (!nodes.length) return;
    const r = this.range();
    r.deleteContents();
    const last = nodes[nodes.length - 1];
    for (const n of nodes.reverse()) r.insertNode(n);
    // the caret in text, after what was put: at an element's edge beside an uneditable chip the
    // browser draws it before the chip, so a chip with no words after it is given a space to stand on
    const after = document.createRange();
    // inserting into words splits them, and may leave an empty text node after what was put: no words
    const next = last.nextSibling;
    const place = caretAfter(last instanceof Text ? "text" : isChip(last) ? "chip" : "other", next instanceof Text && next.length > 0);
    if (place === "end") after.setStart(last, (last as Text).length);
    else if (place === "next") after.setStart(next as Text, 0);
    else if (place === "space") {
      const space = document.createTextNode(" ");
      (last as ChildNode).after(space);
      after.setStart(space, 1);
    } else after.setStartAfter(last);
    after.collapse(true);
    // inserting split a text node, leaving an empty one: gone, the words beside joined again (the
    // caret, a live range, keeps its place in what they become)
    this.el.normalize();
    setSelection(after);
    // a line break last in the box shows no line of its own: one more, which says nothing, lets the
    // caret stand on the new line
    if (last.nodeName === "BR" && last.isConnected && !last.nextSibling) {
      const end = document.createElement("br");
      end.dataset.end = "";
      this.el.append(end);
    }
    this.hooks.changed();
    this.complete();
  }

  /** A link inserted where the caret is, as its chip, with a space after it. */
  insertLink(url: string): void {
    this.insertText(`${url} `);
  }

  /** The caret's place in the box, or its end where the caret is not in it. */
  private range(): Range {
    const sel = getSelection();
    if (sel && sel.rangeCount && this.el.contains(sel.getRangeAt(0).commonAncestorContainer)) return sel.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(this.el);
    r.collapse(false);
    return r;
  }

  /** `text` as the box's nodes: words as text, a line break for each new line, links of this site
   *  as chips — without the secret of a link that lets in (`withoutKeys`). */
  private nodesOf(text: string): Node[] {
    const out: Node[] = [];
    for (const s of segments(this.hooks.unkeyed(text), (url) => this.hooks.chip(url) !== null)) {
      if ("url" in s) {
        out.push(chipNode(s.url, this.hooks.chip(s.url)!));
        continue;
      }
      s.text.split("\n").forEach((line, k) => {
        if (k) out.push(document.createElement("br"));
        if (line) out.push(document.createTextNode(line));
      });
    }
    return out;
  }

  private key(e: KeyboardEvent): void {
    if (this.el.contentEditable !== "true") return;
    if (!this.list.hidden && this.choices.length) {
      const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (move) {
        e.preventDefault();
        this.at = (this.at + move + this.choices.length) % this.choices.length;
        return this.drawList();
      }
      if ((e.key === "Enter" || e.key === "Tab") && !composing(e)) {
        e.preventDefault();
        return this.choose(this.at);
      }
      if (e.key === "Escape") {
        // the completions close; the box keeps the focus, and the next Esc leaves it
        e.preventDefault();
        e.stopPropagation();
        return this.closeList();
      }
    }
    if (e.key !== "Enter" || composing(e)) return;
    e.preventDefault();
    // Shift+Enter: a new line; Enter: send
    if (e.shiftKey) this.insertText("\n");
    else this.hooks.send();
  }

  /** The completions of the mention being typed at the caret, or none. */
  private complete(): void {
    const sel = getSelection();
    const node = sel?.anchorNode;
    if (!sel?.isCollapsed || !node || node.nodeType !== 3 || !this.el.contains(node)) return this.closeList();
    const text = (node as Text).data;
    const m = typingMention(text, sel.anchorOffset);
    const choices = m ? completions(m.query, this.hooks.names()) : [];
    if (!m || !choices.length) return this.closeList();
    this.typed = { node: node as Text, start: m.start, end: sel.anchorOffset };
    this.choices = choices;
    this.at = Math.min(this.at, choices.length - 1);
    this.drawList();
  }

  private drawList(): void {
    this.list.hidden = false;
    this.list.innerHTML = this.choices
      .map((c, k) => `<button type="button" role="option" class="cv-mention${k === this.at ? " on" : ""}${c.agent ? " agent" : ""}" aria-selected="${k === this.at}" data-k="${k}" tabindex="-1">@${escapeHtml(c.name)}${c.agent ? ' <span class="muted">agent</span>' : ""}</button>`)
      .join("");
  }

  private closeList(): void {
    this.list.hidden = true;
    this.choices = [];
    this.at = 0;
    this.typed = null;
  }

  /** A completion chosen: the mention typed so far becomes `@` and the name, and a space. */
  private choose(k: number): void {
    const c = this.choices[k];
    const t = this.typed;
    if (!c || !t || !t.node.isConnected) return this.closeList();
    const said = `@${c.name} `;
    t.node.replaceData(t.start, t.end - t.start, said);
    const r = document.createRange();
    r.setStart(t.node, t.start + said.length);
    r.collapse(true);
    setSelection(r);
    this.closeList();
    this.hooks.changed();
  }
}

/** A chip in the box: what the link leads to, standing for it. */
/** Where the caret goes after what was put in the box, by what came last and whether words follow:
 *  the end of the words put (`end`); the start of the words after a chip (`next`); after a space
 *  given to a chip that ends the box or comes before a line break (`space`); else after the node
 *  (`after`: a line break). */
export function caretAfter(last: "text" | "chip" | "other", wordsNext: boolean): "end" | "next" | "space" | "after" {
  if (last === "text") return "end";
  if (last === "chip") return wordsNext ? "next" : "space";
  return "after";
}

const isChip = (n: Node): boolean => n instanceof HTMLElement && n.classList.contains("cv-chip");

function chipNode(url: string, html: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "cv-chip in-box";
  el.contentEditable = "false";
  el.dataset.href = url;
  el.innerHTML = html;
  return el;
}

function setSelection(r: Range): void {
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}
