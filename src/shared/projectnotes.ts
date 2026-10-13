// The project's notes (AttachmentSpec decisions 13–19, the owner's of 2026-10-11): a note is the
// project's, one note, an item that belongs to views as declarations do — the Project holds every
// one, another view those its scope gives and those added to it (shared/items.ts) — unless it is
// made a view's own (shared/sticky.ts, a view note). It is kept in the server's state beside the views — not in
// the review's log — and changed by operations applied the same way on the server and in every page
// (shared/views.ts, ViewBook), so that it is shared live as the views' operations are. Writing,
// editing and deleting one are events of the timeline; opening, collapsing and moving one are not.
//
// Where a project note is: one place per clustering (decision 15). Under a clustering it is either
// in a cluster — by the cluster's key and every key around it, each with the note's spot as a
// fraction of that cluster's radius, so that it is the same spot of the circle on every board
// whatever the circle's size — or at the top level, on the ring around the board at the angle where
// it was let go; or it has no place there yet, and is on the ring at the angle of what it is about
// (decision 16). Moving it on a board sets its place under that board's clustering alone. A note may
// also be attached to a declaration (the owner's decision of 2026-10-12): a declaration is under
// both clusterings, so the attachment is its place under every one, and its places are where it
// falls back to when the declaration is gone with no rename. How a place is read on a board, and
// which boards show the note, is shared/noteplace.ts's.

import type { ClusterMode } from "./graph.ts";
import { cleanCard, cleanCarries, cleanDecl, cleanEdited, invalidCard, invalidCarries, invalidDecl, invalidNoteText, sameCarries, setCard, setCarries, setDecl, stampWho, validNoteId } from "./sticky.ts";
import type { NoteCard, NoteCarry, NoteDecl, NoteWho, StickyNote } from "./sticky.ts";
import { validPersonId } from "./review.ts";

/** A project note's place under one clustering: in a cluster — its key first, then every key around
 *  it, each with the spot as a fraction of that cluster's radius (x, y) — or on the ring, at an angle
 *  in degrees clockwise from the top. */
export type ClusterPlace = { in: [string, number, number][] } | { ring: number };

export interface ProjectNote {
  id: string;
  /** plain text with a little Markdown (bold, italics, code); full names in backticks link */
  text: string;
  /** its place per clustering; none where nobody has put it anywhere under that clustering yet */
  places: Partial<Record<ClusterMode, ClusterPlace>>;
  /** expanded or collapsed: its own state, shared, as folds are */
  open: boolean;
  /** who wrote it, attributed as a view note's author is (shared/sticky.ts) */
  by: string | null;
  agent?: true;
  person?: string;
  at: string;
  /** its last edit: by whom, and when — VisualProof's, where a build carried it to the cluster its
   *  declarations moved to (decision 18) */
  edited?: { by: string | null; agent?: true; person?: string; at: string };
  /** what it carries besides its text: files of the library and clips of their pages (decision 12) */
  carries?: NoteCarry[];
  /** where its card hangs from its icon, in pixels of the screen (shared/sticky.ts, NoteCard); absent
   *  where it hangs as by default. One for every board, never its place. */
  card?: NoteCard;
  /** the declaration it is attached to (shared/sticky.ts, NoteDecl; the owner's decision of
   *  2026-10-12): its place under every clustering, `places` where it falls back to when the
   *  declaration is gone; absent where it is attached to none */
  decl?: NoteDecl;
}

/** The operations on the project's notes, applied the same way by the server and the pages. The
 *  server stamps who wrote and edited, and when. A move under one clustering leaves the other as it
 *  is; `place` null takes its place there away (it goes on the ring about what it is about). `by` and
 *  `at` on a move are the server's own, when a build carried the note (decision 18): an edit by
 *  VisualProof. */
export type ProjectNoteOp =
  | { op: "pnote"; note: ProjectNote }
  /** its text, and what it carries where `carries` is given (the whole list, [] for nothing) */
  | { op: "pnote-edit"; id: string; text: string; carries?: NoteCarry[]; by?: string | null; agent?: true; person?: string; at?: string }
  | { op: "pnote-move"; id: string; mode: ClusterMode; place: ClusterPlace | null; by?: string; at?: string }
  | { op: "pnote-open"; id: string; open: boolean }
  /** where its card hangs, null for the default: shared as its open state is, and no event */
  | { op: "pnote-card"; id: string; card: NoteCard | null }
  /** the declaration it is attached to, null for none: its place under every clustering, as a move
   *  is, and no event; every other operation keeps it, a move under one clustering moving only its
   *  fallback there */
  | { op: "pnote-decl"; id: string; decl: NoteDecl | null }
  | { op: "pnote-delete"; id: string };

