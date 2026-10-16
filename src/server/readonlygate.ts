// What a read-only reader may ask (CollabSpec decision 11): what a guest reads, and nothing that
// changes what is shared. The server refuses the rest (403) whatever the page sends; the page does
// not offer it. What costs the server is bounded for read-only readers: Lean's answers, by address
// and in all, each kept per build; the printed document, one typesetting at a time for them all.

/** Whether a read-only reader may make this request. */
export function readOnlyAllows(method: string, path: string): boolean {
  const read = method === "GET" || method === "HEAD";
  if (read) {
    // the page and its files: its fonts, the tips' clips (GuideSpec decision 6)
    if (path === "/" || path === "/index.html" || path === "/style.css" || /^\/(app|layout|edges|pdfworker)\.js(\.map)?$/.test(path) || path.startsWith("/pdfjs/") || path.startsWith("/fonts/") || path.startsWith("/tips/")) return true;
    // the graph, its sources and Lean's answers, the review, what happened, the views, the history,
    // the library, the printed document's state and files, who the reader is and the link they
    // came by, and the event stream every change comes by
    if (["/api/status", "/api/meta", "/api/edges", "/api/git", "/api/source", "/api/review", "/api/activity", "/api/identity", "/api/share"].includes(path)) return true;
    // a stream is opened by GET alone: a HEAD would take one of their places for nothing
    if (path === "/api/events") return method === "GET";
    if (path === "/api/hover" || path === "/api/hover/describe" || path === "/api/hover/print") return true;
    for (const p of ["/api/views", "/api/history", "/api/library", "/api/export"]) if (path === p || path.startsWith(`${p}/`)) return true;
    return false;
  }
  // a file opened in Lean, the names in a declaration's source: reads, posted for their size
  if (method === "POST" && (path === "/api/hover/open" || path === "/api/hover/names")) return true;
  // the printed document of a view as it is shared (bounded below)
  if (method === "POST" && path === "/api/export") return true;
  return false;
}

/** Whether Lean's answer is what it says in the end, to be kept for the build: not a failure, nor
 *  "still elaborating" (server/hover.ts), which a later request must ask again. */
export function finalAnswer(body: unknown): boolean {
  const b = body as { error?: unknown; pending?: unknown } | null;
  return !!b && typeof b === "object" && !b.error && !b.pending;
}

/** At most `per` in `ms` for each key, and `all` in all: a sliding count per key. */
class Rate {
  private hits = new Map<string, number[]>();
  private every: number[] = [];
  private per: number;
  private all: number;
  private ms: number;
  constructor(per: number, all: number, ms: number) {
    this.per = per;
    this.all = all;
    this.ms = ms;
  }
  /** 0 when `key` may go now (and it is counted), else the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const since = now - this.ms;
    const mine = (this.hits.get(key) ?? []).filter((t) => t > since);
    this.every = this.every.filter((t) => t > since);
    const wait = (ts: number[], max: number) => (ts.length < max ? 0 : Math.max(1, Math.ceil((ts[ts.length - max] + this.ms - now) / 1000)));
    const w = Math.max(wait(mine, this.per), wait(this.every, this.all));
    if (w === 0) {
      mine.push(now);
      this.every.push(now);
    }
    if (mine.length) this.hits.set(key, mine);
    else this.hits.delete(key);
    // the keys of addresses gone quiet go with them
    if (this.hits.size > 10_000) for (const [k, ts] of this.hits) if (!ts.some((t) => t > since)) this.hits.delete(k);
    return w;
  }
}

/** Lean's answers to read-only readers, and their printed documents. */
export class ReadOnlyBounds {
  /** Lean's answers: per address, and for every read-only reader together, a minute's worth */
  private lean = new Rate(60, 300, 60_000);
  /** Lean's answers to the same question about the same build, as read-only readers asked them */
  private answers = new Map<string, unknown>();
  private static readonly ANSWERS = 2000;
  /** the read-only readers' document being typeset, by its job's id; `RESERVED` while it starts */
  exporting: string | null = null;
  private static readonly RESERVED = "\0starting";

  /** whether a job is still running (server/export.ts) */
  private running: (id: string) => boolean;
  constructor(running: (id: string) => boolean = () => false) {
    this.running = running;
  }

  /** 0 when an address may ask Lean now, else the seconds to wait (429). */
  leanWait(address: string, now = Date.now()): number {
    return this.lean.take(address, now);
  }

  /** An answer kept for this build and question, if there is one. */
  answer(key: string): unknown {
    return this.answers.get(key);
  }

  /** Keep an answer, the oldest going past ANSWERS. */
  keep(key: string, answer: unknown): void {
    this.answers.delete(key);
    this.answers.set(key, answer);
    while (this.answers.size > ReadOnlyBounds.ANSWERS) this.answers.delete(this.answers.keys().next().value!);
  }

  /** Whether a read-only reader may start a document now: no other read-only document is being
   *  typeset, nor starting. */
  mayExport(): boolean {
    if (this.exporting && this.exporting !== ReadOnlyBounds.RESERVED && !this.running(this.exporting)) this.exporting = null;
    return this.exporting === null;
  }

  /** Take the place before a document starts (`mayExport` said yes). */
  reserveExport(): void {
    this.exporting = ReadOnlyBounds.RESERVED;
  }

  /** The document started (the export's answer), or failed to: the place is its job's while it
   *  runs, and free otherwise. */
  exportStarted(answer: unknown): void {
    const job = (answer as { job?: { id?: unknown; state?: unknown } } | null)?.job;
    this.exporting = job?.state === "running" && typeof job.id === "string" ? job.id : null;
  }
}
