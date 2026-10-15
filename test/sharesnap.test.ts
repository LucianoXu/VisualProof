// A share link that carries exactly what the sharer sees (CollabSpec decision 7, the owner's decision
// of 2026-10-12): Share's switch, on by default, makes its links carry after the address a snapshot of
// every followed part (shared/sharesnap.ts), the camera as the region of the board it showed, fitted
// into the opener's screen; off, the address alone, as before. It travels in the fragment, past the
// access link's key and a personal link's token; an old link reads as it did; what is no longer there
// is said in a line; and agents make such links from their own place or one they give.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanArtwork, cleanView } from "../src/shared/collab.ts";
import type { PresenceView } from "../src/shared/collab.ts";
import { addressOf, camOf, goneNames, missingLine, readSnapshot, regionOf, SNAPSHOT_FORMS, SNAPSHOT_MAX, snapshotIn, sortOut, withSnapshot, writeSnapshot } from "../src/shared/sharesnap.ts";
import type { Region, Screen } from "../src/shared/sharesnap.ts";
import { decodeState, encodeState } from "../src/web/src/state.ts";
import { FOLLOWED, followedOf, pressActs, keyActs } from "../src/web/src/surfaces.ts";
import type { PageEl, PageParts } from "../src/web/src/surfaces.ts";
import { routes } from "../src/server/mcptools.ts";
import type { ReadOnlyLinkShown } from "../src/web/src/data.ts";
import { site } from "./site.ts";
import type { Json } from "./site.ts";

const N = (s: string) => `FltRegular.CaseII.InductionStep.Proof.${s}`;
/** the sharer's canvas: a wide screen, the side panel and the panel open */
const WIDE: Screen = { w: 1600, h: 1000, insets: { left: 300, right: 420, top: 120, bottom: 48 } };
/** the opener's: a laptop with the side panel folded */
const SMALL: Screen = { w: 1024, h: 700, insets: { left: 0, right: 0, top: 100, bottom: 48 } };

/** Everything a page can show at once: a view, a build, a camera, a selection under Keys, the focus,
 *  a trail of visitors, six pinned windows beside the following one, the reference window on a link,
 *  Activity filtered, the lost-and-found, the Status colouring, the edges hidden. */
function heavy(): PresenceView {
  return {
    view: "v7f3a9c2e41",
    scope: "tcb(flt_regular) except trusted except external",
    clusterMode: "module",
    history: { snapshot: 137 },
    cam: { x: 1234.5678, y: -987.25, k: 0.8312 },
    mode: "keys",
    selection: `tcb(${N("Units.unitsBound")}) and (key(flt_regular) or decl(${N("Units.unitsBound")})) or decl(${N("Ideal.idealPrincipal")})`,
    focus: "flt_regular",
    visitors: Array.from({ length: 8 }, (_, i) => ({ decl: N(`Norm.normLemma${i}`), at: [1234.5 + i, 99.9] as [number, number], from: N("Units.unitsBound"), in: N("Norm"), spot: [12.3 * i, -45.6] as [number, number] })),
    sel: N("Units.unitsBound"),
    source: true,
    sourceCollapsed: true,
    pinned: Array.from({ length: 6 }, (_, i) => ({ decl: N(`Galois.galois_${i}_commutes`), collapsed: i % 2 === 0 })),
    paper: { file: "3f".repeat(32), page: 12, link: "l0123456789ab", collapsed: true },
    activity: { open: true, kind: "review", who: "people", mine: "Olivia Park" },
    lostFound: { open: true },
    scheme: "status",
    edges: false,
    linear: false,
    artwork: { w: 4961, h: 3508, scheme: "kind", theme: "dark", background: "transparent", labels: "board", namesFrom: "board", hiddenNames: [], shownNames: [], edges: "selection", notes: true, targets: "highlight", shownTargets: [], keys: true, selection: true, source: true, style: "stars", title: "Sphere Packing", subtitle: null, titleSize: 9.5, footSize: 2.4, ruledNames: [], border: true, region: [1201.25, -950.5, 1480.3, 1046.7] },
    tabs: ["project", "v7f3a9c2e41"],
  };
}

