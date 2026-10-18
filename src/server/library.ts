// The library on the server (AttachmentSpec decisions 1–6, 20): the bytes of its files, kept in the
// site's folder by their SHA-256 (`<site>/files/<sha256>`), and what people and agents do with them, which
// the review's logs record (shared/library.ts). Its record and the links into it name it by its hash. A server that reads a link to a file it does not have says so, and takes
// only bytes of that hash to fill the gap.
//
// Every operation is here once, for both doors (AgentSpec, "One way in per operation, two doors"):
// the page's routes (server/libraryroute.ts) and the agents' endpoints (server/agentlibrary.ts) call
// the same methods with who asks. Whoever can give an opinion — a person with a name, an agent at
// level advise — adds files and makes links; an agent edits, archives and removes what others made
// at level full only (decision 20). A file is never deleted from the library, only archived
// (HistorySpec decision 1); its bytes are purged by the owner alone, from the command line
// (`visualproof purge-file`).
//
// A link to a cluster follows the cluster when a build moves all its declarations to one other
// cluster — a folder or a namespace renamed (decision 6): the server finds it as it finds renames,
// and records it as a `link-edit` in its own log, beside the moves it found (`carryClusterLinks`).

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ClusterMode } from "../shared/graph.ts";
import { clusterKeys } from "../shared/layout.ts";
import { DEFAULT_LIBRARY_LIMIT, defaultLabel, fileOf, LIMITS, linkOf, MAX_FILE, MIME, nameStem, parseSubject, roundRegion, sizeWords, sniffType, subjectText, validQuote, validRegion, validSha } from "../shared/library.ts";
import type { FileRecord, FileType, LibraryData, LibraryOp, Link, LinkPlace, Quote, Region, Subject } from "../shared/library.ts";
import type { ReviewOp } from "../shared/review.ts";
import type { Graph } from "../shared/viewgraph.ts";
import { arxivId, arxivTitle, fetchUrl } from "./fetchurl.ts";
import type { FetchOptions } from "./fetchurl.ts";
import type { SnapGraph } from "./history.ts";
import { clampWidth, PdfReader, searchWords, writeAtomic } from "./poppler.ts";
import type { PageWords, PdfInfo } from "./poppler.ts";
import type { AppendResult, ReviewStore, Writer } from "./review.ts";
import { SERVER_WRITER } from "./review.ts";

/** The bytes of the library's files, in `<site>/files/<sha256>`, and what poppler read of them,
 *  in `<cache>/files-cache/<sha256>/`. */
export class Library {
  readonly dir: string;
  readonly pdf: PdfReader;
  /** the most the library holds, all its files' bytes together (a server option) */
  limit: number;
  /** how a fetch by URL is made: the defaults, unless a test fetches from a server of its own */
  fetchOptions: FetchOptions = {};
  /** the bytes held, worked out once and kept up to date */
  private usedBytes: number | null = null;

  /** the files in the site directory, what was read of them in the project's cache (server/dirs.ts) */
  constructor(siteDir: string, cacheDir: string, limit = DEFAULT_LIBRARY_LIMIT) {
    this.dir = join(siteDir, "files");
    this.pdf = new PdfReader(join(cacheDir, "files-cache"));
    this.limit = limit;
  }

  path(sha: string): string {
    return join(this.dir, sha);
  }

  has(sha: string): boolean {
    return validSha(sha) && existsSync(this.path(sha));
  }

  /** How many bytes the library's files take. */
  used(): number {
    if (this.usedBytes === null) {
      let n = 0;
      try {
        for (const f of readdirSync(this.dir)) if (validSha(f)) n += statSync(join(this.dir, f)).size;
      } catch {
        // no folder yet: nothing held
      }
      this.usedBytes = n;
    }
    return this.usedBytes;
  }

