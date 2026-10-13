// Items belong to views as declarations do (the owner's decision of 2026-10-11; AttachmentSpec
// decision 17, shared/items.ts, shared/noteplace.ts): the Project holds every note of the project;
// another view shows what follows from its scope — a note in a cluster on its board, on the ring
// about a cluster under the other clustering on it, or carrying a file linked to what it holds; a
// note's mentions are not links — and what was added to it, less what was taken out; read live;
// Zoom in starts with no lists, Duplicate copies them (of the Project, what the copy would not
// derive, as added); what is written in a view is added to it; a note deleted leaves every list;
// view notes are untouched; the timeline records adding and taking out; the agents' API and the
// export's authors.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readView, Views } from "../src/server/views.ts";
import type { ClusterMode, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { applyItemOp, cleanItems, dropItem, itemIn, itemOp, itemShown } from "../src/shared/items.ts";
import type { ViewItems } from "../src/shared/items.ts";
import { clusterKeys, clusterTree } from "../src/shared/layout.ts";
import { aboutMembers, derivedWhy, itemBoard, itemSpot, itemsShownOn, itemWhy, linkedOn, linksByFile, noteBoard } from "../src/shared/noteplace.ts";
import { printQuery } from "../src/shared/query.ts";
import type { ProjectNote } from "../src/shared/projectnotes.ts";
import type { StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { invalidViewOps, PROJECT, ViewBook } from "../src/shared/views.ts";
import type { ViewOp } from "../src/shared/views.ts";
import { menuItems } from "../src/web/src/ctxmenu.ts";
import type { MenuContext } from "../src/web/src/ctxmenu.ts";
import { tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

/** Namespaces N.A (t, d), N.B (e, x) and the structure N.S with its constructor; folders N.A (t, e),
 *  N.C (d, x) and N.D (the structure's). */
const NODES: ViewNode[] = [
  { name: "N.A.t", kind: "theorem", module: "N.A", ax: 0 },
  { name: "N.A.d", kind: "def", module: "N.C", ax: 0 },
  { name: "N.B.e", kind: "def", module: "N.A", ax: 0 },
  { name: "N.B.x", kind: "def", module: "N.C", ax: 0 },
  { name: "N.S", kind: "structure", module: "N.D", ax: 0 },
  { name: "N.S.mk", kind: "def", module: "N.D", ax: 0 },
];
const at = (name: string) => NODES.find((n) => n.name === name)!;
const ex = (m: ClusterMode, key: string) => clusterKeys(m, NODES).has(key);
const [F, G, H, K] = ["f", "a", "b", "c"].map((x) => x.repeat(64));
const LINKS = [
  { subject: "decl(N.B.e)", file: F },
  { subject: "ns(N.A)", file: G },
  { subject: "file(N.C)", file: H },
  { subject: "ns(N.S)", file: K },
];
const note = (id: string, places: ProjectNote["places"], over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text: `note ${id}`, places, open: false, by: "Alice", at: "2026-10-11T10:00:00.000Z", ...over });
const inA = note("inA", { namespace: { in: [["N.A", 0.5, 0], ["N", 0.2, 0]] } });
const ringNs = note("ringNs", { namespace: { ring: 45 }, module: { in: [["N.C", 0, 0]] } });
const top = note("top", {});
const paper = note("paper", {}, { carries: [{ file: F }] });
const clip = note("clip", {}, { carries: [{ file: G, page: 2, region: [0.1, 0.1, 0.9, 0.3] }] });
const folder = note("folder", {}, { carries: [{ file: H }] });
const struct = note("struct", {}, { carries: [{ file: K }] });
const mention = note("mention", {}, { text: "every use of `N.B.e` rounds down" });
const ALL = [inA, ringNs, top, paper, clip, folder, struct, mention];

/** The notes a view shows on a board of `names` by `mode`: `all` the Project, `items` its lists. */
function shown(names: string[], mode: ClusterMode, view: { all: boolean; items?: ViewItems } = { all: false }, links = LINKS): string[] {
  const b = itemBoard(mode, names.map(at));
  const index = linksByFile(links);
  return ALL.filter((n) => itemWhy(n, view, b, ex, index)).map((n) => n.id);
}

test("the Project holds every item, wherever it sits; another view what follows from its scope: its cluster, its cluster under the other clustering for a note on the ring, a file linked to what it holds", () => {
  // the Project, by either clustering, whatever it holds: every note
  for (const mode of ["namespace", "module"] as ClusterMode[]) assert.deepEqual(shown(["N.B.x"], mode, { all: true }), ALL.map((n) => n.id));
  const why = (n: ProjectNote, names: string[], mode: ClusterMode = "namespace") => derivedWhy(n, itemBoard(mode, names.map(at)), ex, linksByFile(LINKS));
  // its cluster on the board
  assert.equal(why(inA, ["N.A.t"]), "cluster");
  assert.equal(why(inA, ["N.B.e"]), null, "N.A is not on a board of N.B.e");
  // on the ring under the board's clustering: where its cluster under the other has a declaration
  assert.equal(why(ringNs, ["N.B.x"]), "ring", "N.B.x is in the folder N.C");
  assert.equal(why(ringNs, ["N.B.e"]), null);
  // in a cluster under the board's clustering that is not on it: the other clustering does not
  // bring it (decision 17's second clause is the ring's)
  assert.equal(why(note("both", { namespace: { in: [["N.A", 0, 0]] }, module: { in: [["N.C", 0, 0]] } }), ["N.B.x"]), null);
  // at the top level under both, carrying nothing linked: the Project's alone
  assert.equal(why(top, NODES.map((n) => n.name)), null);
  // a file linked to a declaration on the board, to a namespace that holds one, to a folder that
  // holds one; a namespace link reaches its structure, which is its namespace
  assert.equal(why(paper, ["N.B.e"]), "link");
  assert.equal(why(paper, ["N.B.x"]), null);
  assert.equal(why(clip, ["N.A.d"]), "link", "a clip carries its file, linked to ns(N.A)");
  assert.equal(why(clip, ["N.B.e"]), null, "N.B.e is in the folder N.A, not the namespace");
  assert.equal(why(folder, ["N.A.d"], "namespace"), "link", "file(N.C) on a board by namespace: the folder holds N.A.d");
  assert.equal(why(struct, ["N.S"]), "link", "ns(N.S) reaches the structure N.S, alone on the board");
  assert.deepEqual(linkedOn(paper, itemBoard("namespace", [at("N.B.e"), at("N.A.d")]), linksByFile(LINKS)), ["decl(N.B.e)"]);
  // a note that names a declaration in backticks is not connected to it
  assert.equal(why(mention, ["N.B.e"]), null);
  // a whole board of N.B by namespace: the ring note through N.C, the paper through its link
  assert.deepEqual(shown(["N.B.e", "N.B.x"], "namespace"), ["ringNs", "paper", "folder"]);
});

test("a view shows what was added to it, and not what was taken out, whatever its scope gives", () => {
  const items: ViewItems = { add: ["top", "mention"], remove: ["paper"] };
  assert.deepEqual(shown(["N.B.e", "N.B.x"], "namespace", { all: false, items }), ["ringNs", "top", "folder", "mention"]);
  assert.equal(itemWhy(top, { all: false, items }, itemBoard("namespace", [at("N.B.e")]), ex, new Map()), "added");
  // derived and added: the scope says why
  assert.equal(itemWhy(paper, { all: false, items: { add: ["paper"], remove: [] } }, itemBoard("namespace", [at("N.B.e")]), ex, linksByFile(LINKS)), "link");
  // the Project keeps everything, lists or not
  assert.deepEqual(shown(["N.B.e"], "namespace", { all: true, items }), ALL.map((n) => n.id));
  // what the export counts, from what a board holds alone
  assert.deepEqual(
    itemsShownOn(ALL, { all: false, items }, "namespace", [at("N.B.e"), at("N.B.x")], NODES, LINKS).map((n) => n.id),
    ["ringNs", "top", "folder", "mention"],
  );
});

test("live: a file linked to what a view holds brings its note there; the link gone, it goes, unless it was added", () => {
  const board = ["N.B.e"];
  assert.deepEqual(shown(board, "namespace", { all: false }, []), []);
  assert.deepEqual(shown(board, "namespace", { all: false }, [{ subject: "decl(N.B.e)", file: F }]), ["paper"]);
  assert.deepEqual(shown(board, "namespace", { all: false }, []), [], "unlinked: gone");
  assert.deepEqual(shown(board, "namespace", { all: false, items: { add: ["paper"], remove: [] } }, []), ["paper"], "added: it stays");
});

test("on the ring: a note shown where its own cluster is not, or at the top level, points toward what it is linked to on this board, else by decision 16", () => {
  const nodes = [at("N.B.e"), at("N.B.x")];
  const nb = noteBoard(clusterTree("namespace", nodes), "namespace", nodes);
  const index = linksByFile(LINKS);
  const spot = (n: ProjectNote) => itemSpot(n, nb, ex, linkedOn(n, nb, index));
  // a library file's note, linked to N.B.e: toward it
  assert.deepEqual(spot(paper), { at: "ring", angle: null, about: { links: ["decl(N.B.e)"] } });
  assert.deepEqual(aboutMembers(nb, { links: ["decl(N.B.e)"] }), [0]);
  assert.deepEqual(aboutMembers(nb, { links: ["file(N.C)"] }), [1], "a folder link: what the folder holds on the board");
  // let go on the ring at an angle: there, whatever it is linked to
  assert.deepEqual(spot({ ...paper, places: { namespace: { ring: 120 } } }), { at: "ring", angle: 120, about: { links: ["decl(N.B.e)"] } });
  // added where its cluster is not drawn: on the ring, about its cluster under the other clustering
  // where that is on the board, else in the order notes were written
  assert.deepEqual(spot(inA), { at: "ring", angle: null, about: null });
  assert.deepEqual(spot({ ...inA, places: { ...inA.places, module: { in: [["N.C", 0, 0]] } } }), { at: "ring", angle: null, about: { mode: "module", key: "N.C" } });
  // a link wins over the other clustering
  assert.deepEqual(spot({ ...paper, places: { module: { in: [["N.C", 0, 0]] } } }), { at: "ring", angle: null, about: { links: ["decl(N.B.e)"] } });
  // in its cluster where the board draws it, as ever
  const nA = noteBoard(clusterTree("namespace", NODES), "namespace", NODES);
  assert.equal(itemSpot(inA, nA, ex).at, "cluster");
});

test("a view's lists: one operation puts a note in one list or neither; Add to view and Remove from this view write the shortest", () => {
  const v: { items?: ViewItems } = {};
  assert.ok(applyItemOp(v, { op: "item", note: "n1", in: "add" }));
  assert.ok(!applyItemOp(v, { op: "item", note: "n1", in: "add" }), "nothing changed");
  assert.ok(applyItemOp(v, { op: "item", note: "n1", in: "remove" }));
  assert.deepEqual(v.items, { add: [], remove: ["n1"] });
  assert.ok(applyItemOp(v, { op: "item", note: "n1", in: null }));
  assert.equal(v.items, undefined, "both empty: none kept");
  // added: on the add list only where the scope does not give it, off the remove list either way
  assert.deepEqual(itemOp(undefined, "n", "add", false), { op: "item", note: "n", in: "add" });
  assert.equal(itemOp(undefined, "n", "add", true), null, "the scope gives it: nothing to do");
  assert.deepEqual(itemOp({ add: [], remove: ["n"] }, "n", "add", true), { op: "item", note: "n", in: null }, "put back: off the remove list");
  assert.deepEqual(itemOp({ add: [], remove: ["n"] }, "n", "add", false), { op: "item", note: "n", in: "add" });
  // taken out: on the remove list only where the scope gives it, off the add list either way
  assert.deepEqual(itemOp(undefined, "n", "remove", true), { op: "item", note: "n", in: "remove" });
  assert.deepEqual(itemOp({ add: ["n"], remove: [] }, "n", "remove", false), { op: "item", note: "n", in: null });
  assert.deepEqual(itemOp({ add: ["n"], remove: [] }, "n", "remove", true), { op: "item", note: "n", in: "remove" });
  assert.equal(itemOp(undefined, "n", "remove", false), null);
  // what the timeline says of each
  assert.equal(itemShown(null, { op: "item", note: "n", in: "add" }), true);
  assert.equal(itemShown("remove", { op: "item", note: "n", in: null }), true);
  assert.equal(itemShown("add", { op: "item", note: "n", in: null }), false);
  assert.equal(itemShown(null, { op: "item", note: "n", in: "remove" }), false);
  // read back with care; checked as operations
  assert.deepEqual(cleanItems({ add: ["a", "a", "bad id!", 3], remove: ["a", "b"] }), { items: { add: ["a"], remove: ["b"] } });
  assert.deepEqual(cleanItems({ add: [], remove: [] }), {});
  assert.equal(itemIn({ add: ["a"], remove: ["b"] }, "b"), "remove");
  assert.equal(invalidViewOps([{ op: "item", note: "n", in: "add" }]), null);
  assert.equal(invalidViewOps([{ op: "item", note: "n", in: "both" }]), "in");
  assert.equal(invalidViewOps([{ op: "item", note: "no such id!", in: null }]), "note");
  assert.deepEqual(dropItem([{ id: "v1", items: { add: ["n"], remove: [] } }, { id: "v2" }], "n"), [{ view: "v1", op: { op: "item", note: "n", in: null } }]);
  // a record keeps its lists; the Project none, holding everything
  const raw = { id: "v1", scope: { op: "all" }, items: { add: ["n"], remove: [] } };
  assert.deepEqual((readView(raw) as { items?: ViewItems }).items, { add: ["n"], remove: [] });
  assert.equal((readView({ ...raw, id: PROJECT }) as { items?: ViewItems }).items, undefined);
});

test("the book: not on the Project, only notes of the project; Zoom in starts with no lists; Duplicate copies them, a copy of the Project what its scope would not give", () => {
  const book = new ViewBook([], [inA, top, paper]);
  const v = book.create("N.B", "Alice", { scope: { op: "ns", prefix: "N.B" } });
  assert.ok(typeof v !== "string");
  // the Project holds every note: nothing to add or take out there
  assert.match(String(book.arrange(PROJECT, [{ op: "item", note: "top", in: "add" }], "Alice")), /Project holds every note/);
  // what is added is a note of the project; a view's own note is no item
  book.arrange(v.id, [{ op: "note", note: { id: "own", text: "mine", place: { mode: "namespace", in: [], world: [0, 0] }, open: true, by: "A", at: "" } }], "Alice");
  assert.match(String(book.arrange(v.id, [{ op: "item", note: "own", in: "add" }], "Alice")), /no note own of the project/);
  assert.deepEqual(book.arrange(v.id, [{ op: "item", note: "top", in: "add" }, { op: "item", note: "inA", in: "remove" }], "Alice"), []);
  assert.deepEqual(v.items, { add: ["top"], remove: ["inA"] });
  // a list changed keeps a view nobody kept
  const temp = book.open({ op: "decl", names: ["N.B.e"] }, "Bob").view;
  assert.equal(temp.items, undefined, "Zoom in: what its scope gives, nothing added or taken out");
  assert.deepEqual(book.arrange(temp.id, [{ op: "item", note: "top", in: "add" }], "Bob"), [{ id: temp.id, what: "kept", by: "Bob" }]);
  // the same query opened again: the view nobody keeps, never a kept one with lists
  assert.notEqual(book.open({ op: "decl", names: ["N.B.e"] }, "Carol").view.id, temp.id);
  // Duplicate: its lists, copied
  const copy = book.create("Copy", "Alice", { from: v.id });
  assert.ok(typeof copy !== "string");
  assert.deepEqual(copy.items, { add: ["top"], remove: ["inA"] });
  copy.items!.add.push("paper");
  assert.deepEqual(v.items!.add, ["top"], "a copy, not the same lists");
  // Duplicate of the Project: what the copy's scope would not give, as added — reckoned on the
  // Project's scope, so that a copy without something leaves its notes out with it
  const asked: unknown[] = [];
  book.derives = (src) => {
    asked.push(src.scope);
    return (n) => n.id === "inA";
  };
  const dup = book.create("Project (copy)", "Alice", { from: PROJECT });
  assert.ok(typeof dup !== "string");
  assert.deepEqual(dup.items, { add: ["top", "paper"], remove: [] });
  const without = book.create("Project without N.A", "Alice", { from: PROJECT, scope: { op: "ns", prefix: "N.B" } });
  assert.ok(typeof without !== "string");
  assert.deepEqual(without.items, { add: ["top", "paper"], remove: [] });
  assert.deepEqual(asked, [{ op: "all" }, { op: "all" }]);
  // with nothing that reads a graph, a copy of the Project takes none
  book.derives = null;
  assert.equal((book.create("Bare", "Alice", { from: PROJECT }) as { items?: ViewItems }).items, undefined);
});

test("view notes are untouched: made the project's on a board it is added to that view; made a view's own it leaves every list", () => {
  const place: StickyNote["place"] = { mode: "namespace", in: [], world: [0, 0] };
  const book = new ViewBook([], [top]);
  const v = book.create("V", "Alice", { scope: { op: "ns", prefix: "N.B" } }) as Exclude<ReturnType<ViewBook["create"]>, string>;
  const w = book.create("W", "Alice", { scope: { op: "ns", prefix: "N.A" } }) as Exclude<ReturnType<ViewBook["create"]>, string>;
  book.arrange(w.id, [{ op: "item", note: "top", in: "add" }], "Alice");
  // the project's note made V's own: no list names it any more
  const r = book.switchNote("top", v.id, "view", place, "namespace", "Alice");
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.drops, [{ view: w.id, op: { op: "item", note: "top", in: null } }]);
  assert.equal(w.items, undefined);
  // V's note made the project's on V: added to V, so that it stays on the board it was put on
  const back = book.switchNote("top", v.id, "project", { ring: 0 }, "namespace", "Alice");
  assert.ok(typeof back !== "string");
  assert.deepEqual(back.view, [{ op: "note-delete", id: "top" }, { op: "item", note: "top", in: "add" }]);
  assert.deepEqual(v.items, { add: ["top"], remove: [] });
  // made the project's on the Project: no lists there
  book.arrange(PROJECT, [{ op: "note", note: { id: "p1", text: "x", place, open: true, by: "A", at: "" } }], "A");
  const onProject = book.switchNote("p1", PROJECT, "project", { ring: 0 }, "namespace", "A");
  assert.ok(typeof onProject !== "string");
  assert.deepEqual(onProject.view, [{ op: "note-delete", id: "p1" }]);
  assert.equal(book.project().items, undefined);
  // a view's own note shows on its board alone, items or not: nothing of the lists reads it
  assert.deepEqual(v.notes ?? [], []);
});

/** The server's views on their own, with the timeline and what goes out. */
function server() {
  const dir = mkdtempSync(join(tmpdir(), "vp-items-"));
  const events: StoredEvent[] = [];
  const sent: { event: string; data: Json }[] = [];
  const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as Json }), { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events.at(-1)!) });
  return { dir, views, events, sent, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the timeline records a note added to a view or taken out of it, as a scope change; writing in a view adds it, with the note's own event alone; deleting a note clears every list", () => {
  const S = server();
  try {
    const V = S.views;
    assert.equal(V.arrangeNotes([{ op: "pnote", note: top }, { op: "pnote", note: paper }], null, "Alice"), null);
    const v = V.book.create("N.B", "Alice", { scope: { op: "ns", prefix: "N.B" } });
    assert.ok(typeof v !== "string");
    const items = () => S.events.filter((e) => e.kind === "view" && e.what === "items").map((e) => [(e as Json).note, (e as Json).shown, (e as Json).by, (e as Json).text]);
    // added, then taken out (off its add list), then put on the remove list, then put back
    const ops: ViewOp[][] = [[{ op: "item", note: "top", in: "add" }], [{ op: "item", note: "top", in: null }], [{ op: "item", note: "paper", in: "remove" }], [{ op: "item", note: "paper", in: null }]];
    for (const o of ops) assert.equal(V.arrange(v.id, o, null, "Bob"), null);
    assert.deepEqual(items(), [["top", true, "Bob", "note top"], ["top", false, "Bob", "note top"], ["paper", false, "Bob", "note paper"], ["paper", true, "Bob", "note paper"]]);
    assert.ok(S.sent.some((s) => s.event === "view-ops" && s.data.id === v.id && s.data.ops[0].op === "item"), "shared live, as pins are");
    // an agent's: marked so
    V.arrange(v.id, [{ op: "item", note: "top", in: "add" }], null, "Claude", true);
    assert.equal((S.events.at(-1) as Json).agent, true);
    // written in the view: added to it, and the note's own event the only one
    const before = S.events.length;
    assert.equal(V.arrangeNotes([{ op: "pnote", note: note("w1", {}) }], "page-1", "Carol", false, null, v.id), null);
    assert.deepEqual(V.book.get(v.id)!.items!.add, ["top", "w1"]);
    assert.deepEqual(S.events.slice(before).map((e) => [e.kind, (e as Json).what]), [["note", "created"]]);
    assert.deepEqual(S.sent.findLast((x) => x.event === "view-ops")?.data, { id: v.id, ops: [{ op: "item", note: "w1", in: "add" }], from: "page-1", by: "Carol" });
    // written on the Project: no lists there
    V.arrangeNotes([{ op: "pnote", note: note("w2", {}) }], null, "Carol", false, null, PROJECT);
    assert.equal(V.book.project().items, undefined);
    // written in a view nobody kept: it keeps it, for everyone
    const temp = V.book.open({ op: "decl", names: ["N.B.e"] }, "Dave").view;
    V.arrangeNotes([{ op: "pnote", note: note("w3", {}) }], null, "Dave", false, null, temp.id);
    assert.equal(V.book.get(temp.id)!.kept, true);
    assert.deepEqual(V.book.get(temp.id)!.items, { add: ["w3"], remove: [] });
    // deleted: in no list any more, every page told — nobody's change of those views
    const copy = V.book.create("Copy", "Alice", { from: v.id });
    assert.ok(typeof copy !== "string");
    const sentBefore = S.sent.length;
    assert.equal(V.arrangeNotes([{ op: "pnote-delete", id: "top" }], null, "Alice"), null);
    assert.deepEqual([V.book.get(v.id)!.items, V.book.get(copy.id)!.items], [{ add: ["w1"], remove: [] }, { add: ["w1"], remove: [] }]);
    const drops = S.sent.slice(sentBefore).filter((s) => s.event === "view-ops");
    assert.deepEqual(drops.map((s) => [s.data.id, s.data.by, s.data.ops]), [[v.id, null, [{ op: "item", note: "top", in: null }]], [copy.id, null, [{ op: "item", note: "top", in: null }]]]);
    assert.ok(!S.events.some((e) => e.kind === "view" && e.what === "items" && (e as Json).note === "top" && e.id > before), "no event of the views for it");
    // kept in views.json beside the scope, and read back as kept
    const again = new Views(S.dir, LAYOUT_VERSION, () => {});
    assert.deepEqual(again.book.get(v.id)!.items, { add: ["w1"], remove: [] });
    assert.equal(printQuery(again.book.get(v.id)!.scope), "ns(N.B)", "never in the scope's text");
  } finally {
    S.done();
  }
});

