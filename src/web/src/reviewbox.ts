// The review of one declaration (ReviewSpec, "What the page shows"): each reviewer's latest opinion
// and the history behind it, the comment box and the buttons, the key mark, the target mark, and for
// a target its progress, its view and linking it to another. It is one review box (the owner's
// decision of 2026-10-19): the panel's and each source window's, following or pinned, are the same
// box on their own declaration — the same controls, in the same order, under the same rules.
//
// An opinion records the text the reviewer judged. Where it has gone stale, "What changed" shows
// that text against the declaration's text now, line by line, so that a re-review reads the change
// rather than the whole declaration again.
//
// What agents advise (AgentSpec decision 2) is shown apart, under the reviewers' opinions and
// marked as an agent's: "Claude (agent) comments — …". It is not an opinion of the review and
// nothing here counts it.
//
// Key declarations (ExportSpec decision 1): where the review has a focus, a declaration its TCB holds,
// trusted or not, in the project or outside it (the owner's decision of 2026-10-19), or its review
// set, can be marked key for that target ("◇ Mark as key for …", "◆ Key for …"), in every review box
// alike; a target's box counts its key declarations apart, those that need review, "+N trusted"
// beside them.
//
// An opinion can be withdrawn (ReviewSpec decision 9, the owner's decision of 2026-10-19): Withdraw
// stands beside the current opinion of whoever the box records for — the reader, or the person they
// speak for (decision 8) — wherever a review box stands. An approval goes at once; a comment asks
// first. The opinion and its withdrawal stay in the history ("Alice withdrew their approval").
//
// Comments (ReviewSpec, "Comments", decided 2026-10-09) read as light Markdown (web/src/markdown.ts),
// people's and agents' alike. Each opinion with a comment has a Quote, which puts a quote of it into
// the comment box beside it, its attribution linking back to it (shared/comment.ts); a click on
// that link shows the opinion, scrolled to and flashed, going to its declaration first when it is
// another. A source window quotes lines of its code into its own box the same way (insert).

import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { insertBlock, MAX_COMMENT, opinionRef, parseRef, quoteOpinion } from "../../shared/comment.ts";
import type { OpinionRef } from "../../shared/comment.ts";
import { advice, current, findOpinion, fresh, judgedOn, keyMarked, STANDARD_AXIOMS, standing, statusOf, trustedBy } from "../../shared/review.ts";
import type { Author, Opinion, Progress, ReviewData, ReviewRequest } from "../../shared/review.ts";
import type { KeyCounts } from "../../shared/keys.ts";
import { nonStandardAxiom, offBoard } from "../../shared/reviewqueue.ts";
import type { Queue } from "../../shared/reviewqueue.ts";
import type { DeclarationText } from "../../shared/excerpt.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { agentName, BOT } from "./agentmark.ts";
import { escapeHtml } from "./highlight.ts";
import { lineDiff } from "./linediff.ts";
import type { LineDiff } from "./linediff.ts";
import { renderComment } from "./markdown.ts";
import { membersOf } from "./trust.ts";
import { invitedId, invitedNames, VERIFIED } from "./verified.ts";
import { reducedMotion } from "./theme.ts";
import { MAX_NAME, sameName } from "../../shared/collab.ts";

/** "3 h ago", for an opinion. */
export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return new Date(iso).toLocaleString();
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

const VERB: Record<Opinion["verdict"], string> = { approve: "approved", comment: "commented" };
/** what an opinion withdrawn was, as its withdrawal names it */
const NOUN: Record<Opinion["verdict"], string> = { approve: "approval", comment: "comment" };

export interface ReviewHooks {
  /** the review as it stands, whether it can be changed here, and who is reviewing: `error` says
   *  which lines of the logs cannot be read (the rest is read), `blocked` why this reader's own
   *  opinions are refused until their log is fixed by hand */
  /** the review, and whether it can be given here: `readOnly` in a snapshot or on a past graph, with
   *  what to say instead of the buttons (`note`; a snapshot's by default) */
  review(): { data: ReviewData; error: string | null; blocked: string | null; readOnly: boolean; note?: string; reviewer: string | null; person?: string | null };
  /** the reviewer's name; asks for it (a modal window) when there is none yet; null if they decline */
  ensureReviewer(): Promise<string | null>;
  /** record something; resolves to why it was refused, or null */
  submit(op: ReviewRequest): Promise<string | null>;
  /** tell the reader what was done, for a moment (an opinion withdrawn); else it is said in the box */
  said?(text: string): void;
  /** a target's review (web/src/reviewqueue.ts): its review set, and how far it has come */
  queue(i: number): Queue;
  progress(i: number): Progress;
  /** open the view a target is linked to, on the target (ViewSpec decision 29) */
  reviewLens(i: number): void;
  /** the view target `i` is linked to, as the panel tells it: its title — null where it has none (its
   *  view was deleted, ViewSpec decision 29) — whether it is the view on show, and why it cannot be
   *  linked to the view on show instead (null: it can); null where there is none to tell of */
  targetView?(i: number): { title: string | null; here: boolean; why: string | null } | null;
  /** link target `i` to the view on show, for everyone */
  linkHere?(i: number): void;
  /** whether the declaration's file changed since what the graph shows was compiled: known now
   *  (true, false) or not yet (null) */
  editedNow(i: number): boolean | null;
  /** the same, finding out if need be */
  edited(i: number): Promise<boolean>;
  /** a declaration's text in its file, as the source window shows it: null where there is none
   *  (outside the project, no place recorded, the file unreadable or the declaration gone from
   *  it), undefined while the file has not been read */
  textNow(i: number): DeclarationText | null | undefined;
  /** the same, reading the file if need be */
  text(i: number): Promise<DeclarationText | null>;
  /** the target the review's focus is on, or null (ViewSpec decision 28; web/src/focus.ts) */
  reviewRoot(): number | null;
  /** whether `i` can be key for `root` — a member of its TCB, trusted or not, or of its review set,
   *  never the target (ExportSpec decision 1) — and whether it is key for it (the target is) */
  keyable(root: number, i: number): boolean;
  isKey(root: number, i: number): boolean;
  /** how far the review of a target's key declarations has come: those that need review, the
   *  trusted counted apart */
  keyProgress(i: number): KeyCounts;
  /** open a view of a target's key declarations alone, `key(T)`; none on a page that makes no views
   *  (a read-only reader's, CollabSpec decision 11), which does not offer it */
  keyView?(i: number): void;
  /** go to declaration `i`: where a quoted opinion on it is shown */
  go(i: number): void;
  /** open the source of declaration `name` at lines `from`–`to` of its file, which read as
   *  `quoted` where the comment holds the code (a code quote's header): a link in a comment, clicked
   *  in `root` */
  openSource(name: string, from: number, to: number, quoted: string[] | null, root: HTMLElement): void;
}

