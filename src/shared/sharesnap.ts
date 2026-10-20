// A share link that carries exactly what the sharer sees (CollabSpec decision 7, the owner's decision
// of 2026-10-12): a snapshot of the parts following carries (web/src/surfaces.ts), which the page that
// opens the link applies once, as starting to follow applies them, after which the reader is free.
//
// It travels in the address's fragment, which no server sees, after the address as a page writes it
// (web/src/state.ts): `#v=…&mode=…&sel=…&snap=<data>`. The two agree, being written from one state
// at once: a page that reads the snapshot takes the board from the address first (its query's build,
// `at=`, is in no snapshot, presence not carrying it), then everything else from the snapshot; a page
// that cannot read it opens the address as before. The access link's key and a personal link's token
// are in the path before it, and stay as they are.
//
// The snapshot is each followed part in a form of its own (`SNAPSHOT_FORMS`, one per part of the
// registry): the fields as presence carries them (shared/collab.ts, PresenceView), checked on the way
// back as the server checks a heartbeat (`cleanView`), but for two. The camera travels as the region
// of the board it showed — its centre, and the width and height shown, in the board's world — and is
// fitted into the opener's screen, so that another screen shows the same region, not the same zoom.
// The visitors leave out where they were drawn in the world, which only pages from before 2026-10-11
// read. Written as JSON, deflated where that is shorter, in base64url: `z` and the deflated bytes, or
// `j` and the JSON's.

import { cleanView } from "./collab.ts";
import type { ExportWindowView, PresenceView } from "./collab.ts";

/** the fragment's part that holds the snapshot */
export const SNAP_PARAM = "snap";
/** the most characters of a snapshot a page reads, and the most bytes it inflates to: a link is
 *  anyone's to write, and what the page is handed stays small whatever it says */
export const SNAPSHOT_MAX = 32_000;
const INFLATED_MAX = 256_000;

/** A page's canvas: its size, and the room the bars and panels leave around the board, where the
 *  camera frames what it shows (web/src/canvas.ts, `insets`). */
export interface Screen {
  w: number;
  h: number;
  insets: { left: number; right: number; top: number; bottom: number };
}

/** A region of the board: its centre, and the width and height of it shown, in the board's world. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Camera = NonNullable<PresenceView["cam"]>;

/** the camera's zoom as the canvas bounds it */
const K_MIN = 0.02, K_MAX = 12;

/** The room a screen leaves for the board: where it is and how large; the whole canvas where the
 *  panels leave none. */
function room(s: Screen): { cx: number; cy: number; w: number; h: number } {
  const w = s.w - s.insets.left - s.insets.right;
  const h = s.h - s.insets.top - s.insets.bottom;
  if (!(w > 0 && h > 0)) return { cx: s.w / 2, cy: s.h / 2, w: Math.max(1, s.w), h: Math.max(1, s.h) };
  return { cx: s.insets.left + w / 2, cy: s.insets.top + h / 2, w, h };
}

/** The region of the board camera `cam` shows on screen `s`: the room the panels leave. */
export function regionOf(cam: Camera, s: Screen): Region {
  const r = room(s);
  return { x: (r.cx - s.w / 2) / cam.k + cam.x, y: (r.cy - s.h / 2) / cam.k + cam.y, w: r.w / cam.k, h: r.h / cam.k };
}

/** The camera that shows region `g` on screen `s`: all of it, centred in the room the panels leave,
 *  as large as that room allows. */
export function camOf(g: Region, s: Screen): Camera {
  const r = room(s);
  const k = Math.min(K_MAX, Math.max(K_MIN, Math.min(r.w / g.w, r.h / g.h)));
  return { x: g.x - (r.cx - s.w / 2) / k, y: g.y - (r.cy - s.h / 2) / k, k };
}

/** A camera and a screen that show exactly region `g`: for a region given as one (an agent's link),
 *  which the camera's form writes as it is. */
export function showing(g: Region): { cam: Camera; screen: Screen } {
  return { cam: { x: g.x, y: g.y, k: 1 }, screen: { w: g.w, h: g.h, insets: { left: 0, right: 0, top: 0, bottom: 0 } } };
}

/** A region as a link writes it, `[x, y, w, h]`, read back: null where it is not one. */
export function readRegion(x: unknown): Region | null {
  if (!Array.isArray(x) || x.length !== 4 || !x.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9)) return null;
  const [cx, cy, w, h] = x as number[];
  return w > 0 && h > 0 ? { x: cx, y: cy, w, h } : null;
}

/** How a followed part is written into a snapshot and read back. */
export interface SnapForm<F extends keyof PresenceView = keyof PresenceView> {
  /** the presence fields it holds */
  readonly fields: readonly F[];
  /** its part of the snapshot's JSON, from where a page is; `screen`, its canvas, frames the camera */
  write(v: Partial<PresenceView>, screen: Screen | null): Record<string, unknown>;
  /** its fields back from a snapshot's JSON (`clean`: that JSON as a heartbeat is checked), on the
   *  screen of the page that opens the link; none of them where the snapshot says nothing of it */
  read(o: Record<string, unknown>, clean: PresenceView, screen: Screen | null): Partial<PresenceView>;
}