const near = (a: number, b: number, eps: number, what: string) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`);
const sameRegion = (a: Region, b: Region, what: string) => {
  near(a.x, b.x, 0.05, `${what} x`);
  near(a.y, b.y, 0.05, `${what} y`);
  near(a.w, b.w, 0.05, `${what} w`);
  near(a.h, b.h, 0.05, `${what} h`);
};

test("every followed part has a form in the snapshot, holding exactly its fields: a part declared without one fails here", () => {
  assert.deepEqual(Object.keys(SNAPSHOT_FORMS).sort(), FOLLOWED.map((p) => p.part).sort());
  for (const p of FOLLOWED) assert.deepEqual([...SNAPSHOT_FORMS[p.part].fields], [...p.fields], p.part);
});

test("every followed part goes round the snapshot: read by the registry, written, read back as it was", async () => {
  const v = heavy();
  // the page's parts as the registry reads them: each gives its own fields
  const read = Object.fromEntries(FOLLOWED.map((p) => [p.part, () => Object.fromEntries(p.fields.map((f) => [f, v[f]]))])) as unknown as PageParts["read"];
  const seen = followedOf(read);
  assert.ok(!("tabs" in seen), "the views a page holds open are no part of what it shows");
  const back = await readSnapshot(await writeSnapshot(seen, WIDE), WIDE);
  assert.ok(back);
  for (const p of FOLLOWED)
    for (const f of p.fields) {
      if (f === "cam") {
        // the camera, as the region it showed, comes back on the same screen as it was
        const c = back.view.cam!;
        near(c.x, v.cam!.x, 0.1, "cam x");
        near(c.y, v.cam!.y, 0.1, "cam y");
        near(c.k, v.cam!.k, 0.001, "cam k");
      } else if (f === "visitors") {
        // each visitor's declaration, what it came from and its place; not where it was drawn
        assert.deepEqual(back.view.visitors, v.visitors!.map(({ at: _at, ...rest }) => rest), p.part);
      } else assert.deepEqual(back.view[f], v[f], `${p.part}: ${f}`);
    }
  assert.ok(!("tabs" in back.view));
  // a page that says nothing of a part (an older one, an agent) leaves it out, and the opener keeps
  // its own
  const some = await readSnapshot(await writeSnapshot({ view: "project", scope: null, sel: "N.a" }, null), null);
  assert.deepEqual(some!.view, { view: "project", scope: null, sel: "N.a" });
  assert.equal(some!.region, null);
});

test("the camera travels as the region of the board it showed: another screen shows the same region, fitted, not the same zoom", async () => {
  const v = heavy();
  const shown = regionOf(v.cam!, WIDE);
  // the room between the panels, in the board's world
  near(shown.w, (1600 - 300 - 420) / v.cam!.k, 1e-9, "width");
  near(shown.h, (1000 - 120 - 48) / v.cam!.k, 1e-9, "height");
  const back = (await readSnapshot(await writeSnapshot(v, WIDE), SMALL))!;
  sameRegion(back.region!, shown, "the region carried");
  const cam = back.view.cam!;
  assert.notEqual(cam.k, v.cam!.k, "a smaller screen: another zoom");
  // on the smaller screen the same centre, and all of the region, as large as the room allows
  const there = regionOf(cam, SMALL);
  near(there.x, shown.x, 0.1, "centre x");
  near(there.y, shown.y, 0.1, "centre y");
  assert.ok(there.w >= shown.w - 0.1 && there.h >= shown.h - 0.1, "all of it shows");
  assert.ok(Math.abs(there.w - shown.w) < 0.1 || Math.abs(there.h - shown.h) < 0.1, "and fills one side");
  // a larger screen comes closer; one whose panels leave no room frames it on the whole canvas
  const big = camOf(shown, { w: 2560, h: 1440, insets: { left: 300, right: 420, top: 120, bottom: 48 } });
  assert.ok(big.k > v.cam!.k);
  const cramped = camOf(shown, { w: 400, h: 300, insets: { left: 300, right: 420, top: 120, bottom: 48 } });
  assert.ok(Number.isFinite(cramped.k) && cramped.k > 0);
});

test("a heavy snapshot stays small: several windows, filters, visitors, a long selection — under 1,500 characters", async () => {
  const v = heavy();
  const raw = JSON.stringify(v).length;
  const snap = await writeSnapshot(v, WIDE);
  assert.match(snap, /^z[A-Za-z0-9_-]+$/, "deflated, in base64url: nothing in it to escape in an address");
  assert.ok(snap.length < 1500, `${snap.length} characters`);
  assert.ok(snap.length < raw / 3, "deflating pays");
  // one with little in it is not deflated where that does not pay
  const small = await writeSnapshot({ edges: true }, null);
  assert.match(small, /^j/);
  assert.deepEqual((await readSnapshot(small, null))!.view, { edges: true });
});

test("an artwork with as many names and targets chosen as it carries, of names the longer in bytes, fits in a heartbeat the server takes (16 KB) and in a link", async () => {
  const many = Array.from({ length: 2000 }, (_, i) => N(`«term_∘_∣_»_lemma_${i}`));
  const v = heavy();
  const art = cleanArtwork({ ...v.artwork, labels: "chosen", targets: "chosen", hiddenNames: many.map((n) => `d:${n}`), shownNames: many.map((n) => `c:${n}`), shownTargets: many })!;
  assert.ok(art.hiddenNames.length > 30 && art.shownNames.length > 30 && art.shownTargets.length > 20, `${art.hiddenNames.length} + ${art.shownNames.length} names, ${art.shownTargets.length} targets`);
  const view = cleanView({ ...v, artwork: art })!;
  const beat = JSON.stringify({ token: "t".repeat(64), view, idle: false });
  assert.ok(Buffer.byteLength(beat) < 16384, `${Buffer.byteLength(beat)} bytes`);
  const snap = await writeSnapshot(view, WIDE);
  assert.ok(snap.length < SNAPSHOT_MAX, `${snap.length} characters`);
  const back = (await readSnapshot(snap, WIDE))!.view.artwork!;
  assert.deepEqual([back.hiddenNames, back.shownNames, back.shownTargets], [art.hiddenNames, art.shownNames, art.shownTargets], "read back as written");
});

test("a snapshot is anyone's to write: what is not one is not read, and what of it is wrong is left out", async () => {
  for (const bad of ["", "z", "znot base64!", "jAAAA", "x" + "a".repeat(10), "z" + "A".repeat(SNAPSHOT_MAX)]) assert.equal(await readSnapshot(bad, WIDE), null, bad.slice(0, 12));
  // JSON that is not an object
  const j = (o: unknown) => "j" + Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(await readSnapshot(j([1, 2]), WIDE), null);
  // a part that is wrong goes, the others stay
  const r = (await readSnapshot(j({ sel: "N.a", paper: { file: "not a hash" }, region: [0, 0, -1, 5], scheme: "rainbow", visitors: [{ nope: 1 }, { decl: "N.b" }], edges: "yes" }), WIDE))!;
  assert.deepEqual(r.view, { sel: "N.a", visitors: [{ decl: "N.b" }] });
  assert.equal(r.region, null);
});

test("a snapshot naming what is no longer there: what still makes sense is applied, and the rest said", async () => {
  const shot = (await readSnapshot(await writeSnapshot(heavy(), WIDE), WIDE))!;
  // the build browsed is gone, the file is there but its link was removed
  const { view, gone } = sortOut(shot.view, { build: (id) => id !== 137, file: () => true, link: () => false });
  assert.equal(view.history, undefined, "not tried: the Time Machine would open at the latest build instead");
  assert.deepEqual(view.paper, { file: "3f".repeat(32), page: 12, collapsed: true }, "the file, at its page");
  assert.deepEqual(gone, { build: true, link: true });
  assert.equal(view.sel, shot.view.sel, "the rest as it was");
  // a file gone takes the window with it
  const noFile = sortOut(shot.view, { build: () => true, file: () => false, link: () => true });
  assert.equal(noFile.view.paper, undefined);
  assert.deepEqual(noFile.gone, { file: true });
  // once applied: the declarations the board's graph lacks, a focus on what is no target now
  const kept = new Set([N("Units.unitsBound"), N("Norm.normLemma0"), N("Galois.galois_0_commutes")]);
  const names = goneNames(view, [N("Units.unitsBound"), N("Ideal.idealPrincipal")], { decl: (n) => kept.has(n), target: () => false });
  assert.equal(names.decls!.length, 1 + 7 + 5, "the selection's, the visitors' and the pinned windows' it lacks, each once");
  assert.ok(names.decls!.includes(N("Ideal.idealPrincipal")) && !names.decls!.includes(N("Units.unitsBound")));
  assert.equal(names.focus, "flt_regular");
  assert.match(missingLine({ ...gone, ...names, view: true })!, /^Not shown from the link \(no longer here\): its view, its build, 13 declarations \(idealPrincipal, normLemma1, normLemma2, …\), the focus ★flt_regular, the link in the reference\.$/);
  // everything there: nothing said
  const all = sortOut(shot.view, { build: () => true, file: () => true, link: () => true });
  assert.equal(missingLine({ ...all.gone, ...goneNames(all.view, [], { decl: () => true, target: () => true }) }), null);
});

test("what could not be shown is said in one short line; nothing, where everything was", () => {
  assert.equal(missingLine({}), null);
  assert.equal(missingLine({ decls: [] }), null);
  const line = missingLine({ view: true, build: true, decls: [N("Units.unitsBound"), N("Units.unitsBound"), "A.b", "C.d", "E.f"], focus: "flt_regular", file: true, link: true })!;
  assert.equal(line, "Not shown from the link (no longer here): its view, its build, 4 declarations (unitsBound, b, d, …), the focus ★flt_regular, the reference file.");
  assert.ok(!line.includes("\n"));
  assert.equal(missingLine({ link: true }), "Not shown from the link (no longer here): the link in the reference.");
});

test("an old link reads as it did; the snapshot goes after the address, which says the same as without it", () => {
  const old = "#v=review%3AA.t&mode=tcb&sel=tcb%28A.b%29";
  assert.equal(snapshotIn(old), null);
  assert.equal(snapshotIn(""), null);
  const st = decodeState(old);
  const linked = withSnapshot(old, "zABC");
  assert.equal(linked, `${old}&snap=zABC`);
  assert.equal(snapshotIn(linked), "zABC");
  assert.deepEqual(decodeState(linked), st, "the address's parts are as they were");
  assert.ok(!encodeState(st!).includes("snap"), "the page's own address never carries one");
  // a link written by hand without the tool, and one with nothing but the snapshot
  assert.deepEqual(decodeState(withSnapshot("#v=review:A.t", "jAA")), decodeState("#v=review:A.t"));
  assert.equal(withSnapshot("", "jAA"), "#snap=jAA");
  assert.equal(decodeState("#snap=jAA"), null, "the address names nothing: the board on show, as before");
  // a snapshot given again replaces the one there
  assert.equal(withSnapshot(linked, "zDEF"), `${old}&snap=zDEF`);
  // an agent's link writes the address as a page does
  assert.deepEqual(decodeState("#" + addressOf({ view: "v1", scope: null, mode: "plain", selection: "decl(A.b)", sel: "A.b" })), { view: "v1", scope: null, mode: "plain", picks: "decl(A.b)", shown: { decl: "A.b" } });
  assert.deepEqual(decodeState("#" + addressOf({ view: "v2", scope: "tcb(A.b)", version: 7, mode: "tcb", sel: null })), { view: null, scope: "tcb(A.b)", version: 7, mode: "tcb", picks: null, shown: null });
});

// ------------------------------------------------------------------ Share's switch

/** Just enough of a page for Share's window: its markup is a string, its fields stand-ins. */
function sharePage(hash: string) {
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement ??= class {};
  g.location = { origin: "http://example.org:4173", hash, href: `http://example.org:4173/${hash}` };
  g.document = {
    activeElement: null,
    addEventListener() {},
    body: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, style: {}, select() {}, remove() {}, value: "" }),
    execCommand: () => false,
  };
  const listeners = new Map<string, (e: unknown) => void>();
  const stub = { focus() {}, select() {}, value: "", dataset: {}, textContent: "" };
  const pop = {
    hidden: true,
    innerHTML: "",
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
    querySelector: () => stub,
    contains: () => false,
  };
  const btn = { addEventListener() {}, classList: { add() {}, remove() {} }, contains: () => false };
  const press = async (sel: string, dataset: Record<string, string> = {}) => {
    listeners.get("click")!({ target: { closest: (s: string) => (s === sel ? { dataset } : null) } });
    await new Promise((ok) => setTimeout(ok, 20));
  };
  /** the link the window shows: the field's value, as the markup writes it */
  const shown = (cls = "sh-url") => new RegExp(`class="${cls}[^"]*" readonly value="([^"]*)"`).exec(pop.innerHTML)![1].replace(/&amp;/g, "&");
  return { pop, btn, press, shown };
}

