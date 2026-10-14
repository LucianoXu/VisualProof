// The layout's memory across a build's two graphs (server/pipeline.ts, prepare; CanvasSpec,
// "Stability"): the graph read first waits for the usage pass and is laid out provisionally; the
// usage pass's graph, which completes it, is laid out as the build's own: against what the build
// was laid out against, never against that provisional layout, which lacked the notation's edges.
// So a first read gives the picture a re-layout gives, and a later build keeps the places of the
// build before it.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gunzipSync } from "node:zlib";
import type { Kind, RawGraph } from "../src/shared/graph.ts";
import type { Extraction } from "../src/server/extract.ts";
import type { Prepared } from "../src/server/pipeline.ts";
import { prepare } from "../src/server/pipeline.ts";
import type { Project } from "../src/server/project.ts";

const tmp = mkdtempSync(join(tmpdir(), "vp-layoutmemory-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const quiet = () => {};
const project: Project = { root: join(tmp, "project"), name: "P", toolchain: "leanprover/lean4:v4.33.1", roots: ["P"], libDir: "", files: new Map() };

/** A project of four namespaces, each a chain of definitions under a few theorems, the theorems
 *  of one namespace resting on the next's; `notation`: a notation unit, and the theorems that use
 *  it, as the usage pass finds them; `extra`: one declaration more, as a later build adds. */
function graph(notation: boolean, extra = false): RawGraph {
  const nodes: RawGraph["nodes"] = [];
  const edges: RawGraph["edges"] = [];
  const add = (name: string, kind: Kind, module: string) => nodes.push({ name, kind, module, type: "Prop", ax: 0, hash: name }) - 1;
  const spaces = ["Alg", "Geo", "Top", "Num"];
  const theorems: number[] = [];
  const firstDef: number[] = [];
  const defs = spaces.map((ns) => Array.from({ length: 8 }, (_, i) => add(`P.${ns}.d${i}`, "def", `P.${ns}`)));
  spaces.forEach((ns, k) => {
    for (let i = 1; i < defs[k].length; i++) edges.push([defs[k][i], defs[k][i - 1], 1]);
    firstDef.push(defs[k][0]);
    for (let i = 0; i < 5; i++) {
      const t = add(`P.${ns}.t${i}`, "theorem", `P.${ns}`);
      theorems.push(t);
      edges.push([t, defs[k][(i * 3) % defs[k].length], 1]);
      if (k + 1 < spaces.length) edges.push([t, defs[k + 1][i], 2]);
    }
  });
  if (extra) edges.push([add("P.Num.d8", "def", "P.Num"), firstDef[3], 1]);
  if (notation) {
    // the notation, used by every theorem, rests on the deepest definitions of every namespace
    const n = add("P.«term‖_‖»", "notation", "P.Notation");
    for (const t of theorems) edges.push([t, n, 1]);
    for (const d of firstDef) edges.push([n, d, 1]);
  }
  return {
    schema: 1,
    roots: ["P"],
    modules: ["P.Alg", "P.Geo", "P.Top", "P.Num", "P.Notation"].map((name) => ({ name, imports: [] })),
    nodes,
    externals: [],
    edges,
    axioms: [],
    axiomSets: [[]],
    stats: { folded: 0, metaDropped: 0, ms: 0 },
  };
}

const ex = (fingerprint: string, g: RawGraph): Extraction => ({ graph: g, fingerprint, at: "2026-10-14T00:00:00Z", cached: false });
let n = 0;
const fresh = () => {
  const d = join(tmp, `site-${++n}`);
  return { site: d, cache: `${d}-cache`, lean: join(tmp, "lean") };
};
const layouts = (p: Prepared) => JSON.parse(gunzipSync(p.metaGz).toString("utf8")).layouts;
const stored = (dirs: { site: string }) => JSON.parse(readFileSync(join(dirs.site, "layout-memory.json"), "utf8"));

const raw1 = ex("raw1", graph(false));
const merged1 = ex("merged1", graph(true));
const raw2 = ex("raw2", graph(false, true));
const merged2 = ex("merged2", graph(true, true));

test("a first read: the usage pass's graph is laid out from scratch, as a re-layout lays it out", async () => {
  const relayout = layouts(await prepare(project, fresh(), null, quiet, { extraction: merged1, freshLayout: true }));

  const site = fresh();
  await prepare(project, site, null, quiet, { extraction: raw1, provisional: true });
  assert.equal(stored(site).before, null, "the provisional layout was made from scratch, and says so");
  const read = layouts(await prepare(project, site, null, quiet, { extraction: merged1, completes: raw1.fingerprint }));
  assert.deepEqual(read, relayout);
  assert.equal(stored(site).before, undefined, "the build's own layout is no longer provisional");

  // as it was: against the provisional layout, another picture
  const old = fresh();
  await prepare(project, old, null, quiet, { extraction: raw1 });
  assert.notDeepEqual(layouts(await prepare(project, old, null, quiet, { extraction: merged1 })), relayout);
});

test("a later build: both its graphs are laid out against the build before, and keep its places", async () => {
  // the build before, served as the site last served it
  const before = fresh();
  await prepare(project, before, null, quiet, { extraction: merged1 });
  const expected = layouts(await prepare(project, before, null, quiet, { extraction: merged2 }));

  const site = fresh();
  await prepare(project, site, null, quiet, { extraction: raw1, provisional: true });
  await prepare(project, site, null, quiet, { extraction: merged1, completes: raw1.fingerprint });
  const built = stored(site).layouts;
  await prepare(project, site, null, quiet, { extraction: raw2, provisional: true });
  assert.deepEqual(stored(site).before, built, "the later build's provisional layout remembers the build before");
  assert.deepEqual(layouts(await prepare(project, site, null, quiet, { extraction: merged2, completes: raw2.fingerprint })), expected);
});

test("a restart while the usage pass runs serves the provisional layout again, and still completes it", async () => {
  const site = fresh();
  const a = await prepare(project, site, null, quiet, { extraction: raw1, provisional: true });
  const again = await prepare(project, site, null, quiet, { extraction: raw1, provisional: true });
  assert.deepEqual(layouts(again), layouts(a));
  assert.equal(stored(site).before, null);
  const relayout = layouts(await prepare(project, fresh(), null, quiet, { extraction: merged1, freshLayout: true }));
  assert.deepEqual(layouts(await prepare(project, site, null, quiet, { extraction: merged1, completes: raw1.fingerprint })), relayout);
});

test("a re-layout while the usage pass runs: the build's graph is laid out from scratch too", async () => {
  // the build before, then a new build read, laid out afresh before its usage pass ends
  const site = fresh();
  await prepare(project, site, null, quiet, { extraction: merged1 });
  await prepare(project, site, null, quiet, { extraction: raw2, provisional: true });
  await prepare(project, site, null, quiet, { extraction: raw2, provisional: true, freshLayout: true });
  assert.equal(stored(site).before, null);
  const relayout = layouts(await prepare(project, fresh(), null, quiet, { extraction: merged2, freshLayout: true }));
  assert.deepEqual(layouts(await prepare(project, site, null, quiet, { extraction: merged2, completes: raw2.fingerprint })), relayout);
});

test("a site without a memory lays its graph out from scratch, whatever view the cache holds", async () => {
  const site = fresh();
  // a cache shared with another site, which served the build stabilized against something else
  const other = { ...fresh(), cache: site.cache };
  await prepare(project, other, null, quiet, { extraction: merged1 });
  await prepare(project, other, null, quiet, { extraction: merged2 });
  const relayout = layouts(await prepare(project, fresh(), null, quiet, { extraction: merged2, freshLayout: true }));
  assert.deepEqual(layouts(await prepare(project, site, null, quiet, { extraction: merged2 })), relayout);
});
