// Asking others to follow, in the page (CollabSpec decision 10, the owner's decision of 2026-10-12).
//
// Being asked: a banner at the top centre — "Alice asks you to follow · Follow · Not now" — with a
// countdown of 30 seconds; when it runs out, the request is declined by itself, and Esc declines it
// too. It never takes the focus: its buttons are out of the tab order and a press on them leaves the
// focus where it was, so that someone typing a comment keeps typing, and no key of theirs answers it
// but Esc, and that only with the focus outside a field. A second request while one shows replaces
// it, from the newest asker. It is a surface of the reader's own (web/src/surfaces.ts): nothing done
// in it ends following, but Follow starts following the asker, as a click on their initials does —
// their state applied as starting to follow applies it, and any following of someone else ended. A
// reader who follows the asker already is not asked: their page answers so at once, and shows nothing.
// An agent asks too (AgentSpec decision 8): the banner says so, with its mark.
//
// Asking: what each reader asked made of it — following now, declined, let it run out — on their
// initials (web/src/people.ts draws it) and in a short line under them ("2 following, 1 declined"),
// for a little while after.

import { colorOf, initials } from "../../shared/collab.ts";
import type { StreamHello } from "../../shared/collab.ts";
import { ASK_GRACE_MS, ASK_MS, askLine, foldAnswers } from "../../shared/askfollow.ts";
import type { AskAnswer, AskAnswered, AskFollow, AskSent, AskState } from "../../shared/askfollow.ts";
import { BOT } from "./agentmark.ts";
import type { DataSource } from "./data.ts";
import { escapeHtml } from "./highlight.ts";
import { VERIFIED } from "./verified.ts";

/** how long the outcome stays on the initials and in the line once the request is over */
export const LINGER_MS = 20_000;
/** how long something said in the line stays */
const SAID_MS = 5_000;
/** how often the countdown is drawn */
const TICK_MS = 250;
/** the countdown ring's circumference, its radius 9 */
const RING = 56.55;

/** Where a key was pressed, as Esc reads it: in a field (typing), or in a menu or a dialog with an
 *  Esc of its own. */
export interface EscWhere {
  field: boolean;
  menu: boolean;
}

export interface BannerHooks {
  /** whether this reader follows the person of `key` already (web/src/people.ts, personKey) */
  following(key: string): boolean;
  /** whether the person of `key` is here, to be followed */
  present(key: string): boolean;
  /** start following the person of `key`, as their initials' Follow does: their state applied, and
   *  any following of someone else ended (web/src/people.ts, follow) */
  follow(key: string): void;
  /** tell the server this page's answer */
  answer(id: string, answer: AskAnswer): void;
  /** something said for a moment */
  say(text: string): void;
}

