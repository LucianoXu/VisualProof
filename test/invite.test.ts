// Inviting a person (CollabSpec decision 9): a personal link made from Share for a name, listed with
// who made it, when and when it was last used, revoked at once; it lets its holder in and says who
// they are, by the link's id, whatever name they go by — renaming keeps their log, their opinions
// and their mark; the review's logs say all of it themselves, and old name-keyed logs read as
// before; a guest cannot take a holder's name; the mark in what the server sends; a private holder;
// and Share's list.

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Invites } from "../src/server/invites.ts";
import { ReviewStore } from "../src/server/review.ts";
import type { Peer, PersonInvite } from "../src/shared/collab.ts";
import { applyEvent, current, emptyReview, findOpinion, logFileName, readEvent, replay } from "../src/shared/review.ts";
import type { ReviewEvent } from "../src/shared/review.ts";
import { personRow } from "../src/web/src/share.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

/** the owner, inviting as a guest by the key's link */
const OWNER = { "x-visualproof-name": "Olivia" };
const KEY = "k".repeat(40);
const VIEW = { mode: "tcb", sel: "N.a", source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };

type Site = Awaited<ReturnType<typeof site>>;

/** A personal link made through Share's endpoint, by the owner (with the key, where there is one). */
async function invite(S: Site, name: string, headers: Record<string, string> = OWNER, key?: string) {
  return S.ask("POST", "/api/share/people", { name }, { ...headers, ...(key ? { authorization: `Bearer ${key}` } : {}) });
}

/** A personal link opened as a browser opens it: where it goes, and the cookie it leaves. */
async function enter(S: Site, link: string) {
  const r = await fetch(S.base + new URL(link).pathname, { redirect: "manual" });
  const set = r.headers.getSetCookie();
  return { status: r.status, location: r.headers.get("location"), set, cookie: set.map((c) => c.split(";")[0]).join("; "), text: await r.text() };
}

/** A personal link's secret: the 43 characters after its id. Not what follows the link's last "_":
 *  the secret is base64url, which has "_" among its characters, so that tail is often only the end
 *  of the secret — a single character for 1 link in 64, which the state file or the cookie holds
 *  anyway, and the test would fail on a secret that was never kept. */
function secretOf(link: string): string {
  const m = /\/i\/vpp_[0-9a-f]{10}_([A-Za-z0-9_-]{43})$/.exec(link);
  assert.ok(m, `not a personal link: ${link}`);
  return m[1];
}

test("a personal link is made by a named person for a name, listed with who made it, and revoked at once", async () => {
  const S = await site();
  try {
    assert.equal((await invite(S, "Bob", {})).status, 401, "a name first");
    assert.equal((await invite(S, "Bob", { ...OWNER, "x-visualproof-kind": "agent" })).status, 403, "not by an agent");
    for (const name of ["", " ", "x".repeat(61), "a\nb"]) assert.equal((await invite(S, name)).status, 400, JSON.stringify(name));
    const r = await invite(S, " Bob ");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const inv = r.json!.invite as PersonInvite;
    assert.equal(inv.name, "Bob");
    assert.equal(inv.by, "Olivia");
    assert.deepEqual(inv.names.map((n) => n.name), ["Bob"]);
    assert.deepEqual([inv.revoked, inv.lastUsed], [null, null]);
    assert.ok(!("digest" in inv), "nothing of the token in the list");
    assert.match(r.json!.link, new RegExp(`^${S.base}/i/vpp_${inv.id}_[A-Za-z0-9_-]{43}$`));
    // a name a holder goes by is theirs: not even in another case
    const again = await invite(S, "BOB");
    assert.equal(again.status, 409);
    assert.match(again.json!.error, /“Bob” is the name of someone invited with a personal link/);
    const list = await S.ask("GET", "/api/share/people");
    assert.deepEqual(list.json!.invites.map((p: Json) => [p.name, p.by]), [["Bob", "Olivia"]]);
    assert.equal((await S.ask("GET", "/api/share/people", undefined, { ...OWNER, "x-visualproof-kind": "agent" })).status, 403);
    // the site directory keeps a digest, readable by its owner alone; never the token
    const file = join(S.dir, "state", "person-invites.json");
    const kept = readFileSync(file, "utf8");
    assert.ok(!kept.includes(secretOf(r.json!.link)), "the secret is not kept");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    // revoked: off the list at once, its name free again, for a new link of a new id
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: "0123456789" }, OWNER)).status, 404);
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: inv.id }, {})).status, 401);
    const gone = await S.ask("POST", "/api/share/people/revoke", { id: inv.id }, OWNER);
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.json!.invites, []);
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: inv.id }, OWNER)).status, 404, "once");
    const next = await invite(S, "Bob");
    assert.equal(next.status, 200);
    assert.notEqual(next.json!.invite.id, inv.id);
    // across a restart: the links, who revoked which, and the cookie's name are kept
    S.live.invites.close();
    const reread = new Invites(join(S.dir, "state"));
    assert.deepEqual(reread.inForce().map((p) => p.id), [next.json!.invite.id]);
    assert.equal(reread.get(inv.id)?.revokedBy, "Olivia");
    assert.equal(reread.cookieName, S.live.invites.cookieName);
    reread.close();
  } finally {
    await S.close();
  }
});

