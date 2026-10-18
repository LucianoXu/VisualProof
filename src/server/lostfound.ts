// The lost-and-found as the server answers it (HistorySpec decisions 12–14): the entries of
// shared/lostfound.ts — what was said of a declaration the graph no longer has — grouped by the name
// they are under, each name with the newest build that had it and the renames of medium confidence
// suggested for it; every migration, the server's and those made by hand; and what is archived.
//
// The archive is the one thing kept: `<site>/history/archive.jsonl`, one line per archiving or
// putting back, `{key, on, by, agent?, person?, at}`, appended and never rewritten; the last line of
// a key is its state. Archiving hides an entry from the list and changes nothing about the thing
// itself, which stays where it is, in the review's logs or on its view. It is shared, as the review
// is: everyone on the server sees the same list.
//
// An archiving is recorded as the review's actions are, under the name of whoever made it, which it
// needs, a private reader's too (CollabSpec decision 8), with the personal link of someone invited
// by one (decision 9): it hides what someone said from everyone's list, and the review says who
// said what; Attach to…, the other thing done to an entry, is a move in the review's logs.

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { lostEntries, lostKey } from "../shared/lostfound.ts";
import type { ArchiveLine, LastHad, LostAnswer, LostEntry, LostGroup, LostMigration, LostSuggestion, PinWho } from "../shared/lostfound.ts";
import type { ClusterMode } from "../shared/graph.ts";
import type { ReviewData } from "../shared/review.ts";
import type { ViewData } from "../shared/views.ts";
import type { ProjectNote } from "../shared/projectnotes.ts";
import type { Mover } from "./historyapi.ts";

/** the most keys one request archives or puts back */
export const MAX_ARCHIVE_KEYS = 500;
const KEY = /^(opinion|target|key|pin|note|link|move):/;

/** Whether a string can be an entry's key: one of the kinds, and short enough to keep. */
export function validKey(k: unknown): k is string {
  return typeof k === "string" && k.length <= 5000 && KEY.test(k) && !/[\n\r]/.test(k);
}

export class Archive {
  readonly file: string;
  /** the last line of each key */
  private last = new Map<string, ArchiveLine>();

  constructor(historyDir: string) {
    this.file = join(historyDir, "archive.jsonl");
    if (!existsSync(this.file)) return;
    for (const l of readFileSync(this.file, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l) as Partial<ArchiveLine>;
        if (validKey(o.key) && typeof o.on === "boolean" && typeof o.by === "string" && typeof o.at === "string") this.last.set(o.key, o as ArchiveLine);
      } catch {
        // a line cut short (the server stopped while writing): left out
      }
    }
  }

  /** The keys archived now, with the line that archived each. */
  archived(): Map<string, ArchiveLine> {
    return new Map([...this.last].filter(([, l]) => l.on));
  }

  /** Whether `key` is archived now: its line, or null. */
  get(key: string): ArchiveLine | null {
    const l = this.last.get(key);
    return l?.on ? l : null;
  }

  /** Archive the keys, or put them back (`on` false), under `who`: a line for each whose state
   *  changes; the lines written. */
  set(keys: string[], on: boolean, who: Mover, now = new Date().toISOString()): ArchiveLine[] {
    const lines: ArchiveLine[] = [];
    for (const key of new Set(keys)) {
      if (!!this.get(key) === on) continue;
      lines.push({ key, on, by: who.name, ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}), at: now });
    }
    if (!lines.length) return lines;
    mkdirSync(join(this.file, ".."), { recursive: true });
    // after a line cut short (the server stopped while writing), on a line of its own
    appendFileSync(this.file, (endsLine(this.file) ? "" : "\n") + lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    for (const l of lines) this.last.set(l.key, l);
    return lines;
  }
}

/** Whether a file is empty, missing, or ends with a line break: what is appended to one that does not
 *  (a line cut short as the server stopped) starts a line of its own (server/renames.ts too). */
