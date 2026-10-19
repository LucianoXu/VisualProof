// The live loop: watch what the owner's builds leave behind, tell open pages at once, and
// re-read the graph when a build has settled.
//
// Two speeds, on purpose. Build status is cheap (a few stats and hashes) and goes out every
// second it changes, so a page shows "building 12 / 40" while Lean works. The graph is expensive
// and only meaningful between builds, so it is re-extracted once the outputs stop moving; until
// then the page keeps the last good graph and says how old it is. With nothing happening, the
// loop asks which compiles run, and looks at the files only when a watch says something moved
// (server/buildwatch.ts): a server at rest costs next to nothing.
//
// The extractor's graph is served as soon as it is ready; the usage pass (server/usage.ts) then
// elaborates the modules whose result is not cached, and its findings — the notation each unit is
// written in, the exact contexts — come as the next version of the graph. Where every module's
// result is cached, the merged graph is the first one served.

import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Invited, PresenceView, PrivateCount, StreamHello } from "../shared/collab.ts";
import { sameName } from "../shared/collab.ts";
import type { ViewMeta } from "../shared/graph.ts";
import { prepare } from "./pipeline.ts";
import type { Prepared } from "./pipeline.ts";
import { extract, loadSaved } from "./extract.ts";
import type { Extraction } from "./extract.ts";
import { DEFAULT_JOBS, UsagePass, mergeUsage, saveMerged } from "./usage.ts";
import type { Plan } from "./usage.ts";
import type { ModuleContexts } from "../shared/context.ts";
import type { Project } from "./project.ts";
import type { Dirs } from "./dirs.ts";
import { indexSources } from "./project.ts";
import { LAYOUT_VERSION } from "../shared/graph.ts";
import { fileOf, filesOf } from "../shared/library.ts";
import { Timeline } from "./events.ts";
import { agentKey, Presence } from "./presence.ts";
import { AgentTokens } from "./tokens.ts";
import { Invites } from "./invites.ts";
import { ReadOnlyLinks } from "./readonly.ts";
import { Talk } from "./talk.ts";
import { Asks } from "./askfollow.ts";
import type { ReviewChange, ReviewStore } from "./review.ts";
import type { ReviewData, ReviewRev } from "../shared/review.ts";
import { BuildTracker, compiling, importable, outputsOf, probeAll, scanModules, stampOf } from "./status.ts";
import { BuildWatch, moduleDirs, shouldLook } from "./buildwatch.ts";
import type { BuildStatus, ModuleInfo } from "./status.ts";
import { Views } from "./views.ts";
import type { ViewPlaces } from "./views.ts";
import { graphOf, memoryProblem, titleContext } from "./agentviews.ts";
import { ownName, rebinder, versionBase, versions, withVersions } from "./versions.ts";
import type { Identity, VersionBase } from "./versions.ts";
import { buildTime, commitNow, History } from "./history.ts";
import { backfillSources, keepSources } from "./sourcestore.ts";
import type { SnapGraph } from "./history.ts";
import type { Mover } from "./historyapi.ts";
import { findRenames, Renames } from "./renames.ts";
import { carryClusterLinks, Library } from "./library.ts";
import type { Migration, Pairing } from "./renames.ts";
import { Archive, archiveKeys, lostAndFound, MAX_ARCHIVE_KEYS } from "./lostfound.ts";
import type { LastHad, LostAnswer } from "../shared/lostfound.ts";
import { identityIn, moveIsIdle } from "../shared/moves.ts";
import { SERVER_WRITER } from "./review.ts";
import { join } from "node:path";
import { PROJECT, viewTitle } from "../shared/views.ts";
import { boardSet } from "../shared/board.ts";
import { derivesOn, existsIn } from "../shared/noteplace.ts";
import { packageVersion } from "./version.ts";
import type { UpdateStatus } from "./updates.ts";
import { withoutReasons } from "../shared/timeline.ts";
import type { StoredEvent } from "../shared/timeline.ts";
import type { DeployStatus } from "../shared/deploy.ts";

const TICK = 1000;
/** outputs quiet this long, and no compile running: the build is over */
const SETTLE = 2500;
/** how long a watch's news of a change a look found may take before the look counts as one it
 *  missed (server/buildwatch.ts) */
const MISS_GRACE_MS = 500;
const PING = 15000;
/** Event streams, which every change goes to: at most this many open at once, and this many per
 *  page (`session`: a reload, a lost connection coming back), its oldest closed for a new one. */
export const MAX_STREAMS = 200;
/** Read-only readers' streams (CollabSpec decision 11): a bound of their own, so that they never
 *  take the places of the people working. */
export const MAX_READONLY_STREAMS = 400;
export const MAX_STREAMS_PER_SESSION = 4;
/** what a stream may have waiting to be sent before it is closed: a page that does not read is
 *  not kept up with by holding everything for it — it comes back (EventSource reconnects) and is
 *  sent the present state afresh */
export const MAX_BUFFERED = 4 << 20;
/** the list of who is here goes out at most this often: a burst of heartbeats is one event */
const PRESENCE_EVERY = 500;

/** The graph's modules and their files (meta.modules), per graph read (agentviews.ts, graphOf). */
const moduleFiles = new WeakMap<ViewMeta, Map<string, string | null>>();

/** An open event stream: the page reading it, the id everyone knows it by (presence), and the
 *  secret only it is told, which its heartbeats carry (server/presence.ts). */
interface Stream {
  res: ServerResponse;
  id: string;
  token: string;
  /** what the page calls itself, from the address; never sent to anyone */
  session: string | null;
  /** its heartbeats say it is private (CollabSpec decision 8): counted, never listed */
  private: boolean;
  /** the personal link its page came by (CollabSpec decision 9), whose revoking ends the stream */
  person: string | null;
  /** a read-only reader's (CollabSpec decision 11): the read-only link it came by, whose revoking
   *  ends the stream, or "public" (--public); null for anyone else */
  readOnly: string | null;
  /** told all of the server's own releases (UpdateSpec decision 11): someone let in fully, not a
   *  read-only reader nor an agent */
  toldAll: boolean;
  /** what may wait to be sent before it is closed (push): MAX_BUFFERED beyond its hello, which a
   *  page reads first however large it is (the views, every file's build status: 0.4 MB on
   *  NavierStokesAndEuler); MAX_BUFFERED once the hello is read */
  room: number;
  /** what was written to it since its hello, while that is not all read */
  after: number;
}

export interface GraphInfo {
  version: number;
  /** the server's process the version is counted by (UpdateSpec decision 8): a page told of a
   *  graph by another reads it again, whatever its number */
  instance?: string;
  fingerprint: string;
  at: string;
  /** modules left out because they, or something under them, could not be imported */
  missing: string[];
  /** the usage pass (server/usage.ts): `pending` while it runs on this graph's build, whose next
   *  version brings its findings; `done` when they are in (`failed` modules without them); `off`
   *  when there is no pass (a saved graph, `--jobs 0`) */
  usage?: { state: "pending" | "done" | "off"; failed: number };
  /** following a branch (DeploySpec): the commit whose build the graph was read from */
  commit?: string;
}

/** A branch the server follows and builds itself (server/deploy.ts, DeploySpec), as the live loop
 *  sees it. */
export interface LiveDeploy {
  /** the tree is being changed or built, a build of it was cut short, or none was ever made:
   *  nothing is read from it */
  holds(): boolean;
  /** the commit whose build the tree holds, and the branch: each snapshot's (HistorySpec decision 4) */
  commit(): { hash: string; branch: string } | null;
  /** a build is going on, which a restart would cut short */
  readonly busy: boolean;
  /** what the pages are told: with the build's log for those let in fully, without for read-only
   *  readers */
  status(full: boolean): DeployStatus;
}

export class Live {
  readonly project: Project;
  /** the site directory and the project's caches (server/dirs.ts) */
  readonly dirs: Dirs;
  private saved: string | null;
  private tracker: BuildTracker;
  private mods: Map<string, ModuleInfo> = new Map();
  private lastStamp = "";
  private extractedStamp = "";
  /** what the last look would read: the stamp, or a followed branch's outputs alone */
  private lastRead = "";
  private quietSince = 0;
  /** what tells the loop to look at the files (server/buildwatch.ts) */
  private buildWatch = new BuildWatch((l) => this.say(l));
  /** when the files were last looked at, the compiles that ran then, and the status as last sent */
  private lastLook = 0;
  private lastRunning = "";
  private buildText = "";

