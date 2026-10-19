// My personal link (CollabSpec decision 9, the owner's decision of 2026-10-19): the server keeps a
// personal link in full, and shows it again to its holder alone — not its maker, a guest, a
// read-only reader, an agent or anyone else, nor on a server behind a sign-in. A link made before
// 0.6.0, of which only a digest was kept, is not shown: its holder makes it anew, and so may any
// holder — the same id, names and log; the old link and every browser it let in cut off at once and
// told so, this browser given the new cookie, this page's stream kept. The file stays its owner's
// alone. And the page: the item in the name's menu, the window's states.

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accessPageHtml } from "../src/server/accesspage.ts";
import { Invites } from "../src/server/invites.ts";
import type { PersonInvite } from "../src/shared/collab.ts";
import { ANEW, myLinkHtml } from "../src/web/src/mylink.ts";
import { menuHtml } from "../src/web/src/whomenu.ts";
import type { NameMode } from "../src/web/src/whomenu.ts";
import { site, stream } from "./site.ts";
import type { Json } from "./site.ts";

const KEY = "k".repeat(40);
/** the owner, a guest by the key */
const OWNER = { "x-visualproof-name": "Olivia", authorization: `Bearer ${KEY}` };
/** what a browser accepts as it navigates (Chrome's) */
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" };

type Site = Awaited<ReturnType<typeof site>>;

/** A personal link made by the owner in Share: its record and the link. */
async function invite(S: Site, name: string): Promise<{ invite: PersonInvite; link: string }> {
  const r = await S.ask("POST", "/api/share/people", { name }, OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { invite: r.json!.invite, link: r.json!.link };
}

/** A link opened as a browser opens it: the status, and the cookie it leaves. */
async function enter(S: Site, link: string, headers: Record<string, string> = {}) {
  const r = await fetch(S.base + new URL(link).pathname, { redirect: "manual", headers });
  const set = r.headers.getSetCookie();
  return { status: r.status, set, cookie: set.map((c) => c.split(";")[0]).join("; "), text: await r.text() };
}

/** The holder's link, as their page asks for it. */
const mine = (S: Site, headers: Record<string, string>) => S.ask("POST", "/api/share/people/mine", {}, headers);
/** The holder's link made anew, as their page asks for it: the answer, and the cookie it gives. */
async function renew(S: Site, headers: Record<string, string>, body: Json = {}) {
  const r = await fetch(S.base + "/api/share/people/mine/renew", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const set = r.headers.getSetCookie();
  return { status: r.status, json: (await r.json()) as Json, set, cookie: set.map((c) => c.split(";")[0]).join("; ") };
}

/** A personal link's secret: the 43 characters after its id. */
function secretOf(link: string): string {
  const m = /\/i\/vpp_[0-9a-f]{10}_([A-Za-z0-9_-]{43})$/.exec(link);
  assert.ok(m, `not a personal link: ${link}`);
  return m[1];
}

test("a personal link made now is kept in full, mode 600, and shown again to its holder alone", async () => {
  const S = await site({ key: KEY });
  try {
    const bob = await invite(S, "Bob");
    const file = join(S.dir, "state", "person-invites.json");
    assert.ok(readFileSync(file, "utf8").includes(secretOf(bob.link)), "the link is kept");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const { cookie } = await enter(S, bob.link);
    // Bob, by the cookie his link left: his own link, named as his page reached the server
    const r = await mine(S, { cookie, origin: S.base });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json!.link, bob.link);
    assert.equal(r.json!.invite.id, bob.invite.id);
    assert.ok(!("token" in r.json!.invite) && !("digest" in r.json!.invite), "the record carries nothing of the token");
    assert.equal((await S.ask("GET", "/api/share/people/mine", undefined, { cookie })).status, 405, "asked for by POST, which carries the Origin");
    // nothing of it anywhere else: the list, who Bob is, the names every page is told
    for (const path of ["/api/share/people", "/api/identity"]) assert.ok(!JSON.stringify((await S.ask("GET", path, undefined, { cookie })).json).includes(secretOf(bob.link)), path);
    // everyone else is refused: its maker and any guest, by the key; an agent, by the key or a
    // token of its own; a read-only reader; someone with another link is shown theirs, never Bob's;
    // whoever nothing lets in is answered as if there were nothing here
    const maker = await mine(S, OWNER);
    assert.equal(maker.status, 403);
    assert.equal(maker.json!.holder, false);
    assert.equal((await mine(S, { ...OWNER, "x-visualproof-kind": "agent" })).status, 403);
    const agent = S.live.tokens.create({ name: "Olivia's AI", by: "Olivia", level: "full", days: 1 });
    assert.equal((await mine(S, { authorization: `Bearer ${agent.token}` })).status, 404, "a token reaches the agents' API alone");
    const ro = await S.ask("POST", "/api/share/readonly", {}, OWNER);
    const reader = await enter(S, ro.json!.made.link);
    const refused = await mine(S, { cookie: reader.cookie });
    assert.equal(refused.status, 403);
    assert.equal(refused.json!.readOnly, true);
    const carol = await invite(S, "Carol");
    const theirs = await mine(S, { cookie: (await enter(S, carol.link)).cookie });
    assert.equal(theirs.json!.link, carol.link);
    assert.equal((await mine(S, {})).status, 404);
    // revoked, it is shown to nobody: the cookie lets nobody in
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id: bob.invite.id }, OWNER)).status, 200);
    assert.equal((await mine(S, { cookie })).status, 410);
    assert.equal((await renew(S, { cookie })).status, 410);
  } finally {
    await S.close();
  }
});

