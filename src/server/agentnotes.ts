// Agents' notes (AgentSpec decision 5; AttachmentSpec decisions 13–20, the owner's of 2026-10-11): an
// agent points people at something by writing a note, as people do from the canvas's menu. A note is
// the project's unless the agent names a view, whose own note it then is:
//
// - a project note is an item (the owner's decision of 2026-10-11): the Project shows every one, any
//   other view those that follow from its scope (in a cluster on its board, on the ring about a
//   cluster under the other clustering that is on it, or carrying a file linked to what it holds) and
//   those added to it, less those taken out of it (shared/items.ts; server/agentviews.ts,
//   `views/items`). It has one place per clustering: in a cluster by key and clustering, at a spot as
//   a fraction of the cluster's radius; beside a declaration, in its cluster under the clustering
//   given; or on the ring around the board (shared/projectnotes.ts, shared/noteplace.ts). One written
//   with `in`, a view's id, is added to that view, as a note a person writes on a board is;
// - a view note is on that view's board alone, placed as it always was: beside a declaration, in a
//   cluster at an offset, or at a spot of the board (shared/sticky.ts).
//
// Either is written through the path a page's takes (server/views.ts), so that its author is
// attributed as a pin's is and the timeline records it. At level advise an agent writes notes, and
// edits, moves and deletes its own; at full it also edits, moves and deletes anyone's, as a person
// can (AgentSpec decision 9). A note is made the other kind by an edit (`kind`), keeping its text,
// its author and where it is on the board it is switched on. Writing or editing a note can give what
// it carries (`carries`: files of the library and clips of their pages, AttachmentSpec decision 12),
// checked against the library as a page's are (server/views.ts). Where its card hangs from its icon
// (`card`, CanvasSpec "Notes") is read in the listings and set by `note/move` or `note/edit`, at the
// levels moving a note has. A note of either kind is attached to a declaration (`decl`, the owner's
// decision of 2026-10-12) by `note` or `note/move`, and detached by `note/move` (`decl` null, or a
// place given): attached, it is at that declaration under every clustering, wherever a board holds
// it, its place beside the declaration being where it falls back to when the declaration is gone.
//
// The endpoints are server/agent.ts's, in its shape (server/agentviews.ts, AgentEndpoint); the board
// a note is put on is read here as the pages lay it out (shared/board.ts), at rest, its pins where
// they were dropped and its hidden levels out.

import { boardLayout, boardSet, wholeLayout } from "../shared/board.ts";
import type { ClusterMode, Layout } from "../shared/graph.ts";
import { clusterKeys, innerKeys } from "../shared/layout.ts";
import { aboutMembers, itemSpot, itemWhy, linkedOn, linksByFile, noteBoard, placeIn, spotIn, viewSpot } from "../shared/noteplace.ts";
import type { Exists, ItemWhy, NoteBoard, NoteSpot } from "../shared/noteplace.ts";
import { invalidProjectNoteOps, MAX_PROJECT_NOTES } from "../shared/projectnotes.ts";
import type { ClusterPlace, ProjectNote, ProjectNoteOp } from "../shared/projectnotes.ts";
import { aboutAngle, angleOf, ringAround, ringRadians } from "../shared/ring.ts";
import type { Ring } from "../shared/ring.ts";
import { fileOf } from "../shared/library.ts";
import { declSpot, POINT_UNITS } from "../shared/notecard.ts";
import { boardClusters, CARD_REACH, cleanCarries, DECL_AT, DECL_FAR, DECL_NEAR, invalidCard, invalidCarries, invalidNoteText, keptDecl, MAX_CARRIES, MAX_NOTES, newNoteId, nodeSpot, placeAt, placeIn as viewPlaceIn } from "../shared/sticky.ts";
import type { NoteCard, NoteCarry, NoteDecl, NoteOp, NotePlace, PlaceCluster, StickyNote } from "../shared/sticky.ts";
import type { Graph } from "../shared/viewgraph.ts";
import { fixedScope, PROJECT, viewTitle } from "../shared/views.ts";
import type { ViewData } from "../shared/views.ts";
import type { Answer, Ask, Caller, Need, World } from "./agent.ts";
import { fail } from "./agent.ts";
import type { AgentEndpoint } from "./agentviews.ts";
import { graphOf, titleContext } from "./agentviews.ts";

const ok = (body: unknown): Answer => ({ status: 200, body });
const CARRY_HINT = 'carries: [{"file": "<sha256>"}] for an image or a whole PDF, [{"file": "<sha256>", "page": 3, "region": [0.1, 0.2, 0.9, 0.45]}] for a clip of a page (fractions from its top left); GET /api/agent/library lists the files.';
/** how far beside a declaration's point a note goes, in the board's units (a point's radius is 5) */
const BESIDE: [number, number] = [9, -9];
const MODES: ClusterMode[] = ["namespace", "module"];
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A note of the project's places, one per clustering. */
type ClusterNote = Pick<ProjectNote, "places">;

/** A view's board by its clustering, laid out as the pages lay it out, at rest. */
interface Board {
  v: ViewData;
  L: Layout;
  g: Graph;
  mode: ClusterMode;
  clusters: PlaceCluster[];
  nb: NoteBoard;
  ring: Ring | null;
}

/** A project note's place under a clustering, as agents read it. */
function placeShown(p: ClusterPlace | undefined): Record<string, unknown> | null {
  if (!p) return null;
  if ("ring" in p) return { ring: p.ring };
  return { cluster: p.in[0][0], at: [p.in[0][1], p.in[0][2]], around: p.in.slice(1).map((e) => e[0]) };
}

