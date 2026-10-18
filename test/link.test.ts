// A target is linked to at most one view, and a view may be several targets' (ViewSpec decision 29,
// the owner's decisions of 2026-10-11; the record's `targets`, in the order they were linked): the
// link can be set to any view, for everyone, the view it leaves keeping its scope and arrangement; a
// linked view has a small star by its title and is focused on its first target to begin with.
// Marking a target makes no view (the owner's decision of 2026-10-12): a click on a target with no
// view opens a view nobody keeps of its TCB, linked to it and focused on it — the link lasts as long
// as that view, and stays once someone keeps it. A view linked to targets is deleted as any kept view
// is, and its targets then have no view; nothing makes a target a view by itself — not marking, not a
// start, not the targets synced, not a build, not a rename. A view named review:<target>, as marking
// made them before, is a view as any other. The Views menu lists views alone.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "../src/server/agent.ts";
import { Views } from "../src/server/views.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { emptyLayouts } from "../src/shared/places.ts";
import { parseQuery, printQuery, reviewScope } from "../src/shared/query.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_STMT } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import { inTargets, reviewQueue } from "../src/shared/reviewqueue.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { routes, TOOLS } from "../src/server/mcptools.ts";
import { linkRefused, PROJECT, summary, targetScope, titleOfScope, ViewBook, viewFocus, viewTitle } from "../src/shared/views.ts";
import type { ViewData, ViewSummary } from "../src/shared/views.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import type { Store } from "../src/web/src/store.ts";
import { linkTip, tabLabel, Tabs } from "../src/web/src/tabs.ts";
import type { TabsHooks } from "../src/web/src/tabs.ts";
import { TargetList, targetRows, targetStep } from "../src/web/src/targetlist.ts";
import { FakeEl } from "./fakedom.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const pin = (key: string, at: [number, number]) => ({ op: "pin" as const, mode: "namespace" as const, kind: "node" as const, key, at });

/** A view made and linked to `target` by hand, as Link to this view does: kept, on the target's TCB. */
function linkedView(book: ViewBook, target: string, name = `${target} closely`): ViewData {
  const v = book.create(name, "Alice", { scope: parseQuery(`tcb(${target})`) }) as ViewData;
  book.link(v.id, target, "Alice");
  return v;
}

/** A target's view as marking made one before 2026-10-12: kept, on its review set, linked to it,
 *  named by it. */
const oldReviewView = (target: string): ViewData => ({ id: `review:${target}`, name: null, scope: reviewScope(target), clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, by: null, at: "2026-10-01T00:00:00.000Z", kept: true, targets: [target], focus: target });

test("marking a target makes no view; a click links it to one; the link moves to another view, which the view it leaves only stops being", () => {
  const book = new ViewBook();
  assert.deepEqual(book.syncTargets(["A.t"]), []);
  assert.deepEqual([book.viewOf("A.t"), book.list().map((v) => v.id)], [undefined, [PROJECT]], "marking makes nothing");
  // a click: the temporary view of its TCB, linked to it, kept once a pin is dropped
  const r = book.openTarget("A.t", "Alice", 0).view;
  assert.deepEqual([r.targets, r.focus, book.viewOf("A.t")?.id], [["A.t"], "A.t", r.id]);
  book.arrange(r.id, [pin("A.d", [1, 2])], "Alice");
  // a board of one's own, then linked to the target, for everyone
  const mine = book.create("Close reading", "Bob", { scope: parseQuery("tcb(A.t) except external") });
  assert.ok(typeof mine !== "string");
  assert.deepEqual(book.link(mine.id, "A.t", "Bob"), [
    { id: r.id, what: "unlinked", by: "Bob", target: "A.t" },
    { id: mine.id, what: "linked", by: "Bob", target: "A.t" },
  ]);
  assert.equal(book.viewOf("A.t")?.id, mine.id);
  // the one it left keeps its scope, arrangement and focus, and is no longer the target's
  assert.deepEqual([r.kept, r.targets, r.focus, printQuery(r.scope), r.pins.namespace.nodes["A.d"]], [true, undefined, "A.t", "tcb(A.t)", [1, 2]]);
  // the one it is linked to: focused on the target to begin with
  assert.deepEqual([mine.targets, mine.focus], [["A.t"], "A.t"]);
  assert.equal(viewFocus(mine, () => true, () => []), "A.t");
  assert.equal(book.link(mine.id, "A.t", "Bob"), null, "linked already: nothing changes");
  // a view nobody kept is kept by being linked
  const open = book.open(parseQuery("key(A.t)"), "Carol").view;
  assert.deepEqual((book.link(open.id, "A.t", "Carol") as { what: string }[]).map((c) => c.what), ["unlinked", "kept", "linked"]);
  assert.equal(book.get(open.id)!.kept, true);
});

