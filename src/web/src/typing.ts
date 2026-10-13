// Keys typed into a field are text, not commands: the shortcuts stand aside while one has focus.

/** Whether a key event (or the focused element) is someone typing into a field. */
export function typing(t: EventTarget | Element | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.matches("input, textarea, select");
}