test("the personal link lets its holder in, as who it says, and its cookie does from then on; a revoked one lets nobody in", async () => {
  const S = await site({ key: KEY });
  try {
    const made = await invite(S, "Bob", OWNER, KEY);
    const inv = made.json!.invite as PersonInvite;
    const link = made.json!.link as string;
    // nobody is let in without the key or a link
    assert.equal((await S.ask("GET", "/api/identity")).status, 404);
    const e = await enter(S, link);
    assert.equal(e.status, 303);
    assert.equal(e.location, "/", "the token leaves the address");
    assert.match(e.cookie, new RegExp(`^${S.live.invites.cookieName}=${inv.id}\\.[A-Za-z0-9_-]{43}$`));
    assert.ok(!e.cookie.includes(secretOf(link)), "the cookie is not the token");
    assert.match(e.set[0], /HttpOnly; SameSite=Lax/);
    // the cookie alone lets Bob in, as Bob, whatever name the page sends
    const me = await S.ask("GET", "/api/identity", undefined, { cookie: e.cookie, "x-visualproof-name": "Mallory" });
    assert.equal(me.status, 200);
    assert.equal(me.json!.name, "Bob");
    assert.equal(me.json!.person.id, inv.id);
    assert.ok(!("digest" in me.json!.person));
    // the page renews it
    const page = await fetch(S.base + "/", { headers: { cookie: e.cookie } });
    assert.ok(page.headers.getSetCookie().some((c) => c.startsWith(`${S.live.invites.cookieName}=`) && /Max-Age=34560000/.test(c)));
    // when it was last used is listed
    assert.ok((await S.ask("GET", "/api/share/people", undefined, { cookie: e.cookie })).json!.invites[0].lastUsed);
    // a link not ours, or ours with another secret, is no link
    assert.equal((await enter(S, `${S.base}/i/vpp_${inv.id}_${"A".repeat(43)}`)).status, 404);
    assert.equal((await enter(S, `${S.base}/i/nothing`)).status, 404);
    // an open stream of Bob's ends the moment the link is revoked
    const s = stream(S.port, "/api/events?session=bbbbbbbb2222", { cookie: e.cookie });
    await s.until(() => !!s.last("hello"));
    const open = () => (S.live.status() as { streams: { open: number } }).streams.open;
    assert.equal(open(), 1);
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: inv.id }, { ...OWNER, cookie: e.cookie })).status, 200);
    await s.until(() => open() === 0);
    s.close();
    // revoked: the link says so, and the cookie lets nobody in and is forgotten
    const again = await enter(S, link);
    assert.equal(again.status, 410);
    assert.match(again.text, /revoked by Bob/, "Bob revoked his own, under his name");
    const out = await fetch(S.base + "/api/identity", { headers: { cookie: e.cookie } });
    assert.equal(out.status, 404);
    assert.ok(out.headers.getSetCookie().some((c) => c.startsWith(`${S.live.invites.cookieName}=;`) && /Max-Age=0/.test(c)));
    // with the key too, the browser comes in as a guest, and is told why it is one
    const guest = await S.ask("GET", "/api/identity", undefined, { cookie: e.cookie, authorization: `Bearer ${KEY}` });
    assert.equal(guest.status, 200);
    assert.equal(guest.json!.person, undefined);
    assert.deepEqual([guest.json!.revoked.by, guest.json!.revoked.name], ["Bob", "Bob"]);
  } finally {
    await S.close();
  }
});