test("where a target cannot be linked — another target's view takes it; a linked view is deleted as any kept view, and its targets then have no view", () => {
  const book = new ViewBook();
  const a = linkedView(book, "A.t");
  const b = linkedView(book, "B.u");
  const past = book.create("Then", "Alice", { version: 3 });
  assert.ok(typeof past !== "string");
  assert.match(String(book.link(PROJECT, "A.t", "Alice")), /everyone's way in/);
  assert.match(String(book.link(past.id, "A.t", "Alice")), /past build/);
  // another target's view is no refusal (the owner's decision of 2026-10-11)
  assert.equal(linkRefused({ id: b.id }, "A.t"), null);
  assert.equal(linkRefused({ id: "v1" }, "A.t"), null);
  // deleted, it unlinks its target, which the deletion says, with the scope it had
  assert.deepEqual(book.remove(a.id, "Alice"), { id: a.id, what: "deleted", by: "Alice", was: "A.t closely", scope: "tcb(A.t)", targets: ["A.t"] });
  assert.equal(book.viewOf("A.t"), undefined);
  // a view a target was linked to after a move of the link: deleted as well
  const other = book.create("Other", "Alice", {});
  assert.ok(typeof other !== "string");
  book.link(other.id, "B.u", "Alice");
  assert.deepEqual((book.remove(other.id, "Alice") as { targets?: string[] }).targets, ["B.u"]);
  assert.deepEqual([book.viewOf("A.t"), book.viewOf("B.u")], [undefined, undefined]);
  assert.ok(book.get(b.id), "the view the link had left stays, unlinked");
  // a view no target is linked to says none
  const plain = book.create("Plain", "Alice", {});
  assert.ok(typeof plain !== "string");
  assert.equal("targets" in (book.remove(plain.id, "Alice") as object), false);
  assert.match(String(book.remove(PROJECT, "Alice")), /Project cannot be deleted/);
});

test("nothing makes a deleted target's view again by itself: the targets synced, a build, a rename, nor a move undone", () => {
  const book = new ViewBook();
  const a = linkedView(book, "A.t");
  const b = linkedView(book, "B.u");
  book.remove(a.id, "Alice");
  // synced again, as the server does at every change of the review and at a start
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  assert.deepEqual([book.viewOf("A.t"), book.get(a.id)], [undefined, undefined]);
  // renamed (a move, by hand or found by a build): still none
  assert.deepEqual(book.syncTargets(["A.top", "B.u"], (t) => (t === "A.top" ? ["A.t"] : undefined)), []);
  assert.equal(book.viewOf("A.top"), undefined);
  // the move undone (server/views.ts, unmoveDeclaration): back under its old name, still none
  assert.deepEqual(book.retarget("A.top", "A.t", "Alice"), []);
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  assert.equal(book.viewOf("A.t"), undefined);
  // the other target's view is untouched by all of it
  assert.equal(book.viewOf("B.u")?.id, b.id);
});

test("marking makes no view and links none: never linked, unmarked and marked again, nor where a view named review:<target> is there", () => {
  const book = new ViewBook();
  assert.deepEqual(book.syncTargets(["A.t"]), []);
  assert.equal(book.viewOf("A.t"), undefined);
  // linked by hand, unmarked, marked again: unlinked, and not linked again
  const a = linkedView(book, "A.t");
  assert.deepEqual(book.syncTargets([]).map((c) => [c.id, c.what, c.target]), [[a.id, "unlinked", "A.t"]]);
  assert.deepEqual(book.syncTargets(["A.t"]), []);
  assert.deepEqual([book.viewOf("A.t"), book.get(a.id)!.kept, book.get(a.id)!.targets], [undefined, true, undefined]);
  // a view named review:<target>, as marking made one before, unlinked: marking does not link it
  // again (the rule that did went on 2026-10-12)
  const old = new ViewBook([{ ...oldReviewView("B.u"), targets: undefined }]);
  assert.deepEqual(old.syncTargets(["B.u"]), []);
  assert.deepEqual([old.viewOf("B.u"), old.get("review:B.u")!.kept], [undefined, true]);
});

test("several targets on one view: linked to it in turn, the first its focus, deleting it unlinks them all, unmarking one unlinks it alone", () => {
  const book = new ViewBook();
  linkedView(book, "A.t");
  const b = linkedView(book, "B.u");
  const c = linkedView(book, "C.w");
  const shared = book.create("Kummer", "Alice", { scope: parseQuery("tcb(A.t, B.u)") });
  assert.ok(typeof shared !== "string");
  assert.deepEqual((book.link(shared.id, "A.t", "Alice") as { what: string }[]).map((c) => c.what), ["unlinked", "linked"]);
  // a second target: the view takes it, its focus stays the first's, and B.u's view lets go
  assert.deepEqual(book.link(shared.id, "B.u", "Bob"), [
    { id: b.id, what: "unlinked", by: "Bob", target: "B.u" },
    { id: shared.id, what: "linked", by: "Bob", target: "B.u" },
  ]);
  assert.deepEqual([shared.targets, shared.focus, book.viewOf("A.t")?.id, book.viewOf("B.u")?.id], [["A.t", "B.u"], "A.t", shared.id, shared.id]);
  assert.equal(viewFocus(shared, () => true, () => []), "A.t");
  assert.equal(book.link(shared.id, "B.u", "Bob"), null, "linked already: nothing changes");
  // its focus as nothing set it: the target linked first; with that one gone, the next
  delete shared.focus;
  assert.equal(viewFocus(shared, (n) => n !== "A.t", () => []), "B.u");
  // summed up for the pages and the agents, in the order linked
  assert.deepEqual(summary(shared).targets, ["A.t", "B.u"]);
  // a target taken to another view leaves the others where they are
  book.link(c.id, "A.t", "Carol");
  assert.deepEqual([shared.targets, shared.focus], [["B.u"], "A.t"], "focused on A.t as it was, nothing else having set it");
  book.link(shared.id, "A.t", "Carol");
  book.link(shared.id, "C.w", "Carol");
  assert.deepEqual(shared.targets, ["B.u", "A.t", "C.w"]);
  // unmarking one unlinks it alone: the view stays, with the others
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]).map((c) => [c.id, c.what, c.target]), [[shared.id, "unlinked", "C.w"]]);
  assert.deepEqual([shared.kept, shared.targets], [true, ["B.u", "A.t"]]);
  // deleted: all its targets unlinked, in one change, and none made a view again by itself
  assert.deepEqual(book.remove(shared.id, "Alice"), { id: shared.id, what: "deleted", by: "Alice", was: "Kummer", scope: "tcb(A.t, B.u)", targets: ["B.u", "A.t"] });
  assert.deepEqual([book.viewOf("A.t"), book.viewOf("B.u")], [undefined, undefined]);
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  // a view kept at a past build, and the Project, still refuse
  const past = book.create("Then", "Alice", { version: 3 });
  assert.ok(typeof past !== "string");
  assert.match(String(book.link(past.id, "A.t", "Alice")), /past build/);
  assert.match(String(book.link(PROJECT, "A.t", "Alice")), /everyone's way in/);
});

