// The call (CallSpec): the server's side, against a LiveKit of the test's own that checks every
// token's signature and grants, and lists whom the test says is in the room. The tokens a page is
// given, the identities, who may join and do what, the call told to the pages, a page gone, one
// removed on purpose coming back, the call ended, read-only links that join it, and the call link's
// way through the key.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { accessToken, loadLiveKitKeys, parseKeys, RoomService } from "../src/server/livekit.ts";
import { CallRoom, PAGE_GONE_MS, SESSION_GRACE_MS } from "../src/server/call.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const KEYS = { key: "APItest", secret: "a-secret-long-enough-for-livekit-0123456789" };

/** A JWT's payload, its HS256 signature checked against `secret`. */
function verified(jwt: string, secret = KEYS.secret): Json {
  const [h, p, s] = jwt.split(".");
  assert.equal(createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url"), s, "signed with the key's secret");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  return JSON.parse(Buffer.from(p, "base64url").toString());
}

/** A LiveKit of the test's own: the room service's three methods, each token checked; who is in a
 *  room is what the test puts there. */
async function fakeLiveKit() {
  const rooms = new Map<string, Json[]>();
  const calls: { method: string; body: Json; grant: Json }[] = [];
  let down = false;
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", () => {
      const method = /^\/twirp\/livekit\.RoomService\/(\w+)$/.exec(req.url ?? "")?.[1];
      const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (down) {
        res.writeHead(503).end();
        return;
      }
      if (!method || !auth) {
        res.writeHead(404).end();
        return;
      }
      const claims = verified(auth);
      assert.equal(claims.iss, KEYS.key);
      const body = JSON.parse(text) as Json;
      calls.push({ method, body, grant: claims.video });
      const list = rooms.get(body.room as string);
      const json = (status: number, b: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(b));
      if (method === "ListParticipants") {
        assert.deepEqual(claims.video, { roomAdmin: true, room: body.room });
        return list ? json(200, { participants: list }) : json(404, { code: "not_found", msg: "requested room does not exist" });
      }
      if (method === "RemoveParticipant") {
        assert.deepEqual(claims.video, { roomAdmin: true, room: body.room });
        const k = list?.findIndex((p) => p.identity === body.identity) ?? -1;
        if (k < 0) return json(404, { code: "not_found", msg: "participant not found" });
        list!.splice(k, 1);
        return json(200, {});
      }
      if (method === "DeleteRoom") {
        assert.deepEqual(claims.video, { roomCreate: true });
        if (!rooms.delete(body.room as string)) return json(404, { code: "not_found", msg: "room not found" });
        return json(200, {});
      }
      json(404, { code: "bad_route" });
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    rooms,
    calls,
    set down(v: boolean) {
      down = v;
    },
    /** someone joins the room as `identity`, as LiveKit lists them */
    join(room: string, identity: string, sid = `PA_${identity.slice(2, 8)}`) {
      const list = rooms.get(room) ?? [];
      rooms.set(room, [...list.filter((p) => p.identity !== identity), { sid, identity, state: "ACTIVE", joinedAt: "1700000000", kind: "STANDARD", name: "whatever it says" }]);
    },
    removed: (identity: string) => calls.filter((c) => c.method === "RemoveParticipant" && c.body.identity === identity).length,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

const name = (n: string) => ({ "x-visualproof-name": n });

describe("LiveKit by hand", () => {
  test("a keys file: one line <key>: <secret>, beside comments; anything else said", () => {
    assert.deepEqual(parseKeys("# the call's key\nAPIabc: s3cr3t\n"), { key: "APIabc", secret: "s3cr3t" });
    assert.match((parseKeys("") as { error: string }).error, /empty/);
    assert.match((parseKeys("a: b\nc: d\n") as { error: string }).error, /2 lines/);
    assert.match((parseKeys("just a secret") as { error: string }).error, /<key>: <secret>/);
  });

  test("the keys from a file its owner alone reads, or from the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "vp-lk-"));
    try {
      const f = join(dir, "keys");
      writeFileSync(f, "APIabc: s3cr3t\n");
      chmodSync(f, 0o644);
      if (process.platform !== "win32") assert.match((loadLiveKitKeys(f) as { error: string }).error, /chmod 600/);
      chmodSync(f, 0o600);
      assert.deepEqual(loadLiveKitKeys(f), { key: "APIabc", secret: "s3cr3t" });
      assert.match((loadLiveKitKeys(join(dir, "none")) as { error: string }).error, /no such file/);
      assert.deepEqual(loadLiveKitKeys("env", { LIVEKIT_API_KEY: "K", LIVEKIT_API_SECRET: "S" }), { key: "K", secret: "S" });
      assert.match((loadLiveKitKeys("env", {}) as { error: string }).error, /LIVEKIT_API_KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an access token is LiveKit's: the key as issuer, the identity, the name, the grant, ten minutes", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    const t = verified(accessToken(KEYS, { identity: "p_x", name: "Alice", ttl: 600, video: { room: "r", roomJoin: true } }, now));
    assert.deepEqual(t, { iss: "APItest", sub: "p_x", nbf: now / 1000, exp: now / 1000 + 600, name: "Alice", video: { room: "r", roomJoin: true } });
  });

  test("the room service under a path (a LiveKit behind a proxy's /livekit/), and a LiveKit that does not answer", async () => {
    const seen: string[] = [];
    const svc = new RoomService("https://lk.example/livekit/", KEYS, (async (u: string | URL | Request) => {
      seen.push(String(u));
      return new Response(JSON.stringify({ participants: [{ identity: "p_a", sid: "PA", joinedAt: "12", state: "ACTIVE" }] }), { status: 200 });
    }) as typeof fetch);
    assert.deepEqual(await svc.participants("r"), [{ sid: "PA", identity: "p_a", state: "ACTIVE", joinedAt: 12, kind: "STANDARD" }]);
    assert.deepEqual(seen, ["https://lk.example/livekit/twirp/livekit.RoomService/ListParticipants"]);
    const down = new RoomService("http://127.0.0.1:1", KEYS);
    down.timeoutMs = 2000;
    await assert.rejects(down.participants("r"), /could not be reached/);
  });

  test("a 404 that is not LiveKit's (a proxy's, a wrong --livekit-api) is no room gone: nothing is said done", async () => {
    const svc = new RoomService("http://lk.example", KEYS, (async () => new Response("<html>Not Found</html>", { status: 404 })) as typeof fetch);
    await assert.rejects(svc.participants("r"), /404/);
    await assert.rejects(svc.deleteRoom("r"), /404/);
    await assert.rejects(svc.remove("r", "p_x"), /404/);
  });
});

describe("the call", () => {
  let S: Awaited<ReturnType<typeof site>>;
  let LK: Awaited<ReturnType<typeof fakeLiveKit>>;
  let call: CallRoom;
  const logs: string[] = [];
  before(async () => {
    S = await site({ key: "the-key" });
    LK = await fakeLiveKit();
    call = new CallRoom({
      url: "wss://lk.example",
      api: LK.base,
      keys: KEYS,
      site: null,
      hooks: { page: (t) => S.live.callPage(t), pageById: (id) => S.live.callPageById(id), send: (e, d) => S.live.broadcast(e, d), sendTo: (t, e, d) => S.live.sendTo(t, e, d), log: (l) => logs.push(l) },
    });
    S.live.call = call;
  });
  after(async () => {
    call.stop();
    await S.close();
    await LK.close();
  });
  const KEY = { authorization: "Bearer the-key" };
  /** a page let in by the key, as `who`: its stream and its secret */
  const page = async (who: string | null, more: Record<string, string> = {}) => {
    const s = stream(S.port, "/api/events?session=" + "a".repeat(32), { ...KEY, ...(who ? name(who) : {}), ...more });
    await s.opened;
    await s.until(() => !!s.last("hello"));
    return { s, token: s.last("hello")!.token as string, id: s.last("hello")!.id as string, headers: { ...KEY, ...(who ? name(who) : {}), ...more } };
  };

  test("every page is told the call as it opens: nobody in it", async () => {
    const a = await page("Alice");
    assert.deepEqual(a.s.last("call"), { session: null, participants: [] });
    a.s.close();
  });

  test("a token: for a page's stream, under its reader's name, for its tab's identity; LiveKit's grant", async () => {
    const a = await page("Alice");
    const r = await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0001" }, a.headers);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json!.url, "wss://lk.example");
    assert.equal(r.json!.room, call.room);
    assert.match(call.room, /^visualproof-[0-9a-f]{12}$/);
    assert.match(r.json!.identity, /^p_[A-Za-z0-9_-]{22}$/);
    const t = verified(r.json!.token);
    assert.equal(t.sub, r.json!.identity);
    assert.equal(t.name, "Alice");
    assert.equal(t.exp - t.nbf, 600);
    assert.deepEqual(t.video, { room: call.room, roomJoin: true, canPublish: true, canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"], canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: true });
    // the same tab joins as the same participant; another as another; the tab is in no identity
    const again = await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0001" }, a.headers);
    assert.equal(again.json!.identity, r.json!.identity);
    const other = await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0002" }, a.headers);
    assert.notEqual(other.json!.identity, r.json!.identity);
    assert.ok(!r.json!.identity.includes("alice"));
    await S.ask("POST", "/api/call/leave", { token: a.token }, a.headers);
    a.s.close();
  });

  test("no token without a name, a stream, a tab; none for a private page, nor an agent", async () => {
    const n = await page(null);
    const nameless = await S.ask("POST", "/api/call/token", { token: n.token, tab: "tab-of-nobody-001" }, n.headers);
    assert.equal(nameless.status, 401);
    assert.equal(nameless.json!.who, true);
    const a = await page("Alice");
    assert.equal((await S.ask("POST", "/api/call/token", { token: "guessed", tab: "tab-of-alice-0001" }, a.headers)).status, 403);
    assert.equal((await S.ask("POST", "/api/call/token", { token: a.token, tab: "short" }, a.headers)).status, 400);
    const priv = await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0001" }, { ...a.headers, "x-visualproof-private": "cccccccc0001" });
    assert.equal(priv.status, 409);
    assert.equal(priv.json!.private, true);
    const agent = await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0001" }, { ...a.headers, "x-visualproof-kind": "agent" });
    assert.equal(agent.status, 403);
    n.s.close();
    a.s.close();
  });

  test("who is in the call is LiveKit's list, named by the server; the session starts and ends with them", async () => {
    const a = await page("Alice");
    const b = await page("Bob");
    const ta = (await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0006" }, a.headers)).json!;
    LK.join(call.room, ta.identity);
    await call.look();
    await b.s.until(() => (b.s.last("call")?.participants as Json[] | undefined)?.length === 1);
    const st = b.s.last("call")!;
    assert.deepEqual(st.participants, [{ id: ta.identity, name: "Alice", page: a.id, joined: "2023-11-14T22:13:20.000Z" }]);
    assert.ok(st.session?.id);
    // what LiveKit says of the participant's name is read by nothing
    assert.ok(!JSON.stringify(st).includes("whatever it says"));
    // Alice leaves: removed at once; the session lasts its minute, then ends
    const left = await S.ask("POST", "/api/call/leave", { token: a.token }, a.headers);
    assert.equal(left.status, 200);
    assert.equal(LK.removed(ta.identity), 1);
    await call.look();
    await b.s.until(() => (b.s.last("call")!.participants as Json[]).length === 0);
    assert.ok(b.s.last("call")!.session, "the session lasts while it may come back");
    await call.look(Date.now() + SESSION_GRACE_MS + 1);
    await b.s.until(() => b.s.last("call")!.session === null);
    a.s.close();
    b.s.close();
  });

  test("a page that went: its participant has a while to come back, then goes; one no page's goes at once", async () => {
    const a = await page("Alice");
    const ta = (await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0003" }, a.headers)).json!;
    LK.join(call.room, ta.identity);
    LK.join(call.room, "someone-else");
    await call.look();
    assert.equal(LK.removed("someone-else"), 1, "an identity no page's is removed");
    a.s.close();
    await new Promise((ok) => setTimeout(ok, 50));
    await call.look();
    assert.equal(LK.removed(ta.identity), 0, "a reload has a while");
    await call.look(Date.now() + PAGE_GONE_MS + 1);
    assert.equal(LK.removed(ta.identity), 1);
    await call.look(Date.now() + SESSION_GRACE_MS * 2);
  });

  test("someone in the call removes another: told, kept out until they ask again; ends it for everyone", async () => {
    const a = await page("Alice");
    const b = await page("Bob");
    const c = await page("Cy");
    const ta = (await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0004" }, a.headers)).json!;
    const tb = (await S.ask("POST", "/api/call/token", { token: b.token, tab: "tab-of-bobby-0004" }, b.headers)).json!;
    LK.join(call.room, ta.identity);
    LK.join(call.room, tb.identity);
    await call.look();
    // only someone in the call
    assert.equal((await S.ask("POST", "/api/call/remove", { token: c.token, identity: tb.identity }, c.headers)).status, 403);
    assert.equal((await S.ask("POST", "/api/call/remove", { token: a.token, identity: "p_nobody" }, a.headers)).status, 404);
    assert.equal((await S.ask("POST", "/api/call/remove", { token: a.token, identity: tb.identity }, a.headers)).status, 200);
    await b.s.until(() => !!b.s.last("call-removed"));
    assert.deepEqual(b.s.last("call-removed"), { by: "Alice" });
    // a join with the token Bob had is removed again
    LK.join(call.room, tb.identity);
    await call.look();
    assert.equal(LK.removed(tb.identity), 2);
    // a token asked for again lets him in
    await S.ask("POST", "/api/call/token", { token: b.token, tab: "tab-of-bobby-0004" }, b.headers);
    LK.join(call.room, tb.identity);
    await call.look();
    assert.equal(LK.removed(tb.identity), 2);
    // Alice invites Cy, who is here and not in the call
    assert.equal((await S.ask("POST", "/api/call/invite", { token: a.token, to: c.id }, a.headers)).status, 200);
    await c.s.until(() => !!c.s.last("call-invite"));
    assert.equal(c.s.last("call-invite")!.from, "Alice");
    assert.equal((await S.ask("POST", "/api/call/invite", { token: a.token, to: b.id }, a.headers)).status, 409);
    // Bob ends it for everyone
    assert.equal((await S.ask("POST", "/api/call/end", { token: b.token }, b.headers)).status, 200);
    assert.ok(LK.calls.some((x) => x.method === "DeleteRoom"));
    await c.s.until(() => !!c.s.last("call-ended"));
    assert.deepEqual(c.s.last("call-ended"), { by: "Bob" });
    assert.deepEqual(c.s.last("call"), { session: null, participants: [] });
    a.s.close();
    b.s.close();
    c.s.close();
  });

  test("LiveKit down: said once, and ending answers 503", async () => {
    const a = await page("Alice");
    const ta = (await S.ask("POST", "/api/call/token", { token: a.token, tab: "tab-of-alice-0005" }, a.headers)).json!;
    LK.join(call.room, ta.identity);
    await call.look();
    LK.down = true;
    const n = logs.length;
    await call.look();
    await call.look();
    assert.equal(logs.length, n + 1);
    assert.equal((await S.ask("POST", "/api/call/end", { token: a.token }, a.headers)).status, 503);
    LK.down = false;
    await call.look();
    assert.match(logs.at(-1)!, /answers again/);
    await S.ask("POST", "/api/call/end", { token: a.token }, a.headers);
    a.s.close();
  });

  test("a read-only link joins the call only where it is made to, under a name its holder gives, and does nothing else", async () => {
    const plain = S.live.readOnly.create("Alice");
    const joins = S.live.readOnly.create("Alice", Date.now(), true);
    const reader = async (id: string) => {
      const headers = { cookie: S.live.readOnly.cookie(id) };
      const s = stream(S.port, "/api/events?session=" + "b".repeat(32), headers);
      await s.opened;
      await s.until(() => !!s.last("hello"));
      return { s, token: s.last("hello")!.token as string, headers };
    };
    const p = await reader(plain.id);
    assert.equal((await S.ask("GET", "/api/identity", undefined, p.headers)).json!.readOnly.call, undefined);
    assert.equal((await S.ask("POST", "/api/call/token", { token: p.token, tab: "tab-of-reader-001", name: "Rita" }, p.headers)).status, 403);
    const j = await reader(joins.id);
    assert.equal((await S.ask("GET", "/api/identity", undefined, j.headers)).json!.readOnly.call, true);
    assert.equal((await S.ask("POST", "/api/call/token", { token: j.token, tab: "tab-of-reader-002" }, j.headers)).status, 400, "a name is given");
    const t = await S.ask("POST", "/api/call/token", { token: j.token, tab: "tab-of-reader-002", name: "Rita" }, j.headers);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    LK.join(call.room, t.json!.identity);
    await call.look();
    assert.deepEqual(call.state().participants.map((x) => ({ name: x.name, readOnly: x.readOnly, page: x.page })), [{ name: "Rita", readOnly: true, page: undefined }]);
    // in the call they end, remove and invite nothing
    for (const path of ["/api/call/end", "/api/call/remove", "/api/call/invite"]) assert.equal((await S.ask("POST", path, { token: j.token, identity: t.json!.identity, to: "x" }, j.headers)).status, 403, path);
    // the link switched off by someone let in: out of the call, kept out
    const off = await S.ask("POST", "/api/share/readonly/call", { id: joins.id, call: false }, { ...KEY, ...name("Alice") });
    assert.equal(off.status, 200);
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(LK.removed(t.json!.identity), 1);
    assert.equal((await S.ask("POST", "/api/call/token", { token: j.token, tab: "tab-of-reader-002", name: "Rita" }, j.headers)).status, 403);
    // a read-only link made to join the call, from Share
    const made = await S.ask("POST", "/api/share/readonly", { call: true }, { ...KEY, ...name("Alice") });
    assert.equal(made.json!.made.call, true);
    p.s.close();
    j.s.close();
    await call.look(Date.now() + SESSION_GRACE_MS * 2);
  });

  test("a read-only link revoked takes its holder out of the call, their page's stream closed or not; a request is its stream's way in", async () => {
    const l = S.live.readOnly.create("Alice", Date.now(), true);
    const headers = { cookie: S.live.readOnly.cookie(l.id) };
    const s = stream(S.port, "/api/events?session=" + "d".repeat(32), headers);
    await s.opened;
    await s.until(() => !!s.last("hello"));
    const t = await S.ask("POST", "/api/call/token", { token: s.last("hello")!.token, tab: "tab-of-reader-009", name: "Rae" }, headers);
    assert.equal(t.status, 200);
    // a page let in by the key, asked for with the read-only cookie alone: not that page's way in
    const full = await page("Alice");
    assert.equal((await S.ask("POST", "/api/call/token", { token: full.token, tab: "tab-of-alice-0009" }, headers)).status, 403);
    LK.join(call.room, t.json!.identity);
    await call.look();
    s.close();
    await new Promise((ok) => setTimeout(ok, 50));
    S.live.readOnly.revoke(l.id, "Alice");
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(LK.removed(t.json!.identity), 1, "removed at once, not 45 s later");
    full.s.close();
    await call.look(Date.now() + SESSION_GRACE_MS * 2);
  });

  test("a call link through the key, a personal link or a read-only link lands on the page with ?call", async () => {
    const k = await fetch(`${S.base}/k/the-key?call`, { redirect: "manual" });
    assert.equal(k.status, 303);
    assert.equal(k.headers.get("location"), "/?call");
    assert.equal((await fetch(`${S.base}/k/the-key`, { redirect: "manual" })).headers.get("location"), "/");
    const ro = S.live.readOnly.create("Alice", Date.now(), true);
    const r = await fetch(`${S.base}${ro.path}?call`, { redirect: "manual" });
    assert.equal(r.headers.get("location"), "/?call");
  });

  test("the call's bundle is the page's, a read-only reader's too", async () => {
    const { readOnlyAllows } = await import("../src/server/readonlygate.ts");
    assert.ok(readOnlyAllows("GET", "/call.js"));
    assert.ok(readOnlyAllows("POST", "/api/call/token"));
    assert.ok(readOnlyAllows("POST", "/api/call/leave"));
    assert.ok(!readOnlyAllows("POST", "/api/call/end"));
  });
});

test("without --livekit-url there is no call: its paths answer 404, and the pages are told nothing of it", async () => {
  const S = await site();
  try {
    const s = stream(S.port, "/api/events?session=" + "c".repeat(32), name("Alice"));
    await s.opened;
    await s.until(() => !!s.last("hello"));
    assert.equal(s.last("call"), undefined);
    assert.equal((await S.ask("POST", "/api/call/token", { token: s.last("hello")!.token, tab: "tab-of-alice-0001" }, name("Alice"))).status, 404);
    s.close();
  } finally {
    await S.close();
  }
});

test("the call keeps its room and its secret in the site: the same room and identities at the next start", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-call-site-"));
  try {
    const hooks = { page: () => null, pageById: () => null, send: () => {}, sendTo: () => {}, log: () => {} };
    const one = new CallRoom({ url: "wss://x", api: "http://x", keys: KEYS, site: dir, hooks });
    const two = new CallRoom({ url: "wss://x", api: "http://x", keys: KEYS, site: dir, hooks });
    assert.equal(one.room, two.room);
    assert.equal(one.identityOf("tab-of-alice-0001"), two.identityOf("tab-of-alice-0001"));
    const other = new CallRoom({ url: "wss://x", api: "http://x", keys: KEYS, site: null, hooks });
    assert.notEqual(other.room, one.room);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
