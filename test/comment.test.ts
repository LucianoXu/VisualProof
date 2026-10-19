// Comments (ReviewSpec, "Comments", decided 2026-10-09): the references a quote carries, both ways
// (shared/comment.ts); the blocks of a comment and what a quote of an opinion keeps of it; quoting
// source lines, whole, from a selection in code that wraps; finding quoted lines again; light
// Markdown rendered from escaped text, never HTML of its own (web/src/markdown.ts); quoting an
// opinion into the box beside it, and source lines into a pinned window's own box; going to a
// quoted opinion (web/src/reviewbox.ts); and the agents' API, which gives comments as written.

import assert from "node:assert/strict";
import { test } from "node:test";
import { attribution, blocks, insertBlock, locateLines, MAX_COMMENT, opinionRef, parseRef, QUOTE_CHARS, QUOTE_LINES, quoteBody, quoteCode, quoteOpinion, refText, selectedLines, sourceRef } from "../src/shared/comment.ts";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import type { ReviewData } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { renderComment } from "../src/web/src/markdown.ts";
import { ReviewBox } from "../src/web/src/reviewbox.ts";
import type { ReviewHooks } from "../src/web/src/reviewbox.ts";
import { FakeEl } from "./fakedom.ts";
import { site } from "./site.ts";

/** A graph of the project's declarations `names`, `also` folded into the first. */
function graph(names: string[], also: string[] = []): Graph {
  const nodes: ViewNode[] = names.map((name, k) => ({ name, kind: "def", module: "M", ax: 0, hash: `h-${name}`, ...(k === 0 && also.length ? { also } : {}) }));
  const meta = { nodes, projectCount: nodes.length, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: 0 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(0));
}

const AT = "2026-10-09T08:12:30.123Z";

// ---------------------------------------------------------------- references

