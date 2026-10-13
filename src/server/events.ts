// The timeline (CollabSpec decision 5), as the server keeps it: one event per line in
// `<site>/events.jsonl`, the last 90 days and at most 5,000 events. It notices what nobody records
// by hand — a build that finished, files that failed or were fixed, `sorry` that came or went, and a
// target's TCB that changed (with the opinions that went stale by it) — and is told of re-layouts,
// of targets taken off and of prefixes trusted or no longer trusted (the review's state keeps the
// trusted list, not who changed it), and of what agents do beside their advice: notes, layout
// batches and their undoing (server/agent.ts), and of views saved, renamed, deleted and laid out
// afresh (server/views.ts). Opinions, targets and key marks are in the review's logs
// (server/review.ts); the page reads them from there.
//
// A target's TCB is compared with the one it had at the last graph, kept in
// `<site>/tcb-baselines.json`, so a change made while the server was down is noticed when it
// comes back.

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { BuildStatus, FileStatus } from "../shared/build.ts";
import type { ViewMeta } from "../shared/graph.ts";
import { byName, current } from "../shared/review.ts";
import type { ReviewData } from "../shared/review.ts";
import { NAMES_LISTED, TcbIndex, tcbDiff } from "../shared/timeline.ts";
import type { NewEvent, StoredEvent } from "../shared/timeline.ts";
import type { Prepared } from "./pipeline.ts";

const KEEP = 5000;
const KEEP_MS = 90 * 24 * 3600 * 1000;

export class Timeline {
  private file: string;
  private baselineFile: string;
  events: StoredEvent[] = [];
  private send: (e: StoredEvent) => void;
  /** each file's state when no build was running, last time */
  private settled: Map<string, FileStatus> | null = null;
  /** the graph on show, for TCBs */
  private index: TcbIndex | null = null;
  /** each target's TCB at the last graph; keyed by names, so without prototypes */
  private baselines = byName<Record<string, string>>();

