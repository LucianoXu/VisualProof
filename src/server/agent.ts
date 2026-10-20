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
// answer (a status, a JSON body, headers), so that the tests call it without HTTP; server/appagent.ts
// does the HTTP. The list of endpoints below is also what GET /api/agent/endpoints says about them,
// and what the entry (GET /api/agent) names of the most used, so the two cannot drift apart; the MCP
// server's tools (server/mcptools.ts) take what each request needs from it. The documentation is
// docs/agent-api/ (server/agentdocs.ts), served as GET /api/agent/docs.
//
// The handlers are by topic, as the documentation's are, each a function taking this API first:
// what an agent reads first (server/agententry.ts), reading declarations (server/agentread.ts) and
// what Lean says of them (server/agentlean.ts), targets and their TCB (server/agenttcb.ts), advice
// (server/agentadvice.ts), following (server/agentfollow.ts), the Project's places and pins
// (server/agentplaces.ts), the exported document (server/agentexport.ts), the timeline
// (server/agentactivity.ts) and talking (server/agenttalk.ts); the graph they read is
// server/agentgraph.ts's. Notes, views, the library, the history and asking to follow are endpoints
// of their own modules (server/agentnotes.ts, server/agentviews.ts, server/agentlibrary.ts,
// server/historyapi.ts, server/askfollow.ts), which the table takes as they are.
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PINNED } from "../shared/collab.ts";
import type { Peer, PresenceView } from "../shared/collab.ts";
import { exactContext } from "../shared/context.ts";
import type { FileContext, ModuleContexts } from "../shared/context.ts";
import type { ClusterMode } from "../shared/graph.ts";
import type { PlaceOp, PlacesData } from "../shared/places.ts";
import { advice, fresh, STANDARD_AXIOMS, trustedBy } from "../shared/review.ts";
import type { Opinion } from "../shared/review.ts";
import { keyGraph } from "../shared/keys.ts";
import { SETTINGS_HELP } from "../shared/doc/settings.ts";
import type { KeyGraph } from "../shared/keys.ts";
import { nonStandardAxiom } from "../shared/reviewqueue.ts";
import { foldedAt, guessNames } from "../shared/declfind.ts";
import type { NewEvent, StoredEvent } from "../shared/timeline.ts";
import type { PinAuthor } from "../shared/views.ts";
import type { Invited } from "../shared/collab.ts";
import { noteEndpoints } from "./agentnotes.ts";
import { libraryEndpoints } from "./agentlibrary.ts";
import { askEndpoints } from "./askfollow.ts";
import type { Asks } from "./askfollow.ts";
import type { Library } from "./library.ts";
import { viewEndpoints } from "./agentviews.ts";
import type { ExportFile, Exporter } from "./export.ts";
import type { HoverAnswer, PrintAnswer } from "./hover.ts";
import type { Kind } from "./identity.ts";
import type { AgentWho } from "./presence.ts";
import type { ReviewStore } from "./review.ts";
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
import { companion, viewLink, viewPost } from "./agentfollow.ts";
import { MAX_PINS, pins, place, undoPost } from "./agentplaces.ts";
import { EXPORT_PARAMS, artwork, exportFileGet, exportGet, exportJob, exportPost } from "./agentexport.ts";
import { activity } from "./agentactivity.ts";

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

/** A request as server/appagent.ts read it: the query for a GET, the JSON body for a POST. */
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

/** what a trusted standard axiom is trusted by */
const STANDARD = "standard axiom";

