// Artwork recipes (ExportSpec decision 20, shared/artrecipe.ts): what a picture of the board is, in
// words that hold on any project, checked, resolved against a board, carried by a link; and the
// agents' endpoint that makes the link (POST /api/agent/artwork).

import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeRecipe, encodeRecipe, readRecipe, recipeIn, resolveRecipe } from "../src/shared/artrecipe.ts";
import type { ArtRecipe, RecipeBoard } from "../src/shared/artrecipe.ts";
import { chooseIn, untilStill } from "../src/web/src/artwork.ts";
import { site } from "./site.ts";

const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };

/** A board: Lib at the top, Lib.A (a target deep in it) and Lib.B under it, the outside world, and
 *  Other beside Lib; 1,100 declarations in the project. */
const BOARD: RecipeBoard = (() => {
  const clusters = [
    { key: "Lib", depth: 0, parent: -1, count: 1000, ext: false },
    { key: "Lib.A", depth: 1, parent: 0, count: 500, ext: false },
    { key: "Lib.B", depth: 1, parent: 0, count: 5, ext: false },
    { key: "Lib.A.X", depth: 2, parent: 1, count: 300, ext: false },
    { key: "⟨external⟩", depth: 0, parent: -1, count: 4000, ext: true },
    { key: "⟨external⟩.Mathlib", depth: 1, parent: 4, count: 3900, ext: true },
    { key: "Other", depth: 0, parent: -1, count: 100, ext: false },
    { key: "Lib.C", depth: 1, parent: 0, count: 200, ext: false },
    { key: "Tiny", depth: 0, parent: -1, count: 3, ext: false },
  ];
  const at = new Map([["Lib.A.X.main", 3], ["Lib.C.side", 7], ["Lib.helper", 0]]);
  return { clusters, clusterOf: (n) => at.get(n), targets: ["Lib.A.X.main", "Lib.C.side"], projectCount: 1100 };
})();

test("a recipe is checked: every field as it says, nothing unknown, within what a link carries", () => {
  const good = readRecipe({ size: "a2", orientation: "portrait", names: { clusters: 1 }, targets: ["Lib.A.X.main"], selection: { name: "Lib.A.X.main" }, title: "Lib", subtitle: "", keys: false });
  assert.ok("recipe" in good, JSON.stringify(good));
  const bad = (v: unknown, re: RegExp) => {
    const r = readRecipe(v);
    assert.ok("error" in r && re.test(r.error), `${JSON.stringify(v)}: ${JSON.stringify(r)}`);
  };
  bad(null, /object/);
  bad({ sise: "a2" }, /no field sise/);
  bad({ size: "a1" }, /no size/);
  bad({ size: { w: 10, h: 100 } }, /whole pixels/);
  bad({ orientation: "upright" }, /orientation/);
  bad({ theme: "sepia" }, /theme/);
  bad({ titleSize: 40 }, /titleSize/);
  bad({ title: 5 }, /title/);
  bad({ names: "some" }, /names is/);
  bad({ names: { clusters: -1 } }, /depth/);
  bad({ names: { depth: 1 } }, /no field depth/);
  bad({ names: { minShare: 2 } }, /share/);
  bad({ targets: "most" }, /targets/);
  bad({ selection: { name: "A.b", mode: "tcbs" } }, /selection/);
  bad({ selection: { of: "A.b" } }, /selection/);
  bad({ title: "x", names: { decls: ["x".repeat(900), "y".repeat(900), "z".repeat(900), "w".repeat(900), "v".repeat(900), "u".repeat(900), "t".repeat(900)] } }, /at most/);
  assert.deepEqual(readRecipe({ selection: null }), { recipe: { selection: null } });
  assert.deepEqual(readRecipe({ size: { w: 1000, h: 2000 } }), { recipe: { size: { w: 1000, h: 2000 } } });
});

