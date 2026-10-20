// The review is a focus (ViewSpec decision 28, the owner's, 2026-10-10): a view has a focus target or
// none, and the review works where it has one. The view's focus is shared and kept with the view — as
// set when it was made from a target or a focused view, else the target linked to it first, else the
// one target its board holds, else none; each reader may focus otherwise for themselves, which is theirs
// as the camera is, remembered per view and followed, and leaves the view's own unchanged.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Ask } from "../src/server/agent.ts";
import { Views } from "../src/server/views.ts";
import { cleanView } from "../src/shared/collab.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { parseQuery, printQuery } from "../src/shared/query.ts";
import { focusFrom, summary, ViewBook, viewFocus } from "../src/shared/views.ts";
import { focusChoices, keptFocus, readerFocus } from "../src/web/src/focus.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const targets = new Set(["A.t", "A.u", "B.v"]);
const isTarget = (n: string) => targets.has(n);

test("the view's focus: as set, else the target linked to it first, else the one target its board holds, else none", () => {
  const none = () => [];
  // as set: made from a target (a Key view), or from a focused view (a Zoom in), or by hand
  assert.equal(viewFocus({ focus: "A.u" }, isTarget, () => ["A.t", "A.u"]), "A.u");
  // set to none: none, whatever the board holds
  assert.equal(viewFocus({ focus: null, targets: ["A.t"] }, isTarget, () => ["A.t"]), null);
  // linked to a target, nothing set (a view kept by an older version)
  assert.equal(viewFocus({ targets: ["A.t"] }, isTarget, none), "A.t");
  // linked to several (the owner's decision of 2026-10-11): the one linked first, a target still
  assert.equal(viewFocus({ targets: ["A.u", "A.t"] }, isTarget, none), "A.u");
  assert.equal(viewFocus({ targets: ["Gone.x", "A.t"] }, isTarget, none), "A.t");
  // the one target the board holds; two, or none, is no focus
  assert.equal(viewFocus({}, isTarget, () => ["B.v"]), "B.v");
  assert.equal(viewFocus({}, isTarget, () => ["A.t", "B.v"]), null);
  assert.equal(viewFocus({}, isTarget, none), null);
  // a focus on what is no target now goes by the next rule
  assert.equal(viewFocus({ focus: "Gone.x", targets: ["A.t"] }, isTarget, none), "A.t");
  assert.equal(viewFocus({ focus: "Gone.x" }, isTarget, () => ["A.u"]), "A.u");
  assert.equal(viewFocus({ targets: ["Gone.x"] }, isTarget, none), null);
  // what a copy takes from the view it is made from
  assert.equal(focusFrom({ focus: null, targets: ["A.t"] }), null);
  assert.equal(focusFrom({ targets: ["A.u", "A.t"] }), "A.u");
  assert.equal(focusFrom({}), undefined);
});

test("the reader's focus is their own: the view's where they chose nothing, a target linked to it or held by the board, or none", () => {
  const held = ["A.t", "A.u"];
  assert.equal(readerFocus(undefined, "A.t", isTarget, held), "A.t");
  assert.equal(readerFocus(undefined, null, isTarget, held), null);
  assert.equal(readerFocus("A.u", "A.t", isTarget, held), "A.u");
  assert.equal(readerFocus(null, "A.t", isTarget, held), null);
  // the view's own focus need not be held (a Zoom in's, a Key view's): it is still a choice
  assert.equal(readerFocus("B.v", "B.v", isTarget, held), "B.v");
  // a choice the board no longer holds, or no target now: the view's again
  assert.equal(readerFocus("B.v", "A.t", isTarget, held), "A.t");
  assert.equal(readerFocus("Gone.x", null, isTarget, held), null);
  // the menu: the view's first, the other targets held, then none
  assert.deepEqual(focusChoices("A.u", [], ["B.v", "A.t", "A.u"]), ["A.u", "A.t", "B.v", null]);
  assert.deepEqual(focusChoices(null, [], ["A.t"]), ["A.t", null]);
  // a view of several targets (the owner's decision of 2026-10-11): its targets first, in the order
  // they were linked, whether the board holds them or not, then the view's own, then those held
  assert.deepEqual(focusChoices("A.u", ["B.v", "A.u"], ["A.t", "A.u"]), ["B.v", "A.u", "A.t", null]);
  assert.deepEqual(focusChoices("A.t", ["B.v"], ["A.u"]), ["B.v", "A.t", "A.u", null]);
  // and a reader may choose a target linked to the view that the board does not hold
  assert.equal(readerFocus("B.v", "A.t", isTarget, ["B.v", ...held]), "B.v");
});