  build: BuildStatus | null = null;
  graph: (GraphInfo & { prep: Prepared }) | null = null;
  extracting = false;
  extractError: string | null = null;
  log: string[] = [];
  /** the open event streams, oldest first, and the same by the secret each page holds */
  private streams = new Map<ServerResponse, Stream>();
  private byToken = new Map<string, Stream>();
  /** streams closed for not reading, since the start */
  private dropped = 0;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceDirty = false;
  /** review changes not yet sent: those made in one turn of the event loop go out as one */
  private reviewPending: ReviewChange[] = [];
  private version = 0;
  /** the branch followed (DeploySpec), where the server builds what it shows; null for a workspace,
   *  whose builds are its owner's */
  deploy: LiveDeploy | null = null;
  /** graphs being made ready to serve (install): the tree is read meanwhile */
  private installing = 0;
  /** this server's process, as its pages know it (UpdateSpec decision 8): the graph's versions are
   *  counted again by another */
  readonly instance = randomBytes(6).toString("base64url");
  /** the VisualProof version this server runs, read as it started */
  readonly toolVersion = packageVersion();
  /** what a page is told of VisualProof's releases (server/updates.ts): everything, or the version
   *  alone (`full` false: a read-only reader, an agent); null where nobody follows them (a test's
   *  server) */
  updateStatus: ((full: boolean) => UpdateStatus) | null = null;

  /** the review's logs (ReviewSpec.md, server/review.ts) */
  readonly review: ReviewStore;
  /** who has a page open (CollabSpec.md) */
  readonly presence: Presence;
  /** the views, each a shared board (ViewSpec.md) */
  readonly views: Views;
  /** the Project view's pins, with who dropped each, where something still speaks of the one set
   *  of shared pins (CollabSpec decision 2; the agents' API) */
  readonly places: ViewPlaces;
  /** what happened (CollabSpec decision 5) */
  readonly timeline: Timeline;
  /** the tokens agents were given by Share (AgentSpec decision 7, server/tokens.ts) */
  readonly tokens: AgentTokens;
  /** the personal links people were invited by from Share (CollabSpec decision 9, server/invites.ts) */
  readonly invites: Invites;
  /** read-only links (CollabSpec decision 11, server/readonly.ts) */
  readonly readOnly: ReadOnlyLinks;
  /** the conversations with agents, their waits and their states (AgentSpec decision 8, server/talk.ts) */
  readonly talk: Talk;
  /** the requests to follow going on (CollabSpec decision 10, server/askfollow.ts): relayed to the
   *  pages asked through their streams, and their answers to the page that asked */
  readonly asks: Asks;
  /** the "Open in editor" template the server was started with (shared/editor.ts) */
  readonly editor: string | null;
  /** the usage pass, `jobs` workers at a time (0: none) */
  readonly usage: UsagePass;
  /** the extraction the usage pass runs for: its findings are merged into that one only */
  private passFor: string | null = null;
  /** a snapshot of the graph at every build read (HistorySpec.md, server/history.ts); none for a
   *  saved graph, which is no build */
  readonly history: History | null;
  /** the renames found at each build and those migrated (server/renames.ts) */
  readonly renames: Renames | null;
  /** the library's files, by their hash (AttachmentSpec.md, server/library.ts) */
  readonly library: Library;
  /** what is archived of the lost-and-found (server/lostfound.ts) */
  readonly archive: Archive | null;
  /** the lost-and-found as the pages were last told it: how many entries it lists, and a revision
   *  that changes with what it holds (`lost`) */
  private lostSent: { rev: number; count: number; lost: number; sig: string } = { rev: 0, count: 0, lost: 0, sig: "" };
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  /** what the versions of the graph on show are made of, and the versions (server/versions.ts) */
  private base: VersionBase | null = null;
  private versions: string[] = [];
  private nodeIndex = new Map<string, number>();
  /** the declarations outside the project the graph on show refers to: in it too */
  private outside = new Set<string>();

  constructor(project: Project, dirs: Dirs, saved: string | null, review: ReviewStore, editor: string | null = null, jobs = DEFAULT_JOBS) {
    this.project = project;
    this.dirs = dirs;
    this.saved = saved;
    this.review = review;
    this.editor = editor;
    this.usage = new UsagePass(project, dirs, saved ? 0 : jobs, (l) => this.say(l));
    this.tracker = new BuildTracker(project);
    this.timeline = new Timeline(dirs.site, (e) => this.sendActivity(e));
    this.tokens = new AgentTokens(dirs.site);
    this.invites = new Invites(dirs.site);
    // every page knows the names the people invited by a link go by, so that what each did shows
    // under the name they go by now; a link revoked cuts its pages off at once, as it does its
    // requests: their streams end, and come back only if the key lets them in
    this.invites.onChanged = () => this.send("people", this.invites.people());
    this.invites.onEnded = (r) => {
      for (const st of [...this.streams.values()]) if (st.person === r.id) this.close(st);
    };
    this.readOnly = new ReadOnlyLinks(dirs.site);
    this.readOnly.onEnded = (l) => {
      for (const st of [...this.streams.values()]) if (st.readOnly === l.id) this.close(st);
    };
    this.talk = new Talk(dirs.site);
    // what changes a view may change the lost-and-found: a pin of a name that is gone, a note
    this.views = new Views(dirs.site, LAYOUT_VERSION, (event, data) => {
      this.send(event, data);
      if (event === "views" || event === "view-ops" || event === "note-ops") this.lostChanged();
    }, this.timeline);
    this.views.syncTargets(Object.keys(review.data.targets));
    this.history = saved ? null : new History(dirs.site);
    this.library = new Library(dirs.site, dirs.cache);
    this.renames = this.history ? new Renames(this.history.dir) : null;
    this.archive = this.history ? new Archive(this.history.dir) : null;
    // a view is kept at a past build the history has (HistorySpec decision 19)
    this.views.snapshotAt = (id) => this.history?.get(id)?.at ?? null;
    this.views.titles = () => titleContext(this);
    this.views.latest = () => this.history?.latest()?.id ?? null;
    // what a view is focused on is a target of the review (ViewSpec decision 28)
    this.views.isTarget = (name) => Object.hasOwn(this.review.data.targets, name);
    // what a note carries is a file of the library, whose records are the review's (AttachmentSpec
    // decision 12)
    this.views.carriedFile = (sha) => fileOf(this.review.data, sha);
    // which notes a view's scope gives (the owner's decision of 2026-10-11: items belong to views as
    // declarations do), read on the graph on show: a copy of the Project takes the others as added
    this.views.book.derives = (v) => {
      const G = graphOf(this);
      if (!G) return null;
      const set = boardSet(G.g, this.review.data, v.scope).set;
      return derivesOn(v.clustering, G.g.nodes.filter((_, i) => set[i]), existsIn(G.g.nodes), this.review.data.links);
    };
    // every item shows on the Project (the owner's decision of 2026-10-11): once, a note of the
    // project for each file of the library no note carries that was never considered — those added
    // before notes carried files, and those whose records came through the logs since the last start
    const noted = this.views.noteLibraryFiles(filesOf(review.data), SERVER_WRITER.name);
    if (noted) this.say(`library: ${noted} file${noted === 1 ? "" : "s"} put on the Project's ring, each carried by a note`);
    // a note's text follows its file's title (the owner's decision of 2026-10-11): the renames made
    // while the server was away, and, the first time, the notes that still say a file's old name
    const followed = this.views.followTitles(review.data, SERVER_WRITER.name);
    if (followed) this.say(`library: ${followed} note${followed === 1 ? "" : "s"} set to the title of the file ${followed === 1 ? "it carries" : "each carries"}`);
    // every change of the review, from a page, an agent or the disk, goes to every page
    review.onChange = (c) => this.reviewChanged(c);
    this.views.onProjectRelayout = () => setTimeout(() => void this.relayout(), 50);
    this.places = this.views.places;
    // presence says which views pages have open: one nobody keeps lives while some page has it
    this.presence = new Presence((peers) => {
      this.views.seenPeers(peers);
      this.presenceChanged();
    });
    this.views.peers = () => this.presence.list();
    // every agent with a token in force is listed, in the state its requests show (listening,
    // thinking, working, offline); a token that ended ends its wait and takes its agent off the
    // list at once
    const talkOf = (id: string) => this.talk.talk(id);
    // read as each agent is first known, before any request of this server's life updates it:
    // whether it was offline while the server was not running
    this.talk.lastUsed = (id) => this.tokens.get(id)?.lastUsed ?? null;
    this.presence.setTokens(this.tokens.inForce(), talkOf);
    this.tokens.onChanged = () => this.presence.setTokens(this.tokens.inForce(), talkOf);
    this.tokens.onEnded = (r) => this.talk.close(r.id, r.revoked ? "revoked" : "expired");
    this.talk.inForce = (id) => this.tokens.inForce().some((r) => r.id === id);
    this.talk.onState = (id, talk) => this.presence.setTalk(id, talk);
    // a new message goes to every page, named by the agent's entry in presence
    this.talk.onMessage = (id, message) => {
      const r = this.tokens.get(id);
      if (r) this.send("chat", { agent: agentKey({ name: r.name, token: r.id }), message });
    };
    this.views.pageOf = (token) => (typeof token === "string" ? this.byToken.get(token)?.id ?? null : null);
    // the views a private page holds live while a page of its session is open
    this.views.sessionOpen = (session) => [...this.streams.values()].some((st) => st.session === session);
    this.views.checkMemory = (v, mode, m) => memoryProblem(this, v, mode, m, this.views.pastOf(v));
    // a request to follow reaches each page asked by its own stream, named as presence lists it
    this.asks = new Asks({
      streams: () => {
        const listed = new Map(this.presence.list().map((p) => [p.id, p]));
        // a read-only reader is seen by nobody, and asked by nobody (CollabSpec decision 11)
        return [...this.streams.values()].filter((st) => st.readOnly === null).map((st) => {
          const p = st.private ? undefined : listed.get(st.id);
          return { token: st.token, id: st.id, private: st.private, name: p && !p.agent ? p.name : null, verified: !!p?.verified };
        });
      },
      peers: () => this.presence.list(),
      send: (token, event, data) => {
        const st = this.byToken.get(token);
        if (st) this.write(st.res, event, data);
      },
    });
  }

