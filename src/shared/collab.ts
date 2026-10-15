// What the server and the page share about the people on a server (CollabSpec.md): names, the
// colour each name has, and what a reader tells the others about where they are.

/** the most characters a name may have */
export const MAX_NAME = 60;

/** A name someone can be known by: 1–60 characters, no line breaks or other control characters. */
export function validName(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= MAX_NAME && t === s && !/[\u0000-\u001f\u007f]/.test(t);
}

/** `s` within `room` characters (counted as validName counts them): itself, or cut short with "…",
 *  never inside a character. */
export function cutShort(s: string, room: number): string {
  if (s.length <= room) return s;
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > room - 1) break;
    out += ch;
  }
  return out + "…";
}

/** The name Share gives an agent unless its person writes another (AgentSpec decision 7): "Alice's
 *  AI", within the characters a name may have — a long name is cut short. */
export function defaultAgentName(by: string): string {
  return `${cutShort(by.trim(), MAX_NAME - "'s AI".length)}'s AI`;
}

/** An agent's name told apart from the names `taken` (the tokens in force), whatever the case: the
 *  name itself, else numbered — "Alice's AI 2", "Alice's AI 3" — within the characters a name may
 *  have, the name cut short to make room for the number. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const seen = new Set([...taken].map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const s = n === 1 ? name : `${cutShort(name, MAX_NAME - ` ${n}`.length)} ${n}`;
    if (!seen.has(s.toLowerCase())) return s;
  }
}

/** Whether two names are the same name to a reader: whatever the case, and however Unicode writes
 *  the same letters. A guest cannot take a name someone invited by a personal link holds in this
 *  sense (CollabSpec decision 9), so that "alice" does not pass for "Alice". */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.trim().normalize("NFKC").toLowerCase();
  return key(a) === key(b);
}

/** Someone invited by a personal link (CollabSpec decision 9, server/invites.ts), as Share lists
 *  them: never the link itself, which is shown once, to whoever made it. */
export interface PersonInvite {
  /** who they are: the link's id, part of the link, no secret */
  id: string;
  /** the name they go by now */
  name: string;
  /** every name they went by, from the one they were invited under, with when they took it */
  names: { name: string; at: string }[];
  /** who made the link, and when */
  by: string;
  created: string;
  revoked: string | null;
  revokedBy: string | null;
  lastUsed: string | null;
}

/** A read-only link (CollabSpec decision 11, server/readonly.ts), as Share lists it: unlike a
 *  personal link's, the link itself is kept, to be shown again. */
export interface ReadOnlyLink {
  id: string;
  /** the link's address on the server, `/r/<token>` */
  path: string;
  /** who made it: a name, or null for someone who gave none */
  by: string | null;
  created: string;
  revoked: string | null;
  revokedBy: string | null;
  lastUsed: string | null;
}

/** What every page is told of the people invited by a personal link (`people`), so that what one
 *  of them did shows under the name they go by now, with its mark: their id, that name, the ones
 *  they had before, and whether their link was revoked. */
export interface Invited {
  id: string;
  name: string;
  was: string[];
  revoked?: true;
}

/** Up to two letters for a name's round badge: the first letters of its first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  const first = (w: string) => [...w][0] ?? "";
  return ((words.length > 1 ? first(words[0]) + first(words[1]) : [...name.trim()].slice(0, 2).join("")) || "?").toUpperCase();
}

/** A person's colour, fixed by their name: the same on every page and every server. */
export function colorOf(name: string): string {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  // hues spread around the wheel, saturated and dark enough to read white initials on
  const hue = ((h >>> 0) % 360 + 360) % 360;
  return `hsl(${hue} 62% 46%)`;
}

/** the most source windows a reader pins at once (web/src/sources.ts): a few declarations side by
 *  side, not a wall of them */
export const MAX_PINNED = 6;

/** A source window a reader pinned (ReviewSpec, "The source window"): the declaration it stays on,
 *  by name, and whether it is collapsed to its pill. */
export interface PinnedWindow {
  decl: string;
  collapsed: boolean;
}

