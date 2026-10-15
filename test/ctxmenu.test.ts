// The canvas's menu (ViewSpec, "The canvas's menu", decided 2026-10-09): what it holds on a
// declaration, a cluster and the empty canvas, with what the reader cannot do left out; on a board
// whose scope is fixed, "Remove" makes a copy without the thing; the scope edits Remove and Add to
// view make, kept short; a copy of a view with a scope of its own; a declaration opened in a pinned
// window of its own.

import assert from "node:assert/strict";
import { test } from "node:test";
import { printQuery, parseQuery } from "../src/shared/query.ts";
import type { Query } from "../src/shared/query.ts";
import { scopeWith, scopeWithout } from "../src/shared/scopeedit.ts";
import { PROJECT, ViewBook } from "../src/shared/views.ts";
import { menuItems } from "../src/web/src/ctxmenu.ts";
import type { MenuContext, MenuItem, MenuTarget } from "../src/web/src/ctxmenu.ts";
import { clusterSet } from "../src/web/src/selection.ts";
import { MAX_PINNED, PIN_CAP, Sources } from "../src/web/src/sources.ts";
import type { SourcePane } from "../src/web/src/sources.ts";

const acts = (items: MenuItem[]) => items.map((it) => it.act);
const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({ fixed: false, review: null, views: [], arrange: true, write: true, ...over });
const decl = (over: Partial<Extract<MenuTarget, { kind: "decl" }>> = {}): MenuTarget => ({ kind: "decl", name: "A.B.c", ext: false, key: null, target: false, ns: { prefix: "A.B", on: false }, ...over });

test("on a declaration: source, the modes, copy, the view, the review and trust; what cannot be done is left out", () => {
  const all = menuItems(decl(), ctx({ views: [{ id: "v1", title: "Mine", holds: false }, { id: "v2", title: "Other", holds: true }] }), "Mine too");
  assert.deepEqual(acts(all), ["source", "pin", "tcb", "deps", "apps", "copy", "remove", "add", "target", "approve", "comment", "trust", "note", "note-view"]);
  assert.equal(all.find((it) => it.act === "trust")!.label, "Trust its namespace");
  // Add to view: every view it can be added to, one that holds it already shown and not chosen, then a
  // new one, named after the declaration
  const add = all.find((it) => it.act === "add")!;
  assert.deepEqual(add.sub!.map((it) => [it.act, it.label, !!it.disabled]), [["add:v1", "Mine", false], ["add:v2", "Other ✓", true], ["add-new", "New view…", false]]);
  assert.equal(add.sub!.at(-1)!.ask, "c");
  // a view open now and not kept yet is offered after the kept ones, said to be temporary: adding
  // to it keeps it
  const withTemp = menuItems(decl(), ctx({ views: [{ id: "v1", title: "Mine", holds: false }, { id: "v3", title: "ns(A)", holds: false, temporary: true }] }), "Mine too");
  const sub = withTemp.find((it) => it.act === "add")!.sub!;
  assert.deepEqual(sub.map((it) => [it.act, it.note ?? null, !!it.sep]), [["add:v1", null, false], ["add:v3", "temporary", true], ["add-new", null, true]]);
  // where the review is focused on a target, a member of its review can be marked key (or unmarked)
  const onReview = menuItems(decl({ key: false }), ctx({ review: "A.T.main" }));
  assert.equal(onReview.find((it) => it.act === "key")!.label, "Mark as key for ★main");
  assert.equal(menuItems(decl({ key: true }), ctx({ review: "A.T.main" })).find((it) => it.act === "key")!.label, "Unmark as key for ★main");
  // with no focus, or not in its review: no key
  assert.ok(!acts(menuItems(decl({ key: null }), ctx({ review: "A.T.main" }))).includes("key"));
  assert.ok(!acts(menuItems(decl({ key: false }), ctx())).includes("key"));
  // a target is taken off; a trusted namespace stops being trusted
  const t = menuItems(decl({ target: true, ns: { prefix: "A.B", on: true } }), ctx());
  assert.equal(t.find((it) => it.act === "target")!.label, "Unmark as target");
  assert.equal(t.find((it) => it.act === "trust")!.label, "Stop trusting its namespace");
  // outside the project: no target, no opinion, no namespace to trust
  assert.deepEqual(acts(menuItems(decl({ ext: true, ns: null }), ctx())), ["source", "pin", "tcb", "deps", "apps", "copy", "remove", "add", "note", "note-view"]);
  // without a name to record under (a snapshot, a proxy that names nobody): reading only, and the
  // views where a snapshot keeps them in the page
  assert.deepEqual(acts(menuItems(decl({ key: false }), ctx({ review: "A.T.main", write: false, arrange: false }))), ["source", "pin", "tcb", "deps", "apps", "copy"]);
  assert.deepEqual(acts(menuItems(decl(), ctx({ write: false }))), ["source", "pin", "tcb", "deps", "apps", "copy", "remove", "add", "note", "note-view"]);
});

