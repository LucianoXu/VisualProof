// The review (ReviewSpec.md): reviewers' opinions on declarations, each bound to one version of
// the declaration by its content hash, and the targets whose TCBs are being reviewed. What is
// stored, how the review is read back from it, and what the page reads off it. No consensus is
// decided here: a status is a summary of what reviewers said.
//
// What is stored (decided 2026-10-08): one append-only log per writer, each line one event — an
// opinion, a target marked or taken off, a prefix trusted or no longer trusted, a key declaration
// of a target marked or unmarked (ExportSpec decision 1) — carrying who wrote it and when. The
// review is what replaying every log gives (`replay`): one writer's events in the order of their
// file, different writers' by time. Each writer appends to a file of their own, so two never write
// the same one. `ReviewData` is that replay, the state the server, the page and the agents' API
// read; server/review.ts keeps the files.
//
// An agent's opinion is advice (AgentSpec decision 2): it is kept in the same list, marked
// `agent`, and nothing that summarises the review reads it — `current`, and so every status, mark
// and progress, is people's opinions only; `advice` is the agents'. Whatever else an agent does at
// level full (AgentSpec decision 9) — a target, a prefix trusted, a key declaration — counts as a
// person's would, and is marked `agent` too, so that the page always says it was an agent's. Every
// line of an agent's log is marked, and no line of a person's.
//
// Someone invited by a personal link (CollabSpec decision 9, 2026-10-09) is the link, not a name:
// their events go to one log named by the link's id, every line of it carrying the id (`person`)
// beside the name it was written under, and a rename appends a `name` line. The replay keeps, per
// id, the name its latest line gives (`people`), and shows everything that id wrote under it, so a
// rename never makes a new writer, and the log needs nothing but itself to say who is who.
//
// An explanation of a declaration was an event too, until the owner removed explanations on
// 2026-10-08 (ExportSpec decision 2): what a declaration is belongs in its docstring, and why a
// reviewer thinks it right in their opinion's comment. So was a checkpoint of a target's review,
// until the owner removed checkpoints on 2026-10-09 (ReviewSpec decision 4): an opinion goes stale
// by itself when what it judged changes, what newly enters a TCB shows as not yet reviewed, the
// timeline records each target's TCB changes, and the exported document records a target as it
// stands at a build. A log may still hold such a line: the replay skips it (`readEvent`) without
// calling it a problem, so that its writer writes on.
//
// Since 2026-10-09 a move (HistorySpec.md) carries what was said of one declaration to another, and
// says where one is another renamed: shared/moves.ts replays it. Since 2026-10-11 the library's
// files and the links into them are events too (AttachmentSpec.md): shared/library.ts replays them.
//
// Declarations are keyed by name, and a name can be anything Lean allows: `toString`,
// `constructor`, even `__proto__`. Every object keyed by names here has no prototype (`byName`),
// is read with Object.hasOwn, and is never spread or assigned into a plain object.

import { validName } from "./collab.ts";
import { applyLibrary, invalidLibrary, isLibraryOp, libraryEventOf, libraryFromJson, libraryNoChange, readLibraryEvent, renamePerson } from "./library.ts";
import type { FileRecord, LibraryEvent, LibraryOp, LibraryStep, Link } from "./library.ts";
import { applyMove, moveIsIdle, readMove } from "./moves.ts";
import type { MoveEvent } from "./moves.ts";

/** A reviewer's word on a declaration: they approve it, or they comment on it, which needs text
 *  (ReviewSpec decision 1, 2026-10-09). */
export type Verdict = "approve" | "comment";

export interface Opinion {
  by: string;
  verdict: Verdict;
  /** what the reviewer says: the text of a comment (and optional with an approval) */
  comment?: string;
  /** the declaration's content hash when the opinion was given (absent for declarations the
   *  extractor gives no hash, such as externals and axioms outside the project) */
  hash?: string;
  toolchain?: string;
  /** ISO time */
  at: string;
  /** the declaration's source as the reviewer read it (the compiled excerpt the source window
   *  shows), so that once it changes the page can show what changed since; absent from those
   *  without a hash (they never go stale), and from one that replaced the same reviewer's opinion
   *  on the same version and the same text (judgedOn) */
  text?: string;
  /** in place of `text` where there was no source: the statement the graph held */
  statement?: string;
  /** given by an agent (AgentSpec decision 2): advice, never counted; absent from people's */
  agent?: true;
  /** given by someone invited by a personal link: the link's id, who they are (`by` is the name
   *  they go by now); absent from a guest's and an agent's */
  person?: string;
  /** the names it was given on before moves brought it here, oldest first (shared/moves.ts) */
  was?: string[];
  /** recorded for them by someone else at the same screen (ReviewSpec decision 8): who typed it,
   *  and the link they came by where invited; `by` and `person` are theirs it was recorded for */
  recordedBy?: { by: string; person?: string };
}

export interface Target {
  by: string;
  at: string;
  /** marked by an agent (AgentSpec decision 9); absent from people's */
  agent?: true;
  /** marked by someone invited by a personal link: the link's id */
  person?: string;
  /** the names it was marked on before moves brought it here (shared/moves.ts) */
  was?: string[];
}

/** A key declaration of a target, as marked (ExportSpec decision 1): who marked it, and when. */
export interface KeyMark {
  by: string;
  at: string;
  /** marked by an agent (AgentSpec decision 9); absent from people's */
  agent?: true;
  /** marked by someone invited by a personal link: the link's id */
  person?: string;
  /** the names the declaration, and the target, had before moves (shared/moves.ts) */
  was?: string[];
  wasOf?: string[];
}

