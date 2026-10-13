// What a drag on the canvas does (CanvasSpec, "Hover, click, drag", decided 2026-10-09): it pans the
// view, by default, as a drag on empty space does; with the layout's lock let go (`l`, or the lock
// behind ⋯) a drag on a declaration, a circle or a note moves it, for everyone on the board. The drag
// key held at the press does the other way for that drag. The choice is the reader's, kept in this
// browser for every project, as the theme is: a new visitor starts with the lock on, panning.
//
// The drag key is ⌘ on a Mac and Ctrl elsewhere (the owner's decision, 2026-10-11): on a Mac,
// Ctrl+click is the secondary click, so Ctrl does nothing to drags there and a Ctrl+click stays the
// right click, the canvas's menu. Ctrl and the wheel (a trackpad's pinch) zooms on every platform.

const KEY = "visualproof:drag";

/** What the browser says of the machine it runs on, as `navigator` has it. */
export interface Platform {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/** Whether the page runs on a Mac — macOS, or iPadOS and iOS, whose keyboards have ⌘ too — by the
 *  platform the browser names (`userAgentData` where it has one), else `navigator.platform` (an iPad
 *  asking for desktop pages says MacIntel), else its user agent. */
export function onMac(nav: Platform | undefined): boolean {
  const named = nav?.userAgentData?.platform || nav?.platform;
  if (named) return /^(mac|ios|iphone|ipad|ipod)/i.test(named);
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(nav?.userAgent ?? "");
}

/** The page's platform, read once. */
export const MAC = onMac(typeof navigator === "undefined" ? undefined : (navigator as Platform));

/** The drag key as the page names it: ⌘ on a Mac, Ctrl elsewhere. */
export const dragKeyName = (mac = MAC): string => (mac ? "⌘" : "Ctrl");

/** Whether a pointer event was made with the drag key held: ⌘ alone on a Mac, Ctrl alone elsewhere
 *  (⊞ or Super is the system's there). */
export const dragKeyHeld = (e: { ctrlKey: boolean; metaKey: boolean }, mac = MAC): boolean => (mac ? e.metaKey : e.ctrlKey);

/** Whether a key, pressed or let go, is the drag key itself (KeyboardEvent.key). */
export const isDragKey = (key: string, mac = MAC): boolean => key === (mac ? "Meta" : "Control");

/** Whether a press of the main button is a Mac's Ctrl+click, its secondary click: the browser opens
 *  the canvas's menu on it (contextmenu), so let go where it was pressed it is no click of the page's
 *  — it selects, toggles and opens nothing — while dragged it is a drag as any, Ctrl doing nothing to
 *  drags there. */
export const menuClick = (e: { button: number; ctrlKey: boolean }, mac = MAC): boolean => mac && e.button === 0 && e.ctrlKey;

/** Whether a drag that starts on something moves it, rather than panning the view: the lock let go
 *  and the drag key not held, or the lock on and the drag key held. */
export function dragMoves(locked: boolean, held: boolean): boolean {
  return locked === held;
}

/** The lock as this browser keeps it: on unless the reader let it go. */
export function lockedChoice(): boolean {
  try {
    return localStorage.getItem(KEY) !== "move";
  } catch {
    // storage blocked: the default
    return true;
  }
}

/** Keep the reader's choice: the default (locked) is kept as nothing, so that a later change of
 *  the default reaches whoever never chose. */
export function setLockedChoice(locked: boolean): void {
  try {
    if (locked) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "move");
  } catch {
    // not kept: in force for this page only
  }
}
