// The agents' API (AgentSpec.md): JSON made for the questions an agent asks — find declarations,
// read one (its source, the context it is written in, what it uses and what uses it), walk a
// target's TCB in review order (and what it trusts), why something is in it, what Lean says of a
// name and what `#print` shows of it, what happened, a target's key declarations and what each
// rests on (ExportSpec decision 3), the exported document's model — and for what an agent does:
// give advice, stick a note on a view that points people at something (its endpoints are
// server/agentnotes.ts), say what it looks at, typeset a document (ExportSpec decision 11), and, at
// level full, whatever a person can do through the page (AgentSpec decision 9): mark targets and
// key declarations, trust prefixes, make, rename, duplicate, delete, rescope, arrange and lay out
// views, drop and let go of pins and undo them. The same server, the same review, the same rules as the page; never the page's 10 MB of
// drawing data. Where an agent would otherwise ask many times in a row, one request answers for
// several parts or several declarations.
//
// Every handler takes a request already read (what was asked, and who asks) and gives back an
// answer (a status, a JSON body, headers), so that the tests call it without HTTP; main.ts does the
// HTTP. The list of endpoints below is also what GET /api/agent/endpoints says about them, and
// what the entry (GET /api/agent) names of the most used, so the two cannot drift apart; the MCP
// server's tools (server/mcptools.ts) take what each request needs from it. The documentation is
// docs/agent-api/ (server/agentdocs.ts), served as GET /api/agent/docs.
//
// What an agent says is advice (AgentSpec decision 2): its opinions are recorded marked `agent`,
// and nothing that counts the review reads them (shared/review.ts), at every level. What it may
// change is set by `--agents` and its token: `read` nothing, `advise` opinions and notes, `full`
// everything a person can do through the page (decision 9), each recorded under its name and
// marked as an agent's — in its own review log, and in the timeline — so that people always see it
// was an agent and can undo or reverse it as anyone's. Each request of pins is one batch in the
// timeline that can be undone at once. Agent tokens stay with people: this API has no endpoint
// that makes, lists or revokes them.

import type { History } from "./history.ts";
import { historyEndpoints, historyWorld } from "./historyapi.ts";
import { PastBuilds } from "./pastdoc.ts";
import type { LastHad, LostAnswer } from "../shared/lostfound.ts";
import type { Identity } from "./versions.ts";
import { spawnSync } from "node:child_process";
import { withoutReasons } from "../shared/timeline.ts";
import { childEnv } from "./children.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIVITY_KINDS, ACTIVITY_WHO, cleanView, MAX_PINNED, SCHEMES, validName } from "../shared/collab.ts";
import type { PaperWindow, Peer, PresenceView } from "../shared/collab.ts";
import { addressOf, readRegion, showing, writeSnapshot } from "../shared/sharesnap.ts";
import { encodeRecipe, readRecipe, RECIPE_PARAM, resolveRecipe, SAVE_PARAM } from "../shared/artrecipe.ts";
import { exactContext } from "../shared/context.ts";
import type { FileContext, ModuleContexts } from "../shared/context.ts";
import type { ClusterMode, Layout } from "../shared/graph.ts";
import { CLUSTER_MODES, invalidOps } from "../shared/places.ts";
import type { PlaceOp, PlacesData } from "../shared/places.ts";
import { evaluate, parseQuery, printQuery, QueryError } from "../shared/query.ts";
import { advice, fresh, STANDARD_AXIOMS, trustedBy } from "../shared/review.ts";
import type { Opinion, ReviewData } from "../shared/review.ts";
import { fileOf, linkOf } from "../shared/library.ts";
import { keyGraph } from "../shared/keys.ts";
import { authorLine, authorsOf, reviewTraces, viewTraces } from "../shared/doc/authors.ts";
import { itemsShownOn } from "../shared/noteplace.ts";
import { buildDoc, DocInputError, docNotes } from "../shared/doc/build.ts";
import { boardSpots } from "./boardspots.ts";
import { outlineOf } from "../shared/doc/outline.ts";
import { planDoc } from "../shared/doc/sections.ts";
import { docFiles, figureFiles, figureNotes } from "./figures.ts";
import type { DocInput, DocSource, DocView } from "../shared/doc/build.ts";
import { renderLatex } from "../shared/doc/latex.ts";
import type { DocModel } from "../shared/doc/model.ts";
import { readSettings, SETTINGS_HELP } from "../shared/doc/settings.ts";
import type { KeyGraph } from "../shared/keys.ts";
import { nonStandardAxiom } from "../shared/reviewqueue.ts";
import { reviewThen } from "../shared/pastgraph.ts";
import { foldedAt, guessNames } from "../shared/declfind.ts";
import { fullWhen } from "../shared/titles.ts";
import type { NewEvent, StoredEvent } from "../shared/timeline.ts";
import { docTitle, fixedScope, PROJECT, titleOfScope, viewTitle } from "../shared/views.ts";
import type { PinAuthor, ViewData } from "../shared/views.ts";
import type { Invited } from "../shared/collab.ts";
import { noteEndpoints } from "./agentnotes.ts";
import { libraryEndpoints } from "./agentlibrary.ts";
import { askEndpoints } from "./askfollow.ts";
import type { Asks } from "./askfollow.ts";
import type { Library } from "./library.ts";
import { noteNames } from "../shared/sticky.ts";
import { focusOf, titleContext, viewEndpoints } from "./agentviews.ts";
import type { ExportFile, ExportJob, Exporter } from "./export.ts";
import type { HoverAnswer, PrintAnswer } from "./hover.ts";
import type { Kind } from "./identity.ts";
import { agentKey } from "./presence.ts";
import type { AgentWho } from "./presence.ts";
import type { ReviewStore } from "./review.ts";
import { SERVER_WRITER } from "./review.ts";
import { ReviewApi } from "./reviewapi.ts";
import { lakeTextHash } from "./status.ts";
import type { DeployStatus } from "../shared/deploy.ts";
import type { Views } from "./views.ts";
import type { Talk } from "./talk.ts";
import { MAX_AGENT, MAX_STATUS, MAX_WAIT_S, THREAD } from "./talk.ts";
import { DOC_TOPICS } from "./agentdocs.ts";
import { View } from "./agentgraph.ts";
import { TALKING, conversation, doingOf, inbox, publicChannel, reply, status } from "./agenttalk.ts";
import { docs, endpointList, index, mcpFile, mcpInstallGet, mcpTools } from "./agententry.ts";
import { MAX_PRINT, describe, print } from "./agentlean.ts";
import { MAX_NAMES, PARTS, context, declaration, declarations, moduleGet, refsGet, searchGet, source } from "./agentread.ts";
import { MAX_OPINIONS, opinionPost, opinionsPost, withdrawPost } from "./agentadvice.ts";
import { keyPost, keysGet, targetPost, targets, tcb, trustPost, why } from "./agenttcb.ts";

/** What agents may change on a server (`--agents`): nothing; advice and notes; or everything a
 *  person can do through the page, their opinions still advice (AgentSpec decision 9). */
export type AgentLevel = "read" | "advise" | "full";
/** What a request needs of an agent's level: advice and notes, or everything else a person can do. */
export type Need = "advise" | "full";
export const AGENT_LEVELS: readonly AgentLevel[] = ["read", "advise", "full"];

/** Who asks: the name and the kind its headers give (server/identity.ts) — or, for an agent with a
 *  token of its own (server/tokens.ts), the token's, whatever its headers say. */
export interface Caller {
  name: string | null;
  kind: Kind;
  /** the token the request came with: its id, who made it, what it lets the agent change, until when */
  token?: { id: string; by: string; level: AgentLevel; expires: string };
  /** the name the request's header gave, where a token's name was taken instead (the index says so) */
  ignoredName?: string;
  /** the personal link a person came by (CollabSpec decision 9): its id, who they are */
  person?: string;
  /** a private page's request (CollabSpec decision 8), with the session the page calls itself by:
   *  what it arranges is recorded without a name (identity.ts, layoutAuthor). Never an agent's. */
  private?: { session: string | null };
}

/** What a handler answers: an HTTP status, a JSON body, and headers beside them; or, for what is not
 *  JSON (the documentation, the MCP server's file), a text of its own type; or a file to download
 *  (a typeset document). */
export interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  text?: { type: string; body: string };
  file?: ExportFile;
  /** sent as it is, compressed already, and tagged: a snapshot's graph in parts (server/historyapi.ts) */
  gz?: { type: string; body: Buffer };
}

/** A request as main.ts read it: the query for a GET, the JSON body for a POST. */
export interface Ask {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  caller: Caller;
  /** the server's address as the request reached it (--public-url, else the Host), for what tells
   *  an agent how to reach it again (the MCP server's installation) */
  base?: string;
  /** aborted when the asker went away: a wait for messages ends with it */
  signal?: AbortSignal;
  /** the session VisualProof's MCP server says it is (X-VisualProof-Session, since 0.4.0): a wait
   *  from another one than the last is a new session's */
  session?: string;
}

/** What the API reads and changes: the live server (server/live.ts) has all of it, a test builds
 *  its own. */
export interface World {
  project: { root: string; files: Map<string, string>; toolchain: string };
  /** the graph on show; `fingerprint` names the build it was read from (server/live.ts) */
  graph: { version: number; fingerprint?: string; prep: { metaGz: Buffer; edgesGz: Buffer } } | null;
  /** the review's logs (server/review.ts): an append is told to every page by the store itself */
  review: Pick<ReviewStore, "data" | "append">;
  /** the holder of a personal link in force who goes by `name` (an opinion recorded for them,
   *  ReviewSpec decision 8) */
  invited?(name: string): { id: string; name: string } | undefined;
  /** whether `name` is an agent's now, a token in force or an agent on the page: nobody's opinion is
   *  recorded for it (ReviewSpec decision 8) */
  agentNamed?(name: string): boolean;
  timeline: { events: StoredEvent[]; add(e: NewEvent): StoredEvent };
  /** the Project view's pins (ViewSpec decision 5): what `place`, `pins` and `undo` are about */
  places: { data: PlacesData; apply(ops: PlaceOp[], who?: { by: string | null; agent?: boolean }): boolean; authorOf(mode: ClusterMode, kind: "node" | "cluster", key: string): PinAuthor | null };
  /** every view (server/views.ts); the endpoints about views are server/agentviews.ts */
  views: Views;
  presence: {
    agentBeat(who: string | AgentWho, view?: PresenceView | null): void;
    agentView(who: string | AgentWho): PresenceView | null;
    drop(session: string): void;
    list(): Peer[];
    /** how many private readers are here, who are not listed (CollabSpec decision 8) */
    privateCount(): number;
    /** the changes of who is where that GET companion waits for, counted (server/presence.ts) */
    rev: number;
    waitChange(since: number, ms: number): Promise<void>;
  };
  placesChanged(ops: unknown[], from: string | null, by: string | null): void;
  /** the usage pass's contexts of a module of the graph on show (server/usage.ts), if it has them */
  contextsOf?(module: string): ModuleContexts | null;
  /** the conversations (server/talk.ts): the public channel and each agent's private one, where
   *  people talk with agents, and what each agent with a token is doing */
  talk?: Pick<Talk, "thread" | "since" | "conversation" | "post" | "allow" | "talk" | "wait" | "seen" | "setStatus" | "left" | "lastChannel">;
  /** who a message may mention (server/live.ts): the names, and the agents among them by token */
  mentionable?(): { names: string[]; agents: Map<string, string> };
  /** the snapshots of the graph (server/history.ts), the identities the renames in force give
   *  (server/versions.ts) and those renames, and the renames recorded between two snapshots */
  history?: History | null;
  identity?(): Identity;
  renamed?(): [string, string][] | null;
  renamesBetween?(from: number, to: number): Map<string, string>;
  /** the people invited by a personal link (server/invites.ts): the name each goes by now, by the
   *  link's id; none behind a sign-in proxy, or in a test that has none */
  people?(): Invited[];
  /** the moves (server/live.ts): listed, made by hand, undone */
  moves?(): unknown;
  moveByHand?(from: string, to: string, who: { name: string; agent: boolean }): { status: number; body: unknown };
  unmove?(id: string, who: { name: string; agent: boolean }): { status: number; body: unknown };
  /** the lost-and-found (server/lostfound.ts): listed, the newest build that had a name, entries
   *  archived or put back */
  lostAndFound?(): LostAnswer;
  lastHad?(name: string): LastHad | null;
  archiveEntries?(keys: string[], on: boolean, who: { name: string; agent: boolean }): { status: number; body: unknown };
  /** the library's files (AttachmentSpec.md, server/library.ts); none in a test that has none */
  library?: Library;
  /** the requests to follow going on (CollabSpec decision 10, server/askfollow.ts) */
  asks?: Asks;
  /** following a branch (DeploySpec): the commit of the graph on show; undefined for a workspace,
   *  whose commit git says as it is now */
  shownCommit?(): { hash: string; branch: string } | null | undefined;
  /** the branch followed and its builds (DeploySpec); null for a workspace */
  following?(): DeployStatus | null;
}

/** Lean, asked about a name where a module is imported (server/hover.ts): what its hover says
 *  (`describe`), and what `#print` says (`print`). */
export interface Lean {
  describe(module: string, name: string, waitMs: number): Promise<HoverAnswer>;
  print(module: string, name: string, proofs: boolean, waitMs: number): Promise<PrintAnswer>;
}

/** An error, as every refusal is shaped: what went wrong, and what to do instead. */
export function fail(status: number, error: string, hint: string, more: Record<string, unknown> = {}, headers?: Record<string, string>): Answer {
  return { status, body: { error, hint, ...more }, headers };
}

export const ok = (body: unknown): Answer => ({ status: 200, body });

/** Why an agent may not do `what` on a server started with `--agents level`, as an answer; null
 *  when it may. `advise`: opinions and notes; `full`: what else a person can do through the page.
 *  With `token`, the level is the agent's token's (at most the server's), and the answer says so. */
export function refusal(level: AgentLevel, what: Need, token?: AgentLevel): Answer | null {
  const lvl = token ? lower(level, token) : level;
  if (lvl === "full" || (lvl === "advise" && what === "advise")) return null;
  const may = lvl === "read" ? "only read" : "give advice, leave notes and add files and links, not do what else people do (targets, key declarations, trust, views, the layout, changing what others made)";
  if (token && token === lvl)
    return fail(403, `Your token lets you ${may} (level ${token}).`, `Whoever shared with you chose this; ask them for a token at level ${what === "advise" ? "advise or full" : "full"} if you need more.`);
  return fail(403, `Agents may ${may} on this server (--agents ${lvl}).`, `The person who runs the server decides this: --agents ${what === "advise" ? "advise or full" : "full"} allows it.`);
}

/** The lower of two levels. */
export function lower(a: AgentLevel, b: AgentLevel): AgentLevel {
  return AGENT_LEVELS[Math.min(AGENT_LEVELS.indexOf(a), AGENT_LEVELS.indexOf(b))];
}

/** What a request to the page's review (POST /api/review, `{op, …}`) needs of an agent: an opinion
 *  is advice, and so is withdrawing its own (ReviewSpec decision 9); a target, a prefix trusted or a
 *  key declaration is what a person does, open to an agent at level full (AgentSpec decision 9). */
export function needOf(body: unknown): Need {
  const op = (body as { op?: unknown } | null)?.op;
  return op === "opinion" || op === "withdraw" ? "advise" : "full";
}

/** A request said it comes from an agent; a write through this API must. */
export function needAgent(c: Caller): Answer | null {
  if (c.kind === "agent" && c.name) return null;
  if (c.kind !== "agent")
    return fail(400, "This API records what agents do: say you are one.", "Send X-VisualProof-Kind: agent with every request, beside X-VisualProof-Name. A person gives opinions from the page.");
  return fail(401, "Say who you are first.", "Send X-VisualProof-Name: <your name> (percent-encoded beyond ASCII), e.g. Claude.", { who: true });
}

