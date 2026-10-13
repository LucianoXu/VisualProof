// Notes on a board (ViewSpec decision 23, CanvasSpec "Notes", the owner's decisions of 2026-10-09):
// short texts people and agents stick on a board. Since 2026-10-11 a note is the project's unless it
// is made a view's own (AttachmentSpec decisions 13–19): the project's notes are
// shared/projectnotes.ts's, and where either kind is on a board is shared/noteplace.ts's. What this
// file holds is a view note — ViewSpec decision 23's note, kept with its view on the server and
// changed by the view's operations (shared/views.ts), so that everyone on the board sees it at once —
// with its checks, and the rules both kinds share of how a note shows; it is drawn by the pages
// (web/src/sticky.ts).
//
// Where a view note is: attached to the most specific cluster at the spot where it was put, at an
// offset in that cluster's local coordinates, so that it moves with the cluster; on the canvas
// itself, in world coordinates, where no cluster is there. A note keeps the offsets of the spot in
// every cluster that held it, and in the world, so that when its cluster is gone (a new graph, a
// scope that no longer holds it) it goes to the nearest one that is still there, where the spot was
// in it, or to the canvas. Under the other clustering than the one it was put under it is on the
// ring around the board (AttachmentSpec decision 16), never in a cluster that happens to have the
// same key. Either kind may be attached to a declaration instead (the owner's decision of
// 2026-10-12, NoteDecl): that is its place under every clustering, and the place it has besides is
// where it falls back to when the declaration is gone. What is here runs the same on the server, in
// the pages and in the tests.

import type { ClusterMode, Layout } from "./graph.ts";
import type { Pins } from "./places.ts";
import { validPersonId } from "./review.ts";

/** What a note carries besides its text (AttachmentSpec decision 12): a file of the library by its
 *  content's hash — an image, a whole PDF (shown by its first page, or by `page` where one is given)
 *  — or a clip of a PDF's page, its region in the page's own fractions (0–1: left, top, right,
 *  bottom). Either kind of note may carry them, and keeps them when it is made the other kind. */
export interface NoteCarry {
  file: string;
  page?: number;
  region?: [number, number, number, number];
}

/** the most a note carries: a note is a few words and what they point at, not a folder */
export const MAX_CARRIES = 8;

/** Where an expanded note's card hangs from its icon (CanvasSpec, "Notes", the owner's decision of
 *  2026-10-11): the card's centre from the icon's centre, in pixels of the screen, x to the right and
 *  y down — a card keeps its size on the screen whatever the zoom, so its offset is kept in the same
 *  units. Either kind of note may have one; none is the default, up and to the right of the icon. It
 *  is never the note's place. */
export type NoteCard = [number, number];

/** the farthest a card's centre is kept from its icon along either axis, in pixels of the screen:
 *  further, it would be off a smaller screen than the one it was put on, whichever way it flips */
export const CARD_REACH = 600;

/** A note attached to a declaration (the owner's decisions of 2026-10-12; CanvasSpec "Notes",
 *  AttachmentSpec decisions 15–18): `name`, the declaration's full name, and `at`, where the note
 *  sits from the declaration's point — its icon's centre from the point's centre, in the board's
 *  world units (a declaration's point is 10 across, its neighbours about 10.3 apart), x to the right
 *  and y down, to a tenth of a unit, at least DECL_NEAR and at most DECL_FAR away. It is a place on
 *  the board, as a node's is, and scales with the zoom: zoomed out, the note sits close to its
 *  declaration, as a node near another would. Either kind of note may have one. Where it has one, it
 *  is the note's place under every clustering (a declaration is under both), and its places (a
 *  project note's) or its place (a view note's) are where it falls back to when the declaration is
 *  gone. */
export interface NoteDecl {
  name: string;
  at: [number, number];
}

/** where a note attached to a declaration sits by default, in the board's units: up and to the right
 *  of its point, about three declarations away — at the zoom a click on a declaration flies to (1.1),
 *  37 px on the screen, its leader showing */
export const DECL_AT: [number, number] = [24, -24];
/** the nearest an attached note sits to its declaration's point, centre to centre, in the board's
 *  units: a little more than a point across, so that it always has a side */