test("a link holder is their link: a rename keeps the same id and log file, and shows what they did under the new name", async () => {
  const S = await site();
  try {
    const made = await invite(S, "Bob");
    const id = made.json!.invite.id as string;
    const { cookie } = await enter(S, made.json!.link);
    const as = { cookie, "x-visualproof-name": "Mallory" };
    // a holder renames before writing anything: no log is started for it
    assert.equal((await S.ask("POST", "/api/identity", { name: "Bobby" }, as)).status, 200);
    assert.equal((await S.ask("POST", "/api/identity", { name: "Bob" }, as)).status, 200);
    const logs = () => {
      try {
        return readdirSync(join(S.dir, "review", "log"));
      } catch {
        return [];
      }
    };
    assert.deepEqual(logs(), []);
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "comment", comment: "why 0?" }, as)).status, 200);
    assert.equal((await S.ask("POST", "/api/review", { op: "target", name: "N.b", on: true }, as)).status, 200);
    assert.equal((await S.ask("POST", "/api/review", { op: "key", target: "N.b", name: "N.a", on: true }, as)).status, 200);
    assert.deepEqual(logs(), [`${id}.person.jsonl`], "one log, named by the link");
    const file = join(S.dir, "review", "log", `${id}.person.jsonl`);
    const lines = () => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines().every((l) => l.person === id && l.by === "Bob"), "every line carries the id, and the name it was written under");
    // renamed: the link keeps every name, the log says so in a line, and what Bob did is Robert's
    const r = await S.ask("POST", "/api/identity", { name: "Robert" }, as);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json!.person.names.map((n: Json) => n.name), ["Bob", "Bobby", "Bob", "Robert"]);
    assert.deepEqual(lines().at(-1), { op: "name", at: lines().at(-1).at, by: "Robert", person: id });
    const d = S.live.review.data;
    assert.deepEqual(current(d, "N.a").map((o) => [o.by, o.person]), [["Robert", id]]);
    assert.deepEqual([d.targets["N.b"].by, d.targets["N.b"].person], ["Robert", id]);
    assert.equal(d.keys["N.b"]["N.a"].by, "Robert");
    assert.deepEqual(d.people[id], { name: "Robert", was: ["Bob"] });
    // the same file from then on; a new opinion replaces the old one, the same writer's
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, as)).status, 200);
    assert.deepEqual(logs(), [`${id}.person.jsonl`]);
    assert.deepEqual(current(S.live.review.data, "N.a").map((o) => [o.by, o.verdict]), [["Robert", "approve"]]);
    assert.equal(S.live.review.data.opinions["N.a"].length, 2);
    // the log alone says all of it: read without the server's state, it gives the same review
    const fresh = new ReviewStore(S.dir, join(S.dir, "review"));
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.data)), JSON.parse(JSON.stringify(S.live.review.data)));
    // a quote of the opinion under the name it had finds it
    assert.equal(findOpinion(fresh.data, "N.a", "Bob", S.live.review.data.opinions["N.a"][0].at)?.by, "Robert");
    // a name another holder goes by is not to be had, nor an empty one; the holder's own is
    await invite(S, "Carol");
    assert.equal((await S.ask("POST", "/api/identity", { name: "carol" }, as)).status, 409);
    assert.equal((await S.ask("POST", "/api/identity", { name: " " }, as)).status, 400);
    assert.equal((await S.ask("POST", "/api/identity", { name: "robert" }, as)).json!.name, "robert");
  } finally {
    await S.close();
  }
});

