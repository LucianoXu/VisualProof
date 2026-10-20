// Light, dark, or as the system is: the reader's choice, kept for every project in this browser;
// light unless they chose otherwise, on every platform (the owner's decision of 2026-10-14). The
// page's colours follow `data-theme` on <html> (style.css); a script in index.html's <head> sets it
// before the first paint, from the same stored choice, so a dark page never flashes light.
//
// What draws in the theme's colours itself — the board's canvas, the linear form — reads them from
// the page's custom properties as it draws, and keeps what it drew: it draws again when the theme on
// show changes (onThemeChange), whoever changed it, in either direction.
//
// The system's other preference the page follows is reduced motion (reducedMotion): nothing on the
// page glides then — style.css's one rule for its transitions and animations, and here for what
// moves by itself (the board's camera, the linear form coming and going).

export type ThemeChoice = "light" | "dark" | "system";
export type ThemeShown = "light" | "dark";

const KEY = "visualproof:theme";
// none without a browser: the artwork command reads the board's module, which reads this one
const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
/** the theme something holds on show over the reader's choice (holdTheme), or none */
let held: ThemeShown | null = null;

/** Whether the system asks for reduced motion: what would glide is where it goes at once (GuideSpec
 *  decision 4; the camera, web/src/canvas.ts animate; the linear form, web/src/linear.ts). Read as
 *  it is asked, so that a change of the setting holds from the next motion. */
export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "system") return v;
  } catch {
    // storage blocked: the default
  }
  return "light";
}

/** Put the choice in force: what <html> says, now and (for "system") whenever the system changes;
 *  while a theme is held (holdTheme), that one. */
export function applyTheme(choice: ThemeChoice = themeChoice()): void {
  const t = held ?? (choice === "system" ? (dark?.matches ? "dark" : "light") : choice);
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}

/** Show `t` whatever the reader chose, until it is let go (null): the artwork mode's theme (web/src/
 *  pageart.ts, drawLook), which a change of the system's, followed by "As the system", must not undo
 *  while the mode is on. Let go, the reader's choice is in force again. */
export function holdTheme(t: ThemeShown | null): void {
  held = t;
  applyTheme();
}

const followers: (() => void)[] = [];
let watching: MutationObserver | null = null;
let shown: string | undefined;

/** Call `f` whenever the theme on show changes, light to dark or back: by the reader's choice, the
 *  system's while it is followed, an artwork's look. It is read from <html> itself, so that no way of
 *  changing it is missed; setting it to what it is already is no change. */
export function onThemeChange(f: () => void): void {
  followers.push(f);
  if (watching || typeof MutationObserver === "undefined") return;
  shown = document.documentElement.dataset.theme;
  watching = new MutationObserver(() => {
    const now = document.documentElement.dataset.theme;
    if (now === shown) return;
    shown = now;
    for (const g of followers) g();
  });
  watching.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export function setTheme(choice: ThemeChoice): void {
  try {
    // the default is kept as nothing, so that a later change of the default reaches whoever never chose
    if (choice === "light") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // not kept: in force for this page only
  }
  applyTheme(choice);
}

dark?.addEventListener("change", () => {
  if (themeChoice() === "system") applyTheme("system");
});

const ICONS: Record<ThemeChoice, string> = {
  light: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>`,
  dark: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z"/></svg>`,
  system: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M6 14h4M8 11.5V14"/></svg>`,
};
const LABELS: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "As the system" };

/** The theme's three choices side by side, in the eyes' ⋯ menu at the bottom right (since
 *  2026-10-08; a switch of its own under the zoom buttons before). */
export function themeChoices(el: HTMLElement): void {
  const render = () => {
    const c = themeChoice();
    el.innerHTML = (["light", "dark", "system"] as ThemeChoice[])
      .map((k) => `<button data-theme-choice="${k}" class="${k === c ? "on" : ""}" role="radio" aria-checked="${k === c}" title="${LABELS[k]}" aria-label="${LABELS[k]}">${ICONS[k]}</button>`)
      .join("");
  };
  render();
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-theme-choice]");
    if (!b) return;
    setTheme(b.dataset.themeChoice as ThemeChoice);
    render();
  });
}