  /** The open event stream whose page holds secret `token`: the id the others know it by, and
   *  whether it is private; null for any other. */
  pageStream(token: unknown): { id: string; private: boolean } | null {
    const st = typeof token === "string" ? this.byToken.get(token) : undefined;
    return st ? { id: st.id, private: st.private } : null;
  }

  /** The list of who is here goes out now, or with the next one if one went out just now: at most
   *  one every PRESENCE_EVERY ms, and always the latest. */
  private presenceChanged(): void {
    if (this.presenceTimer) {
      this.presenceDirty = true;
      return;
    }
    this.send("presence", this.presence.list());
    this.send("private", { count: this.presence.privateCount() } satisfies PrivateCount);
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (this.presenceDirty) {
        this.presenceDirty = false;
        this.presenceChanged();
      }
    }, PRESENCE_EVERY);
    this.presenceTimer.unref?.();
  }

  /** A page's heartbeat, by the secret its stream was given: false when no open stream has it (a
   *  stream that closed, a guess), and nothing changes. A private page's (`priv`, CollabSpec
   *  decision 8) is counted and nothing more is kept of it: not its name, not where it is.
   *  `verified`: the page of someone invited by a personal link (decision 9). */
  beat(token: unknown, name: string | null, view: PresenceView | null, idle: boolean, priv = false, verified = false): boolean {
    const s = typeof token === "string" ? this.byToken.get(token) : undefined;
    if (!s) return false;
    if (s.private !== priv) this.rename(s, priv, name, view, idle, verified);
    else if (priv) this.presence.beatPrivate(s.id);
    else this.presence.beat(s.id, name, view, idle, false, verified);
    return true;
  }

  /** A page went private, or showed itself again (CollabSpec decision 8): its stream gets a new
   *  public id, so that nothing the others were told under one id — where the page was, under its
   *  name; the `from` of what it arranged — ties it to what they are told under the other. The page
   *  alone is told the new id (`hello`) and, right after, the list and the count as they are now:
   *  it counts itself out of the private count by its hello. Going private, the views it had open
   *  are held for it (server/views.ts, `hold`), since its heartbeats no longer say them; shown
   *  again, they do. */
  private rename(s: Stream, priv: boolean, name: string | null, view: PresenceView | null, idle: boolean, verified: boolean): void {
    const was = this.presence.pageView(s.id);
    const old = s.id;
    s.id = randomBytes(9).toString("base64url");
    s.private = priv;
    // a private reader cannot be followed: what they asked is withdrawn
    if (priv) this.asks.withdraw(s.token);
    this.write(s.res, "hello", this.helloOf(s));
    if (s.session) {
      if (priv) this.views.hold(s.session, was ? [...(was.view ? [was.view] : []), ...was.tabs] : []);
      else this.views.release(s.session);
    }
    this.presence.renamed(old, s.id, priv, name, view, idle, verified);
    this.write(s.res, "presence", this.presence.list());
    this.write(s.res, "private", { count: this.presence.privateCount() } satisfies PrivateCount);
  }

  /** The file of a module of the graph on show, relative to the project (meta.modules): the only
   *  modules whose source is served or handed to Lean. Undefined when the graph has no such module
   *  (or there is no graph yet), null when it has no file. */
  moduleFile(module: string): string | null | undefined {
    const G = graphOf(this);
    if (!G) return undefined;
    let files = moduleFiles.get(G.meta);
    if (!files) moduleFiles.set(G.meta, (files = new Map(G.meta.modules.map((m) => [m.name, m.file]))));
    return files.get(module);
  }

  /** The Project view's pins changed (the agents' API): every page gets the operations, and who
   *  made them. */
  placesChanged(ops: unknown[], from: string | null, by: string | null): void {
    this.send("view-ops", { id: PROJECT, ops, from, by });
  }

  /** The review changed (server/review.ts tells it): every open page gets what changed — the new
   *  events, which it applies to the review it holds (`review-delta`), or, where events came in
   *  between, the revision alone (`review-rev`), at which the page reads the whole review (GET
   *  /api/review, compressed and tagged). The stream never carries the whole review: with thousands
   *  of opinions it is megabytes, and it went uncompressed to every page, which read it again from
   *  GET /api/review besides (5.4 MB to each page of a review of 5,000 opinions on
   *  NavierStokesAndEuler, 0.7 MB compressed). Changes made in one turn (an agent's batch of advice)
   *  go out as one. A new target's TCB is where its timeline starts; it has no view until a click
   *  gives it one (ViewSpec decision 29). */
  reviewChanged(c: ReviewChange): void {
    if (!this.reviewPending.length) setImmediate(() => this.flushReview());
    this.reviewPending.push(c);
  }

  private flushReview(): void {
    const cs = this.reviewPending;
    this.reviewPending = [];
    if (!cs.length) return;
    const last = cs[cs.length - 1];
    const deltas = cs.every((c, k) => c.events !== null && (k === 0 || c.base === cs[k - 1].rev));
    if (deltas) this.send("review-delta", { epoch: last.epoch, base: cs[0].base, rev: last.rev, events: cs.flatMap((c) => c.events!), problems: last.problems, error: this.review.error });
    else this.send("review-rev", this.reviewRev());
    this.timeline.reviewChanged(this.review.data);
    // a target a move brought from another name takes that name's view over; a target unmarked is
    // unlinked from its view
    const d = this.review.data;
    this.views.syncTargets(Object.keys(d.targets), (t) => (Object.hasOwn(d.targets, t) ? d.targets[t].was : undefined));
    // a file renamed in the library, here or in a log that came from elsewhere: the notes whose text
    // was its title follow it
    this.views.followTitles(d, SERVER_WRITER.name);
    this.reversion();
    this.lostChanged();
  }

  say(line: string): void {
    this.log.push(line);
    if (this.log.length > 200) this.log.shift();
    console.log(line);
  }

  start(): void {
    // the history begins with the extractions the project's cache holds from before it
    if (this.history?.empty) {
      try {
        const n = this.history.importExtractions(join(this.dirs.cache, "extract"), this.project, (l) => this.say(l));
        if (n) this.say(`history: ${n} snapshot(s) made from the extractions kept before the history`);
      } catch (e) {
        this.say(`history: the extractions kept before could not be imported: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // the source texts of the snapshots made before the history kept them, found once, in the
    // background (HistorySpec decision 22): a snapshot backfilled is not looked at again
    if (this.history) void backfillSources(this.history, this.project, this.dirs.cache, (l) => this.say(l)).catch((e) => this.say(`history: the source texts could not be backfilled: ${e instanceof Error ? e.message : String(e)}`));
    // the review's logs are watched whatever the graph comes from: they may change on disk any time
    this.timers.push(setInterval(() => this.checkReview(), TICK));
    this.timers.push(
      setInterval(() => {
        for (const st of [...this.streams.values()]) this.push(st, ": ping\n\n");
      }, PING),
    );
    if (this.saved) {
      // a saved extraction does not change: no watching of the build
      void this.extract(null);
      return;
    }
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (e) {
        this.say(`watch: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!this.stopped) this.next = setTimeout(loop, TICK);
    };
    void loop();
  }

  /** the loop's timers, which `stop` clears */
  private timers: ReturnType<typeof setInterval>[] = [];
  private next: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** Nothing more is watched (a test that ran the loop, at its end). */
  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    if (this.next) clearTimeout(this.next);
    this.timers = [];
  }

  /** The review's logs changed on disk (by hand, a backup restored): what changed is read, and the
   *  store tells the pages. */
  private checkReview(): void {
    try {
      this.review.refresh();
    } catch (e) {
      this.say(`review: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async tick(): Promise<void> {
    const running = await compiling(this.project);
    const now = Date.now();
    const runs = [...running].sort().join(" ");
    // the files are looked at only when something says to (server/buildwatch.ts)
    const heard = this.buildWatch.dirty;
    const look = shouldLook({
      heard,
      polling: this.buildWatch.polling !== null,
      running: running.size,
      runsChanged: runs !== this.lastRunning,
      active: !!this.build?.active,
      sinceMove: now - this.quietSince,
      sinceLook: now - this.lastLook,
      unread: this.lastRead !== this.extractedStamp,
      settle: SETTLE,
      tick: TICK,
    });
    if (!look) return;
    this.buildWatch.dirty = false;
    this.lastLook = now;
    this.lastRunning = runs;
    let probes = probeAll(this.project, this.mods);
    let st = stampOf(probes);
    // the first look is not a change: a project at rest is read at once
    const moved = st !== this.lastStamp && this.lastStamp !== "";
    // a change no watch told of, unless its news is on its way still (through the event loop; after
    // a moment, on macOS): one more and the watches are given up
    if (moved && !heard && this.buildWatch.polling === null) setTimeout(() => this.buildWatch.dirty || this.buildWatch.missed(), MISS_GRACE_MS).unref();
    if (st !== this.lastStamp || this.mods.size === 0) {
      // sources or outputs moved: files may have appeared, and the import graph changed
      this.project.files = indexSources(this.project.root);
      this.mods = scanModules(this.project);
      probes = probeAll(this.project, this.mods);
      st = stampOf(probes);
    }
    this.buildWatch.watch(moduleDirs(this.project, this.mods), this.project.root);
    this.lastStamp = st;
    if (moved) this.quietSince = now;

    // the status as JSON once a look, compared with what went out last
    let build = await this.tracker.status(this.mods, probes, running);
    // following a branch, the build going on is the server's own: active from its fetch to its end
    // (DeploySpec decision 6)
    const d = this.deploy;
    if (d && d.busy && !build.active) build = { ...build, active: true };
    const text = JSON.stringify(build);
    this.build = build;
    if (text !== this.buildText) {
      this.buildText = text;
      this.send("build", build);
      this.timeline.buildStatus(build);
    }
    // and its builds, beside the files: the one going on, the newest commit waiting, the last
    if (d) {
      const now = JSON.stringify(d.status(true));
      if (now !== this.deploySent) {
        this.deploySent = now;
        this.sendDeploy();
      }
    }

    // a branch's tree is read only between its builds, and only where a build wrote something:
    // its sources change only with a checkout, which a build follows (DeploySpec decision 5)
    const read = d ? outputsOf(probes) : st;
    this.lastRead = read;
    const settled = !build.active && now - this.quietSince >= SETTLE;
    if (settled && !this.extracting && read !== this.extractedStamp && !d?.holds()) {
      this.extractedStamp = read;
      const ok = importable(this.project, this.mods);
      const okSet = new Set(ok);
      const missing = [...this.mods.keys()].filter((m) => !okSet.has(m)).sort();
      if (ok.length === 0) {
        this.extractError = "No part of this build can be read: every file failed or sits on one that did. Showing the last graph that could be read.";
        this.send("extract-error", { error: this.extractError });
      } else void this.extract(missing.length ? tops(ok, this.mods) : null, missing);
    }
  }

  /** `roots` replaces the project's roots when part of the build cannot be imported. */
  private async extract(roots: string[] | null, missing: string[] = []): Promise<void> {
    this.extracting = true;
    this.extractError = null;
    this.send("extracting", { missing });
    if (missing.length) this.say(`${missing.length} module(s) cannot be imported; reading the rest`);
    try {
      const project = roots ? { ...this.project, roots } : this.project;
      const ex = this.saved ? loadSaved(this.saved) : await extract(project, this.dirs, (l) => this.say(l));
      this.say(ex.cached ? `extraction ${ex.fingerprint} reused` : `extraction ${ex.fingerprint} done`);
      // an edit without a build reads the same extraction again: a pass running for it goes on
      if (this.passFor === ex.fingerprint && this.usage.status.state === "running") return;
      // a pass still running is for a build that is over: what it finished stays cached
      this.usage.cancel();
      this.passFor = null;
      if (!this.usage.enabled || ex.graph.usage) {
        await this.install(ex, missing, ex.graph.usage ? "done" : "off");
        return;
      }
      const plan = this.usage.plan(ex.graph);
      if (!plan.todo.length) {
        // every module's result is cached: the merged graph is the one served
        const merged = await this.merge(ex, plan);
        if (merged) await this.install(merged, missing, "done", ex.fingerprint);
        return;
      }
      await this.install(ex, missing, "pending");
      this.passFor = ex.fingerprint;
      void this.pass(ex, plan, missing);
    } catch (e) {
      this.extractError = e instanceof Error ? e.message : String(e);
      this.say(this.extractError);
      // a build that started underneath us is retried at the next settle; anything else waits
      // for the next change, rather than failing again every few seconds
      if (this.extractError.includes("build is incomplete")) this.extractedStamp = "";
      this.send("extract-error", { error: this.extractError });
    } finally {
      this.extracting = false;
      this.send("idle", {});
    }
  }

  /** Lay out an extraction and serve it as the next version of the graph, unless it is the one
   *  served already. A graph that waits for the usage pass is not compared with the targets' TCBs
   *  (events.ts): it lacks the notation, and the next version brings it back. Its layout is
   *  provisional: the usage pass's graph, which `completes` that build's extraction, is laid out as
   *  the build's own (server/pipeline.ts, prepare). */
  private async install(ex: Extraction, missing: string[], usage: "pending" | "done" | "off", completes?: string): Promise<void> {
    // the tree is read until it is served (the source texts the snapshot keeps): a branch's build
    // waits (DeploySpec decision 5)
    this.installing++;
    try {
      await this.installNow(ex, missing, usage, completes);
    } finally {
      this.installing--;
    }
  }

  private async installNow(ex: Extraction, missing: string[], usage: "pending" | "done" | "off", completes?: string): Promise<void> {
    const laid = await prepare(this.project, this.dirs, null, (l) => this.say(l), { extraction: ex, provisional: usage === "pending", completes });
    if (this.graph && this.graph.fingerprint === laid.fingerprint) return;
    const failed = ex.graph.usage?.failed.length ?? 0;
    this.base = versionBase(ex.graph);
    this.nodeIndex = new Map(this.base.names.map((n, i) => [n, i]));
    this.outside = new Set(ex.graph.externals.map((e) => e.name));
    // the history first: the renames found against the build before are migrated, so that the
    // versions served are made under them (HistorySpec.md)
    const renamed = this.snapshot(ex, missing);
    const prep = this.versioned(laid);
    const commit = this.deploy?.commit()?.hash;
    this.graph = { version: ++this.version, fingerprint: prep.fingerprint, at: new Date().toISOString(), missing, usage: { state: usage, failed }, ...(commit ? { commit } : {}), prep };
    this.send("graph", this.graphInfo());
    this.lostChanged();
    // opinions recorded under the kernel's hash are bound to the versions of this graph
    this.review.setReading(rebinder((name, kernel) => this.versionOfKernel(name, kernel)));
    this.say(`graph v${this.graph.version} ready${usage === "pending" ? "; notation and contexts follow when the usage pass is done" : ""}`);
    if (usage === "pending") return;
    try {
      this.timeline.graphChanged(prep, this.review.data, renamed);
    } catch (e) {
      this.say(`timeline: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The page's graph with its versions made under the renames in force (server/versions.ts): the
   *  one laid out where they change nothing in it. */
  private versioned(prep: Prepared): Prepared {
    if (!this.base) return prep;
    const identity = this.identity();
    this.identityKey = this.identityKeyNow();
    this.versions = versions(this.base, identity);
    const gz = withVersions(prep.metaGz, this.base, identity);
    return gz ? { ...prep, metaGz: gz } : prep;
  }

  /** The renames in force changed (a move made by hand or undone, or one found in the logs): the graph
   *  on show is served again with its versions made under them, and opinions recorded under the
   *  kernel's hash are bound again. */
  private reversion(): void {
    if (!this.graph || this.identityKeyNow() === this.identityKey) return;
    const prep = this.versioned(this.graph.prep);
    this.review.setReading(rebinder((name, kernel) => this.versionOfKernel(name, kernel)));
    if (prep === this.graph.prep) return;
    this.graph = { ...this.graph, version: ++this.version, at: new Date().toISOString(), prep };
    this.send("graph", this.graphInfo());
    this.say(`graph v${this.graph.version}: versions made again under the renames in force`);
  }

  /** what the renames in force were when the versions on show were made */
  private identityKey = "";
  /** The renames in force, as a key: a snapshot's graph served under them (server/historyapi.ts)
   *  is served again when it changes. */
  identityTag(): string {
    return this.identityKeyNow();
  }
  private identityKeyNow(): string {
    const r = this.review.data.renamed;
    return r ? JSON.stringify(Object.entries(r).sort()) : "";
  }

  /** The pass run, and its results merged into the extraction, filed beside it; null when it
   *  was stopped. */
  private async merge(ex: Extraction, plan: Plan, onProgress?: () => void): Promise<Extraction | null> {
    const results = await this.usage.run(plan, onProgress);
    if (!results) return null;
    const st = this.usage.status;
    const merged = mergeUsage(ex, plan, results, st.failed, st.ms ?? 0);
    saveMerged(this.dirs.cache, merged);
    const u = merged.graph.usage!;
    this.say(
      `usage pass: ${plan.modules.length} modules, ${plan.todo.length} elaborated, ${plan.cached.size} reused, ${st.failed.length} failed, ` +
        `${((st.ms ?? 0) / 1000).toFixed(1)} s; ${u.stats.notationEdges} notation edges, ${u.stats.nestedEdges} between notations`,
    );
    for (const f of st.failed.slice(0, 20)) this.say(`  usage pass: ${f.module}: ${f.error}`);
    if (st.failed.length > 20) this.say(`  usage pass: … and ${st.failed.length - 20} more (GET /api/status)`);
    return merged;
  }

  /** The usage pass, after the extractor's graph is served: its findings are the next version,
   *  if no newer build came first. */
  private async pass(ex: Extraction, plan: Plan, missing: string[]): Promise<void> {
    const t0 = Date.now();
    let next = 0;
    this.say(`usage pass: elaborating ${plan.todo.length} of ${plan.modules.length} modules, ${this.usage.jobs} at a time`);
    const progress = () => {
      const st = this.usage.status;
      if (st.done < next && st.done < st.todo) return;
      next = st.done + Math.max(1, Math.ceil(st.todo / 10));
      this.say(`usage pass: ${st.done}/${st.todo} (${Math.round((Date.now() - t0) / 1000)} s)`);
    };
    try {
      const merged = await this.merge(ex, plan, progress);
      // a re-layout going on is let finish; a newer build supersedes the pass
      while (this.extracting && this.passFor === ex.fingerprint) await new Promise((ok) => setTimeout(ok, 200));
      // a branch's build that started meanwhile changes the tree: its graph is read once it ends
      if (!merged || this.passFor !== ex.fingerprint || this.deploy?.holds()) return;
      this.passFor = null;
      await this.install(merged, missing, "done", ex.fingerprint);
    } catch (e) {
      this.say(`usage pass: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The version of declaration `name` whose kernel's content hash was `kernel` (server/versions.ts):
   *  the one on show, where it has that hash, else the one a snapshot of the history has; null where
   *  no graph read has it so. */
  versionOfKernel(name: string, kernel: string): string | null {
    const i = this.nodeIndex.get(name);
    if (i !== undefined && this.base?.kernel[i] === kernel) return this.versions[i];
    // renamed since, its content the kernel's same (a theorem that does not mention itself)
    const renamed = this.review.data.renamed;
    if (renamed) {
      const ahead = new Map(Object.entries(renamed).map(([to, from]) => [from, to]));
      let n = name;
      for (let k = 0; k < 1000 && ahead.has(n); k++) {
        n = ahead.get(n)!;
        const j = this.nodeIndex.get(n);
        if (j !== undefined && this.base?.kernel[j] === kernel) return this.versions[j];
      }
    }
    return this.history?.versionOfKernel(name, kernel, this.identity()) ?? null;
  }

  /** The identities the renames in force give (server/versions.ts, shared/moves.ts): what versions
   *  are made under. */
  identity(): Identity {
    const renamed = this.review.data.renamed;
    return renamed ? (u) => identityIn(renamed, u) : ownName;
  }

  /** The renames in force (to → from), which `identity` follows: what the history's worker makes it
   *  again from (server/historythread.ts). */
  renamed(): [string, string][] | null {
    const renamed = this.review.data.renamed;
    return renamed ? Object.entries(renamed) : null;
  }

  /** Keep a snapshot of the graph just read (server/history.ts): a new build's, or its own again;
   *  then pair what vanished since the build before with what appeared (server/renames.ts), and
   *  migrate the renames of high confidence. The pages are told of a snapshot made or changed
   *  (`history`). The renames migrated, old name → new. */
  private snapshot(ex: Extraction, missing: string[]): Map<string, string> {
    const renamed = new Map<string, string>();
    if (!this.history || !this.renames) return renamed;
    try {
      const t0 = Date.now();
      // a branch's build is of the commit its build checked out, on the branch followed; a
      // workspace's, of the commit checked out as it is read
      const d = this.deploy?.commit();
      const commit = this.deploy ? (d ? { hash: d.hash, branch: d.branch } : null) : commitNow(this.project.root);
      // the texts the build was compiled from, while its files are most likely still those
      // (HistorySpec decision 21): only the files that changed since any build are written
      let written = 0;
      const sources = () => {
        const found = keepSources(this.project, ex.graph.modules.map((m) => m.name), commit?.hash ?? null, this.history!.sources);
        written = found.written;
        return found;
      };
      const r = this.history.record(ex.graph, { at: buildTime(this.project), fingerprint: ex.fingerprint, commit, toolchain: this.project.toolchain, missing, sources, tool: this.toolVersion });
      if (!r.written) return renamed;
      const s = r.info;
      if (r.before) {
        const after = this.history.graph(s.id)!;
        const pairs = findRenames(r.before, after, this.identity());
        this.renames.record(s.id, pairs);
        const found = this.renames.found.get(s.id) ?? [];
        this.history.annotate(s.id, { renames: { high: found.filter((p) => p.confidence === "high").length, medium: found.filter((p) => p.confidence === "medium").length } });
        const high = pairs.filter((p) => p.confidence === "high");
        if (pairs.length) this.say(`history: ${high.length} rename(s) found against ${r.before.info.id === s.id ? "this build read before" : `snapshot ${r.before.info.id}`}, ${pairs.length - high.length} suggestion(s)`);
        const n = this.migrate(high, after, s.id);
        if (n) this.say(`history: ${n} rename(s) migrated`);
        // the links on a cluster the build renamed as a whole go with it (AttachmentSpec decision 6)
        const links = carryClusterLinks(this.review, this.project.toolchain, r.before, after, new Map(high.map((p) => [p.from, p.to])), s.id, (l) => this.say(l));
        if (links) this.say(`history: ${links} link(s) carried to a renamed cluster`);
        for (const p of high) renamed.set(p.from, p.to);
        // a project note goes with its cluster where the build moved all of it to another (a folder
        // or a namespace renamed: AttachmentSpec decision 18)
        const carried = this.views.carryNotes(r.before.nodes, after.nodes, renamed, SERVER_WRITER.name);
        if (carried) this.say(`history: ${carried} note(s) carried to the cluster their declarations moved to`);
      }
      const t = s.sources;
      const texts = t ? `; ${t.kept} of ${t.of} source texts kept, ${(t.bytes.all / 1024).toFixed(0)} KB, ${(written / 1024).toFixed(0)} KB of it written now` : "";
      this.say(`history: snapshot ${s.id} ${r.fresh ? "of a new build" : "of its build, read again"}: ${s.counts.nodes} declarations in ${(s.bytes.all / 1024).toFixed(0)} KB, ${(s.bytes.new / 1024).toFixed(0)} KB of it written for this build${texts} (${Date.now() - t0} ms)`);
      this.send("history", this.history.get(s.id));
    } catch (e) {
      this.say(`history: ${e instanceof Error ? e.message : String(e)}`);
    }
    return renamed;
  }

  /** The renames of high confidence found from snapshot `from` to snapshot `to`, composed: what the
   *  Time Machine's diff calls renamed. */
  renamesBetween(from: number, to: number): Map<string, string> {
    return this.renames && this.history ? this.renames.between(from, to, this.history.list().map((s) => s.id)) : new Map();
  }

  /** The people invited by a personal link, by the name each goes by now (CollabSpec decision 9):
   *  what the agents' API names them by, as the pages do (an exported document's authors). */
  people(): Invited[] {
    return this.invites.people();
  }

  /** What the lost-and-found lists of moves (HistorySpec.md): every migration, the server's and
   *  those made by hand, undone or not; and the suggestions not acted on — pairs of medium
   *  confidence whose old name the graph no longer has and whose new one it has, that no migration
   *  in force made. */
  moves(): { migrations: Migration[]; suggestions: (Pairing & { snap: number })[] } {
    if (!this.renames) return { migrations: [], suggestions: [] };
    const done = new Set(this.renames.migrations.filter((m) => !m.undone).map((m) => `${m.from}\u0000${m.to}`));
    const suggestions: (Pairing & { snap: number })[] = [];
    for (const [snap, pairs] of this.renames.found)
      for (const p of pairs)
        if (p.confidence === "medium" && !done.has(`${p.from}\u0000${p.to}`) && !this.nodeIndex.has(p.from) && this.nodeIndex.has(p.to)) suggestions.push({ ...p, snap });
    return { migrations: this.renames.migrations, suggestions };
  }

  /** Attach to… (HistorySpec.md): what was said of `from`, a declaration the graph no longer has,
   *  carried to `to`, one it has, by a person or an agent at level full: a move in their log, and
   *  its pins, notes' mentions and scopes moved on the views. It says `to` is `from` renamed where
   *  `to` was not there yet in the last build that had `from`. */
  moveByHand(from: string, to: string, who: Mover): { status: number; body: unknown } {
    if (!this.graph || !this.renames) return { status: 503, body: { error: "The graph has not been read yet." } };
    if (from === to) return { status: 400, body: { error: "A move is from one declaration to another." } };
    if (this.nodeIndex.has(from)) return { status: 409, body: { error: `${from} is in the graph: only what was said of a declaration that is gone is attached to another.` } };
    if (!this.nodeIndex.has(to)) return { status: 404, body: { error: `There is no declaration ${to} in the graph.` } };
    let rename = false;
    for (const snap of this.history?.list().reverse() ?? []) {
      const g = this.history!.graph(snap.id);
      if (!g || !g.nodes.some((n, i) => i < g.projectCount && n.name === from)) continue;
      rename = !g.nodes.some((n, i) => i < g.projectCount && n.name === to);
      break;
    }
    const d = this.review.data;
    const carried = carriedOf(d, from);
    let review = false;
    if (!moveIsIdle(d, { from, to, on: true, rename: rename || undefined })) {
      const r = this.review.append({ name: who.name, agent: who.agent, person: who.person ?? null }, { op: "move", from, to, on: true, ...(rename ? { rename: true } : {}), by: who.name, ...(who.agent ? { agent: true } : {}), ...(who.person ? { person: who.person } : {}) }, this.project.toolchain);
      if ("status" in r) return { status: r.status, body: { error: r.error } };
      review = !!r.change;
    }
    // a target's view goes with it, where it has one, once the move is replayed (flushReview)
    const targetView = carried.targets && this.views.book.viewOf(from) ? 1 : 0;
    const views = this.views.moveDeclaration(from, to, who.name, who.agent);
    if (!review && !views.length) return { status: 200, body: { ok: true, changed: false } };
    const m = this.renames.migrated({ at: new Date().toISOString(), from, to, by: who.name, ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}), rename, review, carried: { ...carried, ...viewsCarried(views), reviewViews: targetView }, views });
    this.lostChanged();
    return { status: 200, body: { ok: true, changed: true, migration: m } };
  }

  /** A migration undone, by a person or an agent at level full: an un-move in their log, which
   *  takes back what the move carried, and the views' operations that undo what it did there. */
  unmove(id: string, who: Mover): { status: number; body: unknown } {
    const m = this.renames?.get(id);
    if (!m) return { status: 404, body: { error: `There is no migration ${id}.` } };
    if (m.undone) return { status: 409, body: { error: `${id} was undone by ${m.undone.by} at ${m.undone.at}.` } };
    if (m.review) {
      const r = this.review.append({ name: who.name, agent: who.agent, person: who.person ?? null }, { op: "move", from: m.from, to: m.to, on: false, ...(m.rename ? { rename: true } : {}), by: who.name, ...(who.agent ? { agent: true } : {}), ...(who.person ? { person: who.person } : {}) }, this.project.toolchain);
      if ("status" in r) return { status: r.status, body: { error: r.error } };
    }
    this.views.unmoveDeclaration(m.from, m.to, m.views, who.name, who.agent, Object.hasOwn(this.review.data.targets, m.from) && !Object.hasOwn(this.review.data.targets, m.to));
    this.renames!.undone(id, who.name, who.agent, who.person);
    this.lostChanged();
    return { status: 200, body: { ok: true, migration: m } };
  }

  /** The lost-and-found (HistorySpec decisions 12–14, server/lostfound.ts): what the review and the
   *  views hold of names the graph on show does not have, the migrations, what is archived. Empty
   *  until a graph is read: before, every name would look gone. */
  lostAndFound(): LostAnswer {
    if (!this.graph || !this.history || !this.renames) return { lost: [], migrations: [], archived: [], aside: { entries: 0, modules: [] }, count: 0 };
    const moves = this.moves();
    const titles = titleContext(this);
    return lostAndFound({
      review: this.review.data,
      views: this.views.book.list(),
      notes: this.views.book.notes,
      has: (name) => this.nodeIndex.has(name) || this.outside.has(name),
      last: (name) => this.lastHad(name),
      missing: this.graph.missing,
      pinWho: (view, mode, name) => this.views.book.authorOf(view, mode, "node", name),
      title: (v) => viewTitle(v, titles),
      atBuild: (v, name) => {
        const past = this.views.pastOf(v);
        return past !== null && !!this.history?.hadAt(name, past);
      },
      // a link's cluster: a namespace something of the project is under, or a module prefix
      hasCluster: (kind, key) => {
        const under = (s: string) => s === key || s.startsWith(key + ".");
        return kind === "ns" ? [...this.nodeIndex.keys()].some(under) : [...this.project.files.keys()].some(under);
      },
      migrations: moves.migrations,
      suggestions: moves.suggestions,
      archive: this.archive,
    });
  }

  /** The newest build whose graph had `name` (Show in history), or null. */
  lastHad(name: string): LastHad | null {
    const l = this.history?.lastHad(name);
    const s = l ? this.history!.get(l.id) : null;
    return l && s ? { name, snapshot: s.id, at: s.at, ...(s.approx ? { approx: true as const } : {}), commit: s.commit, module: l.module } : null;
  }

  /** Archive entries of the lost-and-found, or put them back (`on` false), by a person with a name
   *  or an agent at level full: a line each in `history/archive.jsonl` whose state changes. */
  archiveEntries(keys: string[], on: boolean, who: Mover): { status: number; body: unknown } {
    if (!this.archive) return { status: 404, body: { error: "This server keeps no history, and so no lost-and-found." } };
    if (!keys.length || keys.length > MAX_ARCHIVE_KEYS) return { status: 400, body: { error: `Send {key} or {keys}: 1 to ${MAX_ARCHIVE_KEYS} entries' keys.` } };
    const write = archiveKeys(this.lostAndFound(), keys, on, this.archive);
    if (typeof write === "string") return { status: 404, body: { error: write } };
    const lines = this.archive.set(write, on, who);
    if (lines.length) this.sendLost();
    return { status: 200, body: { ok: true, changed: lines.length > 0, lines } };
  }

  /** Something the lost-and-found reads changed (the review, a view, the graph, a migration): the
   *  pages are told once it settles, if what it lists changed. */
  private lostChanged(): void {
    if (this.lostTimer || !this.archive) return;
    this.lostTimer = setTimeout(() => {
      this.lostTimer = null;
      this.sendLost();
    }, 250);
    this.lostTimer.unref?.();
  }

  /** Tell the pages how many entries the lost-and-found lists — all, and the lost things among
   *  them — with a revision that changes with what it holds, so that a page showing it reads it
   *  again (`lost`). Nobody to tell, nothing done. */
  private sendLost(): void {
    // nobody to tell: whoever comes next has it worked out afresh
    if (!this.streams.size) {
      this.lostSent.sig = "";
      return;
    }
    try {
      const a = this.lostAndFound();
      const sig = JSON.stringify([a.lost.map((g) => [g.name, g.suggestions.length, g.entries.map((e) => e.key)]), a.migrations.map((m) => [m.key, !!m.undone]), a.archived.map((x) => x.key), a.aside.entries]);
      if (sig === this.lostSent.sig) return;
      this.lostSent = { rev: this.lostSent.rev + 1, count: a.count, lost: a.count - a.migrations.length, sig };
      this.send("lost", lostNews(this.lostSent));
    } catch (e) {
      this.say(`lost-and-found: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Migrate renames of high confidence found at snapshot `snap` (HistorySpec.md): for each, a move
   *  in the server's log where something was said of the declaration — opinions, its target mark,
   *  key marks — or where a declaration that refers to it has opinions, whose versions its
   *  identity keeps; and its pins, notes' mentions and views' scopes moved on the views. Each is
   *  recorded with what undoes it. How many carried anything. */
  private migrate(pairs: Pairing[], after: SnapGraph, snap: number): number {
    if (!pairs.length || !this.renames) return 0;
    const d = this.review.data;
    const own = (o: object, k: string) => Object.hasOwn(o, k);
    // under its name in this build, or the one it had before it
    const before = new Map(pairs.map((p) => [p.to, p.from]));
    const opined = (n: string) => own(d.opinions, n) || (before.has(n) && own(d.opinions, before.get(n)!));
    // who refers to what, in this build
    const users = new Map<string, string[]>();
    for (let i = 0; i < after.projectCount; i++) {
      const u = after.nodes[i];
      for (const r of new Set((u.refs ?? []).map((x) => x.split(" ")[0]))) {
        const xs = users.get(r);
        if (xs) xs.push(u.name);
        else users.set(r, [u.name]);
      }
    }
    let made = 0;
    for (const p of pairs) {
      const carried = carriedOf(d, p.from);
      const said = carried.opinions + carried.targets + carried.keys + carried.links > 0;
      const matters = said || (users.get(p.to) ?? []).some((u) => u !== p.to && opined(u));
      let review = false;
      if (matters) {
        const r = this.review.append(SERVER_WRITER, { op: "move", from: p.from, to: p.to, on: true, rename: true, auto: p.why, snap, by: SERVER_WRITER.name }, this.project.toolchain);
        if ("status" in r) this.say(`history: the move of ${p.from} to ${p.to} could not be written: ${r.error}`);
        else review = !!r.change;
      }
      // a target's view goes with it, where it has one, once the move is replayed (flushReview)
      const targetView = carried.targets && this.views.book.viewOf(p.from) ? 1 : 0;
      const views = this.views.moveDeclaration(p.from, p.to, SERVER_WRITER.name);
      if (!review && !views.length) continue;
      const v = { ...viewsCarried(views), reviewViews: targetView };
      this.renames.migrated({ at: new Date().toISOString(), from: p.from, to: p.to, snap, by: SERVER_WRITER.name, auto: p.why, rename: true, review, carried: { ...carried, ...v }, views });
      made++;
    }
    return made;
  }

  /** The holder of a personal link in force who goes by `name` (CollabSpec decision 9): whom an
   *  opinion recorded for that name is for (ReviewSpec decision 8). */
  invited(name: string): { id: string; name: string } | undefined {
    const r = this.invites.holder(name);
    return r ? { id: r.id, name: r.name } : undefined;
  }

  /** Whether `name` is an agent's now (sameName): a token in force has it, or an agent on the page
   *  gives it — nobody's opinion is recorded for an agent, even one that has written nothing yet
   *  (ReviewSpec decision 8, AgentSpec decision 2). */
  agentNamed(name: string): boolean {
    return this.tokens.inForce().some((r) => sameName(r.name, name)) || this.presence.list().some((p) => p.agent && p.name !== null && sameName(p.name, name));
  }

  /** The usage pass's contexts of a module (shared/context.ts), when the graph on show has them. */
  contextsOf(module: string): ModuleContexts | null {
    return this.graph?.prep.usage?.contexts[module] ?? null;
  }

  /** Lay the graph on screen out from scratch, forgetting where things were. It reuses that
   *  graph's extraction: a re-layout never reads the build, which may be half-written. */
  async relayout(): Promise<void> {
    if (this.extracting || !this.graph) return;
    this.extracting = true;
    this.send("extracting", { missing: this.graph.missing });
    try {
      const laid = await prepare(this.project, this.dirs, this.saved, (l) => this.say(l), {
        freshLayout: true,
        reuse: this.saved ? undefined : this.graph.fingerprint,
        // laid out afresh while the usage pass runs: its graph is laid out afresh too
        provisional: this.graph.usage?.state === "pending",
      });
      const prep = this.versioned(laid);
      this.graph = { ...this.graph, version: ++this.version, at: new Date().toISOString(), prep };
      this.send("graph", this.graphInfo());
      this.say(`graph v${this.graph.version}: laid out afresh`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.say(`re-layout: ${msg}`);
      this.send("extract-error", { error: msg });
    } finally {
      this.extracting = false;
      this.send("idle", {});
    }
  }

  graphInfo(): GraphInfo | null {
    if (!this.graph) return null;
    const { prep: _, ...info } = this.graph;
    return { ...info, instance: this.instance };
  }

  /** What a stream's page alone is told of it (`hello`), and which server it is (UpdateSpec
   *  decision 8): its version, and its process. */
  private helloOf(st: Stream): StreamHello {
    return { id: st.id, token: st.token, ...(st.private ? { private: true as const } : {}), server: { version: this.toolVersion, instance: this.instance } };
  }

  /** How many pages are open on the server (their event streams), read-only readers' too. */
  get pages(): number {
    return this.streams.size;
  }

  /** Whether the server is working on the build (an extraction, a re-layout, the usage pass):
   *  no moment to restart in (UpdateSpec decision 6). */
  get busy(): boolean {
    return this.extracting || this.usage.status.state === "running" || !!this.deploy?.busy;
  }

  /** Whether the tree is being read: an extraction, a re-layout, a graph made ready to serve. A
   *  branch's build changes the tree only after (DeploySpec decision 5). */
  get reading(): boolean {
    return this.extracting || this.installing > 0;
  }

  /** Following a branch, the commit of the graph on show and the branch (an exported document's
   *  build, GET /api/git): null before a build was read; undefined for a workspace, whose commit git
   *  says as it is now. */
  shownCommit(): { hash: string; branch: string } | null | undefined {
    const d = this.deploy;
    if (!d) return undefined;
    const c = this.graph?.commit ?? d.commit()?.hash;
    return c ? { hash: c, branch: d.status(false).branch } : null;
  }

  /** The branch followed and its builds, as agents are told them (GET /api/agent/history); null
   *  for a workspace. */
  following(): DeployStatus | null {
    return this.deploy?.status(true) ?? null;
  }

  /** A branch's build ended (DeploySpec decision 5): the tree is read again once it settles,
   *  whatever the build wrote — a usage pass it cut short is done then, from what it finished. */
  reread(): void {
    this.extractedStamp = "";
  }

  /** A branch's builds changed (one started, a step, a newer commit waiting): the loop looks at its
   *  next turn, as it does when a watch tells of a change (server/buildwatch.ts), and the pages are
   *  told then. */
  lookSoon(): void {
    this.buildWatch.dirty = true;
  }

  /** The branch's builds as the pages were last told them (`deploy`). */
  private deploySent = "";

  /** The branch's builds, to every page (`deploy`): a read-only reader's without the build's log
   *  (DeploySpec decision 11). */
  private sendDeploy(): void {
    const d = this.deploy;
    if (!d || !this.streams.size) return;
    const full = `event: deploy\ndata: ${JSON.stringify(d.status(true))}\n\n`;
    const slim = `event: deploy\ndata: ${JSON.stringify(d.status(false))}\n\n`;
    for (const st of [...this.streams.values()]) this.push(st, st.readOnly === null ? full : slim);
  }

  /** What happened, to every page: a version set aside, without why, to those not told all
   *  (UpdateSpec decision 11). */
  private sendActivity(e: StoredEvent): void {
    if (e.kind !== "tool" || !e.setAside) return this.send("activity", e);
    const full = `event: activity\ndata: ${JSON.stringify(e)}\n\n`;
    const slim = `event: activity\ndata: ${JSON.stringify(withoutReasons(e))}\n\n`;
    for (const st of [...this.streams.values()]) this.push(st, st.toldAll ? full : slim);
  }

  /** What is known of VisualProof's releases changed: each page is told what it may know of it
   *  (`toldAll`, as GET /api/updates says it). */
  updatesChanged(): void {
    const status = this.updateStatus;
    if (!status) return;
    const full = `event: updates\ndata: ${JSON.stringify(status(true))}\n\n`;
    const slim = `event: updates\ndata: ${JSON.stringify(status(false))}\n\n`;
    for (const st of [...this.streams.values()]) this.push(st, st.toldAll ? full : slim);
  }

  /** The server stops (UpdateSpec decision 9): every page is told why — a restart into another
   *  version (`update`), or a stop (`bye`) — and its stream ended, so that it comes back to the
   *  server that answers next. */
  end(why: { update: { from: string; to: string } } | { stopped: true }): void {
    const text = "update" in why ? `event: update\ndata: ${JSON.stringify(why.update)}\n\n` : `event: bye\ndata: ${JSON.stringify({ why: "stopped" })}\n\n`;
    for (const st of [...this.streams.values()]) {
      this.streams.delete(st.res);
      this.byToken.delete(st.token);
      st.res.end(text);
    }
  }

  /** What /api/status says: enough for the loader and for a page that just connected. */
  status(): object {
    return {
      state: this.graph ? "ready" : this.extractError ? "error" : "extracting",
      error: this.graph ? undefined : this.extractError ?? undefined,
      log: this.log,
      extracting: this.extracting,
      extractError: this.extractError,
      graph: this.graphInfo(),
      // the usage pass: how far it is, and the modules it could not elaborate
      usage: this.usage.status,
      build: this.build,
      // the branch followed, where the server builds what it shows (DeploySpec)
      ...(this.deploy ? { deploy: this.deploy.status(true) } : {}),
      live: !this.saved,
      editor: this.editor,
      streams: { open: this.streams.size, max: MAX_STREAMS, readOnly: this.readOnlyStreams(), maxReadOnly: MAX_READONLY_STREAMS, closedForNotReading: this.dropped, agentsListening: this.talk.count },
      // the review's folder, and the lines of its logs that cannot be read (server/review.ts)
      review: { folder: this.review.dir, problems: this.review.problems, error: this.review.error },
    };
  }

  /** A page's event stream; `session` is what the page calls itself (its streams are kept few by
   *  it), `person` the personal link it came by. The stream is named by the server: the page is
   *  told its id, which everyone sees, and a secret for its heartbeats (`hello`); it is gone from
   *  presence when its stream closes. */
  subscribe(res: ServerResponse, session: string | null = null, person: string | null = null, readOnly: string | null = null, toldAll = readOnly === null): void {
    if (session) {
      // a page that opens one more than a page needs (a reload whose old stream lingers) loses
      // its oldest
      const mine = [...this.streams.values()].filter((st) => st.session === session);
      for (const st of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_SESSION + 1))) this.close(st);
    }
    const [n, max] = readOnly === null ? [this.streams.size - this.readOnlyStreams(), MAX_STREAMS] : [this.readOnlyStreams(), MAX_READONLY_STREAMS];
    if (n >= max) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", "retry-after": "10" });
      res.end(JSON.stringify({ error: `This server has ${max} pages open${readOnly === null ? "" : " to read only"}, as many as it serves: try again in a while.` }));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    const st: Stream = { res, id: randomBytes(9).toString("base64url"), token: randomBytes(24).toString("base64url"), session, private: false, person, readOnly, toldAll, room: Infinity, after: 0 };
    this.streams.set(res, st);
    this.byToken.set(st.token, st);
    this.presence.open(st.id);
    res.on("close", () => this.close(st));
    this.write(res, "hello", this.helloOf(st));
    if (this.updateStatus) this.write(res, "updates", this.updateStatus(st.toldAll));
    this.write(res, "presence", this.presence.list());
    this.write(res, "private", { count: this.presence.privateCount() } satisfies PrivateCount);
    this.write(res, "people", this.invites.people());
    // the views as they are: a page that was away (a restart, a lost connection) catches up, and
    // reads again the boards it has open
    this.write(res, "views", { views: this.views.list(), changes: [], all: true });
    if (this.build) this.write(res, "build", this.build);
    if (this.deploy) this.write(res, "deploy", this.deploy.status(readOnly === null));
    // the review's revision: a page that holds another reads the whole review (GET /api/review);
    // what changes after comes as deltas
    this.write(res, "review-rev", this.reviewRev());
    const g = this.graphInfo();
    if (g) this.write(res, "graph", g);
    if (this.extracting) this.write(res, "extracting", {});
    // how many entries the lost-and-found lists, as the pages were last told; the first page
    // to come has it worked out
    if (this.lostSent.sig) this.write(res, "lost", lostNews(this.lostSent));
    else this.lostChanged();
    st.room = MAX_BUFFERED + res.writableLength;
    st.after = 0;
  }

  /** Which review the server holds (`review-rev`): its run and its revision. */
  private reviewRev(): ReviewRev {
    return { epoch: this.review.epoch, rev: this.review.rev };
  }

  private write(res: ServerResponse, event: string, data: unknown): void {
    const st = this.streams.get(res);
    if (st) this.push(st, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Every open page gets the event. It is written once and the one text handed to every stream,
   *  so that what waits for slow pages is shared, not copied per page. */
  private send(event: string, data: unknown): void {
    if (!this.streams.size) return;
    const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const st of [...this.streams.values()]) this.push(st, text);
  }

  /** Write to a stream, unless what it has not read yet passed MAX_BUFFERED beyond its hello (`room`):
   *  then it is closed instead, and its page reconnects to the present state. A hello counted against
   *  MAX_BUFFERED (in 0.4.3 it carried the whole review, 7 MB for 5,000 opinions on
   *  Sphere-Packing-Lean) closed every page's stream as it opened, and the pages reconnected every two
   *  seconds, never live. */
  private push(st: Stream, text: string | Buffer): void {
    const waiting = st.res.writableLength;
    // all that waits was written since the hello: the hello is read
    if (st.room > MAX_BUFFERED && st.room !== Infinity && waiting <= st.after) st.room = MAX_BUFFERED;
    if (waiting > st.room) {
      this.dropped++;
      this.close(st);
      return;
    }
    st.res.write(text);
    if (st.room > MAX_BUFFERED) st.after += text.length;
  }

  /** A stream is over: its page leaves the list, its secret means nothing any more. */
  /** How many read-only readers' streams are open. */
  readOnlyStreams(): number {
    let n = 0;
    for (const st of this.streams.values()) if (st.readOnly !== null) n++;
    return n;
  }

  private close(st: Stream): void {
    if (this.streams.get(st.res) !== st) return;
    this.streams.delete(st.res);
    this.byToken.delete(st.token);
    this.presence.drop(st.id);
    // what its page was asked goes unanswered, and what it asked is withdrawn
    this.asks.closed(st.token);
    st.res.destroy();
  }
}

/** The importable modules nothing else importable imports: importing them imports the rest. */
function tops(ok: string[], mods: Map<string, ModuleInfo>): string[] {
  const okSet = new Set(ok);
  const imported = new Set<string>();
  for (const m of ok) for (const i of mods.get(m)?.imports ?? []) if (okSet.has(i)) imported.add(i);
  return ok.filter((m) => !imported.has(m));
}

/** What the pages are told of the lost-and-found (`lost`). */
const lostNews = (s: { rev: number; count: number; lost: number }) => ({ rev: s.rev, count: s.count, lost: s.lost });

/** What a move would carry of the review: opinions on it, its target mark, key marks on it (as a
 *  declaration of a target's review, and as a target), the links on it (AttachmentSpec decision 6). */
export function carriedOf(d: ReviewData, name: string): { opinions: number; targets: number; keys: number; links: number } {
  const own = (o: object, k: string) => Object.hasOwn(o, k);
  const keys = Object.values(d.keys).filter((ks) => own(ks, name)).length + (own(d.keys, name) ? Object.keys(d.keys[name]).length : 0);
  const links = (d.links ?? []).filter((l) => l.subject === `decl(${name})`).length;
  return { opinions: own(d.opinions, name) ? d.opinions[name].length : 0, targets: own(d.targets, name) ? 1 : 0, keys, links };
}

/** What a move carried of the views, counted from what it did to them. */
function viewsCarried(views: { ops: { op: string; id?: string }[]; scope?: unknown }[]): { notes: number; pins: number; scopes: number; reviewViews: number } {
  let notes = 0, pins = 0, scopes = 0;
  for (const v of views) {
    // a note counts once, whether its text named the declaration or it was attached to it, or both
    notes += new Set(v.ops.filter((o) => o.op === "note-edit" || o.op === "pnote-edit" || o.op === "note-decl" || o.op === "pnote-decl").map((o) => o.id)).size;
    pins += v.ops.filter((o) => o.op === "pin").length;
    if (v.scope) scopes++;
  }
  return { notes, pins, scopes, reviewViews: 0 };
}
