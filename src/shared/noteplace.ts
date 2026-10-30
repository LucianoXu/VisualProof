// Where a note is on a board, and which boards show it (AttachmentSpec decisions 15–19, the owner's
// of 2026-10-11), as pure rules run the same in the pages, on the server (the agents' API, the
// export's authors, a build carrying notes) and in the tests.
//
// A board is read here by its keys: every cluster key of either clustering that holds one of its
// declarations, in the tree before chains are merged and levels hidden (shared/layout.ts,
// innerKeys), and for each key of the board's own clustering the circle drawn for it — itself; the
// circle a chain of clusters holding one cluster each was merged into, which counts as each of
// them; the nearest drawn circle around a hidden level (ViewSpec decision 24); or the top level.
//
// Which boards show a note of the project (decision 17, the owner's decision of 2026-10-11: items
// belong to views as declarations do): the Project shows every one. Any other board shows one that
// follows from its scope — attached to a declaration on the board; in a cluster that is on the
// board; on the ring under the board's
// clustering, where its cluster under the other clustering has a declaration on the board; or
// carrying a file linked (decision 4) to a declaration or a cluster on the board — or that was added
// to its view, unless it was taken out of it (shared/items.ts). A note that names a declaration in
// backticks is not connected to it. Read live, as a scope is: a link made or gone, a note moved,
// shows or hides it at once.
//
// - A project note in a cluster under the board's clustering that the board draws is at its spot
//   of the circle drawn for it: the spot is kept as a fraction of each circle's radius, so it is the
//   same spot on every board whatever the circle's size, and it is brought inside the circle as
//   drawn. A cluster that is gone from the board's graph (a build that took it away) gives way to
//   the nearest one around it that is still there, at the spot the note had in it; none left, the
//   note is at the top level.
// - At the top level, or shown on a board that does not draw its cluster (added, or through a
//   link), it is on the ring: at the angle where it was let go, else toward what it carries a file
//   linked to on this board, else at the angle of the centre of the declarations its cluster under
//   the other clustering holds on the board (decision 16), else in the order notes were written.
// - A view note under its own clustering is where it always was (shared/sticky.ts); under the other
//   it is on the ring about the cluster it was put in, never in a cluster of the same key. View notes
//   are their view's alone, and none of the rules of items touches them (decision 14).
// - A note of either kind attached to a declaration (the owner's decision of 2026-10-12) is at that
//   declaration wherever the board holds it — a reader's visitor counts — under every clustering,
//   and a board that holds the declaration shows a note of the project attached to it (the derived
//   clause of items). A board of a past build reads the declaration by its name in that build. Where
//   the board's graph does not have the declaration (gone, with no rename carrying the note), the note
//   is on the ring, still attached, toward the cluster its place had it in (the owner's decision of
//   2026-10-30), shown on the boards its places show it on (decision 18), and at the declaration
//   again should it come back; where the graph has it but the board does not, a note of the project
//   shows only where it is linked or added, on the ring, and a view note where its place puts it.
//
// A key is never matched across clusterings: a namespace and a folder may share a key.

import type { ClusterMode, Layout, ViewNode } from "./graph.ts";
import { itemIn } from "./items.ts";
import type { ViewItems } from "./items.ts";
import { clusterKeys, innerKeys, splitName } from "./layout.ts";
import { parseSubject } from "./library.ts";
import type { ClusterPlace, ProjectNote } from "./projectnotes.ts";
import { resolvePlace } from "./sticky.ts";
import type { NoteDecl, PlaceCluster, StickyNote } from "./sticky.ts";

export const otherMode = (m: ClusterMode): ClusterMode => (m === "namespace" ? "module" : "namespace");

type NodeLike = Pick<ViewNode, "name" | "module" | "ext">;

/** A cluster key and every key around it, innermost first ("" has none). */
export function keyChain(key: string): string[] {
  if (!key) return [];
  const parts = splitName(key);
  const out: string[] = [];
  for (let k = parts.length; k > 0; k--) out.push(parts.slice(0, k).join("."));
  return out;
}

