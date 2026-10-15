// Where the page gets its data: the live server, or a snapshot carried inside the page itself
// (`visualproof export`), which opens from disk with no server at all.

import type { Outline } from "../../shared/doc/outline.ts";
import type { BoardMemory } from "../../shared/board.ts";
import type { AgentTalk, AgentTokenInfo, ChatMessage, PersonInvite, PresenceView, ReadOnlyLink } from "../../shared/collab.ts";
import type { ClusterMode, ViewMeta } from "../../shared/graph.ts";
import { CLUSTER_MODES } from "../../shared/places.ts";
import { cleanQuery, printQuery } from "../../shared/query.ts";
import { invalidViewOps, summary, ViewBook } from "../../shared/views.ts";
import type { Change, ViewData, ViewOp, ViewSummary } from "../../shared/views.ts";
import type { StoredEvent } from "../../shared/timeline.ts";
import { reviewFromJson } from "../../shared/review.ts";
import { isPackedEdges, unpackEdges } from "../../shared/edgecodec.ts";
import type { ReviewChange, ReviewData, ReviewRequest, ReviewWhole } from "../../shared/review.ts";
import type { BuildLine, LostAnswer, LostMigration } from "../../shared/lostfound.ts";
import { cleanProjectNotes, invalidProjectNoteOps } from "../../shared/projectnotes.ts";
import type { ClusterPlace, ProjectNote, ProjectNoteOp } from "../../shared/projectnotes.ts";
import type { NotePlace } from "../../shared/sticky.ts";
import type { PastSource, PastSourceMissing } from "./pastsource.ts";
import type { AskAnswer, AskSent } from "../../shared/askfollow.ts";

/** The review as the server last told it: the replay of its logs at revision `rev` of the server's
 *  run `epoch`, and the lines of the logs that cannot be read (shared/review.ts). */
export type ReviewState = ReviewWhole;

/** The whole review as JSON carried it, its objects keyed by names made again without a prototype. */
export function reviewState(raw: unknown): ReviewState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ReviewWhole>;
  return {
    epoch: typeof r.epoch === "string" ? r.epoch : "",
    rev: typeof r.rev === "number" ? r.rev : 0,
    data: reviewFromJson(r.data),
    problems: Array.isArray(r.problems) ? r.problems : [],
    error: typeof r.error === "string" ? r.error : null,
  };
}

import type { ModuleContexts } from "../../shared/context.ts";
import type { ExportHead, ExportJobState } from "./exportmodal.ts";

export interface Status {
  state: "extracting" | "ready" | "error";
  log: string[];
  error?: string;
  /** the server's "Open in editor" template (`--editor`, shared/editor.ts); a snapshot has none */
  editor?: string | null;
}

export interface Source {
  file: string;
  text: string;
  /** the Lake hash of `text`: compared with the module's `compiled` hash, it says whether this is
   *  the text the graph was read from */
  hash?: string;
  /** the contexts the usage pass read from the elaborator for this text (shared/context.ts); absent
   *  where it has not, and the context is read from the text */
  contexts?: ModuleContexts;
}

/** What the server answers about views (server/views.ts): `error`, and `who` when it wants a name. */
export interface ViewAnswer {
  ok?: boolean;
  error?: string;
  who?: boolean;
  view?: ViewData;
  scope?: string;
  /** a layout's memory handed over: taken, or the one there is instead */
  accepted?: boolean;
  current?: BoardMemory | { set: string } | null;
}

/** What the server answers to an action on the lost-and-found: `error`, and `who` when it wants a
 *  name. */
export interface LostReply {
  ok?: boolean;
  changed?: boolean;
  error?: string;
  who?: boolean;
  migration?: LostMigration;
}

/** The history the lost-and-found and the build-status popover read (HistorySpec decisions 12–15):
 *  the server's; a snapshot keeps none. */
export interface LostApi {
  /** the builds the history keeps, oldest first, and the latest's id; null where it keeps none */
  builds(): Promise<{ snapshots: BuildLine[]; current: number | null } | null>;
  /** the lost-and-found (GET /api/history/lost); null where it cannot be read */
  list(): Promise<LostAnswer | null>;
  /** archive entries, or put them back (`on` false) */
  archive(keys: string[], on: boolean): Promise<LostReply>;
  /** Attach to…: what was said of `from` carried to `to`; a migration undone */
  move(from: string, to: string): Promise<LostReply>;
  unmove(id: string): Promise<LostReply>;
}

