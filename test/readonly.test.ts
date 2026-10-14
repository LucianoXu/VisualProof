// Read-only access (CollabSpec decision 11): a read-only link made from Share lets its holder read,
// by a cookie that is not the token, and their own Share gives the link they came by; revoked, it
// cuts their pages off at once. --public lets in read-only whoever has no key. A read-only reader
// reads what a guest reads and changes nothing shared (403 whatever the page sends), is seen by
// nobody, never reaches the agents' API, and asks Lean and typesets within bounds.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReadOnlyLinks } from "../src/server/readonly.ts";
import { ReadOnlyBounds, readOnlyAllows } from "../src/server/readonlygate.ts";
import { site, stream } from "./site.ts";

const KEY = "k".repeat(40);
const OWNER = { "x-visualproof-name": "Olivia", authorization: `Bearer ${KEY}` };
type Site = Awaited<ReturnType<typeof site>>;

/** A link opened as a browser opens it: where it goes, and the cookie it leaves. */
async function enter(S: Site, path: string) {
  const r = await fetch(S.base + path, { redirect: "manual" });
  const set = r.headers.getSetCookie();
  return { status: r.status, location: r.headers.get("location"), set, cookie: set.map((c) => c.split(";")[0]).join("; "), text: await r.text() };
}

test("a read-only link lets its holder read, by a cookie that is not the token; their Share gives it back; revoked, it cuts them off", async () => {
  const S = await site({ key: KEY });
  try {
    const made = await S.ask("POST", "/api/share/readonly", {}, OWNER);
    assert.equal(made.status, 200);
    const link = made.json!.made as { id: string; path: string; link: string; by: string };
    assert.match(link.path, /^\/r\/vpr_[0-9a-f]{10}_[A-Za-z0-9_-]{43}$/);
    assert.equal(link.by, "Olivia");
    assert.equal(link.link, `${S.base}${link.path}`);
    // listed for whoever is let in, with its link
    assert.equal((await S.ask("GET", "/api/share/readonly", undefined, OWNER)).json!.links[0].path, link.path);
    const e = await enter(S, link.path);
    assert.equal(e.status, 303);
    assert.equal(e.location, "/");
    assert.ok(!e.cookie.includes(link.path.slice(3)), "the cookie is not the token");
    assert.match(e.set[0], /HttpOnly; SameSite=Lax/);
    // let in to read, as nobody
    const me = await S.ask("GET", "/api/identity", undefined, { cookie: e.cookie, "x-visualproof-name": "Mallory" });
    assert.equal(me.status, 200);
    assert.deepEqual([me.json!.readOnly, me.json!.name], [{ by: "link" }, null]);
    // their Share gives the link they came by
    assert.deepEqual((await S.ask("GET", "/api/share", undefined, { cookie: e.cookie })).json, { path: link.path, readOnly: true });
    // the page renews the cookie
    const page = await fetch(S.base + "/", { headers: { cookie: e.cookie } });
    assert.equal(page.status, 200);
    assert.ok(page.headers.getSetCookie().some((c) => c.startsWith(`${S.live.readOnly.cookieName}=`)));
    // a link not ours, or ours with another secret, is no link
    assert.equal((await enter(S, `/r/vpr_${link.id}_${"A".repeat(43)}`)).status, 404);
    // its stream ends the moment the link is revoked; revoking needs a name
    const s = stream(S.port, "/api/events?session=rrrrrrrr1111", { cookie: e.cookie });
    await s.until(() => !!s.last("hello"));
    assert.equal(S.live.readOnlyStreams(), 1);
    assert.equal((await S.ask("POST", "/api/share/readonly/revoke", { id: link.id }, { authorization: `Bearer ${KEY}` })).status, 401);
    assert.equal((await S.ask("POST", "/api/share/readonly/revoke", { id: link.id }, OWNER)).status, 200);
    await s.until(() => S.live.readOnlyStreams() === 0);
    s.close();
    const again = await enter(S, link.path);
    assert.equal(again.status, 410);
    assert.match(again.text, /revoked by Olivia/);
    const out = await fetch(S.base + "/api/identity", { headers: { cookie: e.cookie } });
    assert.equal(out.status, 404);
    assert.ok(out.headers.getSetCookie().some((c) => c.startsWith(`${S.live.readOnly.cookieName}=;`) && /Max-Age=0/.test(c)));
  } finally {
    await S.close();
  }
});

