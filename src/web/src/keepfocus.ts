// The keyboard's place kept while a part of the page is drawn again, and inside a modal window. A list drawn anew from its HTML
// (the targets, the board's tree, the legend, Share) replaces the element that had the focus: the
// focus would fall back to the page's start, and a reader at the keyboard would have to come all the
// way back after each press. What had it is found again in what is drawn by what it is — its tag, its
// data attributes or its first class, and the data attributes of what holds it — and focused there.

/** An element as `focusKey` reads it (in the tests, a stand-in). */
export interface KeyedEl {
  readonly tagName: string;
  readonly className: string;
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly parentElement: KeyedEl | null;
}

/** Its data attributes, in a line. */
function dataOf(el: KeyedEl): string {
  const out: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name.startsWith("data-")) out.push(`${a.name}=${a.value}`);
  }
  return out.sort().join(" ");
}

/** What `el` is inside `root`, the same for its like drawn again: its tag and its data attributes,
 *  or, with none, its first class (the others say its state: on, folded); and the data attributes of
 *  each element holding it below `root` that has some (the row a button is on). */
export function focusKey(el: KeyedEl, root: KeyedEl): string {
  const data = dataOf(el);
  const own = `${el.tagName.toLowerCase()}${data ? `[${data}]` : `.${el.className.trim().split(/\s+/)[0] ?? ""}`}`;
  const up: string[] = [];
  for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
    const d = dataOf(e);
    if (d) up.push(d);
  }
  return [own, ...up].join(" < ");
}

/** Draw `root` again with `draw`, the focus kept: what had it inside `root`, where it is gone, is
 *  found again by its key, else `fallback` (a selector inside `root`) takes it. Nothing is focused
 *  where the focus was elsewhere. */
export function keepFocus(root: HTMLElement, draw: () => void, fallback?: string): void {
  const back = holdFocus(root, fallback);
  draw();
  back();
}

/** `keepFocus` in two halves, for a long drawing: what has the focus in `root` now, and the function
 *  that focuses it again once `root` is drawn. */
export function holdFocus(root: HTMLElement, fallback?: string): () => void {
  // drawn without a browser (the tests): no focus to keep
  if (typeof document === "undefined") return () => {};
  const a = document.activeElement;
  const had = a instanceof HTMLElement && a !== root && root.contains(a) ? a : null;
  const key = had ? focusKey(had, root) : null;
  return () => {
    if (!had || root.contains(had)) return;
    const like = [...root.querySelectorAll<HTMLElement>(had.tagName)].find((e) => focusKey(e, root) === key) ?? (fallback ? root.querySelector<HTMLElement>(fallback) : null);
    like?.focus({ preventScroll: true });
  };
}

/** A popover or a window closing with the focus in it (Esc, its own Close): the focus goes back to
 *  `to`, its button, not to the page's start. Elsewhere (a press outside it) the focus is left be. */
export function focusBack(from: HTMLElement, to: HTMLElement, orBody = false): void {
  if (typeof document === "undefined") return;
  const a = document.activeElement;
  if (from.contains(a) || (orBody && a === document.body)) to.focus();
}

/** What the keyboard can reach in `root`, in its order: its controls on show, not disabled. */
export function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, video[controls], [tabindex]")].filter(
    (c) => c.tabIndex >= 0 && !c.matches(":disabled") && (typeof c.checkVisibility !== "function" || c.checkVisibility()),
  );
}

/** Tab in a modal window `root` (the help's sheet, Export): round what is in it, from its last
 *  control to its first and back, never to the page behind it. */
export function trapTab(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const all = tabbable(root);
  if (!all.length) return;
  const first = all[0], last = all[all.length - 1];
  const a = document.activeElement;
  const out = !root.contains(a);
  if (out || (e.shiftKey ? a === first || a === root : a === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}