test("without a key: the holder's link is shown and made anew alike; a browser of the old one is a guest, told why", async () => {
  const S = await site();
  try {
    const made = await S.ask("POST", "/api/share/people", { name: "Bob" }, { "x-visualproof-name": "Olivia" });
    const { cookie } = await enter(S, made.json!.link);
    assert.equal((await mine(S, { cookie })).json!.link, made.json!.link);
    assert.equal((await mine(S, { "x-visualproof-name": "Bob" })).status, 403, "a guest giving the holder's name is not the holder");
    const anew = await renew(S, { cookie });
    assert.equal(anew.status, 200);
    // a request with the old cookie, as one of the renewing page's still on its way: answered as a
    // guest's, and it does not make the browser forget the cookie — the new one, by then
    const old = await S.ask("GET", "/api/identity", undefined, { cookie });
    assert.equal(old.status, 200);
    assert.equal(old.json!.person, undefined);
    assert.equal(old.json!.replaced.name, "Bob");
    assert.deepEqual(old.headers.getSetCookie(), []);
    // a page loaded with it forgets it
    const page = await fetch(S.base + "/", { headers: { cookie } });
    assert.ok(page.headers.getSetCookie().some((c) => c.startsWith(`${S.live.invites.cookieName}=;`) && /Max-Age=0/.test(c)));
    assert.equal((await S.ask("GET", "/api/identity", undefined, { cookie: anew.cookie })).json!.name, "Bob");
  } finally {
    await S.close();
  }
});

test("behind a sign-in there are no personal links, and nobody's is shown", async () => {
  const S = await site({ identityHeader: "x-forwarded-user" });
  try {
    assert.equal((await mine(S, { "x-forwarded-user": "bob" })).status, 404);
    assert.equal((await renew(S, { "x-forwarded-user": "bob" })).status, 404);
  } finally {
    await S.close();
  }
});