test("a read-only reader reads what a guest reads, and is refused everything that changes what is shared", async () => {
  const S = await site({ key: KEY });
  try {
    const link = (await S.ask("POST", "/api/share/readonly", {}, OWNER)).json!.made.path as string;
    const { cookie } = await enter(S, link);
    const as = { cookie, "x-visualproof-name": "Mallory" };
    const before = JSON.stringify(S.live.review.whole());
    for (const p of ["/api/status", "/api/meta", "/api/edges", "/api/review", "/api/activity", "/api/views", "/api/history", "/api/library", "/api/source?module=M"]) {
      const r = await S.ask("GET", p, undefined, as);
      assert.ok(r.status === 200, `${p}: ${r.status}`);
    }
    const writes: [string, string, unknown][] = [
      ["POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }],
      ["POST", "/api/presence", { token: "x" }],
      ["POST", "/api/identity", { name: "Mallory" }],
      ["POST", "/api/views/create", { name: "Mine" }],
      ["POST", "/api/views/open", { scope: "all" }],
      ["POST", "/api/views/memory", { memory: {} }],
      ["POST", "/api/history/archive", {}],
      ["POST", "/api/library/url", { url: "https://example.org/a.pdf" }],
      ["POST", "/api/layout/undo", { id: 1 }],
      ["POST", "/api/chat/new", {}],
      ["POST", "/api/ask", {}],
      ["GET", "/api/chat", undefined],
      ["GET", "/api/share/agents", undefined],
      ["GET", "/api/share/people", undefined],
      ["GET", "/api/share/readonly", undefined],
      ["POST", "/api/share/readonly", {}],
      ["GET", "/api/agent", undefined],
    ];
    for (const [m, p, body] of writes) {
      const r = await S.ask(m, p, body, as);
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.json!.readOnly, true);
    }
    // nothing was written
    assert.equal(JSON.stringify(S.live.review.whole()), before);
  } finally {
    await S.close();
  }
});

test("a read-only reader is seen by nobody: not listed, not counted, never asked to follow; their streams have a bound of their own", async () => {
  const S = await site({ key: KEY, publicRead: true });
  try {
    const guest = stream(S.port, "/api/events?session=gggggggg1111", { authorization: `Bearer ${KEY}` });
    const reader = stream(S.port, "/api/events?session=rrrrrrrr2222");
    await guest.until(() => !!guest.last("hello"));
    await reader.until(() => !!reader.last("hello"));
    const hello = guest.last("hello") as { token: string };
    assert.equal((await S.ask("POST", "/api/presence", { token: hello.token, view: null }, { authorization: `Bearer ${KEY}`, "x-visualproof-name": "Gus" })).status, 200);
    // the reader cannot beat, so is neither listed nor counted as a private reader
    assert.equal((await S.ask("POST", "/api/presence", { token: (reader.last("hello") as { token: string }).token, private: true }, {})).status, 403);
    await guest.until(() => ((guest.last("presence") as { name: string }[] | undefined) ?? []).some((p) => p.name === "Gus"));
    assert.deepEqual((guest.last("presence") as { name: string }[]).map((p) => p.name), ["Gus"]);
    assert.equal(S.live.presence.privateCount(), 0);
    // asked by nobody: Gus asking everyone asks nobody, the reader being nobody to ask
    const asked = await S.ask("POST", "/api/ask", { everyone: true, token: hello.token }, { authorization: `Bearer ${KEY}`, "x-visualproof-name": "Gus" });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    assert.deepEqual([asked.json!.asked, asked.json!.private], [[], 0]);
    // counted apart: they take no place of the people working
    const st = (S.live.status() as { streams: { open: number; readOnly: number } }).streams;
    assert.deepEqual([st.open, st.readOnly], [2, 1]);
    guest.close();
    reader.close();
  } finally {
    await S.close();
  }
});

test("--public: whoever has no key reads, by the address alone; no agent does; without it they are not let in", async () => {
  const open = await site({ key: KEY, publicRead: true });
  try {
    const me = await open.ask("GET", "/api/identity");
    assert.deepEqual([me.status, me.json!.readOnly], [200, { by: "public" }]);
    assert.deepEqual((await open.ask("GET", "/api/share")).json, { path: "/", readOnly: true });
    assert.equal((await open.ask("POST", "/api/review", {}, { "x-visualproof-name": "Mallory" })).status, 403);
    // an agent without the key or a token of its own is not let in, to read or else
    assert.equal((await open.ask("GET", "/api/agent", undefined, { "x-visualproof-name": "Bot", "x-visualproof-kind": "agent" })).status, 404);
    // the key still lets in a guest, who may write, and is told so
    const guest = await open.ask("GET", "/api/share", undefined, OWNER);
    assert.deepEqual([guest.json!.readOnly, guest.json!.readOnlyLinks, guest.json!.public], [undefined, true, true]);
  } finally {
    await open.close();
  }
  const closed = await site({ key: KEY });
  try {
    assert.equal((await closed.ask("GET", "/api/identity")).status, 404);
  } finally {
    await closed.close();
  }
});

