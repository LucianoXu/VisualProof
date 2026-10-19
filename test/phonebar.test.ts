// The bar's popovers on a phone (PhoneSpec decisions 6 and 7): a phone is as narrow as 390 px, so
// each stays on the screen — across it under the bar, or at its right no wider than it. The build
// status's popover is 460 px wide on a larger screen; a mention's notice and what a request to follow
// came to hang from their buttons' right edge there.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PHONE } from "../src/web/src/phone.ts";

const css = () => readFileSync(new URL("../src/web/style.css", import.meta.url), "utf8").replace(/\/\*[^]*?\*\//g, "");

/** The rules of the `@media` blocks of `query`: selector, body. */
function blocks(text: string, query: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`@media ${query} {`, from);
    if (at < 0) return out;
    let depth = 0, i = text.indexOf("{", at);
    const start = i + 1;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    for (const m of text.slice(start, i).matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sel: m[1].trim(), body: m[2] });
    from = i;
  }
}

test("on a phone each popover of the bar stays on the screen: across it under the bar, or at its right no wider than it", () => {
  const phone = blocks(css(), PHONE);
  assert.ok(phone.length > 40, "the phone's rules are read");
  /** what the phone's rules say of `id`, all together */
  const of = (id: string) =>
    phone
      .filter((r) => r.sel.split(",").some((s) => s.trim() === id))
      .map((r) => r.body)
      .join(";");
  for (const id of ["#build-pop", "#share-pop", "#library-pop", "#who-menu", "#peer-menu", "#results", "#talk-notice", "#ask-line"]) {
    const b = of(id);
    assert.match(b, /(^|[;\s])left:\s*8px/, `${id}: from the screen's left margin`);
    assert.match(b, /(^|[;\s])right:\s*8px/, `${id}: to its right margin`);
    assert.match(b, /(^|[;\s])width:\s*auto/, `${id}: no width of its own`);
  }
  // a mention's notice and a request's answer wrap rather than run off
  assert.match(of("#ask-line"), /white-space:\s*normal/);
  // ⋯ and help's menu, at the right: no wider than the screen less its margins
  assert.match(of("#more-pop"), /right:\s*8px/);
  assert.match(of("#more-pop"), /width:\s*min\(\d+px,\s*calc\(100vw - 16px\)\)/);
  assert.match(of("#help-menu"), /right:\s*8px/);
});