/** A board as notes read it (see the head of this file). */
export interface NoteBoard {
  mode: ClusterMode;
  /** each declaration's innermost key by either clustering, in the board's numbering */
  inner: Record<ClusterMode, string[]>;
  /** per clustering, every key that holds a declaration of the board */
  on: Record<ClusterMode, Set<string>>;
  /** per key of the board's clustering on it, the cluster of the layout drawn for it, -1 for the
   *  top level */
  stands: Map<string, number>;
  /** the layout's clusters' keys: a circle's key is the deepest of the keys merged into it */
  keys: string[];
  /** each declaration of the board by its name, in the board's numbering: what a link to one
   *  reaches, and a note attached to one */
  index: Map<string, number>;
  /** on a board of a past build, and with the reader's visitors: as ItemBoard says */
  then?: ReadonlyMap<string, string>;
  visiting?: ReadonlySet<string>;
}

/** Whether key `k` is circle `c` of board `b` — the circle itself, or a key a chain merged into it —
 *  rather than a hidden level that only stands in it. */
export function counts(b: Pick<NoteBoard, "stands" | "keys">, k: string, c: number): boolean {
  if (c < 0 || b.stands.get(k) !== c) return false;
  const own = b.keys[c];
  return own === k || own.startsWith(k + ".");
}

/** The board of layout `L` (drawn: chains merged, hidden levels out) by `mode`, of `nodes` (the
 *  board's declarations, in the layout's numbering). */
export function noteBoard(L: Pick<Layout, "cluster" | "clusters">, mode: ClusterMode, nodes: NodeLike[]): NoteBoard {
  const inner = { namespace: innerKeys("namespace", nodes), module: innerKeys("module", nodes) };
  const on = { namespace: new Set<string>(), module: new Set<string>() };
  const stands = new Map<string, number>();
  // the innermost circle that holds every declaration a key holds on the board
  const meet = (a: number, b: number): number => {
    while (a !== b) {
      if (a < 0 || b < 0) return -1;
      if (L.clusters[a].depth >= L.clusters[b].depth) a = L.clusters[a].parent;
      else b = L.clusters[b].parent;
    }
    return a;
  };
  // the circle each innermost key's declarations meet in, then each key around it: a key and its
  // chain worked out once, however many declarations it holds
  const own = new Map<string, number>();
  inner[mode].forEach((key, j) => {
    const c = L.cluster[j] ?? -1;
    const was = own.get(key);
    own.set(key, was === undefined ? c : meet(was, c));
  });
  for (const [key, c] of own)
    for (const k of keyChain(key)) {
      const was = stands.get(k);
      stands.set(k, was === undefined ? c : meet(was, c));
    }
  for (const k of stands.keys()) on[mode].add(k);
  // the other clustering: only which keys hold something
  const other = otherMode(mode);
  for (const key of new Set(inner[other])) for (const k of keyChain(key)) on[other].add(k);
  return { mode, inner, on, stands, keys: L.clusters.map((c) => c.key), index: new Map(nodes.map((n, j) => [n.name, j])) };
}

/** The declarations of the board that key `key` holds by `mode`, in the board's numbering. */
export function membersOf(b: NoteBoard, mode: ClusterMode, key: string): number[] {
  const out: number[] = [];
  const pre = key + ".";
  b.inner[mode].forEach((k, j) => {
    if (k === key || k.startsWith(pre)) out.push(j);
  });
  return out;
}

/** The cluster that holds a note under `mode` on a graph (`exists`: whether a key is a cluster of
 *  that graph by that clustering): the first key of its place that is still one — its own, else the
 *  nearest around it that is left (decision 18) — and where it is in that place; null at the top
 *  level (on the ring, no place, or none of its clusters left). */
export function holderOf(place: ClusterPlace | undefined, mode: ClusterMode, exists: (mode: ClusterMode, key: string) => boolean): { key: string; at: number } | null {
  if (!place || !("in" in place)) return null;
  for (let k = 0; k < place.in.length; k++) if (exists(mode, place.in[k][0])) return { key: place.in[k][0], at: k };
  return null;
}

