// The library's events in the timeline (CollabSpec decision 5, AttachmentSpec.md): the history the
// replay keeps of them — only what changed something, a removed link and a title edited away kept
// as they were, an invited person's renamed — carried by the review's JSON and checked there; the
// drawer's events for them, attributed as opinions are, each leading to what it is about
// (web/src/activity.ts); and the agents' timeline listing them (GET /api/agent/activity).

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibraryStep } from "../src/shared/library.ts";
import { applyEvent, emptyReview, readEvent, reviewFromJson } from "../src/shared/review.ts";
import type { ReviewData, ReviewEvent } from "../src/shared/review.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import type { Store } from "../src/web/src/store.ts";
import { setPeople } from "../src/web/src/verified.ts";
import { tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const L1 = "l000000000001", L2 = "l000000000002", L3 = "l000000000003";
const P = "0123456789";
const at = (k: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, k)).toISOString();

/** The review the lines give, each read as its log reads it: a person's, an agent's, or the log of
 *  someone invited by a personal link. */
function replayed(lines: [Record<string, unknown>, ("agent" | "invited")?][]): ReviewData {
  const d = emptyReview();
  for (const [raw, log] of lines) {
    const e = readEvent(raw, log === "agent", log === "invited" ? P : null);
    assert.ok(e && typeof e !== "string", `readable: ${JSON.stringify(raw)} → ${String(e)}`);
    applyEvent(d, e as ReviewEvent);
  }
  return d;
}

/** Carol, invited by a personal link, adds a paper and links it; an agent adds an image, archives it
 *  and links a cluster; Bob renames the paper, restores the image, edits Carol's link and removes
 *  it; VisualProof carries the agent's link with a namespace a build renamed; Carol goes by
 *  Caroline since. Between them, events that change nothing. */
function library(): ReviewData {
  const invited = (o: Record<string, unknown>) => [{ ...o, by: "Carol", person: P }, "invited"] as [Record<string, unknown>, "invited"];
  const agent = (o: Record<string, unknown>) => [{ ...o, by: "Claude", agent: true }, "agent"] as [Record<string, unknown>, "agent"];
  const bob = (o: Record<string, unknown>) => [{ ...o, by: "Bob" }] as [Record<string, unknown>];
  return replayed([
    invited({ op: "file", at: at(0), sha: A, title: "A Tiny Paper on Games", type: "pdf", size: 10, pages: 2 }),
    // the same bytes added on another server: the first record stands
    bob({ op: "file", at: at(1), sha: A, title: "Games again", type: "pdf", size: 10 }),
    agent({ op: "file", at: at(2), sha: B, title: "Figure 1", type: "png", size: 5 }),
    bob({ op: "file-edit", at: at(3), sha: A, title: "Games, Briefly" }),
    bob({ op: "file-edit", at: at(4), sha: A, title: "Games, Briefly" }),
    agent({ op: "file-archive", at: at(5), sha: B }),
    bob({ op: "file-archive", at: at(6), sha: B }),
    bob({ op: "file-restore", at: at(7), sha: B }),
    invited({ op: "link", at: at(8), id: L1, subject: "decl(N.a)", file: A, page: 2, quote: { text: "Halving undoes doubling." }, label: "Theorem 3" }),
    agent({ op: "link", at: at(9), id: L2, subject: "ns(N)", file: A, page: 1, label: "Section 1" }),
    bob({ op: "link-edit", at: at(10), id: L1, label: "Thm 3", page: 3 }),
    bob({ op: "link-edit", at: at(11), id: L1, label: "Thm 3" }),
    [{ op: "link-edit", at: at(12), by: "VisualProof", id: L2, subject: "ns(M)", auto: "namespace renamed", snap: 2 }],
    bob({ op: "unlink", at: at(13), id: L1 }),
    bob({ op: "unlink", at: at(14), id: L1 }),
    // a link into a file this server has no record of, on a declaration the graph lacks
    bob({ op: "link", at: at(15), id: L3, subject: "decl(N.zzz)", file: C, page: 1, label: "Lemma 2" }),
    [{ op: "name", at: at(16), by: "Caroline", person: P }, "invited"],
  ]);
}