  constructor(siteDir: string, send: (e: StoredEvent) => void) {
    this.send = send;
    this.file = join(siteDir, "events.jsonl");
    this.baselineFile = join(siteDir, "tcb-baselines.json");
    if (existsSync(this.file)) {
      const lines = readFileSync(this.file, "utf8").split("\n");
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          this.events.push(JSON.parse(l));
        } catch {
          // a line cut short (the server stopped while writing): left out
        }
      }
      const kept = this.pruned();
      if (kept.length !== this.events.length) {
        this.events = kept;
        this.rewrite();
      }
    }
    try {
      const raw = JSON.parse(readFileSync(this.baselineFile, "utf8")) as unknown;
      for (const [target, tcb] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
        if (!tcb || typeof tcb !== "object") continue;
        const m = byName<string>();
        for (const [k, v] of Object.entries(tcb)) if (typeof v === "string") m[k] = v;
        this.baselines[target] = m;
      }
    } catch {
      // none yet, or unreadable: every target starts again from the TCB it has now
    }
  }

  private pruned(): StoredEvent[] {
    const after = Date.now() - KEEP_MS;
    return this.events.filter((e) => Date.parse(e.at) >= after).slice(-KEEP);
  }

  private rewrite(): void {
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, this.events.map((e) => JSON.stringify(e) + "\n").join(""));
    renameSync(tmp, this.file);
  }

  /** Record an event, and tell every page. */
  add(e: NewEvent): StoredEvent {
    const full = { ...e, id: (this.events[this.events.length - 1]?.id ?? 0) + 1, at: new Date().toISOString() } as StoredEvent;
    this.events.push(full);
    appendFileSync(this.file, JSON.stringify(full) + "\n");
    if (this.events.length > KEEP + 500) {
      this.events = this.pruned();
      this.rewrite();
    }
    this.send(full);
    return full;
  }

  /** The build status, every time it changes: once no build runs, what changed since the last
   *  quiet moment is one event. The first status after a start is where the comparison begins. */
  buildStatus(b: BuildStatus): void {
    if (b.active) return;
    const now = new Map(b.files.map((f) => [f.module, f]));
    const was = this.settled;
    this.settled = now;
    if (!was) return;
    const failed: string[] = [], fixed: string[] = [], sorry: string[] = [], sorryGone: string[] = [];
    let rebuilt = 0;
    for (const [m, f] of now) {
      const p = was.get(m);
      if (f.builtAt && p?.builtAt !== f.builtAt) rebuilt++;
      if (f.state === "failed" && p?.state !== "failed") failed.push(m);
      if (p?.state === "failed" && (f.state === "ok" || f.state === "sorry")) fixed.push(m);
      if (f.state === "sorry" && p?.state !== "sorry") sorry.push(m);
      if (p?.state === "sorry" && f.state === "ok") sorryGone.push(m);
    }
    if (failed.length || fixed.length || sorry.length || sorryGone.length || rebuilt)
      this.add({ kind: "build", failed: failed.sort(), fixed: fixed.sort(), sorry: sorry.sort(), sorryGone: sorryGone.sort(), rebuilt });
  }

  /** A new graph: every target's TCB is compared with the one it had, and a change is an event.
   *  `renamed`: the renames found against the build before (HistorySpec.md), old name → new: a
   *  declaration renamed is the same one, neither removed nor added, and a target renamed keeps its
   *  baseline. */
  graphChanged(prep: Prepared, review: ReviewData, renamed: ReadonlyMap<string, string> = new Map()): void {
    const meta: ViewMeta = JSON.parse(gunzipSync(prep.metaGz).toString("utf8"));
    const raw = gunzipSync(prep.edgesGz);
    const edges = new Int32Array(new Uint8Array(raw).buffer);
    this.index = new TcbIndex(meta.nodes, edges);
    // a baseline kept before versions holds the kernel's hashes (server/versions.ts): one that is
    // the kernel's hash of the content there now is that content's version
    const kernel = new Map<string, string>();
    for (const v of meta.nodes) if (v.kernel && v.hash) kernel.set(v.name, v.kernel);
    if (renamed.size) {
      for (const t of Object.keys(this.baselines)) {
        const b = this.baselines[t];
        const now = byName<string>();
        for (const k of Object.keys(b)) now[renamed.get(k) ?? k] = b[k];
        delete this.baselines[t];
        this.baselines[renamed.get(t) ?? t] = now;
      }
    }
    for (const target of Object.keys(review.targets)) {
      const root = this.index.byName.get(target);
      if (root === undefined) continue;
      const now = this.index.tcb(root);
      const before = Object.hasOwn(this.baselines, target) ? this.baselines[target] : null;
      if (before) for (const k of Object.keys(before)) if (Object.hasOwn(now, k) && kernel.get(k) === before[k]) before[k] = now[k];
      this.baselines[target] = now;
      if (!before) continue;
      const d = tcbDiff(before, now);
      if (!d.added.length && !d.removed.length && !d.changed.length) continue;
      // opinions given on the version before, for what changed: stale now
      let stale = 0;
      for (const name of d.changed) stale += current(review, name).filter((o) => o.hash && o.hash === before[name]).length;
      this.add({
        kind: "tcb",
        target,
        added: d.added.slice(0, NAMES_LISTED),
        removed: d.removed.slice(0, NAMES_LISTED),
        changed: d.changed.slice(0, NAMES_LISTED),
        counts: { added: d.added.length, removed: d.removed.length, changed: d.changed.length },
        stale,
      });
    }
    this.saveBaselines();
  }

  /** The review changed: a new target starts from the TCB it has now. */
  reviewChanged(review: ReviewData): void {
    if (!this.index) return;
    let added = false;
    for (const target of Object.keys(review.targets)) {
      if (Object.hasOwn(this.baselines, target)) continue;
      const root = this.index.byName.get(target);
      if (root === undefined) continue;
      this.baselines[target] = this.index.tcb(root);
      added = true;
    }
    if (added) this.saveBaselines();
  }

  private saveBaselines(): void {
    const tmp = `${this.baselineFile}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.baselines));
    renameSync(tmp, this.baselineFile);
  }
}