/** Someone invited by a personal link, as the review knows them from their log: the name they go
 *  by now, and the ones they went by before, the latest last. */
export interface PersonName {
  name: string;
  was: string[];
}

export interface ReviewData {
  version: 1;
  /** prefixes trusted without review, sorted: an external declaration is trusted by its module, one
   *  of the project's own by its module or its name (ReviewSpec decision 3) */
  trusted: string[];
  /** by target name; no prototype */
  targets: Record<string, Target>;
  /** per declaration, every opinion in the order replayed; no prototype */
  opinions: Record<string, Opinion[]>;
  /** per target, its key declarations as marked (ExportSpec decision 1; by people, or agents at
   *  level full): name → who marked it and when. No prototype at either level. The target itself is
   *  always key, implicitly, and never listed. */
  keys: Record<string, Record<string, KeyMark>>;
  /** the people invited by a personal link who wrote in the review, by the link's id: the name each
   *  goes by (CollabSpec decision 9). No prototype. */
  people: Record<string, PersonName>;
  /** the renames in force (HistorySpec.md): a declaration's name → the name it had before; where
   *  versions take their identities from (shared/moves.ts). No prototype; absent where none is */
  renamed?: Record<string, string>;
  /** the library's files by hash, and the links into them in the order they were made
   *  (AttachmentSpec decisions 1–6, shared/library.ts); absent where none was recorded */
  files?: Record<string, FileRecord>;
  links?: Link[];
  /** the library's events that changed something, in the order replayed, as the timeline tells
   *  them (CollabSpec decision 5, shared/library.ts); absent where none did */
  libraryHistory?: LibraryStep[];
}

export const DEFAULT_TRUSTED = ["Batteries", "Init", "Lean", "Mathlib", "Std"];
/** The trusted entry that stands for everything outside the project, whatever its module (no Lean
 *  name starts with "@", so it is no prefix of one). */
export const OUTSIDE = "@external";

/** A trusted entry as the page and the timeline show it. */
export function prefixLabel(p: string): string {
  return p === OUTSIDE ? "the outside world" : p;
}
/** the longest text an opinion records, in UTF-16 units: far beyond any declaration a reviewer
 *  reads, and small enough that a log stays a file people read */
export const MAX_TEXT = 65536;
export const STANDARD_AXIOMS = ["Classical.choice", "Quot.sound", "propext"];

/** An object keyed by names: without a prototype, so that no name means something already. */
export function byName<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function emptyReview(): ReviewData {
  return { version: 1, trusted: [...DEFAULT_TRUSTED], targets: byName(), opinions: byName(), keys: byName(), people: byName() };
}

/** A personal link's id (server/invites.ts): who someone invited by one is, in the review's logs. */
export function validPersonId(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{10}$/.test(s);
}

/** What a page asks the server to record (POST /api/review). Only what the reader decides: who
 *  says it comes from the request's headers, and what an opinion is about (the declaration's hash,
 *  the text judged) is the server's to work out from the graph. */
export type ReviewRequest =
  /** `for`: recorded as another person's, named as the page gives them (ReviewSpec decision 8) */
  | { op: "opinion"; name: string; verdict: Verdict; comment?: string; for?: string }
  | { op: "target"; name: string; on: boolean }
  | { op: "trust"; prefix: string; on: boolean }
  /** `name` marked as a key declaration of `target`, or no longer (ExportSpec decision 1) */
  | { op: "key"; target: string; name: string; on: boolean }
  /** what was said of `from` carried to `to`, or taken back (`on` false); `rename`: `to` is `from`
   *  renamed (HistorySpec.md, shared/moves.ts) */
  | { op: "move"; from: string; to: string; on: boolean; rename?: boolean };

/** What the server records, bound: the author — whether an agent, and the personal link they came
 *  by, which the server says from who asks, never from the request's body — and what the graph
 *  says the opinion is about. */
export type ReviewOp = (
  /** `for`, `forPerson`: recorded as another person's, by name and, where they are invited, by
   *  their link's id, which the server finds (ReviewSpec decision 8) */
  | { op: "opinion"; name: string; verdict: Verdict; comment?: string; hash?: string; text?: string; statement?: string; for?: string; forPerson?: string }
  | { op: "target"; name: string; on: boolean }
  | { op: "trust"; prefix: string; on: boolean }
  | { op: "key"; target: string; name: string; on: boolean }
  /** `auto` and `snap` are the server's own, for a rename it found (server/renames.ts) */
  | { op: "move"; from: string; to: string; on: boolean; rename?: boolean; auto?: string; snap?: number }
  /** the library's files and links (AttachmentSpec.md, shared/library.ts) */
  | LibraryOp
) & { by: string; agent?: boolean; person?: string };

/** One line of a writer's log: what was recorded, by whom (their exact name: the file's name is
 *  only a container), when; `agent` on every line of an agent's log, `person` (the link's id) on
 *  every line of the log of someone invited by a personal link — whose `name` line says only that
 *  they go by `by` from then on. */