/** Where a reader is: what the others see of them, and what following them restores. */
export interface PresenceView {
  /** the tool, how a click selects (the Mode buttons: plain; the steps of Rests on, deps, tcb, keys;
   *  apps) */
  mode: string;
  /** the name of the declaration the reader's panel tells of */
  sel: string | null;
  /** what the reader selected, as a query's text (web/src/selection.ts): a follower selects the
   *  same; absent from a page or an agent that does not say */
  selection?: string | null;
  /** the source window that follows the selection is open on it */
  source: boolean;
  /** that window is collapsed to its pill; absent when it is not, or closed */
  sourceCollapsed?: boolean;
  /** the source windows the reader pinned, the first pinned first (decided 2026-10-09: a follower's
   *  windows mirror them too); absent when there are none, or from an agent, which pins none */
  pinned?: PinnedWindow[];
  /** the board's clustering */
  clusterMode: string;
  cam: { x: number; y: number; k: number } | null;
  /** the view the reader is on (ViewSpec.md), by its id; null for the Project */
  view: string | null;
  /** that view's scope as text, when it is not kept: a follower opens the same query */
  scope: string | null;
  /** the views the reader has open (their tabs): a view nobody keeps lives while one is */
  tabs: string[];
  /** in the Time Machine (HistorySpec decision 18): the snapshot the reader browses, on their view;
   *  a follower opens the same */
  history?: { snapshot: number };
  /** the reader's own focus on their view (ViewSpec decision 28): a target, or null for none; absent,
   *  the view's own. A follower takes it */
  focus?: string | null;
  /** the reader's visitors on their view (ViewSpec decision 27; web/src/visitors.ts), oldest first:
   *  declarations it does not hold that they went to, each with what it was reached from, its place
   *  (`in`, the key of the board's cluster the outermost of what it brings stands in, "" for the top
   *  level, and `spot`, where in that cluster's coordinates; since 2026-10-11) and where it is drawn in
   *  the board's world (`at`, which pages of before read). A follower draws them; nobody else sees them */
  visitors?: { decl: string; at?: [number, number]; from?: string; in?: string; spot?: [number, number] }[];
  /** the reference window (AttachmentSpec decision 11): the file it shows, by hash, at which page, the
   *  link it was opened on, and whether it is collapsed; absent where it is closed. A follower's
   *  shows the same */
  paper?: PaperWindow;
  // What the panels and the board show besides (CollabSpec decision 4, the owner's decision of
  // 2026-10-11: what you see is followed). A page from before that day, and an agent, say none of
  // them: whoever follows it keeps their own.
  /** Activity (CollabSpec decision 5): open or closed, and its filters */
  activity?: ActivityView;
  /** the lost-and-found (HistorySpec decisions 12–14): open or closed */
  lostFound?: { open: boolean };
  /** the colouring the board is drawn in: the legend's Kind or Status (CanvasSpec, "Colour schemes") */
  scheme?: ColourScheme;
  /** the edges drawn (CanvasSpec, "Edges"); proof edges, said until 2026-10-15, are no more */
  edges?: boolean;
  /** the board drawn as its document's outline (ExportSpec decision 18, web/src/linear.ts) */
  linear?: boolean;
  /** the artwork mode (ExportSpec decision 19): its settings, the board drawn with them, and what its
   *  frame holds; null where it is off */
  artwork?: ArtworkView | null;
}

/** An artwork's settings (ExportSpec decision 19, web/src/artwork.ts): the picture's size in pixels,
 *  and its look. */