test("a click on a target with no view: a view nobody keeps of its TCB, linked and focused; the link goes with the view, and stays once it is kept", () => {
  const book = new ViewBook();
  // A.t marked: no view; B.u linked to one
  book.syncTargets(["A.t", "B.u"]);
  const b = linkedView(book, "B.u");
  // the view Zoom in on A.t under Rests on → TCB makes from the Project: tcb(A.t), by namespace, at
  // the latest build, nobody keeping it
  const { view: v, changes } = book.openTarget("A.t", "Bob", 1000);
  assert.deepEqual([printQuery(v.scope), v.clustering, v.version, v.kept, v.targets, v.focus], ["tcb(A.t)", "namespace", undefined, false, ["A.t"], "A.t"]);
  assert.deepEqual(changes, [
    { id: v.id, what: "opened", by: "Bob" },
    { id: v.id, what: "linked", by: "Bob", target: "A.t", temporary: true },
  ]);
  assert.equal(printQuery(targetScope("A.t")), "tcb(A.t)");
  assert.equal(book.viewOf("A.t")?.id, v.id);
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  // clicked again, by anyone: the same view, nothing changed
  assert.deepEqual(book.openTarget("A.t", "Carol", 2000), { view: v, changes: [] });
  // a target with a view: that one
  assert.equal(book.openTarget("B.u", "Carol").view.id, b.id);
  // nobody keeps it, every page closes it: it goes, and the link with it — no view again
  assert.deepEqual(book.sweep(2000 + 10_000, 8000), [{ id: v.id, what: "gone", by: null, targets: ["A.t"] }]);
  assert.equal(book.viewOf("A.t"), undefined);
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  // clicked once more, and kept (a pin dropped): the link stays, and the target has a view of its own
  const again = book.openTarget("A.t", "Bob", 20_000).view;
  assert.notEqual(again.id, v.id);
  assert.deepEqual((book.arrange(again.id, [pin("A.d", [1, 2])], "Bob") as { what: string }[]).map((c) => c.what), ["kept"]);
  assert.deepEqual([again.kept, again.targets], [true, ["A.t"]]);
  assert.deepEqual(book.sweep(99_000, 8000), []);
  assert.equal(book.viewOf("A.t")?.id, again.id);
  // a view open on the same query nobody keeps (a Zoom in) is the one a click finds, linked and
  // focused on the target
  book.remove(again.id, "Bob");
  const zoom = book.open(targetScope("A.t"), "Carol", 30_000, { focus: "B.u" }).view;
  assert.equal(book.openTarget("A.t", "Bob", 31_000).view.id, zoom.id);
  assert.deepEqual([zoom.kept, zoom.targets, zoom.focus], [false, ["A.t"], "A.t"]);
  // another target linked to it by hand keeps it, and A.t's link with it
  assert.deepEqual((book.link(zoom.id, "B.u", "Carol") as { what: string }[]).map((c) => c.what), ["unlinked", "kept", "linked"]);
  assert.deepEqual([zoom.kept, zoom.targets, zoom.focus], [true, ["A.t", "B.u"], "A.t"]);
});

test("a view deleted takes its focus with it; the other views focused on the target keep theirs", () => {
  const book = new ViewBook();
  const a = linkedView(book, "A.t");
  const key = book.open(parseQuery("key(A.t)"), "Alice", 0, { focus: "A.t" }).view;
  const copy = book.create("Mine", "Bob", { from: a.id });
  assert.ok(typeof copy !== "string");
  book.remove(a.id, "Alice");
  const isTarget = (n: string) => n === "A.t";
  assert.deepEqual([book.get(key.id)!.focus, book.get(copy.id)!.focus], ["A.t", "A.t"]);
  assert.deepEqual([viewFocus(book.get(key.id)!, isTarget, () => []), viewFocus(book.get(copy.id)!, isTarget, () => [])], ["A.t", "A.t"]);
  // clicked: a view nobody keeps of its TCB, focused on it
  assert.equal(book.openTarget("A.t", "Alice").view.focus, "A.t");
});

test("unmarking a target unlinks its view, which stays; marked again, it has none until a click; moved, its view goes with it", () => {
  const book = new ViewBook();
  const r = linkedView(book, "A.t");
  linkedView(book, "B.u");
  assert.deepEqual(book.syncTargets(["B.u"]).map((c) => [c.id, c.what, c.target]), [[r.id, "unlinked", "A.t"]]);
  assert.deepEqual([r.kept, r.targets], [true, undefined]);
  // marked again: no view; a click gives it a temporary one of its TCB
  assert.deepEqual(book.syncTargets(["A.t", "B.u"]), []);
  assert.equal(book.viewOf("A.t"), undefined);
  const fresh = book.openTarget("A.t", "Alice", 0).view;
  assert.notEqual(fresh.id, r.id);
  assert.deepEqual([fresh.targets, fresh.focus, printQuery(fresh.scope)], [["A.t"], "A.t", "tcb(A.t)"]);
  // a target moved: its view goes with it, under its own id
  book.syncTargets(["A.top", "B.u"], (t) => (t === "A.top" ? ["A.t"] : undefined));
  assert.deepEqual([book.viewOf("A.top")?.id, book.get(fresh.id)!.targets, book.get(fresh.id)!.focus], [fresh.id, ["A.top"], "A.top"]);
});

