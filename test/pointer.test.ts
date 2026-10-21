// Pointers in a room (the owner's decisions of 2026-10-20; CollabSpec decision 4; shared/pointer.ts,
// web/src/pointers.ts): a reader and those who follow them directly see one another's pointers and
// text selections. The room is direct relations alone; a private or read-only reader's pointer goes
// to nobody, though they are sent their room's; the server relays within the room, at a bounded
// rate, and keeps nothing. A place is said as what it is on and found again on another page's
// layout — another size, another scroll — or said to be scrolled away.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cleanAt, cleanPointer, cleanSel, cleanText, FADE_MS, inRoom, RELAY_PER_S, roomOf, SHOWN, STEPS_MAX } from "../src/shared/pointer.ts";
import type { PointerAt, PointerNews, RoomPage } from "../src/shared/pointer.ts";
import type { StreamHello } from "../src/shared/collab.ts";
import { anchorAt, drawnOf, follow, lineColOf, offsetOf, resolveAt, stepsTo } from "../src/web/src/pointers.ts";
import type { AnchorHooks } from "../src/web/src/pointers.ts";
import { readOnlyAllows } from "../src/server/readonlygate.ts";
import { site, stream } from "./site.ts";

// ---------------------------------------------------------------- the room

const page = (id: string, key: string | null, follows: string | null = null): RoomPage => ({ id, key, follows });

test("the room is direct relations alone: whom a page follows, who follows it, who follows the same reader", () => {
  const P = page("p", "n:Pat");
  const A = page("a", "n:Alice", "n:Pat");
  const B = page("b", "n:Bob", "n:Pat");
  // C follows A, who follows P: a chain is two rooms
  const C = page("c", "n:Carol", "n:Alice");
  const E = page("e", "n:Eve");
  const all = [P, A, B, C, E];
  // P's pointer: to those following P
  assert.deepEqual(roomOf(P, all).sort(), ["a", "b"]);
  // A's: to P (whom A follows), B (who follows P too), C (who follows A)
  assert.deepEqual(roomOf(A, all).sort(), ["b", "c", "p"]);
  // C's: to A alone — not P, whom C does not follow; not B
  assert.deepEqual(roomOf(C, all), ["a"]);
  assert.deepEqual(roomOf(E, all), [], "in no room: sent to nobody");
  // as each page works out whom it draws
  assert.ok(inRoom(P, A) && inRoom(A, P) && inRoom(A, B) && inRoom(B, A) && inRoom(C, A) && inRoom(A, C));
  assert.ok(!inRoom(C, P) && !inRoom(P, C) && !inRoom(C, B));
  // never one's own pages: a person with two pages following the same reader
  const A2 = page("a2", "n:Alice", "n:Pat");
  assert.ok(!inRoom(A, A2) && !inRoom(A2, A));
  // a private or read-only page (nobody sees it) is sent its room's, and its own goes to nobody
  const hidden = page("h", null, "n:Pat");
  assert.ok(roomOf(P, [...all, hidden]).includes("h") && roomOf(A, [...all, hidden]).includes("h"));
  assert.deepEqual(roomOf(hidden, [...all, hidden]), []);
});

// ---------------------------------------------------------------- what a page sends, checked