export interface ArtworkLook {
  w: number;
  h: number;
  scheme: ColourScheme;
  /** the theme's colours, on its background or on none (a transparent picture, light for a light
   *  page, dark for a dark one) */
  theme: "light" | "dark";
  background: "theme" | "transparent";
  /** names as the board writes them (a lit declaration's where the board would give it a card); the
   *  clusters' and the targets' alone; none; or by selection: from As shown or from none
   *  (`namesFrom`), those the reader hid left out and those they showed written, each wherever it
   *  falls (the owner's decision of 2026-10-15) */
  labels: "board" | "clusters" | "none" | "chosen";
  namesFrom: "board" | "none";
  /** by selection, the names hidden and the names shown besides, each by what it names (artNameId): a
   *  cluster by its key, a declaration by its full name; each list within what presence carries
   *  (ART_NAMES_BYTES) */
  hiddenNames: string[];
  shownNames: string[];
  /** by selection, names a recipe's rule chose (ExportSpec decision 20; the owner's decision of
   *  2026-10-15): written after those shown, each only where it covers no name already written —
   *  never one over another; within ART_RULED_BYTES */
  ruledNames: string[];
  edges: "all" | "selection" | "none";
  notes: boolean;
  /** a target's star and name marked; drawn as any declaration; it alone, the rest faded; or those
   *  chosen (`shownTargets`) marked, the others drawn as any declaration */
  targets: "marked" | "plain" | "highlight" | "chosen";
  /** the targets chosen, by full name; within what presence carries (ART_TARGETS_BYTES) */
  shownTargets: string[];
  /** the key declarations' diamonds, a switch of their own (the owner's decision of 2026-10-15); with
   *  the targets chosen, those of the targets chosen */
  keys: boolean;
  /** the selection and what is lit drawn as the reader sees them */
  selection: boolean;
  /** the project's git source and the commit it was read from, at the bottom right */
  source: boolean;
  /** how it is drawn (the owner's decisions of 2026-10-15): as the board; as cells, each namespace a
   *  glowing territory on a dark ground; as a starfield, each declaration a star and each cluster a
   *  constellation */
  style: ArtStyle;
  /** the title at the top left and the line under it: the project's name and what it holds where
   *  null, the reader's words where given ("" for none); the title's size, in hundredths of the
   *  picture's height */
  title: string | null;
  subtitle: string | null;
  titleSize: number;
  /** the foot's size — "Generated by VisualProof" and the source's line alike —, in hundredths of
   *  the picture's height */
  footSize: number;
  /** a thin line round the whole picture, a little within its edge */
  border: boolean;
}

/** An artwork's ways of being drawn (ArtworkLook `style`). */
export const ART_STYLES = ["board", "cells", "stars"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];
/** the title's size, in hundredths of the picture's height: the least, the most, the first */
export const TITLE_SIZE = { least: 3, most: 16, first: 7 } as const;
/** the foot's size, in hundredths of the picture's height: the least, the most, the first */
export const FOOT_SIZE = { least: 0.8, most: 4, first: 1.6 } as const;
/** the most characters a title, or the line under it, has */
export const TITLE_CHARS = 120;

/** An artwork's title or its line as given: the reader's words, at most so long, or null (the
 *  project's own). */
export function cleanTitle(v: unknown): string | null {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, TITLE_CHARS) : null;
}

/** An artwork's title size as given, within its bounds; the first where it is none. */
export function cleanTitleSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(TITLE_SIZE.most, Math.max(TITLE_SIZE.least, Math.round(v * 2) / 2)) : TITLE_SIZE.first;
}

/** An artwork's foot size as given, within its bounds, to a tenth; the first where it is none. */
export function cleanFootSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(FOOT_SIZE.most, Math.max(FOOT_SIZE.least, Math.round(v * 10) / 10)) : FOOT_SIZE.first;
}

/** What a name of an artwork's names (ArtworkLook `names`) names: a cluster, by its key, or a
 *  declaration, by its full name. */
export function artNameId(kind: "cluster" | "decl", s: string): string {
  return `${kind === "cluster" ? "c" : "d"}:${s}`;
}

/** The most an artwork's names hidden, its names shown, and its targets chosen each take in what
 *  presence carries, in bytes of their JSON: a heartbeat is at most 16 KB (server/main.ts), and the
 *  rest of where a reader is has room beside them. Names by selection are kept as what differs from
 *  As shown, so that a few names hidden or added are a few names carried. */
export const ART_NAMES_BYTES = 4500;
export const ART_TARGETS_BYTES = 2500;
/** the names a recipe's rule chose (ArtworkLook `ruledNames`): a rule names a few clusters */
export const ART_RULED_BYTES = 1500;

/** What `x` adds to a list's JSON: itself, quoted, and a comma. */
const jsonBytes = (x: string) => new TextEncoder().encode(JSON.stringify(x)).length + 1;

/** A list of names as given, checked: strings, each once, none empty or longer than a name is (1,000
 *  characters), each as `ok` says; kept in their order while their JSON stays within `budget` bytes,
 *  the rest left out. */