  /** Keep `bytes`: stored once by their hash, whoever adds them again. Refused where they are no
   *  PDF or image, larger than a file may be, not of the hash expected (`expect`: bytes added for a
   *  record whose file this server lacks), or beyond the library's limit. */
  put(bytes: Buffer, expect?: string): { sha: string; type: FileType; fresh: boolean } | { status: number; error: string; hint: string } {
    if (!bytes.length) return { status: 400, error: "The file is empty.", hint: "Send the file's bytes." };
    if (bytes.length > MAX_FILE) return { status: 413, error: `The file is ${sizeWords(bytes.length)}: a file of the library is at most ${sizeWords(MAX_FILE)}.`, hint: "Add a smaller file." };
    const type = sniffType(bytes);
    if (!type) return { status: 415, error: "This is no PDF, PNG, JPEG, WebP or GIF: the library takes those alone (never SVG, which can carry scripts).", hint: "The type is read from the file's bytes, not its name." };
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (expect && sha !== expect)
      return { status: 409, error: `This is another file (${sha.slice(0, 12)}…), not the one the link names (${expect.slice(0, 12)}…).`, hint: "Only a file with exactly that content is taken in its place: the same version of the paper, byte for byte." };
    if (this.has(sha)) return { sha, type, fresh: false };
    if (this.used() + bytes.length > this.limit)
      return { status: 507, error: `The library holds ${sizeWords(this.used())} of its ${sizeWords(this.limit)}: this file does not fit.`, hint: "The owner can raise the limit (--library-limit) or purge files added by mistake (visualproof purge-file)." };
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(this.path(sha), bytes);
    this.usedBytes = this.used() + bytes.length;
    return { sha, type, fresh: true };
  }

  read(sha: string): Buffer | null {
    return this.has(sha) ? readFileSync(this.path(sha)) : null;
  }

  /** Purge a file's bytes for good, and what was read of them: the owner's, from the command line
   *  (decision 3). Its record and its links stay, saying the server lacks the file. */
  purge(sha: string): boolean {
    if (!this.has(sha)) return false;
    rmSync(this.path(sha), { force: true });
    this.pdf.forget(sha);
    this.usedBytes = null;
    return true;
  }
}

/** Who asks, as the library records it: the review's writer, and what their level lets an agent
 *  do — `full`: edit, archive and remove what others made too. */
export interface Asker extends Writer {
  full: boolean;
}

/** An answer: an HTTP status and a JSON body; or bytes of a type (a page, a clip, a file). */
export interface LibAnswer {
  status: number;
  body: unknown;
  bytes?: { type: string; data: Buffer; immutable?: boolean };
}

const fail = (status: number, error: string, hint: string, more: Record<string, unknown> = {}): LibAnswer => ({ status, body: { error, hint, ...more } });
const ok = (body: unknown): LibAnswer => ({ status: 200, body });

/** The graph on show, as the library checks a link's subject against it. */
export interface LibraryGraph {
  g: Graph;
}

/** What the library's operations read and write. */
export interface LibraryWorld {
  review: Pick<ReviewStore, "data" | "append">;
  project: { toolchain: string };
  library: Library;
  /** the graph on show, or null until it has been read */
  graph(): LibraryGraph | null;
  /** a file came into the library, its first record written by `who`: a note of the project carries
   *  it (server/views.ts, fileAdded), unless the page writes that note itself (`note` false: a file
   *  dropped or pasted on the canvas, its note at that spot) */
  fileAdded?(f: FileRecord, who: Asker, note: boolean): void;
}

/** A file's record as the API shows it: with whether this server has its bytes. */
export function shownFile(f: FileRecord, have: boolean): Record<string, unknown> {
  return { ...f, have, mime: MIME[f.type] };
}

/** The cluster keys of a graph, by clustering: what `ns(P)` and `file(P)` may name. */
const keysOf = new WeakMap<Graph, Record<ClusterMode, Set<string>>>();
function clusterKeysOf(g: Graph): Record<ClusterMode, Set<string>> {
  let k = keysOf.get(g);
  if (!k) keysOf.set(g, (k = { namespace: clusterKeys("namespace", g.nodes), module: clusterKeys("module", g.nodes) }));
  return k;
}

