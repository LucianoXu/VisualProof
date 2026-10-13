// The mark of someone invited by a personal link (CollabSpec decision 9): a small ✓ beside their
// name wherever the page names them — among the others, in Activity, in the review, on the notes on
// a board — so that a guest who gives a name like theirs does not pass for them. What such a person
// did shows under the name they go by now: the server tells every page who they are (`people`, as
// they are told it again at each rename), and what the review's logs say of them comes with the
// review, already under that name.

import type { Invited } from "../../shared/collab.ts";
import { escapeHtml } from "./highlight.ts";

/** The mark, after a name. */
export const VERIFIED = `<span class="vf" title="Invited with a personal link: the name is theirs" aria-label="(invited with a personal link)">✓</span>`;

/** The people invited by a personal link, by the link's id, as the server last told them. */
const known = new Map<string, Invited>();

/** What the server says of the people invited by a personal link (`people`). */
export function setPeople(list: Invited[]): void {
  known.clear();
  for (const p of Array.isArray(list) ? list : []) if (p && typeof p.id === "string" && typeof p.name === "string") known.set(p.id, p);
}

/** The name someone goes by now: for someone invited by a personal link (`person`, their link's
 *  id), the one the server knows, else the name the record carries. */
export function nameNow(by: string | null, person?: string): string | null {
  return (person && known.get(person)?.name) || by;
}

/** A name as HTML: the name someone goes by now, escaped, with the mark where they were invited by
 *  a personal link. */
export function nameHtml(by: string, person?: string): string {
  return escapeHtml(nameNow(by, person) ?? by) + (person ? VERIFIED : "");
}