/** the longest the companion waits for someone to move, in seconds */
const MAX_COMPANION_WAIT = 60;
/** the tools, how a click selects, as the page names them (web/src/main.ts, MODE_NAME) */
/** The page's tools by name (web/src/main.ts): the modes Selection and Used by, and the three steps
 *  of the mode Rests on, Uses, TCB and Keys (ViewSpec decision 20). */
const TOOL_NAMES: Record<string, string> = { plain: "Selection", deps: "Uses", tcb: "TCB", keys: "Keys", apps: "Used by" };
/** Activity's kinds of event, as its filters name them (web/src/activity.ts) */
const ACTIVITY_WORDS: Record<string, string> = { review: "Review", build: "Builds", change: "Changes" };
const MAX_PINS = 500;
/** a declaration's radius as the layout packs it (web/src/scene.ts, LEAF_R) */
const LEAF_R = 5;
/** The parameters of the export endpoints, as a GET takes them. */
const EXPORT_PARAMS = {
  view: "the view's id (GET /api/agent/views lists them; project for the Project; POST /api/agent/views/open {scope} gives one for a query, e.g. key(T)). A view kept at a past build makes that build's document",
  settings: `optional, a JSON object: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}`,
  version: "optional: the build to print the view at, a snapshot's id (GET /api/agent/history), as the Time Machine shows a view at another build than its own; null or 0 for the latest. Left out: the view's own build",
};
/** What an export's notes say where no page had laid the view's board out for what it holds now
 *  (server/boardspots.ts): the order is the board the server laid out. */
const FRESH_BOARD =
  "No page had laid out this view's board for what it holds now: the document follows the board as the server laid it out from the view's memory, by the rules a page follows, which is the board a page will show when it next opens the view.";

/** What a request is told of a view to export. */
const VIEW_HINT =
  "Export a view, by its id: {view, settings}. What the view holds is what the document prints. A target's key document is its Key view: POST /api/agent/views/open {\"scope\": \"key(<target>)\"}, then export that view; the full review set is a view of its scope, tcb(<target>) except trusted or (uses(<target>) and kind(axiom) and nonstandard), opened the same way; any other view is a curated set.";

/** what a trusted standard axiom is trusted by */
const STANDARD = "standard axiom";

interface Endpoint {
  method: "GET" | "POST";
  /** its path; a last part `{name}` is any one part, read as the query parameter `name` */
  path: string;
  about: string;
  /** a line for the entry, where it names the endpoint among the most used (server/agententry.ts, ENTRY) */
  brief?: string;
  /** the query parameters of a GET, the JSON fields of a POST */
  params: Record<string, string>;
  returns: string;
  /** what `--agents` (and the token) must allow */
  needs?: Need;
  run(a: Ask): Answer | Promise<Answer>;
}

export class AgentApi {
  readonly world: World;
  readonly lean: Lean | null;
  readonly level: AgentLevel;
  private view: View | null = null;
  readonly endpoints: Endpoint[];

  /** what the review records, checked and bound as for the page (server/reviewapi.ts) */
  readonly reviews: ReviewApi;
  /** the typesetting of exported documents (server/export.ts), which the server gives where it
   *  typesets; null: documents are read as JSON only */
  exporter: Exporter | null = null;
  /** each agent's last typesetting job, by its token or its name: one runs at a time */
  private exportJobs = new Map<string, string>();
  /** the past builds views are printed at lately (server/pastdoc.ts) */
  private pasts: PastBuilds;

  constructor(world: World, lean: Lean | null, level: AgentLevel = "full") {
    this.world = world;
    this.lean = lean;
    this.level = level;
    this.endpoints = this.table();
    this.pasts = new PastBuilds(historyWorld(world));
    this.reviews = new ReviewApi(world, () => {
      const v = this.graph();
      return v instanceof View ? v : null;
    });
  }

  /** Answer a request under /api/agent. Every agent that asks something is here, for the people
   *  on the page (AgentSpec decision 1): its request keeps its presence, and the view it gave. */
  async handle(a: Ask): Promise<Answer> {
    const leaving = a.path === "/api/agent/view" && (a.body as { leave?: unknown } | null)?.leave === true;
    if (a.caller.kind === "agent" && a.caller.name && !leaving) this.world.presence.agentBeat(whoOf(a.caller));
    // what an agent with a token does is what people talking to it see it doing (AgentSpec
    // decision 8): its wait, its line and its reply say more, and say it themselves
    if (a.caller.token && this.world.talk && !leaving && !TALKING.has(a.path)) this.world.talk.seen(a.caller.token.id, doingOf(a));
    const path = a.path.replace(/\/+$/, "") || "/api/agent";
    const here = this.endpoints.flatMap((e) => {
      const part = matchPath(e.path, path);
      return part === null ? [] : [{ e, part }];
    });
    if (!here.length) return fail(404, `No endpoint ${a.path}.`, "GET /api/agent/endpoints lists every endpoint, with its parameters; GET /api/agent/docs, the documentation.");
    const found = here.find((x) => x.e.method === a.method);
    if (!found) return fail(405, `${a.path} answers ${here.map((x) => x.e.method).join(", ")}, not ${a.method}.`, "GET /api/agent/endpoints lists every endpoint.");
    const { e, part } = found;
    try {
      if (part !== true) {
        const query = new URLSearchParams(a.query);
        query.set(part.name, part.value);
        return await e.run({ ...a, query });
      }
      return await e.run(a);
    } catch (err) {
      return fail(500, err instanceof Error ? err.message : String(err), "This is the server's fault; the request may work again.");
    }
  }

  // ---------------------------------------------------------------- the graph

  /** What `caller` may change: the server's --agents, and no more than its token's level. */
  levelOf(c: Caller): AgentLevel {
    return c.token ? lower(this.level, c.token.level) : this.level;
  }

  /** Why `caller` may not do `what`, or null. */
  refuse(c: Caller, what: Need): Answer | null {
    return refusal(this.level, what, c.token?.level);
  }

  /** The graph on show, or the answer that there is none yet. */
  graph(): View | Answer {
    const g = this.world.graph;
    if (!g) return fail(503, "The graph has not been read yet.", "The server is reading the project; ask again in a few seconds.", { retryAfter: 5 }, { "retry-after": "5" });
    if (!this.view || this.view.version !== g.version) this.view = new View(g.version, g.prep.metaGz, g.prep.edgesGz);
    return this.view;
  }

  /** Up to five names like `name` (shared/declfind.ts, `guessNames`). */
  guess(v: View, name: string): string[] {
    return guessNames(v.g, v.index, name);
  }

  /** A declaration by its full name, or the answer that there is none (with what was meant). A
   *  name the graph folds into a declaration is that declaration (`folded` says so). */
  find(v: View, name: string | null | undefined, param = "name"): number | Answer {
    if (typeof name !== "string" || !name.trim())
      return fail(400, `${param} is missing.`, `Give ${param}=<a declaration's full name>; GET /api/agent/search?q=<words> finds one.`);
    const i = v.g.byName.get(name.trim()) ?? this.foldedAt(v, name.trim());
    if (i !== undefined) return i;
    const guesses = this.guess(v, name.trim());
    return fail(404, `There is no declaration ${name} in the graph.`, guesses.length ? `Did you mean ${guesses[0]}? Names are full, as the search gives them.` : "Search for it: GET /api/agent/search?q=<words>.", { didYouMean: guesses });
  }

  /** The declaration a name the graph has no node for is folded into (shared/declfind.ts,
   *  `foldedAt`). */
  private foldedAt(v: View, name: string): number | undefined {
    return foldedAt(v.g, name);
  }

  /** What an answer about `asked` says when that name is folded into declaration `i`. */
  folded(v: View, asked: string | null | undefined, i: number): Record<string, unknown> {
    const unit = v.g.nodes[i].name;
    const a = asked?.trim();
    if (!a || a === unit) return {};
    const how = v.g.foldedInto.get(a) === i
      ? `Lean generated it from the command that writes ${unit}, and it is part of that unit`
      : `it is generated beside ${a.slice(0, a.lastIndexOf("."))} (a constructor, recursor, field or the like) and folded into ${unit}`;
    return { asked: a, foldedInto: unit, foldedNote: `${a} is not a declaration of the graph: ${how}. This answer is about ${unit}; GET /api/agent/print?name=${encodeURIComponent(a)} shows what Lean made of ${a}.` };
  }

  /** A declaration in a list: enough to tell it from the others. */
  brief(v: View, i: number): { name: string; kind: string; module: string; external?: true; display?: string; grammar?: true } {
    const n = v.g.nodes[i];
    return {
      name: n.name,
      kind: n.kind,
      module: n.module,
      ...(v.g.isExt(i) ? { external: true as const } : {}),
      // a notation unit: what the page calls it, and whether it only declares grammar
      ...(n.display ? { display: n.display } : {}),
      ...(v.g.isGrammar(i) ? { grammar: true as const } : {}),
    };
  }

  /** Whether a declaration is trusted without review, and what trusts it: the prefixes that cover
   *  it, or "standard axiom". */
  trust(v: View, i: number): { trusted: boolean; trustedBy: string[] } {
    const n = v.g.nodes[i];
    const d = this.world.review.data;
    if (STANDARD_AXIOMS.includes(n.name)) return { trusted: true, trustedBy: [STANDARD] };
    // any other axiom needs review, whatever prefix its module is under (ReviewSpec decision 3)
    if (nonStandardAxiom(v.g, i)) return { trusted: false, trustedBy: [] };
    const by = trustedBy(d, n.name, n.module, v.g.isExt(i));
    return { trusted: by.length > 0, trustedBy: by };
  }

  /** Whether a declaration's file is not the text it was compiled from (its place, statement and
   *  hash are about the compiled one), and the file's lines; null where there is no file. */
  file(v: View, module: string): { rel: string; lines: string[]; edited: boolean; hash: string } | null {
    // the file the graph was read from, of a module of the graph: no other file is ever read
    const rel = v.modules.get(module)?.file;
    if (!rel) return null;
    let text: string;
    try {
      text = readFileSync(join(this.world.project.root, rel), "utf8");
    } catch {
      return null;
    }
    const compiled = v.modules.get(module)?.compiled ?? null;
    const hash = lakeTextHash(text);
    return { rel, lines: text.split("\n"), edited: !!compiled && hash !== compiled, hash };
  }

  /** The context declaration `name` of `module` is written in, as the elaborator has it (the usage
   *  pass), when the file is the text it elaborated; null otherwise, and the text is read. */
  exact(module: string, name: string, f: { edited: boolean; hash: string }): FileContext | null {
    return f.edited ? null : exactContext(this.world.contextsOf?.(module), name, f.hash);
  }

  /** An opinion as the API shows it. */
  opinion(o: Opinion, hash: string | undefined, me: Caller): Record<string, unknown> {
    return {
      by: o.by,
      agent: !!o.agent,
      // someone invited by a personal link: the name is theirs (CollabSpec decision 9), unless
      // someone else recorded it for them at the same screen, who is named (ReviewSpec decision 8)
      ...(o.person && !o.recordedBy ? { verified: true } : {}),
      ...(o.recordedBy ? { recordedBy: o.recordedBy.by } : {}),
      verdict: o.verdict,
      ...(o.comment ? { comment: o.comment } : {}),
      at: o.at,
      // about the version there is now, or an earlier one (stale)
      onPresentVersion: fresh(o, hash),
      ...(o.agent && me.kind === "agent" && o.by === me.name ? { yours: true } : {}),
    };
  }

  /** `root`'s key graph over its TCB (shared/keys.ts). */
  keys(v: View, root: number): KeyGraph {
    return keyGraph(v.g, this.world.review.data, root, v.order(root, this.world.review.data).order);
  }

  /** Whether the agent asking has advised on the present version of declaration `i`. */
  advised(v: View, i: number, me: Caller): boolean {
    return this.advisedOn(v.g.nodes[i].name, v.g.nodes[i].hash, me);
  }

  advisedOn(name: string, hash: string | undefined, me: Caller): boolean {
    return me.kind === "agent" && !!me.name && advice(this.world.review.data, name).some((o) => o.by === me.name && fresh(o, hash));
  }

  // ---------------------------------------------------------------- the exported document