/** What `body.region`, `body.quote` and `body.page` say of a place, checked: the place, or why not. */
function readPlace(b: Record<string, unknown>, type: FileType, pages: number | undefined): LinkPlace | string {
  const place: LinkPlace = {};
  if (b.page !== undefined && b.page !== null) {
    if (type !== "pdf") return "An image has no pages: leave page out.";
    if (!Number.isInteger(b.page) || (b.page as number) < 1 || (pages && (b.page as number) > pages)) return `page is a page of the file, 1 to ${pages ?? "its last"}.`;
    place.page = b.page as number;
  }
  if (b.region !== undefined && b.region !== null) {
    if (!validRegion(b.region)) return "region is [left, top, right, bottom], fractions of the page from its top left (0 to 1), left < right and top < bottom.";
    place.region = roundRegion(b.region as Region);
  }
  if (b.quote !== undefined && b.quote !== null) {
    const q = typeof b.quote === "string" ? { text: b.quote } : b.quote;
    if (!validQuote(q)) return `quote is the text quoted (at most ${LIMITS.quote} characters), or {text, before?, after?} with a little of the text around it.`;
    place.quote = q as Quote;
  }
  if (type === "pdf" && place.page === undefined) return "A link into a PDF is at a page: give page (from 1), with a region or a quote on it if you like.";
  return place;
}

/** The library's operations, for the page and for agents alike. */
export class LibraryApi {
  private w: LibraryWorld;

  constructor(w: LibraryWorld) {
    this.w = w;
  }

  private get data(): LibraryData {
    return this.w.review.data;
  }

  /** Append an event under who asks, as everything the review records is. */
  private record(op: LibraryOp, who: Writer): AppendResult {
    const r = { ...op, by: who.name, ...(who.agent ? { agent: true } : {}), ...(who.person ? { person: who.person } : {}) } as ReviewOp;
    return this.w.review.append({ name: who.name, agent: who.agent, person: who.person ?? null, server: who.server }, r, this.w.project.toolchain);
  }

  private written(r: AppendResult): LibAnswer | null {
    if ("status" in r) return fail(r.status, r.error, r.status === 409 ? "Mend that line of the log by hand (or ask its writer to); VisualProof never rewrites a log." : "");
    return null;
  }

  /** What changed in the review, for the page to apply at once (as POST /api/review answers it). */
  private static changeOf(r: AppendResult): Record<string, unknown> {
    return "change" in r && r.change ? { change: r.change } : {};
  }

  // ---------------------------------------------------------------- the library

  /** The library: its files, the archived apart, each with whether this server has its bytes, and
   *  how full it is. */
  list(): LibAnswer {
    const all = Object.values(this.data.files ?? {});
    const shown = (f: FileRecord) => ({ ...shownFile(f, this.w.library.has(f.sha)), links: (this.data.links ?? []).filter((l) => l.file === f.sha).length });
    return ok({
      files: all.filter((f) => !f.archived).map(shown),
      archived: all.filter((f) => f.archived).map(shown),
      used: this.w.library.used(),
      limit: this.w.library.limit,
      maxFile: MAX_FILE,
    });
  }

  file(sha: unknown): LibAnswer {
    if (!validSha(sha)) return fail(400, "sha is a file's SHA-256, 64 hex digits.", "GET the library to list them.");
    const f = fileOf(this.data, sha);
    if (!f) return fail(404, `The library has no file ${sha.slice(0, 12)}….`, "GET the library to list them.");
    return ok({ file: shownFile(f, this.w.library.has(sha)), links: (this.data.links ?? []).filter((l) => l.file === sha) });
  }

