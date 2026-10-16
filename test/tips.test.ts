// The tips (GuideSpec decisions 5–11): the catalogue held to its budgets and to the page — every
// control a tip is about is on the page and declared a surface (web/src/surfaces.ts), every key it
// names is bound, every Show me is done somewhere, every rule is one of the eight, every More is a
// heading of the manual — and what decides who sees which tip, and when a release is newer.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { GROUPS, TIPS } from "../src/web/src/tips.ts";
import { RULES } from "../src/web/src/intip.ts";
import { matches, plain, tipsFor } from "../src/web/src/tipcards.ts";
import { newer, TipState } from "../src/web/src/tipstate.ts";
import { FOLLOWED, FRAMES, YOURS } from "../src/web/src/surfaces.ts";
import { GUIDE_SHOWS } from "../src/web/src/guide.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

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
  for (const t of TIPS) if (t.showMe) assert.ok(done.has(t.showMe), `${t.id}: Show me ${t.showMe} is done by the guide or the page`);
  const rules = TIPS.flatMap((t) => (t.when ? [t.when] : []));
  assert.ok(Object.keys(RULES).length <= 8, "eight rules at most (GuideSpec decision 9)");
  assert.deepEqual([...rules].sort(), Object.keys(RULES).sort(), "each rule shows one tip, and each tip's rule is a rule");
  for (const r of Object.keys(RULES)) assert.ok(main.includes(`offerTip("${r}")`), `the page offers ${r}`);
  // GitHub's anchor of a heading: lower case, its punctuation dropped, its spaces dashes
  const anchors = new Set(
    read("docs/MANUAL.md")
      .split("\n")
      .filter((l) => /^#{2,3} /.test(l))
      .map((l) => l.replace(/^#+ /, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")),
  );
  for (const t of TIPS) if (t.manual) assert.ok(anchors.has(t.manual), `${t.id}: More links to a heading of the manual (#${t.manual})`);
  // the clips: one per tip that has one, within what the recorder makes
  const clips = TIPS.flatMap((t) => (t.clip ? [t.clip] : []));
  assert.equal(new Set(clips).size, clips.length, "a clip is one tip's");
  for (const c of clips) assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c), `clip ${c}`);
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
  const tcb = TIPS.find((t) => t.id === "what-a-tcb-is")!;
  assert.ok(matches(tcb, "TCB statement") && matches(tcb, "  tcb ") && !matches(tcb, "pinch"));
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