/** The banner of a request to follow, shown to a page asked. */
export class AskBanner {
  private el: HTMLElement;
  private hooks: BannerHooks;
  private shown: { ask: AskFollow; key: string; until: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private secs: { textContent: string | null } | null = null;
  now = () => Date.now();

  constructor(el: HTMLElement, hooks: BannerHooks) {
    this.el = el;
    this.hooks = hooks;
    // a press on it leaves the focus where it was: a comment being typed keeps its caret
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      const b = (e.target as Element | null)?.closest?.("[data-ask]") as HTMLElement | null;
      if (!b) return;
      if (b.dataset.ask === "follow") this.followNow();
      else this.close("decline");
    });
  }

  /** The request shown, or null. */
  get showing(): AskFollow | null {
    return this.shown?.ask ?? null;
  }

  /** A request to follow the person of `key`: shown, in the place of any shown before (the server
   *  counts that one not answered); answered at once, and not shown, where this reader follows them
   *  already. */
  show(ask: AskFollow, key: string): void {
    if (this.hooks.following(key)) {
      this.hooks.answer(ask.id, "following");
      return;
    }
    this.stop();
    this.shown = { ask, key, until: this.now() + ask.ms };
    const who = `<b>${escapeHtml(ask.name)}</b>${ask.agent ? " (agent)" : ask.verified ? VERIFIED : ""}`;
    this.el.style.setProperty("--c", colorOf(ask.name));
    this.el.classList.toggle("agent", !!ask.agent);
    this.el.innerHTML =
      `<span class="ab-mark${ask.agent ? " agent" : ""}" aria-hidden="true">${ask.agent ? BOT : escapeHtml(initials(ask.name))}</span>` +
      `<span class="ab-text"><span class="ab-who">${who} asks you to follow</span>` +
      (ask.agent ? `<span class="ab-sub">An AI agent: following it opens its conversation</span>` : "") +
      `</span>` +
      `<span class="ab-count" title="Declined by itself when this runs out; Esc declines now" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" width="26" height="26"><circle class="ab-track" cx="12" cy="12" r="9"/><circle class="ab-left" cx="12" cy="12" r="9" stroke-dasharray="${RING}"/></svg>` +
      `<span class="ab-secs"></span></span>` +
      `<button type="button" class="rv-btn primary ab-follow" data-ask="follow" tabindex="-1">Follow</button>` +
      `<button type="button" class="rv-btn ab-no" data-ask="decline" tabindex="-1">Not now</button>` +
      `<span class="ab-bar" aria-hidden="true"><i></i></span>`;
    this.secs = this.el.querySelector(".ab-secs");
    this.el.hidden = false;
    this.count();
    this.timer = setInterval(() => this.count(), TICK_MS);
  }

  /** The request ended on the server (its asker left, or went private, or its time is over): it
   *  goes, unanswered. */
  end(id: string): void {
    if (this.shown?.ask.id === id) this.close(null);
  }

  /** Esc, pressed `where`: Not now, while a request shows and the focus is neither in a field nor
   *  in a menu or a dialog of its own. Whether it was taken. */
  escape(where: EscWhere): boolean {
    if (!this.shown || where.field || where.menu) return false;
    this.close("decline");
    return true;
  }

  /** The countdown, drawn; once it ran out, the request is declined by itself. */
  private count(): void {
    const s = this.shown;
    if (!s) return;
    const left = s.until - this.now();
    if (left <= 0) return this.close("timeout");
    const frac = Math.max(0, Math.min(1, left / s.ask.ms));
    this.el.style.setProperty("--left", frac.toFixed(3));
    this.el.style.setProperty("--ring", `${(RING * (1 - frac)).toFixed(2)}px`);
    if (this.secs) this.secs.textContent = String(Math.ceil(left / 1000));
  }

  private followNow(): void {
    const s = this.shown;
    if (!s) return;
    if (!this.hooks.present(s.key)) {
      this.hooks.say(`${s.ask.name} is not here any more.`);
      return this.close(null);
    }
    if (!this.hooks.following(s.key)) this.hooks.follow(s.key);
    this.close("follow");
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The banner goes, with this page's answer, if it gives one. */
  private close(answer: AskAnswer | null): void {
    const s = this.shown;
    if (!s) return;
    this.stop();
    this.shown = null;
    this.secs = null;
    this.el.hidden = true;
    this.el.innerHTML = "";
    if (answer) this.hooks.answer(s.ask.id, answer);
  }
}

export interface TallyHooks {
  /** the person a listed page is (web/src/people.ts, personKey), or null where it is not listed */
  personOf(id: string): string | null;
  /** the initials, which show each person's part, are to be drawn again */
  changed(): void;
}

/** A person's part, on their initials: a mark, and what it says. */
export function askMark(state: AskState | null, name: string): { cls: string; glyph: string; tip: string } | null {
  switch (state) {
    case "follow":
      return { cls: "ask-follow", glyph: "✓", tip: `${name} follows you now` };
    case "decline":
      return { cls: "ask-decline", glyph: "✕", tip: `${name} declined to follow you` };
    case "timeout":
      return { cls: "ask-timeout", glyph: "–", tip: `${name} did not answer` };
    case "waiting":
      return { cls: "ask-waiting", glyph: "…", tip: `Asked to follow you: waiting for ${name}` };
    default:
      return null;
  }
}

