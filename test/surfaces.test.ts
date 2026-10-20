// What following carries (CollabSpec decision 4, the owner's decision of 2026-10-11): what you see is
// followed, how you look at it is yours. One registry (web/src/surfaces.ts) declares every surface:
// every element of the page's skeleton and every key of the page is in it; presence carries exactly
// its followed parts; what ends following is a change to one of them, never anything of the
// reader's own. A follower's page takes Activity (open or closed, its filters), the lost-and-found,
// the colouring and the edges at once and live, keeps them once following ends, and keeps
// its own where an older page says nothing of them.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { ART_NAMES_BYTES, ART_RULED_BYTES, ART_TARGETS_BYTES, cleanView, withoutArtwork } from "../src/shared/collab.ts";
import type { ActivityView, ArtworkView, PresenceView } from "../src/shared/collab.ts";
import { Activity } from "../src/web/src/activity.ts";
import type { ActivityHooks } from "../src/web/src/activity.ts";
import { LostAndFound } from "../src/web/src/lostfound.ts";
import type { LostHooks } from "../src/web/src/lostfound.ts";
import type { Store } from "../src/web/src/store.ts";
import {
  applyOwn,
  BOOKKEEPING,
  doubleClickActs,
  FOLLOWED,
  FRAMES,
  keyActs,
  NOT_SURFACES,
  PRESENCE_FIELDS,
  presenceOf,
  pressActs,
  WHEEL,
  YOURS,
} from "../src/web/src/surfaces.ts";
import type { PageEl, PageParts } from "../src/web/src/surfaces.ts";

const root = new URL("../src/", import.meta.url);

/** An element of the page as the rule reads it: inside the ones before it, each matching the
 *  selectors it is given ("a|b": one element that is both). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);
const parts = (sel: string) => sel.split(",").map((s) => s.trim());
const key = (k: string, more: { ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean } = {}) => ({ key: k, ...more });

/** Every element with an id in the page's skeleton, with the ids of the elements it is inside. */
function skeleton(): { id: string; inside: string[] }[] {
  const html = readFileSync(new URL("web/index.html", root), "utf8").replace(/<script[^]*?<\/script>/g, "").replace(/<!--[^]*?-->/g, "");
  const VOID = new Set(["meta", "link", "input", "br", "img", "hr", "source", "path", "circle", "rect"]);
  const stack: (string | null)[] = [];
  const out: { id: string; inside: string[] }[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1] ?? null;
    if (id) out.push({ id, inside: stack.filter((x): x is string => x !== null) });
    if (!self && !VOID.has(tag.toLowerCase())) stack.push(id);
  }
  return out;
}

/** Every selector the registry names, as text. */
const declared = [
  ...FOLLOWED.flatMap((p) => ["changes" in p ? p.changes : "", "reads" in p ? p.reads : ""]),
  ...YOURS.map((y) => ("where" in y ? y.where : "")),
].join(", ");
/** Whether element `id` is named: a surface, or no surface (what passes; a frame, whose contents
 *  are declared each) */
const names = (id: string) => new RegExp(`#${id.replace(/[-]/g, "\\$&")}(?![\\w-])`).test(declared) || (NOT_SURFACES as readonly string[]).includes(`#${id}`);
const framed = (id: string) => (FRAMES as readonly string[]).includes(`#${id}`);