  /** The build the document of view `rec` is of (ExportSpec decision 16): the view's own where the
   *  request names none — the past build it is kept at, if it is (HistorySpec decision 19) — else
   *  the one `raw` names, as the Time Machine shows a view at another build than its own (null, 0 or
   *  the latest's id: the latest). Null for the latest build; or the answer why it cannot be had. */
  private exportAt(rec: ViewData, raw: unknown): number | null | Answer {
    if (raw === undefined || raw === "") return this.world.views?.pastOf(rec) ?? null;
    if (raw === null || raw === 0 || raw === "0" || raw === "null" || raw === "latest") return null;
    const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id < 0) return fail(400, "version is a snapshot's id, or null for the latest build.", "GET /api/agent/history lists the snapshots; leave version out for the view's own build.");
    const h = this.world.history;
    if (!h?.get(id)) return fail(404, `There is no snapshot ${id}.`, "GET /api/agent/history lists them; leave version out for the view's own build.");
    return id === h.latest()?.id ? null : id;
  }

  /** The build a document's title says (ViewSpec decision 25), for view `rec` printed at `at`
   *  (exportAt; `raw` what the request named): that build where it is a past one; the build the view
   *  is kept at where the request named none, as its title says it everywhere; none for the latest
   *  named. */
  private titleVersion(rec: ViewData, at: number | null, raw: unknown): number | undefined {
    return at ?? (raw === undefined || raw === "" ? rec.version : undefined);
  }

  /** The exported document's input as a request sends it, read and checked: the view, the settings
   *  and the build (ExportSpec decisions 7, 12 and 16), the view's board as its page draws it (the
   *  owner's decisions of 2026-10-12: the document's order, and the notes it shows) and what the
   *  figures of those notes need of the library; or the answer why not. What was asked of a
   *  document until 2026-10-09 — targets, a preset, a content — is refused, and told what to ask
   *  instead. */
  private async docInput(view: unknown, settings: unknown, retired: Record<string, unknown> = {}, version?: unknown): Promise<{ input: DocInput } | Answer> {
    const old = ["targets", "preset", "content"].filter((k) => retired[k] !== undefined);
    if (old.length) return fail(400, `A document is a view's now (2026-10-09): ${old.join(", ")} ${old.length === 1 ? "is" : "are"} no longer taken.`, VIEW_HINT);
    const v = this.graph();
    if (!(v instanceof View)) return v;
    if (typeof view !== "string" || !view) return fail(400, "view is the id of the view to export.", VIEW_HINT);
    const rec = this.world.views?.book.get(view);
    if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them; POST /api/agent/views/open {scope} opens one on a query.");
    const at = this.exportAt(rec, version);
    if (at !== null && typeof at === "object") return at;
    const st = readSettings(settings);
    if ("error" in st) return fail(400, `${st.error}.`, `Settings: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}.`);
    const tv = this.titleVersion(rec, at, version);
    const docView: DocView = {
      id: rec.id,
      name: rec.name,
      ...(rec.targets ? { targets: [...rec.targets] } : {}),
      scope: rec.scope,
      clustering: rec.clustering,
      hidden: [...rec.hidden[rec.clustering]],
      authors: this.authorsOf(rec, at, v),
      ...(tv !== undefined ? { version: tv } : {}),
    };
    // the notes it may print, and what their images and clips need of the library
    const notes = this.world.views?.book.notes ?? [];
    const files = await docFiles(this.world.library, [...notes, ...(rec.notes ?? [])].map((n) => n.carries));
    if (at !== null) return this.pastInput(v, at, rec, docView, st.settings, files);
    const root = this.world.project.root;
    // each module's text as it is now, read once per document
    const source = (module: string): DocSource | null => {
      const m = v.modules.get(module);
      const rel = this.world.project.files.get(module) ?? m?.file;
      if (!rel) return null;
      try {
        const text = readFileSync(join(root, rel), "utf8");
        const hash = lakeTextHash(text);
        return { lines: text.split("\n"), edited: !!m?.compiled && hash !== m.compiled, contexts: this.world.contextsOf?.(module) ?? null, hash };
      } catch {
        return null;
      }
    };
    const review = this.world.review.data;
    return {
      input: {
        g: v.g,
        review,
        view: docView,
        settings: st.settings,
        source,
        fileOf: (module) => v.modules.get(module)?.file ?? null,
        // a branch's build is of its commit, not of what is checked out meanwhile (DeploySpec)
        build: { fingerprint: this.world.graph?.fingerprint ?? null, commit: shownOr(this.world.shownCommit?.(), root) },
        ...(tv !== undefined ? { titles: titleContext(this.world) } : {}),
        board: boardSpots({ g: v.g, review, rec, memory: this.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null, whole: v.meta.layouts?.[rec.clustering], notes }),
        files,
      },
    };
  }

  /** The input of the document of view `rec` at past build `at` (ExportSpec decision 16): its
   *  board's graph is that build's past graph, as the page makes it (server/pastdoc.ts), the review
   *  read there under the names then too, the board laid out as the Time Machine lays it out; its
   *  texts that build's, as the history keeps them. */
  private pastInput(v: View, at: number, rec: ViewData, view: DocView, settings: DocInput["settings"], files: DocInput["files"]): { input: DocInput } | Answer {
    const h = this.world.history;
    if (!h) return fail(404, "This server keeps no history: it serves a saved graph, and has no past build to print.", "Export the view at the latest build: version null.");
    // the texts of a build kept before the history kept them are found once, at start (HistorySpec
    // decision 22): until then none would print
    if (h.sourcesOf(at) === null)
      return fail(503, `The source texts of snapshot ${at} are still being looked for: the server finds those of the builds kept before it kept texts once, as it starts.`, "Ask again in a few seconds.", { retryAfter: 5 }, { "retry-after": "5" });
    const b = this.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
    if (!b) return fail(404, `There is no snapshot ${at}.`, "GET /api/agent/history lists them.");
    const s = b.info;
    const c = s.commit;
    const review = reviewThen(this.world.review.data, b.past.nowName);
    const board = boardSpots({
      g: b.past.graph,
      review,
      rec,
      memory: this.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null,
      whole: v.meta.layouts?.[rec.clustering],
      past: { snapshot: at, nowName: b.past.nowName, now: v.g, nowReview: this.world.review.data },
      notes: this.world.views?.book.notes ?? [],
    });
    return {
      input: {
        g: b.past.graph,
        review,
        view,
        settings,
        source: b.source,
        fileOf: b.fileOf,
        build: { fingerprint: s.fingerprint, commit: c && { hash: c.hash, branch: c.branch, ...(c.dirty ? { dirty: true } : {}), ...(c.guessed ? { guessed: true } : {}) }, toolchain: s.toolchain },
        past: { snapshot: at, at: s.at, when: fullWhen(s.at), ...(s.approx ? { approx: true } : {}) },
        titles: titleContext(this.world),
        board,
        files,
      },
    };
  }

  /** The people who left a trace on view `rec`, in the order of their first (ExportSpec decision 15;
   *  shared/doc/authors.ts): from its record, who dropped its pins, and the timeline; and the review
   *  of what its document prints at build `at` (null: the latest), the declarations of the project it
   *  holds on that build's graph `v` or its past graph (the owner's decision, 2026-10-10). Someone
   *  invited by a personal link by the name they go by now, as the server's links say it, else the
   *  review's logs. */
  private authorsOf(rec: ViewData, at: number | null, v: View): string[] {
    const people = new Map((this.world.people?.() ?? []).map((p) => [p.id, p.name]));
    const logs = this.world.review.data.people;
    const nameOf = (id: string) => people.get(id) ?? (Object.hasOwn(logs, id) ? logs[id].name : null);
    const past = at === null ? null : this.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
    const g = past ? past.past.graph : v.g;
    const d = past ? reviewThen(this.world.review.data, past.past.nowName) : this.world.review.data;
    const set = evaluate(rec.scope, { g, review: d });
    const held: string[] = [];
    for (let i = 0; i < g.projectCount; i++) if (set[i]) held.push(g.nodes[i].name);
    // the items it shows (AttachmentSpec decision 17, the owner's of 2026-10-11): every note of the
    // project on the Project; elsewhere what its scope gives, against that build's clusters, the
    // links and the declarations notes are attached to as that build names them, and what was added
    // to it, less what was taken out
    const shown = itemsShownOn(this.world.views?.book.notes ?? [], { all: fixedScope(rec), items: rec.items }, rec.clustering, g.nodes.filter((_, i) => set[i]), g.nodes, d.links, past?.past.nowName);
    const traces = viewTraces(rec, this.world.views?.book.authors.get(rec.id), this.world.timeline.events, shown);
    return authorsOf([...traces, ...reviewTraces(d, held)], nameOf, [SERVER_WRITER.name]);
  }

  /** What heads the document of view `view` (ExportSpec decisions 14 and 15) at the build `version`
   *  names (decision 16; left out, the view's own): its title and its author line as they print, for
   *  the page's Export window (GET /api/export/head). */
  exportHead(view: string, version?: unknown): Answer {
    const rec = view ? this.world.views?.book.get(view) : undefined;
    if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them.");
    const at = this.exportAt(rec, version);
    if (at !== null && typeof at === "object") return at;
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const authors = this.authorsOf(rec, at, v);
    const { version: _kept, ...base } = rec;
    const tv = this.titleVersion(rec, at, version);
    return ok({ view: rec.id, title: docTitle({ ...base, ...(tv !== undefined ? { version: tv } : {}) }, titleContext(this.world)), author: authorLine(authors), authors });
  }

  /** The outline of the document of view `view` at the build `version` names (ExportSpec decision
   *  18; left out, the view's own): its sections, declarations and notes in the document's order,
   *  without their text, from the board as its page draws it (as `document` reads it). What the
   *  page's linear form draws (GET /api/export/outline); a view too large to print has one too. */
  exportOutline(view: string, version?: unknown): Answer {
    const rec = view ? this.world.views?.book.get(view) : undefined;
    if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them.");
    const at = this.exportAt(rec, version);
    if (at !== null && typeof at === "object") return at;
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const notes = this.world.views?.book.notes ?? [];
    const memory = this.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null;
    const whole = v.meta.layouts?.[rec.clustering];
    let g = v.g;
    let review = this.world.review.data;
    let past: Parameters<typeof boardSpots>[0]["past"];
    if (at !== null) {
      const b = this.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
      if (!b) return fail(404, `There is no snapshot ${at}.`, "GET /api/agent/history lists them.");
      past = { snapshot: at, nowName: b.past.nowName, now: v.g, nowReview: review };
      g = b.past.graph;
      review = reviewThen(review, b.past.nowName);
    }
    const set = evaluate(rec.scope, { g, review });
    const plan = planDoc(g, set, rec.clustering, rec.hidden[rec.clustering] ?? []);
    const board = boardSpots({ g, review, rec, memory, whole, notes, ...(past ? { past } : {}) });
    return ok({ view: rec.id, ...(at !== null ? { version: at } : {}), outline: outlineOf(plan, g, board) });
  }

  /** The exported document's model (ExportSpec decision 6) of view `view` with `settings` at the
   *  build `version` names (decision 16; left out, the view's own), as a request sends them: what
   *  the page's Export and an agent typeset (POST /api/export, POST /api/agent/export), and what
   *  agents read as JSON (GET /api/agent/export). `retired`: the rest of the request, where what is
   *  no longer taken is looked for. */
  async document(view: unknown, settings: unknown, retired: Record<string, unknown> = {}, version?: unknown): Promise<{ doc: DocModel; notes: string[] } | Answer> {
    const r = await this.docInput(view, settings, retired, version);
    if (!("input" in r)) return r;
    try {
      const doc = buildDoc(r.input);
      // what the document does not say of how it was made (decision 8), and of its order and figures
      const { board, files } = r.input;
      const notes = [...docNotes(doc), ...(board?.fresh ? [FRESH_BOARD] : []), ...(files ? figureNotes(board?.notes ?? [], r.input.review, files) : [])];
      return { doc, notes };
    } catch (e) {
      // a view of nothing of the project, or of more than a document prints
      if (e instanceof DocInputError) return fail(400, `${e.message}.`, VIEW_HINT);
      throw e;
    }
  }

  /** Typeset a document (ExportSpec decisions 6 and 11): the job that does it, at once — 202 while
   *  it runs, 200 once done (the same document asked again, or one the cache holds). For the page's
   *  POST /api/export and the agents' POST /api/agent/export alike; an agent (`agent`, the caller)
   *  has one job running at most, and is answered 429 while it has, with that job. */
  async exportStart(body: unknown, agent: Caller | null): Promise<Answer> {
    const ex = this.exporter;
    if (!ex) return fail(404, "This server does not export documents.", "GET /api/agent/export gives the document's model as JSON.");
    if (!ex.available()) return fail(503, "XeLaTeX is not installed on the server, so documents cannot be typeset here.", "GET /api/agent/export gives the document's model as JSON.");
    const owner = agent ? jobOwner(agent) : null;
    const was = owner ? this.exportJobs.get(owner) : undefined;
    const busy = was ? ex.job(was) : null;
    if (busy?.state === "running")
      return fail(429, "You have a document being typeset already: one at a time.", `Wait for it (GET /api/agent/export/job?id=${busy.id}), then ask again.`, { job: busy }, { "retry-after": "5" });
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const d = await this.document(b.view, b.settings, b, b.version);
    if (!("doc" in d)) return d;
    // another request of the same agent may have started one while this was being built
    const raced = owner ? this.exportJobs.get(owner) : undefined;
    const running = raced && raced !== was ? ex.job(raced) : null;
    if (running?.state === "running")
      return fail(429, "You have a document being typeset already: one at a time.", `Wait for it (GET /api/agent/export/job?id=${running.id}), then ask again.`, { job: running }, { "retry-after": "5" });
    const job = ex.compile(renderLatex(d.doc), d.notes, figureFiles(d.doc, this.world.library));
    if (owner && job.state === "running") this.exportJobs.set(owner, job.id);
    return { status: job.state === "running" ? 202 : 200, body: { job, ...(agent ? jobLinks(job) : {}) } };
  }

  /** How a typesetting job is doing, by its id; for agents with what to ask next. */
  exportJob(id: string, agent: boolean): Answer {
    const job = this.exporter?.job(id) ?? null;
    if (!job) return fail(404, "There is no such document: it was never asked for, or has left the cache.", "POST /api/agent/export starts one; the same request again finds it while it is kept.");
    return ok({ job, ...(agent ? jobLinks(job) : {}) });
  }

  /** A file of a typeset document: the PDF, the .tex, the style file, or the sources' zip. 409
   *  while it is still being typeset (with Retry-After) or where it failed, 404 where it is unknown
   *  or has left the cache. */
  exportFile(id: string, what: string | null): Answer {
    const w = what ?? "pdf";
    if (w !== "pdf" && w !== "tex" && w !== "sty" && w !== "zip") return fail(400, "what is pdf, tex, sty or zip.", "pdf (the default): the document; tex and sty: its LaTeX and the style file; zip: everything needed to typeset it again.");
    const ex = this.exporter;
    const job = ex?.job(id) ?? null;
    if (!ex || !job) return fail(404, "There is no such document: it was never asked for, or has left the cache.", "POST /api/agent/export starts one; the same request again finds it while it is kept.");
    if (job.state === "running") return fail(409, "That document is still being typeset.", `Ask again in a few seconds, or wait for GET /api/agent/export/job?id=${job.id} to say done.`, { job }, { "retry-after": "2" });
    if (job.state === "failed") return fail(409, `That document could not be typeset: ${(job.error ?? "XeLaTeX failed").replace(/\.$/, "")}.`, "Its job has the end of XeLaTeX's log (GET /api/agent/export/job).", { job });
    const f = ex.file(id, w);
    if (!f) return fail(404, "That document has left the cache.", "Ask for it again: POST /api/agent/export.");
    return { status: 200, body: null, file: f };
  }

  private async exportGet(a: Ask): Promise<Answer> {
    const raw = a.query.get("settings");
    let settings: unknown;
    if (raw) {
      try {
        settings = JSON.parse(raw);
      } catch {
        return fail(400, "settings is not JSON.", 'Send settings as a JSON object, URL-encoded, e.g. {"paper":"letter"}.');
      }
    }
    const r = await this.document(a.query.get("view") ?? undefined, settings, Object.fromEntries(a.query), a.query.get("version") ?? undefined);
    return "doc" in r ? ok(r.doc) : r;
  }

  private exportPost(a: Ask): Promise<Answer> | Answer {
    const no = needAgent(a.caller);
    if (no) return no;
    return this.exportStart(a.body, a.caller);
  }

  private exportFileGet(a: Ask): Answer {
    // an MCP server from before it saved files (0.3.0) relays `saveTo` as a parameter and would hand the
    // model a PDF as text: it is told to update instead
    const what = a.query.get("what") ?? "pdf";
    if (a.query.has("saveTo") && (what === "pdf" || what === "zip"))
      return fail(400, "Your MCP server cannot save files yet.", "Download it again (GET /api/agent/mcp, as GET /api/agent/mcp/install says), restart your client, then save it again (the export tool, action file).");
    return this.exportFile(a.query.get("id") ?? "", what);
  }

  // ---------------------------------------------------------------- reading

  /** Who is on the page and where each one is (AgentSpec decision 7): every person, with the place
   *  of their liveliest page, and the agents present; and how many private readers are here, who
   *  are not listed (CollabSpec decision 8). With `wait`, the answer waits until someone comes,
   *  goes or moves (the revision is not `since` any more), up to that many seconds. */
  private async companion(a: Ask): Promise<Answer> {
    const P = this.world.presence;
    const rawSince = a.query.get("since");
    const wait = clampInt(a.query.get("wait"), 0, 0, MAX_COMPANION_WAIT);
    let since: number | null = null;
    if (rawSince !== null && rawSince.trim() !== "") {
      since = Number(rawSince);
      if (!Number.isInteger(since) || since < 0) return fail(400, "since is a revision: the rev of an earlier answer.", "GET /api/agent/companion answers with rev; ask ?wait=30&since=<that rev> to wait for the next change.");
    }
    if (wait > 0) await P.waitChange(since ?? P.rev, wait * 1000);
    const mine = a.caller.kind === "agent" && a.caller.name ? agentKey(whoOf(a.caller)) : null;
    const peers = P.list();
    const people = new Map<string, Peer[]>();
    const agents: Record<string, unknown>[] = [];
    for (const p of peers) {
      if (p.agent) {
        agents.push({ name: p.name, idle: p.idle, ...(p.talk ? { state: p.talk.state, ...(p.talk.status ? { status: p.talk.status } : {}), lastSeen: p.talk.lastSeen } : {}), ...(p.id === mine ? { you: true } : {}), place: p.view ? this.placeOf(p.view) : null });
        continue;
      }
      const key = p.name ? `n:${p.name}` : `s:${p.id}`;
      people.set(key, [...(people.get(key) ?? []), p]);
    }
    const out = [...people.values()].map((ps) => {
      ps.sort((x, y) => Number(x.idle) - Number(y.idle));
      const p = ps[0];
      return { name: p.name, ...(p.verified ? { verified: true } : {}), idle: ps.every((x) => x.idle), pages: ps.length, place: p.view ? this.placeOf(p.view) : null };
    });
    out.sort((x, y) => Number(x.idle) - Number(y.idle) || (x.name ?? "\uffff").localeCompare(y.name ?? "\uffff"));
    // the person who shared with this agent, and whether they are here: the prompt does not say
    // where they are, this does
    const by = a.caller.token?.by;
    const sharedBy = by ? { name: by, here: out.some((p) => p.name === by) } : null;
    return ok({
      rev: P.rev,
      ...(since !== null ? { changed: P.rev !== since } : {}),
      now: new Date().toISOString(),
      ...(sharedBy ? { sharedBy } : {}),
      ...(sharedBy && !sharedBy.here ? { sharedByNote: `${by}, who shared with you, has no page open now: go on with what they asked; ?wait=60&since=<rev> tells you when someone comes.` } : {}),
      people: out,
      privateCount: P.privateCount(),
      agents,
      note: "privateCount: how many people are here privately — not listed, not followable, nothing known of where they are. Each person's place is that of their liveliest page: the view, the tool (how a click selects), what is selected (a query), the declaration their panel tells of, whether its source window is open (and collapsed), the source windows they pinned (pinned: declaration, collapsed), and, where their page says them, Activity (open, kind, who, mine: whose targets), the lost-and-found (lostAndFound.open), the colouring (kind or status), edges — all of which those following them see too. idle: no input for five minutes, or the page in the background. verified: invited by a personal link, so the name is theirs. To look where someone looks, POST /api/agent/view with their view and declaration; ?wait=<s>&since=<rev> waits for the next change (at most 60 s).",
    });
  }

  /** A page's or an agent's place, as the companion tells it (and a conversation's message, where
   *  its writer was): with its source windows, the one following the selection and those pinned,
   *  each collapsed or not (decided 2026-10-09: what a follower's windows mirror), the build it
   *  browses in the Time Machine (HistorySpec decision 18), and what else those following it see
   *  (CollabSpec decision 4, the owner's decision of 2026-10-11): Activity and its filters, the
   *  lost-and-found, the colouring, the edges — each where the page says it (an agent says none). */
  placeOf(v: PresenceView): {
    view: string;
    viewTitle: string | null;
    mode: string;
    tool: string;
    selection: string | null;
    declaration: string | null;
    source: boolean;
    sourceCollapsed: boolean;
    pinned: { declaration: string; collapsed: boolean }[];
    inWords: string;
  } & Record<string, unknown> {
    const on = v.view ? this.world.views.book.get(v.view) : undefined;
    const titles = titleContext(this.world);
    // a view nobody keeps that the server forgot is called by its query, as a page calls it
    const title = on ? viewTitle(on, titles) : v.scope ? titleOfScope(v.scope, titles) : v.view ? null : "Project";
    const tool = TOOL_NAMES[v.mode] ?? v.mode;
    const words =
      (on && on.id !== PROJECT ? `the view ${JSON.stringify(title)}` : v.scope ? `a view on ${v.scope}` : "the Project view") +
      (on?.targets ? `, ${on.targets.join(" and ")}'s view` : "") +
      (v.focus !== undefined ? (v.focus ? `, focused on ${v.focus} for themselves` : ", with no focus for themselves") : "") +
      (v.sel ? `, ${v.source ? "reading the source of" : "looking at"} ${v.sel}` : "") +
      (v.selection ? `, with ${v.selection} selected` : "") +
      (v.pinned?.length ? `, with the source of ${v.pinned.map((w) => w.decl).join(", ")} pinned` : "");
    const built = v.history ? this.world.history?.get(v.history.snapshot)?.at ?? null : null;
    const then = v.history ? `, in the Time Machine at snapshot ${v.history.snapshot}${built ? ` (built ${built})` : ""}` : "";
    // the panels and the board besides, in words where they are not as a page starts
    const a = v.activity;
    const shownBy = a?.open
      ? `, with Activity open${a.kind !== "all" ? ` on ${ACTIVITY_WORDS[a.kind]}` : ""}${a.who !== "all" ? `, ${a.who} only` : ""}${a.mine ? `, on ${a.mine}'s targets` : ""}`
      : v.lostFound?.open
        ? ", with the lost-and-found open"
        : "";
    const drawn =
      (v.scheme ? `, coloured by ${v.scheme}` : "") + (v.edges === false ? ", edges hidden" : "");
    return {
      view: v.view ?? PROJECT,
      viewTitle: title,
      ...(on?.targets ? { targets: [...on.targets] } : {}),
      ...(v.scope ? { scope: v.scope } : {}),
      mode: v.mode,
      tool,
      selection: v.selection ?? null,
      declaration: v.sel,
      source: v.source,
      sourceCollapsed: v.source && v.sourceCollapsed === true,
      pinned: (v.pinned ?? []).map((w) => ({ declaration: w.decl, collapsed: w.collapsed })),
      ...(v.history ? { history: { snapshot: v.history.snapshot, built } } : {}),
      ...(v.activity ? { activity: { ...v.activity } } : {}),
      ...(v.lostFound ? { lostAndFound: { open: v.lostFound.open } } : {}),
      ...(v.scheme ? { colouring: v.scheme } : {}),
      ...(v.edges !== undefined ? { edges: v.edges } : {}),
      inWords: words + then + shownBy + drawn + ".",
    };
  }

  private activity(a: Ask): Answer {
    const since = (a.query.get("since") ?? "").trim();
    const limit = clampInt(a.query.get("limit"), 100, 1, 1000);
    let after = "";
    if (since) {
      if (/^\d+$/.test(since)) {
        // an event id: what came after it
        const e = this.world.timeline.events.find((x) => x.id === Number(since));
        after = e?.at ?? "";
      } else if (!Number.isNaN(Date.parse(since))) after = new Date(since).toISOString();
      else return fail(400, "since is neither a time nor an event id.", "Give since=<ISO time>, e.g. the `now` of your last answer, or an event's id.");
    }
    const d = this.world.review.data;
    const out: Record<string, unknown>[] = [];
    // what the review's logs record, as the page reads it
    for (const [name, ops] of Object.entries(d.opinions))
      for (const o of ops) {
        out.push({ at: o.at, kind: "opinion", by: o.by, ...(o.recordedBy ? { recordedBy: o.recordedBy.by } : {}), agent: !!o.agent, name, verdict: o.verdict, ...(o.comment ? { comment: o.comment } : {}), ...(o.withdrawn ? { withdrawn: true } : {}) });
        // its withdrawal (ReviewSpec decision 9): whose it was, and who typed it for them
        const w = o.withdrawn;
        if (w) out.push({ at: w.at, kind: "withdrawal", by: o.by, ...(w.recordedBy ? { recordedBy: w.recordedBy.by } : {}), agent: !!o.agent, name, verdict: o.verdict, of: o.at });
      }
    // what an agent did at level full is marked as an agent's, as its advice is
    for (const [name, t] of Object.entries(d.targets)) out.push({ at: t.at, kind: "target", by: t.by, agent: !!t.agent, name });
    for (const [target, marks] of Object.entries(d.keys)) for (const [name, m] of Object.entries(marks)) out.push({ at: m.at, kind: "key", by: m.by, agent: !!m.agent, target, name });
    // the library's files and links (AttachmentSpec.md), as the review's history of them keeps
    // them: what was done, and what to — a file by its hash and its title then, a link by its id,
    // subject, label and file, an edit with what changed
    const WHAT = { file: "added", "file-edit": "edited", "file-archive": "archived", "file-restore": "restored", link: "made", "link-edit": "edited", unlink: "removed" } as const;
    for (const h of d.libraryHistory ?? []) {
      const { op, at, by, agent, person: _person, ...rest } = h;
      out.push({ at, kind: "sha" in h ? "file" : "link", what: WHAT[op], by, agent: !!agent, ...rest });
    }
    const undone = new Map<number, number>();
    for (const e of this.world.timeline.events) if (e.kind === "undo") undone.set(e.of, e.id);
    for (const e of this.world.timeline.events) {
      // a note of the kind agents left about a declaration before notes were on the board: not read
      if (e.kind === "note" && !("what" in e)) continue;
      // what someone did says whether an agent did it
      const who = "by" in e ? { agent: !!(e as { agent?: true }).agent } : {};
      if (e.kind === "layout") {
        // the operations themselves are the server's business: what moved, and whether it was undone
        const { ops, undo: _u, ...rest } = e;
        out.push({ ...rest, ...who, moved: ops.flatMap((o) => (o.op === "clear" ? [] : [o.key])).slice(0, 100), undoneBy: undone.get(e.id) ?? null });
      } else out.push({ ...withoutReasons(e), ...who });
    }
    const about = (a.query.get("name") ?? "").trim();
    // a note is about the declarations it names; a link, about the declaration it is on, or was on
    // before an edit
    const on = `decl(${about})`;
    const kept = out.filter((e) => (!after || (e.at as string) > after) && (!about || e.name === about || e.target === about || (e.kind === "note" && typeof e.text === "string" && noteNames(e.text).includes(about)) || (e.kind === "link" && (e.subject === on || e.wasSubject === on)))).sort((x, y) => ((x.at as string) < (y.at as string) ? -1 : (x.at as string) > (y.at as string) ? 1 : 0));
    return ok({ now: new Date().toISOString(), events: kept.slice(-limit), more: Math.max(0, kept.length - limit) });
  }

  private place(a: Ask): Answer {
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const mode = (a.query.get("mode") ?? "namespace") as ClusterMode;
    if (!CLUSTER_MODES.includes(mode)) return fail(400, `mode ${mode} is neither namespace nor module.`, "Leave it out for namespace, the page's default.");
    const hidden = this.projectHidden(mode);
    const L = v.projectLayout(mode, hidden);
    const near = a.query.get("near");
    const point = near === null ? null : near.split(",").map(Number);
    if (point && (point.length !== 2 || !point.every(Number.isFinite))) return fail(400, "near is x,y: two numbers in the parent's coordinates.", "e.g. near=12.5,-40: the siblings nearest that place come first.");
    const cluster = a.query.get("cluster");
    let me: { kind: "node" | "cluster"; index: number; key: string; parent: number; r: number; laidOut: [number, number] };
    if (cluster !== null) {
      const c = L.clusters.findIndex((x) => x.key === cluster);
      if (c < 0) return fail(404, `There is no cluster ${cluster} by ${mode}.`, "Clusters are named by their full path, e.g. a namespace; GET /api/agent/place?name=<declaration> names its cluster.");
      const cl = L.clusters[c];
      me = { kind: "cluster", index: c, key: cl.key, parent: cl.parent, r: cl.r, laidOut: [cl.lx, cl.ly] };
    } else {
      const i = this.find(v, a.query.get("name"));
      if (typeof i !== "number") return i;
      me = { kind: "node", index: i, key: v.g.nodes[i].name, parent: L.cluster[i], r: LEAF_R, laidOut: [L.lx[i], L.ly[i]] };
    }
    const pin = this.pinOf(mode, me.kind, me.key);
    // what else is in the parent, each where it is drawn: its pin, or where the layout put it
    const inside = v.inside(mode, hidden, me.parent);
    const sibs = [
      ...inside.nodes.filter((j) => me.kind !== "node" || j !== me.index).map((j) => ({ kind: "node" as const, key: v.g.nodes[j].name, of: v.g.nodes[j].kind, r: LEAF_R, laidOut: [L.lx[j], L.ly[j]] as [number, number] })),
      ...inside.clusters.filter((k) => me.kind !== "cluster" || k !== me.index).map((k) => ({ kind: "cluster" as const, key: L.clusters[k].key, of: null, r: L.clusters[k].r, laidOut: [L.clusters[k].lx, L.clusters[k].ly] as [number, number] })),
    ].map((x) => {
      const p = this.pinOf(mode, x.kind, x.key);
      return { ...x, pin: p, at: p.at ?? x.laidOut };
    });
    const from = (point as [number, number] | null) ?? pin.at ?? me.laidOut;
    // nearest first: what a pin there would crowd. The gap is the free space between the two
    // circles, were this one at `from`; below zero they overlap
    const gap = (x: { at: [number, number]; r: number }) => Math.hypot(x.at[0] - from[0], x.at[1] - from[1]) - x.r - me.r;
    sibs.sort((x, y) => gap(x) - gap(y));
    const limit = clampInt(a.query.get("limit"), 100, 0, 2000);
    const room = roomIn(L, me.parent, me.r);
    return ok({
      mode,
      kind: me.kind,
      key: me.key,
      parent: { ...this.parentOf(L, me.parent), room: shown(roomIn(L, me.parent, 0)) },
      r: me.r,
      room: shown(room),
      laidOut: me.laidOut,
      pinned: pin.at,
      ...(pin.at ? { pinnedBy: pin.by } : {}),
      siblings: {
        total: sibs.length,
        pinned: sibs.filter((x) => x.pin.at).length,
        nearestTo: from,
        more: Math.max(0, sibs.length - limit),
        list: sibs.slice(0, limit).map((x) => ({
          kind: x.kind,
          key: x.key,
          ...(x.of ? { declKind: x.of } : {}),
          r: x.r,
          at: x.at,
          gap: Math.round(gap(x) * 10) / 10,
          pinned: !!x.pin.at,
          ...(x.pin.at ? { pinnedBy: x.pin.by, laidOut: x.laidOut } : {}),
        })),
      },
    });
  }

  private parentOf(L: Layout, c: number): { cluster: string | null; r: number | null } {
    return c >= 0 ? { cluster: L.clusters[c].key, r: L.clusters[c].r } : { cluster: null, r: null };
  }

  /** A pin, and who dropped it as far as the server knows (null: not recorded — it was dropped
   *  before the server kept who). */
  /** The levels the Project view hides by `mode` (ViewSpec decision 24); none where the world has
   *  no views. */
  private projectHidden(mode: ClusterMode): string[] {
    return this.world.views?.book.get(PROJECT)?.hidden[mode] ?? [];
  }

  private pinOf(mode: ClusterMode, kind: "node" | "cluster", key: string): { at: [number, number] | null; by: { name: string | null; agent: boolean; at: string } | null } {
    const P = this.world.places.data.layouts[mode];
    const set = kind === "node" ? P.nodes : P.clusters;
    if (!Object.hasOwn(set, key)) return { at: null, by: null };
    const who = this.world.places.authorOf(mode, kind, key);
    return { at: set[key], by: who ? { name: who.by, agent: !!who.agent, at: who.at } : null };
  }

  // ---------------------------------------------------------------- what people do (level full)

  private viewPost(a: Ask): Answer {
    const no = needAgent(a.caller);
    if (no) return no;
    const me = whoOf(a.caller);
    const b = body(a);
    if (b.leave === true) {
      // an agent with a token that leaves is offline until it listens or asks again — unless its
      // MCP server says it is a session that a newer one replaced, which goes on
      if (a.caller.token && this.world.talk && !this.world.talk.left(a.caller.token.id, a.session ?? null)) return ok({ ok: true, left: false, note: "Another session of your token listens now: it stays." });
      this.world.presence.drop(agentKey(me));
      return ok({ ok: true, left: true });
    }
    const p = this.goingTo(a, b);
    if ("status" in p) return p;
    const { place: clean, temporary } = p;
    this.world.presence.agentBeat(me, clean);
    // what people who follow it see, said in words: the view, whose view it is (ViewSpec decision
    // 29), and the review's focus there — the agent's own, else the view's (decision 28)
    const on = clean.view ? this.world.views.book.get(clean.view) : undefined;
    const review = on?.targets ?? null;
    const focus = clean.focus !== undefined ? clean.focus : on ? focusOf(this.world, on) : null;
    const board =
      (on && on.id !== PROJECT ? `the view ${JSON.stringify(viewTitle(on, titleContext(this.world)))}` : "the Project view: everything") +
      (review ? `, ${review.join(" and ")}'s view` : "") +
      (focus ? `, the review focused on ${focus} with its strip (its whole review set, what the board does not hold shown as visitors)` : "");
    const paperFile = clean.paper ? fileOf(this.world.review.data, clean.paper.file) : null;
    const sel =
      (clean.sel ? `, looking at ${clean.sel}${clean.source ? " with its source open" : ""}` : "") +
      (clean.selection ? `, with ${clean.selection} selected` : "") +
      (paperFile ? `, with the reference window on ${JSON.stringify(paperFile.title)}${clean.paper!.page ? ` at page ${clean.paper!.page}` : ""}${clean.paper!.link ? ", the link lit" : ""}` : "");
    return ok({
      ok: true,
      view: clean,
      reviewView: review,
      followersSee: `${board}${sel}.`,
      ...(temporary ? { temporary: true, note: `${temporary} had no view: you are on a temporary view of its TCB, linked to it, as a person's click on it opens. The link lasts as long as the view: it goes when nobody is on it, unless someone keeps it — pins, folds or names it (views/arrange, views/rename) — and with it the link. POST /api/agent/views/link {id, target} links ${temporary} to another view.` } : {}),
    });
  }

  /** Where the agent would be with the fields of `b` over its own place, each checked as POST view
   *  takes it: where POST view puts it, and what POST view/link makes a link to. */
  private goingTo(a: Ask, b: Record<string, unknown>): { place: PresenceView; temporary: string | null } | Answer {
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const was = this.world.presence.agentView(whoOf(a.caller)) ?? { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
    const next: PresenceView = { ...was, cam: null };
    if (b.mode !== undefined) {
      if (typeof b.mode !== "string" || !Object.hasOwn(TOOL_NAMES, b.mode))
        return fail(400, "mode is plain, deps, tcb, keys or apps.", "deps, tcb and keys are the steps of Rests on: what it uses, its TCB, the key declarations in its TCB; apps is what uses it.");
      next.mode = b.mode;
    }
    /** On a view (ViewSpec.md), as a page is: people following go to it, and a view nobody keeps
     *  lives while the agent is there. */
    const onView = (id: string): Answer | null => {
      const w = this.world.views.book.get(id);
      if (!w) return fail(404, `There is no view ${id}.`, "GET /api/agent/views lists them; POST /api/agent/views/open opens one on a query.");
      Object.assign(next, { view: w.id, scope: w.kept ? null : printQuery(w.scope), clusterMode: w.clustering, tabs: [...new Set([...next.tabs, w.id])].slice(-20) });
      return null;
    };
    if (b.view !== undefined) {
      const bad = b.view === null ? onView(PROJECT) : typeof b.view === "string" ? onView(b.view) : fail(400, "view is a view's id, or null for the Project.", "GET /api/agent/views lists them.");
      if (bad) return bad;
    }
    // a target with no view, asked for (`review`): the view nobody keeps a click on it opens
    let temporary: string | null = null;
    if (b.review !== undefined) {
      // a target's view, the one it is linked to (ViewSpec decision 29), as a click on the target
      // opens it; with none, a view nobody keeps of its TCB, linked to it while it lasts (the owner's
      // decision of 2026-10-11)
      if (b.review === null) {
        if (next.view && this.world.views.book.get(next.view)?.targets) onView(PROJECT);
      } else {
        const t = this.find(v, str(b.review), "review");
        if (typeof t !== "number") return t;
        const target = v.g.nodes[t].name;
        if (!this.world.review.data.targets[target])
          return fail(400, `${target} is not a target: it has no view of its own.`, "GET /api/agent/targets lists the targets; POST /api/agent/views/open opens a view on tcb(<name>) for anything else.");
        const linked = this.world.views.book.viewOf(target);
        if (!linked) temporary = target;
        const bad = onView((linked ?? this.world.views.openTarget(target, a.caller.name, true)).id);
        if (bad) return bad;
        next.mode = "tcb";
      }
    }
    if (b.sel !== undefined) {
      if (b.sel === null) next.sel = null;
      else {
        const j = this.find(v, str(b.sel), "sel");
        if (typeof j !== "number") return j;
        next.sel = v.g.nodes[j].name;
      }
    }
    if (b.selection !== undefined) {
      // what a page selects is a query (web/src/selection.ts): people who follow select the same
      if (b.selection === null) next.selection = null;
      else {
        const hint = "A query's text, its parts joined by or: decl(A.b) or tcb(A.c) or tcb(ns(A.D) except external).";
        if (typeof b.selection !== "string") return fail(400, "selection is a query's text, or null.", hint);
        try {
          next.selection = printQuery(parseQuery(b.selection));
        } catch (e) {
          if (!(e instanceof QueryError)) throw e;
          return fail(400, `selection: at ${e.at + 1}, ${e.message}.`, hint);
        }
      }
    }
    if (b.source !== undefined) next.source = b.source === true;
    // its own focus on its view, as a person's (ViewSpec decision 28): those following it take it;
    // on another view it starts from that view's own
    if (b.focus !== undefined) {
      // a tool's arguments say "view" and "none" where JSON says false and null
      if (b.focus === false || b.focus === "view") delete next.focus;
      else if (b.focus === null || b.focus === "none") next.focus = null;
      else {
        const t = this.find(v, str(b.focus), "focus");
        if (typeof t !== "number") return t;
        const target = v.g.nodes[t].name;
        if (!Object.hasOwn(this.world.review.data.targets, target)) return fail(400, `${target} is not a target: nothing can be focused on it.`, "GET /api/agent/targets lists the targets.");
        next.focus = target;
      }
    } else if (next.view !== was.view) delete next.focus;
    // the reference window shown to those who follow (AttachmentSpec decision 20): a link's place,
    // or a file of the library at a page; null closes it
    if (b.paper !== undefined) {
      const p = paperOf(this.world.review.data, b.paper);
      if (typeof p === "string") return fail(400, p, "paper is {link} (a link's id: its file at its place, lit), or {file, page?} (a file's SHA-256 and a page from 1), or null to close the window.");
      if (p) next.paper = p;
      else delete next.paper;
    }
    return { place: cleanView(next)!, temporary };
  }

  /** A link to a picture of the board (ExportSpec decision 20, drafted 2026-10-15): a recipe
   *  (shared/artrecipe.ts) checked, and resolved against the board of the view it names — the
   *  Project's layout in the view's clustering — so that a name, a target or a cluster the board has
   *  not is refused here rather than drawn as a picture unlike the one meant; the selection it gives
   *  goes in the address, the recipe after it. The page that opens the link resolves it again
   *  against the board it opens on, opens the artwork mode, and saves the files asked for. Nothing
   *  changes here, and the link holds no key. */
  private async artwork(a: Ask): Promise<Answer> {
    const no = needAgent(a.caller);
    if (no) return no;
    const b = body(a);
    const read = readRecipe(b.recipe);
    if ("error" in read) return fail(400, read.error, read.hint);
    const r = read.recipe;
    const save = b.save === undefined || b.save === null ? [] : typeof b.save === "string" ? b.save.split(",").map((k) => k.trim()) : null;
    if (!save || save.some((k) => k !== "png" && k !== "svg")) return fail(400, "save is png, svg or png,svg.", "The files the page saves once the board is ready; left out, none.");
    const v = this.graph();
    if (!(v instanceof View)) return v;
    let sel: string | null = null;
    if (r.selection) {
      const i = this.find(v, r.selection.name, "selection.name");
      if (typeof i !== "number") return i;
      sel = v.g.nodes[i].name;
    }
    const rec = r.view && r.view !== PROJECT ? this.world.views?.book.get(r.view) : undefined;
    if (r.view && r.view !== PROJECT && !rec) return fail(404, `There is no view ${r.view}.`, "GET /api/agent/views lists them; left out, the Project.");
    const L = v.meta.layouts[rec?.clustering ?? "namespace"];
    const res = resolveRecipe(r, {
      clusters: L.clusters,
      clusterOf: (name) => {
        const i = v.g.byName.get(name);
        return i === undefined ? undefined : L.cluster[i];
      },
      targets: Object.keys(this.world.review.data.targets),
      projectCount: v.meta.projectCount,
    });
    if (res.problems.length)
      return fail(404, `The recipe names what the board has not: ${res.problems.join("; ")}.`, "Clusters by key (GET /api/agent/views/view lists a view's), declarations and targets by full name (GET /api/agent/search; the targets: GET /api/agent/targets). A target of the review the graph no longer has is left out unsaid where the recipe does not name it.", { problems: res.problems });
    const address = addressOf({ view: rec ? rec.id : null, scope: null, mode: r.selection?.mode ?? "tcb", selection: null, sel });
    const link = `${a.base ?? ""}/#${address}&${RECIPE_PARAM}=${encodeRecipe(r)}${save.length ? `&${SAVE_PARAM}=${[...new Set(save)].join(",")}` : ""}`;
    const look = res.look;
    return ok({
      ok: true,
      link,
      length: link.length,
      size: [look.w, look.h],
      names: look.labels === "chosen" ? res.named : look.labels,
      targets: look.targets === "chosen" ? look.shownTargets : look.targets,
      selection: sel ? { name: sel, mode: r.selection!.mode ?? "tcb" } : null,
      // names and targets beyond what the artwork carries, left out: said, not refused
      left: res.left,
      note: "It holds no key: it opens for whoever is let in already, or for a script that enters with the key (scripts/artwork-batch.mjs). The page that opens it resolves the recipe again against its board, opens the artwork mode fitted to the whole board, and saves the files asked for on that machine; nothing comes back here.",
    });
  }

  /** A link to what the agent looks at, or to a place it gives over its own, as a person's Share makes
   *  one with Exactly what I see (CollabSpec decision 7, the owner's decision of 2026-10-12): the
   *  address, and after it a snapshot of everything followed, which the page that opens it applies
   *  once. It moves nobody, the agent neither. It holds no key: it opens for whoever is let in. */
  private async viewLink(a: Ask): Promise<Answer> {
    const no = needAgent(a.caller);
    if (no) return no;
    const b = body(a);
    const p = this.goingTo(a, b);
    if ("status" in p) return p;
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const place: Record<string, unknown> = { ...p.place };
    // what a page shows besides, which an agent's own place says nothing of: each as given, checked
    const bool = (k: string): Answer | null => {
      if (b[k] === undefined) return null;
      if (typeof b[k] !== "boolean") return fail(400, `${k} is true or false.`, "Leave it out for what the opener's page shows of its own.");
      place[k] = b[k];
      return null;
    };
    // (proofEdges, said until 2026-10-15, is no more: left as it is, as any word not known)
    const bad = bool("sourceCollapsed") ?? bool("edges");
    if (bad) return bad;
    if (b.lostFound !== undefined) {
      if (typeof b.lostFound !== "boolean") return fail(400, "lostFound is true (open) or false.", "The lost-and-found has no filters.");
      place.lostFound = { open: b.lostFound };
    }
    if (b.scheme !== undefined) {
      if (!SCHEMES.includes(b.scheme as never)) return fail(400, `scheme is ${SCHEMES.join(" or ")}.`, "The legend's colouring: by kind, or by the review's status.");
      place.scheme = b.scheme;
    }
    if (b.activity !== undefined) {
      const o = b.activity && typeof b.activity === "object" ? (b.activity as Record<string, unknown>) : null;
      const kind = o?.kind ?? "all", who = o?.who ?? "all";
      if (!o || typeof o.open !== "boolean" || !ACTIVITY_KINDS.includes(kind as never) || !ACTIVITY_WHO.includes(who as never) || (o.mine !== undefined && (typeof o.mine !== "string" || !validName(o.mine))))
        return fail(400, "activity is {open, kind?, who?, mine?}.", `open: true or false; kind: ${ACTIVITY_KINDS.join(", ")}; who: ${ACTIVITY_WHO.join(", ")}; mine: the name whose targets "My targets" keeps to.`);
      place.activity = { open: o.open, kind, who, ...(o.mine !== undefined ? { mine: o.mine } : {}) };
    }
    if (b.pinned !== undefined) {
      if (!Array.isArray(b.pinned) || b.pinned.length > MAX_PINNED) return fail(400, `pinned is a list of at most ${MAX_PINNED} windows, [{name, collapsed?}].`, "Each a source window pinned on a declaration, the first pinned first.");
      const pinned: { decl: string; collapsed: boolean }[] = [];
      for (const w of b.pinned) {
        const i = this.find(v, w && typeof w === "object" ? str((w as Record<string, unknown>).name) : null, "pinned's name");
        if (typeof i !== "number") return i;
        pinned.push({ decl: v.g.nodes[i].name, collapsed: (w as Record<string, unknown>).collapsed === true });
      }
      place.pinned = pinned;
    }
    if (b.history !== undefined && b.history !== null) {
      const id = b.history;
      if (!Number.isInteger(id) || !this.world.history?.get(id as number)) return fail(404, `There is no snapshot ${String(id)}.`, "history is a snapshot's id (GET /api/agent/history): the link opens the Time Machine at that build; null or left out for none.");
      place.history = { snapshot: id };
    }
    let region = null;
    if (b.region !== undefined && b.region !== null) {
      region = readRegion(b.region);
      if (!region) return fail(400, "region is [x, y, w, h]: a centre and a width and height, in the board's world.", "Leave it out, and the opener's page frames the board as for any link.");
    }
    const view = cleanView(place)!;
    const exact = b.exact !== false;
    // the build a view nobody keeps shows travels with its query, in the address
    const rec = view.view ? this.world.views.book.get(view.view) : undefined;
    const address = addressOf({ ...view, version: rec && !rec.kept ? rec.version ?? null : null });
    const shown = region ? showing(region) : null;
    const snap = exact ? await writeSnapshot({ ...view, cam: shown?.cam ?? null }, shown?.screen ?? null) : null;
    const link = `${a.base ?? ""}/#${address}${snap ? `&snap=${snap}` : ""}`;
    const { tabs: _tabs, cam: _cam, ...carried } = view;
    return ok({
      ok: true,
      link,
      exact,
      carries: exact ? { ...carried, ...(region ? { region } : {}) } : { view: view.view, scope: view.scope, mode: view.mode, selection: view.selection ?? null, sel: view.sel },
      length: link.length,
      note: "It holds no key: it opens for whoever is let in already — the people on this page. Opened, the page shows what it carries once, the region given framed on the opener's screen, and the reader is free after; what is no longer there is said in a line. To let someone new in, a person sends the guest link from Share.",
      ...(p.temporary ? { temporary: true } : {}),
    });
  }

  private pins(a: Ask): Answer {
    const no = needAgent(a.caller) ?? this.refuse(a.caller, "full");
    if (no) return no;
    const v = this.graph();
    if (!(v instanceof View)) return v;
    const b = body(a);
    const mode = (b.mode ?? "namespace") as ClusterMode;
    if (!CLUSTER_MODES.includes(mode)) return fail(400, "mode is namespace or module.", "Leave it out for namespace, the page's default.");
    if (!Array.isArray(b.pins) || !b.pins.length || b.pins.length > MAX_PINS)
      return fail(400, `pins is a list of 1 to ${MAX_PINS} {name or cluster, at: [x, y] or null}.`, "at is in the parent cluster's coordinates (GET /api/agent/place); null lets go of the pin.");
    const L = v.projectLayout(mode, this.projectHidden(mode));
    const keys = new Map(L.clusters.map((c, k) => [c.key, k]));
    const ops: PlaceOp[] = [];
    for (const p of b.pins as Record<string, unknown>[]) {
      if (!p || typeof p !== "object") return fail(400, "Each pin is {name or cluster, at}.", "e.g. {\"name\": \"A.b\", \"at\": [12, -40]}.");
      let kind: "node" | "cluster", key: string, room: number;
      if (typeof p.cluster === "string") {
        const c = keys.get(p.cluster);
        if (c === undefined) return fail(404, `There is no cluster ${p.cluster} by ${mode}.`, "GET /api/agent/place?name=<declaration> names the cluster it is in.");
        kind = "cluster";
        key = p.cluster;
        room = roomIn(L, L.clusters[c].parent, L.clusters[c].r);
      } else {
        const i = this.find(v, str(p.name));
        if (typeof i !== "number") return i;
        kind = "node";
        key = v.g.nodes[i].name;
        room = roomIn(L, L.cluster[i], LEAF_R);
      }
      if (p.at === null) ops.push({ op: "unpin", mode, kind, key });
      else ops.push({ op: "pin", mode, kind, key, at: inside(p.at, room) });
    }
    const why = invalidOps(ops);
    if (why) return fail(400, `The pins are not right (${why}).`, "at is [x, y], two finite numbers in the parent cluster's coordinates.");
    const done = this.layout(a.caller.name!, true, ops);
    // where each one went: a place beyond the parent's room is brought in, as a drag would be
    return ok({ ...done, placed: ops.map((o) => (o.op === "pin" ? { key: o.key, at: o.at } : o.op === "unpin" ? { key: o.key, at: null } : null)).filter(Boolean) });
  }

  /** Drop and let go of pins as one batch (AgentSpec decision 4): applied as a page's drop is, and
   *  recorded in the timeline with what each pin was before, so that it can be undone at once. */
  private layout(by: string, agent: boolean, ops: PlaceOp[]): { ok: true; id: number | null; count: number } {
    const P = this.world.places.data.layouts;
    const id = (o: Exclude<PlaceOp, { op: "clear" }>) => `${o.mode}\u0000${o.kind}\u0000${o.key}`;
    const pinOf = (o: Exclude<PlaceOp, { op: "clear" }>) => (o.kind === "node" ? P[o.mode].nodes : P[o.mode].clusters)[o.key] ?? null;
    const moves = ops.filter((o): o is Exclude<PlaceOp, { op: "clear" }> => o.op !== "clear");
    const before = new Map<string, { o: Exclude<PlaceOp, { op: "clear" }>; at: [number, number] | null }>();
    for (const o of moves) if (!before.has(id(o))) before.set(id(o), { o, at: pinOf(o) });
    if (!this.world.places.apply(moves, { by, agent })) return { ok: true, id: null, count: 0 };
    this.world.placesChanged(moves, null, by);
    const as = (o: Exclude<PlaceOp, { op: "clear" }>, at: [number, number] | null): PlaceOp =>
      at ? { op: "pin", mode: o.mode, kind: o.kind, key: o.key, at } : { op: "unpin", mode: o.mode, kind: o.kind, key: o.key };
    // what the batch left (each pin once, where it ended), and what puts back what was there
    const after = [...before.values()].map(({ o }) => as(o, pinOf(o)));
    const undo = [...before.values()].map(({ o, at }) => as(o, at));
    const e = this.world.timeline.add({ kind: "layout", by, ...(agent ? { agent: true as const } : {}), count: before.size, ops: after, undo });
    return { ok: true, id: e.id, count: before.size };
  }

  /** Undo a layout batch: every pin it set goes back to what it was, except where someone moved it
   *  since — that one is left, and the answer (and the timeline) says so. `by` is null for a private
   *  reader's undo (CollabSpec decision 8), recorded without a name. */
  undo(by: string | null, agent: boolean, id: unknown): Answer {
    if (typeof id !== "number" || !Number.isInteger(id)) return fail(400, "id is the layout batch's number.", "POST /api/agent/pins answers with it; GET /api/agent/activity lists layout events.");
    const events = this.world.timeline.events;
    const e = events.find((x) => x.id === id);
    if (!e || e.kind !== "layout") return fail(404, `There is no layout batch #${id}.`, "GET /api/agent/activity lists layout events, each with its id.");
    const done = events.find((x) => x.kind === "undo" && x.of === id);
    if (done) return fail(409, `Layout batch #${id} was undone already, by ${(done as { by: string | null }).by ?? "someone"}.`, "Nothing to do.");
    const P = this.world.places.data.layouts;
    const restore: PlaceOp[] = [];
    const kept: string[] = [];
    e.ops.forEach((o, k) => {
      if (o.op === "clear") return;
      const now = (o.kind === "node" ? P[o.mode].nodes : P[o.mode].clusters)[o.key] ?? null;
      const left = o.op === "pin" ? o.at : null;
      const same = now === left || (!!now && !!left && now[0] === left[0] && now[1] === left[1]);
      if (same) restore.push(e.undo[k]);
      else kept.push(o.key);
    });
    if (restore.length && this.world.places.apply(restore, { by, agent })) this.world.placesChanged(restore, null, by);
    const u = this.world.timeline.add({ kind: "undo", by, ...(agent ? { agent: true as const } : {}), of: id, restored: restore.length, kept });
    return ok({
      ok: true,
      id: u.id,
      restored: restore.length,
      kept,
      ...(kept.length ? { note: `${kept.length} left where they are: someone moved them since.` } : {}),
    });
  }

  private undoPost(a: Ask): Answer {
    const no = needAgent(a.caller) ?? this.refuse(a.caller, "full");
    if (no) return no;
    return this.undo(a.caller.name!, true, body(a).id);
  }

  // ---------------------------------------------------------------- the table

  private table(): Endpoint[] {
    const name = "a declaration's full name, e.g. fermatLastTheoremFour";
    return [
      { method: "GET", path: "/api/agent", about: "The entry: who you are here and what you may do, how to begin, the rules, the documentation's topics, the most used endpoints.", params: {}, returns: "{about, you: {name, kind, level, may, token?}, level, requests, start, rules, docs, topics, endpoints, errors, graph}", run: (a) => index(this, a) },
      { method: "GET", path: "/api/agent/endpoints", about: "Every endpoint of this API: what it does, its parameters, its answer and the level it needs.", params: { path: "optional: only this path's (e.g. /api/agent/tcb)" }, returns: "{endpoints: [{method, path, about, params, returns, needs?}]}", run: (a) => endpointList(this, a) },
      {
        method: "GET", path: "/api/agent/module", about: "A module of the project: its file's doc comments (/-! … -/, where a project keeps the reasons behind its definitions), what it imports and what imports it, and every declaration in it in the order of the file — what sits beside a declaration: a variant, a weaker or stronger form.",
        params: { name: "a module, e.g. Mathlib.NumberTheory.FLT.Four — or —", of: "a declaration: its module" },
        returns: "{name, file, compiled, note?, imports, importedBy, docs: [{line, endLine, text}], docsCut?, count, declarations: [{name, kind, line, display?, grammar?, also?}]}",
        run: (a) => moduleGet(this, a),
      },
      {
        method: "GET", path: "/api/agent/inbox", brief: "listen: answers the moment someone writes to you", about: `Your inbox (AgentSpec decision 8): wait here for what is handed to you — your maker's messages in your private channel (channel private), and a person's message in the public channel that mentions you (channel public; an agent's mention never is). It answers at once with every message that came since it last answered, in order, each with who wrote it, where they were and its channel; else it waits up to wait seconds and answers the moment one comes, or with none at the end. Reply where a message came from: POST /api/agent/reply does by default. The first wait after you join (after you were offline) may bring earlier messages first, in one entry of kind earlier ("Earlier in this conversation, before you joined"): read them as context, and do not answer them again. When your maker starts a new conversation, you are handed a notice (kind divider): disregard what came before; it needs no answer. Listen by asking again after each answer: while a wait is open you are shown listening, and once messages were handed to you, thinking, until you reply. One wait at a time: a newer one ends an older one (replaced). VisualProof's MCP server's wait_for_message does this for you. Needs a token of your own.`,
        params: { wait: `seconds to wait for a message (default 0: only look; at most ${MAX_WAIT_S}; fractions allowed)`, max: "optional: the longest you wait in all, where you split it into shorter requests (the MCP server does): you are shown offline once you have had no wait open and made no request for this plus 60 s (default: wait)" },
        returns: "{messages: [{id, at, from, kind: person, channel: private|public, text, mentions?, where: {inWords, view, declaration, selection}} | {id, at, from, kind: divider, channel: private, text} | {id: 0, at, from: VisualProof, kind: earlier, text, count, omitted}], waited: seconds, next | replaced} — 401 {error, ended} at once when your token is revoked or expires during the wait",
        run: (a) => inbox(this, a),
      },
      {
        method: "POST", path: "/api/agent/status", about: "Say what you are doing, in your own words (\"reading the TCB…\"): one short line, shown with your state beside your mark and in the conversation window. It clears when you reply, and when you wait again. Needs a token of your own.",
        params: { text: `one line, at most ${MAX_STATUS} characters; empty clears it` },
        returns: "{ok, state, status}",
        run: (a) => status(this, a),
      },
      {
        method: "POST", path: "/api/agent/reply", brief: "answer: where the last message came from", about: "Write in a channel (CollabSpec decision 13): your private channel, which only your maker reads, or the public channel, which everyone with a name on the page and every agent reads. By default where the last message handed to you came from; you may also write in the public channel unasked. You are no longer thinking. Plain text with simple Markdown (**bold**, *italics*, `code`); declarations' full names become links, and links of this site show as what they lead to; no HTML. @ and a name mentions someone; an agent you mention is shown it, never handed it. Move your view (POST /api/agent/view) to what you explain first; wait for the next message after. Needs a token of your own.",
        params: { text: `your answer, at most ${MAX_AGENT.toLocaleString("en")} characters`, channel: "optional: private or public (default: the channel of the last message handed to you; private before any)" },
        returns: "{ok, channel, id, at, next}",
        run: (a) => reply(this, a),
      },
      {
        method: "GET", path: "/api/agent/channel", about: "The public channel (CollabSpec decision 13): what everyone with a name on the page and every agent wrote there, oldest first, each with who wrote it, where they were and the names it mentions. Nothing of it is handed to you but a person's message that mentions you: read it here when you want. A request there is a request: ask your maker before changing the board on someone else's word. Kept 90 days. Needs a token of your own.",
        params: { since: "optional: a message's id: only what came after it (default: the newest)", limit: `how many at most (default 50, at most ${THREAD})` },
        returns: "{channel: public, messages: [{id, at, from, kind: person|agent, channel: public, text, mentions?, where?}], last, note}",
        run: (a) => publicChannel(this, a),
      },
      {
        method: "GET", path: "/api/agent/conversation", about: "Your private channel, with your maker alone: the last messages, theirs and yours, oldest first, each with who wrote it and where they were, and your state as people see it (read: the last message of it handed to you). Since your maker last started a new conversation (divider: who, when), unless all says otherwise. Kept 30 days. The public channel: GET /api/agent/channel. Needs a token of your own.",
        params: { limit: `how many (default 50, at most ${THREAD})`, all: "1: the messages before the last new conversation too, its dividers among them (kind divider)" },
        returns: "{state, since, doing, status, read, lastSeen, messages: [{id, at, from, kind: person|agent|divider, text, where?}], divider: {id, at, from} | null, before, note?}",
        run: (a) => conversation(this, a),
      },
      {
        method: "GET", path: "/api/agent/mcp", about: "VisualProof's MCP server: one file, no dependencies, Node 18 or later, run by an MCP client as a local (stdio) server with VISUALPROOF_URL, VISUALPROOF_TOKEN and VISUALPROOF_WAIT_SECONDS in its environment. It offers this API as tools: wait_for_message (your inbox: it returns the moment someone writes), reply and status among them. GET /api/agent/mcp/install says how to install it. Needs a token of your own.",
        params: {},
        returns: "text/javascript",
        run: (a) => mcpFile(this, a),
      },
      { method: "GET", path: "/api/agent/mcp/install", about: "How to install and run VisualProof's MCP server, per client (Claude Code, others), as plain text. Needs a token of your own.", params: {}, returns: "text/plain", run: (a) => mcpInstallGet(this, a) },
      { method: "GET", path: "/api/agent/mcp/tools", about: "What the MCP server offers, which it relays: its instructions and its tools, each with the request it makes. Needs a token of your own.", params: {}, returns: "{you, instructions, tools: [{name, description, inputSchema, call: {method, path, waits?, saves?}}]}", run: (a) => mcpTools(this, a) },
      { method: "GET", path: "/api/agent/docs", about: "The documentation's index, as Markdown (text/markdown): the rules and the topics, each GET /api/agent/docs/<topic>.", params: { topic: "optional: a topic, as /api/agent/docs/<topic>" }, returns: "Markdown text", run: (a) => docs(this, a) },
      { method: "GET", path: "/api/agent/docs/{topic}", about: `A topic of the documentation, as Markdown (text/markdown): ${DOC_TOPICS.map((d) => d.topic).join(", ")}.`, params: {}, returns: "Markdown text", run: (a) => docs(this, a) },
      {
        method: "GET", path: "/api/agent/companion", brief: "who is on the page, and where each one looks", about: "Who is on the page now and where each one is — every person (the place of their liveliest page: view, tool, selection, the declaration in their panel, the source window and the pinned ones, Activity, the lost-and-found, the colouring and the edges, idle or not) and the agents present — to follow the people you help; privateCount says how many people are here privately, who are not listed and cannot be followed. With wait, the answer waits until someone comes, goes or moves.",
        params: { wait: "optional: seconds to wait for a change (at most 60)", since: "optional: the rev of an earlier answer; with wait, the answer comes as soon as the revision is another" },
        returns: "{rev, changed?, now, sharedBy?: {name, here}, sharedByNote?, people: [{name, idle, pages, place: {view, viewTitle, targets?, scope?, mode, tool, selection, declaration, source, sourceCollapsed, pinned: [{declaration, collapsed}], history?, activity?: {open, kind, who, mine?}, lostAndFound?: {open}, colouring?, edges?, inWords}}], privateCount, agents: [{name, idle, state?, status?, lastSeen?, you?, place}], note}",
        run: (a) => this.companion(a),
      },
      {
        method: "GET", path: "/api/agent/search", brief: "find declarations by name, statement and docstring", about: "Find declarations by name, statement and docstring, as the page's search: every word must be found; name matches first.",
        params: { q: "words (at least 2 characters)", limit: "how many (default 20, at most 200)" },
        returns: "{query, counts: {name, statement, doc}, hits: [{name, kind, module, external?, where, via?, snippet?}], more} — via: the name it folds that was found",
        run: (a) => searchGet(this, a),
      },
      {
        method: "GET", path: "/api/agent/declaration", brief: "everything about one; include=source,context,uses,…; names=: several", about: "Everything about one declaration: statement, doc, what Lean generated from its command (also), axioms, hash, its review (people's opinions and agents' advice apart), trust, the targets whose TCB holds it, how many it uses and how many use it. With include, the answers of other endpoints for it too, in one request. A name folded into a declaration (an also name, a constructor, a recursor…) is answered for that declaration, with asked and foldedInto.",
        params: { name, include: `optional, comma-separated: ${PARTS.join(", ")} — each as its own endpoint answers it (uses and users take offset, limit and where; describe and print take proofs, and share wait)`, names: `or several full names separated by commas, at most ${MAX_NAMES}: answered as GET declarations answers them`, proofs: "1: print prints proofs too", wait: "for describe and print: how long to wait for Lean, ms (default 20000, at most 60000)" },
        returns: "{name, kind, module, external, file, range, statement, doc, also, leanName?, display?, grammar?, interprets?, interpretedBy?, flags, axioms, nonStandardAxioms, hash, kernel?, editedSinceCompiled, review: {status, trusted, trustedBy, needsReview, opinions, advice, youAdvised}, isTarget, keyFor: [targets], inTcbOf, tcbSize, usesDirect, usedBy: {direct, all}, <each part asked for>, failed?: {part: status}, asked?, foldedInto?, foldedNote?}",
        run: (a) => declaration(this, a),
      },
      {
        method: "GET", path: "/api/agent/declarations", about: `Up to ${MAX_NAMES} declarations at once, each as GET declaration answers it (include too); a name that is not there is answered on its own (status, error, didYouMean), the others still are.`,
        params: { names: `full names separated by commas, at most ${MAX_NAMES}`, include: "as for declaration", proofs: "as for declaration", wait: "for describe and print, the whole request's (default 20000, at most 60000)" },
        returns: "{count, found, declarations: [declaration answer | {name, status, error, hint, didYouMean}]}",
        run: (a) => declarations(this, a),
      },
      {
        method: "GET", path: "/api/agent/source", brief: "its source, and the context it is written in", about: "The declaration's compiled source, as the page's source window shows it (docstring and attributes included), and the context it is written in as Lean (namespaces, opens, variables, options, local notation); advice records the two as the text judged, context first. Says when the file changed since it was compiled. With snapshot, its source at that build, from the text the build was compiled from (HistorySpec decision 23), with check saying how that text was matched to the build (lake: its Lake hash is the build's; places: the places the build recorded, its hash not kept); a text not kept is answered 404 with kept: false, and the statement and doc then.",
        params: { name, snapshot: "optional: a snapshot's id (GET /api/agent/history lists them): the source at that build; a name a rename since gave is found under its name then" },
        returns: "{name, module, file, compiled, note?, also?, alsoNote?, generatedNote?, context, text}; with snapshot: {name, asked?, module, file, snapshot: {id, at, commit}, compiled: true, check: lake|places, note, line, endLine, context, text}",
        run: (a) => source(this, a),
      },
      {
        method: "GET", path: "/api/agent/context", about: "What is in force where the declaration is written: the namespaces and sections around it, the opens (an `open … in` right before it marked in), variables with their binders as written, universes, options, local commands. precision elaborated: the elaborator's scope, as the usage pass read it (opens resolved, a variable per binder, those Lean included in the declaration marked used); text: read from the file up to it. Says when the file changed since it was compiled.",
        params: { name },
        returns: "{name, module, file, compiled, note?, line, imports, precision: elaborated|text, exact?, namespace, namespaces, blocks: [{kind, name, line}], opens: [{line, text, namespaces, scoped?, in?}], variables: [{line, text, binds?, in?, used?}], universes, options, local}",
        run: (a) => context(this, a),
      },
      {
        method: "GET", path: "/api/agent/uses", brief: "what it refers to, and where (/users: what refers to it)", about: "What the declaration refers to by name, and the notation its text is written in (kind notation: the rule that ran, in the TCB, and the syntax, at the grammar site, outside it), each with where it sits in it (statement, body, proof, grammar), its kind, module, whether it is outside the project and whether it is trusted. Paged.",
        params: { name, where: "optional: statement, body, proof or grammar — only references there (grammar: a syntax that only declares grammar, outside every TCB)", offset: "default 0", limit: "default 100, at most 1000" },
        returns: "{name, direction, note, counts: {total, statement, body, proof, project, external, trusted}, where?, offset, limit, total, next, refs: [{name, kind, module, external?, display?, grammar?, where: [statement|body|proof|grammar], trusted, trustedBy?}]}",
        run: (a) => refsGet(this, a, "uses"),
      },
      {
        method: "GET", path: "/api/agent/users", about: "What refers to the declaration by name, each with where the reference sits in it (statement, body, proof). Paged, as uses.",
        params: { name, where: "optional: statement, body, proof or grammar — only users that refer to it there", offset: "default 0", limit: "default 100, at most 1000" },
        returns: "as uses",
        run: (a) => refsGet(this, a, "users"),
      },
      {
        method: "GET", path: "/api/agent/describe", about: "What Lean itself says about a name — its signature and doc, as a hover shows them. Any Lean name: a declaration of the graph, or a constructor, field or generated name (asked where the declaration it is under is imported). 503 with Retry-After while Lean loads.",
        params: { name: "a full Lean name, e.g. Nat.Prime.eq_one_or_self_of_dvd", module: "optional: the module to import (default: the declaration's own, else that of the declaration the name is under, else the project's root module)", wait: "how long to wait for Lean, ms (default 20000, at most 60000)" },
        returns: "{name, unit?, module, moduleChosen, inGraph, lean: markdown}",
        run: (a) => describe(this, a),
      },
      {
        method: "GET", path: "/api/agent/print", brief: "Lean's #print of any name (/describe: its hover)", about: `What Lean's #print shows: the elaborated declaration with its value, every name in full — what a macro generated, the proposition a Prop-valued definition stands for, a structure's fields and constructor. Any Lean name, as describe. Proofs are shown as ⋯ unless proofs=1. At most ${MAX_PRINT.toLocaleString("en")} characters. 503 with Retry-After while Lean loads.`,
        params: { name: "a full Lean name", module: "optional, as for describe", proofs: "1: print proofs too (a theorem's value is its proof)", wait: "as for describe" },
        returns: "{name, unit?, module, moduleChosen, inGraph, proofs, lean: text, truncated?: {shown, length}, note?, warnings?, seeAlso?: [names Lean generated from the same command], seeAlsoNote?}",
        run: (a) => print(this, a),
      },
      {
        method: "GET", path: "/api/agent/targets", brief: "the targets, and how far each review has come", about: "The targets people review, each with how far its review has come.",
        params: {},
        returns: "{targets: [{name, markedBy, markedByAgent?, at, inGraph, counts: {needReview, approved, commented, stale, unreviewed, advised, agentComments, advisedByYou, key: {total, approved, commented, stale, unreviewed, trusted}}}]}",
        run: (a) => targets(this, a),
      },
      {
        method: "GET", path: "/api/agent/tcb", brief: "a target's review set, in review order", about: "What a target's review holds, its review set: its TCB without what is trusted (an untrusted outside declaration included), and every non-standard axiom it rests on, through proofs too — in review order (the axioms first, then bottom-up), each with people's status, the agents' advice on its present version, and whether you advised on it; or (include) the members trusted without review, each with what trusts it. Paged.",
        params: { target: name, include: "review (default) | trusted: the trusted members, each with the prefix that covers it or \"standard axiom\" | all: both, review's first", todo: "1: only those you have not advised on (present version); with include=review", key: "optional, with include=review: first — the key declarations first (the trusted ones first, marked trusted), then the rest in review order; only — the key declarations alone", offset: "default 0", limit: "default 50, at most 500" },
        returns: "{target, isTarget, order, counts: {needReview, approved, commented, stale, unreviewed, advised, agentComments, advisedByYou, key: {total, approved, commented, stale, unreviewed, trusted}}, trustedNotCounted, axioms: [{name, inGraph, status, usedIn}] (counted in counts; one not inGraph is advised on by its name), trusted?: {project, external, byPrefix}, include, offset, limit, total, next, members: [{position, name, kind, module, external?, key?: true, status, advice: [{by, verdict}], youAdvised} | {position, name, kind, module, external?, key?: true, trusted: true, trustedBy}]}",
        run: (a) => tcb(this, a),
      },
      {
        method: "GET", path: "/api/agent/keys", brief: "its key declarations, and what each rests on", about: "A target's key declarations (members of its TCB, trusted ones too, marked by people, or by agents at level full; the target is always one), top-down, each with its docstring, what it rests on beyond itself — its support, the members of the review it reaches through members that are not key, by review status — and the key declarations it rests on; and the key graph's edges.",
        params: { target: name, members: "1 (default): list each key declaration's support by name; 0: counts only" },
        returns: "{target, isTarget, order, note, counts: {key, all: {total, approved, commented, stale, unreviewed}, offBoardAxioms}, keys: [{name, kind, module, external?, target? | markedBy, markedByAgent?, markedAt, status | trusted: true, trustedBy, doc, restsOn: [names], support: {total, approved, commented, stale, unreviewed, members?: [names]}}], edges: [[from, to]], viaProof: [names], marksOutsideTcb?}",
        run: (a) => keysGet(this, a),
      },
      {
        method: "GET", path: "/api/agent/export", about: "The exported document's model (ExportSpec.md): what the PDF of a view holds, as JSON. The view is the specification: every declaration of the project its board holds is printed (whatever is folded), each with its docstring and its code — a definition whole, proofs left out — in sections from the view's cluster structure as the board shows it (its hidden levels taken out); what it holds from outside the project is counted on the head card (head.outside), not printed. The board is the document's outline (2026-10-12): everything comes in the order of its height on the view's board, the lowest first, ties left to right, whatever depends on what — a section's declarations, notes and sections in one list (items), the document's start (declarations in no cluster, notes outside every cluster) before its sections; reordering things on the board (pins) reorders the document. The notes the view shows are its prose: a note attached to a declaration in that declaration's notes, after it; one in a cluster in that section's items; their text as prose blocks, a declaration they name in backticks an inline {t: decl, id} where the document prints it; the images and clips they carry as figures ({ref, file, page?, region?, size?: points}), whole PDFs as papers. Its title (head.title) is the view's, as it is named; its author line (head.author) the people who left a trace on the view — made, renamed, rescoped or laid it out afresh, dropped a pin still on it, wrote or edited a note on it — in the order of their first, agents and private readers not named: no setting gives either. Nothing of the review is in it. code.textCut says where a definition's proofs were found by reading its text rather than where the usage pass found them (edited: its file changed since it was compiled; unread: the pass has not read it; past: a past build's text): every `by` block is left out there, data too, and a proof written as a term stays. A view kept at a past build (or the build version names) makes that build's document (ExportSpec decision 16): head.past says the build — its snapshot, when it finished, how many texts were matched to it by its places alone and how many are not kept — head.commit and head.toolchain are that build's, the title says its build as the view's does, and its board holds that build's declarations alone; each declaration's text is the one that build compiled (code.places: matched to it by its places), a declaration whose text then is not kept printed as its statement then (code.notKept, from: statement).",
        params: EXPORT_PARAMS,
        returns: "{version: 10, settings, view: {id, title, scope, clustering, hidden}, head: {title, author, project, roots, fingerprint, commit: {hash, branch, dirty?, guessed?} | null, toolchain, past: {snapshot, at, when, approx?, places, notKept} | null, trusted, outside: {count, by: [{name, count}]}}, items: [item: {t: decl, decl} | {t: note, note} | {t: section, section: {id, key, title, level: 1-4, papers?, items: [item]}}], count: {declarations, sections, notes}, references: [{n, sha, title, type, pages?, url?, name?}]}; decl: {id, name, short, kind, module, file, line, doc: [prose blocks] | null, code: {lines: [[[tokenKind, text]]], proofElided, proofsCut?, textCut?: edited|unread|past, from, places?, notKept?}, papers?, notes?: [note]}; note: {id, kind: project|view, text: [prose blocks] | null (it says only its one file's title), figures?: [{ref, file, page?, region?, size?}], papers?: [{label, page?, ref}]}",
        run: (a) => this.exportGet(a),
      },
      {
        method: "POST", path: "/api/agent/export", about: "Typeset a view's document with XeLaTeX, as the page's Export does (ExportSpec decision 11): the answer comes at once with its job — 202 while it runs, 200 when it is done already (the same document asked again is the same job; done ones are cached). One job of yours runs at a time: another while it runs is answered 429, with Retry-After and that job. 503 where the server has no XeLaTeX; 400 for a view that holds nothing of the project, or more than 2,000 of its declarations. Any level may export: it only reads. A target's key document is its Key view (open key(T), export that view); the full review set is a view of its scope (open tcb(T) except trusted or (uses(T) and kind(axiom) and nonstandard), export that view). A view kept at a past build is typeset at that build, as GET /api/agent/export's model says.",
        params: { view: EXPORT_PARAMS.view, settings: `optional: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}`, version: EXPORT_PARAMS.version },
        returns: "{job: {id, state: running|done|failed, at, pages?, ms?, runs?, cached?, error?, log?, notes?: [what the document does not say about how it was made, e.g. the definitions whose proofs were found by reading their text]}, next?: the request that says how it is doing, files?: {pdf, tex, sty, zip} once done}",
        run: (a) => this.exportPost(a),
      },
      {
        method: "GET", path: "/api/agent/export/job", about: "How a typesetting job is doing: running, done (with its pages and the files to download) or failed (why, and the end of XeLaTeX's log); its notes say what the document does not about how it was made.",
        params: { id: "the job's id" },
        returns: "{job, next?, files?: {pdf, tex, sty, zip}}",
        run: (a) => this.exportJob(a.query.get("id") ?? "", true),
      },
      {
        method: "GET", path: "/api/agent/export/file", about: "A typeset document's file: the PDF (application/pdf), its .tex, the style file visualproof.sty, or a zip of everything needed to typeset it again (the .tex, the style file, the fonts). 409 with Retry-After while it is being typeset, 409 where it failed, 404 where it is unknown or has left the cache.",
        params: { id: "the job's id", what: "pdf (default) | tex | sty | zip" },
        returns: "the file, as an attachment",
        run: (a) => this.exportFileGet(a),
      },
      {
        method: "GET", path: "/api/agent/why", about: "Why a declaration is in a target's TCB: the shortest chain of statement and body references from the target to it; for a non-standard axiom reached through a proof, where it is used.",
        params: { target: name, name },
        returns: "{target, name, inTcb, inReview?, chain: [{name, kind, module, usedIn?}] | null, usedIn?, reviewPosition?: {position, of} | null, note?}",
        run: (a) => why(this, a),
      },
      {
        method: "GET", path: "/api/agent/activity", brief: "the timeline", about: "The timeline, oldest first: opinions and advice, targets and key marks, files of the library added, retitled, archived or restored and links made, edited or removed (all from the review's logs), builds, TCB changes, targets taken off, prefixes trusted or no longer, views saved, renamed, rescoped, deleted or laid out afresh, notes added to a view or taken out of it, notes, layouts and their undoing.",
        params: { since: "an ISO time (e.g. the `now` of your last answer) or an event id: what came after", name: "optional: only what is about this declaration (opinions, advice, notes that name it, key marks, links on it; a target's own events)", limit: "default 100, at most 1000 (the newest)" },
        returns: "{now, events: [{at, kind, by?, agent?, …}] oldest first, more}; kinds: opinion, target, key (a key declaration as marked now: target, name), build, tcb, untarget, trust, untrust, view (a view saved, renamed, rescoped, deleted or laid out afresh: what, view, name, was?, scope; or a note of the project added to it or taken out of it: what items, note, text, shown), note (a note on a view written, edited or deleted: what, view, title, note, text), file (a file of the library: what is added, edited — its title, wasTitle the one before —, archived or restored; sha, title), link (what is made, edited or removed; id, subject, label, file, and an edit's changed (subject, label, place), wasSubject?, wasLabel?, auto? where VisualProof carried it with a renamed cluster), layout (with moved and undoneBy), undo, tool (the VisualProof version serving the site changed: from, to, setAside?); relayout only in a timeline kept from before views",
        run: (a) => this.activity(a),
      },
      {
        method: "GET", path: "/api/agent/place", about: "Where a declaration or a cluster is on the Project view (for another view: GET /api/agent/views/view), in its parent cluster's coordinates (origin the parent's centre), as laid out and as pinned (and by whom); and what else is in the parent — declarations and clusters, each with its radius, where it is and whether it is pinned — nearest first, so that a pin can go where nothing is.",
        params: { name: "a declaration — or —", cluster: "a cluster's key (its full path)", mode: "namespace (default) or module: the way of clustering", near: "optional x,y in the parent's coordinates: the siblings nearest there first (default: nearest the thing itself)", limit: "how many siblings (default 100, at most 2000; 0 for none)" },
        returns: "{mode, kind, key, parent: {cluster, r, room}, r, room, laidOut: [x, y], pinned: [x, y] | null, pinnedBy?: {name (null: someone — a private reader, or a page without a name), agent, at} | null, siblings: {total, pinned, nearestTo, more, list: [{kind, key, declKind?, r, at, gap (free space to it from nearestTo; < 0: overlap), pinned, pinnedBy?, laidOut?}]}}",
        run: (a) => this.place(a),
      },
      {
        method: "POST", path: "/api/agent/opinion", brief: "advice: approve or comment", needs: "advise", about: "Give advice on a declaration's present version: approve, or comment with what is wrong, unclear or worth checking. The server records the content hash and the text you judged. A later opinion replaces your earlier one. Never counted. A non-standard axiom a target rests on is advised on by its name, also where the graph has no declaration for it.",
        params: { name, verdict: "approve | comment", comment: "your reasons; the text of a comment, which needs one (at most 10,000 characters). Light Markdown, kept as written: > quotes, `code`, ```lean blocks, **bold**, *italics*; a declaration's full name in backticks links to it; no HTML. Quote an opinion as `> [**Alice** (2026-10-09)](opinion:<name>#<by>@<at>):`, source lines as `[File.lean:12–13](source:<name>#L12-L13)` over a ```lean block (GET /api/agent/docs/advice)", opinions: `or several at once, [{name, verdict, comment}], at most ${MAX_OPINIONS}: answered as POST opinions answers them` },
        returns: "{ok, recorded: {name, verdict, comment, hash, judged}, counted: false}",
        run: (a) => opinionPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/opinion/withdraw", brief: "take your advice back", needs: "advise", about: "Withdraw your advice on a declaration, stale or not: you have none there after, your earlier advice not restored; it stays in the history, and the timeline records it. Your own alone.",
        params: { name: "the declaration you advised on" },
        returns: "{ok, withdrawn: {name, by, verdict, at}}; 409 where you have no advice there",
        run: (a) => withdrawPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/opinions", needs: "advise", about: `Advice on up to ${MAX_OPINIONS} declarations at once: each item is checked and recorded as POST opinion does it, and answered on its own — one refused does not refuse the others.`,
        params: { opinions: `[{name, verdict, comment}], at most ${MAX_OPINIONS}` },
        returns: "{ok, recorded, refused, counted: false, results: [{index, name, status, recorded? | error, hint, didYouMean?}]}",
        run: (a) => opinionsPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/view", brief: "show what you look at: people following you see it", about: "Say what you look at, so that people who follow you see it: fields not sent keep their value. Any request keeps you present; you are away after a minute without one, gone after three (with a token: listed while it is in force, offline after your longest wait and a minute without a wait or a request; leave makes you offline at once).",
        params: { sel: "the declaration you look at, or null", source: "true: the source window open on sel", view: "a view's id (GET /api/agent/views), or null for the Project; POST /api/agent/views/open opens one on a query", review: "a target: its view, the one it is linked to (null, on a target's view, goes back to the Project); a target with none (marking makes none, and a view deleted leaves its targets with none) is given a temporary view of its TCB, linked to it while it lasts, as a person's click on it does, and the answer says so (temporary)", selection: "what you select, as a query's text — its parts joined by or, each a click a page makes: decl(A.b), uses(A.b), tcb(A.b), tcb(A.b) and (key(targets) or decl(A.b)) (Keys: where the review has a focus, key(<the focus>)), usedBy(A.b), or the same over a cluster, tcb(ns(A.C) except external) — or null; without it, people following select sel under mode", mode: "how you select (a page's Mode): plain (just what is clicked); the steps of Rests on, deps (what it uses), tcb (its TCB), keys (the key declarations in its TCB); apps (what uses it); what you set last, tcb at first", paper: "the reference window, shown to people following you: {link} (a link's id: its file at its place, lit) or {file, page} (a file's SHA-256 and a page from 1); null closes it", focus: "your own focus on the view (ViewSpec decision 28), as a person's, which people following you take: a target's full name; null (or \"none\") for none; false (or \"view\") for the view's own again, as on every view you come to", leave: "true: you are done; without a token you leave the page's list (back with your next request), with one you stay listed, offline until you wait or make a request again" },
        returns: "{ok, view, reviewView: the targets linked to the view you are on | null, followersSee: what people who follow you see, in words, temporary?: true where review made a temporary view of a target with none, with a note}",
        run: (a) => this.viewPost(a),
      },
      {
        method: "POST", path: "/api/agent/view/link", about: "A link to what you look at, or to a place you give, that opens exactly that for whoever opens it, as a person's Share makes with Exactly what I see (the owner's decision of 2026-10-12): the address, and after it a snapshot of everything followed — the view, the build in the Time Machine, the region of the board, the tool, the selection, the focus, the panel, the source windows, the reference window, Activity, the lost-and-found, the colouring, the edges. Fields you send are taken over your own place (as POST view takes them); nothing moves, you neither. The page that opens it applies it once, and says in a line what is no longer there. It holds no key: it opens for whoever is let in already, the people on the page.",
        params: { "view, review, sel, selection, mode, source, focus, paper": "as POST view: over your own place", sourceCollapsed: "true: the source window following sel is collapsed to its pill", pinned: `source windows pinned, [{name, collapsed?}], at most ${MAX_PINNED}, the first pinned first`, history: "a snapshot's id (GET /api/agent/history): the Time Machine at that build; null for none", region: "[x, y, w, h]: the region of the board framed — its centre, width and height in the board's world — fitted to the opener's screen; left out, framed as for any link", activity: "{open, kind?, who?, mine?}: Activity open or closed, its filters", lostFound: "true: the lost-and-found open", scheme: "kind or status: the colouring", edges: "edges drawn", exact: "false: only the view, as Share's switch turned off makes it (the address alone)" },
        returns: "{ok, link, exact, carries: what the link opens on, length, note, temporary?}",
        run: (a) => this.viewLink(a),
      },
      {
        method: "POST", path: "/api/agent/artwork", about: "A link that opens the board as a picture, in the artwork mode, as the recipe says (ExportSpec decision 20): its size, its look, names by a rule, the targets marked, the selection — in words that hold on any project, so that one recipe makes the same kind of picture of every codebase; the page saves the PNG or SVG where asked, once the board is ready. It changes nothing, and holds no key. A name, a target or a cluster the board has not is refused (404, problems).",
        params: { recipe: "the picture: {size, orientation, style, theme, transparent, colouring, border, title, subtitle, titleSize, footSize, source, names, targets, keys, notes, edges, selection, lit, view}, each optional (GET /api/agent/docs/export, \"Artwork\")", save: "png, svg or png,svg: the files the page saves once the board is ready; left out, none" },
        returns: "{ok, link, length, size: [w, h], names: {clusters, decls: written wherever they fall; ruled: by the rule, each only where it covers no other name} | how the board writes them, targets, selection, left: names and targets left out for room, note}",
        run: (a) => this.artwork(a),
      },
      {
        method: "POST", path: "/api/agent/pins", needs: "full", about: "Drop or let go of pins on the Project view, as people drag (for another view: POST /api/agent/views/arrange): one batch, recorded in the timeline with what it replaced, undoable at once.",
        params: { mode: "namespace (default) or module", pins: `[{name or cluster, at: [x, y] in the parent's coordinates (GET /api/agent/place), or null to let go}], at most ${MAX_PINS}` },
        returns: "{ok, id (the batch, for undo; null when nothing changed), count}",
        run: (a) => this.pins(a),
      },
      {
        method: "POST", path: "/api/agent/undo", needs: "full", about: "Undo a layout batch: its pins go back to what they were, except those someone moved since (listed as kept).",
        params: { id: "the batch's id" },
        returns: "{ok, id, restored, kept: [keys], note?}",
        run: (a) => this.undoPost(a),
      },
      {
        method: "POST", path: "/api/agent/target", needs: "full", about: "Mark a declaration of the project as a target — a theorem whose TCB people review; no view comes with it, and a click on it (or view {review}) opens a temporary view of its TCB, linked to it — or take one off, as the panel's ☆ Mark as target does (its view, if any, stays, unlinked). Recorded in your review log under your name, marked as an agent's; the timeline shows it.",
        params: { name, on: "true (default): mark it; false: take it off" },
        returns: "{ok, changed, recorded?: {op, at, by, agent, name, on}, view?: the view it is linked to | null, next?, note?}",
        run: (a) => targetPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/key", needs: "full", about: `Mark declarations of a target's TCB, trusted ones too, as key for it — what matters for reading it: the central definitions, the main theorem (ExportSpec decision 1) — or unmark them. One (name) or up to ${MAX_OPINIONS} at once (names), each answered on its own. The target itself is always key. Recorded in your review log, marked as an agent's.`,
        params: { target: "a target's full name", name: "a declaration of its TCB (GET /api/agent/tcb?target=…&include=all lists them) — or —", names: `[full names], at most ${MAX_OPINIONS}`, on: "true (default): mark; false: unmark" },
        returns: "{ok, changed, recorded?} for one; {ok, target, on, changed, unchanged, refused, results: [{index, name, status, changed?, recorded? | error, hint, didYouMean?}]} for names",
        run: (a) => keyPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/trust", needs: "full", about: "Trust a prefix without review — a module or a namespace (a whole dotted component), or @external for every declaration outside the project — or stop trusting it (a default one too: Mathlib, Init, Lean, Std, Batteries). What is trusted leaves every target's review and its counts, for everyone (ReviewSpec decision 3). Recorded in your review log and in the timeline, marked as an agent's.",
        params: { prefix: "e.g. Mathlib.Order, Nat, or @external", on: "true (default): trust it; false: no longer" },
        returns: "{ok, changed, recorded?, prefix, on, covers: {project, outside}, trusted: [the list after]}",
        run: (a) => trustPost(this, a),
      },
      ...viewEndpoints(this.world, (c) => this.refuse(c, "full")),
      ...noteEndpoints(this.world, (c, need) => this.refuse(c, need)),
      ...libraryEndpoints(this.world, (c, need) => this.refuse(c, need)),
      ...askEndpoints(this.world, (c, need) => this.refuse(c, need)),
      ...historyEndpoints(this.world, (a) => this.refuse(a.caller, "full")),
    ];
  }
}