/** The views (ViewSpec.md): the server's, or a snapshot's kept in the page. */
export interface ViewsApi {
  list(): Promise<ViewSummary[]>;
  /** a view in full, and which set each of its layouts' memory was made for; null when it is gone */
  get(id: string): Promise<{ view: ViewData; memory: Partial<Record<ClusterMode, string>> } | null>;
  memory(id: string, mode: ClusterMode): Promise<BoardMemory | null>;
  /** the project's notes (AttachmentSpec decision 13), every one; none where they cannot be read */
  notes(): Promise<ProjectNote[]>;
  /** POST /api/views/<action>: open, create, rename, delete, scope, focus, link, clustering,
   *  arrange, relayout, memory, notes (the project's notes' operations), note-kind (a note made a
   *  view's own, or the project's) */
  post(action: string, body: Record<string, unknown>): Promise<ViewAnswer>;
}

export interface DataSource {
  /** set for a snapshot: when and what it was taken from */
  snapshot: { createdAt: string; label: string } | null;
  status(): Promise<Status>;
  /** `version`: the graph version the page was told about; an older one is refused */
  meta(version?: number): Promise<ViewMeta>;
  edges(version?: number): Promise<ArrayBuffer>;
  source(module: string): Promise<Source | null>;
  /** forget fetched sources: a new graph means the files may have changed */
  forget(): void;
  /** a module's text at a past build, the snapshot `snapshot`'s (GET /api/history/source), or why
   *  it is not kept; a snapshot of the page keeps no history */
  pastSource(snapshot: number, module: string): Promise<PastSource | PastSourceMissing>;
  /** the review (ReviewSpec.md), whole */
  review(): Promise<ReviewState>;
  /** record an opinion, a target, a trusted prefix, a key declaration; resolves to what changed
   *  (null: nothing did, it was so already), rejects with the reason it was refused */
  postReview(op: ReviewRequest): Promise<ReviewChange | null>;
  /** what Lean says is at a position of a module's file (0-based line, UTF-16 column), for the
   *  text with Lake hash `hash`; null where there is no Lean to ask (a snapshot) */
  hover(module: string, line: number, character: number, hash: string): Promise<HoverReply | null>;
  /** have Lean start on a module's file, before the first hover */
  hoverOpen(module: string): void;
  /** what Lean says about a declaration by name, where `module` is imported (server/hover.ts,
   *  `describe`); null without Lean */
  describe(module: string, name: string): Promise<HoverReply | null>;
  /** what Lean's `#print` says of `name` where `module` is imported (a declaration Lean generated
   *  has no text of its own); null without Lean */
  print(module: string, name: string): Promise<PrintReply | null>;
  /** the reader's name, sent with every request (CollabSpec decision 3); null without one */
  name: string | null;
  /** while the reader is private (CollabSpec decision 8), what this page calls itself (its event
   *  stream's session), said with every request: what it arranges is recorded without a name, and
   *  the views it reads or opens are kept for it; null while the reader is visible */
  privateSession: string | null;
  /** how names are given on this server ("none" in a snapshot), and the proxy's name for this page,
   *  or the personal link it came by */
  identity(): Promise<Identity>;
  /** the name this reader goes by from now on (POST /api/identity, CollabSpec decision 9): kept
   *  with their personal link, or — a guest's — checked not to be a link holder's (`taken`) */
  setIdentity(name: string): Promise<{ ok?: true; name?: string; person?: PersonInvite; error?: string; taken?: boolean }>;
  /** tell the others where this page is (CollabSpec decision 4), or only that it is here (a private
   *  page, decision 8), by the secret this page's event stream was given (`hello`) */
  presence(token: string, beat: Heartbeat): void;
  /** what the server's timeline holds (CollabSpec decision 5); a snapshot has none */
  activity(): Promise<StoredEvent[]>;
  /** what this page may share (web/src/share.ts): the link that lets someone in, and whether
   *  read-only links can be made here */
  shareInfo(): Promise<ShareInfo>;
  /** sharing with AI agents (AgentSpec decision 7): the tokens in force and what a new one may be;
   *  null where there is no server (a snapshot) or it cannot be reached */
  agentShares(): Promise<AgentShares | null>;
  /** a token for an agent and the prompt that carries it, or why not (`who`: a name is needed); no
   *  name gives the reader's AI ("Alice's AI") */
  shareAgent(body: { name?: string; level: string; days: number }): Promise<{ prompt: string; token: AgentTokenInfo; tokens: AgentTokenInfo[] } | { error: string; who?: boolean }>;
  /** the prompt of a token in force, shown again, or why not */
  agentPrompt(id: string): Promise<{ prompt: string; token: AgentTokenInfo } | { error: string; who?: boolean }>;
  /** revoke a token: the tokens in force after, or why not */
  revokeAgent(id: string): Promise<{ tokens?: AgentTokenInfo[]; error?: string; who?: boolean }>;
  /** the personal links in force (CollabSpec decision 9); null where there are none to have (a
   *  snapshot, a server behind a sign-in) or the server cannot be reached */
  invites(): Promise<PersonInvite[] | null>;
  /** a personal link for a person named `name`, made under this reader's name: the link, shown
   *  this once, or why not (`taken`: someone with a link goes by that name) */
  invite(name: string): Promise<{ invite: PersonInvite; link: string; invites: PersonInvite[] } | { error: string; who?: boolean; taken?: boolean }>;
  /** revoke a personal link: the links in force after, or why not */
  revokeInvite(id: string): Promise<{ invites?: PersonInvite[]; error?: string; who?: boolean }>;
  /** the read-only links (CollabSpec decision 11), in force first, each with its address; null
   *  where there are none to have (a snapshot, a server that lets in anyone or is behind a
   *  sign-in, a read-only reader) or the server cannot be reached */
  readOnlyLinks(): Promise<ReadOnlyLinkShown[] | null>;
  /** a read-only link, made under this reader's name if they have one, or why not */
  makeReadOnly(): Promise<{ made: ReadOnlyLinkShown; links: ReadOnlyLinkShown[] } | { error: string }>;
  /** revoke a read-only link: the links after, or why not (`who`: a name is needed) */
  revokeReadOnly(id: string): Promise<{ links?: ReadOnlyLinkShown[]; error?: string; who?: boolean }>;
  /** an agent's conversation (AgentSpec decision 8), by the agent's id in presence; null where it
   *  cannot be read */
  chat(agent: string): Promise<{ agent: { id: string; name: string | null; talk: AgentTalk }; messages: ChatMessage[] } | null>;
  /** write to an agent, from where this page is; the message, or why not ("offline": it neither
   *  listens nor works) */
  sendChat(agent: string, text: string, place: PresenceView): Promise<{ message: ChatMessage } | { error: string; who?: boolean }>;
  /** start a new conversation with an agent (the owner's decision of 2026-10-11): the divider, null
   *  where nothing was said since the last one, or why not */
  newChat(agent: string): Promise<{ divider: ChatMessage | null } | { error: string; who?: boolean }>;
  /** ask everyone on the server to follow this reader, or the person whose page is `to` (CollabSpec
   *  decision 10), from this page's event stream (its secret, `hello`): whom it went to, or why not
   *  (`who`: a name is needed; `retryAfter`: asked a moment ago) */
  askFollow(token: string, to: string | null): Promise<AskSent | { error: string; who?: boolean; retryAfter?: number }>;
  /** this page's answer to a request to follow it was shown */
  answerAsk(token: string, id: string, answer: AskAnswer): void;
  /** typeset the document of a view (POST /api/export, ExportSpec.md), and how its job is doing;
   *  the job, or why it was refused */
  /** the title and the author line the document of a view will have (ExportSpec decisions 14, 15),
   *  at the build `version` names (a preview's; left out, the view's own: decision 16) */
  exportHead(view: string, version?: number | null): Promise<ExportHead | string>;
  /** the outline of the document of a view (ExportSpec decision 18, the linear form), at the build
   *  `version` names; or why there is none */
  exportOutline(view: string, version?: number | null): Promise<Outline | string>;
  exportDoc(body: { view: string; settings: object; version?: number | null }): Promise<ExportJobState | string>;
  exportJob(id: string): Promise<ExportJobState | string>;
  /** undo an agent's layout batch (AgentSpec decision 4); why not, when refused */
  undoLayout(id: number): Promise<{ error?: string; who?: boolean }>;
  /** what Lean says each position names (server/hover.ts, `names`); null without Lean */
  names(module: string, positions: [number, number][], hash: string): Promise<NamesReply | null>;
  views: ViewsApi;
  /** the lost-and-found and the builds (HistorySpec.md); null in a snapshot */
  lost: LostApi | null;
}

