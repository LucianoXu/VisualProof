// The keyboard's place kept while a list is drawn again (web/src/keepfocus.ts): what had the focus is
// found again in the list drawn anew by what it is — its tag, its data attributes or its first class,
// and the data attributes of the row holding it — whatever its state, and nothing else is taken for it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { focusKey } from "../src/web/src/keepfocus.ts";
import type { KeyedEl } from "../src/web/src/keepfocus.ts";

/** An element: its tag and classes, its attributes, inside `parent`. */
const el = (tag: string, className: string, attrs: Record<string, string>, parent: KeyedEl | null): KeyedEl => ({
  tagName: tag.toUpperCase(),
  className,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  parentElement: parent,
});

test("a row's control drawn again is found by what it is, not by its state", () => {
  const root = el("div", "", { id: "outline" }, null);
  // the board's tree: a cluster's row, its arrow, its name, its fold
  const row = (c: string, cls = "o-row") => el("div", cls, { "data-c": c, style: "padding-left:8px" }, root);
  const before = row("3");
  const after = row("3", "o-row on folded");
  for (const cls of ["tw", "o-label", "fold"]) assert.equal(focusKey(el("button", cls, {}, before), root), focusKey(el("button", `${cls} on`, { "aria-expanded": "true" }, after), root), cls);
  // another row, another control of the row: another place
  assert.notEqual(focusKey(el("button", "o-label", {}, before), root), focusKey(el("button", "o-label", {}, row("4")), root));
  assert.notEqual(focusKey(el("button", "tw", {}, before), root), focusKey(el("button", "fold", {}, before), root));
  // the targets: each row a button that says which target it is, the one on show or not
  const tg = (t: string, cls: string) => el("button", cls, { "data-target": t, "data-open": `v-${t}` }, el("div", "tg-rows", {}, root));
  assert.equal(focusKey(tg("A.caseII", "tg-row"), root), focusKey(tg("A.caseII", "tg-row on"), root));
  assert.notEqual(focusKey(tg("A.caseII", "tg-row"), root), focusKey(tg("A.flt", "tg-row"), root));
  // the legend's schemes: Kind is Kind, chosen or not
  const scheme = (s: string, cls: string) => el("button", cls, { "data-scheme": s, "aria-pressed": "false" }, el("nav", "seg mini", {}, root));
  assert.equal(focusKey(scheme("kind", ""), root), focusKey(scheme("kind", "on"), root));
  assert.notEqual(focusKey(scheme("kind", ""), root), focusKey(scheme("status", ""), root));
  // a field is a field, its tag apart from a button's
  assert.notEqual(focusKey(el("input", "sh-url", {}, root), root), focusKey(el("button", "sh-url", {}, root), root));
});
