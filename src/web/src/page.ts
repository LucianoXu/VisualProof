// The page as its parts share it (web/src/main.ts makes the parts, in order, each from the page as
// it is so far). Each part (web/src/page*.ts) gives the others what they call, which its interface
// lists; the state they keep together is the page's (PageState), set and read on it, never in a
// part's own variables; and what the page is given before any part is made (PageGiven) each part
// takes from it as it starts. Here too are the page's words and helpers every part uses.

import type { BuildStatus, BuildWhole, FileStatus } from "../../shared/build.ts";
import type { ViewMeta } from "../../shared/graph.ts";
import type { Query } from "../../shared/query.ts";
import type { MenuTarget } from "./ctxmenu.ts";
import type { DataSource, ReviewState } from "./data.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import type { DeployStatus } from "../../shared/deploy.ts";
import type { Editor } from "./editor.ts";
import { restsOn } from "./selection.ts";
import type { Tool, Pick, Shown } from "./selection.ts";
import type { Kept } from "./reload.ts";
import type { siteOrigins } from "./chatlinks.ts";
import type { ArtSettings } from "./artwork.ts";
import type { Store } from "./store.ts";
import type { Visitor } from "./visitors.ts";
import type { Saved } from "./store.ts";
import type { AddressPart } from "./pageaddress.ts";
import type { LivePart } from "./pagelive.ts";
import type { ToolbarPart } from "./pagetoolbar.ts";
import type { MenuPart } from "./pagemenu.ts";
import type { NotesPart } from "./pagenotes.ts";
import type { KeysPart } from "./pagekeys.ts";
import type { GuidePart } from "./pageguide.ts";
import type { MainPart } from "./main.ts";


export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The tools by name: the modes Selection and Used by, and the three steps of the mode Rests on
 *  (decided 2026-10-08, ViewSpec decision 20). */
export const MODE_NAME: Record<Tool, string> = { plain: "Selection", deps: "Uses", tcb: "TCB", keys: "Keys", refs: "Direct", apps: "Used by" };
/** A tool as the others' list and the notes say it: a step with its mode. */
export const toolName = (t: Tool): string => (restsOn(t) ? `Rests on · ${MODE_NAME[t]}` : MODE_NAME[t]);

/** What a click selects with each tool (the mode buttons, web/src/selection.ts): said while the
 *  pointer is on a button. */
export const MODE_HINT: Record<Tool, string> = {
  plain: "A click selects just what you click; shift-click adds it or takes it out.",
  deps: "A click selects what you click and everything it uses, proofs included: the most it rests on.",
  refs: "A click selects what you click and what it uses directly: in its statement, its body or its proof.",
  tcb: "A click selects the TCB of what you click: the definitions its statement rests on, proofs skipped.",
  keys:
    "A click selects what you click and the key declarations in its TCB: where the review has a focus, that target's; elsewhere every target's, or a target's own when you click a target. " +
    "Dashed edges are the key graph: from A to B when A rests on B through declarations that are not key.",
  apps: "A click selects what you click and everything that uses it.",
};
/** What Rests on is, while the pointer is on its button: the question its steps answer, at the
 *  granularities everything used ⊇ the TCB ⊇ the key declarations in it, and one step: what it uses
 *  directly (ViewSpec decision 20). */
export const RESTS_HINT = "A click selects what you click rests on, as much of it as the step says:";
export const STEP_HINT: Record<Tool, string> = { plain: "", apps: "", deps: "everything it uses, proofs included", refs: "what it uses directly, proofs included", tcb: "what its statement rests on, proofs skipped", keys: "the key declarations in its TCB" };
/** What a tap selects with each tool, in a few words: under the tool's name in a phone's ⋯, where
 *  nothing is said while a pointer rests on a button (web/src/phone.ts). */
export const TAP_HINT: Record<Tool, string> = { ...STEP_HINT, plain: "just what you tap", apps: "everything that uses it" };
/** What a link to a view the server no longer has opens instead, and why (ViewSpec decision 6). */
export const VIEW_GONE = "This link's view is gone: it was deleted, or nobody kept it and everyone closed it. Here is the Project.";