  /** Add a file's bytes: kept once by their hash, and recorded where the library has no record of
   *  them yet — its title the one `meta.title` finds, else the PDF's own, else the file's name.
   *  `meta.title` is asked then alone, since it may fetch a page (an arXiv paper's abstract), and a
   *  title it cannot find leaves the rest. Bytes the library has already are its file as it is
   *  (restored, where it was archived); bytes for a record whose file this server lacks (`expect`)
   *  fill that gap and record nothing. A file recorded anew is carried by a note of the project, on
   *  the ring (`fileAdded`), unless `meta.note` is false: the page writes that note itself. */
  async add(bytes: Buffer, meta: { name?: string | null; url?: string | null; expect?: string | null; title?: () => Promise<string | null>; note?: boolean }, who: Asker): Promise<LibAnswer> {
    if (meta.expect !== undefined && meta.expect !== null && !validSha(meta.expect)) return fail(400, "sha is a file's SHA-256, 64 hex digits.", "Name the file the link names.");
    // bytes for a record are taken only where there is the record: nothing is kept for nothing
    if (meta.expect && !fileOf(this.data, meta.expect)) return fail(404, "The library has no record of that file.", "Add it as a new file, without sha.");
    const put = this.w.library.put(bytes, meta.expect ?? undefined);
    if ("status" in put) return fail(put.status, put.error, put.hint);
    const had = fileOf(this.data, put.sha);
    if (had) {
      let restored = {};
      if (had.archived) {
        // the same bytes again restore the file, as Restore does: what others made, an agent
        // restores at level full only (decision 20), whichever way it asks
        if (this.mayChange(had, who, "This file")) return fail(403, `${had.title} is in the library already, archived by ${had.archived.by}; it was added by ${had.by}: an agent restores what others made at level full only.`, "Ask a person to restore it from the library's archive, or for a token at level full.");
        const r = this.record({ op: "file-restore", sha: put.sha }, who);
        const no = this.written(r);
        if (no) return no;
        restored = LibraryApi.changeOf(r);
      }
      const now = fileOf(this.data, put.sha)!;
      return ok({ ok: true, file: shownFile(now, true), existed: true, restored: !!had.archived, ...(put.fresh ? { filled: true } : {}), ...restored });
    }
    let info: PdfInfo | null = null;
    if (put.type === "pdf") {
      try {
        info = await this.w.library.pdf.info(put.sha, this.w.library.path(put.sha));
      } catch {
        // a PDF poppler cannot read: kept as it is; pdf.js may still draw it
      }
    }
    const found = meta.title ? await meta.title().catch(() => null) : null;
    const name = meta.name ? clip(meta.name.replace(/[\u0000-\u001f\u007f]/g, "").trim(), LIMITS.name) : null;
    const title = clip(found ?? info?.title ?? (name ? nameStem(name) : null) ?? (meta.url ? new URL(meta.url).hostname : "Untitled"), LIMITS.title) || "Untitled";
    const op: LibraryOp = {
      op: "file",
      sha: put.sha,
      title,
      type: put.type,
      size: bytes.length,
      ...(info && info.pages > 0 ? { pages: Math.min(info.pages, LIMITS.pages) } : {}),
      ...(name ? { name } : {}),
      ...(meta.url ? { url: clip(meta.url, LIMITS.url) } : {}),
    };
    const r = this.record(op, who);
    const no = this.written(r);
    if (no) return no;
    const f = fileOf(this.data, put.sha)!;
    this.w.fileAdded?.(f, who, meta.note !== false);
    return ok({ ok: true, file: shownFile(f, true), existed: false, ...LibraryApi.changeOf(r) });
  }

  /** Add the file at an address: fetched once (an arXiv abstract's address gives its PDF), kept as
   *  any file is. A paper on arXiv, by its abstract's address or its PDF's, is titled as its abstract
   *  page says, which its PDF seldom does (arXiv serves it as "1910.09336v1.pdf"). */
  async addUrl(url: unknown, who: Asker): Promise<LibAnswer> {
    if (typeof url !== "string" || !url.trim() || url.length > LIMITS.url) return fail(400, "url is the file's address, http or https.", "e.g. {\"url\": \"https://arxiv.org/abs/2401.01234\"}.");
    const opts = this.w.library.fetchOptions;
    const got = await fetchUrl(url, opts);
    if (!got.ok) return fail(got.status, got.error, "Give the address of the PDF or the image itself; it is fetched once, by the server.");
    // a paper is arXiv's where the address given is, or where a redirect led
    const id = arxivId(url) ?? arxivId(got.url);
    return this.add(got.bytes, { name: got.name, url: got.url, ...(id ? { title: () => arxivTitle(id, opts) } : {}) }, who);
  }

  /** May `who` change what `a` made? A person may; an agent its own at advise, anyone's at full. */
  private mayChange(a: { by: string; agent?: true }, who: Asker, what: string): LibAnswer | null {
    if (!who.agent || who.full) return null;
    if (a.agent && a.by === who.name) return null;
    return fail(403, `${what} was made by ${a.by}: an agent changes what others made at level full only.`, "Ask the person who shared with you for a token at level full, or ask a person to do it.");
  }