test("on a board whose scope is fixed, Remove is a new view without it, which asks for its name", () => {
  const items = menuItems(decl(), ctx({ fixed: true }), "Review ★main");
  const r = items.find((it) => it.act.startsWith("remove"))!;
  assert.deepEqual([r.act, r.label, r.ask], ["remove-new", "New view without it…", "Review ★main without c"]);
  assert.ok(!acts(items).includes("remove"));
  const c = menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: null }, ctx({ fixed: true }), "Project");
  assert.deepEqual(acts(c), ["fold", "hide", "remove-new", "add", "note", "note-view"]);
  assert.equal(c[2].ask, "Project without B");
});

test("on a cluster: fold, hide its level, the view, trust, a note; on the empty canvas: a note of the project or of the view, fit and re-layout; on a note: edit, open or collapse, its kind, delete", () => {
  const c = menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: { prefix: "A.B", on: false } }, ctx());
  assert.deepEqual(c.map((it) => [it.act, it.label]), [["fold", "Fold"], ["hide", "Hide this level"], ["remove", "Remove from this view"], ["add", "Add to view"], ["trust", "Trust this namespace"], ["note", "Add a note here"], ["note-view", "Add a note for this view"]]);
  const f = menuItems({ kind: "cluster", key: "A/B", folded: true, folder: true, trust: { prefix: "A.B", on: true } }, ctx());
  assert.deepEqual(f.map((it) => it.label), ["Unfold", "Hide this level", "Remove from this view", "Add to view", "Stop trusting this folder", "Add a note here", "Add a note for this view"]);
  // under a broader prefix trusted already, or the review not writable: no trust
  assert.deepEqual(acts(menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: null }, ctx())), ["fold", "hide", "remove", "add", "note", "note-view"]);
  assert.deepEqual(acts(menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: { prefix: "A.B", on: false } }, ctx({ write: false }))), ["fold", "hide", "remove", "add", "note", "note-view"]);
  assert.deepEqual(acts(menuItems({ kind: "canvas" }, ctx())), ["note", "note-view", "fit", "relayout"]);
  assert.deepEqual(acts(menuItems({ kind: "canvas" }, ctx({ arrange: false }))), ["fit"]);
  // a reader who cannot arrange (no name, no snapshot) sees no board item on a cluster, Hide this level
  // included: left out, not greyed (ViewSpec decision 21)
  assert.deepEqual(acts(menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: null }, ctx({ arrange: false }))), ["fold"]);
  // a note: its own state says Collapse or Expand, its kind the other one it can be made (AttachmentSpec
  // decision 14); where the board cannot be changed, no menu
  assert.deepEqual(menuItems({ kind: "note", open: true, view: false }, ctx()).map((it) => [it.act, it.label]), [["note-edit", "Edit"], ["note-toggle", "Collapse"], ["note-kind", "Only in this view"], ["note-delete", "Delete…"]]);
  assert.equal(menuItems({ kind: "note", open: false, view: false }, ctx())[1].label, "Expand");
  assert.equal(menuItems({ kind: "note", open: true, view: true }, ctx())[2].label, "In every view", "a view's own note: back to every view");
  assert.deepEqual(menuItems({ kind: "note", open: true, view: false }, ctx({ arrange: false })), []);
});

