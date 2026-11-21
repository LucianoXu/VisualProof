// The call (CallSpec): its button in the bar and the notices under it, its window — a floating window
// the reader moves, resizes, collapses and maximizes (web/src/floatwin.ts; CallSpec decision 5) —,
// what the server says of the call (`call`, `call-invite`, `call-removed`, `call-ended`), the call
// link (`?call`: decision 6), and rejoining after a reload. The call itself — the pre-join, the
// tiles, the controls — is its own bundle (web/src/call/main.ts, `call.js`), loaded the first time
// the window opens: a page that never opens it carries none of LiveKit.
//
// The call is the reader's own (CollabSpec decision 4): following never opens, closes or moves its
// window, and nothing in it ends following; the window's place and size are kept in this browser.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { personKey } from "../../shared/collab.ts";
import type { CallBy, CallInvite, CallState } from "../../shared/call.ts";
import { clampRect, EDGE, FloatWindow, readKept } from "./floatwin.ts";
import type { Kept, Rect, Size } from "./floatwin.ts";
import { callTab } from "./call/tab.ts";
import { callIcon } from "./call/icons.ts";
import { clockText, namesLine } from "./call/model.ts";
import type { CallEnv, CallView, StartCall } from "./call/env.ts";
import { copy } from "./share.ts";
import { escapeHtml } from "./highlight.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** the smallest the reader can make the window, viewport permitting */
export const MIN: Size = { w: 300, h: 200 };
/** its size at first (the owner's decision of 2026-11-20) */
export const DEFAULT: Size = { w: 720, h: 480 };
/** the board's foot, from the viewport's bottom: the window starts above it */
const FOOT = 56;
/** how long a page that went in a call may come back and rejoin it */
export const REJOIN_MS = 5 * 60_000;
const REJOIN_KEY = "visualproof:call:rejoin";

/** Where the window starts: at the bottom right of the board, DEFAULT large where it fits. */
export function defaultRect(vp: Size): Rect {
  const w = Math.min(DEFAULT.w, vp.w - 2 * EDGE);
  const h = Math.min(DEFAULT.h, vp.h - FOOT - EDGE);
  return clampRect({ x: vp.w - EDGE - w, y: vp.h - FOOT - h, w, h }, vp, MIN);
}

/** What the call gives the page's other parts. */
export interface CallPart {
  calls: Calls;
}

export interface Calls {
  /** the server has a call (--livekit-url), and this reader may join it */
  readonly on: boolean;
  /** this page is in the call now */
  readonly inCall: boolean;
  /** what the server says of the call (`call`) */
  heard(s: CallState): void;
  invited(i: CallInvite): void;
  removed(b: CallBy): void;
  ended(b: CallBy): void;
  /** the page's event stream said hello again (the server came back): a page in the call is the
   *  server's again */
  connected(): void;
  /** the call link for this page, as Share and the window copy it */
  link(): Promise<string>;
}

const viewport = (): Size => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

