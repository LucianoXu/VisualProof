// The bar's popovers on a phone (PhoneSpec decisions 6 and 7): a phone is as narrow as 390 px, so
// each stays on the screen — across it under the bar, or at its right no wider than it. The build
// status's popover is 460 px wide on a larger screen; a mention's notice and what a request to follow
// came to hang from their buttons' right edge there.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { initialsShown } from "../src/web/src/people.ts";
import { ITEMS, moreMark, PHONE } from "../src/web/src/phone.ts";

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

// The conversation button on a phone (the owner's decision of 2026-10-19, PhoneSpec decision 7): in
// ⋯ with the bar's other buttons, its count of what is new in Everyone and its mark carried on ⋯ as
// Activity's count is; beside the people's initials it left the build status 33 px ("Bı") and the
// project's name "«f…" of a 390 px bar.
test("on a phone the conversation button is an item of ⋯, after Activity, and what is new under ⋯ shows on it", () => {
  const phone = blocks(css(), PHONE);
  const hidden = phone.find((r) => /display:\s*none\s*!important/.test(r.body) && r.sel.split(",").some((s) => s.trim() === "#activity-btn"));
  assert.ok(hidden, "the bar's buttons that ⋯ holds are not in the bar");
  assert.ok(hidden.sel.split(",").some((s) => s.trim() === "#talk-btn"), "nor is the conversation button");
  const ids = ITEMS.map((i) => i.id);
  assert.equal(ids.indexOf("talk-btn"), ids.indexOf("activity-btn") + 1, "Conversations follows Activity, as in the bar");
  assert.deepEqual(ids, ["share-btn", "library-btn", "export-btn", "activity-btn", "talk-btn", "who", "help-btn"]);
  // ⋯ carries Activity's count and the conversations' as one, and the mark of a mention
  assert.deepEqual(moreMark(null, null, false), { count: null, at: false });
  assert.deepEqual(moreMark("3", null, false), { count: "3", at: false });
  assert.deepEqual(moreMark(null, "2", true), { count: "2", at: true });
  assert.deepEqual(moreMark("3", "2", false), { count: "5", at: false });
  assert.deepEqual(moreMark("99+", "4", false), { count: "99+", at: false });
  assert.deepEqual(moreMark("60", "45", true), { count: "99+", at: true });
  // ⋯'s popover lies above the floating windows, the conversation window among them, as the bar's
  // other popovers do: it is what opens and closes that window on a phone
  assert.match(css(), /#bar:has\([^{]*#more-pop:not\(\[hidden\]\)[^{]*\{\s*z-index:\s*36/);
});

test("on a phone the people take at most four places of the bar: four initials, or three and +N", () => {
  // a larger screen: five, then +N
  assert.equal(initialsShown(3, false, false), 3);
  assert.equal(initialsShown(8, false, false), 5);
  assert.equal(initialsShown(8, true, false), 5);
  // a phone: up to four; more, three and +N; the private readers' count takes a place
  assert.equal(initialsShown(0, true, true), 0);
  assert.equal(initialsShown(4, false, true), 4);
  assert.equal(initialsShown(5, false, true), 3);
  assert.equal(initialsShown(3, true, true), 3);
  assert.equal(initialsShown(4, true, true), 2);
  const phone = blocks(css(), PHONE);
  const of = (sel: string) => phone.filter((r) => r.sel.split(",").some((s) => s.trim() === sel)).map((r) => r.body).join(";");
  // the private readers by their count alone
  assert.match(of(".pv-word"), /display:\s*none/);
  // search by its magnifier, the field taking the whole bar while it is used
  assert.match(of("#search"), /width:\s*36px/);
  assert.match(of(".search-wrap:focus-within #search"), /width:\s*100%/);
  // the status keeps its dot and first word, and gives way before the name
  assert.match(of(".build-pill"), /min-width:\s*57px/);
  // the buttons at the right take their own width, and the places of those ⋯ holds no gap
  assert.match(of("#bar .right"), /flex:\s*0 1 auto/);
  assert.ok(phone.some((r) => /display:\s*contents/.test(r.body) && /\.talk-wrap/.test(r.sel) && /\.share-wrap/.test(r.sel)));
});