test("the replay: an invited person's log with name lines beside the old name-keyed logs, read as before", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-invite-"));
  try {
    const log = join(dir, "review", "log");
    mkdirSync(log, { recursive: true });
    const id = "0a1b2c3d4e";
    const line = (o: object) => JSON.stringify(o) + "\n";
    // a guest's log as it always was, and an agent's
    writeFileSync(join(log, logFileName("Alice", false)), line({ op: "opinion", name: "A.a", by: "Alice", verdict: "approve", at: "2026-10-08T09:00:00.000Z" }) + line({ op: "target", name: "T", by: "Alice", on: true, at: "2026-10-08T09:00:01.000Z" }));
    writeFileSync(join(log, logFileName("Claude", true)), line({ op: "opinion", name: "A.a", by: "Claude", verdict: "comment", comment: "hm", at: "2026-10-08T09:00:02.000Z", agent: true }));
    // an invited person's: their lines, a rename, more lines; and a guest who once went by their
    // first name, who is someone else
    writeFileSync(
      join(log, `${id}.person.jsonl`),
      line({ op: "opinion", name: "A.a", by: "Bob", person: id, verdict: "comment", comment: "off by one", at: "2026-10-08T10:00:00.000Z" }) +
        line({ op: "key", target: "T", name: "A.a", by: "Bob", person: id, on: true, at: "2026-10-08T10:00:01.000Z" }) +
        line({ op: "name", by: "Robert", person: id, at: "2026-10-08T11:00:00.000Z" }) +
        line({ op: "opinion", name: "A.b", by: "Robert", person: id, verdict: "approve", at: "2026-10-08T11:00:01.000Z" }),
    );
    writeFileSync(join(log, logFileName("Bob", false)), line({ op: "opinion", name: "A.a", by: "Bob", verdict: "approve", at: "2026-10-08T12:00:00.000Z" }));
    const store = new ReviewStore(dir, join(dir, "review"));
    assert.deepEqual(store.problems, []);
    const d = store.data;
    assert.deepEqual(
      current(d, "A.a").map((o) => [o.by, o.verdict, o.person ?? null]),
      [["Alice", "approve", null], ["Robert", "comment", id], ["Bob", "approve", null]],
      "the guest Bob is not the invited Robert, who was Bob",
    );
    assert.equal(current(d, "A.b")[0].by, "Robert");
    assert.deepEqual([d.keys.T["A.a"].by, d.targets.T.by], ["Robert", "Alice"]);
    assert.deepEqual(d.people[id], { name: "Robert", was: ["Bob"] });
    // what a page holds, as it applies the same lines one by one: a rename coming as a delta
    const page = replay([{ file: logFileName("Alice", false), events: [] }]);
    const evs = store.data.opinions["A.a"].filter((o) => o.person).map((o): ReviewEvent => ({ op: "opinion", name: "A.a", ...o, by: "Bob" }));
    for (const e of evs) applyEvent(page, e);
    applyEvent(page, { op: "name", by: "Rob", person: id, at: "2026-10-08T13:00:00.000Z" });
    assert.deepEqual(current(page, "A.a").map((o) => o.by), ["Rob"]);
    assert.deepEqual(page.people[id], { name: "Rob", was: ["Bob"] });
    // a log without a name line names its writer by its lines
    const plain = emptyReview();
    applyEvent(plain, { op: "target", name: "U", by: "Dora", person: "ffffffffff", on: true, at: "2026-10-08T13:00:00.000Z" });
    assert.deepEqual(plain.people.ffffffffff, { name: "Dora", was: [] });
    // what passes for someone else's is a line that cannot be read: an id in a guest's log, another
    // id or none in a person's, a name line outside one
    assert.match(readEvent({ op: "opinion", name: "A.a", by: "Eve", person: id, verdict: "approve", at: "2026-10-08T13:00:00.000Z" }, false) as string, /invited person's line in another's log/);
    assert.match(readEvent({ op: "opinion", name: "A.a", by: "Eve", verdict: "approve", at: "2026-10-08T13:00:00.000Z" }, false, id) as string, /without their id/);
    assert.match(readEvent({ op: "opinion", name: "A.a", by: "Eve", person: "ffffffffff", verdict: "approve", at: "2026-10-08T13:00:00.000Z" }, false, id) as string, /without their id/);
    assert.match(readEvent({ op: "name", by: "Eve", at: "2026-10-08T13:00:00.000Z" }, false) as string, /name line outside/);
    appendFileSync(join(log, logFileName("Alice", false)), line({ op: "name", by: "Eve", person: id, at: "2026-10-08T13:00:00.000Z" }));
    store.refresh();
    const problems: { file: string }[] = store.problems;
    assert.deepEqual(problems.map((x) => x.file), [logFileName("Alice", false)]);
    assert.equal(store.data.people[id].name, "Robert", "a line in another's log names nobody");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a guest cannot take a link holder's name: told why, wherever a name is needed; free again once it is not theirs", async () => {
  const S = await site();
  try {
    const made = await invite(S, "Bob");
    const holder = { cookie: (await enter(S, made.json!.link)).cookie };
    const asBob = { "x-visualproof-name": "bob" };
    const taken = await S.ask("POST", "/api/identity", { name: "BOB" });
    assert.equal(taken.status, 409);
    assert.equal(taken.json!.taken, true);
    assert.match(taken.json!.error, /“Bob” is the name of someone invited with a personal link: choose another/);
    assert.deepEqual((await S.ask("POST", "/api/identity", { name: "Alice" })).json, { ok: true, name: "Alice" });
    // a page that kept the name is told, and is taken for one without a name
    const id = await S.ask("GET", "/api/identity", undefined, asBob);
    assert.equal(id.json!.name, null);
    assert.match(id.json!.taken, /“Bob”/);
    const op = await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, asBob);
    assert.equal(op.status, 401);
    assert.equal(op.json!.who, true);
    assert.match(op.json!.error, /personal link/);
    assert.equal((await S.ask("POST", "/api/share/agents", {}, asBob)).status, 401);
    // among the others, without the name
    const g = stream(S.port, "/api/events?session=aaaaaaaa1111");
    await g.until(() => !!g.last("hello"));
    await S.ask("POST", "/api/presence", { token: g.last("hello")!.token, view: VIEW, idle: false }, asBob);
    await g.until(() => ((g.last("presence") as Peer[] | undefined) ?? []).length === 1);
    assert.equal((g.last("presence") as Peer[])[0].name, null);
    g.close();
    // an agent's names are its own: marked as one wherever it is named
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, { ...asBob, "x-visualproof-kind": "agent" })).status, 200);
    // renamed, the holder lets the old name go; revoked, the new one too
    assert.equal((await S.ask("POST", "/api/identity", { name: "Robert" }, holder)).status, 200);
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, asBob)).status, 200);
    assert.equal((await S.ask("POST", "/api/identity", { name: "Robert" })).status, 409);
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: made.json!.invite.id }, OWNER)).status, 200);
    assert.equal((await S.ask("POST", "/api/identity", { name: "Robert" })).status, 200);
  } finally {
    await S.close();
  }
});

