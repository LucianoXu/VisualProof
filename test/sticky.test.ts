// Notes on a board (shared/sticky.ts, ViewSpec decision 23, CanvasSpec "Notes", decided
// 2026-10-09): a view's notes as its operations change them, the same on the server and in a page;
// who wrote each, attributed as pins are; where a note is — the most specific cluster at its spot,
// and the nearest one left when that one is gone — and how it shows: collapsed when zoomed out,
// hidden in a folded cluster that counts it; the timeline's events; agents' notes, which are notes
// on a board now.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { noteEndpoints } from "../src/server/agentnotes.ts";
import type { Answer, Ask, World } from "../src/server/agent.ts";
import { refusal } from "../src/server/agent.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { emptyReview } from "../src/shared/review.ts";
import { AUTO_COLLAPSE_PX, boardClusters, cleanNotes, MAX_NOTES, noteExcerpt, noteLook, noteMarkers, noteNames, placeAt, resolvePlace } from "../src/shared/sticky.ts";
import type { NoteOp, PlaceCluster, StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { applyViewOps, invalidViewOps, PROJECT, ViewBook } from "../src/shared/views.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const note = (id: string, text = "look here", over: Partial<StickyNote> = {}): StickyNote => ({
  id,
  text,
  place: { mode: "namespace", in: [["A.B", 3, 4], ["A", 13, 24]], world: [113, 224] },
  open: true,
  by: "Mallory",
  at: "2000-01-01T00:00:00.000Z",
  ...over,
});

/** A server's views in a site directory of their own, with the timeline they write. */
function server(dir: string) {
  const sent: { event: string; data: Json }[] = [];
  const events: StoredEvent[] = [];
  const timeline = { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events[events.length - 1]) };
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), timeline);
  const ask = (body: unknown, name: string | null = "Alice", kind: "person" | "agent" = "person", level: "read" | "advise" | "full" = "full") =>
    views.handle({ method: "POST", path: "/api/views/arrange", query: new URLSearchParams(), body, caller: { name, kind } } as Ask, level);
  return { views, sent, events, ask };
}

