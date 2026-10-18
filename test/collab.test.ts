// The people on a server (CollabSpec.md): the names pages give and the proxy's, presence, shared
// pins, the timeline.

import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanView, colorOf, initials, validName } from "../src/shared/collab.ts";
import type { Peer } from "../src/shared/collab.ts";
import { Identities } from "../src/server/identity.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import { applyOps, diffPins, emptyLayouts, invalidOps } from "../src/shared/places.ts";
import { gzipSync } from "node:zlib";
import type { BuildStatus, FileState, FileStatus } from "../src/shared/build.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../src/shared/graph.ts";
import { emptyReview } from "../src/shared/review.ts";
import type { StoredEvent } from "../src/shared/timeline.ts";
import { Timeline } from "../src/server/events.ts";
import type { Prepared } from "../src/server/pipeline.ts";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

test("a reader's name is the one the page gives, any name, percent-encoded on the way", () => {
  const ids = new Identities();
  assert.equal(ids.mode, "declared");
  assert.equal(ids.who(req({ "x-visualproof-name": "Alice" })), "Alice");
  assert.equal(ids.who(req({ "x-visualproof-name": encodeURIComponent("许英特") })), "许英特", "any script");
  assert.equal(ids.who(req({})), null, "no name given");
  assert.equal(ids.who(req({ "x-visualproof-name": encodeURIComponent("a\nb") })), null, "not a name");
  assert.equal(ids.who(req({ "x-visualproof-name": "%E0%A4%A" })), null, "broken encoding");
});

test("behind an authenticating proxy, the name is the header's, and the page's is not taken", () => {
  const ids = new Identities("X-Forwarded-User");
  assert.equal(ids.mode, "header");
  assert.equal(ids.who(req({ "x-forwarded-user": "carol@example.org" })), "carol@example.org");
  assert.equal(ids.who(req({ "x-visualproof-name": "Mallory" })), null);
  // Node reads a header's bytes as Latin-1: a name the proxy wrote in UTF-8 is read as UTF-8, one in
  // Latin-1 as it is, and MIME encoded-words (Tailscale's, beyond ASCII) are decoded
  const sent = (s: string) => Buffer.from(s, "utf8").toString("latin1");
  assert.equal(ids.who(req({ "x-forwarded-user": sent("José García") })), "José García");
  assert.equal(ids.who(req({ "x-forwarded-user": sent("许英特") })), "许英特");
  assert.equal(ids.who(req({ "x-forwarded-user": "José" })), "José");
  assert.equal(ids.who(req({ "x-forwarded-user": "=?utf-8?q?Jos=C3=A9_Garc=C3=ADa?=" })), "José García");
  assert.equal(ids.who(req({ "x-forwarded-user": `=?UTF-8?B?${Buffer.from("许英特").toString("base64")}?=` })), "许英特");
  assert.equal(ids.who(req({ "x-forwarded-user": "Jos=C3=A9" })), "Jos=C3=A9", "not encoded-words: as it is");
});

test("presence: the list goes out when it changes, not on every heartbeat", () => {
  const sent: Peer[][] = [];
  const p = new Presence((peers) => sent.push(peers));
  const view = cleanView({ mode: "tcb", sel: "A.b", source: false, clusterMode: "namespace", cam: { x: 1, y: 2, k: 3 }, view: null, scope: null, tabs: [] });
  p.beat("s1", "Alice", view, false);
  p.beat("s1", "Alice", view, false);
  assert.equal(sent.length, 1, "the same again is not news");
  p.beat("s1", "Alice", view, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1][0].idle, true);
  p.drop("s1");
  assert.deepEqual(sent[2], []);
});

test("names, initials, colours, views", () => {
  assert.ok(validName("Yingt") && validName("Ada Lovelace"));
  assert.ok(!validName("") && !validName(" x") && !validName("x".repeat(61)));
  assert.equal(initials("Ada Lovelace"), "AL");
  assert.equal(initials("yingt"), "YI");
  assert.equal(colorOf("Alice"), colorOf("Alice"), "a name has one colour");
  assert.notEqual(colorOf("Alice"), colorOf("Bob"));
  assert.equal(cleanView("nonsense"), null);
  const v = cleanView({ mode: "tcb", sel: 3, cam: { x: "1" }, view: "review:A", tabs: ["project", 4, "review:A"] });
  assert.deepEqual(v, { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: "review:A", scope: null, tabs: ["project", "review:A"] });
});

