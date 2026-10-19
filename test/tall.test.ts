// The upright screens (PhoneSpec, "Tall screens" and "Upright monitors", the owner's decisions of
// 2026-10-17 and 2026-10-18): wider than a phone and at least 1.2 times as high as it is wide — a tall
// screen under a finger or narrower than 1000 px, an upright monitor with a mouse otherwise. Their
// lines, as the page draws them (web/style.css) and as its code asks for them (web/src/phone.ts);
// every surface of the page has a place on each; and neither is a mode — nothing is gated by them.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MONITOR, PHONE, SHEETED, shapeOf, TALL } from "../src/web/src/phone.ts";
import { FOLLOWED, FRAMES, YOURS } from "../src/web/src/surfaces.ts";

const web = new URL("../src/web/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, web), "utf8");
const css = () => read("style.css").replace(/\/\*[^]*?\*\//g, "");

/** The rules of the `@media` blocks of `query`, the blocks nested in them included: selector, body. */
function blocks(text: string, query: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`@media ${query} {`, from);
    if (at < 0) return out;
    // the block, to its closing brace
    let depth = 0, i = text.indexOf("{", at);
    const start = i + 1;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    const inner = text.slice(start, i).replace(/@media[^{]*\{/g, "");
    for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sel: m[1].trim(), body: m[2] });
    from = i;
  }
}

test("the lines: a phone at most 640 px wide; upright, a tall screen under a finger or below 1000 px, else an upright monitor", () => {
  const sizes: [number, number, Parameters<typeof shapeOf>[2], ReturnType<typeof shapeOf>][] = [
    [390, 844, "coarse", "phone"],
    [640, 1200, "fine", "phone"],
    // upright under a finger: the iPads, whatever their width
    [641, 1200, "coarse", "tall"],
    [768, 1024, "coarse", "tall"],
    [820, 1180, "coarse", "tall"],
    [1024, 1366, "coarse", "tall"],
    // upright with a mouse: a narrow window, then the monitors on their side
    [900, 1600, "fine", "tall"],
    [999, 1800, "fine", "tall"],
    [1000, 1800, "fine", "monitor"],
    [1080, 1920, "fine", "monitor"],
    [1200, 1920, "fine", "monitor"],
    [1440, 2560, "fine", "monitor"],
    [2160, 3840, "fine", "monitor"],
    // the ratio's line itself is upright; just short of it, a larger screen's page
    [1000, 1200, "fine", "monitor"],
    [1000, 1199, "fine", "wide"],
    [1100, 1100, "coarse", "wide"],
    // no pointer at all, upright and wide enough: a larger screen's page
    [1080, 1920, "none", "wide"],
    // held sideways, and a laptop
    [1024, 768, "coarse", "wide"],
    [1366, 1024, "coarse", "wide"],
    [1440, 900, "fine", "wide"],
    [844, 390, "coarse", "wide"],
  ];
  for (const [w, h, p, shape] of sizes) assert.equal(shapeOf(w, h, p), shape, `${w} × ${h}, ${p}`);
  // the queries say the same, which `shapeOf` follows
  assert.equal(PHONE, "(max-width: 640px)");
  assert.equal(TALL, "(min-width: 641px) and (max-aspect-ratio: 5/6) and (pointer: coarse), (min-width: 641px) and (max-width: 999px) and (max-aspect-ratio: 5/6)");
  assert.equal(SHEETED, `${PHONE}, ${TALL}`, "a phone or a tall screen: the shapes with a sheet and a drawer");
  assert.equal(MONITOR, "(min-width: 1000px) and (max-aspect-ratio: 5/6) and (pointer: fine)");
  // and the page draws them with those very queries
  const text = css();
  for (const q of [PHONE, TALL, SHEETED, MONITOR]) assert.ok(text.includes(`@media ${q} {`), `style.css has a block for ${q}`);
});

/** Where each surface of the page (web/src/surfaces.ts) is on a tall screen and on an upright monitor,
 *  by the decision that puts it there. A surface declared without a place here fails: it is placed
 *  before it ships. */