export type ReviewEvent =
  /** `for`, `forPerson`: written by `by` as another person's (ReviewSpec decision 8) */
  | ({ op: "opinion"; name: string; for?: string; forPerson?: string } & Opinion)
  | { op: "target"; at: string; by: string; name: string; on: boolean; agent?: true; person?: string }
  | { op: "trust"; at: string; by: string; prefix: string; on: boolean; agent?: true; person?: string }
  | { op: "key"; at: string; by: string; target: string; name: string; on: boolean; agent?: true; person?: string }
  | { op: "name"; at: string; by: string; person: string; agent?: undefined }
  | MoveEvent
  | LibraryEvent;
type OpinionEvent = Extract<ReviewEvent, { op: "opinion" }>;

/** A prefix that can be trusted: a dotted Lean name, as a module or a namespace is written, and
 *  short enough to read in a list. */
export function validPrefix(s: unknown): s is string {
  if (s === OUTSIDE) return true;
  const part = "(?:[\\p{L}_][\\p{L}\\p{N}_'!?₀-₉ₐ-ₜ]*|«[^»\\n\\r]*»|[0-9]+)";
  return typeof s === "string" && s.length <= 200 && new RegExp(`^${part}(?:\\.${part})*$`, "u").test(s);
}

/** A request is checked before anything is written: sizes are bounded, fields have the right
 *  kinds. Returns the reason it is refused, or null. */
export function invalid(r: unknown): string | null {
  if (!r || typeof r !== "object") return "not an object";
  const o = r as Record<string, unknown>;
  const str = (v: unknown, max: number, optional = false) =>
    v === undefined ? optional : typeof v === "string" && v.length > 0 && v.length <= max;
  // trust names a prefix, a move two declarations; everything else one declaration
  if (o.op === "trust") {
    if (!validPrefix(o.prefix)) return "prefix";
  } else if (isLibraryOp(o.op)) {
    // a file is named by its hash, a link by its id (shared/library.ts)
  } else if (o.op === "move") {
    if (!str(o.from, 2000) || !str(o.to, 2000) || o.from === o.to) return "a move is from one declaration to another";
  } else if (!str(o.name, 2000)) return "name";
  if (!str(o.by, 120) || !(o.by as string).trim()) return "reviewer";
  // the server says whether the request came from an agent, from who asks, never the page; what
  // an agent may record is its level's to say, checked where the request comes in
  if (o.agent !== undefined && typeof o.agent !== "boolean") return "agent";
  if (o.person !== undefined && (!validPersonId(o.person) || o.agent)) return "person";
  // an opinion recorded for someone else (ReviewSpec decision 8): a person's, for another person
  if (o.for !== undefined || o.forPerson !== undefined) {
    if (o.op !== "opinion") return "only an opinion is recorded for someone else";
    if (o.agent) return "an agent records for no one";
    if (typeof o.for !== "string" || !validName(o.for.trim())) return "for";
    if (o.forPerson !== undefined && !validPersonId(o.forPerson)) return "forPerson";
    if (o.for.trim() === (o.by as string).trim() || (o.forPerson !== undefined && o.forPerson === o.person)) return "an opinion of one's own is recorded as one's own";
  }
  switch (o.op) {
    case "opinion":
      if (o.verdict !== "approve" && o.verdict !== "comment") return "verdict";
      if (!str(o.comment, 10000, true)) return "comment";
      if (o.verdict === "comment" && !(o.comment as string | undefined)?.trim()) return "a comment needs text";
      if (!str(o.hash, 64, true)) return "hash";
      if (!str(o.text, MAX_TEXT, true)) return "text";
      if (!str(o.statement, MAX_TEXT, true)) return "statement";
      if (o.text !== undefined && o.statement !== undefined) return "a text or a statement, not both";
      return null;
    case "target":
      return typeof o.on === "boolean" ? null : "on";
    case "trust":
      return typeof o.on === "boolean" ? null : "on";
    case "key":
      if (!str(o.target, 2000)) return "target";
      if (o.target === o.name) return "a target is always key for itself";
      return typeof o.on === "boolean" ? null : "on";
    case "move":
      if (o.rename !== undefined && typeof o.rename !== "boolean") return "rename";
      if (!str(o.auto, 200, true)) return "auto";
      if (o.snap !== undefined && !(Number.isInteger(o.snap) && (o.snap as number) > 0)) return "snap";
      return typeof o.on === "boolean" ? null : "on";
    default:
      return isLibraryOp(o.op) ? invalidLibrary(o) : "op";
  }
}

/** The event that records a (checked) request, as it is appended to its writer's log;
 *  `toolchain` and `now` come from the server. `d` is the review it is recorded on: a change of
 *  mind on the same version and the same text does not repeat the text, so that a log grows by
 *  the opinion alone. */