/** A part carried as presence carries it: each of its fields the page says, read back as the server
 *  reads a heartbeat. */
const same = <F extends keyof PresenceView>(...fields: F[]): SnapForm<F> => ({
  fields,
  write: (v) => Object.fromEntries(fields.filter((f) => v[f] !== undefined).map((f) => [f, v[f]])),
  read: (o, clean) => Object.fromEntries(fields.filter((f) => f in o && clean[f] !== undefined).map((f) => [f, clean[f]])),
});

/** The Export window with its job only where the job has an id: one the server had not named yet,
 *  or refused, is nothing the opener can read. */
function namedJob(e: ExportWindowView): ExportWindowView {
  const { job, ...rest } = e;
  return { ...rest, ...(job?.id ? { job } : {}) };
}

/** to a tenth of a unit of the board's world: a tenth of a pixel at the closest zoom but one */
const tenth = (n: number) => Math.round(n * 10) / 10;

/** The form of every followed part, by its name in the registry (web/src/surfaces.ts, which holds the
 *  two to each other): a part declared followed without one does not typecheck there, and
 *  test/sharesnap.test.ts fails. */
export const SNAPSHOT_FORMS = {
  view: same("view", "scope", "clusterMode"),
  history: same("history"),
  // the region the camera showed, fitted into the opener's screen
  camera: {
    fields: ["cam"],
    write: (v, screen) => {
      if (!v.cam || !screen) return {};
      const g = regionOf(v.cam, screen);
      return { region: [tenth(g.x), tenth(g.y), tenth(g.w), tenth(g.h)] };
    },
    read: (o, _clean, screen) => {
      const g = readRegion(o.region);
      return g && screen ? { cam: camOf(g, screen) } : {};
    },
  },
  tool: same("mode"),
  selection: same("selection"),
  focus: same("focus"),
  // each visitor's declaration, what it was reached from and its place; not where it was drawn in the
  // world, which only pages from before 2026-10-11 read
  visitors: {
    fields: ["visitors"],
    write: (v) => (v.visitors?.length ? { visitors: v.visitors.map(({ at: _at, ...rest }) => rest) } : {}),
    read: (o, clean) => ("visitors" in o && clean.visitors ? { visitors: clean.visitors } : {}),
  },
  panel: same("sel"),
  sources: same("source", "sourceCollapsed", "pinned"),
  paper: same("paper"),
  activity: same("activity"),
  lostFound: same("lostFound"),
  colouring: same("scheme"),
  edges: same("edges"),
  linear: same("linear"),
  // the Export window open, with its settings and the document it shows typeset or typesetting,
  // which the opener reads by its id from the export's cache (the owner's decision of 2026-10-20); a
  // job the server had not named yet, or refused, is no document to show, and is left out. Closed,
  // nothing: the opener's own stays as it is
  export: {
    fields: ["export"],
    write: (v) => (v.export?.open ? { export: namedJob(v.export) } : {}),
    read: (o, clean) => ("export" in o && clean.export?.open ? { export: namedJob(clean.export) } : {}),
  },
  artwork: same("artwork"),
} as const satisfies Record<string, SnapForm>;

/** What a link's snapshot says: the followed fields it holds, the camera fitted to the screen it was
 *  read for, and the region the camera showed, for fitting it again once the opener's panels are as
 *  the snapshot says (they change the room the board has). */
export interface ReadSnapshot {
  view: Partial<PresenceView>;
  region: Region | null;
}

/** The snapshot of where a page is (`v`, as presence carries it: the registry's parts, read by the
 *  page), as a link carries it after `snap=`. */
export async function writeSnapshot(v: Partial<PresenceView>, screen: Screen | null): Promise<string> {
  const o: Record<string, unknown> = {};
  for (const form of Object.values(SNAPSHOT_FORMS) as SnapForm[]) Object.assign(o, form.write(v, screen));
  const json = new TextEncoder().encode(JSON.stringify(o));
  const z = await deflate(json);
  return z && z.length < json.length ? "z" + base64url(z) : "j" + base64url(json);
}

/** A link's snapshot read back for a page on `screen`: null where it cannot be read (written by
 *  hand, cut short, too long, or deflated where this browser cannot inflate). */
export async function readSnapshot(text: string, screen: Screen | null): Promise<ReadSnapshot | null> {
  if (text.length < 2 || text.length > SNAPSHOT_MAX) return null;
  const bytes = unbase64url(text.slice(1));
  if (!bytes) return null;
  const json = text[0] === "z" ? await inflate(bytes) : text[0] === "j" ? bytes : null;
  if (!json) return null;
  let o: unknown;
  try {
    o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const raw = o as Record<string, unknown>;
  const clean = cleanView({ ...raw, cam: null, tabs: [] })!;
  const view: Partial<PresenceView> = {};
  for (const form of Object.values(SNAPSHOT_FORMS) as SnapForm[]) Object.assign(view, form.read(raw, clean, screen));
  return { view, region: readRegion(raw.region) };
}

/** The snapshot a fragment carries (`snap=`), or null. */
export function snapshotIn(hash: string): string | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  return text ? new URLSearchParams(text).get(SNAP_PARAM) : null;
}

