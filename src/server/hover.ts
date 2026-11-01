// Hover information for the source window, as VS Code shows it: Lean's own language server,
// asked "what is at this position".
//
// The server is started from the project's `lean-server/` folder of the cache, not from the project: Lean's file
// worker runs `lake setup-file` — which builds out-of-date imports — only when it finds a
// lakefile in the directory it was started from. Started elsewhere with the project's LEAN_PATH,
// it reads the `.olean` files the owner's builds left and writes nothing (SPEC.md: "No .lake
// conflict"). It elaborates the file it is asked about once, then answers hovers in milliseconds.
// At most `--lean-files` files are kept open (two by default); the server stops after ten idle
// minutes. A file outside the
// project — a package's, Lean's core's, whose source the window shows too (the owner's decision of
// 2026-10-20; server/outside.ts) — is opened by the same Lean in the same way: elaborated against
// the `.olean` files of what it imports, nothing built.
//
// A name in a hover card opens a card of its own: what Lean says about a declaration by name is
// asked in a scratch file of VisualProof's (in the project's cache, never in the project) that
// imports the module on show and `#check`s the name. The agents' API asks there too, and also has
// Lean `#print` a name: the elaborated definition, which Lean says as a message about the command
// (a diagnostic), not as a hover.
//
// Lean runs each open file in a worker process of its own, which can die (a worker on a large
// project holds gigabytes: 4.1 GB for Sphere-Packing-Lean's main theorem's module; and the kernel's OOM killer picks the
// largest). Lean then says the file's progress
// is a fatal error, and starts the worker again only when the document changes: until then every
// question about it would wait forever. So a crashed document is closed and opened again here, as a
// new version, and its questions asked anew; one that keeps crashing is given up on for a while,
// with why; a question Lean does not answer in REQUEST_MS is answered that it did not; and what
// Lean is doing is part of /api/status (`state`).
//
// The InfoView (ReviewSpec, "The InfoView"; the owner's decisions of 2026-11-01) asks the same Lean,
// of the same open file, the goals at a place: before the tactic there and after it, and the
// expected type of the term there (`goals`). Lean is asked at positions alone, which the server
// reads from the file's text (shared/goals.ts, tacticSpan). It asks through Lean's RPC first — one
// session per open file, kept alive while the file is open — for goals whose subterms Lean can say
// more of (`subterm`: their type and doc, asked by the number the answer gives each); where the RPC
// cannot be had, Lean's plain answers. Lean's answers keep what they refer to alive in the session:
// the server holds the last ANSWERS of each file's, and releases what it lets go. The widgets Lean has
// at a place are counted, never fetched nor drawn (SECURITY.md).

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { childEnv, DETACH, end, grouped } from "./children.ts";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterLine, holdsBy, tacticSpan } from "../shared/goals.ts";
import type { Goal, GoalsAnswer, SubtermInfo } from "../shared/goals.ts";
import { afterTheLine, readInfo, readInteractiveGoals, readInteractiveTermGoal, readPlainGoals, readPlainTermGoal, readWidgets, Reading, refsIn } from "./goals.ts";
import type { RpcRef } from "./goals.ts";
import type { Project } from "./project.ts";

/** A Lean name, dotted, and nothing else: no spaces, no line breaks, no commands. */
export function isDeclName(s: string): boolean {
  const part = "(?:[\\p{L}_][\\p{L}\\p{N}_'!?\u2080-\u2089\u2090-\u209c]*|«[^»\\n\\r]*»|[0-9]+)";
  return s.length <= 2000 && new RegExp(`^${part}(?:\\.${part})*$`, "u").test(s);
}

export interface HoverAnswer {
  /** Lean's hover text (markdown), or null when there is nothing at that position */
  contents?: string | null;
  /** asked about a name by `describe`: why Lean refused it (an unknown name), with no contents */
  refused?: string;
  /** the position is not elaborated yet: how far Lean has got */
  pending?: { line: number; of: number };
  /** why there is no answer */
  error?: string;
}

/** What Lean says about a command, as its messages: `#print`'s output is one. */
export interface Message {
  severity: "error" | "warning" | "information" | "hint";
  text: string;
}

export interface PrintAnswer {
  /** what Lean said about the `#print`, in order: its output, or why it could not */
  messages?: Message[];
  /** the scratch file is not checked yet: Lean is still loading the module's imports */
  pending?: { line: number; of: number };
  /** why there is no answer */
  error?: string;
}

/** A diagnostic as Lean publishes it, what is read of it. */
interface Diagnostic {
  range: { start: { line: number } };
  severity?: number;
  message: string;
}

const SEVERITY: Message["severity"][] = ["error", "error", "warning", "information", "hint"];

/** the files kept open at most, where the server is not told otherwise (`--lean-files`), and the
 *  most it may be told */
export const KEEP_OPEN = 2;
export const MAX_LEAN_FILES = 16;
const IDLE_MS = 10 * 60 * 1000;
/** the longest a question waits for Lean's answer before it is answered that there was none */
const REQUEST_MS = 5 * 60 * 1000;
/** a document still being elaborated that Lean has said nothing about for this long has stopped,
 *  whatever Lean says: it is opened again, as a crashed one (loading a large project's imports can
 *  take minutes on a machine short of memory, in which Lean says nothing; on an idle one
 *  Sphere-Packing-Lean's main theorem's module answers in 2 s) */
const STALL_MS = 10 * 60 * 1000;
/** crashes in a row (the document never elaborated to its end between them) after which a document
 *  is not opened again until GIVE_UP_MS have passed */