interface Endpoint {
  method: "GET" | "POST";
  /** its path; a last part `{name}` is any one part, read as the query parameter `name` */
  path: string;
  about: string;
  /** a line for the entry, where it names the endpoint among the most used (server/agententry.ts,
   *  ENTRY) */
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
  readonly exportJobs = new Map<string, string>();
  /** the past builds views are printed at lately (server/pastdoc.ts) */
  readonly pasts: PastBuilds;

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
        run: (a) => companion(this, a),
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
        run: (a) => exportGet(this, a),
      },
      {
        method: "POST", path: "/api/agent/export", about: "Typeset a view's document with XeLaTeX, as the page's Export does (ExportSpec decision 11): the answer comes at once with its job — 202 while it runs, 200 when it is done already (the same document asked again is the same job; done ones are cached). One job of yours runs at a time: another while it runs is answered 429, with Retry-After and that job. 503 where the server has no XeLaTeX; 400 for a view that holds nothing of the project, or more than 2,000 of its declarations. Any level may export: it only reads. A target's key document is its Key view (open key(T), export that view); the full review set is a view of its scope (open tcb(T) except trusted or (uses(T) and kind(axiom) and nonstandard), export that view). A view kept at a past build is typeset at that build, as GET /api/agent/export's model says.",
        params: { view: EXPORT_PARAMS.view, settings: `optional: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}`, version: EXPORT_PARAMS.version },
        returns: "{job: {id, state: running|done|failed, at, pages?, ms?, runs?, cached?, error?, log?, notes?: [what the document does not say about how it was made, e.g. the definitions whose proofs were found by reading their text]}, next?: the request that says how it is doing, files?: {pdf, tex, sty, zip} once done}",
        run: (a) => exportPost(this, a),
      },
      {
        method: "GET", path: "/api/agent/export/job", about: "How a typesetting job is doing: running, done (with its pages and the files to download) or failed (why, and the end of XeLaTeX's log); its notes say what the document does not about how it was made.",
        params: { id: "the job's id" },
        returns: "{job, next?, files?: {pdf, tex, sty, zip}}",
        run: (a) => exportJob(this, a.query.get("id") ?? "", true),
      },
      {
        method: "GET", path: "/api/agent/export/file", about: "A typeset document's file: the PDF (application/pdf), its .tex, the style file visualproof.sty, or a zip of everything needed to typeset it again (the .tex, the style file, the fonts). 409 with Retry-After while it is being typeset, 409 where it failed, 404 where it is unknown or has left the cache.",
        params: { id: "the job's id", what: "pdf (default) | tex | sty | zip" },
        returns: "the file, as an attachment",
        run: (a) => exportFileGet(this, a),
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
        run: (a) => activity(this, a),
      },
      {
        method: "GET", path: "/api/agent/place", about: "Where a declaration or a cluster is on the Project view (for another view: GET /api/agent/views/view), in its parent cluster's coordinates (origin the parent's centre), as laid out and as pinned (and by whom); and what else is in the parent — declarations and clusters, each with its radius, where it is and whether it is pinned — nearest first, so that a pin can go where nothing is.",
        params: { name: "a declaration — or —", cluster: "a cluster's key (its full path)", mode: "namespace (default) or module: the way of clustering", near: "optional x,y in the parent's coordinates: the siblings nearest there first (default: nearest the thing itself)", limit: "how many siblings (default 100, at most 2000; 0 for none)" },
        returns: "{mode, kind, key, parent: {cluster, r, room}, r, room, laidOut: [x, y], pinned: [x, y] | null, pinnedBy?: {name (null: someone — a private reader, or a page without a name), agent, at} | null, siblings: {total, pinned, nearestTo, more, list: [{kind, key, declKind?, r, at, gap (free space to it from nearestTo; < 0: overlap), pinned, pinnedBy?, laidOut?}]}}",
        run: (a) => place(this, a),
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
        run: (a) => viewPost(this, a),
      },
      {
        method: "POST", path: "/api/agent/view/link", about: "A link to what you look at, or to a place you give, that opens exactly that for whoever opens it, as a person's Share makes with Exactly what I see (the owner's decision of 2026-10-12): the address, and after it a snapshot of everything followed — the view, the build in the Time Machine, the region of the board, the tool, the selection, the focus, the panel, the source windows, the reference window, Activity, the lost-and-found, the colouring, the edges. Fields you send are taken over your own place (as POST view takes them); nothing moves, you neither. The page that opens it applies it once, and says in a line what is no longer there. It holds no key: it opens for whoever is let in already, the people on the page.",
        params: { "view, review, sel, selection, mode, source, focus, paper": "as POST view: over your own place", sourceCollapsed: "true: the source window following sel is collapsed to its pill", pinned: `source windows pinned, [{name, collapsed?}], at most ${MAX_PINNED}, the first pinned first`, history: "a snapshot's id (GET /api/agent/history): the Time Machine at that build; null for none", region: "[x, y, w, h]: the region of the board framed — its centre, width and height in the board's world — fitted to the opener's screen; left out, framed as for any link", activity: "{open, kind?, who?, mine?}: Activity open or closed, its filters", lostFound: "true: the lost-and-found open", scheme: "kind or status: the colouring", edges: "edges drawn", exact: "false: only the view, as Share's switch turned off makes it (the address alone)" },
        returns: "{ok, link, exact, carries: what the link opens on, length, note, temporary?}",
        run: (a) => viewLink(this, a),
      },
      {
        method: "POST", path: "/api/agent/artwork", about: "A link that opens the board as a picture, in the artwork mode, as the recipe says (ExportSpec decision 20): its size, its look, names by a rule, the targets marked, the selection — in words that hold on any project, so that one recipe makes the same kind of picture of every codebase; the page saves the PNG or SVG where asked, once the board is ready. It changes nothing, and holds no key. A name, a target or a cluster the board has not is refused (404, problems).",
        params: { recipe: "the picture: {size, orientation, style, theme, transparent, colouring, border, title, subtitle, titleSize, footSize, source, names, targets, keys, notes, edges, selection, lit, view}, each optional (GET /api/agent/docs/export, \"Artwork\")", save: "png, svg or png,svg: the files the page saves once the board is ready; left out, none" },
        returns: "{ok, link, length, size: [w, h], names: {clusters, decls: written wherever they fall; ruled: by the rule, each only where it covers no other name} | how the board writes them, targets, selection, left: names and targets left out for room, note}",
        run: (a) => artwork(this, a),
      },
      {
        method: "POST", path: "/api/agent/pins", needs: "full", about: "Drop or let go of pins on the Project view, as people drag (for another view: POST /api/agent/views/arrange): one batch, recorded in the timeline with what it replaced, undoable at once.",
        params: { mode: "namespace (default) or module", pins: `[{name or cluster, at: [x, y] in the parent's coordinates (GET /api/agent/place), or null to let go}], at most ${MAX_PINS}` },
        returns: "{ok, id (the batch, for undo; null when nothing changed), count}",
        run: (a) => pins(this, a),
      },
      {
        method: "POST", path: "/api/agent/undo", needs: "full", about: "Undo a layout batch: its pins go back to what they were, except those someone moved since (listed as kept).",
        params: { id: "the batch's id" },
        returns: "{ok, id, restored, kept: [keys], note?}",
        run: (a) => undoPost(this, a),
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
