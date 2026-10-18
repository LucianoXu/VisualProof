// The side panel as a drawer from ☰, on a phone and a tall screen (PhoneSpec decisions 9 and 19): it
// closes when the reader goes somewhere from it — a target, a cluster's name — and stays while they
// open or fold a level of the tree, fold a section, press a row's own buttons or ⚙ Board and Trusted,
// which take its place.

import assert from "node:assert/strict";
import { test } from "node:test";
import { goesFromDrawer } from "../src/web/src/phone.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";

/** An element inside the ones before it, each matching the selectors it is given ("a|b": one element
 *  that is both). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("the drawer closes as the reader goes somewhere from it, and stays for what arranges what it shows", () => {
  // a target's row is a button that goes to the target's view
  assert.equal(goesFromDrawer(at("#side", "#targets", "button|.tg-row|[data-open]")), true);
  assert.equal(goesFromDrawer(at("#side", "#targets", "button|.tg-row|[data-open]", ".tg-name")), true, "on its name");
  assert.equal(goesFromDrawer(at("#side", "#targets", "button|.tg-row")), true, "a target with no view yet");
  // a cluster's name, or the rest of its row, selects it
  assert.equal(goesFromDrawer(at("#side", "#outline", ".o-row|[data-c]", "button|.o-label")), true);
  assert.equal(goesFromDrawer(at("#side", "#outline", ".o-row|[data-c]", ".o-count")), true);
  // what stays: the arrow of a level, the section's heading, a row's own buttons, ⚙ Board, Trusted
  assert.equal(goesFromDrawer(at("#side", "#outline", ".o-row|[data-c]", "button|.tw")), false);
  assert.equal(goesFromDrawer(at("#side", "#targets", "button|.sec-h|[data-sec]")), false);
  assert.equal(goesFromDrawer(at("#side", "#targets", "button|.sec-h|[data-sec]", ".sec-chev")), false);
  assert.equal(goesFromDrawer(at("#side", "#outline", ".o-row|[data-c]", "button|.fold")), false);
  assert.equal(goesFromDrawer(at("#side", "#outline", ".o-row|[data-c]", "button|.o-trust|[data-trust]")), false);
  assert.equal(goesFromDrawer(at("#side", ".side-tools", "button|#board-btn")), false);
  assert.equal(goesFromDrawer(at("#side", ".side-tools", "button|#trusted-btn")), false);
  // the drawer's blank parts
  assert.equal(goesFromDrawer(at("#side")), false);
  assert.equal(goesFromDrawer(at("#side", "#outline")), false);
});