test("the registry declares every surface of the page: each element of its skeleton, each window and card it adds, each key it binds", () => {
  // every element of web/index.html is a surface, inside one, or named as no surface
  const all = skeleton();
  assert.ok(all.length > 60, "the skeleton was read");
  for (const { id, inside } of all) assert.ok(names(id) || framed(id) || inside.some(names), `#${id} is declared in web/src/surfaces.ts, followed or yours, or as no surface`);
  // what the page adds outside its skeleton: the windows, the hover cards, a note's editor, the
  // canvas's submenu, the windows' edges
  for (const cls of [".sw-win", ".pw-win", ".hcard", ".sticky-editor", ".cm-sub", ".fl-rz"]) assert.ok(parts(declared).some((s) => s.split(/[\s>]+/)[0].startsWith(cls)), cls);
  // every key the page's keyboard handler binds is a followed part's or the reader's own (Esc is
  // apart: it stops following, web/src/people.ts); the handler is one of the page's parts
  // (web/src/main.ts makes them, web/src/page*.ts), and ends where its listener does
  const web = new URL("web/src/", root);
  const main = ["main.ts", ...readdirSync(web).filter((f) => /^page.*\.ts$/.test(f)).sort()].map((f) => readFileSync(new URL(f, web), "utf8")).join("\n");
  const from = main.indexOf("// ---------------------------------------------------------------- keyboard");
  const handler = main.slice(from, main.indexOf("\n  });\n", from));
  const bound = new Set([...handler.matchAll(/e\.key === "([^"]+)"/g)].map((m) => m[1]));
  assert.ok(bound.has("g") && bound.has("c") && bound.has("l"), "the handler was read");
  const keys = new Set<string>([...FOLLOWED.flatMap((p) => ("keys" in p ? [...p.keys] : [])), ...YOURS.flatMap((y) => ("keys" in y ? [...y.keys] : [])), "Escape"]);
  for (const k of bound) assert.ok(keys.has(k), `the key ${JSON.stringify(k)} is declared`);
  // a key is one surface's, a name one surface's
  const once = [...FOLLOWED.flatMap((p) => ("keys" in p ? [...p.keys] : [])), ...YOURS.flatMap((y) => ("keys" in y ? [...y.keys] : []))];
  assert.equal(new Set(once).size, once.length);
  const ids: string[] = [...FOLLOWED.map((p) => p.part), ...YOURS.map((y) => y.id)];
  assert.equal(new Set(ids).size, ids.length);
  // the parts the owner named followed, and the surfaces named the reader's own
  assert.deepEqual(FOLLOWED.map((p) => p.part), ["view", "history", "camera", "tool", "selection", "focus", "visitors", "panel", "sources", "paper", "activity", "lostFound", "colouring", "edges", "linear", "artwork"]);
  for (const y of ["windowPlaces", "scroll", "sections", "tcbOrder", "outline", "whatChanged", "theme", "lock", "share", "export", "help", "library", "board", "trusted", "viewsMenu", "search", "name", "conversation", "followingStrip", "hoverCards", "pointer"]) assert.ok(ids.includes(y), y);
});

/** A page whose every part reads as given: the place's parts with what a page says of them. */
function reading(): PageParts["read"] {
  return {
    view: () => ({ view: "v1", scope: null, clusterMode: "namespace" }),
    history: () => ({ history: { snapshot: 4 } }),
    camera: () => ({ cam: { x: 1, y: 2, k: 3 } }),
    tool: () => ({ mode: "tcb" }),
    selection: () => ({ selection: "tcb(A.b)" }),
    focus: () => ({ focus: "A.t" }),
    visitors: () => ({ visitors: [{ decl: "A.v", from: "A.b" }] }),
    panel: () => ({ sel: "A.b" }),
    sources: () => ({ source: true, sourceCollapsed: true, pinned: [{ decl: "A.c", collapsed: false }] }),
    paper: () => ({ paper: { file: "a".repeat(64), page: 3 } }),
    activity: () => ({ activity: { open: true, kind: "review", who: "people", mine: "Alice" } }),
    lostFound: () => ({ lostFound: { open: false } }),
    colouring: () => ({ scheme: "status" }),
    edges: () => ({ edges: false }),
    linear: () => ({ linear: true }),
    artwork: () => ({ artwork: ART }),
  };
}

/** an artwork's settings and the rectangle of the board its frame holds (ExportSpec decision 19) */
const ART: ArtworkView = {
  w: 1920,
  h: 1080,
  scheme: "status",
  theme: "dark",
  background: "transparent",
  labels: "chosen",
  namesFrom: "board",
  hiddenNames: ["c:FltRegular.CaseI"],
  shownNames: ["d:FltRegular.CaseI.Statement.caseI", "d:FltRegular.«term_∣_»"],
  ruledNames: ["c:FltRegular.CaseII"],
  edges: "selection",
  notes: false,
  targets: "chosen",
  shownTargets: ["FltRegular.flt_regular"],
  keys: false,
  selection: false,
  source: true,
  style: "cells",
  title: "",
  subtitle: "Fermat's Last Theorem for regular primes",
  titleSize: 7,
  footSize: 2.2,
  border: true,
  region: [10, -20, 640, 360],
};

test("presence carries exactly the followed parts, and the views a page holds open; the server keeps every one of them", () => {
  const v = presenceOf(reading(), ["v1", "v2"]);
  assert.deepEqual(Object.keys(v).sort(), [...PRESENCE_FIELDS].sort());
  assert.deepEqual([...BOOKKEEPING], ["tabs"]);
  assert.equal(new Set(PRESENCE_FIELDS).size, PRESENCE_FIELDS.length, "a field is one part's");
  // as the server takes it: nothing dropped, nothing added
  assert.deepEqual(cleanView(JSON.parse(JSON.stringify(v))), v);
  // read with care: what is not one of them is not carried
  const odd = cleanView({ ...v, activity: { open: "yes", kind: "review", who: "people" }, lostFound: { open: 1 }, scheme: "rainbow", edges: "no", linear: "on" })!;
  for (const f of ["activity", "lostFound", "scheme", "edges", "linear"] as const) assert.equal(odd[f], undefined, f);
  // proof edges, said until 2026-10-15, are no more: carried by none
  assert.ok(!("proofEdges" in cleanView({ ...v, proofEdges: true } as never)!), "no proof edges");
  assert.equal(cleanView({ ...v, activity: { open: true, kind: "everything", who: "all" } })!.activity, undefined);
  assert.deepEqual(cleanView({ ...v, activity: { open: false, kind: "all", who: "agents", mine: "\n" } })!.activity, { open: false, kind: "all", who: "agents" }, "a name that is no name is no one's targets");
  // the artwork (ExportSpec decision 19): off is said as such; settings out of their range, or a
  // frame that holds nothing, are not carried
  assert.equal(cleanView({ ...v, artwork: null })!.artwork, null);
  for (const bad of [{ ...ART, w: 99999 }, { ...ART, w: 15 }, { ...ART, scheme: "rainbow" }, { ...ART, notes: "yes" }, { ...ART, background: "white" }, { ...ART, labels: "all" }, { ...ART, region: [0, 0, 0, 10] }, { ...ART, region: [0, 0, 1] }, { ...ART, region: [0, 0, 1, Infinity] }, "on"])
    assert.equal(cleanView({ ...v, artwork: bad })!.artwork, undefined, JSON.stringify(bad));
  assert.deepEqual(cleanView({ ...v, artwork: { ...ART, extra: 1 } })!.artwork, ART, "nothing else is carried");
  // the style and the title (said since that night): read with care, the project's own where none
  const styled = cleanView({ ...v, artwork: { ...ART, style: "neon", title: 5, subtitle: "x".repeat(300), titleSize: 0 } })!.artwork!;
  assert.deepEqual([styled.style, styled.title, styled.subtitle!.length, styled.titleSize], ["board", null, 120, 3]);
  assert.equal(cleanView({ ...v, artwork: { ...ART, border: "thin" } })!.artwork!.border, false, "a border said otherwise is none");
  // the foot's size (said since later that night): within its bounds, to a tenth; the first where none
  assert.deepEqual([99, 0.123, 2.26, "big"].map((footSize) => cleanView({ ...v, artwork: { ...ART, footSize } })!.artwork!.footSize), [4, 0.8, 2.3, 1.6]);
  const { footSize: _foot, ...unsized } = ART;
  assert.equal(cleanView({ ...v, artwork: unsized })!.artwork!.footSize, 1.6, "a page from before it: the first");
  // a page from before the source was said: none
  const { source: _source, ...older } = ART;
  assert.equal(cleanView({ ...v, artwork: older })!.artwork!.source, false);
  // the names and targets chosen (the owner's decision of 2026-10-15): names each once, a cluster's or
  // a declaration's, and targets' names; a page from before them chose none, its key marks as its
  // targets drew them
  for (const bad of [{ ...ART, labels: "picked" }, { ...ART, targets: "some" }]) assert.equal(cleanView({ ...v, artwork: bad })!.artwork, undefined, JSON.stringify(bad));
  const odd2 = cleanView({ ...v, artwork: { ...ART, namesFrom: "all", hiddenNames: ["x:A", 5, "", "d:A.b", "d:A.b", "c:", "c:A", "d:" + "x".repeat(1001)], shownNames: "c:B", shownTargets: "A.t", keys: "no" } })!.artwork!;
  assert.deepEqual([odd2.namesFrom, odd2.hiddenNames, odd2.shownNames, odd2.shownTargets, odd2.keys], ["board", ["d:A.b", "c:A"], [], [], true], "a switch that is none: as the targets drew them");
  const { namesFrom: _from, hiddenNames: _hidden, shownNames: _shownNames, shownTargets: _shown, keys: _keys, ...before } = ART;
  for (const [targets, keys] of [["plain", false], ["marked", true], ["highlight", true]] as const)
    assert.deepEqual(
      (({ namesFrom, hiddenNames, shownNames, shownTargets, keys }) => ({ namesFrom, hiddenNames, shownNames, shownTargets, keys }))(cleanView({ ...v, artwork: { ...before, labels: "board", targets } })!.artwork!),
      { namesFrom: "board", hiddenNames: [], shownNames: [], shownTargets: [], keys },
      targets,
    );
  // a long list is cut, in its order, within what a heartbeat has room for
  const many = Array.from({ length: 1000 }, (_, i) => `FltRegular.CaseII.InductionStep.Proof.lemma_${i}`);
  const cut = cleanView({ ...v, artwork: { ...ART, hiddenNames: many.map((n) => `d:${n}`), shownNames: many.map((n) => `c:${n}`), shownTargets: many } })!.artwork!;
  assert.ok(cut.hiddenNames.length > 60 && cut.hiddenNames.length < 120, `${cut.hiddenNames.length} names`);
  assert.deepEqual(cut.hiddenNames, many.slice(0, cut.hiddenNames.length).map((n) => `d:${n}`));
  for (const list of [cut.hiddenNames, cut.shownNames]) assert.ok(Buffer.byteLength(JSON.stringify(list)) <= ART_NAMES_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(cut.shownTargets)) <= ART_TARGETS_BYTES);
  // the names a recipe's rule chose (ExportSpec decision 20): carried as named, cut within their own
  // room; a page from before them chose none
  const ruled = cleanView({ ...v, artwork: { ...ART, ruledNames: ["c:A", "x:B", "c:A", ...many.map((n) => `c:${n}`)] } })!.artwork!.ruledNames;
  assert.deepEqual(ruled.slice(0, 2), ["c:A", `c:${many[0]}`]);
  assert.ok(Buffer.byteLength(JSON.stringify(ruled)) <= ART_RULED_BYTES && ruled.length > 10, `${ruled.length} names`);
  const { ruledNames: _ruled, ...unruled } = ART;
  assert.deepEqual(cleanView({ ...v, artwork: unruled })!.artwork!.ruledNames, []);
  // an agent's presence carries none: agents have no artwork
  const { artwork: _artwork, ...rest } = cleanView(v)!;
  assert.deepEqual(withoutArtwork(cleanView(v)), rest);
  assert.ok(!("artwork" in withoutArtwork(cleanView(v))!));
});