test("the star by a linked view's title, naming its targets; its title is its own, made from its scope as any view's", () => {
  const short = (t: string) => t.split(".").pop()!;
  assert.equal(tabLabel("Close reading", undefined), "Close reading");
  assert.match(tabLabel("Close reading", ["A.t"], short), /^<span class="star link-star" title="★t's view: clicking ★t opens it">★<\/span>Close reading$/);
  // several targets: the star names them all
  assert.equal(linkTip(["A.t", "B.u", "C.w"], short), "The view of ★t, ★u and ★w: clicking any of them opens it");
  assert.match(tabLabel("TCB of t, u", ["A.t", "B.u"], short), /^<span class="star link-star" title="The view of ★t and ★u: clicking any of them opens it">★<\/span>TCB of t, u$/);
  // the temporary view a click opens reads "★ TCB of t": its scope's title, the star its link's
  assert.match(tabLabel("TCB of t", ["A.t"], short), /^<span class="star link-star" title="★t's view: clicking ★t opens it">★<\/span>TCB of t$/);
  const base = { id: "v1", name: null, targets: ["My.Mod.main"] };
  assert.equal(viewTitle({ ...base, scope: targetScope("My.Mod.main") }), "TCB of main");
  assert.equal(viewTitle({ ...base, scope: parseQuery("tcb(My.Mod.main) except external") }), "TCB of main − outside");
  assert.equal(viewTitle({ ...base, name: "Close reading", scope: parseQuery("all") }), "Close reading");
  // one on its target's review set, as marking made them before: its scope's title too, linked or
  // not, to one target or several
  for (const v of [{ ...base, id: "review:My.Mod.main" }, { id: "v1", name: null }, { ...base, targets: ["My.Mod.main", "My.Mod.aux"] }])
    assert.equal(viewTitle({ ...v, scope: reviewScope("My.Mod.main") }), "review ★main");
});