export function cleanNames(v: unknown, budget: number, ok: (s: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 2;
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== "string" || !x || x.length > 1000 || seen.has(x) || !ok(x)) continue;
    const b = jsonBytes(x);
    if (used + b > budget) break;
    used += b;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** a name of an artwork's names: a cluster's or a declaration's (artNameId) */
export const isArtNameId = (s: string) => /^[cd]:./.test(s);

/** The artwork mode as presence carries it: its settings, and the rectangle of the board's world its
 *  frame holds (its middle, its width and height), which a follower's frame holds too. */
export interface ArtworkView extends ArtworkLook {
  region: [number, number, number, number];
}

/** the most pixels a side of an artwork has */
export const ART_MAX_SIDE = 16384;

/** A place with no artwork in it: an agent's (ExportSpec decision 19, agents have no artwork). */
export function withoutArtwork(v: PresenceView | null): PresenceView | null {
  if (!v || !("artwork" in v)) return v;
  const { artwork: _artwork, ...rest } = v;
  return rest;
}

/** An artwork's settings as given, checked; null where they are not. */
export function cleanArtwork(v: unknown): ArtworkView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const one = <T extends string>(xs: readonly T[], x: unknown): T | null => (xs.includes(x as T) ? (x as T) : null);
  const side = (x: unknown) => (Number.isInteger(x) && (x as number) >= 16 && (x as number) <= ART_MAX_SIDE ? (x as number) : null);
  const r = Array.isArray(o.region) && o.region.length === 4 && o.region.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9) ? (o.region as [number, number, number, number]) : null;
  const w = side(o.w), h = side(o.h), scheme = one(SCHEMES, o.scheme), theme = one(["light", "dark"] as const, o.theme);
  const background = one(["theme", "transparent"] as const, o.background), labels = one(["board", "clusters", "none", "chosen"] as const, o.labels);
  const edges = one(["all", "selection", "none"] as const, o.edges), targets = one(["marked", "plain", "highlight", "chosen"] as const, o.targets);
  if (!r || r[2] <= 0 || r[3] <= 0 || !w || !h || !scheme || !theme || !background || !labels || !edges || !targets) return null;
  // (a proof edges' switch, said until 2026-10-15, is no more: an artwork draws none)
  if (typeof o.notes !== "boolean" || typeof o.selection !== "boolean") return null;
  // the source, said since 2026-10-15: off where a page does not say it. The names and targets chosen
  // and the key marks' switch, said since the evening of that day: none chosen where a page does not
  // say them, and the key marks as the targets drew them before (with their stars, unless As any)
  const namesFrom = o.namesFrom === "none" ? "none" : "board";
  const hiddenNames = cleanNames(o.hiddenNames, ART_NAMES_BYTES, isArtNameId), shownNames = cleanNames(o.shownNames, ART_NAMES_BYTES, isArtNameId);
  // the names a recipe's rule chose, said since later that night: none where a page does not say them
  const ruledNames = cleanNames(o.ruledNames, ART_RULED_BYTES, isArtNameId);
  const shownTargets = cleanNames(o.shownTargets, ART_TARGETS_BYTES);
  const keys = typeof o.keys === "boolean" ? o.keys : targets !== "plain";
  // the style and the title, said since that night: as the board, the project's own; the foot's
  // size, said since later that night: the first
  const style = one(ART_STYLES, o.style) ?? "board";
  return { w, h, scheme, theme, background, labels, namesFrom, hiddenNames, shownNames, ruledNames, edges, notes: o.notes, targets, shownTargets, keys, selection: o.selection, source: o.source === true, style, title: cleanTitle(o.title), subtitle: cleanTitle(o.subtitle), titleSize: cleanTitleSize(o.titleSize), footSize: cleanFootSize(o.footSize), border: o.border === true, region: [...r] };
}

/** The legend's schemes (CanvasSpec, "Colour schemes"). */
export const SCHEMES = ["kind", "status"] as const;
export type ColourScheme = (typeof SCHEMES)[number];
/** Activity's filters: the kind of event, and whose (web/src/activity.ts). */
export const ACTIVITY_KINDS = ["all", "review", "build", "change"] as const;
export const ACTIVITY_WHO = ["all", "agents", "people"] as const;

/** Activity as presence carries it: open or closed, the kind of event shown, whose, and — "My
 *  targets" — the reader whose targets it keeps to: their own name, or the name of the reader whose
 *  Activity they took it from by following them; absent, everyone's. */
export interface ActivityView {
  open: boolean;
  kind: (typeof ACTIVITY_KINDS)[number];
  who: (typeof ACTIVITY_WHO)[number];
  mine?: string;
}

/** What the reference window shows, as presence carries it. */
export interface PaperWindow {
  file: string;
  page?: number;
  link?: string;
  collapsed?: boolean;
}

