// The review's storage (ReviewSpec.md, decision 5; the log design decided 2026-10-08): the site's
// `log/` (server/dirs.ts; a folder given relative to the project, or absolute). The site is local,
// never committed (the owner's decision of 2026-10-13): the review is the site's, as its history is.
//
// One append-only log per writer, `log/<name>-<hash>.jsonl` (an agent's `….agent.jsonl`; someone
// invited by a personal link, `<id>.person.jsonl`, whatever name they go by), one event per line
// (shared/review.ts). A person's events go to their file, an agent's to its own —
// its advice, and at level full whatever else it does (AgentSpec decision 9), every line marked
// as an agent's. Nothing is ever rewritten: an event is appended, after checking that the file is the
// size last read, so that what was written meanwhile (by hand, a restored backup) is read first and
// never written over.
//
// The review is the replay of every log. The folder is looked at every second; only files whose
// size, time or inode changed are read again. A file that only grew is parsed from where the last
// read stopped; one that shrank or changed before that point (a rewrite, a checkout) is read whole.
// A line that cannot be read (a line cut short, a bad edit by hand) is reported, the
// file's other lines and the other files are read, and nothing more is appended to that file until
// someone fixes it by hand. A line of an event the review no longer records (an explanation, since
// 2026-10-08; a checkpoint, since 2026-10-09) is skipped, neither reported nor holding up its file.
//
// What changed is told as a change (`ReviewChange`): the events that came after everything replayed
// so far, which a page applies to its own review — or, when an event came in between (older events
// restored from a backup, a rewrite), the whole review again.

