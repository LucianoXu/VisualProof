// Follow again (CollabSpec, "Following ends"; the owner's decision of 2026-10-30): following ended by
// the reader's own action — a press, Back or Forward, a link followed from the conversation — leaves
// the strip offering to follow the same reader again, until the reader answers it, follows anyone, or
// that reader leaves; Esc, the strip's ✕ and the reader leaving end it without the offer.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { Peer, PresenceView } from "../src/shared/collab.ts";
import { People } from "../src/web/src/people.ts";
import type { DataSource } from "../src/web/src/data.ts";
import type { Store } from "../src/web/src/store.ts";

const VIEW = { mode: "tcb", sel: "N.a", source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };

type Listener = (e: unknown) => void;

/** The page as People reads it: the elements it asks for, the listeners it adds to the window and
 *  to the strip, and the events a reader makes, as the browser would deliver them. */
function fakePage(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, window: g.window, Element: g.Element, HTMLElement: g.HTMLElement, KeyboardEvent: g.KeyboardEvent };
  class FakeElement {}
  class FakeKeyboardEvent {}
  const on = new Map<string, Listener[]>();
  const add = (type: string, f: Listener) => on.set(type, [...(on.get(type) ?? []), f]);
  const mk = (sel: string) => {
    const classes = new Set<string>();
    return {
      innerHTML: "",
      hidden: true,
      textContent: "",
      title: "",
      dataset: {} as Record<string, string>,
      style: { setProperty() {} },
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), toggle() {}, contains: (c: string) => classes.has(c) },
      setAttribute() {},
      addEventListener: (type: string, f: Listener) => add(`${type}@${sel}`, f),
      contains: () => false,
    };
  };
  const els = new Map<string, ReturnType<typeof mk>>();
  const $ = (s: string) => els.get(s) ?? (els.set(s, mk(s)), els.get(s)!);
  g.document = { querySelector: $, body: mk("body"), activeElement: null, addEventListener() {}, hidden: false };
  g.window = { addEventListener: add };
  g.Element = FakeElement;
  g.HTMLElement = class {};
  g.KeyboardEvent = FakeKeyboardEvent;
  const fire = (type: string, e: Record<string, unknown>) => {
    for (const f of on.get(type) ?? []) f(e);
  };
  // the canvas: outside every surface, where any press moves the reader
  const canvas = Object.assign(Object.create(FakeElement.prototype), { matches: () => false, parentElement: null });
  // the strip's buttons, by what they carry
  const button = (attr: string) => ({ closest: (sel: string) => (sel === `[data-${attr}]` ? {} : null) });
  return {
    strip: $("#following"),
    text: () => $(".fl-strip").innerHTML,
    said: () => $(".fl-strip").textContent,
    press: () => fire("pointerdown", { isTrusted: true, target: canvas }),
    back: () => fire("popstate", {}),
    esc: () => fire("keydown", Object.assign(Object.create(FakeKeyboardEvent.prototype), { isTrusted: true, key: "Escape", target: canvas, preventDefault() {}, stopImmediatePropagation() {} })),
    click: (attr: string) => fire("click@#following", { target: button(attr) }),
    restore: () => Object.assign(g, saved),
  };
}

function reader() {
  const applied: (string | null)[] = [];
  const view = (sel: string): PresenceView => ({ ...VIEW, sel });
  const data = { privateSession: null, name: null, presence: async () => {} };
  const people = new People(data as unknown as DataSource, { data: {}, save() {} } as unknown as Store, {
    view: () => view("me"),
    describe: () => "",
    follow: (v) => applied.push(v.sel),
    changed: () => {},
    renamed: () => {},
    unfollowed: () => {},
  });
  const here = (...who: [string, string][]) => people.setPeers(who.map(([id, name]) => ({ id, name, view: view(`${name}.place`), idle: false })) as Peer[]);
  return { people, applied, here };
}

