// Who may reach the server (server/access.ts): with a key, only those given its link — a cookie
// for a browser, the key itself for an agent — and nothing at all for anyone else. Without one,
// only by the names it is reached at (CollabSpec decision 12): its addresses, localhost,
// --public-url's host and --allowed-host's, so that no web page reaches it by DNS rebinding.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Access, hostAllowed, KEY_PATH, loadKey, newKey, urlHost } from "../src/server/access.ts";
import { site } from "./site.ts";

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage;

test("the link lets a browser in with a cookie; the key lets an agent in; nothing else gets in", () => {
  const key = newKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const A = new Access(key);
  assert.equal(A.link, `${KEY_PATH}${key}`, "the link a page that is in may share");
  assert.equal(A.admit(req(), "/"), "out");
  assert.equal(A.admit(req(), "/api/agent"), "out");
  assert.equal(A.admit(req(), `${KEY_PATH}${key.slice(1)}`), "out", "a wrong key");
  assert.equal(A.admit(req(), KEY_PATH), "out");
  const entered = A.admit(req(), `${KEY_PATH}${key}`);
  assert.ok(typeof entered === "object");
  const cookie = entered.enter.split(";")[0];
  assert.match(entered.enter, /HttpOnly/);
  assert.ok(!cookie.includes(key), "the key itself is in no cookie");
  assert.equal(A.admit(req({ cookie: `other=1; ${cookie}` }), "/api/events"), "in");
  assert.equal(A.admit(req({ cookie: `${cookie}x` }), "/"), "out");
  assert.equal(A.admit(req({ cookie: `visualproof_access=${key}` }), "/"), "out", "the key is not the cookie");
  assert.equal(A.admit(req({ authorization: `Bearer ${key}` }), "/api/agent/views"), "in");
  assert.equal(A.admit(req({ authorization: `Bearer ${newKey()}` }), "/api/agent"), "out");
  assert.equal(new Access(newKey()).admit(req({ cookie }), "/"), "out", "a new key: the old cookies are out");
});

test("a key file is made once, readable by its owner alone, and must hold a key", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-access-"));
  try {
    const file = join(dir, "VisualProof.key");
    const made = loadKey(file);
    assert.equal(made.made, true);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(loadKey(file), { key: made.key, made: false });
    assert.equal(readFileSync(file, "utf8").trim(), made.key);
    writeFileSync(file, "short\n");
    assert.throws(() => loadKey(file), /does not hold a key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without a key, the names a request may come by: an address, localhost, --public-url's host, --allowed-host's; any port, any case", () => {
  const names = ["vp.example.org", "Lab.Example.", urlHost("https://pub.example.net:8443")];
  // addresses, IPv6 in brackets, with a port or without: a rebinding comes under a name, never one
  for (const h of ["127.0.0.1", "127.0.0.1:4173", "192.168.1.20:80", "[::1]", "[::1]:4173", "[::ffff:127.0.0.1]:4173"]) assert.ok(hostAllowed(h, names), h);
  // localhost and the names under it, which browsers resolve to this machine themselves
  for (const h of ["localhost", "localhost:4173", "LocalHost:1", "localhost.", "vp.localhost:4173"]) assert.ok(hostAllowed(h, names), h);
  // the names given, in any case, fully qualified (a trailing dot) or not, with any port
  for (const h of ["vp.example.org", "VP.Example.ORG:443", "vp.example.org.", "lab.example", "LAB.EXAMPLE:8080", "pub.example.net:8443", "pub.example.net"]) assert.ok(hostAllowed(h, names), h);
  // every other name, and what is no name
  for (const h of ["rebind.attacker.example", "rebind.attacker.example:4173", "localhost.attacker.example", "127.0.0.1.attacker.example", "xlocalhost", "example.org", "::1", "[nope]", "999.1.1.1", "user@vp.example.org", "vp.example.org:port", "a b", ".", ""]) assert.ok(!hostAllowed(h, names), h);
  assert.ok(!hostAllowed(undefined, names), "no Host at all");
  // none given: addresses and localhost alone; --allowed-host repeated: each of them
  assert.ok(!hostAllowed("vp.example.org", []));
  assert.ok(hostAllowed("b.example", ["a.example", "b.example"]) && hostAllowed("a.example", ["a.example", "b.example"]));
  assert.equal(urlHost("http://[::1]:4173"), "::1");
});

/** A request to the server at 127.0.0.1:`port` as a browser sends it for `host`. */
function viaHost(port: number, host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const r = request({ host: "127.0.0.1", port, path, headers: { host, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (text += d.length < 4096 ? d : ""));
      // an event stream does not end: its head says enough
      if ((res.headers["content-type"] ?? "").startsWith("text/event-stream")) {
        res.destroy();
        return ok({ status: res.statusCode ?? 0, text: "" });
      }
      res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
    });
    r.on("error", fail);
    r.end();
  });
}

