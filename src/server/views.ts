// The views on a server (ViewSpec.md), kept in `<site>/views.json`: the book (shared/views.ts) of
// every kept view — the Project, the views people made, arranged or linked to targets —
// with its scope, clustering, and pins, folds and hidden levels per way of clustering; the views
// nobody keeps live here only while a page has them open. Each board's layout memory
// (shared/board.ts) is kept beside it, one file per view in `<site>/view-memory/`.
//
// Every change goes out live, per view and with who made it: `views` (the list, and what changed),
// `view-ops` (pins, folds, hidden levels, notes and the build shown as operations, as `places` did),
// `view-memory` (a board was laid out for a new set). The timeline records views saved for everyone,
// renamed, deleted, laid out afresh and kept at a past build (HistorySpec decision 19), and notes
// written, edited and deleted (shared/sticky.ts), each under who did it as the note records its
// author: the attribution pins have.
//
// A target's link is kept in the record of the view it is linked to (ViewSpec decision 29). A view
// nobody keeps is not written down, so a link a click made to it goes with it, at a start too; and
// since marking a target makes no view (the owner's decision of 2026-10-12), nothing is kept of the
// targets that have none. A `viewless` list an earlier version wrote is not read.
//
// The project's notes (AttachmentSpec decisions 13–19, shared/projectnotes.ts) are kept in the same
// file, beside the views: they go out as `note-ops`, as a view's notes go out in `view-ops`, and the
// timeline records them written, edited and deleted (their `view` ""), and carried by a build to
// the cluster their declarations moved to, as an edit by VisualProof; a note attached to a
// declaration follows it to another name (moveDeclaration). What a note of either kind
// carries (AttachmentSpec decision 12) is checked against the library as it is written: a file or a
// clip a note is to carry and did not before must be a file the library has, not archived.
//
// A view's items (the owner's decision of 2026-10-11, shared/items.ts) are kept in its record: the
// notes of the project added to it and taken out of it, changed by the `item` operation, which goes
// out in `view-ops` as pins do and is an event of the timeline as a scope change is (`items`). A
// note written in a view is added to it (`arrangeNotes`, `written`), with no event of its own beside
// the note's; a note deleted, or made a view's own, leaves every list.
//
// Who dropped a pin is kept per view beside its pins (shared/views.ts, PinAuthor) and never sent
// to the pages. What a private reader arranges is recorded without a name (CollabSpec decision 8):
// `handle` takes its author from identity.ts (`layoutAuthor`), and so does whatever arranges a board
// through it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardMemory } from "../shared/board.ts";
import type { Peer } from "../shared/collab.ts";
import type { ClusterMode } from "../shared/graph.ts";
import { CLUSTER_MODES, emptyLayouts } from "../shared/places.ts";
import type { PlaceOp, Pins, PlacesData } from "../shared/places.ts";
import { cleanQuery, invalidQuery, printQuery, QueryError, parseQuery } from "../shared/query.ts";
import { validPersonId } from "../shared/review.ts";
import type { Query } from "../shared/query.ts";
import type { NewEvent, StoredEvent } from "../shared/timeline.ts";
import { cleanItems, itemIn, itemShown } from "../shared/items.ts";
import type { ItemOp } from "../shared/items.ts";
import { addedNames, filesOf, formerNames, validSha } from "../shared/library.ts";
import type { LibraryData } from "../shared/library.ts";
import { carryProblem, cleanNotes, invalidPlace, MAX_NOTE_TEXT, newCarries, newNoteId, sameCarries } from "../shared/sticky.ts";
import { renameInNote, renameInQuery } from "../shared/moves.ts";
import type { CarriedFile, NoteCarry, NotePlace, StickyNote } from "../shared/sticky.ts";
import { carriedNotes } from "../shared/noteplace.ts";
import { applyProjectNoteOp, cleanProjectNotes, invalidClusterPlace, invalidProjectNoteOps, MAX_PROJECT_NOTES } from "../shared/projectnotes.ts";
import type { ClusterPlace, ProjectNote, ProjectNoteOp } from "../shared/projectnotes.ts";
import { cleanAuthors, invalidViewOps, PROJECT, summary, validVersion, ViewBook, viewTitle } from "../shared/views.ts";
import type { TitleContext } from "../shared/views.ts";
import type { Change, PinAuthor, PinAuthors, ViewData, ViewOp, ViewSummary } from "../shared/views.ts";
import type { AgentLevel, Answer, Ask } from "./agent.ts";
import { refusal } from "./agent.ts";
import { layoutAuthor } from "./identity.ts";

/** Whether an edit changed note `n` as it was before: its text, or what it carries (an attachment
 *  added or taken away is an edit of the note, as its text is). */
const edited = (n: { text: string; carries?: NoteCarry[] } | undefined, o: { text: string; carries?: NoteCarry[] }): boolean =>
  !!n && (n.text !== o.text || (o.carries !== undefined && !sameCarries(n.carries, o.carries)));

/** how long a view nobody keeps outlives the last page that had it open: a reload comes back */
const GRACE_MS = 8000;
/** how long a private page's holds outlive its last event stream (a reload is a new page) */
const HOLD_MS = 60_000;
/** the most views one private page holds */
const MAX_HOLDS = 100;

interface Stored {
  layoutVersion: number;
  /** every kept view; one that could not be read is written back as it was read, with why */
  views: (ViewData | (Record<string, unknown> & { unreadable: string }))[];
  /** who dropped each pin, per kept view */
  authors?: Record<string, unknown>;
  /** the project's notes (shared/projectnotes.ts); one that cannot be read is left out */
  notes?: unknown;
  /** the files of the library a note was written for as they came (AttachmentSpec decision 12),
   *  by hash: never written for again */
  filesNoted?: unknown;
  /** each file's title as the notes last followed it, by hash; absent until the notes were first set
   *  to their files' titles (Views.followTitles) */
  fileTitles?: unknown;
}

/** A view in views.json that cannot be used now — a scope beyond what a query may be (QUERY_LIMITS:
 *  bounds can change between versions), a record broken by hand. It is not dropped: it stays in
 *  the file as it was, said at the start and listed (`unreadable`), and comes back by itself once
 *  it can be read again. */
export interface UnreadableView {
  id: string | null;
  name: string | null;
  why: string;
  raw: Record<string, unknown>;
}

/** The most a board's layout memory may be when a page hands it over: room for a board of a large
 *  project's declarations four times over (the showcase's whole board, 7,851 declarations, is
 *  1.8 MB). */
export const MAX_MEMORY_BYTES = 8 << 20;

const isPins = (p: unknown): p is Pins => {
  const o = p as Record<string, unknown> | null;
  const places = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((a) => Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === "number" && Number.isFinite(v)));
  return !!o && typeof o === "object" && places(o.nodes) && places(o.clusters);
};

/** A kept view as views.json holds it, checked: the view, or why it cannot be used. A field a file
 *  written by an older version lacks takes its default. */