export const DECL_NEAR = 12;
/** the reach, in the board's units — about six declarations away: the radius of the circle round a
 *  declaration in which a note attached to it, dragged, stays attached, where that is between
 *  ZONE_MIN_PX and ZONE_MAX_PX on the screen (shared/notecard.ts, zonePx); and the furthest a drop
 *  pushes a note out from the point to clear it, so that a note let go on its point zoomed out stays
 *  near it on the board */
export const DECL_REACH = 64;
/** The circle in which a dragged note stays attached to its declaration (the owner's decision of
 *  2026-10-12), by its radius on the screen, in pixels: never smaller than ZONE_MIN_PX, so that zoomed
 *  out it shows well round the icon (24 px across), a short move does not leave it, and it holds an
 *  icon pushed out to clear the point (shared/notecard.ts, DECL_CLEAR_PX, 40 px); never larger than
 *  ZONE_MAX_PX, so that zoomed in a short move takes a note off its declaration too, and it still holds
 *  DECL_NEAR at the most zoom (144 px at 12). */
export const ZONE_MIN_PX = 48;
export const ZONE_MAX_PX = 160;
/** the least and the most zoom the canvas goes to (web/src/canvas.ts) */
export const ZOOM_LEAST = 0.02;
export const ZOOM_MOST = 12;
/** the farthest an attached note sits from its declaration's point, in the board's units: as far as
 *  the circle in which it stays attached reaches at the least zoom, so that wherever its icon is let
 *  go inside the circle, at any zoom, it is kept there */
export const DECL_FAR = ZONE_MIN_PX / ZOOM_LEAST;

/** A note's spot on a board. */
export interface NotePlace {
  /** the clustering it was put under */
  mode: ClusterMode;
  /** the clusters that held the spot, innermost first, each by key with the spot's offset from its
   *  origin */
  in: [string, number, number][];
  /** the spot in the board's world coordinates: where it goes when none of those is there */
  world: [number, number];
}

export interface StickyNote {
  id: string;
  /** plain text with a little Markdown (bold, italics, code); full names in backticks link */
  text: string;
  place: NotePlace;
  /** expanded, showing its text, or collapsed to an icon and its first words: the note's own
   *  state, shared, as folds are */
  open: boolean;
  /** who wrote it, attributed as pins are (server/views.ts): null where no name was given, or
   *  where it is kept anonymous */
  by: string | null;
  agent?: true;
  /** written by someone invited by a personal link (CollabSpec decision 9): the link's id, by which
   *  the page shows it under the name they go by now */
  person?: string;
  /** when it was written */
  at: string;
  /** its last edit: by whom, and when */
  edited?: { by: string | null; agent?: true; person?: string; at: string };
  /** what it carries (NoteCarry); absent while it carries nothing */
  carries?: NoteCarry[];
  /** where its card hangs from its icon (NoteCard); absent where it hangs as by default */
  card?: NoteCard;
  /** the declaration it is attached to (NoteDecl): its place under every clustering, `place` its
   *  fallback; absent where it is attached to none */
  decl?: NoteDecl;
}

/** The operations on a view's notes, applied the same way by the server and the pages
 *  (shared/views.ts, applyViewOps). The server stamps who wrote and edited, and when, as it
 *  records who dropped a pin. */
export type NoteOp =
  | { op: "note"; note: StickyNote }
  /** its text, and what it carries where `carries` is given (the whole list, [] for nothing) */
  | { op: "note-edit"; id: string; text: string; carries?: NoteCarry[]; by?: string | null; agent?: true; person?: string; at?: string }
  | { op: "note-move"; id: string; place: NotePlace }
  | { op: "note-open"; id: string; open: boolean }
  /** where its card hangs, null for the default: shared as its open state is, and no event */
  | { op: "note-card"; id: string; card: NoteCard | null }
  /** the declaration it is attached to, null for none: its place, as a move is, and no event; every
   *  other operation keeps it */
  | { op: "note-decl"; id: string; decl: NoteDecl | null }
  | { op: "note-delete"; id: string };

export const NOTE_OPS = ["note", "note-edit", "note-move", "note-open", "note-card", "note-decl", "note-delete"] as const;
/** the longest a note is, in characters */
export const MAX_NOTE_TEXT = 2000;
/** the most notes a view holds: a board, not a document */
export const MAX_NOTES = 300;

/** A cluster's radius on the screen below which a note in it shows collapsed, whatever its own
 *  state (CanvasSpec, "Notes"): an expanded note is some 240 px wide, and a cluster smaller than
 *  that on the screen would be covered by it, its labels and its neighbours with it. */