test("a link made before 0.6.0 is not shown; made anew it keeps its id, names and log, and the old link and its cookies are told they let nobody in", async () => {
  const S = await site({ key: KEY });
  try {
    const bob = await invite(S, "Bob");
    const id = bob.invite.id;
    const old = await enter(S, bob.link);
    // as a server before 0.6.0 kept it: the digest alone
    delete S.live.invites.get(id)!.token;
    const as = { cookie: old.cookie };
    assert.equal((await S.ask("POST", "/api/identity", { name: "Robert" }, as)).status, 200);
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.a", verdict: "comment", comment: "why 0?" }, as)).status, 200);
    const shown = await mine(S, as);
    assert.equal(shown.status, 200);
    assert.equal(shown.json!.link, null, "only its digest: nothing to show");
    // made anew: a new secret for the same id, and this browser given its cookie
    const events = async () => ((await S.ask("GET", "/api/activity", undefined, OWNER)).json!.events as Json[]).length;
    const before = await events();
    const made = await renew(S, { ...as, origin: S.base });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const link = made.json.link as string;
    assert.match(link, new RegExp(`^${S.base}/i/vpp_${id}_[A-Za-z0-9_-]{43}$`));
    assert.notEqual(secretOf(link), secretOf(bob.link));
    assert.match(made.set.join("\n"), new RegExp(`^${S.live.invites.cookieName}=${id}\\.[A-Za-z0-9_-]{43}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax$`, "m"));
    assert.notEqual(made.cookie, old.cookie);
    assert.equal(await events(), before, "the timeline records nothing of it");
    const now = { cookie: made.cookie };
    // the same person: the id, every name, the log
    const me = await S.ask("GET", "/api/identity", undefined, now);
    assert.equal(me.json!.person.id, id);
    assert.equal(me.json!.name, "Robert");
    assert.deepEqual(me.json!.person.names.map((n: Json) => n.name), ["Bob", "Robert"]);
    assert.equal((await S.ask("POST", "/api/review", { op: "opinion", name: "N.b", verdict: "approve" }, now)).status, 200);
    assert.deepEqual(readdirSync(join(S.dir, "review", "log")), [`${id}.person.jsonl`], "one log, the link's");
    assert.equal((await mine(S, now)).json!.link, link, "shown from now on");
    // the new link lets in, as the same person
    const again = await enter(S, link);
    assert.equal(again.status, 303);
    assert.equal(again.cookie, made.cookie);
    // the old link lets nobody in: told when it was made anew (410); a browser asking for a page is
    // shown the page of a link that does not open the site, naming nobody
    const gone = await enter(S, bob.link);
    assert.equal(gone.status, 410);
    assert.match(gone.text, /^This personal link was made anew on \d{4}-\d\d-\d\d: it lets nobody in any more\./);
    const page = await enter(S, bob.link, BROWSER);
    assert.equal(page.status, 403);
    assert.equal(page.text, accessPageHtml("link"));
    // its cookie neither: the page's requests are told so (410), and the page, reloaded, says the
    // link no longer opens the site and forgets the cookie
    const asked = await S.ask("GET", "/api/identity", undefined, as);
    assert.equal(asked.status, 410);
    assert.equal(asked.json!.revoked, true);
    assert.match(asked.json!.error, /made anew/);
    const reload = await fetch(S.base + "/", { headers: { ...as, ...BROWSER } });
    assert.equal(reload.status, 403);
    assert.equal(await reload.text(), accessPageHtml("link"));
    assert.ok(reload.headers.getSetCookie().some((c) => c.startsWith(`${S.live.invites.cookieName}=;`) && /Max-Age=0/.test(c)));
    assert.equal((await mine(S, as)).status, 410);
    // a browser the key lets in too goes on as a guest, told why
    const guest = await S.ask("GET", "/api/identity", undefined, { ...as, authorization: `Bearer ${KEY}` });
    assert.equal(guest.status, 200);
    assert.equal(guest.json!.person, undefined);
    assert.equal(guest.json!.replaced.name, "Robert");
    assert.match(guest.json!.replaced.at, /^\d{4}-/);
    // nor does the list: the link in force as it was
    const list = await S.ask("GET", "/api/share/people", undefined, now);
    assert.deepEqual(list.json!.invites.map((p: Json) => [p.id, p.name, p.revoked]), [[id, "Robert", null]]);
    // revoked since: the cookies of every secret it had say so
    assert.equal((await S.ask("POST", "/api/share/people/revoke", { id }, OWNER)).status, 200);
    for (const c of [as, now]) assert.match((await S.ask("GET", "/api/identity", undefined, c)).json!.error, /revoked by Olivia/);
    // a browser the key lets in too is told by whom, its requests leaving the cookie for the page to
    // forget as it loads
    const told = await S.ask("GET", "/api/identity", undefined, { ...now, authorization: `Bearer ${KEY}` });
    assert.equal(told.json!.revoked.by, "Olivia");
    assert.deepEqual(told.headers.getSetCookie(), []);
  } finally {
    await S.close();
  }
});

test("made anew, the old link's pages are cut off at once, but the one that made it anew", async () => {
  const S = await site({ key: KEY });
  try {
    const bob = await invite(S, "Bob");
    const { cookie } = await enter(S, bob.link);
    const here = stream(S.port, "/api/events?session=aaaaaaaa1111", { cookie });
    const there = stream(S.port, "/api/events?session=bbbbbbbb2222", { cookie });
    await here.until(() => !!here.last("hello"));
    await there.until(() => !!there.last("hello"));
    const open = () => (S.live.status() as { streams: { open: number } }).streams.open;
    assert.equal(open(), 2);
    const made = await renew(S, { cookie }, { stream: here.last("hello")!.token });
    assert.equal(made.status, 200);
    await there.until(() => open() === 1);
    // this page goes on: told what every page is told
    const told = here.events.length;
    await invite(S, "Carol");
    await here.until(() => here.events.slice(told).some((e) => e.event === "people"));
    // the other comes back with the old cookie, and is told the link no longer lets it in
    const back = stream(S.port, "/api/events?session=bbbbbbbb2222", { cookie });
    assert.equal(await back.opened, 410);
    // a page of this browser — the new cookie — comes back as it was
    const tab = stream(S.port, "/api/events?session=cccccccc3333", { cookie: made.cookie });
    assert.equal(await tab.opened, 200);
    for (const s of [here, there, back, tab]) s.close();
  } finally {
    await S.close();
  }
});