export const PROJECT_NOTE_OPS = ["pnote", "pnote-edit", "pnote-move", "pnote-open", "pnote-card", "pnote-decl", "pnote-delete"] as const;

/** the most notes the project holds: each shows only where what it is about is, so a project holds
 *  more than a board (MAX_NOTES), but it is still not a document */
export const MAX_PROJECT_NOTES = 1000;

const CLUSTER_MODES: ClusterMode[] = ["namespace", "module"];
/** how far out a spot's fraction of its radius may be as sent: it is brought inside the circle where
 *  it is drawn */
const FAR = 4;

/** Why a place under one clustering cannot be taken, or null. */
export function invalidClusterPlace(x: unknown): string | null {
  const p = x as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "place";
  if ("ring" in p) return typeof p.ring === "number" && Number.isFinite(p.ring) && Math.abs(p.ring) <= 3600 && Object.keys(p).length === 1 ? null : "place.ring";
  if (!Array.isArray(p.in) || p.in.length === 0 || p.in.length > 64) return "place.in";
  for (const e of p.in as unknown[]) {
    if (!Array.isArray(e) || e.length !== 3 || typeof e[0] !== "string" || !e[0] || e[0].length > 2000) return "place.in";
    if (![e[1], e[2]].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= FAR)) return "place.in";
  }
  return null;
}

/** Why a note's places cannot be taken, or null. */
export function invalidPlaces(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return "places";
  for (const [m, p] of Object.entries(x as Record<string, unknown>)) {
    if (!CLUSTER_MODES.includes(m as ClusterMode)) return "places";
    const why = invalidClusterPlace(p);
    if (why) return why;
  }
  return null;
}

/** Why an operation on the project's notes is refused, or null. */
export function invalidProjectNoteOp(o: Record<string, unknown>): string | null {
  if (o.op === "pnote") {
    const n = o.note as Record<string, unknown> | null;
    if (!n || typeof n !== "object") return "note";
    if (!validNoteId(n.id)) return "note.id";
    const t = invalidNoteText(n.text);
    if (t) return t;
    if (typeof n.open !== "boolean") return "note.open";
    if (n.card !== undefined && invalidCard(n.card, false)) return "note.card";
    if (n.decl !== undefined && invalidDecl(n.decl, false)) return "note.decl";
    return invalidPlaces(n.places) ?? invalidCarries(n.carries);
  }
  if (!validNoteId(o.id)) return "id";
  if (o.op === "pnote-edit") return invalidNoteText(o.text) ?? invalidCarries(o.carries);
  if (o.op === "pnote-move") return !CLUSTER_MODES.includes(o.mode as ClusterMode) ? "mode" : o.place === null ? null : invalidClusterPlace(o.place);
  if (o.op === "pnote-open") return typeof o.open === "boolean" ? null : "open";
  if (o.op === "pnote-card") return invalidCard(o.card);
  if (o.op === "pnote-decl") return invalidDecl(o.decl);
  return o.op === "pnote-delete" ? null : "op";
}

/** Why a list of operations on the project's notes is refused, or null. */
export function invalidProjectNoteOps(ops: unknown): string | null {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 400) return "ops";
  for (const o of ops as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") return "op";
    const why = invalidProjectNoteOp(o);
    if (why) return why;
  }
  return null;
}

/** A place under one clustering as a record keeps it: a ring's angle within a turn, a spot's
 *  fractions to the tenth of a percent. */
export function cleanClusterPlace(p: ClusterPlace): ClusterPlace {
  if ("ring" in p) return { ring: Math.round((((p.ring % 360) + 360) % 360) * 10) / 10 };
  const f = (v: number) => Math.round(v * 1000) / 1000;
  return { in: p.in.map(([k, x, y]) => [k, f(x), f(y)] as [string, number, number]) };
}

/** Apply one operation to the project's notes in place; true when anything changed. A note beyond
 *  MAX_PROJECT_NOTES, or one whose id is taken, is not added. */