/** One open page, as every page is told; a private one is not (CollabSpec decision 8). */
export interface Peer {
  /** the page's event stream, as the server names it to everyone (server/live.ts), or an agent's
   *  entry; never what the page calls itself, nor the secret its heartbeats carry */
  id: string;
  /** null for a reader who has not given a name */
  name: string | null;
  view: PresenceView | null;
  /** no input for five minutes, or the page is in the background; for an agent without a token,
   *  no request for a minute; with one, offline */
  idle: boolean;
  /** an agent working through the API (AgentSpec decision 1), not a page */
  agent?: true;
  /** a page of someone invited by a personal link (CollabSpec decision 9): the name is theirs */
  verified?: true;
  /** an agent with a token of its own (AgentSpec decisions 7 and 8): its state, as the server
   *  infers it from what the agent does; absent for any other */
  talk?: AgentTalk;
  /** who shared with it */
  by?: string;
}

/** What an agent with a token of its own is doing, as the server infers it from its requests
 *  (AgentSpec decision 8, server/talk.ts): *listening* while a wait for messages is open;
 *  *thinking* from the moment messages were handed to it until it replies; *working* when it
 *  makes requests with nothing to answer; *offline* once it has had no wait open and made no
 *  request for its longest wait plus a minute. Only an offline agent cannot be written to. */
export type AgentState = "listening" | "thinking" | "working" | "offline";

export interface AgentTalk {
  state: AgentState;
  /** when the state began: for thinking, when the messages were handed over */
  since: string;
  /** what its latest request did, in words ("reading `A.b`"), while thinking or working */
  doing: string | null;
  /** the line it set itself (POST /api/agent/status), until it replies or waits again */
  status: string | null;
  /** the last message handed to it: people's messages after it wait for its next wait */
  read: number;
  /** its last request, or the end of its last wait; null before the first */
  lastSeen: string | null;
}

/** A token an agent was given by Share (AgentSpec decision 7, server/tokens.ts), as the page and the
 *  agents' API list it: never the token itself, whose prompt Share asks for apart. */
export interface AgentTokenInfo {
  /** names it in lists: part of the token, no secret */
  id: string;
  /** the name it acts under, fixed for its life: the one the person gave ("Alice's AI"), numbered
   *  when another in force had it */
  name: string;
  level: "read" | "advise" | "full";
  /** who made it */
  by: string;
  created: string;
  expires: string;
  revoked: string | null;
  revokedBy: string | null;
  lastUsed: string | null;
}

/** One message of a conversation with an agent (AgentSpec decision 8, server/talk.ts), as pages
 *  and the agent are told it; or a divider, where someone started a new conversation (the owner's
 *  decision of 2026-10-11): `from` is who did, and its text the notice the agent is handed. */
export interface ChatMessage {
  /** its place in the conversation, from 1 */
  id: number;
  at: string;
  from: string;
  kind: "person" | "agent" | "divider";
  text: string;
  /** where the writer was: in words, and the view, declaration and selection */
  where?: { inWords: string; view: string; declaration: string | null; selection: string | null } | null;
}

/** A session id: what a page calls itself for as long as it is open, in its event stream's address
 *  only (the server keeps a page's streams few by it); it is never told to the others. */
export function validSession(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f-]{8,64}$/.test(s);
}

/** What the server tells a page alone when its event stream opens (`hello`): the id everyone knows
 *  the page by, and the secret its heartbeats and arrangements carry to say they are its own. It is
 *  told again, with a new id, when the page goes private or shows itself again (CollabSpec decision
 *  8); `private` says the server counts it among the private readers. */
export interface StreamHello {
  id: string;
  token: string;
  private?: true;
}

/** How many private readers are on the server (CollabSpec decision 8), as every page is told it
 *  beside the list of the others (`private`): a count, never who. */
export interface PrivateCount {
  count: number;
}

