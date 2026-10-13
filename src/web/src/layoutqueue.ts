// The Time Machine's layouts, in turn (HistorySpec, "The Time Machine"): each in a worker
// (web/src/layoutworker.ts) — two side by side where the machine has the cores, so that the build
// beyond the one aimed at is laid out while that one is — the most wanted first, so that the build the
// reader aims at is laid out before those laid out ahead of them. A layout nobody wants any more — the
// reader dragged on — is dropped before it starts, and one running is stopped (its worker ended,
// another started for the next) when a wanted one waits behind it: a fast drag across several builds
// piles up no work. What a layout reads is gathered when it starts, not when it is asked for. Where no
// worker can be had, the page lays out on its own thread, one at a time.

import type { Layout } from "../../shared/graph.ts";
import { layOut } from "./layoutworker.ts";
import type { LayoutAsk } from "./layoutworker.ts";

/** What the queue needs of a worker (web/src/layoutworker.ts; a fake one in the tests). */
export interface LayoutWorker {
  postMessage(m: LayoutAsk): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<{ id: number; layout?: Layout; error?: string }>) => void) | null;
  onerror: ((e: Event) => void) | null;
}

/** A layout given up because nobody wants it any more. */
export class Skipped extends Error {
  constructor() {
    super("no longer wanted");
    this.name = "Skipped";
  }
}

type Ask = Omit<LayoutAsk, "id">;

interface Job {
  id: number;
  /** the build it is of: how much it is wanted is asked by it */
  snapshot: number;
  ask: () => Ask;
  ok(L: Layout): void;
  no(e: Error): void;
}

/** One worker and the layout it runs. */
interface Slot {
  worker: LayoutWorker | null;
  job: Job | null;
}

export class LayoutQueue {
  /** the workers, each running one layout at a time: the build aimed at and the one beyond it are
   *  laid out side by side where the machine has the cores */
  private slots: Slot[];
  /** no worker can be had (its file not served): the page lays out itself, one at a time */
  private noWorker = false;
  private waiting: Job[] = [];
  private next = 1;
  /** how many layouts were dropped before they started, and stopped while they ran */
  dropped = 0;
  stopped = 0;
  private want: (snapshot: number) => number;
  private spawn: () => LayoutWorker | null;
  private local: (a: Ask) => Layout;

  /** `want`: how much a build's layout is wanted (0: not at all, then the more the sooner);
   *  `spawn`: a worker, or null where none can be had; `local`: a layout on the page's thread;
   *  `workers`: how many layouts run at once. */
  constructor(want: (snapshot: number) => number, spawn: () => LayoutWorker | null, local: (a: Ask) => Layout = layOut, workers = 1) {
    this.want = want;
    this.spawn = spawn;
    this.local = local;
    this.slots = Array.from({ length: Math.max(1, workers) }, () => ({ worker: null, job: null }));
  }

  /** Lay out a board of build `snapshot`; `ask` gathers what the layout reads, when it starts. It
   *  rejects with `Skipped` where nobody wants it any more. */
  lay(snapshot: number, ask: () => Ask): Promise<Layout> {
    return new Promise<Layout>((ok, no) => {
      this.waiting.push({ id: this.next++, snapshot, ask, ok, no });
      this.prune();
    });
  }

  /** Whether a layout runs or waits. */
  get busy(): boolean {
    return this.waiting.length > 0 || this.slots.some((s) => s.job);
  }

  /** The builds whose layouts run, slot by slot (null: a free one). */
  get running(): (number | null)[] {
    return this.slots.map((s) => s.job?.snapshot ?? null);
  }

  /** What is wanted changed: what nobody wants is dropped, and a layout running is stopped where
   *  nobody wants it and a wanted one waits with no worker free; then the next ones start. */
  prune(): void {
    const keep: Job[] = [];
    for (const j of this.waiting) {
      if (this.want(j.snapshot) > 0) keep.push(j);
      else this.drop(j);
    }
    this.waiting = keep;
    for (const s of this.slots) {
      if (this.waiting.length <= this.slots.filter((x) => !x.job).length) break;
      const j = s.job;
      if (!j || !s.worker || this.want(j.snapshot) > 0) continue;
      this.stopped++;
      s.worker.terminate();
      s.worker = null;
      s.job = null;
      j.no(new Skipped());
    }
    this.pump();
  }

  /** Drop everything waiting (what it was asked for is gone: a new graph on show, the history read
   *  again); the layouts running finish, unread. */
  clear(): void {
    for (const j of this.waiting) this.drop(j);
    this.waiting = [];
  }

  private drop(j: Job): void {
    this.dropped++;
    j.no(new Skipped());
  }

  /** The next layouts, on the free workers: the most wanted, the first asked among equals. Without a
   *  worker, one at a time on the page's thread. */
  private pump(): void {
    for (const s of this.noWorker ? this.slots.slice(0, 1) : this.slots) {
      if (this.noWorker && this.slots.some((x) => x.job)) return;
      while (!s.job && this.waiting.length) {
        let k = 0;
        for (let i = 1; i < this.waiting.length; i++) if (this.want(this.waiting[i].snapshot) > this.want(this.waiting[k].snapshot)) k = i;
        const [j] = this.waiting.splice(k, 1);
        if (this.want(j.snapshot) <= 0) {
          this.drop(j);
          continue;
        }
        s.job = j;
        const w = this.noWorker ? null : (s.worker ??= this.started(s));
        if (w) w.postMessage({ id: j.id, ...j.ask() });
        else setTimeout(() => this.here(s, j), 0);
      }
    }
  }

  /** A layout on the page's thread (no worker, or the worker could not), unless it is no longer
   *  wanted. */
  private here(s: Slot, j: Job): void {
    if (s.job !== j) return;
    s.job = null;
    if (this.want(j.snapshot) <= 0) this.drop(j);
    else {
      let L: Layout | null = null;
      let err: Error | null = null;
      try {
        L = this.local(j.ask());
      } catch (e) {
        err = e instanceof Error ? e : new Error(String(e));
      }
      if (L) j.ok(L);
      else j.no(err ?? new Error("the layout failed"));
    }
    this.pump();
  }

  private started(s: Slot): LayoutWorker | null {
    let w: LayoutWorker | null;
    try {
      w = this.spawn();
    } catch {
      w = null;
    }
    if (!w) {
      this.noWorker = true;
      return null;
    }
    w.onmessage = (e) => {
      const j = s.job;
      if (s.worker !== w || !j || e.data.id !== j.id) return;
      if (e.data.layout) {
        s.job = null;
        j.ok(e.data.layout);
        this.pump();
      } else setTimeout(() => this.here(s, j), 0); // the worker could not: the page tries
    };
    // a worker that cannot run (its file not served): the page lays out itself, from now on
    w.onerror = () => {
      if (s.worker !== w) return;
      s.worker = null;
      this.noWorker = true;
      const j = s.job;
      if (j) setTimeout(() => this.here(s, j), 0);
    };
    return w;
  }
}
