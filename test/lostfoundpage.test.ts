// The lost-and-found and the build-status popover in the page (HistorySpec decisions 12–15): what
// the popover holds (web/src/buildpop.ts, a pure function); the drawer drawn from what the server
// answers, its Attach to… confirmed with what the search picked, and its archiving
// (web/src/lostfound.ts); and the migrations as events of Activity (web/src/activity.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileStatus } from "../src/shared/build.ts";
import type { BuildLine, LostAnswer, LostMigration } from "../src/shared/lostfound.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import { popHtml, stamp } from "../src/web/src/buildpop.ts";
import type { PopState } from "../src/web/src/buildpop.ts";
import type { LostApi, LostReply } from "../src/web/src/data.ts";
import { LostAndFound } from "../src/web/src/lostfound.ts";
import type { LostHooks } from "../src/web/src/lostfound.ts";
import type { Store } from "../src/web/src/store.ts";
import { setPeople } from "../src/web/src/verified.ts";

const NOW = new Date(2026, 9, 9, 21, 30);
const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();

const line = (id: number, at: string, o: Partial<BuildLine> = {}): BuildLine => ({
  id, at, commit: { hash: `${id}abcdef0123`, branch: "main" }, missing: [], counts: { modules: 756, nodes: 13_000 + id, edges: 0, externals: 0 }, ...o,
});
const LABEL = { failed: "failed", stale: "out of date" };
const base = (o: Partial<PopState> = {}): PopState => ({ graph: { version: 3, at: local(9, 21, 28), missing: [] }, extractError: null, files: [], stateLabel: LABEL, builds: undefined, lost: null, now: NOW, ...o });

test("times as the popover says them: today, yesterday, a day, another year", () => {
  assert.equal(stamp(local(9, 13, 8), NOW), "today 13:08");
  assert.equal(stamp(local(8, 9, 5), NOW), "yesterday 09:05");
  assert.equal(stamp(local(1, 18, 2), NOW), "Oct 1 18:02");
  assert.equal(stamp(new Date(2025, 11, 31, 23, 59).toISOString(), NOW), "Dec 31 2025 23:59");
});

test("the popover: the build time and its commit, the two buttons with the count, the recent builds newest first, then the graph and the files", () => {
  const snapshots = [1, 2, 3, 4, 5, 6, 7].map((k) => line(k, local(k + 1, 10, k)));
  snapshots[6] = line(7, local(9, 13, 8), { commit: { hash: "fb2839694847", branch: "main", dirty: true }, renames: { high: 5, medium: 1 } });
  snapshots[5] = line(6, local(7, 10, 6), { approx: true, commit: { hash: "f9a0ca2abaf9", branch: null, guessed: true }, missing: ["A.B"] });
  const files: FileStatus[] = [{ module: "My.X", file: "My/X.lean", state: "failed", warnings: 0 }, { module: "My.Y", file: "My/Y.lean", state: "built" as FileStatus["state"], warnings: 0 }];
  const html = popHtml(base({ builds: { snapshots, current: 7 }, lost: { count: 12, lost: 3 }, files }));
  // the build on show: when it finished, its commit with what differed from it
  assert.match(html, /<span class="bp-built"[^>]*>Built today 13:08<\/span><span class="bp-commit"[^>]*><span class="mono">fb28396<\/span> main <span class="bp-dirty">edited<\/span>/);
  // the two ways into the history, the count of what the lost-and-found lists, lost things marked
  assert.match(html, /data-bp="tm"[^>]*>.*Time Machine<\/button>/);
  assert.match(html, /data-bp="lost" title="[^"]*: 3 lost, 9 migrations listed">.*Lost-and-found<span class="bp-count lost">12<\/span>/);
  // the recent builds: five of seven, newest first, each opening the Time Machine there
  const rows = [...html.matchAll(/<button class="bp-build( on)?" data-snapshot="(\d+)"/g)].map((m) => [Number(m[2]), !!m[1]]);
  assert.deepEqual(rows, [[7, true], [6, false], [5, false], [4, false], [3, false]]);
  assert.match(html, /Recent builds <span class="muted">5 of 7<\/span>/);
  assert.match(html, /data-snapshot="7"[^]*?13,007 declarations · 5 renamed/);
  assert.match(html, /data-snapshot="6"[^]*?≈ Oct 7 10:06[^]*?≈<span class="mono">f9a0ca2<\/span>[^]*?1 file unread/);
  // what was there before: the graph and the files in trouble
  assert.match(html, /Graph v3, read/);
  assert.match(html, /<button class="pf" data-module="My.X">.*failed/);
  assert.match(html, /Files <span class="muted">1 of 2<\/span>/);
});