/** What the readers asked made of this page's request: by page, and the private ones counted. */
export class AskTally {
  private el: HTMLElement;
  private hooks: TallyHooks;
  private req: { id: string; pages: Map<string, AskAnswer | null>; priv: (AskAnswer | null)[]; until: number } | null = null;
  private said: string | null = null;
  private saidTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** answers that came before the request they answer: a page following the asker already answers
   *  the moment it is asked, which can be before the asking page is told its request went out */
  private early: AskAnswered[] = [];
  now = () => Date.now();

  constructor(el: HTMLElement, hooks: TallyHooks) {
    this.el = el;
    this.hooks = hooks;
  }

  /** A request went out: every page asked waits for its answer. */
  start(sent: AskSent): void {
    if (!sent.id) return;
    this.req = { id: sent.id, pages: new Map(sent.asked.map((id) => [id, null])), priv: sent.private ? new Array(sent.private).fill(null) : [], until: this.now() + sent.ms + ASK_GRACE_MS };
    this.said = null;
    // past its time, what was not answered was not: the server says so too, unless it cannot
    this.later(sent.ms + ASK_GRACE_MS + 1000, () => this.expire());
    const early = this.early.filter((a) => a.id === sent.id);
    this.early = [];
    for (const a of early) this.answered(a);
    this.changed();
  }

  /** A page's answer: a listed one by its id, a private one in the first place still open. */
  answered(a: AskAnswered): void {
    const r = this.req;
    if (!r || a.id !== r.id) {
      this.early = [...this.early, a].slice(-100);
      return;
    }
    if (a.from === null) {
      const k = r.priv.indexOf(null);
      if (k >= 0) r.priv[k] = a.answer;
    } else if (r.pages.has(a.from)) r.pages.set(a.from, a.answer);
    // a page renamed as it went private or visible again: its answer counts where one is open
    else {
      const k = r.priv.indexOf(null);
      if (k >= 0) r.priv[k] = a.answer;
    }
    if (this.over()) this.later(LINGER_MS, () => this.clear());
    this.changed();
  }

  /** The part of the person whose pages are `ids` in the request going on, or just over; null where
   *  they were not asked, or follow already (they were not asked, then). */
  stateOf(ids: readonly string[]): AskState | null {
    const r = this.req;
    if (!r) return null;
    const answers = ids.filter((id) => r.pages.has(id)).map((id) => r.pages.get(id)!);
    if (!answers.length) return null;
    const s = foldAnswers(answers);
    return s === "following" ? null : s;
  }

  /** The line under the initials: what was said a moment ago, else the outcome; null for none. */
  line(): string | null {
    if (this.said) return this.said;
    const r = this.req;
    if (!r) return null;
    const states = this.states();
    const counted = askLine(states);
    if (counted) return `Asked to follow you: ${counted}`;
    return states.length === 1 ? "They follow you already." : "Everyone you asked follows you already.";
  }

  /** Say something in the line for a moment: why a request was not made. */
  say(text: string): void {
    this.said = text;
    if (this.saidTimer) clearTimeout(this.saidTimer);
    this.saidTimer = setTimeout(() => {
      this.saidTimer = null;
      this.said = null;
      this.render();
    }, SAID_MS);
    this.render();
  }

  /** Each person's part, a private page's each its own. */
  private states(): AskState[] {
    const r = this.req!;
    const by = new Map<string, (AskAnswer | null)[]>();
    for (const [id, a] of r.pages) {
      const k = this.hooks.personOf(id) ?? `page:${id}`;
      by.set(k, [...(by.get(k) ?? []), a]);
    }
    return [...[...by.values()].map(foldAnswers), ...r.priv.map((a) => foldAnswers([a]))];
  }

  private over(): boolean {
    const r = this.req;
    return !!r && ([...r.pages.values()].every((a) => a !== null) && r.priv.every((a) => a !== null));
  }

  private expire(): void {
    const r = this.req;
    if (!r) return;
    for (const [id, a] of r.pages) if (a === null) r.pages.set(id, "timeout");
    r.priv = r.priv.map((a) => a ?? "timeout");
    this.later(LINGER_MS, () => this.clear());
    this.changed();
  }