test("what a page sends is checked as every field: a place of each kind, a selection, a click; anything else is none", () => {
  const steps = [["id", "panel-body", 0], ["data-go", "FltRegular.caseII", 3], [null, null, 1], ["data-ex-go", null, 0]];
  const good: PointerAt[] = [
    { b: [12.5, -40] },
    { l: ["decl:FltRegular.caseII", 0.5, 120] },
    { sw: "FltRegular.caseII", lc: [3, 14] },
    { pw: [12, 0.25, 0.8] },
    { in: { id: "panel" }, p: steps as never, f: [0.1, 0.9] },
    { in: { sw: "FltRegular.caseII" }, p: [], f: [0.5, 0.5] },
    { in: { pw: true }, p: [[null, null, 0]], f: [0, 1] },
  ];
  for (const at of good) assert.deepEqual(cleanAt(at), at, JSON.stringify(at));
  const bad = [
    { b: [1] },
    { b: [Infinity, 0] },
    { l: ["", 0.5, 1] },
    { sw: "A", lc: [-1, 0] },
    { sw: "A", lc: [1.5, 0] },
    { pw: [1, 7, 0] },
    { in: { id: "1bad" }, p: [], f: [0, 0] },
    { in: { id: "panel" }, p: [["onclick", "x", 0]], f: [0, 0] },
    { in: { id: "panel" }, p: [["data-x", "a\nb", 0]], f: [0, 0] },
    { in: { id: "panel" }, p: Array.from({ length: STEPS_MAX + 1 }, () => [null, null, 0]), f: [0, 0] },
    { in: { id: "panel" }, p: [[null, null, -1]], f: [0, 0] },
    "board",
    null,
  ];
  for (const at of bad) assert.equal(cleanAt(at), null, JSON.stringify(at));
  assert.deepEqual(cleanText({ in: { id: "panel" }, p: [], o: 42 }), { in: { id: "panel" }, p: [], o: 42 });
  assert.equal(cleanText({ in: { id: "panel" }, p: [], o: -1 }), null);
  assert.deepEqual(cleanSel({ a: { sw: "A.b", lc: [0, 2] }, b: { sw: "A.b", lc: [1, 0] } }), { a: { sw: "A.b", lc: [0, 2] }, b: { sw: "A.b", lc: [1, 0] } });
  assert.equal(cleanSel({ a: { sw: "A.b", lc: [0, 2] } }), null);
  // what the room is told: the place, the selection, a click — nothing else a page sends
  assert.deepEqual(cleanPointer({ token: "t", at: { b: [1, 2] }, sel: null, click: true, following: "n:X", extra: 1 }), { at: { b: [1, 2] }, sel: null, click: true });
  assert.deepEqual(cleanPointer({ at: "here", click: "yes" }), { at: null, sel: null });
  // a read-only reader says whom it follows here: the gate lets it
  assert.equal(readOnlyAllows("POST", "/api/pointer"), true);
  assert.equal(SHOWN, 5);
});

// ---------------------------------------------------------------- the server relays within the room

