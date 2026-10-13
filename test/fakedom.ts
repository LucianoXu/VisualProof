// Just enough of a browser for a floating window (web/src/floatwin.ts) to be driven without one: an
// element with a style, classes, children and listeners; a viewport; a ResizeObserver the test
// fires itself. An element's size is its own (`content`) while its width is `max-content`, within
// its least and most, as CSS would make it; else the size its style sets.

type Listener = (e: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  target: FakeEl;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  isPrimary?: boolean;
  pointerType?: string;
  button?: number;
  preventDefault(): void;
}

const px = (v: string | undefined) => (v && v.endsWith("px") ? parseFloat(v) : null);

export class FakeEl {
  tag: string;
  className: string;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  /** the size its content gives it */
  content = { w: 0, h: 0 };
  private listeners = new Map<string, Listener[]>();
  private captured = new Set<number>();

  constructor(tag = "div", className = "") {
    this.tag = tag;
    this.className = className;
  }

  classList = {
    add: (...cs: string[]) => cs.forEach((c) => this.setClass(c, true)),
    remove: (...cs: string[]) => cs.forEach((c) => this.setClass(c, false)),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classes().includes(c);
      this.setClass(c, want);
      return want;
    },
    contains: (c: string) => this.classes().includes(c),
  };

  private classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }

  private setClass(c: string, on: boolean): void {
    const cs = this.classes().filter((x) => x !== c);
    this.className = (on ? [...cs, c] : cs).join(" ");
  }

  append(...els: FakeEl[]): void {
    for (const e of els) {
      e.parent = this;
      this.children.push(e);
    }
  }

  setAttribute(): void {}

  addEventListener(type: string, f: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }

  removeEventListener(type: string, f: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((g) => g !== f));
  }

  /** An event at this element, bubbling up to the window it is in. */
  dispatch(e: Omit<FakeEvent, "target" | "preventDefault"> & Partial<FakeEvent>): void {
    const ev: FakeEvent = { preventDefault() {}, ...e, target: e.target ?? this };
    for (let at: FakeEl | null = this; at; at = at.parent) for (const f of at.listeners.get(ev.type) ?? []) f(ev);
  }

  /** whether it is this simple selector: a tag, `.class` or `[data-key]` */
  private is(sel: string): boolean {
    if (sel.startsWith(".")) return this.classes().includes(sel.slice(1));
    const data = /^\[data-([a-z-]+)\]$/.exec(sel);
    if (data) return data[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) in this.dataset;
    return this.tag === sel;
  }

  closest(sels: string): FakeEl | null {
    const each = sels.split(",").map((s) => s.trim());
    for (let at: FakeEl | null = this; at; at = at.parent) if (each.some((s) => at!.is(s))) return at;
    return null;
  }

  contains(o: unknown): boolean {
    for (let at = o instanceof FakeEl ? o : null; at; at = at.parent) if (at === this) return true;
    return false;
  }

  querySelector(sel: string): FakeEl | null {
    for (const c of this.children) {
      if (c.closest(sel) === c) return c;
      const inner = c.querySelector(sel);
      if (inner) return inner;
    }
    return null;
  }

  /** a child resize handle of the window, by its edges (floatwin.ts makes them) */
  edge(edges: string): FakeEl {
    const h = this.children.find((c) => c.dataset.rz === edges);
    if (!h) throw new Error(`no handle ${edges}`);
    return h;
  }

  get offsetWidth(): number {
    const set = px(this.style.width);
    if (set !== null && this.style.width !== "max-content") return set;
    return Math.min(Math.max(this.content.w, px(this.style.minWidth) ?? 0), px(this.style.maxWidth) ?? Infinity);
  }

  get offsetHeight(): number {
    const set = px(this.style.height);
    if (set !== null) return set;
    return Math.min(Math.max(this.content.h, px(this.style.minHeight) ?? 0), px(this.style.maxHeight) ?? Infinity);
  }

  setPointerCapture(id: number): void {
    this.captured.add(id);
  }

  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }

  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }

  focus(): void {}
}

/** The ResizeObservers made, so that a test tells them the content changed size. */
export const observers: { fire(): void }[] = [];

/** A page of `vp`'s size around the floating windows: `document`, `window` and `ResizeObserver` as
 *  floatwin.ts uses them. Returns a function that changes the viewport's size. */
export function fakePage(vp: { w: number; h: number }): (to: { w: number; h: number }) => void {
  const size = { ...vp };
  const winListeners = new Map<string, (() => void)[]>();
  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => new FakeEl(tag),
    documentElement: {
      get clientWidth() {
        return size.w;
      },
      get clientHeight() {
        return size.h;
      },
    },
    activeElement: null,
  };
  g.window = {
    addEventListener: (t: string, f: () => void) => winListeners.set(t, [...(winListeners.get(t) ?? []), f]),
    removeEventListener: (t: string, f: () => void) => winListeners.set(t, (winListeners.get(t) ?? []).filter((x) => x !== f)),
  };
  g.ResizeObserver = class {
    private f: () => void;
    constructor(f: () => void) {
      this.f = f;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
    fire() {
      this.f();
    }
  };
  return (to) => {
    Object.assign(size, to);
    for (const f of winListeners.get("resize") ?? []) f();
  };
}

/** A press on `at`, dragged by (dx, dy) and let go: the pointer as floatwin.ts follows it. */
export function drag(at: FakeEl, dx: number, dy: number): void {
  const base = { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
  at.dispatch({ ...base, type: "pointerdown", clientX: 500, clientY: 300 });
  at.dispatch({ ...base, type: "pointermove", clientX: 500 + dx, clientY: 300 + dy });
  at.dispatch({ ...base, type: "pointerup", clientX: 500 + dx, clientY: 300 + dy });
}