/** What `view {paper}` asks the reference window to show: a link's place, or a file at a page; null to
 *  close it; or why it cannot. */
function paperOf(d: ReviewData, raw: unknown): PaperWindow | null | string {
  if (raw === null || raw === false) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "paper is an object.";
  const o = raw as Record<string, unknown>;
  if (o.link !== undefined) {
    const l = typeof o.link === "string" ? linkOf(d, o.link) : null;
    if (!l) return `There is no link ${String(o.link)}.`;
    return { file: l.file, ...(l.page ? { page: l.page } : {}), link: l.id };
  }
  const f = typeof o.file === "string" ? fileOf(d, o.file) : null;
  if (!f) return `The library has no file ${String(o.file)}.`;
  if (o.page !== undefined && (!Number.isInteger(o.page) || (o.page as number) < 1 || (f.pages && (o.page as number) > f.pages))) return `page is 1 to ${f.pages ?? "its last"}.`;
  return { file: f.sha, ...(o.page !== undefined ? { page: o.page as number } : f.type === "pdf" ? { page: 1 } : {}) };
}

/** How far from its parent's centre something of radius `r` may be placed, as the page keeps a
 *  drop inside its parent's circle (web/src/scene.ts, `inside`): the circle less the room left for
 *  its label. Where the page folded the thing, it is smaller and may go further; this is the
 *  bound for every page. Infinity at the top, where nothing holds it. */