test("following ended by the reader's own press leaves Follow again, which follows the same reader as starting to does", (t) => {
  const page = fakePage(t);
  try {
    const { people, applied, here } = reader();
    people.start();
    here(["a1", "Ada"], ["b1", "Bob"]);
    people.follow("n:Bob");
    assert.equal(page.strip.classList.contains("again"), false);
    page.press();
    assert.equal(people.followedKey, null, "a press on the canvas ends following");
    assert.equal(page.strip.hidden, false, "the strip stays");
    assert.equal(page.strip.classList.contains("again"), true);
    assert.match(page.text(), /Stopped following <b>Bob<\/b>/);
    assert.match(page.text(), /data-again[^>]*>Follow again</);
    // no timer puts it away
    t.mock.timers.tick(10 * 60_000);
    assert.equal(page.strip.hidden, false, "it waits for an answer");
    page.click("again");
    assert.equal(people.followedKey, "n:Bob");
    assert.deepEqual(applied, ["Bob.place", "Bob.place"], "his state applied again, at once");
    assert.equal(page.strip.classList.contains("again"), false);
    assert.match(page.text(), /Following <b>Bob<\/b> · Esc to stop/);
  } finally {
    page.restore();
  }
});

test("Back or Forward and a link followed from the conversation offer it too; its ✕ puts it away", (t) => {
  const page = fakePage(t);
  try {
    const { people, here } = reader();
    people.start();
    here(["b1", "Bob"]);
    people.follow("n:Bob");
    page.back();
    assert.equal(people.followedKey, null);
    assert.equal(page.strip.classList.contains("again"), true, "Back offers it");
    page.click("dismiss");
    assert.equal(page.strip.hidden, true, "its ✕ puts it away");
    assert.equal(page.strip.classList.contains("again"), false);
    // a link from a message: web/src/pagetalk.ts calls leave()
    people.follow("n:Bob");
    people.leave();
    assert.equal(page.strip.classList.contains("again"), true);
    assert.equal(page.strip.hidden, false);
  } finally {
    page.restore();
  }
});

test("Esc, the strip's ✕ and the followed initials clicked again mean to stop: no offer", (t) => {
  const page = fakePage(t);
  try {
    const { people, here } = reader();
    people.start();
    here(["b1", "Bob"]);
    people.follow("n:Bob");
    page.esc();
    assert.equal(people.followedKey, null, "Esc stops following");
    assert.deepEqual([page.strip.hidden, page.strip.classList.contains("again")], [true, false]);
    people.follow("n:Bob");
    page.click("unfollow");
    assert.deepEqual([people.followedKey, page.strip.hidden, page.strip.classList.contains("again")], [null, true, false], "the strip's ✕");
    people.follow("n:Bob");
    people.follow("n:Bob");
    assert.deepEqual([people.followedKey, page.strip.hidden, page.strip.classList.contains("again")], [null, true, false], "his initials again");
  } finally {
    page.restore();
  }
});

test("the offer goes when the reader follows anyone, or when the reader it names leaves; leaving ends following with no offer", (t) => {
  const page = fakePage(t);
  try {
    const { people, here } = reader();
    people.start();
    here(["a1", "Ada"], ["b1", "Bob"]);
    people.follow("n:Bob");
    page.press();
    assert.equal(page.strip.classList.contains("again"), true);
    people.follow("n:Ada");
    assert.equal(people.followedKey, "n:Ada");
    assert.equal(page.strip.classList.contains("again"), false, "following Ada replaces it");
    assert.match(page.text(), /Following <b>Ada<\/b>/);
    page.press();
    assert.match(page.text(), /Stopped following <b>Ada<\/b>/);
    here(["b1", "Bob"]);
    assert.deepEqual([page.strip.hidden, page.strip.classList.contains("again")], [true, false], "Ada left: nobody to follow again");
    // Bob, followed, leaves: "Bob left", then the strip goes, with no offer
    people.follow("n:Bob");
    here();
    assert.equal(people.followedKey, null);
    assert.equal(page.said(), "Bob left");
    assert.equal(page.strip.classList.contains("again"), false);
    t.mock.timers.tick(2500);
    assert.equal(page.strip.hidden, true);
  } finally {
    page.restore();
  }
});
