// Files reach the canvas by themselves (AttachmentSpec decision 12, the owner's of 2026-10-11: "the
// Project is the place that holds everything; every item shows there"): a file added to the
// library, by upload or by URL, by a person or an agent, is carried by a note of the project on the
// ring — collapsed, titled by the file, written by whoever added it — and the same bytes again make
// none; a file dropped on the canvas has the page's own note instead. Once, at the start, every
// file no note carries that was never considered gets its note, by VisualProof; a restart writes
// none again, and a note deleted stays deleted.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyLibrary, fileOf } from "../src/shared/library.ts";
import type { LibraryData, LibraryOp } from "../src/shared/library.ts";
import { itemBoard, itemWhy } from "../src/shared/noteplace.ts";
import type { ProjectNote } from "../src/shared/projectnotes.ts";
import type { ReviewOp } from "../src/shared/review.ts";
import { LAYOUT_VERSION } from "../src/shared/graph.ts";
import { PROJECT } from "../src/shared/views.ts";
import { Live } from "../src/server/live.ts";
import { openProject } from "../src/server/project.ts";
import { ReviewStore } from "../src/server/review.ts";
import { Views } from "../src/server/views.ts";
import { tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";
import { testDirs } from "./tmpdirs.ts";

const pdf = (title: string) => tinyPdf([[`${title}: a page of it.`]], title);
const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };

/** Upload bytes through the page's route as `name`, with the query given. */
async function upload(base: string, bytes: Buffer, name: string, query = "name=paper.pdf") {
  const r = await fetch(`${base}/api/library/upload?${query}`, { method: "POST", headers: { "x-visualproof-name": name }, body: new Uint8Array(bytes) });
  return (await r.json()) as { file: { sha: string; title: string }; existed: boolean };
}

/** Whether a note shows on the Project alone: at the top level under both clusterings, carrying no
 *  file linked to anything, another view shows it only where it is added to it (the owner's decision
 *  of 2026-10-11, AttachmentSpec decision 17). */
const projectOnly = (n: ProjectNote) =>
  itemWhy(n, { all: true }, itemBoard("namespace", []), () => true, new Map()) === "project" &&
  (["namespace", "module"] as const).every((m) => itemWhy(n, { all: false }, itemBoard(m, [{ name: "N.a", module: "M" }]), () => true, new Map()) === null);

test("a file added to the library, by a person or an agent, is carried by a note of the project on the ring, collapsed, titled by the file; the same bytes again make none, a file dropped on the canvas none either", async () => {
  const S = await site({ agents: "advise" });
  try {
    const a = await upload(S.base, pdf("Games, Briefly"), "Alice");
    const notes = () => S.live.views.book.notes;
    assert.equal(notes().length, 1);
    const n = notes()[0];
    assert.equal(n.text, "Games, Briefly");
    assert.equal(n.open, false, "collapsed");
    assert.deepEqual(n.places, {}, "at the top level under both clusterings: on the ring");
    assert.ok(projectOnly(n), "on the Project, and on another view only by a link or an add");
    assert.equal(n.by, "Alice");
    assert.equal(n.agent, undefined);
    assert.deepEqual(n.carries, [{ file: a.file.sha }]);
    // written as any note is: the timeline says so, under who added the file
    assert.ok(S.live.timeline.events.some((e) => e.kind === "note" && e.what === "created" && e.by === "Alice" && e.text === "Games, Briefly"));
    // the same bytes again, by anyone: the file as it is, and no second note
    assert.equal((await upload(S.base, pdf("Games, Briefly"), "Bob")).existed, true);
    assert.equal(notes().length, 1);
    // an agent's file: its note is the agent's
    const r = await fetch(`${S.base}/api/agent/library/upload?name=notes.pdf`, { method: "POST", headers: agent, body: new Uint8Array(pdf("Lecture Notes")) });
    assert.equal(r.status, 200);
    const b = notes().find((x) => x.text === "Lecture Notes")!;
    assert.equal(b.by, "Claude");
    assert.equal(b.agent, true);
    // a file dropped on the canvas: the page writes its note at the spot, the server none
    const dropped = await upload(S.base, pdf("A Photo of a Whiteboard"), "Alice", "name=board.pdf&note=0");
    assert.ok(fileOf(S.live.review.data, dropped.file.sha));
    assert.equal(notes().length, 2);
    assert.ok(!notes().some((x) => x.carries?.some((c) => c.file === dropped.file.sha)));
  } finally {
    await S.close();
  }
});

