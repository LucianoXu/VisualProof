// The author line of a view's exported document (ExportSpec decision 15, the owner's, 2026-10-09):
// the people who left a trace on the view, in the order of their first trace. A trace is
//   - making the view: its maker as its record has them, once it is kept (a view nobody keeps is
//     only what its query looks like, ViewSpec decision 6: opening it makes nothing), and whoever
//     saved it for everyone (the timeline's `created`);
//   - renaming, rescoping, laying it out afresh, keeping it at a past build, adding a note of the
//     project to it or taking one out of it: the timeline's view events for its id;
//   - a pin dropped on it that is still kept (who dropped each, server/views.ts);
//   - a note written or edited on it: the notes it holds (their writers and last edits) and the
//     timeline's notes written and edited on it, a note deleted since among them; and the items it
//     shows (AttachmentSpec decision 17, the owner's of 2026-10-11: every note of the project on the
//     Project; their writers and last edits);
//   - the review of what it prints (the owner's decision, 2026-10-10): an opinion given on one of the
//     declarations of the project it holds, an approval or a comment, its key marks and its target
//     mark (`reviewTraces`).
// People only: what an agent did is no trace (its opinions are advice), nor what a private reader
// arranged (recorded without a name, CollabSpec decision 8; their review keeps it), nor what the
// server itself did (its moves of renamed declarations, under its own name). Someone invited by a personal link is named as they are called now (their link's
// id is on what they did). The timeline keeps 90 days, so a rename or a re-layout older than that is
// forgotten; a pin, a note and the maker are kept with the view.

import type { ReviewData } from "../review.ts";
import type { StoredEvent } from "../timeline.ts";
import type { PinAuthors, ViewData } from "../views.ts";
import type { StickyNote } from "../sticky.ts";
import { CLUSTER_MODES } from "../places.ts";

/** One thing someone did to a view: who (a name, null without one), whether an agent did, their
 *  personal link's id, and when. */
export interface Trace {
  by: string | null;
  agent?: boolean;
  person?: string;
  at: string;
}

/** Everything left on view `v` that may make an author: its record, who dropped each of its pins
 *  (`pins`, the server's), the timeline's events, and the items it shows (`shown`, shared/noteplace.ts,
 *  itemsShownOn). Events from before the view was made are another view's of
 *  the same id. Unsorted. */
export function viewTraces(
  v: Pick<ViewData, "id" | "by" | "at" | "agent" | "person" | "kept" | "notes" | "pins">,
  pins: PinAuthors | undefined,
  events: readonly StoredEvent[],
  shown: readonly Pick<StickyNote, "by" | "agent" | "person" | "at" | "edited">[] = [],
): Trace[] {
  const mark = (t: { by: string | null; agent?: boolean; person?: string; at: string }): Trace => ({ by: t.by, ...(t.agent ? { agent: true } : {}), ...(t.person ? { person: t.person } : {}), at: t.at });
  const ours: Trace[] = [];
  for (const e of events) {
    if ((e.kind === "view" || (e.kind === "note" && (e.what === "created" || e.what === "edited"))) && e.view === v.id && e.at >= v.at) ours.push(mark(e));
  }
  for (const n of [...(v.notes ?? []), ...shown]) {
    ours.push(mark(n));
    if (n.edited) ours.push(mark(n.edited));
  }
  for (const mode of CLUSTER_MODES)
    for (const kind of ["nodes", "clusters"] as const) {
      const set = pins?.[mode]?.[kind];
      if (!set) continue;
      for (const [key, who] of Object.entries(set)) if (Object.hasOwn(v.pins[mode][kind], key)) ours.push(mark(who));
    }
  if (!v.kept || !v.by) return ours;
  // a record made before makers were marked says nothing of an agent: one whose name acted on this
  // view as an agent, and is no person's link, is taken for that agent
  const agent = !!v.agent || (!v.person && ours.some((t) => t.agent && t.by === v.by));
  return [mark({ by: v.by, agent, person: v.person, at: v.at }), ...ours];
}

/** What the review says of the declarations a view holds (`held`: their names, on the graph its board
 *  is of, with `d` the review as that board reads it): each opinion given on one, an approval or a
 *  comment, each key mark on one, and its target mark. Unsorted. */
export function reviewTraces(d: ReviewData, held: Iterable<string>): Trace[] {
  const mark = (t: { by: string; agent?: boolean; person?: string; at: string }): Trace => ({ by: t.by, ...(t.agent ? { agent: true } : {}), ...(t.person ? { person: t.person } : {}), at: t.at });
  const names = new Set(held);
  const out: Trace[] = [];
  for (const name of names) {
    if (Object.hasOwn(d.opinions, name)) for (const o of d.opinions[name]) out.push(mark(o));
    if (Object.hasOwn(d.targets, name)) out.push(mark(d.targets[name]));
  }
  for (const marks of Object.values(d.keys)) for (const [name, k] of Object.entries(marks)) if (names.has(name)) out.push(mark(k));
  return out;
}

/** The people among `traces`, by the name each goes by now (`nameOf`: the name of someone invited
 *  by a personal link, by its id; null where it is not known, and the name the trace carries is
 *  used), once each, in the order of their first trace (a tie in the order given). `notPeople`: names
 *  that are no one's (the server's own). */
export function authorsOf(traces: readonly Trace[], nameOf: (person: string) => string | null, notPeople: readonly string[] = []): string[] {
  const order = traces.map((t, k) => ({ t, k })).sort((a, b) => (a.t.at < b.t.at ? -1 : a.t.at > b.t.at ? 1 : a.k - b.k));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { t } of order) {
    if (!t.by || t.agent) continue;
    if (!t.person && notPeople.includes(t.by)) continue;
    const name = ((t.person && nameOf(t.person)) || t.by).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** The author line as it prints: "Alice", "Alice and Bob", "Alice, Bob and Carol"; "" for nobody. */
export function authorLine(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}