/** how long a quoted opinion gone to, or quoted lines opened, flash (the style's vp-flash,
 *  web/style.css) */
export const FLASH_MS = 2400;

/** How tall a comment box is drawn: as many rows as what is written in it needs, within reason. */
const rowsFor = (text: string) => Math.min(12, Math.max(3, text.split("\n").length + 1));

/** A comment box as tall as what it holds, its wrapped lines too, within the bounds web/style.css
 *  gives it (`.rv-text`: taller in a source window): it grows as one writes, and never scrolls
 *  sideways (the owner's request, 2026-10-10). */
export function fitBox(box: HTMLTextAreaElement): void {
  // a box drawn nowhere (the tests' stand-ins) has nothing to measure
  if (!box.style) return;
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight + 2}px`;
}

const EDITED =
  "This file has changed since it was compiled. Review it once it is compiled again: an opinion " +
  "is about the compiled version, and that is not the text there is now.";

export class ReviewBox {
  g: Graph;
  private hooks: ReviewHooks;
  /** comments being written, per declaration, kept while the page is drawn again */
  private drafts = new Map<string, string>();
  /** the "What changed" disclosures that are open, by declaration, reviewer and time, kept while
   *  the page is drawn again */
  private opened = new Set<string>();
  /** diffs already worked out, by the two texts: the page is drawn again often, the texts rarely
   *  change */
  private diffs = new Map<string, LineDiff>();
  /** comments rendered, by declaration and text, on the graph `renderedOn`: the panel, the windows
   *  and Activity draw the same ones again and again */
  private rendered = new Map<string, string>();
  private renderedOn: Graph | null = null;
  /** a quoted opinion being gone to (its key, `opinionRef`): until when it is waited for where its
   *  review is drawn, since when it flashes (0: not yet), and the panel and windows that scrolled to
   *  it already */
  private flashing: { key: string; until: number; since: number; shown: WeakSet<HTMLElement> } | null = null;

  /** whom the opinions given on this page are for, where not the reader (ReviewSpec decision 8): it
   *  stays, on every review box, until changed back; kept for the tab */
  private speakingFor: string | null = readFor();

  constructor(g: Graph, hooks: ReviewHooks) {
    this.g = g;
    this.hooks = hooks;
  }

  /** Whom an opinion given now is for: another person's name, or null for the reader's own — their
   *  own name in any case is theirs, as the server takes it (server/reviewapi.ts, `voice`), so that no
   *  box says "Recording for" an opinion recorded as the reader's own. */
  private forName(): string | null {
    const f = this.speakingFor?.trim() || null;
    const me = this.hooks.review().reviewer?.trim();
    return f && !(me && sameName(f, me)) ? f : null;
  }

  /** The drafts not empty, kept across a reload into a new version (web/src/reload.ts). */
  get keptDrafts(): [string, string][] {
    return [...this.drafts].filter(([, v]) => v.trim() !== "");
  }

  /** The drafts kept by the reload that made this page (UpdateSpec decision 8). */
  restoreDrafts(kept: [string, string][]): void {
    for (const [k, v] of kept) if (!this.drafts.has(k)) this.drafts.set(k, v);
  }

  /** Keep what is typed into a comment box: the other boxes of the declaration show it too. Whom
   *  one speaks for, typed into any box, is every box's. */
  input(t: HTMLElement, i: number): void {
    if (t.matches("[data-rv-for]")) return this.speakFor((t as HTMLInputElement).value, t);
    if (!t.matches("[data-rv-comment]")) return;
    const name = this.g.nodes[i].name;
    const value = (t as HTMLTextAreaElement).value;
    this.drafts.set(name, value);
    this.mirror(name, value, t);
    fitBox(t as HTMLTextAreaElement);
  }

  /** The opinions given from now on are `name`'s (none: the reader's own): every review box on the
   *  page says so at once, without being drawn again (ReviewSpec decision 8). */
  private speakFor(name: string, except: Element | null): void {
    this.speakingFor = name.slice(0, MAX_NAME) || null;
    try {
      if (this.speakingFor) sessionStorage.setItem(FOR_KEY, this.speakingFor);
      else sessionStorage.removeItem(FOR_KEY);
    } catch {
      // a page that cannot keep it forgets it with the tab: nothing else changes
    }
    if (typeof document === "undefined") return;
    const f = this.forName();
    for (const b of document.querySelectorAll<HTMLInputElement>("input[data-rv-for]")) if (b !== except && b.value !== name) b.value = name;
    for (const on of document.querySelectorAll<HTMLElement>("[data-rv-for-on]")) {
      on.hidden = !f;
      on.innerHTML = f ? `Recording for <b>${escapeHtml(f)}</b> — their opinion, recorded by you` : "";
    }
    for (const w of document.querySelectorAll<HTMLElement>("[data-rv-for-who]")) w.textContent = f ? ` for ${f}` : "";
    // Withdraw beside the opinion of whoever the boxes record for now
    const mine = this.voiceMatch();
    for (const b of document.querySelectorAll<HTMLElement>("button[data-rv-withdraw]")) b.hidden = !mine({ by: b.dataset.rvBy ?? "", person: b.dataset.rvPerson });
  }

  /** Whose opinions Withdraw takes back (ReviewSpec decision 9): the person the boxes record for
   *  (decision 8), found as the server finds them (server/reviewapi.ts, voice) — someone invited by
   *  their link in force, else a guest by their name in any case — or else the reader: by their link
   *  where they were invited by one, else by their name as their log writes it. Never an agent's. */
  private voiceMatch(): (o: Author) => boolean {
    const f = this.forName();
    const R = this.hooks.review();
    if (f) {
      const id = invitedId(f);
      return (o) => !o.agent && (id ? o.person === id : !o.person && sameName(o.by, f));
    }
    const me = R.reviewer?.trim() ?? null;
    const person = R.person ?? null;
    return (o) => !o.agent && (person ? o.person === person : !!me && !o.person && o.by === me);
  }

  /** The names the "Speaking for" box offers: the people invited by a personal link and those the
   *  logs name, agents left out, the reader not; kept in the page's one list of them. */
  private people(d: ReviewData): void {
    if (typeof document === "undefined") return;
    const me = this.hooks.review().reviewer?.trim();
    const names = new Set(invitedNames());
    for (const ops of Object.values(d.opinions)) for (const o of ops) if (!o.agent) names.add(o.by);
    for (const t of Object.values(d.targets)) if (!t.agent) names.add(t.by);
    if (me) for (const n of names) if (sameName(n, me)) names.delete(n);
    let list = document.getElementById("rv-people");
    if (!list) {
      list = document.createElement("datalist");
      list.id = "rv-people";
      document.body.append(list);
    }
    const html = [...names].sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
    if (list.innerHTML !== html) list.innerHTML = html;
  }

  /** Every comment box of declaration `name` on the page but `except` shows `value`: the panel and
   *  a source window on the same declaration write one comment, so that what one of them holds is
   *  never lost to what the other held. */
  private mirror(name: string, value: string, except: Element | null): void {
    if (typeof document === "undefined") return;
    for (const b of document.querySelectorAll<HTMLTextAreaElement>("textarea[data-rv-comment]"))
      if (b !== except && b.dataset.rvComment === name && b.value !== value) {
        b.value = value;
        fitBox(b);
      }
  }

  /** A comment on declaration `name` as the page shows it (web/src/markdown.ts), here and in
   *  Activity. */
  comment(text: string, name: string): string {
    if (this.renderedOn !== this.g) {
      this.rendered.clear();
      this.renderedOn = this.g;
    }
    const key = `${name}\u0000${text}`;
    let html = this.rendered.get(key);
    if (html === undefined) {
      html = renderComment(text, name, this.g);
      this.rendered.set(key, html);
      if (this.rendered.size > 512) this.rendered.delete(this.rendered.keys().next().value!);
    }
    return html;
  }

  /** A click inside `root` on one of the review's controls; true when it was one. */
  click(t: HTMLElement, i: number, root: HTMLElement): boolean {
    const v = this.g.nodes[i];
    const R = this.hooks.review();
    // a comment's references: a quoted opinion, which is gone to; quoted source lines, opened there
    const op = t.closest<HTMLElement>("[data-md-op]");
    if (op) {
      const r = parseRef(op.dataset.mdOp!);
      if (r?.kind === "opinion") this.jump(r, i, root);
      return true;
    }
    const src = t.closest<HTMLElement>("[data-md-src]");
    if (src) {
      const r = parseRef(src.dataset.mdSrc!);
      if (r?.kind === "source") this.hooks.openSource(r.name, r.from, r.to, quotedCode(src), root);
      return true;
    }
    const quote = t.closest<HTMLElement>("[data-rv-quote]");
    if (quote) {
      this.quote(quote.dataset.rvQuote!, i, root);
      return true;
    }
    if (t.closest("[data-rv-lens]")) {
      this.hooks.reviewLens(i);
      return true;
    }
    if (t.closest("[data-rv-link]")) {
      this.hooks.linkHere?.(i);
      return true;
    }
    // the click opens or closes the disclosure after this: remember which way it goes
    const changes = t.closest("summary")?.parentElement;
    if (changes?.matches("details[data-rv-changes]")) {
      const key = (changes as HTMLElement).dataset.rvChanges!;
      if ((changes as HTMLDetailsElement).open) this.opened.delete(key);
      else this.opened.add(key);
      return true;
    }
    if (t.closest("[data-rv-keyview]")) {
      this.hooks.keyView?.(i);
      return true;
    }
    // a key declaration of the focus (ExportSpec decision 1)
    const key = t.closest<HTMLElement>("[data-rv-key]");
    if (key) {
      const r = this.hooks.reviewRoot();
      if (r === null || R.readOnly || R.blocked) return true;
      const target = this.g.nodes[r].name;
      return this.as(root, () => this.toggleKey(target, v.name));
    }
    // an opinion taken back (ReviewSpec decision 9)
    const wd = t.closest<HTMLElement>("[data-rv-withdraw]");
    if (wd) {
      this.withdraw(i, { by: wd.dataset.rvBy ?? "", ...(wd.dataset.rvPerson ? { person: wd.dataset.rvPerson } : {}) }, root);
      return true;
    }
    const verdict = t.closest<HTMLElement>("[data-rv]")?.dataset.rv as Opinion["verdict"] | undefined;
    if (verdict) {
      this.give(verdict, i, root);
      return true;
    }
    // an axiom the graph has no declaration for on the board, from its target's review box: the
    // comment written there is what Comment sends
    const ax = t.closest<HTMLElement>("[data-rv-ax]");
    if (ax) {
      this.giveAxiom(ax.dataset.rvAxv === "comment" ? "comment" : "approve", ax.dataset.rvAx!, i, root);
      return true;
    }
    // what a target is, the server works out (server/reviewapi.ts)
    if (t.closest("[data-rv-target]")) return this.as(root, () => this.hooks.submit({ op: "target", name: v.name, on: !Object.hasOwn(R.data.targets, v.name) }));
    return false;
  }

  /** Whether the review of declaration `i` compares a stale opinion with its source: drawn again
   *  once the file has been read. */
  needsSource(i: number): boolean {
    const v = this.g.nodes[i];
    const d = this.hooks.review().data;
    return current(d, v.name).some((o) => !fresh(o, v.hash) && judgedOn(d, v.name, o)?.of === "source");
  }

  private diff(before: string, after: string): LineDiff {
    const key = `${before}\u0000${after}`;
    let df = this.diffs.get(key);
    if (!df) {
      df = lineDiff(before, after);
      this.diffs.set(key, df);
      if (this.diffs.size > 32) this.diffs.delete(this.diffs.keys().next().value!);
    }
    return df;
  }

  /** "What changed" since a stale opinion was given: the text it was given on against the
   *  declaration's text now, in a disclosure under the opinion. */
  private changes(i: number, o: Opinion): string {
    const v = this.g.nodes[i];
    const esc = escapeHtml;
    const was = judgedOn(this.hooks.review().data, v.name, o);
    if (!was) return `<div class="rv-changes muted">The text it was given on was not recorded, so what changed cannot be shown.</div>`;
    const key = JSON.stringify([v.name, o.by, o.at]);
    const disclose = (summary: string, body: string) =>
      `<details class="rv-changes" data-rv-changes="${esc(key)}"${this.opened.has(key) ? " open" : ""}><summary>What changed${summary}</summary>${body}</details>`;
    let now: string | null;
    let note = "";
    if (was.of === "statement") {
      // there was no source to record: statements are compared, never a statement with a source
      now = v.type ?? null;
      note = `<div class="rv-cmp muted">Only the statement was recorded with this opinion; it is compared with the statement now.</div>`;
    } else {
      const src = this.hooks.textNow(i);
      if (src === undefined) return disclose("", `<div class="rv-cmp muted">Reading the source…</div>`);
      now = src?.text ?? null;
      // the file changed since it was compiled: what is there now is all there is to compare with
      if (src?.edited) note = `<div class="rv-cmp warn">Compared with the present text, which has not been compiled yet.</div>`;
    }
    if (now === null) return disclose("", `<div class="rv-cmp muted">There is no ${was.of} to compare with now.</div>`);
    const df = this.diff(was.text, now);
    if (!df.rows.length)
      return disclose(
        ` <span class="muted">— the same text</span>`,
        note + `<div class="rv-cmp muted">The text reads as it did; what changed is around it (an <code>open</code>, a <code>variable</code>, a notation) or in how Lean elaborates it.</div>`,
      );
    const rows = df.rows
      .map((r) => (r.op === "skip" ? `<div class="dl skip">⋯ ${r.lines} unchanged lines</div>` : `<div class="dl ${r.op}"><span>${esc(r.text)}</span></div>`))
      .join("");
    return disclose(
      ` <span class="rv-n">${df.added ? `<b class="add">+${df.added}</b>` : ""}${df.removed ? `<b class="del">−${df.removed}</b>` : ""}</span>`,
      note + `<div class="rv-delta" role="group" aria-label="Lines removed (−) and added (+) since this opinion">${rows}</div>`,
    );
  }

  /** Approve or comment on declaration `i`, as its buttons inside `root` do (the a and m keys come
   *  here too): a comment not yet written is asked for, the reviewer's name is asked for if there
   *  is none, an opinion on a file changed since it was compiled is refused. Where the buttons are
   *  not shown (a snapshot, a reader whose log cannot be read, a file known to be edited) nothing
   *  happens: `root` says why already. */
  give(verdict: Opinion["verdict"], i: number, root: HTMLElement): void {
    const v = this.g.nodes[i];
    const R = this.hooks.review();
    if (R.readOnly || R.blocked || this.hooks.editedNow(i) === true) return;
    const comment = (this.drafts.get(v.name) ?? "").trim();
    if (verdict === "comment" && !comment) {
      this.told(root, "Write the comment first, in the box.");
      root.querySelector<HTMLTextAreaElement>("[data-rv-comment]")?.focus();
      return;
    }
    // an opinion about text that is not what was compiled would be about nothing; what it is
    // about (the hash, the text judged) the server records from the graph (server/reviewapi.ts)
    const f = this.forName();
    this.send(root, v.name, async () => ((await this.hooks.edited(i)) ? EDITED : this.hooks.submit({ op: "opinion", name: v.name, verdict, comment: comment || undefined, ...(f ? { for: f } : {}) })));
  }

  /** Withdraw the opinion of `whose` on declaration `i`, as its Withdraw in `root` does (ReviewSpec
   *  decision 9): theirs as it stands — the reader's own, or that of the person they speak for,
   *  recorded as by the reader. An approval goes at once; a comment, whose text then leaves the
   *  review for its history, is asked about first. What was done is said. */
  withdraw(i: number, whose: Author, root: HTMLElement): void {
    const v = this.g.nodes[i];
    const R = this.hooks.review();
    if (R.readOnly || R.blocked) return;
    const o = standing(R.data, v.name, whose);
    if (!o) return this.told(root, "That opinion is no longer the one that stands.");
    const f = this.forName();
    const theirs = f ? `${o.by}'s` : "your";
    const what = `${theirs} ${NOUN[o.verdict]} ${o.verdict === "approve" ? "of" : "on"} ${this.g.short(i)}`;
    if (o.verdict === "comment" && typeof confirm === "function" && !confirm(`Withdraw ${what}? It stays in the history; ${f ? `${o.by} will have` : "you will have"} no opinion on ${this.g.short(i)}.`)) return;
    this.as(root, async () => {
      const why = await this.hooks.submit({ op: "withdraw", name: v.name, ...(f ? { for: f } : {}) });
      if (why) return why;
      const done = `Withdrew ${what}${f ? ", recorded by you" : ""}.`;
      if (this.hooks.said) this.hooks.said(done);
      else this.told(root, done);
      return null;
    });
  }

  /** Approve or comment on an axiom by its name, from the review box of target `i` (the board has
   *  no declaration for it): a comment is the one written there. */
  private giveAxiom(verdict: Opinion["verdict"], name: string, i: number, root: HTMLElement): void {
    const R = this.hooks.review();
    if (R.readOnly || R.blocked) return;
    const target = this.g.nodes[i].name;
    const comment = (this.drafts.get(target) ?? "").trim();
    if (verdict === "comment" && !comment) {
      this.told(root, `Write the comment on ${name} in the box above first.`);
      root.querySelector<HTMLTextAreaElement>("[data-rv-comment]")?.focus();
      return;
    }
    const f = this.forName();
    this.send(root, target, () => this.hooks.submit({ op: "opinion", name, verdict, comment: comment || undefined, ...(f ? { for: f } : {}) }));
  }

  /** Send an opinion with the comment written under `key` (the declaration's name; for an axiom,
   *  its target's): the comment is spent as it goes, so that the boxes drawn again with the change
   *  come empty, and the box in `root` is emptied once the opinion is taken. Refused, the comment
   *  is put back, in the box too if it was drawn again meanwhile, so that nothing typed is lost.
   *  What the reader typed while it went is theirs, and stays. */
  private send(root: HTMLElement, key: string, act: () => Promise<string | null>): void {
    this.as(root, async () => {
      const draft = this.drafts.get(key);
      this.drafts.delete(key);
      let why: string | null;
      try {
        why = await act();
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
      const box = root.querySelector<HTMLTextAreaElement>("[data-rv-comment]");
      const typed = this.drafts.has(key);
      if (why === null) {
        if (box && !typed) {
          box.value = "";
          box.rows = rowsFor("");
          this.mirror(key, "", box);
        }
      } else if (draft !== undefined && !typed) {
        this.drafts.set(key, draft);
        if (box && !box.value) box.value = draft;
      }
      return why;
    });
  }

  /** Quote an opinion on declaration `i`, by its key (its Quote, in `root`), into the comment being
   *  written there. */
  private quote(key: string, i: number, root: HTMLElement): void {
    const r = parseRef(key);
    if (r?.kind !== "opinion") return;
    const o = findOpinion(this.hooks.review().data, r.name, r.by, r.at);
    if (o?.comment) this.insert(root, i, quoteOpinion(r.name, { by: o.by, at: o.at, agent: o.agent, comment: o.comment }));
  }

  /** Put `block`, a quote, into the comment being written on declaration `i` in `root` (the panel,
   *  or a source window: each has its box): where the caret is while the box has the focus, else at
   *  its end, on lines of its own; then the caret after it, in the box, where the reader writes on.
   *  Refused, with why, where there is no box (nothing can be recorded here) or where the comment
   *  would grow longer than a comment can be: what was written stays as it was. */
  insert(root: HTMLElement, i: number, block: string): string | null {
    const name = this.g.nodes[i].name;
    const box = root.querySelector<HTMLTextAreaElement>("[data-rv-comment]");
    if (!box) return "There is no comment to write here.";
    const at = typeof document !== "undefined" && document.activeElement === box ? [box.selectionStart, box.selectionEnd] : [box.value.length, box.value.length];
    const next = insertBlock(box.value, at[0], at[1], block);
    const n = next.value.trim().length;
    if (n > MAX_COMMENT) {
      const why = `With this quote the comment would be ${n.toLocaleString("en")} characters long; a comment holds at most ${MAX_COMMENT.toLocaleString("en")}.`;
      this.told(root, why);
      return why;
    }
    box.value = next.value;
    box.rows = rowsFor(next.value);
    fitBox(box);
    this.drafts.set(name, next.value);
    this.mirror(name, next.value, box);
    box.focus();
    box.setSelectionRange(next.caret, next.caret);
    return null;
  }

  /** Go to a quoted opinion — its attribution clicked in `root`, which shows declaration `i`; from
   *  Activity, neither: it is shown where its review is drawn, scrolled to and flashed, its
   *  declaration gone to first when it is another. */
  jump(r: OpinionRef, i: number | null, root: HTMLElement | null): void {
    const j = this.g.byName.get(r.name) ?? this.g.foldedInto.get(r.name);
    if (j === undefined) {
      if (root) this.told(root, `${r.name} is not in the graph now.`);
      return;
    }
    // the opinion as it is keyed now: its writer, invited by a personal link, may have been renamed
    // since it was quoted (CollabSpec decision 9)
    const by = findOpinion(this.hooks.review().data, this.g.nodes[j].name, r.by, r.at)?.by ?? r.by;
    this.flashing = { key: opinionRef(this.g.nodes[j].name, by, r.at), until: Date.now() + 3000, since: 0, shown: new WeakSet() };
    if (j !== i || !root) return this.hooks.go(j);
    if (!this.reveal(root)) this.told(root, `That opinion of ${r.by}'s is not in the review now.`);
  }

  /** Once the review is drawn in `root`: a quoted opinion being gone to flashes there — in the
   *  history, opened, when it is not among the latest — and is scrolled to, once in each place.
   *  Drawn again while it flashes, it flashes on from where it was. Whether it is there. */
  reveal(root: HTMLElement): boolean {
    const f = this.flashing;
    if (!f) return false;
    const now = Date.now();
    if (now > (f.since ? f.since + FLASH_MS : f.until)) {
      this.flashing = null;
      return false;
    }
    const el = [...root.querySelectorAll<HTMLElement>("[data-rv-op]")].find((e) => e.dataset.rvOp === f.key);
    if (!el) return false;
    const hist = el.closest("details");
    if (hist) hist.open = true;
    // gone to again while it still flashed from before: from the start
    if (!f.since) {
      el.classList.remove("rv-flash");
      void el.offsetWidth;
    }
    el.style.animationDelay = f.since ? `${f.since - now}ms` : "";
    el.classList.add("rv-flash");
    if (!f.shown.has(root)) {
      f.shown.add(root);
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    f.since ||= now;
    return true;
  }

  /** Mark `name` key for `target`, or take the mark off: what it is now decides. */
  private toggleKey(target: string, name: string): Promise<string | null> {
    return this.hooks.submit({ op: "key", target, name, on: !keyMarked(this.hooks.review().data, target, name) });
  }

  /** Mark several declarations key for the target on show (the selection bar's "Mark selected as
   *  key"): those not marked yet, one after the other; why the first refused one was, or null. */
  async markKeys(names: string[]): Promise<string | null> {
    const root = this.hooks.reviewRoot();
    if (root === null) return "Focus on a target first (Focus, in the view's header): key declarations are a target's.";
    const target = this.g.nodes[root].name;
    if (!(await this.hooks.ensureReviewer())) return "A key declaration is marked under your name: give one first.";
    for (const n of names) {
      if (n === target || keyMarked(this.hooks.review().data, target, n)) continue;
      const why = await this.hooks.submit({ op: "key", target, name: n, on: true });
      if (why) return why;
    }
    return null;
  }

  /** Where the review has a focus, the toggle that marks declaration `i` key for that target, or
   *  says it is; "" elsewhere, for the target itself (always key) and for what its TCB does not
   *  hold. */
  private keyHtml(i: number): string {
    const root = this.hooks.reviewRoot();
    if (root === null || root === i || !this.hooks.keyable(root, i)) return "";
    const R = this.hooks.review();
    const on = this.hooks.isKey(root, i);
    const t = escapeHtml(this.g.short(root));
    const full = escapeHtml(this.g.nodes[root].name);
    if (R.readOnly || R.blocked) return on ? `<div class="rv-tag rv-key-tag">◆ Key for ${t}</div>` : "";
    return (
      `<button class="rv-btn rv-key${on ? " on" : ""}" data-rv-key aria-pressed="${on}" title="${on ? `A key declaration of ${full}: it matters for reading it, comes first in its review, and is printed in its exported document. Click to unmark (k)` : `Mark as a key declaration of ${full}: one that matters for reading it (the game, the scheme, the adversary). Key declarations come first in its review and make its exported document (k)`}">` +
      `${on ? "◆ Key" : "◇ Mark as key"} for ${t}</button>`
    );
  }

  /** What records something needs to know who says it, and asks once if it does not. */
  private as(root: HTMLElement, act: (me: string) => Promise<string | null>): true {
    void this.hooks.ensureReviewer().then((me) => (me ? act(me).then((why) => this.told(root, why)) : undefined));
    return true;
  }

  /** Why a request was refused, under the buttons in `root`. */
  private told(root: HTMLElement, why: string | null): void {
    if (!why) return;
    const box = root.querySelector<HTMLElement>(".rv-err");
    if (box) {
      box.textContent = why;
      box.hidden = false;
    }
  }

  /** The review box of declaration `i`, one wherever it stands (the panel, each source window):
   *  `tcb` is its TCB when the caller has it already. */
  html(i: number, tcb?: Uint8Array): string {
    const g = this.g;
    const v = g.nodes[i];
    const R = this.hooks.review();
    const d = R.data;
    const ext = g.isExt(i);
    const esc = escapeHtml;
    // whether a comment can be written here: then each comment can be quoted into it
    const writable = !R.readOnly && !R.blocked && this.hooks.editedNow(i) !== true;
    // an opinion's key, which its quotes link to, and its Quote
    const key = (o: Opinion) => esc(opinionRef(v.name, o.by, o.at));
    const quote = (o: Opinion) =>
      o.comment && writable ? ` <button type="button" class="rv-quote" data-rv-quote="${key(o)}" title="Quote this comment in yours, linking back to it">Quote</button>` : "";
    // Withdraw, beside the current opinion of whoever the box records for (ReviewSpec decision 9):
    // on every person's, shown on theirs alone, so that speaking for someone else moves it at once
    const mine = this.voiceMatch();
    const withdraw = (o: Opinion) =>
      R.readOnly || R.blocked || o.agent
        ? ""
        : ` <button type="button" class="rv-quote rv-withdraw" data-rv-withdraw data-rv-by="${esc(o.by)}"${o.person ? ` data-rv-person="${esc(o.person)}"` : ""}${mine(o) ? "" : " hidden"} title="Withdraw this ${NOUN[o.verdict]}: afterwards there is no opinion of ${esc(o.by)}'s here (an earlier one is not restored); it stays in the history">Withdraw</button>`;
    // `compare` (the latest ones): a stale opinion offers what changed since, and the reader's own
    // can be withdrawn
    const opinion = (o: Opinion, compare = false) => {
      const now = fresh(o, v.hash);
      return (
        // recorded for them by someone else: theirs, without the mark they did not give it under
        // (ReviewSpec decision 8)
        `<div class="rv-op rv-${o.verdict}${now ? "" : " old"}${o.withdrawn ? " withdrawn" : ""}" data-rv-op="${key(o)}"><span class="rv-dot"></span><b>${esc(o.by)}</b>${o.person && !o.recordedBy ? VERIFIED : ""} ${VERB[o.verdict]}` +
        ` <span class="muted">· ${ago(o.at)}${o.recordedBy ? ` · recorded by ${esc(o.recordedBy.by)}` : ""}${now ? "" : " · on an earlier version"}${o.withdrawn ? " · withdrawn" : ""}</span>${quote(o)}${compare ? withdraw(o) : ""}` +
        (o.comment ? `<div class="rv-c md">${this.comment(o.comment, v.name)}</div>` : "") +
        `</div>` +
        // beside the opinion, not in it: a stale opinion is faded, what changed must read clearly
        (compare && !now ? this.changes(i, o) : "")
      );
    };
    const now = current(d, v.name);
    const all = (Object.hasOwn(d.opinions, v.name) ? d.opinions[v.name] : []).filter((o) => !o.agent);
    const ops = now.length ? now.map((o) => opinion(o, true)).join("") : `<div class="muted">${all.length ? "No opinions now." : "No opinions yet."}</div>`;
    // the history: every opinion, and each withdrawal at its time (ReviewSpec decision 9), whose it
    // was and, where someone spoke for them, who typed it
    const withdrawal = (o: Opinion) =>
      `<div class="rv-op rv-wd" data-rv-wd="${key(o)}"><span class="rv-dot"></span><b>${esc(o.by)}</b>${o.person && !o.withdrawn!.recordedBy ? VERIFIED : ""} withdrew their ${NOUN[o.verdict]}` +
      ` <span class="muted">· ${ago(o.withdrawn!.at)}${o.withdrawn!.recordedBy ? ` · recorded by ${esc(o.withdrawn!.recordedBy.by)}` : ""}</span></div>`;
    const entries = all.flatMap((o) => [{ at: o.at, html: () => opinion(o) }, ...(o.withdrawn ? [{ at: o.withdrawn.at, html: () => withdrawal(o) }] : [])]);
    // in time order, an opinion before its withdrawal (a stable sort)
    entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const gone = all.filter((o) => o.withdrawn).length;
    const history =
      all.length > now.length
        ? `<details class="rv-hist"><summary>All ${all.length} opinions${gone ? ` · ${gone} withdrawn` : ""}</summary>${entries.map((x) => x.html()).join("")}</details>`
        : "";
    // each agent's latest advice, apart: what to look at first, not part of the review
    const adv = advice(d, v.name);
    const advised = adv.length
      ? `<div class="rv-advice"><div class="rv-adv-h">${BOT}Advice from agents <span class="muted">· not counted</span></div>` +
        adv
          .map((o) => {
            const on = fresh(o, v.hash);
            return (
              `<div class="rv-adv rv-adv-${o.verdict}${on ? "" : " old"}" data-rv-op="${key(o)}"><b>${esc(agentName(o.by))}</b> ${o.verdict === "approve" ? `suggests: <b class="rv-adv-v">approve</b>` : `<b class="rv-adv-v">comments</b>`}` +
              ` <span class="muted">· ${ago(o.at)}${on ? "" : " · on an earlier version"}</span>${quote(o)}` +
              (o.comment ? `<div class="rv-adv-c md">${this.comment(o.comment, v.name)}</div>` : "") +
              `</div>`
            );
          })
          .join("") +
        `</div>`
      : "";
    // a reviewer's new opinion replaces their earlier one (ReviewSpec decision 1); their current one
    // is withdrawn beside it (decision 9)
    let controls: string;
    if (R.readOnly) controls = `<div class="muted rv-note">${esc(R.note ?? "A snapshot shows the review as it was when it was taken.")}</div>`;
    else if (R.blocked) controls = `<div class="banner bad">${esc(R.blocked)}</div>`;
    else if (this.hooks.editedNow(i) === true)
      controls = `<div class="banner warn">${EDITED}</div>`;
    else {
      // whom the opinion is for (ReviewSpec decision 8): the reader, or another person by name
      this.people(d);
      const f = this.forName();
      controls =
        `<div class="rv-for-on" data-rv-for-on${f ? "" : " hidden"}>${f ? `Recording for <b>${esc(f)}</b> — their opinion, recorded by you` : ""}</div>` +
        `<textarea class="rv-text" data-rv-comment="${esc(v.name)}" rows="${rowsFor(this.drafts.get(v.name) ?? "")}" placeholder="Comment (optional with an approval) · Markdown" title="Markdown: &gt; quote, \`code\`, \`\`\`lean blocks, **bold**, *italics*; a declaration's full name in backticks links to it. Quote an opinion with its Quote, lines of code by selecting them in the source window">${esc(this.drafts.get(v.name) ?? "")}</textarea>` +
        `<div class="rv-actions"><button class="rv-btn approve" data-rv="approve" title="Approve (a), with the comment if there is one">Approve<span data-rv-for-who>${f ? ` for ${esc(f)}` : ""}</span></button>` +
        `<button class="rv-btn comment" data-rv="comment" title="Comment (m): send what you wrote in the box">Comment<span data-rv-for-who>${f ? ` for ${esc(f)}` : ""}</span></button>` +
        `<label class="rv-for" title="Record the opinion as another person's, at the same screen: it counts as theirs, recorded by you. Empty: your own">Speaking for <input class="rv-for-in" data-rv-for list="rv-people" value="${esc(this.speakingFor ?? "")}" placeholder="${esc(R.reviewer ?? "yourself")}" maxlength="${MAX_NAME}" spellcheck="false" autocomplete="off"></label>` +
        `</div><div class="rv-err" hidden></div>`;
    }
    // lines of someone's log that cannot be read: the rest of the review is read, and shown
    if (R.error && !R.readOnly && !R.blocked) controls += `<div class="banner warn">${esc(R.error)}</div>`;
    // trusted, and by what: taking that prefix off (Trusted, in the side panel) is how to undo it
    const by = trustedBy(d, v.name, v.module, ext);
    const why = STANDARD_AXIOMS.includes(v.name)
      ? ` <span class="muted">— a standard axiom, trusted without review</span>`
      : nonStandardAxiom(g, i)
        ? ` <span class="muted">— a non-standard axiom: it needs review whatever is trusted</span>`
        : by.length
        ? ` <span class="muted rv-trusted-by">— trusted without review, under ${by.map((p) => `<code>${esc(p)}</code>`).join(" and ")}</span>`
        : "";
    const head = `<div class="sec">Review${why}</div>`;
    const keyBtn = this.keyHtml(i);

    // a target: how far its review has come — its review set, and the axioms beside it
    // (shared/reviewqueue.ts)
    const target = Object.hasOwn(d.targets, v.name) ? d.targets[v.name] : undefined;
    let tgt = "";
    if (target) {
      tcb ??= g.reach([i], SITE_STMT | SITE_BODY, "out");
      const members = membersOf(g, tcb);
      // what is not counted, by what trusts it (the broadest prefix, when several do)
      const free = new Map<string, number>();
      for (const m of members) {
        const j = g.byName.get(m.name);
        if (j !== undefined && nonStandardAxiom(g, j)) continue;
        const reason = STANDARD_AXIOMS.includes(m.name) ? "standard axioms" : trustedBy(d, m.name, m.module, m.ext)[0];
        if (reason) free.set(reason, (free.get(reason) ?? 0) + 1);
      }
      const freeN = [...free.values()].reduce((a, b) => a + b, 0);
      const freeTitle = [...free].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n.toLocaleString()}`).join("\n");
      const p = this.hooks.progress(i);
      const open = p.total - p.approved - p.commented - p.stale;
      const pct = (x: number) => (p.total ? ((100 * x) / p.total).toFixed(1) : "0");
      // the key declarations apart (ExportSpec decision 4): approved of K, those that need review,
      // the target among them; the trusted ones beside them, never counted in
      const k = this.hooks.keyProgress(i);
      const kpct = (x: number) => (k.total ? ((100 * x) / k.total).toFixed(1) : "0");
      const keyLine =
        `<div class="rv-prog rv-keyprog" title="The key declarations that need review, the target among them: they come first in its review${k.trusted ? `; ${k.trusted} more are trusted, read with them and in need of no review` : ""}"><span class="key-mark">◆</span> Key: <b>${k.approved}</b> / ${k.total} approved` +
        (k.trusted ? ` <span class="muted rv-key-trusted">+${k.trusted} trusted</span>` : "") +
        (k.commented ? ` · <span class="commented">${k.commented} commented</span>` : "") + (k.stale ? ` · ${k.stale} stale` : "") +
        (k.total + k.trusted === 1 ? ` <span class="muted">— none marked besides the target</span>` : "") + `</div>` +
        `<div class="rv-bar rv-keybar"><i class="ok" style="width:${kpct(k.approved)}%"></i><i class="commented" style="width:${kpct(k.commented)}%"></i><i class="stale" style="width:${kpct(k.stale)}%"></i></div>`;
      tgt =
        `<div class="rv-target">${keyLine}<div class="rv-prog">All: <b>${p.approved}</b> / ${p.total} approved` +
        (p.commented ? ` · <span class="commented">${p.commented} commented</span>` : "") +
        (p.stale ? ` · ${p.stale} stale` : "") + ` · ${open} not yet reviewed` +
        (freeN ? ` <span class="muted" title="${esc(freeTitle)}">(${freeN} trusted, not counted)</span>` : "") + `</div>` +
        `<div class="rv-bar"><i class="ok" style="width:${pct(p.approved)}%"></i><i class="commented" style="width:${pct(p.commented)}%"></i><i class="stale" style="width:${pct(p.stale)}%"></i></div>` +
        this.axiomsHtml(i, R.readOnly || !!R.blocked) +
        this.viewHtml(i, R.readOnly || !!R.blocked) +
        `</div>`;
    }
    // a target is a declaration of the project (server/reviewapi.ts): one outside it is offered none
    const targetBtn =
      R.readOnly || R.blocked || (ext && !target)
        ? target
          ? `<div class="rv-tag">★ Target</div>`
          : ""
        : `<button class="rv-btn rv-tgt${target ? " on" : ""}" data-rv-target>${target ? "★ Target" : "☆ Mark as target"}</button>`;
    return `${head}<div class="rv">${ops}${history}${advised}${controls}${keyBtn}${targetBtn}${tgt}</div>`;
  }

  /** In target `i`'s review box, the view it is linked to (ViewSpec decision 29): Its view, which
   *  opens it, with its title; Key view; and Link to this view, where the view on show is another and
   *  may be its view. A target with no view (marking makes none, the owner's decision of 2026-10-12, and
   *  a view deleted leaves its targets with none) says so, and offers Link to this view and Key view;
   *  a click on the target gives it a view nobody keeps of its TCB (the owner's decision of
   *  2026-10-11). */
  private viewHtml(i: number, readOnly: boolean): string {
    const esc = escapeHtml;
    const name = this.g.nodes[i].name;
    const tv = this.hooks.targetView?.(i) ?? null;
    const key = this.hooks.keyView ? `<button class="rv-btn" data-rv-keyview title="A view of its key declarations alone, focused on it: key(${esc(name)})">Key view</button>` : "";
    const linkBtn = (title: string) =>
      tv?.why
        ? `<button class="rv-btn" disabled title="${esc(tv.why)}">Link to this view</button>`
        : `<button class="rv-btn" data-rv-link title="${esc(title)}">Link to this view</button>`;
    if (tv && tv.title === null) {
      // no view: the view on show may be linked to it; a click on the target gives it a temporary one
      const link = readOnly ? "" : linkBtn(`Make the view on show ★${name}'s, for everyone: clicking ★${name} opens it`);
      return `<div class="rv-view muted" title="${esc(`Clicking ★${name} opens a temporary view of its TCB, linked to it until it goes`)}">It has no view.</div><div class="rv-actions">${link}${key}</div>`;
    }
    const its = tv
      ? `<button class="rv-btn" data-rv-lens title="${esc(`The view ★${name} is linked to: ${tv.title}. Clicking ★${name} anywhere opens it, on the target`)}">Its view</button>`
      : `<button class="rv-btn" data-rv-lens title="Its view, on the target">Its view</button>`;
    const link = tv && !tv.here && !readOnly ? linkBtn(`Make the view on show ★${name}'s, for everyone: clicking ★${name} opens it. Its view now, ${tv.title}, keeps its scope and arrangement`) : "";
    const where = tv ? `<div class="rv-view muted">Its view: <b>${esc(tv.title!)}</b>${tv.here ? " — on show" : ""}</div>` : "";
    return `${where}<div class="rv-actions">${its}${key}${link}</div>`;
  }

  /** In target `i`'s review box, the non-standard axioms its review counts that the graph has no
   *  declaration for on the board: each with its status, where it comes in, and — where this page
   *  may record — Approve and Comment (Comment sends the comment written above). */
  private axiomsHtml(i: number, readOnly: boolean): string {
    const g = this.g;
    const d = this.hooks.review().data;
    const off = offBoard(this.hooks.queue(i));
    if (!off.length) return "";
    const esc = escapeHtml;
    return (
      `<div class="rv-axioms"><div class="rv-diff-h">Axioms outside the graph <span class="muted">${off.length} · counted, approved here</span></div>` +
      off
        .map((a) => {
          const s = statusOf(d, a.name, undefined);
          const where = a.via.length ? ` · comes in through ${a.via.map((j) => g.nodes[j].name).join(", ")}` : "";
          return (
            `<div class="row rv-${s}" title="${esc(`${a.name}: a non-standard axiom ${g.nodes[i].name} rests on${where}`)}"><b>axiom ${esc(a.name)}</b> <span class="muted">${s === "none" ? "not yet reviewed" : s}${esc(where)}</span>` +
            (readOnly
              ? ""
              : `<span class="rv-actions"><button class="rv-btn approve" data-rv-ax="${esc(a.name)}" data-rv-axv="approve">Approve</button>` +
                `<button class="rv-btn comment" data-rv-ax="${esc(a.name)}" data-rv-axv="comment" title="Send the comment written above">Comment</button></span>`) +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    );
  }
}

/** The code under a code quote's header, as its lines (the header clicked): null for a link to
 *  source lines with no code under it. */
function quotedCode(link: HTMLElement): string[] | null {
  const pre = link.matches(".md-cq-h") ? link.closest(".md-cq")?.querySelector("pre") : null;
  return pre?.textContent ? pre.textContent.split("\n") : null;
}

/** where a tab keeps whom its opinions are for (ReviewSpec decision 8) */
const FOR_KEY = "visualproof.speakingFor";

/** Whom this tab's opinions were for, where it said so: none in a page that cannot keep it. */
function readFor(): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(FOR_KEY);
  } catch {
    return null;
  }
}