  private clear(): void {
    this.req = null;
    this.changed();
  }

  private later(ms: number, f: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      f();
    }, ms);
  }

  private changed(): void {
    this.render();
    this.hooks.changed();
  }

  /** The line, drawn. */
  render(): void {
    const text = this.line();
    this.el.hidden = text === null;
    this.el.textContent = text ?? "";
  }
}

export interface AskingHooks {
  data: Pick<DataSource, "askFollow" | "answerAsk">;
  /** this page's event stream, as the server named it: its secret says which page asks */
  stream(): StreamHello | null;
  /** the reader's name, asking for one where there is none; null where they declined */
  ensureName(): Promise<string | null>;
  /** the server took no name from this page */
  lost(): void;
  /** the reader is private: nobody can follow them (CollabSpec decision 8) */
  isPrivate(): boolean;
  /** how many others a request to everyone would go to: the people listed but agents, and the
   *  private readers */
  others(): number;
  /** the person who asks, as web/src/people.ts keys them */
  keyOf(ask: AskFollow): string;
  following(key: string): boolean;
  present(key: string): boolean;
  follow(key: string): void;
  personOf(id: string): string | null;
  /** the initials are to be drawn again */
  changed(): void;
  say(text: string): void;
}

/** Asking, and being asked: the banner, the outcome, and the request itself. */
export class Asking {
  readonly banner: AskBanner;
  readonly tally: AskTally;
  private hooks: AskingHooks;
  /** when this page last asked, as far as it knows: the server holds every asker to one request per
   *  30 s, and the menus say so before it does */
  private last = -Infinity;
  now = () => Date.now();

  constructor(banner: HTMLElement, line: HTMLElement, hooks: AskingHooks) {
    this.hooks = hooks;
    this.banner = new AskBanner(banner, {
      following: (k) => hooks.following(k),
      present: (k) => hooks.present(k),
      follow: (k) => hooks.follow(k),
      answer: (id, a) => {
        const st = hooks.stream();
        if (st) hooks.data.answerAsk(st.token, id, a);
      },
      say: (t) => hooks.say(t),
    });
    this.tally = new AskTally(line, { personOf: (id) => hooks.personOf(id), changed: () => hooks.changed() });
  }

  /** Why this reader cannot ask now — everyone (`all`), or one person — or null where they can. */
  why(all: boolean): string | null {
    if (this.hooks.isPrivate()) return "You are private: nobody can follow you. Go visible to ask.";
    const wait = Math.ceil((this.last + ASK_MS - this.now()) / 1000);
    if (wait > 0) return `You asked a moment ago: ask again in ${wait} s.`;
    if (all && this.hooks.others() === 0) return "Nobody else is here to ask.";
    return null;
  }

  /** Ask everyone to follow this reader, or the person whose page is `to` (by its id, with their
   *  name): under the reader's name, asked for where there is none. Why not is said in the line. */
  async ask(to: { id: string; name: string } | null): Promise<void> {
    const no = this.why(to === null);
    if (no) return this.tally.say(no);
    if ((await this.hooks.ensureName()) === null) return;
    const st = this.hooks.stream();
    if (!st) return this.tally.say("Not connected to the server: try again in a moment.");
    const r = await this.hooks.data.askFollow(st.token, to?.id ?? null);
    if ("error" in r) {
      if (r.who) this.hooks.lost();
      if (r.retryAfter) this.last = this.now() + r.retryAfter * 1000 - ASK_MS;
      return this.tally.say(r.error);
    }
    if (!r.id) return this.tally.say(to ? `${to.name} is not here any more.` : "Nobody else is here to ask.");
    this.last = this.now();
    this.tally.start(r);
  }

  /** A request to follow someone came (`ask`). */
  asked(ask: AskFollow): void {
    this.banner.show(ask, this.hooks.keyOf(ask));
  }

  /** An answer to this page's request came (`ask-answer`). */
  answered(a: AskAnswered): void {
    this.tally.answered(a);
  }

  /** A request ended on the server (`ask-end`). */
  ended(id: string): void {
    this.banner.end(id);
  }
}
