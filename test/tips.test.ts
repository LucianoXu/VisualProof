// The tips (GuideSpec decisions 5–11): the catalogue held to its budgets and to the page — every
// control a tip is about is on the page and declared a surface (web/src/surfaces.ts), every key it
// names is bound, every Show me is done somewhere, every rule is one of the eight, every More is a
// heading of the manual — and what decides who sees which tip, and when a release is newer.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GROUPS, TIPS } from "../src/web/src/tips.ts";
import { RULES } from "../src/web/src/intip.ts";
import { matches, plain, tipsFor } from "../src/web/src/tipcards.ts";
import { newer, TipState } from "../src/web/src/tipstate.ts";
import { FOLLOWED, YOURS } from "../src/web/src/surfaces.ts";

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

test("each control a tip is about is on the page and declared a surface; each key, bound", () => {
  const html = read("src/web/index.html");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const declared = [...FOLLOWED.flatMap((p) => ["changes" in p ? p.changes : "", "reads" in p ? p.reads : ""]), ...YOURS.map((y) => ("where" in y ? y.where : ""))].join(", ");
  const keys = new Set<string>([...FOLLOWED.flatMap((p) => ("keys" in p ? [...p.keys] : [])), ...YOURS.flatMap((y) => ("keys" in y ? [...y.keys] : []))]);
  for (const t of TIPS) {
    assert.ok(t.about.length, `${t.id}: about something`);
    for (const a of t.about) {
      if (a.startsWith("key:")) {
        const k = a.slice(4) === "Space" ? " " : a.slice(4);
        assert.ok(keys.has(k), `${t.id}: the key ${a} is declared`);
        continue;
      }
      // its first part: an element of the skeleton, or a window the page adds (declared by its class)
      const head = /^([#.][\w-]+)/.exec(a)?.[1];
      assert.ok(head, `${t.id}: ${a}`);
      if (head.startsWith("#")) assert.ok(ids.has(head.slice(1)), `${t.id}: ${head} is in index.html`);
      else assert.ok(new RegExp(`\\${head}(?![\\w-])`).test(declared), `${t.id}: ${head} is declared in surfaces.ts`);
    }
  }
});

test("each Show me is done, each rule is one of at most eight and shows one tip, each More is a heading", () => {
  const guide = read("src/web/src/guide.ts");
  const main = read("src/web/src/main.ts");
  for (const t of TIPS) {
    if (!t.showMe) continue;
    const done = guide.includes(`"${t.showMe}"`) || main.includes(`case "${t.showMe}":`);
    assert.ok(done, `${t.id}: Show me ${t.showMe} is done in guide.ts or main.ts`);
  }
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
    // what cannot be read is nothing kept
    kept.set("visualproof:tips", "{not json");
    assert.ok(!new TipState().isDone("follow"));
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
