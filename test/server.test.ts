// The server as a client meets it (server/main.ts, server/live.ts): bodies too large answered and
// the connection closed, a fault answered 500, event streams bounded and closed when they do not
// read, presence that only a page's own stream can speak for, only the graph's modules served, and
// the access cookie named per instance; what a page has already not sent again, and what it is
// sent compressed.

import assert from "node:assert/strict";
import { get, request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { Access, newKey } from "../src/server/access.ts";
import { LeanHover } from "../src/server/hover.ts";
import { Identities } from "../src/server/identity.ts";
import { Live, MAX_BUFFERED, MAX_STREAMS, MAX_STREAMS_PER_SESSION } from "../src/server/live.ts";
import { MAX_AGENTS } from "../src/server/presence.ts";
import { openProject } from "../src/server/project.ts";
import { ReviewStore } from "../src/server/review.ts";
import { lakeTextHash } from "../src/server/status.ts";
import type { Peer, StreamHello } from "../src/shared/collab.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";
import { isPackedEdges, unpackEdges } from "../src/shared/edgecodec.ts";
import { site, SOURCE, stream } from "./site.ts";
import type { Json } from "./site.ts";

test("a body too large is answered 413, as JSON ({error, hint} on the agents' API), and the connection is closed", async () => {
  const S = await site();
  try {
    const agent = await S.ask("POST", "/api/agent/opinion", { name: "x".repeat(2 << 20) }, { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" });
    assert.equal(agent.status, 413);
    assert.match(agent.json?.error, /larger than 1 MB/);
    assert.ok(agent.json?.hint, "the agents' API says what to do");
    assert.equal(agent.headers.get("connection"), "close");
    const page = await S.ask("POST", "/api/presence", { view: "x".repeat(1 << 20) });
    assert.equal(page.status, 413);
    assert.match(page.json?.error, /larger than 16 KB/);
    const memory = await S.ask("POST", "/api/views/memory", { memory: "x".repeat(51 << 20) }, { "x-visualproof-name": "Alice" });
    assert.equal(memory.status, 413, "a board's memory: 50 MB at most");
    assert.notEqual((await S.ask("POST", "/api/views/memory", { memory: "x".repeat(9 << 20) }, { "x-visualproof-name": "Alice" })).status, 413, "9 MB is not too large");
    // the review's own route, read the same way
    assert.equal((await S.ask("POST", "/api/review", { comment: "x".repeat(9 << 20) }, { "x-visualproof-name": "Alice" })).status, 413);
    // and the server goes on
    assert.equal((await S.ask("GET", "/api/status")).status, 200);
  } finally {
    await S.close();
  }
});

test("a body too large is answered once it has all come, so that the client reads the answer; one never ending, after a grace", async () => {
  const S = await site();
  try {
    // a client that finishes sending reads the 413, and nothing the handler answered meanwhile
    const big = await fetch(`${S.base}/api/presence`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(32 << 20) });
    assert.equal(big.status, 413);
    assert.match((await big.json()).error, /larger than 16 KB/);
    // one that never stops is answered all the same after the grace, and cut off: it reads the 413,
    // or, where the system resets a connection closed while the client still sends (macOS), only
    // the reset
    const u = new URL(`${S.base}/api/presence`);
    const started = Date.now();
    const end = await new Promise<string>((ok) => {
      const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        ok(String(res.statusCode));
        res.resume();
        req.destroy();
      });
      req.on("error", (e: NodeJS.ErrnoException) => ok(e.code ?? e.message));
      const chunk = Buffer.alloc(64 << 10, 120);
      const pump = () => {
        while (!req.destroyed && req.write(chunk));
      };
      req.on("drain", pump);
      pump();
    });
    assert.match(end, /^(413|ECONNRESET|EPIPE)$/);
    assert.ok(Date.now() - started >= 1500, "after the grace");
    assert.equal((await S.ask("GET", "/api/status")).status, 200, "and the server goes on");
  } finally {
    await S.close();
  }
});

