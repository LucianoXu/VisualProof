// The tips (GuideSpec decisions 5–11): the tour film's eleven chapters and the reference tips, held
// to their budgets and to the page — every control they are about is on the page and declared a
// surface (web/src/surfaces.ts), every key they name is bound, every Show me is done somewhere, every
// rule is one of the eight and shows one tip or chapter, every More is a heading of the manual, no
// clip but the phone's — and what decides who sees which tip, the film's times as the recording
// gives them, and when a release is newer.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { GROUPS, TIPS, TOUR } from "../src/web/src/tips.ts";
import { chapterAt, cueAt, cuesOf, FILM_KEYS, FilmWaiter, tourData } from "../src/web/src/tourfilm.ts";
import type { FilmAnswer, WaitClock } from "../src/web/src/tourfilm.ts";
import { RULES } from "../src/web/src/intip.ts";
import { matches, plain, tipsFor } from "../src/web/src/tipcards.ts";
import { newer, TipState } from "../src/web/src/tipstate.ts";
import { FOLLOWED, FRAMES, keyActs, YOURS } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";
import { filmChapterOf, GUIDE_SHOWS, welcomeOf } from "../src/web/src/guide.ts";
import { decodeState, tipsIn, tipsPart } from "../src/web/src/state.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("the film is thirteen chapters, in the review's order, each a few words and a few sentences", () => {
  assert.deepEqual(TOUR.map((c) => c.id), ["target", "view", "arrange", "source", "keys", "checks", "review", "project", "share", "agent", "library", "export", "artwork"]);
  for (const c of TOUR) {
    assert.ok(c.title.length <= 32, `${c.id}: title of ${c.title.length} characters`);
    const words = plain(c.text);
    assert.ok(words.length <= 220, `${c.id}: ${words.length} characters`);
    assert.ok((words.match(/[.!?](\s|$)/g) ?? []).length <= 4, `${c.id}: four sentences at most`);
    assert.ok(!/<(?!\/?(b|kbd|i)>)/.test(c.text), `${c.id}: <b>, <kbd>, <i> alone`);
    assert.ok(!/\b(simple|advanced|expert|beginner)\b/i.test(c.title + words), `${c.id}: no level`);
    assert.ok(!("clip" in c), `${c.id}: a chapter is in the film, with no clip of its own`);
  }
  // no tip shows a clip but the phone's gestures (the owner's decision of 2026-10-16, night)
  assert.deepEqual(TIPS.filter((t) => t.clip).map((t) => [t.id, t.clip]), [["phone-fingers", "phone-fingers"]]);
  // a tip and a chapter are never the same
  for (const c of TOUR) assert.ok(!TIPS.some((t) => t.id === c.id), `${c.id}: a chapter, and no tip`);
});

test("the film as the recording says it: every chapter, in order, within the film, else none; its captions", () => {
  const chapters = TOUR.map((c, k) => ({ id: c.id, start: 10 * k, end: 10 * k + 10 }));
  const film = { file: "tour.mp4", sha256: "0".repeat(64), size: 1, width: 2560, height: 1600, duration: 130 };
  const captions = [
    { start: 1, end: 4, text: "Search for the theorem." },
    { start: 12, end: 15, text: " Uses lights what it uses. " },
    { start: 5, end: 3, text: "backwards: dropped" },
    { start: 6, end: 8, text: "" },
    { start: 7, end: 9, text: "x".repeat(201) },
    { start: 125, end: 140, text: "beyond the film: dropped" },
  ];
  const d = tourData({ film, chapters, captions }, TOUR)!;
  assert.deepEqual(d.chapters, chapters);
  assert.deepEqual([d.width, d.height, d.duration], [2560, 1600, 130]);
  assert.deepEqual(d.captions.map((c) => c.text), ["Search for the theorem.", "Uses lights what it uses."]);
  // the caption drawn at a time, and a chapter's captions where the film does not play them
  assert.equal(cueAt(d.captions, 0.5), null);
  assert.equal(cueAt(d.captions, 2)?.text, "Search for the theorem.");
  assert.equal(cueAt(d.captions, 4), null);
  assert.equal(cueAt(d.captions, 13)?.text, "Uses lights what it uses.");
  assert.deepEqual(cuesOf(d.captions, d.chapters[0]).map((c) => c.start), [1]);
  assert.deepEqual(cuesOf(d.captions, d.chapters[1]).map((c) => c.start), [12]);
  assert.deepEqual(cuesOf(d.captions, d.chapters[2]), []);
  // anything else: the cards are their words
  assert.equal(tourData({ film, chapters: chapters.slice(1), captions }, TOUR), null, "a chapter missing");
  assert.equal(tourData({ film: { ...film, duration: 50 }, chapters, captions }, TOUR), null, "beyond the film");
  for (const bad of [null, "x", { film: { duration: "1" } }, { chapters }]) assert.equal(tourData(bad, TOUR), null);
  // captions are optional
  assert.deepEqual(tourData({ film, chapters }, TOUR)!.captions, []);
});