export const AUTO_COLLAPSE_PX = 120;

const CLUSTER_MODES: ClusterMode[] = ["namespace", "module"];
const finite = (v: unknown, most = 1e7): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < most;

export function validNoteId(x: unknown): x is string {
  return typeof x === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(x);
}

/** Why a note's text cannot be taken, or null. */
export function invalidNoteText(x: unknown): string | null {
  if (typeof x !== "string" || !x.trim()) return "A note needs text.";
  if (x.length > MAX_NOTE_TEXT) return `A note is at most ${MAX_NOTE_TEXT.toLocaleString("en")} characters.`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x)) return "A note's text has control characters.";
  return null;
}

/** Why what a note carries cannot be taken, or null: absent, or a list of at most MAX_CARRIES files
 *  of the library and clips of their pages (NoteCarry), none twice. A region is a box of a page, so
 *  it comes with the page. Whether the library has the files is the server's to say (`carryProblem`). */
export function invalidCarries(x: unknown): string | null {
  if (x === undefined) return null;
  if (!Array.isArray(x)) return "carries";
  if (x.length > MAX_CARRIES) return `A note carries at most ${MAX_CARRIES} files and clips.`;
  const seen = new Set<string>();
  for (const c of x as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || typeof c.file !== "string" || !/^[0-9a-f]{64}$/.test(c.file)) return "carries.file";
    if (c.page !== undefined && !(Number.isInteger(c.page) && (c.page as number) >= 1 && (c.page as number) < 1e6)) return "carries.page";
    if (c.region !== undefined) {
      const r = c.region as unknown[];
      if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) || !((r[2] as number) > (r[0] as number) && (r[3] as number) > (r[1] as number))) return "carries.region";
      if (c.page === undefined) return "carries.region: a clip is a region of a page, and comes with the page";
    }
    const key = carryKey(c as unknown as NoteCarry);
    if (seen.has(key)) return "A note carries a file or a clip once.";
    seen.add(key);
  }
  return null;
}

/** What a note carries with `c` attached (a note's Attach…): the list, `c` last; or why not — it
 *  carries that already, or as much as a note carries. */
export function withCarry(had: readonly NoteCarry[] | undefined, c: NoteCarry): NoteCarry[] | string {
  const list = had ?? [];
  if (list.some((x) => carryKey(x) === carryKey(c))) return "The note carries it already.";
  if (list.length >= MAX_CARRIES) return `A note carries at most ${MAX_CARRIES} files and clips: detach one first.`;
  return [...list, c];
}

/** The text of a note made of a clip (Clip to a note, in the reference window): what the field says
 *  where the reader wrote in it; left as it came (`label`, the link's label by default), the text
 *  selected, quoted in full with its page, where text was selected; else that label. At most
 *  MAX_NOTE_TEXT, cut with an ellipsis. */
export function clipNoteText(field: string, label: string, quote: string | null, page: number): string {
  const typed = field.replace(/\s+/g, " ").trim();
  const text = typed && typed !== label ? typed : quote ? `“${quote}” — p. ${page}` : typed || label;
  return text.length > MAX_NOTE_TEXT ? text.slice(0, MAX_NOTE_TEXT - 1) + "…" : text;
}

/** A carry as one key: its file, page and region, what tells two carries of a note apart. */
export const carryKey = (c: NoteCarry): string => `${c.file}:${c.page ?? ""}:${c.region?.join(",") ?? ""}`;

/** Whether two notes carry the same, in the same order (nothing and an empty list alike). */
export function sameCarries(a: readonly NoteCarry[] | undefined, b: readonly NoteCarry[] | undefined): boolean {
  const x = a ?? [], y = b ?? [];
  return x.length === y.length && x.every((c, k) => carryKey(c) === carryKey(y[k]));
}

/** What a note is to carry that it did not carry before (`had`): what the library checks. A carry it
 *  has already stays, whatever became of its file since — archived, or this server never had it. */
export function newCarries(next: readonly NoteCarry[] | undefined, had: readonly NoteCarry[] | undefined): NoteCarry[] {
  const old = new Set((had ?? []).map(carryKey));
  return (next ?? []).filter((c) => !old.has(carryKey(c)));
}

/** A file of the library as a carry is checked against it: its record's title, type, pages and
 *  whether it is archived (shared/library.ts, FileRecord). */