/** What Share is told about sharing with agents: the levels a token may have here (at most the
 *  server's --agents), the defaults, and the tokens in force. */
export interface AgentShares {
  level: string;
  levels: string[];
  defaultLevel: string;
  days: number[];
  defaultDays: number;
  tokens: AgentTokenInfo[];
}

export type { ChatMessage };

export interface NamesReply {
  /** per position: the first word of Lean's hover there, or null */
  heads?: (string | null)[];
  pending?: { line: number; of: number };
  stale?: boolean;
  error?: string;
}

export interface Identity {
  mode: "declared" | "header" | "none";
  name: string | null;
  /** the personal link this page came by (CollabSpec decision 9): who the reader is */
  person?: PersonInvite;
  /** why the name this page gives is not its own: a link holder goes by it */
  taken?: string;
  /** the personal link this page came by, revoked: by whom, and when */
  revoked?: { by: string | null; at: string | null; name: string };
  /** a read-only reader (CollabSpec decision 11): let in by a read-only link, or by --public */
  readOnly?: { by: "link" | "public" };
}

/** What a page may share (`GET /api/share`, web/src/share.ts). */
export interface ShareInfo {
  /** the path of the link that lets someone in: `/k/<key>`; for a read-only reader the read-only
   *  link they came by, or `/` where anyone may read (--public); null where anyone is let in */
  path: string | null;
  /** the reader is read-only (CollabSpec decision 11) */
  readOnly?: boolean;
  /** read-only links can be made here: the server lets in only those given a link, and no sign-in
   *  stands in front of it */
  readOnlyLinks?: boolean;
  /** anyone who reaches the server may read it (--public) */
  public?: boolean;
}