test("no read-only links where everyone is in already, or behind a sign-in", async () => {
  const S = await site();
  try {
    assert.equal((await S.ask("POST", "/api/share/readonly", {}, { "x-visualproof-name": "Olivia" })).status, 404);
    assert.equal((await S.ask("GET", "/api/share")).json!.readOnlyLinks, false);
  } finally {
    await S.close();
  }
  const P = await site({ key: KEY, identityHeader: "X-Forwarded-User" });
  try {
    assert.equal((await P.ask("POST", "/api/share/readonly", {}, { authorization: `Bearer ${KEY}`, "x-forwarded-user": "Olivia" })).status, 404);
    assert.equal((await enter(P, `/r/vpr_0123456789_${"A".repeat(43)}`)).status, 404);
  } finally {
    await P.close();
  }
});

test("what a read-only reader may ask, by method and path", () => {
  for (const p of ["/", "/style.css", "/app.js", "/pdfjs/x", "/api/meta", "/api/views/view", "/api/history/graph", "/api/library/text", "/api/export/job", "/api/hover/describe", "/api/share", "/api/events"]) assert.ok(readOnlyAllows("GET", p), p);
  for (const p of ["/api/hover/open", "/api/hover/names", "/api/export"]) assert.ok(readOnlyAllows("POST", p), p);
  for (const p of ["/api/review", "/api/views/open", "/api/presence", "/api/identity", "/api/library/upload", "/api/share/readonly", "/api/agent/opinion"]) assert.ok(!readOnlyAllows("POST", p), p);
  for (const p of ["/api/agent", "/api/chat", "/api/share/agents", "/api/share/people", "/api/share/readonly", "/k/x"]) assert.ok(!readOnlyAllows("GET", p), p);
});

test("Lean's answers to read-only readers: within bounds per address and in all, each kept per build; one document typeset at a time", () => {
  const b = new ReadOnlyBounds();
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) assert.equal(b.leanWait("a", t + i), 0);
  const w = b.leanWait("a", t + 100);
  assert.ok(w >= 1 && w <= 60, `waits ${w} s`);
  assert.equal(b.leanWait("b", t + 100), 0, "another address is not held by the first");
  // in all: 300 a minute, whatever the addresses
  for (let i = 0; i < 239; i++) assert.equal(b.leanWait(`x${i}`, t + 200), 0);
  assert.ok(b.leanWait("y", t + 300) > 0);
  assert.equal(b.leanWait("y", t + 61_000), 0, "a minute later");
  // answers kept, the oldest going first
  b.keep("k1", { a: 1 });
  assert.deepEqual(b.answer("k1"), { a: 1 });
  for (let i = 0; i < 2000; i++) b.keep(`n${i}`, i);
  assert.equal(b.answer("k1"), undefined);
  // documents
  let running = true;
  const d = new ReadOnlyBounds(() => running);
  assert.ok(d.mayExport());
  d.exporting = "job1";
  assert.ok(!d.mayExport());
  running = false;
  assert.ok(d.mayExport());
});

test("the links are kept, readable by the server's user alone, and read again; a file that cannot be read is set aside", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-readonly-"));
  try {
    const a = new ReadOnlyLinks(dir);
    const l = a.create("Olivia");
    a.close();
    const file = join(dir, "readonly-links.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const b = new ReadOnlyLinks(dir);
    assert.equal(b.cookieName, a.cookieName);
    assert.equal(b.list()[0].path, l.path);
    assert.ok(b.check(l.path.slice(3)) && "ok" in b.check(l.path.slice(3))!);
    b.close();
    writeFileSync(file, "{not json");
    const c = new ReadOnlyLinks(dir);
    assert.deepEqual(c.list(), []);
    c.close();
    const aside = readdirSync(dir).filter((f) => f.startsWith("readonly-links.json.broken-"));
    assert.equal(aside.length, 1);
    assert.equal(readFileSync(join(dir, aside[0]), "utf8"), "{not json", "set aside as it was");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