/** What a note on the ring is about on a board, which gives its angle and is lit while it is
 *  hovered: what it carries a file linked to on this board (`links`, the links' subjects), or a
 *  cluster by its clustering, or nothing (in the order notes were written). */
export type About = { mode: ClusterMode; key: string } | { links: string[] } | null;

/** Where a note is on a board, in the board's terms. */
export type NoteSpot =
  /** attached to a declaration of the board (`j`, its index; -1 for one of the reader's visitors, by
   *  `name`, the board's name for it), its icon at `d` from the point, in the board's units */
  | { at: "decl"; j: number; name: string; d: [number, number] }
  /** a project note in a cluster of the layout, at a fraction of its radius drawn */
  | { at: "cluster"; c: number; f: [number, number] }
  /** a view note in a cluster of the layout, at an offset in its local coordinates */
  | { at: "offset"; c: number; d: [number, number] }
  /** a view note on the canvas, at a spot of the board's world */
  | { at: "world"; x: number; y: number }
  /** on the ring: at an angle where it was let go (degrees clockwise from the top), or null: at the
   *  angle of what it is about, else in the order notes were written; `gone`, the declaration it is
   *  attached to, where the board's graph does not have it */
  | { at: "ring"; angle: number | null; about: About; gone?: string };

/** The links of the library by the file they point into: each file's subjects (`decl(X)`, `ns(P)`,
 *  `file(P)`), in the order the links were made, once each. */
export type LinkIndex = ReadonlyMap<string, readonly string[]>;

export function linksByFile(links: readonly { subject: string; file: string }[] | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of links ?? []) {
    const list = out.get(l.file) ?? [];
    if (!list.includes(l.subject)) list.push(l.subject);
    out.set(l.file, list);
  }
  return out;
}

/** A board as the rules of items read it: its clustering, the keys that hold its declarations by
 *  either clustering, and its declarations by name. A NoteBoard is one. On a board of a past build,
 *  `then` names each declaration renamed since by its name in that build (thenNames), as a note's
 *  attachment names it now; `visiting`, the reader's visitors on it by name, which count as the
 *  board's for a note attached to one (the page alone has them). */
export type ItemBoard = Pick<NoteBoard, "mode" | "on"> & { index: ReadonlyMap<string, number>; then?: ReadonlyMap<string, string>; visiting?: ReadonlySet<string> };

/** Whether a key is a cluster of a graph by a clustering (decision 18: whether a note's cluster is
 *  still one), and, where known (`decl`), whether a name is a declaration of that graph (whether the
 *  declaration a note is attached to is still there; unknown, it is taken to be). */
export type Exists = ((mode: ClusterMode, key: string) => boolean) & { decl?: (name: string) => boolean };

/** A past graph's renames (PastGraph.nowName: each declaration's name then to its name now) turned
 *  round: its name now to its name then, worked out once per map. */
const turned = new WeakMap<ReadonlyMap<string, string>, Map<string, string>>();
export function thenNames(nowName: ReadonlyMap<string, string> | undefined): ReadonlyMap<string, string> | undefined {
  if (!nowName?.size) return undefined;
  let t = turned.get(nowName);
  if (!t) turned.set(nowName, (t = new Map([...nowName].map(([then, now]) => [now, then]))));
  return t;
}

/** Where the declaration note `n` is attached to is for board `b`: on it (`j`, its index there, or
 *  -1 for one of the reader's visitors; `name`, the board's name for it); `off`, in the board's graph
 *  but not on the board; `gone`, not in the board's graph (`exists.decl`), no rename having carried
 *  the note; null where it is attached to none. */
export function declOf(n: { decl?: NoteDecl }, b: ItemBoard, exists: Exists): { j: number; name: string } | "off" | "gone" | null {
  if (!n.decl) return null;
  const name = b.then?.get(n.decl.name) ?? n.decl.name;
  const j = b.index.get(name);
  if (j !== undefined) return { j, name };
  if (b.visiting?.has(name)) return { j: -1, name };
  return exists.decl && !exists.decl(name) ? "gone" : "off";
}