test("the artwork is followed (ExportSpec decision 19): on with the other's settings and frame, changed with them, off with theirs", () => {
  const f = follower();
  applyOwn(leader({ artwork: ART }), f.apply);
  assert.deepEqual(f.page.artwork, ART);
  const wider: ArtworkView = { ...ART, w: 3840, h: 2160, theme: "light", region: [0, 0, 1280, 720] };
  applyOwn(leader({ artwork: wider }), f.apply);
  assert.deepEqual(f.page.artwork, wider);
  applyOwn(leader({ artwork: null }), f.apply);
  assert.equal(f.page.artwork, null);
});

test("following ends on every change to a followed part, wherever its control is, and on acting on what a followed surface shows", () => {
  // each followed part's controls: pressed alone, and inside a surface of the reader's own
  for (const p of FOLLOWED) {
    for (const sel of "changes" in p ? parts(p.changes) : []) {
      assert.equal(pressActs(at(sel)), true, `${p.part}: ${sel}`);
      assert.equal(pressActs(at("#eyes-pop", sel)), true, `${p.part}: ${sel}, inside a popover of the reader's own`);
    }
    for (const k of "keys" in p ? (p.keys as readonly string[]) : []) {
      assert.equal(keyActs(key(k), at(), false), true, `${p.part}: the key ${JSON.stringify(k)}`);
      // the page takes its keys wherever the focus is, in Share too (where Space presses the button
      // it is on)
      assert.equal(keyActs(key(k), at("#share-pop", k === " " ? "div" : "button"), false), true, `${p.part}: ${JSON.stringify(k)} with the focus in Share`);
    }
  }
  // what the owner named: opening or closing Activity, a filter of it, closing the lost-and-found or
  // opening it from the build status, the colouring, edges
  assert.equal(pressActs(at("#activity-btn")), true, "Activity opened or closed from the bar");
  assert.equal(pressActs(at("#activity", "button")), true, "closed from its ✕, or a row that leads somewhere");
  assert.equal(pressActs(at("#activity", "#activity .act-filters", "button")), true, "a filter");
  assert.equal(pressActs(at("#lostfound", "button")), true, "the lost-and-found closed, or acted in");
  assert.equal(pressActs(at("#build-pop", "#build-pop [data-bp=lost]")), true, "the lost-and-found opened");
  assert.equal(pressActs(at("#legend", "#legend [data-scheme]")), true, "Kind or Status");
  assert.equal(keyActs(key("c"), at(), false), true);
  assert.equal(pressActs(at("#zoom", "#eyes-pop", "#edges-btn")), true, "edges");
  assert.equal(keyActs(key("g"), at(), false), true);
  // a view opened from the Views menu, a search result chosen (by Enter too), a file opened in the
  // reference window from the Library, a build from the build status: their parts'
  assert.equal(pressActs(at("#views-menu", "#views-menu [data-open]")), true);
  assert.equal(pressActs(at("#results", "#results .hit")), true);
  assert.equal(keyActs(key("Enter"), at("#search"), true), true);
  assert.equal(pressActs(at("#library-pop", "#library-pop [data-lb-open]")), true);
  assert.equal(pressActs(at("#build-pop", "#build-pop [data-snapshot]")), true);
  // a followed content panel: a control on it acts, its text is read; typing in its fields acts, so
  // that nothing moves under a comment being written; Enter or Space on a control presses it
  for (const p of FOLLOWED) {
    if (!("reads" in p)) continue;
    assert.equal(pressActs(at(p.reads, "button")), true, `${p.part}: a control on ${p.reads}`);
    assert.equal(pressActs(at(p.reads)), false, `${p.part}: reading ${p.reads}`);
    assert.equal(keyActs(key("x"), at(p.reads, "textarea"), true), true, `${p.part}: typing on ${p.reads}`);
    assert.equal(keyActs(key("Enter"), at(p.reads, "button"), false), true, `${p.part}: Enter on a control of ${p.reads}`);
  }
  // a double-click on a window's title bar collapses it, the reference window's too
  assert.equal(doubleClickActs(at(".pw-win:not(.collapsed) .pw-head")), true);
  assert.equal(doubleClickActs(at(".pw-win:not(.collapsed) .pw-head", "button")), false);
  assert.equal(doubleClickActs(at(".pw-win")), false);
  // the wheel zooms the canvas; anywhere else it scrolls
  assert.deepEqual(parts(WHEEL), ["#canvas", "#labels", "#cards"]);
  // outside every surface — a bar's blank part — a press, and an undeclared key, act as before
  assert.equal(pressActs(at("#bar")), true);
  assert.equal(keyActs(key("Tab"), at(), false), true);
});