test("the mark: a holder's page in presence, their opinions to agents, and the names every page is told", async () => {
  const S = await site();
  try {
    const made = await invite(S, "Bob");
    const id = made.json!.invite.id as string;
    const { cookie } = await enter(S, made.json!.link);
    const other = stream(S.port, "/api/events?session=aaaaaaaa1111");
    const bob = stream(S.port, "/api/events?session=bbbbbbbb2222", { cookie });
    await other.until(() => !!other.last("hello"));
    await bob.until(() => !!bob.last("hello"));
    // every page is told who the invited people are, at once and at each change
    assert.deepEqual(other.last("people"), [{ id, name: "Bob", was: [] }]);
    await S.ask("POST", "/api/presence", { token: bob.last("hello")!.token, view: VIEW, idle: false }, { cookie });
    await S.ask("POST", "/api/presence", { token: other.last("hello")!.token, view: VIEW, idle: false }, { "x-visualproof-name": "Alice" });
    const listed = () => (other.last("presence") as Peer[] | undefined) ?? [];
    await other.until(() => listed().length === 2);
    assert.deepEqual(listed().map((p) => [p.name, !!p.verified]).sort(), [["Alice", false], ["Bob", true]]);
    await S.ask("POST", "/api/identity", { name: "Robert" }, { cookie });
    await other.until(() => (other.last("people") as Json[])[0].name === "Robert");
    assert.deepEqual(other.last("people"), [{ id, name: "Robert", was: ["Bob"] }]);
    // what agents are told: his opinions and his place, marked
    await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, { cookie });
    // pages are told it as a change they apply, each event read back as its log was (web/src/main.ts)
    await other.until(() => !!other.last("review-delta"));
    const delta = other.last("review-delta")!.events as Json[];
    assert.deepEqual(delta.map((e) => [e.op, e.by, e.person]), [["opinion", "Robert", id]]);
    for (const e of delta) assert.equal(typeof readEvent(e, e.agent === true, e.person ?? null), "object");
    await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, { "x-visualproof-name": "Alice" });
    const AGENT = { "x-visualproof-name": "Claude", "x-visualproof-kind": "agent" };
    const decl = (await S.ask("GET", "/api/agent/declaration?name=N.a", undefined, AGENT)).json!;
    assert.deepEqual(decl.review.opinions.map((o: Json) => [o.by, !!o.verified]).sort(), [["Alice", false], ["Robert", true]]);
    await S.ask("POST", "/api/presence", { token: bob.last("hello")!.token, view: VIEW, idle: false }, { cookie });
    const companion = (await S.ask("GET", "/api/agent/companion", undefined, AGENT)).json!;
    assert.deepEqual(companion.people.map((p: Json) => [p.name, !!p.verified]).sort(), [["Alice", false], ["Robert", true]]);
    other.close();
    bob.close();
  } finally {
    await S.close();
  }
});

