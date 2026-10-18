// The page for whoever arrives without the key (CollabSpec decisions 7 and 12, the owner's decision
// of 2026-10-18): a browser asking for a page is shown that the site is private, or that its link
// does not open it, or — a server without a key reached by a name it does not answer — what whoever
// runs it can do; 403, the same bytes on every server, nothing of the site in it. The API, the event
// stream, agents and files keep their answers. --public and a sign-in in front are as they were.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { test } from "node:test";
import { ACCESS_PAGE_CSP, accessPageHtml, asksForPage } from "../src/server/accesspage.ts";
import type { AccessPage } from "../src/server/accesspage.ts";
import { packageVersion } from "../src/server/version.ts";
import { site } from "./site.ts";

const KEY = "k".repeat(40);
/** the owner, let in by the key, with a name */
const OWNER = { "x-visualproof-name": "Olivia", authorization: `Bearer ${KEY}` };
/** what a browser accepts as it navigates (Chrome's) */
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" };

type Site = Awaited<ReturnType<typeof site>>;

/** A request as a browser or a client sends it: its status, headers and text. */
async function get(S: Site, path: string, headers: Record<string, string> = {}, method = "GET") {
  const r = await fetch(S.base + path, { method, headers, redirect: "manual" });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

/** A link opened by a browser: the cookie it leaves. */
async function cookieOf(S: Site, path: string): Promise<string> {
  const r = await get(S, path, BROWSER);
  assert.equal(r.status, 303, path);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** That an answer is the page `kind`, as a browser is shown it. */
function isPage(r: { status: number; headers: Headers; text: string }, kind: AccessPage, publicRead = false, what = "") {
  assert.equal(r.status, 403, what);
  assert.equal(r.text, accessPageHtml(kind, publicRead), what);
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8", what);
  assert.equal(r.headers.get("cache-control"), "no-store", what);
  assert.equal(r.headers.get("content-security-policy"), ACCESS_PAGE_CSP, what);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff", what);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer", what);
  assert.equal(r.headers.get("vary"), "accept", what);
}

test("a browser asking for a page: GET or HEAD, accepting HTML, a page's path, from no agent", () => {
  const r = (method: string, headers: Record<string, string> = BROWSER) => ({ method, headers }) as unknown as IncomingMessage;
  for (const path of ["/", "/index.html", "/k/abc", "/k/", "/i/vpp_0123456789_x", "/r/vpr_x", "/somewhere", "/a/b/page.html"]) {
    assert.ok(asksForPage(r("GET"), path), path);
    assert.ok(asksForPage(r("HEAD"), path), path);
  }
  for (const m of ["POST", "PUT", "DELETE", "OPTIONS"]) assert.ok(!asksForPage(r(m), "/"), m);
  // what it accepts: HTML among its ranges, not refused at q=0
  for (const accept of ["TEXT/HTML", "application/json, text/html;q=0.5", "text/html; charset=utf-8"]) assert.ok(asksForPage(r("GET", { accept }), "/"), accept);
  for (const accept of ["*/*", "application/json", "text/html;q=0", "text/html; q=0.0", "", "text/css,*/*;q=0.1", "image/avif,image/webp,*/*", "text/htmlx"]) assert.ok(!asksForPage(r("GET", { accept }), "/"), accept);
  assert.ok(!asksForPage(r("GET", {}), "/"), "no Accept");
  // the API (the event stream, the agents' docs and MCP file in it), and files
  for (const path of ["/api", "/api/identity", "/api/events", "/api/agent/docs", "/api/agent/docs/words", "/api/agent/mcp", "/app.js", "/style.css", "/app.js.map", "/fonts/jost-latin-wght-normal.woff2", "/tips/index.json", "/tips/tour.mp4", "/tips/x", "/pdfjs/x", "/favicon.ico", "/robots.txt"]) assert.ok(!asksForPage(r("GET"), path), path);
  // an agent: its key or token, or saying it is one; a sign-in proxy's Basic passed on is a browser's
  assert.ok(!asksForPage(r("GET", { ...BROWSER, authorization: `Bearer ${KEY}` }), "/"));
  assert.ok(!asksForPage(r("GET", { ...BROWSER, authorization: "bearer vpa_x" }), "/"));
  assert.ok(!asksForPage(r("GET", { ...BROWSER, "x-visualproof-kind": "Agent" }), "/"));
  assert.ok(asksForPage(r("GET", { ...BROWSER, authorization: "Basic dTpw" }), "/"));
});

test("the page stands alone: no script, nothing fetched, its style allowed by its digest, light and dark, a phone's width", () => {
  for (const kind of ["private", "link", "host"] as const)
    for (const pub of [false, true]) {
      const html = accessPageHtml(kind, pub);
      assert.ok(!/<script|\bon[a-z]+=|javascript:/i.test(html), `${kind}: no script`);
      assert.ok(!/\bsrc=|url\(|@import|https?:/i.test(html), `${kind}: nothing fetched`);
      assert.deepEqual([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]), kind === "link" && pub ? ["data:,", "/"] : ["data:,"], kind);
      const style = /<style>([\s\S]*)<\/style>/.exec(html)![1];
      assert.ok(ACCESS_PAGE_CSP.includes(`style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'`), "the CSP allows its style, and only it");
      assert.match(ACCESS_PAGE_CSP, /^default-src 'none';/);
      assert.match(html, /<div class="logo">VisualProof<\/div>/);
      assert.match(style, /prefers-color-scheme: dark/);
      assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
      assert.match(html, /<meta name="robots" content="noindex">/);
    }
  assert.match(accessPageHtml("private"), /This site is private/);
  assert.match(accessPageHtml("link"), /This link no longer opens this site/);
  assert.match(accessPageHtml("host"), /--public-url &lt;its address&gt;.*--allowed-host &lt;name&gt;/);
  // the address alone, read-only: said on a link's page alone
  assert.match(accessPageHtml("link", true), /<a href="\/">open it read-only<\/a>/);
  assert.equal(accessPageHtml("private", true), accessPageHtml("private"));
  assert.equal(accessPageHtml("host", true), accessPageHtml("host"));
});

test("with a key, a browser asking for a page is shown it, 403; everything else keeps its 404", async () => {
  const S = await site({ key: KEY });
  try {
    for (const path of ["/", "/index.html", "/somewhere"]) isPage(await get(S, path, BROWSER), "private", false, path);
    const head = await get(S, "/", BROWSER, "HEAD");
    assert.deepEqual([head.status, head.headers.get("content-type"), head.text], [403, "text/html; charset=utf-8", ""]);
    // a link that does not open the site: the key's, wrong; a personal or read-only link never made
    for (const path of [`/k/${"x".repeat(40)}`, "/k/", `/i/vpp_0123456789_${"A".repeat(43)}`, "/i/nothing", `/r/vpr_0123456789_${"A".repeat(43)}`, "/r/"]) isPage(await get(S, path, BROWSER), "link", false, path);
    // not a browser asking for a page: as if there were nothing here
    const nothing = async (path: string, headers: Record<string, string>, method = "GET") => {
      const r = await get(S, path, headers, method);
      assert.deepEqual([r.status, r.headers.get("content-type"), r.text], [404, "application/json", '{"error":"not found"}'], `${method} ${path} ${JSON.stringify(headers)}`);
    };
    for (const path of ["/", "/index.html", `/k/${"x".repeat(40)}`, "/i/nothing", "/r/nothing"]) {
      await nothing(path, {});
      await nothing(path, { accept: "*/*" });
      await nothing(path, { ...BROWSER, authorization: `Bearer ${"y".repeat(40)}` });
      await nothing(path, { ...BROWSER, "x-visualproof-kind": "agent" });
    }
    await nothing("/", BROWSER, "POST");
    for (const path of ["/api/identity", "/api/review", "/api/events?session=aaaaaaaa1111", "/api/agent", "/api/agent/docs", "/api/agent/mcp", "/app.js", "/style.css", "/favicon.ico", "/tips/index.json"]) await nothing(path, BROWSER);
    // an agent's token not of this server's: as before
    assert.equal((await get(S, "/", { ...BROWSER, authorization: "Bearer vpa_0123456789_abc" })).status, 404);
    // the link still lets in; then the page is the app's
    const cookie = await cookieOf(S, `/k/${KEY}`);
    const app = await get(S, "/", { ...BROWSER, cookie });
    assert.equal(app.status, 200);
    assert.match(app.text, /<script type="module" src="\/app\.js">/);
  } finally {
    await S.close();
  }
});

test("a link revoked and one never made are one page, naming nobody; a browser the key lets in is told who, as before", async () => {
  const S = await site({ key: KEY });
  try {
    const invite = (await S.ask("POST", "/api/share/people", { name: "Bob" }, OWNER)).json!;
    const personal = new URL(invite.link as string).pathname;
    const bob = await cookieOf(S, personal);
    const ro = (await S.ask("POST", "/api/share/readonly", {}, OWNER)).json!.made as { id: string; path: string };
    const reader = await cookieOf(S, ro.path);
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: invite.invite.id }, OWNER)).status, 200);
    assert.equal((await S.ask("POST", "/api/share/readonly/revoke", { id: ro.id }, OWNER)).status, 200);
    // the links themselves: the page of a link that does not open the site, as for one never made
    for (const path of [personal, ro.path]) {
      const r = await get(S, path, BROWSER);
      isPage(r, "link", false, path);
      assert.ok(!/Olivia|Bob|revoked by/.test(r.text));
    }
    // a page of theirs, reloaded: the same page, and the cookie forgotten
    for (const [cookie, name] of [[bob, S.live.invites.cookieName], [reader, S.live.readOnly.cookieName]]) {
      const told = await get(S, "/", { ...BROWSER, cookie });
      isPage(told, "link", false, name);
      assert.ok(told.headers.getSetCookie().some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/.test(c)), name);
      // the page's scripts, and what is not a browser, are told as before
      assert.equal((await get(S, "/api/identity", { ...BROWSER, cookie })).status, 410);
      const plain = await get(S, "/", { cookie });
      assert.deepEqual([plain.status, plain.headers.get("content-type")], [410, "text/plain; charset=utf-8"]);
      assert.match(plain.text, /revoked by Olivia/);
    }
    // what is not a browser opening the link: as before
    assert.match((await get(S, personal, {})).text, /^This personal link was revoked by Olivia on /);
    assert.equal((await get(S, "/i/nothing", {})).status, 404);
    // a browser the key lets in sees the site's people anyway: told who revoked it, as before; a
    // link never made is the page
    const guest = await cookieOf(S, `/k/${KEY}`);
    const told = await get(S, personal, { ...BROWSER, cookie: guest });
    assert.equal(told.status, 410);
    assert.match(told.text, /^This personal link was revoked by Olivia on \d{4}-\d\d-\d\d\. Ask whoever invited you for a new one\.\n$/);
    assert.match((await get(S, ro.path, { ...BROWSER, cookie: guest })).text, /^This read-only link was revoked by Olivia/);
    isPage(await get(S, "/i/nothing", { ...BROWSER, cookie: guest }), "link");
  } finally {
    await S.close();
  }
});