export interface CarriedFile {
  title: string;
  type: string;
  pages?: number;
  archived?: unknown;
}

/** Why a note cannot take carry `c`, the library's record of its file being `file` (null where the
 *  library has none), or null: the file is in the library and not archived; an image is carried
 *  whole; a page of a PDF is one it has. */
export function carryProblem(c: NoteCarry, file: CarriedFile | null): string | null {
  if (!file) return `The library has no file ${c.file.slice(0, 12)}…: add it to the library first.`;
  if (file.archived) return `${file.title} is archived: restore it from the library's archive to attach it.`;
  if (file.type !== "pdf") return c.page !== undefined || c.region ? `${file.title} is an image: a note carries it whole, with no page or region.` : null;
  if (c.page !== undefined && file.pages && c.page > file.pages) return `${file.title} has ${file.pages} page${file.pages === 1 ? "" : "s"}: page ${c.page} is not one of them.`;
  return null;
}

/** What a note carries as a record keeps it: only the fields a carry has, none where it is empty. */
export function cleanCarries(x: unknown): { carries?: NoteCarry[] } {
  if (invalidCarries(x) || !Array.isArray(x) || !x.length) return {};
  return { carries: (x as NoteCarry[]).map((c) => ({ file: c.file, ...(c.page !== undefined ? { page: c.page } : {}), ...(c.region ? { region: [...c.region] as NoteCarry["region"] } : {}) })) };
}

/** Why a card's offset cannot be taken, or null: a pair of numbers within CARD_REACH, or null (the
 *  default) where `none` allows it. */
export function invalidCard(x: unknown, none = true): string | null {
  if (x === null && none) return null;
  return Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= CARD_REACH) ? null : "card";
}

/** A card's offset as a record keeps it: whole pixels, none where it cannot be read. */
export function cleanCard(x: unknown): { card?: NoteCard } {
  return x !== undefined && !invalidCard(x, false) ? { card: [Math.round((x as NoteCard)[0]), Math.round((x as NoteCard)[1])] } : {};
}

/** Why the declaration a note is attached to cannot be taken, or null: a full name — some text on
 *  one line, at most 2,000 characters — and an offset within DECL_FAR (`reach`: the store reads any
 *  offset, and brings it within); or null (none) where `none` allows it. Whether the graph has that
 *  declaration is not asked: a note attached on a board of a past build may name one the latest
 *  build lacks. */
export function invalidDecl(x: unknown, none = true, reach = true): string | null {
  if (x === null && none) return null;
  const d = x as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return "decl";
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 2000 || /[\u0000-\u001f\u007f]/.test(d.name)) return "decl.name";
  const at = d.at as unknown[];
  if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === "number" && Number.isFinite(v))) return "decl.at";
  // within its reach, a tenth of a unit rounded either way
  if (reach && Math.hypot(at[0] as number, at[1] as number) > DECL_FAR + 0.1) return "decl.at";
  return null;
}

/** An offset of an attached note from its declaration's point (NoteDecl.at, the board's units) as it
 *  is kept: along its own direction, at least `near` (DECL_NEAR, or more where a drop asks it: never
 *  beyond DECL_REACH) and at most DECL_FAR from the point, to a tenth of a unit; DECL_AT where it has
 *  no direction. */
export function keptDecl(d: readonly [number, number], near = DECL_NEAR): [number, number] {
  const len = Math.hypot(d[0], d[1]);
  if (!(len >= 0.1)) return [DECL_AT[0], DECL_AT[1]];
  const least = Math.min(DECL_REACH, Math.max(DECL_NEAR, near));
  const f = len < least ? least / len : len > DECL_FAR ? DECL_FAR / len : 1;
  return [Math.round(d[0] * f * 10) / 10, Math.round(d[1] * f * 10) / 10];
}

/** The declaration a note is attached to as a record keeps it: its name, and its offset kept as
 *  keptDecl keeps it, brought within DECL_FAR, so that an attachment kept with an offset beyond it
 *  stays attached; none where it cannot be read. */
export function cleanDecl(x: unknown): { decl?: NoteDecl } {
  if (x === undefined || invalidDecl(x, false, false)) return {};
  const d = x as NoteDecl;
  return { decl: { name: d.name, at: keptDecl(d.at) } };
}

