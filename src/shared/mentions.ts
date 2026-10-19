// Mentions (CollabSpec decision 13, the owner's decision of 2026-10-19): `@` and a name in a message,
// the name of a person or of an agent as it is listed. The server reads them as a message is written
// (server/talk.ts): a person's mention of an agent hands the message to that agent, an agent's is
// shown and never handed. The page completes one as it is typed, from the people online and the
// agents listed, and marks the reader's own.
//
// Names may hold spaces ("Alice's AI"), so a mention is not a word: it is read against the names it
// may be, the longest that fits first, compared as names are (shared/collab.ts, sameName), and only
// where nothing of a name goes on after it (`@Al` is not `@Alice`). An `@` inside a word (an address,
// alice@example.org) mentions nobody.

import { MAX_NAME, nameKey, sameName } from "./collab.ts";

/** what a name goes on with: after a mention there is none of it, and before its `@` neither */
const WORDY = /[\p{L}\p{N}_]/u;

/** A mention in a text: the name as listed, and where it is — from its `@` to the end of the name. */
export interface Mention {
  name: string;
  start: number;
  end: number;
}

/** The mentions in `text` of the names `names`, in order: at each `@` that starts a word, the
 *  longest of the names written there. */
export function mentionsIn(text: string, names: Iterable<string>): Mention[] {
  const sorted = [...new Set(names)].filter((n) => n.trim() !== "").sort((a, b) => b.length - a.length);
  const out: Mention[] = [];
  if (!sorted.length) return out;
  for (let i = text.indexOf("@"); i >= 0; i = text.indexOf("@", i + 1)) {
    if (i > 0 && WORDY.test(text[i - 1])) continue;
    const rest = text.slice(i + 1, i + 1 + MAX_NAME + 1);
    if (!rest || /^\s/.test(rest)) continue;
    for (const n of sorted) {
      const piece = rest.slice(0, n.length);
      if (piece.length === n.length && sameName(piece, n) && !WORDY.test(rest[n.length] ?? "")) {
        out.push({ name: n, start: i, end: i + 1 + n.length });
        i += n.length;
        break;
      }
    }
  }
  return out;
}

/** The names `text` mentions, each once, in the order first mentioned. */
export function mentioned(text: string, names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const m of mentionsIn(text, names)) if (!out.some((x) => sameName(x, m.name))) out.push(m.name);
  return out;
}

/** The mention being typed just before `caret`: where its `@` is, and what follows it so far (one
 *  line, a name's length at most); null where none is being typed. */
export function typingMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(Math.max(0, caret - MAX_NAME - 1), caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const start = caret - before.length + at;
  if (start > 0 && WORDY.test(text[start - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\n@]/.test(query) || /^\s/.test(query)) return null;
  return { start, query };
}

/** A name a mention may be completed with: a person's, or an agent's. */
export interface Mentionable {
  name: string;
  agent?: boolean;
}

/** The names that complete `query`, at most `max`: those that start with it first, then those with a
 *  word that does; people before agents, each in the order given. */
export function completions(query: string, names: readonly Mentionable[], max = 8): Mentionable[] {
  const q = nameKey(query);
  const seen = new Set<string>();
  const first: Mentionable[] = [], then: Mentionable[] = [];
  for (const n of names) {
    const k = nameKey(n.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (k.startsWith(q)) first.push(n);
    else if (q && k.split(/[\s.'’-]+/).some((w) => w.startsWith(q))) then.push(n);
  }
  const people = (xs: Mentionable[]) => [...xs.filter((x) => !x.agent), ...xs.filter((x) => x.agent)];
  return [...people(first), ...people(then)].slice(0, max);
}

/** Whether `text` mentions `name` (the reader's, say): one of its mentions is of that name. */
export function mentions(text: string, name: string, names: Iterable<string> = [name]): boolean {
  return mentionsIn(text, [...names, name]).some((m) => sameName(m.name, name));
}