test("the server: the links kept in views.json — the views linked before carry over — moved for everyone, several on one view, and said in the timeline", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-link-"));
  try {
    // a views.json as the live server kept it before a view could be several targets': a view with
    // its one target, no focus, named review:<target> as marking made them
    const old = { id: "review:A.t", name: null, scope: reviewScope("A.t"), clustering: "namespace", pins: emptyLayouts(), folds: { namespace: [], module: [] }, hidden: { namespace: [], module: [] }, by: null, at: "2026-10-01T00:00:00.000Z", kept: true, target: "A.t" };
    writeFileSync(join(dir, "views.json"), JSON.stringify({ layoutVersion: LAYOUT_VERSION, views: [old] }));
    const events: StoredEvent[] = [];
    const timeline = { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) };
    const views = new Views(dir, LAYOUT_VERSION, () => {}, timeline);
    views.isTarget = (n) => n === "A.t" || n === "B.u";
    views.syncTargets(["A.t"]);
    const r = views.book.get("review:A.t")!;
    assert.deepEqual([r.targets, r.focus, viewFocus(r, (n) => n === "A.t", () => [])], [["A.t"], undefined, "A.t"]);
    assert.equal(events.length, 0, "nothing to say: it was linked already");
    const ask = (path: string, body: unknown, name: string | null = "Alice") => views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as Ask, "full");
    const made = ask("/api/views/create", { name: "Close reading", scope: "tcb(A.t)" });
    const id = (made.body as { view: { id: string } }).view.id;
    assert.equal(ask("/api/views/link", { id, target: "N.x" }).status, 400, "only a target is linked");
    assert.equal(ask("/api/views/link", { id: PROJECT, target: "A.t" }).status, 400);
    assert.equal(ask("/api/views/link", { id, target: "A.t" }, null).status, 401, "a name first");
    assert.equal(ask("/api/views/link", { id, target: "A.t" }).status, 200);
    const linked = events.filter((e) => e.kind === "view" && e.what === "linked");
    assert.deepEqual(linked.map((e) => (e.kind === "view" ? [e.view, e.by, e.target] : null)), [[id, "Alice", "A.t"]]);
    // kept on disk: the old view no longer the target's, the new one is
    const disk = () => JSON.parse(readFileSync(join(dir, "views.json"), "utf8")) as { views: { id: string; target?: string; targets?: string[]; focus?: string }[] };
    assert.deepEqual(disk().views.filter((v) => v.targets).map((v) => [v.id, v.targets, v.focus]), [[id, ["A.t"], "A.t"]]);
    assert.equal(disk().views.find((v) => v.id === "review:A.t")!.focus, "A.t", "the view it left is focused on it as it was");
    assert.ok(disk().views.every((v) => v.target === undefined), "written as it is read now");
    // a second target on the same view (the owner's decision of 2026-10-11): linked, said, written
    views.syncTargets(["A.t", "B.u"]);
    assert.equal(ask("/api/views/link", { id, target: "B.u" }).status, 200);
    assert.deepEqual(disk().views.find((v) => v.id === id)!.targets, ["A.t", "B.u"]);
    assert.deepEqual(events.filter((e) => e.kind === "view" && e.what === "linked").map((e) => (e.kind === "view" ? e.target : null)), ["A.t", "B.u"]);
    // read back: the order they were linked in
    assert.deepEqual(new Views(dir, LAYOUT_VERSION, () => {}).book.get(id)!.targets, ["A.t", "B.u"]);
    // one unmarked: the server unlinks it alone, the view stays, and the timeline has the target's
    // event already
    views.syncTargets(["B.u"]);
    assert.deepEqual([views.book.get(id)!.kept, views.book.get(id)!.targets], [true, ["B.u"]]);
    assert.equal(events.filter((e) => e.kind === "view" && e.what === "linked").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the server: marking makes no view, on disk or after a start; a view deleted is one event with its targets; a click opens a temporary view of the TCB, linked while it lasts, kept with its link", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-link-"));
  try {
    const events: StoredEvent[] = [];
    const sent: { event: string; data: { changes?: { what: string }[] } }[] = [];
    const timeline = { add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: "" } as StoredEvent), events.at(-1)!) };
    const start = () => {
      // as server/live.ts starts: the views read back, then synced with the review's targets
      const v = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data: data as { changes?: { what: string }[] } }), timeline);
      v.isTarget = (n) => n === "A.t" || n === "B.u";
      v.syncTargets(["A.t", "B.u"]);
      return v;
    };
    let views = start();
    assert.deepEqual([views.book.list().map((v) => v.id), views.book.viewOf("A.t"), views.book.viewOf("B.u")], [[PROJECT], undefined, undefined], "the targets marked have no view");
    const ask = (path: string, body: unknown, name: string | null = "Alice") => views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as Ask, "full");
    // a view both are linked to, deleted: one event says both targets
    const both = (ask("/api/views/create", { name: "Both", scope: "tcb(A.t, B.u)" }).body as { view: { id: string } }).view.id;
    assert.equal(ask("/api/views/link", { id: both, target: "B.u" }).status, 200);
    assert.equal(ask("/api/views/link", { id: both, target: "A.t" }).status, 200);
    assert.equal(ask("/api/views/delete", { id: both }).status, 200);
    const deleted = events.filter((e) => e.kind === "view" && e.what === "deleted");
    assert.deepEqual(deleted.map((e) => (e.kind === "view" ? [e.view, e.by, e.targets, e.target, e.scope] : null)), [[both, "Alice", ["B.u", "A.t"], undefined, "tcb(A.t, B.u)"]]);
    const disk = () => JSON.parse(readFileSync(join(dir, "views.json"), "utf8")) as { views: { id: string; targets?: string[] }[]; viewless?: string[] };
    assert.equal(disk().viewless, undefined, "nothing is kept of the targets with no view");
    // a restart, and the review changed again: nothing makes them a view
    views = start();
    assert.equal(views.book.viewOf("A.t"), undefined);
    const before = events.length;
    // there is no endpoint that makes a target a view
    assert.equal(ask("/api/views/review", { target: "A.t" }).status, 404);
    // a click on A.t: the view nobody keeps of its TCB, linked to it and focused on it — read, as
    // opening is, so no name is needed; the pages are told, the timeline is not
    const r = ask("/api/views/target", { target: "A.t" }, null);
    assert.equal(r.status, 200);
    const v = (r.body as { view: { id: string; kept: boolean; scope: unknown; targets: string[]; focus: string } }).view;
    assert.deepEqual([v.kept, printQuery(v.scope as never), v.targets, v.focus], [false, "tcb(A.t)", ["A.t"], "A.t"]);
    assert.equal(events.length, before, "no event: opening a view is none");
    assert.deepEqual(sent.at(-1)!.data.changes!.map((c) => c.what), ["opened", "linked"]);
    assert.equal(ask("/api/views/target", { target: "N.x" }).status, 400, "only a target");
    assert.equal((ask("/api/views/target", { target: "A.t" }).body as { view: { id: string } }).view.id, v.id, "clicked again: the same view");
    // not on disk: the view is nobody's
    assert.equal(disk().views.some((x) => x.id === v.id), false);
    // every page closes it: it goes, and the link with it
    views.sweep(Date.now() + 60_000);
    assert.deepEqual([views.book.get(v.id), views.book.viewOf("A.t")], [undefined, undefined]);
    // clicked again, then kept — a pin dropped — the link stays, on disk and after a restart
    const w = (ask("/api/views/target", { target: "A.t" }).body as { view: { id: string } }).view;
    assert.equal(ask("/api/views/arrange", { id: w.id, ops: [pin("A.d", [1, 2])] }).status, 200);
    assert.deepEqual(disk().views.find((x) => x.id === w.id)?.targets, ["A.t"]);
    views = start();
    assert.equal(views.book.viewOf("A.t")?.id, w.id);
    // unmarked: its view stays, kept, no longer the target's
    views.syncTargets(["B.u"]);
    assert.deepEqual([views.book.get(w.id)?.kept, views.book.get(w.id)?.targets, views.book.viewOf("A.t")], [true, undefined, undefined]);
    // a click linked to a view the server forgets at a start: none again
    const u = (ask("/api/views/target", { target: "B.u" }).body as { view: { id: string } }).view;
    assert.equal(views.book.viewOf("B.u")?.id, u.id);
    views = start();
    assert.equal(views.book.viewOf("B.u"), undefined);
    // the Project still cannot be deleted
    assert.equal(ask("/api/views/delete", { id: PROJECT }).status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agents link targets to a view at level full, several on one, and go to a target's view wherever it is linked", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const reader = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 }).token;
    const ask = (method: string, path: string, body?: Json, t = token) => S.ask(method, path, body, { authorization: `Bearer ${t}` });
    assert.equal((await ask("POST", "/api/agent/target", { name: "N.b" })).status, 200);
    assert.equal((await ask("POST", "/api/agent/target", { name: "N.a" })).status, 200);
    await new Promise((ok) => setImmediate(ok));
    const made = (await ask("POST", "/api/agent/views/create", { name: "Bot's board", scope: "decl(N.a, N.b)" })).json!;
    const id = made.view.id as string;
    assert.equal((await ask("POST", "/api/agent/views/link", { id, target: "N.b" }, reader)).status, 403);
    const r = await ask("POST", "/api/agent/views/link", { id, target: "N.b" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json!.view.targets, r.json!.view.focus, r.json!.left], [["N.b"], "N.b", undefined], "it had no view to leave");
    // a second target on the same view: taken, its focus the first's still
    const second = await ask("POST", "/api/agent/views/link", { id, target: "N.a" });
    assert.equal(second.status, 200);
    assert.deepEqual([second.json!.view.targets, second.json!.view.focus, second.json!.left], [["N.b", "N.a"], "N.b", undefined]);
    assert.equal((await ask("POST", "/api/agent/views/link", { id: "project", target: "N.b" })).status, 409);
    // the targets' view is where the agent goes for either now
    const there = await ask("POST", "/api/agent/view", { review: "N.a" });
    assert.equal(there.json!.view.view, id);
    assert.deepEqual(there.json!.reviewView, ["N.b", "N.a"]);
    assert.match(there.json!.followersSee, /^the view "Bot's board", N\.b and N\.a's view, the review focused on N\.b/);
    const listed = ((await ask("GET", "/api/agent/views")).json!.views as Json[]).find((v) => v.id === id)!;
    assert.deepEqual(listed.targets, ["N.b", "N.a"]);
    // deleted, it unlinks both, in one event
    const gone = await ask("POST", "/api/agent/views/delete", { id });
    assert.deepEqual(gone.json!.unlinked, ["N.b", "N.a"]);
    assert.match(gone.json!.note, /N\.b, N\.a have no view now/);
    const events = (await ask("GET", "/api/agent/activity")).json!.events as Json[];
    assert.deepEqual(events.filter((e) => e.kind === "view" && e.what === "deleted").map((e) => [e.view, e.targets]), [[id, ["N.b", "N.a"]]]);
  } finally {
    await S.close();
  }
});

