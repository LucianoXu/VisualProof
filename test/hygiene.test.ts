// Names Lean's macro hygiene makes (shared/hygiene.ts): Mathlib's `irreducible_def X` writes its value
// and the opaque constant holding it as `definition` and `wrapped`, which Lean names with macro scopes
// (`Fixture.definition._@.Fixture.Tagged._hyg.3`); the extractor folds them into `X` (ViewNode.also).
// The page says them by what the macro wrote — in the panel's "Also declares", the source window's
// list of what the command generated, a search hit found by one — and offers no `#print` for them,
// which cannot name them to Lean. On the fixture's own `hidden_def`: test/extract.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { hygienic, withoutMacroScopes } from "../src/shared/hygiene.ts";
import { isDeclName } from "../src/server/hover.ts";
import { alsoList, generatedName } from "../src/web/src/panel.ts";

const DEF = "Fixture.definition._@.Fixture.Tagged._hyg.3";
const WRAPPED = "Fixture.Pair.wrapped._@.Fixture.Tagged.1a2b3c4d._hygCtx._hyg.12";

test("a name of the macro's hygiene, read without its macro scopes: what the macro wrote", () => {
  assert.equal(hygienic(DEF), true);
  assert.equal(hygienic("Fixture.Pair.Tag_ne"), false);
  assert.equal(withoutMacroScopes(DEF), "Fixture.definition");
  assert.equal(withoutMacroScopes(WRAPPED), "Fixture.Pair.wrapped");
  assert.equal(withoutMacroScopes("Fixture.definition._proof_1._@.Fixture.Tagged._hyg.3"), "Fixture.definition._proof_1");
  assert.equal(withoutMacroScopes("Fixture.Pair.Tag_ne"), "Fixture.Pair.Tag_ne");
  // and no `#print` could name it: the server refuses such a name, so the page offers none
  assert.equal(isDeclName(DEF), false);
  assert.equal(isDeclName(withoutMacroScopes(DEF)), true, "what is said is a name, though of nothing Lean has");
});

test("what a command generated, as the panel and the source window say it: the macro's names readably, never their hygiene's numbers", () => {
  assert.deepEqual(generatedName("Fixture.positive", DEF), { short: "definition", hygienic: true });
  assert.deepEqual(generatedName("Fixture.Pair.corner", WRAPPED), { short: "wrapped", hygienic: true });
  // the others as before: under the unit's name, else their last part
  assert.deepEqual(generatedName("Fixture.Pair", "Fixture.Pair.Tag_ne"), { short: "Tag_ne", hygienic: false });
  assert.deepEqual(generatedName("Fixture.Pair", "Fixture.instDecidableEqTag"), { short: "instDecidableEqTag", hygienic: false });
  const html = alsoList("Fixture.positive", [DEF, "Fixture.definition._@.Fixture.Tagged._hyg.5".replace("definition", "wrapped")]);
  assert.equal(html.replace(/<[^>]+>/g, ""), "definition, wrapped", "was: 3, 5");
  assert.match(html, /title="Fixture\.definition: written by the macro of the command that writes Fixture\.positive, under a name of its hygiene \(Fixture\.definition\._@\.Fixture\.Tagged\._hyg\.3\), and part of it"/);
});