const MAX_CRASHES = 2;
const GIVE_UP_MS = 5 * 60 * 1000;
/** LeanFileProgressKind.fatalError, as Lean sends it: the worker for the document crashed */
const FATAL = 2;
/** questions waiting for their turn in the scratch file, at most */
const MAX_QUEUED = 16;
/** how often an RPC session is told it is still in use: Lean ends one it hears nothing of for 30 s */
const KEEP_ALIVE_MS = 10_000;
/** the goals answers kept per open file, with what Lean holds for their subterms */
const ANSWERS = 32;
/** Lean's codes: the RPC session is gone (its worker restarted, or it expired); no such method */
const RPC_RECONNECT = -32900;
const NO_METHOD = -32601;

/** A file Lean is asked about: one of the project, by its path in it; or one outside it (a package's,
 *  Lean's core's: server/outside.ts), by what it is called (`mathlib: Mathlib/Logic/Basic.lean`, what
 *  the status says) and where it is, resolved. Either is elaborated the same way, by the same Lean in
 *  the cache's `lean-server/` folder, which has no lakefile: nothing is built. */
export type HoverFile = string | { name: string; path: string };

/** A document Lean has open: a file of the project, or the scratch file. */
interface Open {
  uri: string;
  version: number;
  /** what Lean was given, to give it again when its worker crashed */
  text: string;
  /** when Lean last said how far it is with this document */
  progressAt: number;
}

interface Doc extends Open {
  hash: string;
  lines: number;
  used: number;
  /** the first line still being elaborated, or -1 when done */
  processing: number;
  /** the RPC session the InfoView asks this document's goals in, and its connection while it is made */
  rpc: string | null;
  connecting: Promise<string | null> | null;
  /** the goals answers kept, by version and place, oldest first, and those being asked */
  answers: Map<string, GoalsEntry>;
  computing: Map<string, Promise<GoalsEntry>>;
}

/** A goals answer as the server keeps it: what the page is given; the references its subterms are
 *  numbered by, and every reference Lean gave in it, released when it is let go; the session they
 *  are of. */
interface GoalsEntry {
  answer: GoalsAnswer;
  refs: RpcRef[];
  held: RpcRef[];
  session: string | null;
}

interface Scratch extends Open {
  done: boolean;
}

/** Lean's answer to a question: its result, or its error with Lean's code. */
type Answered = { result?: unknown; error?: { message: string; code?: number } };

/** A JSON-RPC message from Lean, as much of it as is read. */
interface LspMessage {
  id?: number;
  method?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
  result?: unknown;
  error?: { message: string; code?: number };
}

/** What Lean's language server is doing, for /api/status. */
export interface LeanState {
  /** off (not started, or stopped after ten idle minutes), starting, running, or failed (why) */
  state: "off" | "starting" | "running" | "failed";
  failure: string | null;
  /** documents opened again after their worker crashed or stalled, since the server started */
  restarts: number;
  files: { file: string; version: number; elaborated: { line: number; of: number } | "done" }[];
  scratch: { module: string; command: string; done: boolean } | null;
  /** documents not opened again for now: their worker kept crashing */
  givenUp: { file: string; why: string; until: string }[];
  /** questions waiting for an answer, and questions waiting for their turn in the scratch file */
  waiting: number;
  queued: number;
}

export class LeanHover {
  private project: Project;
  private dir: string;
  private proc: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private buf = Buffer.alloc(0);
  private nextId = 0;
  private waiting = new Map<number, (msg: Answered) => void>();
  /** crashes in a row per document (a uri), reset once it elaborates to its end */
  private crashes = new Map<string, number>();
  /** documents not opened again for now, with why and since when */
  private givenUp = new Map<string, { why: string; at: number }>();
  /** documents opened again after a crash or a stall, since the start */
  private restarts = 0;
  /** frames of Lean's output that could not be read, and when that was last said */
  private garbled = { count: 0, said: 0 };
  private docs = new Map<string, Doc>();
  /** hover requests in flight, by uri:line:character, so a retry joins the one already asked */
  private asked = new Map<string, Promise<Answered>>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private env: { lean: string; leanPath: string } | null = null;
  /** why Lean cannot be asked, once found out */
  failure: string | null = null;
  /** the scratch file names are described in, and the describing in progress: one at a time,
   *  since each changes the file */
  private scratch: Scratch | null = null;
  private describing: Promise<unknown> = Promise.resolve();
  private queued = 0;
  /** the scratch file's last version: one count across Lean's restarts and the file's reopenings,
   *  so that nothing Lean said about an earlier one is taken for the present one */
  private scratchVersion = 0;
  /** past Lean's handshake */
  private ready = false;
  /** what Lean last published about each document it has open: the version it is about, and the
   *  messages (a `#print` says what it prints so) */
  private diagnostics = new Map<string, { version: number | null; items: Diagnostic[] }>();
  /** the files kept open at most (`--lean-files`) */
  readonly keepOpen: number;
  /** what tells the RPC sessions they are still in use, while there is one */
  private alive: ReturnType<typeof setInterval> | null = null;

  constructor(project: Project, cacheDir: string, keepOpen = KEEP_OPEN) {
    this.project = project;
    this.dir = join(cacheDir, "lean-server");
    this.keepOpen = Math.max(1, Math.floor(keepOpen));
  }

  /** The project's `lean` and LEAN_PATH, found once. */
  private resolveEnv(): { lean: string; leanPath: string } {
    if (this.env) return this.env;
    const root = this.project.root;
    const which = spawnSync("elan", ["which", "lean"], { cwd: root, encoding: "utf8", timeout: 60000, env: childEnv() });
    const lean = which.status === 0 && which.stdout.trim() ? which.stdout.trim() : "lean";
    const env = spawnSync("lake", ["env", "printenv", "LEAN_PATH"], { cwd: root, encoding: "utf8", timeout: 120000, env: childEnv() });
    if (env.status !== 0) throw new Error(`lake env failed: ${(env.stderr || env.stdout || "").trim().slice(0, 300)}`);
    this.env = { lean, leanPath: env.stdout.trim() };
    return this.env;
  }

