// Typing through an input method (Chinese, Japanese, Korean…): the keys a reader presses build a
// composition, and Enter commits it — the letters or the characters it holds go into the field as
// they are. That Enter is never the field's own (send a message, choose a result, save a note): the
// owner's report of 2026-10-11, in Safari, where a Chinese input method's Enter sent the whole
// message. Chrome and Firefox mark that keydown `isComposing`; Safari ends the composition first
// (compositionend), then sends a keydown with `isComposing` false and keyCode 229, or, in some
// versions, 13 — so a composition that ended a moment ago counts too.

/** how long after a composition ended its Enter may still come, in milliseconds */
const AFTER_MS = 80;

let composingNow = false;
let endedAt = -Infinity;

/** A composition began or ended on the page (the listeners below; tests call it themselves). */
export function noteComposition(active: boolean, at: number = performance.now()): void {
  composingNow = active;
  if (!active) endedAt = at;
}

if (typeof document !== "undefined") {
  document.addEventListener("compositionstart", () => noteComposition(true), true);
  document.addEventListener("compositionend", () => noteComposition(false), true);
}

/** Whether key event `e` belongs to an input method's composition, and so is not the field's own:
 *  marked so, keyCode 229 (Safari), during a composition, or just after one ended. */
export function composing(e: { isComposing?: boolean; keyCode?: number }, at: number = performance.now()): boolean {
  return !!e.isComposing || e.keyCode === 229 || composingNow || at - endedAt < AFTER_MS;
}