  /** A file's title, edited. */
  editFile(sha: unknown, title: unknown, who: Asker): LibAnswer {
    const f = this.found(sha);
    if ("status" in f) return f;
    const t = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
    if (!t || t.length > LIMITS.title) return fail(400, `title is 1 to ${LIMITS.title} characters.`, "Send {sha, title}.");
    const no = this.mayChange(f, who, "This file");
    if (no) return no;
    const r = this.record({ op: "file-edit", sha: f.sha, title: t }, who);
    const bad = this.written(r);
    if (bad) return bad;
    return ok({ ok: true, changed: !!("change" in r && r.change), file: shownFile(fileOf(this.data, f.sha)!, this.w.library.has(f.sha)), ...LibraryApi.changeOf(r) });
  }

  /** Archive a file (`on`), hiding it from the library while its links say so, or restore it. */
  archive(sha: unknown, on: unknown, who: Asker): LibAnswer {
    const f = this.found(sha);
    if ("status" in f) return f;
    const no = this.mayChange(f, who, "This file");
    if (no) return no;
    const r = this.record({ op: on === false ? "file-restore" : "file-archive", sha: f.sha }, who);
    const bad = this.written(r);
    if (bad) return bad;
    return ok({ ok: true, changed: !!("change" in r && r.change), file: shownFile(fileOf(this.data, f.sha)!, this.w.library.has(f.sha)), ...LibraryApi.changeOf(r) });
  }

  private found(sha: unknown): FileRecord | LibAnswer {
    if (!validSha(sha)) return fail(400, "sha is a file's SHA-256, 64 hex digits.", "GET the library to list them.");
    return fileOf(this.data, sha) ?? fail(404, `The library has no file ${sha.slice(0, 12)}….`, "GET the library to list them.");
  }

  // ---------------------------------------------------------------- links

  /** Whether a subject is one the graph on show has: a declaration (a name Lean generated from a
   *  command stands for the command's unit), or a cluster by namespace or by file. The subject as it
   *  is to be recorded, or the answer that refuses it. */
  subject(raw: unknown): string | LibAnswer {
    const s = parseSubject(raw);
    if (!s) return fail(400, "subject is decl(<full name>), ns(<namespace>) or file(<module prefix>).", "e.g. decl(fermatLastTheoremFour), or ns(Fermat42) for a cluster.");
    const G = this.w.graph();
    if (!G) return fail(503, "The graph has not been read yet.", "The server is reading the project; try again in a few seconds.");
    const { g } = G;
    if (s.kind === "decl") {
      const i = g.byName.get(s.name) ?? g.foldedInto.get(s.name);
      if (i === undefined) return fail(404, `There is no declaration ${s.name} in the graph.`, "Link a declaration of the graph, by its full name.");
      return subjectText({ kind: "decl", name: g.nodes[i].name });
    }
    const mode: ClusterMode = s.kind === "file" ? "module" : "namespace";
    if (!clusterKeysOf(g)[mode].has(s.name)) return fail(404, `There is no cluster ${s.name} by ${s.kind === "file" ? "file" : "namespace"}.`, `A cluster is a namespace (ns) or a module prefix (file) of the graph, as its key names it.`);
    return subjectText(s as Subject);
  }

  /** The links of a subject, or into a file; every link without either. */
  links(q: { subject?: string | null; file?: string | null }): LibAnswer {
    let ls = this.data.links ?? [];
    if (q.subject) {
      const s = parseSubject(q.subject);
      if (!s) return fail(400, "subject is decl(<full name>), ns(<namespace>) or file(<module prefix>).", "");
      ls = ls.filter((l) => l.subject === subjectText(s));
    }
    if (q.file) ls = ls.filter((l) => l.file === q.file);
    return ok({ links: ls.map((l) => this.shownLink(l)) });
  }

  private shownLink(l: Link): Record<string, unknown> {
    const f = fileOf(this.data, l.file);
    return { ...l, fileTitle: f?.title ?? null, ...(f?.archived ? { archived: true } : {}), have: this.w.library.has(l.file) };
  }