test("the popover without a history, while it is read, and with nothing lost", () => {
  const none = popHtml(base({ builds: null }));
  assert.ok(!/data-bp=|Recent builds|bp-head/.test(none), "a saved graph keeps no history: no buttons");
  assert.match(none, /All 0 files built and up to date/);
  const reading = popHtml(base({ builds: undefined }));
  assert.match(reading, /Reading the history…/);
  assert.match(reading, /data-bp="lost"/);
  const empty = popHtml(base({ builds: { snapshots: [line(1, local(9, 13, 8))], current: 1 }, lost: { count: 0, lost: 0 } }));
  assert.ok(!/bp-count/.test(empty), "no count where it lists nothing");
  const migrationsOnly = popHtml(base({ builds: { snapshots: [line(1, local(9, 13, 8), { commit: null })], current: 1 }, lost: { count: 2, lost: 0 } }));
  assert.match(migrationsOnly, /<span class="bp-count">2<\/span>/);
  assert.match(migrationsOnly, /no commit/);
});

const MIG: LostMigration = { id: "m1", at: local(9, 13, 9), from: "My.Q.termIv", to: "My.Q.termIv.Inverse", snap: 2, by: "VisualProof", auto: "same kernel hash", rename: true, review: true, carried: { opinions: 2, targets: 0, keys: 1, notes: 1, pins: 0, scopes: 0, reviewViews: 0 } };
const HAND: LostMigration = { id: "m2", at: local(9, 14, 0), from: "My.old", to: "My.new", by: "Carol", person: "0123456789", rename: false, review: true, carried: { opinions: 1, targets: 1, keys: 0, notes: 0, pins: 3, scopes: 0, reviewViews: 1 }, undone: { by: "Claude", agent: true, at: local(9, 15, 0) } };

function answer(): LostAnswer {
  return {
    lost: [
      {
        name: "My.gone",
        last: { name: "My.gone", snapshot: 2, at: local(9, 13, 8), commit: { hash: "fb2839694847", branch: "main" }, module: "My.Mod" },
        suggestions: [{ to: "My.here", score: 0.72, why: "the same last name, the same module", snap: 2 }],
        entries: [
          { key: "target:My.gone", kind: "target", name: "My.gone", by: "Alice", at: local(8, 9, 0) },
          { key: "opinion:My.gone#Alice@x", kind: "opinion", name: "My.gone", by: "Alice", at: local(8, 9, 1), verdict: "comment", comment: "Is `My.gone` right?" },
          { key: "pin:project:namespace:My.gone", kind: "pin", name: "My.gone", by: null, at: local(8, 9, 2), view: "project", title: "Project", mode: "namespace" },
          { key: "note:v1:n1:My.gone", kind: "note", name: "My.gone", by: "Bot", agent: true, at: local(8, 9, 3), view: "v1", title: "Mine", note: "n1", text: "see `My.gone`" },
        ],
      },
      { name: "My.never", last: null, suggestions: [], entries: [{ key: "key:My.top#My.never", kind: "key", name: "My.never", by: "Alice", at: local(8, 9, 4), target: "My.top", member: "My.never" }] },
    ],
    migrations: [{ ...HAND, key: "move:m2" }],
    archived: [{ key: "move:m1", line: { key: "move:m1", on: true, by: "Alice", at: local(9, 16, 0) }, migration: MIG }],
    aside: { entries: 2, modules: ["My.Broken"] },
    count: 6,
  };
}