export function eventOf(d: ReviewData, r: ReviewOp, toolchain: string, now: string): ReviewEvent {
  const by = r.by.trim();
  // an agent's event says so, whatever it is; so does one by someone invited by a personal link
  const agent = r.agent ? { agent: true as const } : {};
  const person = r.person ? { person: r.person } : {};
  switch (r.op) {
    case "opinion": {
      const e: OpinionEvent = { op: "opinion", name: r.name, by, ...person, verdict: r.verdict, at: now, toolchain };
      // recorded for someone else (ReviewSpec decision 8)
      if (r.for?.trim()) {
        e.for = r.for.trim();
        if (r.forPerson) e.forPerson = r.forPerson;
      }
      if (r.comment?.trim()) e.comment = r.comment.trim();
      if (r.agent) e.agent = true;
      // the text matters only to an opinion that can go stale, one bound to a version
      if (r.hash) {
        e.hash = r.hash;
        const was = (Object.hasOwn(d.opinions, r.name) ? d.opinions[r.name] : []).findLast((p) => author(p) === voice(e));
        const same = was?.hash === r.hash ? judgedOn(d, r.name, was) : null;
        if (r.text !== undefined && !(same?.of === "source" && same.text === r.text)) e.text = r.text;
        else if (r.text === undefined && r.statement !== undefined && !(same?.of === "statement" && same.text === r.statement)) e.statement = r.statement;
      }
      return e;
    }
    case "target":
      return { op: "target", at: now, by, ...person, name: r.name, on: r.on, ...agent };
    case "trust":
      return { op: "trust", at: now, by, ...person, prefix: r.prefix, on: r.on, ...agent };
    case "key":
      return { op: "key", at: now, by, ...person, target: r.target, name: r.name, on: r.on, ...agent };
    case "move":
      return {
        op: "move",
        at: now,
        by,
        ...person,
        from: r.from,
        to: r.to,
        on: r.on,
        ...(r.rename ? { rename: true as const } : {}),
        ...(r.auto ? { auto: r.auto } : {}),
        ...(r.snap ? { snap: r.snap } : {}),
        ...agent,
      };
    default:
      return libraryEventOf(r, by, now, !!r.agent, r.person ?? null);
  }
}

/** The line that says someone invited by a personal link goes by `name` from `now` on, appended to
 *  their log when they rename themselves (server/review.ts, `named`). */
export function nameEvent(person: string, name: string, now: string): ReviewEvent {
  return { op: "name", at: now, by: name.trim(), person };
}

/** One step of the replay: the review after `e`. Every page and the server take the same steps
 *  in the same order, so they hold the same review. */
export function applyEvent(d: ReviewData, e: ReviewEvent): void {
  // the name someone invited by a personal link goes by is the one their latest line gives: what
  // they wrote before shows under it from now on
  if (e.person) named(d, e.person, e.by);
  // who did it, where an agent did: the page marks it as an agent's
  const agent = e.agent ? { agent: true as const } : {};
  const person = e.person ? { person: e.person } : {};
  switch (e.op) {
    case "name":
      return;
    case "opinion": {
      const { op: _op, name, for: forName, forPerson, ...o } = e;
      (Object.hasOwn(d.opinions, name) ? d.opinions[name] : (d.opinions[name] = [])).push(forName === undefined ? o : recordedFor(d, o, forName, forPerson));
      return;
    }
    case "target":
      if (!e.on) delete d.targets[e.name];
      else if (!Object.hasOwn(d.targets, e.name)) d.targets[e.name] = { by: e.by, at: e.at, ...agent, ...person };
      return;
    case "trust": {
      const rest = d.trusted.filter((p) => p !== e.prefix);
      d.trusted = [...new Set(e.on ? [...rest, e.prefix] : rest)].sort();
      return;
    }
    case "key": {
      // the first mark stands (who marked it, and when) until it is taken off
      const ks = Object.hasOwn(d.keys, e.target) ? d.keys[e.target] : null;
      if (e.on) {
        const m = ks ?? (d.keys[e.target] = byName<KeyMark>());
        if (!Object.hasOwn(m, e.name)) m[e.name] = { by: e.by, at: e.at, ...agent, ...person };
      } else if (ks) {
        delete ks[e.name];
        if (!Object.keys(ks).length) delete d.keys[e.target];
      }
      return;
    }
    case "move":
      applyMove(d, e);
      return;
    default:
      applyLibrary(d, e);
  }
}

/** Someone invited by a personal link goes by `name` now: what their id wrote shows under it, and
 *  the name they went by before is kept among those they had. */
function named(d: ReviewData, id: string, name: string): void {
  const p = Object.hasOwn(d.people, id) ? d.people[id] : null;
  if (p?.name === name) return;
  if (!p) {
    // first seen after opinions were recorded for them (decision 8): those show under this name,
    // the names they were written under kept, so that a quote of one still finds it
    const was = new Set<string>();
    for (const ops of Object.values(d.opinions))
      for (const o of ops)
        if (o.person === id && o.by !== name) {
          was.add(o.by);
          o.by = name;
        }
    d.people[id] = { name, was: [...was] };
    return;
  }
  p.was = [...p.was.filter((n) => n !== p.name && n !== name), p.name];
  p.name = name;
  for (const ops of Object.values(d.opinions))
    for (const o of ops) {
      if (o.person === id) o.by = name;
      if (o.recordedBy?.person === id) o.recordedBy.by = name;
    }
  for (const t of Object.values(d.targets)) if (t.person === id) t.by = name;
  for (const marks of Object.values(d.keys)) for (const m of Object.values(marks)) if (m.person === id) m.by = name;
  renamePerson(d, id, name);
}

/** The opinion on `name` given at `at` by whoever is, or was, called `by`: what a quote of an
 *  opinion (shared/comment.ts, `opinionRef`) names, which stays right once its writer, invited by a
 *  personal link, renames themselves. */
export function findOpinion(d: ReviewData, name: string, by: string, at: string): Opinion | undefined {
  const was = (o: Opinion) => !!o.person && Object.hasOwn(d.people, o.person) && d.people[o.person].was.includes(by);
  return (Object.hasOwn(d.opinions, name) ? d.opinions[name] : []).find((o) => o.at === at && (o.by === by || was(o)));
}

/** Record a (checked) request on `d` at once: the event, applied. */
export function record(d: ReviewData, r: ReviewOp, toolchain: string, now: string): ReviewEvent {
  const e = eventOf(d, r, toolchain, now);
  applyEvent(d, e);
  return e;
}