const PLACES: Record<string, { tall: string; monitor: string }> = {
  // what is followed
  view: {
    tall: "the tabs in the view bar; the side panel in the drawer from ☰ (decision 19)",
    monitor: "the tabs in the view bar; the side panel at the board's left (decision 32)",
  },
  history: {
    tall: "the Time Machine's bar in the view bar, the focus giving way below 1000 px (decisions 24, 28)",
    monitor: "the Time Machine's bar in the view bar, as on a larger screen (decision 30)",
  },
  camera: {
    tall: "the board, the whole width; the zoom's box at the foot of its room (decision 23)",
    monitor: "the board above the work area; the zoom's box at the foot of its room (decisions 30, 32)",
  },
  tool: {
    tall: "the modes in the view bar, as on a larger screen (decision 18)",
    monitor: "the modes in the view bar, as on a larger screen (decision 30)",
  },
  selection: {
    tall: "the board, the drawer's rows, the search, the panel's rows; the selection bar across, under the strip (decisions 19, 22)",
    monitor: "the board, the side panel's rows, the search, the panel's rows; the selection bar under the modes (decision 30)",
  },
  focus: {
    tall: "the focus menu in the view bar (decision 25)",
    monitor: "the focus menu in the view bar (decision 30)",
  },
  visitors: {
    tall: "the board, as on a larger screen (decision 18)",
    monitor: "the board, as on a larger screen (decision 30)",
  },
  panel: {
    tall: "the sheet from the bottom (decision 20)",
    monitor: "the pane at the work area's left (decision 33)",
  },
  sources: {
    tall: "docked in the sheet's place (decision 21)",
    monitor: "the column, at its top (decision 34)",
  },
  paper: {
    tall: "docked in the sheet's place, beside or under the source (decision 21)",
    monitor: "the column, under the source (decision 34)",
  },
  activity: {
    tall: "in the sheet's place (decision 20)",
    monitor: "in the panel's pane (decision 33)",
  },
  lostFound: {
    tall: "in the sheet's place (decision 20)",
    monitor: "in the panel's pane (decision 33)",
  },
  colouring: {
    tall: "the legend at the foot of the board's room (decision 23)",
    monitor: "the legend at the foot of the board's room (decision 30)",
  },
  edges: {
    tall: "the zoom's box's ⋯, at the foot of the board's room (decision 23)",
    monitor: "the zoom's box's ⋯ (decision 30)",
  },
  linear: {
    tall: "the board, the whole width (decision 18)",
    monitor: "the board's room (decision 30)",
  },
  artwork: {
    tall: "the artwork's frame and its panel, as on a larger screen (decision 18)",
    monitor: "the artwork's frame and its panel, as on a larger screen (decision 30)",
  },
  // the reader's own
  windowPlaces: {
    tall: "the dock places the windows: no edge, no drag (decision 21)",
    monitor: "the column places the windows: no edge, no drag; its splitters (decisions 34, 35)",
  },
  scroll: {
    tall: "as anywhere (decision 18)",
    monitor: "as anywhere (decision 30)",
  },
  sections: {
    tall: "the drawer, the sheet and the lost-and-found in the sheet's place (decisions 19, 20)",
    monitor: "the side panel, the panel's pane and the lost-and-found in it (decisions 32, 33)",
  },
  tcbOrder: {
    tall: "the sheet's TCB list (decision 20)",
    monitor: "the panel's TCB list (decision 33)",
  },
  outline: {
    tall: "the drawer (decision 19)",
    monitor: "the side panel (decision 32)",
  },
  whatChanged: {
    tall: "the Time Machine's bar and its lists (decision 28)",
    monitor: "the Time Machine's bar and its lists (decision 30)",
  },
  legend: {
    tall: "the foot of the board's room (decision 23)",
    monitor: "the foot of the board's room (decision 30)",
  },
  eyes: {
    tall: "the zoom's box's ⋯ (decision 23)",
    monitor: "the zoom's box's ⋯ (decision 30)",
  },
  phone: {
    tall: "☰ opens the drawer (decision 19); ⋯ is a phone's alone, the bar holding every button (decisions 7, 24)",
    monitor: "neither ⋯ nor ☰: the bar holds every button and the side panel is in place (decisions 30, 32)",
  },
  theme: {
    tall: "the zoom's box's ⋯ (decision 23)",
    monitor: "the zoom's box's ⋯ (decision 30)",
  },
  lock: {
    tall: "the zoom's box's ⋯, as on a larger screen (decision 18)",
    monitor: "the zoom's box's ⋯, as on a larger screen (decision 30)",
  },
  paperTools: {
    tall: "the reference window, docked (decision 21)",
    monitor: "the reference window, in the column (decision 34)",
  },
  share: {
    tall: "the bar; its popover at the bar's right (decisions 24, 25)",
    monitor: "the bar and its popover, as on a larger screen (decision 30)",
  },
  export: {
    tall: "the bar; its window in the sheet's place (decisions 20, 24)",
    monitor: "the bar; its window at the top right, the outline on the board (decision 30)",
  },
  help: {
    tall: "the bar's ? and its menu at the bar's right; the sheet the screen's width; the tour framed above the sheet; the welcome above the legend (decisions 23, 25–27)",
    monitor: "the bar's ? and its menu; the sheet, the tour framed on the board's room, the welcome above the legend (decision 30)",
  },
  film: {
    tall: "the help sheet, the film over its chapters (decision 26)",
    monitor: "the help sheet, as on a larger screen (decision 30)",
  },
  library: {
    tall: "the bar; its popover at the bar's right (decisions 24, 25)",
    monitor: "the bar and its popover, as on a larger screen (decision 30)",
  },
  board: {
    tall: "⚙ Board in the drawer's place (decision 19)",
    monitor: "⚙ Board beside the side panel (decision 32)",
  },
  trusted: {
    tall: "Trusted in the drawer's place (decision 19)",
    monitor: "Trusted beside the side panel (decision 32)",
  },
  viewsMenu: {
    tall: "the Views menu under its button (decision 25)",
    monitor: "the Views menu under its button (decision 30)",
  },
  focusMenu: {
    tall: "the focus menu under its button (decision 25)",
    monitor: "the focus menu under its button (decision 30)",
  },
  build: {
    tall: "the bar's build status and its popover (decision 18)",
    monitor: "the bar's build status and its popover (decision 30)",
  },
  search: {
    tall: "the bar (decision 18)",
    monitor: "the bar (decision 30)",
  },
  artFilter: {
    tall: "the artwork's panel (decision 18)",
    monitor: "the artwork's panel (decision 30)",
  },
  name: {
    tall: "the bar; its menu at the bar's right (decision 25)",
    monitor: "the bar and its menu (decision 30)",
  },
  people: {
    tall: "the bar's initials and their menu (decision 18)",
    monitor: "the bar's initials and their menu (decision 30)",
  },
  askBanner: {
    tall: "at the top in the middle, as on a larger screen (decision 18)",
    monitor: "at the top in the middle, as on a larger screen (decision 30)",
  },
  conversation: {
    tall: "the conversation window docked in the sheet's place, its button in the bar (decisions 18, 21)",
    monitor: "the conversation window in the column, under the reference; its button in the bar (decisions 30, 34)",
  },
  followingStrip: {
    tall: "above the legend (decision 23)",
    monitor: "above the legend (decision 30)",
  },
  hoverCards: {
    tall: "as on a larger screen (decision 18)",
    monitor: "as on a larger screen (decision 30)",
  },
  pointer: {
    tall: "as on a larger screen (decision 18)",
    monitor: "as on a larger screen (decision 30)",
  },
  meter: {
    tall: "as on a larger screen (decision 18)",
    monitor: "as on a larger screen (decision 30)",
  },
};

