// The lost-and-found (HistorySpec decisions 12–14, the owner's of 2026-10-09): what people and agents
// said and marked of a declaration the graph no longer has — an opinion with its comment, a target
// mark, a key mark, a pin on a view, a note's mention of it — that no rename in force carried to a
// new name. Nothing is deleted when a declaration goes: what was said of it waits here, under the
// name it was said of, until someone attaches it to a declaration of the graph (a move, HistorySpec
// decision 9) or archives it, which only hides it.
//
// The entries are computed, never stored: from the review and the views as they are, against the
// graph on show. Each is keyed by what it is and where, so that the same thing is the same entry on
// every page and in the archive (server/lostfound.ts), which is the one thing kept:
//
//   opinion:<name>#<by>@<at>        an opinion (the reference comments use, shared/comment.ts)
//   target:<name>                   a target mark
//   key:<target>#<name>             a key mark, lost where either name is gone
//   pin:<view>:<mode>:<name>        a declaration's pin on a view, under one way of clustering
//   note:<view>:<note id>:<name>    a note's mention of a full name in backticks
//   link:<link id>                  a link into the library (AttachmentSpec decision 6), its
//                                   declaration gone, or its cluster (listed as `ns(P)`, `file(P)`)
//   move:<migration id>             a migration (server/renames.ts), listed beside the lost
//
// This file is what the server and the pages share: the entries, their keys, and the shape of the
// answer the server gives (GET /api/history/lost).

import { opinionRef } from "./comment.ts";
import type { ClusterMode } from "./graph.ts";
import { CLUSTER_MODES } from "./places.ts";
import type { ReviewData, Verdict } from "./review.ts";
import type { ViewData } from "./views.ts";
import { viewTitle } from "./views.ts";
import type { ProjectNote } from "./projectnotes.ts";

export type LostKind = "opinion" | "target" | "key" | "pin" | "note" | "link";

/** One thing said or marked of a declaration the graph no longer has. */
export interface LostEntry {
  key: string;
  kind: LostKind;
  /** the name it is under, which the graph no longer has: what Attach to… moves from */
  name: string;
  /** who said or did it, and when, as the review or the view records it; null where nobody is
   *  named (a pin dropped without a name) */
  by: string | null;
  agent?: true;
  /** someone invited by a personal link: the link's id (CollabSpec decision 9) */
  person?: string;
  /** empty where it is not known: a pin dropped before the server kept who dropped each */
  at: string;
  /** an opinion recorded for `by` by someone else at one screen (ReviewSpec decision 8): who typed it */
  recordedBy?: { by: string; person?: string };
  /** an opinion's verdict and comment */
  verdict?: Verdict;
  comment?: string;
  /** a key mark: the target of the review it is in, and the declaration marked */
  target?: string;
  member?: string;
  /** a pin or a note: the view ("" for a note of the project), its title, the way of clustering (a
   *  pin), the note and its text */
  view?: string;
  title?: string;
  mode?: ClusterMode;
  note?: string;
  text?: string;
  /** an opinion of someone invited by a personal link: its key under each name they went by
   *  before, which an archiving made then is kept under */
  aliases?: string[];
  /** a link: its id, its label and the file it points into, by title */
  link?: string;
  label?: string;
  fileTitle?: string;
}

/** Who dropped a pin, as the server keeps it (shared/views.ts, PinAuthor). */
export interface PinWho {
  by: string | null;
  agent?: true;
  at: string;
}

/** The order the kinds are listed in, under one name. */
const KIND_ORDER: LostKind[] = ["target", "key", "opinion", "link", "note", "pin"];

/** A name as a note writes one in full between backticks: a dotted or plain Lean name, nothing
 *  that reads as code (spaces, operators). */
const NAME_LIKE = /^[\p{L}_«][^\s`(){}[\],;:=+*<>|&^%$#@~"/\\]*$/u;

export const lostKey = {
  opinion: (name: string, by: string, at: string): string => opinionRef(name, by, at),
  target: (name: string): string => `target:${name}`,
  key: (target: string, name: string): string => `key:${target}#${name}`,
  pin: (view: string, mode: ClusterMode, name: string): string => `pin:${view}:${mode}:${name}`,
  note: (view: string, note: string, name: string): string => `note:${view}:${note}:${name}`,
  link: (id: string): string => `link:${id}`,
  move: (id: string): string => `move:${id}`,
};

