// Renames (HistorySpec.md, decided by the owner on 2026-10-09). On each new graph, the declarations
// that vanished since the build before are paired with those that appeared:
//
// - **High confidence**: the same version once names are mapped — the same content, with what it
//   refers to the same, the declaration itself and what was renamed with it set aside (TCBSpec
//   decision 3) — and the same kind, one declaration on each side. A pairing can make another
//   (what refers to a renamed declaration is known once that one is), so it is found again until
//   nothing more pairs. Against a build read before versions, the same kernel's hash stands for it.
//   Such a rename is migrated by itself (server/live.ts): a move in the server's log where something
//   was said of the declaration or of what refers to it, and its pins, its notes' mentions and its
//   views' scopes moved on the server (server/views.ts) — each recorded here, with what undoes it.
// - **Medium confidence**: what is alike without being the same — the same last name, the same
//   module, nearby, a statement that reads alike, or content the same as several others'. Offered as
//   suggestions, never applied.
//
// What a module of either build that could not be read held is set aside: it did not vanish.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SnapGraph, SnapNode } from "./history.ts";
import { endsLine } from "./lostfound.ts";
import { refIdentity, versionOf } from "./versions.ts";
import type { Identity } from "./versions.ts";
import type { ViewOp } from "../shared/views.ts";
import type { ProjectNoteOp } from "../shared/projectnotes.ts";

export interface Pairing {
  from: string;
  to: string;
  confidence: "high" | "medium";
  /** why: `same version` (content and references, names aside), `same kernel hash` (against a
   *  build read before versions); for a suggestion, its clues, as words */
  why: string;
  /** a suggestion's likeness, 0 to 1 */
  score?: number;
}

/** What stands for the declaration itself in its own references, so that a declaration can be
 *  paired before its own rename is known. */
const SELF = "\u0000self";
/** the least likeness a suggestion has */
export const SUGGEST_FROM = 0.6;
/** the most candidates a vanished declaration is compared with for a suggestion */
const MAX_CANDIDATES = 200;

const last = (name: string) => name.slice(name.lastIndexOf(".") + 1);
const tail = (module: string) => module.slice(module.lastIndexOf(".") + 1);

/** The words a statement is written with, dotted names by their last part: what two statements
 *  are compared by. */