test("whatever goes wrong in answering is answered 500 with what it was, on every route", async () => {
  const S = await site();
  try {
    S.live.views.handle = () => {
      throw new Error("a fault in the views");
    };
    const r = await S.ask("GET", "/api/views");
    assert.deepEqual([r.status, r.json?.error], [500, "a fault in the views"]);
    // after the body is read, in the review's route
    S.live.review.append = () => {
      throw new Error("a fault in the review");
    };
    const review = await S.ask("POST", "/api/review", { op: "target", name: "N.a", on: true }, { "x-visualproof-name": "Alice" });
    assert.deepEqual([review.status, review.json?.error], [500, "a fault in the review"]);
    assert.equal((await S.ask("GET", "/api/status")).status, 200, "and the server goes on");
  } finally {
    await S.close();
  }
});

test("presence: a page speaks only for its own stream, by the secret the stream was given; the others see an id that is neither", async () => {
  const S = await site();
  try {
    const alice = stream(S.port, "/api/events?session=aaaaaaaa1111");
    assert.equal(await alice.opened, 200);
    await alice.until(() => !!alice.last("hello"));
    const hello = alice.last("hello") as StreamHello;
    assert.ok(hello.id && hello.token && hello.id !== hello.token);
    const view = { mode: "tcb", sel: "N.a", source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
    assert.equal((await S.ask("POST", "/api/presence", { token: hello.token, view, idle: false }, { "x-visualproof-name": "Alice" })).status, 200);
    const bob = stream(S.port, "/api/events?session=bbbbbbbb2222");
    await bob.until(() => (bob.last("presence") as Peer[] | undefined)?.some((p) => p.name === "Alice") ?? false);
    const told = JSON.stringify(bob.events);
    assert.ok(!told.includes(hello.token) && !told.includes("aaaaaaaa1111"), "neither Alice's secret nor what her page calls itself is told");
    const seen = (bob.last("presence") as Peer[]).find((p) => p.name === "Alice")!;
    assert.equal(seen.id, hello.id);
    // Mallory, with what he can know (her public id, her session) or guess: refused, Alice as she was
    for (const body of [{ token: hello.id }, { session: "aaaaaaaa1111" }, { token: "guess" }, {}])
      assert.equal((await S.ask("POST", "/api/presence", { ...body, view: null, idle: true }, { "x-visualproof-name": "Mallory" })).status, 403, JSON.stringify(body));
    // opening and closing a stream under her session's name, or her id, takes nothing from her
    for (const name of [hello.id, "aaaaaaaa1111"]) {
      const m = stream(S.port, `/api/events?session=${name}`);
      await m.opened;
      m.close();
    }
    await new Promise((ok) => setTimeout(ok, 800));
    const now = (bob.last("presence") as Peer[]).filter((p) => p.name === "Alice");
    assert.deepEqual(now.map((p) => [p.id, p.idle]), [[hello.id, false]]);
    // her stream closes: she goes, and her secret means nothing any more
    alice.close();
    await bob.until(() => !(bob.last("presence") as Peer[]).some((p) => p.name === "Alice"));
    assert.equal((await S.ask("POST", "/api/presence", { token: hello.token, view, idle: false }, { "x-visualproof-name": "Alice" })).status, 403);
    // her arrangements carry the same secret: the others are told her public id, never it
    const again = stream(S.port, "/api/events?session=aaaaaaaa1111");
    await again.until(() => !!again.last("hello"));
    const h2 = again.last("hello") as StreamHello;
    assert.notEqual(h2.id, hello.id, "a stream opened again is named afresh");
    const arranged = await S.ask("POST", "/api/views/arrange", { id: "project", token: h2.token, ops: [{ op: "fold", mode: "namespace", key: "N", on: true }] }, { "x-visualproof-name": "Alice" });
    assert.equal(arranged.status, 200, JSON.stringify(arranged.json));
    await bob.until(() => !!bob.last("view-ops"));
    assert.equal(bob.last("view-ops")!.from, h2.id);
    again.close();
    bob.close();
  } finally {
    await S.close();
  }
});

test("agents are listed at most MAX_AGENTS at once", async () => {
  const S = await site();
  try {
    for (let i = 0; i < MAX_AGENTS + 10; i++) S.live.presence.agentBeat(`Bot${i}`);
    assert.equal(S.live.presence.list().filter((p) => p.agent).length, MAX_AGENTS);
  } finally {
    await S.close();
  }
});

/** A response that stands for a page's event stream: what is written to it, how much waits. */
function fakeResponse() {
  const r = {
    status: 0,
    written: [] as string[],
    writableLength: 0,
    destroyed: false,
    closers: [] as (() => void)[],
    writeHead(status: number) {
      r.status = status;
      return r;
    },
    write(text: string) {
      r.written.push(text);
      return true;
    },
    end(text?: string) {
      if (text) r.written.push(text);
    },
    on(event: string, f: () => void) {
      if (event === "close") r.closers.push(f);
      return r;
    },
    destroy() {
      if (r.destroyed) return;
      r.destroyed = true;
      for (const f of r.closers) f();
    },
  };
  return r;
}

test("event streams: at most MAX_STREAMS, a few per page, and one that does not read is closed rather than queued for", async () => {
  const S = await site();
  try {
    const open = (session: string | null) => {
      const r = fakeResponse();
      S.live.subscribe(r as unknown as ServerResponse, session);
      return r;
    };
    // a page that opens more streams than a page needs loses its oldest
    const mine = Array.from({ length: MAX_STREAMS_PER_SESSION + 1 }, () => open("cccccccc3333"));
    assert.deepEqual(mine.map((r) => r.destroyed), [true, ...Array(MAX_STREAMS_PER_SESSION).fill(false)]);
    // a page that does not read: once more waits for it than MAX_BUFFERED, it is closed, and the
    // others are sent the event (one text for all)
    const slow = mine[1];
    slow.writableLength = MAX_BUFFERED + 1;
    S.live.placesChanged([], null, "Alice");
    assert.ok(slow.destroyed, "closed for not reading");
    assert.ok(mine[2].written.at(-1)!.startsWith("event: view-ops"));
    assert.equal((S.live.status() as Json).streams.closedForNotReading, 1);
    // as many as the server serves: the next is refused, 503, until one closes
    const rest = Array.from({ length: MAX_STREAMS - (S.live.status() as Json).streams.open }, (_, i) => open(`d${String(i).padStart(9, "0")}`));
    const refused = open("eeeeeeee5555");
    assert.equal(refused.status, 503);
    assert.match(refused.written.join(""), /pages open/);
    rest[0].destroy();
    assert.equal(open("eeeeeeee5555").status, 200);
  } finally {
    await S.close();
  }
});

test("only the graph's modules are served or given to Lean, whatever files the project's folder holds", async () => {
  const S = await site();
  try {
    const source = await S.ask("GET", "/api/source?module=M");
    assert.deepEqual([source.status, source.json?.file, source.json?.text], [200, "M.lean", SOURCE]);
    for (const mod of ["_attic.Old", "Old", "ci.Axioms", "Axioms", "../M", "Init.Prelude"]) {
      assert.equal((await S.ask("GET", `/api/source?module=${encodeURIComponent(mod)}`)).status, 404, mod);
      for (const route of ["/api/hover?line=0&character=0&", "/api/hover/describe?name=Nat&", "/api/hover/open?", "/api/hover/names?"])
        assert.equal((await S.ask(route.includes("open") || route.includes("names") ? "POST" : "GET", `${route}module=${encodeURIComponent(mod)}`, route.includes("names") ? [[0, 0]] : undefined)).status, 404, `${route} ${mod}`);
    }
    // the agents' API: a module given must be one of the graph's
    const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    for (const mod of ["ci.Axioms", "_attic.Old", "Init.Prelude"]) assert.equal((await S.ask("GET", `/api/agent/describe?name=Nat&module=${mod}&wait=1000`, undefined, agent)).status, 400, mod);
    assert.equal(S.hover.state().state, "off", "Lean was never started");
  } finally {
    await S.close();
  }
});

test("the access cookie is named per instance, made from the key and not the key; the name every server shared still lets in, and is renewed", async () => {
  const k1 = newKey(), k2 = newKey();
  const A = new Access(k1), B = new Access(k2);
  assert.notEqual(A.name, B.name, "two servers on one host keep a cookie each");
  assert.match(A.name, /^visualproof_access_[0-9a-f]{12}$/);
  assert.ok(!A.name.includes(k1));
  const entered = A.admit({ headers: {} } as IncomingMessage, `/k/${k1}`);
  assert.ok(typeof entered === "object");
  const [pair] = entered.enter.split(";");
  assert.ok(pair.startsWith(`${A.name}=`) && !pair.includes(k1));
  const value = pair.slice(A.name.length + 1);
  const req = (cookie: string) => ({ headers: { cookie } }) as unknown as IncomingMessage;
  assert.equal(A.admit(req(pair), "/"), "in");
  assert.equal(A.renewal(req(pair)), null);
  assert.equal(B.admit(req(pair), "/"), "out", "another server's cookie lets nobody into this one");
  // B's link on the same host leaves A's cookie as it is: both are in
  const both = `${pair}; ${(B.admit({ headers: {} } as IncomingMessage, `/k/${k2}`) as { enter: string }).enter.split(";")[0]}`;
  assert.equal(A.admit(req(both), "/"), "in");
  assert.equal(B.admit(req(both), "/"), "in");
  // a browser let in before the names were per instance
  const legacy = `visualproof_access=${value}`;
  assert.equal(A.admit(req(legacy), "/"), "in");
  assert.match(A.renewal(req(legacy)) ?? "", new RegExp(`^${A.name}=${value}; Path=/`));
  // over HTTP: the link's cookie, and the renewal on the way in
  const S = await site({ key: k1 });
  try {
    const link = await fetch(`${S.base}/k/${k1}`, { redirect: "manual" });
    assert.equal(link.status, 303);
    assert.ok(link.headers.get("set-cookie")!.startsWith(`${A.name}=`));
    const renewed = await fetch(`${S.base}/api/status`, { headers: { cookie: legacy } });
    assert.equal(renewed.status, 200);
    assert.ok(renewed.headers.get("set-cookie")!.startsWith(`${A.name}=`));
    assert.equal((await fetch(`${S.base}/api/status`, { headers: { cookie: `${B.name}=${value}` } })).status, 404);
  } finally {
    await S.close();
  }
});

/** A GET as a browser sends it, the body as it came over the wire (not decompressed). */
function raw(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }>((ok, fail) => {
    get({ host: "127.0.0.1", port, path, headers }, (r) => {
      const parts: Buffer[] = [];
      r.on("data", (b: Buffer) => parts.push(b));
      r.on("end", () => ok({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(parts) }));
    }).on("error", fail);
  });
}

