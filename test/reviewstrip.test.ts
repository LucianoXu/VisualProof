// The review without "Next to review" (the owner's decisions of 2026-10-12): people review by
// following names in the source window, so the page has no button, key or help line that walks a
// review, and the review strip is one line of progress with nothing to press but its target's name,
// shown wherever the review has a focus and nowhere else. The words "Review view" are gone from the
// page and from what agents are told: a view linked to a target is a view with a ★.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import type { ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../src/shared/graph.ts";
import { emptyReview, record } from "../src/shared/review.ts";
import type { ReviewOp } from "../src/shared/review.ts";
import { Graph } from "../src/shared/viewgraph.ts";
import { ReviewFlow } from "../src/web/src/reviewqueue.ts";

const root = new URL("../src/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
/** The page's wiring: web/src/main.ts and the parts it makes (web/src/page*.ts). */
const wiring = () => ["main.ts", ...readdirSync(new URL("web/src/", root)).filter((f) => /^page.*\.ts$/.test(f)).sort()].map((f) => read(`web/src/${f}`)).join("\n");
const sources = (dir: string) =>
  readdirSync(new URL(dir, root))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [`${dir}${f}`, read(`${dir}${f}`)] as const);
/** What a reader or an agent is shown: the text with the comments taken out, which may speak of
 *  what went. */
const shown = (text: string) =>
  text
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
/** Every source of the page, and the agents' interface. */
const everything = () => [
  ["web/index.html", read("web/index.html")] as const,
  ["web/style.css", read("web/style.css")] as const,
  ...sources("web/src/"),
  ...sources("shared/"),
  ...sources("server/"),
];

/** t's statement uses a and b; a uses c. */
function world() {
  const names = ["N.t", "N.a", "N.b", "N.c"];
  const nodes: ViewNode[] = names.map((name) => ({ name, kind: name === "N.t" ? "theorem" : "def", module: "M", ax: 0, hash: `h-${name}` }));
  const at = (n: string) => names.indexOf(n);
  const edges: number[] = [];
  const use = (u: string, v: string, site: number) => edges.push(at(u), at(v), site);
  use("N.t", "N.a", SITE_STMT);
  use("N.t", "N.b", SITE_STMT);
  use("N.a", "N.c", SITE_BODY);
  const meta = { nodes, projectCount: 4, axioms: [], axiomSets: [[]], layouts: {}, edgeCount: edges.length / 3 } as unknown as ViewMeta;
  return new Graph(meta, new Int32Array(edges));
}

test("no Next to review anywhere: no button in the strip or the panel, no key, no line of help, no agents' equivalent", () => {
  for (const [file, text] of everything()) {
    assert.ok(!/next to review/i.test(shown(text)), `${file} offers Next to review`);
    assert.ok(!/lens-next|lens-advice|rv-next|data-rv-next|q-next|nextToReview|nextKeyFirst|nextAgentComment|canNext/.test(text), `${file} keeps a piece of it`);
  }
  // the keys: n and s do nothing; a, m and k stay
  const main = wiring();
  assert.doesNotMatch(main, /e\.key === "[ns]"/);
  for (const k of ["a", "m", "k"]) assert.match(main, new RegExp(`e\\.key === "${k}"`), `the key ${k} stays`);
  // the help sheet lists no n and no s
  const guide = read("web/src/guide.ts");
  assert.doesNotMatch(guide, /k: \["[ns]"\]/);
  assert.match(guide, /k: \["k"\], what: "mark it key for the focus/);
});

test("the strip is one line of progress: the target's name, the counts, what agents comment on; nothing else to press", () => {
  const g = world();
  const d = emptyReview();
  d.targets["N.t"] = { by: "Alice", at: "2026-10-12T00:00:00Z" };
  let k = 0;
  const op = (name: string, by: string, verdict: "approve" | "comment", agent = false) =>
    record(d, { op: "opinion", name, by, verdict, hash: `h-${name}`, ...(verdict === "comment" ? { comment: "why" } : {}), ...(agent ? { agent: true } : {}) } as ReviewOp, "tc", `2026-10-12T00:00:0${k++}Z`);
  op("N.c", "Alice", "approve");
  op("N.b", "Bob", "comment");
  op("N.a", "Claude", "comment", true);
  const el = () => ({ innerHTML: "", title: "", hidden: false });
  const strip: Record<string, ReturnType<typeof el>> = { "#lens-title": el(), "#lens-meta": el() };
  const doc = globalThis as unknown as { document?: unknown };
  const was = doc.document;
  doc.document = { querySelector: (sel: string) => strip[sel] ?? null };
  try {
    const flow = new ReviewFlow({ graph: () => g, review: () => d, reader: () => "Alice" });
    flow.renderStrip(0);
    const html = strip["#lens-title"].innerHTML + strip["#lens-meta"].innerHTML;
    const text = html.replace(/<[^>]*>/g, "");
    // "Reviewing ★N.t · ◆ 0 / 1 · 1 / 4 approved · 1 commented · Claude comments on 1"
    assert.equal(text, "Reviewing★N.t· ◆0 / 1 · 1 / 4 approved · 1 commented · Claude comments on 1");
    // one control: the target's name, back to the target
    assert.deepEqual(html.match(/<button[^>]*>/g)?.map((b) => /class="lens-target" data-go="0"/.test(b)), [true]);
    assert.doesNotMatch(html, /All reviewed/, "Alice has not given an opinion on everything");
    // her part done: said in the line, still nothing to press
    op("N.a", "Alice", "approve");
    op("N.b", "Alice", "approve");
    op("N.t", "Alice", "approve");
    flow.renderStrip(0);
    assert.match(strip["#lens-meta"].innerHTML.replace(/<[^>]*>/g, ""), /3 \/ 4 approved · 1 commented · Claude comments on 1 · All reviewed ✓$/);
    assert.equal(strip["#lens-meta"].innerHTML.includes("<button"), false);
  } finally {
    doc.document = was;
  }
  // the markup holds the line alone, hidden until a focus shows it
  const html = read("web/index.html");
  const bar = html.slice(html.indexOf('<div id="lensbar"'), html.indexOf("</div>", html.indexOf('<div id="lensbar"')));
  assert.match(bar, /<div id="lensbar" class="glass" hidden>/);
  assert.doesNotMatch(bar, /<button/);
});

test("the strip shows wherever the review has a focus, and not without one", () => {
  const main = wiring();
  const at = main.indexOf("const renderStrip = () => {");
  const body = main.slice(at, main.indexOf("};", at));
  assert.match(body, /const r = reviewRoot\(\);/);
  assert.match(body, /bar\.hidden = r === null;/);
  assert.match(body, /if \(r !== null\) flow\.renderStrip\(r\);/);
});

test("\"Review view\" is no longer in the interface's strings: a view linked to a target is a view with a ★", () => {
  // the title "Review ★T" went with it; "review ★T", a review set's chip, stays
  for (const [file, text] of everything()) assert.ok(!/review view/i.test(shown(text)) && !/Review ★/.test(shown(text)), `${file} says Review view`);
  // the agents' MCP tools and their prompt too
  assert.ok(!/review view/i.test(read("mcp/visualproof-mcp.mjs")), "mcp/visualproof-mcp.mjs");
});