test("a private holder: what they arrange is anonymous, their review keeps their name and mark", async () => {
  const S = await site();
  try {
    const made = await invite(S, "Bob");
    const id = made.json!.invite.id as string;
    const { cookie } = await enter(S, made.json!.link);
    const SESSION = "bbbbbbbb2222";
    const bob = stream(S.port, `/api/events?session=${SESSION}`, { cookie });
    const other = stream(S.port, "/api/events?session=aaaaaaaa1111");
    await bob.until(() => !!bob.last("hello"));
    await other.until(() => !!other.last("hello"));
    const hello = bob.last("hello")!;
    // a private page's heartbeat carries its cookie, as every request does: it is still counted only
    await S.ask("POST", "/api/presence", { token: hello.token, private: true }, { cookie });
    await other.until(() => (other.last("private") as Json | undefined)?.count === 1);
    assert.deepEqual(other.last("presence"), []);
    const note = (nid: string) => ({ op: "note", note: { id: nid, text: "look here", place: { mode: "namespace", in: [], world: [1, 2] }, open: true, by: null, at: "" } });
    const priv = { cookie, "x-visualproof-private": SESSION };
    assert.equal((await S.ask("POST", "/api/views/arrange", { id: "project", token: hello.token, ops: [note("n1")] }, priv)).status, 200);
    const notes = () => (S.live.views.book.get("project")!.notes ?? []) as Json[];
    assert.deepEqual([notes()[0].by, notes()[0].person], [null, undefined], "someone's, not tied to the link");
    const events = () => S.live.timeline.events.filter((e) => e.kind === "note") as Json[];
    assert.deepEqual([events()[0].by, events()[0].person], [null, undefined]);
    await other.until(() => other.events.some((x) => x.event === "activity"));
    const arranged = other.events.filter((x) => x.event === "view-ops" || x.event === "activity");
    assert.ok(arranged.length >= 2 && !JSON.stringify(arranged).includes(id) && !JSON.stringify(arranged).includes("Bob"), "what the others are told of it names neither him nor his link");
    // the review keeps his name, his mark and his log
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "approve" }, priv)).status, 200);
    assert.deepEqual(current(S.live.review.data, "N.a").map((o) => [o.by, o.person]), [["Bob", id]]);
    // visible again, what he arranges is his, by his link
    await S.ask("POST", "/api/presence", { token: hello.token, view: VIEW, idle: false }, { cookie });
    assert.equal((await S.ask("POST", "/api/views/arrange", { id: "project", token: hello.token, ops: [note("n2")] }, { cookie })).status, 200);
    assert.deepEqual([notes()[1].by, notes()[1].person], ["Bob", id]);
    assert.deepEqual([events()[1].by, events()[1].person], ["Bob", id]);
    bob.close();
    other.close();
  } finally {
    await S.close();
  }
});