test("Share's switch, Exactly what I see: on by default, the links carry the snapshot; off, only the view, as before; kept in the browser", async () => {
  const { Share } = await import("../src/web/src/share.ts");
  const hash = "#v=project&mode=tcb&sel=decl%28N.a%29";
  const page = sharePage(hash);
  const kept: { shareExact?: false } = {};
  const snap = await writeSnapshot(heavy(), WIDE);
  let asked = 0;
  const share = new Share(page.btn as never, page.pop as never, {
    info: async () => ({ path: "/k/KEY" }),
    data: { agentShares: async () => null, invites: async () => [], invite: async (name: string) => ({ invite: { id: "abc", name }, invites: [], link: "http://example.org:4173/i/vpp_0123456789_SECRET" }) } as never,
    me: () => "Alice",
    ensureName: async () => "Alice",
    snapshot: async () => (asked++, snap),
    exact: { get: () => kept.shareExact !== false, set: (on) => void (kept.shareExact = on ? undefined : false) },
  });
  await share.open();
  // on: the access link's path, the address as it is, and the snapshot after it
  const on = page.shown();
  assert.equal(on, `http://example.org:4173/k/KEY${hash}&snap=${snap}`);
  assert.equal(new URL(on).pathname, "/k/KEY", "the key stays in the path");
  assert.equal(snapshotIn(new URL(on).hash), snap, "the snapshot is in the fragment, which no server is sent");
  assert.ok(asked > 0);
  assert.match(page.pop.innerHTML, /role="switch" aria-checked="true" data-exact/);
  assert.match(page.pop.innerHTML, /Opens once on exactly what you see now/);
  // off: the link as it was before the switch, and the choice kept
  await page.press("[data-exact]");
  assert.deepEqual(kept, { shareExact: false });
  assert.equal(page.shown(), `http://example.org:4173/k/KEY${hash}`);
  assert.match(page.pop.innerHTML, /aria-checked="false"/);
  assert.match(page.pop.innerHTML, /Opens on the view and its selection/);
  // a personal link takes the address after it, and the snapshot as the switch says
  await page.press("[data-tab]");
  await page.press("[data-exact]");
  assert.equal(kept.shareExact, undefined);
  (share as unknown as { inviteName: string }).inviteName = "Bob";
  await page.press("[data-invite-create]");
  const invite = page.shown("sh-url sh-invite-url");
  assert.equal(invite, `http://example.org:4173/i/vpp_0123456789_SECRET${hash}&snap=${snap}`);
  assert.equal(new URL(invite).pathname, "/i/vpp_0123456789_SECRET", "the token stays in the path");
  await page.press("[data-exact]");
  assert.equal(page.shown("sh-url sh-invite-url"), `http://example.org:4173/i/vpp_0123456789_SECRET${hash}`);
  // the switch is the reader's own: pressing it, by the pointer or the keys, never ends following
  const sw: PageEl = { matches: (s) => s.split(",").some((x) => ["button", "[data-exact]"].includes(x.trim())), parentElement: { matches: (s) => s.split(",").some((x) => x.trim() === "#share-pop"), parentElement: null } };
  assert.equal(pressActs(sw), false);
  assert.equal(keyActs({ key: " " }, sw, false), false);
  assert.equal(keyActs({ key: "Enter" }, sw, false), false);
});