test("a recipe resolved: a new artwork's settings where it says nothing; sizes by name in either orientation", () => {
  const plain = resolveRecipe({}, BOARD);
  assert.deepEqual([plain.look.w, plain.look.h, plain.look.labels, plain.look.targets, plain.look.theme, plain.look.edges, plain.look.selection, plain.look.title], [3840, 2160, "board", "marked", "light", "all", true, null]);
  assert.deepEqual(plain.problems, []);
  const a2 = resolveRecipe({ size: "a2", orientation: "portrait" }, BOARD).look;
  assert.deepEqual([a2.w, a2.h], [4961, 7016]);
  const tall = resolveRecipe({ size: { w: 1000, h: 2000 } }, BOARD).look;
  assert.deepEqual([tall.w, tall.h], [1000, 2000], "a size given keeps its own shape");
  const turned = resolveRecipe({ size: { w: 1000, h: 2000 }, orientation: "landscape" }, BOARD).look;
  assert.deepEqual([turned.w, turned.h], [2000, 1000]);
  const look = resolveRecipe({ transparent: true, colouring: "status", targets: "faded", keys: false, notes: false, lit: false, edges: "selection", source: true, style: "stars" }, BOARD).look;
  assert.deepEqual([look.background, look.scheme, look.targets, look.keys, look.notes, look.selection, look.edges, look.source, look.style], ["transparent", "status", "highlight", false, false, false, "selection", true, "stars"]);
  assert.equal(resolveRecipe({ targets: "none" }, BOARD).look.targets, "plain");
});

test("names by a rule: the outside world's own, and the project's down to the depth that hold enough, each written only where it covers no other; names given written wherever they fall", () => {
  const r = resolveRecipe({ names: { clusters: 1 }, targets: ["Lib.A.X.main"] }, BOARD);
  assert.equal(r.look.labels, "chosen");
  assert.equal(r.look.namesFrom, "none");
  // Lib.B and the top-level Tiny hold less than 1% of 1,100; the outside world's Mathlib is not the
  // project's. The rule's clusters are written only where they fit (ruledNames), the target's name
  // as if ticked by hand (shownNames)
  assert.deepEqual(r.named, { clusters: [], ruled: ["Lib", "Lib.A", "⟨external⟩", "Other", "Lib.C"], decls: ["Lib.A.X.main"] });
  assert.deepEqual(r.look.ruledNames, ["c:Lib", "c:Lib.A", "c:⟨external⟩", "c:Other", "c:Lib.C"]);
  assert.deepEqual(r.look.shownNames, ["d:Lib.A.X.main"]);
  assert.deepEqual([r.look.targets, r.look.shownTargets], ["chosen", ["Lib.A.X.main"]]);
  // every target's name, under all; none; a lower share; the rule's clusters left out by hand
  assert.deepEqual(resolveRecipe({ names: { clusters: 1 } }, BOARD).named.decls, ["Lib.A.X.main", "Lib.C.side"]);
  assert.deepEqual(resolveRecipe({ names: { clusters: 0, targets: false } }, BOARD).named, { clusters: [], ruled: ["Lib", "⟨external⟩", "Other"], decls: [] });
  assert.deepEqual(resolveRecipe({ names: { clusters: 1, minShare: 0, targets: false } }, BOARD).named.ruled, ["Lib", "Lib.A", "Lib.B", "⟨external⟩", "Other", "Lib.C", "Tiny"]);
  assert.deepEqual(resolveRecipe({ names: { clusters: 1, targets: false, omit: ["External", "Other"] } }, BOARD).named.ruled, ["Lib", "Lib.A", "Lib.C"]);
  // clusters by key are written as given, as names ticked by hand; declarations besides
  const keys = resolveRecipe({ names: { clusters: ["Lib", "Lib.A"], decls: ["Lib.helper"] }, targets: ["Lib.A.X.main"] }, BOARD);
  assert.deepEqual(keys.named, { clusters: ["Lib", "Lib.A"], ruled: [], decls: ["Lib.A.X.main", "Lib.helper"] });
  assert.deepEqual([keys.look.shownNames, keys.look.ruledNames], [["c:Lib", "c:Lib.A", "d:Lib.A.X.main", "d:Lib.helper"], []]);
  // from what the board writes: what is left out is hidden
  const from = resolveRecipe({ names: { from: "board", omit: ["Lib.B", "Lib.helper"], targets: false } }, BOARD).look;
  assert.deepEqual([from.namesFrom, from.hiddenNames, from.shownNames], ["board", ["c:Lib.B", "d:Lib.helper"], []]);
  // the board's own ways
  assert.equal(resolveRecipe({ names: "clusters" }, BOARD).look.labels, "clusters");
});