test("what a page has already is not sent again; the page's files, the graph and large answers go compressed", async () => {
  const S = await site();
  try {
    const gz = { "accept-encoding": "gzip, deflate" };
    for (const path of ["/", "/style.css", "/api/meta?v=1", "/api/edges?v=1", "/api/edges?v=1&pack=1"]) {
      const first = await raw(S.port, path, gz);
      assert.equal(first.status, 200, path);
      assert.equal(first.headers["content-encoding"], "gzip", path);
      assert.match(String(first.headers["cache-control"]), /no-cache/, `${path}: kept, and asked about again`);
      const etag = String(first.headers.etag);
      assert.match(etag, /^"[A-Za-z0-9_-]+"$/, path);
      const again = await raw(S.port, path, { ...gz, "if-none-match": etag });
      assert.deepEqual([again.status, again.body.length], [304, 0], `${path}: the page has it`);
      assert.equal((await raw(S.port, path, { ...gz, "if-none-match": '"other"' })).status, 200, path);
    }
    // a page file to a client that takes no gzip: as it is
    const plain = await raw(S.port, "/style.css");
    assert.equal(plain.headers["content-encoding"], undefined);
    assert.ok(plain.body.toString("utf8").length > 0);
    // packed edges are the same edges; unpacked ones stay as they were for agents and old pages
    const edges = new Int32Array(new Uint8Array(gunzipSync((await raw(S.port, "/api/edges?v=1", gz)).body)).buffer);
    const packed = new Uint8Array(gunzipSync((await raw(S.port, "/api/edges?v=1&pack=1", gz)).body));
    assert.ok(isPackedEdges(packed) && !isPackedEdges(new Uint8Array(edges.buffer)));
    const triples = (e: Int32Array) => [...Array(e.length / 3).keys()].map((k) => `${e[3 * k]} ${e[3 * k + 1]} ${e[3 * k + 2]}`).sort();
    assert.deepEqual(triples(unpackEdges(packed)), triples(edges));
    // JSON: compressed when large and taken, as it is when small or not taken
    const index = await raw(S.port, "/api/agent", gz);
    assert.equal(index.headers["content-encoding"], "gzip");
    assert.ok(JSON.parse(gunzipSync(index.body).toString("utf8")).endpoints);
    assert.equal((await raw(S.port, "/api/agent")).headers["content-encoding"], undefined);
    assert.equal((await raw(S.port, "/api/identity", gz)).headers["content-encoding"], undefined, "a small answer is sent as it is");
  } finally {
    await S.close();
  }
});

