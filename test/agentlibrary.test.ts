// The library for agents (AttachmentSpec decision 20): what the page does with the library, its
// files' text and pages, and the links, an agent does through its API and the MCP server's tools —
// reading at every level, adding files and links at advise, changing what others made at full
// (AgentSpec decision 9) — and it shows the reference window to the people who follow it, as its view
// shows them a declaration.

import assert from "node:assert/strict";
import { test } from "node:test";
import { routes, TOOLS } from "../src/server/mcptools.ts";
import { MAGIC, tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";

const PDF = tinyPdf([["Let G be a game between an adversary and a challenger."], ["Theorem 3. Halving undoes doubling."]], "Games");
const agent = (name = "Claude") => ({ "x-visualproof-name": name, "x-visualproof-kind": "agent" });

/** Upload bytes as an agent, its body the file. */
async function agentUpload(base: string, bytes: Buffer, name = "Claude", query = "name=games.pdf") {
  const r = await fetch(`${base}/api/agent/library/upload?${query}`, { method: "POST", headers: { ...agent(name), "content-type": "application/pdf" }, body: new Uint8Array(bytes) });
  return { status: r.status, json: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("an agent reads the library at every level, and at level read changes nothing", async () => {
  const S = await site({ agents: "read" });
  try {
    const up = await fetch(`${S.base}/api/library/upload?name=games.pdf`, { method: "POST", headers: { "x-visualproof-name": "Alice" }, body: new Uint8Array(PDF) });
    const sha = ((await up.json()) as { file: { sha: string } }).file.sha;
    const list = await S.ask("GET", "/api/agent/library", undefined, agent());
    assert.equal(list.json!.files[0].sha, sha);
    const text = await S.ask("GET", `/api/agent/library/text?sha=${sha}&page=2`, undefined, agent());
    assert.match(text.json!.text, /Halving undoes doubling/);
    const found = await S.ask("GET", `/api/agent/library/search?sha=${sha}&q=adversary`, undefined, agent());
    assert.equal(found.json!.matches[0].page, 1);
    // a page as an image, for an agent that reads images
    const page = await fetch(`${S.base}/api/agent/library/page?sha=${sha}&page=1&width=400`, { headers: agent() });
    assert.equal(page.headers.get("content-type"), "image/png");
    assert.ok(Buffer.from(await page.arrayBuffer()).subarray(0, 8).equals(MAGIC.png.subarray(0, 8)));
    // nothing written
    assert.equal((await agentUpload(S.base, PDF)).status, 403);
    const link = await S.ask("POST", "/api/agent/link", { subject: "decl(N.a)", file: sha, page: 1 }, agent());
    assert.equal(link.status, 403);
    assert.match(link.json!.hint, /advise/);
    assert.equal((await S.ask("POST", "/api/library/link", { subject: "decl(N.a)", file: sha, page: 1 }, agent())).status, 403, "nor through the page's door");
  } finally {
    await S.close();
  }
});

test("at level advise an agent adds files and links, and changes its own; what others made only at level full", async () => {
  const S = await site({ agents: "advise" });
  try {
    // uploaded as its bytes; an MCP server from before uploads sends a path, and is told to update
    const old = await fetch(`${S.base}/api/agent/library/upload?name=x.pdf`, { method: "POST", headers: { ...agent(), "content-type": "application/json" }, body: JSON.stringify({ file: "/home/me/x.pdf" }) });
    assert.equal(old.status, 400);
    assert.match(((await old.json()) as { hint: string }).hint, /MCP server/);
    const up = await agentUpload(S.base, PDF);
    assert.equal(up.status, 200, JSON.stringify(up.json));
    assert.equal(up.json.file.agent, true);
    assert.equal(up.json.change, undefined, "the review's change is the pages'");
    const sha = up.json.file.sha;
    const made = await S.ask("POST", "/api/agent/link", { subject: "decl(N.a)", file: sha, page: 2, quote: { text: "Halving undoes doubling.", before: "Theorem 3." }, label: "Theorem 3, p. 2" }, agent());
    assert.equal(made.status, 200);
    assert.equal(made.json!.link.agent, true);
    assert.equal(made.json!.link.by, "Claude");
    // its own, edited; a person's, not
    assert.equal((await S.ask("POST", "/api/agent/link/edit", { id: made.json!.link.id, region: [0.1, 0.05, 0.5, 0.1] }, agent())).status, 200);
    const person = await S.ask("POST", "/api/library/link", { subject: "ns(N)", file: sha, page: 1 }, { "x-visualproof-name": "Alice" });
    const id = person.json!.link.id;
    assert.equal((await S.ask("POST", "/api/agent/link/edit", { id, label: "mine now" }, agent())).status, 403);
    assert.equal((await S.ask("POST", "/api/agent/unlink", { id }, agent())).status, 403);
    // another agent's is another's
    assert.equal((await S.ask("POST", "/api/agent/unlink", { id: made.json!.link.id }, agent("Other"))).status, 403);
    // a file someone else added: archived at full only
    const theirs = await fetch(`${S.base}/api/library/upload?name=b.pdf`, { method: "POST", headers: { "x-visualproof-name": "Alice" }, body: new Uint8Array(tinyPdf([["Another."]])) });
    const tsha = ((await theirs.json()) as { file: { sha: string } }).file.sha;
    assert.equal((await S.ask("POST", "/api/agent/library/archive", { sha: tsha }, agent())).status, 403);
    assert.equal((await S.ask("POST", "/api/agent/library/archive", { sha }, agent())).status, 200);
    // nor restored by adding its bytes again, once a person archived it; its own, it restores so
    assert.equal((await S.ask("POST", "/api/library/archive", { sha: tsha }, { "x-visualproof-name": "Alice" })).status, 200);
    const again = await agentUpload(S.base, tinyPdf([["Another."]]), "Claude", "name=b.pdf");
    assert.equal(again.status, 403, JSON.stringify(again.json));
    assert.match(again.json.error, /archived by Alice/);
    assert.equal((await S.ask("GET", "/api/agent/library", undefined, agent())).json!.archived.length, 2, "both still archived");
    // links listed by subject and by file
    const bySubject = await S.ask("GET", `/api/agent/links?subject=${encodeURIComponent("decl(N.a)")}`, undefined, agent());
    assert.deepEqual(bySubject.json!.links.map((l: { label: string }) => l.label), ["Theorem 3, p. 2"]);
    assert.equal(bySubject.json!.links[0].archived, true);
    const byFile = await S.ask("GET", `/api/agent/links?file=${sha}`, undefined, agent());
    assert.equal(byFile.json!.links.length, 2);
  } finally {
    await S.close();
  }
});

test("at level full an agent edits, removes and archives what others made; everything it does is marked as an agent's", async () => {
  const S = await site({ agents: "full" });
  try {
    const up = await fetch(`${S.base}/api/library/upload?name=games.pdf`, { method: "POST", headers: { "x-visualproof-name": "Alice" }, body: new Uint8Array(PDF) });
    const sha = ((await up.json()) as { file: { sha: string } }).file.sha;
    const id = (await S.ask("POST", "/api/library/link", { subject: "decl(N.b)", file: sha, page: 1 }, { "x-visualproof-name": "Alice" })).json!.link.id;
    const ed = await S.ask("POST", "/api/agent/link/edit", { id, label: "The game, p. 1" }, agent());
    assert.equal(ed.status, 200);
    assert.deepEqual(ed.json!.link.edited, { by: "Claude", at: ed.json!.link.edited.at, agent: true });
    assert.equal((await S.ask("POST", "/api/agent/library/edit", { sha, title: "Games (retitled)" }, agent())).json!.file.edited.agent, true);
    assert.equal((await S.ask("POST", "/api/agent/library/archive", { sha }, agent())).status, 200);
    assert.equal((await S.ask("POST", "/api/agent/library/archive", { sha, on: false }, agent())).status, 200);
    assert.equal((await S.ask("POST", "/api/agent/unlink", { id }, agent())).status, 200);
  } finally {
    await S.close();
  }
});

test("an agent shows the reference window to those who follow it: a link's place, or a file at a page; null closes it", async () => {
  const S = await site({ agents: "advise" });
  try {
    const up = await fetch(`${S.base}/api/library/upload?name=games.pdf`, { method: "POST", headers: { "x-visualproof-name": "Alice" }, body: new Uint8Array(PDF) });
    const sha = ((await up.json()) as { file: { sha: string } }).file.sha;
    const id = (await S.ask("POST", "/api/library/link", { subject: "decl(N.b)", file: sha, page: 2, label: "Theorem 3" }, { "x-visualproof-name": "Alice" })).json!.link.id;
    const v = await S.ask("POST", "/api/agent/view", { sel: "N.b", source: true, paper: { link: id } }, agent());
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.deepEqual(v.json!.view.paper, { file: sha, page: 2, link: id });
    assert.match(v.json!.followersSee, /reference window on "Games" at page 2, the link lit/);
    const peer = S.live.presence.list().find((p) => p.agent && p.name === "Claude");
    assert.deepEqual(peer?.view?.paper, { file: sha, page: 2, link: id });
    const page = await S.ask("POST", "/api/agent/view", { paper: { file: sha, page: 1 } }, agent());
    assert.deepEqual(page.json!.view.paper, { file: sha, page: 1 });
    assert.equal((await S.ask("POST", "/api/agent/view", { paper: { file: sha, page: 9 } }, agent())).status, 400);
    const closed = await S.ask("POST", "/api/agent/view", { paper: null }, agent());
    assert.equal(closed.json!.view.paper, undefined);
  } finally {
    await S.close();
  }
});

test("the MCP server's tools for the library: reading at every level, adding at advise; a file sent from the agent's machine, a page handed over as an image", async () => {
  const route = (tool: string, action: string) => routes().find((r) => r.tool === tool && r.action === action)!.route;
  assert.equal(route("library", "add_file").sends, true);
  assert.equal(route("library", "save").saves, true);
  const view = TOOLS.find((t) => t.name === "view")!;
  assert.ok(view.args.paper, "the view tool shows the reference window");
  assert.match(String((view.args.paper as { description?: string }).description), /^the reference window/);
  // what each level is offered: reading at every level, adding and tidying from advise
  const S = await site();
  try {
    const actions = async (level: "read" | "advise", tool: string) => {
      const { token } = S.live.tokens.create({ name: `Lib ${tool} ${level}`, by: "Alice", level, days: 1 });
      const tools = (await S.ask("GET", "/api/agent/mcp/tools", undefined, { authorization: `Bearer ${token}` })).json!.tools as { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[];
      return tools.find((t) => t.name === tool)?.inputSchema.properties.action.enum;
    };
    const reading = ["list", "file", "text", "search", "page", "clip", "save"];
    assert.deepEqual(await actions("read", "library"), reading);
    assert.deepEqual(await actions("advise", "library"), [...reading, "add_url", "add_file", "edit", "archive"]);
    assert.deepEqual(await actions("read", "links"), ["list"]);
    assert.deepEqual(await actions("advise", "links"), ["list", "make", "edit", "remove"]);
  } finally {
    await S.close();
  }
});