/** A view as a page sent it, checked and bounded; null when it is not one. */
export function cleanView(v: unknown): PresenceView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, max = 2000) => (typeof x === "string" && x.length <= max ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const cam = o.cam && typeof o.cam === "object" ? (o.cam as Record<string, unknown>) : null;
  const cx = num(cam?.x), cy = num(cam?.y), ck = num(cam?.k);
  const selection = str(o.selection, 20000);
  const h = o.history && typeof o.history === "object" ? (o.history as Record<string, unknown>).snapshot : null;
  const snapshot = typeof h === "number" && Number.isInteger(h) && h > 0 && h < 1e9 ? h : null;
  const source = o.source === true;
  // the visitors, at most a trail's worth (web/src/visitors.ts, TRAIL), each a name, where it was
  // reached from and its place: the cluster and the spot in it, and where it is drawn
  const pair = (p: unknown): [number, number] | null =>
    Array.isArray(p) && p.length === 2 && p.every((n) => num(n) !== null && Math.abs(n as number) < 1e8) ? [p[0] as number, p[1] as number] : null;
  const visitors = (Array.isArray(o.visitors) ? o.visitors.slice(0, 8) : []).flatMap((w): NonNullable<PresenceView["visitors"]> => {
    const x = w && typeof w === "object" ? (w as Record<string, unknown>) : null;
    const decl = x ? str(x.decl) : null;
    if (!decl) return [];
    const at = pair(x!.at), spot = pair(x!.spot), from = str(x!.from), inn = typeof x!.in === "string" ? str(x!.in) : null;
    return [{ decl, ...(at ? { at } : {}), ...(from ? { from } : {}), ...(inn !== null && spot ? { in: inn, spot } : {}) }];
  });
  // the reference window: a file by its hash, a page, the link it was opened on
  const pw = o.paper && typeof o.paper === "object" ? (o.paper as Record<string, unknown>) : null;
  const paper: PaperWindow | null =
    pw && typeof pw.file === "string" && /^[0-9a-f]{64}$/.test(pw.file)
      ? {
          file: pw.file,
          ...(Number.isInteger(pw.page) && (pw.page as number) >= 1 && (pw.page as number) <= 100000 ? { page: pw.page as number } : {}),
          ...(typeof pw.link === "string" && /^l[0-9a-f]{12}$/.test(pw.link) ? { link: pw.link } : {}),
          ...(pw.collapsed === true ? { collapsed: true } : {}),
        }
      : null;
  // what the panels and the board show besides, each said or not at all (an older page says none)
  const av = o.activity && typeof o.activity === "object" ? (o.activity as Record<string, unknown>) : null;
  const one = <T extends string>(xs: readonly T[], x: unknown): T | null => (xs.includes(x as T) ? (x as T) : null);
  const kind = one(ACTIVITY_KINDS, av?.kind), who = one(ACTIVITY_WHO, av?.who);
  const activity: ActivityView | null =
    av && typeof av.open === "boolean" && kind && who ? { open: av.open, kind, who, ...(typeof av.mine === "string" && validName(av.mine) ? { mine: av.mine } : {}) } : null;
  const lost = o.lostFound && typeof o.lostFound === "object" ? (o.lostFound as Record<string, unknown>).open : undefined;
  const scheme = one(SCHEMES, o.scheme);
  const pinned = Array.isArray(o.pinned)
    ? o.pinned
        .slice(0, MAX_PINNED)
        .map((w): PinnedWindow | null => {
          const decl = w && typeof w === "object" ? str((w as Record<string, unknown>).decl) : null;
          return decl ? { decl, collapsed: (w as Record<string, unknown>).collapsed === true } : null;
        })
        .filter((w): w is PinnedWindow => w !== null)
    : [];
  return {
    mode: str(o.mode, 16) ?? "tcb",
    sel: str(o.sel),
    ...(selection !== null ? { selection } : {}),
    source,
    ...(source && o.sourceCollapsed === true ? { sourceCollapsed: true } : {}),
    ...(pinned.length ? { pinned } : {}),
    clusterMode: str(o.clusterMode, 16) ?? "namespace",
    cam: cx !== null && cy !== null && ck !== null ? { x: cx, y: cy, k: ck } : null,
    view: str(o.view, 300),
    scope: str(o.scope, 4000),
    tabs: Array.isArray(o.tabs) ? o.tabs.slice(0, 50).map((t) => str(t, 300)).filter((t): t is string => t !== null) : [],
    ...(snapshot !== null ? { history: { snapshot } } : {}),
    ...(o.focus === null || str(o.focus) ? { focus: o.focus as string | null } : {}),
    ...(visitors.length ? { visitors } : {}),
    ...(paper ? { paper } : {}),
    ...(activity ? { activity } : {}),
    ...(typeof lost === "boolean" ? { lostFound: { open: lost } } : {}),
    ...(scheme ? { scheme } : {}),
    ...(typeof o.edges === "boolean" ? { edges: o.edges } : {}),
    ...(typeof o.linear === "boolean" ? { linear: o.linear } : {}),
    ...(o.artwork === null ? { artwork: null } : cleanArtwork(o.artwork) ? { artwork: cleanArtwork(o.artwork) } : {}),
  };
}
