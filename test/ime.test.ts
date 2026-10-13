// An input method's Enter commits its composition and is never a field's own (web/src/ime.ts; the
// owner's report of 2026-10-11, in Safari): marked composing, keyCode 229, during a composition,
// or just after one ended; a plain Enter a while later is the field's again.

import assert from "node:assert/strict";
import { test } from "node:test";
import { composing, noteComposition } from "../src/web/src/ime.ts";

test("an Enter that commits an input method's composition is not the field's own", () => {
  noteComposition(false, -1e9);
  assert.equal(composing({ isComposing: false, keyCode: 13 }, 0), false, "a plain Enter");
  assert.equal(composing({ isComposing: true, keyCode: 13 }, 0), true, "Chrome and Firefox mark it");
  assert.equal(composing({ isComposing: false, keyCode: 229 }, 0), true, "Safari's keyCode");
  noteComposition(true, 100);
  assert.equal(composing({ isComposing: false, keyCode: 13 }, 150), true, "during a composition");
  noteComposition(false, 200);
  assert.equal(composing({ isComposing: false, keyCode: 13 }, 230), true, "Safari: just after compositionend");
  assert.equal(composing({ isComposing: false, keyCode: 13 }, 400), false, "a later Enter is the field's again");
});