  /** Lean, started and past the handshake. Every caller waits for the same start: a request sent
   *  before `initialized` makes Lean's server exit. */
  private start(): Promise<void> {
    this.starting ??= (async () => {
      const { lean, leanPath } = this.resolveEnv();
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      // a group of its own, which stopping ends with its workers (server/children.ts)
      const p = grouped(spawn(lean, ["--server"], { cwd: this.dir, env: childEnv({ LEAN_PATH: leanPath }), stdio: ["pipe", "pipe", "pipe"], detached: DETACH }));
      this.proc = p;
      // what Lean writes is read here, in a callback no request waits on: nothing it writes may
      // throw out of it, or the server stops (read() skips what it cannot read)
      p.stdout!.on("data", (d: Buffer) => {
        if (this.proc !== p) return;
        try {
          this.read(d);
        } catch (e) {
          this.skip(`Lean's output: ${e instanceof Error ? e.message : String(e)}`);
          this.buf = Buffer.alloc(0);
        }
      });
      // what Lean last said on stderr: the reason, when it stops
      let said = "";
      p.stderr!.on("data", (d: Buffer) => (said = (said + d.toString()).slice(-2000)));
      // a Lean that stopped closes its pipes: writing then fails, and that must not stop the server
      p.stdin!.on("error", () => {});
      p.on("error", (e) => (this.failure = e.message));
      p.on("exit", (code, signal) => {
        // stopped by stop(), this is not the running Lean any more and everything was reset there
        if (this.proc !== p) return;
        this.failure = `Lean stopped (${signal ?? `exit ${code}`})${said.trim() ? `: ${said.trim().slice(-300)}` : ""}`;
        this.reset();
      });
      const init = await this.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
      if (init.error) {
        const why = this.failure ?? init.error.message;
        this.reset();
        end(p);
        throw new Error(why);
      }
      this.notify("initialized", {});
      this.failure = null;
      this.ready = true;
    })().catch((e) => {
      this.starting = null;
      this.failure = e instanceof Error ? e.message : String(e);
      throw e;
    });
    return this.starting;
  }