test("a view's notes change by its operations, the same on the server and in a page; the server says who wrote them", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-sticky-"));
  try {
    const S = server(dir);
    // a page writes a note under its reader's name; the server records who it says it is, not the
    // name the note carries, as it records who dropped a pin
    const add: NoteOp = { op: "note", note: note("n1", "the swap is applied twice in `A.B.c`") };
    assert.equal(S.ask({ id: PROJECT, ops: [add] }).status, 200);
    const kept = S.views.book.project().notes!;
    assert.equal(kept.length, 1);
    assert.equal(kept[0].by, "Alice");
    assert.notEqual(kept[0].at, "2000-01-01T00:00:00.000Z", "and when");
    // the operations go out stamped, so every page holds what the server holds
    const out = S.sent.filter((s) => s.event === "view-ops").at(-1)!.data;
    assert.equal(out.by, "Alice");
    assert.equal(out.ops[0].note.by, "Alice");
    const page = { pins: S.views.book.project().pins, folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, notes: [] as StickyNote[] };
    applyViewOps(page, out.ops);
    assert.deepEqual(page.notes, kept);
    // opened, collapsed, moved, edited, deleted: the same on both sides
    const ops: NoteOp[] = [
      { op: "note-open", id: "n1", open: false },
      { op: "note-move", id: "n1", place: { mode: "namespace", in: [["A", 1, 2]], world: [101, 202] } },
      { op: "note-edit", id: "n1", text: "the swap is applied once, in `A.B.c`" },
    ];
    assert.equal(S.ask({ id: PROJECT, ops }, "Bob").status, 200);
    applyViewOps(page, S.sent.filter((s) => s.event === "view-ops").at(-1)!.data.ops);
    assert.deepEqual(page.notes, S.views.book.project().notes);
    const n = page.notes[0];
    assert.deepEqual([n.open, n.place.in, n.text, n.by, n.edited?.by], [false, [["A", 1, 2]], "the swap is applied once, in `A.B.c`", "Alice", "Bob"]);
    // the same twice changes nothing; one about a note there is not changes nothing
    assert.equal(applyViewOps(page, [{ op: "note-open", id: "n1", open: false }, { op: "note-delete", id: "nope" }]), false);
    assert.equal(applyViewOps(page, [{ op: "note", note: note("n1", "again") }]), false, "an id taken");
    // kept on disk with the view, and read back; a broken note is left out, the others kept
    const file = join(dir, "views.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.views[0].notes.push({ id: "bad id!", text: "x", place: n.place, open: true }, { id: "n2", text: "", place: n.place, open: true });
    writeFileSync(file, JSON.stringify(raw));
    const again = new Views(dir, LAYOUT_VERSION, () => {});
    assert.deepEqual(again.book.project().notes, S.views.book.project().notes);
    // deleted
    assert.equal(S.ask({ id: PROJECT, ops: [{ op: "note-delete", id: "n1" }] }).status, 200);
    assert.deepEqual(S.views.book.project().notes, []);
    // what is refused: no text, too long, a place that is not one, an id that is not one
    for (const bad of [
      { op: "note", note: note("n3", " ") },
      { op: "note", note: note("n3", "x".repeat(2001)) },
      { op: "note", note: { ...note("n3"), place: { mode: "flat", in: [], world: [0, 0] } } },
      { op: "note", note: note("../n3") },
      { op: "note-edit", id: "n3", text: "" },
      { op: "note-open", id: "n3", open: "yes" },
      { op: "note-move", id: "n3", place: { mode: "namespace", in: [["A", 1]], world: [0, 0] } },
    ])
      assert.ok(invalidViewOps([bad]), JSON.stringify(bad).slice(0, 60));
    assert.equal(S.ask({ id: PROJECT, ops: [{ op: "note", note: note("n3", "") }] }).status, 400);
    // a view holds at most MAX_NOTES
    const many = { pins: S.views.book.project().pins, folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, notes: [] as StickyNote[] };
    applyViewOps(many, Array.from({ length: MAX_NOTES + 3 }, (_, k): NoteOp => ({ op: "note", note: note(`m${k}`) })));
    assert.equal(many.notes.length, MAX_NOTES);
    // an agent writes through the page's door at level full only, as it arranges a view
    assert.equal(S.ask({ id: PROJECT, ops: [{ op: "note", note: note("n4") }] }, "Claude", "agent", "advise").status, 403);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("written, edited and deleted are the timeline's; opened, collapsed and moved are not; a copy of a view keeps its notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-sticky-"));
  try {
    const S = server(dir);
    S.ask({ id: PROJECT, ops: [{ op: "note", note: note("n1", "first") }] });
    S.ask({ id: PROJECT, ops: [{ op: "note-open", id: "n1", open: false }, { op: "note-move", id: "n1", place: note("x").place }] }, "Bob");
    S.ask({ id: PROJECT, ops: [{ op: "note-edit", id: "n1", text: "second" }] }, "Bob");
    S.ask({ id: PROJECT, ops: [{ op: "note-edit", id: "n1", text: "second" }] }, "Bob");
    S.ask({ id: PROJECT, ops: [{ op: "note-delete", id: "n1" }] }, "Carol", "agent");
    const notes = S.events.filter((e) => e.kind === "note") as Json[];
    assert.deepEqual(
      notes.map((e) => [e.what, e.by, !!e.agent, e.view, e.title, e.note, e.text]),
      [
        ["created", "Alice", false, PROJECT, "Project", "n1", "first"],
        ["edited", "Bob", false, PROJECT, "Project", "n1", "second"],
        ["deleted", "Carol", true, PROJECT, "Project", "n1", "second"],
      ],
      "an edit to the same text is none; a deletion keeps the text it had",
    );
    // a view copied (Duplicate, or the menu's copy of a board whose scope is fixed) is the board it
    // was copied from, its notes on it
    const book = new ViewBook();
    book.arrange(PROJECT, [{ op: "note", note: note("n1") }], "Alice", { by: "Alice" });
    const copy = book.create("Copy", "Alice", { from: PROJECT });
    assert.ok(typeof copy !== "string");
    assert.deepEqual(copy.notes, book.project().notes);
    assert.notEqual(copy.notes, book.project().notes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A board's clusters: A at the origin (radius 100), A.B inside it (radius 30), A.B.C inside that,
 *  and Z beside A. */
const CLUSTERS: PlaceCluster[] = [
  { key: "A", parent: -1, depth: 0, x: 0, y: 0, r: 100, open: true },
  { key: "A.B", parent: 0, depth: 1, x: 40, y: 0, r: 30, open: true },
  { key: "A.B.C", parent: 1, depth: 2, x: 50, y: 0, r: 8, open: true },
  { key: "Z", parent: -1, depth: 0, x: 300, y: 0, r: 50, open: true },
];

test("writing, editing and deleting a note need a name, but a private reader's are kept without one; opening and moving need none", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-sticky-"));
  try {
    const S = server(dir);
    const as = (body: unknown, caller: Record<string, unknown>) =>
      S.views.handle({ method: "POST", path: "/api/views/arrange", query: new URLSearchParams(), body, caller: { kind: "person", ...caller } } as Ask, "full");
    const nameless = { name: null };
    assert.equal(as({ id: PROJECT, ops: [{ op: "note", note: note("n1") }] }, nameless).status, 401);
    assert.equal(S.views.book.project().notes?.length ?? 0, 0);
    // a private reader (CollabSpec decision 8): written, and kept as someone's
    const priv = { name: "Alice", private: { session: "s1" } };
    assert.equal(as({ id: PROJECT, ops: [{ op: "note", note: note("n1") }] }, priv).status, 200);
    assert.equal(S.views.book.project().notes![0].by, null);
    assert.equal(as({ id: PROJECT, ops: [{ op: "note-edit", id: "n1", text: "again" }] }, priv).status, 200);
    assert.equal(S.views.book.project().notes![0].edited!.by, null);
    assert.ok(!S.events.some((e) => (e as Json).by === "Alice"), "the timeline does not name her");
    // without a name, a note is neither edited nor deleted, but it is collapsed and moved
    assert.equal(as({ id: PROJECT, ops: [{ op: "note-edit", id: "n1", text: "x" }] }, nameless).status, 401);
    assert.equal(as({ id: PROJECT, ops: [{ op: "note-delete", id: "n1" }] }, nameless).status, 401);
    assert.equal(as({ id: PROJECT, ops: [{ op: "note-open", id: "n1", open: false }, { op: "note-move", id: "n1", place: note("x").place }] }, nameless).status, 200);
    assert.equal(S.views.book.project().notes![0].open, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a note is attached to the most specific open cluster at its spot, and to the nearest one left when that one goes", () => {
  // inside A.B, off A.B.C: A.B, with the spot's offset in it and in every cluster around it
  const p = placeAt("namespace", [30, 10], CLUSTERS);
  assert.deepEqual(p, { mode: "namespace", in: [["A.B", -10, 10], ["A", 30, 10]], world: [30, 10] });
  // inside A.B.C: the innermost
  assert.deepEqual(placeAt("namespace", [52, 1], CLUSTERS).in[0], ["A.B.C", 2, 1]);
  // a folded cluster is no place for a note: the open one around it is
  const folded = CLUSTERS.map((c) => (c.key.startsWith("A.B") ? { ...c, open: false } : c));
  assert.deepEqual(placeAt("namespace", [52, 1], folded).in, [["A", 52, 1]]);
  // nothing there: on the canvas, in world coordinates
  assert.deepEqual(placeAt("module", [150, 150], CLUSTERS), { mode: "module", in: [], world: [150, 150] });
  // where it is on a layout: its cluster, at its offset there
  const index = (keys: string[]) => (key: string) => keys.indexOf(key);
  assert.deepEqual(resolvePlace(p, "namespace", index(["A", "A.B", "Z"])), { c: 1, dx: -10, dy: 10 });
  // its cluster gone (a new graph, a scope that no longer holds it): the nearest one around it that
  // is left, where the spot was in it; none left: the canvas, at the spot
  assert.deepEqual(resolvePlace(p, "namespace", index(["A", "Z"])), { c: 0, dx: 30, dy: 10 });
  assert.deepEqual(resolvePlace(p, "namespace", index(["Z"])), { c: -1, dx: 30, dy: 10 });
  // under the other clustering it is on the ring (shared/noteplace.ts), never in a folder that has
  // its namespace's key (AttachmentSpec decision 18)
  assert.equal(resolvePlace(p, "module", index(["A", "A.B", "Z"])), null);
  // a board laid out from its layout and its pins, at rest, as the server reads it for an agent
  const L: Layout = {
    x: [], y: [], lx: [5], ly: [6], cluster: [1],
    clusters: [
      { key: "A", label: "A", parent: -1, depth: 0, x: 0, y: 0, lx: 0, ly: 0, r: 100, count: 1, ext: false },
      { key: "A.B", label: "B", parent: 0, depth: 1, x: 40, y: 0, lx: 40, ly: 0, r: 30, count: 1, ext: false },
    ],
  };
  const at = boardClusters(L, { nodes: {}, clusters: { A: [1000, 0] } }, ["A.B"]);
  assert.deepEqual(at.map((c) => [c.key, c.x, c.y, c.open]), [["A", 1000, 0, true], ["A.B", 1040, 0, false]]);
});

test("zoomed out a note shows collapsed, whatever its state; a folded cluster hides its notes and counts them", () => {
  assert.equal(noteLook(true, AUTO_COLLAPSE_PX), "open");
  assert.equal(noteLook(true, AUTO_COLLAPSE_PX - 1), "shut", "its cluster small on the screen");
  assert.equal(noteLook(false, 10_000), "shut", "collapsed by its own state");
  assert.equal(noteLook(true, null), "open", "on the canvas, never collapsed for the zoom");
  // notes in A.B.C (2), A.B (1), Z (1), on the canvas (1); A.B folded: three hidden, counted on A.B,
  // the outermost folded cluster around them
  const shownAs = (c: number) => (c === 1 || c === 2 ? 1 : -1);
  assert.deepEqual([...noteMarkers([2, 2, 1, 3, -1], shownAs)], [[1, 3]]);
  // and A folded around it: counted on A
  assert.deepEqual([...noteMarkers([2, 1, 3], (c) => (c <= 2 ? 0 : -1))], [[0, 2]]);
  assert.equal(noteMarkers([2, 3], () => -1).size, 0, "nothing folded, no marker");
  // a collapsed note shows its first words, without the Markdown
  assert.equal(noteExcerpt("The **swap** is `applied` twice here"), "The swap is appli…");
  assert.equal(noteExcerpt("Short"), "Short");
  // what a note names: in backticks, or a dotted name written bare
  assert.deepEqual(noteNames("see `A.B.c` and then A.d, not this."), ["A.B.c", "A.d"]);
});

test("notes read back from a file: what cannot be read is left out", () => {
  const good = note("n1");
  const out = cleanNotes([good, { ...good }, { ...good, id: "n2", open: "yes" }, { ...good, id: "n3", place: null }, "x", { ...good, id: "n4", by: 5, agent: true, edited: { by: "B", at: "t" } }]);
  assert.deepEqual(out.map((n) => [n.id, n.by, !!n.agent, n.edited?.by ?? null]), [["n1", "Mallory", false, null], ["n4", null, true, "B"]]);
  assert.deepEqual(cleanNotes(undefined), []);
});

/** The agents' notes on a small project: N.A (t, d) and N.B (e, x), laid out as the server lays
 *  them out. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "vp-sticky-agents-"));
  const names = ["N.A.t", "N.A.d", "N.B.e", "N.B.x"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: "def", module: name.slice(0, 3), ax: 0, hash: `h-${name}` }));
  const edges = new Int32Array([0, 1, SITE_STMT, 2, 3, SITE_STMT]);
  const meta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["N"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [],
    nodes,
    projectCount: names.length,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 2,
  } as ViewMeta;
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events.at(-1)!) };
  const views = new Views(dir, LAYOUT_VERSION, () => {}, timeline);
  const presence = new Presence(() => {});
  const w = {
    project: { root: dir, files: new Map(), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
    review: { data: emptyReview(), append: () => ({ status: 403, error: "not here" }) },
    timeline,
    places: views.places,
    presence,
    placesChanged: () => {},
    views,
  } as unknown as World;
  const ask = (level: "read" | "advise" | "full", method: "GET" | "POST", path: string, params: Json = {}): Answer => {
    const e = noteEndpoints(w, (c, need) => refusal(level, need))!.find((x) => x.method === method && x.path === path)!;
    const caller = { name: "Claude", kind: "agent" as const };
    return e.run(method === "GET" ? { method, path, query: new URLSearchParams(params), body: null, caller } : { method, path, query: new URLSearchParams(), body: params, caller }) as Answer;
  };
  return { meta, views, events, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("an agent's view note is the view's own, placed as it always was: beside a declaration, in a cluster, or at a spot; advise adds and changes its own, full anyone's", () => {
  const W = world();
  try {
    const body = (a: Answer) => a.body as Json;
    const view = PROJECT;
    // beside a declaration: its innermost cluster, just by its point
    const L = W.meta.layouts.namespace;
    const i = 1;
    const c = L.clusters[L.cluster[i]];
    const beside = W.ask("advise", "POST", "/api/agent/note", { view, name: "N.A.d", text: "start at `N.A.d`" });
    assert.equal(beside.status, 200, JSON.stringify(beside.body));
    assert.deepEqual([body(beside).kind, body(beside).view, body(beside).here, body(beside).by, body(beside).agent], ["view", PROJECT, { cluster: c.key, offset: [Math.round((L.lx[i] + 9) * 10) / 10, Math.round((L.ly[i] - 9) * 10) / 10] }, "Claude", true]);
    const stuck = W.views.book.project().notes![0];
    assert.equal(stuck.place.in.at(-1)![0], "N", "with every cluster around it");
    assert.equal(W.views.book.notes.length, 0, "a view's own: none of the project's");
    // in a cluster, at an offset; at a spot of the board alone, the innermost open cluster there
    assert.deepEqual(body(W.ask("advise", "POST", "/api/agent/note", { view, cluster: "N.B", at: [3, 4], text: "here" })).here.offset, [3, 4]);
    const nb = L.clusters.find((x) => x.key === "N.B")!;
    const spot = W.ask("advise", "POST", "/api/agent/note", { view, at: [nb.x, nb.y], text: "and here" });
    assert.equal(body(spot).here.cluster, "N.B");
    assert.deepEqual(body(W.ask("advise", "POST", "/api/agent/note", { view, at: [1e6, 1e6], text: "far" })).here, { spot: [1e6, 1e6] }, "nowhere: on the canvas");
    // on another view, which must hold the declaration
    const other = W.views.book.create("Mine", "Alice", { scope: { op: "ns", prefix: "N.B" } });
    assert.ok(typeof other !== "string");
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { view: other.id, name: "N.A.d", text: "x" }).status, 404);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { view: other.id, name: "N.B.e", text: "x" }).status, 200);
    assert.equal(W.views.book.get(other.id)!.notes!.length, 1);
    // refused: no text, nowhere said, an unknown view, a read token
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { view, name: "N.A.d" }).status, 400);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { view, text: "x" }).status, 400);
    assert.equal(W.ask("advise", "POST", "/api/agent/note", { view: "nope", at: [0, 0], text: "x" }).status, 404);
    assert.equal(W.ask("read", "POST", "/api/agent/note", { view, at: [0, 0], text: "x" }).status, 403);
    // the timeline says so, under the agent's name, on the view
    assert.deepEqual(W.events.filter((e) => e.kind === "note").map((e) => [(e as Json).what, (e as Json).by, (e as Json).agent, (e as Json).view]).at(0), ["created", "Claude", true, PROJECT]);
    // listed, with where each is
    const listed = body(W.ask("read", "GET", "/api/agent/notes"));
    assert.equal(listed.notes.length, 4);
    assert.equal(listed.notes[0].here.cluster, c.key);
    // its own at advise; another's at full only
    const id = stuck.id;
    const mine = W.ask("advise", "POST", "/api/agent/note/edit", { view, id, text: "start at `N.A.t`", open: false });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual([body(mine).text, body(mine).open, body(mine).edited.by], ["start at `N.A.t`", false, "Claude"]);
    W.views.arrange(PROJECT, [{ op: "note", note: { id: "nAlice", text: "Alice's", place: stuck.place, open: true, by: "Alice", at: "" } }], null, "Alice");
    assert.equal(W.ask("advise", "POST", "/api/agent/note/edit", { view, id: "nAlice", text: "y" }).status, 403);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/move", { view, id: "nAlice", cluster: "N.B" }).status, 403);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/delete", { view, id: "nAlice" }).status, 403);
    assert.equal(W.ask("full", "POST", "/api/agent/note/edit", { view, id: "nAlice", text: "y" }).status, 200);
    // moved on its board, under its view's clustering
    const moved = W.ask("advise", "POST", "/api/agent/note/move", { view, id, cluster: "N.B", at: [1, 2] });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.deepEqual(body(moved).here, { cluster: "N.B", offset: [1, 2] });
    assert.equal(W.ask("full", "POST", "/api/agent/note/edit", { view, id }).status, 400, "nothing to change");
    assert.equal(W.ask("full", "POST", "/api/agent/note/delete", { view, id: "nope" }).status, 404);
    assert.equal(W.ask("advise", "POST", "/api/agent/note/delete", { view, id }).status, 200);
    assert.equal(W.views.book.project().notes!.length, 4);
    assert.deepEqual(W.events.filter((e) => e.kind === "note").map((e) => (e as Json).what), ["created", "created", "created", "created", "created", "edited", "created", "edited", "deleted"]);
  } finally {
    W.done();
  }
});
