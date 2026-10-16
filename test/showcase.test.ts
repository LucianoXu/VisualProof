// The showcases (showcase/*/): each committed site reads as a server would read it, tells the story
// it was made to tell, and holds nothing a site must not give away. No Lean is needed: the site is
// read from the repository, never served from it (a server writes in its site; scripts/showcase.mjs
// serves a copy).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { History, snapVersion } from "../src/server/history.ts";
import { ReviewStore } from "../src/server/review.ts";
import { current, statusOf } from "../src/shared/review.ts";
import { SECRETS } from "../showcase/flt-regular/generate.ts";
import type { ShowcaseProject } from "../showcase/flt-regular/generate.ts";

const DIR = fileURLToPath(new URL("../showcase/flt-regular/", import.meta.url));
const SITE = join(DIR, "site");
const project = JSON.parse(readFileSync(join(DIR, "project.json"), "utf8")) as ShowcaseProject;

/** every file under `dir`, relative to it */
function files(dir: string, under = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), under) : [relative(under, join(dir, e.name))]));
}

test("the flt-regular showcase's history holds the story's three builds, at their commits and times", () => {
  const h = new History(SITE);
  const list = h.list();
  assert.deepEqual(
    list.map((s) => [s.commit?.hash, s.toolchain, s.at]),
    project.builds.map((b) => [b.commit, b.toolchain, b.builtAt]),
  );
  assert.equal(project.served, project.builds[project.builds.length - 1].commit);
  for (const s of list) assert.ok(h.graph(s.id), `the graph of snapshot ${s.id} reads`);
});

test("the flt-regular showcase's review replays without a problem and tells the story", () => {
  const store = new ReviewStore(SITE, SITE);
  assert.deepEqual(store.problems, []);
  const d = store.data;
  assert.deepEqual(Object.keys(d.targets).sort(), ["FltRegular.caseII", "eq_pow_prime_of_unit_of_congruent", "flt_regular"]);
  // Mathlib trusted but its number theory, which the statement means
  assert.ok(!d.trusted.includes("Mathlib") && d.trusted.includes("Mathlib.Algebra") && !d.trusted.some((t) => t.startsWith("Mathlib.NumberTheory")));
  const all = Object.values(d.opinions).flat();
  assert.deepEqual([...new Set(all.filter((o) => !o.agent).map((o) => o.by))].sort(), ["Alice", "Bob", "Charlie"]);
  assert.deepEqual([...new Set(all.filter((o) => o.agent).map((o) => o.by))], ["Alice's AI"]);
  // an opinion recorded for someone at one screen, and a comment quoting another
  assert.ok(all.some((o) => o.by === "Charlie" && o.recordedBy?.by === "Alice"));
  assert.ok(all.some((o) => o.comment?.includes("](opinion:IsRegularNumber#Charlie@")));
  assert.deepEqual(Object.keys(d.keys.flt_regular ?? {}).sort(), ["FermatLastTheoremFor", "IsRegularPrime"]);

  // as the latest build has them: approved, commented, and two approvals gone stale
  const h = new History(SITE);
  const g = h.graph(h.latest()!.id)!;
  const version = new Map(g.nodes.filter((n) => !n.ext).map((n) => [n.name, snapVersion(n)]));
  const status = (name: string) => statusOf(d, name, version.get(name));
  assert.equal(status("flt_regular"), "approved");
  assert.equal(status("NumberField.instCommRingRingOfIntegers"), "commented");
  assert.equal(status("exists_not_dvd_spanSingleton_eq"), "stale");
  assert.equal(status(`exists_pow_eq_of_zeta_sub_one_pow_dvd_sub_one`), "stale");
  assert.equal(status("Hilbert92"), "approved");
  // the stale ones keep the text judged, for What changed
  for (const name of ["exists_not_dvd_spanSingleton_eq", "exists_pow_eq_of_zeta_sub_one_pow_dvd_sub_one"])
    assert.ok(current(d, name).every((o) => o.text), name);
});

test("the flt-regular showcase's library, views and timeline read", () => {
  const store = new ReviewStore(SITE, SITE);
  const lib = Object.values(store.data.files ?? {});
  assert.equal(lib.length, 3);
  for (const f of lib) {
    const bytes = readFileSync(join(SITE, "files", f.sha));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha, f.title);
    assert.equal(f.type, "pdf");
  }
  const links = store.data.links ?? [];
  assert.ok(links.length >= 4);
  for (const l of links) assert.ok(lib.some((f) => f.sha === l.file), l.label);

  const views = JSON.parse(readFileSync(join(SITE, "views.json"), "utf8")) as { views: { id: string; name?: string; version?: number }[]; notes: unknown[] };
  const named = views.views.filter((v) => v.name);
  assert.ok(named.length >= 5);
  assert.ok(named.some((v) => v.version === 1), "a view kept at the first build");
  assert.ok(views.notes.length >= 6);

  const events = readFileSync(join(SITE, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { at: string });
  const first = Date.parse(project.builds[0].builtAt);
  for (const e of events) assert.ok(Date.parse(e.at) >= first && Date.parse(e.at) < Date.parse("2026-10-16T00:00:00Z"), e.at);
});

test("the flt-regular showcase gives nothing away, and every name in it is legal on Windows", () => {
  for (const s of SECRETS) assert.ok(!existsSync(join(SITE, s)), s);
  assert.ok(!existsSync(join(SITE, ".lock")));
  for (const f of files(DIR)) {
    for (const part of f.split(/[/\\]/)) {
      assert.ok(!/[<>:"|?*\u0000-\u001f]/.test(part) && !/[ .]$/.test(part) && !/~\d/.test(part), `name: ${f}`);
      assert.ok(!/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(part), `name: ${f}`);
    }
    assert.ok(f.length < 100, `path: ${f}`);
    const raw = readFileSync(join(DIR, f));
    if (f.endsWith(".pdf") || f.startsWith(join("site", "files"))) continue;
    const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    // tokens, personal and read-only links; paths of the machine it was made on
    assert.ok(!/\bvp[apr]_[A-Za-z0-9_-]{8,}/.test(text), `a secret in ${f}`);
    assert.ok(!/(\/home\/|\/Users\/|\/data\/|\/tmp\/|[A-Z]:\\\\)/.test(text), `a path of this machine in ${f}`);
  }
  // small enough to keep in the repository
  const bytes = files(SITE).reduce((n, f) => n + statSync(join(SITE, f)).size, 0);
  assert.ok(bytes < 4 << 20, `${bytes} bytes`);
});