  /** Lean's output, framed as LSP frames it (`Content-Length`, then the JSON): each frame read in
   *  turn. A frame that cannot be read is skipped and said, never thrown. */
  private read(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const h = this.buf.indexOf("\r\n\r\n");
      if (h < 0) {
        // a header that never ends is not Lean's protocol: dropped rather than kept growing
        if (this.buf.length > 1 << 16) {
          this.skip("a header with no end");
          this.buf = Buffer.alloc(0);
        }
        return;
      }
      const length = /Content-Length: (\d+)/i.exec(this.buf.subarray(0, h).toString());
      if (!length) {
        this.skip("a header without Content-Length");
        this.buf = this.buf.subarray(h + 4);
        continue;
      }
      const len = Number(length[1]);
      if (this.buf.length < h + 4 + len) return;
      const text = this.buf.subarray(h + 4, h + 4 + len).toString();
      this.buf = this.buf.subarray(h + 4 + len);
      let msg: LspMessage;
      try {
        msg = JSON.parse(text);
      } catch {
        this.skip("a frame that is not JSON");
        continue;
      }
      try {
        this.take(msg);
      } catch (e) {
        this.skip(`a frame not as expected (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  /** One message from Lean: an answer, how far a document is, what Lean says about one. */
  private take(msg: LspMessage): void {
    if (!msg || typeof msg !== "object") return;
    // a request of Lean's own (`workspace/semanticTokens/refresh`, `workspace/inlayHint/refresh`, as
    // a file is elaborated) carries an id of Lean's counting, which may be one of ours: it is no
    // answer. It is answered, as an editor does, with nothing
    if (msg.id !== undefined && msg.method !== undefined) return this.send({ id: msg.id, result: null });
    if (msg.id !== undefined && this.waiting.has(msg.id)) {
      this.waiting.get(msg.id)!(msg);
      this.waiting.delete(msg.id);
    } else if (msg.method === "$/lean/fileProgress") {
      const uri: unknown = msg.params?.textDocument?.uri;
      const ranges = (Array.isArray(msg.params?.processing) ? msg.params.processing : []) as { range?: { start?: { line?: number } }; kind?: number }[];
      if (typeof uri !== "string") return;
      // the worker for the document crashed: Lean waits for a change before it starts another (one
      // said of a version before the present one is about a worker already replaced)
      if (ranges.some((r) => r.kind === FATAL)) {
        const now = this.docOf(uri)?.version ?? (this.scratch?.uri === uri ? this.scratch.version : null);
        const of = msg.params.textDocument.version;
        return now !== null && (typeof of !== "number" || of >= now) ? this.crashed(uri) : undefined;
      }
      const doc = this.docOf(uri);
      if (doc) {
        doc.processing = ranges.length ? Math.min(...ranges.map((r) => r.range?.start?.line ?? 0)) : -1;
        doc.progressAt = Date.now();
        if (!ranges.length) this.crashes.delete(uri);
      }
      const sc = this.scratch;
      if (sc && sc.uri === uri && msg.params.textDocument.version === sc.version) {
        sc.done = !ranges.length;
        sc.progressAt = Date.now();
        if (sc.done) this.crashes.delete(uri);
      }
    } else if (msg.method === "textDocument/publishDiagnostics") {
      // each publication holds every message about the document so far: the last one is kept
      if (typeof msg.params?.uri !== "string") return;
      this.diagnostics.set(msg.params.uri, { version: msg.params.version ?? null, items: Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [] });
    }
  }

  /** Something of Lean's output was not read: said, at most once a minute. */
  private skip(what: string): void {
    this.garbled.count++;
    if (Date.now() - this.garbled.said < 60_000) return;
    this.garbled.said = Date.now();
    console.error(`lean: skipped ${what} (${this.garbled.count} so far)`);
  }

  private docOf(uri: string): Doc | undefined {
    for (const d of this.docs.values()) if (d.uri === uri) return d;
    return undefined;
  }

  /** Lean's worker for document `uri` stopped (or stalled: `why`). Lean starts it again only when
   *  the document changes, and until then keeps every question about it waiting: the document is
   *  closed and opened again, as a new version, so that it is elaborated afresh and the questions
   *  asked anew. One that keeps crashing — it never got to its end in between — is closed and left
   *  for GIVE_UP_MS: what is asked about it meanwhile is answered with why. */
  private crashed(uri: string, why = "crashed"): void {
    const doc = this.docOf(uri);
    const sc = this.scratch?.uri === uri ? this.scratch : null;
    const open: Open | null = doc ?? sc;
    if (!open) return;
    this.restarts++;
    const n = (this.crashes.get(uri) ?? 0) + 1;
    this.crashes.set(uri, n);
    this.diagnostics.delete(uri);
    this.asked.clear();
    this.notify("textDocument/didClose", { textDocument: { uri } });
    const name = doc ? [...this.docs.entries()].find(([, d]) => d === doc)![0] : "the scratch file";
    console.error(`lean: the worker for ${name} ${why} (${n} in a row)`);
    if (n > MAX_CRASHES) {
      this.givenUp.set(uri, { why: `Lean's worker for ${name} ${why} ${n} times in a row (out of memory, or a fault in Lean); it is started again in ${Math.round(GIVE_UP_MS / 60_000)} minutes.`, at: Date.now() });
      this.crashes.delete(uri);
      if (doc) for (const [k, d] of this.docs) if (d === doc) this.docs.delete(k);
      if (sc) this.scratch = null;
      return;
    }
    open.version = sc ? ++this.scratchVersion : open.version + 1;
    open.progressAt = Date.now();
    if (doc) {
      doc.processing = 0;
      // a new worker: the RPC session and what it held went with the old one
      doc.rpc = null;
      doc.connecting = null;
      doc.answers.clear();
      doc.computing.clear();
    }
    if (sc) sc.done = false;
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: open.version, text: open.text } });
  }

  /** Why document `uri` is not opened now (its worker kept crashing), or null. */
  private refused(uri: string): string | null {
    const g = this.givenUp.get(uri);
    if (!g) return null;
    if (Date.now() - g.at < GIVE_UP_MS) return g.why;
    this.givenUp.delete(uri);
    return null;
  }

  /** A document Lean is elaborating and has said nothing about for STALL_MS has stopped: it is
   *  opened again as a crashed one. */
  private unstall(open: Open, busy: boolean): void {
    if (busy && Date.now() - open.progressAt > STALL_MS) this.crashed(open.uri, `said nothing for ${Math.round(STALL_MS / 60_000)} minutes`);
  }

  /** What Lean's language server is doing (/api/status). */
  state(): LeanState {
    const now = Date.now();
    const fileOf = (uri: string) => [...this.docs.entries()].find(([, d]) => d.uri === uri)?.[0] ?? decodeURIComponent(uri.replace(/^.*\//, ""));
    return {
      state: this.proc ? (this.ready ? "running" : "starting") : this.failure ? "failed" : "off",
      failure: this.failure,
      restarts: this.restarts,
      files: [...this.docs.entries()].map(([file, d]) => ({ file, version: d.version, elaborated: d.processing < 0 ? ("done" as const) : { line: d.processing, of: d.lines } })),
      scratch: this.scratch ? { module: this.scratch.text.split("\n")[0].replace(/^import /, ""), command: this.scratch.text.split("\n")[1] ?? "", done: this.scratch.done } : null,
      givenUp: [...this.givenUp.entries()].filter(([, g]) => now - g.at < GIVE_UP_MS).map(([uri, g]) => ({ file: fileOf(uri), why: g.why, until: new Date(g.at + GIVE_UP_MS).toISOString() })),
      waiting: this.waiting.size,
      queued: this.queued,
    };
  }

  private send(m: object): void {
    const s = JSON.stringify({ jsonrpc: "2.0", ...m });
    const p = this.proc;
    if (p && p.stdin!.writable) p.stdin!.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  /** A question to Lean, answered by Lean, or after `timeoutMs` that it did not answer: nothing
   *  waits for Lean forever. Asked of a Lean that is not running, it is answered so at once. */
  private request(method: string, params: unknown, timeoutMs = REQUEST_MS): Promise<Answered> {
    const id = ++this.nextId;
    return new Promise((ok) => {
      if (!this.proc?.stdin?.writable) return ok({ error: { message: "Lean is not running" } });
      const timer = setTimeout(() => {
        if (!this.waiting.delete(id)) return;
        ok({ error: { message: `Lean did not answer in ${Math.round(timeoutMs / 1000)} s` } });
      }, timeoutMs);
      timer.unref();
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        ok(msg);
      });
      this.send({ id, method, params });
    });
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref();
  }

  /** Have Lean elaborate a file (its present text), keeping at most `keepOpen` open. */
  async open(file: HoverFile, text: string, hash: string): Promise<Doc> {
    await this.start();
    this.touch();
    const rel = typeof file === "string" ? file : file.name;
    const uri = pathToFileURL(typeof file === "string" ? join(this.project.root, file) : file.path).href;
    let doc = this.docs.get(rel);
    if (doc) this.unstall(doc, doc.processing >= 0);
    const no = this.refused(uri);
    if (no) throw new Error(no);
    doc = this.docs.get(rel);
    if (doc && doc.hash !== hash) {
      // the file changed: Lean takes the new text and elaborates again from where it differs
      doc.version++;
      doc.hash = hash;
      doc.text = text;
      doc.lines = text.split("\n").length;
      doc.processing = 0;
      doc.progressAt = Date.now();
      this.asked.clear();
      this.notify("textDocument/didChange", { textDocument: { uri, version: doc.version }, contentChanges: [{ text }] });
    } else if (!doc) {
      doc = { uri, version: 1, text, progressAt: Date.now(), hash, lines: text.split("\n").length, used: 0, processing: 0, rpc: null, connecting: null, answers: new Map(), computing: new Map() };
      this.docs.set(rel, doc);
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text } });
      // too many open: the one least recently asked about is closed
      if (this.docs.size > this.keepOpen) {
        const [old] = [...this.docs.entries()].filter(([k]) => k !== rel).sort((a, b) => a[1].used - b[1].used)[0];
        this.notify("textDocument/didClose", { textDocument: { uri: this.docs.get(old)!.uri } });
        this.diagnostics.delete(this.docs.get(old)!.uri);
        this.docs.delete(old);
      }
    }
    doc.used = Date.now();
    return doc;
  }

  /** What is at (line, character) of the file — UTF-16 columns, as the page counts them. Waits
   *  up to `waitMs` for Lean to elaborate that far, then says how far it is. */
  async hover(file: HoverFile, text: string, hash: string, line: number, character: number, waitMs: number): Promise<HoverAnswer> {
    let doc: Doc;
    try {
      doc = await this.open(file, text, hash);
    } catch (e) {
      return { error: this.failure ?? (e instanceof Error ? e.message : String(e)) };
    }
    const msg = await Promise.race([this.ask(doc, line, character), after(waitMs)]);
    if (!msg) return { pending: { line: doc.processing < 0 ? doc.lines : doc.processing, of: doc.lines } };
    if (msg.error) return { error: msg.error.message };
    const r = msg.result as { contents?: { value?: string } } | null;
    return { contents: r?.contents?.value ?? null };
  }

  /** What Lean says each position of a file names, asked all at once: the first word of the
   *  hover's code — a declaration's full name where the position refers to one, a variable's name
   *  where it is one — or null where Lean has nothing to say. This is how the source window links
   *  every name to what it means, dot notation and `open`s included, as go-to-definition would. */
  async names(file: HoverFile, text: string, hash: string, positions: [number, number][], waitMs: number): Promise<{ heads?: (string | null)[]; pending?: HoverAnswer["pending"]; error?: string }> {
    let doc: Doc;
    try {
      doc = await this.open(file, text, hash);
    } catch (e) {
      return { error: this.failure ?? (e instanceof Error ? e.message : String(e)) };
    }
    const all = Promise.all(positions.map(([line, character]) => this.ask(doc, line, character)));
    const msgs = await Promise.race([all, after(waitMs)]);
    if (!msgs) return { pending: { line: doc.processing < 0 ? doc.lines : doc.processing, of: doc.lines } };
    return {
      heads: msgs.map((m) => {
        const md = (m.result as { contents?: { value?: string } } | null)?.contents?.value;
        const first = md ? /^```[^\n]*\n(\S+)/.exec(md)?.[1] : undefined;
        // `Option.elim.{u_1, u_2} …`: the universes are not part of the name
        return first ? first.replace(/\.\{.*$/, "") : null;
      }),
    };
  }

  /** The goals at (line, character) of the file, for the InfoView (ReviewSpec, "The InfoView"):
   *  before the tactic there and after it, the expected type of the term there, how many widgets
   *  Lean has there. Waits up to `waitMs` for Lean to elaborate that far, then says how far it is;
   *  a place Lean has passed is answered at once. */
  async goals(file: HoverFile, text: string, hash: string, line: number, character: number, waitMs: number): Promise<GoalsAnswer> {
    let doc: Doc;
    try {
      doc = await this.open(file, text, hash);
    } catch (e) {
      return { error: this.failure ?? (e instanceof Error ? e.message : String(e)) };
    }
    const e = await Promise.race([this.goalsAt(doc, line, character), after(waitMs)]);
    if (!e) return { pending: { line: doc.processing < 0 ? doc.lines : doc.processing, of: doc.lines } };
    return e.answer;
  }

  /** What Lean says of subterm `k` of the goals answer at (line, character): its type, the term
   *  with its implicit arguments, its doc. The answer is asked again where it was let go, or its
   *  session ended; only Lean's own reference for the subterm reaches Lean. */
  async subterm(file: HoverFile, text: string, hash: string, line: number, character: number, k: number, waitMs: number): Promise<SubtermInfo> {
    let doc: Doc;
    try {
      doc = await this.open(file, text, hash);
    } catch (e) {
      return { error: this.failure ?? (e instanceof Error ? e.message : String(e)) };
    }
    const deadline = Date.now() + waitMs;
    for (let tries = 0; tries < 2; tries++) {
      const e = await Promise.race([this.goalsAt(doc, line, character), after(Math.max(0, deadline - Date.now()))]);
      if (!e) return { pending: { line: doc.processing < 0 ? doc.lines : doc.processing, of: doc.lines } };
      const ref = e.refs[k];
      if (!e.answer.interactive || !ref || e.session === null) return { error: "Lean has no such subterm there" };
      // the session the answer was had in has ended: asked again in a new one
      if (e.session !== doc.rpc) {
        this.forget(doc, line, character);
        continue;
      }
      const position = { line, character };
      const r = await Promise.race([this.request("$/lean/rpc/call", { textDocument: { uri: doc.uri }, position, sessionId: e.session, method: "Lean.Widget.InteractiveDiagnostics.infoToInteractive", params: ref }), after(Math.max(1000, deadline - Date.now()))]);
      if (!r) return { pending: { line: doc.processing < 0 ? doc.lines : doc.processing, of: doc.lines } };
      if (r.error?.code === RPC_RECONNECT) {
        if (doc.rpc === e.session) doc.rpc = null;
        this.forget(doc, line, character);
        continue;
      }
      if (r.error) return { error: r.error.message };
      // what the popup refers to is of no use once read
      this.release(doc, e.session, refsIn(r.result));
      return readInfo(r.result);
    }
    return { error: "Lean's RPC session ended" };
  }

  /** The goals answer at a place of a document, kept or asked; one being asked is joined. Kept, an
   *  answer comes at once; one that came after the page stopped waiting is kept too, so that what it
   *  holds in Lean is released in its turn. */
  private goalsAt(doc: Doc, line: number, character: number): Promise<GoalsEntry> {
    const key = `${doc.version}:${line}:${character}`;
    const kept = doc.answers.get(key);
    if (kept) {
      doc.answers.delete(key);
      doc.answers.set(key, kept);
      return Promise.resolve(kept);
    }
    let p = doc.computing.get(key);
    if (!p) {
      const asked = this.askGoals(doc, line, character).then((e) => {
        if (doc.computing.get(key) === asked) doc.computing.delete(key);
        // a failure is asked again next time; an answer of a worker since replaced is let go
        if (!e.answer.error && (e.session === null || e.session === doc.rpc)) this.keep(doc, key, e);
        else if (e.session !== null) this.release(doc, e.session, e.held);
        return e;
      });
      p = asked;
      doc.computing.set(key, p);
    }
    return p;
  }

  /** Keep an answer of a document's, the oldest let go past ANSWERS (what Lean holds for it
   *  released). */
  private keep(doc: Doc, key: string, e: GoalsEntry): void {
    doc.answers.set(key, e);
    while (doc.answers.size > ANSWERS) {
      const [old, gone] = doc.answers.entries().next().value!;
      doc.answers.delete(old);
      if (gone.session !== null) this.release(doc, gone.session, gone.held);
    }
  }

  /** Let go of the answers kept for a place, of any version. */
  private forget(doc: Doc, line: number, character: number): void {
    for (const [key, e] of doc.answers)
      if (key.endsWith(`:${line}:${character}`)) {
        doc.answers.delete(key);
        if (e.session !== null && e.session === doc.rpc) this.release(doc, e.session, e.held);
      }
  }

  /** Tell Lean what of a session's it may let go of. */
  private release(doc: Doc, session: string, refs: RpcRef[]): void {
    if (!refs.length || doc.rpc !== session || !this.docOf(doc.uri)) return;
    for (let i = 0; i < refs.length; i += 1000) this.notify("$/lean/rpc/release", { uri: doc.uri, sessionId: session, refs: refs.slice(i, i + 1000) });
  }

  /** The RPC session of a document, made once: null where Lean gives none. While there is one, every
   *  session is told every KEEP_ALIVE_MS that it is still in use. */
  private session(doc: Doc): Promise<string | null> {
    if (doc.rpc) return Promise.resolve(doc.rpc);
    if (!doc.connecting) {
      const version = doc.version;
      const c = this.request("$/lean/rpc/connect", { uri: doc.uri }, 60_000).then((m) => {
        if (doc.connecting === c) doc.connecting = null;
        const id = (m.result as { sessionId?: unknown } | null)?.sessionId;
        const sid = typeof id === "string" || typeof id === "number" ? String(id) : null;
        // a document opened again meanwhile has a new worker: this session was the old one's
        if (!sid || !this.docOf(doc.uri) || doc.version < version) return null;
        doc.rpc = sid;
        this.alive ??= setInterval(() => {
          for (const d of this.docs.values()) if (d.rpc) this.notify("$/lean/rpc/keepAlive", { uri: d.uri, sessionId: d.rpc });
        }, KEEP_ALIVE_MS);
        this.alive.unref?.();
        return sid;
      });
      doc.connecting = c;
    }
    return doc.connecting;
  }

  /** Ask Lean the goals at a place: through its RPC, tagged, where it can (a session gone is made
   *  again once); else its plain answers. Before the tactic at its first character, after it at its
   *  end — or, for a tactic that holds a block of its own, where the proof goes on —, the term's
   *  expected type and the widgets where the place is. */
  private async askGoals(doc: Doc, line: number, character: number): Promise<GoalsEntry> {
    const text = doc.text.split("\n")[line] ?? "";
    const span = tacticSpan(text, character);
    // a tactic that holds a block of its own ends inside it: the state after the whole line is
    // where the proof goes on, its next line's start (the owner's decision of 2026-11-01); Lean's
    // answer at the end where it does not go on there
    const next = span && holdsBy(text, span.from, span.to) ? afterLine(doc.text, line, span.from) : null;
    const end = { line, character: span ? span.to : character };
    const at: Places = {
      before: { line, character: span ? span.from : character },
      after: next ? { line: next.line, character: next.ch } : end,
      here: { line, character },
      ...(next ? { end } : {}),
    };
    const tactic = span ? { line, ...span } : null;
    for (let tries = 0; tries < 2; tries++) {
      const sid = await this.session(doc);
      if (!sid) break;
      const r = await this.interactive(doc, sid, at);
      if (r === "plain") break;
      if (r !== "reconnect") return { ...r, answer: { tactic, ...r.answer } };
      if (doc.rpc === sid) doc.rpc = null;
    }
    const q = (method: string, position: { line: number; character: number }) => this.request(method, { textDocument: { uri: doc.uri }, position });
    const [b, a, t, e] = await Promise.all([q("$/lean/plainGoal", at.before), q("$/lean/plainGoal", at.after), q("$/lean/plainTermGoal", at.here), at.end ? q("$/lean/plainGoal", at.end) : null]);
    if (b.error && a.error && t.error) return { answer: { error: b.error.message }, refs: [], held: [], session: null };
    const before = b.error ? null : readPlainGoals(b.result);
    const after = afterOf(at, before, a.error ? null : readPlainGoals(a.result), () => (e && !e.error ? readPlainGoals(e.result) : null));
    return { answer: { tactic, before, ...after, term: t.error ? null : readPlainTermGoal(t.result), interactive: false }, refs: [], held: [], session: null };
  }

  /** The goals at the three places through Lean's RPC, in session `sid`; "reconnect" where the
   *  session is gone, "plain" where Lean has no such methods. */
  private async interactive(doc: Doc, sid: string, at: Places): Promise<GoalsEntry | "reconnect" | "plain"> {
    const call = (method: string, params: unknown, position: { line: number; character: number }) =>
      this.request("$/lean/rpc/call", { textDocument: { uri: doc.uri }, position, sessionId: sid, method, params });
    const where = (position: { line: number; character: number }) => ({ textDocument: { uri: doc.uri }, position });
    const asked = await Promise.all([
      call("Lean.Widget.getInteractiveGoals", where(at.before), at.before),
      call("Lean.Widget.getInteractiveGoals", where(at.after), at.after),
      call("Lean.Widget.getInteractiveTermGoal", where(at.here), at.here),
      // counted, never fetched nor drawn: a widget's JavaScript is the project's code
      call("Lean.Widget.getWidgets", at.here, at.here),
      ...(at.end ? [call("Lean.Widget.getInteractiveGoals", where(at.end), at.end)] : []),
    ]);
    const held = asked.flatMap((m) => refsIn(m.result));
    const [b, a, t, w, e] = asked;
    if (asked.some((m) => m.error?.code === RPC_RECONNECT)) {
      this.release(doc, sid, held);
      return "reconnect";
    }
    if (b.error?.code === NO_METHOD || t.error?.code === NO_METHOD) {
      this.release(doc, sid, held);
      return "plain";
    }
    if (b.error && a.error && t.error) {
      this.release(doc, sid, held);
      return { answer: { error: b.error.message }, refs: [], held: [], session: null };
    }
    const reading = new Reading();
    const widgets = w.error ? 0 : readWidgets(w.result);
    const before = b.error ? null : readInteractiveGoals(b.result, reading);
    const answer: GoalsAnswer = {
      before,
      ...afterOf(at, before, a.error ? null : readInteractiveGoals(a.result, reading), () => (e && !e.error ? readInteractiveGoals(e.result, reading) : null)),
      term: t.error ? null : readInteractiveTermGoal(t.result, reading),
      ...(widgets ? { widgets } : {}),
      interactive: true,
    };
    return { answer, refs: reading.refs, held, session: sid };
  }

  /** What Lean says about the declaration `name` — its signature and doc, as its hover shows
   *  them — where `module` is imported. `name` must be a name and nothing else
   *  (`isDeclName`): it is written into Lean source. */
  describe(module: string, name: string, waitMs: number): Promise<HoverAnswer> {
    const deadline = Date.now() + waitMs;
    return this.queue(() => this.describeNow(module, name, deadline), { pending: { line: 0, of: 2 } });
  }

  /** What Lean's `#print` says about `name` where `module` is imported: the elaborated declaration,
   *  with its value — what a macro generated, the proposition a Prop-valued definition stands for.
   *  Without `proofs`, a proof is shown as `⋯` (a theorem's value is its proof). `name` must be a
   *  name and nothing else (`isDeclName`): it is written into Lean source. */
  print(module: string, name: string, proofs: boolean, waitMs: number): Promise<PrintAnswer> {
    const deadline = Date.now() + waitMs;
    return this.queue(() => this.printNow(module, name, proofs, deadline), { pending: { line: 0, of: 2 } });
  }

  /** One question in the scratch file at a time: each changes the file. Each waits from when it
   *  was asked, not from its turn; and no more than MAX_QUEUED wait at once: one more is answered
   *  `busy` at once (asked again, it is the pending answer: a 503 with Retry-After for an agent). */
  private queue<T>(ask: () => Promise<T>, busy: T): Promise<T> {
    if (this.queued >= MAX_QUEUED) return Promise.resolve(busy);
    this.queued++;
    const run = this.describing.then(ask).finally(() => this.queued--);
    this.describing = run.catch(() => {});
    return run;
  }

  private async describeNow(module: string, name: string, deadline: number): Promise<HoverAnswer> {
    if (!isDeclName(name) || !isDeclName(module)) return { error: "not a name" };
    const sc = await this.check(module, `#check @${name}`, deadline);
    if (!("uri" in sc)) return sc;
    // a name Lean does not know has no hover of its own: the one at its place is the `@`'s, which
    // explains `@`. What `#check` said tells the two apart
    const said = await this.said(sc, deadline);
    if (said.error) return { error: said.error };
    const refused = said.messages!.find((m) => m.severity === "error");
    if (refused) return { contents: null, refused: refused.text };
    const hover = this.request("textDocument/hover", { textDocument: { uri: sc.uri }, position: { line: 1, character: 8 } });
    const msg = await Promise.race([hover, after(Math.max(1000, deadline - Date.now()))]);
    // the import is still being loaded
    if (!msg) return { pending: { line: 0, of: 2 } };
    if (msg.error) return { error: msg.error.message };
    return { contents: (msg.result as { contents?: { value?: string } } | null)?.contents?.value ?? null };
  }

  private async printNow(module: string, name: string, proofs: boolean, deadline: number): Promise<PrintAnswer> {
    if (!isDeclName(name) || !isDeclName(module)) return { error: "not a name" };
    // one line, so that every message about it is on line 1
    const sc = await this.check(module, `${proofs ? "" : "set_option pp.proofs false in "}#print ${name}`, deadline);
    if (!("uri" in sc)) return sc;
    return this.said(sc, deadline);
  }

  /** What Lean said about the scratch file's command, once it has checked it. The messages can
   *  come just after Lean says it is done: wait for those about this version of the file and about
   *  the command (every command says something, if only an error). */
  private async said(sc: { uri: string; version: number }, deadline: number): Promise<{ messages?: Message[]; error?: string }> {
    const about = () => {
      const d = this.diagnostics.get(sc.uri);
      return d && d.version === sc.version ? d.items.filter((x) => (x.range?.start?.line ?? 0) >= 1) : [];
    };
    const until = Math.max(deadline, Date.now() + 2000);
    while (!about().length && this.scratch === sc && Date.now() < until) await new Promise((ok) => setTimeout(ok, 20));
    if (this.scratch !== sc) return { error: "Lean stopped" };
    const items = about();
    if (!items.length) return { error: "Lean said nothing about the command" };
    return { messages: items.map((x) => ({ severity: SEVERITY[x.severity ?? 1] ?? "error", text: x.message })) };
  }

  /** Have Lean check `command` where `module` is imported, in the scratch file: the file, once Lean
   *  has checked it; else how far it got by the deadline, or why it cannot. */
  private async check(module: string, command: string, deadline: number): Promise<Scratch | HoverAnswer> {
    try {
      await this.start();
    } catch (e) {
      return { error: this.failure ?? (e instanceof Error ? e.message : String(e)) };
    }
    this.touch();
    const text = `import ${module}\n${command}\n`;
    const uri = pathToFileURL(join(this.dir, "Describe.lean")).href;
    if (this.scratch) this.unstall(this.scratch, !this.scratch.done);
    const no = this.refused(uri);
    if (no) return { error: no };
    if (!this.scratch) {
      this.scratch = { uri, version: ++this.scratchVersion, text, done: false, progressAt: Date.now() };
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: this.scratch.version, text } });
    } else if (this.scratch.text !== text) {
      // the import line stays while the same module is on show: only the command is elaborated again
      this.scratch.version = ++this.scratchVersion;
      this.scratch.text = text;
      this.scratch.done = false;
      this.scratch.progressAt = Date.now();
      this.notify("textDocument/didChange", { textDocument: { uri: this.scratch.uri, version: this.scratch.version }, contentChanges: [{ text }] });
    }
    // asked before the import is read, Lean answers that there is nothing there: wait until it has
    // checked the file (a crash opens the same file again, as a newer version, and it is waited for)
    const sc = this.scratch;
    while (!sc.done && this.scratch === sc && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 30));
    if (this.scratch !== sc) return { error: this.refused(uri) ?? "Lean stopped" };
    if (!sc.done) return { pending: { line: 0, of: 2 } };
    return sc;
  }

  /** One hover request; a request for the same place while one is in flight joins it. */
  private ask(doc: Doc, line: number, character: number): Promise<Answered> {
    const key = `${doc.uri}:${doc.version}:${line}:${character}`;
    let p = this.asked.get(key);
    if (!p) {
      const asked = this.request("textDocument/hover", { textDocument: { uri: doc.uri }, position: { line, character } });
      p = asked;
      this.asked.set(key, p);
      // an answer is kept a while for the retries that join it; a failure (a crash, no answer) is
      // forgotten at once, so that the next asks again
      void p.then((m) => (m.error ? this.asked.get(key) === asked && this.asked.delete(key) : setTimeout(() => this.asked.get(key) === asked && this.asked.delete(key), 30000).unref()));
    }
    return p;
  }

  /** Forget the running Lean: what it had open, and the questions it will not answer now. */
  private reset(): void {
    if (this.alive) clearInterval(this.alive);
    this.alive = null;
    this.ready = false;
    this.proc = null;
    this.buf = Buffer.alloc(0);
    this.starting = null;
    this.scratch = null;
    this.diagnostics.clear();
    this.docs.clear();
    this.asked.clear();
    for (const w of this.waiting.values()) w({ error: { message: "Lean stopped" } });
    this.waiting.clear();
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const p = this.proc;
    this.reset();
    if (p) end(p);
  }

  /** The project's toolchain changed (a new commit of the branch the server follows:
   *  server/deploy.ts): Lean stops, and starts at the next question with the new toolchain's `lean`
   *  and LEAN_PATH. */
  toolchainChanged(): void {
    this.stop();
    this.env = null;
    this.failure = null;
  }
}

/** Where Lean is asked the goals at a place: before the tactic, after it, the term's expected type;
 *  and where the tactic ends, when the goals after are asked where the proof goes on (`after` the
 *  next line's start), in case it does not go on there. */
type Places = Record<"before" | "after" | "here", { line: number; character: number }> & { end?: { line: number; character: number } };

/** The goals after the tactic: where the proof goes on, as the state after the whole line (Lean's
 *  diff there being the next tactic's, it is made this one's: afterTheLine), where Lean has a tactic
 *  state there; else those at the tactic's end (`atEnd`, read only then). */
function afterOf(at: Places, before: Goal[] | null, after: Goal[] | null, atEnd: () => Goal[] | null): Pick<GoalsAnswer, "after" | "afterFrom"> {
  if (!at.end) return { after };
  if (after) return { after: afterTheLine(before, after), afterFrom: at.after.line };
  return { after: atEnd() };
}

/** Null after `ms`: what a question for Lean is raced against. */
function after(ms: number): Promise<null> {
  return new Promise((ok) => setTimeout(() => ok(null), ms).unref());
}