/** Whether recording `r` would change nothing: a target marked that is one, a prefix trusted that
 *  is, a key declaration marked that is. Such a request is answered, and nothing is appended. */
export function noChange(d: ReviewData, r: ReviewOp): boolean {
  if (r.op === "target") return Object.hasOwn(d.targets, r.name) === r.on;
  if (r.op === "trust") return d.trusted.includes(r.prefix) === r.on;
  if (r.op === "key") return keyMarked(d, r.target, r.name) === r.on;
  if (r.op === "move") return moveIsIdle(d, { ...r, rename: r.rename || undefined });
  if (isLibraryOp(r.op)) return libraryNoChange(d, r as LibraryOp);
  return false;
}

/** Events the review no longer records: an explanation (`explain`), removed by the owner on
 *  2026-10-08, and a checkpoint of a target's review (`checkpoint`), removed on 2026-10-09. A line
 *  of one in a log is skipped, whatever it holds. */
const RETIRED_OPS: readonly unknown[] = ["explain", "checkpoint"];

/** A line of a log, read: the event it holds, or why it is not one; null for an event of a kind
 *  the review no longer records (`RETIRED_OPS`), which is skipped — neither applied nor a problem,
 *  so that an older log is read and its writer writes on. Only known fields are kept, in objects
 *  of their own. Every line in an agent's log (`agentLog`) is marked as an agent's — its
 *  opinions advice, its other events what it did at level full, which was checked when it was
 *  written; a log read back from disk is replayed as written — and no line in a person's is.
 *  Likewise every line in the log of someone invited by a personal link (`personLog`, the link's
 *  id, from the file's name) carries that id, and no line elsewhere carries one; their `name` lines
 *  are read there only. */
export function readEvent(raw: unknown, agentLog: boolean, personLog: string | null = null): ReviewEvent | string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an event";
  const o = raw as Record<string, unknown>;
  if (RETIRED_OPS.includes(o.op)) return null;
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!str(o.at, 40) || !Number.isFinite(Date.parse(o.at as string))) return "no time (at)";
  if (!str(o.by, 120) || !(o.by as string).trim()) return "no writer (by)";
  const at = o.at as string, by = o.by as string;
  if (agentLog ? o.agent !== true : o.agent !== undefined) return agentLog ? "a line of an agent's log not marked as an agent's" : "an agent's line in a person's log";
  if (personLog ? o.person !== personLog : o.person !== undefined) return personLog ? "a line of an invited person's log without their id (person)" : "an invited person's line in another's log";
  const agent = agentLog ? { agent: true as const } : {};
  const person = personLog ? { person: personLog } : {};
  switch (o.op) {
    case "name":
      return personLog ? { op: "name", at, by, person: personLog } : "a name line outside an invited person's log";
    case "opinion": {
      if (!str(o.name, 2000)) return "name";
      if (o.verdict !== "approve" && o.verdict !== "comment") return "verdict";
      const e: OpinionEvent = { op: "opinion", name: o.name as string, by, ...person, verdict: o.verdict, at };
      for (const [k, max] of [["comment", 10000], ["hash", 64], ["toolchain", 200], ["text", MAX_TEXT], ["statement", MAX_TEXT]] as const) {
        if (o[k] === undefined) continue;
        if (!str(o[k], max)) return k;
        e[k] = o[k] as string;
      }
      if (e.text !== undefined && e.statement !== undefined) return "a text and a statement";
      // recorded for someone else (ReviewSpec decision 8): a person's line, for another person
      if (o.for !== undefined || o.forPerson !== undefined) {
        if (agentLog) return "an agent's opinion recorded for someone else";
        if (typeof o.for !== "string" || !validName(o.for)) return "for";
        if (o.forPerson !== undefined && !validPersonId(o.forPerson)) return "forPerson";
        if (o.for === by || (o.forPerson !== undefined && o.forPerson === personLog)) return "an opinion recorded for its own writer";
        e.for = o.for as string;
        if (o.forPerson !== undefined) e.forPerson = o.forPerson as string;
      }
      if (agentLog) e.agent = true;
      return e;
    }
    case "target":
      if (!str(o.name, 2000)) return "name";
      return typeof o.on === "boolean" ? { op: "target", at, by, ...person, name: o.name as string, on: o.on, ...agent } : "on";
    case "trust":
      if (!validPrefix(o.prefix)) return "prefix";
      return typeof o.on === "boolean" ? { op: "trust", at, by, ...person, prefix: o.prefix, on: o.on, ...agent } : "on";
    case "key":
      if (!str(o.name, 2000)) return "name";
      if (!str(o.target, 2000)) return "target";
      return typeof o.on === "boolean" ? { op: "key", at, by, ...person, target: o.target as string, name: o.name as string, on: o.on, ...agent } : "on";
    case "move": {
      const m = readMove(o, at, by, agentLog);
      return typeof m === "string" ? m : { ...m, ...person };
    }
    default:
      return isLibraryOp(o.op) ? readLibraryEvent(o, at, by, agentLog, personLog) : "op";
  }
}

/** One writer's events, in the order of their file, and the file's name: what `replay` merges. */
export interface Log {
  file: string;
  events: ReviewEvent[];
}

/** Every log merged into one sequence: one writer's events in the order of their file, different
 *  writers' by time; at the same time, by file name (the same on every replica, so every server
 *  replays the same). A writer's clock going backwards keeps their order and delays nobody else's
 *  past their own. */