/** The board of `nodes` (its declarations) by `mode`, read without laying it out: what holds what,
 *  not where (the agents' API and the export's authors, for a board they do not draw). */
export function itemBoard(mode: ClusterMode, nodes: readonly NodeLike[]): ItemBoard {
  const on = { namespace: new Set<string>(), module: new Set<string>() };
  for (const m of ["namespace", "module"] as ClusterMode[]) for (const key of new Set(innerKeys(m, nodes as NodeLike[]))) for (const k of keyChain(key)) on[m].add(k);
  return { mode, on, index: new Map(nodes.map((n, j) => [n.name, j])) };
}

/** The subjects of the links into the files note `n` carries (whole or as clips) that reach what
 *  board `b` holds: a declaration on it (`decl(X)`), a namespace (`ns(P)`; a structure is its
 *  namespace, so `ns(S)` reaches the structure `S` too) or a folder (`file(P)`) that holds one of its
 *  declarations. Once each, in the order of what it carries. */
export function linkedOn(n: Pick<ProjectNote, "carries">, b: ItemBoard, links: LinkIndex): string[] {
  const out: string[] = [];
  for (const c of n.carries ?? [])
    for (const subject of links.get(c.file) ?? []) {
      if (out.includes(subject)) continue;
      const s = parseSubject(subject);
      if (!s) continue;
      const on = s.kind === "decl" ? b.index.has(s.name) : s.kind === "ns" ? b.on.namespace.has(s.name) || b.index.has(s.name) : b.on.module.has(s.name);
      if (on) out.push(subject);
    }
  return out;
}

/** Why board `b` shows note `n` by what follows from its scope alone (decision 17): `decl`, it is
 *  attached to a declaration on the board (a reader's visitor counts; the owner's decision of
 *  2026-10-12); `cluster`, its cluster under the board's clustering is on the board; `ring`, it is at
 *  the top level under the board's clustering and its cluster under the other clustering has a
 *  declaration on the board; `link`, it carries a file linked to a declaration or a cluster on the
 *  board. Its places count only where it is attached to none, or its declaration is gone: attached to
 *  one off the board, that is where it is. Null where none does: at the top level under both
 *  clusterings, a note is the Project's, not every board's. */
export function derivedWhy(n: ProjectNote, b: ItemBoard, exists: Exists, links: LinkIndex): "decl" | "cluster" | "ring" | "link" | null {
  const at = declOf(n, b, exists);
  if (at && typeof at === "object") return "decl";
  if (at !== "off") {
    const h = holderOf(n.places[b.mode], b.mode, exists);
    if (h && b.on[b.mode].has(h.key)) return "cluster";
    if (!h) {
      const o = holderOf(n.places[otherMode(b.mode)], otherMode(b.mode), exists);
      if (o && b.on[otherMode(b.mode)].has(o.key)) return "ring";
    }
  }
  return linkedOn(n, b, links).length ? "link" : null;
}

/** Why a board shows a note of the project: the Project holds every one (`project`); any other
 *  board, what follows from its scope (derivedWhy) or what was added to its view (`added`), unless
 *  it was taken out of it. */
export type ItemWhy = "project" | "decl" | "cluster" | "ring" | "link" | "added";

/** Why the board of view `view` shows note `n`, or null where it does not (decision 17): `all`, the
 *  view holds everything (the Project); `items`, its lists (shared/items.ts). */
export function itemWhy(n: ProjectNote, view: { all: boolean; items?: ViewItems }, b: ItemBoard, exists: Exists, links: LinkIndex): ItemWhy | null {
  if (view.all) return "project";
  const listed = itemIn(view.items, n.id);
  if (listed === "remove") return null;
  return derivedWhy(n, b, exists, links) ?? (listed === "add" ? "added" : null);
}

/** The cluster keys of a whole graph by each clustering, and its declarations' names, worked out
 *  once per graph: whether a note's cluster is still one (decision 18), and whether the declaration
 *  a note is attached to is. */