test("the artwork's names and targets by selection (ExportSpec decision 19): a line ticked, by its box or its words, All and None, a name shown from the board's menu end following; the filter over the names does not", () => {
  const panel = (...inner: string[]) => at("#art-panel", ...inner);
  assert.equal(pressActs(panel(".art-rows", "#art-panel input:not([data-art-filter])")), true, "a line's box");
  assert.equal(pressActs(panel(".art-rows", "#art-panel .art-row", "span")), true, "a line's words");
  assert.equal(pressActs(panel(".ex-checks", "#art-panel .ex-check")), true, "a switch's words: Key marks");
  assert.equal(pressActs(panel(".art-pick-head", "#art-panel [data-art-pick]")), true, "All, None");
  assert.equal(pressActs(at("#ctxmenu", "button")), true, "Show its name in the artwork");
  // the filter is the reader's own: pressed, typed in; the list scrolled is read
  assert.equal(pressActs(panel(".art-pick-head", "#art-panel [data-art-filter]")), false, "the filter pressed");
  assert.equal(keyActs(key("a"), panel(".art-pick-head", "#art-panel [data-art-filter]"), true), false, "typed in");
  assert.equal(pressActs(panel(".art-rows")), false, "the list scrolled");
});

test("nothing of the reader's own ends following, nor does reading", () => {
  for (const y of YOURS) {
    if ("where" in y) {
      for (const sel of parts(y.where)) {
        assert.equal(pressActs(at(sel)), false, `${y.id}: ${sel}`);
        assert.equal(pressActs(at(sel, "button")), false, `${y.id}: a button in ${sel}`);
        // inside a followed panel too: a section folded in the panel, the TCB list's order
        assert.equal(pressActs(at("#panel", sel)), false, `${y.id}: ${sel} in the panel`);
        assert.equal(keyActs(key("x"), at(sel, "input"), true), false, `${y.id}: typing in ${sel}`);
        assert.equal(keyActs(key("Enter"), at(sel, "button"), false), false, `${y.id}: Enter on a button of ${sel}`);
        assert.equal(keyActs(key("ArrowDown"), at(sel, "button"), false), false, `${y.id}: a menu's own keys in ${sel}`);
      }
    }
    for (const k of "keys" in y ? y.keys : []) assert.equal(keyActs(key(k), at(), false), false, `${y.id}: the key ${JSON.stringify(k)}`);
  }
  // what the owner named: the theme, a side-panel section folded, Share opened, Activity scrolled
  assert.equal(pressActs(at("#zoom", "#eyes-btn")), false, "the eyes' ⋯ opened");
  assert.equal(pressActs(at("#zoom", "#eyes-pop", "#theme-seg", "button")), false, "the theme");
  assert.equal(pressActs(at("#zoom", "#eyes-pop", "#lock-btn")), false, "the lock");
  assert.equal(pressActs(at("#side", "[data-sec]")), false, "a side-panel section folded");
  assert.equal(pressActs(at("#side", "#outline .tw")), false, "a level of the outline opened");
  assert.equal(pressActs(at("#side", "#board-btn")), false, "⚙ Board opened");
  assert.equal(pressActs(at("#share-btn")), false, "Share opened");
  assert.equal(pressActs(at("#share-pop", "button")), false, "a link made in Share");
  assert.equal(pressActs(at("#activity")), false, "Activity read, scrolled by its scrollbar");
  assert.equal(pressActs(at("#lostfound", "#lostfound .lf-archived > summary")), false, "the lost-and-found's Archived opened");
  assert.equal(pressActs(at("#legend", "button")), false, "the legend folded or opened");
  assert.equal(pressActs(at(".pw-win", "[data-pw-zoom]")), false, "the reference window zoomed");
  assert.equal(pressActs(at(".sw-win", ".fl-rz")), false, "a window resized");
  assert.equal(pressActs(at(".sw-win", ".sw-head")), false, "a window moved by its title bar");
  // the search box: focused, typed in, its results gone through
  assert.equal(pressActs(at("#search")), false);
  assert.equal(keyActs(key("q"), at("#search"), true), false);
  assert.equal(keyActs(key("ArrowDown"), at("#search"), true), false);
  assert.equal(keyActs(key("Enter", { isComposing: true }), at("#search"), true), false, "an input method's Enter commits, it chooses nothing");
  // in the conversation, the strip, the presence bar and the name's window nothing ends following —
  // not even a name that goes to its declaration: the reader looks aside until the other moves
  assert.equal(pressActs(at("#following", "#talk", "[data-ref]")), false);
  assert.equal(pressActs(at("#peers", "button")), false);
  assert.equal(keyActs(key("Enter"), at("#modal", "input"), true), false);
  // a hover card is read; a name in it goes there
  assert.equal(pressActs(at(".hcard")), false);
  assert.equal(pressActs(at(".hcard", "[data-ref]")), true);
  // the browser's own keys, a modifier alone
  assert.equal(keyActs(key("c", { metaKey: true }), at(), false), false, "copy");
  assert.equal(keyActs(key("Shift"), at(), false), false);
});