test("export: people and agents typeset the document of a view and fetch it; an agent has one job at a time", async () => {
  const S = await site({ exporter: true });
  try {
    const agent = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    // the outline is gone with the content it was chosen from (2026-10-09)
    assert.equal((await S.ask("GET", "/api/export/outline?targets=N.b&preset=full")).status, 404);
    // what heads the document, as the window shows it: the view's title, and the people who left a
    // trace on it (ExportSpec decisions 14 and 15) — on the Project, nobody yet; then Alice, by a pin
    // still kept, and not the agent, by its own
    assert.deepEqual((await S.ask("GET", "/api/export/head?view=project")).json, { view: "project", title: "Project", author: "", authors: [] });
    const drop = (key: string, headers: Record<string, string>) => S.ask("POST", "/api/views/arrange", { id: "project", ops: [{ op: "pin", mode: "namespace", kind: "node", key, at: [1, 1] }] }, headers);
    assert.equal((await drop("N.a", { "x-visualproof-name": "Alice" })).status, 200);
    assert.equal((await drop("N.b", agent)).status, 200);
    assert.equal((await S.ask("GET", "/api/export/head?view=project")).json?.author, "Alice");
    assert.equal((await S.ask("GET", "/api/export/head?view=nope")).status, 404);
    if (!S.app.exporter!.available()) {
      assert.equal((await S.ask("POST", "/api/export", { view: "project" })).status, 503, "no XeLaTeX here");
      assert.equal((await S.ask("POST", "/api/agent/export", { view: "project" }, agent)).status, 503);
      return;
    }
    // what is asked is checked, for people and agents alike: a view by its id, settings; what was
    // asked until 2026-10-09 is refused, saying what to ask instead
    const old = await S.ask("POST", "/api/export", { targets: ["N.b"], preset: "key" });
    assert.equal(old.status, 400);
    assert.match(old.json?.error, /no longer taken/);
    assert.equal((await S.ask("POST", "/api/export", { view: "nope" })).status, 404);
    assert.equal((await S.ask("POST", "/api/export", { view: "project", settings: { paper: "a3" } })).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/export", { view: "project", content: { include: ["N.a"] } }, agent)).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/export", { view: "project" }, { "x-visualproof-kind": "agent" })).status, 401, "an agent says who it is");
    assert.equal((await S.ask("GET", "/api/export/job?id=nope")).status, 404);
    assert.equal((await S.ask("GET", "/api/agent/export/file?id=nope", undefined, agent)).status, 404);
    // a margin of its own for each document asked for below, so that each is another document
    const poll = async (path: string, id: string, headers: Record<string, string> = {}) => {
      let job: Json = { state: "running" };
      for (let k = 0; k < 120 && job.state === "running"; k++) {
        await new Promise((ok) => setTimeout(ok, 250));
        job = (await S.ask("GET", `${path}?id=${id}`, undefined, headers)).json?.job;
      }
      return job;
    };
    // a person's document of the Project, with settings retired since (the key graph's figure, the
    // appendix, the title and the author line), which are taken and ignored
    const started = await S.ask("POST", "/api/export", { view: "project", settings: { title: "Mine", author: "Bob", figure: false, supportIndex: true } });
    assert.equal(started.status, 202, JSON.stringify(started.json));
    const id = started.json?.job.id as string;
    const job = await poll("/api/export/job", id);
    assert.equal(job.state, "done", job.log);
    const pdf = await fetch(`${S.base}/api/export/file?id=${id}&what=pdf`);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", /attachment/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    const tex = await (await fetch(`${S.base}/api/export/file?id=${id}&what=tex`)).text();
    assert.match(tex, /\\usepackage\{visualproof\}/);
    assert.match(tex, /\\vpSection\{vp:section\.3a\.N\}\{1\}\{1\}\{N\}/, "a section of the view's namespace");
    assert.match(tex, /\\begin\{vpContents\}/, "the contents, by default");
    assert.match(tex, /\\vpTitle\{Project\}\{Alice\}/, "the view's title and its people, not the retired settings");
    assert.ok(!tex.includes("vpFigure") && !tex.includes("vpNode"), "no figure");
    assert.equal((await S.ask("GET", `/api/export/file?id=${id}&what=exe`)).status, 400);
    // an agent, through its API: the job at once, one at a time
    const first = await S.ask("POST", "/api/agent/export", { view: "project", settings: { margin: 23 } }, agent);
    assert.equal(first.status, 202, JSON.stringify(first.json));
    const aid = first.json?.job.id as string;
    assert.equal(first.json?.next, `GET /api/agent/export/job?id=${aid}`);
    const early = await S.ask("GET", `/api/agent/export/file?id=${aid}&what=pdf`, undefined, agent);
    if (early.json?.job?.state === "running") {
      assert.equal(early.status, 409, "still being typeset");
      assert.equal(early.headers.get("retry-after"), "2");
    }
    const second = await S.ask("POST", "/api/agent/export", { view: "project", settings: { margin: 24 } }, agent);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "5");
    assert.equal(second.json?.job.id, aid, "the job it waits for");
    assert.match(second.json?.hint, /export\/job/);
    // the page's route holds an agent to the same limit; another agent is not held by it
    assert.equal((await S.ask("POST", "/api/export", { view: "project", settings: { margin: 25 } }, agent)).status, 429);
    const other = await S.ask("POST", "/api/agent/export", { view: "project", settings: { margin: 26 } }, { ...agent, "x-visualproof-name": "Other" });
    assert.equal(other.status, 202);
    const done = await poll("/api/agent/export/job", aid, agent);
    assert.equal(done.state, "done", done.log);
    const after = await S.ask("GET", `/api/agent/export/job?id=${aid}`, undefined, agent);
    assert.equal(after.json?.files.pdf, `/api/agent/export/file?id=${aid}&what=pdf`);
    const file = await fetch(`${S.base}/api/agent/export/file?id=${aid}&what=pdf`, { headers: agent });
    assert.equal(file.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    // its job done, it may start another; the same document again is the cached one
    const third = await S.ask("POST", "/api/agent/export", { view: "project", settings: { margin: 23 } }, agent);
    assert.equal(third.status, 200);
    assert.equal(third.json?.job.id, aid);
    assert.equal(third.json?.files.zip, `/api/agent/export/file?id=${aid}&what=zip`);
    await poll("/api/agent/export/job", other.json?.job.id, agent);
    // a document that could not be typeset: its files are refused, with why
    const bad = S.app.exporter!.compile("\\documentclass{article}\\begin{document}\\nosuchmacro\\end{document}\n");
    await S.app.exporter!.wait(bad.id);
    const refused = await S.ask("GET", `/api/agent/export/file?id=${bad.id}`, undefined, agent);
    assert.equal(refused.status, 409);
    assert.match(refused.json?.error, /could not be typeset/);
    // the agents' model is the same document, as JSON
    const model = await S.ask("GET", "/api/agent/export?view=project", undefined, agent);
    assert.equal(model.status, 200);
    const sections = (model.json?.items as Json[]).filter((x) => x.t === "section").map((x) => x.section);
    assert.deepEqual(sections.map((x: Json) => [x.title, x.items.map((e: Json) => e.decl.name).sort()]), [["N", ["N.a", "N.b"]]]);
    assert.deepEqual([model.json?.head.title, model.json?.head.author], ["Project", "Alice"], "its head as computed");
  } finally {
    await S.close();
  }
});