import { createHash, randomBytes } from "node:crypto";
import type { Hash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { SITE_README } from "./dirs.ts";
import { applyEvent, emptyReview, eventOf, invalid, logFileName, merged, nameEvent, noChange, personOfLog, problemsText, readEvent } from "../shared/review.ts";
import type { LogProblem, ReviewChange, ReviewData, ReviewEvent, ReviewOp, ReviewWhole } from "../shared/review.ts";

export type { ReviewChange };

const LOG_DIR = "log";

/** Who writes: a person or an agent, by the exact name their events carry; someone invited by a
 *  personal link also by the link's id, which names their log; or the server itself, which writes
 *  the moves of the renames it finds (HistorySpec.md) to a log of its own. */
export interface Writer {
  name: string;
  agent: boolean;
  person?: string | null;
  server?: boolean;
}

/** The server's own log: the moves it made of the renames it found, and the links it carried with a
 *  cluster a build renamed (AttachmentSpec decision 6), and nothing else; a move made twice
 *  carries nothing the second time. */
export const SERVER_LOG = "visualproof.server.jsonl";
/** the name the server's moves are recorded under */
export const SERVER_WRITER: Writer = { name: "VisualProof", agent: false, server: true };

/** An append's answer: what changed, or why nothing was written (an HTTP status and words). */
export type AppendResult = { change: ReviewChange; event: ReviewEvent } | { change: null; unchanged: true } | { status: number; error: string };

/** One log as last read. */
interface LogFile {
  /** its name in log/ */
  file: string;
  agent: boolean;
  /** the personal link's id it is named by, or null */
  person: string | null;
  /** the server's own log (SERVER_LOG): moves it found, nothing else */
  server: boolean;
  /** size, time and inode when last read: a file whose stamp is the same is not read again */
  stamp: string;
  /** bytes read up to the end of the last whole line, and their hash */
  offset: number;
  hash: Hash;
  /** whole lines read */
  lines: number;
  /** the events of the whole lines, in file order */
  events: ReviewEvent[];
  /** the last line, where it has no newline yet: its event when it can be read (counted, and
   *  written after with a newline first), else a problem */
  tail: { bytes: number; event: ReviewEvent | null } | null;
  problems: LogProblem[];
}

export class ReviewStore {
  readonly dir: string;
  readonly logDir: string;
  data: ReviewData = emptyReview();
  /** this run's id, and the revision of `data`: one more at every change */
  readonly epoch = randomBytes(6).toString("hex");
  rev = 0;
  /** told of every change, after it is made (server/live.ts sends it to the pages) */
  onChange: ((c: ReviewChange) => void) | null = null;
  private files = new Map<string, LogFile>();
  /** the replay's order: what `data` was made from */
  private order: ReviewEvent[] = [];
  /** what the replay reads an event as (`setReading`): the event, unless an opinion recorded under
   *  the kernel's content hash is bound to its version (server/versions.ts, `rebinder`). The same
   *  object each time for the same line, so that what was replayed is still told from what is new */
  private reading: ((e: ReviewEvent) => ReviewEvent) | null = null;
  private read_ = new WeakMap<ReviewEvent, ReviewEvent>();
  /** the next commit replays every event, as `reading` changed */
  private again = false;

  /** `dir` relative to the project, or absolute. Nothing is created until something is written. */
  constructor(projectRoot: string, dir: string) {
    this.dir = isAbsolute(dir) ? dir : resolve(projectRoot, dir);
    this.logDir = join(this.dir, LOG_DIR);
    this.refresh();
  }

  /** Every line that cannot be read, file by file. */
  get problems(): LogProblem[] {
    return [...this.files.values()].flatMap((f) => f.problems);
  }

  /** The problems in words (the page, /api/status); null when every line reads. */
  get error(): string | null {
    return problemsText(this.problems);
  }

  /** The whole review, as a page takes it on (re)connecting. */
  whole(): ReviewWhole {
    return { epoch: this.epoch, rev: this.rev, data: this.data, problems: this.problems, error: this.error };
  }

  /** The file a writer's events go to (shared/review.ts, logFileName). */
  fileOf(w: Writer): string {
    return w.server ? SERVER_LOG : logFileName(w.name, w.agent, w.person ?? null);
  }

  /** Read the logs that changed on disk since last read; the change, or null when nothing did. */
  refresh(): ReviewChange | null {
    let names: string[] = [];
    try {
      names = readdirSync(this.logDir).filter((n) => n.endsWith(".jsonl")).sort();
    } catch {
      // no folder yet: no review yet
    }
    let changed = false;
    for (const gone of [...this.files.keys()].filter((f) => !names.includes(f))) {
      this.files.delete(gone);
      changed = true;
    }
    for (const name of names) if (this.read(name)) changed = true;
    return changed ? this.commit() : null;
  }

  /** Read one log again if its stamp changed: from where the last read stopped when it only grew,
   *  else whole. Whether anything was read. */
  private read(name: string): boolean {
    const path = join(this.logDir, name);
    const was = this.files.get(name);
    let buf: Buffer;
    let stamp: string;
    try {
      const st = statSync(path);
      if (!st.isFile()) return this.files.delete(name);
      stamp = `${st.size}:${st.mtimeMs}:${st.ino}`;
      if (was?.stamp === stamp) return false;
      buf = readFileSync(path);
    } catch (e) {
      // unreadable (permissions, gone between listing and reading): said, what was read of it is
      // kept, nothing is written to it, and it is read again at the next look
      const f = was ?? this.fresh(name, "");
      f.problems = [...f.problems.filter((p) => p.line > 0), { file: name, line: 0, why: `the file cannot be read (${e instanceof Error ? e.message : String(e)})`, writer: null }];
      f.stamp = "";
      this.files.set(name, f);
      return true;
    }
    // only grown: the bytes read before are still there, the same
    if (was && buf.length >= was.offset && createHash("sha256").update(buf.subarray(0, was.offset)).digest("hex") === was.hash.copy().digest("hex")) {
      was.stamp = stamp;
      this.parse(was, buf);
      return true;
    }
    const f = this.fresh(name, stamp);
    this.files.set(name, f);
    this.parse(f, buf);
    return true;
  }

  private fresh(name: string, stamp: string): LogFile {
    return { file: name, agent: name.endsWith(".agent.jsonl"), person: personOfLog(name), server: name === SERVER_LOG, stamp, offset: 0, hash: createHash("sha256"), lines: 0, events: [], tail: null, problems: [] };
  }

  /** Parse what follows `f.offset` in `buf`: whole lines become events (or problems), the rest is
   *  the tail. */
  private parse(f: LogFile, buf: Buffer): void {
    // a tail read before is read again with what came after it, and a file that could not be read
    // before is no longer said to be unreadable
    f.tail = null;
    f.problems = f.problems.filter((p) => p.line > 0 && p.line <= f.lines);
    const take = (text: string, line: number, last: boolean): ReviewEvent | null => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        f.problems.push({ file: f.file, line, why: last ? `the last line is cut short (${clip(text)})` : `not an event (${clip(text)})`, writer: null });
        return null;
      }
      let e = readEvent(raw, f.agent, f.person);
      // the server writes the moves it found there, and the links it carried with a cluster a build
      // renamed (AttachmentSpec decision 6); they are written nowhere else
      if (e && typeof e !== "string" && f.server !== serversOwn(e))
        e = f.server ? "the server's log holds the moves it found and the links it carried, nothing else" : "a move the server found, or a link it carried, outside its own log";
      // an event of a kind no longer recorded is skipped: read, not a problem
      if (e === null || typeof e !== "string") return e;
      f.problems.push({ file: f.file, line, why: `${e} (${clip(text)})`, writer: null });
      return null;
    };
    let at = f.offset;
    for (;;) {
      const nl = buf.indexOf(10, at);
      if (nl < 0) break;
      f.hash.update(buf.subarray(at, nl + 1));
      const text = buf.subarray(at, nl).toString("utf8").replace(/\r$/, "");
      f.lines++;
      if (text.trim()) {
        const e = take(text, f.lines, false);
        if (e) f.events.push(e);
      }
      at = nl + 1;
    }
    f.offset = at;
    if (at < buf.length) {
      const text = buf.subarray(at).toString("utf8");
      f.tail = { bytes: buf.length - at, event: text.trim() ? take(text, f.lines + 1, true) : null };
    }
    // whose log it is, as its good lines say
    const who = f.events[0]?.by ?? f.tail?.event?.by ?? null;
    for (const p of f.problems) p.writer = who;
  }

  /** Replay what was read, and say what changed: the new events alone where they all come after
   *  what was replayed before, else the whole review. A log read whole again has events of its own
   *  (new objects), and one gone has none: either way what was replayed is no longer where it was,
   *  and the review is replayed whole. */
  private commit(): ReviewChange {
    const logs = [...this.files.values()].map((f) => ({ file: f.file, events: f.tail?.event ? [...f.events, f.tail.event] : f.events }));
    const next = merged(logs).map((x) => this.readAs(x.e));
    const before = this.order;
    const appended = !this.again && next.length >= before.length && before.every((e, k) => next[k] === e);
    this.again = false;
    const base = this.rev;
    this.rev++;
    this.order = next;
    let events: ReviewEvent[] | null = null;
    if (appended) {
      events = next.slice(before.length);
      for (const e of events) applyEvent(this.data, e);
    } else {
      this.data = emptyReview();
      for (const e of next) applyEvent(this.data, e);
    }
    const c: ReviewChange = { epoch: this.epoch, base, rev: this.rev, events, problems: this.problems };
    this.onChange?.(c);
    return c;
  }

  private readAs(e: ReviewEvent): ReviewEvent {
    if (!this.reading) return e;
    let r = this.read_.get(e);
    if (!r) this.read_.set(e, (r = this.reading(e)));
    return r;
  }

  /** Read every event through `reading` from now on (a new graph, or new renames, change what an
   *  opinion recorded under the kernel's hash is bound to): the whole review is replayed, and the
   *  pages are told. */
  setReading(reading: ((e: ReviewEvent) => ReviewEvent) | null): ReviewChange {
    this.reading = reading;
    this.read_ = new WeakMap();
    this.again = true;
    return this.commit();
  }

  /** When a new event is recorded: now — or, where the last event replayed is as late (another
   *  writer in the same millisecond), just after it, so that what is appended comes after what was
   *  replayed and pages are sent the new event alone. A clock far ahead is not followed. */
  private nextTime(): string {
    const now = Date.now();
    const last = this.order.length ? Date.parse(this.order[this.order.length - 1].at) : 0;
    return new Date(last >= now && last - now < 1000 ? last + 1 : now).toISOString();
  }

  /** Record a (checked) request under its writer's name: one line appended to their log, never
   *  anything rewritten. Refused when their log has a line that cannot be read, until it is fixed
   *  by hand; a request that changes nothing (a target marked that is one) appends nothing. */
  append(who: Writer, r: ReviewOp, toolchain: string): AppendResult {
    const why = invalid(r);
    if (why) return { status: 400, error: why };
    const w = { name: who.name.trim(), agent: who.agent, person: who.person ?? null, server: who.server };
    if (r.by.trim() !== w.name || !!r.agent !== w.agent || (r.person ?? null) !== w.person) return { status: 400, error: "an event is recorded under the name and kind of who asks" };
    if (!!w.server !== serversOwn(r)) return { status: 400, error: "the server records the moves it found and the links it carried, and only it does" };
    // what someone else wrote meanwhile comes first
    this.refresh();
    if (noChange(this.data, r)) return { change: null, unchanged: true };
    return this.write(this.fileOf(w), () => eventOf(this.data, r, toolchain, this.nextTime()));
  }

  /** Someone invited by a personal link renamed themselves (CollabSpec decision 9): their log says
   *  so, a `name` line, so that everything they wrote shows under the new name on every replica.
   *  Nothing is written for someone who has no log yet — their first line will carry the name — nor
   *  when the log says that name already. */
  named(person: string, name: string): AppendResult {
    this.refresh();
    const file = logFileName(name, false, person);
    const now = Object.hasOwn(this.data.people, person) ? this.data.people[person].name : null;
    if (!this.files.has(file) || now === name.trim()) return { change: null, unchanged: true };
    return this.write(file, () => nameEvent(person, name, this.nextTime()));
  }

  /** Append the event `make` gives to log `file`: one line, once the file is as it was last read —
   *  else what someone else wrote is read first, and the event made again. Refused while the file
   *  has a line that cannot be read. */
  private write(file: string, make: () => ReviewEvent): AppendResult {
    for (let tries = 0; tries < 3; tries++) {
      const f = this.files.get(file);
      if (f?.problems.length) {
        const p = f.problems[0];
        return {
          status: 409,
          error:
            `Your review log (log/${file} in ${this.dir}) has a line that cannot be read — line ${p.line}: ${p.why}. ` +
            "Nothing more is written to it until it is fixed by hand; nothing in it was changed.",
        };
      }
      const e = make();
      const expected = f ? f.offset + (f.tail?.bytes ?? 0) : 0;
      // a last line without its newline (written by hand) ends before this one starts
      const line = Buffer.from((f?.tail?.bytes ? "\n" : "") + JSON.stringify(e) + "\n", "utf8");
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
        // what the folder is, for whoever finds it (with the first log, where the
        // server did not make the folder; one already there is left as it is)
        try {
          writeFileSync(join(this.dir, "README.md"), SITE_README, { flag: "wx" });
        } catch {
          // there is one
        }
      }
      const fd = openSync(join(this.logDir, file), "a");
      let wrote = false;
      try {
        // the file is as last read, or someone else wrote to it: that is read first, then this
        // is tried again
        if (fstatSync(fd).size === expected) {
          writeSync(fd, line);
          wrote = true;
        }
      } finally {
        closeSync(fd);
      }
      if (!wrote) {
        this.refresh();
        continue;
      }
      const c = this.refresh();
      if (!c) return { status: 500, error: "the review log was written but could not be read back" };
      return { change: c, event: e };
    }
    return { status: 409, error: `Your review log (log/${file}) kept changing while this was written; try again.` };
  }
}

/** Whether an event is one only the server writes, in its own log: a move of a rename it found, or
 *  a link it carried with a cluster a build renamed as a whole (server/library.ts); each says why
 *  (`auto`). */
function serversOwn(e: { op: string; auto?: string }): boolean {
  return (e.op === "move" || e.op === "link-edit") && e.auto !== undefined;
}

/** A line's start, as a problem quotes it. */
function clip(text: string): string {
  const t = text.trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}