/** A read-only link as Share shows it: with its full address. */
export type ReadOnlyLinkShown = ReadOnlyLink & { link: string };

/** What a page's heartbeat says (CollabSpec decision 4): where it is; or, from a private page
 *  (decision 8), only that it is here. */
export type Heartbeat = { view: PresenceView | null; idle: boolean } | { private: true };

/** A heartbeat as it goes to the server (POST /api/presence), from the headers the page's requests
 *  carry. A private page's carries its stream's secret and the flag, and nothing else: neither the
 *  name nor where the page is (CollabSpec decision 8). */
export function heartbeatRequest(token: string, beat: Heartbeat, headers: Record<string, string>): { headers: Record<string, string>; body: string } {
  if ("private" in beat) return { headers: { "content-type": "application/json" }, body: JSON.stringify({ token, private: true }) };
  return { headers, body: JSON.stringify({ token, view: beat.view, idle: beat.idle }) };
}

export interface PrintReply {
  messages?: { severity: string; text: string }[];
  pending?: { line: number; of: number };
  error?: string;
}

export interface HoverReply {
  contents?: string | null;
  /** not elaborated that far yet: how far Lean has got */
  pending?: { line: number; of: number };
  /** the file changed: read the source again */
  stale?: boolean;
  error?: string;
}

