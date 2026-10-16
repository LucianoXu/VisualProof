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

export class TipState {
  private d: Kept = { shown: {}, counts: {}, done: [] };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && typeof o === "object") {
        const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
        const numbers = (x: unknown): Record<string, number> =>
          x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter((e): e is [string, number] => Number.isInteger(e[1]) && e[1] > 0)) : {};
        this.d = { shown: numbers(o.shown), counts: numbers(o.counts), done: ids(o.done), off: o.off === true || undefined, version: typeof o.version === "string" ? o.version : undefined, newSince: typeof o.newSince === "string" ? o.newSince : undefined };
      }
    } catch {
      // nothing kept
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.d));
    } catch {
      // not kept
    }
  }

  isDone(id: string): boolean {
    return this.d.done.includes(id);
  }

  done(id: string): void {
    if (this.isDone(id)) return;
    this.d.done.push(id);
    this.save();
  }

  /** A tip shown in place: the second time, it is done, answered or not. */
  shown(id: string): void {
    const n = (this.d.shown[id] ?? 0) + 1;
    this.d.shown[id] = n;
    if (n >= 2 && !this.d.done.includes(id)) this.d.done.push(id);
    this.save();
  }

  /** One more of what a rule counts; how many now. */
  bump(name: string): number {
    const n = (this.d.counts[name] ?? 0) + 1;
    this.d.counts[name] = n;
    this.save();
    return n;
  }

  get off(): boolean {
    return this.d.off === true;
  }

  set off(v: boolean) {
    this.d.off = v || undefined;
    this.save();
  }

  /** The releases New is told against: tips newer than `since` are New; null when none is. */
  get newSince(): string | null {
    return this.d.newSince ?? null;
  }

  /** Tips has been looked at: nothing is New any more. */
  newLooked(): void {
    if (this.d.newSince === undefined) return;
    this.d.newSince = undefined;
    this.save();
  }

  /** The server runs release `v`: the release this browser saw before it when it is newer (What's
   *  new is told), else null. A first visit records it and tells nothing. */
  meet(v: string): string | null {
    const was = this.d.version;
    if (was === v) return null;
    // an older server (another one, or a step back): nothing told, and the newest seen kept, so that
    // going between two servers tells nothing twice
    if (was !== undefined && !newer(v, was)) return null;
    this.d.version = v;
    if (was !== undefined) this.d.newSince = this.d.newSince !== undefined && newer(was, this.d.newSince) ? this.d.newSince : was;
    this.save();
    return was ?? null;
  }
}