test("a quote's reference, written and read back: an opinion's and source lines', readable, odd names and all", () => {
  assert.equal(opinionRef("Function.Embedding", "Alice", AT), "opinion:Function.Embedding#Alice@2026-10-09T08:12:30.123Z");
  assert.equal(sourceRef("Function.Embedding", 12, 15), "source:Function.Embedding#L12-L15");
  assert.equal(sourceRef("Function.Embedding", 7, 7), "source:Function.Embedding#L7");
  assert.deepEqual(parseRef("opinion:Function.Embedding#Alice@2026-10-09T08:12:30.123Z"), { kind: "opinion", name: "Function.Embedding", by: "Alice", at: AT });
  assert.deepEqual(parseRef("source:Function.Embedding#L12-L15"), { kind: "source", name: "Function.Embedding", from: 12, to: 15 });
  assert.deepEqual(parseRef("source:A.b#L7"), { kind: "source", name: "A.b", from: 7, to: 7 });
  // what would end the link or a part is encoded, and nothing else: Unicode names stay readable
  for (const [name, by] of [["A.«weird name (1)#@»", "Ann Lee [CS] #2 @home"], ["Matrix.U₁.ε'", "Zoë"], ["A.b%c", "100% sure"], ["A.b", "a\"b`c\\d"]]) {
    const r = opinionRef(name, by, AT);
    assert.ok(!/[\s()[\]<>"`\\]/.test(r), r);
    assert.deepEqual(parseRef(r), { kind: "opinion", name, by, at: AT }, r);
    const s = sourceRef(name, 3, 9);
    assert.deepEqual(parseRef(s), { kind: "source", name, from: 3, to: 9 });
    assert.equal(refText(parseRef(s)!), s);
  }
  assert.equal(opinionRef("Matrix.U₁", "Zoë", AT), "opinion:Matrix.U₁#Zoë@2026-10-09T08:12:30.123Z");
  // anything else is no reference
  for (const bad of [
    "javascript:alert(1)",
    "opinion:A.b#Alice",
    "opinion:A.b#Alice@yesterday",
    "opinion:A.b#Al@ice@2026-10-09T08:12:30.123Z",
    "opinion:A%ZZ#Alice@2026-10-09T08:12:30.123Z",
    "opinion:A%0Ab#Alice@2026-10-09T08:12:30.123Z",
    "source:A.b#L0",
    "source:A.b#L9-L3",
    "source:A.b#12",
    "source:A.b",
    "https://example.com/#L1",
  ])
    assert.equal(parseRef(bad), null, bad);
});

// ---------------------------------------------------------------- blocks, and quoting an opinion

test("the blocks of a comment: paragraphs, quotes, fences (closed by as many backticks or more), a code quote's header", () => {
  const text = [
    "> [**Alice** (2026-10-09)](opinion:A.f#Alice@2026-10-09T08:12:30.123Z):",
    "> Why 2?",
    "",
    "Because the bound",
    "is tight.",
    "[M.lean:3–4](source:A.f#L3-L4)",
    "```lean",
    "def f := 2",
    "```",
    "````",
    "```",
    "````",
    "```text",
    "never closed",
  ].join("\n");
  const b = blocks(text);
  assert.deepEqual(b.map((x) => x.kind), ["quote", "para", "fence", "fence", "fence"]);
  assert.deepEqual(b[0], { kind: "quote", lines: ["[**Alice** (2026-10-09)](opinion:A.f#Alice@2026-10-09T08:12:30.123Z):", "Why 2?"] });
  assert.deepEqual(attribution((b[0] as { lines: string[] }).lines[0])?.ref, { kind: "opinion", name: "A.f", by: "Alice", at: AT });
  assert.deepEqual(b[1], { kind: "para", lines: ["Because the bound", "is tight."] });
  const cq = b[2] as Extract<(typeof b)[number], { kind: "fence" }>;
  assert.deepEqual([cq.lang, cq.lines, cq.closed, cq.head?.label, cq.head?.ref], ["lean", ["def f := 2"], true, "M.lean:3–4", { kind: "source", name: "A.f", from: 3, to: 4 }]);
  assert.deepEqual((b[3] as { lines: string[] }).lines, ["```"], "a shorter run of backticks does not close a fence");
  assert.deepEqual([(b[4] as { closed: boolean }).closed, (b[4] as { lines: string[] }).lines], [false, ["never closed"]]);
  // a link to source lines with no fence under it is a paragraph
  assert.deepEqual(blocks("[M.lean:3](source:A.f#L3)\nsee there").map((x) => x.kind), ["para"]);
});

test("a quote of an opinion: attributed, linking back; the commenter's own words, trimmed to a few lines; nested quotes and quoted code left out", () => {
  const short = quoteOpinion("Function.Embedding", { by: "Alice", at: AT, comment: "Why 2 and not 3?" });
  assert.equal(short, "> [**Alice** (2026-10-09)](opinion:Function.Embedding#Alice@2026-10-09T08:12:30.123Z):\n> Why 2 and not 3?");
  // an agent is marked so; a name that would break the link is shown without what breaks it
  assert.match(quoteOpinion("A.f", { by: "Claude", at: AT, agent: true, comment: "ok" }), /^> \[\*\*Claude\*\* \(agent, 2026-10-09\)\]\(opinion:A\.f#Claude@/);
  const odd = quoteOpinion("A.f", { by: "Bob [*x*]", at: AT, comment: "ok" });
  assert.equal(attribution(odd.split("\n")[0].slice(2))?.ref.by, "Bob [*x*]");
  // long: QUOTE_LINES lines, then "…"
  const many = Array.from({ length: 9 }, (_, k) => `line ${k + 1}`).join("\n");
  assert.deepEqual(quoteBody(many), [...Array.from({ length: QUOTE_LINES }, (_, k) => `line ${k + 1}`), "…"]);
  // one long paragraph: cut at a word, with "…"
  const long = quoteBody("word ".repeat(200).trim());
  assert.equal(long.length, 1);
  assert.ok(long[0].endsWith("…") && long[0].length <= QUOTE_CHARS + 1 && !long[0].includes("wo…"), long[0]);
  // a reply to a quote: the reply alone; a code quote: its header alone; a fence cut into, closed
  const reply = "> [**Bob** (2026-10-08)](opinion:A.f#Bob@2026-10-08T08:00:00.000Z):\n> Is it 2?\n\nYes: see\n\n[M.lean:3–9](source:A.f#L3-L9)\n```lean\na\nb\nc\nd\ne\nf\n```";
  assert.deepEqual(quoteBody(reply), ["Yes: see", "", "[M.lean:3–9](source:A.f#L3-L9)"]);
  assert.deepEqual(quoteBody("Look:\n```lean\na\nb\nc\nd\ne\n```"), ["Look:", "", "```lean", "a", "b", "c", "```", "…"]);
  // quoted as a whole, it reads back: a quote whose code fence closes inside it
  const q = quoteOpinion("A.f", { by: "Carol", at: AT, comment: "Look:\n```lean\na\nb\nc\nd\ne\n```" });
  const inner = blocks((blocks(q)[0] as { lines: string[] }).lines.slice(1).join("\n"));
  assert.deepEqual(inner.map((x) => x.kind), ["para", "fence", "para"]);
});

// ---------------------------------------------------------------- quoting code

test("code quoted from a selection: whole source lines, however they wrap; a header with the file and the lines over a Lean fence", () => {
  const lines = ["theorem foo (n : Nat) :", "    " + "veryLongName ".repeat(30).trim() + " = 0 := by", "  simp"];
  const text = lines.join("\n");
  const start = lines[0].length + 1;
  // a selection inside one long line — several rows on the screen — is that line
  assert.deepEqual(selectedLines(text, start + 40, start + 300), { first: 1, last: 1 });
  // from the middle of one line to the middle of the next: both, whole
  assert.deepEqual(selectedLines(text, 8, start + 10), { first: 0, last: 1 });
  // backwards, the same
  assert.deepEqual(selectedLines(text, start + 10, 8), { first: 0, last: 1 });
  // a line with its line break (a triple click) is that line, not the next
  assert.deepEqual(selectedLines(text, start, start + lines[1].length + 1), { first: 1, last: 1 });
  // starting on a line's break: the line it only touches there is not taken
  assert.deepEqual(selectedLines(text, lines[0].length, start + 3), { first: 1, last: 1 });
  assert.equal(selectedLines(text, 5, 5), null);
  // the quote: lines 2–3 of the code, which starts at line 41 of its file (from 0)
  assert.equal(
    quoteCode({ file: "Mathlib/Logic/Embedding/Basic.lean", name: "Function.Embedding.trans", start: 40, lines, first: 1, last: 2 }),
    `[Mathlib/Logic/Embedding/Basic.lean:42–43](source:Function.Embedding.trans#L42-L43)\n\`\`\`lean\n${lines[1]}\n  simp\n\`\`\``,
  );
  assert.match(quoteCode({ file: "X.lean", name: "A.f", start: 0, lines, first: 0, last: 0 }), /^\[X\.lean:1\]\(source:A\.f#L1\)\n/);
  // code holding backticks gets a longer fence, so that it reads back as written
  const ticky = ["def s := \"```\"", "```"];
  const q = quoteCode({ file: "X.lean", name: "A.f", start: 0, lines: ticky, first: 0, last: 1 });
  const b = blocks(q);
  assert.deepEqual([b.length, (b[0] as { lines: string[] }).lines], [1, ticky]);
});

test("quoted lines found again: where they were, else where their text is now, else what is left of where they were", () => {
  const now = ["theorem foo :", "  -- a new line", "  a = b := by", "  simp"];
  // the declaration starts at line 10 (from 0): lines 12–13 of the file are its third and fourth
  assert.deepEqual(locateLines(now, 10, 13, 14, ["  a = b := by", "  simp"]), [2, 3]);
  // quoted when they were lines 12–13: a line came in above them since
  assert.deepEqual(locateLines(now, 10, 12, 13, ["  a = b := by", "  simp"]), [2, 3]);
  // no code to find them by: where they were
  assert.deepEqual(locateLines(now, 10, 12, 13, null), [1, 2]);
  assert.deepEqual(locateLines(now, 10, 13, 40, null), [2, 3]);
  assert.equal(locateLines(now, 10, 30, 40, null), null);
});

test("a quote goes into the comment on lines of its own: a blank line before it after text, and after it, where the caret goes", () => {
  assert.deepEqual(insertBlock("", 0, 0, "> q"), { value: "> q\n\n", caret: 5 });
  assert.deepEqual(insertBlock("Hello", 5, 5, "> q"), { value: "Hello\n\n> q\n\n", caret: 12 });
  assert.deepEqual(insertBlock("Hello\n", 6, 6, "> q"), { value: "Hello\n\n> q\n\n", caret: 12 });
  // in the middle, in place of what is selected: the reply gets a paragraph of its own
  assert.deepEqual(insertBlock("A\n\nX\n\nB", 3, 4, "> q"), { value: "A\n\n> q\n\n\n\nB", caret: 8 });
});

// ---------------------------------------------------------------- the renderer

test("a comment rendered: escaped first, then quotes, code, emphasis; names in backticks link where they are declarations", () => {
  const g = graph(["Function.Embedding", "Function.Injective", "Nat.Prime", "Nat.succ"], ["Function.Embedding.mk"]);
  const html = renderComment(
    [
      "> [**Alice** (2026-10-09)](opinion:Function.Embedding#Alice@2026-10-09T08:12:30.123Z):",
      "> Is `Injective` right?",
      "",
      "**Yes**: *see* _this_ and `Nat.Prime`, `Function.Embedding.mk`, `unknownThing`, `x + 1`.",
      "Second line.",
      "",
      "[Mathlib/Logic/Embedding/Basic.lean:12–13](source:Function.Embedding#L12-L13)",
      "```lean",
      "def f := helper <b>",
      "```",
      "```",
      "plain <i>",
      "```",
    ].join("\n"),
    "Function.Embedding",
    g,
  );
  // the quote: its attribution goes to the opinion, the name in it links in the declaration's namespace
  assert.match(html, /^<blockquote class="md-q quoted"><button type="button" class="md-op md-by" data-md-op="opinion:Function\.Embedding#Alice@2026-10-09T08:12:30\.123Z" title="Go to Alice's opinion on Function\.Embedding"><b>Alice<\/b> \(2026-10-09\)<\/button><p>Is <button type="button" class="md-ref" data-ref="Function\.Injective"/);
  // emphasis, line breaks kept within a paragraph
  assert.match(html, /<p><b>Yes<\/b>: <i>see<\/i> <i>this<\/i> and /);
  assert.match(html, /Second line\.<\/p>/);
  assert.ok(html.includes("\nSecond line."));
  // full names link; a name generated from a command goes to its unit; unknown names and code stay code
  assert.match(html, /<button type="button" class="md-ref" data-ref="Nat\.Prime" title="Nat\.Prime"><code>Nat\.Prime<\/code><\/button>/);
  assert.match(html, /data-ref="Function\.Embedding" title="Function\.Embedding"><code>Function\.Embedding\.mk<\/code>/);
  assert.match(html, /, <code>unknownThing<\/code>, <code>x \+ 1<\/code>\./);
  // the code quote: its header opens the source there, its code is Lean, highlighted and escaped; its
  // names do not link (what they mean depends on the file's opens, which the comment does not carry)
  assert.match(html, /<div class="md-cq"><button type="button" class="md-src md-cq-h" data-md-src="source:Function\.Embedding#L12-L13" title="Open the source of Function\.Embedding at lines 12–13">Mathlib\/Logic\/Embedding\/Basic\.lean:12–13<\/button><pre class="code md-code">/);
  assert.match(html, /<span class="tk-keyword">def<\/span> f := helper &lt;b&gt;/);
  // a fence that names no language is plain
  assert.match(html, /<pre class="code md-code">plain &lt;i&gt;<\/pre>$/);
  // a short name is read only where the comment is: elsewhere it is code
  assert.doesNotMatch(renderComment("`Injective`", "Nat.Prime", g), /data-ref/);
  assert.match(renderComment("`succ`", "Nat.zero", g), /data-ref="Nat\.succ"/);
});

test("a hostile comment stays text: no tag, no attribute, no link of its own", () => {
  const g = graph(["A.f"]);
  const evil = [
    "<script>alert(1)</script> <img src=x onerror=alert(1)>",
    "[click](javascript:alert(1)) [x](https://evil.example) [y](opinion:A.f#x\"onmouseover=\"alert(1)@2026-10-09T08:12:30.123Z)",
    "&lt;script&gt; &amp; &#60;b&#62;",
    "`A.f\" onclick=\"x` **<b>bold</b>** *<i>*",
    "> <iframe src=//evil>",
    "```lean",
    "</pre><script>alert(2)</script>",
    "```",
    "[M.lean:1](source:A.f#L1)",
    "```lean",
    "\"<svg onload=alert(3)>\"",
    "```",
  ].join("\n");
  const html = renderComment(evil, "A.f", g);
  // the only tags are the renderer's own
  const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
  for (const t of tags) assert.ok(["p", "b", "i", "code", "pre", "blockquote", "button", "span", "div"].includes(t), `tag ${t}`);
  // and their attributes, with values the renderer made
  for (const m of html.matchAll(/<[a-z]+((?:\s+[a-z-]+="[^"]*")*)\s*>/gi))
    for (const a of m[1].matchAll(/([a-z-]+)="/gi)) assert.ok(["type", "class", "title", "data-ref", "data-md-op", "data-md-src"].includes(a[1]), `attribute ${a[1]}`);
  for (const tag of html.match(/<[^>]*>/g) ?? []) assert.ok(!/\son[a-z]+=|href|javascript:|<(script|img|iframe|svg)/i.test(tag), tag);
  // escaped as written: entities read as typed, links of other schemes as text
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&amp;lt;script&amp;gt; &amp;amp; &amp;#60;b&amp;#62;"));
  assert.ok(html.includes("[click](javascript:alert(1))"));
  assert.ok(html.includes("[x](https://evil.example)"));
  assert.ok(html.includes("[y](opinion:A.f#x&quot;onmouseover=&quot;alert(1)@2026-10-09T08:12:30.123Z)"), "a reference that does not read back is text");
  assert.ok(!html.includes(' onclick="x'), "a quote cannot leave an attribute");
  const text = html.replace(/<[^>]*>/g, "");
  assert.ok(text.includes("&lt;/pre&gt;&lt;script&gt;alert(2)&lt;/script&gt;"), "Lean code is escaped as it is highlighted");
  assert.ok(text.includes("&quot;&lt;svg onload=alert(3)&gt;&quot;"));
  // a quote nested deeper than the page draws is text
  assert.match(renderComment("> > > > > deep", null, g), /&gt; deep<\/p>/);
});

// ---------------------------------------------------------------- the review box

/** A comment box as the panel and a source window hold it, and the line under the buttons. */
function fakeRoot() {
  const box = {
    value: "",
    rows: 2,
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
    focus() {
      this.focused = true;
    },
    setSelectionRange(a: number, b: number) {
      this.selectionStart = a;
      this.selectionEnd = b;
    },
    matches: (s: string) => s === "[data-rv-comment]",
  };
  const err = { textContent: "", hidden: true };
  const opinions: { dataset: { rvOp: string }; classList: FakeEl["classList"]; style: Record<string, string>; flashed: number; offsetWidth: number; closest: () => null; scrollIntoView(): void }[] = [];
  const root = {
    querySelector: (s: string) => (s === "[data-rv-comment]" ? box : s === ".rv-err" ? err : null),
    querySelectorAll: (s: string) => (s === "[data-rv-op]" ? opinions : []),
  } as unknown as HTMLElement;
  /** an opinion as drawn in it, by its key */
  const drawn = (key: string) => {
    const el = new FakeEl("div");
    const o = { dataset: { rvOp: key }, classList: el.classList, style: {} as Record<string, string>, flashed: 0, offsetWidth: 1, closest: () => null, scrollIntoView() { this.flashed++; } };
    opinions.push(o);
    return o;
  };
  return { box, err, root, drawn };
}

function reviewBox(g: Graph, d: ReviewData, gone: number[] = []) {
  const hooks = {
    review: () => ({ data: d, error: null, blocked: null, readOnly: false, reviewer: "Carol" }),
    ensureReviewer: async () => "Carol",
    submit: async () => null,
    editedNow: () => false,
    edited: async () => false,
    reviewRoot: () => null,
    go: (i: number) => gone.push(i),
    openSource: () => {},
  } as unknown as ReviewHooks;
  return new ReviewBox(g, hooks);
}

/** A click on the control with data attribute `key` (camel-cased) set to `value`. */
const control = (key: string, value: string) => {
  const t = new FakeEl("button");
  t.dataset[key] = value;
  return t as unknown as HTMLElement;
};

test("Quote on an opinion puts its quote into the box beside it — the panel's or the window's, on that declaration — with a link back; refused past the size of a comment, the text kept", () => {
  const g = graph(["A.f", "A.g"]);
  const d = emptyReview();
  const long = "x".repeat(400);
  record(d, { op: "opinion", name: "A.f", by: "Alice", verdict: "comment", comment: "Why 2?\nAnd not 3?", hash: "h-A.f" }, "tc", AT);
  record(d, { op: "opinion", name: "A.f", by: "Claude", verdict: "comment", comment: long, hash: "h-A.f", agent: true }, "tc", "2026-10-09T09:00:00.000Z");
  record(d, { op: "opinion", name: "A.g", by: "Bob", verdict: "approve", hash: "h-A.g" }, "tc", AT);
  const box = reviewBox(g, d);
  const [f, gi] = [g.byName.get("A.f")!, g.byName.get("A.g")!];
  // drawn: each opinion with a comment has its Quote and its key; one without has no Quote
  const html = box.html(f);
  const key = opinionRef("A.f", "Alice", AT);
  assert.ok(html.includes(`data-rv-op="${key}"`) && html.includes(`data-rv-quote="${key}"`));
  assert.ok(html.includes(`data-rv-quote="${opinionRef("A.f", "Claude", "2026-10-09T09:00:00.000Z")}"`), "an agent's advice is quoted too");
  assert.ok(!box.html(gi).includes("data-rv-quote"));
  assert.match(html, /<div class="rv-c md"><p>Why 2\?\nAnd not 3\?<\/p><\/div>/);
  // a snapshot can be written nothing: nothing to quote into
  const frozen = new ReviewBox(g, { review: () => ({ data: d, error: null, blocked: null, readOnly: true, reviewer: null }), editedNow: () => false, reviewRoot: () => null } as unknown as ReviewHooks);
  assert.ok(!frozen.html(f).includes("data-rv-quote"));

  // the panel on A.g, a pinned window on A.f: Quote in the window fills the window's box, and A.f's
  // draft, the panel's untouched
  const panel = fakeRoot();
  const win = fakeRoot();
  panel.box.value = "my own words on g";
  win.box.value = "Thanks.";
  assert.equal(box.click(control("rvQuote", key), f, win.root), true);
  assert.equal(win.box.value, `Thanks.\n\n> [**Alice** (2026-10-09)](opinion:A.f#Alice@2026-10-09T08:12:30.123Z):\n> Why 2?\n> And not 3?\n\n`);
  assert.deepEqual([win.box.focused, win.box.selectionStart, win.box.value.length], [true, win.box.value.length, win.box.value.length]);
  assert.ok(win.box.rows > 2, "the box grows with what it holds");
  assert.equal(panel.box.value, "my own words on g");
  assert.match(box.html(f), /<textarea class="rv-text" data-rv-comment="A\.f"[^>]*>Thanks\.\n\n&gt; \[\*\*Alice\*\*/, "the draft is kept for the box drawn again");
  // the agent's long advice: attributed as an agent's, trimmed with "…"
  box.click(control("rvQuote", opinionRef("A.f", "Claude", "2026-10-09T09:00:00.000Z")), f, win.root);
  assert.match(win.box.value, /> \[\*\*Claude\*\* \(agent, 2026-10-09\)\]\(opinion:A\.f#Claude@2026-10-09T09:00:00\.000Z\):\n> x{300}…\n\n$/);
  // a quote that would make the comment longer than a comment can be: refused, the text as it was
  win.box.value = "y".repeat(MAX_COMMENT - 20);
  box.click(control("rvQuote", key), f, win.root);
  assert.equal(win.box.value, "y".repeat(MAX_COMMENT - 20));
  assert.equal(win.err.hidden, false);
  assert.match(win.err.textContent, /at most 10,000/);
});

test("source lines quoted in a pinned window go to its own declaration's comment, whatever is selected", () => {
  const g = graph(["A.f", "A.g"]);
  const box = reviewBox(g, emptyReview());
  const [f, gi] = [g.byName.get("A.f")!, g.byName.get("A.g")!];
  // the following window and the panel on A.g (the selection), a window pinned on A.f
  const following = fakeRoot();
  const pinned = fakeRoot();
  const q = quoteCode({ file: "A.lean", name: "A.f", start: 9, lines: ["def f :=", "  2"], first: 0, last: 1 });
  assert.equal(box.insert(pinned.root, f, q), null);
  assert.equal(pinned.box.value, `${q}\n\n`);
  assert.equal(following.box.value, "");
  assert.match(box.html(f), /data-rv-comment="A\.f"[^>]*>\[A\.lean:10–11\]\(source:A\.f#L10-L11\)\n```lean\ndef f :=\n  2\n```/);
  assert.match(box.html(gi), /data-rv-comment="A\.g"[^>]*><\/textarea>/);
  // a window with no box (nothing can be recorded there) takes nothing
  const none = { querySelector: () => null } as unknown as HTMLElement;
  assert.match(box.insert(none, f, q) ?? "", /no comment/);
});

test("a quoted opinion's attribution goes to it: shown in place when it is there, its declaration gone to first when it is another; flashed once where drawn", () => {
  const g = graph(["A.f", "A.g"]);
  const d = emptyReview();
  record(d, { op: "opinion", name: "A.f", by: "Alice", verdict: "comment", comment: "Why?", hash: "h-A.f" }, "tc", AT);
  const gone: number[] = [];
  const box = reviewBox(g, d, gone);
  const [f, gi] = [g.byName.get("A.f")!, g.byName.get("A.g")!];
  const key = opinionRef("A.f", "Alice", AT);
  // clicked where A.f is shown: scrolled to and flashed there, nothing gone to
  const here = fakeRoot();
  const el = here.drawn(key);
  assert.equal(box.click(control("mdOp", key), f, here.root), true);
  assert.deepEqual([gone, el.flashed, el.classList.contains("rv-flash")], [[], 1, true]);
  // clicked in a comment on A.g: A.f is gone to, and flashed where its review is drawn next,
  // scrolled to once
  assert.equal(box.click(control("mdOp", key), gi, fakeRoot().root), true);
  assert.deepEqual(gone, [f]);
  const there = fakeRoot();
  const el2 = there.drawn(key);
  assert.equal(box.reveal(there.root), true);
  assert.deepEqual([el2.flashed, el2.classList.contains("rv-flash"), el2.style.animationDelay], [1, true, ""]);
  // drawn again while it flashes: it flashes on from where it was, and the panel does not jump back
  assert.equal(box.reveal(there.root), true);
  assert.equal(el2.flashed, 1, "scrolled to once");
  assert.match(el2.style.animationDelay, /^-?\d+ms$/);
  // an opinion that is not there any more is said so
  const empty = fakeRoot();
  box.click(control("mdOp", opinionRef("A.f", "Zed", AT)), f, empty.root);
  assert.match(empty.err.textContent, /not in the review now/);
  // a declaration the graph does not hold
  box.click(control("mdOp", opinionRef("Gone.h", "Alice", AT)), f, empty.root);
  assert.match(empty.err.textContent, /Gone\.h is not in the graph now/);
});

// ---------------------------------------------------------------- the agents' API

test("the agents' API gives a comment as it was written: its Markdown, quotes and references as text", async () => {
  const S = await site();
  try {
    const quoted = quoteOpinion("N.b", { by: "Alice", at: AT, comment: "Why `N.a`?" });
    const person = `${quoted}\n\n**Because** of\n\n${quoteCode({ file: "M.lean", name: "N.b", start: 2, lines: ["def b : Nat := a"], first: 0, last: 0 })}\n\n<b>not html</b>`;
    const r = await S.ask("POST", "/api/review", { op: "opinion", name: "N.b", verdict: "comment", comment: person }, { "x-visualproof-name": "Bob" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const agent = "> [**Bob** (2026-10-09)](opinion:N.b#Bob@2026-10-09T08:00:00.000Z):\n> Because\n\nAgreed: `N.a` is *zero*.";
    const AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    const a = await S.ask("POST", "/api/agent/opinion", { name: "N.b", verdict: "comment", comment: agent }, AGENT);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json!.recorded.comment, agent);
    const decl = await S.ask("GET", "/api/agent/declaration?name=N.b", undefined, AGENT);
    assert.equal(decl.status, 200);
    const rv = decl.json!.review;
    assert.equal(rv.opinions.find((o: { by: string }) => o.by === "Bob").comment, person);
    assert.equal(rv.advice.find((o: { by: string }) => o.by === "Claude").comment, agent);
    const act = await S.ask("GET", "/api/agent/activity?name=N.b", undefined, AGENT);
    const comments = (act.json!.events as { kind: string; comment?: string }[]).filter((e) => e.kind === "opinion").map((e) => e.comment);
    assert.deepEqual(comments.sort(), [agent, person].sort());
  } finally {
    await S.close();
  }
});
