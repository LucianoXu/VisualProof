// A tall screen (PhoneSpec, "Tall screens", the owner's decisions of 2026-10-17): wider than a phone
// and at least 1.2 times as high as it is wide. Its line, as the page draws it (web/style.css) and as
// its code asks for it (web/src/phone.ts); every surface of the page has a place there; and a tall
// screen is a shape, not a mode — nothing on the page is gated by it.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { PHONE, SHEETED, shapeOf, TALL } from "../src/web/src/phone.ts";
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

test("the line: a phone at most 640 px wide; a tall screen wider, at least 1.2 times as high as it is wide", () => {
  const sizes: [number, number, ReturnType<typeof shapeOf>][] = [
    [390, 844, "phone"],
    [640, 1200, "phone"],
    [641, 1200, "tall"],
    // the iPads held upright, a narrow window, a monitor on its side
    [768, 1024, "tall"],
    [820, 1180, "tall"],
    [1024, 1366, "tall"],
    [900, 1600, "tall"],
    [1080, 1920, "tall"],
    [1440, 2560, "tall"],
    // the line itself is tall; just short of it, a larger screen's page
    [1000, 1200, "tall"],
    [1000, 1199, "wide"],
    [1100, 1100, "wide"],
    // held sideways, and a laptop
    [1024, 768, "wide"],
    [1366, 1024, "wide"],
    [1440, 900, "wide"],
    [844, 390, "wide"],
  ];
  for (const [w, h, shape] of sizes) assert.equal(shapeOf(w, h), shape, `${w} × ${h}`);
  // the queries say the same: the phone's width, then the tall screen's ratio, which `shapeOf` follows
  assert.equal(PHONE, "(max-width: 640px)");
  assert.equal(TALL, "(min-width: 641px) and (max-aspect-ratio: 5/6)");
  assert.equal(SHEETED, `${PHONE}, (max-aspect-ratio: 5/6)`, "a phone or a tall screen: the shapes with a sheet and a drawer");
  // and the page draws them with those very queries
  const text = css();
  for (const q of [PHONE, TALL, SHEETED]) assert.ok(text.includes(`@media ${q} {`), `style.css has a block for ${q}`);
});

/** Where each surface of the page (web/src/surfaces.ts) is on a tall screen, by the decision that
 *  puts it there. A surface declared without a place here fails: it is placed before it ships. */
const PLACES: Record<string, string> = {
  // what is followed
  view: "the tabs in the view bar; the side panel in the drawer from ☰ (decision 19)",
  history: "the Time Machine's bar in the view bar, the focus giving way below 1000 px (decisions 24, 28)",
  camera: "the board, the whole width; the zoom's box at the foot of its room (decision 23)",
  tool: "the modes in the view bar, as on a larger screen (decision 18)",
  selection: "the board, the drawer's rows, the search, the panel's rows; the selection bar across, under the strip (decisions 19, 22)",
  focus: "the focus menu in the view bar (decision 25)",
  visitors: "the board, as on a larger screen (decision 18)",
  panel: "the sheet from the bottom (decision 20)",
  sources: "docked in the sheet's place (decision 21)",
  paper: "docked in the sheet's place, beside or under the source (decision 21)",
  activity: "in the sheet's place (decision 20)",
  lostFound: "in the sheet's place (decision 20)",
  colouring: "the legend at the foot of the board's room (decision 23)",
  edges: "the zoom's box's ⋯, at the foot of the board's room (decision 23)",
  linear: "the board, the whole width (decision 18)",
  artwork: "the artwork's frame and its panel, as on a larger screen (decision 18)",
  // the reader's own
  windowPlaces: "the dock places the windows: no edge, no drag (decision 21)",
  scroll: "as anywhere (decision 18)",
  sections: "the drawer, the sheet and the lost-and-found in the sheet's place (decisions 19, 20)",
  tcbOrder: "the sheet's TCB list (decision 20)",
  outline: "the drawer (decision 19)",
  whatChanged: "the Time Machine's bar and its lists (decision 28)",
  legend: "the foot of the board's room (decision 23)",
  eyes: "the zoom's box's ⋯ (decision 23)",
  phone: "☰ opens the drawer (decision 19); ⋯ is a phone's alone, the bar holding every button (decisions 7, 24)",
  theme: "the zoom's box's ⋯ (decision 23)",
  lock: "the zoom's box's ⋯, as on a larger screen (decision 18)",
  paperTools: "the reference window, docked (decision 21)",
  share: "the bar; its popover at the bar's right (decisions 24, 25)",
  export: "the bar; its window in the sheet's place (decisions 20, 24)",
  help: "the bar's ? and its menu at the bar's right; the sheet the screen's width; the tour framed above the sheet; the welcome above the legend (decisions 23, 25–27)",
  film: "the help sheet, the film over its chapters (decision 26)",
  library: "the bar; its popover at the bar's right (decisions 24, 25)",
  board: "⚙ Board in the drawer's place (decision 19)",
  trusted: "Trusted in the drawer's place (decision 19)",
  viewsMenu: "the Views menu under its button (decision 25)",
  focusMenu: "the focus menu under its button (decision 25)",
  build: "the bar's build status and its popover (decision 18)",
  search: "the bar (decision 18)",
  artFilter: "the artwork's panel (decision 18)",
  name: "the bar; its menu at the bar's right (decision 25)",
  people: "the bar's initials and their menu (decision 18)",
  askBanner: "at the top in the middle, as on a larger screen (decision 18)",
  conversation: "docked in the sheet's place; the following strip above the legend (decisions 21, 23)",
  talkPin: "the conversation's title bar, docked (decision 21)",
  hoverCards: "as on a larger screen (decision 18)",
  pointer: "as on a larger screen (decision 18)",
  meter: "as on a larger screen (decision 18)",
};

test("every surface of the page has a place on a tall screen, and nothing else is placed", () => {
  const surfaces = [...FOLLOWED.map((p) => p.part), ...YOURS.map((y) => y.id)].sort();
  assert.deepEqual(Object.keys(PLACES).sort(), surfaces);
  for (const [s, place] of Object.entries(PLACES)) assert.match(place, /\(decisions? \d+/, `${s}: placed by a decision`);
  // and the decisions it cites are PhoneSpec's tall screens' (16–28), or the phone's it reuses
  const spec = readFileSync(new URL("../SPEC/PhoneSpec.md", import.meta.url), "utf8");
  const tall = spec.slice(spec.indexOf("### Tall screens"), spec.indexOf("## Open"));
  for (let d = 16; d <= 28; d++) assert.match(tall, new RegExp(`^${d}\\. \\*\\*`, "m"), `decision ${d}`);
});

test("on a tall screen nothing a surface is shown in is hidden: what goes is moved, or its words alone", () => {
  const text = css();
  const tall = [...blocks(text, TALL), ...blocks(text, SHEETED), ...blocks(text, "(min-width: 641px) and (max-width: 1000px) and (max-aspect-ratio: 5/6)"), ...blocks(text, "(min-width: 641px) and (max-width: 900px) and (max-aspect-ratio: 5/6)")];
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