test("the server relays a pointer within its room alone — private and read-only pages sent theirs, never heard — at a bounded rate, keeping nothing", async () => {
  const S = await site();
  try {
    const open = async (session: string, headers: Record<string, string> = {}) => {
      const s = stream(S.port, `/api/events?session=${session}`, headers);
      await s.until(() => !!s.last("hello"));
      return { s, hello: s.last("hello") as StreamHello };
    };
    const KEY = {};
    const pat = await open("pppppppp1111");
    const alice = await open("aaaaaaaa1111");
    const bob = await open("bbbbbbbb1111");
    const carol = await open("cccccccc1111");
    const dave = await open("dddddddd1111");
    const eve = await open("eeeeeeee1111");
    const beat = (w: { hello: StreamHello }, name: string, body: Record<string, unknown>) => S.ask("POST", "/api/presence", { token: w.hello.token, ...body }, { ...KEY, "x-visualproof-name": name });
    const VIEW = { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
    await beat(pat, "Pat", { view: VIEW, idle: false });
    await beat(alice, "Alice", { view: { ...VIEW, following: "n:Pat" }, idle: false });
    await beat(bob, "Bob", { view: { ...VIEW, following: "n:Alice" }, idle: false });
    // Carol follows Pat privately; Dave follows Alice; Eve nobody
    await beat(carol, "Carol", { private: true, following: "n:Pat" });
    await beat(dave, "Dave", { view: { ...VIEW, following: "n:Alice" }, idle: false });
    await beat(eve, "Eve", { view: VIEW, idle: false });
    // a read-only page follows Pat: it says so on the pointer's route, and nowhere else
    const rita = await open("rrrrrrrr1111");
    const readOnly = [...(S.live as unknown as { streams: Map<unknown, { token: string; readOnly: string | null }> }).streams.values()].find((st) => st.token === rita.hello.token)!;
    readOnly.readOnly = "public";
    assert.equal((await S.ask("POST", "/api/pointer", { token: rita.hello.token, following: "n:Pat" }, KEY)).json!.to, 0);
    await new Promise((ok) => setTimeout(ok, 700));
    const heard = (w: { s: ReturnType<typeof stream> }) => w.s.events.filter((e) => e.event === "pointer").map((e) => e.data as PointerNews);
    const point = async (w: { hello: StreamHello }, at: PointerAt, more: Record<string, unknown> = {}) => (await S.ask("POST", "/api/pointer", { token: w.hello.token, at, sel: null, ...more }, KEY)).json!;
    // Alice's pointer: to Pat (whom she follows), Carol and Rita (who follow Pat too), Bob and Dave
    // (who follow her); not Eve
    const r = await point(alice, { b: [1, 2] }, { click: true });
    assert.equal(r.to, 5);
    await new Promise((ok) => setTimeout(ok, 200));
    for (const w of [pat, carol, rita, bob, dave]) assert.deepEqual(heard(w).at(-1), { from: alice.hello.id, at: { b: [1, 2] }, sel: null, click: true });
    assert.equal(heard(eve).length, 0);
    assert.equal(heard(alice).length, 0, "not to herself");
    // Bob's: to Alice and Dave (who follows Alice too) — not Pat: chains are two rooms
    assert.equal((await point(bob, { b: [3, 4] })).to, 2);
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal(heard(dave).at(-1)!.from, bob.hello.id);
    assert.ok(!heard(pat).some((n) => n.from === bob.hello.id));
    // a private reader's pointer, and a read-only one's, go to nobody
    assert.equal((await point(carol, { b: [0, 0] })).to, 0);
    assert.equal((await point(rita, { b: [0, 0] })).to, 0);
    assert.ok(![...heard(pat), ...heard(alice)].some((n) => n.from === carol.hello.id || n.from === rita.hello.id));
    assert.ok(!JSON.stringify(pat.s.events).includes("Carol"));
    // a secret no stream has: refused
    assert.equal((await S.ask("POST", "/api/pointer", { token: "nobody", at: { b: [0, 0] } }, KEY)).status, 403);
    // the rate: a burst of pointers, at most RELAY_PER_S a second relayed
    const before = heard(bob).length;
    const sent = await Promise.all(Array.from({ length: RELAY_PER_S + 10 }, (_, i) => point(pat, { b: [i, i] })));
    assert.equal(sent.filter((x) => x.to > 0).length, RELAY_PER_S);
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(heard(alice).length >= RELAY_PER_S, "Pat's room hears them");
    assert.equal(heard(bob).length, before, "Bob follows Alice, not Pat");
    // nothing is kept: the server's state is the streams' and the presence it had
    assert.ok(!JSON.stringify(S.live.presence.list()).includes('"b":'));
    for (const w of [pat, alice, bob, carol, dave, eve, rita]) w.s.close();
  } finally {
    await S.close();
  }
});

// ---------------------------------------------------------------- found again on another layout

/** Just enough of an element for the anchoring: an id, attributes, children, a box on the screen,
 *  whether it clips what it holds; `closest` and `matches` of the selectors the anchoring uses. */
class El {
  id = "";
  attrs = new Map<string, string>();
  classes: string[] = [];
  children: El[] = [];
  parentElement: El | null = null;
  box = { left: 0, top: 0, width: 0, height: 0 };
  clips = false;
  tag: string;
  constructor(tag: string, o: { id?: string; cls?: string; attrs?: Record<string, string>; box?: [number, number, number, number]; clips?: boolean } = {}, kids: El[] = []) {
    this.tag = tag;
    this.id = o.id ?? "";
    this.classes = (o.cls ?? "").split(" ").filter(Boolean);
    for (const [k, v] of Object.entries(o.attrs ?? {})) this.attrs.set(k, v);
    if (o.box) this.box = { left: o.box[0], top: o.box[1], width: o.box[2], height: o.box[3] };
    this.clips = !!o.clips;
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  hasAttribute(a: string) {
    return this.attrs.has(a);
  }
  getAttribute(a: string) {
    if (a === "class") return this.classes.length ? this.classes.join(" ") : null;
    return this.attrs.get(a) ?? null;
  }
  getBoundingClientRect() {
    const b = this.box;
    return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height, width: b.width, height: b.height, x: b.left, y: b.top };
  }
  getClientRects() {
    return this.box.width || this.box.height ? [this.getBoundingClientRect()] : [];
  }
  private one(sel: string): boolean {
    const m = /^([a-z]*)((?:[#.][\w-]+)*)$/.exec(sel.trim());
    if (!m) return false;
    if (m[1] && m[1] !== this.tag) return false;
    for (const part of m[2].match(/[#.][\w-]+/g) ?? []) if (part[0] === "#" ? this.id !== part.slice(1) : !this.classes.includes(part.slice(1))) return false;
    return true;
  }
  matches(sels: string): boolean {
    return sels.split(",").some((sel) => {
      const parts = sel.trim().split(/\s+/);
      if (!this.one(parts.at(-1)!)) return false;
      let at: El | null = this.parentElement;
      for (const p of parts.slice(0, -1).reverse()) {
        while (at && !at.one(p)) at = at.parentElement;
        if (!at) return false;
        at = at.parentElement;
      }
      return true;
    });
  }
  closest(sels: string): El | null {
    for (let e: El | null = this; e; e = e.parentElement) if (e.matches(sels)) return e;
    return null;
  }
  contains(x: El): boolean {
    for (let e: El | null = x; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
}

/** A followed panel as two pages lay it out: the rows of a declaration's review, each keyed by what
 *  it goes to, under a heading; the follower's panel is narrower, its list scrolled, and it has a
 *  line the other's has not ("Also here: Bob"). */
function panel(o: { left: number; width: number; scrolled: number; also: boolean; listH: number }) {
  const rowH = 30;
  const rows = ["FltRegular.caseI", "FltRegular.caseII", "FltRegular.flt_regular"].map(
    (name, i) => new El("div", { cls: "row", attrs: { "data-go": name }, box: [o.left + 8, 200 + i * rowH - o.scrolled, o.width - 16, rowH] }, [new El("button", { attrs: { "data-act": "approve" }, box: [o.left + o.width - 80, 205 + i * rowH - o.scrolled, 60, 20] })]),
  );
  const list = new El("div", { cls: "list", clips: true, box: [o.left, 180, o.width, o.listH] }, rows);
  const kids = [new El("h3", { box: [o.left, 100, o.width, 24] }), ...(o.also ? [new El("div", { cls: "also", box: [o.left, 130, o.width, 20] })] : []), list];
  const root = new El("aside", { id: "panel", box: [o.left, 90, o.width, 400] }, kids);
  return { root, rows };
}

const hooks = (byId: Record<string, El>, cam: { x: number; y: number; k: number; w: number; h: number }): AnchorHooks => ({
  toWorld: (x, y) => [(x - cam.w / 2) / cam.k + cam.x, (y - cam.h / 2) / cam.k + cam.y],
  toScreen: (x, y) => [(x - cam.x) * cam.k + cam.w / 2, (y - cam.y) * cam.k + cam.h / 2],
  boardRoom: () => ({ left: 0, top: 50, right: cam.w, bottom: cam.h }),
  linear: () => null,
  windowDecl: () => null,
  windowOf: () => null,
  yours: (el) => (el as unknown as El).closest("#share-pop") !== null,
  ...{ byId },
});

/** Run `f` as on a page whose elements by id are `byId`, of a screen `w` × `h`. */
function onPage<T>(byId: Record<string, El>, w: number, h: number, f: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const was = { document: g.document, getComputedStyle: g.getComputedStyle, innerWidth: g.innerWidth, innerHeight: g.innerHeight };
  g.document = { getElementById: (id: string) => byId[id] ?? null, querySelector: () => null, body: null };
  g.getComputedStyle = (e: El) => ({ overflowX: e.clips ? "auto" : "visible", overflowY: e.clips ? "auto" : "visible" });
  g.innerWidth = w;
  g.innerHeight = h;
  try {
    return f();
  } finally {
    Object.assign(g, was);
  }
}

test("a place found again on a page of another size and scroll: an element by what it is and where in it; the board by its world; a place scrolled away said so", () => {
  // the followed reader's page: a wide panel, its list not scrolled
  const lead = panel({ left: 1000, width: 400, scrolled: 0, also: false, listH: 120 });
  // the follower's: a narrow one on a smaller screen, its list shorter and scrolled by 25 px, with one
  // more line above it
  const fol = panel({ left: 700, width: 300, scrolled: 25, also: true, listH: 40 });
  const L = hooks({ panel: lead.root }, { x: 10, y: 20, k: 2, w: 1440, h: 900 });
  const F = hooks({ panel: fol.root }, { x: 10, y: 20, k: 2, w: 1024, h: 700 });
  // the pointer on caseII's Approve, a quarter across it and halfway down
  const btn = lead.rows[1].children[0];
  const at = onPage({ panel: lead.root }, 1440, 900, () => anchorAt(btn.box.left + 15, btn.box.top + 10, btn as never, L))!;
  assert.ok("in" in at);
  assert.deepEqual((at as { in: unknown }).in, { id: "panel" });
  assert.deepEqual((at as { f: unknown }).f, [0.25, 0.5]);
  const there = onPage({ panel: fol.root }, 1024, 700, () => resolveAt(at, F))!;
  const fbtn = fol.rows[1].children[0];
  // the same button on the follower's page, a quarter across and halfway down it, in what shows
  assert.equal(there.x, fbtn.box.left + 15);
  assert.equal(there.y, fbtn.box.top + 10);
  assert.ok(there.y >= there.box.top && there.y <= there.box.bottom, "shown");
  // the last row, below the follower's list as it is scrolled: found, outside what shows — the page
  // marks the edge, and a click scrolls there
  const last = lead.rows[2];
  const below = onPage({ panel: lead.root }, 1440, 900, () => anchorAt(last.box.left + 4, last.box.top + 4, last as never, L))!;
  const away = onPage({ panel: fol.root }, 1024, 700, () => resolveAt(below, F))!;
  assert.ok(away.y > away.box.bottom, "scrolled away below");
  assert.ok(typeof away.reveal === "function");
  // a row the follower's page does not have: not drawn
  const gone = { ...(at as object), p: (at as { p: unknown[] }).p.map((s, i) => (i === 1 ? ["data-go", "FltRegular.elsewhere", 1] : s)) } as PointerAt;
  assert.equal(onPage({ panel: fol.root }, 1024, 700, () => resolveAt(gone, F)), null);
  // the board: the same point of its world, wherever each page's screen puts it
  const canvas = new El("canvas", { id: "canvas", box: [0, 0, 1440, 900] });
  const b = onPage({}, 1440, 900, () => anchorAt(820, 470, canvas as never, L))!;
  assert.deepEqual(b, { b: [60, 30] });
  const onF = onPage({}, 1024, 700, () => resolveAt(b, F))!;
  assert.deepEqual([onF.x, onF.y], [612, 370]);
  assert.equal(onF.reveal, undefined, "the board's camera is followed: no scrolling it");
  // a surface of the reader's own is never said
  const share = new El("div", { id: "share-pop", box: [10, 10, 100, 100] }, [new El("button", { box: [20, 20, 40, 20] })]);
  assert.equal(onPage({}, 1440, 900, () => anchorAt(25, 25, share.children[0] as never, L)), null);
});

test("the steps down to an element: by what each is, then by place; deep elements held by the one STEPS_MAX down", () => {
  const a = new El("li", { attrs: { "data-go": "A" } });
  const b = new El("li", { attrs: { "data-go": "B" } }, [new El("span")]);
  const root = new El("ul", { id: "list" }, [a, b]);
  const path = stepsTo(root as never, b.children[0] as never)!;
  assert.deepEqual(path.steps, [["data-go", "B", 1], [null, null, 0]]);
  // a class says what an element is where nothing else does
  const list = new El("div", { cls: "list rows" }, [new El("p")]);
  assert.deepEqual(stepsTo(new El("div", { id: "x" }, [new El("h3"), list]) as never, list.children[0] as never)!.steps, [["class", "list", 1], [null, null, 0]]);
  // on a page where B comes first, and another row before it
  const b2 = new El("li", { attrs: { "data-go": "B" } }, [new El("span")]);
  const other = new El("ul", { id: "list" }, [new El("li", { attrs: { "data-go": "Z" } }), b2, new El("li", { attrs: { "data-go": "A" } })]);
  assert.equal(follow(other as never, path.steps), b2.children[0]);
  let deep = new El("i");
  const top = deep;
  for (let i = 0; i < STEPS_MAX + 4; i++) deep = new El("b", {}, [deep]);
  const r = new El("div", { id: "r" }, [deep]);
  const held = stepsTo(r as never, top as never)!;
  assert.equal(held.steps.length, STEPS_MAX);
  // code: a line and a column, from a point of its text and back
  const code = "theorem caseII :\n  P := by\n  simp";
  assert.deepEqual(lineColOf(code, code.indexOf("simp")), [2, 2]);
  assert.equal(offsetOf(code, [2, 2]), code.indexOf("simp"));
  assert.equal(offsetOf(code, [1, 99]), code.indexOf("\n  simp"), "a column past the line's end: its end");
  assert.equal(offsetOf(code, [9, 0]), null, "no such line");
});

test("at most five others' pointers drawn at once, the latest to move; one still for two seconds fades, its selection stays", () => {
  const now = 100_000;
  const others = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, moved: now - i * 100 }));
  assert.equal(SHOWN, 5);
  assert.deepEqual(drawnOf(others, now), ["p0", "p1", "p2", "p3", "p4"]);
  // still: faded, unless it holds a selection
  assert.deepEqual(drawnOf([{ id: "a", moved: now - FADE_MS - 500 }, { id: "b", moved: now - FADE_MS - 500, sel: {} }, { id: "c", moved: now - 10 }], now), ["c", "b"]);
});

test("a page followed by read-only readers alone is told that someone unseen follows — never who nor how many, counted nowhere — and sends its pointer for them (the owner's decision of 2026-10-21)", async () => {
  const S = await site();
  try {
    const open = async (session: string) => {
      const s = stream(S.port, `/api/events?session=${session}`);
      await s.until(() => !!s.last("hello"));
      return { s, hello: s.last("hello") as StreamHello };
    };
    const VIEW = { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
    const alice = await open("aaaaaaaa1111");
    const bob = await open("bbbbbbbb1111");
    await S.ask("POST", "/api/presence", { token: alice.hello.token, view: VIEW, idle: false }, { "x-visualproof-name": "Alice" });
    await S.ask("POST", "/api/presence", { token: bob.hello.token, view: VIEW, idle: false }, { "x-visualproof-name": "Bob" });
    // two read-only pages follow Alice
    const readOnly = async (session: string) => {
      const r = await open(session);
      const st = [...(S.live as unknown as { streams: Map<unknown, { token: string; readOnly: string | null }> }).streams.values()].find((x) => x.token === r.hello.token)!;
      st.readOnly = "public";
      return r;
    };
    const rita = await readOnly("rrrrrrrr1111");
    const rob = await readOnly("rrrrrrrr2222");
    const priv = (w: { s: ReturnType<typeof stream> }) => w.s.last("private") as { count: number; followers?: number; unseen?: true };
    await S.ask("POST", "/api/pointer", { token: rita.hello.token, following: "n:Alice" });
    await alice.s.until(() => priv(alice)?.unseen === true);
    await S.ask("POST", "/api/pointer", { token: rob.hello.token, following: "n:Alice" });
    await new Promise((ok) => setTimeout(ok, 100));
    // that someone does, never how many: no count, no follower; nobody else told
    assert.deepEqual(priv(alice), { count: 0, unseen: true });
    assert.ok(!bob.s.events.some((e) => e.event === "private" && (e.data as { unseen?: true }).unseen));
    assert.ok(!JSON.stringify(alice.s.events).includes(rita.hello.id) && !JSON.stringify(alice.s.events).includes(rob.hello.id), "nor who");
    // so Alice's page sends its pointer, and they are sent it
    assert.equal((await S.ask("POST", "/api/pointer", { token: alice.hello.token, at: { b: [1, 2] }, sel: null })).json!.to, 2);
    await rita.s.until(() => rita.s.events.some((e) => e.event === "pointer"));
    // one stops following, the other's page closes: Alice is told no one unseen follows any more
    await S.ask("POST", "/api/pointer", { token: rita.hello.token, following: null });
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(priv(alice).unseen, true, "Rob still does");
    rob.s.close();
    await alice.s.until(() => priv(alice)?.unseen === undefined);
    for (const w of [alice, bob, rita]) w.s.close();
  } finally {
    await S.close();
  }
});

test("a click's ripple grows where the click was: placed by `translate`, which the animation's `scale` leaves alone", () => {
  // placed by `transform`, the ring's offset is scaled with it (the individual `scale` applies after
  // `transform`): it swept across the screen from the corner instead of growing in place
  const css = readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8");
  const code = readFileSync(new URL("../src/web/src/pointers.ts", import.meta.url), "utf8");
  assert.match(css, /@keyframes ptr-ripple \{[^}]*scale:/);
  const ripple = /private ripple\([^]*?\n {2}\}/.exec(code)?.[0] ?? "";
  assert.match(ripple, /r\.style\.translate = /);
  assert.doesNotMatch(ripple, /r\.style\.transform = /);
});