test("the project's git source and commit are read when asked, not kept with the graph: a commit made after the build is told", async () => {
  const { spawnSync } = await import("node:child_process");
  const S = await site();
  try {
    const dir = S.live.project.root;
    const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } });
    assert.deepEqual((await S.ask("GET", "/api/git")).json, { git: null }, "no repository");
    if (git("init", "-q", "-b", "main").status !== 0) return;
    // a read is kept a moment, whoever asks: git runs at most once in it (CollabSpec decision 11)
    git("add", "M.lean");
    git("commit", "-q", "-m", "zero");
    assert.deepEqual((await S.ask("GET", "/api/git")).json, { git: null }, "the read of a moment ago");
    S.app.gitFreshMs = 0;
    git("remote", "add", "origin", "git@github.com:A/B.git");
    git("add", "M.lean");
    git("commit", "-q", "-m", "one");
    const one = git("rev-parse", "HEAD").stdout.trim();
    assert.deepEqual((await S.ask("GET", "/api/git")).json, { git: { source: "github.com/A/B", commit: one, branch: "main" } });
    // edited, then committed, the build on show the same all along
    writeFileSync(join(dir, "M.lean"), SOURCE + "-- more\n");
    assert.equal((await S.ask("GET", "/api/git")).json!.git.dirty, true, "a .lean file differs from the commit");
    git("commit", "-q", "-am", "two");
    const two = git("rev-parse", "HEAD").stdout.trim();
    assert.deepEqual((await S.ask("GET", "/api/git")).json, { git: { source: "github.com/A/B", commit: two, branch: "main" } }, "the new commit, clean");
  } finally {
    await S.close();
  }
});

test("a snapshot of the page carries the project's git source and commit as it is taken, having no server to ask", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { gzipSync } = await import("node:zlib");
  const { withGit } = await import("../src/server/snapshot.ts");
  const dir = mkdtempSync(join(tmpdir(), "vp-snapgit-"));
  try {
    const meta = { schema: 1, project: { name: "p", root: dir } } as never;
    const gz = gzipSync(JSON.stringify(meta));
    assert.equal(withGit(dir, meta, gz), gz, "no repository: the graph as it was");
    const git = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } });
    if (git("init", "-q", "-b", "main").status !== 0) return;
    writeFileSync(join(dir, "A.lean"), "def a := 1\n");
    git("add", ".");
    git("commit", "-q", "-m", "a");
    const hash = git("rev-parse", "HEAD").stdout.trim();
    assert.deepEqual(JSON.parse(gunzipSync(withGit(dir, meta, gz)).toString()).project.git, { source: null, commit: hash, branch: "main" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