export interface GraphInfo {
  version: number;
  /** the server's process that counts the versions (UpdateSpec decision 8) */
  instance?: string;
  at: string;
  missing: string[];
  /** the usage pass on this graph's build (server/live.ts) */
  usage?: { state: "pending" | "done" | "off"; failed: number };
  /** following a branch (DeploySpec): the commit whose build the graph was read from */
  commit?: string;
}

export const STATE_LABEL: Record<string, string> = {
  failed: "failed",
  unbuilt: "never built",
  blocked: "blocked",
  stale: "out of date",
  queued: "queued",
  building: "building",
  sorry: "uses sorry",
};
/** Why the review is refused on a past board, where it would be given. */
export const PAST_REVIEW = "This board shows a past build: opinions, key marks, targets and trust are given on the latest build.";
export const READ_ONLY_REVIEW = "Read-only: the review as it stands, live.";

export const short = (name: string) => name.split(".").pop() ?? name;

/** What the page is given before any of its parts is made (main.ts). */
export interface PageGiven {
  data: DataSource;
  store: Store;
  S: Saved;
  kept: Kept | null;
  reader: "link" | "public" | null;
  editor: Editor;
  site: ReturnType<typeof siteOrigins>;
}

/** The state the parts keep together: each part reads it, and sets it, on the page. */
export interface PageState {
  graphInfo: GraphInfo | null;
  /** the build status, read as the page loads (web/src/buildread.ts): shown once the first board is */
  firstBuild: Promise<BuildWhole> | null;
  meta: ViewMeta;
  /** the graph on show: the latest build's */
  present: Graph;
  /** the graph the board on show was taken from: the graph on show's, or a past build's */
  g: Graph;
  offerTip: (_rule: string) => void;
  didTip: (_rule: string) => void;
  countTip: (_name: string, _rule: string) => number;
  heardRelease: string | null;
  hearRelease: (v: string) => void;
  /** read-only links can be made on this server: the tip about them is for it alone */
  readOnlyLinks: boolean;
  /** the selection (web/src/selection.ts): its picks, by name and key, and what the panel tells of */
  picks: Pick[];
  shown: Shown | null;
  /** the reader's visitors on the board on show (ViewSpec decision 27; web/src/visitors.ts), newest
   *  last, and the board they are on: another board has none */
  visitors: Visitor[];
  build: BuildStatus | null;
  /** the branch the server follows and builds itself (DeploySpec), as it last said; null for a
   *  workspace */
  deploy: DeployStatus | null;
  /** the depth stepper's label (defined with the side panel below) */
  showLevel: () => void;
  /** draw the edges, or not (defined with the eyes below) */
  setEdges: (_edges: boolean) => void;
  /** the review (ReviewSpec.md), as the server last told it: the whole once, then each change */
  review: ReviewState;
  handsOver: () => boolean;
  compiled: Map<string, string | null | undefined>;
  /** The reader's own focus on the board on show (ViewSpec decision 28; web/src/focus.ts): a target,
   *  none (null), or the view's own (undefined). It is theirs as the camera is: remembered per view
   *  (`here`, `place`) and followed (`whereIAm`). */
  mine: string | null | undefined;
  /** whether the page's history has a step back and one forward: the following window shows it */
  steps: { back: boolean; forward: boolean };
  filmPart: string;
  /** the artwork's settings the board is drawn with: null where its mode is off */
  artLook: ArtSettings | null;
  fileIndex: Map<string, FileStatus>;
  /** The focus in force, as last drawn by: what follows it (the key declarations' diamonds, the
   *  colour scheme) is made again when it changes. */
  focusWas: string | null | undefined;
  locked: boolean;
  /** What the menu is open on: the target, its declaration in the whole graph's numbering or its
   *  cluster on the board, the part of a scope it is (decl(X), or the cluster's set), and where. */
  menuOn: { t: MenuTarget; i?: number; c?: number; note?: string; part: Query | null; world: [number, number]; at: { x: number; y: number }; linear?: boolean; artName?: string } | null;
}

/** The page: what it is given, its state, and what each part gives the others. */
export interface Page extends
  PageGiven, PageState, AddressPart, LivePart, ToolbarPart, MenuPart, NotesPart, KeysPart,
  GuidePart, MainPart
{}