export function endsLine(file: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return true;
  }
  try {
    const size = fstatSync(fd).size;
    if (!size) return true;
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

/** What the lost-and-found is computed from. */
export interface LostWorld {
  review: ReviewData;
  views: readonly ViewData[];
  /** the project's notes (AttachmentSpec decision 13): their mentions are lost as a view note's are */
  notes?: readonly ProjectNote[];
  /** whether the graph on show has a declaration of that name */
  has(name: string): boolean;
  /** the newest build that had a name, and its module there (server/history.ts, `lastHad`) */
  last(name: string): LastHad | null;
  /** the modules the graph on show could not read */
  missing: readonly string[];
  pinWho?(view: string, mode: ClusterMode, name: string): PinWho | null;
  /** what a view is called (shared/views.ts, viewTitle, told with the graph on show's names) */
  title?(v: ViewData): string;
  /** whether view `v` is kept at a past build that had a declaration named `name`
   *  (server/views.ts `pastOf`, server/history.ts `hadAt`) */
  atBuild?(v: ViewData, name: string): boolean;
  /** whether the graph on show has a cluster: by namespace (`ns`) or by file (`file`), its key */
  hasCluster?(kind: "ns" | "file", key: string): boolean;
  migrations: readonly LostMigration[];
  /** the suggestions not acted on (server/live.ts, `moves`) */
  suggestions: readonly { from: string; to: string; score?: number; why: string; snap: number }[];
  archive: Archive | null;
}

/** The lost-and-found: the entries not archived by the name they are under, the migrations not
 *  archived, what is archived, and what is set aside — entries of a declaration that was, in the
 *  newest build that had it, in a file the graph on show could not read: it did not vanish
 *  (HistorySpec decision 6). */
export function lostAndFound(w: LostWorld): LostAnswer {
  const archived = w.archive?.archived() ?? new Map<string, ArchiveLine>();
  // an opinion's archiving under a name its writer went by before stands
  const lineOf = (e: { key: string; aliases?: string[] }): ArchiveLine | null => {
    for (const k of [e.key, ...(e.aliases ?? [])]) {
      const l = archived.get(k);
      if (l) return l;
    }
    return null;
  };
  const lasts = new Map<string, LastHad | null>();
  const last = (name: string) => {
    if (!lasts.has(name)) lasts.set(name, w.last(name));
    return lasts.get(name)!;
  };
  // a note's mention counts where it names what was a declaration, in some build the history kept:
  // anything else in backticks is code
  const entries = lostEntries(w.review, w.views, w.has, (name) => last(name) !== null, w.pinWho, w.title, w.atBuild, w.notes, w.hasCluster ? (k, key) => w.hasCluster!(k, key) : null);
  const missing = new Set(w.missing);
  const aside = { entries: 0, modules: new Set<string>() };
  const groups = new Map<string, LostGroup>();
  const out: LostAnswer = { lost: [], migrations: [], archived: [], aside: { entries: 0, modules: [] }, count: 0 };
  const shown: { key: string; line: ArchiveLine; entry?: LostEntry; migration?: LostMigration }[] = [];
  for (const e of entries) {
    const l = last(e.name);
    if (l && missing.has(l.module)) {
      aside.entries++;
      aside.modules.add(l.module);
      continue;
    }
    const line = lineOf(e);
    if (line) {
      shown.push({ key: e.key, line, entry: e });
      continue;
    }
    let g = groups.get(e.name);
    if (!g) groups.set(e.name, (g = { name: e.name, last: l, suggestions: [], entries: [] }));
    g.entries.push(e);
  }
  for (const s of w.suggestions) {
    const g = groups.get(s.from);
    if (g && !g.suggestions.some((x) => x.to === s.to)) g.suggestions.push({ to: s.to, score: s.score ?? 0, why: s.why, snap: s.snap } satisfies LostSuggestion);
  }
  for (const g of groups.values()) g.suggestions.sort((a, b) => b.score - a.score || (a.to < b.to ? -1 : 1));
  out.lost = [...groups.values()];
  for (const m of [...w.migrations].reverse()) {
    const key = lostKey.move(m.id);
    const line = archived.get(key);
    if (line) shown.push({ key, line, migration: m });
    else out.migrations.push({ ...m, key });
  }
  out.archived = shown.sort((a, b) => (a.line.at < b.line.at ? 1 : a.line.at > b.line.at ? -1 : 0));
  out.aside = { entries: aside.entries, modules: [...aside.modules].sort() };
  out.count = out.lost.reduce((n, g) => n + g.entries.length, 0) + out.migrations.length;
  return out;
}

/** The keys an archiving or a putting back names in the lost-and-found as it is: archiving takes an
 *  entry or a migration listed and not archived, putting back one archived (an opinion under any
 *  of its keys). The keys to write, or why not. */
export function archiveKeys(a: LostAnswer, keys: string[], on: boolean, archive: Archive): string[] | string {
  const listed = new Map<string, { aliases?: string[] }>();
  for (const g of a.lost) for (const e of g.entries) listed.set(e.key, e);
  for (const m of a.migrations) listed.set(m.key, {});
  const held = new Map<string, { aliases?: string[] }>();
  for (const x of a.archived) held.set(x.key, x.entry ?? {});
  const out: string[] = [];
  for (const k of keys) {
    if (on) {
      if (held.has(k)) continue;
      if (!listed.has(k)) return `There is no entry ${k.slice(0, 300)} in the lost-and-found now (GET /api/history/lost lists them).`;
      out.push(k);
    } else {
      const e = held.get(k);
      if (!e) {
        if (listed.has(k)) continue;
        return `There is no archived entry ${k.slice(0, 300)} (GET /api/history/lost lists them under archived).`;
      }
      // the line that archived it may be under a name its writer went by before
      for (const x of [k, ...(e.aliases ?? [])]) if (archive.get(x)) out.push(x);
    }
  }
  return out;
}