/** Note `n` attached to `decl` (null: to none); whether that changed it. */
export function setDecl(n: { decl?: NoteDecl }, decl: NoteDecl | null): boolean {
  const d = decl ? cleanDecl(decl).decl : undefined;
  if (d ? !!n.decl && n.decl.name === d.name && n.decl.at[0] === d.at[0] && n.decl.at[1] === d.at[1] : !n.decl) return false;
  if (d) n.decl = d;
  else delete n.decl;
  return true;
}

/** Note `n`'s card made to hang at `card` (null: as by default); whether that changed it. */
export function setCard(n: { card?: NoteCard }, card: NoteCard | null): boolean {
  const c = card ? cleanCard(card).card : undefined;
  if (c ? !!n.card && n.card[0] === c[0] && n.card[1] === c[1] : !n.card) return false;
  if (c) n.card = c;
  else delete n.card;
  return true;
}

/** Why a place cannot be taken, or null. */
export function invalidPlace(x: unknown): string | null {
  const p = x as Partial<NotePlace> | null;
  if (!p || typeof p !== "object") return "place";
  if (!CLUSTER_MODES.includes(p.mode as ClusterMode)) return "place.mode";
  if (!Array.isArray(p.in) || p.in.length > 64) return "place.in";
  for (const e of p.in) if (!Array.isArray(e) || e.length !== 3 || typeof e[0] !== "string" || !e[0] || e[0].length > 2000 || !finite(e[1]) || !finite(e[2])) return "place.in";
  if (!Array.isArray(p.world) || p.world.length !== 2 || !p.world.every((v) => finite(v))) return "place.world";
  return null;
}

/** Why a note operation is refused, or null. */
export function invalidNoteOp(o: Record<string, unknown>): string | null {
  if (o.op === "note") {
    const n = o.note as Record<string, unknown> | null;
    if (!n || typeof n !== "object") return "note";
    if (!validNoteId(n.id)) return "note.id";
    const t = invalidNoteText(n.text);
    if (t) return t;
    if (typeof n.open !== "boolean") return "note.open";
    if (n.card !== undefined && invalidCard(n.card, false)) return "note.card";
    if (n.decl !== undefined && invalidDecl(n.decl, false)) return "note.decl";
    return invalidPlace(n.place) ?? invalidCarries(n.carries);
  }
  if (!validNoteId(o.id)) return "id";
  if (o.op === "note-edit") return invalidNoteText(o.text) ?? invalidCarries(o.carries);
  if (o.op === "note-move") return invalidPlace(o.place);
  if (o.op === "note-open") return typeof o.open === "boolean" ? null : "open";
  if (o.op === "note-card") return invalidCard(o.card);
  if (o.op === "note-decl") return invalidDecl(o.decl);
  return o.op === "note-delete" ? null : "op";
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Apply one note operation to a view's notes in place; true when anything changed. A note
 *  beyond MAX_NOTES, or one whose id is taken, is not added. */
export function applyNoteOp(notes: StickyNote[], o: NoteOp): boolean {
  if (o.op === "note") {
    if (notes.length >= MAX_NOTES || notes.some((n) => n.id === o.note.id)) return false;
    const n = structuredClone(o.note);
    if (n.decl) n.decl = cleanDecl(n.decl).decl;
    if (!n.decl) delete n.decl;
    notes.push(n);
    return true;
  }
  const k = notes.findIndex((n) => n.id === o.id);
  if (k < 0) return false;
  const n = notes[k];
  switch (o.op) {
    case "note-edit":
      if (n.text === o.text && (o.carries === undefined || sameCarries(n.carries, o.carries))) return false;
      n.text = o.text;
      if (o.carries !== undefined) setCarries(n, o.carries);
      if (o.at) n.edited = { by: o.by ?? null, ...(o.agent ? { agent: true as const } : {}), ...(o.person ? { person: o.person } : {}), at: o.at };
      return true;
    case "note-move":
      n.place = structuredClone(o.place);
      return true;
    case "note-open":
      if (n.open === o.open) return false;
      n.open = o.open;
      return true;
    case "note-card":
      return setCard(n, o.card);
    case "note-decl":
      return setDecl(n, o.decl);
    case "note-delete":
      notes.splice(k, 1);
      return true;
  }
}

/** What note `n` carries made `carries`: a list of its own, none where it is empty. A new array
 *  each time, so that what was kept of the note before (the timeline's `before`) keeps the old one. */
export function setCarries(n: { carries?: NoteCarry[] }, carries: readonly NoteCarry[]): void {
  const c = cleanCarries(carries).carries;
  if (c) n.carries = c;
  else delete n.carries;
}

/** Who did something to a note, as the server takes it from whoever asks. */
export type NoteWho = { by: string | null; agent?: boolean; person?: string | null } | undefined;

/** Mark `x` (a new note, or an edit) as done by `who` at `at`: the name, the agent's mark, and the
 *  personal link they came by — never with a note without a name (a private reader's). */
export function stampWho(x: { by?: string | null; agent?: true; person?: string; at?: string }, who: NoteWho, at: string): void {
  x.by = who?.by ?? null;
  if (who?.agent) x.agent = true;
  else delete x.agent;
  if (x.by && who?.person && !who.agent) x.person = who.person;
  else delete x.person;
  x.at = at;
}

/** Stamp who does a note operation, and when, as the server records who dropped a pin: the
 *  author of a new note, the editor of an edit. */
export function stampNoteOp(o: NoteOp, who: NoteWho, at: string): void {
  if (o.op === "note") {
    stampWho(o.note, who, at);
    delete o.note.edited;
  } else if (o.op === "note-edit") stampWho(o, who, at);
}

/** A view's notes as views.json holds them, checked: one that cannot be read is left out. */
export function cleanNotes(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) return [];
  const out: StickyNote[] = [];
  for (const n of raw as Record<string, unknown>[]) {
    if (!n || typeof n !== "object" || !validNoteId(n.id) || invalidNoteText(n.text) || invalidPlace(n.place) || typeof n.open !== "boolean") continue;
    if (out.some((x) => x.id === n.id) || out.length >= MAX_NOTES) continue;
    const ed = n.edited;
    out.push({
      id: n.id,
      text: n.text as string,
      place: n.place as NotePlace,
      open: n.open,
      by: typeof n.by === "string" ? n.by : null,
      ...(n.agent === true ? { agent: true as const } : {}),
      ...(validPersonId(n.person) ? { person: n.person } : {}),
      at: typeof n.at === "string" ? n.at : new Date(0).toISOString(),
      ...cleanEdited(ed),
      ...cleanCarries(n.carries),
      ...cleanCard(n.card),
      ...cleanDecl(n.decl),
    });
  }
  return out;
}

