// Pointers in a room (CollabSpec decision 4; the owner's decisions of 2026-10-20): a reader and those
// who follow them directly see one another's pointers and text selections — the followed reader
// their followers', the followers the followed reader's and one another's. Only direct relations
// make a room: whom a page follows, who follows it, and who follows the same reader as it.
//
// A pointer is anchored to what is under it, never to the screen: a follower's page shows what the
// followed one shows, laid out for another screen, scrolled as its reader scrolls it. So a position is
// said as what it is on — the board, in its world (the camera is followed); the linear form, by its
// row; a source window's text, by its declaration, a line and a column; the reference window, by its
// page and where on it; an element of a followed surface (the panels, Activity, the review strip, the
// Export window), by the steps down to it from the surface and where in it — and each page finds it
// again on its own layout. A text selection is two such points in text.
//
// What a page sends (POST /api/pointer) and what the others in its room are told (`pointer`) are this
// module's, checked here as the server checks every field: a page sends only while it is in a room,
// at most every LEAD_MS (followed) or FOLLOW_MS (following); the server relays at most RELAY_PER_S a
// second per page, within the room alone, and keeps nothing. A private or read-only reader's pointer
// is never sent on, nor an agent's (it has none); a private or read-only follower is sent the
// others'. Each page draws at most SHOWN others' pointers, fading FADE_MS after they stop.

/** a followed reader's page sends its pointer at most this often (ms): some 16 a second */
export const LEAD_MS = 60;
/** a follower's, at most this often: some 10 a second */
export const FOLLOW_MS = 100;
/** the most a page's pointer is relayed in a second; more are dropped */
export const RELAY_PER_S = 25;
/** the most others' pointers a page shows at once: the latest to move */
export const SHOWN = 5;
/** a pointer still for this long fades */
export const FADE_MS = 2000;
/** the most bytes a pointer's request holds */
export const BODY_MAX = 4096;
/** the most steps from a surface down to an element, and the most characters of an attribute's value */
export const STEPS_MAX = 16;
const VALUE_MAX = 160;

/** A step down from an element to one of its children: by an attribute that says what the child is —
 *  its `id`, a `data-` attribute and its value (null for one that is a flag), or a class it has — or,
 *  without one, by its place among its siblings (`nth`, which is said anyway, for an attribute that
 *  several have). */
export type Step = [attr: string | null, value: string | null, nth: number];

/** Where an element's steps start: a surface of the page by its id; a source window, by the
 *  declaration it shows; the reference window. */
export type Root = { id: string } | { sw: string } | { pw: true };

/** Where a pointer is, as any page finds it again. */
export type PointerAt =
  /** on the board: a point of its world */
  | { b: [number, number] }
  /** on the linear form: a row by its key, how far down it (0–1), how far right of the line (in the
   *  outline's units) */
  | { l: [string, number, number] }
  /** on a source window's code: its declaration, a line of what it shows (from 0) and a column */
  | { sw: string; lc: [number, number] }
  /** on the reference window: a page (from 1; 0 for an image) and where on it (0–1 across, down) */
  | { pw: [number, number, number] }
  /** on an element of a followed surface: the steps down to it, and where in it (0–1 across, down) */
  | { in: Root; p: Step[]; f: [number, number] };

/** A point in text: a source window's line and column, or a character of an element's text. */
export type TextAt = { sw: string; lc: [number, number] } | { in: Root; p: Step[]; o: number };

/** A text selection: from one point to another. */
export interface SelAt {
  a: TextAt;
  b: TextAt;
}

/** What a page sends (POST /api/pointer): its stream's secret, where its pointer is (null: off
 *  every followed surface, or off the page), what text it has selected, and whether it was a click;
 *  a read-only page says whom it follows instead, so as to be sent the pointers of its room. */
export interface PointerBody {
  token: string;
  at?: PointerAt | null;
  sel?: SelAt | null;
  click?: true;
  following?: string | null;
}

/** What a page in the room is told (`pointer`): whose pointer, by their page's public id. */
export interface PointerNews {
  from: string;
  at: PointerAt | null;
  sel: SelAt | null;
  click?: true;
}

const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
const frac = (x: unknown): number | null => num(x, -0.5, 1.5);
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f]/.test(x) ? x : null);

function cleanStep(x: unknown): Step | null {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const [a, v, n] = x as unknown[];
  const nth = Number.isInteger(n) && (n as number) >= 0 && (n as number) < 5000 ? (n as number) : null;
  if (nth === null) return null;
  if (a === null) return v === null ? [null, null, nth] : null;
  if (typeof a !== "string" || !/^(?:id|class|data-[a-z0-9-]{1,40})$/.test(a)) return null;
  if (a === "class" && !(typeof v === "string" && /^[\w-]{1,60}$/.test(v))) return null;
  if (v === null) return [a, null, nth];
  const value = typeof v === "string" && v.length <= VALUE_MAX && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
  return value === null ? null : [a, value, nth];
}