/** Just enough of an element for the drawer: its HTML, its classes, its listeners. */
function drawerEl() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const classes = new Set<string>();
  return {
    innerHTML: "",
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) },
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
    querySelectorAll: () => [],
    /** a click on an element inside, as the drawer finds it: by the attributes it carries */
    click(attrs: Record<string, string>) {
      const target = {
        closest: (sel: string) => {
          const m = /^\[([\w-]+)\]$/.exec(sel);
          return m && m[1] in attrs ? { getAttribute: (a: string) => attrs[a] ?? null, dataset: {} } : null;
        },
      };
      for (const f of listeners.get("click") ?? []) f({ target });
    },
  };
}

test("the drawer: Lost by name with the last build and the suggestions first, the migrations with Undo, the archived with Put back; Attach to… confirmed, then a move", async () => {
  setPeople([{ id: "0123456789", name: "Caroline", was: ["Carol"], revoked: null } as never]);
  const posted: [string, unknown][] = [];
  const reply: LostReply = { ok: true, changed: true, migration: { ...HAND, id: "m3", undone: undefined } };
  const api: LostApi = {
    builds: async () => null,
    list: async () => answer(),
    archive: async (keys, on) => (posted.push(["archive", { keys, on }]), { ok: true, changed: true }),
    move: async (from, to) => (posted.push(["move", { from, to }]), reply),
    unmove: async (id) => (posted.push(["unmove", { id }]), { ok: true }),
  };
  const told: unknown[] = [];
  const hooks: LostHooks = {
    has: (n) => n === "My.here" || n === "My.new" || n === "My.top",
    go: () => {},
    hasView: (id) => id === "project",
    openView: () => {},
    hasNote: () => true,
    showNote: () => {},
    comment: (text) => `<p>${text}</p>`,
    pick: async () => "My.here",
    timeMachine: (at) => told.push(at),
    ensureName: async () => "Alice",
    nameLost: () => {},
    toggled: () => {},
    changed: () => {},
  };
  const el = drawerEl();
  const d = new LostAndFound(el as unknown as HTMLElement, api, hooks);
  d.toggle(true);
  await new Promise((ok) => setTimeout(ok, 0));
  const html = el.innerHTML;
  assert.match(html, /<div class="banner warn">2 things said of declarations in files this build could not read are set aside[^<]*Broken/);
  assert.match(html, /Lost <span class="muted">5<\/span>/);
  // a name: its full name, the last build that had it, the suggestion before anything else
  assert.match(html, /data-lf-name="My.gone"><div class="lf-name mono"[^>]*>My.gone<\/div><div class="lf-last muted">last in the build of [^<]*13:08[^]*fb28396[^]*My.Mod<\/span><\/div><div class="lf-sugg"><span class="muted">Likely<\/span> <button class="act-ref mono" data-go="My.here"[^]*72%/);
  // its entries, each with what it is and Archive
  for (const k of ["target:My.gone", "opinion:My.gone#Alice@x", "pin:project:namespace:My.gone", "note:v1:n1:My.gone"]) assert.match(html, new RegExp(`data-lf-key="${k.replace(/[.#]/g, "\\$&")}"><span class="lf-kind`), k);
  assert.match(html, /<p>Is `My.gone` right\?<\/p>/, "an opinion's comment, as the review shows it");
  assert.match(html, /pinned on <button class="act-ref" data-view="project"[^>]*>Project<\/button> <span class="muted">by namespace<\/span>/);
  assert.match(html, /named in a note on <span class="act-gone">Mine<\/span> by <span class="act-agent">/);
  // a name no build kept: no Show in history
  assert.match(html, /data-lf-name="My.never"[^]*?data-lf-history disabled/);
  assert.match(html, /◆<\/span> key for <span class="star">★<\/span><button class="act-ref mono" data-go="My.top"/);
  // a migration by hand, undone by an agent: who, what it carried, no Undo
  assert.match(html, /Migrations <span class="muted">1<\/span>/);
  assert.match(html, /data-lf-key="move:m2">[^]*attached by <b>Caroline<span class="vf"[^]*1 opinion, 1 target mark, 1 target's view, 3 pins[^]*undone by <span class="act-agent">[^]*Claude/);
  assert.ok(!/data-lf-m="0"[^]*?data-lf-undo[^]*?<details/.test(html), "an undone migration has no Undo");
  // archived: the server's rename, with who archived it and Put back
  assert.match(html, /Archived <span class="muted">1<\/span>[^]*renamed, found by <b>VisualProof<\/b>[^]*archived by <b>Alice<\/b>[^]*data-lf-putback/);
  // Show in history: the Time Machine, at the last build that had it, on it
  el.click({ "data-lf-g": "0", "data-lf-history": "" });
  assert.deepEqual(told, [{ snapshot: 2, name: "My.gone" }]);
  // Attach to…: the declaration picked is confirmed in the drawer, then moved
  el.click({ "data-lf-g": "0", "data-lf-pick": "" });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.match(el.innerHTML, /<div class="lf-confirm">Attach what was said of <b class="mono">gone<\/b> to <button class="act-ref mono" data-go="My.here"/);
  assert.deepEqual(posted, [], "nothing moved before it is confirmed");
  el.click({ "data-lf-confirm": "" });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(posted, [["move", { from: "My.gone", to: "My.here" }]]);
  // archiving an entry, a name's every entry, a migration; putting back
  el.click({ "data-lf-g": "0", "data-lf-e": "1", "data-lf-archive": "" });
  await new Promise((ok) => setTimeout(ok, 0));
  el.click({ "data-lf-g": "0", "data-lf-archive-all": "" });
  await new Promise((ok) => setTimeout(ok, 0));
  el.click({ "data-lf-a": "0", "data-lf-putback": "" });
  await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(posted.slice(1), [
    ["archive", { keys: ["opinion:My.gone#Alice@x"], on: true }],
    ["archive", { keys: ["target:My.gone", "opinion:My.gone#Alice@x", "pin:project:namespace:My.gone", "note:v1:n1:My.gone"], on: true }],
    ["archive", { keys: ["move:m1"], on: false }],
  ]);
  // Activity's migrations: the listed and the archived, oldest first
  assert.deepEqual(d.migrations().map((m) => m.key), ["move:m1", "move:m2"]);
});

test("Activity: each migration an event of the review — who, from → to, the server's or by hand, undone or not — leading to its entry", () => {
  setPeople([{ id: "0123456789", name: "Caroline", was: ["Carol"], revoked: null } as never]);
  const el = () => ({ addEventListener: () => {}, classList: { toggle: () => {} } });
  const store = { data: {}, save: () => {} } as unknown as Store;
  const opened: string[] = [];
  const hooks = {
    review: () => ({ opinions: {}, targets: {}, keys: {} }),
    has: (n: string) => n.endsWith("Inverse") || n === "My.new",
    hasView: () => false,
    migrations: () => [{ ...MIG, key: "move:m1" }, { ...HAND, key: "move:m2" }],
    openLost: (k: string) => opened.push(k),
  } as unknown as ActivityHooks;
  const act = new Activity(el() as unknown as HTMLElement, el() as unknown as HTMLElement, el() as unknown as HTMLElement, store, hooks);
  const items = act.items().filter((x) => x.key.startsWith("mv:"));
  assert.deepEqual(items.map((x) => [x.key, x.cat, x.by, x.agent]), [
    ["mv:m2", "review", "Caroline", false],
    ["mv:m1", "review", "VisualProof", false],
  ]);
  assert.match(items[1].html, /<b>VisualProof<\/b> carried what was said of <span class="act-gone mono" title="My.Q.termIv">termIv<\/span> to <button class="act-ref" data-go="My.Q.termIv.Inverse"[^]*renamed <span class="muted">\(same kernel hash\)<\/span>/);
  assert.match(items[1].html, /data-lost="move:m1"/);
  assert.match(items[0].html, /<b>Caroline<span class="vf"[^]*attached what was said of [^]*old[^]*to [^]*new[^]*undone by Claude \(agent\)/);
  assert.deepEqual(items[0].names, ["My.old", "My.new"]);
});
