// The library and its links (AttachmentSpec decisions 1–10): a file's type read from its bytes, the
// bytes kept once by their hash within the library's limits; records and links as events of the
// review's logs, attributed as opinions are; archiving, restoring, and a file this server lacks;
// poppler's words, pages and clips; links carried by moves and by a cluster a build renamed, and
// left for the lost-and-found otherwise; what the reference window opens beside a source; links
// refused on a past board.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyLibrary, clusterChain, declSubject, defaultLabel, findQuote, linkOffer, linksOf, MAX_FILE, pairedLinks, PAST_LINK, quoteAt, sniffType } from "../src/shared/library.ts";
import type { LibraryEvent, Link } from "../src/shared/library.ts";
import { lostEntries } from "../src/shared/lostfound.ts";
import { applyEvent, emptyReview, logFileName, readEvent } from "../src/shared/review.ts";
import type { ReviewData, ReviewEvent } from "../src/shared/review.ts";
import type { SnapGraph } from "../src/server/history.ts";
import { carryClusterLinks, clusterMovedTo, Library } from "../src/server/library.ts";
import { PdfReader, usefulTitle } from "../src/server/poppler.ts";
import { ReviewStore, SERVER_LOG } from "../src/server/review.ts";
import { MAGIC, tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";

const PDF = tinyPdf([["Let G be a game between an adversary and a challenger.", "The advantage is small."], ["Theorem 3. Halving undoes doubling.", "Proof by induction on n."]], "A Tiny Paper on Games");
const by = (name: string, more: Record<string, string> = {}) => ({ "x-visualproof-name": encodeURIComponent(name), ...more });

/** Upload bytes through the page's route, as a person (or, with kind, an agent by its headers). */
async function upload(base: string, bytes: Buffer, name: string | null, query = "name=paper.pdf") {
  const r = await fetch(`${base}/api/library/upload?${query}`, { method: "POST", headers: name ? by(name) : {}, body: new Uint8Array(bytes) });
  return { status: r.status, json: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("a file's type is read from its bytes: PDF, PNG, JPEG, WebP, GIF; never SVG, nor a page a server answered instead", () => {
  assert.equal(sniffType(PDF), "pdf");
  // a few bytes before the header, as readers accept
  assert.equal(sniffType(Buffer.concat([Buffer.from("\n\n"), PDF])), "pdf");
  assert.equal(sniffType(MAGIC.png), "png");
  assert.equal(sniffType(MAGIC.jpeg), "jpeg");
  assert.equal(sniffType(MAGIC.gif), "gif");
  assert.equal(sniffType(MAGIC.webp), "webp");
  assert.equal(sniffType(MAGIC.svg), null);
  assert.equal(sniffType(MAGIC.html), null);
  assert.equal(sniffType(Buffer.alloc(0)), null);
});

test("the library keeps a file once by its hash, at most 50 MB a file, within its limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-lib-"));
  try {
    const lib = new Library(dir, dir);
    const a = lib.put(PDF);
    assert.ok("sha" in a && a.fresh && a.type === "pdf");
    const again = lib.put(Buffer.from(PDF));
    assert.ok("sha" in again && !again.fresh && again.sha === (a as { sha: string }).sha);
    assert.deepEqual(readdirSync(join(dir, "files")), [(a as { sha: string }).sha]);
    assert.equal(lib.used(), PDF.length);
    // what is not a PDF or an image, an empty file, a file too large
    assert.equal((lib.put(MAGIC.svg) as { status: number }).status, 415);
    assert.equal((lib.put(Buffer.alloc(0)) as { status: number }).status, 400);
    const big = Buffer.alloc(MAX_FILE + 1);
    PDF.copy(big);
    assert.equal((lib.put(big) as { status: number }).status, 413);
    // the bytes of a file a link names, and no other
    assert.equal((lib.put(Buffer.concat([MAGIC.png, Buffer.from("x")]), "0".repeat(64)) as { status: number }).status, 409);
    // the library's limit
    lib.limit = PDF.length + 10;
    const over = lib.put(Buffer.concat([MAGIC.png, Buffer.alloc(64)]));
    assert.equal((over as { status: number }).status, 507);
    assert.match((over as { error: string }).error, /does not fit/);
    // purged from the command line: the bytes go, nothing else
    assert.ok(lib.purge((a as { sha: string }).sha));
    assert.ok(!lib.has((a as { sha: string }).sha));
    assert.equal(lib.used(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adding a file records it under its adder's name, its title the PDF's own; the same bytes again add nothing", async () => {
  const S = await site();
  try {
    const nameless = await upload(S.base, PDF, null);
    assert.equal(nameless.status, 401);
    const r = await upload(S.base, PDF, "Alice");
    assert.equal(r.status, 200);
    assert.equal(r.json.existed, false);
    assert.equal(r.json.file.title, "A Tiny Paper on Games");
    assert.equal(r.json.file.pages, 2);
    assert.equal(r.json.file.name, "paper.pdf");
    assert.ok(r.json.change, "the change, for the page to apply at once");
    const sha = r.json.file.sha;
    const log = readFileSync(join(S.dir, "review", "log", logFileName("Alice", false)), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(log.map((e) => e.op), ["file"]);
    assert.equal(log[0].sha, sha);
    assert.equal(log[0].by, "Alice");
    assert.equal(log[0].type, "pdf");
    // the bytes are in the state, not in the review folder
    assert.ok(existsSync(join(S.dir, "state", "files", sha)));
    assert.ok(!readdirSync(join(S.dir, "review")).some((f) => f.includes(sha)));
    // the same bytes again, by someone else: the file as it is, nothing written
    const again = await upload(S.base, PDF, "Bob", "name=copy.pdf");
    assert.equal(again.json.existed, true);
    assert.ok(!existsSync(join(S.dir, "review", "log", logFileName("Bob", false))));
    // an SVG is refused, whatever its name says
    assert.equal((await upload(S.base, MAGIC.svg, "Alice", "name=paper.pdf")).status, 415);
    // the list, and the bytes behind the page's access check, sent as what they are
    const list = await S.ask("GET", "/api/library");
    assert.equal(list.json!.files.length, 1);
    assert.equal(list.json!.files[0].have, true);
    const f = await fetch(`${S.base}/api/library/file?sha=${sha}`);
    assert.equal(f.headers.get("content-type"), "application/pdf");
    assert.equal(f.headers.get("x-content-type-options"), "nosniff");
    assert.match(f.headers.get("content-security-policy") ?? "", /sandbox/);
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), PDF);
  } finally {
    await S.close();
  }
});

test("a PDF's own title is its title where it says something: not a file's name, a placeholder or only an identifier, where the file's name is used", async () => {
  for (const t of ["1910.09336", "1910.09336v2", "arXiv:1910.09336v2", "arXiv:1910.09336v2 [cs.LO]", "math/0211159v1", "math.GT/0309136", "hep-th/9901001", "10.1145/3133956.3134034", "doi:10.1007/978-3-030-17659-4_9", "https://doi.org/10.1145/3133956", "Untitled", "Microsoft Word - draft.docx", "main.tex", " ", null])
    assert.equal(usefulTitle(t), null, String(t));
  for (const t of ["The Lean Mathematical Library", "2001: A Space Odyssey", "On arXiv:1910.09336 and its Errata", "The 10.1145 Bug"]) assert.equal(usefulTitle(t), t);
  assert.equal(usefulTitle("  Spaced\n  Out  "), "Spaced Out");
  // an upload whose PDF calls itself by its arXiv identifier: titled by its file's name, as one without a title
  const S = await site();
  try {
    const r = await upload(S.base, tinyPdf([["A paper titled by its identifier."]], "arXiv:1910.09336v2"), "Alice", `name=${encodeURIComponent("Lean Library.pdf")}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.file.title, "Lean Library");
  } finally {
    await S.close();
  }
});

test("a file's title edited; archived and restored, as nothing is deleted; a file this server lacks says so and takes only bytes of its hash", async () => {
  const S = await site();
  try {
    const sha = (await upload(S.base, PDF, "Alice")).json.file.sha;
    const edit = await S.ask("POST", "/api/library/edit", { sha, title: "Games, Briefly" }, by("Bob"));
    assert.equal(edit.json!.file.title, "Games, Briefly");
    assert.equal(edit.json!.file.edited.by, "Bob");
    const arch = await S.ask("POST", "/api/library/archive", { sha }, by("Bob"));
    assert.equal(arch.status, 200);
    let list = await S.ask("GET", "/api/library");
    assert.equal(list.json!.files.length, 0);
    assert.equal(list.json!.archived[0].archived.by, "Bob");
    // no link to an archived file
    const no = await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha, page: 1 }, by("Alice"));
    assert.equal(no.status, 409);
    // added again, it is restored
    const back = await upload(S.base, PDF, "Carol");
    assert.equal(back.json.restored, true);
    list = await S.ask("GET", "/api/library");
    assert.equal(list.json!.files.length, 1);
    // the owner purges its bytes (visualproof purge-file): its record stays, saying so
    assert.ok(S.live.library.purge(sha));
    list = await S.ask("GET", "/api/library");
    assert.equal(list.json!.files[0].have, false);
    const gone = await S.ask("GET", `/api/library/file?sha=${sha}`);
    assert.equal(gone.status, 404);
    assert.equal(gone.json!.missing, true);
    // only bytes of that hash fill the gap
    const other = tinyPdf([["Another paper."]]);
    assert.equal((await upload(S.base, other, "Alice", `name=x.pdf&sha=${sha}`)).status, 409);
    const fill = await upload(S.base, PDF, "Alice", `name=x.pdf&sha=${sha}`);
    assert.equal(fill.status, 200);
    assert.equal(fill.json.filled, true);
    assert.ok(S.live.library.has(sha));
  } finally {
    await S.close();
  }
});

test("links: made, edited and removed by events of the review, attributed as opinions are; a subject the graph has, a place in the file", async () => {
  const S = await site({ agents: "advise" });
  try {
    const sha = (await upload(S.base, PDF, "Alice")).json.file.sha;
    const quote = { text: "Halving undoes doubling.", before: "Theorem 3." };
    const made = await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha, page: 2, quote, region: [0.1, 0.05, 0.6, 0.1] }, by("Alice"));
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const l = made.json!.link;
    assert.match(l.id, /^l[0-9a-f]{12}$/);
    // the label by default: the page and the quote's first words
    assert.equal(l.label, "p. 2 “Halving undoes doubling.”");
    assert.equal(l.by, "Alice");
    assert.deepEqual(l.region, [0.1, 0.05, 0.6, 0.1]);
    // a cluster, by namespace and by file
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "ns(N)", file: sha, page: 1, label: "Section 1" }, by("Bob"))).status, 200);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "file(M)", file: sha, page: 1 }, by("Bob"))).status, 200);
    // what is refused: a name the graph lacks, a cluster it lacks, no page in a PDF, a region upside
    // down, an image's page
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "decl(N.zzz)", file: sha, page: 1 }, by("Alice"))).status, 404);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "ns(Nope)", file: sha, page: 1 }, by("Alice"))).status, 404);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "N.a", file: sha, page: 1 }, by("Alice"))).status, 400);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha }, by("Alice"))).status, 400);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha, page: 3 }, by("Alice"))).status, 400);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha, page: 1, region: [0.5, 0.5, 0.2, 0.9] }, by("Alice"))).status, 400);
    // edited by someone else, and the review says who
    const ed = await S.ask("POST", "/api/library/link/edit", { id: l.id, label: "Theorem 3, p. 2" }, by("Bob"));
    assert.equal(ed.json!.link.label, "Theorem 3, p. 2");
    assert.equal(ed.json!.link.edited.by, "Bob");
    // an agent at level advise adds links, and changes its own alone
    const agent = by("Claude", { "x-visualproof-kind": "agent" });
    const mine = await S.ask("POST", "/api/library/link", { subject: "decl(N.b)", file: sha, page: 1, quote: "Let G be a game" }, agent);
    assert.equal(mine.status, 200);
    assert.equal(mine.json!.link.agent, true);
    assert.equal((await S.ask("POST", "/api/library/link/edit", { id: mine.json!.link.id, label: "The game" }, agent)).status, 200);
    const theirs = await S.ask("POST", "/api/library/unlink", { id: l.id }, agent);
    assert.equal(theirs.status, 403);
    assert.match(theirs.json!.error, /level full/);
    // removed by a person
    assert.equal((await S.ask("POST", "/api/library/unlink", { id: l.id }, by("Carol"))).status, 200);
    const d = S.live.review.data;
    assert.equal(linksOf(d, "decl(N.a)").length, 0);
    assert.equal(linksOf(d, "decl(N.b)")[0].label, "The game");
    // the logs: each writer's events in their own file, the agent's marked
    const lines = (who: string, agentLog = false) => readFileSync(join(S.dir, "review", "log", logFileName(who, agentLog)), "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.deepEqual(lines("Alice").map((e) => e.op), ["file", "link"]);
    assert.deepEqual(lines("Bob").map((e) => e.op), ["link", "link", "link-edit"]);
    assert.deepEqual(lines("Carol").map((e) => e.op), ["unlink"]);
    assert.ok(lines("Claude", true).every((e) => e.agent === true));
    // the review replayed from the logs alone is the same
    const again = new ReviewStore(S.dir, join(S.dir, "review"));
    assert.deepEqual(JSON.parse(JSON.stringify(again.data.links)), JSON.parse(JSON.stringify(d.links)));
    assert.equal(again.problems.length, 0);
  } finally {
    await S.close();
  }
});

test("a page's text with the place of every word, a search through the file, a page and a clip as images", async () => {
  const S = await site();
  try {
    const sha = (await upload(S.base, PDF, "Alice")).json.file.sha;
    const t = await S.ask("GET", `/api/library/text?sha=${sha}&page=2`);
    assert.equal(t.status, 200);
    assert.equal(t.json!.pages, 2);
    assert.match(t.json!.text, /^Theorem 3\. Halving undoes doubling\.\nProof by induction on n\.$/);
    const w = t.json!.words[0];
    assert.equal(w[0], "Theorem");
    // in the page's fractions: 72 pt from the left of a 612 pt page
    assert.ok(Math.abs(w[1] - 72 / 612) < 0.01 && w[2] > 0 && w[2] < 0.15 && w[3] > w[1] && w[4] > w[2]);
    const s = await S.ask("GET", `/api/library/search?sha=${sha}&q=${encodeURIComponent("adversary and a")}`);
    assert.equal(s.json!.matches.length, 1);
    assert.equal(s.json!.matches[0].page, 1);
    assert.equal(s.json!.matches[0].boxes.length, 3);
    const png = (b: Buffer) => b.subarray(0, 8).equals(MAGIC.png.subarray(0, 8));
    const page = await fetch(`${S.base}/api/library/page?sha=${sha}&page=1&width=400`);
    assert.equal(page.headers.get("content-type"), "image/png");
    assert.ok(png(Buffer.from(await page.arrayBuffer())));
    const clip = await fetch(`${S.base}/api/library/clip?sha=${sha}&page=1&region=0.1,0.05,0.9,0.15&width=800`);
    assert.equal(clip.status, 200);
    assert.ok(png(Buffer.from(await clip.arrayBuffer())));
    // kept by file, page and region
    assert.ok(readdirSync(join(S.live.dirs.cache, "files-cache", sha)).some((f) => f.startsWith("clip-1-")));
    assert.equal((await S.ask("GET", `/api/library/clip?sha=${sha}&page=1&region=0.9,0.1,0.1,0.2`)).status, 400);
    assert.equal((await S.ask("GET", `/api/library/text?sha=${sha}&page=9`)).status, 400);
  } finally {
    await S.close();
  }
});

test("the clips kept of a file are bounded, the oldest going first, a clip asked for again kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-clips-"));
  try {
    const file = join(dir, "paper.pdf");
    writeFileSync(file, PDF);
    const reader = new PdfReader(join(dir, "cache"), 3);
    const size = { w: 612, h: 792 };
    const clip = (k: number) => reader.clip("f".repeat(64), file, 1, size, [0.1, 0.01 * k, 0.5, 0.01 * k + 0.1], 400);
    const kept = () => readdirSync(join(dir, "cache", "f".repeat(64))).filter((f) => f.startsWith("clip-")).sort();
    await clip(1);
    await clip(2);
    await clip(3);
    assert.equal(kept().length, 3);
    // the first asked for again: the second is the oldest now
    await new Promise((ok) => setTimeout(ok, 20));
    await clip(1);
    await new Promise((ok) => setTimeout(ok, 20));
    await clip(4);
    assert.deepEqual(kept(), ["clip-1-0.1_0.01_0.5_0.11-w400.png", "clip-1-0.1_0.03_0.5_0.13-w400.png", "clip-1-0.1_0.04_0.5_0.14-w400.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A review replayed from library events and moves, as the logs give them. */
function replayed(events: unknown[]): ReviewData {
  const d = emptyReview();
  for (const raw of events) {
    const e = readEvent(raw, false);
    assert.ok(e && typeof e !== "string", `readable: ${JSON.stringify(raw)} → ${String(e)}`);
    applyEvent(d, e as ReviewEvent);
  }
  return d;
}

const SHA = "a".repeat(64);
const at = (k: number) => `2026-10-11T10:00:0${k}.000Z`;
const fileEvent = { op: "file", at: at(0), by: "Alice", sha: SHA, title: "A paper", type: "pdf", size: 10, pages: 3 };
const link = (id: string, subject: string, k = 1) => ({ op: "link", at: at(k), by: "Alice", id, subject, file: SHA, page: 1, label: `link ${id}` });

test("a move carries a declaration's links, an un-move takes them back; one whose declaration is gone without a rename is in the lost-and-found", () => {
  const d = replayed([fileEvent, link("l000000000001", "decl(A.f)"), link("l000000000002", "ns(A)", 2), { op: "move", at: at(3), by: "VisualProof", from: "A.f", to: "A.g", on: true, rename: true }]);
  assert.equal(linksOf(d, "decl(A.g)").length, 1);
  assert.deepEqual(linksOf(d, "decl(A.g)")[0].was, ["A.f"]);
  assert.equal(linksOf(d, "decl(A.f)").length, 0);
  applyEvent(d, readEvent({ op: "move", at: at(4), by: "Alice", from: "A.f", to: "A.g", on: false, rename: true }, false) as ReviewEvent);
  assert.equal(linksOf(d, "decl(A.f)").length, 1);
  assert.equal(linksOf(d, "decl(A.f)")[0].was, undefined);
  // gone: listed under the declaration's name, and under the cluster's subject where it is gone
  const lost = lostEntries(d, [], (n) => n === "A.g", () => true, () => null, undefined, undefined, [], (_k, key) => key !== "A");
  assert.deepEqual(
    lost.filter((e) => e.kind === "link").map((e) => [e.key, e.name, e.label, e.fileTitle]),
    [
      ["link:l000000000001", "A.f", "link l000000000001", "A paper"],
      ["link:l000000000002", "ns(A)", "link l000000000002", "A paper"],
    ].sort((a, b) => (a[1] < b[1] ? -1 : 1)),
  );
});

/** A snapshot's graph of the names and modules given, as the history keeps it. */
function snap(id: number, nodes: [string, string][]): SnapGraph {
  return { info: { id } as SnapGraph["info"], modules: [], nodes: nodes.map(([name, module]) => ({ name, module, kind: "def", type: "", ax: [], hash: name })), projectCount: nodes.length, edges: [] };
}

test("a cluster a build renamed as a whole carries its links, by the server's own log; a cluster gone otherwise leaves them for the lost-and-found", () => {
  const before = snap(1, [["Old.f", "P.Old"], ["Old.Sub.g", "P.Old.Sub"], ["Keep.h", "P.Keep"], ["Split.a", "P.Split"], ["Split.b", "P.Split"]]);
  const after = snap(2, [["New.f", "P.New"], ["New.Sub.g", "P.New.Sub"], ["Keep.h", "P.Keep"], ["X.a", "P.X"], ["Y.b", "P.Y"]]);
  const renamed = new Map([["Old.f", "New.f"], ["Old.Sub.g", "New.Sub.g"], ["Split.a", "X.a"], ["Split.b", "Y.b"]]);
  assert.equal(clusterMovedTo(before, after, renamed, "ns", "Old"), "New");
  assert.equal(clusterMovedTo(before, after, renamed, "file", "P.Old"), "P.New");
  // still there; went to two places
  assert.equal(clusterMovedTo(before, after, renamed, "ns", "Keep"), null);
  assert.equal(clusterMovedTo(before, after, renamed, "ns", "Split"), null);
  const dir = mkdtempSync(join(tmpdir(), "vp-carry-"));
  try {
    const store = new ReviewStore(dir, "review");
    const w = { name: "Alice", agent: false };
    const r = (op: object) => store.append(w, { ...op, by: "Alice" } as never, "tc");
    r({ op: "file", sha: SHA, title: "A paper", type: "pdf", size: 10, pages: 3 });
    r({ op: "link", id: "l000000000001", subject: "ns(Old)", file: SHA, page: 1, label: "Section 1" });
    r({ op: "link", id: "l000000000002", subject: "file(P.Old)", file: SHA, page: 2, label: "Section 2" });
    r({ op: "link", id: "l000000000003", subject: "ns(Split)", file: SHA, page: 3, label: "Section 3" });
    assert.equal(carryClusterLinks(store, "tc", before, after, renamed, 2), 2);
    const subjects = store.data.links!.map((l) => l.subject);
    assert.deepEqual(subjects, ["ns(New)", "file(P.New)", "ns(Split)"]);
    assert.equal(store.data.links![0].edited?.by, "VisualProof");
    // in the server's own log, saying why; read back as such
    const lines = readFileSync(join(dir, "review", "log", SERVER_LOG), "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.deepEqual(lines.map((e) => [e.op, e.subject, e.auto, e.snap]), [["link-edit", "ns(New)", "namespace renamed", 2], ["link-edit", "file(P.New)", "folder renamed", 2]]);
    assert.equal(new ReviewStore(dir, "review").problems.length, 0);
    // such a line anywhere else cannot be read; and only the server writes one
    writeFileSync(join(dir, "review", "log", logFileName("Mallory", false)), JSON.stringify({ ...lines[0], by: "Mallory" }) + "\n");
    assert.match(new ReviewStore(dir, "review").problems[0].why, /outside its own log/);
    const refused = store.append(w, { op: "link-edit", id: "l000000000003", subject: "ns(X)", auto: "mine", by: "Alice" } as never, "tc");
    assert.equal((refused as { status: number }).status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("what the reference window opens beside a source: the declaration's own links first, else its innermost linked cluster's under the board's clustering, else none", () => {
  const d: ReviewData = emptyReview();
  const ev = (e: object) => applyLibrary(d, e as LibraryEvent);
  ev(fileEvent);
  ev(link("l000000000001", "ns(A)"));
  ev(link("l000000000002", "ns(A.B)", 2));
  ev(link("l000000000003", "decl(A.B.f)", 3));
  ev(link("l000000000004", "decl(A.B.f)", 4));
  ev(link("l000000000005", "file(M.N)", 5));
  // its own, in the order made
  assert.deepEqual(pairedLinks(d, "A.B.f", "M.N.O", "namespace")?.links.map((l) => l.id), ["l000000000003", "l000000000004"]);
  assert.equal(pairedLinks(d, "A.B.f", "M.N.O", "namespace")?.whose, "decl(A.B.f)");
  // the innermost cluster around it that has one, by the board's clustering
  assert.deepEqual(pairedLinks(d, "A.B.g", "M.N.O", "namespace"), { links: [d.links![1]], whose: "ns(A.B)" });
  assert.equal(pairedLinks(d, "A.C.g", "Q", "namespace")?.whose, "ns(A)");
  assert.equal(pairedLinks(d, "A.C.g", "M.N.O", "module")?.whose, "file(M.N)");
  // a structure and its namespace are one: the namespace's links are the structure's
  assert.equal(pairedLinks(d, "A.B", "Q", "namespace")?.whose, "ns(A.B)");
  // none: the window says so and keeps what it showed
  assert.equal(pairedLinks(d, "Z.g", "Q", "namespace"), null);
  assert.equal(pairedLinks(d, "A.C.g", "Q", "module"), null);
  assert.deepEqual(clusterChain("A.«b.c».f", "M.N", "namespace"), ["ns(A.«b.c».f)", "ns(A.«b.c»)", "ns(A)"]);
});

test("a link is refused on a past build's board, as the review is; on the latest it links the declaration or the cluster selected, or the one being linked", () => {
  assert.deepEqual(linkOffer({ cannot: PAST_LINK, archived: false, linking: null, board: "decl(A.f)" }), { refused: PAST_LINK });
  assert.deepEqual(linkOffer({ cannot: PAST_LINK, archived: false, linking: "ns(A)", board: null }), { refused: PAST_LINK });
  assert.deepEqual(linkOffer({ cannot: null, archived: false, linking: null, board: "decl(A.f)" }), { subject: "decl(A.f)", here: false });
  assert.deepEqual(linkOffer({ cannot: null, archived: false, linking: "ns(A)", board: "decl(A.f)" }), { subject: "ns(A)", here: true });
  assert.ok("refused" in linkOffer({ cannot: null, archived: true, linking: null, board: "decl(A.f)" }));
  assert.deepEqual(linkOffer({ cannot: null, archived: false, linking: null, board: null }), { none: true });
});

test("a quote keeps a little of the text around it, and is found again by it wherever the same words occur twice", () => {
  const page = "The game G.\nLet A be an adversary.  The game G ends\nwhen A stops. The game G again.";
  const start = page.indexOf("The game G ends");
  const q = quoteAt(page, start, start + "The game G".length)!;
  assert.equal(q.text, "The game G");
  assert.equal(q.after, "ends when A stops. The game G again.");
  assert.ok(q.before!.endsWith("Let A be an adversary."));
  assert.deepEqual(findQuote(page, q), { start, end: start + 10 });
  // line breaks and case read loosely
  assert.ok(findQuote("let a be\nan ADVERSARY.", { text: "Let A be an adversary." }));
  assert.equal(findQuote(page, { text: "absent words" }), null);
  // typography read as typed, as a quote written by hand or by an agent is: ’ as ', – and − as -
  const typeset = "Let p be regular. Kummer’s lemma. If u ≡ n (mod p) then u = v^p – a unit “in” K − 0.";
  const k = typeset.indexOf("Kummer’s");
  assert.deepEqual(findQuote(typeset, { text: "Kummer's lemma." }), { start: k, end: k + "Kummer’s lemma.".length });
  assert.ok(findQuote(typeset, { text: 'v^p - a unit "in" K - 0.' }));
  // where the text has the very characters, they are found first, as before
  assert.deepEqual(findQuote("It's a test: it’s the one.", { text: "it’s" }), { start: 13, end: 17 });
  assert.equal(defaultLabel({ page: 4, quote: { text: "Let A be an adversary that makes many queries" } }, "pdf"), "p. 4 “Let A be an adversary that…”");
  assert.equal(defaultLabel({ region: [0, 0, 1, 1] }, "png"), "A region of the image");
});

test("library events read back from a log are checked: a file by its hash, a link with a subject, a place on a page", () => {
  const ok = (o: object) => typeof readEvent(o, false) !== "string";
  assert.ok(ok(fileEvent));
  assert.ok(!ok({ ...fileEvent, sha: "nothex" }));
  assert.ok(!ok({ ...fileEvent, type: "svg" }));
  assert.ok(ok(link("l000000000001", "decl(A.f)")));
  assert.ok(!ok(link("l1", "decl(A.f)")));
  assert.ok(!ok({ ...link("l000000000001", "A.f") }));
  assert.ok(!ok({ ...link("l000000000001", "decl(A.f)"), region: [0, 0, 2, 1] }));
  const { page: _p, ...noPage } = link("l000000000001", "decl(A.f)");
  assert.ok(!ok({ ...noPage, quote: { text: "a quote off any page" } }));
  assert.ok(!ok({ op: "link-edit", at: at(1), by: "A", id: "l000000000001" }), "an edit changes something");
  // an agent's line in an agent's log, a person's in an invited person's log
  assert.equal((readEvent({ ...link("l000000000001", "decl(A.f)"), agent: true }, true) as Link & { agent: true }).agent, true);
  assert.equal((readEvent({ ...link("l000000000001", "decl(A.f)"), person: "0123456789" }, false, "0123456789") as Link).person, "0123456789");
  assert.equal(declSubject("A.f"), "decl(A.f)");
});