test("the note's menu: Add to view ▸ with the views that show it marked, Remove from this view but on the Project; a view's own note has neither", () => {
  const ctx: MenuContext = { fixed: false, review: null, views: [], arrange: true, write: true };
  const views = [
    { id: "v1", title: "TCB of ns Fermat42", holds: true },
    { id: "v2", title: "Review ★t", holds: false },
    { id: "v3", title: "what Fermat42.not_minimal uses", holds: false, temporary: true },
  ];
  const items = menuItems({ kind: "note", open: true, view: false, items: { views, remove: true } }, ctx);
  assert.deepEqual(items.map((it) => it.act), ["note-edit", "note-toggle", "note-kind", "item-add", "item-remove", "note-delete"]);
  const add = items.find((it) => it.act === "item-add")!;
  assert.deepEqual(add.sub!.map((it) => [it.act, it.label, !!it.disabled, it.note ?? null]), [["item:v1", "TCB of ns Fermat42 ✓", true, null], ["item:v2", "Review ★t", false, null], ["item:v3", "what Fermat42.not_minimal uses", false, "temporary"]]);
  assert.ok(!add.sub!.some((it) => it.act === "add-new"), "a note makes no view of its own");
  // on the Project: added elsewhere, deleted here, never taken out
  assert.deepEqual(menuItems({ kind: "note", open: true, view: false, items: { views, remove: false } }, ctx).map((it) => it.act), ["note-edit", "note-toggle", "note-kind", "item-add", "note-delete"]);
  // a view's own note: none of this
  assert.deepEqual(menuItems({ kind: "note", open: true, view: true }, ctx).map((it) => it.act), ["note-edit", "note-toggle", "note-kind", "note-delete"]);
});