const graphKeys = new WeakMap<object, Partial<Record<ClusterMode, Set<string>>> & { names?: Set<string> }>();
export function existsIn(full: readonly NodeLike[]): Exists {
  const keys = () => {
    const k = graphKeys.get(full) ?? {};
    graphKeys.set(full, k);
    return k;
  };
  const f: Exists = (m, key) => {
    const k = keys();
    return (k[m] ??= clusterKeys(m, full as ViewNode[])).has(key);
  };
  f.decl = (name) => {
    const k = keys();
    return (k.names ??= new Set(full.map((n) => n.name))).has(name);
  };
  return f;
}

/** Whether a board gives each note from what follows from its scope alone (derivedWhy), its view's
 *  lists left aside: what Add to view and Remove from this view decide by (shared/items.ts, itemOp),
 *  and which notes a copy of the Project takes as added. `nodes` its declarations, `exists` whether a
 *  key is a cluster of the whole graph it is of (existsIn), `mode` its clustering, `nowName` a past
 *  build's renames (PastGraph.nowName), under whose names then it reads a note's attachment. */
export function derivesOn(mode: ClusterMode, nodes: readonly NodeLike[], exists: Exists, links: readonly { subject: string; file: string }[] | undefined, nowName?: ReadonlyMap<string, string>): (n: ProjectNote) => boolean {
  const b: ItemBoard = { ...itemBoard(mode, nodes), then: thenNames(nowName) };
  const index = linksByFile(links);
  return (n) => derivedWhy(n, b, exists, index) !== null;
}

/** The project's notes the board of view `view` shows (decision 17), from what it holds alone,
 *  without laying it out: `nodes` its declarations, `full` those of the whole graph it is of, `mode`
 *  its clustering, `links` the library's links as that board reads them, `nowName` the renames of a
 *  past build it is of (PastGraph.nowName). What a view's exported document counts among its
 *  authors' traces (shared/doc/authors.ts). */
export function itemsShownOn(
  notes: readonly ProjectNote[],
  view: { all: boolean; items?: ViewItems },
  mode: ClusterMode,
  nodes: readonly NodeLike[],
  full: readonly ViewNode[],
  links: readonly { subject: string; file: string }[] | undefined,
  nowName?: ReadonlyMap<string, string>,
): ProjectNote[] {
  if (view.all || !notes.length) return [...notes];
  const derives = derivesOn(mode, nodes, existsIn(full), links, nowName);
  return notes.filter((n) => {
    const listed = itemIn(view.items, n.id);
    return listed !== "remove" && (listed === "add" || derives(n));
  });
}

/** Where project note `n` is on board `b`, which shows it (itemWhy): at the declaration it is
 *  attached to, where the board holds it (a visitor counts); attached to one the board's graph has
 *  but the board does not, on the ring, toward what it carries a file linked to on this board;
 *  attached to one the graph does not have (gone), on the ring, toward the cluster its places had it
 *  in (placedAbout), else toward what it carries a file linked to; else, attached to none, in its
 *  cluster under the board's clustering where the board draws it; else on the ring — at the angle
 *  where it was let go, else toward what it carries a file linked to on this board (`linked`,
 *  linkedOn), else about its cluster under the other clustering where that holds a declaration of
 *  the board (decision 16), else in the order notes were written. */
