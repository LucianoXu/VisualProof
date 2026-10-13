// The library and its links (AttachmentSpec.md, decisions 1–10, the owner's of 2026-10-10 and
// 2026-10-11): the papers and images that explain the formal code, and the links that join a
// declaration or a cluster to a place in one of them.
//
// A file's bytes are in the site's folder, named by their SHA-256 (server/library.ts), and never
// change (decision 2): a revised paper is another file. Its record — title, type, size, pages, who
// added it, the URL it came from — and every link are events of the review's logs (ReviewSpec
// decision 5), which name the file by its hash:
//
//   {"op":"file","sha":"…","title":"…","type":"pdf","size":…,"pages":12,"url":"…",…}
//   {"op":"file-edit","sha":"…","title":"…"}          the title changed
//   {"op":"file-archive","sha":"…"}                    hidden from the library (decision 3)
//   {"op":"file-restore","sha":"…"}                    back in it
//   {"op":"link","id":"…","subject":"decl(A.b)","file":"…","page":12,"region":[…],"quote":{…},"label":"…"}
//   {"op":"link-edit","id":"…", …}                     its label, place or subject changed
//   {"op":"unlink","id":"…"}                           removed
//
// each with who wrote it and when, attributed as opinions are (an agent's marked, someone invited
// by a personal link by the link's id). The replay keeps the records by hash and the links in the
// order they were made (`ReviewData.files`, `ReviewData.links`). A link's subject is named as a
// scope names it (decision 4): `decl(X)`, `ns(P)`, `file(P)`; a move (shared/moves.ts) carries the
// links on `decl(from)` to `decl(to)` as it carries opinions, and the server carries the links on a
// cluster a build renamed as a whole by a `link-edit` in its own log (server/library.ts).
//
// A place is a page of a PDF with a region of it, the quoted text with a little of the text around
// it, or both; or an image, whole or a region of it. A region is kept in the page's own fractions
// (0–1, from its top left), so that it does not depend on how large the page is drawn.
//
// Names are anything Lean allows, so every object keyed by them or by hashes here has no prototype,
// as in shared/review.ts.

import { splitName } from "./layout.ts";
import type { ClusterMode } from "./graph.ts";

/** The most a file may be (decision 1). */
export const MAX_FILE = 50 * 1024 * 1024;
/** The most the library holds by default, all its files' bytes together: a server option. */
export const DEFAULT_LIBRARY_LIMIT = 2 * 1024 * 1024 * 1024;

/** What a file of the library may be: a PDF or an image. Never SVG, which can carry scripts. */
export type FileType = "pdf" | "png" | "jpeg" | "webp" | "gif";
export const FILE_TYPES: readonly FileType[] = ["pdf", "png", "jpeg", "webp", "gif"];
export const MIME: Record<FileType, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** A file's type, read from its first bytes, never from its name: null for anything else (SVG, an
 *  HTML page a server answered instead of the PDF, a zip). A PDF may have a few bytes before its
 *  header, as readers accept. */