test("agents: marking makes no view; view {review} on a target with no view is put on a temporary view of its TCB, linked to it; no endpoint nor tool makes one", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const reader = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 }).token;
    const ask = (method: string, path: string, body?: Json, t = token) => S.ask(method, path, body, { authorization: `Bearer ${t}` });
    const marked = await ask("POST", "/api/agent/target", { name: "N.b" });
    assert.deepEqual([marked.status, marked.json!.view], [200, null]);
    assert.match(marked.json!.next, /a temporary view of its TCB/);
    await new Promise((ok) => setImmediate(ok));
    assert.equal(S.live.views.book.viewOf("N.b"), undefined, "marking makes no view");
    assert.deepEqual(((await ask("GET", "/api/agent/views")).json!.views as Json[]).map((v) => v.id), [PROJECT]);
    // asked for, at any level: a view nobody keeps of its TCB, linked to it and focused on it, the
    // agent on it — as a person's click on it opens
    await ask("POST", "/api/agent/view", { view: null }, reader);
    const there = await ask("POST", "/api/agent/view", { review: "N.b" }, reader);
    assert.equal(there.status, 200);
    const v = S.live.views.book.viewOf("N.b")!;
    assert.deepEqual([there.json!.view.view, there.json!.temporary, there.json!.reviewView, v.kept, printQuery(v.scope), v.focus], [v.id, true, ["N.b"], false, "tcb(N.b)", "N.b"]);
    assert.match(there.json!.note, /temporary view of its TCB/);
    assert.match(there.json!.followersSee, /^the view "TCB of (N\.)?b", N\.b's view, the review focused on N\.b/);
    // the timeline says nothing of it, as of a view opened
    const events = (await ask("GET", "/api/agent/activity")).json!.events as Json[];
    assert.equal(events.filter((e) => e.kind === "view" && e.what === "linked").length, 0);
    // asked again: the same view, now linked
    const again = await ask("POST", "/api/agent/view", { review: "N.b" });
    assert.deepEqual([again.json!.view.view, again.json!.temporary], [v.id, undefined]);
    // kept by a name, the link stays
    assert.equal((await ask("POST", "/api/agent/views/rename", { id: v.id, name: "N.b, read closely" })).status, 200);
    assert.deepEqual([S.live.views.book.get(v.id)!.kept, S.live.views.book.viewOf("N.b")?.id], [true, v.id]);
    // deleted as any kept view, at the level deleting needs: the target has no view again
    assert.equal((await ask("POST", "/api/agent/views/delete", { id: v.id }, reader)).status, 403);
    const gone = await ask("POST", "/api/agent/views/delete", { id: v.id });
    assert.deepEqual(gone.json!.unlinked, ["N.b"]);
    assert.match(gone.json!.note, /N\.b has no view now/);
    // nothing makes a target a view: the endpoint answers 404 and the MCP tool is not there
    assert.equal((await ask("POST", "/api/agent/views/review", { target: "N.b" })).status, 404);
    assert.equal(S.live.views.handle({ method: "POST", path: "/api/views/review", query: new URLSearchParams(), body: { target: "N.b" }, caller: { name: "Alice", kind: "person" } } as Ask, "full").status, 404);
    assert.equal(TOOLS.some((t) => t.name === "make_review_view"), false);
    assert.ok(routes().some((r) => r.tool === "views" && r.action === "link"));
    // a declaration that is no target has no view to be given
    assert.equal((await ask("POST", "/api/agent/view", { review: "N.a" })).status, 400);
  } finally {
    await S.close();
  }
});

/** The views a page lists where A.t has no view, B.u's view is C.w's too, a view is kept with no
 *  target and one is open that nobody keeps. */
