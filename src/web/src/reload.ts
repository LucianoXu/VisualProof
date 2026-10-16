// The page following its server into another version (UpdateSpec decision 8). The server says which
// VisualProof it runs as each event stream opens (`hello`); a page of another version — its server
// restarted into a patch, or was upgraded by hand — reloads itself where it is, so that it never runs
// old code against a new server. What the address and the browser's storage keep comes back by
// itself (the view, the mode, the selection, the camera, the tabs); what this page alone holds is
// kept here for the reload (Kept: the source windows, the drafts of comments and messages, a
// read-only reader's notes opened or collapsed). The reload waits while it would cut something short
// — text being typed, a drag, the export window, the artwork mode, the linear form — the build pill
// meanwhile offering it ("Updated — reload").
//
// This is the logic alone, with no page in it, so that it is tested without a browser
// (test/reload.test.ts); web/src/main.ts wires it.

declare const __VP_VERSION__: string | undefined;

/** The VisualProof version this page's code is of, as it was bundled (server/pipeline.ts); null
 *  outside a bundle (a test). */
export const PAGE_VERSION: string | null = typeof __VP_VERSION__ === "string" ? __VP_VERSION__ : null;

/** What this page alone holds, kept across its reload into a new version. */
export interface Kept {
  /** the project it is of */
  root: string;
  at: number;
  /** the source windows, by their declarations' names */
  sources: { following: { name: string; collapsed: boolean } | null; pinned: { name: string; collapsed: boolean }[] };
  /** the drafts of comments, by what they are about (web/src/reviewbox.ts) */
  review: [string, string][];
  /** the drafts of messages to agents, by agent (web/src/talk.ts) */
  talk: [string, string][];
  /** a read-only reader's notes opened or collapsed, by id */
  notes: [string, boolean][];
}

const KEY = "visualproof:reload";
/** the version this tab last reloaded for: a page whose code is still not of it after the reload
 *  (a package built with another version than it says) does not reload again, and again */
const FOR_KEY = "visualproof:reloaded-for";
/** what is kept is taken back this long after, at most: a reload, not a visit days later */
const FRESH_MS = 10 * 60_000;

/** The storage it is kept in: the tab's own (sessionStorage), which may refuse. */
export interface KeptStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const session = (): KeptStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export function keep(k: Kept, storage: KeptStorage | null = session()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(k));
  } catch {
    // full or refused: the reload goes on, without them
  }
}

const pairs = <V>(x: unknown, ok: (v: unknown) => v is V): [string, V][] =>
  Array.isArray(x) ? x.filter((p): p is [string, V] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && ok(p[1])) : [];
const isString = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const win = (v: unknown): { name: string; collapsed: boolean } | null =>
  v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? { name: (v as { name: string }).name, collapsed: (v as { collapsed?: unknown }).collapsed === true } : null;

/** What was kept for this page's project by the reload that made it, once: taken out as it is read. */
export function takeKept(root: string, now = Date.now(), storage: KeptStorage | null = session()): Kept | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY) ?? null;
    storage?.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as Partial<Kept> & { sources?: { following?: unknown; pinned?: unknown } };
    if (k.root !== root || typeof k.at !== "number" || now - k.at > FRESH_MS || now < k.at) return null;
    const pinned = Array.isArray(k.sources?.pinned) ? k.sources.pinned.map(win).filter((w): w is { name: string; collapsed: boolean } => w !== null) : [];
    return { root, at: k.at, sources: { following: win(k.sources?.following), pinned }, review: pairs(k.review, isString), talk: pairs(k.talk, isString), notes: pairs(k.notes, isBool) };
  } catch {
    return null;
  }
}

export interface ReloadHooks {
  /** what a reload would cut short now, in a few words, or null */
  busy(): string | null;
  /** what this page keeps across the reload */
  kept(): Kept;
  /** offer the reload (the build pill: "Updated — reload"), or no longer: null */
  offer(version: string | null): void;
  /** reload the page (location.reload) */
  reload(): void;
  storage?: KeptStorage | null;
}

/** how often a reload waiting for a moment looks again */
const RETRY_MS = 1000;

export class Reloader {
  /** the version the server runs, where it is another than this page's; null: none waits */
  wanted: string | null = null;
  private hooks: ReloadHooks;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private page: string | null;

  constructor(hooks: ReloadHooks, page: string | null = PAGE_VERSION) {
    this.hooks = hooks;
    this.page = page;
  }

  /** The server said which it is, as a stream opened: of another version, the page reloads into
   *  it as soon as nothing is cut short; of this page's (a step back meanwhile), nothing waits. */
  hello(server: { version: string; instance: string } | undefined): void {
    if (!server || !this.page) return;
    if (server.version === this.page) {
      if (this.wanted !== null) {
        this.wanted = null;
        this.stopWaiting();
        this.hooks.offer(null);
      }
      return;
    }
    this.wanted = server.version;
    this.attempt();
  }

  /** Reload now, keeping what this page holds: the reader asked (the pill), or nothing waits. */
  go(): void {
    this.stopWaiting();
    const storage = this.storage();
    keep(this.hooks.kept(), storage);
    try {
      if (this.wanted !== null) storage?.setItem(FOR_KEY, this.wanted);
    } catch {
      // refused: a reload that brings no new code may come again
    }
    this.hooks.reload();
  }

  private storage(): KeptStorage | null {
    return this.hooks.storage === undefined ? session() : this.hooks.storage;
  }

  private attempt(): void {
    if (this.wanted === null) return;
    let done: string | null = null;
    try {
      done = this.storage()?.getItem(FOR_KEY) ?? null;
    } catch {
      // none known
    }
    // reloaded for this version already, and this page still is not of it: once is enough
    if (done === this.wanted) return;
    if (this.hooks.busy() === null) return this.go();
    this.hooks.offer(this.wanted);
    this.stopWaiting();
    this.timer = setTimeout(() => this.attempt(), RETRY_MS);
  }

  private stopWaiting(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