/** Where a note is on a board, as agents read it. */
function spotShown(s: NoteSpot | null, B: Board): Record<string, unknown> | null {
  if (!s) return null;
  if (s.at === "decl") return { decl: s.name, at: s.d };
  if (s.at === "cluster") return { cluster: B.L.clusters[s.c].key, at: s.f.map(round3) };
  if (s.at === "offset") return { cluster: B.L.clusters[s.c].key, offset: s.d };
  if (s.at === "world") return { spot: [s.x, s.y] };
  const about = !s.about ? null : "links" in s.about ? { links: s.about.links } : { clustering: s.about.mode, cluster: s.about.key };
  return { ring: s.angle, about };
}

/** what `why` says of a note of the project on a board, for an agent */
const WHY_WORDS: Record<ItemWhy, string> = {
  project: "the Project holds every note",
  decl: "it is attached to a declaration on this board",
  cluster: "its cluster is on this board",
  ring: "at the top level here, about its cluster under the other clustering, which is on this board",
  link: "it carries a file linked to what this board holds",
  added: "it was added to this view",
};

/** The agents' endpoints about notes. `refuse` says why an agent may not do what needs `need`. */
export function noteEndpoints(world: World, refuse: (c: Caller, need: Need) => Answer | null): AgentEndpoint[] {
  const body = (a: Ask) => (a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {});
  /** Writes say who makes them, and that it is an agent; then what their level allows. */
  const who = (a: Ask, need: Need): Answer | null => {
    if (a.caller.kind !== "agent") return fail(400, "This API records what agents do: say you are one.", "Send X-VisualProof-Kind: agent with every request, beside X-VisualProof-Name.");
    if (!a.caller.name) return fail(401, "Say who you are first.", "Send X-VisualProof-Name: <your name>, e.g. Claude.", { who: true });
    return refuse(a.caller, need);
  };
  /** A note the agent wrote is its own to change at level advise; anyone else's needs full. */
  const mayChange = (a: Ask, n: { by: string | null; agent?: true }): Answer | null => who(a, n.agent && n.by === a.caller.name ? "advise" : "full");
  const viewOf = (id: unknown): ViewData | Answer => {
    const key = id === undefined || id === null || id === "" ? PROJECT : id;
    return (typeof key === "string" && world.views.book.get(key)) || fail(404, `There is no view ${String(key)}.`, "GET /api/agent/views lists them; leave view out for the Project.");
  };
  const graph = () => graphOf(world) ?? fail(503, "The graph has not been read yet.", "The server is reading the project; ask again in a few seconds.", { retryAfter: 5 }, { "retry-after": "5" });
  /** whether a key is a cluster of the graph on show by a clustering, and whether a name is one of
   *  its declarations (where a note attached to one falls back to its places when it is gone) */
  const keys = new WeakMap<object, Partial<Record<ClusterMode, Set<string>>>>();
  const exists = (g: Graph): Exists => {
    const f: Exists = (m, key) => {
      const k = keys.get(g) ?? {};
      keys.set(g, k);
      return (k[m] ??= clusterKeys(m, g.nodes)).has(key);
    };
    f.decl = (name) => g.byName.has(name);
    return f;
  };
  /** View `v`'s board by `mode` (its clustering by default), at rest, under the levels it hides. */
  const boardOf = (v: ViewData, mode: ClusterMode = v.clustering): Board | Answer => {
    const G = graph();
    if ("status" in G) return G;
    const bs = boardSet(G.g, world.review.data, v.scope);
    const hidden = v.hidden[mode];
    const L = bs.whole ? wholeLayout(G.meta.layouts[mode], G.g.nodes, mode, hidden) : boardLayout(bs.sub!.graph, mode, bs.key, world.views.book.memoryOf(v.id, mode), hidden).layout;
    const g = bs.whole ? G.g : bs.sub!.graph;
    const clusters = boardClusters(L, v.pins[mode], v.folds[mode]);
    const discs = clusters.flatMap((c) => (c.parent < 0 ? [c] : []));
    L.cluster.forEach((c, i) => {
      if (c < 0) discs.push({ x: L.x[i], y: L.y[i], r: 8 } as PlaceCluster);
    });
    return { v, L, g, mode, clusters, nb: noteBoard(L, mode, g.nodes), ring: ringAround(discs) };
  };
  /** The note `id`: the project's, or view `view`'s own; with `view` given, that view's first. */
  const find = (id: unknown, view: unknown): { kind: "project"; note: ProjectNote } | { kind: "view"; note: StickyNote; v: ViewData } | Answer => {
    const p = world.views.book.notes.find((n) => n.id === id);
    const v = view === undefined || view === null || view === "" ? null : viewOf(view);
    if (v && !("id" in v)) return v;
    const own = (v ?? world.views.book.get(PROJECT)!).notes?.find((n) => n.id === id);
    if (own && (v || !p)) return { kind: "view", note: own, v: v ?? world.views.book.get(PROJECT)! };
    if (p) return { kind: "project", note: p };
    return fail(404, `There is no note ${String(id).slice(0, 40)}${v ? ` on view ${v.id}` : ""}.`, "GET /api/agent/notes lists them (view=… for a view's own).");
  };
  /** Whether board `B` shows project note `n`, and why (shared/noteplace.ts, itemWhy), and where it
   *  is there; null where it does not show it. */
  const projectHere = (n: ProjectNote, B: Board): { why: ItemWhy; spot: NoteSpot } | null => {
    const ex = exists(graphOf(world)!.g);
    const links = linksByFile(world.review.data.links);
    const why = itemWhy(n, { all: fixedScope(B.v), items: B.v.items }, B.nb, ex, links);
    return why ? { why, spot: itemSpot(n, B.nb, ex, linkedOn(n, B.nb, links)) } : null;
  };
  /** What a note carries as the agents' API tells it: each file or clip with what it is (an image, a
   *  PDF, a clip of a page) and the file's title, or that the library has no record of it now. */
  const carriesShown = (cs: NoteCarry[] | undefined): Record<string, unknown>[] =>
    (cs ?? []).map((c) => {
      const f = fileOf(world.review.data, c.file);
      const what = !f ? "unknown" : f.type !== "pdf" ? "image" : c.region ? "clip" : "pdf";
      return { ...c, what, title: f?.title ?? null, ...(f?.archived ? { archived: true } : {}) };
    });
  /** A note as the agents' API tells it: its kind, who wrote it, what it carries, its places, and
   *  where it is on board `B` (null where that board does not show it). */
  const shown = (kind: "project" | "view", n: ProjectNote | StickyNote, B: Board | null, view?: string): Record<string, unknown> => {
    const base = {
      id: n.id,
      kind,
      text: n.text,
      open: n.open,
      by: n.by,
      agent: !!n.agent,
      at: n.at,
      ...(n.edited ? { edited: { by: n.edited.by, agent: !!n.edited.agent, at: n.edited.at } } : {}),
      carries: carriesShown(n.carries),
      // where its card hangs from its icon, in pixels of the screen; null where it hangs by default
      card: n.card ?? null,
      // the declaration it is attached to, its icon at `at` from its point in the board's units;
      // null where it is attached to none
      decl: n.decl ?? null,
    };
    if (kind === "project") {
      const p = n as ProjectNote;
      const h = B ? projectHere(p, B) : null;
      return { ...base, places: Object.fromEntries(MODES.map((m) => [m, placeShown(p.places[m])])), here: h && B ? spotShown(h.spot, B) : null, why: h ? h.why : null };
    }
    const s = n as StickyNote;
    const index = new Map(B?.L.clusters.map((c, k) => [c.key, k]) ?? []);
    return { ...base, view, clustering: s.place.mode, here: B ? spotShown(viewSpot(s, B.nb, (key) => index.get(key) ?? -1), B) : null };
  };
  /** Apply operations to view `v`'s notes, or the project's, as the agent's, through the path a
   *  page's take. */
  const applyView = (a: Ask, v: ViewData, ops: NoteOp[]): Answer | null => {
    const err = world.views.arrange(v.id, ops, null, a.caller.name, true);
    return err ? fail(400, err, CARRY_HINT) : null;
  };
  const applyProject = (a: Ask, ops: ProjectNoteOp[], written: string | null = null): Answer | null => {
    const why = invalidProjectNoteOps(ops);
    if (why) return fail(400, `The note cannot be taken: ${why}.`, "A ring's angle is in degrees (within ±3600); a spot, a fraction of the radius.");
    const err = world.views.arrangeNotes(ops, null, a.caller.name, true, null, written);
    return err ? fail(400, err, CARRY_HINT) : null;
  };
  /** Where a request says a note's card hangs from its icon: an offset in pixels of the screen, null
   *  for the default, undefined where it says nothing; or the answer that refuses it. */
  const cardOf = (x: unknown): NoteCard | null | undefined | Answer => {
    if (x === undefined) return undefined;
    if (x === null) return null;
    return invalidCard(x) ? fail(400, `card is [x, y], the card's centre from the icon's in pixels of the screen (x right, y down), each within ±${CARD_REACH}; null hangs it as by default.`, "") : ([Math.round((x as number[])[0]), Math.round((x as number[])[1])] as NoteCard);
  };
  /** What a request says a note carries, checked as to its shape (the library checks the files):
   *  the list, undefined where it says nothing, or the answer that refuses it. A file alone may be
   *  given by its hash. */
  const carriesOf = (x: unknown): NoteCarry[] | undefined | Answer => {
    if (x === undefined) return undefined;
    const list = Array.isArray(x) ? x.map((c) => (typeof c === "string" ? { file: c } : c)) : x;
    const why = invalidCarries(list);
    if (why) return fail(400, why.startsWith("carries") ? `${why}: carries is a list of at most ${MAX_CARRIES} files of the library and clips of their pages.` : why, CARRY_HINT);
    return cleanCarries(list).carries ?? [];
  };
  const modeOf = (x: unknown, dflt: ClusterMode): ClusterMode | Answer =>
    x === undefined || x === null || x === "" ? dflt : MODES.includes(x as ClusterMode) ? (x as ClusterMode) : fail(400, "clustering is namespace or module.", "");
  /** What a request says a note is attached to: a declaration of the graph on show by its full name,
   *  or {name, at} with its icon's offset from the point in the board's units (DECL_AT by default);
   *  null for none, undefined where it says nothing; or the answer that refuses it. */
  const declIn = (x: unknown): NoteDecl | null | undefined | Answer => {
    if (x === undefined) return undefined;
    if (x === null) return null;
    const o = (typeof x === "string" ? { name: x } : x) as Record<string, unknown> | null;
    const hint = `decl is a declaration's full name, or {"name": …, "at": [x, y]} with its icon's offset from the declaration's point in the board's units, where a declaration's point is ${POINT_UNITS} across (x right, y down, between ${DECL_NEAR} and ${DECL_FAR} away; default [${DECL_AT.join(", ")}]); null detaches it.`;
    if (!o || typeof o !== "object" || typeof o.name !== "string" || !o.name) return fail(400, "decl names a declaration.", hint);
    const at = o.at === undefined ? DECL_AT : o.at;
    if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === "number" && Number.isFinite(v))) return fail(400, "decl.at is [x, y], two finite numbers.", hint);
    const G = graph();
    if ("status" in G) return G;
    if (!G.g.byName.has(o.name)) return fail(404, `There is no declaration ${o.name}.`, "GET /api/agent/search finds one.");
    return { name: o.name, at: keptDecl(at as [number, number]) };
  };
  /** The places of a note of the project attached to declaration `name`, where it falls back to: beside
   *  it under both clusterings, in its cluster on the Project. */
  const besides = (name: string): ClusterNote["places"] | Answer => {
    const places: ClusterNote["places"] = {};
    for (const m of MODES) {
      const p = projectPlace({ name }, m);
      if (p && "status" in p) return p;
      if (p) places[m] = p as ClusterPlace;
    }
    return places;
  };
  const pointOf = (x: unknown): [number, number] | null | Answer => {
    if (x === undefined) return null;
    return Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7) ? (x as [number, number]) : fail(400, "at is [x, y], two finite numbers.", "For a note of the project, a fraction of the cluster's radius ([0.5, -0.3]); for a view's note, an offset in the cluster or a spot of the board.");
  };

  /** A project note's place under `mode`, from what the request says: a cluster by key (with `at`, a
   *  fraction of its radius), beside a declaration (in its cluster), or on the ring (`ring`: an
   *  angle in degrees clockwise from the top, or true for wherever the ring puts it). Undefined:
   *  no place there (the ring, about what it is about). */
  const projectPlace = (b: Record<string, unknown>, mode: ClusterMode): ClusterPlace | undefined | Answer => {
    const G = graph();
    if ("status" in G) return G;
    if (b.ring !== undefined) {
      if (b.ring === true) return undefined;
      if (typeof b.ring !== "number" || !Number.isFinite(b.ring)) return fail(400, "ring is an angle in degrees, clockwise from the top (0 at the top, 90 on the right), or true for wherever the ring puts it.", "");
      return { ring: b.ring };
    }
    const at = pointOf(b.at);
    if (at && !Array.isArray(at)) return at;
    // laid out as the Project shows it by that clustering, which holds everything
    const B = boardOf(world.views.book.project(), mode);
    if ("status" in B) return B;
    if (typeof b.name === "string") {
      const i = B.g.byName.get(b.name);
      if (i === undefined) return fail(404, `There is no declaration ${b.name}.`, "GET /api/agent/search finds one.");
      const key = innerKeys(mode, B.g.nodes)[i];
      if (!key) return undefined;
      const [x, y] = nodeSpot(B.L, B.v.pins[mode], B.clusters, i, b.name);
      return spotIn(key, [x + BESIDE[0], y + BESIDE[1]], B.clusters, B.nb) ?? undefined;
    }
    if (typeof b.cluster === "string") {
      if (!exists(G.g)(mode, b.cluster)) return fail(404, `There is no cluster ${b.cluster} by ${mode}.`, `GET /api/agent/views/view?id=project&mode=${mode} lists the clusters; a folder's key is its modules' path with dots (Mathlib.NumberTheory.FLT), a namespace's its name.`);
      // a fraction of the radius, brought inside the circle as the page brings a spot let go
      const [fx, fy] = (at as [number, number] | null) ?? [0, 0];
      const len = Math.hypot(fx, fy);
      const f: [number, number] = len > 1 ? [round3(fx / len), round3(fy / len)] : [fx, fy];
      const c = B.nb.stands.get(b.cluster);
      // the spot in the circle drawn for it, and in every one around it
      const C = c !== undefined && c >= 0 ? B.clusters[c] : null;
      const spot: [number, number] = C ? [C.x + f[0] * C.r, C.y + f[1] * C.r] : [0, 0];
      const p = C ? spotIn(b.cluster, spot, B.clusters, B.nb) : null;
      const chain: [string, number, number][] = p && "in" in p ? p.in : [[b.cluster, f[0], f[1]]];
      chain[0] = [b.cluster, f[0], f[1]];
      return { in: chain };
    }
    return fail(400, "Say where: cluster (with clustering, and at a fraction of its radius), name (beside a declaration, in its cluster), or ring (an angle, or true).", 'e.g. {"text": "…", "cluster": "Fermat42", "clustering": "namespace"}.');
  };

  /** A view note's place on its view's board, from what the request says: beside a declaration, in a
   *  cluster at an offset, or at a spot of the board — as it always was. */
  const viewPlace = (b: Record<string, unknown>, B: Board): NotePlace | Answer => {
    const { L, g, mode, clusters } = B;
    const at = pointOf(b.at);
    if (at && !Array.isArray(at)) return at;
    if (typeof b.name === "string") {
      const i = g.byName.get(b.name);
      if (i === undefined) return fail(404, `${b.name} is not on view ${B.v.id}.`, "A note beside a declaration is on a view that holds it.");
      const [x, y] = nodeSpot(L, B.v.pins[mode], clusters, i, b.name);
      const spot: [number, number] = [x + BESIDE[0], y + BESIDE[1]];
      return L.cluster[i] >= 0 ? viewPlaceIn(mode, spot, clusters, L.cluster[i]) : placeAt(mode, spot, []);
    }
    if (typeof b.cluster === "string") {
      const c = L.clusters.findIndex((x) => x.key === b.cluster);
      if (c < 0) return fail(404, `View ${B.v.id} has no cluster ${b.cluster} by ${mode}.`, "GET /api/agent/views/view?id=… lists its clusters.");
      const [dx, dy] = (at as [number, number] | null) ?? [0, 0];
      return viewPlaceIn(mode, [clusters[c].x + dx, clusters[c].y + dy], clusters, c);
    }
    if (at) return placeAt(mode, at as [number, number], clusters);
    return fail(400, "Say where: name (beside a declaration), cluster (with at, an offset in it), or at (a spot of the board).", 'e.g. {"text": "…", "view": "…", "name": "Nat.exists_infinite_primes"}.');
  };

  /** Where a note is at rest on board `B`, in the board's world: what a switch to the other kind keeps
   *  (its spot in its cluster, else its point on the ring). */
  const restOn = (kind: "project" | "view", n: ProjectNote | StickyNote, B: Board): [number, number] | null => {
    const index = new Map(B.L.clusters.map((c, k) => [c.key, k]));
    const s = kind === "project" ? projectHere(n as ProjectNote, B)?.spot : viewSpot(n as StickyNote, B.nb, (key) => index.get(key) ?? -1);
    if (!s) return null;
    // attached to a declaration: at its offset from the point, a place on the board, as the page
    // draws it at rest
    if (s.at === "decl") {
      if (s.j < 0) return null;
      const [x, y] = B.L.cluster[s.j] >= 0 ? nodeSpot(B.L, B.v.pins[B.mode], B.clusters, s.j, s.name) : [B.L.x[s.j], B.L.y[s.j]];
      return declSpot([x, y], s.d);
    }
    if (s.at === "cluster") return [B.clusters[s.c].x + s.f[0] * B.clusters[s.c].r, B.clusters[s.c].y + s.f[1] * B.clusters[s.c].r];
    if (s.at === "offset") return [B.clusters[s.c].x + s.d[0], B.clusters[s.c].y + s.d[1]];
    if (s.at === "world") return [s.x, s.y];
    if (!B.ring) return null;
    let a = s.angle !== null ? ringRadians(s.angle) : null;
    if (a === null && s.about) {
      const js = aboutMembers(B.nb, s.about);
      if (js.length) {
        let x = 0, y = 0;
        for (const j of js) {
          const p = B.L.cluster[j] >= 0 ? nodeSpot(B.L, B.v.pins[B.mode], B.clusters, j, B.g.nodes[j].name) : [B.L.x[j], B.L.y[j]];
          x += p[0];
          y += p[1];
        }
        a = aboutAngle(B.ring, [x / js.length, y / js.length]);
      }
    }
    a ??= -Math.PI / 2;
    return [B.ring.x + B.ring.r * Math.cos(a), B.ring.y + B.ring.r * Math.sin(a)];
  };

  const list = (a: Ask): Answer => {
    const v = viewOf(a.query.get("view"));
    if (!("id" in v)) return v;
    const B = boardOf(v);
    if ("status" in B) return B;
    const all = a.query.get("all") === "1" || a.query.get("all") === "true";
    const project = world.views.book.notes.filter((n) => all || projectHere(n, B) !== null);
    return ok({
      view: v.id,
      title: viewTitle(v, titleContext(world)),
      ...(v.items ? { items: v.items } : {}),
      notes: [...project.map((n) => shown("project", n, B)), ...(v.notes ?? []).map((n) => shown("view", n, B, v.id))],
      note:
        `kind project: a note of the project, an item: the Project shows every one, any other view what follows from its scope and what was added to it, less what was taken out (POST /api/agent/views/items). why: ${Object.entries(WHY_WORDS).map(([k, w]) => `${k}, ${w}`).join("; ")}. places: its place per clustering (a cluster with its spot as a fraction of the radius, or ring: an angle in degrees clockwise from the top; null: none yet, on the ring about its cluster under the other clustering); here: where it is on this view's board; card: where its card hangs from its icon, in pixels of the screen (null: by default). kind view: this view's own note, here on its board. ` +
        (all ? "all: every note of the project, here and why null where this board does not show it." : "Only the project's notes this board shows are listed: all=1 lists every one."),
    });
  };

  const add = (a: Ask): Answer => {
    const no = who(a, "advise");
    if (no) return no;
    const b = body(a);
    const text = typeof b.text === "string" ? b.text.trim() : "";
    const bad = invalidNoteText(text);
    if (bad) return fail(400, bad, 'Send {text, …where}: what people should look at there, e.g. "the swap is applied twice here"; at most 2,000 characters, with **bold**, *italics*, `code`, and full names in backticks as links.');
    const carried = carriesOf(b.carries);
    if (carried && !Array.isArray(carried)) return carried;
    // attached to a declaration: that is where it is, under every clustering
    const decl = declIn(b.decl);
    if (decl && "status" in decl) return decl;
    if (decl && placing(b)) return fail(400, "Say where once: decl attaches the note to a declaration, its place beside it; cluster, name, ring and at place it elsewhere.", "");
    const stamp = { open: b.open !== false, by: a.caller.name, agent: true as const, at: new Date().toISOString(), ...(carried?.length ? { carries: carried } : {}), ...(decl ? { decl: decl as NoteDecl } : {}) };
    // a view named: that view's own note, on its board alone
    if (b.view !== undefined && b.view !== null && b.view !== "") {
      const v = viewOf(b.view);
      if (!("id" in v)) return v;
      if ((v.notes?.length ?? 0) >= MAX_NOTES) return fail(409, `View ${v.id} holds ${MAX_NOTES} notes already.`, "Delete one first, or write a note of the project (leave view out).");
      const B = boardOf(v);
      if ("status" in B) return B;
      const place = viewPlace(decl ? { name: (decl as NoteDecl).name } : b, B);
      if ("status" in place) return place;
      const card = cardOf(b.card);
      if (card && !Array.isArray(card)) return card;
      const note: StickyNote = { id: newNoteId(), text, place, ...stamp, ...(card ? { card: card as NoteCard } : {}) };
      const err = applyView(a, v, [{ op: "note", note }]);
      if (err) return err;
      const made = world.views.book.get(v.id)?.notes?.find((n) => n.id === note.id) ?? note;
      return ok({ ok: true, ...shown("view", made, B, v.id) });
    }
    if (world.views.book.notes.length >= MAX_PROJECT_NOTES) return fail(409, `The project holds ${MAX_PROJECT_NOTES} notes already.`, "Delete one first (yours at advise, anyone's at full).");
    // written in a view: added to it, as a note people write on a board is (the owner's decision of
    // 2026-10-11)
    const written = b.in === undefined || b.in === null || b.in === "" ? null : viewOf(b.in);
    if (written && !("id" in written)) return written;
    const mode = modeOf(b.clustering, "namespace");
    if (typeof mode !== "string") return mode;
    // attached, it falls back to beside the declaration under both clusterings
    const places = decl ? besides((decl as NoteDecl).name) : null;
    if (places && "status" in places) return places;
    const place = decl ? undefined : projectPlace(b, mode);
    if (place && "status" in place) return place;
    const card = cardOf(b.card);
    if (card && !Array.isArray(card)) return card;
    const note: ProjectNote = { id: newNoteId(), text, places: (places as ClusterNote["places"] | null) ?? (place ? { [mode]: place as ClusterPlace } : {}), ...stamp, ...(card ? { card: card as NoteCard } : {}) };
    const err = applyProject(a, [{ op: "pnote", note }], written ? written.id : null);
    if (err) return err;
    const made = world.views.book.notes.find((n) => n.id === note.id) ?? note;
    const B = boardOf(written ?? world.views.book.project());
    return ok({ ok: true, ...shown("project", made, "status" in B ? null : B), ...(written ? { in: written.id } : {}) });
  };

  const edit = (a: Ask): Answer => {
    const b = body(a);
    const f = find(b.id, b.view);
    if ("status" in f) return f;
    const no = mayChange(a, f.note);
    if (no) return no;
    let text: string | undefined;
    if (b.text !== undefined) {
      text = typeof b.text === "string" ? b.text.trim() : "";
      const bad = invalidNoteText(text);
      if (bad) return fail(400, bad, "At most 2,000 characters, plain text with simple Markdown.");
    }
    const carries = carriesOf(b.carries);
    if (carries && !Array.isArray(carries)) return carries;
    if (b.open !== undefined && typeof b.open !== "boolean") return fail(400, "open is true (its text shown) or false (collapsed).", "");
    if (b.kind !== undefined && b.kind !== "project" && b.kind !== "view") return fail(400, "kind is project (the Project, and every view whose scope gives it or that it was added to) or view (that view's own).", "");
    const card = cardOf(b.card);
    if (card && !Array.isArray(card)) return card;
    const switching = b.kind !== undefined && b.kind !== f.kind;
    if (text === undefined && carries === undefined && b.open === undefined && card === undefined && !switching) return fail(400, "Send text, carries, open, card, kind, or several.", "POST /api/agent/note/move moves a note.");
    // its text and what it carries are one edit: the text as it is where only what it carries changes
    const edit = text !== undefined || carries !== undefined ? { id: f.note.id, text: text ?? f.note.text, ...(carries !== undefined ? { carries } : {}) } : null;
    // made the other kind, where it is on the board of the view it becomes or leaves: worked out
    // first, so that a switch refused changes nothing
    let to: { v: ViewData; B: Board; place: NotePlace | ClusterPlace } | null = null;
    if (switching) {
      if (f.kind === "project" && (b.view === undefined || b.view === null || b.view === "")) return fail(400, "Say whose it becomes: view, the view's id.", "");
      const v = f.kind === "view" ? f.v : viewOf(b.view);
      if (!("id" in v)) return v;
      const B = boardOf(v);
      if ("status" in B) return B;
      const at = restOn(f.kind, f.note, B);
      if (!at) return fail(409, `View ${v.id}'s board does not show this note: it cannot be made that view's where it is.`, "Move it onto that board first, or write the view's note anew.");
      to = { v, B, place: f.kind === "project" ? placeAt(B.mode, at, B.clusters) : placeIn(at, B.clusters, B.nb) ?? (B.ring ? { ring: angleOf(B.ring, at[0], at[1]) } : { ring: 0 }) };
    }
    if (f.kind === "project") {
      const ops: ProjectNoteOp[] = [];
      if (edit) ops.push({ op: "pnote-edit", ...edit });
      if (b.open !== undefined) ops.push({ op: "pnote-open", id: f.note.id, open: b.open as boolean });
      if (card !== undefined) ops.push({ op: "pnote-card", id: f.note.id, card: card as NoteCard | null });
      const err = ops.length ? applyProject(a, ops) : null;
      if (err) return err;
    } else {
      const ops: NoteOp[] = [];
      if (edit) ops.push({ op: "note-edit", ...edit });
      if (b.open !== undefined) ops.push({ op: "note-open", id: f.note.id, open: b.open as boolean });
      if (card !== undefined) ops.push({ op: "note-card", id: f.note.id, card: card as NoteCard | null });
      const err = ops.length ? applyView(a, f.v, ops) : null;
      if (err) return err;
    }
    if (!to) {
      const now = find(f.note.id, f.kind === "view" ? f.v.id : undefined);
      if ("status" in now) return now;
      const B = boardOf(now.kind === "view" ? now.v : world.views.book.project());
      return ok({ ok: true, ...shown(now.kind, now.note, "status" in B ? null : B, now.kind === "view" ? now.v.id : undefined) });
    }
    const err = world.views.switchNote(f.note.id, to.v.id, f.kind === "project" ? "view" : "project", to.place, to.B.mode, null, a.caller.name, true);
    if (err) return fail(400, err, "");
    const now = find(f.note.id, f.kind === "project" ? to.v.id : undefined);
    if ("status" in now) return now;
    return ok({ ok: true, ...shown(now.kind, now.note, to.B, now.kind === "view" ? to.v.id : undefined) });
  };

  const move = (a: Ask): Answer => {
    const b = body(a);
    const f = find(b.id, b.view);
    if ("status" in f) return f;
    const no = mayChange(a, f.note);
    if (no) return no;
    // where its card hangs, with its place or alone: shared as its place is, and no event
    const card = cardOf(b.card);
    if (card && !Array.isArray(card)) return card;
    // attached to a declaration (decl), detached (decl null, or detach), or neither said
    const decl = b.detach === true && b.decl === undefined ? null : declIn(b.decl);
    if (decl && "status" in decl) return decl;
    const moving = placing(b);
    if (decl && moving) return fail(400, "Say where once: decl attaches the note to a declaration, its place beside it; cluster, name, ring and at place it elsewhere, and detach it.", "");
    // placed elsewhere, an attached note is detached: its place is where it was put
    const detach = decl === null || (moving && !!f.note.decl);
    const declOp = decl ? (decl as NoteDecl) : detach ? null : undefined;
    if (f.kind === "view") {
      const B = boardOf(f.v);
      if ("status" in B) return B;
      const ops: NoteOp[] = [];
      if (declOp !== undefined) ops.push({ op: "note-decl", id: f.note.id, decl: declOp });
      if (decl || moving || (card === undefined && declOp === undefined)) {
        const place = viewPlace(decl ? { name: (decl as NoteDecl).name } : b, B);
        if ("status" in place) return place;
        ops.push({ op: "note-move", id: f.note.id, place });
      }
      if (card !== undefined) ops.push({ op: "note-card", id: f.note.id, card: card as NoteCard | null });
      const err = applyView(a, f.v, ops);
      if (err) return err;
      return ok({ ok: true, ...shown("view", f.v.notes!.find((n) => n.id === f.note.id)!, B, f.v.id) });
    }
    const ops: ProjectNoteOp[] = [];
    const mode = modeOf(b.clustering, "namespace");
    if (typeof mode !== "string") return mode;
    if (declOp !== undefined) ops.push({ op: "pnote-decl", id: f.note.id, decl: declOp });
    if (decl) {
      // attached: it falls back to beside the declaration under both clusterings
      const places = besides((decl as NoteDecl).name);
      if ("status" in places) return places;
      for (const m of MODES) if (places[m]) ops.push({ op: "pnote-move", id: f.note.id, mode: m, place: places[m]! });
    } else if (moving || (card === undefined && declOp === undefined)) {
      const place = projectPlace(b, mode);
      if (place && "status" in place) return place;
      ops.push({ op: "pnote-move", id: f.note.id, mode, place: (place as ClusterPlace | undefined) ?? null });
    }
    if (card !== undefined) ops.push({ op: "pnote-card", id: f.note.id, card: card as NoteCard | null });
    const err = applyProject(a, ops);
    if (err) return err;
    const B = boardOf(world.views.book.project());
    const said = decl
      ? `Attached to ${(decl as NoteDecl).name} under every clustering, wherever a board holds it; beside it in its clusters is where it falls back to.`
      : decl === null && !moving
        ? "Detached: it is at its place under each clustering again."
        : moving || card === undefined
          ? `Moved under the ${mode} clustering alone: its place under the other is as it was.${detach ? " Detached from the declaration it was attached to." : ""}`
          : null;
    return ok({ ok: true, ...shown("project", world.views.book.notes.find((n) => n.id === f.note.id)!, "status" in B ? null : B), ...(said ? { note: said } : {}) });
  };

  const remove = (a: Ask): Answer => {
    const b = body(a);
    const f = find(b.id, b.view);
    if ("status" in f) return f;
    const no = mayChange(a, f.note);
    if (no) return no;
    if (f.kind === "project") {
      const err = applyProject(a, [{ op: "pnote-delete", id: f.note.id }]);
      if (err) return err;
    } else {
      const err = applyView(a, f.v, [{ op: "note-delete", id: f.note.id }]);
      if (err) return err;
    }
    return ok({ ok: true, kind: f.kind, ...(f.kind === "view" ? { view: f.v.id } : {}), deleted: f.note.id, text: f.note.text, note: "Deleted for everyone; the timeline keeps its text and says you did it." });
  };

  /** Whether a request places a note somewhere other than a declaration it is attached to. */
  function placing(b: Record<string, unknown>): boolean {
    return b.cluster !== undefined || b.name !== undefined || b.ring !== undefined || b.at !== undefined;
  }

  const where = {
    clustering: "namespace (default) or module: the clustering a note of the project is placed under; it has no place under the other until someone puts it there",
    cluster: "a cluster's key by that clustering — with at: [x, y], the spot as a fraction of its radius (default [0, 0], its centre) — or —",
    name: "a declaration: the note goes in its cluster by that clustering, just beside its point — or —",
    ring: "an angle in degrees clockwise from the top (0 at the top, 90 on the right): on the ring around the board, at the top level; true: no place by that clustering, so the ring puts it at the angle of its cluster under the other — or —",
    decl: `a declaration's full name, or {name, at}: the note is attached to it — its place under every clustering, shown wherever a board holds it, a thin dashed leader from its icon to the point — its icon at \`at\` from the point, a place on the board in its units, where a declaration's point is ${POINT_UNITS} across, so that it comes closer on the screen as the zoom goes out (x right, y down, between ${DECL_NEAR} and ${DECL_FAR} away; default [${DECL_AT.join(", ")}]); where the declaration is gone with no rename, it falls back to beside it in its cluster`,
  };
  return [
    {
      method: "GET", path: "/api/agent/notes", about: "The notes a view's board shows — of the project's, every one on the Project, elsewhere those its scope gives and those added to it, less those taken out; and the view's own — with where each is, why it shows, who wrote it, its kind and where its card hangs.",
      params: { view: "a view's id (default: the Project)", all: "1: every note of the project, shown on that board or not" },
      returns: "{view, title, items?: {add, remove} (the view's lists), notes: [{id, kind: project|view, text, open, by, agent, at, edited?, carries, card: [x, y] | null, decl: {name, at} | null, places? and why? (project: project, decl, cluster, ring, link or added; null where this board does not show it), view? (view), here}], note}",
      run: (a) => list(a),
    },
    {
      method: "POST", path: "/api/agent/note", brief: "a note that points people at something", needs: "advise",
      about: "Point people at something: a note, marked as yours. Without view, a note of the project — an item: on the Project, and on every view whose scope gives it (attached to a declaration it holds, in its cluster, on the ring about its cluster under the other clustering, or carrying a file linked to what the view holds) or that it is added to (in: the view you write it in) — attached to a declaration (decl), placed by cluster, beside a declaration, or on the ring. With view, that view's own note, on its board alone — attached to a declaration, beside one, in a cluster at an offset, or at a spot of the board. Activity records it. It moves nobody's view.",
      params: {
        text: "what to look at there (at most 2,000 characters): plain text with **bold**, *italics* and `code`; a full name in backticks becomes a link",
        view: "a view's id: the note is that view's own; leave it out for a note of the project",
        in: "a note of the project: the view you write it in, which it is added to, so that it shows there wherever it is put (as a note a person writes on a board is)",
        ...where,
        at: "with cluster: for a note of the project, a fraction of the radius; for a view's note, an offset in the cluster, or alone a spot of its board",
        open: "true (default): its text shown; false: collapsed to its first words",
        carries: `what it carries besides its text, at most ${MAX_CARRIES}: files of the library — {file: <sha256>} for an image or a whole PDF (a hash alone does too) — and clips, {file, page, region: [left, top, right, bottom]} in fractions of the page from its top left; GET /api/agent/library lists the files, library/text gives a page's words with their boxes`,
        card: `where its card hangs from its icon: [x, y], the card's centre from the icon's in pixels of the screen (x right, y down), each within ±${CARD_REACH}; left out, by default (up and to the right, outward on the ring)`,
      },
      returns: "{ok, id, kind, text, open, by, agent, at, carries: [{file, page?, region?, what: image|pdf|clip, title}], card, decl, places? and why? | view?, here, in?}",
      run: (a) => add(a),
    },
    {
      method: "POST", path: "/api/agent/note/edit", needs: "advise",
      about: "Edit a note — your own at advise, anyone's at full: its text, what it carries, whether it shows its text, where its card hangs, or its kind (kind view with view: only in that view; kind project: the project's again, added to that view), keeping its text, author, what it carries and where it is on that view's board. Activity records an edit of its text or of what it carries.",
      params: { id: "the note's id (GET /api/agent/notes)", view: "the view whose note it is, or becomes", text: "its new text", carries: "what it carries from now on, the whole list as for note ([] for nothing): what it carries already stays as it is, a file or a clip added must be in the library and not archived", open: "true: its text shown; false: collapsed", card: `[x, y]: where its card hangs from its icon, in pixels of the screen (each within ±${CARD_REACH}); null: by default`, kind: "project or view" },
      returns: "{ok, id, kind, text, open, …}",
      run: (a) => edit(a),
    },
    {
      method: "POST", path: "/api/agent/note/move", needs: "advise",
      about: "Move a note — your own at advise, anyone's at full. A note of the project moves under one clustering alone, on every board of that clustering; a view's note moves on its board. decl attaches either kind to a declaration, its place under every clustering; decl null detaches it, and so does any other place given. Its card, where it hangs from its icon, moves with card, alone or with its place: shared as its place is, no event.",
      params: { id: "the note's id", view: "for a view's note: its view", ...where, decl: `${where.decl}; null: detached, at its place under each clustering again`, detach: "true: as decl null", at: "with cluster: a fraction of the radius (a view's note: an offset), or alone a spot of a view's board", card: `[x, y]: where its card hangs from its icon, in pixels of the screen (each within ±${CARD_REACH}); null: by default; alone, the note stays where it is` },
      returns: "{ok, id, kind, decl, places? | view?, here, note?}",
      run: (a) => move(a),
    },
    {
      method: "POST", path: "/api/agent/note/delete", needs: "advise", about: "Delete a note for everyone — your own at advise, anyone's at full. Activity records it, with its text.",
      params: { id: "the note's id", view: "for a view's note: its view" },
      returns: "{ok, kind, view?, deleted, text, note}",
      run: (a) => remove(a),
    },
  ];
}