/** A note's last edit as a file holds it, checked: none where it cannot be read. */
export function cleanEdited(ed: unknown): { edited?: NonNullable<StickyNote["edited"]> } {
  const e = ed as StickyNote["edited"] | undefined;
  return e && typeof e === "object" && typeof e.at === "string"
    ? { edited: { by: typeof e.by === "string" ? e.by : null, ...(e.agent ? { agent: true as const } : {}), ...(validPersonId(e.person) ? { person: e.person } : {}), at: e.at } }
    : {};
}

/** A cluster of a board as placing a note reads it: its key, its parent (-1 at the top), its
 *  centre in world coordinates and its radius, and whether a note can be put in it (it is drawn
 *  open: not folded, not inside a folded one, not hidden). */
export interface PlaceCluster {
  key: string;
  parent: number;
  depth: number;
  x: number;
  y: number;
  r: number;
  open: boolean;
}

/** The place of a spot of a board: the most specific open cluster whose circle holds it, and every
 *  cluster around that one, each with the spot's offset from its centre, and the spot itself. */
export function placeAt(mode: ClusterMode, world: [number, number], clusters: PlaceCluster[]): NotePlace {
  const [wx, wy] = world;
  let best = -1;
  clusters.forEach((c, k) => {
    if (!c.open || (c.x - wx) ** 2 + (c.y - wy) ** 2 > c.r * c.r) return;
    if (best < 0 || c.depth > clusters[best].depth) best = k;
  });
  const chain: [string, number, number][] = [];
  for (let k = best; k >= 0; k = clusters[k].parent) chain.push([clusters[k].key, round(wx - clusters[k].x), round(wy - clusters[k].y)]);
  return { mode, in: chain, world: [round(wx), round(wy)] };
}

/** A board's clusters as placing a note reads them, at rest: where its layout puts each, or its
 *  pin (in its parent's coordinates) where it has one, summed down the tree; folds close what they
 *  hold. The pages read their scene instead, which is where things are drawn. */