test("Share's read-only link (CollabSpec decision 11): made, listed, shown again and revoked by those let in; a read-only reader's Share gives only the link they came by", async () => {
  const { Share } = await import("../src/web/src/share.ts");
  const hash = "#v=project&mode=tcb";
  const snap = await writeSnapshot(heavy(), WIDE);
  const exact = { get: () => true, set() {} };
  const tabs = (html: string) => [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
  const at = (path: string) => `http://example.org:4173${path}`;
  const made: ReadOnlyLinkShown = { id: "0123456789", path: "/r/vpr_0123456789_S", link: at("/r/vpr_0123456789_S"), by: "Alice", created: new Date().toISOString(), revoked: null, revokedBy: null, lastUsed: null };
  const old: ReadOnlyLinkShown = { ...made, id: "aaaaaaaaaa", path: "/r/vpr_aaaaaaaaaa_T", link: at("/r/vpr_aaaaaaaaaa_T"), by: null };
  const gone: ReadOnlyLinkShown = { ...made, id: "bbbbbbbbbb", revoked: new Date().toISOString(), revokedBy: "Bob" };

  // a reader let in by the key, on a server that makes read-only links
  let page = sharePage(hash);
  let links = [old, gone];
  const revoked: string[] = [];
  const data = {
    agentShares: async () => null,
    invites: async () => [],
    readOnlyLinks: async () => links,
    makeReadOnly: async () => ((links = [made, ...links]), { made, links }),
    revokeReadOnly: async (id: string) => (revoked.push(id), (links = links.filter((l) => l.id !== id)), { links }),
  };
  let share = new Share(page.btn as never, page.pop as never, { info: async () => ({ path: "/k/KEY", readOnlyLinks: true }), data: data as never, me: () => null, ensureName: async () => "Alice", snapshot: async () => snap, exact });
  await share.open();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(tabs(page.pop.innerHTML), ["person", "readonly", "invite", "agent"]);
  assert.match(page.pop.innerHTML, />Guest link</, "decision 7's Public link, renamed");
  // the links in force are listed, not the revoked one
  assert.match(page.pop.innerHTML, /Read-only links/);
  assert.match(page.pop.innerHTML, /data-revoke-ro="aaaaaaaaaa"/);
  assert.doesNotMatch(page.pop.innerHTML, /bbbbbbbbbb/);
  // made: shown with the place and what the reader sees after it, and listed
  await page.press("[data-tab]", { tab: "readonly" });
  assert.match(page.pop.innerHTML, /data-ro-create/);
  await page.press("[data-ro-create]");
  assert.equal(page.shown("sh-url sh-ro-url"), `${made.link}${hash}&snap=${snap}`);
  assert.match(page.pop.innerHTML, /data-revoke-ro="0123456789"/);
  // another one's link shown again from the list
  await page.press("[data-ro-show]", { roShow: "aaaaaaaaaa" });
  assert.equal(page.shown("sh-url sh-ro-url"), `${old.link}${hash}&snap=${snap}`);
  // revoked on the second press, under a name; the link on show goes with it
  await page.press("[data-revoke-ro]", { revokeRo: "aaaaaaaaaa" });
  assert.deepEqual(revoked, []);
  assert.match(page.pop.innerHTML, /Revoke it/);
  await page.press("[data-revoke-ro]", { revokeRo: "aaaaaaaaaa" });
  assert.deepEqual(revoked, ["aaaaaaaaaa"]);
  assert.doesNotMatch(page.pop.innerHTML, /data-revoke-ro="aaaaaaaaaa"/);
  assert.match(page.pop.innerHTML, /data-ro-create/);

  // with --public: the address alone is the read-only link
  page = sharePage(hash);
  share = new Share(page.btn as never, page.pop as never, { info: async () => ({ path: "/k/KEY", readOnlyLinks: true, public: true }), data: data as never, me: () => null, ensureName: async () => "Alice", snapshot: async () => snap, exact });
  await share.open();
  await page.press("[data-tab]", { tab: "readonly" });
  assert.equal(page.shown("sh-url sh-ro-url"), at(`/${hash}&snap=${snap}`));
  assert.match(page.pop.innerHTML, /--public/);

  // a server that lets in whoever reaches it: no such tab
  page = sharePage(hash);
  share = new Share(page.btn as never, page.pop as never, { info: async () => ({ path: null, readOnlyLinks: false }), data: data as never, me: () => null, ensureName: async () => "Alice", snapshot: async () => snap, exact });
  await share.open();
  assert.deepEqual(tabs(page.pop.innerHTML), ["person", "invite", "agent"]);

  // a read-only reader: the link they came by, alone, and the server is asked nothing more
  page = sharePage(hash);
  const never = new Proxy({}, { get: (_, k) => () => assert.fail(`a read-only reader's Share asked ${String(k)}`) });
  share = new Share(page.btn as never, page.pop as never, { info: async () => ({ path: "/r/vpr_0123456789_S", readOnly: true }), data: never as never, me: () => null, ensureName: async () => null, snapshot: async () => snap, exact });
  await share.open();
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(tabs(page.pop.innerHTML), ["readonly"]);
  assert.equal(page.shown("sh-url sh-ro-url"), `${made.link}${hash}&snap=${snap}`);
  assert.match(page.pop.innerHTML, /The link you came by/);
  assert.doesNotMatch(page.pop.innerHTML, /data-ro-create|data-revoke|Guest link/);
  // let in by --public: the address
  page = sharePage(hash);
  share = new Share(page.btn as never, page.pop as never, { info: async () => ({ path: "/", readOnly: true }), data: never as never, me: () => null, ensureName: async () => null, snapshot: async () => snap, exact });
  await share.open();
  assert.equal(page.shown("sh-url sh-ro-url"), at(`/${hash}&snap=${snap}`));
  assert.match(page.pop.innerHTML, /the address is the read-only link/);
});

// ------------------------------------------------------------------ access, invites, agents

const KEY = "k".repeat(40);
const AGENT = { "x-visualproof-kind": "agent", "x-visualproof-name": "Claude" };

test("with the access key and a personal link: the server sends the browser on to the page with no fragment of its own, so the link's (the snapshot with it) is kept", async () => {
  const S = await site({ key: KEY });
  try {
    const snap = await writeSnapshot(heavy(), WIDE);
    const link = `${S.base}/k/${KEY}${withSnapshot("#v=project&mode=tcb", snap)}`;
    // fetch, as any client, never sends the fragment; the redirect names no fragment, which keeps
    // the link's across it (RFC 9110, 10.2.2)
    const r = await fetch(link, { redirect: "manual" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/");
    // a personal link the same
    const made = await S.ask("POST", "/api/share/people", { name: "Bob" }, { authorization: `Bearer ${KEY}`, "x-visualproof-name": "Olivia" });
    assert.equal(made.status, 200);
    const inv = await fetch(`${made.json!.link}${withSnapshot("#v=project&mode=tcb", snap)}`, { redirect: "manual" });
    assert.equal(inv.status, 303);
    assert.equal(inv.headers.get("location"), "/");
  } finally {
    await S.close();
  }
});

test("an agent makes such a link from its own place, or from a place it gives over its own; it moves nobody, holds no key, and says what it carries", async () => {
  const S = await site({ key: KEY, publicUrl: "http://example.org:4173" });
  const as = { ...AGENT, authorization: `Bearer ${KEY}` };
  try {
    assert.equal((await S.ask("POST", "/api/agent/view", { sel: "N.b", source: true }, as)).status, 200);
    // from its own place
    const own = (await S.ask("POST", "/api/agent/view/link", {}, as)).json!;
    assert.equal(own.ok, true);
    assert.equal(own.exact, true);
    const url = new URL(own.link);
    assert.equal(url.origin + url.pathname, "http://example.org:4173/", "no key in it");
    assert.ok(!own.link.includes(KEY));
    // on the Project, looking at N.b: which those following it select under its tool, as the address says
    assert.deepEqual(decodeState(url.hash), { view: null, scope: null, mode: "tcb", picks: "tcb(N.b)", shown: { decl: "N.b" } });
    const mine = (await readSnapshot(snapshotIn(url.hash)!, SMALL))!;
    assert.equal(mine.view.sel, "N.b");
    assert.equal(mine.view.source, true);
    assert.equal(mine.view.view, null, "the Project");
    assert.equal(mine.region, null, "an agent has no camera: the opener frames the board as for any link");
    // from a place it gives: everything followed, the region fitted to the opener's screen
    const given = await S.ask(
      "POST",
      "/api/agent/view/link",
      { sel: "N.a", selection: "tcb(N.a)", mode: "tcb", pinned: [{ name: "N.b", collapsed: true }], scheme: "status", edges: false, activity: { open: true, kind: "review" }, lostFound: true, region: [10, 20, 400, 300] },
      as,
    );
    assert.equal(given.status, 200);
    const shot = (await readSnapshot(snapshotIn(new URL(given.json!.link).hash)!, SMALL))!;
    assert.equal(shot.view.sel, "N.a");
    assert.equal(shot.view.selection, "tcb(N.a)");
    assert.deepEqual(shot.view.pinned, [{ decl: "N.b", collapsed: true }]);
    assert.deepEqual([shot.view.scheme, shot.view.edges], ["status", false]);
    assert.deepEqual(shot.view.activity, { open: true, kind: "review", who: "all" });
    assert.deepEqual(shot.view.lostFound, { open: true });
    sameRegion(shot.region!, { x: 10, y: 20, w: 400, h: 300 }, "the region given");
    // its height fills the opener's room, which is wider than the region
    sameRegion(regionOf(shot.view.cam!, SMALL), { x: 10, y: 20, w: (300 * 1024) / (700 - 148), h: 300 }, "fitted on the opener's screen");
    assert.equal(given.json!.carries.sel, "N.a");
    assert.match(given.json!.note, /no key/);
    // the agent did not move
    assert.equal(S.live.presence.agentView("Claude")?.sel, "N.b");
    // only the view: the address alone
    const plain = (await S.ask("POST", "/api/agent/view/link", { exact: false, sel: "N.a" }, as)).json!;
    assert.equal(plain.exact, false);
    assert.equal(snapshotIn(new URL(plain.link).hash), null);
    assert.deepEqual(decodeState(new URL(plain.link).hash)!.shown, { decl: "N.a" });
    // what is not there, or not one, is refused
    assert.equal((await S.ask("POST", "/api/agent/view/link", { history: 99 }, as)).status, 404);
    assert.equal((await S.ask("POST", "/api/agent/view/link", { region: [0, 0, 0, 1] }, as)).status, 400);
    assert.equal((await S.ask("POST", "/api/agent/view/link", { pinned: [{ name: "N.nope" }] }, as)).status, 404);
    assert.equal((await S.ask("POST", "/api/agent/view/link", { scheme: "rainbow" }, as)).status, 400);
    // the endpoint reference lists it, at any level (it only reads), and the MCP server offers it
    // as the view tool's action link
    const listed = (await S.ask("GET", "/api/agent/endpoints?path=/api/agent/view/link", undefined, as)).json!.endpoints as Json[];
    assert.deepEqual(listed.map((e) => [e.method, e.needs]), [["POST", undefined]]);
    const link = routes().find((r) => r.tool === "view" && r.action === "link");
    assert.deepEqual([link?.route.method, link?.route.path], ["POST", "/api/agent/view/link"]);
  } finally {
    await S.close();
  }
});
