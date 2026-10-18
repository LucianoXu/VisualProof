// Notes carry attachments (AttachmentSpec decision 12, the owner's of 2026-10-10): what a note
// carries is checked, kept by every operation and limited; the server takes only files of its
// library; files dropped or pasted make notes of the project by the new-note rule; a clip makes a
// note beside what is selected; Attach… adds to a note; agents give what a note carries at their
// levels.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { noteEndpoints } from "../src/server/agentnotes.ts";
import type { Answer, World } from "../src/server/agent.ts";
import { refusal } from "../src/server/agent.ts";
import { routes, TOOLS } from "../src/server/mcptools.ts";
import { Presence } from "../src/server/presence.ts";
import { Views } from "../src/server/views.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { fileOf } from "../src/shared/library.ts";
import type { FileRecord } from "../src/shared/library.ts";
import { besidePlace, noteBoard, placeIn, spacedPlaces } from "../src/shared/noteplace.ts";
import { applyProjectNoteOp, asProjectNote, asViewNote, invalidProjectNoteOps } from "../src/shared/projectnotes.ts";
import type { ProjectNote } from "../src/shared/projectnotes.ts";
import { applyEvent, emptyReview } from "../src/shared/review.ts";
import { applyNoteOp, carryProblem, cleanCarries, clipNoteText, invalidCarries, invalidNoteOp, MAX_CARRIES, MAX_NOTE_TEXT, withCarry } from "../src/shared/sticky.ts";
import type { NoteCarry, PlaceCluster, StickyNote } from "../src/shared/sticky.ts";
import type { NewEvent, StoredEvent } from "../src/shared/timeline.ts";
import { PROJECT } from "../src/shared/views.ts";
import { notesOfFiles } from "../src/web/src/projectnotes.ts";
import type { Uploaded } from "../src/web/src/library.ts";
import { MAGIC, tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PDF = "a".repeat(64);
const PNG = "b".repeat(64);
const GONE = "c".repeat(64);
const OLD = "d".repeat(64);
const clip = (page = 2): NoteCarry => ({ file: PDF, page, region: [0.1, 0.2, 0.9, 0.4] });
const record = (sha: string, over: Partial<FileRecord> = {}): FileRecord => ({ sha, title: `file ${sha[0]}`, type: "pdf", size: 10, pages: 5, by: "Alice", at: "2026-10-11T09:00:00.000Z", ...over });
/** The library as the server checks a carry against it: a PDF of five pages, an image, an archived PDF. */
const LIB: Record<string, FileRecord> = { [PDF]: record(PDF), [PNG]: record(PNG, { type: "png", pages: undefined }), [OLD]: record(OLD, { archived: { by: "Bob", at: "2026-10-11T09:30:00.000Z" } }) };
const pnote = (id: string, over: Partial<ProjectNote> = {}): ProjectNote => ({ id, text: `note ${id}`, places: {}, open: true, by: "Alice", at: "2026-10-11T10:00:00.000Z", ...over });

test("what a note carries is checked: files of the library by hash, a clip with its page, at most 8, none twice", () => {
  assert.equal(MAX_CARRIES, 8);
  assert.equal(invalidCarries(undefined), null);
  assert.equal(invalidCarries([{ file: PNG }, { file: PDF }, clip(), clip(3), { file: PDF, page: 4 }]), null);
  for (const bad of [{}, "x", [{ file: "x" }], [{ file: PDF, page: 0 }], [{ file: PDF, page: 1.5 }], [{ file: PDF, page: 2, region: [0.5, 0.2, 0.4, 0.4] }], [{ file: PDF, page: 2, region: [0, 0, 1] }], [{ file: PDF, page: 2, region: [0, 0, 1, 2] }]])
    assert.notEqual(invalidCarries(bad), null, JSON.stringify(bad));
  assert.match(invalidCarries([{ file: PDF, region: [0.1, 0.1, 0.5, 0.5] }])!, /comes with the page/, "a clip is a region of a page");
  assert.match(invalidCarries([clip(), clip()])!, /once/, "the same clip twice");
  assert.match(invalidCarries(Array.from({ length: 9 }, (_, k) => clip(k + 1)))!, /at most 8/);
  // what a record keeps of it: the fields a carry has, a list of its own
  const raw = [{ file: PDF, page: 2, region: [0.1, 0.2, 0.9, 0.4], extra: true }];
  const kept = cleanCarries(raw).carries!;
  assert.deepEqual(kept, [clip()]);
  assert.notEqual(kept[0].region, raw[0].region);
  // against the library: a file it has, not archived; an image whole; a page the PDF has
  assert.equal(carryProblem(clip(), LIB[PDF]), null);
  assert.equal(carryProblem({ file: PNG }, LIB[PNG]), null);
  assert.match(carryProblem({ file: GONE }, null)!, /no file/);
  assert.match(carryProblem({ file: OLD }, LIB[OLD])!, /archived/);
  assert.match(carryProblem({ file: PNG, page: 1, region: [0, 0, 1, 1] }, LIB[PNG])!, /image/);
  assert.match(carryProblem(clip(6), LIB[PDF])!, /5 pages/);
});

test("an edit gives a note what it carries, the whole list; moving, opening and making it the other kind keep it", () => {
  const notes: ProjectNote[] = [];
  assert.ok(applyProjectNoteOp(notes, { op: "pnote", note: pnote("n1", { carries: [{ file: PNG }], places: { namespace: { ring: 30 } } }) }));
  // what it carries changed, its text the same: an edit, stamped
  assert.equal(invalidProjectNoteOps([{ op: "pnote-edit", id: "n1", text: "note n1", carries: [{ file: PNG }, clip()] }]), null);
  assert.ok(applyProjectNoteOp(notes, { op: "pnote-edit", id: "n1", text: "note n1", carries: [{ file: PNG }, clip()], by: "Bob", at: "2026-10-11T11:00:00.000Z" }));
  assert.deepEqual([notes[0].carries, notes[0].edited?.by], [[{ file: PNG }, clip()], "Bob"]);
  assert.equal(applyProjectNoteOp(notes, { op: "pnote-edit", id: "n1", text: "note n1", carries: [{ file: PNG }, clip()] }), false, "the same: nothing changes");
  // its text alone: what it carries stays
  applyProjectNoteOp(notes, { op: "pnote-edit", id: "n1", text: "words" });
  assert.equal(notes[0].carries?.length, 2);
  // moved, collapsed: kept
  applyProjectNoteOp(notes, { op: "pnote-move", id: "n1", mode: "module", place: { ring: 90 } });
  applyProjectNoteOp(notes, { op: "pnote-open", id: "n1", open: false });
  assert.equal(notes[0].carries?.length, 2);
  // made a view's own and the project's again: kept, a list of its own each time
  const place = { mode: "namespace" as const, in: [], world: [0, 0] as [number, number] };
  const v = asViewNote(notes[0], place);
  assert.deepEqual(v.carries, notes[0].carries);
  assert.notEqual(v.carries, notes[0].carries);
  assert.deepEqual(asProjectNote(v, "namespace", { ring: 0 }).carries, notes[0].carries);
  // nothing, taken off
  applyProjectNoteOp(notes, { op: "pnote-edit", id: "n1", text: "words", carries: [] });
  assert.equal("carries" in notes[0], false);
  // refused: more than a note carries, the same twice
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote-edit", id: "n1", text: "x", carries: Array.from({ length: 9 }, (_, k) => clip(k + 1)) }]), null);
  assert.notEqual(invalidProjectNoteOps([{ op: "pnote", note: pnote("n2", { carries: [{ file: PNG }, { file: PNG }] }) }]), null);
  // a view's own note likewise
  const vs: StickyNote[] = [{ id: "v1", text: "t", place, open: true, by: "A", at: "" }];
  assert.equal(invalidNoteOp({ op: "note-edit", id: "v1", text: "t", carries: [clip()] }), null);
  assert.ok(applyNoteOp(vs, { op: "note-edit", id: "v1", text: "t", carries: [clip()] }));
  assert.deepEqual(vs[0].carries, [clip()]);
  assert.notEqual(invalidNoteOp({ op: "note-edit", id: "v1", text: "t", carries: [{ file: "nope" }] }), null);
});

/** A server's views with a library to check carries against, and the timeline they write. */
function views(dir: string, lib: Record<string, FileRecord> = LIB) {
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events.at(-1)!) };
  const v = new Views(dir, LAYOUT_VERSION, () => {}, timeline);
  v.carriedFile = (sha) => lib[sha] ?? null;
  const ask = (path: string, body: unknown, name: string | null = "Alice") => v.handle({ method: "POST", path, query: new URLSearchParams(), body, caller: { name, kind: "person" } } as never, "full");
  return { v, events, ask };
}