test("a page opened at an address takes the reader's own focus there as their place remembers it: the address carries none", () => {
  // chosen: a target, or none
  assert.deepEqual(keptFocus({ focus: "A.u" }), { focus: "A.u" });
  assert.deepEqual(keptFocus({ focus: null }), { focus: null });
  // nothing chosen, nothing remembered, or something no page wrote: the view's own
  assert.deepEqual(keptFocus({}), {});
  assert.deepEqual(keptFocus(undefined), {});
  assert.deepEqual(keptFocus({ focus: ["A.t"] }), {});
  // the place it makes, read as the page reads it (pageselection.ts, place): what the reader chose wins
  const mine = keptFocus({ focus: null }).focus;
  assert.equal(readerFocus(mine, "A.t", isTarget, ["A.t"]), null);
});

test("a view's focus is kept with it: a Key view's is its target, a copy takes it, setting it keeps a view nobody kept", () => {
  const book = new ViewBook();
  // a click on a target with no view gives it a temporary view of its TCB, focused on it
  const r = book.openTarget("A.t", "Alice", 0).view;
  assert.deepEqual([r.targets, r.focus], [["A.t"], "A.t"]);
  // a target's Key view, opened from its panel: focused on the target it is made from
  const key = book.open(parseQuery("key(A.t)"), "Alice", 0, { focus: "A.t" }).view;
  assert.equal(key.focus, "A.t");
  // a Zoom in from it: the focus of the view it came from (the page passes it)
  const zoom = book.open(parseQuery("tcb(A.d) and key(A.t)"), "Alice", 0, { focus: "A.t" }).view;
  assert.equal(zoom.focus, "A.t");
  // an open view found again keeps the focus it was made with
  assert.equal(book.open(parseQuery("key(A.t)"), "Bob", 1, { focus: "A.u" }).view.id, key.id);
  assert.equal(book.get(key.id)!.focus, "A.t");
  // a copy of the target's view is focused as it is, but is not the target's
  const copy = book.create("Mine", "Bob", { from: r.id });
  assert.ok(typeof copy !== "string");
  assert.deepEqual([copy.focus, copy.targets], ["A.t", undefined]);
  // set by hand, for everyone: work on the board, which keeps a view nobody kept
  assert.deepEqual(book.setFocus(zoom.id, "A.u", "Carol"), [{ id: zoom.id, what: "focus", by: "Carol" }, { id: zoom.id, what: "kept", by: "Carol" }]);
  assert.equal(book.setFocus(zoom.id, "A.u", "Carol"), null, "the same again changes nothing");
  assert.deepEqual(book.setFocus(zoom.id, null, "Carol"), [{ id: zoom.id, what: "focus", by: "Carol" }]);
  assert.equal(summary(book.get(zoom.id)!).focus, null, "the list every page holds says it");
});