test("what a recipe names that the board has not is said, not drawn; a target of the review the board has not is left out unsaid; what does not fit is counted", () => {
  const r = resolveRecipe({ names: { clusters: ["Lib", "Nope"], decls: ["Lib.gone"] }, targets: ["Lib.A.X.main", "Not.a.target"] }, BOARD);
  assert.deepEqual(r.problems, ["not targets of the review: Not.a.target", "no cluster Nope on the board", "no declaration Lib.gone on the board"]);
  assert.deepEqual(r.look.shownTargets, ["Lib.A.X.main"]);
  assert.deepEqual(r.named.clusters, ["Lib"]);
  // a target renamed or removed since it was marked stays in the review: left out where the recipe
  // does not name it, said where it does
  const stale: RecipeBoard = { ...BOARD, targets: [...BOARD.targets, "Lib.renamedAway"] };
  const all = resolveRecipe({ names: { clusters: 0 } }, stale);
  assert.deepEqual([all.problems, all.named.decls], [[], ["Lib.A.X.main", "Lib.C.side"]]);
  assert.deepEqual(resolveRecipe({ targets: ["Lib.renamedAway"] }, stale).problems, ["targets not on the board: Lib.renamedAway"]);
  // more than the artwork carries: what fits, in its order, and how many were left out — no problem
  const big: RecipeBoard = { ...BOARD, clusterOf: () => 0 };
  const decls = Array.from({ length: 400 }, (_, i) => `Lib.a_rather_long_declaration_name_${i}`);
  const cut = resolveRecipe({ names: { decls, targets: false } }, big);
  assert.deepEqual(cut.problems, []);
  assert.ok(cut.left > 200 && cut.named.decls.length + cut.left === 400, `${cut.named.decls.length} kept, ${cut.left} left`);
  assert.deepEqual(cut.look.shownNames, cut.named.decls.map((d) => `d:${d}`));
});

test("the list of names: a rule's name ticked is the reader's, unticked is no longer the rule's — and hidden where the board would write it", () => {
  const s = { namesFrom: "none" as const, hiddenNames: [], shownNames: ["d:A.t"], ruledNames: ["c:A", "c:B"] };
  // B was left out (it would cover another name): ticked, it is written wherever it falls
  assert.deepEqual(chooseIn(s, new Set(["c:A", "d:A.t"]), ["c:B"], true), { hidden: [], shown: ["d:A.t"], ruled: ["c:A"], add: ["c:B"], hide: [] });
  // A, written by the rule, unticked: from none, simply no longer written
  assert.deepEqual(chooseIn(s, new Set(["c:A", "d:A.t"]), ["c:A"], false), { hidden: [], shown: ["d:A.t"], ruled: ["c:B"], add: [], hide: [] });
  // from As shown, the board would write it all the same: hidden
  assert.deepEqual(chooseIn({ ...s, namesFrom: "board" }, new Set(["c:A"]), ["c:A"], false).hide, ["c:A"]);
  // a name shown besides, unticked; one the board writes, unticked, from As shown
  assert.deepEqual(chooseIn(s, new Set(["d:A.t"]), ["d:A.t"], false).shown, []);
  assert.deepEqual(chooseIn({ ...s, namesFrom: "board" }, new Set(["d:A.x"]), ["d:A.x"], false).hide, ["d:A.x"]);
});