test("the file: the token kept beside its digest, the last old digests, mode 600; a token that is not the link's own is never shown", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-mylink-"));
  try {
    const a = new Invites(dir);
    const made = a.create({ name: "Bob", by: "Olivia" });
    assert.ok(typeof made !== "string");
    const id = made.record.id;
    assert.equal(a.tokenOf(id), made.token);
    assert.equal(a.tokenOf("0123456789"), undefined);
    let token = made.token;
    for (let i = 0; i < 20; i++) token = a.renew(id)!.token;
    a.close();
    const file = join(dir, "person-invites.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const kept = JSON.parse(readFileSync(file, "utf8")) as { invites: Json[] };
    assert.equal(kept.invites[0].token, token);
    assert.equal(kept.invites[0].replaced.length, 16, "the last 16 old digests");
    // read again: the link as it is, the oldest secrets nobody's, the latest old one told it was made anew
    const b = new Invites(dir);
    assert.equal(b.tokenOf(id), token);
    assert.ok(b.check(token) && "ok" in b.check(token)!);
    assert.equal(b.check(made.token), null, "older than the old digests kept");
    b.close();
    // a token written over by hand, of another id or not the digest's: never shown, the link as one
    // made before 0.6.0, which its holder makes anew
    // a file that cannot be written: the link stays as it was, its old secret letting in
    if (process.getuid?.() !== 0) {
      const c = new Invites(dir);
      chmodSync(dir, 0o500);
      try {
        assert.throws(() => c.renew(id));
      } finally {
        chmodSync(dir, 0o700);
      }
      assert.equal(c.tokenOf(id), token);
      assert.equal(c.get(id)?.replaced?.length, 16);
      assert.ok(c.check(token) && "ok" in c.check(token)!);
      c.close();
    }
    for (const bad of [token.replace(id, "0123456789"), `vpp_${id}_${"A".repeat(43)}`, 42]) {
      writeFileSync(file, JSON.stringify({ ...kept, invites: [{ ...kept.invites[0], token: bad, replaced: "nothing" }] }));
      const c = new Invites(dir);
      assert.equal(c.tokenOf(id), null, String(bad));
      assert.equal(c.get(id)?.replaced, undefined);
      assert.ok(c.check(token) && "ok" in c.check(token)!, "the digest still lets its link in");
      c.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the page: My personal link in the name's menu of whoever came by one alone; the window says what making it anew does", () => {
  const menu = (mode: NameMode, myLink = true) =>
    menuHtml({ mode: () => mode, name: () => "Bob", visibility: () => "visible", rename: () => {}, setVisibility: () => {}, ...(myLink ? { myLink: () => {} } : {}) });
  assert.match(menu("person"), /data-act="mylink"><span class="wm-t">My personal link…<\/span>/);
  for (const mode of ["declared", "header", "none"] as const) assert.doesNotMatch(menu(mode), /mylink/, mode);
  assert.doesNotMatch(menu("person", false), /mylink/);
  // the link, escaped; Copy; whoever has it is them; making it anew offered below
  const shown = myLinkHtml({ kind: "link", link: 'http://h/i/vpp_0123456789_"<x>', made: false, copied: null });
  assert.match(shown, /value="http:\/\/h\/i\/vpp_0123456789_&quot;&lt;x&gt;"/);
  assert.match(shown, /Whoever has this link comes in as you: keep it to yourself\./);
  assert.match(shown, /data-ml-copy>Copy</);
  assert.match(shown, /data-ml-anew>Make it anew…</);
  assert.match(myLinkHtml({ kind: "link", link: "l", made: true, copied: true }), /Made anew: the old link lets nobody in any more.*data-ml-copy>Copied</s);
  // a link made before 0.6.0: not shown, made anew
  const old = myLinkHtml({ kind: "old" });
  assert.match(old, /made before VisualProof 0\.6\.0/);
  assert.doesNotMatch(old, /<input/);
  assert.match(old, /data-ml-anew>Make my link anew…</);
  // asked before: what it cuts off, and that this browser stays in
  const ask = myLinkHtml({ kind: "confirm", busy: false, error: null });
  assert.ok(ask.includes(ANEW));
  assert.match(ANEW, /every browser it let you in .* is cut off; this browser stays in/);
  assert.match(myLinkHtml({ kind: "confirm", busy: true, error: null }), /data-ml-confirm disabled/);
});
