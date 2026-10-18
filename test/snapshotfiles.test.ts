// A snapshot of the page (`visualproof export -o page.html`, opened from disk) carries the library's
// records and links, not its files: a note's card asks for no drawing of what it carries, and the
// reference window opens none, each saying so, rather than asking a server there is not and showing
// what failed.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileRecord } from "../src/shared/library.ts";
import type { NoteCarry } from "../src/shared/sticky.ts";

const SHA = "c7820e17e8bc972c68ae3ad4d13bb723fd0a688e3f01c28429c874a0541de010";
const record = (type: "pdf" | "png"): FileRecord => ({ sha: SHA, title: "Review plan", type, size: 1000, pages: 2, by: "Alice", at: "2026-10-01T00:00:00Z" }) as FileRecord;

test("a note's card in a snapshot of the page draws nothing it carries from a server, and says so; on a server it asks for the drawings", async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= { addEventListener() {}, devicePixelRatio: 1 };
  const { Stickies } = await import("../src/web/src/sticky.ts");
  const card = (type: "pdf" | "png", c: NoteCarry, noFiles: boolean): string =>
    (Stickies.prototype as unknown as { carryHtml(c: NoteCarry, k: number, w: number): string }).carryHtml.call({ hooks: { file: () => record(type), noFiles: () => noFiles } }, c, 0, 240);
  const kinds: [string, "pdf" | "png", NoteCarry][] = [
    ["a PDF", "pdf", { file: SHA, page: 1 }],
    ["a clip", "pdf", { file: SHA, page: 1, region: [0.1, 0.2, 0.9, 0.5] }],
    ["an image", "png", { file: SHA }],
  ];
  for (const [what, type, c] of kinds) {
    const served = card(type, c, false);
    assert.match(served, /<img [^>]*src="\/api\/library\//, `${what} drawn by the server`);
    const frozen = card(type, c, true);
    assert.doesNotMatch(frozen, /<img|\/api\//, `${what} in a snapshot asks for nothing`);
    assert.match(frozen, /data-sha=/, `${what} still opens, in the reference window`);
    if (type === "pdf" && !c.region) assert.match(frozen, /sk-att-title">Review plan<.*PDF · 2 p\./, "a PDF's title and pages stand alone");
    else assert.match(frozen, /Review plan is drawn on the server: a snapshot of the page carries no files\./, `${what} says why it is not drawn`);
  }
});

test("the reference window in a snapshot of the page opens no file and fetches nothing: it says why", async () => {
  const { PaperWin } = await import("../src/web/src/paperwin.ts");
  const g = globalThis as Record<string, unknown>;
  const fetched: string[] = [];
  const was = g.fetch;
  g.fetch = async (u: string) => {
    fetched.push(u);
    throw new Error("no server");
  };
  try {
    const host = { innerHTML: "", textContent: "" };
    // the find bar, whose search of the file shown before is put away
    const input = { dataset: { done: "1" } as Record<string, string> };
    const found = { textContent: "3 of 7" };
    const findEl = { querySelector: (s: string) => (s === "input" ? input : found) };
    const win = { turn: 0, view: null, file: null, page: 0, pages: 0, host, findEl, unpick() {}, hooks: { noFiles: () => "A snapshot of the page carries the library's records and links, not its files: open it on the server." } };
    await (PaperWin.prototype as unknown as { load(f: FileRecord): Promise<void> }).load.call(win, record("pdf"));
    assert.deepEqual(fetched, []);
    assert.match(host.innerHTML, /<b>Review plan<\/b>.*not its files: open it on the server\./);
    assert.equal(input.dataset.done, undefined);
    assert.equal(found.textContent, "");
  } finally {
    g.fetch = was;
  }
});