/** Just enough of an element for a drawer: its classes, what is drawn in it, its listeners, and a
 *  click on something inside, found by the one attribute it carries. */
function drawerEl() {
  const listeners: ((e: unknown) => void)[] = [];
  const classes = new Set<string>();
  return {
    innerHTML: "",
    hidden: false,
    textContent: "",
    classList: { toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) },
    addEventListener: (t: string, f: (e: unknown) => void) => (t === "click" ? listeners.push(f) : 0),
    querySelectorAll: () => [],
    click(attr: string, value = "") {
      const name = attr.replace(/^data-/, "").replace(/-(\w)/g, (_m, c: string) => c.toUpperCase());
      const target = { closest: (sel: string) => (sel === `[${attr}]` ? { dataset: { [name]: value }, getAttribute: () => value } : null) };
      for (const f of listeners) f({ target });
    },
  };
}

/** A follower's page: its Activity and lost-and-found as the page draws them, its colouring and
 *  edges, applied from a followed reader's presence as web/src/pagefollow.ts applies them. */
function follower(me: string | null = "Bob") {
  const actEl = drawerEl(), lostEl = drawerEl();
  const asked: (string | null)[] = [];
  let told = 0;
  const store = { data: {}, save: () => {} } as unknown as Store;
  const activity = new Activity(actEl as unknown as HTMLElement, drawerEl() as unknown as HTMLElement, drawerEl() as unknown as HTMLElement, store, {
    me: () => me,
    review: () => ({ targets: {}, opinions: {}, keys: {}, trusted: [] }),
    mine: (name: string | null) => (asked.push(name), { targets: new Set<string>(), names: new Set<string>(), modules: new Set<string>() }),
    has: () => true,
    hasView: () => false,
    toggled: (open: boolean) => {
      if (open && lost.open) lost.toggle(false);
    },
    stateChanged: () => told++,
  } as unknown as ActivityHooks);
  const lost: LostAndFound = new LostAndFound(lostEl as unknown as HTMLElement, null, {
    toggled: (open: boolean) => {
      if (open && activity.open) activity.toggle(false);
    },
    changed: () => {},
  } as unknown as LostHooks);
  const page = { scheme: "kind" as string, edges: true, linear: false, artwork: null as ArtworkView | null };
  const apply: PageParts["apply"] = {
    activity: (v) => activity.mirror(v.activity!),
    lostFound: (v) => lost.toggle(v.lostFound!.open),
    colouring: (v) => (page.scheme = v.scheme!),
    edges: (v) => (page.edges = v.edges!),
    linear: (v) => (page.linear = v.linear!),
    artwork: (v) => (page.artwork = v.artwork ?? null),
  };
  return { activity, lost, page, apply, actEl, asked, told: () => told };
}