const agent = (name = "Claude") => ({ "x-visualproof-name": name, "x-visualproof-kind": "agent" });
const person = (name: string) => ({ "x-visualproof-name": name });

test("end to end: a file added through the library is the Project's; a link brings it to a view that holds the declaration, live; agents add and take out items; Duplicate and Zoom in; writing in a view; export authors", async () => {
  const S = await site({ exporter: true });
  try {
    const up = await fetch(`${S.base}/api/agent/library/upload?name=flt4.pdf`, { method: "POST", headers: agent(), body: new Uint8Array(tinyPdf([["Theorem 8. There is no solution in positive integers."]], "Fermat for exponent four")) });
    const sha = ((await up.json()) as Json).file.sha as string;
    const paperNote = S.live.views.book.notes.find((n) => n.carries?.some((c) => c.file === sha))!;
    assert.deepEqual(paperNote.places, {}, "on the ring of the Project");
    const v = (await S.ask("POST", "/api/agent/views/create", { name: "Only b", scope: "decl(N.b)" }, agent())).json!.view;
    const listed = async (id: string) => ((await S.ask("GET", `/api/agent/notes?view=${id}`, undefined, agent())).json!.notes as Json[]).filter((n) => n.kind === "project");
    // on the Project only: no link yet
    assert.deepEqual((await listed(PROJECT)).map((n) => [n.id, n.why]), [[paperNote.id, "project"]]);
    assert.deepEqual(await listed(v.id), []);
    // linked to N.b: it shows on the view of N.b at once, on the ring, toward N.b
    const link = (await S.ask("POST", "/api/agent/link", { subject: "decl(N.b)", file: sha, page: 1 }, agent())).json!.link;
    const there = await listed(v.id);
    assert.deepEqual(there.map((n) => [n.id, n.why, n.here?.about]), [[paperNote.id, "link", { links: ["decl(N.b)"] }]]);
    // taken out of the view by an agent at level full: on its remove list (its scope gives it)
    const out = await S.ask("POST", "/api/agent/views/items", { id: v.id, remove: [paperNote.id] }, agent());
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.deepEqual([out.json!.changed, out.json!.items.remove.map((x: Json) => x.id), out.json!.notes], [true, [paperNote.id], [{ id: paperNote.id, shown: false }]]);
    assert.deepEqual(await listed(v.id), []);
    // put back: off the remove list, nothing on the add list
    const back = await S.ask("POST", "/api/agent/views/items", { id: v.id, add: [paperNote.id] }, agent());
    assert.deepEqual([back.json!.items.add, back.json!.items.remove], [[], []]);
    // the link gone: gone from the view too; added, it stays whatever the links
    await S.ask("POST", "/api/agent/unlink", { id: link.id }, agent());
    assert.deepEqual(await listed(v.id), []);
    await S.ask("POST", "/api/agent/views/items", { id: v.id, add: [paperNote.id] }, agent());
    assert.deepEqual((await listed(v.id)).map((n) => n.why), ["added"]);
    assert.deepEqual((await S.ask("GET", `/api/agent/views/view?id=${v.id}`, undefined, agent())).json!.items.add.map((x: Json) => x.id), [paperNote.id]);
    // the timeline: each a view event, marked as the agent's
    const evs = S.live.timeline.events.filter((e) => e.kind === "view" && e.what === "items");
    assert.deepEqual(evs.map((e) => [(e as Json).shown, (e as Json).agent]), [[false, true], [true, true], [true, true]]);
    // refused: on the Project, a note that is none of the project's, at level advise
    assert.equal((await S.ask("POST", "/api/agent/views/items", { id: PROJECT, add: [paperNote.id] }, agent())).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/views/items", { id: v.id, add: ["nnnnnnnnnnnn"] }, agent())).status, 404);
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "advise", days: 1 });
    assert.equal((await S.ask("POST", "/api/agent/views/items", { id: v.id, add: [paperNote.id] }, { authorization: `Bearer ${token}` })).status, 403);
    // Duplicate, as the page does: the view's lists; the Project's, what its copy would not give
    const dupV = (await S.ask("POST", "/api/views/create", { name: "Only b (copy)", from: v.id }, person("Alice"))).json!.view;
    assert.deepEqual(dupV.items, { add: [paperNote.id], remove: [] });
    const inN = S.live.views.book.notes.length;
    assert.equal(S.live.views.arrangeNotes([{ op: "pnote", note: note("inN", { namespace: { in: [["N", 0, 0]] } }) }], null, "Alice"), null);
    const dupP = (await S.ask("POST", "/api/views/create", { name: "Project (copy)", from: PROJECT }, person("Alice"))).json!.view;
    assert.deepEqual(dupP.items, { add: [paperNote.id], remove: [] }, "the paper's note (no link now); not the note in N, which its scope gives");
    assert.equal(S.live.views.book.notes.length, inN + 1);
    // Zoom in: what its scope gives, no lists
    const zoom = (await S.ask("POST", "/api/views/open", { scope: "decl(N.a)" }, person("Alice"))).json!.view;
    assert.equal(zoom.items, undefined);
    // written in the view, from the page: added to it
    const w = await S.ask("POST", "/api/views/notes", { ops: [{ op: "pnote", note: note("written1", {}, { by: null }) }], in: v.id }, person("Bob"));
    assert.equal(w.status, 200, JSON.stringify(w.json));
    assert.deepEqual(S.live.views.book.get(v.id)!.items!.add, [paperNote.id, "written1"]);
    assert.equal((await S.ask("POST", "/api/views/notes", { ops: [{ op: "pnote", note: note("written2", {}) }], in: "no-such-view" }, person("Bob"))).status, 404);
    // an agent writes in a view as well
    const mine = await S.ask("POST", "/api/agent/note", { ring: true, text: "start with b", in: v.id }, agent());
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json!.why, "added");
    // the export's authors: the people whose notes the view shows — Alice's in N, which holds N.b,
    // and Bob's written there — not Eve's, the Project's alone, nor what agents wrote
    assert.equal(S.live.views.arrangeNotes([{ op: "pnote", note: note("eve", {}) }], null, "Eve"), null);
    const head = (await S.ask("GET", `/api/export/head?view=${v.id}`)).json!;
    assert.deepEqual(head.authors, ["Alice", "Bob"]);
    assert.ok(((await S.ask("GET", `/api/export/head?view=${PROJECT}`)).json!.authors as string[]).includes("Eve"), "the Project shows every note");
    // deleted: in no list any more
    await S.ask("POST", "/api/agent/note/delete", { id: paperNote.id }, agent());
    for (const id of [v.id, dupV.id, dupP.id]) assert.ok(!JSON.stringify(S.live.views.book.get(id)!.items ?? {}).includes(paperNote.id), id);
  } finally {
    await S.close();
  }
});