/** A fragment (`#…`, or none) with the snapshot after the address it holds. */
export function withSnapshot(hash: string, snap: string): string {
  const text = (hash.startsWith("#") ? hash.slice(1) : hash).split("&").filter((p) => p && !p.startsWith(`${SNAP_PARAM}=`)).join("&");
  return `#${text ? text + "&" : ""}${SNAP_PARAM}=${snap}`;
}

/** The address as a page writes it (web/src/state.ts), for a link made off the page (an agent's): the
 *  view by its id, or by its query and the build it shows where nobody keeps it; the tool; the
 *  selection; and the declaration the panel tells of. */
export function addressOf(v: { view: string | null; scope: string | null; version?: number | null; mode: string; selection?: string | null; sel: string | null }): string {
  const p = new URLSearchParams();
  if (v.scope) {
    p.set("q", v.scope);
    if (typeof v.version === "number") p.set("at", String(v.version));
  } else if (v.view) p.set("v", v.view);
  p.set("mode", v.mode);
  if (v.selection) p.set("sel", v.selection);
  if (v.sel) p.set("s", v.sel);
  return p.toString();
}

/** What of a link's snapshot the page that opens it no longer has: its view, the build it browsed,
 *  declarations it names, the target it focused on, the reference window's file or its link. */
export interface Missing {
  view?: boolean;
  build?: boolean;
  decls?: string[];
  focus?: string | null;
  file?: boolean;
  link?: boolean;
}

/** A snapshot sorted out before it is applied, by what the opener's page has: a build the history no
 *  longer holds, and a file of the library or a link no longer there, are taken out — the Time
 *  Machine would open at the latest build instead, the reference window say there is no such file —
 *  and said; the reference window opens on its file at its page where only the link is gone. */
export function sortOut(v: Partial<PresenceView>, has: { build(id: number): boolean; file(sha: string): boolean; link(id: string): boolean }): { view: Partial<PresenceView>; gone: Missing } {
  const view = { ...v };
  const gone: Missing = {};
  if (view.history && !has.build(view.history.snapshot)) {
    delete view.history;
    gone.build = true;
  }
  if (view.paper && !has.file(view.paper.file)) {
    delete view.paper;
    gone.file = true;
  } else if (view.paper?.link && !has.link(view.paper.link)) {
    const { link: _gone, ...rest } = view.paper;
    view.paper = rest;
    gone.link = true;
  }
  return { view, gone };
}

/** What a snapshot names that the board's graph does not hold, once it is applied — what the panel
 *  tells of, the declarations of the selection (`picked`), the visitors, the pinned windows — and a
 *  focus on what is no target now. */
export function goneNames(v: Partial<PresenceView>, picked: readonly string[], has: { decl(name: string): boolean; target(name: string): boolean }): Pick<Missing, "decls" | "focus"> {
  const named = [v.sel, ...picked, ...(v.visitors ?? []).map((w) => w.decl), ...(v.pinned ?? []).map((w) => w.decl)];
  const decls = [...new Set(named.filter((n): n is string => !!n && !has.decl(n)))];
  return { decls, ...(typeof v.focus === "string" && !has.target(v.focus) ? { focus: v.focus } : {}) };
}

/** What could not be shown of a link's snapshot, said in one short line; null where everything was. */
export function missingLine(m: Missing): string | null {
  const short = (n: string) => n.split(".").pop() ?? n;
  const decls = [...new Set(m.decls ?? [])];
  const said = [
    m.view ? "its view" : null,
    m.build ? "its build" : null,
    decls.length ? `${decls.length === 1 ? "1 declaration" : `${decls.length} declarations`} (${decls.slice(0, 3).map(short).join(", ")}${decls.length > 3 ? ", …" : ""})` : null,
    m.focus ? `the focus ★${short(m.focus)}` : null,
    m.file ? "the reference file" : m.link ? "the link in the reference" : null,
  ].filter((x): x is string => x !== null);
  return said.length ? `Not shown from the link (no longer here): ${said.join(", ")}.` : null;
}

// ------------------------------------------------------------------ bytes

/** `bytes` deflated (raw), or null where the browser cannot. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null;
  }
}

/** `bytes` inflated, or null: where the browser cannot, where they are not deflated, or where they
 *  inflate to more than a snapshot ever holds. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > INFLATED_MAX) {
        void reader.cancel().catch(() => {});
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  } catch {
    return null;
  }
}

function base64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(t: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(t)) return null;
  try {
    const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