function roomIn(L: Layout, parent: number, r: number): number {
  if (parent < 0) return Infinity;
  const P = L.clusters[parent];
  return Math.max(0, P.r - (10 + Math.min(14, Math.sqrt(P.count))) - r);
}

/** A room as the API says it: to a tenth, never beyond it; null at the top, where nothing holds it. */
function shown(room: number): number | null {
  return Number.isFinite(room) ? Math.floor(room * 10) / 10 : null;
}

/** A place brought within `room` of the centre, a hair inside so that rounding keeps it there, as
 *  every page would bring it. Anything not a place is left for invalidOps to refuse. */
function inside(at: unknown, room: number): [number, number] {
  if (!Array.isArray(at) || at.length !== 2 || !at.every((x) => typeof x === "number" && Number.isFinite(x))) return at as [number, number];
  const [x, y] = at as [number, number];
  const d = Math.hypot(x, y);
  if (d <= room) return [x, y];
  const k = Math.max(0, room - 0.1) / d;
  return [Math.round(x * k * 10) / 10, Math.round(y * k * 10) / 10];
}

/** Whether `path` is an endpoint's `pattern`: true where it is that path; where the pattern's last
 *  part is `{name}`, the path's last part (one part, not empty) as that parameter; else null. */
function matchPath(pattern: string, path: string): true | { name: string; value: string } | null {
  if (pattern === path) return true;
  const m = /^(.*)\/\{(\w+)\}$/.exec(pattern);
  if (!m || !path.startsWith(`${m[1]}/`)) return null;
  const rest = path.slice(m[1].length + 1);
  if (!rest || rest.includes("/")) return null;
  try {
    return { name: m[2], value: decodeURIComponent(rest) };
  } catch {
    return null;
  }
}