test("the server: a view opened with a focus, the view's focus set for everyone and kept on disk; a reader's focus travels with their place", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-focus-"));
  try {
    const sent: { event: string; data: unknown }[] = [];
    const views = new Views(dir, LAYOUT_VERSION, (event, data) => sent.push({ event, data }));
    views.isTarget = isTarget;
    const ask = (path: string, body: unknown, name: string | null = "Alice", kind: "person" | "agent" = "person") => views.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind } } as Ask, "full");
    const opened = ask("/api/views/open", { scope: "key(A.t)", focus: "A.t" });
    const id = (opened.body as { view: { id: string; focus: string } }).view.id;
    assert.equal(views.book.get(id)!.focus, "A.t");
    assert.equal(ask("/api/views/open", { scope: "key(A.t)", focus: "N.x" }).status, 400, "a focus is a target");
    assert.equal(ask("/api/views/focus", { id, focus: "A.u" }).status, 200);
    assert.equal(ask("/api/views/focus", { id, focus: "N.x" }).status, 400);
    const last = sent.filter((e) => e.event === "views").at(-1)!.data as { views: { id: string; focus?: string | null }[]; changes: { what: string }[] };
    assert.equal(last.views.find((v) => v.id === id)!.focus, "A.u");
    assert.deepEqual(last.changes.map((c) => c.what), ["focus", "kept"]);
    // kept across a restart
    const again = new Views(dir, LAYOUT_VERSION, () => {});
    assert.equal(again.book.get(id)!.focus, "A.u");
    // a reader's own focus is part of where they are: those who follow them take it
    const place = { mode: "plain", sel: null, source: false, clusterMode: "namespace", cam: null, view: id, scope: null, tabs: [] };
    assert.equal(cleanView({ ...place, focus: "B.v" })!.focus, "B.v");
    assert.equal(cleanView({ ...place, focus: null })!.focus, null);
    assert.equal("focus" in cleanView(place)!, false, "absent: the view's own");
    assert.equal("focus" in cleanView({ ...place, focus: 3 })!, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agents read a view's focus, set it at level full, and have a focus of their own that followers take", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const reader = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 }).token;
    const ask = (method: string, path: string, body?: Json, t = token) => S.ask(method, path, body, { authorization: `Bearer ${t}` });
    // where the agent is, as presence keeps it: by its token's id (vpa_<id>_<secret>)
    const bot = { name: "Bot", token: token.split("_")[1] };
    // marked, it has no view (the owner's decision of 2026-10-12)
    const marked = await ask("POST", "/api/agent/target", { name: "N.b" });
    assert.deepEqual([marked.status, marked.json!.view], [200, null]);
    const list = async () => (await ask("GET", "/api/agent/views")).json!.views as Json[];
    const viewOf = async (id: string): Promise<Json> => (await list()).find((v) => v.id === id)!;
    assert.deepEqual((await list()).map((v) => v.id), ["project"]);
    // the Project holds one target: its focus by the rules; its temporary view's is its target
    assert.equal((await viewOf("project")).focus, "N.b");
    const tv = (await ask("POST", "/api/agent/view", { review: "N.b" })).json!;
    assert.equal(tv.temporary, true);
    const its = tv.view.view as string;
    assert.equal((await viewOf(its)).focus, "N.b");
    // set for everyone at full, refused below
    assert.equal((await ask("POST", "/api/agent/views/focus", { id: "project", focus: null })).status, 200);
    assert.equal((await viewOf("project")).focus, null);
    assert.equal((await ask("POST", "/api/agent/views/focus", { id: "project", focus: "N.b" }, reader)).status, 403);
    assert.equal((await ask("POST", "/api/agent/views/focus", { id: "project", focus: "N.a" })).status, 400, "N.a is no target");
    // a view opened on a query, made from the target
    const opened = await ask("POST", "/api/agent/views/open", { scope: "key(N.b)", focus: "N.b" });
    assert.equal(opened.json!.view.focus, "N.b");
    // its own focus, as a person's: people following it take it; another view starts from that
    // view's own again
    assert.equal((await ask("POST", "/api/agent/view", { view: "project", focus: "N.b" })).status, 200);
    assert.equal(S.live.presence.agentView(bot)?.focus, "N.b");
    assert.equal((await ask("POST", "/api/agent/view", { focus: "none" })).status, 200);
    assert.equal(S.live.presence.agentView(bot)?.focus, null);
    assert.equal((await ask("POST", "/api/agent/view", { view: its })).status, 200);
    assert.equal(S.live.presence.agentView(bot)?.focus, undefined);
    assert.equal((await ask("POST", "/api/agent/view", { focus: "N.a" })).status, 400);
    // the scope of a target's view changes as any view's, at full, which keeps it
    assert.equal((await ask("POST", "/api/agent/views/scope", { id: its, scope: "tcb(N.b) except trusted" })).status, 200);
    assert.deepEqual([printQuery(S.live.views.book.get(its)!.scope), S.live.views.book.get(its)!.kept, S.live.views.book.viewOf("N.b")?.id], ["tcb(N.b) except trusted", true, its]);
  } finally {
    await S.close();
  }
});