test("every surface of the page has a place on a tall screen and on an upright monitor, and nothing else is placed", () => {
  const surfaces = [...FOLLOWED.map((p) => p.part), ...YOURS.map((y) => y.id)].sort();
  assert.deepEqual(Object.keys(PLACES).sort(), surfaces);
  const spec = readFileSync(new URL("../SPEC/PhoneSpec.md", import.meta.url), "utf8");
  const tall = spec.slice(spec.indexOf("### Tall screens"), spec.indexOf("### Upright monitors"));
  const monitor = spec.slice(spec.indexOf("### Upright monitors"), spec.indexOf("## Open"));
  for (const [s, place] of Object.entries(PLACES)) {
    assert.match(place.tall, /\(decisions? \d+/, `${s}: placed on a tall screen by a decision`);
    assert.match(place.monitor, /\(decisions? \d+/, `${s}: placed on an upright monitor by a decision`);
    // an upright monitor's places are its own decisions' (29–35)
    for (const d of place.monitor.match(/\d+/g)!) assert.ok(+d >= 29 && +d <= 35, `${s}: decision ${d} on a monitor`);
  }
  // and the decisions cited are there: the tall screens' (16–28), the upright monitors' (29–35)
  for (let d = 16; d <= 28; d++) assert.match(tall, new RegExp(`^${d}\\. \\*\\*`, "m"), `decision ${d}`);
  for (let d = 29; d <= 35; d++) assert.match(monitor, new RegExp(`^${d}\\. \\*\\*`, "m"), `decision ${d}`);
});

test("on a tall screen nothing a surface is shown in is hidden: what goes is moved, or its words alone", () => {
  const text = css();
  const tall = [...blocks(text, TALL), ...blocks(text, SHEETED), ...blocks(text, "(min-width: 641px) and (max-width: 999px) and (max-aspect-ratio: 5/6)"), ...blocks(text, "(min-width: 641px) and (max-width: 900px) and (max-aspect-ratio: 5/6)")];
  assert.ok(tall.length > 20, "the tall screen's rules are read");
  // what a tall screen hides, and where it went: the side panel into the drawer, the words of three
  // buttons (their icons stay), the focus while the Time Machine's bar needs the room, the windows'
  // edges (the dock places them)
  const MOVED: Record<string, string> = {
    "#side": "the drawer",
    "#share-btn > span, #library-btn > span, #export-btn > span": "the buttons' words: their icons stay",
    "body.tm .focus-wrap": "the focus, while the Time Machine is open",
    "#windows .fl-rz": "the docked windows' edges",
  };
  const hidden = tall.filter((r) => /display:\s*none/.test(r.body)).map((r) => r.sel.replace(/\s+/g, " "));
  for (const sel of hidden) assert.ok(sel in MOVED, `a tall screen hides ${sel}`);
  // the side panel comes back in the drawer, with its button
  assert.ok(tall.some((r) => r.sel.includes("body.side-open #side") && /display:\s*flex/.test(r.body)), "the drawer shows the side panel");
  assert.ok(tall.some((r) => r.sel === ".side-btn" && /display:\s*inline-flex/.test(r.body)), "☰ is shown");
  // and no element a surface is in is hidden by its id: every id the registry names
  const ids = new Set<string>();
  const where = [...FOLLOWED.flatMap((p) => ["changes" in p ? p.changes : "", "reads" in p ? p.reads : ""]), ...YOURS.map((y) => ("where" in y ? y.where : "")), ...FRAMES].join(",");
  for (const m of where.matchAll(/#([\w-]+)/g)) ids.add(m[1]);
  for (const sel of hidden)
    for (const one of sel.split(",").map((s) => s.trim()))
      if (/^#[\w-]+$/.test(one)) assert.ok(one === "#side" || !ids.has(one.slice(1)), `${one} is hidden on a tall screen`);
  // what a phone folds into ⋯ is not folded on a tall screen: the bar keeps its buttons
  assert.ok(!tall.some((r) => r.sel.includes("#share-btn, #library-btn") && /display:\s*none/.test(r.body)), "the bar's buttons stay");
  assert.ok(!tall.some((r) => r.sel.includes(".more-wrap") && /display:\s*block/.test(r.body)), "no ⋯ on a tall screen");
  // an upright monitor hides nothing but the docked windows' edges: the work area places them
  const monitor = blocks(text, MONITOR);
  assert.ok(monitor.length > 10, "the monitor's rules are read");
  const gone = monitor.filter((r) => /display:\s*none/.test(r.body)).map((r) => r.sel.replace(/\s+/g, " "));
  assert.deepEqual(gone, ["#windows .fl-rz"]);
});

test("a tall screen is a shape, not a mode: nothing is gated by it, nothing names it a mode, and its code is the phone's", () => {
  const sources = readdirSync(new URL("src/", web)).filter((f) => f.endsWith(".ts")).map((f) => [f, read(`src/${f}`)] as const);
  for (const [file, text] of [...sources, ["index.html", read("index.html")] as const, ["style.css", read("style.css")] as const]) {
    // no class the page sets for the shape, no mode spoken of
    assert.ok(!/classList\.(toggle|add)\("(tall|tablet|portrait)"/.test(text), `${file} sets a class for the shape`);
    assert.ok(!/body\.(tall|tablet|portrait)\b/.test(text), `${file} styles a body class of the shape`);
    assert.ok(!/\b(tablet|portrait|tall) mode\b/i.test(text), `${file} speaks of a mode`);
  }
  // the shape is asked of the screen alone, in one place
  for (const [file, text] of sources) if (file !== "phone.ts") assert.ok(!text.includes("max-aspect-ratio"), `${file} draws its own line`);
  // the sheet and the drawer are the phone's: one class binds them, for both shapes
  const phone = read("src/phone.ts");
  assert.equal((phone.match(/private bindSheet\(/g) ?? []).length, 1);
  assert.match(phone, /document\.getElementById\("side"\)!\.addEventListener\("click", \(e\) => \{\s*if \(!sheeted\(\)\) return;/);
});