test("in the artwork mode with its names by selection (ExportSpec decision 19): first, the name shown in the picture or hidden, on a declaration or a cluster; elsewhere nothing of it", () => {
  const d = menuItems(decl({ art: false }), ctx());
  assert.deepEqual([d[0].act, d[0].label], ["art-name", "Show its name in the artwork"]);
  assert.equal(d[1].act, "source");
  assert.equal(d[1].sep, true, "set apart from the rest");
  assert.equal(menuItems(decl({ art: true }), ctx())[0].label, "Hide its name in the artwork");
  // a reader who can change nothing else can choose the names of their own picture
  const c = menuItems({ kind: "cluster", key: "A.B", folded: false, folder: false, trust: null, art: true }, ctx({ arrange: false, write: false }));
  assert.deepEqual(c.map((it) => [it.act, it.label, !!it.sep]), [["art-name", "Hide its name in the artwork", false], ["fold", "Fold", true]]);
  assert.ok(!acts(menuItems(decl(), ctx())).includes("art-name"));
  assert.equal(menuItems(decl(), ctx())[0].sep, undefined);
  assert.ok(!acts(menuItems({ kind: "canvas" }, ctx())).includes("art-name"));
});

const q = (text: string) => parseQuery(text);
const p = (x: Query) => printQuery(x);

test("Remove from this view and Add to view: scope except part, scope or part, kept short", () => {
  const X: Query = { op: "decl", names: ["A.x"] };
  const Y: Query = { op: "decl", names: ["A.y"] };
  // a declaration taken out, a second joining the first
  const s1 = scopeWithout(q("tcb(A.t) except trusted"), X);
  assert.equal(p(s1), "tcb(A.t) except trusted except decl(A.x)");
  assert.equal(p(scopeWithout(s1, Y)), "tcb(A.t) except trusted except decl(A.x, A.y)");
  // and put back: the taking out is undone, rather than a second part piled on
  const same = (a: Query, b: Query) => p(a) === p(b) || (p(a) === "tcb(A.t) except trusted" && p(b) === "tcb(A.t) except trusted or decl(A.x)");
  assert.equal(p(scopeWith(s1, X, same)), "tcb(A.t) except trusted");
  // without being told the set, it says exactly what was asked
  assert.equal(p(scopeWith(s1, X)), "tcb(A.t) except trusted or decl(A.x)");
  assert.equal(p(scopeWith(scopeWithout(s1, Y), X)), "tcb(A.t) except trusted except decl(A.y) or decl(A.x)");
  // added, and added again, and taken out again
  const s2 = scopeWith(q("ns(A.B) except external"), X);
  assert.equal(p(s2), "ns(A.B) except external or decl(A.x)");
  assert.equal(p(scopeWith(s2, Y)), "ns(A.B) except external or decl(A.x, A.y)");
  // what was added goes from the decl(…) that added it; told that what is left does not hold it,
  // nothing more is written
  const noY = (a: Query, b: Query) => p(b) === `${p(a)} except decl(A.y)`;
  assert.equal(p(scopeWithout(scopeWith(s2, Y), Y, noY)), "ns(A.B) except external or decl(A.x)");
  assert.equal(p(scopeWithout(scopeWith(s2, Y), Y)), "ns(A.B) except external or decl(A.x) except decl(A.y)");
  // a board of declarations by name takes one more, and loses one
  assert.equal(p(scopeWith(q("decl(A.x)"), Y)), "decl(A.x, A.y)");
  assert.equal(p(scopeWithout(q("decl(A.x, A.y)"), X)), "decl(A.y)");
  // a cluster, as a cluster pick writes it, taken out and put back
  const ns = clusterSet("A.B", "namespace");
  const s3 = scopeWithout(q("all"), ns);
  assert.equal(p(s3), "all except (ns(A.B) except external)");
  // told that all holds the cluster already, that is what is written
  const holdsB = (a: Query, b: Query) => [p(a), p(b)].sort().join(" | ") === "all | all or (ns(A.B) except external)";
  assert.equal(p(scopeWith(s3, ns, holdsB)), "all");
  assert.equal(p(scopeWith(s3, ns)), "all or (ns(A.B) except external)");
  assert.equal(p(scopeWith(q("tcb(A.t)"), clusterSet("A/B", "module"))), "tcb(A.t) or file(A/B)");
  // a scope that holds the set asked for already is left as it is
  const all = q("all");
  assert.equal(scopeWith(all, X, () => true), all);
  const ys = q("decl(A.y)");
  assert.equal(scopeWithout(ys, X, () => true), ys, "it never held it");
});