export function readView(raw: unknown): ViewData | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "it is not a view's record";
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return "it has no id";
  const bad = invalidQuery(r.scope);
  if (bad) return `its scope cannot be read: ${bad}`;
  const clustering = r.clustering ?? "namespace";
  if (!CLUSTER_MODES.includes(clustering as ClusterMode)) return "its clustering is neither namespace nor module";
  const pins = (r.pins ?? emptyLayouts()) as Record<string, unknown>;
  if (!CLUSTER_MODES.every((m) => isPins(pins[m]))) return "its pins are not pins";
  const folds = (r.folds ?? { namespace: [], module: [] }) as Record<string, unknown>;
  if (!CLUSTER_MODES.every((m) => Array.isArray(folds[m]) && (folds[m] as unknown[]).every((k) => typeof k === "string"))) return "its folds are not lists of clusters";
  const hidden = (r.hidden ?? { namespace: [], module: [] }) as Record<string, unknown>;
  if (!CLUSTER_MODES.every((m) => Array.isArray(hidden[m]) && (hidden[m] as unknown[]).every((k) => typeof k === "string"))) return "its hidden levels are not lists of clusters";
  if (r.name !== null && r.name !== undefined && typeof r.name !== "string") return "its name is not text";
  // a note that cannot be read is left out; the others are the view's
  const notes = cleanNotes(r.notes);
  // the notes of the project added to it and taken out of it; the Project keeps none, holding all
  const items = r.id === PROJECT ? {} : cleanItems(r.items);
  return {
    id: r.id,
    name: (r.name as string | null | undefined) ?? null,
    scope: cleanQuery(r.scope)!,
    clustering: clustering as ClusterMode,
    pins: pins as Record<ClusterMode, Pins>,
    folds: folds as Record<ClusterMode, string[]>,
    ...(notes.length ? { notes } : {}),
    ...items,
    hidden: hidden as Record<ClusterMode, string[]>,
    by: typeof r.by === "string" ? r.by : null,
    at: typeof r.at === "string" ? r.at : new Date(0).toISOString(),
    // who made it: an agent, or someone invited by a personal link (shared/views.ts, marksOf)
    ...(r.agent === true ? { agent: true as const } : typeof r.by === "string" && validPersonId(r.person) ? { person: r.person } : {}),
    kept: true,
    // the targets linked to it, in the order they were linked; a record written before a view could
    // be several targets' (the owner's decision of 2026-10-11) names its one as `target`, and is read
    // so, that the links people set are not lost
    ...linkedOf(r),
    // the view's focus as set (ViewSpec decision 28): a name, or null for none
    ...(r.focus === null || (typeof r.focus === "string" && r.focus.length > 0 && r.focus.length <= 2000) ? { focus: r.focus as string | null } : {}),
    // the build it is kept at (HistorySpec decision 19); a value that is no snapshot's id is dropped
    ...(validVersion(r.version) ? { version: r.version } : {}),
  };
}

/** The targets linked to a view as its record on disk says them (ViewData.targets): names, each once. */
function linkedOf(r: Record<string, unknown>): { targets?: string[] } {
  const raw = Array.isArray(r.targets) ? r.targets : typeof r.target === "string" ? [r.target] : [];
  const targets = [...new Set(raw.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 2000))];
  return targets.length ? { targets } : {};
}

/** What a move of a declaration changed on one view (Views.moveDeclaration), for undoing it: its
 *  operations, its scope before and after, and whether its focus was moved. */
export interface ViewsMoved {
  /** the view; "" for the project's notes, whose mentions a move edits too */
  view: string;
  ops: (ViewOp | ProjectNoteOp)[];
  scope?: [string, string];
  focus?: true;
}

/** One view's pins, one set per way of clustering, as the agents' API (server/agent.ts) reads and
 *  changes them. */
export interface ViewPlaces {
  data: PlacesData;
  apply(ops: PlaceOp[], who?: { by: string | null; agent?: boolean }): boolean;
  authorOf(mode: ClusterMode, kind: "node" | "cluster", key: string): PinAuthor | null;
}

/** An answer as the page's endpoints give one: `{error}`, and `who` when a name is needed. */
const no = (status: number, error: string, more: Record<string, unknown> = {}): Answer => ({ status, body: { error, ...more } });
const ok = (body: unknown): Answer => ({ status: 200, body });
const NEED_NAME = no(401, "Say who you are first.", { who: true });

/** A query from a request: its JSON form or its text; why not, when it is neither. */
export function readQuery(x: unknown): Query | string {
  if (typeof x === "string") {
    try {
      return parseQuery(x);
    } catch (e) {
      return e instanceof QueryError ? `The scope cannot be read at ${e.at}: ${e.message}.` : String(e);
    }
  }
  return cleanQuery(x) ?? `The scope cannot be used: ${invalidQuery(x)}. Send its text (e.g. tcb(A.b) except trusted) or its JSON form.`;
}

/** A layout's memory as a page sent it, checked; null when it is not one. */
function cleanMemory(x: unknown): BoardMemory | null {
  const m = x as { set?: unknown; mem?: { nodes?: unknown; clusters?: unknown } } | null;
  if (!m || typeof m.set !== "string" || m.set.length > 200 || !m.mem || typeof m.mem !== "object") return null;
  const nodes = m.mem.nodes as Record<string, unknown> | undefined, clusters = m.mem.clusters as Record<string, unknown> | undefined;
  if (!nodes || !clusters || typeof nodes !== "object" || typeof clusters !== "object") return null;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e8;
  let n = 0;
  for (const v of Object.values(nodes)) if (++n > 200000 || !Array.isArray(v) || v.length !== 3 || !num(v[0]) || !num(v[1]) || typeof v[2] !== "string") return null;
  for (const v of Object.values(clusters)) if (++n > 200000 || !Array.isArray(v) || v.length !== 3 || !v.every(num)) return null;
  return { set: m.set, mem: { nodes, clusters } as BoardMemory["mem"] };
}

export class Views {
  readonly book: ViewBook;
  private file: string;
  private memDir: string;
  private layoutVersion: number;
  private send: (event: string, data: unknown) => void;
  /** what records views made, renamed, deleted and laid out afresh; none for an export */
  private timeline: { add(e: NewEvent): StoredEvent } | null;
  /** the Project view laid out afresh: the server lays the graph out anew (server/live.ts) */
  onProjectRelayout: () => void = () => {};
  /** who is here now (server/presence.ts): a view nobody keeps lives while one of them has it open */
  peers: () => Peer[] = () => [];
  /** which page a page's secret stands for (server/live.ts): the `from` of the operations it sends,
   *  so that it skips its own when they come back; null when it is no open page's */
  pageOf: (token: unknown) => string | null = () => null;
  /** why a layout's memory does not fit the board it is handed over for, with the status to answer
   *  (server/agentviews.ts, `memoryProblem`); the live server reads the board on its graph */
  checkMemory: (v: ViewData, mode: ClusterMode, m: BoardMemory) => { status: number; error: string } | null = () => null;
  /** the kept views views.json holds that cannot be read now (UnreadableView) */
  readonly unreadable: UnreadableView[] = [];
  private unreadableAuthors: Record<string, unknown> = {};
  /** The views private pages hold (CollabSpec decision 8), by the session each page calls itself:
   *  such a page says nothing of what it has open, so a view nobody keeps lives while a page that
   *  read or opened it while private is open, as it does while it is in the others' tabs. Nobody is
   *  told of them. */
  private holds = new Map<string, { ids: Set<string>; at: number }>();
  /** whether a page of this session has its event stream open (server/live.ts) */
  sessionOpen: (session: string) => boolean = () => false;
  /** when snapshot `id` was built (server/history.ts), or null where there is no such snapshot: a
   *  view is kept only at a build the history has (HistorySpec decision 19); none without a history */
  snapshotAt: (id: number) => string | null = () => null;
  /** what a view's title is told with (shared/views.ts, viewTitle): the graph on show's names, the
   *  history's builds (server/live.ts) */
  titles: () => TitleContext = () => ({});

  /** the latest build's snapshot, the graph on show's (server/history.ts); null without a history */
  latest: () => number | null = () => null;

  /** whether a name is a target of the review now (server/live.ts): what a view is focused on */
  isTarget: (name: string) => boolean = () => true;

  /** the library's record of a file (server/live.ts reads it from the review), against which what a
   *  note is to carry is checked; null where nothing checks it (a book read for an export) */
  carriedFile: ((sha: string) => CarriedFile | null) | null = null;

