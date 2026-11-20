// What a page's tab calls itself in the call (CallSpec, "As built"): 16 letters and digits, kept in
// the tab's session storage, sent with the page's request for a token; the server makes the
// participant's identity of it, which nobody is told how. A reload keeps it — session storage
// outlives a page in its tab —, so the page that joins after it is the participant the one before
// was, and LiveKit replaces that one.
//
// A tab the browser duplicates starts with a copy of the session storage: two live pages would hold
// one tab, and each one's join would put the other out of the call. So a page asks the others of its
// origin, on a BroadcastChannel, whether one of them holds its tab before it joins, and takes a new
// tab if one does; every page answers for its own from the start. Adapted from Cocoding's meetings.
//
// In the page's first bundle (web/src/pagecall.ts makes it at load, so that it answers from then on);
// its parts are injectable for test/callmodel.test.ts.

import { CALL_TAB } from "../../../shared/call.ts";

/** where the tab is kept, in the tab's session storage */
export const TAB_KEY = "visualproof:call:tab";
/** how long a page waits for another to say it holds the same tab */
export const ASK_MS = 150;

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface CallTab {
  /** The tab to join as, once no other live page of the origin is found to hold it. */
  get(): Promise<string>;
  /** Whether this page is a copy of another live page (asked at its load). */
  readonly copy: Promise<boolean>;
  /** Another page holds this tab after all: take a new one. */
  renew(): string;
  close(): void;
}

type TabMessage = { ask: string; from: string } | { taken: string; to: string };

export interface TabDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  channel: (Pick<BroadcastChannel, "postMessage" | "close"> & { onmessage: ((e: MessageEvent) => void) | null }) | null;
  random: (bytes: Uint8Array) => Uint8Array;
  askMs: number;
}

/** 16 letters and digits, each as likely as another. */
export function newTab(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let tab = "";
  while (tab.length < 16) {
    // 248 = 4 × 62: below it, each character is as likely as another
    for (const b of random(new Uint8Array(32))) if (b < 248 && tab.length < 16) tab += ALPHANUMERIC[b % 62];
  }
  return tab;
}

const browserDeps = (): TabDeps => {
  let storage: TabDeps["storage"] = null;
  try {
    storage = sessionStorage;
  } catch {
    // storage blocked: a tab of this page only
  }
  return { storage, channel: typeof BroadcastChannel === "function" ? new BroadcastChannel("visualproof:call-tab") : null, random: (b) => crypto.getRandomValues(b), askMs: ASK_MS };
};

export function callTab(deps: TabDeps = browserDeps()): CallTab {
  const keep = (tab: string): string => {
    try {
      deps.storage?.setItem(TAB_KEY, tab);
    } catch {
      // storage blocked: this page keeps it
    }
    return tab;
  };
  let kept: string | null = null;
  try {
    kept = deps.storage?.getItem(TAB_KEY) ?? null;
  } catch {
    kept = null;
  }
  let tab = kept !== null && CALL_TAB.test(kept) ? kept : keep(newTab(deps.random));
  /** this page, on the channel */
  const me = newTab(deps.random);
  const waiting = new Set<(taken: string) => void>();
  const channel = deps.channel;
  if (channel)
    channel.onmessage = (e: MessageEvent) => {
      const m = e.data as Partial<TabMessage> | null;
      if (!m || typeof m !== "object") return;
      if ("ask" in m && m.ask === tab && typeof m.from === "string" && m.from !== me) channel.postMessage({ taken: tab, to: m.from } satisfies TabMessage);
      else if ("taken" in m && m.to === me && typeof m.taken === "string") for (const f of waiting) f(m.taken);
    };
  const renew = () => (tab = keep(newTab(deps.random)));
  const ask = async (): Promise<boolean> => {
    if (!channel) return false;
    const asked = tab;
    const taken = await new Promise<boolean>((resolve) => {
      const on = (t: string) => {
        if (t !== asked) return;
        waiting.delete(on);
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        waiting.delete(on);
        resolve(false);
      }, deps.askMs);
      waiting.add(on);
      channel.postMessage({ ask: asked, from: me } satisfies TabMessage);
    });
    if (taken && tab === asked) renew();
    return taken;
  };
  const copy = ask();
  return {
    async get() {
      await copy;
      await ask();
      return tab;
    },
    copy,
    renew,
    close() {
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}