test("a link's files are saved once the board has been drawn since the mode came and then still, never on a frame from before", async () => {
  let t = 0;
  let drawn = 50;
  const o = { now: () => t, drawnAt: () => drawn, sleep: async (ms: number) => void (t += ms) };
  // a frame from before the mode came (since 1000), long ago: not still enough to save
  assert.equal(await untilStill(o, 1000, 800, 5000), false, "no frame since the mode came");
  // drawn at 6,500 (after since), then nothing: still 800 ms later
  t = 6000;
  drawn = 6500;
  let at = -1;
  const sleep = async (ms: number) => {
    t += ms;
    if (t === 6700) drawn = 6700;
  };
  assert.equal(await untilStill({ ...o, sleep, now: () => t }, 6000), true);
  at = t;
  assert.ok(at >= 6700 + 800, `saved at ${at}, after the last frame and 800 ms`);
});

test("a link carries the recipe after #, any text it holds; and the files to save", () => {
  const r: ArtRecipe = { title: "Théorème · ⟨x⟩", names: { clusters: 1 }, selection: { name: "Lib.A.X.main", mode: "keys" } };
  const text = encodeRecipe(r);
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeRecipe(text), r);
  assert.equal(decodeRecipe("%%%"), null);
  assert.deepEqual(recipeIn(`#mode=tcb&s=Lib.a&art=${text}&save=svg,png,svg,gif`), { text, save: ["svg", "png"] });
  assert.deepEqual(recipeIn(`#mode=tcb&art=${text}`), { text, save: [] });
  assert.equal(recipeIn("#mode=tcb"), null);
});

test("POST /api/agent/artwork: the recipe checked against the board, a link with the selection in its address and the recipe after it; nothing changes", async () => {
  const S = await site();
  try {
    const before = JSON.stringify(S.live.review.whole());
    const r = await S.ask("POST", "/api/agent/artwork", { recipe: { size: "a3", orientation: "portrait", names: { clusters: 0 }, selection: { name: "N.b" }, title: "Fixture" }, save: "png,svg" }, agent);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const link = new URL(r.json!.link as string);
    const p = new URLSearchParams(link.hash.slice(1));
    assert.deepEqual([p.get("mode"), p.get("s"), p.get("save")], ["tcb", "N.b", "png,svg"]);
    assert.deepEqual(decodeRecipe(p.get("art")!), { size: "a3", orientation: "portrait", names: { clusters: 0 }, selection: { name: "N.b" }, title: "Fixture" });
    assert.deepEqual(r.json!.size, [3508, 4961]);
    assert.deepEqual(r.json!.selection, { name: "N.b", mode: "tcb" });
    assert.ok((r.json!.names as { ruled: string[] }).ruled.includes("N"), JSON.stringify(r.json!.names));
    assert.equal(JSON.stringify(S.live.review.whole()), before, "nothing changed");
    // refused: what is no field, a selection that is no declaration, a target that is none, a bad save
    const ask = (body: unknown) => S.ask("POST", "/api/agent/artwork", body, agent);
    assert.equal((await ask({ recipe: { size: "a1" } })).status, 400);
    const gone = await ask({ recipe: { selection: { name: "N.c" } } });
    assert.equal(gone.status, 404);
    assert.ok(Array.isArray(gone.json!.didYouMean));
    const nt = await ask({ recipe: { targets: ["N.a"] } });
    assert.deepEqual([nt.status, nt.json!.problems], [404, ["not targets of the review: N.a"]]);
    assert.equal((await ask({ recipe: {}, save: "gif" })).status, 400);
    assert.equal((await ask({ recipe: { view: "nope" } })).status, 404);
    // a target of the review the graph no longer has: left out unsaid, unless the recipe names it
    S.live.review.append({ name: "Alice", agent: false }, { op: "target", name: "N.renamedAway", by: "Alice", on: true }, "tc");
    assert.equal((await ask({ recipe: { names: { clusters: 0 } } })).status, 200);
    const named = await ask({ recipe: { targets: ["N.renamedAway"] } });
    assert.deepEqual([named.status, named.json!.problems], [404, ["targets not on the board: N.renamedAway"]]);
    // an agent says it is one
    assert.equal((await S.ask("POST", "/api/agent/artwork", { recipe: {} })).status, 400);
  } finally {
    await S.close();
  }
});
