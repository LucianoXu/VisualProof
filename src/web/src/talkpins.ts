// A conversation's pin (AgentSpec decision 8, the owner's decision of 2026-10-12): the reader pins the
// conversation with an agent from its window's title bar, and a pinned conversation stays open when
// following ends, so that the reader can go on talking with the agent while working on their own. It
// stays open across reloads, and a Shift-click on the agent's badge opens it again without following
// (web/src/people.ts). An unpinned one opens and closes with following, as before.
//
// The pin is the reader's own (web/src/surfaces.ts), kept in this browser per agent (web/src/store.ts):
// the agents pinned, by their entry's id, which is its token's (server/presence.ts, agentKey), and
// the one whose conversation is open without following. There is one conversation window: following
// someone, it shows what following shows (the strip, or the followed agent's conversation), and the
// pinned conversation left open comes back when following ends. What is kept is read back with care,
// as it may be from an older page or another tab.

import type { Peer } from "../../shared/collab.ts";

/** What this browser keeps of the pins: the agents pinned, and the one whose conversation is open
 *  without following (null: none). */
export interface TalkPins {
  pinned: string[];
  open: string | null;
}

/** The pins as kept (`talkPins`, `talkOpen` in web/src/store.ts): ids that are strings, once each; the
 *  open one only where it is pinned. */
export function readPins(kept: { talkPins?: unknown; talkOpen?: unknown }): TalkPins {
  const pinned = Array.isArray(kept.talkPins) ? [...new Set(kept.talkPins.filter((x): x is string => typeof x === "string" && x !== ""))] : [];
  const open = typeof kept.talkOpen === "string" && pinned.includes(kept.talkOpen) ? kept.talkOpen : null;
  return { pinned, open };
}

/** Keep the pins in what the browser keeps (web/src/store.ts): nothing where there is nothing. */
export function writePins(kept: { talkPins?: string[]; talkOpen?: string }, p: TalkPins): void {
  kept.talkPins = p.pinned.length ? p.pinned : undefined;
  kept.talkOpen = p.open ?? undefined;
}

export function isPinned(p: TalkPins, id: string): boolean {
  return p.pinned.includes(id);
}

/** Pin agent `id`'s conversation, which is on the screen as it is pinned: the open one from now on. */
export function pin(p: TalkPins, id: string): TalkPins {
  return { pinned: isPinned(p, id) ? p.pinned : [...p.pinned, id], open: id };
}

/** Unpin agent `id`'s conversation: it is no longer the one open without following. */
export function unpin(p: TalkPins, id: string): TalkPins {
  return { pinned: p.pinned.filter((x) => x !== id), open: p.open === id ? null : p.open };
}

/** Agent `id`'s pinned conversation is on the screen (followed, or opened from its badge): it is the
 *  one open when following ends. An agent not pinned changes nothing. */
export function opened(p: TalkPins, id: string): TalkPins {
  return isPinned(p, id) ? { ...p, open: id } : p;
}

/** The conversation open without following was closed (its ✕): it stays pinned, and opens again from
 *  the agent's badge. */
export function closed(p: TalkPins): TalkPins {
  return { ...p, open: null };
}

/** The agent whose conversation the window shows: following someone, the followed agent where it can
 *  be talked to (`followed`: its entry, or null for anyone else); following nobody, the pinned one left
 *  open, while the server lists it with a token in force (`peers`); else none. */
export function shownTalk(p: TalkPins, following: boolean, followed: Peer | null, peers: readonly Peer[]): Peer | null {
  if (following) return followed;
  if (!p.open) return null;
  return peers.find((x) => x.id === p.open && x.agent && x.talk) ?? null;
}