export function merged(logs: Log[]): { file: string; e: ReviewEvent }[] {
  const ls = [...logs].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const time = ls.map((l) => l.events.map((e) => Date.parse(e.at)));
  const next = ls.map(() => 0);
  const out: { file: string; e: ReviewEvent }[] = [];
  for (;;) {
    let best = -1;
    for (let k = 0; k < ls.length; k++) if (next[k] < ls[k].events.length && (best < 0 || time[k][next[k]] < time[best][next[best]])) best = k;
    if (best < 0) return out;
    out.push({ file: ls[best].file, e: ls[best].events[next[best]++] });
  }
}

/** The review every log gives. */
export function replay(logs: Log[]): ReviewData {
  const d = emptyReview();
  for (const { e } of merged(logs)) applyEvent(d, e);
  return d;
}

/** The review as JSON carried it (the server's answer, a snapshot): the same review, with its
 *  objects keyed by names made again without a prototype. */
export function reviewFromJson(raw: unknown): ReviewData {
  const d = emptyReview();
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ReviewData, unknown>>;
  if (Array.isArray(r.trusted)) d.trusted = [...new Set(r.trusted.filter((t): t is string => typeof t === "string"))].sort();
  const own = (o: unknown): [string, unknown][] => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o) : []);
  const marks = (x: Partial<Target>) => ({ ...(x.agent === true ? { agent: true as const } : {}), ...(validPersonId(x.person) ? { person: x.person } : {}) });
  const was = (x: { was?: unknown }) => (Array.isArray(x.was) && x.was.every((w) => typeof w === "string") ? { was: x.was as string[] } : {});
  for (const [name, t] of own(r.targets)) {
    const x = t as Partial<Target>;
    d.targets[name] = { by: String(x.by ?? ""), at: String(x.at ?? ""), ...marks(x), ...was(x) };
  }
  for (const [name, ops] of own(r.opinions)) if (Array.isArray(ops)) d.opinions[name] = ops.filter((o): o is Opinion => !!o && typeof o === "object");
  for (const [target, ks] of own(r.keys)) {
    const m = byName<KeyMark>();
    for (const [name, k] of own(ks)) {
      const x = (k && typeof k === "object" ? k : {}) as Partial<KeyMark>;
      const wasOf = Array.isArray(x.wasOf) && x.wasOf.every((w) => typeof w === "string") ? { wasOf: x.wasOf as string[] } : {};
      m[name] = { by: String(x.by ?? ""), at: String(x.at ?? ""), ...marks(x), ...was(x), ...wasOf };
    }
    if (Object.keys(m).length) d.keys[target] = m;
  }
  for (const [id, p] of own(r.people)) {
    const x = (p && typeof p === "object" ? p : {}) as Partial<PersonName>;
    if (validPersonId(id) && typeof x.name === "string") d.people[id] = { name: x.name, was: Array.isArray(x.was) ? x.was.filter((n): n is string => typeof n === "string") : [] };
  }
  const renamed = own(r.renamed).filter(([, v]) => typeof v === "string");
  if (renamed.length) {
    d.renamed = byName<string>();
    for (const [k, v] of renamed) d.renamed[k] = v as string;
  }
  // the library's files, links and history (shared/library.ts)
  Object.assign(d, libraryFromJson(r as { files?: unknown; links?: unknown; libraryHistory?: unknown }));
  return d;
}

// ---------------------------------------------------------------------------------------------
// The logs' names

/** FNV-1a over a text's UTF-8 bytes, as 8 hex digits: short, and the same in the page and the
 *  server. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** the longest readable part of a log's name, in UTF-16 units: the whole name stays under 60 */
const SLUG = 32;

/** The file a writer's events are appended to, in the site's `log/`: a readable part of
 *  their name and a short hash of their exact name — `Alice-3f2a9c1b.jsonl`, an agent's
 *  `Claude-7c01aa52.agent.jsonl`. The site's folder may be copied, backed up or synced anywhere,
 *  Windows included, so the name is one every copy accepts: only letters and digits
 *  that read the same in every Unicode normal form (accents dropped), joined by hyphens — no
 *  `< > : " / \ | ? *`, no control character, no space or dot at the end, no `~` (an NTFS short
 *  name's shape), never a device name (the hash follows the readable part) — under 60 characters;
 *  and two names that differ only in case get two hashes, so their files differ by more than case
 *  (macOS and Windows would take them for one). The hash is of the exact name the events carry.
 *  Someone invited by a personal link writes to a log named by the link's id alone, whatever name
 *  they go by — `3f2a9c1b07.person.jsonl` — so that a rename never starts a new file. */
export function logFileName(name: string, agent: boolean, person: string | null = null): string {
  if (person) return `${person}.person.jsonl`;
  const plain = name.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
  let slug = "";
  for (const c of plain) {
    const keep = /^[\p{L}\p{N}]$/u.test(c) && c.normalize("NFD") === c && c.normalize("NFKC") === c;
    const add = keep ? c : slug.endsWith("-") ? "" : "-";
    if (slug.length + add.length > SLUG) break;
    slug += add;
  }
  slug = slug.replace(/^-+|-+$/g, "") || "writer";
  return `${slug}-${shortHash(name)}${agent ? ".agent" : ""}.jsonl`;
}