export function callPart(page: Page): CallPart {
  const { data, store, reader, site } = page;
  const el = $("#call");
  const body = el.querySelector<HTMLElement>(".cl-body")!;
  const btn = $("#call-btn");
  const badge = $("#call-badge");
  const notice = $("#call-notice");
  /** what this tab calls itself in the call, answering for itself from now on */
  const tab = data.snapshot ? null : callTab();
  /** a call link opened this page (`?call`): its pre-join opens once the server says it has a call;
   *  the address goes without it */
  let asked = new URLSearchParams(location.search).has("call");
  if (asked) {
    try {
      history.replaceState(history.state, "", location.pathname + location.hash);
    } catch {
      // the address keeps it: harmless
    }
  }
  /** a page reloaded in a call: the session it was in, and its microphone and camera */
  type Rejoin = { session: string; at: number; mic: boolean; cam: boolean };
  let rejoin: Rejoin | null = null;
  try {
    const r = JSON.parse(sessionStorage.getItem(REJOIN_KEY) ?? "null") as Rejoin | null;
    if (r && typeof r.session === "string" && Date.now() - r.at < REJOIN_MS) rejoin = { session: r.session, at: r.at, mic: !!r.mic, cam: !!r.cam };
  } catch {
    rejoin = null;
  }
  const forgetRejoin = () => {
    rejoin = null;
    try {
      sessionStorage.removeItem(REJOIN_KEY);
    } catch {
      // nothing kept
    }
  };

  let state: CallState | null = null;
  /** a read-only reader's link joins the call (CallSpec decision 4), as the server says */
  let readOnlyCall = false;
  if (reader === "link" && !data.snapshot)
    void data.identity().then((id) => {
      readOnlyCall = !!id.readOnly?.call;
      // the server may have told of the call before: the button, and a call link's pre-join, now
      drawButton();
      if (asked && state && may()) {
        asked = false;
        void open();
      }
    });
  let shown = false;
  let view: CallView | null = null;
  let loading: Promise<StartCall> | null = null;
  /** the name a read-only reader gave, for a token asked again */
  let roName: string | null = null;
  /** when LiveKit last put this page out of the call as ended or removed; when the server last said
   *  who ended the call or removed this page */
  let droppedAt = -Infinity;
  let namedAt = -Infinity;

  const may = () => !data.snapshot && (reader === null || (reader === "link" && readOnlyCall));
  const inCall = () => !!view?.inCall;

  // ---------------------------------------------------------------- the window

  const win = new FloatWindow(el, {
    min: MIN,
    handle: ".cl-head",
    collapser: "[data-collapse]",
    opener: ".fl-pill-open",
    maximizer: "[data-cl-max]",
    keeper: {
      read: () => store.data.call,
      write: (change: Kept) => {
        store.data.call = { ...readKept(store.data.call), ...change };
        store.save();
      },
    },
    start: (vp) => defaultRect(vp),
    live: () => shown,
    // maximized, it keeps under the bars, which stay the reader's
    top: () => $("#viewbar").getBoundingClientRect().bottom + 8,
    collapsed: () => {
      view?.shownChanged();
      drawHead();
    },
    maximized: (on) => {
      const b = el.querySelector<HTMLElement>("[data-cl-max]")!;
      b.innerHTML = callIcon(on ? "restore" : "max", 14);
      b.title = on ? "Restore the window" : "Maximize the window";
      b.setAttribute("aria-label", b.title);
    },
  });

  const load = (): Promise<StartCall> => {
    // a path the bundler leaves alone: the call's bundle is served beside the page's
    const url = "/call.js";
    loading ??= (import(url) as Promise<{ startCall: StartCall }>).then((m) => m.startCall);
    loading.catch(() => (loading = null));
    return loading;
  };

  /** Open the window, in front: the call where the page is in it, else the pre-join (or, rejoining,
   *  the call at once). */
  const open = async (o: { rejoin?: { mic: boolean; cam: boolean } } = {}) => {
    if (!may()) return;
    if (!shown) {
      shown = true;
      el.hidden = false;
      win.setCollapsed(false);
      btn.setAttribute("aria-pressed", "true");
    }
    win.layout();
    win.front();
    if (win.collapsed) win.collapse(false);
    notice.hidden = true;
    if (view) {
      if (!view.inCall) view.start(o);
      return;
    }
    body.innerHTML = `<div class="cl-wait muted">Loading the call…</div>`;
    let start: StartCall;
    try {
      start = await load();
    } catch {
      body.innerHTML = `<div class="cl-wait">The call could not be loaded. <button type="button" class="rv-btn" data-cl-retry>Try again</button></div>`;
      return;
    }
    if (!shown) return;
    view ??= start(env);
    view.start(o);
  };

  /** Close the window: out of the call where it was in it (Leave). */
  const close = () => {
    if (!shown) return;
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    shown = false;
    el.hidden = true;
    win.reset();
    btn.setAttribute("aria-pressed", "false");
    view?.dispose();
    view = null;
    body.innerHTML = "";
    drawButton();
  };

  /** ✕ in the call asks first: pressed again, it leaves (as Revoke and Remove do, pressed twice). */
  let closeArmed = 0;
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-cl-retry]")) return void open();
    if (t.closest("[data-cl-link]")) return void copyLink();
    if (t.closest("[data-cl-mic]")) return view?.toggleMic();
    const x = t.closest<HTMLElement>("[data-cl-close]");
    if (!x) return;
    if (!inCall()) return close();
    if (Date.now() - closeArmed > 4000) {
      closeArmed = Date.now();
      for (const b of el.querySelectorAll<HTMLElement>("[data-cl-close]")) {
        b.classList.add("armed");
        b.title = "Press again to leave the call";
      }
      setTimeout(() => el.querySelectorAll<HTMLElement>("[data-cl-close]").forEach((b) => (b.classList.remove("armed"), (b.title = "Leave the call and close"))), 4000);
      return;
    }
    closeArmed = 0;
    void view?.leave();
  });

  /** The window's title: Call, how many are in it, for how long; collapsed, its pill. */
  const drawHead = () => {
    const n = state?.participants.length ?? 0;
    const since = state?.session ? Date.parse(state.session.started) : NaN;
    const clock = Number.isFinite(since) && n ? clockText(Date.now() - since) : "";
    el.querySelector<HTMLElement>(".cl-count")!.textContent = n ? `· ${n}` : "";
    el.querySelector<HTMLElement>(".cl-clock")!.textContent = clock;
    const pill = el.querySelector<HTMLElement>(".fl-pill-text")!;
    const text = `${callIcon("call", 14)}<span>Call${n ? ` · ${n}` : ""}</span>${clock ? `<span class="fl-pill-state">${clock}</span>` : ""}`;
    if (pill.innerHTML !== text) pill.innerHTML = text;
    const mic = el.querySelector<HTMLElement>("[data-cl-mic]")!;
    mic.hidden = !inCall();
    const on = !!view?.mic;
    const m = callIcon(on ? "mic" : "micOff", 14);
    if (mic.innerHTML !== m) mic.innerHTML = m;
    mic.classList.toggle("off", !on);
    mic.title = on ? "Turn the microphone off" : "Turn the microphone on";
  };
  setInterval(() => {
    if (shown && state?.session) drawHead();
  }, 1000);

  // ---------------------------------------------------------------- the button and its notices

  const drawButton = () => {
    btn.hidden = !may() || state === null;
    const ps = state?.participants ?? [];
    badge.hidden = ps.length === 0;
    badge.textContent = ps.length > 99 ? "99+" : String(ps.length);
    btn.classList.toggle("live", ps.length > 0);
    btn.classList.toggle("rejoin", !!rejoin && !inCall());
    const names = ps.map((p) => p.name ?? "someone");
    btn.title = inCall() ? `The call: you and ${Math.max(0, ps.length - 1)} more — click to show it` : ps.length ? `The call: ${namesLine(names)} ${ps.length === 1 ? "is" : "are"} in it — click to join` : "The call: a video call with the people here — click to start one";
    btn.setAttribute("aria-label", ps.length ? `Call, ${ps.length} in it` : "Call");
  };

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** A notice under the button, with its buttons, for `ms` (0: until answered). */
  const say = (html: string, acts: { label: string; primary?: boolean; run: () => void }[] = [], ms = 10_000) => {
    notice.innerHTML = `<div class="cn-text">${html}</div>` + (acts.length ? `<div class="cn-acts">${acts.map((a, i) => `<button type="button" class="rv-btn${a.primary ? " primary" : ""}" data-cn="${i}">${escapeHtml(a.label)}</button>`).join("")}<button type="button" class="cn-x" data-cn="x" aria-label="Dismiss" title="Dismiss">✕</button></div>` : "");
    notice.hidden = false;
    noticeActs = acts;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = ms ? setTimeout(() => (notice.hidden = true), ms) : null;
  };
  let noticeActs: { run: () => void }[] = [];
  notice.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cn]");
    if (!b) return;
    notice.hidden = true;
    if (b.dataset.cn === "x") {
      if (rejoin) (forgetRejoin(), drawButton());
      return;
    }
    noticeActs[Number(b.dataset.cn)]?.run();
  });

  btn.addEventListener("click", () => {
    if (!shown) return void open(rejoin && state?.session?.id === rejoin.session ? { rejoin: takeRejoin() } : {});
    if (win.collapsed || win.covered) {
      if (win.collapsed) win.collapse(false);
      win.front();
      return;
    }
    // in front: in the call, it collapses to its pill; on the pre-join, it closes
    if (inCall()) win.collapse(true);
    else close();
  });

  const takeRejoin = () => {
    const r = rejoin!;
    forgetRejoin();
    return { mic: r.mic, cam: r.cam };
  };

  /** A short sound, two tones, as an invite comes (Web Audio: nothing fetched). */
  const chime = () => {
    try {
      const ctx = new AudioContext();
      const at = ctx.currentTime;
      for (const [f, t] of [[660, 0], [880, 0.16]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at + t);
        g.gain.exponentialRampToValueAtTime(0.12, at + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + t + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(at + t);
        o.stop(at + t + 0.25);
      }
      setTimeout(() => void ctx.close().catch(() => undefined), 800);
    } catch {
      // no sound: the notice says it
    }
  };

  // ---------------------------------------------------------------- what the call asks of the page

  const post = async (path: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> => {
    const stream = page.people.stream?.token;
    if (!stream) return { status: 0, body: { error: "This page is not connected to the server: wait a moment." } };
    const r = await data.callPost(path, { token: stream, ...extra });
    return r;
  };
  const refusal = async (path: string, extra: Record<string, unknown> = {}) => {
    const r = await post(path, extra);
    return r.status === 200 ? null : String(r.body.error ?? "It could not be done.");
  };

  /** The call link (CallSpec decision 6): the guest link as Share makes it, or a read-only reader's
   *  own, with `?call` and the view on show. */
  const link = async (): Promise<string> => {
    const info = await data.shareInfo().catch(() => ({ path: null }) as { path: string | null });
    return `${site.base}${info.path ?? "/"}?call${location.hash}`;
  };
  const copyLink = async () => {
    const l = await link();
    const keyed = /\/[kr]\//.test(new URL(l).pathname);
    const ok = await copy(l);
    page.say(ok ? `Call link copied: whoever opens it ${keyed ? "comes in by it and " : ""}finds the call ready to join.` : `Copy the call link: ${l}`);
  };

  const env: CallEnv = {
    el: body,
    state: () => state,
    me: () => ({ name: page.people.name, readOnly: reader !== null, private: data.privateSession !== null, page: page.people.stream?.id ?? null }),
    here: () =>
      page.people.peers
        .filter((p) => !p.agent && p.name && p.id !== page.people.stream?.id)
        .map((p) => ({ page: p.id, name: p.name!, verified: !!p.verified })),
    token: async (name) => {
      if (name !== null) roName = name;
      const r = await post("/api/call/token", { tab: await tab!.get(), ...(name !== null ? { name } : {}) });
      if (r.status === 200) return r.body as unknown as Awaited<ReturnType<CallEnv["token"]>>;
      return { error: String(r.body.error ?? "The call could not be joined."), ...(r.body.who ? { who: true } : {}), ...(r.body.private ? { private: true } : {}) };
    },
    end: () => refusal("/api/call/end"),
    remove: (identity) => refusal("/api/call/remove", { identity }),
    invite: (to) => refusal("/api/call/invite", { to }),
    left: () => {
      const stream = page.people.stream?.token;
      if (stream) void data.callPost("/api/call/leave", { token: stream });
      forgetRejoin();
    },
    ensureName: () => page.people.ensure(),
    goVisible: async () => {
      page.people.setPrivate(false);
      await new Promise((r) => setTimeout(r, 300));
    },
    follow: (id) => {
      const p = page.people.peers.find((x) => x.id === id);
      if (p) page.people.follow(personKey(p));
    },
    askToFollow: async (to) => {
      const stream = page.people.stream?.token;
      if (!stream) return "This page is not connected to the server: wait a moment.";
      const r = await data.askFollow(stream, to);
      return "error" in r ? r.error : null;
    },
    copyLink: () => void copyLink(),
    say: (t) => page.say(t),
    changed: () => {
      drawButton();
      drawHead();
    },
    seen: () => shown && !win.collapsed && !document.hidden,
    dropped: (why) => {
      if (why === "elsewhere") {
        tab?.renew();
        close();
        say("Your call went on in another tab of this browser, a copy of this one.", [{ label: "Join here too", primary: true, run: () => void open() }], 0);
      } else if (why === "removed" || why === "ended") {
        // LiveKit's word may come before the server's (`call-ended`, `call-removed`): said now,
        // and said again with who did it when that comes
        droppedAt = Date.now();
        close();
        if (Date.now() - namedAt > 10_000) say(why === "ended" ? "The call was ended." : "You were removed from the call.", [], 8000);
      }
      drawButton();
    },
    close: () => close(),
  };

  // ---------------------------------------------------------------- the page around the call

  // a page in the call asks before it is closed or reloaded; as it goes, it leaves the call and keeps
  // what a reload rejoins with
  window.addEventListener("beforeunload", (e) => {
    if (!inCall()) return;
    e.preventDefault();
    e.returnValue = "";
  });
  window.addEventListener("pagehide", () => {
    if (!inCall() || !view) return;
    try {
      if (state?.session) sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ session: state.session.id, at: Date.now(), mic: view.mic, cam: view.cam }));
    } catch {
      // no rejoin offered
    }
    const stream = page.people.stream?.token;
    if (stream) navigator.sendBeacon?.("/api/call/leave", JSON.stringify({ token: stream }));
    view.pageGone();
  });
  document.addEventListener("visibilitychange", () => view?.shownChanged());
  // a reader who goes private leaves the call: in a call one is seen (CallSpec decision 3)
  setInterval(() => {
    if (inCall() && data.privateSession !== null) {
      void view?.leave();
      page.say("You went private: you left the call, where everyone is seen.");
    }
  }, 1000);

  const calls: Calls = {
    get on() {
      return state !== null && may();
    },
    get inCall() {
      return inCall();
    },
    heard(s) {
      const was = state;
      state = s;
      drawButton();
      drawHead();
      view?.stateChanged();
      if (!may()) return;
      // a call link: the pre-join, once the server says it has a call
      if (asked) {
        asked = false;
        void open();
        return;
      }
      // a page reloaded in a call that still runs: Rejoin (the button, and a notice until answered)
      if (rejoin && !inCall()) {
        if (s.session?.id === rejoin.session) {
          say("You were in the call when this page reloaded.", [{ label: "Rejoin", primary: true, run: () => void open({ rejoin: takeRejoin() }) }, { label: "Not now", run: () => (forgetRejoin(), drawButton()) }], 0);
        } else if (s.session === null || s.session.id !== rejoin.session) {
          forgetRejoin();
          drawButton();
        }
        return;
      }
      // someone started a call: said to the pages not in it, with Join — not to the page that
      // started it, which may hear of it before its own join is done
      const mine = page.people.stream?.id;
      if (was && !was.session && s.session && !inCall() && !shown && s.participants.length && !s.participants.some((p) => p.page === mine)) {
        const who = s.participants[0].name ?? "Someone";
        say(`<b>${escapeHtml(who)}</b> started a call.`, [{ label: "Join", primary: true, run: () => void open() }], 12_000);
      }
    },
    invited(i) {
      if (!may() || inCall()) return;
      chime();
      say(`<b>${escapeHtml(i.from)}</b> invites you to the call.`, [{ label: "Join", primary: true, run: () => void open() }], 60_000);
    },
    removed(b) {
      namedAt = Date.now();
      close();
      say(`${b.by ? `<b>${escapeHtml(b.by)}</b>` : "Someone"} removed you from the call.`, [], 8000);
    },
    ended(b) {
      // a page that was not in the call, nor had it just ended under it, is told nothing
      if (!shown && !inCall() && Date.now() - droppedAt > 10_000) return;
      namedAt = Date.now();
      close();
      say(`${b.by ? `<b>${escapeHtml(b.by)}</b>` : "Someone"} ended the call.`, [], 8000);
    },
    connected() {
      // the server came back (a restart): the page's participant is named again by its new stream
      if (inCall()) void env.token(reader !== null ? roName : null);
    },
    link,
  };
  // a snapshot has no call: no button, no window
  if (data.snapshot) btn.hidden = true;
  return { calls };
}