function words(type: string): Set<string> {
  return new Set(type.replace(/[\p{L}_][\p{L}\p{N}_'!?.₀-₉]*/gu, (m) => last(m)).split(/[\s()[\]{}:,]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

/** The pairs of `before`'s vanished declarations with `after`'s new ones, high confidence first.
 *  `identity`: the renames in force before these (server/versions.ts). */
export function findRenames(before: SnapGraph, after: SnapGraph, identity: Identity): Pairing[] {
  const proj = (g: SnapGraph) => g.nodes.slice(0, g.projectCount);
  const inBefore = new Set(proj(before).map((n) => n.name));
  const inAfter = new Set(proj(after).map((n) => n.name));
  const unreadAfter = new Set(after.info.missing);
  const unreadBefore = new Set(before.info.missing);
  const gone = proj(before).filter((n) => !inAfter.has(n.name) && !unreadAfter.has(n.module));
  const came = proj(after).filter((n) => !inBefore.has(n.name) && !unreadBefore.has(n.module));
  if (!gone.length || !came.length) return [];
  // after's new names → the names they had, as found so far
  const was = new Map<string, string>();
  const used = new Set<string>();
  const out: Pairing[] = [];
  const shapeKey = (n: SnapNode, map: Identity) =>
    n.shape && n.refs ? `${n.kind}|${versionOf(n.shape, n.refs.map((r) => refIdentity(r, (u) => (u === n.name ? SELF : map(u)))))}` : null;
  const pairUnique = (key: (n: SnapNode, side: "before" | "after") => string | null, why: string): number => {
    const byKey = new Map<string, { b: SnapNode[]; a: SnapNode[] }>();
    const add = (n: SnapNode, side: "b" | "a") => {
      const k = key(n, side === "b" ? "before" : "after");
      if (k === null) return;
      let e = byKey.get(k);
      if (!e) byKey.set(k, (e = { b: [], a: [] }));
      e[side].push(n);
    };
    for (const n of gone) if (!used.has(n.name)) add(n, "b");
    for (const n of came) if (!was.has(n.name)) add(n, "a");
    let made = 0;
    for (const { b, a } of byKey.values()) {
      if (b.length !== 1 || a.length !== 1) continue;
      was.set(a[0].name, b[0].name);
      used.add(b[0].name);
      out.push({ from: b[0].name, to: a[0].name, confidence: "high", why });
      made++;
    }
    return made;
  };
  // the same version, names aside, again as long as a pairing makes another
  const afterIdentity: Identity = (u) => identity(was.get(u) ?? u);
  while (pairUnique((n, side) => shapeKey(n, side === "before" ? identity : afterIdentity), "same version") > 0);
  // against a build read before versions: the same kernel's hash, which a rename of what it refers
  // to changes, but a rename of the declaration alone does not where it does not mention itself
  if (!(proj(before).some((n) => n.shape) && proj(after).some((n) => n.shape))) pairUnique((n) => `${n.kind}|k:${n.hash}`, "same kernel hash");

  // suggestions: alike, not the same
  const rest = gone.filter((n) => !used.has(n.name));
  const open = came.filter((n) => !was.has(n.name));
  if (!rest.length || !open.length) return out;
  const byLast = new Map<string, SnapNode[]>();
  const byModule = new Map<string, SnapNode[]>();
  const byShape = new Map<string, SnapNode[]>();
  for (const n of open) {
    for (const [m, k] of [[byLast, `${n.kind}|${last(n.name)}`], [byModule, `${n.kind}|${n.module}`]] as const) {
      const xs = m.get(k);
      if (xs) xs.push(n);
      else m.set(k, [n]);
    }
    const sk = shapeKey(n, afterIdentity);
    if (sk) byShape.set(sk, [...(byShape.get(sk) ?? []), n]);
  }
  const text = new Map<SnapNode, Set<string>>();
  const wordsOf = (n: SnapNode) => text.get(n) ?? (text.set(n, words(n.type)), text.get(n)!);
  const offers: Pairing[] = [];
  for (const v of rest) {
    const sk = shapeKey(v, identity);
    const sameContent = new Set(sk ? byShape.get(sk) ?? [] : []);
    const cands = new Set([...(byLast.get(`${v.kind}|${last(v.name)}`) ?? []), ...(byModule.get(`${v.kind}|${v.module}`) ?? []), ...sameContent]);
    let best: Pairing | null = null;
    let k = 0;
    for (const w of cands) {
      if (k++ >= MAX_CANDIDATES) break;
      const clues: string[] = [];
      let score = 0;
      if (last(w.name) === last(v.name)) (score += 0.4), clues.push("the same last name");
      if (w.module === v.module) {
        score += 0.15;
        clues.push("the same module");
        if (w.range && v.range && Math.abs(w.range[0] - v.range[0]) <= 30) (score += 0.05), clues.push("nearby");
      } else if (tail(w.module) === tail(v.module)) (score += 0.1), clues.push("a file of the same name");
      const sim = jaccard(wordsOf(v), wordsOf(w));
      score += 0.4 * sim;
      if (sim >= 0.8) clues.push("a statement that reads alike");
      if (sameContent.has(w)) (score = Math.max(score, 0.8)), clues.push("the same content as others");
      score = Math.min(1, Math.round(score * 100) / 100);
      if (score >= SUGGEST_FROM && (!best || score > best.score!)) best = { from: v.name, to: w.name, confidence: "medium", why: clues.join(", "), score };
    }
    if (best) offers.push(best);
  }
  // each new declaration offered once, to the one it is likest
  offers.sort((p, q) => q.score! - p.score! || (p.from < q.from ? -1 : 1));
  const taken = new Set<string>();
  for (const p of offers) {
    if (taken.has(p.to)) continue;
    taken.add(p.to);
    out.push(p);
  }
  return out;
}

/** A rename the server migrated by itself, or a move a person or an agent made (Attach to…),
 *  as the lost-and-found lists it: what moved, what it carried, and what undoes it. */
export interface Migration {
  id: string;
  at: string;
  from: string;
  to: string;
  /** the snapshot it was found at; absent for one made by hand */
  snap?: number;
  /** who made it: VisualProof for a rename it found, else the person or agent */
  by: string;
  agent?: true;
  /** made by someone invited by a personal link: the link's id (CollabSpec decision 9) */
  person?: string;
  /** a rename found, with why it is sure (Pairing.why) */
  auto?: string;
  /** `to` is `from` renamed: what refers to it keeps its version */
  rename: boolean;
  /** whether a move was appended to the review's logs: where something was said of it, or of what
   *  refers to it (a rename's identity keeps their versions) */
  review: boolean;
  /** what it carried, counted: opinions (comments with them), target marks, key marks, notes that
   *  mention it, pins, views whose scope names it, and a target's view, which goes with it
   *  (`reviewViews`) */
  carried: { opinions: number; targets: number; keys: number; notes: number; pins: number; scopes: number; reviewViews: number };
  /** per view, the operations it applied, a scope it changed (before, after) and whether it moved its
   *  focus — view "" for the project's notes it edited (AttachmentSpec decision 13): its undoing
   *  moves back what they moved (server/views.ts, `unmoveDeclaration`) */
  views: { view: string; ops: (ViewOp | ProjectNoteOp)[]; scope?: [string, string]; focus?: true }[];
  /** undone: by whom and when (an un-move in their log) */
  undone?: { by: string; agent?: true; person?: string; at: string };
}

/** The migrations and suggestions, kept in `<site>/history/`: `migrations.jsonl`, one line per
 *  migration and one per undoing (`{undo, by, agent?, person?, at}`); `renames.jsonl`, one line per
 *  graph read with the pairs found against the build before (`{snap, at, pairs}`). Appended, never
 *  rewritten. */
export class Renames {
  private migFile: string;
  private pairFile: string;
  readonly migrations: Migration[] = [];
  private byId = new Map<string, Migration>();
  /** per snapshot, the pairs found at it (each read of its build adds its own) */
  readonly found = new Map<number, Pairing[]>();

  constructor(historyDir: string) {
    this.migFile = join(historyDir, "migrations.jsonl");
    this.pairFile = join(historyDir, "renames.jsonl");
    for (const l of lines(this.migFile)) {
      const o = l as Partial<Migration> & { undo?: string; by?: string; at?: string; agent?: true; person?: string };
      if (typeof o.undo === "string") {
        const m = this.byId.get(o.undo);
        if (m && typeof o.by === "string" && typeof o.at === "string") m.undone = { by: o.by, ...(o.agent ? { agent: true as const } : {}), ...(typeof o.person === "string" ? { person: o.person } : {}), at: o.at };
      } else if (typeof o.id === "string" && typeof o.from === "string" && typeof o.to === "string") {
        this.migrations.push(o as Migration);
        this.byId.set(o.id, o as Migration);
      }
    }
    for (const l of lines(this.pairFile)) {
      const o = l as { snap?: unknown; pairs?: unknown };
      if (Number.isInteger(o.snap) && Array.isArray(o.pairs)) this.add(o.snap as number, o.pairs as Pairing[]);
    }
  }

  private add(snap: number, pairs: Pairing[]): void {
    const was = this.found.get(snap) ?? [];
    const seen = new Set(was.map((p) => `${p.from}\u0000${p.to}`));
    this.found.set(snap, [...was, ...pairs.filter((p) => !seen.has(`${p.from}\u0000${p.to}`))]);
  }

  /** The pairs found at a graph read of snapshot `snap`'s build. */
  record(snap: number, pairs: Pairing[]): void {
    if (!pairs.length) return;
    append(this.pairFile, { snap, at: new Date().toISOString(), pairs });
    this.add(snap, pairs);
  }

  get(id: string): Migration | null {
    return this.byId.get(id) ?? null;
  }

  /** A migration made: kept, under the next id. */
  migrated(m: Omit<Migration, "id">): Migration {
    const full = { id: `m${this.migrations.length + 1}`, ...m } as Migration;
    append(this.migFile, full);
    this.migrations.push(full);
    this.byId.set(full.id, full);
    return full;
  }

  /** A migration undone (`person`: by someone invited by a personal link, the link's id). */
  undone(id: string, by: string, agent: boolean, person?: string): void {
    const m = this.byId.get(id);
    if (!m) return;
    const at = new Date().toISOString();
    const who = { by, ...(agent ? { agent: true as const } : {}), ...(person ? { person } : {}) };
    append(this.migFile, { undo: id, ...who, at });
    m.undone = { ...who, at };
  }

  /** The renames of high confidence found from snapshot `from` to snapshot `to`, composed along the
   *  builds between: a name at `from` → its name at `to`. `order`: the snapshots' ids, oldest
   *  build first. */
  between(from: number, to: number, order: number[]): Map<string, string> {
    const i = order.indexOf(from), j = order.indexOf(to);
    const out = new Map<string, string>();
    if (i < 0 || j < 0 || j <= i) return out;
    for (const id of order.slice(i + 1, j + 1)) {
      const step = new Map((this.found.get(id) ?? []).filter((p) => p.confidence === "high").map((p) => [p.from, p.to]));
      // a name renamed before goes on from its name now; any other starts from its name at `from`
      const now = new Set(out.values());
      for (const [a, b] of out) if (step.has(b)) out.set(a, step.get(b)!);
      for (const [a, b] of step) if (!now.has(a) && !out.has(a)) out.set(a, b);
    }
    return out;
  }
}

/** A line appended to one of the files: after a line cut short (the server stopped while writing),
 *  on a line of its own, so that the line cut short alone is lost, never the one written after it. */
function append(file: string, o: object): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, (endsLine(file) ? "" : "\n") + JSON.stringify(o) + "\n");
}

function lines(file: string): unknown[] {
  if (!existsSync(file)) return [];
  const out: unknown[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // a line cut short (the server stopped while writing): left out
    }
  }
  return out;
}