  /** The files of the library a project note was written for as they came, or that a note carried
   *  already then (AttachmentSpec decision 12, the owner's of 2026-10-11): each is considered once,
   *  so that a restart writes nothing again and a note deleted stays deleted. */
  private filesNoted = new Set<string>();

  /** Whether any note, the project's or a view's, carries file `sha`. */
  private carried(sha: string): boolean {
    const has = (n: { carries?: NoteCarry[] }) => !!n.carries?.some((c) => c.file === sha);
    return this.book.notes.some(has) || this.book.list().some((v) => (v.notes ?? []).some(has));
  }

  /** A file came into the library (its first record, by upload or by URL, from a person or an agent):
   *  every item shows on the Project (the owner's decision of 2026-10-11), so a note of the project
   *  carries it — collapsed, its text the file's title, written by whoever added the file, at the
   *  top level under both clusterings, with no place: on the Project's ring, in the order notes were
   *  written, and on another view's only where a link or an add brings it (decisions 16–17). `note` false where the page writes the note itself, at the spot
   *  a file was dropped or pasted on the canvas. Nothing where a note carries the file already, or
   *  it was considered before. Whether a note was written. */
  fileAdded(f: { sha: string; title: string }, who: { by: string; agent: boolean; person: string | null }, note = true): boolean {
    // its title as notes follow it (followTitles), written down with what follows
    if (this.fileTitles && !this.fileTitles.has(f.sha)) this.fileTitles.set(f.sha, f.title);
    if (this.filesNoted.has(f.sha)) return false;
    this.filesNoted.add(f.sha);
    const write = note && !this.carried(f.sha) && this.book.notes.length < MAX_PROJECT_NOTES;
    const n: ProjectNote = { id: newNoteId(), text: noteTitle(f.title), places: {}, open: false, by: who.by, at: new Date().toISOString(), carries: [{ file: f.sha }] };
    // a note refused (a file archived meanwhile) leaves the file considered all the same
    if (!write || this.arrangeNotes([{ op: "pnote", note: n }], null, who.by, who.agent, who.person) !== null || !this.book.notes.some((x) => x.id === n.id)) {
      this.save();
      return false;
    }
    return true;
  }

  /** Once, at the start: every file the library has a record of, not archived, that was never
   *  considered — the files added before the notes carried them (the owner's decision of
   *  2026-10-11), and those whose records came through the review's logs since the last start —
   *  gets its note as one just added would, written by `by` (VisualProof), unless a note carries it
   *  already. How many notes were written. */
  noteLibraryFiles(files: readonly { sha: string; title: string; archived?: unknown }[], by: string): number {
    let made = 0;
    for (const f of files) if (!f.archived && this.fileAdded(f, { by, agent: false, person: null })) made++;
    return made;
  }

  /** Each file's title as the notes last followed it, by hash (views.json `fileTitles`); null until
   *  the notes were first set to their files' titles, once (followTitles). */
  private fileTitles: Map<string, string> | null = null;

  /** The library's records as the review has them now (server/live.ts calls it at the start and at
   *  each change of the review, wherever the change came from): a note's text follows its file's title
   *  (the owner's decision of 2026-10-11). Where a file's title is not the one the notes last
   *  followed — renamed in the library since, by anyone, on this server or another — every note that
   *  carries that file alone and whose text is the title it had, or the name the file was added under,
   *  takes the new title, as an edit by `by` (VisualProof); a text someone wrote stays. Once, the first
   *  time (no `fileTitles` in views.json): every note that carries one file alone and whose text is any
   *  name that file went by before — the name it was added under, the title it was added with, a title
   *  an edit took from it (formerNames) — takes its title now, so that the notes made of files renamed
   *  before notes followed their titles say them. How many notes followed. */
  followTitles(d: LibraryData, by: string): number {
    const files = filesOf(d);
    let made = 0;
    let first = false;
    if (!this.fileTitles) {
      made += this.retitle(files.map((f) => ({ sha: f.sha, from: formerNames(d, f.sha), to: f.title })), by);
      this.fileTitles = new Map();
      first = true;
    }
    const renamed: { sha: string; from: string[]; to: string }[] = [];
    for (const f of files) {
      const was = this.fileTitles.get(f.sha);
      if (was === f.title) continue;
      if (was !== undefined) renamed.push({ sha: f.sha, from: [was, ...addedNames(f)], to: f.title });
      this.fileTitles.set(f.sha, f.title);
    }
    made += this.retitle(renamed, by);
    // written down where it was done for the first time or a file was renamed, so that the same old
    // title is never followed again; a file seen for the first time is written with whatever is
    // written next (one added here, with the note that carries it: fileAdded)
    if (first || renamed.length) this.save();
    return made;
  }

  /** The notes, the project's and the views' own, that carry one of the files `changes` names alone
   *  — one file, whole or a clip of it, as their icons show no count — and whose text is one of the
   *  names it went by (`from`), each given its title now (`to`), as an edit by `by`. How many. */
  private retitle(changes: readonly { sha: string; from: readonly string[]; to: string }[], by: string): number {
    if (!changes.length) return 0;
    const of = new Map(changes.map((c) => [c.sha, c]));
    const follows = (n: { text: string; carries?: NoteCarry[] }): string | null => {
      const c = n.carries?.length === 1 ? of.get(n.carries[0].file) : undefined;
      if (!c) return null;
      const to = noteTitle(c.to);
      return n.text !== to && c.from.some((t) => t === n.text || noteTitle(t) === n.text) ? to : null;
    };
    let made = 0;
    const edits: ProjectNoteOp[] = [];
    for (const n of this.book.notes) {
      const text = follows(n);
      if (text !== null) edits.push({ op: "pnote-edit", id: n.id, text });
    }
    if (edits.length && this.arrangeNotes(edits, null, by) === null) made += edits.length;
    for (const v of this.book.list()) {
      const ops: ViewOp[] = [];
      for (const n of v.notes ?? []) {
        const text = follows(n);
        if (text !== null) ops.push({ op: "note-edit", id: n.id, text });
      }
      if (ops.length && this.arrange(v.id, ops, null, by) === null) made += ops.length;
    }
    return made;
  }

  /** Why operations on notes cannot be taken for what they would make a note carry, or null: each
   *  file or clip a note is to carry and did not carry before (`had`, by the note's id) is checked
   *  against the library — a carry it has already stays, whatever became of its file since. */
  private carriesRefused(ops: readonly (ProjectNoteOp | ViewOp)[], had: (id: string) => NoteCarry[] | undefined): string | null {
    const file = this.carriedFile;
    if (!file) return null;
    for (const o of ops) {
      const fresh = o.op === "pnote" || o.op === "note" ? newCarries(o.note.carries, undefined) : o.op === "pnote-edit" || o.op === "note-edit" ? newCarries(o.carries, had(o.id)) : [];
      for (const c of fresh) {
        const why = carryProblem(c, file(c.file));
        if (why) return why;
      }
    }
    return null;
  }

  /** The past build view `v` shows: the snapshot it is kept at, unless that is the latest build's;
   *  null for the graph on show. Its board is that build's graph (HistorySpec decision 19). */
  pastOf(v: ViewData): number | null {
    return v.version === undefined || v.version === this.latest() ? null : v.version;
  }