const HISTORY: LibraryStep[] = [
  { op: "file", sha: A, title: "A Tiny Paper on Games", by: "Caroline", at: at(0), person: P },
  { op: "file", sha: B, title: "Figure 1", by: "Claude", at: at(2), agent: true },
  { op: "file-edit", sha: A, title: "Games, Briefly", wasTitle: "A Tiny Paper on Games", by: "Bob", at: at(3) },
  { op: "file-archive", sha: B, title: "Figure 1", by: "Claude", at: at(5), agent: true },
  { op: "file-restore", sha: B, title: "Figure 1", by: "Bob", at: at(7) },
  { op: "link", id: L1, subject: "decl(N.a)", label: "Theorem 3", file: A, by: "Caroline", at: at(8), person: P },
  { op: "link", id: L2, subject: "ns(N)", label: "Section 1", file: A, by: "Claude", at: at(9), agent: true },
  { op: "link-edit", id: L1, subject: "decl(N.a)", label: "Thm 3", file: A, changed: ["label", "place"], wasLabel: "Theorem 3", by: "Bob", at: at(10) },
  { op: "link-edit", id: L2, subject: "ns(M)", label: "Section 1", file: A, changed: ["subject"], wasSubject: "ns(N)", auto: "namespace renamed", by: "VisualProof", at: at(12) },
  { op: "unlink", id: L1, subject: "decl(N.a)", label: "Thm 3", file: A, by: "Bob", at: at(13) },
  { op: "link", id: L3, subject: "decl(N.zzz)", label: "Lemma 2", file: C, by: "Bob", at: at(15) },
];

test("the replay keeps the library's history: what changed something, a removed link and an old title as they were, an invited person under the name they go by now", () => {
  const d = library();
  assert.deepEqual(d.libraryHistory, HISTORY);
  // the state itself is as before: the first record stands, the removed link is gone
  assert.equal(d.files![A].title, "Games, Briefly");
  assert.equal(d.files![A].by, "Caroline");
  assert.deepEqual(d.links!.map((l) => l.id), [L2, L3]);
  // no quote's text in the history
  assert.ok(!JSON.stringify(d.libraryHistory).includes("Halving"));
  // no library event, no history: the review is as it was without one
  const none = replayed([[{ op: "opinion", at: at(0), by: "Bob", name: "N.a", verdict: "approve" }]]);
  assert.ok(!("libraryHistory" in none));
});

