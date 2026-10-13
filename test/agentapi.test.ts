// What an agent reads before it does anything, kept small: the entry (GET /api/agent), the
// documentation in topics (docs/agent-api/, GET /api/agent/docs), and the MCP server's tools —
// fewer, each of one domain's operations by its action, offered as the caller's level allows. Every
// request a tool makes, and every endpoint the entry and the documentation name, is one the server
// answers.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DOC_TOPICS } from "../src/server/agentdocs.ts";
import { claudeCodeSteps, mcpInstall, mcpInstructions, routes, TOOLS } from "../src/server/mcptools.ts";
import { agentPrompt } from "../src/server/prompt.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const ROOT = join(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs", "agent-api");
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const LEVELS = ["read", "advise", "full"] as const;
/** what each level allows of what an endpoint needs */
const ALLOWS: Record<string, (needs?: string) => boolean> = { read: (n) => !n, advise: (n) => !n || n.includes("advise"), full: () => true };

/** The budgets: what an agent loads first stays within them. */
const ENTRY_MAX = 6000;
const TOPIC_MAX = 15_000;
const DOCS_MAX = 110_000;
const TOOLS_LIST_MAX = 28_000;

test("the entry is small: who you are, how to begin, the rules, the topics, the most used endpoints — at every level, within its budget", async () => {
  const S = await site();
  try {
    const reference = (await S.ask("GET", "/api/agent/endpoints", undefined, { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" })).json!.endpoints as Json[];
    for (const level of LEVELS) {
      // the longest name a token takes
      const { token } = S.live.tokens.create({ name: `${"N".repeat(57)} ${level[0]}`, by: "B".repeat(60), level, days: 30 });
      const r = await fetch(`${S.base}/api/agent`, { headers: bearer(token) });
      const text = await r.text();
      assert.ok(Buffer.byteLength(text) <= ENTRY_MAX, `${level}: ${Buffer.byteLength(text)} bytes`);
      const e = JSON.parse(text);
      assert.deepEqual(Object.keys(e), ["about", "you", "level", "requests", "start", "rules", "docs", "topics", "endpoints", "errors", "graph"]);
      assert.equal(e.you.level, level);
      assert.ok(e.start.length >= 3 && e.start.length <= 5, level);
      assert.ok(e.endpoints.length >= 10 && e.endpoints.length <= 15, level);
      // a line each, the topics with their address
      for (const line of [...e.rules, ...e.topics, ...e.endpoints, ...e.start]) assert.ok(!line.includes("\n") && line.length <= 240, line);
      assert.deepEqual(e.topics.map((t: string) => t.split(":")[0]), DOC_TOPICS.map((d) => `/api/agent/docs/${d.topic}`));
      // the endpoints it names are the table's own, as the reference lists them
      for (const line of e.endpoints) {
        const [method, path] = line.split(/[ ?:{]/).filter(Boolean);
        assert.ok(reference.some((x) => x.method === method && x.path === path), line);
      }
      assert.match(e.rules.join("\n"), /Your opinions stay advice at every level/);
      assert.equal(e.rules.some((x: string) => /first wait after you join may bring earlier messages/.test(x)), true, "a token is told it may be talked to");
    }
  } finally {
    await S.close();
  }
});

test("the documentation: an index and one file per topic, each served as Markdown, each within its budget, every link resolving", async () => {
  const files = readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(files, ["README.md", ...DOC_TOPICS.map((d) => `${d.topic}.md`)].sort(), "the topics are the folder's files");
  let total = 0;
  const texts = new Map(files.map((f) => [f, readFileSync(join(DOCS, f), "utf8")]));
  for (const [f, md] of texts) {
    const size = Buffer.byteLength(md);
    total += size;
    assert.ok(size <= TOPIC_MAX, `${f}: ${size} bytes`);
    assert.match(md, /^# \S/, `${f} starts with its title`);
    assert.equal((md.match(/^```/gm) ?? []).length % 2, 0, `${f}: every code block is closed`);
    // relative links: to a file of the folder, and to a heading there (code is no link)
    for (const [, target] of prose(md).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const [file, anchor] = target.split("#");
      const to = file === "" ? f : file;
      assert.ok(texts.has(to), `${f} links to ${target}`);
      if (anchor) assert.ok(headings(texts.get(to)!).includes(anchor), `${f} links to ${target}: no such heading`);
    }
  }
  assert.ok(total <= DOCS_MAX, `in all ${total} bytes`);
  // the README lists every topic, linked
  for (const d of DOC_TOPICS) assert.ok(texts.get("README.md")!.includes(`](${d.topic}.md)`), d.topic);
  // the rest of the repository links to the folder, never to the manual it replaced
  for (const f of ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/MANUAL.md"]) {
    const md = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(md, /AGENT-API/, f);
    for (const [, target] of md.matchAll(/\]\(([^)\s#]*agent-api[^)\s#]*)/g)) assert.ok(existsSync(join(dirname(join(ROOT, f)), target)), `${f} links to ${target}`);
  }

  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 });
    const get = async (path: string) => {
      const r = await fetch(`${S.base}${path}`, { headers: bearer(token) });
      return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
    };
    const index = await get("/api/agent/docs");
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/markdown/);
    assert.equal(index.text, texts.get("README.md"));
    for (const d of DOC_TOPICS) {
      const t = await get(`/api/agent/docs/${d.topic}`);
      assert.equal(t.status, 200, d.topic);
      assert.match(t.type, /text\/markdown/);
      assert.equal(t.text, texts.get(`${d.topic}.md`), d.topic);
      assert.equal((await get(`/api/agent/docs?topic=${d.topic}`)).text, t.text, "?topic= is the same");
    }
    for (const bad of ["/api/agent/docs/nope", "/api/agent/docs/README", "/api/agent/docs/..%2Fwords", "/api/agent/docs?topic=../README"]) {
      const r = await get(bad);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(JSON.parse(r.text).topics, DOC_TOPICS.map((d) => d.topic), bad);
    }
    assert.equal((await get("/api/agent/docs/words/more")).status, 404);
  } finally {
    await S.close();
  }
});

test("every endpoint is documented, and every endpoint the entry, the documentation, the tools, the prompt and the install text name is one the server answers", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "full", days: 1 });
    const reference = (await S.ask("GET", "/api/agent/endpoints", undefined, bearer(token))).json!.endpoints as Json[];
    const paths = new Set(reference.map((e) => e.path));
    const docs = readdirSync(DOCS).map((f) => readFileSync(join(DOCS, f), "utf8")).join("\n");
    // documented: by its full path, or under /api/agent as a table or a heading names it ("GET
    // library/text?…", "`/note/move`"); a path of one part, with its method
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const e of reference) {
      const rest = e.path.replace(/^\/api\/agent\/?/, "").replace("{topic}", "<topic>");
      const short = rest.includes("/") ? `(?<![\\w/-])/?${esc(rest)}` : `${e.method} ${esc(rest)}`;
      const named = new RegExp(`(${esc(e.path.replace("{topic}", "<topic>"))}|${short})(?![\\w/-])`);
      assert.ok(named.test(docs), `${e.method} ${e.path} is not in the documentation`);
    }
    // named: every /api/agent path in what agents read
    const entry = await (await fetch(`${S.base}/api/agent`, { headers: bearer(token) })).text();
    const offer = (await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(token))).json!;
    const texts: Record<string, string> = {
      docs,
      entry,
      tools: JSON.stringify(offer.tools.map((t: Json) => [t.description, t.inputSchema])),
      instructions: offer.instructions,
      prompt: agentPrompt({ url: "http://h", token: "vpa_x", record: { name: "Bot", by: "Alice", level: "full", expires: "2026-10-09T10:00:00.000Z" } }),
      install: mcpInstall("http://h") + claudeCodeSteps("http://h", "t"),
      reference: JSON.stringify(reference.map((e) => [e.about, e.params, e.returns])),
    };
    for (const [what, text] of Object.entries(texts))
      for (const [m] of text.matchAll(/\/api\/agent(\/[a-z][a-z0-9/-]*)?/g)) {
        const p = m.replace(/\/+$/, "");
        const topic = /^\/api\/agent\/docs\/([a-z-]+)$/.exec(p)?.[1];
        assert.ok(paths.has(p) || DOC_TOPICS.some((d) => d.topic === topic), `${what} names ${m}, which no endpoint answers`);
      }
  } finally {
    await S.close();
  }
});

test("each tool's request, or each of its actions', is an endpoint, and its arguments are that endpoint's parameters", async () => {
  const S = await site();
  try {
    const reference = (await S.ask("GET", "/api/agent/endpoints", undefined, { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" })).json!.endpoints as Json[];
    assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length, "names are unique");
    assert.ok(TOOLS.length >= 20 && TOOLS.length <= 25, `${TOOLS.length} tools`);
    for (const r of routes()) {
      const what = `${r.tool}${r.action ? ` ${r.action}` : ""}`;
      const e = reference.find((x) => x.method === r.route.method && x.path === r.route.path);
      assert.ok(e, `${what}: no endpoint ${r.route.method} ${r.route.path}`);
      // what the MCP server takes for itself: the file it saves to, the file it sends
      const own = new Set([...(r.route.saves ? ["saveTo"] : []), ...(r.route.sends ? ["path"] : [])]);
      const params = new Set(Object.keys(e.params).flatMap((k) => k.split(", ")));
      for (const a of r.args) assert.ok(params.has(a) || own.has(a), `${what}: ${a} is no parameter of ${e.method} ${e.path}`);
    }
    for (const t of TOOLS) {
      assert.ok(!!t.call !== !!t.actions, `${t.name}: a request, or actions`);
      // wait_for_message says how to listen, for a client that shows no instructions
      assert.ok((t.about.length <= 400 || t.name === "wait_for_message") && t.about.split(/[.!?](\s|$)/).filter((x) => x?.trim()).length <= 3, `${t.name}: a sentence or two`);
      for (const [k, s] of Object.entries(t.args)) assert.ok(s.description.length <= 200, `${t.name}.${k}: a short description`);
      if (!t.actions) continue;
      assert.ok(!("action" in t.args), t.name);
      const used = new Set(Object.values(t.actions).flatMap((a) => a.args));
      for (const k of Object.keys(t.args)) assert.ok(used.has(k), `${t.name}: no action takes ${k}`);
      for (const a of Object.values(t.actions)) for (const k of a.args) assert.ok(k in t.args, `${t.name}: ${k} has no schema`);
      if (t.default) assert.ok(t.default in t.actions, t.name);
    }
  } finally {
    await S.close();
  }
});

test("a level is offered the tools and actions it allows, with their arguments, and is refused the rest as before; the list stays small", async () => {
  const S = await site();
  try {
    const reference = (await S.ask("GET", "/api/agent/endpoints", undefined, { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" })).json!.endpoints as Json[];
    const needs = (r: { method: string; path: string }) => reference.find((e) => e.method === r.method && e.path === r.path)!.needs as string | undefined;
    for (const level of LEVELS) {
      const { token } = S.live.tokens.create({ name: `Bot ${level}`, by: "Alice", level, days: 1 });
      const offer = (await S.ask("GET", "/api/agent/mcp/tools", undefined, bearer(token))).json!;
      const tools = offer.tools as Json[];
      for (const d of TOOLS) {
        const t = tools.find((x) => x.name === d.name);
        if (d.call) {
          assert.equal(!!t, ALLOWS[level](needs(d.call)), `${d.name} at ${level}`);
          if (t) assert.deepEqual(t.call, d.call);
          continue;
        }
        const allowed = Object.entries(d.actions!).filter(([, a]) => ALLOWS[level](needs(a))).map(([k]) => k);
        if (!allowed.length) {
          assert.equal(t, undefined, `${d.name} at ${level}: no action, no tool`);
          continue;
        }
        assert.ok(t, `${d.name} at ${level}`);
        assert.deepEqual(t.inputSchema.properties.action.enum, allowed, `${d.name} at ${level}`);
        assert.deepEqual(Object.keys(t.call.actions), allowed);
        // the arguments of the actions allowed, and no other
        const args = new Set(allowed.flatMap((k) => d.actions![k].args));
        assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ["action", ...args].sort(), `${d.name} at ${level}`);
        assert.equal(t.inputSchema.required?.includes("action") ?? false, !allowed.includes(d.default ?? ""), `${d.name} at ${level}: action required without a default`);
        for (const k of allowed) assert.match(t.description, new RegExp(`\\b${k} \\(`), `${d.name} at ${level} says what ${k} does`);
        for (const k of Object.keys(d.actions!).filter((x) => !allowed.includes(x))) assert.doesNotMatch(t.description, new RegExp(`; ${k} \\(|: ${k} \\(`), `${d.name} at ${level} does not offer ${k}`);
      }
      // the list a client loads, within its budget; the documentation's topics beside it
      const list = JSON.stringify({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      assert.ok(Buffer.byteLength(list) <= TOOLS_LIST_MAX, `${level}: tools/list is ${Buffer.byteLength(list)} bytes`);
      assert.ok(tools.length >= 20 && tools.length <= 25, `${level}: ${tools.length} tools`);
      assert.deepEqual(offer.docs.map((d: Json) => d.topic), DOC_TOPICS.map((d) => d.topic));
      assert.deepEqual(tools.find((t) => t.name === "docs")!.inputSchema.properties.topic.enum, DOC_TOPICS.map((d) => d.topic));
      assert.match(offer.instructions, /docs tool/);
      assert.ok(mcpInstructions({ name: "N".repeat(60), by: "B".repeat(60), level, expires: "2026-10-09T10:00:00.000Z", address: "https://visualproof.example.org:4173", project: "flt_regular" }).length <= 2048, level);
    }
    // the server still refuses what a level does not allow, saying why
    const { token: reader } = S.live.tokens.create({ name: "Reader", by: "Alice", level: "read", days: 1 });
    for (const [path, body] of [["/api/agent/note", { name: "N.a", text: "here" }], ["/api/agent/opinion", { name: "N.a", verdict: "approve" }], ["/api/agent/views/create", { name: "Mine" }]] as const) {
      const r = await S.ask("POST", path, body, bearer(reader));
      assert.equal(r.status, 403, path);
      assert.ok(r.json!.hint, path);
    }
  } finally {
    await S.close();
  }
});

test("one request answers for several: declaration takes names, opinion takes opinions, as the batch endpoints answer them", async () => {
  const S = await site();
  try {
    const { token } = S.live.tokens.create({ name: "Bot", by: "Alice", level: "advise", days: 1 });
    const many = (await S.ask("GET", "/api/agent/declaration?names=N.a,N.zz", undefined, bearer(token))).json!;
    assert.deepEqual(many, (await S.ask("GET", "/api/agent/declarations?names=N.a,N.zz", undefined, bearer(token))).json);
    assert.deepEqual([many.count, many.found, many.declarations[1].status], [2, 1, 404]);
    const r = await S.ask("POST", "/api/agent/opinion", { opinions: [{ name: "N.a", verdict: "approve", comment: "zero" }, { name: "N.zz", verdict: "approve" }] }, bearer(token));
    assert.equal(r.status, 200);
    assert.deepEqual([r.json!.recorded, r.json!.refused, r.json!.results.map((x: Json) => x.status)], [1, 1, [200, 404]]);
  } finally {
    await S.close();
  }
});

/** Markdown without its code: fenced blocks and inline code. */
function prose(md: string): string {
  return md.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
}

/** The anchors of a Markdown file's headings, as GitHub makes them. */
function headings(md: string): string[] {
  return [...md.matchAll(/^#{1,6} (.+)$/gm)].map(([, h]) =>
    h
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-"),
  );
}