  /** Make a link: a subject of the graph, a file of the library (not archived), a place in it and a
   *  label — by default the page and the quote's first words. */
  link(b: Record<string, unknown>, who: Asker): LibAnswer {
    const subject = this.subject(b.subject);
    if (typeof subject !== "string") return subject;
    const f = this.found(b.file ?? b.sha);
    if ("status" in f) return f;
    if (f.archived) return fail(409, `${f.title} is archived.`, "Restore it from the library's archive first.");
    const place = readPlace(b, f.type, f.pages);
    if (typeof place === "string") return fail(400, place, "");
    const label = b.label === undefined || b.label === null || (typeof b.label === "string" && !b.label.trim()) ? defaultLabel(place, f.type) : typeof b.label === "string" ? b.label.replace(/\s+/g, " ").trim() : "";
    if (!label || label.length > LIMITS.label) return fail(400, `label is 1 to ${LIMITS.label} characters.`, "e.g. \"Theorem 3, p. 12\"; left out, the page and the quote's first words.");
    const id = `l${randomBytes(6).toString("hex")}`;
    const r = this.record({ op: "link", id, subject, file: f.sha, label, ...place }, who);
    const bad = this.written(r);
    if (bad) return bad;
    return ok({ ok: true, link: this.shownLink(linkOf(this.data, id)!), ...LibraryApi.changeOf(r) });
  }

  /** Edit a link: its label, its place, its subject. */
  editLink(b: Record<string, unknown>, who: Asker): LibAnswer {
    const l = validId(b.id) ? linkOf(this.data, b.id as string) : null;
    if (!l) return fail(404, `There is no link ${String(b.id)}.`, "List the links of a subject or a file to find one.");
    const no = this.mayChange(l, who, "This link");
    if (no) return no;
    const f = fileOf(this.data, l.file);
    const op: LibraryOp & { op: "link-edit" } = { op: "link-edit", id: l.id };
    if (b.subject !== undefined) {
      const s = this.subject(b.subject);
      if (typeof s !== "string") return s;
      op.subject = s;
    }
    if (b.label !== undefined) {
      const t = typeof b.label === "string" ? b.label.replace(/\s+/g, " ").trim() : "";
      if (!t || t.length > LIMITS.label) return fail(400, `label is 1 to ${LIMITS.label} characters.`, "");
      op.label = t;
    }
    if (b.page !== undefined || b.region !== undefined || b.quote !== undefined) {
      // the place as it will be, checked whole
      const next = { page: l.page, region: l.region, quote: l.quote, ...Object.fromEntries(["page", "region", "quote"].filter((k) => b[k] !== undefined).map((k) => [k, b[k]])) };
      const place = readPlace(next as Record<string, unknown>, f?.type ?? "pdf", f?.pages);
      if (typeof place === "string") return fail(400, place, "");
      for (const k of ["page", "region", "quote"] as const) if (b[k] !== undefined) (op as Record<string, unknown>)[k] = place[k] ?? null;
    }
    if (Object.keys(op).length === 2) return fail(400, "Say what changes: label, page, region, quote or subject.", "");
    const r = this.record(op, who);
    const bad = this.written(r);
    if (bad) return bad;
    return ok({ ok: true, changed: !!("change" in r && r.change), link: this.shownLink(linkOf(this.data, l.id)!), ...LibraryApi.changeOf(r) });
  }

  /** Remove a link. */
  unlink(id: unknown, who: Asker): LibAnswer {
    const l = validId(id) ? linkOf(this.data, id as string) : null;
    if (!l) return fail(404, `There is no link ${String(id)}.`, "List the links of a subject or a file to find one.");
    const no = this.mayChange(l, who, "This link");
    if (no) return no;
    const r = this.record({ op: "unlink", id: l.id }, who);
    const bad = this.written(r);
    if (bad) return bad;
    return ok({ ok: true, removed: l.id, ...LibraryApi.changeOf(r) });
  }

  // ---------------------------------------------------------------- reading a file

  /** A file's bytes, for the page's window and an agent that wants them. */
  bytes(sha: unknown): LibAnswer {
    const f = this.found(sha);
    if ("status" in f) return f;
    const data = this.w.library.read(f.sha);
    if (!data) return this.missing(f);
    return { status: 200, body: null, bytes: { type: MIME[f.type], data, immutable: true } };
  }

  private missing(f: FileRecord): LibAnswer {
    return fail(404, `This server does not have the file of ${f.title}.`, "Add it to the library: only a file of exactly that content (its SHA-256) is taken in its place.", { missing: true, sha: f.sha });
  }