const place = { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: "v1", scope: null, tabs: ["v1"] };
const leader = (v: Partial<PresenceView>): PresenceView => cleanView({ ...place, ...v })!;
const shut: ActivityView = { open: false, kind: "all", who: "all" };

test("following starts: the follower's Activity, lost-and-found, colouring and edges become the other's at once, and follow them live", () => {
  const f = follower();
  // the follower had Activity open, filtered: the other's is closed, so theirs closes
  f.activity.toggle(true);
  f.actEl.click("data-filter", "build");
  assert.deepEqual(f.activity.state(), { open: true, kind: "build", who: "all" });
  applyOwn(leader({ activity: shut, lostFound: { open: false }, scheme: "kind", edges: true }), f.apply);
  assert.equal(f.activity.open, false, "nothing of the follower's own stays over the panel");
  assert.equal(f.actEl.classList.contains("open"), false);
  assert.deepEqual(f.activity.state(), shut, "with the other's filters");
  // the other opens Activity on Review, people only: the follower's opens with it, drawn so
  applyOwn(leader({ activity: { open: true, kind: "review", who: "people" } }), f.apply);
  assert.deepEqual(f.activity.state(), { open: true, kind: "review", who: "people" });
  assert.match(f.actEl.innerHTML, /class="sbtn toggle on" data-filter="review"/);
  assert.match(f.actEl.innerHTML, /class="sbtn toggle on" data-who="people"/);
  // their "My targets" is their own targets: the follower's keeps to Alice's, and says so
  applyOwn(leader({ activity: { open: true, kind: "all", who: "all", mine: "Alice" } }), f.apply);
  assert.equal(f.asked.at(-1), "Alice");
  assert.match(f.actEl.innerHTML, /data-mine[^>]*>Alice's targets</);
  assert.deepEqual(f.activity.state(), { open: true, kind: "all", who: "all", mine: "Alice" }, "and says so to whoever follows the follower");
  // the follower's own targets when the other's "My targets" is the follower's
  applyOwn(leader({ activity: { open: true, kind: "all", who: "all", mine: "Bob" } }), f.apply);
  assert.match(f.actEl.innerHTML, /data-mine[^>]*>My targets</);
  // the lost-and-found opens where Activity was, and Activity closes with it
  applyOwn(leader({ activity: shut, lostFound: { open: true } }), f.apply);
  assert.deepEqual([f.activity.open, f.lost.open], [false, true]);
  applyOwn(leader({ activity: { open: true, kind: "all", who: "all" }, lostFound: { open: false } }), f.apply);
  assert.deepEqual([f.activity.open, f.lost.open], [true, false]);
  // the colouring and the edges, and the linear form, as the other's board draws them
  applyOwn(leader({ scheme: "status", edges: false, linear: true }), f.apply);
  assert.deepEqual(f.page, { scheme: "status", edges: false, linear: true, artwork: null });
  // the place's parts are the page's own step, not these
  const placed: string[] = [];
  applyOwn(leader({ selection: "A.b", sel: "A.b", source: true }), new Proxy(f.apply, { get: (o, k) => (placed.push(String(k)), (o as Record<string, unknown>)[k as string]) }));
  assert.deepEqual(placed, []);
  // every change of the reader's own Activity is told, so that whoever follows them sees it
  assert.ok(f.told() > 0);
});

test("following ends: what the follower's page shows stays, their own; their next change starts from it", () => {
  const f = follower();
  applyOwn(leader({ activity: { open: true, kind: "change", who: "agents", mine: "Alice" }, scheme: "status", edges: false }), f.apply);
  // following ended: nothing is put back
  assert.deepEqual(f.activity.state(), { open: true, kind: "change", who: "agents", mine: "Alice" });
  assert.deepEqual(f.page, { scheme: "status", edges: false, linear: false, artwork: null });
  // the reader's own change of a filter starts from what they were shown
  f.actEl.click("data-who", "all");
  assert.deepEqual(f.activity.state(), { open: true, kind: "change", who: "all", mine: "Alice" });
  // Alice's targets let go, then the reader's own
  f.actEl.click("data-mine");
  assert.deepEqual(f.activity.state(), { open: true, kind: "change", who: "all" });
  f.actEl.click("data-mine");
  assert.deepEqual(f.activity.state(), { open: true, kind: "change", who: "all", mine: "Bob" });
  assert.equal(f.asked.at(-1), "Bob");
});

test("a page from before 2026-10-11, or an agent, says nothing of them: whoever follows it keeps their own", () => {
  const f = follower();
  f.activity.toggle(true);
  f.actEl.click("data-filter", "review");
  const own = f.activity.state();
  const old = cleanView(place)!;
  for (const field of ["activity", "lostFound", "scheme", "edges", "linear", "artwork"] as const) assert.ok(!(field in old), field);
  applyOwn(old, f.apply);
  assert.deepEqual(f.activity.state(), own);
  assert.equal(f.lost.open, false);
  assert.deepEqual(f.page, { scheme: "kind", edges: true, linear: false, artwork: null });
  // a page that says some of them: those, and the others stay
  applyOwn(leader({ edges: false }), f.apply);
  assert.deepEqual([f.activity.state(), f.page], [own, { scheme: "kind", edges: false, linear: false, artwork: null }]);
});