test("once at the start, every file of the library no note carries and never considered gets its note, by VisualProof; a restart writes none again, and a note deleted stays deleted", async () => {
  const S = await site();
  try {
    // files whose records came before notes carried files (or through the logs from elsewhere): the
    // review has them, the notes know nothing of them
    const record = (sha: string, title: string, more: Partial<LibraryOp> = {}) =>
      S.live.review.append({ name: "Bob", agent: false, person: null }, { op: "file", sha, title, type: "pdf", size: 10, pages: 1, by: "Bob", ...more } as unknown as ReviewOp, "tc");
    const [A, B, C] = ["a", "b", "c"].map((x) => x.repeat(64));
    record(A, "The Lean Mathematical Library");
    record(B, "Carried already");
    record(C, "Archived");
    S.live.review.append({ name: "Bob", agent: false, person: null }, { op: "file-archive", sha: C, by: "Bob" } as unknown as ReviewOp, "tc");
    // a note carries B already
    assert.equal(S.live.views.arrangeNotes([{ op: "pnote", note: { id: "nbbbbbbbbbbbb", text: "my note on B", places: {}, open: true, by: null, at: "", carries: [{ file: B }] } }], null, "Bob"), null);
    const state = join(S.dir, "state");
    const restart = () => {
      const live = new Live(openProject(S.dir, ["M"], false), testDirs(state), null, new ReviewStore(S.dir, join(S.dir, "review")));
      live.tokens.close();
      live.invites.close();
      return live.views.book.notes;
    };
    const after = restart();
    const made = after.filter((n) => n.by === "VisualProof");
    assert.equal(made.length, 1, "A alone: B is carried, C archived");
    assert.equal(made[0].text, "The Lean Mathematical Library");
    assert.deepEqual(made[0].carries, [{ file: A }]);
    assert.equal(made[0].open, false);
    assert.deepEqual(made[0].places, {});
    // again: nothing more
    assert.equal(restart().filter((n) => n.by === "VisualProof").length, 1);
    // its note deleted: it stays deleted
    const views = new Views(state, LAYOUT_VERSION, () => {});
    views.carriedFile = (sha) => fileOf(S.live.review.data, sha);
    assert.equal(views.arrangeNotes([{ op: "pnote-delete", id: made[0].id }], null, "Alice"), null);
    assert.equal(restart().filter((n) => n.by === "VisualProof").length, 0);
    // the archived one restored, and a new record from the logs: each considered at the next start
    S.live.review.append({ name: "Bob", agent: false, person: null }, { op: "file-restore", sha: C, by: "Bob" } as unknown as ReviewOp, "tc");
    assert.deepEqual(
      restart()
        .filter((n) => n.by === "VisualProof")
        .map((n) => n.text),
      ["Archived"],
    );
  } finally {
    await S.close();
  }
});