test("a copy of a view with a scope of its own: the copy's arrangement, the scope given", () => {
  const book = new ViewBook();
  book.project().pins.namespace.clusters["A.B"] = [1, 2];
  const c = book.create("Project without c", "Alice", { from: PROJECT, scope: q("all except decl(A.B.c)") });
  assert.ok(typeof c !== "string");
  assert.equal(p(c.scope), "all except decl(A.B.c)");
  assert.deepEqual(c.pins.namespace.clusters["A.B"], [1, 2], "arranged as the Project");
  // without a scope, a copy holds the scope copied
  const d = book.create("Copy", "Alice", { from: c.id });
  assert.ok(typeof d !== "string");
  assert.equal(p(d.scope), "all except decl(A.B.c)");
});

class Pane implements SourcePane {
  decl = -1;
  name = "";
  collapsed = false;
  aside = 0;
  fronted = 0;
  removed = false;
  show(i: number) {
    this.decl = i;
    this.name = `D${i}`;
  }
  redrawReview() {}
  pin() {}
  pinAside(step: number) {
    this.aside = step;
  }
  collapse(on: boolean) {
    this.collapsed = on;
  }
  front() {
    this.fronted++;
  }
  rect() {
    return { x: 0, y: 0, w: 600, h: 400 };
  }
  holds() {
    return false;
  }
  remove() {
    this.removed = true;
  }
}

test("Open in a pinned window: a window of its own, a step aside; one on it already comes in front", () => {
  const made: Pane[] = [];
  const said: string[] = [];
  const s = new Sources<Pane>({ make: () => (made.push(new Pane()), made.at(-1)!), say: (t) => said.push(t), changed: () => {}, viewport: () => ({ w: 1400, h: 900 }) });
  // the following window stays where it is, on the selection
  const f = s.show(1);
  const a = s.openPinned(2)!;
  assert.deepEqual([a.decl, a.aside, s.following === f, s.pinned.length], [2, 1, true, 1]);
  a.collapse(true);
  assert.equal(s.openPinned(2), a, "the same declaration: the window there");
  assert.deepEqual([a.collapsed, made.length], [false, 2]);
  for (let i = 3; s.pinned.length < MAX_PINNED; i++) s.openPinned(i);
  assert.equal(s.openPinned(99), null);
  assert.deepEqual(said, [PIN_CAP]);
});

test("on a visitor (ViewSpec decision 27): Add to this view makes it a member, beside Add to view; nothing to remove", () => {
  const items = menuItems(decl({ visitor: true }), ctx({ here: "v7", views: [{ id: "v1", title: "Mine", holds: false }] }), "Board");
  assert.deepEqual(acts(items), ["source", "pin", "tcb", "deps", "apps", "copy", "add:v7", "add", "target", "approve", "comment", "trust", "note", "note-view"]);
  assert.equal(items.find((it) => it.act === "add:v7")!.label, "Add to this view");
  // on a board whose scope stays (the Project, with a condition), it goes to another view only
  assert.deepEqual(acts(menuItems(decl({ visitor: true }), ctx({ here: null, fixed: true }))).filter((a) => a.startsWith("add") || a.startsWith("remove")), ["add"]);
  // a member keeps Remove from this view
  assert.ok(acts(menuItems(decl(), ctx({ here: "v7" }))).includes("remove"));
});