test("the film sent to a chapter's start is in that chapter, the browser's time a hair short of it", () => {
  // the recording's chapters start at frames (30 a second): 19.4666…; Chrome reads the time it was
  // sent to back to the microsecond, 19.466666, short of the start
  const chapters = [
    { start: 0, end: 19.466666666666665 },
    { start: 19.466666666666665, end: 31.833333333333332 },
    { start: 31.833333333333332, end: 53.666666666666664 },
  ];
  const read = (t: number) => Math.floor(t * 1e6) / 1e6;
  for (let k = 0; k < chapters.length; k++) assert.equal(chapterAt(chapters, read(chapters[k].start)), k, `chapter ${k + 1} from its start`);
  // so → goes on from chapter to chapter while the film is paused, ← back one
  let at = 0;
  for (const want of [1, 2, 2]) {
    at = chapterAt(chapters, read(chapters[Math.min(chapters.length - 1, at + 1)].start));
    assert.equal(at, want);
  }
  assert.equal(chapterAt(chapters, read(chapters[at - 1].start)), 1);
  // inside a chapter, its end, and past the film's end
  assert.equal(chapterAt(chapters, 25), 1);
  assert.equal(chapterAt(chapters, 31.5), 1);
  assert.equal(chapterAt(chapters, 60), 2);
});

test("the film's keys are its own: declared, and kept from following there", () => {
  const film = YOURS.find((y) => y.id === "film")!;
  assert.ok("ownKeys" in film);
  assert.deepEqual([...film.ownKeys].sort(), [...FILM_KEYS].sort());
  // the film's handler binds these keys and no other
  const src = read("src/web/src/tourfilm.ts");
  assert.match(src, /FILM_KEYS = \[" ", "ArrowLeft", "ArrowRight", "c"\]/);
  const el = (sel: string, parent: PageEl | null = null): PageEl => ({ matches: (s: string) => s.split(",").some((x) => x.trim() === sel), parentElement: parent });
  const inFilm = el("div", el("[data-film]", el("#help")));
  for (const k of FILM_KEYS) assert.equal(keyActs({ key: k }, inFilm, false), false, `${JSON.stringify(k)} in the film`);
  // the same keys elsewhere change what is followed
  assert.equal(keyActs({ key: "c" }, el("#canvas"), false), true);
});

