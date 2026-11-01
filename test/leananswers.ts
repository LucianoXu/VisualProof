// Lean's answers about goals as it gives them, recorded from Lean's language server on the test
// fixture (test/fixture/Fixture/Basic.lean, v4.33.1): what the readers of server/goals.ts and the
// InfoView's pane (web/src/infoview.ts) are tested on.

/** Lean's interactive goals at `cases a` of test/fixture/Fixture/Basic.lean (v4.33.1), as it answers
 *  them: before the tactic, its diff marking what the tactic will change. */
export const INTERACTIVE = {
  goals: [
    {
      ctx: { p: "15" },
      goalPrefix: "⊢ ",
      hyps: [
        { fvarIds: ["_uniq.550", "_uniq.553"], isRemoved: true, names: ["a", "b"], type: { tag: [{ info: { p: "0" }, subexprPos: "/" }, { text: "Point" }] } },
        {
          fvarIds: ["_uniq.573"],
          names: ["h"],
          type: { tag: [{ info: { p: "1" }, subexprPos: "/" }, { append: [{ tag: [{ diffStatus: "willChange", info: { p: "4" }, subexprPos: "/0/1" }, { text: "a" }] }, { text: ".x = b.x" }] }] },
        },
      ],
      isInserted: false,
      mvarId: "_uniq.575",
      type: { tag: [{ info: { p: "12" }, subexprPos: "/" }, { append: [{ tag: [{ diffStatus: "willChange", info: { p: "13" }, subexprPos: "/0/1" }, { text: "a" }] }, { text: " = " }, { tag: [{ info: { p: "14" }, subexprPos: "/1" }, { text: "b" }] }] }] },
    },
  ],
};

/** Lean's interactive term goal at `Nat.le_add_right _ _` of the fixture's `size_le`. */
export const TERM = {
  ctx: { p: "156" },
  hyps: [{ fvarIds: ["_uniq.317.3"], names: ["p"], type: { tag: [{ info: { p: "150" }, subexprPos: "/" }, { text: "Point" }] } }],
  range: { end: { character: 66, line: 12 }, start: { character: 46, line: 12 } },
  term: { p: "157" },
  type: { tag: [{ info: { p: "151" }, subexprPos: "/" }, { append: [{ text: "p.x ≤ " }, { tag: [{ info: { p: "154" }, subexprPos: "/1" }, { text: "p.size" }] }] }] },
};