export function applyProjectNoteOp(notes: ProjectNote[], o: ProjectNoteOp): boolean {
  if (o.op === "pnote") {
    if (notes.length >= MAX_PROJECT_NOTES || notes.some((n) => n.id === o.note.id)) return false;
    const n = structuredClone(o.note);
    for (const m of CLUSTER_MODES) if (n.places[m]) n.places[m] = cleanClusterPlace(n.places[m]!);
    if (n.decl) n.decl = cleanDecl(n.decl).decl;
    if (!n.decl) delete n.decl;
    notes.push(n);
    return true;
  }
  const k = notes.findIndex((n) => n.id === o.id);
  if (k < 0) return false;
  const n = notes[k];
  switch (o.op) {
    case "pnote-edit":
      if (n.text === o.text && (o.carries === undefined || sameCarries(n.carries, o.carries))) return false;
      n.text = o.text;
      if (o.carries !== undefined) setCarries(n, o.carries);
      if (o.at) n.edited = { by: o.by ?? null, ...(o.agent ? { agent: true as const } : {}), ...(o.person ? { person: o.person } : {}), at: o.at };
      return true;
    case "pnote-move":
      if (o.place === null) {
        if (!n.places[o.mode]) return false;
        delete n.places[o.mode];
      } else n.places[o.mode] = cleanClusterPlace(o.place);
      if (o.by && o.at) n.edited = { by: o.by, at: o.at };
      return true;
    case "pnote-open":
      if (n.open === o.open) return false;
      n.open = o.open;
      return true;
    case "pnote-card":
      return setCard(n, o.card);
    case "pnote-decl":
      return setDecl(n, o.decl);
    case "pnote-delete":
      notes.splice(k, 1);
      return true;
  }
}

/** Stamp who does an operation on the project's notes, and when, as for a view note: the author of
 *  a new note, the editor of an edit. A page's move says nothing of who: only the server records a
 *  carry as its edit. */
export function stampProjectNoteOp(o: ProjectNoteOp, who: NoteWho, at: string): void {
  if (o.op === "pnote") {
    stampWho(o.note, who, at);
    delete o.note.edited;
  } else if (o.op === "pnote-edit") stampWho(o, who, at);
  else if (o.op === "pnote-move") {
    delete o.by;
    delete o.at;
  }
}

/** The project's notes as a file holds them, checked: one that cannot be read is left out. */
export function cleanProjectNotes(raw: unknown): ProjectNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectNote[] = [];
  for (const n of raw as Record<string, unknown>[]) {
    if (!n || typeof n !== "object" || !validNoteId(n.id) || invalidNoteText(n.text) || invalidPlaces(n.places) || typeof n.open !== "boolean") continue;
    if (out.some((x) => x.id === n.id) || out.length >= MAX_PROJECT_NOTES) continue;
    const places: ProjectNote["places"] = {};
    for (const m of CLUSTER_MODES) {
      const p = (n.places as ProjectNote["places"])[m];
      if (p) places[m] = cleanClusterPlace(p);
    }
    out.push({
      id: n.id,
      text: n.text as string,
      places,
      open: n.open,
      by: typeof n.by === "string" ? n.by : null,
      ...(n.agent === true ? { agent: true as const } : {}),
      ...(validPersonId(n.person) ? { person: n.person } : {}),
      at: typeof n.at === "string" ? n.at : new Date(0).toISOString(),
      ...cleanEdited(n.edited),
      ...cleanCarries(n.carries),
      ...cleanCard(n.card),
      ...cleanDecl(n.decl),
    });
  }
  return out;
}

/** What both kinds of note have besides where they are: what a switch between them keeps. */
function common(n: ProjectNote | StickyNote): Omit<ProjectNote, "places"> {
  return {
    id: n.id,
    text: n.text,
    open: n.open,
    by: n.by,
    ...(n.agent ? { agent: true as const } : {}),
    ...(n.person ? { person: n.person } : {}),
    at: n.at,
    ...(n.edited ? { edited: structuredClone(n.edited) } : {}),
    ...(n.carries?.length ? { carries: structuredClone(n.carries) } : {}),
    ...(n.card ? { card: [n.card[0], n.card[1]] as NoteCard } : {}),
    ...(n.decl ? { decl: { name: n.decl.name, at: [n.decl.at[0], n.decl.at[1]] as [number, number] } } : {}),
  };
}

/** A project note made a view's own (decision 14, Only in this view): its text, author, state, what
 *  it carries, where its card hangs and the declaration it is attached to kept, at `place`, where it
 *  is on the board it was switched on — its fallback, where it is attached. */
export function asViewNote(n: ProjectNote, place: StickyNote["place"]): StickyNote {
  return { ...common(n), place: structuredClone(place) };
}

/** A view note made the project's (In every view): kept as it is, attached to the declaration it was
 *  attached to, at `place` under the clustering of the board it was switched on — where it is there,
 *  its fallback where it is attached — and with no place under the other. */
export function asProjectNote(n: StickyNote, mode: ClusterMode, place: ClusterPlace): ProjectNote {
  return { ...common(n), places: { [mode]: cleanClusterPlace(place) } };
}
