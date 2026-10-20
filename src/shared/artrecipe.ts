// An artwork recipe (ExportSpec decision 20, drafted 2026-10-15 for the owner's review): what a
// picture of the board is, in words that hold on any project — a size by its name, names by a rule
// ("the clusters to depth 1, and the targets"), targets and the selection by full name — so that
// one recipe makes the same kind of picture of every codebase. An agent sends one
// (POST /api/agent/artwork, server/agentexport.ts); the link it gets back carries it after `#`, and
// the page that opens it resolves it against the board it opens on (web/src/pageart.ts, openRecipe)
// and opens the artwork mode with what it says, saving the files where the link asks.

import { ART_MAX_SIDE, ART_NAMES_BYTES, ART_RULED_BYTES, ART_STYLES, ART_TARGETS_BYTES, artNameId, cleanNames, FOOT_SIZE, SCHEMES, TITLE_CHARS, TITLE_SIZE } from "./collab.ts";
import type { ArtStyle, ArtworkLook, ColourScheme } from "./collab.ts";

/** The sizes offered (web/src/artwork.ts, PRESETS), each in either orientation: given landscape;
 *  `key`, a recipe's name for it. */
export const ART_PRESETS: readonly { key: string; name: string; w: number; h: number }[] = [
  { key: "hd", name: "HD", w: 1920, h: 1080 },
  { key: "4k", name: "4K", w: 3840, h: 2160 },
  { key: "square", name: "Square", w: 4096, h: 4096 },
  { key: "a3", name: "A3, 300 dpi", w: 4961, h: 3508 },
  { key: "a2", name: "A2, 300 dpi", w: 7016, h: 4961 },
];

/** How a click selects, as the address names it (web/src/selection.ts, TOOLS): Selection; Rests on's
 *  Uses, TCB, Keys and Direct; Used by. */
export const RECIPE_MODES = ["plain", "deps", "tcb", "keys", "refs", "apps"] as const;
export type RecipeMode = (typeof RECIPE_MODES)[number];

/** Names by a rule: from none (or from what the board writes), the clusters to a depth or by key,
 *  the targets' names, declarations by full name; and what to leave out. */
export interface RecipeNames {
  from?: "none" | "board";
  /** a depth (0: the top level), or the clusters' keys */
  clusters?: number | string[];
  /** with a depth: a cluster named only where it holds at least this share of the project's
   *  declarations (default 0.01), so that a rule does not name a hundred small circles — a project
   *  extending a library's namespaces has many small ones at the top */
  minShare?: number;
  /** the shown targets' names (default true) */
  targets?: boolean;
  decls?: string[];
  /** clusters by key, declarations by full name, left out */
  omit?: string[];
}

export interface ArtRecipe {
  size?: string | { w: number; h: number };
  orientation?: "landscape" | "portrait";
  style?: ArtStyle;
  theme?: "light" | "dark";
  transparent?: boolean;
  colouring?: ColourScheme;
  border?: boolean;
  /** null or left out: the project's own; "" for none */
  title?: string | null;
  subtitle?: string | null;
  titleSize?: number;
  footSize?: number;
  source?: boolean;
  names?: "board" | "clusters" | "none" | RecipeNames;
  /** all marked; none (drawn as any declaration); faded (they alone, the rest faded); or those named */
  targets?: "all" | "none" | "faded" | string[];
  keys?: boolean;
  notes?: boolean;
  edges?: "all" | "selection" | "none";
  /** what is selected on the board: a declaration and how (default tcb); null for nothing */
  selection?: { name: string; mode?: RecipeMode } | null;
  /** the selection and what it lights drawn (the panel's "The selection, as you see it"; default true) */
  lit?: boolean;
  /** the view it is a picture of, by id; left out, the Project */
  view?: string | null;
}

/** The most a recipe takes, in bytes of its JSON: the link carries it. */
export const RECIPE_BYTES = 6000;