export function itemSpot(n: ProjectNote, b: NoteBoard, exists: Exists, linked: readonly string[] = []): NoteSpot {
  const at = declOf(n, b, exists);
  if (at && typeof at === "object") return { at: "decl", j: at.j, name: at.name, d: [n.decl!.at[0], n.decl!.at[1]] };
  if (at === "off") return { at: "ring", angle: null, about: linked.length ? { links: [...linked] } : null };
  // its declaration gone, no rename carrying it (the owner's decision of 2026-10-30): on the ring,
  // still attached, where the declaration was rather than at a spot that now holds other things
  if (at === "gone") return { at: "ring", angle: null, about: placedAbout(n.places, b, exists) ?? (linked.length ? { links: [...linked] } : null), gone: n.decl!.name };
  const m = b.mode;
  const place = n.places[m];
  const h = holderOf(place, m, exists);
  const c = h ? b.stands.get(h.key) : undefined;
  if (h && c !== undefined && place && "in" in place) {
    // its cluster stands at the top level here (a hidden top level): on the ring, about itself
    if (c < 0) return { at: "ring", angle: null, about: { mode: m, key: h.key } };
    // the spot it has in the circle drawn for it: the first of its keys that is that circle — a
    // hidden level is in the nearest drawn around it, at its spot there (decision 19) — else its own
    let f: [number, number] = [place.in[h.at][1], place.in[h.at][2]];
    for (let k = h.at; k < place.in.length; k++)
      if (counts(b, place.in[k][0], c)) {
        f = [place.in[k][1], place.in[k][2]];
        break;
      }
    return { at: "cluster", c, f: inside(f) };
  }
  // on the ring: the top level, or a board that does not draw its cluster (it was added, or a link
  // brought it)
  const o = holderOf(n.places[otherMode(m)], otherMode(m), exists);
  const about: About = linked.length ? { links: [...linked] } : o && b.on[otherMode(m)].has(o.key) ? { mode: otherMode(m), key: o.key } : null;
  return { at: "ring", angle: place && "ring" in place ? place.ring : null, about };
}

/** What a note on the ring whose declaration is gone is about (the owner's decision of 2026-10-30):
 *  the cluster its place puts it in — the innermost of its keys that is still a cluster and holds a
 *  declaration of board `b` —, under the board's clustering, else under the other; null where none
 *  does. A note attached to a declaration has its places beside it (declPlace), so this is where the
 *  declaration was. */
export function placedAbout(places: Partial<Record<ClusterMode, ClusterPlace>>, b: Pick<NoteBoard, "mode" | "on">, exists: (mode: ClusterMode, key: string) => boolean): About {
  for (const m of [b.mode, otherMode(b.mode)]) {
    const p = places[m];
    if (!p || !("in" in p)) continue;
    const key = p.in.map((e) => e[0]).find((k) => exists(m, k) && b.on[m].has(k));
    if (key) return { mode: m, key };
  }
  return null;
}

/** The declarations of board `b` a note on the ring is about, in the board's numbering: those of
 *  its cluster, or those its files are linked to — a declaration, or what a namespace or a folder
 *  holds on the board. */
export function aboutMembers(b: NoteBoard, about: About): number[] {
  if (!about) return [];
  if ("key" in about) return membersOf(b, about.mode, about.key);
  const out = new Set<number>();
  for (const subject of about.links) {
    const s = parseSubject(subject);
    if (!s) continue;
    const j = b.index.get(s.name);
    if (s.kind !== "file" && j !== undefined) out.add(j);
    if (s.kind !== "decl") for (const k of membersOf(b, s.kind === "ns" ? "namespace" : "module", s.name)) out.add(k);
  }
  return [...out].sort((x, y) => x - y);
}

/** Where view note `n` is on its board `b`: at the declaration it is attached to, where the board
 *  holds it (a visitor counts), under every clustering; attached to one the board's graph does not
 *  have (`exists`; unknown, it is taken to be there), on the ring about the innermost cluster of its
 *  place that holds a declaration of the board (the owner's decision of 2026-10-30); else under its
 *  own clustering as it always was, by the keys of the layout drawn (`index`); under the other, on
 *  the ring about that cluster. */
export function viewSpot(n: StickyNote, b: NoteBoard, index: (key: string) => number, exists: Exists = NO_GRAPH): NoteSpot {
  const at = declOf(n, b, exists);
  if (at && typeof at === "object") return { at: "decl", j: at.j, name: at.name, d: [n.decl!.at[0], n.decl!.at[1]] };
  const key = n.place.in.map((e) => e[0]).find((k) => b.on[n.place.mode].has(k));
  const about: About = key ? { mode: n.place.mode, key } : null;
  if (at === "gone") return { at: "ring", angle: null, about, gone: n.decl!.name };
  const r = resolvePlace(n.place, b.mode, index);
  if (r) return r.c >= 0 ? { at: "offset", c: r.c, d: [r.dx, r.dy] } : { at: "world", x: r.dx, y: r.dy };
  return { at: "ring", angle: null, about };
}