  constructor(siteDir: string, layoutVersion: number, send: (event: string, data: unknown) => void, timeline: { add(e: NewEvent): StoredEvent } | null = null) {
    this.file = join(siteDir, "views.json");
    this.memDir = join(siteDir, "view-memory");
    this.layoutVersion = layoutVersion;
    this.send = send;
    this.timeline = timeline;
    let views: ViewData[] = [];
    let authors: Record<string, unknown> = {};
    let notes: ProjectNote[] = [];
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, "utf8")) as Stored;
        // a view that cannot be read is kept aside, not dropped: the next save writes it back
        for (const r of Array.isArray(raw.views) ? raw.views : []) {
          const v = readView(r);
          if (typeof v !== "string") views.push(v);
          else {
            const o = (r && typeof r === "object" ? r : { record: r }) as Record<string, unknown>;
            this.unreadable.push({ id: typeof o.id === "string" ? o.id : null, name: typeof o.name === "string" ? o.name : null, why: v, raw: o });
          }
        }
        // pins dropped under another way of laying out mean nothing in this one (CanvasSpec)
        if (raw.layoutVersion !== layoutVersion) {
          for (const v of views) v.pins = emptyLayouts();
          for (const u of this.unreadable) if (u.raw.pins !== undefined) u.raw.pins = emptyLayouts();
        }
        authors = raw.authors && typeof raw.authors === "object" ? raw.authors : {};
        notes = cleanProjectNotes(raw.notes);
        if (Array.isArray(raw.filesNoted)) for (const sha of raw.filesNoted) if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)) this.filesNoted.add(sha);
        if (raw.fileTitles && typeof raw.fileTitles === "object" && !Array.isArray(raw.fileTitles))
          this.fileTitles = new Map(Object.entries(raw.fileTitles as Record<string, unknown>).filter((e): e is [string, string] => validSha(e[0]) && typeof e[1] === "string"));
      } catch {
        // unreadable: the views start afresh, the file is kept aside to look at
        renameSync(this.file, join(siteDir, `views.broken-${Date.now()}.json`));
      }
    }
    for (const u of this.unreadable) {
      if (u.id && authors[u.id] !== undefined) this.unreadableAuthors[u.id] = authors[u.id];
      console.error(`views: ${u.name ?? u.id ?? "a view"} in ${this.file} cannot be read (${u.why}); it is kept there as it is`);
    }
    this.book = new ViewBook(views, notes);
    for (const v of this.book.kept()) if (authors[v.id]) this.book.authors.set(v.id, cleanAuthors(authors[v.id], v.pins));
    for (const v of this.book.kept()) {
      try {
        this.book.memory.set(v.id, JSON.parse(readFileSync(this.memFile(v.id), "utf8")));
      } catch {
        // no memory yet: the board is laid out afresh the first time it is shown
      }
    }
    setInterval(() => this.sweep(), GRACE_MS / 2).unref();
  }

  /** The views nobody keeps and no page has open go: what is open now, not only what changed last
   *  (a page that sits on a view says nothing new), and what private pages hold. */
  sweep(now = Date.now()): void {
    this.seenPeers(this.peers(), now);
    this.book.seen(this.held(now), now);
    this.changed(this.book.sweep(now, GRACE_MS));
  }

  /** A private page (by its session) has these views open: they live while it does. */
  hold(session: string, ids: Iterable<string>): void {
    const h = this.holds.get(session) ?? { ids: new Set<string>(), at: 0 };
    for (const id of ids) if (h.ids.size < MAX_HOLDS && this.book.get(id)?.kept === false) h.ids.add(id);
    h.at = Date.now();
    this.holds.set(session, h);
    this.book.seen(h.ids);
  }

  /** A page showed itself again: what it has open, its heartbeats say. */
  release(session: string): void {
    this.holds.delete(session);
  }

  /** The views held by private pages that are open, or were a moment ago. */
  private held(now: number): string[] {
    const out: string[] = [];
    for (const [session, h] of this.holds) {
      if (!this.sessionOpen(session) && now - h.at > HOLD_MS) {
        this.holds.delete(session);
        continue;
      }
      out.push(...h.ids);
    }
    return out;
  }

  /** The Project view's pins (ViewPlaces). */
  get places(): ViewPlaces {
    return this.placesOf(PROJECT);
  }

  /** A view's pins (the Project's, by default), read and changed with who dropped each. The
   *  pages are told (`view-ops`). */
  placesOf(id = PROJECT): ViewPlaces {
    const book = this.book;
    const version = this.layoutVersion;
    return {
      get data() {
        return { layoutVersion: version, layouts: book.get(id)?.pins ?? emptyLayouts() };
      },
      apply: (ops, who) => {
        const r = book.arrange(id, ops, who?.by ?? null, who);
        if (r === null || typeof r === "string") return false;
        // an agent's pins keep an open view too
        if (r.length) this.changed(r, !!who?.agent);
        else this.save();
        return true;
      },
      authorOf: (mode, kind, key) => book.authorOf(id, mode, kind, key),
    };
  }

  list(): ViewSummary[] {
    return this.book.list().map(summary);
  }

  /** The kept views that cannot be read now, as the lists say them: which, and why. */
  unreadableList(): { id: string | null; name: string | null; why: string }[] {
    return this.unreadable.filter((u) => !u.id || !this.book.get(u.id)).map(({ id, name, why }) => ({ id, name, why }));
  }

  /** Pages have these views open (presence: each page's view and tabs). */
  seenPeers(peers: Peer[], now = Date.now()): void {
    const ids: string[] = [];
    for (const p of peers) {
      if (!p.view) continue;
      if (p.view.view) ids.push(p.view.view);
      ids.push(...p.view.tabs);
    }
    this.book.seen(ids, now);
  }

  /** The review's targets changed: a view whose target was unmarked stays, unlinked, and one a move
   *  brought from another name (`formerly`) takes that name's view over (ViewSpec decision 29); a
   *  target marked makes no view (the owner's decision of 2026-10-12). The timeline has the targets
   *  already. */
  syncTargets(targets: string[], formerly?: (target: string) => string[] | undefined): void {
    this.changed(this.book.syncTargets(targets, formerly), false, null, false);
  }

  /** The view a click on target `target` opens, by `by` (ViewSpec decision 29, the owner's decision
   *  of 2026-10-11; shared/views.ts, `openTarget`): the one it is linked to, else a view nobody keeps
   *  of its TCB, linked to it while it lasts. The pages are told; the timeline is not, as it is not
   *  of a view opened. Whether `target` is a target is the caller's to say. */
  openTarget(target: string, by: string | null, agent = false, person: string | null = null): ViewData {
    const r = this.book.openTarget(target, by, Date.now(), { agent, person });
    this.changed(r.changes, agent, person);
    return r.view;
  }

  /** Declaration `from` is `to` now (a move, HistorySpec.md): on every view, its pins are moved to
   *  `to` where `to` has none, its full name in backticks in a note's text is written as `to`, a note
   *  attached to it is attached to `to` (the owner's decision of 2026-10-12: the attachment follows
   *  renames, at the same offset), and a scope that names it names `to` — through the views' own
   *  operations, recorded under `by` (VisualProof for a rename it found), as anyone's changes are.
   *  What each view changed: its operations, and its scope before and after (`unmoveDeclaration`
   *  undoes them). */
  moveDeclaration(from: string, to: string, by: string, agent = false): ViewsMoved[] {
    const out: ViewsMoved[] = [];
    for (const v of this.book.list()) {
      const ops: ViewOp[] = [];
      for (const mode of CLUSTER_MODES) {
        const nodes = v.pins[mode].nodes;
        if (!Object.hasOwn(nodes, from) || Object.hasOwn(nodes, to)) continue;
        ops.push({ op: "pin", mode, kind: "node", key: to, at: nodes[from] }, { op: "unpin", mode, kind: "node", key: from });
      }
      for (const n of v.notes ?? []) {
        const text = renameInNote(n.text, from, to);
        if (text !== n.text) ops.push({ op: "note-edit", id: n.id, text });
        if (n.decl?.name === from) ops.push({ op: "note-decl", id: n.id, decl: { name: to, at: n.decl.at } });
      }
      if (ops.length) this.arrange(v.id, ops, null, by, agent);
      // a target's view too: its scope can be changed as any view's (ViewSpec decision 28), and the
      // view goes with its target (ViewBook.retarget)
      let scope: [string, string] | undefined;
      const q = renameInQuery(v.scope, from, to);
      if (q !== v.scope) {
        scope = [printQuery(v.scope), printQuery(q)];
        const c = this.book.setScope(v.id, q, by, false);
        if (c && typeof c !== "string") this.changed(c, agent);
      }
      // a view focused on it is focused on it under its new name
      const focus = v.focus === from;
      if (focus) {
        const c = this.book.setFocus(v.id, to, by, false);
        if (c && typeof c !== "string") this.changed(c, agent);
      }
      if (ops.length || scope || focus) out.push({ view: v.id, ops, ...(scope ? { scope } : {}), ...(focus ? { focus: true } : {}) });
    }
    // the project's notes name it under its new name too, and those attached to it are attached to
    // it under its new name
    const edits: ProjectNoteOp[] = [];
    for (const n of this.book.notes) {
      const text = renameInNote(n.text, from, to);
      if (text !== n.text) edits.push({ op: "pnote-edit", id: n.id, text });
      if (n.decl?.name === from) edits.push({ op: "pnote-decl", id: n.id, decl: { name: to, at: n.decl.at } });
    }
    if (edits.length) {
      this.arrangeNotes(structuredClone(edits), null, by, agent);
      out.push({ view: "", ops: edits });
    }
    return out;
  }

  /** A move of a declaration on the views undone, as a move back, on what it changed alone: on each
   *  view it changed, a pin it moved to `to` goes back to `from` (where `from` has none since), a
   *  note it edited names `from` again where it names `to` — what else was edited since stays —, a
   *  note it attached to `to` is attached to `from` again where it is still attached to `to`, and a
   *  scope it changed names `from` again, and a focus `from` again; the view of a target that went
   *  with it comes back with it (`target`). */
  unmoveDeclaration(from: string, to: string, views: ViewsMoved[], by: string, agent = false, target = false): void {
    if (target) this.changed(this.book.retarget(to, from, by), agent);
    for (const e of views) {
      if (e.view === "") {
        // the project's notes it edited name `from` again, where they name `to`
        const back: ProjectNoteOp[] = [];
        for (const o of e.ops) {
          if (o.op === "pnote-decl") {
            const n = this.book.notes.find((x) => x.id === o.id);
            if (n?.decl?.name === to) back.push({ op: "pnote-decl", id: n.id, decl: { name: from, at: n.decl.at } });
            continue;
          }
          const n = o.op === "pnote-edit" ? this.book.notes.find((x) => x.id === o.id) : undefined;
          const text = n ? renameInNote(n.text, to, from) : null;
          if (n && text !== n.text) back.push({ op: "pnote-edit", id: n.id, text: text! });
        }
        if (back.length) this.arrangeNotes(back, null, by, agent);
        continue;
      }
      const v = this.book.get(e.view);
      if (!v) continue;
      const ops: ViewOp[] = [];
      for (const o of e.ops) {
        if (o.op === "pin" && o.kind === "node") {
          const nodes = v.pins[o.mode].nodes;
          if (Object.hasOwn(nodes, to) && !Object.hasOwn(nodes, from)) ops.push({ op: "pin", mode: o.mode, kind: "node", key: from, at: nodes[to] }, { op: "unpin", mode: o.mode, kind: "node", key: to });
        } else if (o.op === "note-edit") {
          const n = v.notes?.find((x) => x.id === o.id);
          const text = n ? renameInNote(n.text, to, from) : null;
          if (n && text !== n.text) ops.push({ op: "note-edit", id: n.id, text: text! });
        } else if (o.op === "note-decl") {
          const n = v.notes?.find((x) => x.id === o.id);
          if (n?.decl?.name === to) ops.push({ op: "note-decl", id: n.id, decl: { name: from, at: n.decl.at } });
        }
      }
      if (ops.length) this.arrange(v.id, ops, null, by, agent);
      if (e.scope) {
        const q = renameInQuery(v.scope, to, from);
        if (q !== v.scope) {
          const c = this.book.setScope(v.id, q, by, false);
          if (c && typeof c !== "string") this.changed(c, agent);
        }
      }
      if (e.focus && v.focus === to) {
        const c = this.book.setFocus(v.id, from, by, false);
        if (c && typeof c !== "string") this.changed(c, agent);
      }
    }
  }

  /** Pins, folds and notes of view `id`, from page `from` (a session) or an agent, under `by` (and
   *  `person`, the personal link of whoever it is, CollabSpec decision 9). A note written, edited or
   *  deleted is an event of the timeline, under the name its note records. */
  arrange(id: string, ops: ViewOp[], from: string | null, by: string | null, agent = false, person: string | null = null): string | null {
    const unknown = this.unknownVersion(ops.map((o) => (o.op === "version" ? o.snapshot : null)));
    if (unknown) return unknown;
    const before = new Map((this.book.get(id)?.notes ?? []).map((n): [string, StickyNote] => [n.id, { ...n }]));
    const carries = this.carriesRefused(ops, (n) => before.get(n)?.carries);
    if (carries) return carries;
    // which list held each note an item operation names, for the timeline
    const listed = structuredClone(this.book.get(id)?.items);
    const who = { by, agent, person: by ? person : null };
    const r = this.book.arrange(id, ops, by, who);
    if (typeof r === "string") return r;
    if (r === null) return null;
    this.send("view-ops", { id, ops, from, by });
    this.changed(r, agent, who.person);
    if (!r.length) this.save();
    this.noted(id, ops, before, who);
    this.itemsNoted(id, ops, listed, who);
    return null;
  }

  /** The timeline's events of the notes of the project item operations `ops` added to view `id` or
   *  took out of it (`listed`: its lists as they were), as a scope changed is: under who did it, with
   *  the note's text then and whether the view shows it by it. */
  private itemsNoted(id: string, ops: ViewOp[], listed: ViewData["items"], who: { by: string | null; agent: boolean; person: string | null }): void {
    const v = this.book.get(id);
    if (!v || !this.timeline) return;
    let was = listed;
    for (const o of ops) {
      if (o.op !== "item") continue;
      const from = itemIn(was, o.note);
      if (from === o.in) continue;
      // each operation read against the lists as the ones before it left them
      was = structuredClone(was) ?? { add: [], remove: [] };
      if (from) was[from] = was[from].filter((x) => x !== o.note);
      if (o.in) was[o.in].push(o.note);
      const n = this.book.notes.find((x) => x.id === o.note);
      this.timeline.add({ kind: "view", by: who.by, ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}), what: "items", view: id, name: v.name, scope: printQuery(v.scope), note: o.note, text: n?.text ?? "", shown: itemShown(from, o) });
    }
  }

  /** Taken off every view's lists, for the pages: what `drops` did (a note no longer the project's,
   *  shared/views.ts dropItems). Nobody's change of the view — no event of the timeline, no view kept
   *  by it, no word on the board: the note's own event says what happened. */
  private dropped(drops: { view: string; op: ItemOp }[]): void {
    for (const d of drops) this.send("view-ops", { id: d.view, ops: [d.op], from: null, by: null });
  }

  /** The project's notes changed by `ops` (shared/projectnotes.ts), from page `from` or an agent,
   *  under `by` (and `person`): every page is told (`note-ops`), and a note written, edited or
   *  deleted is an event of the timeline under the name its note records, as a view's is. A note
   *  written in view `written` (the board on show where it was written, or the view an agent names)
   *  is added to it (the owner's decision of 2026-10-11); a note deleted leaves every view's lists.
   *  Why the operations were refused, or null (taken, whether or not they changed anything). */
  arrangeNotes(ops: ProjectNoteOp[], from: string | null, by: string | null, agent = false, person: string | null = null, written: string | null = null): string | null {
    // held to what a page's request is held to, whichever path it came by: a place a file could
    // not read back would lose the note at the next start
    const why = invalidProjectNoteOps(ops);
    if (why) return why;
    const before = new Map(this.book.notes.map((n): [string, ProjectNote] => [n.id, { ...n }]));
    const carries = this.carriesRefused(ops, (n) => before.get(n)?.carries);
    if (carries) return carries;
    const who = { by, agent, person: by ? person : null };
    if (!this.book.noteOps(ops, who)) return null;
    this.send("note-ops", { ops, from, by });
    const now = new Set(this.book.notes.map((n) => n.id));
    // a note deleted is in no view's lists any more
    for (const o of ops) if (o.op === "pnote-delete" && before.has(o.id) && !now.has(o.id)) this.dropped(this.book.dropItems(o.id));
    // what was written in a view is that view's, wherever it is put: added to it, as the page that
    // wrote it has done already (`from`)
    const fresh = ops.flatMap((o) => (o.op === "pnote" && now.has(o.note.id) && !before.has(o.note.id) ? [o.note.id] : []));
    const w = written && fresh.length ? this.book.written(written, fresh, by, who) : null;
    if (w) {
      this.send("view-ops", { id: written, ops: w.ops, from, by });
      this.changed(w.changes, agent, who.person);
    }
    this.save();
    if (!this.timeline) return null;
    for (const o of ops) {
      const e =
        o.op === "pnote" && now.has(o.note.id) && !before.has(o.note.id)
          ? { what: "created" as const, note: o.note.id, text: o.note.text }
          : o.op === "pnote-edit" && now.has(o.id) && edited(before.get(o.id), o)
            ? { what: "edited" as const, note: o.id, text: o.text }
            : o.op === "pnote-delete" && before.has(o.id) && !now.has(o.id)
              ? { what: "deleted" as const, note: o.id, text: before.get(o.id)!.text }
              : null;
      if (e) this.timeline.add({ kind: "note", ...e, by: who.by, ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}), view: "", title: "" });
    }
    return null;
  }

  /** A note of the project made view `view`'s own, or view `view`'s made the project's (`to`), at
   *  `place` where it is on that view's board clustered by `mode` (shared/views.ts, switchNote):
   *  every page is told on both sides, and nobody becomes its author by it. Why not, or null. */
  switchNote(id: string, view: string, to: "view" | "project", place: NotePlace | ClusterPlace, mode: ClusterMode, from: string | null, by: string | null, agent = false, person: string | null = null): string | null {
    const r = this.book.switchNote(id, view, to, place, mode, by);
    if (typeof r === "string") return r;
    this.send("note-ops", { ops: r.notes, from, by });
    this.send("view-ops", { id: view, ops: r.view, from, by });
    this.dropped(r.drops);
    this.changed(r.changes, agent, person);
    if (!r.changes.length) this.save();
    return null;
  }

  /** A new build moved whole clusters (AttachmentSpec decision 18; shared/noteplace.ts,
   *  carriedNotes): each project note in a cluster that went, all of it, to another — a folder or a
   *  namespace renamed — goes with it, as an edit by `by` (VisualProof) that the timeline records
   *  with where it was carried from and to. `before` and `after` are the two builds' declarations,
   *  `renamed` the renames of high confidence found between them. How many notes were carried. */
  carryNotes(before: readonly { name: string; module: string; ext?: true }[], after: readonly { name: string; module: string; ext?: true }[], renamed: ReadonlyMap<string, string>, by: string): number {
    const moves = carriedNotes(this.book.notes, before, after, renamed);
    if (!moves.length) return 0;
    const at = new Date().toISOString();
    const ops: ProjectNoteOp[] = moves.map((m) => ({ op: "pnote-move", id: m.id, mode: m.mode, place: m.place, by, at }));
    // applied as they are: a carry is the server's own edit, stamped here, not taken from whoever asks
    let changed = false;
    for (const o of ops) if (applyProjectNoteOp(this.book.notes, o)) changed = true;
    if (!changed) return 0;
    this.send("note-ops", { ops, from: null, by });
    this.save();
    for (const m of moves) {
      const n = this.book.notes.find((x) => x.id === m.id);
      if (n) this.timeline?.add({ kind: "note", what: "edited", note: n.id, text: n.text, by, view: "", title: "", carried: { mode: m.mode, from: m.from, to: m.to } });
    }
    return moves.length;
  }

  /** Why a version cannot be kept, of those asked for (null: the latest), or null. */
  private unknownVersion(snaps: (number | null | undefined)[]): string | null {
    for (const s of snaps) if (typeof s === "number" && this.snapshotAt(s) === null) return `There is no snapshot ${s}: GET /api/history lists them.`;
    return null;
  }

  /** The timeline's events of the notes `ops` wrote, edited or deleted on view `id` (`before`: its
   *  notes as they were), under who did it as the notes record it; opening, collapsing and moving a
   *  note are not events, as a drag is not. */
  private noted(id: string, ops: ViewOp[], before: Map<string, StickyNote>, who: { by: string | null; agent: boolean; person: string | null }): void {
    const v = this.book.get(id);
    if (!v || !this.timeline) return;
    const now = new Set((v.notes ?? []).map((n) => n.id));
    const title = viewTitle(v, this.titles());
    for (const o of ops) {
      const e =
        o.op === "note" && now.has(o.note.id) && !before.has(o.note.id)
          ? { what: "created" as const, note: o.note.id, text: o.note.text }
          : o.op === "note-edit" && now.has(o.id) && edited(before.get(o.id), o)
            ? { what: "edited" as const, note: o.id, text: o.text }
            : o.op === "note-delete" && before.has(o.id) && !now.has(o.id)
              ? { what: "deleted" as const, note: o.id, text: before.get(o.id)!.text }
              : null;
      if (e) this.timeline.add({ kind: "note", ...e, by: who.by, ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}), view: id, title });
    }
  }

  /** Tell the pages, write down what is kept, record what the timeline keeps (`person`: the
   *  personal link of whoever made the changes; `record` false for what the server does by itself
   *  with the targets, which the timeline has already). */
  changed(changes: Change[], agent = false, person: string | null = null, record = true): void {
    if (!changes.length) return;
    for (const c of changes) {
      const v = this.book.get(c.id);
      if (c.what === "kept" && v) this.saveMemory(v.id);
      if (c.what === "deleted" || c.what === "gone") rmSync(this.memFile(c.id), { force: true });
      // what the timeline keeps: views saved for everyone, renamed, rescoped, deleted, laid out
      // afresh, under a name or by someone without one (a private reader, CollabSpec decision 8); a
      // target's view's scope changed is said as any view's (ViewSpec decision 28)
      const what = c.what === "kept" ? "created" : c.what;
      const rescoped = what === "scope" && !!v;
      // kept at a past build: which one, and when it was built, so that the timeline says it alone
      const version = what === "version" ? { snapshot: c.snapshot ?? null, ...(typeof c.snapshot === "number" && this.snapshotAt(c.snapshot) ? { built: this.snapshotAt(c.snapshot)! } : {}) } : {};
      // a target linked to a view (ViewSpec decision 29), by someone: said once, of the view it is
      // linked to now; the view it left only stops being the target's. A click on a target with no
      // view links it to a view nobody keeps, which is no more an event than opening one is. A view
      // deleted that targets were linked to says those targets, which have no view now, in the same
      // event (the owner's decisions of 2026-10-11)
      const linked = what === "linked" && typeof c.target === "string" && !c.temporary && record;
      const unlinked = what === "deleted" && !!c.targets?.length;
      if (what === "created" || what === "renamed" || rescoped || what === "deleted" || what === "relayout" || what === "version" || linked)
        this.timeline?.add({ kind: "view", by: c.by, ...(agent ? { agent: true as const } : {}), ...(person && c.by ? { person } : {}), what: what as Exclude<typeof what, "opened" | "kept" | "clustering" | "gone" | "focus" | "unlinked">, view: c.id, name: v?.name ?? null, ...(c.was !== undefined ? { was: c.was } : {}), ...(linked ? { target: c.target! } : {}), ...(unlinked ? { targets: c.targets! } : {}), scope: v ? printQuery(v.scope) : c.scope ?? "", ...version });
    }
    this.save();
    this.send("views", { views: this.list(), changes });
  }

  private save(): void {
    const kept = this.book.kept();
    const authors: Record<string, unknown> = Object.fromEntries(kept.flatMap((v) => (this.book.authors.has(v.id) ? [[v.id, this.book.authors.get(v.id)!]] : [])));
    // the views that could not be read go back as they came, unless one of the same id took their
    // place since
    const aside = this.unreadable.filter((u) => !u.id || !this.book.get(u.id));
    for (const u of aside) if (u.id && this.unreadableAuthors[u.id] !== undefined) authors[u.id] = this.unreadableAuthors[u.id];
    const data: Stored = {
      layoutVersion: this.layoutVersion,
      views: [...kept, ...aside.map((u) => ({ ...u.raw, unreadable: u.why }))],
      authors,
      ...(this.book.notes.length ? { notes: this.book.notes } : {}),
      ...(this.filesNoted.size ? { filesNoted: [...this.filesNoted] } : {}),
      ...(this.fileTitles ? { fileTitles: Object.fromEntries(this.fileTitles) } : {}),
    };
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data) + "\n");
    renameSync(tmp, this.file);
  }

  private memFile(id: string): string {
    return join(this.memDir, createHash("sha1").update(id).digest("hex").slice(0, 20) + ".json");
  }

  private saveMemory(id: string): void {
    const m = this.book.memory.get(id);
    if (!m || !this.book.get(id)?.kept) return;
    mkdirSync(this.memDir, { recursive: true });
    const tmp = `${this.memFile(id)}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, this.memFile(id));
  }

  /** A board's layout memory, handed over by a page or the agents' API (compare and set). */
  setMemory(id: string, mode: ClusterMode, base: string | null, next: BoardMemory): { accepted: boolean; current: BoardMemory | null } | string {
    const r = this.book.setMemory(id, mode, base, next);
    if (typeof r === "string" || !r.accepted) return r;
    this.saveMemory(id);
    this.send("view-memory", { id, mode, base, set: next.set });
    return r;
  }

  /** Lay a view out afresh: its pins and its layout's memory go; the Project's graph is laid out
   *  anew by the server too. The timeline says who did it, and whether an agent did. */
  relayout(id: string, by: string | null, agent = false, person: string | null = null): string | null {
    const c = this.book.relayout(id, by);
    if (typeof c === "string") return c;
    rmSync(this.memFile(id), { force: true });
    this.send("view-ops", { id, ops: [{ op: "clear" }], from: null, by });
    for (const mode of CLUSTER_MODES) this.send("view-memory", { id, mode, base: null, set: null });
    this.changed([c], agent, person);
    if (id === PROJECT) this.onProjectRelayout();
    return null;
  }

  // ---------------------------------------------------------------- the page's endpoints

  /** A request under /api/views, read by main.ts: what the page asks, under the name it gives. An
   *  agent may use them too, within what `--agents` allows (AgentSpec decision 9): opening a view
   *  is reading; everything else, deleting a view and laying one out afresh included, is level
   *  full, recorded as the agent's. A private reader's changes are recorded without a name, and
   *  need none (CollabSpec decision 8). */
  handle(a: Ask, level: AgentLevel): Answer {
    // who what is done here is recorded under: the caller's name, or none for a private reader
    // (identity.ts, layoutAuthor); what needs a name is what records one
    const me = layoutAuthor(a.caller);
    const nameless = !me && !a.caller.private;
    // the personal link of whoever it is (CollabSpec decision 9), with their name only: never with
    // what a private reader arranges
    const person = me ? a.caller.person ?? null : null;
    // a private page holds the views it reads or opens: it says nothing else of what it has open
    const session = a.caller.private?.session ?? null;
    const holds = (id: string): void => {
      if (session) this.hold(session, [id]);
    };
    const agent = a.caller.kind === "agent";
    const b = (a.body && typeof a.body === "object" ? a.body : {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : a.query.get("id") ?? "";
    const mode = (typeof b.mode === "string" ? b.mode : a.query.get("mode") ?? "namespace") as ClusterMode;
    const arranging = () => (agent ? (me ? refusal(level, "full") : NEED_NAME) : null);
    const result = (r: Change | Change[] | string | null, body: () => unknown = () => ({ ok: true })): Answer => {
      if (typeof r === "string") return no(r.startsWith("There is no view") ? 404 : 400, r);
      this.changed(r === null ? [] : Array.isArray(r) ? r : [r], agent, person);
      return ok(body());
    };
    const path = a.path.replace(/\/+$/, "");
    if (a.method === "GET") {
      if (path === "/api/views") return ok({ views: this.list(), ...(this.unreadable.length ? { unreadable: this.unreadableList() } : {}) });
      if (path === "/api/views/view") {
        const v = this.book.get(id);
        if (!v) return no(404, `There is no view ${id}.`);
        holds(v.id);
        const memory: Partial<Record<ClusterMode, string>> = {};
        for (const m of CLUSTER_MODES) {
          const s = this.book.memoryOf(id, m)?.set;
          if (s) memory[m] = s;
        }
        return ok({ view: v, memory });
      }
      // the project's notes, every one (AttachmentSpec decision 13): each page decides which its
      // board shows
      if (path === "/api/views/notes") return ok({ notes: this.book.notes });
      if (path === "/api/views/memory") {
        if (!this.book.get(id)) return no(404, `There is no view ${id}.`);
        if (!CLUSTER_MODES.includes(mode)) return no(400, "mode is namespace or module.");
        return ok({ memory: this.book.memoryOf(id, mode) });
      }
      return no(404, "not found");
    }
    if (a.method !== "POST") return no(405, `${a.path} answers GET and POST.`);
    switch (path) {
      case "/api/views/open": {
        const q = readQuery(b.scope);
        if (typeof q === "string") return no(400, q);
        // a view made from a board of a past build shows that build (the owner's decision of
        // 2026-10-09): found or made by its query and the build together
        if (b.version !== undefined && b.version !== null && !validVersion(b.version)) return no(400, "version is a snapshot's id (GET /api/history lists them), or null for the latest build.");
        const unknown = this.unknownVersion([b.version as number | null | undefined]);
        if (unknown) return no(404, unknown);
        if (b.clustering !== undefined && !CLUSTER_MODES.includes(b.clustering as ClusterMode)) return no(400, "The clustering is namespace or module.");
        // a new view's focus (ViewSpec decision 28): the target it is made from, or the focus of the
        // view a Zoom in came from
        if (b.focus !== undefined && b.focus !== null && (typeof b.focus !== "string" || !this.isTarget(b.focus))) return no(400, "focus is a target's full name.");
        const { view, change } = this.book.open(q, me, Date.now(), { agent, person, ...(typeof b.version === "number" ? { version: b.version } : {}), ...(b.clustering ? { clustering: b.clustering as ClusterMode } : {}), ...(typeof b.focus === "string" ? { focus: b.focus } : {}) });
        holds(view.id);
        return result(change, () => ({ view }));
      }
      case "/api/views/create": {
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        const q = b.scope === undefined ? undefined : readQuery(b.scope);
        if (typeof q === "string") return no(400, q);
        if (b.clustering !== undefined && !CLUSTER_MODES.includes(b.clustering as ClusterMode)) return no(400, "The clustering is namespace or module.");
        // Save as new view (HistorySpec decision 19): the build it shows, a snapshot the history has
        if (b.version !== undefined && b.version !== null && !validVersion(b.version)) return no(400, "version is a snapshot's id (GET /api/history lists them), or null for the latest build.");
        const unknown = this.unknownVersion([b.version as number | null | undefined]);
        if (unknown) return no(404, unknown);
        const v = this.book.create(typeof b.name === "string" ? b.name.trim() : "", me, { scope: q, clustering: b.clustering as ClusterMode | undefined, from: typeof b.from === "string" ? b.from : undefined, version: b.version as number | null | undefined, agent, person });
        if (typeof v === "string") return no(400, v);
        return result({ id: v.id, what: "kept", by: me }, () => ({ view: v }));
      }
      case "/api/views/rename": {
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        const name = b.name === null ? null : typeof b.name === "string" ? b.name.trim() : "";
        return result(this.book.rename(id, name === "" ? null : name, me));
      }
      case "/api/views/delete": {
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        return result(this.book.remove(id, me));
      }
      case "/api/views/scope": {
        const refused = arranging();
        if (refused) return refused;
        const q = readQuery(b.scope);
        if (typeof q === "string") return no(400, q);
        return result(this.book.setScope(id, q, me), () => ({ ok: true, scope: printQuery(q) }));
      }
      case "/api/views/focus": {
        // the view's own focus, for everyone on it (ViewSpec decision 28): a target, or null for none
        const refused = arranging();
        if (refused) return refused;
        if (b.focus !== null && (typeof b.focus !== "string" || !this.isTarget(b.focus))) return no(400, "focus is a target's full name, or null for none.");
        return result(this.book.setFocus(id, b.focus as string | null, me));
      }
      case "/api/views/link": {
        // a target linked to this view, for everyone (ViewSpec decision 29): its clicks open it; a
        // view linked to other targets takes it too (the owner's decision of 2026-10-11)
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        if (typeof b.target !== "string" || !this.isTarget(b.target)) return no(400, "target is a target's full name.");
        return result(this.book.link(id, b.target, me));
      }
      case "/api/views/target": {
        // the view a click on a target opens (ViewSpec decision 29, the owner's decision of
        // 2026-10-11): the one it is linked to, else a view nobody keeps of its TCB, linked to it
        // for as long as that view lasts. Opening a view is reading, as `open` is
        if (typeof b.target !== "string" || !this.isTarget(b.target)) return no(400, "target is a target's full name.");
        const r = this.openTarget(b.target, me, agent, person);
        holds(r.id);
        return ok({ view: r });
      }
      case "/api/views/clustering": {
        const refused = arranging();
        if (refused) return refused;
        return result(this.book.setClustering(id, b.clustering as ClusterMode, me));
      }
      case "/api/views/arrange": {
        const refused = arranging();
        if (refused) return refused;
        const why = invalidViewOps(b.ops);
        if (why) return no(400, why);
        // a clear is a re-layout's, which says so on the timeline
        const ops = (b.ops as ViewOp[]).filter((o) => o.op !== "clear");
        // a note written, edited or deleted records who did it, as a view made does; so does a view
        // kept at a build, for everyone on it, as a re-layout does
        if (nameless && ops.some((o) => o.op === "note" || o.op === "note-edit" || o.op === "note-delete" || o.op === "version")) return NEED_NAME;
        // the page says which it is by its stream's secret: the others are told its public id
        const err = this.arrange(id, ops, this.pageOf(b.token), me, agent, person);
        return err ? no(this.book.get(id) ? 400 : 404, err) : ok({ ok: true });
      }
      case "/api/views/notes": {
        // the project's notes, as a view's are arranged: writing, editing and deleting one is
        // recorded under a name; opening, collapsing and moving one need none
        const refused = arranging();
        if (refused) return refused;
        const why = invalidProjectNoteOps(b.ops);
        if (why) return no(400, why);
        const ops = b.ops as ProjectNoteOp[];
        if (nameless && ops.some((o) => o.op === "pnote" || o.op === "pnote-edit" || o.op === "pnote-delete")) return NEED_NAME;
        // the view they were written in, which they are added to (the owner's decision of 2026-10-11)
        if (b.in !== undefined && b.in !== null && (typeof b.in !== "string" || !this.book.get(b.in))) return no(404, `There is no view ${String(b.in).slice(0, 80)} to write in.`);
        // what a note is to carry is checked against the library there
        const err = this.arrangeNotes(ops, this.pageOf(b.token), me, agent, person, typeof b.in === "string" ? b.in : null);
        return err ? no(400, err) : ok({ ok: true });
      }
      case "/api/views/note-kind": {
        // a note made a view's own, or the project's again (AttachmentSpec decision 14), keeping
        // where it is on the board it was switched on
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        if (typeof b.note !== "string" || (b.to !== "view" && b.to !== "project")) return no(400, "Send {id, note, to: view | project, place, mode}: the view, the note, and where it is on that view's board.");
        if (!CLUSTER_MODES.includes(mode)) return no(400, "mode is namespace or module.");
        if (b.to === "view" ? invalidPlace(b.place) : invalidClusterPlace(b.place)) return no(400, "place is where the note is on the board: a view note's {mode, in, world}, or a project note's {in} or {ring}.");
        const err = this.switchNote(b.note, id, b.to, b.place as NotePlace | ClusterPlace, mode, this.pageOf(b.token), me, agent, person);
        return err ? no(this.book.get(id) ? 400 : 404, err) : ok({ ok: true });
      }
      case "/api/views/relayout": {
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        const err = this.relayout(id, me, agent, person);
        return err ? no(404, err) : ok({ ok: true });
      }
      case "/api/views/memory": {
        // the memory decides where everything on the board is for everyone on it: handing it over
        // is laying the board out, under a name and within what agents may do, as arranging is
        const refused = arranging();
        if (refused) return refused;
        if (nameless) return NEED_NAME;
        if (!CLUSTER_MODES.includes(mode)) return no(400, "mode is namespace or module.");
        const v = this.book.get(id);
        if (!v) return no(404, `There is no view ${id}.`);
        const next = cleanMemory(b.memory);
        if (!next) return no(400, "memory is {set, mem: {nodes, clusters}} as shared/layout.ts memoryOf makes it.");
        // for the set the board holds now, of what is on it: a page that read another graph or
        // review lays the board out for itself, and nothing else gets in
        const unfit = this.checkMemory(v, mode, next);
        if (unfit) return no(unfit.status, unfit.error);
        const r = this.setMemory(id, mode, typeof b.base === "string" ? b.base : null, next);
        if (typeof r === "string") return no(404, r);
        // the memory that won, unless it is the one sent: the page lays the board out from it
        return ok({ accepted: r.accepted, current: r.accepted ? { set: next.set } : r.current });
      }
    }
    return no(404, "not found");
  }
}

/** A file's title as a note's text: a note needs some, within its limit and without control
 *  characters (a title read from a PDF may carry any). */
function noteTitle(title: string): string {
  const t = title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || "A file of the library";
  return t.length > MAX_NOTE_TEXT ? t.slice(0, MAX_NOTE_TEXT - 1) + "…" : t;
}