test("a note's text follows its file's title where it is that title or the name the file was added under, as an edit by VisualProof; a text someone wrote stays", async () => {
  const S = await site();
  try {
    // uploaded under its name, which titles it: a PDF that says no title of its own
    const a = await upload(S.base, tinyPdf([["A page."]]), "Alice", "name=games-briefly.pdf");
    const b = await upload(S.base, pdf("Another Paper"), "Alice", "name=other.pdf");
    assert.equal(a.file.title, "games-briefly");
    const notes = () => S.live.views.book.notes;
    const auto = notes().find((n) => n.carries?.[0].file === a.file.sha)!;
    assert.equal(auto.text, "games-briefly", "its note says its title");
    const write = (id: string, text: string, carries: { file: string }[]) =>
      assert.equal(S.live.views.arrangeNotes([{ op: "pnote", note: { id, text, places: {}, open: false, by: "Bob", at: "2026-10-11T10:00:00.000Z", carries } }], null, "Bob"), null);
    write("nname0000000", "games-briefly.pdf", [{ file: a.file.sha }]);
    write("nwritten0000", "Read Section 3 of games-briefly first", [{ file: a.file.sha }]);
    write("ntwo00000000", "games-briefly", [{ file: a.file.sha }, { file: b.file.sha }]);
    write("nother000000", "games-briefly", [{ file: b.file.sha }]);
    // a view's own note follows as the project's do
    assert.equal(S.live.views.arrange(PROJECT, [{ op: "note", note: { id: "vview0000000", text: "games-briefly", place: { mode: "namespace", in: [], world: [0, 0] }, open: true, by: "Bob", at: "", carries: [{ file: a.file.sha }] } }], null, "Bob"), null);
    const text = (id: string) => notes().find((n) => n.id === id)?.text ?? S.live.views.book.project().notes?.find((n) => n.id === id)?.text;
    // renamed in the library, by the page's route
    const rename = async (title: string) => {
      const r = await fetch(`${S.base}/api/library/edit`, { method: "POST", headers: { "content-type": "application/json", "x-visualproof-name": "Carol" }, body: JSON.stringify({ sha: a.file.sha, title }) });
      assert.equal(r.status, 200);
      await new Promise((r) => setTimeout(r, 20));
    };
    await rename("Games, Briefly");
    assert.equal(text(auto.id), "Games, Briefly", "the title it had");
    assert.equal(text("nname0000000"), "Games, Briefly", "the name it was added under");
    assert.equal(text("vview0000000"), "Games, Briefly", "a view's own note");
    assert.equal(text("nwritten0000"), "Read Section 3 of games-briefly first", "words someone wrote stay");
    assert.equal(text("ntwo00000000"), "games-briefly", "a note that carries two files has no one title to follow");
    assert.equal(text("nother000000"), "games-briefly", "nor one that carries another file");
    // an edit by VisualProof, said in the timeline as one
    const followed = notes().find((n) => n.id === auto.id)!;
    assert.equal(followed.edited?.by, "VisualProof");
    assert.ok(S.live.timeline.events.some((e) => e.kind === "note" && e.what === "edited" && e.by === "VisualProof" && e.text === "Games, Briefly"));
    // renamed again: the notes whose text is the title follow again; one written over since stays
    assert.equal(S.live.views.arrangeNotes([{ op: "pnote-edit", id: "nname0000000", text: "My own words now" }], null, "Bob"), null);
    await rename("Games, Briefly (2nd ed.)");
    assert.equal(text(auto.id), "Games, Briefly (2nd ed.)");
    assert.equal(text("nname0000000"), "My own words now");
    // a rename that came through a log from elsewhere is followed as one made here
    S.live.review.append({ name: "Dana", agent: false, person: null }, { op: "file-edit", sha: a.file.sha, title: "Games, Briefly (3rd ed.)", by: "Dana" } as unknown as ReviewOp, "tc");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(text(auto.id), "Games, Briefly (3rd ed.)");
  } finally {
    await S.close();
  }
});