test("presence carries the reader's source windows: the following one collapsed or not, and each pinned one, in order", () => {
  const base = { mode: "tcb", sel: "A.b", source: true, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
  const v = cleanView({ ...base, sourceCollapsed: true, pinned: [{ decl: "A.c", collapsed: true }, { decl: "A.d", collapsed: false }] });
  assert.deepEqual(v, { ...base, sourceCollapsed: true, pinned: [{ decl: "A.c", collapsed: true }, { decl: "A.d", collapsed: false }] });
  // none pinned, nothing collapsed: neither is said, as a page or an agent that pins nothing says it
  assert.deepEqual(cleanView({ ...base, sourceCollapsed: false, pinned: [] }), base);
  // collapsed is said of an open window only
  assert.equal(cleanView({ ...base, source: false, sourceCollapsed: true })?.sourceCollapsed, undefined);
  // read with care: what is not a pinned window is dropped, `collapsed` is true or not at all, at
  // most six
  const odd = cleanView({ ...base, pinned: [{ decl: "A.c", collapsed: "yes" }, null, { decl: 4 }, "A.e", { collapsed: true }] });
  assert.deepEqual(odd?.pinned, [{ decl: "A.c", collapsed: false }]);
  const many = cleanView({ ...base, pinned: Array.from({ length: 20 }, (_, k) => ({ decl: `A.x${k}`, collapsed: false })) });
  assert.equal(many?.pinned?.length, 6);
  assert.equal(cleanView({ ...base, pinned: "A.c" })?.pinned, undefined);
});

test("pins: the last drop wins and goes to the end; a diff says what changed; another layout version starts afresh", () => {
  const L = emptyLayouts();
  assert.ok(applyOps(L, [
    { op: "pin", mode: "namespace", kind: "node", key: "A.x", at: [1, 2] },
    { op: "pin", mode: "namespace", kind: "node", key: "A.y", at: [3, 4] },
  ]));
  assert.ok(applyOps(L, [{ op: "pin", mode: "namespace", kind: "node", key: "A.x", at: [5, 6] }]));
  assert.deepEqual(Object.keys(L.namespace.nodes), ["A.y", "A.x"], "dropped again: now the latest");
  assert.ok(!applyOps(L, [{ op: "pin", mode: "namespace", kind: "node", key: "A.x", at: [5, 6] }]), "the same drop again changes nothing");
  assert.ok(applyOps(L, [{ op: "unpin", mode: "namespace", kind: "node", key: "A.y" }]));
  assert.deepEqual(diffPins("module", { nodes: { a: [0, 0], b: [1, 1] }, clusters: {} }, { nodes: { b: [2, 2], c: [3, 3] }, clusters: {} }), [
    { op: "unpin", mode: "module", kind: "node", key: "a" },
    { op: "pin", mode: "module", kind: "node", key: "b", at: [2, 2] },
    { op: "pin", mode: "module", kind: "node", key: "c", at: [3, 3] },
  ]);
  assert.ok(applyOps(L, [{ op: "clear" }]));
  assert.deepEqual(L, emptyLayouts());
  assert.ok(invalidOps([{ op: "pin", mode: "namespace", kind: "node", key: "x", at: [1, NaN] }]));
  assert.ok(invalidOps([{ op: "drop-table" }]));
  assert.ok(invalidOps([]));
  assert.equal(invalidOps([{ op: "unpin", mode: "module", kind: "cluster", key: "M" }]), null);
  const dir = mkdtempSync(join(tmpdir(), "vp-places-"));
  try {
    const project = (version: number) => new Views(dir, version, () => {}).places;
    project(2).apply([{ op: "pin", mode: "module", kind: "cluster", key: "M", at: [7, 8] }]);
    assert.deepEqual(project(2).data.layouts.module.clusters, { M: [7, 8] }, "kept across a restart");
    assert.deepEqual(project(3).data.layouts, emptyLayouts(), "under another layout version, nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timeline: a build that settled says what failed, was fixed, got or lost a sorry; a target's TCB that changed says what went stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-timeline-"));
  try {
    const sent: StoredEvent[] = [];
    const t = new Timeline(dir, (e) => sent.push(e));
    const f = (module: string, state: FileState, builtAt: number): FileStatus => ({ module, file: null, state, warnings: 0, builtAt });
    const st = (active: boolean, files: FileStatus[]) => ({ active, progress: null, files, counts: {} }) as unknown as BuildStatus;
    t.buildStatus(st(false, [f("A", "ok", 1), f("B", "ok", 1)]));
    assert.equal(sent.length, 0, "the first look is where the comparison begins");
    t.buildStatus(st(true, [f("A", "building", 1), f("B", "ok", 1)]));
    assert.equal(sent.length, 0, "nothing while a build runs");
    t.buildStatus(st(false, [f("A", "failed", 1), f("B", "sorry", 2)]));
    assert.deepEqual(sent.map((e) => e.kind === "build" && [e.failed, e.sorry, e.rebuilt]), [[["A"], ["B"], 1]]);
    t.buildStatus(st(false, [f("A", "ok", 3), f("B", "ok", 4)]));
    const fixed = sent[1];
    assert.ok(fixed.kind === "build" && fixed.fixed[0] === "A" && fixed.sorryGone[0] === "B" && fixed.rebuilt === 2);

    // a target T whose statement uses D, which uses E; a proof of T uses P, which is not in its TCB
    const prep = (nodes: { name: string; hash: string }[], edges: number[]) =>
      ({ metaGz: gzipSync(JSON.stringify({ nodes })), edgesGz: gzipSync(Buffer.from(new Int32Array(edges).buffer)) }) as unknown as Prepared;
    const review = emptyReview();
    review.targets.T = { by: "Alice", at: "2026-10-07T10:00:00Z" };
    review.opinions.D = [{ by: "Bob", verdict: "approve", hash: "d1", at: "2026-10-07T10:01:00Z" }];
    t.graphChanged(prep([{ name: "T", hash: "t" }, { name: "D", hash: "d1" }, { name: "E", hash: "e" }, { name: "P", hash: "p" }], [0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF]), review);
    assert.equal(sent.length, 2, "the first graph is where a target's TCB starts");
    // D changes, E leaves the TCB, F comes in
    t.graphChanged(prep([{ name: "T", hash: "t" }, { name: "D", hash: "d2" }, { name: "F", hash: "f" }, { name: "P", hash: "p2" }], [0, 1, SITE_STMT, 1, 2, SITE_BODY, 0, 3, SITE_PROOF]), review);
    const c = sent[2];
    assert.ok(c.kind === "tcb", JSON.stringify(c));
    assert.deepEqual([c.target, c.changed, c.added, c.removed, c.stale], ["T", ["D"], ["F"], ["E"], 1]);
    // kept: a server that starts again has the events, and compares with the TCB it last saw
    const again = new Timeline(dir, () => {});
    assert.equal(again.events.length, 3);
    assert.ok(existsSync(join(dir, "tcb-baselines.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