function listed(): ViewSummary[] {
  const book = new ViewBook([{ ...oldReviewView("B.u"), id: "vb", scope: parseQuery("tcb(B.u)") }]);
  book.syncTargets(["A.t", "B.u", "C.w"]);
  book.link("vb", "C.w", "Alice");
  book.create("Close reading", "Bob", { scope: parseQuery("tcb(B.u) except external") });
  book.open(parseQuery("uses(B.u)"), "Carol");
  return book.list().map(summary);
}

/** An element of the page as the lists draw into it: its HTML, and its listeners, fired by hand. */
function drawn(): FakeEl & { innerHTML: string } {
  return Object.assign(new FakeEl("div"), { innerHTML: "" });
}

/** A click on a control inside `el`, with these data attributes. */
function clickIn(el: FakeEl, data: Record<string, string>): void {
  const b = new FakeEl("button");
  Object.assign(b.dataset, data);
  el.append(b);
  el.dispatch({ type: "click", target: b });
}

test("the targets list: every target, a view of several on each one's row, one with no view listed as such; a click asks for its view either way", () => {
  const views = listed();
  assert.deepEqual(targetRows(["B.u", "A.t", "C.w"], views).map((r) => [r.target, r.view?.id ?? null]), [["A.t", null], ["B.u", "vb"], ["C.w", "vb"]]);
  // where a click goes: the view it is linked to, or on it already, nowhere else
  assert.equal(targetStep("vb", "vb"), null);
  assert.equal(targetStep("vb", PROJECT), "vb");
  const el = drawn();
  const opened: [string | null, string][] = [];
  const list = new TargetList(el as unknown as HTMLElement, {
    list: () => views,
    targets: () => ["A.t", "B.u", "C.w"],
    active: () => PROJECT,
    progress: () => ({ total: 4, approved: 1, commented: 0, stale: 0 }),
    keyProgress: () => null,
    open: (id, target) => opened.push([id, target]),
    shut: () => false,
    toggle: () => {},
  });
  list.render();
  assert.match(el.innerHTML, /Targets<\/span><span class="sec-aside muted">3</);
  const rows = el.innerHTML.split("<button class=\"tg-row").slice(1);
  assert.match(rows[0], /^ tg-viewless" data-target="A\.t" title="A\.t — it has no view: open a temporary view of its TCB/);
  assert.match(rows[0], /<span class="tg-noview">no view<\/span>/);
  assert.doesNotMatch(rows[0], /rv-bar/, "said where the bar is");
  assert.doesNotMatch(rows[0], /data-open/);
  assert.match(rows[1], /data-open="vb" data-target="B\.u"/);
  assert.match(rows[2], /data-open="vb" data-target="C\.w"/);
  clickIn(el, { target: "A.t" });
  clickIn(el, { open: "vb", target: "C.w" });
  assert.deepEqual(opened, [[null, "A.t"], ["vb", "C.w"]]);
});

test("the Views menu: one list of views — the Project, the kept ones, those nobody keeps in italics — with no Targets and no Kept, a linked view starred and its targets named", () => {
  const views = listed();
  const was = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { addEventListener() {} };
  try {
    const menu = Object.assign(drawn(), { hidden: true });
    let active = "vb";
    const selected: string[] = [];
    const hooks: TabsHooks = {
      tabs: () => [],
      active: () => active,
      title: (id) => (id === PROJECT ? "Project" : id === "vb" ? "TCB of u" : views.find((v) => v.id === id)?.name ?? "uses of u"),
      summary: (id) => views.find((v) => v.id === id),
      list: () => views,
      select: (id) => selected.push(id),
      close: () => {},
      create: async () => null,
      duplicate: async () => null,
      rename: async () => null,
      remove: async () => null,
      readOnly: () => false,
      link: async () => null,
    };
    const tabs = new Tabs(drawn() as unknown as HTMLElement, drawn() as unknown as HTMLElement, menu as unknown as HTMLElement, hooks);
    tabs.toggle(true);
    const html = menu.innerHTML;
    // no Targets section, no Kept label, nothing about a target with no view
    assert.doesNotMatch(html, /Targets|Kept|rl-none|Review view|data-go|data-act="make"/);
    assert.equal(html.match(/class="vm-h"/g)?.length, 1, "one heading: Views");
    // the order: the Project, B.u's view (linked), the kept one, then the one nobody keeps
    const ids = [...html.matchAll(/data-open="([^"]+)"/g)].map((m) => m[1]);
    const loose = views.find((v) => !v.kept)!.id;
    const kept = views.find((v) => v.name === "Close reading")!.id;
    assert.deepEqual(ids, [PROJECT, "vb", kept, loose]);
    // a view of two targets, a row like any other with its star, which names them; its Delete says both
    assert.match(html, /<button class="vm-row on" data-open="vb" title="[^"]*The view of ★u and ★w: clicking any of them opens it"><span class="vm-name"><span class="star link-star" title="The view of ★u and ★w: clicking any of them opens it">★<\/span>TCB of u<\/span><span class="vm-scope">/);
    assert.match(html, /data-act="remove" title="Delete this view for everyone: ★u and ★w then have no view">Delete…</);
    // the one nobody keeps: apart, in italics as its tab is, saying it is not kept
    assert.match(html, /<div class="vm-sep"><\/div><button class="vm-row loose" data-open="[^"]+" title="[^"]*Not kept: it goes when everyone has closed it/);
    // a click on any row opens that view
    clickIn(menu, { open: "vb" });
    assert.deepEqual(selected, ["vb"]);
    // on the Project, which is no target's: no Delete
    active = PROJECT;
    tabs.toggle(true);
    assert.match(menu.innerHTML, /data-act="remove" disabled title="The Project cannot be deleted"/);
  } finally {
    (globalThis as { window?: unknown }).window = was;
  }
});

test("a target's panel: with no view, as marking leaves it, it says so and offers Link to this view and Key view", () => {
  const nodes: ViewNode[] = [
    { name: "T", kind: "theorem", module: "M", ax: 0, hash: "h-T" },
    { name: "G", kind: "def", module: "M", ax: 0, hash: "h-G" },
  ];
  const g = new Graph({ nodes, projectCount: 2, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 1 } as unknown as ViewMeta, new Int32Array([0, 1, SITE_STMT]));
  const d = emptyReview();
  record(d, { op: "target", name: "T", by: "Alice", on: true }, "tc", "2026-10-11T10:00:00.000Z");
  let tv: ReturnType<NonNullable<ReviewHooks["targetView"]>> = { title: null, here: false, why: null };
  const linked: number[] = [];
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Alice" }),
    queue: (i: number) => reviewQueue(g, d, i, inTargets(g, [i])),
    progress: () => ({ total: 2, approved: 0, commented: 0, stale: 0 }),
    keyProgress: () => ({ total: 1, approved: 0, commented: 0, stale: 0, unreviewed: 1 }),
    editedNow: () => false,
    textNow: () => null,
    reviewRoot: () => 0,
    inReview: () => true,
    isKey: () => false,
    targetView: () => tv,
    linkHere: (i: number) => linked.push(i),
    keyView: () => {},
  } as unknown as ReviewHooks;
  const box = new ReviewBox(g, hooks);
  const html = box.html(0, true);
  assert.match(html, /<div class="rv-view muted" title="Clicking ★T opens a temporary view of its TCB[^"]*">It has no view\.<\/div>/);
  assert.doesNotMatch(html, /Review view|data-rv-make/);
  assert.match(html, /data-rv-link[^>]*>Link to this view</);
  assert.match(html, /data-rv-keyview/);
  assert.doesNotMatch(html, /data-rv-lens/);
  const b = new FakeEl("button");
  b.dataset.rvLink = "";
  assert.equal(box.click(b as unknown as HTMLElement, 0, new FakeEl() as unknown as HTMLElement), true);
  assert.deepEqual(linked, [0]);
  // the view on show cannot be its view (the Project): Link is there, greyed, saying why
  tv = { title: null, here: false, why: "The Project is everyone's way in, no target's: link ★T to another view." };
  assert.match(box.html(0, true), /<button class="rv-btn" disabled title="The Project is everyone's way in[^"]*">Link to this view</);
  // with a view, the temporary one a click gave it, say: Its view, by its title
  tv = { title: "TCB of T", here: false, why: null };
  assert.match(box.html(0, true), /Its view: <b>TCB of T<\/b>/);
});