export function sniffType(b: Uint8Array): FileType | null {
  const at = (k: number, sig: number[]) => sig.every((x, j) => b[k + j] === x);
  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (b.length >= 6 && (at(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || at(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return "gif";
  if (b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "webp";
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let k = 0; k + pdf.length <= Math.min(b.length, 1024); k++) if (at(k, pdf)) return "pdf";
  return null;
}

/** A file's name in the library: the SHA-256 of its bytes, in lower-case hex. */
export function validSha(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

/** A link's id, made by the server: short, and unique among a project's links. */
export function validLinkId(s: unknown): s is string {
  return typeof s === "string" && /^l[0-9a-f]{12}$/.test(s);
}

/** Who did something, as the review records it (as an opinion is attributed). */
export interface Author {
  by: string;
  at: string;
  /** an agent's (AgentSpec decision 9) */
  agent?: true;
  /** someone invited by a personal link: the link's id */
  person?: string;
}

/** A file of the library, as its events say (decision 1). */
export interface FileRecord extends Author {
  sha: string;
  /** the PDF's own title, else the file's name; editable */
  title: string;
  type: FileType;
  size: number;
  /** a PDF's pages */
  pages?: number;
  /** the name it was uploaded under */
  name?: string;
  /** the address it was fetched from */
  url?: string;
  edited?: Author;
  /** hidden from the library (decision 3): its links say so, and it is restored from the archive */
  archived?: Author;
}

/** Quoted text with a little of the text around it, so that it is found again in its page. */
export interface Quote {
  text: string;
  before?: string;
  after?: string;
}

/** A region: its left, top, right and bottom, as fractions of its page's (or image's) width and
 *  height, from the top left. */
export type Region = [number, number, number, number];

/** Where a link points in its file: a PDF's page with a region and/or a quote, or an image, whole
 *  (nothing) or a region of it. */
export interface LinkPlace {
  page?: number;
  region?: Region;
  quote?: Quote;
}

/** A link (decision 4): a subject, a place in a file, and a label. */
export interface Link extends Author, LinkPlace {
  id: string;
  /** `decl(X)`, `ns(P)` or `file(P)` */
  subject: string;
  /** the file's hash */
  file: string;
  label: string;
  edited?: Author;
  /** the declarations it was on before moves brought it here, oldest first (shared/moves.ts) */
  was?: string[];
}

/** The limits of what a record and a link hold, in UTF-16 units. */
export const LIMITS = { title: 300, label: 200, name: 300, url: 2000, quote: 2000, context: 200, subject: 2010, pages: 100000 } as const;

// ---------------------------------------------------------------------------------------------
// Subjects

export type SubjectKind = "decl" | "ns" | "file";

export interface Subject {
  kind: SubjectKind;
  /** a declaration's full name, a namespace, or a module prefix */
  name: string;
}

/** A subject's text, `decl(X)`, `ns(P)` or `file(P)`, read; null when it is not one. The name is
 *  everything between the first parenthesis and the last, so a name in «» may hold parentheses. */
export function parseSubject(s: unknown): Subject | null {
  if (typeof s !== "string" || s.length > LIMITS.subject) return null;
  const m = /^(decl|ns|file)\((.+)\)$/s.exec(s);
  if (!m || !m[2].trim() || /[\n\r]/.test(m[2])) return null;
  return { kind: m[1] as SubjectKind, name: m[2] };
}

export function subjectText(s: Subject): string {
  return `${s.kind}(${s.name})`;
}

export const declSubject = (name: string): string => `decl(${name})`;

/** The subject a cluster of a board is, by its key and the board's clustering. */
export function clusterSubject(key: string, mode: ClusterMode): string {
  return `${mode === "module" ? "file" : "ns"}(${key})`;
}

/** A subject in a few words, as the page and the export say it: a declaration by its name, a
 *  cluster as "namespace P" or "files under P". */
export function subjectWords(s: string): string {
  const p = parseSubject(s);
  if (!p) return s;
  return p.kind === "decl" ? p.name : p.kind === "ns" ? `namespace ${p.name}` : `files under ${p.name}`;
}

/** The clusters around a declaration under a way of clustering, innermost first, as subjects (the
 *  board's clusters: a namespace and each one around it, or a module and each prefix of it). A
 *  structure and its namespace are one thing on the board (shared/layout.ts), so a declaration's
 *  own name comes first by namespace: a link on `ns(Foo)` is one on the structure `Foo` too. */
export function clusterChain(name: string, module: string, mode: ClusterMode): string[] {
  const parts = mode === "module" ? module.split(".") : splitName(name);
  const out: string[] = [];
  for (let k = parts.length; k >= 1; k--) out.push(clusterSubject(parts.slice(0, k).join("."), mode));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The events

export const LIBRARY_OPS = ["file", "file-edit", "file-archive", "file-restore", "link", "link-edit", "unlink"] as const;
export type LibraryOpName = (typeof LIBRARY_OPS)[number];

export function isLibraryOp(op: unknown): op is LibraryOpName {
  return (LIBRARY_OPS as readonly unknown[]).includes(op);
}

/** What is recorded, before who and when. `null` in a link's edit takes a part of its place away. */
export type LibraryOp =
  | { op: "file"; sha: string; title: string; type: FileType; size: number; pages?: number; name?: string; url?: string }
  | { op: "file-edit"; sha: string; title: string }
  | { op: "file-archive"; sha: string }
  | { op: "file-restore"; sha: string }
  | ({ op: "link"; id: string; subject: string; file: string; label: string } & LinkPlace)
  | { op: "link-edit"; id: string; subject?: string; label?: string; page?: number | null; region?: Region | null; quote?: Quote | null; auto?: string; snap?: number }
  | { op: "unlink"; id: string };

/** One line of a log: what was recorded, by whom, when. */
export type LibraryEvent = LibraryOp & { at: string; by: string; agent?: true; person?: string };

const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && !!v.trim();
const optStr = (v: unknown, max: number) => v === undefined || str(v, max);

export function validRegion(r: unknown): r is Region {
  if (!Array.isArray(r) || r.length !== 4 || !r.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) return false;
  return r[2] > r[0] && r[3] > r[1];
}

export function validQuote(q: unknown): q is Quote {
  if (!q || typeof q !== "object" || Array.isArray(q)) return false;
  const o = q as Record<string, unknown>;
  const ctx = (v: unknown) => v === undefined || (typeof v === "string" && v.length <= LIMITS.context);
  return str(o.text, LIMITS.quote) && ctx(o.before) && ctx(o.after) && Object.keys(o).every((k) => k === "text" || k === "before" || k === "after");
}

const validPage = (p: unknown) => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= LIMITS.pages;

/** Why a library event's own fields are not right, or null. Who wrote it is checked beside it
 *  (shared/review.ts, `invalid` and `readEvent`). */
export function invalidLibrary(o: Record<string, unknown>): string | null {
  switch (o.op) {
    case "file":
      if (!validSha(o.sha)) return "sha";
      if (!str(o.title, LIMITS.title)) return "title";
      if (!FILE_TYPES.includes(o.type as FileType)) return "type";
      if (!Number.isInteger(o.size) || (o.size as number) <= 0 || (o.size as number) > MAX_FILE) return "size";
      if (o.pages !== undefined && !validPage(o.pages)) return "pages";
      if (!optStr(o.name, LIMITS.name)) return "name";
      if (!optStr(o.url, LIMITS.url)) return "url";
      return null;
    case "file-edit":
      if (!validSha(o.sha)) return "sha";
      return str(o.title, LIMITS.title) ? null : "title";
    case "file-archive":
    case "file-restore":
      return validSha(o.sha) ? null : "sha";
    case "link":
      if (!validLinkId(o.id)) return "id";
      if (!parseSubject(o.subject)) return "subject";
      if (!validSha(o.file)) return "file";
      if (!str(o.label, LIMITS.label)) return "label";
      if (o.page !== undefined && !validPage(o.page)) return "page";
      if (o.region !== undefined && !validRegion(o.region)) return "region";
      if (o.quote !== undefined && !validQuote(o.quote)) return "quote";
      if (o.quote !== undefined && o.page === undefined) return "a quote is on a page";
      return null;
    case "link-edit":
      if (!validLinkId(o.id)) return "id";
      if (o.subject !== undefined && !parseSubject(o.subject)) return "subject";
      if (o.label !== undefined && !str(o.label, LIMITS.label)) return "label";
      if (o.page !== undefined && o.page !== null && !validPage(o.page)) return "page";
      if (o.region !== undefined && o.region !== null && !validRegion(o.region)) return "region";
      if (o.quote !== undefined && o.quote !== null && !validQuote(o.quote)) return "quote";
      if (o.auto !== undefined && !str(o.auto, 200)) return "auto";
      if (o.snap !== undefined && !(Number.isInteger(o.snap) && (o.snap as number) > 0)) return "snap";
      if (["subject", "label", "page", "region", "quote"].every((k) => o[k] === undefined)) return "an edit changes something";
      return null;
    case "unlink":
      return validLinkId(o.id) ? null : "id";
    default:
      return "op";
  }
}

/** A library event's own fields, as a line holds them: only those an event of its kind has, in an
 *  object of its own. Checked first (`invalidLibrary`). */
function fieldsOf(o: Record<string, unknown>): LibraryOp {
  const pick = <K extends string>(keys: readonly K[]) => {
    const out: Record<string, unknown> = { op: o.op };
    for (const k of keys) if (o[k] !== undefined) out[k] = k === "region" && Array.isArray(o[k]) ? [...(o[k] as number[])] : k === "quote" && o[k] ? { ...(o[k] as Quote) } : o[k];
    return out as LibraryOp;
  };
  switch (o.op as LibraryOpName) {
    case "file":
      return pick(["sha", "title", "type", "size", "pages", "name", "url"]);
    case "file-edit":
      return pick(["sha", "title"]);
    case "file-archive":
    case "file-restore":
      return pick(["sha"]);
    case "link":
      return pick(["id", "subject", "file", "label", "page", "region", "quote"]);
    case "link-edit":
      return pick(["id", "subject", "label", "page", "region", "quote", "auto", "snap"]);
    case "unlink":
      return pick(["id"]);
  }
}

/** The event that records a checked request: its fields, then who and when. */
export function libraryEventOf(r: LibraryOp, by: string, now: string, agent: boolean, person: string | null): LibraryEvent {
  return { ...fieldsOf(r as unknown as Record<string, unknown>), at: now, by, ...(person ? { person } : {}), ...(agent ? { agent: true as const } : {}) } as LibraryEvent;
}

/** A line of a log holding a library event, read: the event, or why it is not one. */
export function readLibraryEvent(o: Record<string, unknown>, at: string, by: string, agent: boolean, person: string | null): LibraryEvent | string {
  const why = invalidLibrary(o);
  if (why) return why;
  return libraryEventOf(fieldsOf(o), by, at, agent, person);
}

/** A part of a link an edit changes: what it is on, its label, or its place in the file (a page, a
 *  region, a quote). */
export type LinkPart = "subject" | "label" | "place";
export const LINK_PARTS: readonly LinkPart[] = ["subject", "label", "place"];

/** One library event as the timeline tells it (CollabSpec decision 5), with who did it and when. A
 *  removed link is no longer in `links`, nor a title edited away in `files`, so it keeps what the
 *  timeline says of it then: a file's hash and its title; a link's id, subject, label and file —
 *  for an edit, the subject and label after it, which parts changed, what the subject and the
 *  label were before, and why, where VisualProof carried it (`auto`). Never a quote's text: it
 *  stays small. */
export type LibraryStep = Author & StepOf;
type StepOf =
  | { op: "file" | "file-archive" | "file-restore"; sha: string; title: string }
  | { op: "file-edit"; sha: string; title: string; wasTitle: string }
  | { op: "link" | "unlink"; id: string; subject: string; label: string; file: string }
  | { op: "link-edit"; id: string; subject: string; label: string; file: string; changed: LinkPart[]; wasSubject?: string; wasLabel?: string; auto?: string };

/** What the replay keeps of the library, as `ReviewData` holds it. */
export interface LibraryData {
  files?: Record<string, FileRecord>;
  links?: Link[];
  /** every library event that changed something, in the order replayed: what the timeline reads,
   *  so that the logs bring their own history, as they do for opinions; absent where none did */
  libraryHistory?: LibraryStep[];
}

const noProto = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

function authorOf(e: LibraryEvent): Author {
  return { by: e.by, at: e.at, ...(e.agent ? { agent: true as const } : {}), ...(e.person ? { person: e.person } : {}) };
}

/** Whether two values of a part of a place are the same: a region or a quote by what it holds. */
const samePart = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** One library event replayed. The first record of a hash stands: two servers adding the same bytes
 *  add one file. */
export function applyLibrary(d: LibraryData, e: LibraryEvent): void {
  const files = (d.files ??= noProto<FileRecord>());
  const links = (d.links ??= []);
  const file = (sha: string) => (Object.hasOwn(files, sha) ? files[sha] : null);
  // what the timeline tells of it, only where it changed something: the same bytes added again, or
  // an edit to what already is, is no news
  const told = (step: StepOf) => (d.libraryHistory ??= []).push({ ...step, ...authorOf(e) });
  switch (e.op) {
    case "file": {
      if (file(e.sha)) return;
      const { op: _op, at: _at, by: _by, agent: _agent, person: _person, ...rest } = e;
      files[e.sha] = { ...rest, ...authorOf(e) };
      told({ op: "file", sha: e.sha, title: e.title });
      return;
    }
    case "file-edit": {
      const f = file(e.sha);
      if (!f) return;
      files[e.sha] = { ...f, title: e.title, edited: authorOf(e) };
      if (f.title !== e.title) told({ op: "file-edit", sha: e.sha, title: e.title, wasTitle: f.title });
      return;
    }
    case "file-archive": {
      const f = file(e.sha);
      if (f && !f.archived) {
        files[e.sha] = { ...f, archived: authorOf(e) };
        told({ op: "file-archive", sha: e.sha, title: f.title });
      }
      return;
    }
    case "file-restore": {
      const f = file(e.sha);
      if (f?.archived) {
        const { archived: _a, ...rest } = f;
        files[e.sha] = rest;
        told({ op: "file-restore", sha: e.sha, title: f.title });
      }
      return;
    }
    case "link": {
      if (links.some((l) => l.id === e.id)) return;
      const { op: _op, at: _at, by: _by, agent: _agent, person: _person, ...rest } = e;
      links.push({ ...rest, ...authorOf(e) });
      told({ op: "link", id: e.id, subject: e.subject, label: e.label, file: e.file });
      return;
    }
    case "link-edit": {
      const k = links.findIndex((l) => l.id === e.id);
      if (k < 0) return;
      const was = links[k];
      const l: Link = { ...was, edited: authorOf(e) };
      if (e.subject !== undefined) l.subject = e.subject;
      if (e.label !== undefined) l.label = e.label;
      for (const part of ["page", "region", "quote"] as const) {
        if (e[part] === null) delete l[part];
        else if (e[part] !== undefined) (l as unknown as Record<string, unknown>)[part] = e[part];
      }
      links[k] = l;
      const changed = LINK_PARTS.filter((p) => (p === "place" ? (["page", "region", "quote"] as const).some((x) => !samePart(was[x], l[x])) : was[p] !== l[p]));
      if (changed.length)
        told({
          op: "link-edit",
          id: l.id,
          subject: l.subject,
          label: l.label,
          file: l.file,
          changed,
          ...(was.subject !== l.subject ? { wasSubject: was.subject } : {}),
          ...(was.label !== l.label ? { wasLabel: was.label } : {}),
          ...(e.auto ? { auto: e.auto } : {}),
        });
      return;
    }
    case "unlink": {
      const k = links.findIndex((l) => l.id === e.id);
      if (k < 0) return;
      const [l] = links.splice(k, 1);
      told({ op: "unlink", id: l.id, subject: l.subject, label: l.label, file: l.file });
      return;
    }
  }
}

/** Whether recording `r` would change nothing: a file already in the library, archived or restored
 *  as it is, its title the same; a link removed that is not there. */
export function libraryNoChange(d: LibraryData, r: LibraryOp): boolean {
  const f = d.files && Object.hasOwn(d.files, (r as { sha?: string }).sha ?? "") ? d.files[(r as { sha: string }).sha] : null;
  switch (r.op) {
    case "file":
      return !!f;
    case "file-edit":
      return !f || f.title === r.title;
    case "file-archive":
      return !f || !!f.archived;
    case "file-restore":
      return !f || !f.archived;
    case "link":
      return !!d.links?.some((l) => l.id === r.id);
    case "link-edit": {
      const l = d.links?.find((x) => x.id === r.id);
      if (!l) return true;
      return (
        (r.subject === undefined || r.subject === l.subject) &&
        (r.label === undefined || r.label === l.label) &&
        (["page", "region", "quote"] as const).every((k) => r[k] === undefined || samePart(r[k], l[k]))
      );
    }
    case "unlink":
      return !d.links?.some((l) => l.id === r.id);
  }
}

/** Someone invited by a personal link goes by `name` now: what their id added and linked shows
 *  under it (shared/review.ts, `named`). */
export function renamePerson(d: LibraryData, id: string, name: string): void {
  const fix = (a: Author | undefined) => {
    if (a?.person === id) a.by = name;
  };
  for (const f of Object.values(d.files ?? {})) [f, f.edited, f.archived].forEach(fix);
  for (const l of d.links ?? []) [l, l.edited].forEach(fix);
  for (const h of d.libraryHistory ?? []) fix(h);
}

/** The library's records, links and history as JSON carried them (a page's review, a snapshot):
 *  objects of their own, keyed without a prototype. */
export function libraryFromJson(raw: { files?: unknown; links?: unknown; libraryHistory?: unknown }): LibraryData {
  const out: LibraryData = {};
  if (raw.files && typeof raw.files === "object" && !Array.isArray(raw.files)) {
    out.files = noProto<FileRecord>();
    for (const [sha, f] of Object.entries(raw.files)) if (validSha(sha) && f && typeof f === "object") out.files[sha] = { ...(f as FileRecord) };
  }
  if (Array.isArray(raw.links)) out.links = raw.links.filter((l): l is Link => !!l && typeof l === "object" && validLinkId((l as Link).id)).map((l) => ({ ...l }));
  if (Array.isArray(raw.libraryHistory)) out.libraryHistory = raw.libraryHistory.flatMap((h) => stepFromJson(h) ?? []);
  return out;
}

/** A step of the library's history as JSON carried it, checked field by field and made again of
 *  those fields alone; null where it is not one. The timeline draws what it holds, so nothing in it
 *  is taken on trust. */
function stepFromJson(raw: unknown): LibraryStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // who and when, as a line of a log says it (shared/review.ts, `readEvent` and `validPersonId`)
  if (!str(o.at, 40) || !str(o.by, 120)) return null;
  if (o.agent !== undefined && o.agent !== true) return null;
  if (o.person !== undefined && !(typeof o.person === "string" && /^[0-9a-f]{10}$/.test(o.person))) return null;
  const who: Author = { by: o.by as string, at: o.at as string, ...(o.agent ? { agent: true as const } : {}), ...(o.person ? { person: o.person as string } : {}) };
  switch (o.op) {
    case "file":
    case "file-archive":
    case "file-restore":
    case "file-edit": {
      if (!validSha(o.sha) || !str(o.title, LIMITS.title)) return null;
      const f = { sha: o.sha, title: o.title as string };
      if (o.op !== "file-edit") return { op: o.op, ...f, ...who };
      return str(o.wasTitle, LIMITS.title) ? { op: "file-edit", ...f, wasTitle: o.wasTitle as string, ...who } : null;
    }
    case "link":
    case "unlink":
    case "link-edit": {
      if (!validLinkId(o.id) || !parseSubject(o.subject) || !str(o.label, LIMITS.label) || !validSha(o.file)) return null;
      const l = { id: o.id, subject: o.subject as string, label: o.label as string, file: o.file };
      if (o.op !== "link-edit") return { op: o.op, ...l, ...who };
      const changed = Array.isArray(o.changed) ? LINK_PARTS.filter((p) => (o.changed as unknown[]).includes(p)) : [];
      if (!changed.length) return null;
      // what it was before, for each of those that changed and only those
      if (changed.includes("subject") ? !parseSubject(o.wasSubject) : o.wasSubject !== undefined) return null;
      if (changed.includes("label") ? !str(o.wasLabel, LIMITS.label) : o.wasLabel !== undefined) return null;
      if (!optStr(o.auto, 200)) return null;
      return {
        op: "link-edit",
        ...l,
        changed,
        ...(o.wasSubject !== undefined ? { wasSubject: o.wasSubject as string } : {}),
        ...(o.wasLabel !== undefined ? { wasLabel: o.wasLabel as string } : {}),
        ...(o.auto !== undefined ? { auto: o.auto as string } : {}),
        ...who,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading it

/** A file's name without the extension of a type the library takes: what its title is where the
 *  file says none of its own (server/library.ts). */
export const nameStem = (name: string): string => name.replace(/\.(pdf|png|jpe?g|webp|gif)$/i, "");

/** The name a file was added under, as it came and without its extension, where its record keeps one
 *  (an upload's, or the name an address served it under). */
export function addedNames(f: FileRecord): string[] {
  return f.name ? [...new Set([f.name, nameStem(f.name)])] : [];
}

/** Every name file `sha` went by before its title now, as the review records it: the name it was
 *  added under (addedNames), the title it was added with and each title an edit took from it (the
 *  history's) — each once, its title now left out. What the text of a note made for it once was,
 *  that follows its title (AttachmentSpec decision 12). */
export function formerNames(d: LibraryData, sha: string): string[] {
  const f = fileOf(d, sha);
  if (!f) return [];
  const out = new Set(addedNames(f));
  for (const h of d.libraryHistory ?? []) {
    if (h.op === "file" && h.sha === sha) out.add(h.title);
    else if (h.op === "file-edit" && h.sha === sha) out.add(h.wasTitle);
  }
  out.delete(f.title);
  return [...out];
}

export function filesOf(d: LibraryData): FileRecord[] {
  return Object.values(d.files ?? {});
}

export function fileOf(d: LibraryData, sha: string): FileRecord | null {
  return d.files && Object.hasOwn(d.files, sha) ? d.files[sha] : null;
}

/** The links of a subject, in the order they were made (decision 4). */
export function linksOf(d: LibraryData, subject: string): Link[] {
  return (d.links ?? []).filter((l) => l.subject === subject);
}

/** The links into a file, in the order they were made. */
export function linksInto(d: LibraryData, sha: string): Link[] {
  return (d.links ?? []).filter((l) => l.file === sha);
}

export function linkOf(d: LibraryData, id: string): Link | null {
  return (d.links ?? []).find((l) => l.id === id) ?? null;
}

/** What the reference window opens beside a declaration's source (decision 8): its own links, else
 *  those of the innermost cluster around it that has any under the board's clustering (`whose`
 *  says which), else none. */
export function pairedLinks(d: LibraryData, name: string, module: string, mode: ClusterMode): { links: Link[]; whose: string } | null {
  const own = linksOf(d, declSubject(name));
  if (own.length) return { links: own, whose: declSubject(name) };
  for (const s of clusterChain(name, module, mode)) {
    const ls = linksOf(d, s);
    if (ls.length) return { links: ls, whose: s };
  }
  return null;
}

/** Why a link is not made on a past build's board: a past build is not reviewed (ViewSpec decision
 *  26), and a link is part of the review (decision 6). */
export const PAST_LINK = "This board shows a past build: links are made on the latest build, as the review is.";

/** What the reference window offers for a place the reader picked (decision 5): to link the subject
 *  being linked (a panel's Link to a paper…), else the one selected on the board; or why not — the
 *  board refuses links (`cannot`: a past build, a snapshot of the page), or the file is archived;
 *  or nothing to link to yet. */
export function linkOffer(o: { cannot: string | null; archived: boolean; linking: string | null; board: string | null }): { subject: string; here: boolean } | { refused: string } | { none: true } {
  if (o.cannot) return { refused: o.cannot };
  if (o.archived) return { refused: "This file is archived: restore it from the Library to link to it." };
  if (o.linking) return { subject: o.linking, here: true };
  if (o.board) return { subject: o.board, here: false };
  return { none: true };
}

/** Text with its runs of white space made one space, and where each character of it came from in
 *  the text it was made of: what a quote is found by, whatever the line breaks of its page. */
export function squeeze(text: string): { s: string; from: number[] } {
  let s = "";
  const from: number[] = [];
  let space = true;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (/\s/.test(c)) {
      if (!space) {
        s += " ";
        from.push(k);
      }
      space = true;
    } else {
      s += c;
      from.push(k);
      space = false;
    }
  }
  if (s.endsWith(" ")) {
    s = s.slice(0, -1);
    from.pop();
  }
  return { s, from };
}

/** How much text around a quote is kept with it. */
export const QUOTE_CONTEXT = 48;

/** A quote of `text` from `start` to `end` (offsets into it), with a little of the text around it. */
export function quoteAt(text: string, start: number, end: number, context = QUOTE_CONTEXT): Quote | null {
  const q = squeeze(text.slice(start, end)).s.slice(0, LIMITS.quote);
  if (!q) return null;
  const before = squeeze(text.slice(Math.max(0, start - context * 3), start)).s.slice(-context);
  const after = squeeze(text.slice(end, end + context * 3)).s.slice(0, context);
  return { text: q, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/** Where a quote is in a page's text: the offsets of the best match into `text` — the one whose
 *  surroundings agree most with what was kept around it — or null when it is not there. Spaces are
 *  read loosely, and so is case where no exact match is. */
export function findQuote(text: string, q: Quote): { start: number; end: number } | null {
  const page = squeeze(text);
  const want = squeeze(q.text).s;
  if (!want) return null;
  const tries = [page.s, page.s.toLowerCase()];
  for (const [k, hay] of tries.entries()) {
    const needle = k ? want.toLowerCase() : want;
    let best: { at: number; score: number } | null = null;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      const before = q.before ? squeeze(q.before).s : "";
      const after = q.after ? squeeze(q.after).s : "";
      const score = common(hay.slice(Math.max(0, at - before.length - 1), at).trimEnd(), before, true) + common(hay.slice(at + needle.length).trimStart(), after, false);
      if (!best || score > best.score) best = { at, score };
    }
    if (best) {
      const end = best.at + needle.length - 1;
      return { start: page.from[best.at], end: page.from[end] + 1 };
    }
  }
  return null;
}

/** How many characters two texts share at their ends (`fromEnd`) or starts. */
function common(a: string, b: string, fromEnd: boolean): number {
  let n = 0;
  while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
  return n;
}

/** A link's label by default (decision 4): the page and the quote's first words; for an image,
 *  what of it. */
export function defaultLabel(place: LinkPlace, type: FileType): string {
  const words = place.quote ? place.quote.text.split(" ").slice(0, 6).join(" ") : "";
  const quoted = words ? `“${words.length > 60 ? words.slice(0, 59) + "…" : words}${words.length < place.quote!.text.length ? "…" : ""}”` : "";
  if (type !== "pdf") return place.region ? "A region of the image" : "The image";
  const page = place.page ? `p. ${place.page}` : "";
  return [page, quoted].filter(Boolean).join(" ") || "The paper";
}

// ---------------------------------------------------------------- a page's words

/** A word of a PDF's page as the server reads it (`pdftotext -bbox-layout`, server/poppler.ts): its
 *  text and its box, in the page's fractions. The reference window reads a page's text so too
 *  (the owner's decision of 2026-10-11): never from pdf.js, whose text extraction fails in Safari. */
export type Word = [text: string, x0: number, y0: number, x1: number, y1: number];

/** A page's text as its words make it: a line's words joined by spaces, lines by line breaks
 *  (`lines[k]` is where line k starts among the words); and where each word starts in it. */
export function wordsText(words: readonly Word[], lines: readonly number[]): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  const lineStart = new Set(lines);
  words.forEach((w, k) => {
    if (k > 0) text += lineStart.has(k) ? "\n" : " ";
    starts.push(text.length);
    text += w[0];
  });
  return { text, starts };
}

/** The words inside a box drawn on a page — those whose middle is in it — as a quote: their text in
 *  reading order, with a little of the page's text around them; null where the box holds none. What
 *  a box's label and quote are by default (the owner's decision of 2026-10-11). */
export function quoteInRegion(words: readonly Word[], lines: readonly number[], r: Region): Quote | null {
  const inside: number[] = [];
  words.forEach((w, k) => {
    const x = (w[1] + w[3]) / 2, y = (w[2] + w[4]) / 2;
    if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) inside.push(k);
  });
  if (!inside.length) return null;
  const { text, starts } = wordsText(words, lines);
  const first = inside[0], last = inside[inside.length - 1];
  const q = quoteAt(text, starts[first], starts[last] + words[last][0].length);
  if (!q) return null;
  // a box across two columns holds words the text runs between: the quote is its own words alone,
  // kept with the text around them
  const own = inside.length === last - first + 1 ? q.text : inside.map((k) => words[k][0]).join(" ");
  // a glyph a PDF's font maps to no character comes as a control character (a formula's symbols):
  // it is no text to quote, and a note made of the quote could not hold it
  const clean = (s: string | undefined) => (s ? squeeze(s.replace(CONTROL, " ")).s : "");
  const out = clean(own).slice(0, LIMITS.quote);
  if (!out) return null;
  const before = clean(q.before).slice(-QUOTE_CONTEXT), after = clean(q.after).slice(0, QUOTE_CONTEXT);
  return { text: out, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

/** Control characters, which a word read from a PDF may carry for a glyph its font maps to nothing. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Boxes of words merged line by line: one box for the words of each line, in their order, as a
 *  search's match and a quote are lit. Two boxes are on one line where they overlap by half the
 *  height of the lower one, and the second does not start left of the first. */
export function lineRects(boxes: readonly Region[]): Region[] {
  const out: Region[] = [];
  for (const b of boxes) {
    const last = out[out.length - 1];
    const overlap = last ? Math.min(last[3], b[3]) - Math.max(last[1], b[1]) : 0;
    if (last && overlap >= 0.5 * Math.min(last[3] - last[1], b[3] - b[1]) && b[0] >= last[0]) {
      out[out.length - 1] = [last[0], Math.min(last[1], b[1]), Math.max(last[2], b[2]), Math.max(last[3], b[3])];
    } else out.push([...b] as Region);
  }
  return out;
}

/** Where a quote is on a page, as the boxes of the words it spans, line by line; null where the
 *  page's words do not hold it. */
export function quoteRects(words: readonly Word[], lines: readonly number[], q: Quote): Region[] | null {
  const { text, starts } = wordsText(words, lines);
  const at = findQuote(text, q);
  if (!at) return null;
  const boxes: Region[] = [];
  words.forEach((w, k) => {
    if (starts[k] < at.end && starts[k] + w[0].length > at.start) boxes.push([w[1], w[2], w[3], w[4]]);
  });
  return boxes.length ? lineRects(boxes) : null;
}

/** Where a link is lit on its page (the owner's decision of 2026-10-11): by its region where it has
 *  one; else by its quote's words, where the page's words are known (`words`: null where they cannot
 *  be read, undefined while they have not come) and hold it; else nowhere. `rects` the boxes to
 *  light, `box` the box around them. Nothing about the words stops a region from being lit. */
export function placeOnPage(place: LinkPlace, words: { words: Word[]; lines: number[] } | null | undefined): { rects: Region[]; box: Region | null } {
  if (place.region) return { rects: [place.region], box: place.region };
  let rects: Region[] | null = null;
  try {
    rects = words && place.quote ? quoteRects(words.words, words.lines, place.quote) : null;
  } catch {
    // words of a shape this page does not expect: the quote is not lit, and nothing else changes
  }
  if (!rects?.length) return { rects: [], box: null };
  return { rects, box: [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))] };
}

/** A region as the API and the page write it, each part to four decimals. */
export function roundRegion(r: Region): Region {
  return r.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 1e4) / 1e4) as Region;
}

/** A size in words, in binary units as the limits are set: 1.2 MB, 340 KB, 2 GB. */
export function sizeWords(n: number): string {
  const G = 1024 ** 3, M = 1024 ** 2;
  if (n >= G) return `${+(n / G).toFixed(1)} GB`;
  return n >= M ? `${(n / M).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}
