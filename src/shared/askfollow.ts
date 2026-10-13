// Asking others to follow (CollabSpec decision 10, AgentSpec decision 8; the owner's decisions of
// 2026-10-12): what the server and the pages share of it — how long a request lasts, what a page
// answers, how the answers of one person's pages make theirs, and the outcome in words.

/** How long a request to follow is shown, and how soon after one the same asker may ask again. */
export const ASK_MS = 30_000;
/** How long the server waits past ASK_MS for an answer on its way before it counts none: a page's
 *  own countdown answers first. */
export const ASK_GRACE_MS = 3_000;

/** What a page asked answers: Follow; Not now, or Esc; nothing before the request ran out (or a newer
 *  one replaced it, or the page closed); or nothing to answer, its reader following the asker
 *  already — such a reader is not asked, and is shown nothing. */
export const ASK_ANSWERS = ["follow", "decline", "timeout", "following"] as const;
export type AskAnswer = (typeof ASK_ANSWERS)[number];
/** A person's part in a request: their answer, or none yet. */
export type AskState = AskAnswer | "waiting";

/** A request as a page asked is told it (`ask`). */
export interface AskFollow {
  id: string;
  /** the asker's entry in presence: who following them follows */
  from: string;
  name: string;
  /** an agent asks (AgentSpec decision 8): the banner says so, with its mark */
  agent?: true;
  /** someone invited by a personal link (CollabSpec decision 9): the name is theirs */
  verified?: true;
  /** how long it is shown, from when the page is told it */
  ms: number;
}

/** An answer as the asking page is told it (`ask-answer`): from a listed page, by the id the others
 *  know it by; from a private one, from nobody in particular (CollabSpec decision 8). */
export interface AskAnswered {
  id: string;
  from: string | null;
  answer: AskAnswer;
}

/** What the asking page is told when it asks (POST /api/ask): the request, the listed pages it went
 *  to, by their ids, and how many private ones; no request (`id` null) where nobody was there to ask. */
export interface AskSent {
  id: string | null;
  asked: string[];
  private: number;
  ms: number;
}

/** A person's part in a request, from the answers of their pages: following where one of them
 *  followed; waiting while one may still answer; following already, declined, or no answer. */
export function foldAnswers(xs: readonly (AskAnswer | null)[]): AskState {
  if (xs.includes("follow")) return "follow";
  if (xs.includes(null)) return "waiting";
  if (xs.includes("following")) return "following";
  if (xs.includes("decline")) return "decline";
  return "timeout";
}

/** Each state in words, as the asker reads it. */
export const ASK_WORDS: Record<AskState, string> = { follow: "following", decline: "declined", timeout: "no answer", following: "already following", waiting: "waiting" };

/** The outcome of a request in a line, from each person's part (a private reader's each its own):
 *  "2 following, 1 declined, 1 no answer". Those following the asker already were not asked, and are
 *  not counted: null where nobody else was. */
export function askLine(states: readonly AskState[]): string | null {
  const asked = states.filter((s) => s !== "following");
  if (!asked.length) return null;
  const parts: string[] = [];
  for (const s of ["follow", "decline", "timeout", "waiting"] as const) {
    const n = asked.filter((x) => x === s).length;
    if (n) parts.push(`${n} ${ASK_WORDS[s]}`);
  }
  return parts.join(", ");
}

/** An answer a page sent, checked: one of ASK_ANSWERS, or null. */
export function cleanAnswer(x: unknown): AskAnswer | null {
  return (ASK_ANSWERS as readonly unknown[]).includes(x) ? (x as AskAnswer) : null;
}