test("nothing of the site is in the page: two servers, one with people, links and a review, give the same bytes", async () => {
  const A = await site({ key: KEY });
  const other = "q".repeat(43);
  const B = await site({ key: other });
  try {
    // A has people, links and a review; B nothing
    const made = (await A.ask("POST", "/api/share/people", { name: "Zebedee Quux" }, OWNER)).json!;
    await A.ask("POST", "/api/share/readonly", {}, OWNER);
    await A.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, OWNER);
    const secrets = ["fixture", "Zebedee", "Olivia", packageVersion(), KEY, other, A.live.invites.cookieName, A.live.readOnly.cookieName, made.invite.id as string, "N.a", A.dir];
    for (const [path, kind] of [["/", "private"], ["/k/nope", "link"], ["/i/nothing", "link"]] as const) {
      const a = await get(A, path, BROWSER);
      const b = await get(B, path, BROWSER);
      isPage(a, kind, false, path);
      assert.equal(a.text, b.text, path);
      for (const s of secrets) assert.ok(!a.text.includes(s) && ![...a.headers.values()].some((v) => v.includes(s)), `${path}: ${s}`);
    }
  } finally {
    await A.close();
    await B.close();
  }
});

test("--public: the address alone reads, as before; a link that does not open the site says that the address does", async () => {
  const S = await site({ key: KEY, publicRead: true });
  try {
    const page = await get(S, "/", BROWSER);
    assert.equal(page.status, 200);
    assert.match(page.text, /<script type="module" src="\/app\.js">/);
    assert.deepEqual((await S.ask("GET", "/api/identity")).json!.readOnly, { by: "public" });
    for (const path of [`/k/${"x".repeat(40)}`, "/i/nothing", "/r/nothing"]) isPage(await get(S, path, BROWSER), "link", true, path);
    // what is not a browser: as before
    assert.deepEqual([(await get(S, `/k/${"x".repeat(40)}`, {})).status, (await get(S, "/i/nothing", {})).status], [403, 404]);
  } finally {
    await S.close();
  }
});