const FIELDS = ["size", "orientation", "style", "theme", "transparent", "colouring", "border", "title", "subtitle", "titleSize", "footSize", "source", "names", "targets", "keys", "notes", "edges", "selection", "lit", "view"];
const NAME_FIELDS = ["from", "clusters", "minShare", "targets", "decls", "omit"];

type Read = { recipe: ArtRecipe } | { error: string; hint: string };

/** A recipe as given, checked: each field as it says, nothing unknown (a field misspelt would
 *  otherwise be a picture silently unlike the one meant). */
export function readRecipe(v: unknown): Read {
  const bad = (error: string, hint: string): Read => ({ error, hint });
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad("recipe is an object.", 'E.g. {"size": "a2", "orientation": "portrait", "names": {"clusters": 1}}.');
  if (new TextEncoder().encode(JSON.stringify(v)).length > RECIPE_BYTES) return bad(`A recipe is at most ${RECIPE_BYTES} bytes.`, "Name clusters by a depth rather than one by one.");
  const o = v as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !FIELDS.includes(k));
  if (unknown.length) return bad(`recipe has no field ${unknown.join(", ")}.`, `Its fields: ${FIELDS.join(", ")}.`);
  const r: ArtRecipe = {};
  const bool = (k: keyof ArtRecipe): string | null => {
    if (o[k] === undefined) return null;
    if (typeof o[k] !== "boolean") return `${k} is true or false.`;
    (r as Record<string, unknown>)[k] = o[k];
    return null;
  };
  const oneOf = <T extends string>(k: keyof ArtRecipe, of: readonly T[]): string | null => {
    if (o[k] === undefined) return null;
    if (!of.includes(o[k] as T)) return `${k} is ${of.join(", ")}.`;
    (r as Record<string, unknown>)[k] = o[k];
    return null;
  };
  const num = (k: "titleSize" | "footSize", least: number, most: number): string | null => {
    if (o[k] === undefined) return null;
    if (typeof o[k] !== "number" || !Number.isFinite(o[k]) || (o[k] as number) < least || (o[k] as number) > most) return `${k} is a number from ${least} to ${most} (hundredths of the picture's height).`;
    r[k] = o[k] as number;
    return null;
  };
  const text = (k: "title" | "subtitle"): string | null => {
    if (o[k] === undefined) return null;
    if (o[k] !== null && (typeof o[k] !== "string" || (o[k] as string).length > TITLE_CHARS)) return `${k} is text of at most ${TITLE_CHARS} characters, "" for none, or null for the project's own.`;
    r[k] = o[k] as string | null;
    return null;
  };
  const names = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 2000 && x.every((n) => typeof n === "string" && n.length > 0 && n.length <= 1000);
  const fault =
    bool("transparent") ?? bool("border") ?? bool("source") ?? bool("keys") ?? bool("notes") ?? bool("lit") ??
    oneOf("orientation", ["landscape", "portrait"]) ?? oneOf("style", ART_STYLES) ?? oneOf("theme", ["light", "dark"]) ??
    oneOf("colouring", SCHEMES) ?? oneOf("edges", ["all", "selection", "none"]) ??
    num("titleSize", TITLE_SIZE.least, TITLE_SIZE.most) ?? num("footSize", FOOT_SIZE.least, FOOT_SIZE.most) ?? text("title") ?? text("subtitle");
  if (fault) return bad(fault, "See GET /api/agent/docs/export, \"Artwork\".");
  if (o.size !== undefined) {
    const s = o.size;
    if (typeof s === "string") {
      if (!ART_PRESETS.some((p) => p.key === s)) return bad(`size ${s} is no size.`, `A size by name (${ART_PRESETS.map((p) => p.key).join(", ")}) or {w, h} in pixels.`);
      r.size = s;
    } else {
      const sw = (s as { w?: unknown } | null)?.w, sh = (s as { h?: unknown } | null)?.h;
      const side = (x: unknown) => Number.isInteger(x) && (x as number) >= 16 && (x as number) <= ART_MAX_SIDE;
      if (!side(sw) || !side(sh)) return bad(`size is a name or {w, h}: whole pixels from 16 to ${ART_MAX_SIDE}.`, `Names: ${ART_PRESETS.map((p) => p.key).join(", ")}.`);
      r.size = { w: sw as number, h: sh as number };
    }
  }
  if (o.names !== undefined) {
    const n = o.names;
    if (n === "board" || n === "clusters" || n === "none") r.names = n;
    else if (n && typeof n === "object" && !Array.isArray(n)) {
      const m = n as Record<string, unknown>;
      const extra = Object.keys(m).filter((k) => !NAME_FIELDS.includes(k));
      if (extra.length) return bad(`names has no field ${extra.join(", ")}.`, `Its fields: ${NAME_FIELDS.join(", ")}.`);
      const rule: RecipeNames = {};
      if (m.from !== undefined) {
        if (m.from !== "none" && m.from !== "board") return bad("names.from is none or board.", "From none: only what the rule names; from board: what the board writes, the rule's besides.");
        rule.from = m.from;
      }
      if (m.clusters !== undefined) {
        if (Number.isInteger(m.clusters) && (m.clusters as number) >= 0 && (m.clusters as number) <= 20) rule.clusters = m.clusters as number;
        else if (names(m.clusters)) rule.clusters = m.clusters;
        else return bad("names.clusters is a depth (0: the top level) or a list of clusters' keys.", "E.g. 1: the top level and the clusters right under it.");
      }
      if (m.minShare !== undefined) {
        if (typeof m.minShare !== "number" || !(m.minShare >= 0 && m.minShare <= 1)) return bad("names.minShare is a share from 0 to 1.", "0.01: a cluster below the top named where it holds at least 1% of the project's declarations.");
        rule.minShare = m.minShare;
      }
      if (m.targets !== undefined) {
        if (typeof m.targets !== "boolean") return bad("names.targets is true or false.", "The shown targets' names.");
        rule.targets = m.targets;
      }
      for (const k of ["decls", "omit"] as const) {
        if (m[k] === undefined) continue;
        if (!names(m[k])) return bad(`names.${k} is a list of names.`, k === "decls" ? "Declarations by full name." : "Clusters by key, declarations by full name.");
        rule[k] = m[k];
      }
      r.names = rule;
    } else return bad('names is "board", "clusters", "none" or a rule {from, clusters, minShare, targets, decls, omit}.', 'E.g. {"clusters": 1}: the top level and the clusters right under it, and the targets.');
  }
  if (o.targets !== undefined) {
    const t = o.targets;
    if (t === "all" || t === "none" || t === "faded") r.targets = t;
    else if (names(t)) r.targets = t;
    else return bad('targets is "all", "none", "faded" or a list of targets\' full names.', "Those named are marked, the others drawn as any declaration.");
  }
  if (o.selection !== undefined && o.selection !== null) {
    const s = o.selection as Record<string, unknown>;
    if (!s || typeof s !== "object" || typeof s.name !== "string" || !s.name || (s.mode !== undefined && !RECIPE_MODES.includes(s.mode as RecipeMode)) || Object.keys(s).some((k) => k !== "name" && k !== "mode"))
      return bad("selection is {name, mode?}: a declaration's full name, and how it is selected.", `mode: ${RECIPE_MODES.join(", ")} (default tcb).`);
    r.selection = { name: s.name, ...(s.mode !== undefined ? { mode: s.mode as RecipeMode } : {}) };
  } else if (o.selection === null) r.selection = null;
  if (o.view !== undefined && o.view !== null) {
    if (typeof o.view !== "string" || !o.view || o.view.length > 200) return bad("view is a view's id.", "GET /api/agent/views lists them; left out, the Project.");
    r.view = o.view;
  }
  return { recipe: r };
}