  /** A PDF of the library, and its page `page`, checked: the record, the path and the info, or the
   *  answer that refuses. */
  private async pdfPage(sha: unknown, page: unknown): Promise<{ f: FileRecord; path: string; info: PdfInfo; page: number } | LibAnswer> {
    const f = this.found(sha);
    if ("status" in f) return f;
    if (f.type !== "pdf") return fail(400, `${f.title} is an image, not a PDF: it has no pages or text.`, "Fetch its bytes instead.");
    if (!this.w.library.has(f.sha)) return this.missing(f);
    const path = this.w.library.path(f.sha);
    let info: PdfInfo;
    try {
      info = await this.w.library.pdf.info(f.sha, path);
    } catch (e) {
      return fail(422, `${f.title} cannot be read: ${e instanceof Error ? e.message : String(e)}`, "");
    }
    const p = page === undefined || page === null || page === "" ? 1 : Number(page);
    if (!Number.isInteger(p) || p < 1 || p > info.pages) return fail(400, `page is 1 to ${info.pages}.`, "");
    return { f, path, info, page: p };
  }

  /** A page's text, with the place of every word (in the page's fractions) and where each line
   *  starts among them. */
  async text(sha: unknown, page: unknown): Promise<LibAnswer> {
    const p = await this.pdfPage(sha, page);
    if ("status" in p) return p;
    let all: PageWords[];
    try {
      all = await this.w.library.pdf.allWords(p.f.sha, p.path);
    } catch (e) {
      return fail(422, `The text of ${p.f.title} cannot be read: ${e instanceof Error ? e.message : String(e)}`, "");
    }
    const w = all[p.page - 1] ?? { page: p.page, width: p.info.sizes[p.page - 1]?.w ?? 0, height: p.info.sizes[p.page - 1]?.h ?? 0, words: [], lines: [] };
    const text = w.lines.map((start, k) => w.words.slice(start, w.lines[k + 1] ?? w.words.length).map((x) => x[0]).join(" ")).join("\n");
    return ok({ file: p.f.sha, title: p.f.title, page: p.page, pages: p.info.pages, size: { width: w.width, height: w.height }, text, words: w.words, lines: w.lines, note: "Each word is [text, left, top, right, bottom], in fractions of the page from its top left: a region of a link is written so." });
  }

  /** Search a PDF's text: each match's page, the boxes of its words, and the text around it. */
  async search(sha: unknown, q: unknown, most: unknown): Promise<LibAnswer> {
    const p = await this.pdfPage(sha, 1);
    if ("status" in p) return p;
    if (typeof q !== "string" || q.trim().length < 2 || q.length > 500) return fail(400, "q is the text to find, 2 to 500 characters.", "");
    const n = Math.min(500, Math.max(1, Number(most) || 50));
    try {
      const all = await this.w.library.pdf.allWords(p.f.sha, p.path);
      const r = searchWords(all, q, n);
      return ok({ file: p.f.sha, title: p.f.title, q, matches: r.matches, more: r.more });
    } catch (e) {
      return fail(422, `The text of ${p.f.title} cannot be read: ${e instanceof Error ? e.message : String(e)}`, "");
    }
  }

  /** A page drawn as a PNG about `width` pixels wide. */
  async page(sha: unknown, page: unknown, width: unknown): Promise<LibAnswer> {
    const p = await this.pdfPage(sha, page);
    if ("status" in p) return p;
    try {
      const data = await this.w.library.pdf.page(p.f.sha, p.path, p.page, clampWidth(Number(width) || 1200));
      return { status: 200, body: null, bytes: { type: "image/png", data, immutable: true } };
    } catch (e) {
      return fail(422, `Page ${p.page} of ${p.f.title} cannot be drawn: ${e instanceof Error ? e.message : String(e)}`, "");
    }
  }

  /** A clip: a region of a page drawn as a PNG about `width` pixels wide (what a note carries,
   *  AttachmentSpec decision 12). */
  async clip(sha: unknown, page: unknown, region: unknown, width: unknown): Promise<LibAnswer> {
    const p = await this.pdfPage(sha, page);
    if ("status" in p) return p;
    const r = typeof region === "string" ? region.split(",").map(Number) : region;
    if (!validRegion(r)) return fail(400, "region is left,top,right,bottom: fractions of the page from its top left (0 to 1).", "e.g. region=0.1,0.2,0.9,0.4.");
    try {
      const data = await this.w.library.pdf.clip(p.f.sha, p.path, p.page, p.info.sizes[p.page - 1] ?? { w: 612, h: 792 }, roundRegion(r), clampWidth(Number(width) || 800));
      return { status: 200, body: null, bytes: { type: "image/png", data, immutable: true } };
    } catch (e) {
      return fail(422, `That region of page ${p.page} cannot be drawn: ${e instanceof Error ? e.message : String(e)}`, "");
    }
  }
}