test("each tip is a few words and one or two sentences, in a group, never of a level", () => {
  const ids = new Set<string>();
  for (const t of TIPS) {
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id), `${t.id}: kebab-case`);
    assert.ok(!ids.has(t.id), `${t.id}: once`);
    ids.add(t.id);
    assert.ok(GROUPS.some((g) => g.id === t.group), `${t.id}: its group`);
    assert.ok(t.title.length <= 32, `${t.id}: title of ${t.title.length} characters`);
    const words = plain(t.text);
    assert.ok(words.length <= 220, `${t.id}: ${words.length} characters`);
    assert.ok((words.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${t.id}: two sentences at most`);
    assert.ok(!/<(?!\/?(b|kbd|i)>)/.test(t.text), `${t.id}: <b>, <kbd>, <i> alone`);
    // ViewSpec decision 18: one page for everyone
    assert.ok(!/\b(simple|advanced|expert|beginner)\b/i.test(t.title + words), `${t.id}: no level`);
  }
  for (const g of GROUPS) assert.ok(TIPS.some((t) => t.group === g.id), `group ${g.id} holds a tip`);
});

test("each tip names a release its feature came in, none after the one in making", () => {
  const [major, minor] = JSON.parse(read("package.json")).version.split(".").map(Number);
  // the next minor release is the one being made: its tips are written before it is tagged
  const making = `${major}.${minor + 1}.0`;
  for (const t of TIPS) {
    assert.ok(/^\d+\.\d+\.\d+$/.test(t.since), `${t.id}: since ${t.since}`);
    assert.ok(!newer(t.since, making), `${t.id}: since ${t.since}, after ${making}`);
  }
});

/** Every element with an id in the page's skeleton, with the ids of the elements it is inside (as
 *  test/surfaces.test.ts reads it). */
function skeleton(): Map<string, string[]> {
  const html = read("src/web/index.html").replace(/<script[^]*?<\/script>/g, "").replace(/<!--[^]*?-->/g, "");
  const VOID = new Set(["meta", "link", "input", "br", "img", "hr", "source", "path", "circle", "rect"]);
  const stack: (string | null)[] = [];
  const out = new Map<string, string[]>();
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1] ?? null;
    if (id) out.set(id, stack.filter((x): x is string => x !== null));
    if (!self && !VOID.has(tag.toLowerCase())) stack.push(id);
  }
  return out;
}

const declared = [...FOLLOWED.flatMap((p) => ["changes" in p ? p.changes : "", "reads" in p ? p.reads : ""]), ...YOURS.map((y) => ("where" in y ? y.where : ""))].join(", ");
const named = (id: string) => new RegExp(`#${id}(?![\\w-])`).test(declared) || (FRAMES as readonly string[]).includes(`#${id}`);
/** what the page's code and markup say: where an attribute, a class or an id a selector names is made */
const page = [read("src/web/index.html"), read("src/web/style.css"), ...readdirSync(new URL("src/web/src/", root)).filter((f) => f.endsWith(".ts")).map((f) => read(`src/web/src/${f}`))].join("\n");

/** Whether a selector names something of the page: its first part an element of the skeleton that
 *  is a declared surface or inside one (web/src/surfaces.ts), or a window the page adds, declared by
 *  its class; each attribute, value, class and id after it made by the page's code or markup. */
function onPage(sel: string, ids: Map<string, string[]>): string | null {
  for (const one of sel.split(",").map((x) => x.trim())) {
    const head = /^([#.][\w-]+)/.exec(one)?.[1];
    if (!head) return `${one}: no element first`;
    if (head.startsWith("#")) {
      const id = head.slice(1);
      if (!ids.has(id)) return `${head} is not in index.html`;
      if (!named(id) && !ids.get(id)!.some(named)) return `${head} is in no surface surfaces.ts declares`;
    } else if (!new RegExp(`\\${head}(?![\\w-])`).test(declared)) return `${head} is declared in surfaces.ts by no window`;
    const rest = one.slice(head.length);
    for (const [, name, value] of rest.matchAll(/\[([\w-]+)(?:=["']?([\w-]+)["']?)?\]/g)) {
      if (!page.includes(name)) return `${one}: [${name}] is made nowhere`;
      if (value && !page.includes(`"${value}"`) && !page.includes(`${name}="${value}`)) return `${one}: ${name}=${value} is made nowhere`;
    }
    for (const [, cls] of rest.matchAll(/\.([\w-]+)/g)) if (!new RegExp(`[\\s"'\`]${cls}[\\s"'\`]|\\.${cls}\\b`).test(page)) return `${one}: .${cls} is made nowhere`;
    for (const [, id] of rest.matchAll(/#([\w-]+)/g)) if (!ids.has(id) && !page.includes(`id="${id}"`)) return `${one}: #${id} is made nowhere`;
  }
  return null;
}

test("each control a tip is about, and each place a rule shows its tip at, is on the page in a declared surface; each key, bound", () => {
  const ids = skeleton();
  const keys = new Set<string>([...FOLLOWED.flatMap((p) => ("keys" in p ? [...p.keys] : [])), ...YOURS.flatMap((y) => ("keys" in y ? [...y.keys] : []))]);
  for (const t of TIPS) {
    assert.ok(t.about.length, `${t.id}: about something`);
    for (const a of t.about) {
      if (a.startsWith("key:")) {
        const k = a.slice(4) === "Space" ? " " : a.slice(4);
        assert.ok(keys.has(k), `${t.id}: the key ${a} is declared`);
        continue;
      }
      const why = onPage(a, ids);
      assert.equal(why, null, `${t.id}: ${why}`);
    }
  }
  for (const c of TOUR)
    for (const a of c.about) {
      if (a.startsWith("key:")) {
        const k = a.slice(4) === "Space" ? " " : a.slice(4);
        assert.ok(keys.has(k), `chapter ${c.id}: the key ${a} is declared`);
        continue;
      }
      const why = onPage(a, ids);
      assert.equal(why, null, `chapter ${c.id}: ${why}`);
    }
  for (const [rule, r] of Object.entries(RULES))
    for (const sel of [r.at, ...(r.phone ? [r.phone] : [])]) {
      const why = onPage(sel, ids);
      assert.equal(why, null, `rule ${rule}: ${why}`);
    }
});

test("each Show me is done, each rule is one of at most eight and shows one tip, each More is a heading", () => {
  const main = read("src/web/src/main.ts");
  // the page's Show me actions: the cases of its showMe
  const body = main.slice(main.indexOf("const showMe = (action: string)"), main.indexOf("const canShowMe = (action: string)"));
  const done = new Set<string>([...GUIDE_SHOWS, ...[...body.matchAll(/case "([\w-]+)":/g)].map((m) => m[1])]);
  for (const t of [...TIPS, ...TOUR]) if (t.showMe) assert.ok(done.has(t.showMe), `${t.id}: Show me ${t.showMe} is done by the guide or the page`);
  // a rule shows a tip, or a chapter of the film (which opens the film at it)
  const rules = [...TIPS, ...TOUR].flatMap((t) => (t.when ? [t.when] : []));
  assert.ok(Object.keys(RULES).length <= 8, "eight rules at most (GuideSpec decision 9)");
  assert.deepEqual([...rules].sort(), Object.keys(RULES).sort(), "each rule shows one tip or chapter, and each one's rule is a rule");
  for (const r of Object.keys(RULES)) assert.ok(main.includes(`offerTip("${r}")`), `the page offers ${r}`);
  // GitHub's anchor of a heading: lower case, its punctuation dropped, its spaces dashes
  const anchors = new Set(
    read("docs/MANUAL.md")
      .split("\n")
      .filter((l) => /^#{2,3} /.test(l))
      .map((l) => l.replace(/^#+ /, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")),
  );
  for (const t of [...TIPS, ...TOUR]) if (t.manual) assert.ok(anchors.has(t.manual), `${t.id}: More links to a heading of the manual (#${t.manual})`);
  // the rules that teach what a chapter shows open the film at it; the panel's ⓘ at the ways to check
  assert.deepEqual(Object.fromEntries(TOUR.flatMap((c) => (c.when ? [[c.when, c.id]] : []))), { "key-in-target": "keys", "tcb-first": "checks", "first-export": "export" });
  assert.match(read("src/web/src/panel.ts"), /\{ id: "checks", title: "What a TCB is/);
});

test("a reader sees the tips for them: a read-only reader none about changing the review, a phone its own", () => {
  const all = { readOnly: false, phone: false, applies: () => true };
  const desk = tipsFor(all);
  assert.ok(desk.length && desk.every((t) => t.where !== "phone"));
  const phone = tipsFor({ ...all, phone: true });
  assert.ok(phone.some((t) => t.where === "phone") && phone.every((t) => t.where !== "desktop"));
  const ro = tipsFor({ ...all, readOnly: true });
  assert.ok(ro.length < desk.length && ro.every((t) => t.who === "all"));
  assert.ok(!tipsFor({ ...all, applies: (t) => t.id !== "read-only-link" }).some((t) => t.id === "read-only-link"));
  const steps = TIPS.find((t) => t.id === "rests-on-steps")!;
  assert.ok(matches(steps, "key declarations") && matches(steps, "  tcb ") && !matches(steps, "pinch"));
});

test("a release is newer by its numbers, a pre-release before its release", () => {
  assert.ok(newer("0.4.1", "0.4.0") && newer("0.10.0", "0.9.9") && newer("1.0.0", "0.99.0"));
  assert.ok(!newer("0.4.0", "0.4.0") && !newer("0.3.9", "0.4.0"));
  assert.ok(newer("0.4.0", "0.4.0-rc.1") && !newer("0.4.0-rc.1", "0.4.0") && newer("0.4.0-rc.2", "0.4.0-rc.1"));
  assert.ok(!newer("junk", "0.1.0") && !newer("0.1.0", "junk"));
});

test("What's new is told once, for a newer release; a tip shown twice in place is done; all of it kept", () => {
  // the browser's storage, as a page has it
  const kept = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  try {
    const a = new TipState();
    assert.equal(a.meet("0.4.0"), null, "a first visit records the release, and tells nothing");
    assert.equal(a.meet("0.4.0"), null);
    assert.equal(a.meet("0.4.2"), "0.4.0", "a newer release: told, against the one seen before");
    assert.equal(a.newSince, "0.4.0");
    assert.equal(a.meet("0.4.3"), "0.4.2");
    assert.equal(a.newSince, "0.4.0", "what is New reaches back to the release seen before Tips was looked at");
    a.newLooked();
    assert.equal(a.newSince, null);
    assert.equal(a.meet("0.4.1"), null, "an older server tells nothing");
    a.shown("follow");
    assert.ok(!a.isDone("follow"));
    a.shown("follow");
    assert.ok(a.isDone("follow"), "shown twice: done");
    assert.equal(a.bump("tcb-picks"), 1);
    a.off = true;
    // another page of the browser reads the same
    const b = new TipState();
    assert.ok(b.isDone("follow") && b.off && b.bump("tcb-picks") === 2);
    assert.equal(b.meet("0.4.3"), null, "the newest seen is kept: back from an older server, nothing told");
    // two pages open at once (two projects, or two tabs): neither writes back the other's older state
    const one = new TipState(), two = new TipState();
    one.done("used-by");
    two.done("notes");
    two.shown("time-machine");
    one.shown("time-machine");
    const now = new TipState();
    assert.ok(now.isDone("used-by") && now.isDone("notes") && now.isDone("time-machine"), "both pages' changes kept, and both showings counted");
    assert.ok(now.isDone("follow") && now.off, "and what was kept before");
    // What's new is told once in the browser, not once per page open
    const p1 = new TipState(), p2 = new TipState();
    assert.equal(p1.meet("0.5.0"), "0.4.3");
    assert.equal(p2.meet("0.5.0"), null);
    // what cannot be read is nothing kept
    kept.set("visualproof:tips", "{not json");
    assert.ok(!new TipState().isDone("follow"));
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a first visit is offered the tour, never given it: the welcome card once, the dot where the reader is busy", () => {
  const first = { guided: false, welcomed: false, deepLink: false, following: false, snapshot: false };
  assert.equal(welcomeOf(first), "card");
  // came to a place, following someone, a snapshot: the dot alone
  for (const busy of ["deepLink", "following", "snapshot"] as const) assert.equal(welcomeOf({ ...first, [busy]: true }), "dot", busy);
  // the card shows once per browser and project; the tour taken, nothing more
  assert.equal(welcomeOf({ ...first, welcomed: true }), "none");
  assert.equal(welcomeOf({ ...first, guided: true }), "none");
  assert.equal(welcomeOf({ ...first, welcomed: true, deepLink: true }), "none");
  // nothing starts the tour by itself: the page offers it, a press starts it
  const main = read("src/web/src/main.ts");
  assert.ok(!main.includes("firstVisit") && !/guide\.start\(/.test(main), "the page never starts the tour");
  assert.match(main, /guide\.welcome\(deepLink\)/);
  const guide = read("src/web/src/guide.ts");
  const welcome = guide.slice(guide.indexOf("  welcome(deepLink: boolean): void {"), guide.indexOf("  private hideWelcome(): void {"));
  assert.ok(welcome.length > 200 && !welcome.includes("this.start("), "the welcome starts no tour");
  assert.match(welcome, /this\.store\.data\.welcomed = true;/, "the card, once shown, is not shown again");
  // its Take the tour and Watch a review are presses on it
  assert.match(guide, /if \(what === "tour"\) this\.start\(\);\s*else this\.openHelp\("tips"\);/);
});

test("the dot on the help is kept in the browser until the help is opened", () => {
  const kept = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  try {
    const a = new TipState();
    assert.equal(a.dot, false);
    a.dot = true;
    assert.equal(new TipState().dot, true, "another page, a later visit");
    new TipState().dot = false;
    assert.equal(new TipState().dot, false);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
  // the help is a menu: Tips, Keys, the tour, then the two Abouts; ? opens it
  const guide = read("src/web/src/guide.ts");
  for (const hm of ["tips", "keys", "tour", "repo"]) assert.ok(guide.includes(`data-hm="${hm}"`), hm);
  assert.match(read("src/web/src/main.ts"), /e\.key === "\?"\) guide\.toggleMenu\(\)/);
  assert.match(guide, /rel="noopener noreferrer"><span class="hm-h">About VisualProof/);
});

/** A waiter for the film on a clock of the test's, its asks answered in turn. */
function waiting(answers: (FilmAnswer | Error)[]) {
  let now = 0;
  const timers: { f: () => void; ms: number }[] = [];
  const clock: WaitClock = { now: () => now, after: (f, ms) => (timers.push({ f, ms }), timers.length), cancel: (t) => void (timers[(t as number) - 1].f = () => {}) };
  const states: string[] = [];
  let asks = 0;
  const w = new FilmWaiter(
    async () => {
      const a = answers[Math.min(asks++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
    (s) => states.push(s),
    clock,
  );
  const settle = () => new Promise((ok) => setTimeout(ok, 0));
  /** the next ask, after the delay it waits */
  const next = async () => {
    const t = timers.at(-1)!;
    now += t.ms;
    t.f();
    await settle();
    return t.ms;
  };
  return { w, states, asks: () => asks, delays: () => timers.map((t) => t.ms), next, settle, at: (ms: number) => void (now = ms) };
}

test("the film is asked for while the server fetches it: every 2 s at first, then as Retry-After says; it plays once it comes", async () => {
  const busy = { status: 503, retryAfter: 10 };
  // 503, 503, then 200: loading, loading, ready, asked three times, 2 s apart
  const a = waiting([busy, busy, { status: 206, retryAfter: null }]);
  a.w.start();
  await a.settle();
  assert.deepEqual(a.states, ["loading"]);
  assert.equal(await a.next(), 2000);
  assert.deepEqual(a.states, ["loading", "loading"]);
  assert.equal(await a.next(), 2000);
  assert.deepEqual(a.states, ["loading", "loading", "ready"]);
  assert.equal(a.asks(), 3);
  assert.deepEqual(a.delays(), [2000, 2000], "nothing asked once it is there");
  // past the first 30 s: as Retry-After says, or 10 s where it says nothing
  const b = waiting([busy, busy, { status: 503, retryAfter: null }, { status: 503, retryAfter: null }]);
  b.w.start();
  await b.settle();
  b.at(31_000);
  await b.next();
  assert.equal(b.delays().at(-1), 10_000);
  await b.next();
  assert.equal(b.delays().at(-1), 10_000, "no Retry-After: 10 s");
  // 404: the film is not to be had here; nothing asked again
  const c = waiting([{ status: 404, retryAfter: null }]);
  c.w.start();
  await c.settle();
  assert.deepEqual(c.states, ["absent"]);
  assert.deepEqual(c.delays(), []);
  // no answer: as if it were still coming
  const d = waiting([new Error("offline"), { status: 200, retryAfter: null }]);
  d.w.start();
  await d.settle();
  assert.deepEqual(d.states, ["loading"]);
  await d.next();
  assert.deepEqual(d.states, ["loading", "ready"]);
  // the sheet closed: no more asks; opened again: asking goes on
  const e = waiting([busy, busy, { status: 200, retryAfter: null }]);
  e.w.start();
  await e.settle();
  e.w.stop();
  await e.next();
  assert.equal(e.asks(), 1, "stopped: the pending ask does nothing");
  e.w.start();
  await e.settle();
  assert.equal(e.asks(), 2);
  await e.next();
  assert.deepEqual(e.states, ["loading", "loading", "ready"]);
});

test("a link opens the help's film, at its chapter: #tips, #tips=<chapter>, beside the rest of the address", () => {
  // alone
  assert.equal(tipsIn("#tips"), null, "the film's start");
  assert.equal(tipsIn("#tips="), null);
  assert.equal(tipsIn("#tips=checks"), "checks");
  assert.equal(tipsIn("tips=checks"), "checks");
  assert.equal(tipsIn("#tips=Not a chapter!"), null, "a word that is no chapter's: the start");
  for (const none of ["", "#", "#v=project&mode=tcb", "#snap=x"]) assert.equal(tipsIn(none), undefined, none);
  // beside the address the page writes: the view and the selection read as ever, tips alone no place
  const h = "#v=project&mode=keys&sel=tcb%28FltRegular.flt_regular%29&tips=checks";
  assert.equal(tipsIn(h), "checks");
  assert.deepEqual([decodeState(h)?.view, decodeState(h)?.mode], ["project", "keys"]);
  assert.equal(decodeState("#tips=checks"), null);
  // written after the rest while the film shows, gone when the sheet closes
  assert.equal(tipsPart(true, null), "&tips");
  assert.equal(tipsPart(true, "checks"), "&tips=checks");
  assert.equal(tipsPart(false, "checks"), "");
  assert.equal(tipsIn(`#v=project&mode=tcb${tipsPart(true, "export")}`), "export");
  // the chapter it opens at: one of the film's, else its start
  assert.equal(filmChapterOf("checks"), "checks");
  for (const c of TOUR) assert.equal(filmChapterOf(c.id), c.id);
  assert.equal(filmChapterOf("tcb"), null, "a chapter of the first cut: the start");
  assert.equal(filmChapterOf(null), null);
  // the page opens it, once it is there, and counts it a link to a place: no welcome card
  const main = read("src/web/src/main.ts");
  assert.match(main, /const filmLink = tipsIn\(location\.hash\);/);
  assert.match(main, /const deepLink = filmLink !== undefined \|\|/);
  assert.match(main, /if \(filmLink !== undefined\) guide\.openHelp\("tips", filmLink \? \{ chapter: filmLink \} : \{\}\);/);
  assert.match(main, /const hash = "#" \+ encodeState\(current\(\)\) \+ filmPart;/);
});