test("Share lists each personal link: for whom, with the mark and the names they had, who made it, when, and when it was last used", async () => {
  const S = await site();
  try {
    const made = await invite(S, "Bob");
    const { cookie } = await enter(S, made.json!.link);
    let [p] = (await S.ask("GET", "/api/share/people")).json!.invites as PersonInvite[];
    const row = personRow({ ...p, lastUsed: null }, false);
    assert.match(row, /<b>Bob<\/b><span class="vf"/);
    assert.match(row, /invited by Olivia, /);
    assert.match(row, /not used yet/);
    assert.match(row, new RegExp(`data-revoke-invite="${p.id}"[^>]*>Revoke<`));
    assert.ok(!row.includes("Was called"));
    await S.ask("POST", "/api/identity", { name: "Robert" }, { cookie });
    [p] = (await S.ask("GET", "/api/share/people")).json!.invites as PersonInvite[];
    const after = personRow(p, true);
    assert.match(after, /<b>Robert<\/b>/);
    assert.match(after, /title="Was called Bob"/);
    assert.match(after, /last used /);
    assert.match(after, />Revoke it</, "armed, waiting for the second press");
    // a name in the list is text, never markup
    assert.ok(!personRow({ ...p, name: "<i>x</i>" }, false).includes("<i>x</i>"));
  } finally {
    await S.close();
  }
});

test("a move by someone invited by a personal link goes to their log with their id, and reads back", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-invite-move-"));
  try {
    const log = join(dir, "review", "log");
    mkdirSync(log, { recursive: true });
    const id = "0a1b2c3d4e";
    writeFileSync(join(log, `${id}.person.jsonl`), JSON.stringify({ op: "opinion", name: "A.a", by: "Robert", person: id, verdict: "comment", comment: "off by one", at: "2026-10-08T10:00:00.000Z" }) + "\n");
    const store = new ReviewStore(dir, join(dir, "review"));
    const r = store.append({ name: "Robert", agent: false, person: id }, { op: "move", by: "Robert", person: id, from: "A.a", to: "A.c", on: true }, "v4.33.1");
    assert.ok(!("status" in r), JSON.stringify(r));
    const lines = readFileSync(join(log, `${id}.person.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([lines.at(-1).op, lines.at(-1).person, lines.at(-1).from, lines.at(-1).to], ["move", id, "A.a", "A.c"]);
    // read again from the files alone: nothing refused, the opinion where the move took it
    const fresh = new ReviewStore(dir, join(dir, "review"));
    assert.deepEqual(fresh.problems, []);
    assert.deepEqual(current(fresh.data, "A.c").map((o) => [o.by, o.person ?? null]), [["Robert", id]]);
    assert.equal(current(fresh.data, "A.a").length, 0);
    // without the id, a move is not theirs to write
    assert.equal((store.append({ name: "Robert", agent: false, person: id }, { op: "move", by: "Robert", from: "A.c", to: "A.a", on: true }, "v4.33.1") as { status?: number }).status, 400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