function cleanSteps(x: unknown): Step[] | null {
  if (!Array.isArray(x) || x.length > STEPS_MAX) return null;
  const out = x.map(cleanStep);
  return out.every((s) => s !== null) ? (out as Step[]) : null;
}

function cleanRoot(x: unknown): Root | null {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
  if (!o) return null;
  if (typeof o.id === "string") return /^[A-Za-z][\w-]{0,60}$/.test(o.id) ? { id: o.id } : null;
  if (o.sw !== undefined) return str(o.sw, 2000) ? { sw: o.sw as string } : null;
  return o.pw === true ? { pw: true } : null;
}

const lineCol = (x: unknown): [number, number] | null => {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [l, c] = x as unknown[];
  return Number.isInteger(l) && Number.isInteger(c) && (l as number) >= 0 && (c as number) >= 0 && (l as number) < 1e6 && (c as number) < 1e5 ? [l as number, c as number] : null;
};

/** A pointer's place as a page sent it, checked; null where it is none. */
export function cleanAt(x: unknown): PointerAt | null {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  if (!o) return null;
  if (Array.isArray(o.b)) {
    const [bx, by] = o.b as unknown[];
    const px = num(bx, -1e9, 1e9), py = num(by, -1e9, 1e9);
    return o.b.length === 2 && px !== null && py !== null ? { b: [px, py] } : null;
  }
  if (Array.isArray(o.l)) {
    const [k, fy, dx] = o.l as unknown[];
    const key = str(k, 2000), y = frac(fy), d = num(dx, -1e6, 1e6);
    return o.l.length === 3 && key && y !== null && d !== null ? { l: [key, y, d] } : null;
  }
  if (o.sw !== undefined && o.lc !== undefined) {
    const sw = str(o.sw, 2000), lc = lineCol(o.lc);
    return sw && lc ? { sw, lc } : null;
  }
  if (Array.isArray(o.pw)) {
    const [p, fx, fy] = o.pw as unknown[];
    const page = Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 100000 ? (p as number) : null;
    const x2 = frac(fx), y2 = frac(fy);
    return o.pw.length === 3 && page !== null && x2 !== null && y2 !== null ? { pw: [page, x2, y2] } : null;
  }
  if (o.in !== undefined) {
    const root = cleanRoot(o.in), p = cleanSteps(o.p);
    const f = Array.isArray(o.f) && o.f.length === 2 ? [frac(o.f[0]), frac(o.f[1])] : null;
    return root && p && f && f[0] !== null && f[1] !== null ? { in: root, p, f: [f[0], f[1]] } : null;
  }
  return null;
}

/** A point in text as a page sent it, checked; null where it is none. */
export function cleanText(x: unknown): TextAt | null {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  if (!o) return null;
  if (o.sw !== undefined && o.lc !== undefined) {
    const sw = str(o.sw, 2000), lc = lineCol(o.lc);
    return sw && lc ? { sw, lc } : null;
  }
  const root = cleanRoot(o.in), p = cleanSteps(o.p);
  const at = Number.isInteger(o.o) && (o.o as number) >= 0 && (o.o as number) < 1e7 ? (o.o as number) : null;
  return root && p && at !== null ? { in: root, p, o: at } : null;
}

/** A selection as a page sent it, checked; null where it is none. */
export function cleanSel(x: unknown): SelAt | null {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  const a = o ? cleanText(o.a) : null, b = o ? cleanText(o.b) : null;
  return a && b ? { a, b } : null;
}

/** What a page sent, checked: what is malformed is none. */
export function cleanPointer(x: unknown): Omit<PointerNews, "from"> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  return { at: cleanAt(o.at), sel: cleanSel(o.sel), ...(o.click === true ? { click: true as const } : {}) };
}

/** A page as its room is worked out: its public id; the person it is, as the people are told apart
 *  (shared/collab.ts personKey) — null for a page nobody sees (private, read-only, not yet listed);
 *  whom it follows; and whether its pointer is shown to anyone (a listed page's). */
export interface RoomPage {
  id: string;
  key: string | null;
  follows: string | null;
}

/** Whether `other` is in `page`'s room (the owner's decision of 2026-10-20): the reader `page`
 *  follows, someone following `page`, or someone following the reader `page` follows — direct
 *  relations alone, never another page of the same person. */
export function inRoom(page: RoomPage, other: RoomPage): boolean {
  if (other.id === page.id || (page.key !== null && other.key === page.key)) return false;
  if (page.follows !== null && other.key === page.follows) return true;
  if (page.key !== null && other.follows === page.key) return true;
  return page.follows !== null && other.follows === page.follows;
}

/** The pages `from`'s pointer is relayed to: those of its room. A page nobody sees has its pointer
 *  shown to nobody. */
export function roomOf(from: RoomPage, pages: readonly RoomPage[]): string[] {
  if (from.key === null) return [];
  return pages.filter((p) => inRoom(from, p)).map((p) => p.id);
}
