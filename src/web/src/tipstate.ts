// What a browser keeps of the tips, for every project (GuideSpec decision 12): the tips seen and
// done, whether tips in place are off, and the last release of VisualProof this browser saw, by
// which What's new is told (decision 11). Storage blocked: the page works, it just does not remember.

const KEY = "visualproof:tips";

interface Kept {
  /** how many times each tip was shown in place, by id: after two it is done (decision 9) */
  shown: Record<string, number>;
  /** what the rules count across visits (web/src/intip.ts): picks under a step, by name */
  counts: Record<string, number>;
  /** the tips ended for good: Got it, or what they teach done */
  done: string[];
  /** in-place tips turned off in the sheet */
  off?: boolean;
  /** the newest release this browser saw a server on */
  version?: string;
  /** the release seen before the last one came: tips newer than it are New until Tips is looked at */
  newSince?: string;
  /** a dot on the help (?): the tour ended, or the welcome was put off, and the help not opened since
   *  (GuideSpec decision 1) */
  dot?: boolean;
}

/** Whether release `a` is newer than `b` (x.y.z, a pre-release before its release). */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v.trim());
    return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}

/** What is kept as it is now; null where the storage cannot be read (a private window). */
function read(): Kept | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== "object") return { shown: {}, counts: {}, done: [] };
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    const numbers = (x: unknown): Record<string, number> =>
      x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter((e): e is [string, number] => Number.isInteger(e[1]) && e[1] > 0)) : {};
    return { shown: numbers(o.shown), counts: numbers(o.counts), done: ids(o.done), off: o.off === true || undefined, version: typeof o.version === "string" ? o.version : undefined, newSince: typeof o.newSince === "string" ? o.newSince : undefined, dot: o.dot === true || undefined };
  } catch {
    // what cannot be read is nothing kept, and is written over by the next change
    return { shown: {}, counts: {}, done: [] };
  }
}

export class TipState {
  private d: Kept;

  constructor() {
    this.d = read() ?? { shown: {}, counts: {}, done: [] };
    // another page of this browser changed it: this one reads it as it is now
    if (typeof addEventListener === "function")
      addEventListener("storage", (e) => {
        if (e.key === KEY || e.key === null) this.d = read() ?? this.d;
      });
  }

  /** A change made to what is kept as it is now, not to this page's copy of it: pages open at once,
   *  on one project or on two, never write back each other's older state. */
  private change<T>(f: (d: Kept) => T): T {
    const d = read() ?? this.d;
    const out = f(d);
    this.d = d;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      // not kept
    }
    return out;
  }

  isDone(id: string): boolean {
    return this.d.done.includes(id);
  }

  done(id: string): void {
    if (this.isDone(id)) return;
    this.change((d) => {
      if (!d.done.includes(id)) d.done.push(id);
    });
  }

  /** A tip shown in place: the second time, it is done, answered or not. */
  shown(id: string): void {
    this.change((d) => {
      const n = (d.shown[id] ?? 0) + 1;
      d.shown[id] = n;
      if (n >= 2 && !d.done.includes(id)) d.done.push(id);
    });
  }

  /** One more of what a rule counts; how many now. */
  bump(name: string): number {
    return this.change((d) => (d.counts[name] = (d.counts[name] ?? 0) + 1));
  }

  get off(): boolean {
    return this.d.off === true;
  }

  set off(v: boolean) {
    this.change((d) => void (d.off = v || undefined));
  }

  /** The dot on the help: shown until the help is opened, the tour taken, or Tips looked at. */
  get dot(): boolean {
    return this.d.dot === true;
  }

  set dot(v: boolean) {
    if (this.dot === v && read()?.dot === (v || undefined)) return;
    this.change((d) => void (d.dot = v || undefined));
  }

  /** The releases New is told against: tips newer than `since` are New; null when none is. */
  get newSince(): string | null {
    return this.d.newSince ?? null;
  }

  /** Tips has been looked at: nothing is New any more. */
  newLooked(): void {
    if (this.d.newSince === undefined && read()?.newSince === undefined) return;
    this.change((d) => void (d.newSince = undefined));
  }

  /** The server runs release `v`: the release this browser saw before it when it is newer (What's
   *  new is told), else null. Read and written at once, so that it is told once in the browser, not
   *  once in each page open. A first visit records it and tells nothing. */
  meet(v: string): string | null {
    return this.change((d) => {
      const was = d.version;
      if (was === v) return null;
      // an older server (another one, or a step back): nothing told, and the newest seen kept, so
      // that going between two servers tells nothing twice
      if (was !== undefined && !newer(v, was)) return null;
      d.version = v;
      if (was !== undefined) d.newSince = d.newSince !== undefined && newer(was, d.newSince) ? d.newSince : was;
      return was ?? null;
    });
  }
}
