// A view's items (the owner's decision of 2026-10-11, AttachmentSpec decision 17): items belong to
// views as declarations do. An item is a note of the project — among them the notes that carry the
// library's files — and the Project holds every one. Any other view shows an item where it follows
// from the view's scope (shared/noteplace.ts, `derivedWhy`: the declaration it is attached to on the
// board — a reader's visitor counts, and a board of a past build reads it by that build's name (the
// owner's decision of 2026-10-12) —, its cluster on the board, its cluster under the other clustering
// on the board for a note on the ring, or a file it carries linked to what the board holds), or where
// it was added to the view, unless it was taken out of it.
//
// What was added and what was taken out are two lists the view keeps beside its scope, never in
// the scope's text (ViewSpec decision 25: titles stay short): `items: {add, remove}` in its record.
// They are changed by a view operation, `item`, that puts a note in one list or in neither, shared
// live as pins are and recorded by the timeline as a scope change is. The page and the agents' API
// decide which list from what the scope gives (`itemOp`), as the canvas's menu writes a scope that
// stays short: adding back what was taken out only takes it off the list that took it out, where
// the scope gives it already, and taking out what was added only takes it off the list that added
// it, where the scope does not give it. A note deleted, or made a view's own, leaves every list.

import { MAX_PROJECT_NOTES } from "./projectnotes.ts";
import { validNoteId } from "./sticky.ts";

/** What a view holds besides what its scope gives: the notes of the project added to it, and those
 *  taken out of it, by id, each in the order it was put there. */
export interface ViewItems {
  add: string[];
  remove: string[];
}

export type ItemList = keyof ViewItems;

/** Put note `note` in one of a view's lists (`in`), or in neither (null): the one operation that
 *  changes them. */
export type ItemOp = { op: "item"; note: string; in: ItemList | null };

/** the most notes a list holds: every note of the project */
export const MAX_ITEMS = MAX_PROJECT_NOTES;

/** Which of view `items`'s lists holds note `id`, or null. */
export function itemIn(items: ViewItems | undefined, id: string): ItemList | null {
  if (!items) return null;
  return items.add.includes(id) ? "add" : items.remove.includes(id) ? "remove" : null;
}

/** Why an item operation cannot be taken, or null. */
export function invalidItemOp(o: Record<string, unknown>): string | null {
  if (!validNoteId(o.note)) return "note";
  return o.in === null || o.in === "add" || o.in === "remove" ? null : "in";
}

/** Apply an item operation to a view's record in place; true when anything changed. A list that
 *  is full takes no more, and a record whose lists are both empty keeps none. */
export function applyItemOp(v: { items?: ViewItems }, o: ItemOp): boolean {
  const was = itemIn(v.items, o.note);
  if (was === o.in) return false;
  const items = v.items ?? { add: [], remove: [] };
  if (o.in && items[o.in].length >= MAX_ITEMS) return false;
  if (was) items[was] = items[was].filter((id) => id !== o.note);
  if (o.in) items[o.in].push(o.note);
  if (items.add.length || items.remove.length) v.items = items;
  else delete v.items;
  return true;
}

/** A view's lists as a file holds them, checked: an id that cannot be one is left out, as is one
 *  named twice; none where both are empty. */
export function cleanItems(raw: unknown): { items?: ViewItems } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const list = (x: unknown): string[] => {
    const out: string[] = [];
    for (const id of Array.isArray(x) ? x : []) {
      if (!validNoteId(id) || seen.has(id) || out.length >= MAX_ITEMS) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  const add = list(r.add);
  const remove = list(r.remove);
  return add.length || remove.length ? { items: { add, remove } } : {};
}

/** The operation that adds note `note` to a view (Add to view ▸, `to` "add") or takes it out of the
 *  view (Remove from this view, `to` "remove"), `derived` saying whether the view's scope gives it:
 *  added, it is in the view's add list only where the scope does not give it, and taken off its
 *  remove list either way; taken out, it is on the remove list only where the scope gives it, and
 *  off its add list either way. Null where the view is as asked already. */
export function itemOp(items: ViewItems | undefined, note: string, to: "add" | "remove", derived: boolean): ItemOp | null {
  const want: ItemList | null = to === "add" ? (derived ? null : "add") : derived ? "remove" : null;
  return itemIn(items, note) === want ? null : { op: "item", note, in: want };
}

/** Whether a view shows a note after an item operation changed it from `was`: what the timeline
 *  says of it — added (put on the add list, or taken off the remove list) or taken out. */
export const itemShown = (was: ItemList | null, o: ItemOp): boolean => o.in === "add" || (o.in === null && was === "remove");

/** The operations that take note `id` off every list of `views` that names it (a note deleted, or
 *  made a view's own), by view. */
export function dropItem(views: Iterable<{ id: string; items?: ViewItems }>, id: string): { view: string; op: ItemOp }[] {
  const out: { view: string; op: ItemOp }[] = [];
  for (const v of views) if (itemIn(v.items, id)) out.push({ view: v.id, op: { op: "item", note: id, in: null } });
  return out;
}