const validId = (s: unknown) => typeof s === "string" && /^l[0-9a-f]{12}$/.test(s);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One LibraryApi per world: the page's routes and the agents' endpoints share it. */
const apis = new WeakMap<object, LibraryApi>();
export function libraryApiOf(key: object, make: () => LibraryWorld): LibraryApi {
  let a = apis.get(key);
  if (!a) apis.set(key, (a = new LibraryApi(make())));
  return a;
}

// ---------------------------------------------------------------- clusters a build renamed

/** The members of a cluster in a snapshot's graph, by namespace (`ns`: a name under it, or the
 *  structure it is) or by file (`file`: a module under it). */
function membersOf(g: SnapGraph, kind: "ns" | "file", key: string): { name: string; module: string }[] {
  const out: { name: string; module: string }[] = [];
  for (let i = 0; i < g.projectCount; i++) {
    const n = g.nodes[i];
    const at = kind === "ns" ? n.name : n.module;
    if (at === key || at.startsWith(key + ".")) out.push(n);
  }
  return out;
}

/** Where a build moved a cluster as a whole (decision 6): the one cluster that holds every
 *  declaration of it the build still has, each under its new name (or the same) with the same part
 *  below the cluster — a folder or a namespace renamed. Null where the cluster is still there, was
 *  not there before, or its declarations went to more than one place, or nowhere. Declarations gone
 *  without a rename have no say. */
export function clusterMovedTo(before: SnapGraph, after: SnapGraph, renamed: ReadonlyMap<string, string>, kind: "ns" | "file", key: string): string | null {
  if (membersOf(after, kind, key).length) return null;
  const was = membersOf(before, kind, key);
  if (!was.length) return null;
  const now = new Map<string, string>();
  for (let i = 0; i < after.projectCount; i++) now.set(after.nodes[i].name, after.nodes[i].module);
  let to: string | null = null;
  for (const m of was) {
    const name = renamed.get(m.name) ?? (now.has(m.name) ? m.name : null);
    if (name === null) continue;
    const rest = (kind === "ns" ? m.name : m.module).slice(key.length);
    const at = kind === "ns" ? name : now.get(name)!;
    if (!at.endsWith(rest) || at.length <= rest.length) return null;
    const q = at.slice(0, at.length - rest.length);
    if (to !== null && q !== to) return null;
    to = q;
  }
  return to === key ? null : to;
}

/** Carry the links on clusters a build renamed as a whole to their new names: a `link-edit` each in
 *  the server's own log, under VisualProof's name, saying why (`auto`) and at which snapshot. A
 *  cluster gone otherwise leaves its links where they are, for the lost-and-found. How many were
 *  carried. */
export function carryClusterLinks(review: Pick<ReviewStore, "data" | "append">, toolchain: string, before: SnapGraph, after: SnapGraph, renamed: ReadonlyMap<string, string>, snap: number, say: (l: string) => void = () => {}): number {
  const links = review.data.links ?? [];
  const moved = new Map<string, string | null>();
  let n = 0;
  for (const l of [...links]) {
    const s = parseSubject(l.subject);
    if (!s || s.kind === "decl") continue;
    if (!moved.has(l.subject)) moved.set(l.subject, clusterMovedTo(before, after, renamed, s.kind, s.name));
    const to = moved.get(l.subject);
    if (!to) continue;
    const subject = subjectText({ kind: s.kind, name: to });
    const r = review.append(SERVER_WRITER, { op: "link-edit", id: l.id, subject, auto: `${s.kind === "ns" ? "namespace" : "folder"} renamed`, snap, by: SERVER_WRITER.name }, toolchain);
    if ("status" in r) say(`history: the link ${l.id} on ${l.subject} could not be carried to ${subject}: ${r.error}`);
    else if (r.change) n++;
  }
  return n;
}