/** A gzipped, base64-encoded payload in a <script type="application/octet-stream"> block. */
async function inflate(id: string): Promise<ArrayBuffer> {
  const b64 = document.getElementById(id)!.textContent!.trim();
  // a data: URL decodes base64 natively, and works on a page opened from file://
  const res = await fetch(`data:application/octet-stream;base64,${b64}`);
  const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** A snapshot's views, kept in the page: the kept views it was taken with, the targets' links as the
 *  review it was taken with says (ViewSpec decision 29). What is changed in them stays in the page
 *  until it is closed: a snapshot is frozen, and has no one to share with. */
function snapshotViews(json: <T>(id: string) => Promise<T>): ViewsApi {
  let book: Promise<ViewBook> | null = null;
  const load = () =>
    (book ??= (async () => {
      const kept = await json<{ views: ViewData[]; memory: Record<string, Partial<Record<ClusterMode, BoardMemory>>>; notes?: unknown }>("vp-views");
      const b = new ViewBook(kept.views, cleanProjectNotes(kept.notes));
      for (const [id, m] of Object.entries(kept.memory)) b.memory.set(id, m);
      const review = reviewFromJson(await json<ReviewData>("vp-review"));
      b.syncTargets(Object.keys(review.targets));
      return b;
    })());
  const err = (r: unknown): ViewAnswer | null => (typeof r === "string" ? { error: r } : null);
  return {
    list: async () => (await load()).list().map(summary),
    get: async (id) => {
      const b = await load();
      const view = b.get(id);
      if (!view) return null;
      const memory: Partial<Record<ClusterMode, string>> = {};
      for (const m of CLUSTER_MODES) {
        const set = b.memoryOf(id, m)?.set;
        if (set) memory[m] = set;
      }
      return { view, memory };
    },
    memory: async (id, mode) => (await load()).memoryOf(id, mode),
    // a copy, as the server's answer is: the page applies its own operations to what it holds
    notes: async () => structuredClone((await load()).notes),
    post: async (action, body) => {
      const b = await load();
      const id = String(body.id ?? "");
      const scope = body.scope === undefined ? undefined : cleanQuery(body.scope);
      if (scope === null) return { error: "The scope is not a query." };
      const done = (r: Change | Change[] | string | null): ViewAnswer => err(r) ?? { ok: true };
      switch (action) {
        case "open":
          // a snapshot has no history: every view shows its graph
          return scope
            ? { view: b.open(scope, null, Date.now(), { ...(body.clustering === "module" || body.clustering === "namespace" ? { clustering: body.clustering } : {}), ...(typeof body.focus === "string" ? { focus: body.focus } : {}) }).view }
            : { error: "scope" };
        case "create": {
          const v = b.create(String(body.name ?? ""), null, { scope, clustering: body.clustering as ClusterMode | undefined, from: typeof body.from === "string" ? body.from : undefined });
          return typeof v === "string" ? { error: v } : { view: v };
        }
        case "rename":
          return done(b.rename(id, typeof body.name === "string" && body.name ? body.name : null, null));
        case "delete":
          return done(b.remove(id, null));
        case "scope":
          return scope ? { ...done(b.setScope(id, scope, null)), scope: printQuery(scope) } : { error: "scope" };
        case "clustering":
          return done(b.setClustering(id, body.clustering as ClusterMode, null));
        case "focus":
          return done(b.setFocus(id, typeof body.focus === "string" ? body.focus : null, null));
        case "link":
          return typeof body.target === "string" ? done(b.link(id, body.target, null)) : { error: "target" };
        case "target":
          return typeof body.target === "string" ? { view: b.openTarget(body.target, null).view } : { error: "target" };
        case "arrange":
          return invalidViewOps(body.ops) ? { error: "ops" } : done(b.arrange(id, (body.ops as ViewOp[]).filter((o) => o.op !== "clear"), null));
        case "relayout":
          return done(b.relayout(id, null));
        case "notes": {
          if (invalidProjectNoteOps(body.ops)) return { error: "ops" };
          const ops = body.ops as ProjectNoteOp[];
          const had = new Set(b.notes.map((n) => n.id));
          b.noteOps(ops);
          // a note deleted leaves every view's lists; one written in a view is added to it
          for (const o of ops) if (o.op === "pnote-delete" && had.has(o.id)) b.dropItems(o.id);
          if (typeof body.in === "string") b.written(body.in, ops.flatMap((o) => (o.op === "pnote" && !had.has(o.note.id) ? [o.note.id] : [])), null);
          return { ok: true };
        }
        case "note-kind": {
          const r = b.switchNote(String(body.note ?? ""), id, body.to === "view" ? "view" : "project", body.place as NotePlace | ClusterPlace, body.mode === "module" ? "module" : "namespace");
          return typeof r === "string" ? { error: r } : { ok: true };
        }
        case "memory": {
          const r = b.setMemory(id, body.mode as ClusterMode, typeof body.base === "string" ? body.base : null, body.memory as BoardMemory);
          return typeof r === "string" ? { error: r } : r;
        }
      }
      return { error: "not found" };
    },
  };
}

function snapshotSource(info: { createdAt: string; label: string }): DataSource {
  let sources: Promise<Record<string, Source>> | null = null;
  const json = async <T>(id: string): Promise<T> => JSON.parse(new TextDecoder().decode(await inflate(id)));
  return {
    views: snapshotViews(json),
    lost: null,
    snapshot: info,
    status: async () => ({ state: "ready", log: [] }),
    forget: () => {},
    meta: () => json<ViewMeta>("vp-meta"),
    edges: () => inflate("vp-edges"),
    // a snapshot shows the review as it was when taken
    review: () => json<ReviewData>("vp-review").then((data) => ({ epoch: "snapshot", rev: 0, data: reviewFromJson(data), problems: [], error: null })),
    postReview: () => Promise.reject(new Error("a snapshot shows the review as it was; it cannot be changed")),
    name: null,
    privateSession: null,
    identity: async () => ({ mode: "none", name: null }),
    presence: () => {},
    undoLayout: async () => ({ error: "a snapshot shows the layout as it was" }),
    exportHead: async () => "a snapshot cannot typeset documents: export from the server",
    exportOutline: async () => "a snapshot of the page has no linear form: its document is the server's",
    exportDoc: async () => "a snapshot cannot typeset documents: export from the server",
    exportJob: async () => "a snapshot cannot typeset documents: export from the server",
    shareInfo: async () => ({ path: null }),
    agentShares: async () => null,
    shareAgent: async () => ({ error: "a snapshot has no server to share with an agent" }),
    agentPrompt: async () => ({ error: "a snapshot has no server" }),
    revokeAgent: async () => ({ error: "a snapshot has no server" }),
    setIdentity: async () => ({ error: "a snapshot has no server" }),
    invites: async () => null,
    invite: async () => ({ error: "a snapshot has no server to invite anyone to" }),
    revokeInvite: async () => ({ error: "a snapshot has no server" }),
    readOnlyLinks: async () => null,
    makeReadOnly: async () => ({ error: "a snapshot has no server to share" }),
    revokeReadOnly: async () => ({ error: "a snapshot has no server" }),
    chat: async () => null,
    sendChat: async () => ({ error: "a snapshot has no server" }),
    newChat: async () => ({ error: "a snapshot has no server" }),
    askFollow: async () => ({ error: "a snapshot has no one to ask" }),
    answerAsk: () => {},
    activity: async () => [],
    hover: async () => null,
    hoverOpen: () => {},
    names: async () => null,
    describe: async () => null,
    print: async () => null,
    source: async (module) => {
      sources ??= json<Record<string, Source>>("vp-sources");
      return (await sources)[module] ?? null;
    },
    pastSource: async () => ({ missing: true, why: "a snapshot of the page keeps no history" }),
  };
}

function serverSource(): DataSource {
  const cache = new Map<string, Promise<Source | null>>();
  // a past build's text is that build's for good: kept whatever graph comes, a few at a time; a text
  // not kept is asked again next time, the backfill of its build being perhaps not done
  const past = new Map<string, Promise<PastSource | PastSourceMissing>>();
  const src: DataSource = {
    snapshot: null,
    name: null,
    privateSession: null,
    views: {
      list: () =>
        fetch("/api/views")
          .then((r) => (r.ok ? r.json() : { views: [] }))
          .then((b: { views: ViewSummary[] }) => b.views)
          .catch(() => []),
      get: (id) =>
        fetch(`/api/views/view?id=${encodeURIComponent(id)}`, { headers: headers() })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      memory: (id, mode) =>
        fetch(`/api/views/memory?id=${encodeURIComponent(id)}&mode=${mode}`)
          .then((r) => (r.ok ? r.json() : { memory: null }))
          .then((b: { memory: BoardMemory | null }) => b.memory)
          .catch(() => null),
      notes: () =>
        fetch("/api/views/notes", { headers: headers() })
          .then((r) => (r.ok ? r.json() : { notes: [] }))
          .then((b: { notes: unknown }) => cleanProjectNotes(b.notes))
          .catch(() => []),
      post: (action, body) =>
        fetch(`/api/views/${action}`, { method: "POST", headers: headers(), body: JSON.stringify(body) })
          .then((r) => r.json())
          .catch(() => ({ error: "the server could not be reached" })),
    },
    lost: {
      // a server that reads no builds keeps no history: 404
      builds: () =>
        fetch("/api/history")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      list: () =>
        fetch("/api/history/lost")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      archive: (keys, on) => lostPost("archive", { keys, on }),
      move: (from, to) => lostPost("move", { from, to }),
      unmove: (id) => lostPost("unmove", { id }),
    },
    status: () => fetch("/api/status").then((r) => r.json()),
    forget: () => cache.clear(),
    meta: (v) => fetch(`/api/meta${v ? `?v=${v}` : ""}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`meta ${r.status}`)))),
    // packed for the way (shared/edgecodec.ts): a quarter of the bytes
    edges: (v) =>
      fetch(`/api/edges?pack=2${v ? `&v=${v}` : ""}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`edges ${r.status}`))))
        .then((b) => (isPackedEdges(new Uint8Array(b)) ? unpackEdges(new Uint8Array(b)).buffer : b)),
    review: () =>
      fetch("/api/review")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`review ${r.status}`))))
        .then(reviewState),
    hover: (module, line, character, hash) =>
      fetch(`/api/hover?module=${encodeURIComponent(module)}&line=${line}&character=${character}&hash=${hash}`)
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    hoverOpen: (module) => void fetch(`/api/hover/open?module=${encodeURIComponent(module)}`, { method: "POST" }).catch(() => {}),
    describe: (module, name) =>
      fetch(`/api/hover/describe?module=${encodeURIComponent(module)}&name=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    print: (module, name) =>
      fetch(`/api/hover/print?module=${encodeURIComponent(module)}&name=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    names: (module, positions, hash) =>
      fetch(`/api/hover/names?module=${encodeURIComponent(module)}&hash=${hash}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(positions) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    postReview: async (op) => {
      const r = await fetch("/api/review", { method: "POST", headers: headers(), body: JSON.stringify(op) });
      const body = (await r.json().catch(() => ({}))) as { error?: string; who?: boolean; change?: ReviewChange | null };
      if (!r.ok) throw Object.assign(new Error(body.error ?? `review ${r.status}`), { who: body.who === true });
      return body.change ?? null;
    },
    identity: () =>
      fetch("/api/identity", { headers: headers() })
        .then((r) => r.json())
        .catch(() => ({ mode: "declared", name: null })),
    setIdentity: (name) =>
      fetch("/api/identity", { method: "POST", headers: headers(), body: JSON.stringify({ name }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    invites: () =>
      fetch("/api/share/people")
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { invites?: PersonInvite[] } | null) => b?.invites ?? null)
        .catch(() => null),
    invite: (name) =>
      fetch("/api/share/people", { method: "POST", headers: headers(), body: JSON.stringify({ name }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    revokeInvite: (id) =>
      fetch("/api/share/people/revoke", { method: "POST", headers: headers(), body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    readOnlyLinks: () =>
      fetch("/api/share/readonly")
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { links?: ReadOnlyLinkShown[] } | null) => b?.links ?? null)
        .catch(() => null),
    makeReadOnly: () =>
      fetch("/api/share/readonly", { method: "POST", headers: headers(), body: "{}" })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    revokeReadOnly: (id) =>
      fetch("/api/share/readonly/revoke", { method: "POST", headers: headers(), body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    activity: () =>
      fetch("/api/activity")
        .then((r) => (r.ok ? r.json() : { events: [] }))
        .then((b: { events: StoredEvent[] }) => b.events)
        .catch(() => []),
    shareInfo: () =>
      fetch("/api/share")
        .then((r) => r.json())
        .then((b: ShareInfo) => ({ ...b, path: typeof b.path === "string" ? b.path : null })),
    agentShares: () =>
      fetch("/api/share/agents")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    shareAgent: (body) =>
      fetch("/api/share/agents", { method: "POST", headers: headers(), body: JSON.stringify(body) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    agentPrompt: (id) =>
      fetch("/api/share/agents/prompt", { method: "POST", headers: headers(), body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    revokeAgent: (id) =>
      fetch("/api/share/agents/revoke", { method: "POST", headers: headers(), body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    chat: (agent) =>
      fetch(`/api/chat?agent=${encodeURIComponent(agent)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    // a private reader's message says who wrote it, not where they are (CollabSpec decision 8)
    sendChat: (agent, text, place) =>
      fetch("/api/chat", { method: "POST", headers: headers(), body: JSON.stringify({ agent, text, place: src.privateSession ? null : place }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    newChat: (agent) =>
      fetch("/api/chat/new", { method: "POST", headers: headers(), body: JSON.stringify({ agent }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    askFollow: (token, to) =>
      fetch("/api/ask", { method: "POST", headers: headers(), body: JSON.stringify({ token, ...(to ? { to } : {}) }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    // a private reader is asked too, and answers without a name: the stream's secret says which page
    answerAsk: (token, id, answer) => {
      void fetch("/api/ask/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, id, answer }), keepalive: true }).catch(() => {});
    },
    exportHead: async (view, version) => {
      try {
        const res = await fetch(`/api/export/head?view=${encodeURIComponent(view)}${version !== undefined ? `&version=${version ?? 0}` : ""}`);
        const b = (await res.json().catch(() => ({}))) as { title?: unknown; author?: unknown; error?: string };
        return typeof b.title === "string" && typeof b.author === "string" ? { title: b.title, author: b.author } : (b.error ?? `the server answered ${res.status}`);
      } catch {
        return "the server could not be reached";
      }
    },
    exportOutline: async (view, version) => {
      try {
        const res = await fetch(`/api/export/outline?view=${encodeURIComponent(view)}${version !== undefined ? `&version=${version ?? 0}` : ""}`);
        const b = (await res.json().catch(() => ({}))) as { outline?: Outline; error?: string };
        return b.outline && Array.isArray(b.outline.items) ? b.outline : (b.error ?? `the server answered ${res.status}`);
      } catch {
        return "the server could not be reached";
      }
    },
    exportDoc: (body) => exportAnswer(fetch("/api/export", { method: "POST", headers: headers(), body: JSON.stringify(body) })),
    exportJob: (id) => exportAnswer(fetch(`/api/export/job?id=${encodeURIComponent(id)}`)),
    undoLayout: (id) =>
      fetch("/api/layout/undo", { method: "POST", headers: headers(), body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .catch(() => ({ error: "the server could not be reached" })),
    presence: (token, beat) => {
      const r = heartbeatRequest(token, beat, headers());
      // its answer let go: the browser holds the requests kept alive, 64 KB between them, until their
      // answers are read, and a heartbeat carrying an artwork's names chosen is some kilobytes
      void fetch("/api/presence", { method: "POST", headers: r.headers, body: r.body, keepalive: true })
        .then((res) => res.body?.cancel())
        .catch(() => {});
    },
    source: (module) => {
      let p = cache.get(module);
      if (!p) {
        p = fetch(`/api/source?module=${encodeURIComponent(module)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        cache.set(module, p);
      }
      return p;
    },
    pastSource: (snapshot, module) => {
      const key = `${snapshot}\u0000${module}`;
      let p = past.get(key);
      if (!p) {
        p = fetch(`/api/history/source?id=${snapshot}&module=${encodeURIComponent(module)}`)
          .then(async (r) => {
            const b = (await r.json().catch(() => null)) as (PastSource & { error?: string; why?: string | null }) | null;
            if (r.ok && b && typeof b.text === "string") return b;
            past.delete(key);
            return { missing: true as const, why: b?.why ?? b?.error ?? null, ...(b?.file ? { file: b.file } : {}) };
          })
          .catch(() => {
            past.delete(key);
            return { missing: true as const, why: null };
          });
        past.set(key, p);
        while (past.size > 64) past.delete(past.keys().next().value!);
      }
      return p;
    },
  };
  /** what goes with a request: the reader's name, percent-encoded so that any script travels, and
   *  while they are private, that they are (CollabSpec decision 8) */
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(src.name ? { "x-visualproof-name": encodeURIComponent(src.name) } : {}),
    ...(src.privateSession ? { "x-visualproof-private": src.privateSession } : {}),
  });
  function lostPost(action: string, body: object): Promise<LostReply> {
    return fetch(`/api/history/${action}`, { method: "POST", headers: headers(), body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ error: "the server could not be reached" }));
  }
  return src;
}

/** A job as the server answers it, or why there is none. */
async function exportAnswer(r: Promise<Response>): Promise<ExportJobState | string> {
  try {
    const res = await r;
    const b = (await res.json().catch(() => ({}))) as { job?: ExportJobState; error?: string };
    return b.job ?? b.error ?? `the server answered ${res.status}`;
  } catch {
    return "the server could not be reached";
  }
}

export function dataSource(): DataSource {
  const info = document.getElementById("vp-static");
  return info ? snapshotSource(JSON.parse(info.textContent!)) : serverSource();
}