test("Activity: a view deleted is one event, with its targets, which have no view now", () => {
  const el = () => ({ addEventListener() {}, classList: { toggle() {} }, hidden: false, textContent: "", innerHTML: "" });
  const store = { data: {} as Record<string, unknown>, save() {} } as unknown as Store;
  const hooks = {
    me: () => "Bob",
    review: () => emptyReview(),
    mine: () => ({ targets: new Set<string>(), names: new Set<string>(), modules: new Set<string>() }),
    touching: () => [],
    covering: () => [],
    has: () => true,
    hasView: () => false,
    scopeTitle: (scope: string) => titleOfScope(scope),
  } as unknown as ActivityHooks;
  const act = new Activity(el() as unknown as HTMLElement, el() as unknown as HTMLElement, el() as unknown as HTMLElement, store, hooks);
  act.load([
    { id: 1, at: "2026-10-11T10:00:00.000Z", kind: "view", by: "Alice", what: "deleted", view: "review:A.t", name: null, was: null, targets: ["A.t"], scope: printQuery(reviewScope("A.t")) },
    { id: 2, at: "2026-10-11T10:01:00.000Z", kind: "view", by: "Alice", what: "deleted", view: "v1", name: null, was: "Close reading", targets: ["A.t", "B.u"], scope: "tcb(A.t)" },
    // a deletion recorded before a view could be several targets': its one as `target`
    { id: 3, at: "2026-10-11T10:02:00.000Z", kind: "view", by: "Alice", what: "deleted", view: "v2", name: null, was: "Old", target: "C.w", scope: "tcb(C.w)" },
    { id: 4, at: "2026-10-11T10:03:00.000Z", kind: "view", by: "Bob", what: "linked", view: "v3", name: null, target: "A.t", scope: "tcb(A.t)" },
  ] as StoredEvent[]);
  const [first, second, third] = act.items().filter((x) => x.html.includes("deleted")).sort((a, b) => (a.at < b.at ? -1 : 1));
  // a view nobody named by its scope's title, one marking made before too
  assert.match(first.html, /deleted <button class="act-ref" data-target="A\.t"[^>]*><span class="star">★<\/span>t<\/button>'s view <b>review ★A\.t<\/b>; the target has no view now/);
  assert.deepEqual(first.targets, ["A.t"]);
  assert.match(second.html, /deleted <button[^>]*data-target="A\.t"[^>]*>.*<\/button> and <button[^>]*data-target="B\.u"[^>]*>.*<\/button>'s view <b>Close reading<\/b>; those targets have no view now/);
  assert.deepEqual(second.targets, ["A.t", "B.u"]);
  assert.match(third.html, /data-target="C\.w"[^>]*>.*'s view <b>Old<\/b>; the target has no view now/);
  assert.match(act.items().find((x) => x.html.includes("linked"))!.html, /linked <button[^>]*data-target="A\.t"[^>]*>.*<\/button> to <span class="act-gone"[^>]*>TCB of A\.t<\/span>/);
  assert.ok(act.items().every((x) => !/Review view|Review ★/.test(x.html)));
});