/** What a recipe is resolved against: the board's clusters (its layout's, in its clustering), where
 *  a declaration lies on it, the review's targets, and how many declarations the project has. */
export interface RecipeBoard {
  clusters: readonly { key: string; depth: number; parent: number; count: number; ext: boolean }[];
  /** the innermost cluster a declaration lies in on the board (-1: none); undefined where the
   *  board does not hold it */
  clusterOf(name: string): number | undefined;
  targets: readonly string[];
  projectCount: number;
}

/** A recipe resolved: the artwork's settings (to be checked as a browser's are, web/src/artwork.ts
 *  cleanSettings), what it names — written wherever it falls (`clusters`, `decls`), or by its rule,
 *  only where it covers no name already written (`ruled`) — and what it names that the board has
 *  not. */
export interface Resolved {
  look: ArtworkLook;
  named: { clusters: string[]; ruled: string[]; decls: string[] };
  /** names and targets left out: more than the artwork carries (a warning, not a problem) */
  left: number;
  problems: string[];
}

/** the outside world's cluster, as a reader may call it */
const EXTERNAL = "⟨external⟩";
const keyOf = (k: string) => (k === "External" ? EXTERNAL : k.startsWith("External.") ? EXTERNAL + k.slice(8) : k);

/** A recipe resolved against a board: everything it leaves out as a new artwork has it (4K
 *  landscape, the board's look, light, names as the board writes them, every target marked). Names
 *  are written from none: the clusters named by key, the declarations and the targets' names
 *  wherever they fall (ArtworkLook `shownNames`), as names ticked by hand are; the clusters a depth
 *  rule names — the outside world's own, and the project's down to the depth that hold `minShare`
 *  of the project — only where they cover no name already written (`ruledNames`; the owner's
 *  decision of 2026-10-15: names chosen by a rule never overlap). */