/** A yes/no parameter: 1 or true. */
export const flag = (s: string | null): boolean => s === "1" || s === "true";

/** Whose typesetting job a request starts: an agent's own token, else its name. */
function jobOwner(c: Caller): string {
  return c.token ? `token:${c.token.id}` : `name:${c.name ?? ""}`;
}

/** What an agent asks next about a job: how it is doing while it runs, its files once it is done. */
function jobLinks(job: ExportJob): Record<string, unknown> {
  const at = (what: string) => `/api/agent/export/file?id=${job.id}&what=${what}`;
  if (job.state === "running") return { next: `GET /api/agent/export/job?id=${job.id}` };
  if (job.state === "done") return { files: { pdf: at("pdf"), tex: at("tex"), sty: at("sty"), zip: at("zip") } };
  return {};
}

/** A POST's JSON object, or an empty one. */
export function body(a: Ask): Record<string, unknown> {
  return a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {};
}

export const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** The agent a request is from, as presence knows it: by its token where it has one of its own. */
export function whoOf(c: Caller): AgentWho {
  return { name: c.name ?? "", ...(c.token ? { token: c.token.id } : {}) };
}


/** An integer parameter within bounds, `dflt` when absent or not a number. */
export function clampInt(s: string | null, dflt: number, lo: number, hi: number): number {
  const n = s === null || s.trim() === "" ? NaN : Number(s);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** The project's commit, where it is a git repository: `git rev-parse`, which only reads (and is
 *  told to take no lock), asked at most once every ten seconds. Null where git is not there or the
 *  project is not a repository. */
/** The commit a document of the graph on show is of: a branch's build's, else what git says now. */
function shownOr(shown: { hash: string; branch: string } | null | undefined, root: string): { hash: string; branch: string | null } | null {
  return shown === undefined ? commitOf(root) : shown;
}

export function commitOf(root: string): { hash: string; branch: string | null } | null {
  const now = Date.now();
  const was = commits.get(root);
  if (was && now - was.at < 10_000) return was.commit;
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5000, env: childEnv({ GIT_OPTIONAL_LOCKS: "0" }), stdio: ["ignore", "pipe", "ignore"] });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const hash = git("rev-parse", "HEAD");
  const branch = hash ? git("rev-parse", "--abbrev-ref", "HEAD") : null;
  const commit = hash && /^[0-9a-f]{7,64}$/.test(hash) ? { hash, branch: branch && branch !== "HEAD" ? branch : null } : null;
  commits.set(root, { at: now, commit });
  return commit;
}

const commits = new Map<string, { at: number; commit: { hash: string; branch: string | null } | null }>();