/** what a view note's attachment reads where the graph is not asked: off the board, its place stands */
const NO_GRAPH: Exists = () => true;

/** The place under a layout's clustering of a note attached to declaration `i` of layout `L` (its
 *  numbering), as the layout has it: the declaration's own circle and every one around it, each with
 *  the spot — its point moved by `d`, in the layout's units — as a fraction of the circle's radius,
 *  brought inside it; null at the top level. Where a note attached on a board falls back to under the
 *  clustering that board is not shown by, read on the Project's layout of it (the server's). */
export function declPlace(L: Pick<Layout, "x" | "y" | "cluster" | "clusters">, i: number, d: [number, number] = [0, 0]): { in: [string, number, number][] } | null {
  const out: [string, number, number][] = [];
  const x = L.x[i] + d[0], y = L.y[i] + d[1];
  for (let c = L.cluster[i] ?? -1; c >= 0; c = L.clusters[c].parent) {
    const C = L.clusters[c];
    const r = Math.max(C.r, 1e-6);
    const [fx, fy] = inside([(x - C.x) / r, (y - C.y) / r]);
    out.push([C.key, Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000]);
  }
  return out.length ? { in: out } : null;
}

/** A fraction of a radius brought inside the circle. */
function inside(f: [number, number]): [number, number] {
  const len = Math.hypot(f[0], f[1]);
  return len > 1 ? [f[0] / len, f[1] / len] : f;
}

/** The place under the board's clustering of a spot of the board (decision 15): in the most specific
 *  open cluster there — its key and every key around it, each with the spot as a fraction of the
 *  radius of the circle drawn for it, brought inside it — or, where no cluster is there, null: the
 *  caller puts it on the ring at the spot's angle. `clusters` are the layout's, as drawn now. */
export function placeIn(world: [number, number], clusters: PlaceCluster[], b: NoteBoard): ClusterPlace | null {
  const [wx, wy] = world;
  let best = -1;
  clusters.forEach((c, k) => {
    if (!c.open || (c.x - wx) ** 2 + (c.y - wy) ** 2 > c.r * c.r) return;
    if (best < 0 || c.depth > clusters[best].depth) best = k;
  });
  if (best < 0) return null;
  return spotIn(clusters[best].key, world, clusters, b);
}

/** The place in cluster `key` (a key of the board's clustering) of a spot of the board: the
 *  fraction of the spot in the circle drawn for each of its keys — a key a chain merged into a circle
 *  is that circle — those that have no circle of their own here (a hidden level, the top level) left
 *  out; null where the board does not draw that cluster. */
export function spotIn(key: string, world: [number, number], clusters: Pick<PlaceCluster, "x" | "y" | "r">[], b: NoteBoard): ClusterPlace | null {
  const out: [string, number, number][] = [];
  for (const k of keyChain(key)) {
    const c = b.stands.get(k);
    if (c === undefined || !counts(b, k, c)) continue;
    const C = clusters[c];
    const r = Math.max(C.r, 1e-6);
    const [fx, fy] = inside([(world[0] - C.x) / r, (world[1] - C.y) / r]);
    out.push([k, Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000]);
  }
  return out.length && out[0][0] === key ? { in: out } : null;
}

/** The places of `n` notes of the project put at one spot together (files dropped at once, decision
 *  12): the first's (`first`, the place a note let go at `world` takes) and, beside it, the others,
 *  `step` apart to the right in the world, in the same cluster and brought inside its circle; on the
 *  ring, all at the first's place, which the ring spreads as it spreads every note on it. */
export function spacedPlaces(first: ClusterPlace, world: [number, number], n: number, step: number, clusters: Pick<PlaceCluster, "x" | "y" | "r">[], b: NoteBoard): ClusterPlace[] {
  const key = "in" in first ? first.in[0][0] : null;
  return Array.from({ length: n }, (_, j) => (j && key ? spotIn(key, [world[0] + j * step, world[1]], clusters, b) : null) ?? first);
}