test("a server started without a key answers 127.0.0.1 and localhost, and refuses a name it was not given, on every route", async () => {
  // the command itself, on a small project's saved graph
  const dir = mkdtempSync(join(tmpdir(), "vp-hostcheck-"));
  const free = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => ok(p));
    });
  });
  mkdirSync(join(dir, "proj"));
  writeFileSync(join(dir, "proj", "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  writeFileSync(join(dir, "proj", "M.lean"), "namespace N\ndef a : Nat := 0\nend N\n");
  const graph = { schema: 1, roots: ["M"], modules: [{ name: "M", imports: [] }], nodes: [{ name: "N.a", kind: "def", module: "M", type: "Nat", ax: 0, hash: "ha" }], externals: [], edges: [], axioms: [], axiomSets: [[]], stats: { folded: 0, metaDropped: 0, ms: 1 } };
  writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
  const main = join(import.meta.dirname, "..", "src", "server", "main.ts");
  const args = ["serve", join(dir, "proj"), "--root", "M", "--graph", join(dir, "graph.json"), "--jobs", "0", "--updates", "off", "--port", String(free), "--site", join(dir, "site"), "--cache", join(dir, "cache"), "--allowed-host", "vp.example.org", "--allowed-host", "Lab.Example"];
  const child = spawn(process.execPath, [main, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VISUALPROOF_UPDATES: "off" } });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    for (let k = 0; k < 600 && !/graph v1 ready/.test(out) && child.exitCode === null; k++) await new Promise((ok) => setTimeout(ok, 50));
    assert.match(out, /graph v1 ready/, out);
    assert.match(out, /access: anyone who reaches the port, by its address, localhost, vp\.example\.org, Lab\.Example/);
    for (const host of [`127.0.0.1:${free}`, `localhost:${free}`, `[::1]:${free}`, "vp.example.org", `lab.example:${free}`]) assert.equal((await viaHost(free, host, "/api/identity")).status, 200, host);
    // a page whose own name resolves to this machine: refused whatever it asks, saying how to let
    // a name in; the console says it once
    for (const path of ["/", "/api/identity", "/api/review", "/api/events?session=aaaaaaaa1111", "/api/agent", "/api/agent/mcp", "/api/share/agents", "/k/whatever"]) {
      const r = await viaHost(free, `rebind.attacker.example:${free}`, path, { "x-visualproof-name": "Mallory" });
      assert.equal(r.status, 403, path);
      if (path !== "/api/events?session=aaaaaaaa1111") assert.match(r.text, /rebind\.attacker\.example is not one of them\. Whoever runs it can let a name in with --allowed-host rebind\.attacker\.example/, path);
    }
    assert.equal((await viaHost(free, `rebind.attacker.example:${free}`, "/api/share/agents", { "content-type": "application/json" })).status, 403);
    assert.equal(out.match(/refused a request for rebind\.attacker\.example/g)?.length, 1, "said once");
  } finally {
    child.kill("SIGTERM");
    await new Promise((ok) => (child.exitCode !== null ? ok(null) : child.on("exit", ok)));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with a key, any name: the key keeps everyone else out", async () => {
  const key = "k".repeat(40);
  const S = await site({ key });
  try {
    assert.equal((await viaHost(S.port, "rebind.attacker.example", "/api/identity", { authorization: `Bearer ${key}` })).status, 200);
    assert.equal((await viaHost(S.port, "rebind.attacker.example", "/api/identity")).status, 404, "as anyone without the key");
  } finally {
    await S.close();
  }
  // without one, --public-url's host is one of its names
  const P = await site({ publicUrl: "https://vp.example.org:8443" });
  try {
    assert.equal((await viaHost(P.port, "vp.example.org:8443", "/api/identity")).status, 200);
    assert.equal((await viaHost(P.port, "other.example.org", "/api/identity")).status, 403);
  } finally {
    await P.close();
  }
});