/** The personal link's id a log is named by (`logFileName`), or null for any other log. */
export function personOfLog(file: string): string | null {
  return /^([0-9a-f]{10})\.person\.jsonl$/.exec(file)?.[1] ?? null;
}

/** A line of a log that cannot be read: where, and why. The file's other lines are read; nothing
 *  is appended to it until it is fixed by hand. */
export interface LogProblem {
  /** the log's name, in `log/` */
  file: string;
  /** 1-based; the last line, where it is cut short */
  line: number;
  why: string;
  /** whose log it is, as its good lines say; null when none says */
  writer: string | null;
}

/** What changed in the review, as the server tells the pages (server/review.ts): `events` came
 *  after everything replayed before, and a page holding the review at revision `base` applies them
 *  in order to have it at `rev`; or `events` is null, and the review is to be read whole. */
export interface ReviewChange {
  /** the server's run: revisions of another run are not comparable */
  epoch: string;
  base: number;
  rev: number;
  events: ReviewEvent[] | null;
  problems: LogProblem[];
}

/** The whole review, as a page takes it on (GET /api/review, and on connecting). */
export interface ReviewWhole {
  epoch: string;
  rev: number;
  data: ReviewData;
  problems: LogProblem[];
  error: string | null;
}

/** The problems in a few words, for the page and /api/status; null when there are none. */
export function problemsText(ps: LogProblem[]): string | null {
  if (!ps.length) return null;
  const files = [...new Set(ps.map((p) => p.file))];
  const each = ps.slice(0, 3).map((p) => `log/${p.file}, line ${p.line}: ${p.why}`).join("; ");
  const who = [...new Set(ps.map((p) => p.writer ?? `the writer of log/${p.file}`))].join(", ");
  return (
    `${ps.length === 1 ? "A line" : `${ps.length} lines`} of the review cannot be read — ${each}${ps.length > 3 ? `; and ${ps.length - 3} more` : ""}. ` +
    `The rest is read; nothing is rewritten, and nothing more is written to ${files.length === 1 ? "that file" : "those files"} (${who}) until ${files.length === 1 ? "it is" : "they are"} fixed by hand.`
  );
}

// ---------------------------------------------------------------------------------------------
// Reading it

export type Status = "none" | "approved" | "commented" | "stale";

/** Who gave an opinion: a person and an agent of the same name are two writers, and neither's
 *  replaces the other's; someone invited by a personal link is their link, whatever name they went
 *  by, and a guest who took a name they once had is someone else. */
function author(o: Opinion): string {
  return o.person ? `link ${o.person}` : (o.agent ? "agent " : "person ") + o.by;
}

/** Whose an opinion line is: theirs it was recorded for (ReviewSpec decision 8), else its writer's. */
function voice(e: OpinionEvent): string {
  return e.for === undefined ? author(e) : author({ by: e.for, verdict: e.verdict, at: e.at, ...(e.forPerson ? { person: e.forPerson } : {}) });
}

/** An opinion recorded for someone else (ReviewSpec decision 8), as the review holds it: theirs —
 *  under their latest name where they are invited — saying who recorded it. */
function recordedFor(d: ReviewData, o: Opinion, forName: string, forPerson: string | undefined): Opinion {
  const { by, person, ...rest } = o;
  const name = forPerson && Object.hasOwn(d.people, forPerson) ? d.people[forPerson].name : forName;
  return { ...rest, by: name, ...(forPerson ? { person: forPerson } : {}), recordedBy: { by, ...(person ? { person } : {}) } };
}

/** Each author's latest opinion on a declaration, people's or agents': a new one replaces their
 *  earlier one. */
function latest(d: ReviewData, name: string, agents: boolean): Opinion[] {
  const out = new Map<string, Opinion>();
  // own keys only: a declaration may be called `constructor` or `toString`
  for (const o of Object.hasOwn(d.opinions, name) ? d.opinions[name] : []) if (!!o.agent === agents) out.set(author(o), o);
  return [...out.values()];
}

/** Each reviewer's latest opinion on a declaration: a new one replaces their earlier one. People
 *  only: an agent's opinion is advice, and nothing read off this counts it. */
export function current(d: ReviewData, name: string): Opinion[] {
  return latest(d, name, false);
}

/** Each agent's latest advice on a declaration (AgentSpec decision 2), shown apart and never
 *  counted. */
export function advice(d: ReviewData, name: string): Opinion[] {
  return latest(d, name, true);
}

/** Which verdict a summary shows when the opinions on a declaration's present version differ, the
 *  first that any of them gives: a comment ahead of an approval, so that what a reviewer said is
 *  not hidden by someone else's approval (the owner's default, 2026-10-09). Every summary reads
 *  this order — the status (`statusOf`), what agents advise (`adviceOf`), and so every count,
 *  colour and query built on them — and changing it here changes them all. */
export const VERDICT_ORDER: readonly Verdict[] = ["comment", "approve"];

/** The status a verdict gives a declaration when it is the one shown. */
const STATUS_OF: Record<Verdict, Status> = { approve: "approved", comment: "commented" };

/** The verdict shown of those given, in `VERDICT_ORDER`; null when none is given. */
function summary(given: Opinion[]): Verdict | null {
  return VERDICT_ORDER.find((v) => given.some((o) => o.verdict === v)) ?? null;
}

/** What agents advise on the present version of a declaration, summed up as a status is
 *  (`VERDICT_ORDER`); null when no agent has advised on it. */