test("the server takes what a note is to carry from its library alone: a file it has, not archived; what a note carries already stays", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-carry-"));
  try {
    const S = views(dir);
    const refused = (ops: unknown, why: RegExp) => {
      const r = S.ask("/api/views/notes", { ops });
      assert.equal(r.status, 400, JSON.stringify(ops));
      assert.match((r.body as Json).error, why);
    };
    refused([{ op: "pnote", note: pnote("n1", { carries: [{ file: GONE }] }) }], /no file/);
    refused([{ op: "pnote", note: pnote("n1", { carries: [{ file: OLD }] }) }], /archived/);
    refused([{ op: "pnote", note: pnote("n1", { carries: [clip(9)] }) }], /5 pages/);
    assert.equal(S.v.book.notes.length, 0, "nothing refused was taken");
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote", note: pnote("n1", { carries: [clip()] }) }] }).status, 200);
    // the file archived since: an edit of the text keeps the clip; a new carry of it is refused
    LIB[PDF].archived = { by: "Bob", at: "2026-10-11T12:00:00.000Z" };
    try {
      assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-edit", id: "n1", text: "still here", carries: [clip()] }] }, "Bob").status, 200);
      refused([{ op: "pnote-edit", id: "n1", text: "still here", carries: [clip(), clip(3)] }], /archived/);
    } finally {
      delete LIB[PDF].archived;
    }
    // what it carries changed is an edit of the note, under who changed it; Detach is one too
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-edit", id: "n1", text: "still here", carries: [clip(), { file: PNG }] }] }, "Carol").status, 200);
    assert.equal(S.ask("/api/views/notes", { ops: [{ op: "pnote-edit", id: "n1", text: "still here", carries: [{ file: PNG }] }] }, "Dave").status, 200);
    assert.deepEqual(
      S.events.filter((e) => e.kind === "note").map((e) => [(e as Json).what, (e as Json).by]),
      [["created", "Alice"], ["edited", "Bob"], ["edited", "Carol"], ["edited", "Dave"]],
    );
    assert.deepEqual(S.v.book.notes[0].carries, [{ file: PNG }]);
    // a view's own note, by the view's operations, likewise
    const place = { mode: "namespace" as const, in: [], world: [0, 0] as [number, number] };
    const err = S.v.arrange(PROJECT, [{ op: "note", note: { id: "v1", text: "mine", place, open: true, by: "A", at: "", carries: [{ file: GONE }] } }], null, "Alice");
    assert.match(err ?? "", /no file/);
    assert.equal(S.v.arrange(PROJECT, [{ op: "note", note: { id: "v1", text: "mine", place, open: true, by: "A", at: "", carries: [{ file: PNG }] } }], null, "Alice"), null);
    assert.deepEqual(S.v.book.get(PROJECT)!.notes![0].carries, [{ file: PNG }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Four declarations: namespaces N.A (t, d) and N.B (e, x), and one at the top level, laid out by hand. */
const NODES: ViewNode[] = [
  { name: "N.A.t", kind: "theorem", module: "N.A", ax: 0 },
  { name: "N.A.d", kind: "def", module: "N.C", ax: 0 },
  { name: "N.B.e", kind: "def", module: "N.A", ax: 0 },
  { name: "N.B.x", kind: "def", module: "N.C", ax: 0 },
  { name: "top", kind: "def", module: "Top", ax: 0 },
];
function layout(clusters: [string, number, number, number, number][], cluster: number[]): Layout {
  const depth = (c: number): number => (clusters[c][1] < 0 ? 0 : depth(clusters[c][1]) + 1);
  return { x: [], y: [], lx: [], ly: [], cluster, clusters: clusters.map(([key, parent, x, y, r], c) => ({ key, label: key, parent, depth: depth(c), x, y, lx: 0, ly: 0, r, count: 0, ext: false })) };
}
const WHOLE = layout([["N", -1, 0, 0, 100], ["N.A", 0, 30, 0, 40], ["N.B", 0, -40, 0, 30]], [1, 1, 2, 2, -1]);
const drawn = (L: Layout): PlaceCluster[] => L.clusters.map((c) => ({ key: c.key, parent: c.parent, depth: c.depth, x: c.x, y: c.y, r: c.r, open: true }));

test("files dropped at once make notes of the project, each carrying its file, by the new-note rule and spaced apart; a file refused makes none", async () => {
  const nb = noteBoard(WHOLE, "namespace", NODES);
  // dropped in N.A: the first where a new note there goes, the others beside it in N.A, inside it
  const first = placeIn([40, 0], drawn(WHOLE), nb)!;
  const spaced = spacedPlaces(first, [40, 0], 3, 15, drawn(WHOLE), nb);
  assert.deepEqual(spaced.map((p) => ("in" in p ? p.in[0] : null)), [["N.A", 0.25, 0], ["N.A", 0.625, 0], ["N.A", 1, 0]]);
  // dropped where no cluster is: all at the ring's angle, which spreads them as every note on it
  assert.deepEqual(spacedPlaces({ ring: 45 }, [500, 0], 2, 15, drawn(WHOLE), nb), [{ ring: 45 }, { ring: 45 }]);
  // each file added to the library, then a note carrying it, its title as its text
  const said: string[] = [];
  const refusals: string[] = [];
  const written: ProjectNote[] = [];
  const taken: unknown[] = [];
  const answers: Record<string, Uploaded> = {
    "fig.png": { ok: true, file: record(PNG, { title: "fig", type: "png" }), existed: false, change: { rev: 1 } as never },
    "page.html": { ok: false, error: "This is no PDF, PNG, JPEG, WebP or GIF." },
    "paper.pdf": { ok: true, file: record(PDF, { title: "A paper" }), existed: true },
  };
  const files = Object.keys(answers).map((n) => new File(["x"], n));
  const places = spaced.map((place) => ({ mode: "namespace" as ClusterMode, place }));
  const deps = {
    upload: async (f: File) => answers[f.name],
    take: (c: unknown) => void taken.push(c),
    write: async (n: ProjectNote) => (written.push(n), null),
    still: () => true,
    say: (t: string) => void said.push(t),
    refused: (why: string) => void refusals.push(why),
    by: "Alice",
    lost: () => {},
  };
  const made = await notesOfFiles(files, places, deps);
  assert.equal(made.length, 2);
  assert.deepEqual(written.map((n) => [n.text, n.carries, n.places, n.open, n.by]), [
    ["fig", [{ file: PNG }], { namespace: places[0].place }, true, "Alice"],
    ["A paper", [{ file: PDF }], { namespace: places[2].place }, true, "Alice"],
  ]);
  assert.ok(written.every((n) => invalidProjectNoteOps([{ op: "pnote", note: n }]) === null), "a note of the project, as a page writes one");
  assert.equal(taken.length, 1, "the file's record applied at once, before its note");
  assert.ok(said.some((t) => t === "page.html: This is no PDF, PNG, JPEG, WebP or GIF."), "a file refused says why");
  // and is told apart, to be said again with the notes made, which say over it
  assert.deepEqual(refusals, ["page.html: This is no PDF, PNG, JPEG, WebP or GIF."]);
  // a note refused (a preview of a view), or another board shown: no more
  written.length = 0;
  assert.deepEqual(await notesOfFiles(files, places, { ...deps, write: async (n: ProjectNote) => (written.push(n), "refused") }), []);
  assert.equal(written.length, 1);
  assert.deepEqual(await notesOfFiles(files, places, { ...deps, still: () => false }), []);
});

test("Clip to a note: beside the declaration selected, in its cluster, or on the ring at the top level; its text the label, or the text selected", () => {
  const nb = noteBoard(WHOLE, "namespace", NODES);
  // beside N.B.e, a little up and to the right of where it is: in N.B and N around it
  const p = besidePlace(2, [-30, -10], drawn(WHOLE), nb)!;
  assert.deepEqual(p, { in: [["N.B", 0.333, -0.333], ["N", -0.3, -0.1]] });
  // folded or a speck on the screen, it is still its cluster (the page's highlight takes none such)
  assert.deepEqual(besidePlace(2, [-30, -10], drawn(WHOLE).map((c) => ({ ...c, open: false })), nb), p);
  // a declaration at the top level: none, for the page to put it on the ring
  assert.equal(besidePlace(4, [0, 0], drawn(WHOLE), nb), null);
  // a hidden level: in the circle drawn around it
  const nodes = NODES.slice(0, 4);
  const hidden = computeLayout("namespace", nodes, new Int32Array(0), ["N.A"]);
  const nh = noteBoard(hidden, "namespace", nodes);
  const ph = besidePlace(0, [hidden.clusters[0].x, hidden.clusters[0].y], drawn(hidden), nh)!;
  assert.deepEqual("in" in ph ? ph.in.map((e) => e[0]) : null, ["N"]);
  // the text: what the reader wrote in the field; left as it came, the quote in full, else the label
  assert.equal(clipNoteText("Theorem 8", "p. 10 “Let A be…”", "Let A be an adversary", 10), "Theorem 8");
  assert.equal(clipNoteText(" p. 10 “Let A be…” ", "p. 10 “Let A be…”", "Let A be an adversary", 10), "“Let A be an adversary” — p. 10");
  assert.equal(clipNoteText("p. 3", "p. 3", null, 3), "p. 3");
  assert.equal(clipNoteText("", "p. 3", null, 3), "p. 3");
  assert.equal(clipNoteText("", "p. 3", "x".repeat(3000), 3).length, MAX_NOTE_TEXT);
});

test("Attach… adds a file or a clip to a note once, within what a note carries; the page's edit is taken", async () => {
  assert.deepEqual(withCarry(undefined, { file: PNG }), [{ file: PNG }]);
  assert.deepEqual(withCarry([{ file: PNG }], clip()), [{ file: PNG }, clip()]);
  assert.match(withCarry([{ file: PNG }, clip()], clip()) as string, /already/);
  assert.match(withCarry(Array.from({ length: 8 }, (_, k) => clip(k + 1)), { file: PNG }) as string, /at most 8/);
  // on a live server: a PDF and an image added, a note written, then each attached by an edit
  const S = await site();
  try {
    const as = { "x-visualproof-name": "Alice" };
    const up = async (bytes: Buffer, name: string) => (await fetch(`${S.base}/api/library/upload?name=${name}`, { method: "POST", headers: as, body: new Uint8Array(bytes) })).json() as Promise<Json>;
    const pdf = (await up(tinyPdf([["Theorem 1. A line."], ["Page two."]]), "paper.pdf")).file.sha as string;
    const png = (await up(MAGIC.png, "fig.png")).file.sha as string;
    const notes = (ops: unknown, name = "Alice") => S.ask("POST", "/api/views/notes", { ops }, { "x-visualproof-name": name });
    assert.equal((await notes([{ op: "pnote", note: pnote("n1", { text: "look" }) }])).status, 200);
    const n = () => S.live.views.book.notes.find((x) => x.id === "n1")!;
    for (const c of [{ file: png }, { file: pdf, page: 2, region: [0, 0.1, 1, 0.3] }]) {
      const next = withCarry(n().carries, c as NoteCarry) as NoteCarry[];
      const r = await notes([{ op: "pnote-edit", id: "n1", text: n().text, carries: next }], "Bob");
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    assert.deepEqual(n().carries, [{ file: png }, { file: pdf, page: 2, region: [0, 0.1, 1, 0.3] }]);
    assert.equal(n().edited?.by, "Bob");
    // a page beyond the paper's, a file the library has not: refused, said why
    const bad = await notes([{ op: "pnote-edit", id: "n1", text: "look", carries: [{ file: pdf, page: 3, region: [0, 0, 1, 1] }] }]);
    assert.equal(bad.status, 400);
    assert.match(bad.json!.error, /2 pages/);
    assert.equal((await notes([{ op: "pnote-edit", id: "n1", text: "look", carries: [{ file: GONE }] }])).status, 400);
    assert.equal(fileOf(S.live.review.data, png)?.type, "png");
  } finally {
    await S.close();
  }
});

/** The agents' notes on a small project with a library, as the server lays it out. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "vp-carry-agents-"));
  const nodes = NODES.slice(0, 4).map((n) => ({ ...n, hash: `h-${n.name}` }));
  const edges = new Int32Array([0, 1, SITE_STMT, 2, 3, SITE_STMT]);
  const meta = {
    schema: 1, layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["N"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [], nodes, projectCount: nodes.length, axioms: [], axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 2,
  } as ViewMeta;
  // the library's records, as the review's logs give them
  const review = emptyReview();
  for (const f of [LIB[PDF], LIB[PNG]]) applyEvent(review, { op: "file", sha: f.sha, title: f.title, type: f.type, size: f.size, ...(f.pages ? { pages: f.pages } : {}), at: f.at, by: f.by });
  const events: StoredEvent[] = [];
  const timeline = { events, add: (e: NewEvent) => (events.push({ ...e, id: events.length + 1, at: new Date().toISOString() } as StoredEvent), events.at(-1)!) };
  const views = new Views(dir, LAYOUT_VERSION, () => {}, timeline);
  views.carriedFile = (sha) => fileOf(review, sha);
  const w = {
    project: { root: dir, files: new Map(), toolchain: "tc" },
    graph: { version: 1, prep: { metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } },
    review: { data: review, append: () => ({ status: 403, error: "not here" }) },
    timeline, places: views.places, presence: new Presence(() => {}), placesChanged: () => {}, views,
  } as unknown as World;
  const ask = (level: "read" | "advise" | "full", path: string, params: Json, name = "Claude"): Answer => {
    const e = noteEndpoints(w, (_c, need) => refusal(level, need)).find((x) => x.method === "POST" && x.path === path)!;
    return e.run({ method: "POST", path, query: new URLSearchParams(), body: params, caller: { name, kind: "agent" } } as never) as Answer;
  };
  return { views, events, ask, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("agents write and edit what a note carries: their own at advise, anyone's at full, checked against the library", () => {
  const W = world();
  try {
    const body = (a: Answer) => a.body as Json;
    // written with a clip and an image, the image by its hash alone; told back with what each is
    const made = W.ask("advise", "/api/agent/note", { cluster: "N.A", text: "Theorem 8 here", carries: [clip(), PNG] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.deepEqual(body(made).carries.map((c: Json) => [c.what, c.title, c.page ?? null]), [["clip", "file a", 2], ["image", "file b", null]]);
    assert.deepEqual(W.views.book.notes[0].carries, [clip(), { file: PNG }]);
    // a view's own note too
    const own = W.ask("advise", "/api/agent/note", { view: PROJECT, at: [0, 0], text: "mine", carries: [{ file: PDF }] });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(W.views.book.get(PROJECT)!.notes![0].carries, [{ file: PDF }]);
    // refused: a file the library has not, a clip with no page, more than a note carries; a read token
    assert.equal(W.ask("advise", "/api/agent/note", { cluster: "N.A", text: "x", carries: [{ file: GONE }] }).status, 400);
    assert.match(body(W.ask("advise", "/api/agent/note", { cluster: "N.A", text: "x", carries: [{ file: PDF, region: [0, 0, 1, 1] }] })).error, /page/);
    assert.equal(W.ask("advise", "/api/agent/note", { cluster: "N.A", text: "x", carries: Array.from({ length: 9 }, (_, k) => clip(k + 1)) }).status, 400);
    assert.equal(W.ask("read", "/api/agent/note", { cluster: "N.A", text: "x", carries: [{ file: PNG }] }).status, 403);
    // its own note's at advise: the whole list; its text as it was
    const id = body(made).id;
    const ed = W.ask("advise", "/api/agent/note/edit", { id, carries: [{ file: PNG }] });
    assert.equal(ed.status, 200, JSON.stringify(ed.body));
    assert.deepEqual([W.views.book.notes[0].carries, W.views.book.notes[0].text], [[{ file: PNG }], "Theorem 8 here"]);
    assert.deepEqual(W.events.filter((e) => e.kind === "note").map((e) => (e as Json).what), ["created", "created", "edited"]);
    // someone else's: at full only
    W.views.arrangeNotes([{ op: "pnote", note: pnote("nAlice") }], null, "Alice");
    assert.equal(W.ask("advise", "/api/agent/note/edit", { id: "nAlice", carries: [{ file: PNG }] }).status, 403);
    assert.equal(W.ask("full", "/api/agent/note/edit", { id: "nAlice", carries: [{ file: PNG }] }).status, 200);
    assert.deepEqual(W.views.book.notes.find((n) => n.id === "nAlice")!.carries, [{ file: PNG }]);
    // the MCP tools give it
    assert.ok(TOOLS.find((t) => t.name === "notes")?.args.carries);
    for (const action of ["write", "edit"]) assert.ok(routes().find((r) => r.tool === "notes" && r.action === action)?.args.includes("carries"), action);
  } finally {
    W.done();
  }
});