/** The place of a note of the project put beside declaration `j` of board `b` (the board's
 *  numbering), at `spot`: in the innermost of its keys under the board's clustering that is a circle
 *  drawn — a hidden level's note is in the one drawn around it — whatever is folded or however small
 *  it is on the screen; null where the declaration is at the top level, for the caller to put the
 *  note on the ring (Clip to a note, decision 12). */
export function besidePlace(j: number, spot: [number, number], clusters: Pick<PlaceCluster, "x" | "y" | "r">[], b: NoteBoard): ClusterPlace | null {
  for (const key of keyChain(b.inner[b.mode][j] ?? "")) {
    const place = spotIn(key, spot, clusters, b);
    if (place) return place;
  }
  return null;
}

/** A build's moves of whole clusters (decision 18): for each project note whose cluster under a
 *  clustering is gone in `after` though `before` had it, the cluster that took all its declarations
 *  — each that is still there, by its name or the one a rename of high confidence gave it — as a
 *  folder or a namespace renamed does: the same structure under another key, every declaration
 *  `K.rest` now `K'.rest`, and at least one of them still there. What it holds that is gone with no
 *  rename is gone, not moved. The notes, each with the clustering, the key it had and the place it
 *  is carried to; a note whose cluster went elsewhere in pieces, or nowhere, is left as it is, and
 *  is in the nearest cluster around it that is left. */
export function carriedNotes(
  notes: readonly ProjectNote[],
  before: readonly NodeLike[],
  after: readonly NodeLike[],
  renamed: ReadonlyMap<string, string>,
): { id: string; mode: ClusterMode; from: string; to: string; place: ClusterPlace }[] {
  const out: { id: string; mode: ClusterMode; from: string; to: string; place: ClusterPlace }[] = [];
  for (const mode of ["namespace", "module"] as ClusterMode[]) {
    const holding = notes.filter((n) => {
      const p = n.places[mode];
      return !!p && "in" in p;
    });
    if (!holding.length) continue;
    const was = innerKeys(mode, before as NodeLike[]);
    const now = innerKeys(mode, after as NodeLike[]);
    const keysNow = new Set<string>();
    for (const k of now) for (const c of keyChain(k)) keysNow.add(c);
    const keysThen = new Set<string>();
    for (const k of was) for (const c of keyChain(k)) keysThen.add(c);
    const where = new Map<string, string>();
    after.forEach((n, i) => where.set(n.name, now[i]));
    const moved = new Map<string, string | null>();
    /** the key `K` was moved to as a whole, or null */
    const target = (K: string): string | null => {
      if (moved.has(K)) return moved.get(K)!;
      let to: string | null | undefined;
      const pre = K + ".";
      for (let i = 0; i < before.length && to !== null; i++) {
        const k = was[i];
        if (k !== K && !k.startsWith(pre)) continue;
        const name = renamed.get(before[i].name) ?? before[i].name;
        const there = where.get(name);
        // gone with no rename: not moved anywhere
        if (there === undefined) continue;
        const rest = k.slice(K.length);
        if (!there.endsWith(rest) || there.length === rest.length) {
          to = null;
          break;
        }
        const key = there.slice(0, there.length - rest.length);
        if (to === undefined) to = key;
        else if (to !== key) to = null;
      }
      const r = to && to !== K && keysNow.has(to) ? to : null;
      moved.set(K, r);
      return r;
    };
    for (const n of holding) {
      const p = n.places[mode] as { in: [string, number, number][] };
      const K = p.in[0][0];
      if (keysNow.has(K) || !keysThen.has(K)) continue;
      const to = target(K);
      if (!to) continue;
      // the spot it had in its cluster, in the one that took it; around it, the spots it had in the
      // clusters that are still around it, else that same spot
      const own: [number, number] = [p.in[0][1], p.in[0][2]];
      const had = new Map(p.in.map((e) => [e[0], [e[1], e[2]] as [number, number]]));
      const chain = keyChain(to).map((k, j): [string, number, number] => {
        const f = j === 0 ? own : had.get(k) ?? own;
        return [k, f[0], f[1]];
      });
      out.push({ id: n.id, mode, from: K, to, place: { in: chain } });
    }
  }
  return out;
}