export function adviceOf(d: ReviewData, name: string, hash: string | undefined): Verdict | null {
  return summary(advice(d, name).filter((o) => fresh(o, hash)));
}

/** What an opinion was given on: the declaration's source as the reviewer read it, or its
 *  statement where there was no source. */
export interface Judged {
  of: "source" | "statement";
  text: string;
}

/** What an opinion was given on, as recorded: with the opinion itself, or — where it replaced the
 *  same reviewer's opinion on the same version and the same text, which `record` does not repeat —
 *  with the one it replaced. Null for an opinion older than the record of it. */
export function judgedOn(d: ReviewData, name: string, o: Opinion): Judged | null {
  const own = (p: Opinion): Judged | null =>
    p.text !== undefined ? { of: "source", text: p.text } : p.statement !== undefined ? { of: "statement", text: p.statement } : null;
  // each author's previous opinion, and what it was given on, in the order given
  const last = new Map<string, { hash?: string; judged: Judged | null }>();
  for (const p of Object.hasOwn(d.opinions, name) ? d.opinions[name] : []) {
    const prev = last.get(author(p));
    const judged = own(p) ?? (p.hash && prev?.hash === p.hash ? prev.judged : null);
    if (p === o) return judged;
    last.set(author(p), { hash: p.hash, judged });
  }
  return own(o);
}

/** Whether an opinion is about the version there is now. */
export function fresh(o: Opinion, hash: string | undefined): boolean {
  return !o.hash || !hash || o.hash === hash;
}

/** A summary of what reviewers said about the present version (ReviewSpec, "What the page shows"):
 *  the verdict shown of those on it (`VERDICT_ORDER`), else stale where every opinion is on an
 *  earlier version, else none. */
export function statusOf(d: ReviewData, name: string, hash: string | undefined): Status {
  const now = current(d, name);
  if (!now.length) return "none";
  const v = summary(now.filter((o) => fresh(o, hash)));
  return v ? STATUS_OF[v] : "stale";
}

/** Whether a dotted name is `prefix` or lies under it, a whole component at a time: "Foo" covers
 *  "Foo" and "Foo.Bar", not "FooBar". */
export function under(s: string, prefix: string): boolean {
  return s === prefix || s.startsWith(prefix + ".");
}

/** Whether a trusted prefix covers a declaration. The world outside the project is trusted by
 *  module, as Mathlib is: its names (Nat.add, Finset.sum) say nothing of where they come from; or
 *  as a whole (OUTSIDE). A project's own declaration is trusted by its module or its name, so that
 *  a vendored library (a folder of files) and a layer reviewed on its own (a namespace) can both be
 *  named. */
export function covers(prefix: string, name: string, module: string, external: boolean): boolean {
  if (prefix === OUTSIDE) return external;
  return under(module, prefix) || (!external && under(name, prefix));
}

/** The trusted prefixes that cover a declaration, in the list's (sorted) order: a prefix comes
 *  before the longer ones under it. */
export function trustedBy(d: ReviewData, name: string, module: string, external: boolean): string[] {
  return d.trusted.filter((p) => covers(p, name, module, external));
}

/** Whether a declaration is trusted without review: a trusted prefix covers it, or it is a
 *  standard axiom. */
export function trusted(d: ReviewData, name: string, module: string, external: boolean): boolean {
  return STANDARD_AXIOMS.includes(name) || trustedBy(d, name, module, external).length > 0;
}

/** What the canvas and the lists mark a declaration with: what reviewers said about it, and when
 *  nobody has, whether a trusted prefix covers it — for the project's own declarations only:
 *  the outside world trusted by default is the rule there, not news. */
export function markOf(d: ReviewData, name: string, module: string, external: boolean, hash: string | undefined): Status | "trusted" {
  const s = statusOf(d, name, hash);
  if (s !== "none" || external) return s;
  return trustedBy(d, name, module, false).length ? "trusted" : "none";
}

export interface Progress {
  /** declarations that need review */
  total: number;
  approved: number;
  commented: number;
  stale: number;
}

/** How far the review of a set (a target's TCB) has come. */
export function progressOf(d: ReviewData, members: { name: string; module: string; ext: boolean; hash?: string }[]): Progress {
  const p: Progress = { total: 0, approved: 0, commented: 0, stale: 0 };
  for (const m of members) {
    if (trusted(d, m.name, m.module, m.ext)) continue;
    p.total++;
    const s = statusOf(d, m.name, m.hash);
    if (s === "approved") p.approved++;
    else if (s === "commented") p.commented++;
    else if (s === "stale") p.stale++;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Key declarations (ExportSpec decision 1)

/** Whether `name` is marked as a key declaration of `target` (own keys only: a target may be
 *  called `constructor`). The target itself is key without a mark: see keyMarks. */
export function keyMarked(d: ReviewData, target: string, name: string): boolean {
  return Object.hasOwn(d.keys, target) && Object.hasOwn(d.keys[target], name);
}

/** The declarations marked as key for `target`, by name, sorted; the target itself, always
 *  key, is not among them. Whether each is still in the target's review is the graph's to say
 *  (shared/keys.ts, keySet). */
export function keyMarks(d: ReviewData, target: string): string[] {
  return Object.hasOwn(d.keys, target) ? Object.keys(d.keys[target]).sort() : [];
}

/** The targets `name` is marked key for, sorted. */
export function keyFor(d: ReviewData, name: string): string[] {
  return Object.keys(d.keys)
    .filter((t) => Object.hasOwn(d.keys[t], name))
    .sort();
}