/** Every entry of the lost-and-found: what the review (`d`) and the views hold of a name the graph
 *  on show does not have (`has`). A note's mention counts where its name is not in the graph, no
 *  rename in force leads from it to one that is (`d.renamed`), and it was a declaration (`known`:
 *  the history had it; without a history, a dotted name). `pinWho` says who dropped a pin, where
 *  the caller knows (the server does; pages are not told); `titleOf` what a view is called (the
 *  server's titles know the graph's names). A view kept at a past build is a board of that build
 *  (HistorySpec decision 19): a pin or a mention of a declaration its build had is not lost
 *  (`atBuild`). Sorted by name, then kind, then time. */
export function lostEntries(
  d: ReviewData,
  views: readonly ViewData[],
  has: (name: string) => boolean,
  known: (name: string) => boolean = (n) => n.includes("."),
  pinWho: (view: string, mode: ClusterMode, name: string) => PinWho | null = () => null,
  titleOf: (v: ViewData) => string = (v) => viewTitle(v),
  atBuild: (view: ViewData, name: string) => boolean = () => false,
  notes: readonly Pick<ProjectNote, "id" | "text" | "by" | "agent" | "person" | "at">[] = [],
  hasCluster: ((kind: "ns" | "file", key: string) => boolean) | null = null,
): LostEntry[] {
  const out: LostEntry[] = [];
  const who = (x: { by: string | null; agent?: true; person?: string; at: string }) => ({
    by: x.by,
    ...(x.agent ? { agent: true as const } : {}),
    ...(x.person ? { person: x.person } : {}),
    at: x.at,
  });
  for (const [name, ops] of Object.entries(d.opinions)) {
    if (has(name)) continue;
    for (const o of ops) {
      // an archiving made while the writer went by another name is kept under that name's key
      const was = o.person && Object.hasOwn(d.people, o.person) ? d.people[o.person].was.filter((n) => n !== o.by) : [];
      out.push({
        key: lostKey.opinion(name, o.by, o.at),
        kind: "opinion",
        name,
        ...who(o),
        ...(o.recordedBy ? { recordedBy: o.recordedBy } : {}),
        verdict: o.verdict,
        ...(o.comment ? { comment: o.comment } : {}),
        ...(was.length ? { aliases: was.map((n) => lostKey.opinion(name, n, o.at)) } : {}),
      });
    }
  }
  for (const [name, t] of Object.entries(d.targets)) if (!has(name)) out.push({ key: lostKey.target(name), kind: "target", name, ...who(t) });
  // a key mark is lost where the declaration marked is gone (as a member), or its target (as a
  // target's own); it is listed under the member's name where that is gone
  for (const [target, marks] of Object.entries(d.keys))
    for (const [member, m] of Object.entries(marks))
      if (!has(member) || !has(target)) out.push({ key: lostKey.key(target, member), kind: "key", name: has(member) ? target : member, ...who(m), target, member });
  // a link whose declaration is gone (a move would have carried it), or whose cluster is: listed
  // under the declaration's name, or under the cluster as its subject names it
  for (const l of d.links ?? []) {
    const m = /^(decl|ns|file)\((.+)\)$/s.exec(l.subject);
    if (!m) continue;
    const gone = m[1] === "decl" ? !has(m[2]) : hasCluster !== null && !hasCluster(m[1] as "ns" | "file", m[2]);
    if (!gone) continue;
    const f = d.files && Object.hasOwn(d.files, l.file) ? d.files[l.file] : null;
    out.push({ key: lostKey.link(l.id), kind: "link", name: m[1] === "decl" ? m[2] : l.subject, ...who(l), link: l.id, label: l.label, ...(f ? { fileTitle: f.title } : {}) });
  }
  // the names each name became, through the renames in force: a note may name one before its rename
  const ahead = new Map<string, string>();
  for (const [to, from] of Object.entries(d.renamed ?? {})) ahead.set(from, to);
  const leads = (name: string): boolean => {
    let n = name;
    for (let k = 0; k < 1000 && ahead.has(n); k++) {
      n = ahead.get(n)!;
      if (has(n)) return true;
    }
    return false;
  };
  /** the mentions in a note's text of names that are gone, each an entry */
  const mentions = (n: { id: string; text: string; by: string | null; agent?: true; person?: string; at: string }, view: string, title: string, gone: (name: string) => boolean) => {
    const names = new Set<string>();
    for (const m of n.text.matchAll(/`([^`\n]+)`/g)) names.add(m[1]);
    for (const name of names) {
      if (!NAME_LIKE.test(name) || has(name) || leads(name) || !known(name) || !gone(name)) continue;
      out.push({ key: lostKey.note(view, n.id, name), kind: "note", name, ...who(n), view, title, note: n.id, text: n.text });
    }
  };
  // the project's notes (AttachmentSpec decision 13): view "", on no board of a past build
  for (const n of notes) mentions(n, "", "", () => true);
  for (const v of views) {
    const title = titleOf(v);
    for (const mode of CLUSTER_MODES)
      for (const name of Object.keys(v.pins[mode].nodes)) {
        if (has(name) || atBuild(v, name)) continue;
        const w = pinWho(v.id, mode, name);
        out.push({ key: lostKey.pin(v.id, mode, name), kind: "pin", name, by: w?.by ?? null, ...(w?.agent ? { agent: true as const } : {}), at: w?.at ?? "", view: v.id, title, mode });
      }
    for (const n of v.notes ?? []) mentions(n, v.id, title, (name) => !atBuild(v, name));
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => cmp(a.name, b.name) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || cmp(a.at, b.at) || cmp(a.key, b.key));
}

/** A build as the lost-and-found and the build-status popover tell it (server/history.ts,
 *  SnapshotInfo: the fields a page reads). */
export interface BuildLine {
  id: number;
  at: string;
  approx?: true;
  commit: { hash: string; branch: string | null; dirty?: boolean; guessed?: true } | null;
  missing: string[];
  counts: { modules: number; nodes: number; edges: number; externals: number };
  renames?: { high: number; medium: number };
}

/** A migration as the lost-and-found lists it (server/renames.ts, Migration: the fields a page
 *  reads). */
export interface LostMigration {
  id: string;
  at: string;
  from: string;
  to: string;
  snap?: number;
  by: string;
  agent?: true;
  person?: string;
  auto?: string;
  rename: boolean;
  review: boolean;
  carried: { opinions: number; targets: number; keys: number; notes: number; pins: number; scopes: number; reviewViews: number; links?: number };
  undone?: { by: string; agent?: true; person?: string; at: string };
}

/** An archiving or a putting back (server/lostfound.ts): the last line of a key is its state. */
export interface ArchiveLine {
  key: string;
  on: boolean;
  by: string;
  agent?: true;
  person?: string;
  at: string;
}

/** A suggestion of medium confidence for a lost name (server/renames.ts, Pairing). */
export interface LostSuggestion {
  to: string;
  score: number;
  why: string;
  snap: number;
}

/** The newest build whose graph had a name, and the module it was in there. */
export interface LastHad {
  name: string;
  snapshot: number;
  at: string;
  approx?: true;
  commit: BuildLine["commit"];
  module: string;
}

/** The entries under one name: the newest build that had it, the suggestions for it, likeliest
 *  first, and what is said of it that is not archived. */
export interface LostGroup {
  name: string;
  last: LastHad | null;
  suggestions: LostSuggestion[];
  entries: LostEntry[];
}

/** What GET /api/history/lost answers. */
export interface LostAnswer {
  /** by name, each with at least one entry not archived */
  lost: LostGroup[];
  /** every migration not archived, the newest first; an undone one stays */
  migrations: (LostMigration & { key: string })[];
  /** what is archived, the latest archiving first: an entry or a migration, with its line */
  archived: { key: string; line: ArchiveLine; entry?: LostEntry; migration?: LostMigration }[];
  /** entries set aside: their declaration was in a file the graph on show could not read, which
   *  did not vanish (HistorySpec decision 6) */
  aside: { entries: number; modules: string[] };
  /** what the list holds: the lost entries and the migrations not archived */
  count: number;
}

/** What a migration carried, as words: "2 opinions, a target mark, 3 pins". */
export function carriedText(c: LostMigration["carried"]): string {
  const n = (k: number, one: string, many = `${one}s`) => (k ? (k === 1 ? `1 ${one}` : `${k} ${many}`) : "");
  const parts = [
    n(c.opinions, "opinion"),
    n(c.targets, "target mark"),
    n(c.keys, "key mark"),
    n(c.links ?? 0, "link"),
    n(c.reviewViews, "target's view", "targets' views"),
    n(c.pins, "pin"),
    n(c.notes, "note"),
    n(c.scopes, "view's scope", "views' scopes"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing said of it: its identity alone";
}