test("behind a sign-in (--identity-header), a request without the header is let in unnamed, as before; with a key, the key decides", async () => {
  const S = await site({ identityHeader: "X-Forwarded-User" });
  try {
    assert.equal((await get(S, "/", BROWSER)).status, 200);
    assert.deepEqual([(await S.ask("GET", "/api/identity")).json!.mode, (await S.ask("GET", "/api/identity")).json!.name], ["header", null]);
  } finally {
    await S.close();
  }
  const K = await site({ identityHeader: "X-Forwarded-User", key: KEY });
  try {
    isPage(await get(K, "/", { ...BROWSER, "x-forwarded-user": "alice" }), "private");
    // no personal or read-only links behind a sign-in: any is a link that does not open the site
    isPage(await get(K, "/i/nothing", BROWSER), "link");
    isPage(await get(K, "/r/nothing", BROWSER), "link");
  } finally {
    await K.close();
  }
});

/** A request to 127.0.0.1:`port` as a browser sends it for `host`. */
function viaHost(port: number, host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; text: string }> {
  return new Promise((ok, fail) => {
    const r = request({ host: "127.0.0.1", port, path, headers: { host, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (text += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), text }));
    });
    r.on("error", fail);
    r.end();
  });
}

test("without a key, a name it does not answer: a browser's page is told what whoever runs it can do, never the name; the rest as before", async () => {
  const S = await site({ allowedHosts: ["vp.example.org"] });
  try {
    for (const path of ["/", "/index.html", "/k/x", "/somewhere"]) {
      const r = await viaHost(S.port, "rebind.attacker.example:4173", path, BROWSER);
      assert.deepEqual([r.status, r.type, r.text], [403, "text/html; charset=utf-8", accessPageHtml("host")], path);
      assert.ok(!r.text.includes("attacker"), "the name is not repeated");
    }
    // not a browser asking for a page: plain text, naming the option and the name, as before
    for (const [path, headers] of [["/", {}], ["/api/identity", BROWSER], ["/app.js", BROWSER], ["/", { ...BROWSER, authorization: "Bearer x" }]] as const) {
      const r = await viaHost(S.port, "rebind.attacker.example", path, headers);
      assert.deepEqual([r.status, r.type], [403, "text/plain; charset=utf-8"], path);
      assert.match(r.text, /--allowed-host rebind\.attacker\.example/);
    }
    // a name it answers: the page itself
    assert.equal((await viaHost(S.port, "vp.example.org", "/", BROWSER)).status, 200);
  } finally {
    await S.close();
  }
});
