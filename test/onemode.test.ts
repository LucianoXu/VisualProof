// One page for everyone (ViewSpec decisions 18 and 19): simple and advanced mode were removed by the
// owner on 2026-10-08, because they barely differed. Nothing on the page is gated any more, the help
// sheet has no switch, and what a browser kept of the old choice (`visualproof:ui`) is not read.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const web = new URL("../src/web/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, web), "utf8");
const sources = () => readdirSync(new URL("src/", web)).filter((f) => f.endsWith(".ts")).map((f) => [f, read(`src/${f}`)] as const);

test("nothing on the page is held back for a mode: no gate in the markup, the style or the code", () => {
  assert.ok(!read("index.html").includes("data-advanced"), "index.html");
  const css = read("style.css");
  assert.ok(!css.includes("data-advanced") && !/body\.simple/.test(css), "style.css");
  for (const [file, text] of sources()) {
    assert.ok(!text.includes("data-advanced"), `${file} marks something advanced`);
    assert.ok(!text.includes("visualproof:ui"), `${file} reads the old choice of mode`);
    assert.ok(!/classList\.toggle\("simple"/.test(text), `${file} sets a simple page`);
  }
});

test("the help sheet has no switch between modes, and the tour no text for one", () => {
  const guide = read("src/guide.ts");
  assert.ok(!guide.includes("data-help-ui"), "no switch");
  assert.ok(!/\bsimple\b/i.test(guide) && !/\badvanced\b/i.test(guide), "no mode spoken of");
});