export function resolveRecipe(r: ArtRecipe, b: RecipeBoard): Resolved {
  const problems: string[] = [];
  const preset = typeof r.size === "string" ? ART_PRESETS.find((p) => p.key === r.size)! : ART_PRESETS[1];
  const given = typeof r.size === "object" ? r.size : { w: preset.w, h: preset.h };
  const portrait = r.orientation ? r.orientation === "portrait" : given.h > given.w;
  const [long, short] = given.w >= given.h ? [given.w, given.h] : [given.h, given.w];
  const { w, h } = portrait ? { w: short, h: long } : { w: long, h: short };
  // what the recipe names that the board has not is said (`problems`); what is left out for room,
  // counted (`left`); a target of the review the board has not — a target outlives its declaration's
  // rename or removal — is left out unsaid, as the board leaves it
  let left = 0;
  const targetSet = new Set(b.targets);
  const held = (n: string) => b.clusterOf(n) !== undefined;
  let targets: ArtworkLook["targets"] = "marked";
  let shownTargets: string[] = [];
  let marked: string[] = b.targets.filter(held);
  if (r.targets === "none") [targets, marked] = ["plain", []];
  else if (r.targets === "faded") targets = "highlight";
  else if (Array.isArray(r.targets)) {
    const unknown = r.targets.filter((t) => !targetSet.has(t));
    if (unknown.length) problems.push(`not targets of the review: ${unknown.join(", ")}`);
    const off = r.targets.filter((t) => targetSet.has(t) && !held(t));
    if (off.length) problems.push(`targets not on the board: ${off.join(", ")}`);
    const on = r.targets.filter((t) => targetSet.has(t) && held(t));
    shownTargets = cleanNames(on, ART_TARGETS_BYTES);
    left += new Set(on).size - shownTargets.length;
    targets = "chosen";
    marked = shownTargets;
  }
  // the names
  let labels: ArtworkLook["labels"] = "board";
  let namesFrom: ArtworkLook["namesFrom"] = "board";
  let shown: string[] = [];
  let hidden: string[] = [];
  let ruledIds: string[] = [];
  const named = { clusters: [] as string[], ruled: [] as string[], decls: [] as string[] };
  const n = r.names;
  if (n === "board" || n === "clusters" || n === "none") labels = n;
  else if (n) {
    labels = "chosen";
    namesFrom = n.from ?? "none";
    const omit = new Set((n.omit ?? []).map(keyOf));
    const byKey = new Map(b.clusters.map((c, i) => [c.key, i]));
    if (typeof n.clusters === "number") {
      const least = Math.ceil((n.minShare ?? 0.01) * b.projectCount);
      b.clusters.forEach((c) => {
        if ((c.ext ? c.depth === 0 : c.depth <= (n.clusters as number) && c.count >= least) && !omit.has(c.key)) named.ruled.push(c.key);
      });
    } else if (Array.isArray(n.clusters)) {
      for (const k of n.clusters) {
        const key = keyOf(k);
        if (!byKey.has(key)) problems.push(`no cluster ${k} on the board`);
        else if (!omit.has(key) && !named.clusters.includes(key)) named.clusters.push(key);
      }
    }
    // the targets' names (all on the board), and the declarations named
    const decls = n.targets === false ? [] : [...marked];
    for (const d of n.decls ?? []) {
      if (!held(d)) problems.push(`no declaration ${d} on the board`);
      else decls.push(d);
    }
    for (const d of decls) if (!omit.has(d) && !named.decls.includes(d)) named.decls.push(d);
    const ids = [...named.clusters.map((k) => artNameId("cluster", k)), ...named.decls.map((d) => artNameId("decl", d))];
    shown = cleanNames(ids, ART_NAMES_BYTES);
    const ruled = named.ruled.map((k) => artNameId("cluster", k));
    ruledIds = cleanNames(ruled, ART_RULED_BYTES);
    left += ids.length + ruled.length - shown.length - ruledIds.length;
    // what is named is what the artwork carries
    const kept = new Set([...shown, ...ruledIds]);
    named.clusters = named.clusters.filter((k) => kept.has(artNameId("cluster", k)));
    named.ruled = named.ruled.filter((k) => kept.has(artNameId("cluster", k)));
    named.decls = named.decls.filter((d) => kept.has(artNameId("decl", d)));
    // from the board, what to leave out is said as hidden
    if (namesFrom === "board") hidden = cleanNames([...omit].map((k) => (byKey.has(k) ? artNameId("cluster", k) : artNameId("decl", k))), ART_NAMES_BYTES);
  }
  const look: ArtworkLook = {
    w,
    h,
    scheme: r.colouring ?? "kind",
    theme: r.theme ?? "light",
    background: r.transparent ? "transparent" : "theme",
    labels,
    namesFrom,
    hiddenNames: hidden,
    shownNames: shown,
    ruledNames: ruledIds,
    edges: r.edges ?? "all",
    notes: r.notes ?? true,
    targets,
    shownTargets,
    keys: r.keys ?? true,
    selection: r.lit ?? true,
    source: r.source ?? false,
    style: r.style ?? "board",
    title: r.title ?? null,
    subtitle: r.subtitle ?? null,
    titleSize: r.titleSize ?? TITLE_SIZE.first,
    footSize: r.footSize ?? FOOT_SIZE.first,
    border: r.border ?? false,
  };
  return { look, named, left, problems };
}

/** A recipe as the link carries it after `#`: its JSON, base64url. */
export function encodeRecipe(r: ArtRecipe): string {
  const bytes = new TextEncoder().encode(JSON.stringify(r));
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A link's recipe, read back; null where it is none. */
export function decodeRecipe(text: string): unknown {
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** the address's word for the recipe, and for the files to save */
export const RECIPE_PARAM = "art";
export const SAVE_PARAM = "save";

/** A fragment's recipe and the files it asks to save; null where it carries none. */
export function recipeIn(hash: string): { text: string; save: ("png" | "svg")[] } | null {
  const p = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const text = p.get(RECIPE_PARAM);
  if (!text) return null;
  const save = (p.get(SAVE_PARAM) ?? "").split(",").filter((k): k is "png" | "svg" => k === "png" || k === "svg");
  return { text, save: [...new Set(save)] };
}