test("once, at the start, a note that carries one file alone and still says a name it went by before takes its title now: the six notes of the live server; done once, and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-retitle-"));
  try {
    // the live library's records as its logs hold them: uploaded by an agent under the file's name,
    // which titled it, then given its real title
    const live: [string, string][] = [
      ["LeanMathlib20", "The Lean Mathematical Library (The mathlib Community, CPP 2020, arXiv 1910.09336)"],
      ["Lean4CADE21", "The Lean 4 Theorem Prover and Programming Language (de Moura and Ullrich, CADE 2021)"],
      ["Wiles95ModularElliptic", "Modular Elliptic Curves and Fermat's Last Theorem (Wiles, Annals of Mathematics 1995)"],
      ["TaylorWiles95HeckeAlgebras", "Ring-Theoretic Properties of Certain Hecke Algebras (Taylor and Wiles, Annals of Mathematics 1995)"],
      ["BuzzardTaylorFLT", "Towards a Lean proof of Fermat's Last Theorem (Buzzard and Taylor, blueprint)"],
      ["sphere-eversion", "Formalising the h-principle and sphere eversion (Massot, Nash and van Doorn, CPP 2023)"],
    ];
    const sha = (k: number) => k.toString(16).repeat(64).slice(0, 64);
    const d: LibraryData = {};
    const who = { at: "2026-10-11T09:00:00.000Z", by: "Olivia's AI", agent: true as const };
    live.forEach(([name, title], k) => {
      applyLibrary(d, { op: "file", sha: sha(k + 1), title: name, type: "pdf", size: 1000, pages: 30, name: `${name}.pdf`, ...who });
      applyLibrary(d, { op: "file-edit", sha: sha(k + 1), title, ...who });
    });
    // a paper fetched by its address, under a name of arXiv's, titled by its abstract page from the
    // first; and one with no name kept, renamed: its first title is in the history
    applyLibrary(d, { op: "file", sha: sha(8), title: "On a conjecture of Marton", type: "pdf", size: 1000, name: "2311.05762v1.pdf", url: "https://arxiv.org/pdf/2311.05762v1", ...who });
    applyLibrary(d, { op: "file", sha: sha(9), title: "scan 3", type: "png", size: 1000, ...who });
    applyLibrary(d, { op: "file-edit", sha: sha(9), title: "Whiteboard, the reduction", ...who });
    const views = new Views(dir, LAYOUT_VERSION, () => {});
    const note = (id: string, text: string, files: number[]): ProjectNote => ({ id, text, places: {}, open: false, by: "Olivia's AI", agent: true, at: "2026-10-11T09:00:00.000Z", carries: files.map((k) => ({ file: sha(k) })) });
    const ops = [
      ...live.map(([name], k) => ({ op: "pnote" as const, note: note(`nlive${k}0000000`, name, [k + 1]) })),
      { op: "pnote" as const, note: note("narxiv0000000", "On a conjecture of Marton", [8]) },
      { op: "pnote" as const, note: note("nscan00000000", "scan 3", [9]) },
      // what stays: words of someone's own, a name of another file, a note carrying two files
      { op: "pnote" as const, note: note("nwords0000000", "LeanMathlib20: start at Section 3", [1]) },
      { op: "pnote" as const, note: note("nelse00000000", "BuzzardTaylorFLT", [1]) },
      { op: "pnote" as const, note: note("ntwo000000000", "BuzzardTaylorFLT", [5, 1]) },
    ];
    assert.equal(views.arrangeNotes(ops, null, "Olivia's AI", true), null);
    const text = (v: Views, id: string) => v.book.notes.find((n) => n.id === id)!.text;
    assert.equal(views.followTitles(d, "VisualProof"), 7, "the six, and the scan's");
    live.forEach(([, title], k) => assert.equal(text(views, `nlive${k}0000000`), title));
    assert.equal(text(views, "nscan00000000"), "Whiteboard, the reduction");
    assert.equal(text(views, "narxiv0000000"), "On a conjecture of Marton", "its title already");
    assert.equal(text(views, "nwords0000000"), "LeanMathlib20: start at Section 3");
    assert.equal(text(views, "nelse00000000"), "BuzzardTaylorFLT");
    assert.equal(text(views, "ntwo000000000"), "BuzzardTaylorFLT");
    assert.equal(views.book.notes.find((n) => n.id === "nlive00000000")!.edited?.by, "VisualProof");
    // idempotent: again, here or after a restart, nothing changes
    assert.equal(views.followTitles(d, "VisualProof"), 0);
    const again = new Views(dir, LAYOUT_VERSION, () => {});
    assert.equal(again.followTitles(d, "VisualProof"), 0);
    // and it was done once: an old name written back by someone since is their text, and stays
    assert.equal(again.arrangeNotes([{ op: "pnote-edit", id: "nlive40000000", text: "BuzzardTaylorFLT" }], null, "Olivia"), null);
    const third = new Views(dir, LAYOUT_VERSION, () => {});
    assert.equal(third.followTitles(d, "VisualProof"), 0);
    assert.equal(text(third, "nlive40000000"), "BuzzardTaylorFLT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