test("the review's JSON carries the history, checked entry by entry: a malformed one is dropped, the rest made again of their own fields", () => {
  const d = library();
  const back = reviewFromJson(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.libraryHistory, HISTORY);
  // a page applying what comes after holds what the server holds
  const next = readEvent({ op: "file-archive", at: at(20), by: "Bob", sha: A }, false) as ReviewEvent;
  applyEvent(d, next);
  applyEvent(back, next);
  assert.deepEqual(back.libraryHistory, d.libraryHistory);
  const good = HISTORY[0];
  const edit = HISTORY[8];
  const bad: unknown[] = [
    5,
    null,
    [good],
    { ...good, op: "explain" },
    { ...good, sha: "nothex" },
    { ...good, title: "" },
    { ...good, by: undefined },
    { ...good, at: 12 },
    { ...good, agent: "yes" },
    { ...good, person: "Mallory" },
    { ...HISTORY[2], wasTitle: undefined },
    { ...edit, changed: [] },
    { ...edit, changed: ["subject", "colour"], wasSubject: undefined },
    { ...edit, wasLabel: "a label that did not change" },
    { ...edit, subject: "N.a" },
    { ...HISTORY[5], id: "l1" },
    { ...HISTORY[5], file: "nothex" },
  ];
  // a part no link has is not carried; the edit stands by the parts it has
  const raw = JSON.parse(JSON.stringify({ libraryHistory: [good, ...bad, { ...edit, changed: ["colour", "subject"] }] }));
  // a field of its own that no step has, even one called __proto__, is not carried
  raw.libraryHistory[0] = JSON.parse(JSON.stringify(good).replace(/^\{/, '{"__proto__":{"polluted":1},"extra":1,'));
  const read = reviewFromJson(raw).libraryHistory!;
  assert.deepEqual(read, [good, edit]);
  assert.deepEqual(Object.keys(read[0]).sort(), Object.keys(good).sort());
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  // what is not a list is no history at all
  assert.ok(!("libraryHistory" in reviewFromJson({ libraryHistory: { 0: good } })));
});

/** Just enough of an element for the drawer: its listeners, and a click on something inside it,
 *  found by the one attribute it carries. */
function drawerEl() {
  const listeners: ((e: unknown) => void)[] = [];
  return {
    innerHTML: "",
    hidden: false,
    textContent: "",
    classList: { toggle: () => {} },
    addEventListener: (_t: string, f: (e: unknown) => void) => listeners.push(f),
    click(attr: string, value: string) {
      const key = attr.replace(/^data-/, "").replace(/-(\w)/g, (_m, c: string) => c.toUpperCase());
      const target = { closest: (sel: string) => (sel === `[${attr}]` ? { dataset: { [key]: value } } : null) };
      for (const f of listeners) f({ target });
    },
  };
}

function activity(d: ReviewData, more: Partial<ActivityHooks> = {}) {
  const el = drawerEl();
  const store = { data: {}, save: () => {} } as unknown as Store;
  const hooks = {
    me: () => "Bob",
    review: () => d,
    has: (n: string) => n === "N.a",
    hasView: () => false,
    ...more,
  } as unknown as ActivityHooks;
  return { el, act: new Activity(el as unknown as HTMLElement, drawerEl() as unknown as HTMLElement, drawerEl() as unknown as HTMLElement, store, hooks) };
}

test("Activity: files are changes and links part of the review, attributed as opinions are, each leading to the file, the link or the declaration while it is there", () => {
  setPeople([{ id: P, name: "Caroline", was: ["Carol"], revoked: null } as never]);
  const opened: string[] = [];
  const { el, act } = activity(library(), { openFile: (sha: string) => opened.push(`file ${sha}`), openLink: (id: string) => opened.push(`link ${id}`) });
  const items = act.items().filter((x) => x.key.startsWith("lb:"));
  assert.equal(items.length, HISTORY.length);
  assert.equal(new Set(act.items().map((x) => x.key)).size, act.items().length, "keys are unique");
  // newest first
  const of = (k: number) => items[HISTORY.length - 1 - k];
  assert.deepEqual(items.map((x) => [x.cat, x.by, x.agent]).reverse(), [
    ["change", "Caroline", false],
    ["change", "Claude", true],
    ["change", "Bob", false],
    ["change", "Claude", true],
    ["change", "Bob", false],
    ["review", "Caroline", false],
    ["review", "Claude", true],
    ["review", "Bob", false],
    ["review", "VisualProof", false],
    ["review", "Bob", false],
    ["review", "Bob", false],
  ]);
  const fileA = `<button class="act-ref" data-act-file="${A}" title="Open Games, Briefly in the reference window">`;
  // a person invited by a personal link under the name they go by now, with its ✓; the title then
  assert.match(of(0).html, /^<b>Caroline<span class="vf"[^]*<\/b> added the paper /);
  assert.ok(of(0).html.endsWith(`${fileA}A Tiny Paper on Games</button> to the library`));
  // an agent's, with its mark
  assert.match(of(1).html, /^<span class="act-agent">[^]*<b>Claude<\/b> <span class="muted">\(agent\)<\/span><\/span> added the image <button class="act-ref" data-act-file="b{64}"[^>]*>Figure 1<\/button> to the library$/);
  assert.ok(of(2).html.endsWith(`renamed the paper <span class="act-gone">A Tiny Paper on Games</span> to ${fileA}Games, Briefly</button>`));
  assert.match(of(3).html, /\(agent\)[^]*archived the image <button[^>]*>Figure 1<\/button>$/);
  assert.match(of(4).html, /^<b>Bob<\/b> restored the image <button[^>]*>Figure 1<\/button>$/);
  // a link removed since is text; the declaration it was on, in the graph, goes to it
  const gone = (label: string) => `<span class="act-gone" title="This link was removed">${label}</span>`;
  const goA = `<button class="act-ref" data-go="N.a" title="N.a">a</button>`;
  assert.match(of(5).html, /^<b>Caroline<span class="vf"/);
  assert.ok(of(5).html.endsWith(`linked ${goA} to ${gone("Theorem 3")} in ${fileA}Games, Briefly</button>`));
  // a cluster in words; a link still there opens the paper at it
  const link2 = `<button class="act-ref" data-act-link="${L2}" title="Open the reference at this link">Section 1</button>`;
  assert.ok(of(6).html.endsWith(`linked namespace N to ${link2} in ${fileA}Games, Briefly</button>`));
  assert.equal(of(7).html, `<b>Bob</b> edited the link ${gone("Thm 3")} on ${goA} <span class="muted">(label was “Theorem 3”, place in the reference changed)</span>`);
  // VisualProof's own carrying, under its name
  assert.equal(of(8).html, `<b>VisualProof</b> carried the link ${link2} from namespace N to namespace M <span class="muted">(namespace renamed)</span>`);
  assert.equal(of(9).html, `<b>Bob</b> removed the link ${gone("Thm 3")} from ${goA}`);
  // a file this server has no record of, a declaration not in the graph: text
  assert.equal(
    of(10).html,
    `<b>Bob</b> linked <span class="act-gone" title="N.zzz: not in the graph now">zzz</span> to <button class="act-ref" data-act-link="${L3}" title="Open the reference at this link">Lemma 2</button> in <span class="act-gone" title="This server has no record of this file">a file</span>`,
  );
  // what "My targets" looks at: the declaration a link is on, never a cluster
  assert.deepEqual([5, 6, 7, 8, 9, 10].map((k) => of(k).names), [["N.a"], [], ["N.a"], [], ["N.a"], ["N.zzz"]]);
  assert.ok([0, 1, 2, 3, 4].every((k) => !of(k).names.length));
  // each leads where it says
  el.click("data-act-file", A);
  el.click("data-act-link", L2);
  assert.deepEqual(opened, [`file ${A}`, `link ${L2}`]);
  // where the page has no reference window, a file and a link are named, not offered
  const plain = activity(library()).act.items().filter((x) => x.key.startsWith("lb:"));
  assert.ok(plain.every((x) => !/data-act-(file|link)/.test(x.html)));
  assert.match(plain[plain.length - 1].html, /added the paper <b>A Tiny Paper on Games<\/b> to the library$/);
});

const agent = (name = "Claude") => ({ "x-visualproof-name": name, "x-visualproof-kind": "agent" });
const person = (name: string) => ({ "x-visualproof-name": encodeURIComponent(name) });

test("the agents' timeline lists files and links, who did what to which, and name= keeps the links on that declaration", async () => {
  const S = await site();
  try {
    const PDF = tinyPdf([["Let G be a game."], ["Theorem 3. Halving undoes doubling."]], "A Tiny Paper on Games");
    const up = await fetch(`${S.base}/api/library/upload?name=paper.pdf`, { method: "POST", headers: person("Alice"), body: new Uint8Array(PDF) });
    const sha = ((await up.json()) as Json).file.sha as string;
    assert.equal((await S.ask("POST", "/api/library/edit", { sha, title: "Games, Briefly" }, person("Bob"))).status, 200);
    const mine = (await S.ask("POST", "/api/agent/link", { subject: "decl(N.a)", file: sha, page: 2, label: "Theorem 3" }, agent())).json!.link;
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "ns(N)", file: sha, page: 1, label: "Section 1" }, person("Alice"))).status, 200);
    assert.equal((await S.ask("POST", "/api/library/link/edit", { id: mine.id, label: "Thm 3" }, person("Bob"))).status, 200);
    assert.equal((await S.ask("POST", "/api/library/unlink", { id: mine.id }, person("Bob"))).status, 200);
    const all = (await S.ask("GET", "/api/agent/activity", undefined, agent())).json!.events as Json[];
    const lib = all.filter((e) => e.kind === "file" || e.kind === "link");
    assert.deepEqual(
      lib.map((e) => [e.kind, e.what, e.by, e.agent]),
      [
        ["file", "added", "Alice", false],
        ["file", "edited", "Bob", false],
        ["link", "made", "Claude", true],
        ["link", "made", "Alice", false],
        ["link", "edited", "Bob", false],
        ["link", "removed", "Bob", false],
      ],
    );
    assert.deepEqual([lib[0].sha, lib[0].title, lib[1].title, lib[1].wasTitle], [sha, "A Tiny Paper on Games", "Games, Briefly", "A Tiny Paper on Games"]);
    assert.deepEqual([lib[4].id, lib[4].subject, lib[4].label, lib[4].file, lib[4].changed, lib[4].wasLabel], [mine.id, "decl(N.a)", "Thm 3", sha, ["label"], "Theorem 3"]);
    assert.deepEqual([lib[5].subject, lib[5].label], ["decl(N.a)", "Thm 3"]);
    // about one declaration: the links on it, not the cluster's
    const onA = (await S.ask("GET", "/api/agent/activity?name=N.a", undefined, agent())).json!.events as Json[];
    assert.deepEqual(onA.filter((e) => e.kind === "link").map((e) => e.what), ["made", "edited", "removed"]);
    assert.ok(!onA.some((e) => e.kind === "file" || e.subject === "ns(N)"));
    // the endpoint reference says so
    const listed = (await S.ask("GET", "/api/agent/endpoints?path=/api/agent/activity", undefined, agent())).json!;
    assert.match(listed.endpoints[0].about, /links made, edited or removed/);
  } finally {
    await S.close();
  }
});

test("Activity: a view renamed says its names; a name taken away says so, the view called by its scope again", () => {
  const { act } = activity(emptyReview(), { scopeTitle: (s: string) => (s === "ns(N)" ? "ns N" : s) } as Partial<ActivityHooks>);
  const at = new Date().toISOString();
  const e = (id: number, name: string | null, was: string | null) => ({ id, at, kind: "view", by: "Alice", what: "renamed", view: "v1", name, was, scope: "ns(N)" });
  act.load([e(1, "Ours", null), e(2, "Theirs", "Ours"), e(3, null, "Theirs")] as never);
  const html = act.items().map((x) => x.html.replace(/<[^>]+>/g, ""));
  assert.ok(html.some((h) => h.includes("Alice renamed a view to Ours")), html.join("\n"));
  assert.ok(html.some((h) => h.includes("Alice renamed the view Ours to Theirs")));
  assert.ok(html.some((h) => h.includes("Alice took the name Theirs off a view, called ns N again")));
});