export function boardClusters(L: Layout, pins: Pins, folds: string[]): PlaceCluster[] {
  const folded = new Set(folds);
  const out: PlaceCluster[] = [];
  const at = (c: number): PlaceCluster => {
    if (out[c]) return out[c];
    const cl = L.clusters[c];
    const [lx, ly] = pins.clusters[cl.key] ?? [cl.lx, cl.ly];
    const up = cl.parent >= 0 ? at(cl.parent) : null;
    return (out[c] = { key: cl.key, parent: cl.parent, depth: cl.depth, x: (up?.x ?? 0) + lx, y: (up?.y ?? 0) + ly, r: cl.r, open: !folded.has(cl.key) && (up?.open ?? true) });
  };
  L.clusters.forEach((_, c) => at(c));
  return out;
}

/** Where declaration `i` (named `name`) is at rest on that board, in world coordinates. */
export function nodeSpot(L: Layout, pins: Pins, clusters: PlaceCluster[], i: number, name: string): [number, number] {
  const [lx, ly] = pins.nodes[name] ?? [L.lx[i], L.ly[i]];
  const c = L.cluster[i];
  return c >= 0 ? [clusters[c].x + lx, clusters[c].y + ly] : [lx, ly];
}

/** The place of a spot in cluster `c` and every cluster around it, whatever is folded: a note an
 *  agent puts beside a declaration is in the declaration's own cluster. */
export function placeIn(mode: ClusterMode, world: [number, number], clusters: PlaceCluster[], c: number): NotePlace {
  const chain: [string, number, number][] = [];
  for (let k = c; k >= 0; k = clusters[k].parent) chain.push([clusters[k].key, round(world[0] - clusters[k].x), round(world[1] - clusters[k].y)]);
  return { mode, in: chain, world: [round(world[0]), round(world[1])] };
}

/** Where a view note is on a layout clustered by `mode`: in cluster `c` at its offset (dx, dy) from
 *  the centre — the first cluster of its place the layout has, by key (`index`) — or on the canvas
 *  (`c` -1) at its world spot. Null under the other clustering than the one it was put under: it is
 *  on the ring there (shared/noteplace.ts), never matched by key, since a namespace and a folder
 *  can have the same key and be nothing alike (AttachmentSpec decision 18). */
export function resolvePlace(place: NotePlace, mode: ClusterMode, index: (key: string) => number): { c: number; dx: number; dy: number } | null {
  if (place.mode !== mode) return null;
  for (const [key, dx, dy] of place.in) {
    const c = index(key);
    if (c >= 0) return { c, dx, dy };
  }
  return { c: -1, dx: place.world[0], dy: place.world[1] };
}

/** How a note shows: expanded only when it is open and its cluster is large enough on the screen to
 *  hold it (`clusterPx`, its radius in pixels; null for a note on the canvas, which is never
 *  collapsed for the zoom). Zoomed out, every note is collapsed; zoomed in again, it is as its
 *  state says. */
export function noteLook(open: boolean, clusterPx: number | null): "open" | "shut" {
  return open && (clusterPx === null || clusterPx >= AUTO_COLLAPSE_PX) ? "open" : "shut";
}

/** The folded clusters that hide notes, and how many each hides: a note in a cluster that is
 *  folded, or inside one that is, is hidden, and counted on the outermost folded cluster around it
 *  (`shownAs`: that cluster, or -1 where the note's cluster is drawn open). */
export function noteMarkers(clustersOf: number[], shownAs: (c: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of clustersOf) {
    if (c < 0) continue;
    const r = shownAs(c);
    if (r >= 0) out.set(r, (out.get(r) ?? 0) + 1);
  }
  return out;
}

/** A note's first words, for its collapsed look: the Markdown marks left out. */
export function noteExcerpt(text: string, most = 18): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > most ? plain.slice(0, most - 1).trimEnd() + "…" : plain;
}

/** The declarations' names a note's text mentions, as the page links them: what it writes in
 *  backticks, and dotted names written bare (web/src/talk.ts, renderMarkdown). Activity and the
 *  agents' timeline say a note is about each. */
export function noteNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) out.add(m[1].trim());
  for (const m of text.replace(/`[^`\n]*`/g, " ").matchAll(/(?<![\w.'])[A-Za-z_\u00c0-\u024f][\w'!?\u00c0-\u024f]*(?:\.[\w'!?\u00c0-\u024f]+)+/g)) out.add(m[0]);
  return [...out];
}

/** A new note's id. */
export function newNoteId(): string {
  return "n" + Math.random().toString(36).slice(2, 10);
}
