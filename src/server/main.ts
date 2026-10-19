#!/usr/bin/env node
// visualproof serve <path>   — read a built Lean project and serve its declaration graph
// visualproof export <path>  — the same page, frozen into one HTML file

import { historyAnswer } from "./historyapi.ts";
import { gitSource } from "./history.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import { freemem, tmpdir } from "node:os";
import { gunzip, gunzipSync, gzip, gzipSync } from "node:zlib";
import { WEB, WEBFONTS, bundleDir, bundleDirIn, ensureBundle, prepare, useBundleDir } from "./pipeline.ts";
import type { Prepared } from "./pipeline.ts";
import { makeArtwork, pngOf, projectView } from "./artcmd.ts";
import { SiteBusy, cacheHome, dataHome, lockSite, openSite, projectDirs } from "./dirs.ts";
import { ProjectError, openProject, targetsInWords } from "./project.ts";
import type { Project } from "./project.ts";
import { Live } from "./live.ts";
import { ReviewStore } from "./review.ts";
import { isDeclName, LeanHover } from "./hover.ts";
import { Identities, layoutAuthor } from "./identity.ts";
import { LAYOUT_VERSION } from "../shared/graph.ts";
import type { GitSource } from "../shared/graph.ts";
import { MAX_MEMORY_BYTES, readProjectView, Views } from "./views.ts";
import { cleanView, defaultAgentName, madeBy, nameKey, validSession, withoutArtwork } from "../shared/collab.ts";
import { writeSnapshot } from "./snapshot.ts";
import { lakeTextHash } from "./status.ts";
import { invalidTemplate } from "../shared/editor.ts";
import { packEdges } from "../shared/edgecodec.ts";
import { Access, hostAllowed, KEY_PATH, loadKey, urlHost } from "./access.ts";
import { asksForPage, sendAccessPage } from "./accesspage.ts";
import { INVITE_PATH, invalidPersonName, Invites, taken } from "./invites.ts";
import type { InviteCheck } from "./invites.ts";
import { AGENT_LEVELS, AgentApi, lower, needOf, refusal } from "./agent.ts";
import type { Caller } from "./agent.ts";
import { AgentTokens, bearerOf, DEFAULT_DAYS, invalidAgentName, looksLikeToken, TOKEN_DAYS } from "./tokens.ts";
import type { TokenRecord } from "./tokens.ts";
import { agentPrompt } from "./prompt.ts";
import { forPages, MAX_PERSON, PUBLIC, THREAD } from "./talk.ts";
import { mentioned } from "../shared/mentions.ts";
import { DEFAULT_JOBS, inGB, jobsAdvice, memoryFloor, onMathlib, UsagePass, mergeUsage, saveMerged, WORKER_PEAK } from "./usage.ts";
import { extract } from "./extract.ts";
import type { AgentLevel, Answer } from "./agent.ts";
import { Exporter } from "./export.ts";
import type { ExportFile } from "./export.ts";
import { Library, libraryApiOf } from "./library.ts";
import { libraryRoute, pdfjsAsset, readUpload } from "./libraryroute.ts";
import { UPLOAD_PATH } from "./agentlibrary.ts";
import { DEFAULT_LIBRARY_LIMIT, validSha } from "../shared/library.ts";
import { doctor, packageVersion, printReport } from "./doctor.ts";
import { READONLY_PATH } from "./readonly.ts";
import { sendMedia, TIP_PATH, TIPS_DIR, tipClips, tourData, tourVtt } from "./media.ts";
import { withoutReasons } from "../shared/timeline.ts";
import { FROM_PACKAGE, PACKAGE_ROOT, UPDATE_MODES, Updates } from "./updates.ts";
import type { UpdateMode } from "./updates.ts";
import { RESTART_STATUS, supervise } from "./supervise.ts";
import { stopChildren } from "./children.ts";
import { filmStatus, serveFilm, useFilm } from "./film.ts";
import { finalAnswer, readOnlyAllows, ReadOnlyBounds } from "./readonlygate.ts";
import { branchProblem, branchToFollow, DEFAULT_BUILD_HOURS, DEFAULT_POLL_MINUTES, DeployBusy, deployFolder, Deployment, deploySite, ensureClone, isGitAddress, limitInWords, lockDeployment, MATHLIB_CACHES, MAX_BUILD_HOURS, MIN_BUILD_HOURS, MIN_POLL_MINUTES, parseBuildHours, parseRemote, recordedDefault, sharedMathlibCache } from "./deploy.ts";
import type { DeployFolder, MathlibCache, Remote } from "./deploy.ts";
import { shortCommit, slimDeploy } from "../shared/deploy.ts";
import type { DeployStatus } from "../shared/deploy.ts";

interface Options {
  cmd: "serve" | "export" | "purge-file" | "doctor" | "artwork";
  path: string;
  roots: string[];
  port: number;
  host: string;
  /** the site's folder (server/dirs.ts), relative to the current directory or absolute; null: under the data home */
  site: string | null;
  /** the root of the caches; null: the cache home */
  cache: string | null;
  graph: string | null;
  out: string | null;
  label: string;
  /** the header an authenticating proxy names the reader in (CollabSpec decision 3) */
  identityHeader: string | null;
  /** the URL template of the page's "Open in editor" links (shared/editor.ts) */
  editor: string | null;
  /** what agents may change (AgentSpec decision 9): nothing, advice and notes, or everything a
   *  person can do through the page */
  agents: AgentLevel;
  /** the file of the key whose link alone lets anyone in (server/access.ts); null: open to all */
  accessKeyFile: string | null;
  /** how many usage-pass workers run at once (server/usage.ts); 0: no pass */
  jobs: number;
  /** the server's address as people reach it, for the prompt Share makes for an agent; null: the
   *  address the person's browser used */
  publicUrl: string | null;
  /** --allowed-host: the names a server without an access key answers besides its addresses,
   *  localhost and --public-url's (CollabSpec decision 12) */
  allowedHosts: string[];
  /** the most the library's files may take, in bytes (AttachmentSpec, "Implementation notes") */
  libraryLimit: number;
  /** --public: whoever comes without the key or a link of their own is a read-only reader
   *  (CollabSpec decision 11), where they would be turned away (decision 7) */
  publicRead: boolean;
  /** purge-file: the file whose bytes go */
  sha: string | null;
  /** artwork (ExportSpec decision 21): the recipe's file, the files to make (neither said: both),
   *  and the screen the board is drawn on */
  recipe: string | null;
  png: boolean;
  svg: boolean;
  screen: { w: number; h: number };
  /** serve: what the server does with VisualProof's own releases (UpdateSpec decision 2): takes a
   *  patch of its minor by itself, tells of a newer one, or neither */
  updates: UpdateMode;
  /** serve: a git address where the project goes (DeploySpec decision 1): the remote whose branch
   *  the server follows and builds; null for a folder */
  remote: Remote | null;
  /** --branch: the branch followed; null: the remote's default branch */
  branch: string | null;
  /** --poll: how often the remote is asked, in minutes; null: DEFAULT_POLL_MINUTES */
  poll: number | null;
  /** --build-timeout: the hours of `lake build` past which a build is stopped (DeploySpec decision
   *  14); null: DEFAULT_BUILD_HOURS */
  buildHours: number | null;
  /** --mathlib-cache: the user's Mathlib cache, or the deployment's own (DeploySpec decision 2);
   *  null: shared */
  mathlibCache: MathlibCache | null;
}

/** The usage, to stderr with status 2 for a command line it cannot read; asked for (`--help`),
 *  to stdout with status 0. */
function usage(code = 2): never {
  (code === 0 ? console.log : console.error)(`usage: visualproof serve  <lean-project | git URL> [--branch name] [--poll ${DEFAULT_POLL_MINUTES}] [--build-timeout ${DEFAULT_BUILD_HOURS}]
                                         [--mathlib-cache shared|own] [--root Name]... [--port 4173] [--host 127.0.0.1]
                                         [--site dir] [--cache dir] [--graph saved.json]
                                         [--identity-header X-Forwarded-User] [--editor URL-template]
                                         [--agents read|advise|full] [--access-key-file file] [--public] [--jobs ${DEFAULT_JOBS}]
                                         [--public-url https://host] [--allowed-host name]... [--library-limit GB]
                                         [--updates auto|notify|off]
       visualproof purge-file <lean-project> <sha256> [--site dir] [--cache dir]
       visualproof export <lean-project> -o page.html [--label text] [--root Name]... [--graph saved.json]
                                         [--jobs ${DEFAULT_JOBS}] [--site dir] [--cache dir]
       visualproof artwork <lean-project> --recipe recipe.json [-o name] [--png] [--svg] [--root Name]...
                                         [--site dir] [--cache dir] [--jobs ${DEFAULT_JOBS}] [--screen 1920x1200] [--graph saved.json]
       visualproof doctor [<lean-project>] [--root Name]... [--site dir] [--cache dir]
       visualproof --version

  Reads what \`lake build\` left in <lean-project>/.lake. It never builds the project, and writes
  nothing into it.

  A git URL where the project goes (https://github.com/owner/repo, ssh://…, git@host:owner/repo, or
  file:///path for a repository on this machine): the server follows that branch of the repository
  in a clone of its own in the cache, never a workspace, and builds each new commit itself —
  \`lake exe cache get\` where the project is on Mathlib, then \`lake build\` — one at a time, the
  newest commit pushed meanwhile the only one built after it; the board shows the last build
  meanwhile. Git's own credentials (an SSH key, a deploy key, a credential helper): VisualProof keeps
  none, and nothing waits on a prompt. Whoever can push to the branch runs code on this machine, as
  the server's user (SECURITY.md): run it as a user of its own, and protect the branch.
  --branch the branch followed (default: the remote's default branch); never a pull request's or
           a fork's
  --poll   how often the remote is asked for the branch's head, in minutes (default ${DEFAULT_POLL_MINUTES})
  --build-timeout  the hours past which \`lake build\` is stopped and the build failed, its commit
           not tried again (default ${DEFAULT_BUILD_HOURS}; ${MIN_BUILD_HOURS} to ${MAX_BUILD_HOURS}, fractions too: 1.5)
  --mathlib-cache  where \`lake exe cache get\` keeps Mathlib's files: shared (the default) — the
           user's, as their own builds' (~/.cache/mathlib, or MATHLIB_CACHE_DIR), so that a build
           fetches only what they have not; own — the deployment's, in its folder of the cache
           (deploy/<repo>-<hash>/mathlib-cache/): about 0.45 GB per version of Mathlib the branch
           builds, kept until that folder is removed

  --root   what to read: a library of the lakefile (the modules Lake builds of it) or a module;
           repeatable. By default the lakefile's default targets.
  --site   the site's folder: the review's logs and what this running site accumulates — the
           history of builds, the library's files, the views and their layouts, the timeline,
           conversations with agents, agents' tokens and personal links. It cannot be derived
           again and holds secrets: back it up, never commit it. One server at a time uses a
           site. Relative to the current directory, or absolute; default:
           ${join(dataHome(), "sites", "<project>-<hash>")}
  --cache  the root of the caches, which a rebuild makes again: the project's (extractions, the
           usage pass's results, prepared views, typeset documents, Lean's language server's
           folder) in projects/<project>-<hash>/, the Lean programs compiled per toolchain in
           lean/, the page's bundle in web/, VisualProof's own releases in updates.json and the
           patches downloaded in versions/ (code the servers run: keep the root yours alone),
           and the tips' tour film in media/.
           Default: ${cacheHome()}
           (XDG_DATA_HOME and XDG_CACHE_HOME move both homes, on any platform)

  --graph  use a saved extraction (a projects/*/extract/*.json of the cache) instead of reading
           the build; the project path still supplies the sources
  export   writes one self-contained HTML file: the page, its data and the sources, frozen

  artwork  makes the picture an artwork recipe says (the agents' API's, docs/agent-api/export.md:
           the size, the look, names by a rule, the targets, the selection), as the page's
           artwork mode makes it, without a browser: an SVG and a PNG (--png or --svg for one),
           named by -o (a name, or a path without its extension), else the recipe's title, else
           the project. With --site, the board as that site keeps it (its layout, pins and folds)
           and its review's targets; without, the board as a new site would lay it out, and the
           targets the recipe names. --screen: the screen the board is drawn on, as a reader's
           (default 1920x1200, at least 640x480): how large names are in the picture. It reads
           the site, never writes it; it writes the files and the cache's extraction. Anything
           that fails ends it with status 1. Notes are not drawn yet.

  --identity-header  behind a proxy that authenticates (Tailscale, oauth2-proxy, …): take each
           reader's name from this header instead of the name the page gives. Only use it when
           the proxy is the only way to reach the server: the header is believed as it comes.

  --editor  link each declaration to its place in an editor, through a URL template:
           "vscode://file/{path}:{line}:{col}" for VS Code on this machine, or
           "vscode://vscode-remote/ssh-remote+HOST{path}:{line}" for VS Code over SSH to it.
           {path} is the file on this machine, {rel} the file in the project, {line} and {col}
           where the declaration starts. Each reader can set their own in the page (?).

  --agents  what AI agents (requests with X-VisualProof-Kind: agent; their API is /api/agent) may
           change: read — nothing; advise — give advice and leave notes; full (the default) — also
           whatever a person can do through the page (targets, key declarations, trust, views,
           pins), each recorded as the agent's. An agent's opinion is advice whatever the level:
           shown apart, never counted; agent tokens stay with people.

  --jobs  how many modules the usage pass elaborates at once (default ${DEFAULT_JOBS}; 0: no pass). The
           pass finds which notation each declaration is written in and the exact context it is
           written in (TCBSpec.md, decisions 2 and 4); its findings follow the extractor's graph
           as its next version. Each worker takes about 400 MB of its own, several GB on a large
           project on Mathlib (serve and doctor say which --jobs the memory fits); with memory
           short, fewer run at a time. The import of a module is bound by memory bandwidth: past
           about a quarter of the cores it gains little.

  --access-key-file  let in only those given the link http://<host>:<port>/k/<key>, the key being
           what the file holds (one is made there, readable by its owner alone, if there is none).
           The link leaves a cookie in the browser; agents send Authorization: Bearer <key>.
           Anything else is answered 404, but a browser asking for a page, which is shown one
           that says the site is private and nothing of it. Over plain HTTP the key crosses the
           network in the clear: it keeps out who was not given the link, not who can watch the
           traffic.
           Share also gives an AI agent a token of its own (vpa_…), which reaches /api/agent only,
           and a person a link of their own (/i/vpp_…), which lets them in and says who they are,
           and anyone a read-only link (/r/vpr_…), which lets them see and change nothing shared.

  --public  with --access-key-file: whoever comes without the key or a link of their own is let
           in read-only, rather than turned away: they see the project, its review and its
           history, change nothing that is shared, and are seen by nobody. For a project anyone
           may read (a showcase); never for a private one.

  --public-url  the address people reach this server at, when it is not the one their browser
           sends (a proxy in front): the prompt Share makes for an agent tells it this address.

  --allowed-host  without --access-key-file, a name this server is reached by; repeatable. A
           server without a key answers only requests for an IP address, localhost (and the names
           under it), --public-url's host and these: any other name is answered 403, so that a web
           page that makes its own name resolve to this machine (DNS rebinding) cannot use it. Give
           the names people reach it by: a proxy's in front of it, this machine's own. With a key,
           the key keeps everyone else out, whatever the name.

  --updates  what the server does with VisualProof's own releases, asked of the npm registry
           (through npm) at start and once a day: auto (the default) — a patch of the version it
           runs (0.4.x) is downloaded into the cache and taken at a quiet moment, nobody on a page,
           open pages reloading where they were; a newer version (0.5.0) is told of, in the log
           and the help, with the command that installs it, after which the server restarts into
           it by itself; notify — told of, never downloaded; off — never asked (and no
           supervisor process), and the tips' tour film never fetched: the server reaches the
           network for nothing of its own. VISUALPROOF_UPDATES says the same. From a checkout,
           never asked.

  --library-limit  the most the project's library of papers and images may take, in GB (default
           ${DEFAULT_LIBRARY_LIMIT / 1024 ** 3}); its files are kept in the site directory, by their hash.

  purge-file  deletes a file's bytes from the library for good (a file added by mistake), and what
           was read of it; its record and its links stay in the review, saying this server lacks it.
           Nothing else deletes a file: removing one from the page archives it.

  doctor   checks what VisualProof needs on this machine (Node, elan, Poppler, XeLaTeX) and, given
           a project, its toolchain, its build and its site, and says what to do; it changes
           nothing.`);
  process.exit(code);
}

function parseArgs(argv: string[]): Options {
  const [cmd, ...rest] = argv;
  if (cmd === "--help" || cmd === "-h" || cmd === "help") usage(0);
  if (cmd === "--version" || cmd === "-v") {
    console.log(packageVersion());
    process.exit(0);
  }
  if (cmd !== "serve" && cmd !== "export" && cmd !== "purge-file" && cmd !== "doctor" && cmd !== "artwork") usage();
  const fromEnv = process.env.VISUALPROOF_UPDATES;
  if (cmd === "serve" && fromEnv !== undefined && !UPDATE_MODES.includes(fromEnv as UpdateMode)) {
    console.error(`visualproof: VISUALPROOF_UPDATES=${fromEnv}: say auto, notify or off`);
    process.exit(2);
  }
  const o: Options = { cmd, path: "", roots: [], port: 4173, host: "127.0.0.1", site: null, cache: null, graph: null, out: null, label: "VisualProof", identityHeader: null, editor: null, agents: "full", accessKeyFile: null, jobs: DEFAULT_JOBS, publicUrl: null, allowedHosts: [], libraryLimit: DEFAULT_LIBRARY_LIMIT, sha: null, publicRead: false, recipe: null, png: false, svg: false, screen: { w: 1920, h: 1200 }, updates: UPDATE_MODES.includes(fromEnv as UpdateMode) ? (fromEnv as UpdateMode) : "auto", remote: null, branch: null, poll: null, buildHours: null, mathlibCache: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const val = () => rest[++i] ?? usage();
    if (a === "--root") o.roots.push(val());
    else if (a === "--port") o.port = Number(val());
    else if (a === "--host") o.host = val();
    else if (a === "--site") o.site = val();
    else if (a === "--cache") o.cache = val();
    else if (a === "--graph") o.graph = resolve(val());
    else if (a === "-o" || a === "--out") o.out = resolve(val());
    else if (a === "--label") o.label = val();
    else if (a === "--identity-header") o.identityHeader = val();
    else if (a === "--editor") o.editor = val();
    else if (a === "--access-key-file") o.accessKeyFile = resolve(val());
    else if (a === "--public") o.publicRead = true;
    else if (a === "--recipe" && cmd === "artwork") o.recipe = resolve(val());
    else if (a === "--png" && cmd === "artwork") o.png = true;
    else if (a === "--svg" && cmd === "artwork") o.svg = true;
    else if (a === "--screen" && cmd === "artwork") {
      const v = val();
      const m = /^(\d+)x(\d+)$/.exec(v);
      // said in a line, as --public-url is, rather than the whole usage
      if (!m || +m[1] < 640 || +m[2] < 480 || +m[1] > 10000 || +m[2] > 10000) {
        console.error(`visualproof artwork: --screen ${v}: give the screen's width and height in pixels, e.g. 1920x1200, from 640x480 to 10000x10000`);
        process.exit(2);
      }
      o.screen = { w: +m[1], h: +m[2] };
    }
    else if (a === "--public-url") {
      const u = val();
      if (!/^https?:\/\/[^\s/?#]+\/?$/.test(u)) {
        console.error(`visualproof: --public-url ${u}: give the scheme and the host (and port), e.g. https://example.org`);
        process.exit(2);
      }
      o.publicUrl = u.replace(/\/+$/, "");
    }
    else if (a === "--allowed-host" && cmd === "serve") {
      const h = val();
      // a name, as a Host header gives it without its port (CollabSpec decision 12)
      if (!/^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?)*\.?$/.test(h)) {
        console.error(`visualproof: --allowed-host ${h}: give a name this server is reached by, without a scheme or a port, e.g. vp.example.org`);
        process.exit(2);
      }
      o.allowedHosts.push(h);
    }
    else if (a === "--jobs") {
      const n = Number(val());
      if (!Number.isInteger(n) || n < 0 || n > 256) usage();
      o.jobs = n;
    }
    else if (a === "--branch" && cmd === "serve") o.branch = val();
    else if (a === "--poll" && cmd === "serve") {
      const v = val();
      const m = Number(v);
      // said in a line, as --screen is
      if (!/^\d+(\.\d+)?$/.test(v) || m < MIN_POLL_MINUTES || m > 1440) {
        console.error(`visualproof: --poll ${v}: say how often the remote is asked, in minutes, from ${MIN_POLL_MINUTES} to 1440 (a day)`);
        process.exit(2);
      }
      o.poll = m;
    }
    else if (a === "--build-timeout" && cmd === "serve") {
      const h = parseBuildHours(val());
      if (typeof h !== "number") {
        console.error(`visualproof: ${h.error}`);
        process.exit(2);
      }
      o.buildHours = h;
    }
    else if (a === "--mathlib-cache" && cmd === "serve") {
      const v = val();
      if (!MATHLIB_CACHES.includes(v as MathlibCache)) {
        console.error(`visualproof: --mathlib-cache ${v.slice(0, 40)}: say shared (the user's Mathlib cache, as their builds': the default) or own (the deployment's, in its folder of the cache)`);
        process.exit(2);
      }
      o.mathlibCache = v as MathlibCache;
    }
    else if (a === "--updates" && cmd === "serve") {
      const mode = val();
      if (!UPDATE_MODES.includes(mode as UpdateMode)) usage();
      o.updates = mode as UpdateMode;
    }
    else if (a === "--agents") {
      const level = val();
      if (!AGENT_LEVELS.includes(level as AgentLevel)) usage();
      o.agents = level as AgentLevel;
    }
    else if (a === "--library-limit") {
      const gb = Number(val());
      if (!Number.isFinite(gb) || gb <= 0 || gb > 10000) usage();
      o.libraryLimit = Math.round(gb * 1024 ** 3);
    }
    else if (a.startsWith("-")) usage();
    else if (!o.path) o.path = a;
    else if (cmd === "purge-file" && !o.sha) o.sha = a;
    else usage();
  }
  if ((!o.path && cmd !== "doctor") || (cmd === "export" && !o.out) || (cmd === "artwork" && !o.recipe)) usage();
  // a git address where the project goes: the branch followed and built (DeploySpec decisions 1,
  // 10 and 11), its address and branch checked before anything is run
  if (o.path && isGitAddress(o.path)) {
    if (cmd !== "serve") {
      console.error(`visualproof ${cmd}: ${o.path.slice(0, 200)} is a git address: only serve follows a branch. Give the folder of its clone, which serve names as it starts (its "clone:" line).`);
      process.exit(2);
    }
    const r = parseRemote(o.path);
    if ("error" in r) {
      console.error(`visualproof: ${r.error}`);
      process.exit(2);
    }
    if (o.graph) {
      console.error("visualproof: --graph does not go with a git address: the server builds what it shows");
      process.exit(2);
    }
    const why = o.branch === null ? null : branchProblem(o.branch);
    if (why) {
      console.error(`visualproof: --branch ${why}`);
      process.exit(2);
    }
    o.remote = r;
  } else {
    // what is about following a branch and building it: a folder is never built (DeploySpec
    // decision 15)
    const given = [["--branch", o.branch], ["--poll", o.poll], ["--build-timeout", o.buildHours], ["--mathlib-cache", o.mathlibCache]].filter(([, v]) => v !== null).map(([n]) => n);
    if (given.length) {
      console.error(`visualproof: ${given.length > 1 ? `${given.slice(0, -1).join(", ")} and ${given[given.length - 1]} go` : `${given[0]} goes`} with a git address (serve https://github.com/owner/repo): a folder is read as its owner's builds leave it, never built`);
      process.exit(2);
    }
  }
  // read-only for whoever comes, beside those the key or a link lets in: without a key, everyone is in
  // already; behind a sign-in, there is nobody else
  if (o.publicRead && (!o.accessKeyFile || o.identityHeader)) {
    console.error("visualproof: --public lets in read-only whoever has no key: it needs --access-key-file, and does not go with --identity-header");
    process.exit(2);
  }
  // the names a server without a key answers: with one, the key keeps everyone else out whatever
  // the name (CollabSpec decision 12)
  if (o.allowedHosts.length && o.accessKeyFile) console.warn("visualproof: --allowed-host changes nothing with --access-key-file: the key lets in whoever has it, by any name");
  if (cmd === "purge-file" && !validSha(o.sha)) {
    console.error("visualproof purge-file: give the file's SHA-256, 64 hex digits, as the page's library shows it.");
    process.exit(2);
  }
  // a template that cannot make a link is said at the start, not found out by a reader's click
  const why = o.editor === null ? null : invalidTemplate(o.editor);
  if (why) {
    console.error(`visualproof: --editor ${o.editor}: ${why}`);
    process.exit(2);
  }
  return o;
}

/** The server's answers to requests: exported so that the tests serve them as the server does. */
export class App {
  live: Live;
  hover: LeanHover;
  ids: Identities;
  /** how long a read of the project's git (GET /api/git) is kept, whoever asks: git is run at most
   *  once in that time, so what readers cost the server is bounded (CollabSpec decision 11); 0 in
   *  the tests */
  gitFreshMs = 3000;
  private gitRead: { at: number; git: GitSource | null } | null = null;
  /** the agents' API (server/agent.ts), and what agents may change */
  agents: AgentApi;
  /** who may come in at all (server/access.ts); null: anyone who reaches the port */
  access: Access | null;
  /** the exported document's typesetting (server/export.ts, ExportSpec.md); null: no export here */
  exporter: Exporter | null;
  /** the address people reach the server at, for the prompt Share makes (--public-url); null: the
   *  one the person's browser used */
  publicUrl: string | null;

  /** --public: whoever comes without the key or a link of their own reads only (CollabSpec
   *  decision 11) */
  publicRead: boolean;
  /** without a key, the names this server answers besides its addresses and localhost
   *  (server/access.ts, hostAllowed): --public-url's host and every --allowed-host; null: every
   *  name, the key keeping everyone else out */
  hostNames: string[] | null;
  /** the names refused as Host, said once each in the server's console (a few: whoever asks
   *  chooses them) */
  private refusedHosts = new Set<string>();
  /** the read-only readers' requests, by the read-only link they came by, or "public" */
  private readOnlyOf = new WeakMap<IncomingMessage, string>();
  /** what read-only readers may cost the server: Lean's answers, their documents */
  readonly bounds: ReadOnlyBounds;
  /** VisualProof's own releases as this server follows them (server/updates.ts); null: the
   *  version alone is told (a test's server) */
  updates: Updates | null = null;

  constructor(live: Live, hover: LeanHover, ids: Identities, agents: AgentApi, access: Access | null, exporter: Exporter | null = null, publicUrl: string | null = null, publicRead = false, allowedHosts: string[] = []) {
    this.live = live;
    this.hover = hover;
    this.ids = ids;
    this.agents = agents;
    this.access = access;
    // a personal link says who its holder is (CollabSpec decision 9); behind a proxy that signs
    // people in, the proxy does, and there are no personal links
    ids.invites = ids.header ? null : live.invites;
    this.exporter = exporter;
    // agents typeset as people do (ExportSpec decision 11), through their API
    agents.exporter = exporter;
    this.publicUrl = publicUrl;
    this.publicRead = publicRead && access !== null;
    this.hostNames = access ? null : [...(publicUrl ? [urlHost(publicUrl)] : []), ...allowedHosts];
    this.bounds = new ReadOnlyBounds((id) => this.exporter?.job(id)?.state === "running");
  }

  /** Whether a request is told all of the server's own releases (UpdateSpec decision 11): someone
   *  let in fully; not a read-only reader, nor an agent. */
  private toldAll(req: IncomingMessage): boolean {
    return this.readOnlyOf.get(req) === undefined && this.ids.kind(req) !== "agent";
  }

  /** The exported document (ExportSpec decisions 5–16): POST /api/export starts typesetting the
   *  document of a view, `{view, settings, version?}` (a build the Time Machine shows the view at;
   *  left out, the view's own), and answers with its job at once; the page asks how the
   *  job is doing (GET /api/export/job) and fetches the PDF and the LaTeX sources once it is done
   *  (GET /api/export/file). The answers are the agents' API's (server/agent.ts), which has the same
   *  routes under /api/agent/; an agent that comes here is held to its one job at a time there too.
   *  The window shows the title and the author line the document will have (GET /api/export/head
   *  ?view=&version=: ExportSpec decisions 14 and 15), which only the server can tell: who dropped
   *  each pin is never sent to pages. */
  private async export(req: IncomingMessage, res: ServerResponse, url: URL, agent: boolean, readOnly = false): Promise<void> {
    const path = url.pathname;
    const api = this.agents;
    // the document's outline, which the linear form draws: nothing is typeset for it
    if (path === "/api/export/outline") {
      const o = api.exportOutline(url.searchParams.get("view") ?? "", url.searchParams.get("version") ?? undefined);
      return sendJson(res, o.body, o.status, o.headers);
    }
    if (!this.exporter) return sendJson(res, { error: "This server does not export documents." }, 404);
    let a: Answer;
    if (path === "/api/export" && req.method === "POST") {
      const caller: Caller | null = agent ? { name: this.ids.who(req), kind: "agent" } : null;
      if (caller && !caller.name) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
      const r = await this.json(req, 1 << 20);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      // read-only readers typeset one document at a time among them (CollabSpec decision 11): while
      // one is being typeset, the others wait, even one the export's cache holds. The place is
      // taken before the job starts, so that two requests at once cannot both start one.
      if (readOnly) {
        if (!this.bounds.mayExport()) return sendJson(res, { error: "Another document is being typeset for readers of this page: try again in a little while." }, 429, { "retry-after": "5" });
        this.bounds.reserveExport();
      }
      let started: Answer | undefined;
      try {
        started = await api.exportStart(r.body, caller);
      } finally {
        if (readOnly) this.bounds.exportStarted(started?.body);
      }
      a = started;
    } else if (path === "/api/export/head") a = api.exportHead(url.searchParams.get("view") ?? "", url.searchParams.get("version") ?? undefined);
    else if (path === "/api/export/job") a = api.exportJob(url.searchParams.get("id") ?? "", false);
    else if (path === "/api/export/file") a = api.exportFile(url.searchParams.get("id") ?? "", url.searchParams.get("what"));
    else return sendJson(res, { error: "not found" }, 404);
    if (a.file) return sendDownload(res, a.file);
    // the agents' answer as it is: the page shows its error, and an agent that asked here its hint
    sendJson(res, a.body, a.status, a.headers);
  }

  /** A request to the agents' API: read here, answered there. An agent with a token of its own is
   *  who its token says, whatever its headers say (server/tokens.ts). */
  private async agent(req: IncomingMessage, res: ServerResponse, url: URL, token: TokenRecord | null = null): Promise<void> {
    const said = this.ids.who(req);
    const caller: Caller = token
      ? { name: token.name, kind: "agent", token: { id: token.id, by: token.by, level: token.level, expires: token.expires }, ...(said && said !== token.name ? { ignoredName: said } : {}) }
      : { name: said, kind: this.ids.kind(req) };
    let body: unknown = null;
    if (req.method === "POST" && url.pathname.replace(/\/+$/, "") === UPLOAD_PATH) {
      // a file for the library: its bytes as they come (server/agentlibrary.ts)
      const bytes = await readUpload(req, res);
      if (!bytes) return;
      body = { bytes };
    } else if (req.method === "POST") {
      const r = await this.json(req, AGENT_BODY);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.`, hint: "Send a JSON object, with content-type: application/json." }, 400);
      body = r.body;
    }
    // a request that waits (the inbox, the companion) learns that its asker went away: an agent's
    // wait for messages ends with its connection, so that none is handed to nobody
    const away = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) away.abort();
    });
    // the session an MCP server says it is (since 0.4.0): a wait from another is a new session's
    const session = req.headers["x-visualproof-session"];
    const a = await this.agents.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller, base: this.publicUrl ?? `http://${hostOf(req)}`, signal: away.signal, ...(validSession(session) ? { session } : {}) });
    if (away.signal.aborted) return;
    if (a.text) return sendText(req, res, a.text.body, a.text.type, a.status);
    if (a.file) return sendDownload(res, a.file);
    if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
    sendJson(res, a.body, a.status, a.headers);
  }

  /** The conversations (CollabSpec decision 13, AgentSpec decision 8), for pages: a channel read
   *  (GET ?channel=public|<agent id>&before=<id>, the newest 200 first) and a message written in it
   *  (POST {channel, text, place}). Everyone with a name reads and writes the public channel; an
   *  agent's private channel is its maker's alone (shared/collab.ts, madeBy: 403 to anyone else).
   *  A read-only reader neither sees nor writes any (403), whatever the page sends; agents talk
   *  through their API. A private channel cannot be written to while its agent is offline (409); a
   *  mention of it in the public channel can, and is handed to it when it comes back. At most so
   *  many messages a minute, a person's in every channel together. */
  private async chat(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const live = this.live;
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, { error: "/api/chat answers GET and POST." }, 405);
    if (this.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agents talk through their API.", hint: "GET /api/agent/channel, POST /api/agent/reply." }, 403);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, { error: "Say who you are first: the conversations are for people with a name, and a message is sent under yours.", who: true }, 401);
    const who = { name: me, person: this.ids.person(req)?.id ?? null };
    /** the channel a request names: the public one, or an agent's private one that is this
     *  reader's — 404 where there is no such agent, 403 where it is someone else's */
    const channelOf = (raw: unknown): { key: string; agent: { id: string; record: TokenRecord } | null } | Answer => {
      if (raw === "public" || raw === undefined || raw === null || raw === "") return { key: PUBLIC, agent: null };
      const tok = typeof raw === "string" ? live.presence.tokenOf(raw) : null;
      const record = tok ? live.tokens.get(tok) : undefined;
      if (!tok || !record) return { status: 404, body: { error: "There is no such channel: public, or the id of an agent with a token of its own." } };
      if (!madeBy(record, who)) return { status: 403, body: { error: `${record.name}'s private channel is ${record.by}'s, who made its token: nobody else reads or writes it.`, private: true } };
      return { key: tok, agent: { id: raw as string, record } };
    };
    if (req.method === "GET") {
      const c = channelOf(url.searchParams.get("channel") ?? url.searchParams.get("agent"));
      if ("status" in c) return sendJson(res, c.body, c.status);
      const raw = url.searchParams.get("before");
      const before = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
      const messages = live.talk.thread(c.key, THREAD, before).map(forPages);
      if (!c.agent) return sendJson(res, { channel: PUBLIC, messages });
      return sendJson(res, { channel: c.agent.id, agent: { id: c.agent.id, name: c.agent.record.name, talk: live.talk.talk(c.key) }, messages });
    }
    const r = await this.json(req, 1 << 16);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as { channel?: unknown; agent?: unknown; text?: unknown; place?: unknown };
    const c = channelOf(b.channel ?? b.agent);
    if ("status" in c) return sendJson(res, c.body, c.status);
    if (c.agent && live.talk.state(c.key) === "offline") return sendJson(res, { error: "offline", message: `${c.agent.record.name} is offline: it can be written to once it listens again.` }, 409);
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return sendJson(res, { error: "The message is empty." }, 400);
    if (text.length > MAX_PERSON) return sendJson(res, { error: `A message is at most ${MAX_PERSON.toLocaleString("en")} characters.` }, 400);
    const wait = live.talk.allow("person", who.person ? `p:${who.person}` : `n:${nameKey(me)}`);
    if (wait) return sendJson(res, { error: `Too many messages at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
    // where the writer was, as the page says it, bounded: a selection can be a long query; a private
    // reader's message says nothing of where they are (CollabSpec decision 8), only who wrote it
    const view = this.ids.privateOf(req) === null ? cleanView(b.place) : null;
    const at = view ? this.agents.placeOf(view) : null;
    const clip = (x: string | null, n: number) => (x !== null && x.length > n ? x.slice(0, n - 1) + "…" : x);
    const where = at ? { inWords: clip(at.inWords, 600)!, view: at.view, declaration: clip(at.declaration, 300), selection: clip(at.selection, 300) } : null;
    // the names it mentions; in the public channel, the agents among them are handed it
    const can = live.mentionable();
    const mentions = mentioned(text, can.names);
    const to = c.agent ? [] : [...new Set(mentions.flatMap((n) => can.agents.get(nameKey(n)) ?? []))];
    const message = live.talk.post(c.key, { from: me, kind: "person", text, ...(mentions.length ? { mentions } : {}), where, to });
    return sendJson(res, { ok: true, channel: c.agent?.id ?? PUBLIC, message: forPages(message) });
  }

  /** A new conversation in an agent's private channel (AgentSpec decision 8, the owner's decisions
   *  of 2026-10-11 and 2026-10-19): a divider, from its maker alone, held to the rate of their
   *  messages; an offline agent's too, so that its next session starts clean. One right after
   *  another divides nothing: it is answered `unchanged`, and neither written nor counted. */
  private async chatNew(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const live = this.live;
    if (req.method !== "POST") return sendJson(res, { error: "/api/chat/new answers POST." }, 405);
    if (this.readOnlyOf.has(req)) return sendJson(res, { error: "This page is read-only.", readOnly: true }, 403);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "A new conversation is for people to start." }, 403);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, { error: "Say who you are first: a new conversation is started under your name.", who: true }, 401);
    const r = await this.json(req, 1 << 12);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as { agent?: unknown };
    const tok = typeof b.agent === "string" ? live.presence.tokenOf(b.agent) : null;
    const record = tok ? live.tokens.get(tok) : undefined;
    if (!tok || !record) return sendJson(res, { error: "There is no such agent: only an agent with a token of its own has a private channel." }, 404);
    const person = this.ids.person(req)?.id ?? null;
    if (!madeBy(record, { name: me, person })) return sendJson(res, { error: `Only ${record.by}, who made ${record.name}'s token, starts a new conversation with it.`, private: true }, 403);
    if (live.talk.fresh(tok)) return sendJson(res, { ok: true, unchanged: true, divider: null, message: "Nothing was said since the conversation began: it is new already." });
    const wait = live.talk.allow("person", person ? `p:${person}` : `n:${nameKey(me)}`);
    if (wait) return sendJson(res, { error: `Too many at once: wait ${wait} s.`, retryAfter: wait }, 429, { "retry-after": String(wait) });
    const divider = live.talk.restart(tok, me);
    return sendJson(res, { ok: true, divider: divider && forPages(divider) });
  }

  /** Asking others to follow (CollabSpec decision 10, the owner's decision of 2026-10-12), for pages:
   *  POST /api/ask {token, to?} — the page whose event stream holds `token` asks everyone on the
   *  server, or the person whose page is listed as `to`, to follow its reader, who has a name and is
   *  visible: a private reader cannot be followed; POST /api/ask/answer {token, id, answer} — a page
   *  asked answers, whoever its reader is. The server relays both (server/askfollow.ts); agents ask
   *  through their API (POST /api/agent/ask-follow). */
  private async ask(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const live = this.live;
    if (req.method !== "POST") return sendJson(res, { error: `${url.pathname} answers POST.` }, 405);
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agents ask through their API.", hint: "POST /api/agent/ask-follow." }, 403);
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as { token?: unknown; to?: unknown; id?: unknown; answer?: unknown };
    const page = live.pageStream(b.token);
    if (!page) return sendJson(res, { error: "This request is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
    if (url.pathname === "/api/ask/answer") {
      const a = live.asks.answer(b.token as string, b.id, b.answer);
      return sendJson(res, a.body, a.status);
    }
    if (url.pathname !== "/api/ask") return sendJson(res, { error: "not found" }, 404);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, this.nameless(req, "a request to follow you says who asks"), 401);
    if (page.private || this.ids.privateOf(req) !== null) return sendJson(res, { error: "You are private: nobody can follow you. Go visible (the menu under your name) to ask." }, 409);
    if (b.to !== undefined && b.to !== null && typeof b.to !== "string") return sendJson(res, { error: "to is a reader's id, as presence lists them; left out, everyone." }, 400);
    const person = this.ids.person(req);
    // one request every 30 s per person — their personal link, else their name — and per page
    const key = person ? `p:${person.id}` : `n:${nameKey(me)}`;
    const a = live.asks.ask({ name: me, verified: !!person, agent: false, from: page.id, stream: b.token as string, rate: [key, `s:${b.token as string}`] }, typeof b.to === "string" ? { page: b.to } : { everyone: true });
    if ("ok" in a) {
      const { report: _, ...sent } = a.ok;
      return sendJson(res, { ok: true, ...sent });
    }
    return sendJson(res, { error: a.error, ...(a.retryAfter ? { retryAfter: a.retryAfter } : {}) }, a.status, a.retryAfter ? { "retry-after": String(a.retryAfter) } : undefined);
  }

  /** Sharing with an AI agent (AgentSpec decision 7), for people: the tokens in force (GET), a new
   *  one with its prompt (POST), a token's prompt shown again (POST …/prompt), and revoking one
   *  (POST …/revoke). All but the list need a name: a token is made under it, and its prompt holds
   *  the token. The prompt is asked for by POST, as making one is, so that the browser sends its
   *  Origin and the prompt names the server as the page reached it, the same both times. */
  private async shareAgents(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // agent tokens stay with people, at every level (the owner's decision, AgentSpec decision 9):
    // an agent that could make, show or revoke tokens could outlive its own revocation. A token
    // never gets here (it reaches the agents' API alone), and a request that says it is an agent's
    // is refused
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Agent tokens are for people: an agent cannot make, show or revoke them, at any level." }, 403);
    const tokens = this.live.tokens;
    const top = this.agents.level;
    const me = this.ids.who(req);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/share/agents" && req.method === "GET")
      return sendJson(res, { level: top, levels: AGENT_LEVELS.slice(0, AGENT_LEVELS.indexOf(top) + 1), defaultLevel: lower("advise", top), days: TOKEN_DAYS, defaultDays: DEFAULT_DAYS, tokens: tokens.inForce().map(AgentTokens.info) });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    if (!me) return sendJson(res, { error: "Say who you are first: a token is made, shown or revoked under your name.", who: true }, 401);
    const r = await this.json(req, 1 << 16);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as Record<string, unknown>;
    if (path === "/api/share/agents/revoke") {
      if (typeof b.id !== "string" || !tokens.revoke(b.id, me)) return sendJson(res, { error: "There is no such token in force." }, 404);
      return sendJson(res, { ok: true, tokens: tokens.inForce().map(AgentTokens.info) });
    }
    // the server as the prompt names it
    const address = this.publicUrl ?? reachedAt(req);
    if (path === "/api/share/agents/prompt") {
      // a token that ended has no prompt: it lets nothing in. Its maker alone is shown it again (the
      // owner's decision of 2026-10-19): whoever holds the token reads its private channel
      const t = typeof b.id === "string" ? tokens.token(b.id) : null;
      if (!t) return sendJson(res, { error: "There is no such token in force." }, 404);
      if (!madeBy(t.record, { name: me, person: this.ids.person(req)?.id ?? null })) return sendJson(res, { error: `Only ${t.record.by}, who made it, is shown this token's prompt again: whoever holds a token reads its agent's private channel.`, maker: false }, 403);
      return sendJson(res, { token: AgentTokens.info(t.record), prompt: agentPrompt({ url: address, token: t.token, record: t.record }) });
    }
    if (path !== "/api/share/agents") return sendJson(res, { error: "not found" }, 404);
    // the name given is the agent's as it is; none, the person's AI ("Alice's AI")
    const name = b.name === undefined || b.name === null || (typeof b.name === "string" && !b.name.trim()) ? defaultAgentName(me) : b.name;
    const bad = invalidAgentName(name);
    if (bad) return sendJson(res, { error: bad }, 400);
    const level = (b.level ?? lower("advise", top)) as AgentLevel;
    if (!AGENT_LEVELS.includes(level)) return sendJson(res, { error: "level is read, advise or full." }, 400);
    if (AGENT_LEVELS.indexOf(level) > AGENT_LEVELS.indexOf(top)) return sendJson(res, { error: `This server lets agents do at most ${top} (--agents ${top}): a token cannot give more.` }, 400);
    const days = b.days ?? DEFAULT_DAYS;
    if (!TOKEN_DAYS.includes(days as (typeof TOKEN_DAYS)[number])) return sendJson(res, { error: `days is one of ${TOKEN_DAYS.join(", ")}.` }, 400);
    const made = tokens.create({ name: (name as string).trim(), by: me, person: this.ids.person(req)?.id ?? null, level, days: days as number });
    const prompt = agentPrompt({ url: address, token: made.token, record: made.record });
    return sendJson(res, { token: AgentTokens.info(made.record), prompt, tokens: tokens.inForce().map(AgentTokens.info) });
  }

  /** Inviting a person (CollabSpec decision 9), for people: the personal links in force (GET), a new
   *  one for a person named in the body (POST), and revoking one (POST …/revoke). Making and
   *  revoking need a name: who made a link, and who revoked it, is said in Share. The link itself
   *  is answered once to whoever made it, and again to its holder alone (`mine`). */
  private async sharePeople(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Personal links are for people: an agent cannot make, list, show or revoke them." }, 403);
    if (this.ids.header) return sendJson(res, { error: "Names come from the sign-in in front of this server: it has no personal links." }, 404);
    const invites = this.live.invites;
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/share/people/mine" || path === "/api/share/people/mine/renew") return this.myLink(req, res, path);
    const list = () => invites.inForce().map(Invites.info);
    if (path === "/api/share/people" && req.method === "GET") return sendJson(res, { invites: list() });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const me = this.ids.who(req);
    if (!me) return sendJson(res, this.nameless(req, "a personal link is made or revoked under your name"), 401);
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const b = (r.body ?? {}) as Record<string, unknown>;
    if (path === "/api/share/people/revoke") {
      if (typeof b.id !== "string" || !invites.revoke(b.id, me)) return sendJson(res, { error: "There is no such personal link in force." }, 404);
      return sendJson(res, { ok: true, invites: list() });
    }
    if (path !== "/api/share/people") return sendJson(res, { error: "not found" }, 404);
    const bad = invalidPersonName(b.name);
    if (bad) return sendJson(res, { error: bad }, 400);
    const made = invites.create({ name: b.name as string, by: me });
    if (typeof made === "string") return sendJson(res, { error: made, taken: true }, 409);
    // the link as the person will open it: the server's address as this page reached it
    const link = `${this.publicUrl ?? reachedAt(req)}${INVITE_PATH}${made.token}`;
    return sendJson(res, { invite: Invites.info(made.record), link, invites: list() });
  }

  /** The personal link a page came by, for its holder alone (CollabSpec decision 9, the owner's
   *  decision of 2026-10-19): shown again (POST /api/share/people/mine; `link` null for a link made
   *  before 0.6.0, of which the server kept only the digest), or made anew (POST …/mine/renew,
   *  `{stream}` the event stream of the page asking, which stays open) — the same id under a new
   *  secret, the old link and the browsers it let in cut off, this browser given the new cookie.
   *  Whoever else asks is refused: its maker, a guest, an agent; a read-only reader's page posts
   *  nothing here (server/readonlygate.ts). Asked for by POST, as an agent's prompt is, so that the
   *  browser sends its Origin and the link names the server as the page reached it. */
  private async myLink(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const p = this.ids.person(req);
    if (!p) return sendJson(res, { error: "A personal link is shown to its holder alone, in a browser it let in: this page came by none.", holder: false }, 403);
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const invites = this.live.invites;
    const address = this.publicUrl ?? reachedAt(req);
    if (path === "/api/share/people/mine") {
      const token = invites.tokenOf(p.id);
      return sendJson(res, { invite: Invites.info(p), link: token ? `${address}${INVITE_PATH}${token}` : null });
    }
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const keep = (r.body as { stream?: unknown } | null)?.stream;
    const made = invites.renew(p.id, { keep: typeof keep === "string" ? keep : undefined });
    if (!made) return sendJson(res, { error: "There is no such personal link in force." }, 404);
    // this browser stays in: the cookie of the new link, beside what the request was given already
    const set = res.getHeader("set-cookie");
    res.setHeader("set-cookie", [...(Array.isArray(set) ? set : set === undefined ? [] : [String(set)]), invites.cookie(made.record)]);
    return sendJson(res, { invite: Invites.info(made.record), link: `${address}${INVITE_PATH}${made.token}` });
  }

  /** Read-only links (CollabSpec decision 11), for people: every link (GET), a new one (POST), and
   *  revoking one (POST …/revoke). Anyone let in may make one; revoking needs a name, which Share
   *  says beside the link. A server open to all, or behind a sign-in, has none. */
  private async shareReadOnly(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "Read-only links are for people: an agent cannot make, list or revoke them." }, 403);
    if (!this.access || this.ids.header) return sendJson(res, { error: this.ids.header ? "Who comes in is the sign-in's, in front of this server: it has no read-only links." : "This server lets in whoever reaches it: a read-only link would let in no one more." }, 404);
    const links = this.live.readOnly;
    const path = url.pathname.replace(/\/+$/, "");
    const address = this.publicUrl ?? reachedAt(req);
    const list = () => links.list().map((l) => ({ ...l, link: `${address}${l.path}` }));
    if (path === "/api/share/readonly" && req.method === "GET") return sendJson(res, { links: list() });
    if (req.method !== "POST") return sendJson(res, { error: `${path} answers POST.` }, 405);
    const me = this.ids.who(req);
    if (path === "/api/share/readonly/revoke") {
      if (!me) return sendJson(res, this.nameless(req, "a read-only link is revoked under your name"), 401);
      const r = await this.json(req, 4096);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      const id = (r.body as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !links.revoke(id, me)) return sendJson(res, { error: "There is no such read-only link in force." }, 404);
      return sendJson(res, { ok: true, links: list() });
    }
    if (path !== "/api/share/readonly") return sendJson(res, { error: "not found" }, 404);
    const made = links.create(me);
    return sendJson(res, { made: { ...made, link: `${address}${made.path}` }, links: list() });
  }

  /** A personal link opened (CollabSpec decision 9): the browser is given the cookie that lets its
   *  holder in, as who the link says, and goes on to the page — the token leaves the address, and a
   *  place after it (a fragment) comes along. A revoked link says so; anything else is answered as
   *  any address nobody was given. On a server with a key, a browser is shown the page of a link
   *  that does not open the site instead (CollabSpec decision 7), which says neither which it was
   *  nor who revoked it — unless the key or a link of its own lets it in, and it may be told. */
  private enter(req: IncomingMessage, res: ServerResponse, token: string, path: string): void {
    const c = this.ids.header ? null : this.live.invites.check(token);
    if (c && "ok" in c) {
      res.writeHead(303, { location: "/", "set-cookie": this.live.invites.cookie(c.ok), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return void res.end();
    }
    if (this.access && asksForPage(req, path) && (!c || !this.letIn(req))) return sendAccessPage(res, "link", this.publicRead);
    if (c) return sendText(req, res, endedWords(c) + "\n", "text/plain; charset=utf-8", 410);
    sendJson(res, { error: "not found" }, 404);
  }

  /** A read-only link opened (CollabSpec decision 11): the browser is given the cookie that lets
   *  its holder read, and goes on to the page — the token leaves the address, and a place after it
   *  (a fragment) comes along. A revoked link says so; anything else, and any link on a server
   *  open to all or behind a sign-in, which have none, is answered as an address nobody was given;
   *  to a browser, on a server with a key, as a personal link's (enter). */
  private enterReadOnly(req: IncomingMessage, res: ServerResponse, token: string, path: string): void {
    const c = this.access && !this.ids.header ? this.live.readOnly.check(token) : null;
    if (c && "ok" in c) {
      res.writeHead(303, { location: "/", "set-cookie": this.live.readOnly.cookie(c.ok.id), "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return void res.end();
    }
    if (this.access && asksForPage(req, path) && (!c || !this.letIn(req))) return sendAccessPage(res, "link", this.publicRead);
    if (c) return sendText(req, res, revokedWords(c.link, "read-only") + "\n", "text/plain; charset=utf-8", 410);
    sendJson(res, { error: "not found" }, 404);
  }

  /** Whether the key's cookie or a personal link in force lets a request in: someone who sees the
   *  site's people, and may be told who revoked a link. */
  private letIn(req: IncomingMessage): boolean {
    return !!this.ids.person(req) || this.access?.admit(req, "/") === "in";
  }

  /** Who the reader is (POST /api/identity {name}): the name someone invited by a personal link goes
   *  by from now on — kept with their link, and said in their review log, so that what they wrote
   *  shows under it — or, for a guest, whether a name is theirs to take: one a link's holder goes
   *  by is not (409). A guest's name is their page's own; nothing of it is kept here. */
  private async identity(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.ids.kind(req) === "agent") return sendJson(res, { error: "An agent's name is its own: its token's, or the one it sends." }, 403);
    if (this.ids.header) return sendJson(res, { error: "Your name is the sign-in's, in front of this server: it cannot be changed here." }, 403);
    const r = await this.json(req, 4096);
    if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
    const name = (r.body as { name?: unknown } | null)?.name;
    const bad = invalidPersonName(name);
    if (bad) return sendJson(res, { error: bad }, 400);
    const n = (name as string).trim();
    const p = this.ids.person(req);
    if (!p) {
      const holder = this.live.invites.holder(n);
      return holder ? sendJson(res, { error: taken(holder), taken: true }, 409) : sendJson(res, { ok: true, name: n });
    }
    const was = p.name;
    const done = this.live.invites.rename(p.id, n);
    if (typeof done === "string") return sendJson(res, { error: done, taken: true }, 409);
    // their log says so, where they have one: what they wrote shows under the new name everywhere.
    // A log that cannot be written to now (a line to mend by hand) says it with their next line,
    // which carries the name it is written under
    if (done.name !== was) this.live.review.named(p.id, done.name);
    return sendJson(res, { ok: true, name: done.name, person: Invites.info(done) });
  }

  /** A request for a name this server without a key does not answer (CollabSpec decision 12): 403,
   *  saying which option lets the name in; and, once per name, the server's console says it too,
   *  for whoever runs it behind a proxy that forwards the name people reach it by. A browser asking
   *  for a page is shown a page that says so (the owner's decision of 2026-10-18), which does not
   *  repeat the name: it is the requester's, any text at all. */
  private refuseHost(req: IncomingMessage, res: ServerResponse, path: string): void {
    const raw = req.headers.host ?? "";
    const name = /^\[/.test(raw) ? raw : raw.replace(/:\d{1,5}$/, "");
    const shown = /^[A-Za-z0-9._\-[\]:]{1,253}$/.test(name) ? name : null;
    if (shown && this.refusedHosts.size < 20 && !this.refusedHosts.has(shown.toLowerCase())) {
      this.refusedHosts.add(shown.toLowerCase());
      console.error(`refused a request for ${shown}: without an access key this server answers only its addresses, localhost, --public-url's host and the --allowed-host names; --allowed-host ${shown} lets this one in`);
    }
    if (asksForPage(req, path)) return sendAccessPage(res, "host");
    sendText(req, res, `This server answers only the names it is meant to be reached by${shown ? `, and ${shown} is not one of them` : ""}. Whoever runs it can let a name in with --allowed-host${shown ? ` ${shown}` : " <name>"}.\n`, "text/plain; charset=utf-8", 403);
  }

  /** The answer to a request that needs a name and has none: the page asks for one (`who`). Where
   *  the name the page gives is a personal link holder's, it says so, and the page asks for
   *  another. */
  private nameless(req: IncomingMessage, what: string): { error: string; who: true } {
    const holder = this.ids.taken(req);
    return { error: holder ? `${taken(holder)} (Click your name.)` : `Say who you are first: ${what}.`, who: true };
  }

  /** The library's operations (server/library.ts), shared with the agents' API. */
  private library() {
    return libraryApiOf(this.live, () => ({
      review: this.live.review,
      project: this.live.project,
      library: this.live.library,
      graph: () => {
        const v = this.agents.reviews.graph();
        return "status" in v ? null : v;
      },
      // every file the library takes shows on the Project: a note carries it, on the ring
      fileAdded: (f, who, note) => void this.live.views.fileAdded(f, { by: who.name, agent: who.agent, person: who.person ?? null }, note),
    }));
  }

  /** A request about views (server/views.ts): read here, answered there. A private page's is
   *  answered as its, recorded without its name (CollabSpec decision 8). */
  private async views(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const priv = this.ids.privateOf(req);
    const person = this.ids.person(req);
    const caller: Caller = { name: this.ids.who(req), kind: this.ids.kind(req), ...(person ? { person: person.id } : {}), ...(priv !== null ? { private: { session: priv || null } } : {}) };
    let body: unknown = null;
    if (req.method === "POST") {
      // a board's layout memory is as large as the board; nothing else about views is
      const r = await this.json(req, url.pathname.replace(/\/+$/, "") === "/api/views/memory" ? MAX_MEMORY_BYTES : 1 << 20);
      if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
      body = r.body;
    }
    const a: Answer = this.live.views.handle({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, caller }, this.agents.level);
    sendJson(res, a.body, a.status, a.headers);
  }

  /** A request's JSON body, or why it has none. A body larger than `limit` is answered here and
   *  now, 413 (as the agents' API words its errors under /api/agent), and the connection closed
   *  after it, without reading the rest; whoever asked for the body is told `too large`, and what
   *  it answers after is not sent (sendJson). */
  private async json(req: IncomingMessage, limit: number): Promise<{ body?: unknown; error?: string }> {
    let text: string;
    try {
      text = await readBody(req, limit);
    } catch (e) {
      const res = this.responses.get(req);
      if (!(e instanceof TooLarge) || !res) return { error: e instanceof Error ? e.message : String(e) };
      const size = limit >= 1 << 20 ? `${Math.round(limit / (1 << 20))} MB` : `${Math.round(limit / 1024)} KB`;
      const agent = (req.url ?? "").startsWith("/api/agent");
      tooLarge(req, res, { error: `The body is larger than ${size}, as much as this request takes.`, ...(agent ? { hint: "Send less at once: fewer items per request (POST /api/agent/opinions takes 100 at most), or split the request." } : {}) });
      return { error: "too large" };
    }
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { error: "not JSON" };
    }
  }

  /** each request's response, for what answers a request while reading it (a body too large) */
  private responses = new WeakMap<IncomingMessage, ServerResponse>();

  /** Answer a request; whatever goes wrong in answering it is answered too, 500 with what it was,
   *  rather than left hanging or taking the server down. */
  handle(req: IncomingMessage, res: ServerResponse): void {
    this.responses.set(req, res);
    this.route(req, res).catch((e: unknown) => {
      console.error(`${req.method} ${req.url?.slice(0, 200)}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      const agent = (req.url ?? "").startsWith("/api/agent");
      if (!res.headersSent) sendJson(res, { error: e instanceof Error ? e.message : String(e), ...(agent ? { hint: "This is the server's fault; the request may work again." } : {}) }, 500);
      else res.destroy();
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const live = this.live;
    // without a key, only the names this server is reached at (CollabSpec decision 12, the owner's
    // decision of 2026-10-18): a page whose own name was made to resolve to this machine (DNS
    // rebinding) is refused whatever it asks — the page, its data, the event stream, the agents'
    // API, the MCP server's file
    if (this.hostNames && !hostAllowed(req.headers.host, this.hostNames)) return this.refuseHost(req, res, path);
    // every route; whatever one throws, handle() answers
    {
      // an agent's own token (server/tokens.ts) lets it into its API alone: the page and the page's
      // API answer it as they answer an outsider. A token that ended says so, to whoever held it.
      const bearer = bearerOf(req.headers.authorization);
      if (bearer && looksLikeToken(bearer)) {
        const t = live.tokens.check(bearer);
        if (!t) return sendJson(res, this.access ? { error: "not found" } : { error: "This token is not one of this server's.", hint: "Check that it was copied whole (vpa_…), or ask the person who shared with you for a new one." }, this.access ? 404 : 401);
        if ("ended" in t)
          return sendJson(res, {
            error: t.ended === "revoked" ? `This token was revoked by ${t.record.revokedBy} at ${t.record.revoked}.` : `This token expired at ${t.record.expires}.`,
            hint: "Ask the person who shared with you for a new one (Share, then AI agent, in the page).",
          }, 401);
        if (path !== "/api/agent" && !path.startsWith("/api/agent/")) return sendJson(res, { error: "not found" }, 404);
        return this.agent(req, res, url, t.ok);
      }
      // a personal link (CollabSpec decision 9, server/invites.ts): it lets its holder in, as who
      // it says, and its cookie does from then on; a revoked one's cookie is forgotten, and lets
      // nobody in
      if (path.startsWith(INVITE_PATH)) return this.enter(req, res, path.slice(INVITE_PATH.length), path);
      // a read-only link (CollabSpec decision 11, server/readonly.ts): its cookie lets its holder
      // read, where nothing else lets them in
      if (path.startsWith(READONLY_PATH)) return this.enterReadOnly(req, res, path.slice(READONLY_PATH.length), path);
      const link = this.ids.link(req);
      const cookies: string[] = link && "ended" in link ? [live.invites.forget()] : [];
      const ro = this.access && !this.ids.header ? live.readOnly.ofCookie(req.headers.cookie) : null;
      if (ro && "ended" in ro) cookies.push(live.readOnly.forget());
      if (this.access) {
        const a = link && "ok" in link && !path.startsWith(KEY_PATH) ? "in" : this.access.admit(req, path);
        if (a === "out") {
          // nothing lets them in to write: their read-only link does, or --public, to read
          const reader = ro && "ok" in ro ? ro.ok.id : this.publicRead && !this.ids.header ? "public" : null;
          // a page whose link was revoked, which nothing else lets in, is told so (CollabSpec
          // decisions 9 and 11): its requests are answered 410 with who revoked it and when, and the
          // page, reloaded, says the link no longer opens the site (decision 7: to a browser, the
          // page of a link that does not, which names nobody); the cookie is forgotten there, once
          // it has been said
          const revoked = reader === null && this.ids.kind(req) !== "agent" ? (link && "ended" in link ? endedWords(link) : ro && "ended" in ro ? revokedWords(ro.link, "read-only") : null) : null;
          if (revoked) {
            if (asksForPage(req, path)) {
              res.setHeader("set-cookie", cookies);
              return sendAccessPage(res, "link");
            }
            if (path === "/" || path === "/index.html") {
              res.setHeader("set-cookie", cookies);
              return sendText(req, res, revoked + "\n", "text/plain; charset=utf-8", 410);
            }
            return sendJson(res, { error: revoked, revoked: true }, 410);
          }
          // nothing lets them in: a browser asking for a page is told the site is private, or that
          // its link (`/k/…`, a key replaced) does not open it (CollabSpec decision 7, the owner's
          // decision of 2026-10-18); anything else is answered as if there were nothing here
          if (reader === null || this.ids.kind(req) === "agent") {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            if (asksForPage(req, path)) return sendAccessPage(res, path.startsWith(KEY_PATH) ? "link" : "private");
            return sendJson(res, { error: "not found" }, 404);
          }
          // a link of the key's that is not the key, opened where the address, or a read-only link,
          // lets them read: the page of a link that does not open the site, which says whether the
          // address alone does (--public)
          if (path.startsWith(KEY_PATH) && asksForPage(req, path)) {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            return sendAccessPage(res, "link", this.publicRead);
          }
          this.readOnlyOf.set(req, reader);
          // the page renews a read-only link's cookie, as a personal link's
          if (reader !== "public" && (path === "/" || path === "/index.html")) cookies.push(live.readOnly.cookie(reader));
          // what a read-only reader may ask; the rest is refused, whatever the page sends
          if (!readOnlyAllows(req.method ?? "GET", path)) {
            if (cookies.length) res.setHeader("set-cookie", cookies);
            return sendJson(res, { error: "This page is read-only: it changes nothing that is shared.", readOnly: true }, 403);
          }
        } else if (a !== "in") {
          // the link: the browser keeps the cookie, and the key leaves the address (a fragment
          // after the key, a place in the page, comes along to "/")
          res.writeHead(303, { location: "/", "set-cookie": [a.enter, ...cookies], "cache-control": "no-store", "referrer-policy": "no-referrer" });
          return void res.end();
        } else {
          // let in by the cookie every server used to share: the browser is given this one's own
          const renew = this.access.renewal(req);
          if (renew) cookies.push(renew);
        }
      }
      // the page renews a personal link's cookie: its holder stays in as long as they come back
      if (link && "ok" in link && (path === "/" || path === "/index.html")) cookies.push(live.invites.cookie(link.ok));
      if (cookies.length) res.setHeader("set-cookie", cookies);
      if (path === "/" || path === "/index.html") return sendFile(req, res, join(WEB, "index.html"));
      if (path === "/style.css") return sendFile(req, res, join(WEB, "style.css"));
      // the fonts an artwork is drawn in (ExportSpec decision 19)
      if (FONT_PATH.test(path)) return sendFile(req, res, join(WEBFONTS, path.slice("/fonts/".length)));
      // the tips' clips and their key frames (GuideSpec decision 6), and which there are
      if (path === "/tips/index.json") return sendJson(res, { clips: tipClips() });
      // the tour film, fetched by this server on its first play and kept checked in the cache
      // (server/film.ts, UpdateSpec decision 14): else 503 while it comes, or 404, and the page shows
      // its stills and captions; and its captions as WebVTT, for assistive technology
      if (path === "/tips/tour.mp4" && !refused.has(res)) return void serveFilm(req, res, sendMedia);
      if (path === "/tips/tour.en.vtt") {
        const vtt = tourVtt(tourData());
        if (vtt === null) return sendJson(res, { error: "no captions" }, 404);
        res.writeHead(200, { "content-type": "text/vtt; charset=utf-8", "cache-control": "no-cache" });
        return void res.end(vtt);
      }
      if (TIP_PATH.test(path) && !refused.has(res)) return sendMedia(req, res, join(TIPS_DIR, path.slice("/tips/".length)));
      // the page, and its workers: the one that lays out the Time Machine's past graphs
      // (web/src/layoutworker.ts), the one that chooses the overview's edges (web/src/edgeworker.ts),
      // and pdf.js's, which reads the library's PDFs for the reference window (AttachmentSpec decision 11)
      if (/^\/(app|layout|edges|pdfworker)\.js(\.map)?$/.test(path)) return sendFile(req, res, join(bundleDir(), path.slice(1)));
      if (path.startsWith("/pdfjs/")) return pdfjsAsset(res, path);
      // with Lean's language server as it is (server/hover.ts): what is open, what crashed
      // a read-only reader is told how the server is, not its log nor where its review is kept
      // `?brief`: the build status without its files, which the page reads by GET /api/build
      if (path === "/api/status") {
        const st: Record<string, unknown> = { ...(live.status(url.searchParams.has("brief")) as Record<string, unknown>), lean: this.hover.state() };
        if (this.readOnlyOf.get(req) !== undefined) {
          delete st.log;
          st.review = { ...(st.review as object), folder: undefined };
          // a branch's build log is not a read-only reader's (DeploySpec decision 11)
          if (st.deploy) st.deploy = slimDeploy(st.deploy as DeployStatus);
        }
        return sendJson(res, st);
      }
      // VisualProof's own version, and what of its releases those let in fully are told (UpdateSpec
      // decision 11): a read-only reader and an agent are told the version alone
      if (path === "/api/updates") return sendJson(res, this.updates?.status(this.toldAll(req)) ?? { running: packageVersion() });
      // the link that lets someone in, for a page that shares where it is (web/src/share.ts); a
      // request gets here only once it is in
      // a read-only reader shares the link they came by, or the address alone (--public)
      const reader = this.readOnlyOf.get(req);
      if (path === "/api/share") {
        if (reader !== undefined) return sendJson(res, { path: reader === "public" ? "/" : (live.readOnly.get(reader)?.path ?? null), readOnly: true });
        return sendJson(res, { path: this.access?.link ?? null, readOnlyLinks: !!this.access && !this.ids.header, public: this.publicRead });
      }
      if (path === "/api/share/readonly" || path.startsWith("/api/share/readonly/")) return this.shareReadOnly(req, res, url);
      if (path.startsWith("/api/share/agents")) return this.shareAgents(req, res, url);
      if (path === "/api/share/people" || path.startsWith("/api/share/people/")) return this.sharePeople(req, res, url);
      if (path === "/api/chat") return this.chat(req, res, url);
      if (path === "/api/chat/new") return this.chatNew(req, res);
      if (path === "/api/ask" || path === "/api/ask/answer") return this.ask(req, res, url);
      if (path === "/api/agent" || path.startsWith("/api/agent/")) return this.agent(req, res, url);
      // the views, each a shared board (ViewSpec.md)
      if (path === "/api/views" || path.startsWith("/api/views/")) return this.views(req, res, url);
      // the snapshots of the graph, one per build (HistorySpec.md): the Time Machine reads them; the
      // moves, the lost-and-found and its archive
      if (path === "/api/history" || path.startsWith("/api/history/")) {
        let body: unknown = null;
        if (req.method === "POST") {
          // a name's every entry archived at once is a few hundred keys at most
          const r = await this.json(req, 1 << 20);
          if (r.error !== undefined) return sendJson(res, { error: `The body is ${r.error}.` }, 400);
          body = r.body;
        }
        // a move, an archiving or a putting back is recorded as the review is: under the reader's
        // name — a private reader's too (CollabSpec decision 8) — with the personal link of someone
        // invited by one, whose moves go to their link's log (decision 9); by an agent at level full
        const person = this.ids.person(req)?.id;
        const a = await historyAnswer(live, { method: req.method ?? "GET", path, query: url.searchParams, body, caller: { name: this.ids.who(req), kind: this.ids.kind(req), ...(person ? { person } : {}) } }, (q) =>
          q.caller.kind === "agent" ? refusal(this.agents.level, "full") : null,
        );
        // a snapshot's graph in parts, as the Time Machine takes it: compressed once, and tagged
        if (a.gz) return sendGz(req, res, a.gz.body, a.gz.type);
        return sendJson(res, a.body, a.status, a.headers);
      }
      // the library of papers and images, and the links into them (AttachmentSpec.md,
      // server/libraryroute.ts)
      if (path === "/api/library" || path.startsWith("/api/library/")) {
        // a read-only reader (CollabSpec decision 11) is drawn what the notes show of a PDF, kept in
        // the cache as it is drawn, and no other page or region of one: each would be drawn by
        // Poppler and kept anew, whoever comes asking
        if (reader !== undefined && (path === "/api/library/page" || path === "/api/library/clip")) {
          const q = url.searchParams;
          const region = path === "/api/library/clip" ? (q.get("region") ?? "").split(",").map(Number) : null;
          if (!live.views.shows(q.get("sha") ?? "", Number(q.get("page")), region)) return sendJson(res, { error: "A read-only page is drawn what the notes show of the library: open the file itself.", readOnly: true }, 403);
        }
        return libraryRoute({ ids: this.ids, level: this.agents.level, api: this.library() }, req, res, url);
      }
      // an agent may use the page's own endpoints too: the same rules hold there (AgentSpec)
      const agent = this.ids.kind(req) === "agent";
      // the review (ReviewSpec.md): the whole of it, as a page takes it on, with the lines of its
      // logs that cannot be read; tagged with its revision, compressed once a revision
      if (path === "/api/review" && req.method === "GET") return sendRevision(req, res, live.review, live.review.tag(), () => live.review.wholeText());
      // the whole build status, tagged with its revision (the owner's decision of 2026-10-19): what
      // changes after comes by the event stream
      if (path === "/api/build" && req.method === "GET") {
        const b = live.buildWhole();
        return sendRevision(req, res, live, b.tag, () => b.text);
      }
      if (path === "/api/review" && req.method === "POST") {
        // an opinion, a target, a trusted prefix or a key declaration is recorded under the
        // reader's name (CollabSpec decision 3), not one in the body; what it is about is
        // bound by the server (server/reviewapi.ts)
        const me = this.ids.who(req);
        if (!me) return sendJson(res, this.nameless(req, "what you record in the review is recorded under your name"), 401);
        const person = this.ids.person(req)?.id ?? null;
        return this.json(req, 1 << 20).then(({ body, error }) => {
          if (error) return sendJson(res, { error: `The body is ${error}.` }, 400);
          // an agent records here what its level allows, as through its own API (AgentSpec decision
          // 9): an opinion as advice, the rest at full; in its own log, marked as an agent's
          const no = agent ? refusal(this.agents.level, needOf(body)) : null;
          if (no) return sendJson(res, no.body, no.status);
          // someone invited by a personal link writes to the log of their link (shared/review.ts)
          const a = this.agents.reviews.post(body, { name: me, agent, person });
          sendJson(res, a.body, a.status);
        });
      }
      if (path === "/api/export" || path.startsWith("/api/export/")) return this.export(req, res, url, agent, reader !== undefined);
      // who the reader is (CollabSpec decisions 3 and 9): the name their page gives, the proxy's, or
      // their personal link's — with the link, and whether the page's own name is a link holder's
      // and not theirs; a link revoked says by whom, one made anew since this browser had it, when
      if (path === "/api/identity" && req.method === "GET") {
        const person = this.ids.person(req);
        const holder = this.ids.taken(req);
        const ended = link && "ended" in link ? link : null;
        if (reader !== undefined) return sendJson(res, { mode: this.ids.mode, name: null, readOnly: { by: reader === "public" ? "public" : "link" } });
        return sendJson(res, {
          mode: this.ids.mode,
          name: this.ids.who(req),
          ...(person ? { person: Invites.info(person) } : {}),
          ...(holder ? { taken: taken(holder) } : {}),
          ...(ended?.ended === "revoked" ? { revoked: { by: ended.record.revokedBy, at: ended.record.revoked, name: ended.record.name } } : {}),
          ...(ended?.ended === "replaced" ? { replaced: { at: ended.at, name: ended.record.name } } : {}),
        });
      }
      if (path === "/api/identity" && req.method === "POST") return this.identity(req, res);
      // where a reader is: the others see it (CollabSpec decision 4); of a private reader, only that
      // they are here (decision 8)
      if (path === "/api/presence" && req.method === "POST") {
        const r = await this.json(req, 16384);
        if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
        const b = (r.body ?? {}) as { token?: unknown; view?: unknown; idle?: unknown; private?: unknown };
        // an agent is one entry by its name (server/presence.ts), never private; a page speaks for
        // its own event stream only, by the secret the stream was given (`hello`)
        const name = this.ids.who(req);
        const priv = !agent && b.private === true;
        // agents have no artwork (ExportSpec decision 19): the page draws it
        if (agent && name) live.presence.agentBeat(name, withoutArtwork(cleanView(b.view)));
        else if (!live.beat(b.token, priv ? null : name, priv ? null : cleanView(b.view), !priv && b.idle === true, priv, !!this.ids.person(req), name))
          return sendJson(res, { error: "This heartbeat is not from an open event stream of this page's: it is sent with the token the stream says hello with.", stream: false }, 403);
        return sendJson(res, { ok: true });
      }
      if (path === "/api/events") {
        const session = url.searchParams.get("session");
        // `build=delta`: the page takes the build status as changes (a page of 0.6.0 or later)
        return live.subscribe(res, validSession(session) ? session : null, this.ids.person(req)?.id ?? null, reader ?? null, this.toldAll(req), url.searchParams.get("build") === "delta", this.ids.who(req));
      }
      // what happened (CollabSpec decision 5): what the server stored; the review's own history the
      // page reads from the review
      if (path === "/api/activity") {
        const events = live.timeline.events.slice(-2000);
        return sendJson(res, { events: this.toldAll(req) ? events : events.map(withoutReasons) });
      }
      // a layout batch an agent made, undone (AgentSpec decision 4): from a page's Activity, by anyone;
      // by a private reader, without their name (CollabSpec decision 8)
      if (path === "/api/layout/undo" && req.method === "POST") {
        const priv = this.ids.privateOf(req) !== null;
        const me = layoutAuthor({ name: this.ids.who(req), private: priv });
        if (!me && !priv) return sendJson(res, { error: "Say who you are first.", who: true }, 401);
        const no = agent ? refusal(this.agents.level, "full") : null;
        if (no) return sendJson(res, no.body, no.status);
        const r = await this.json(req, 4096);
        if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
        const a = this.agents.undo(me, agent, (r.body as { id?: unknown } | null)?.id);
        return sendJson(res, a.body, a.status);
      }
      // the project's git source and commit as git says them now, not as the build was read (an
      // artwork's foot, ExportSpec decision 19; the owner's decision of 2026-10-15)
      if (path === "/api/git") {
        // following a branch, the commit of the build on show, on that branch: what is checked out
        // meanwhile is the build going on (DeploySpec decision 12)
        const shown = live.shownCommit();
        if (shown !== undefined) return sendJson(res, { git: shown && { source: live.deploy!.status(false).source, commit: shown.hash, branch: shown.branch } });
        if (!this.gitRead || Date.now() - this.gitRead.at >= this.gitFreshMs) this.gitRead = { git: gitSource(live.project.root), at: Date.now() };
        return sendJson(res, { git: this.gitRead.git });
      }
      if (path === "/api/meta" || path === "/api/edges") {
        const g = live.graph;
        if (!g) return sendJson(res, { error: "not ready" }, 503);
        // a page asks for the version it was told about; an older one is gone
        const want = url.searchParams.get("v");
        // of this server's: one restarted since counts its versions again (UpdateSpec decision 8)
        const of = url.searchParams.get("i");
        if ((want && Number(want) !== g.version) || (of && of !== live.instance)) return sendJson(res, { error: "superseded", version: g.version, instance: live.instance }, 409);
        // a page asks for the edges packed (shared/edgecodec.ts; `pack=2` with the grammar site, a
        // page from before it `pack=1`, which takes grammar for a proof); an agent gets them as they
        // are
        const pack = url.searchParams.get("pack");
        return path === "/api/meta"
          ? sendGz(req, res, g.prep.metaGz, "application/json")
          : sendGz(req, res, pack === "1" || pack === "2" ? packedGz(g.prep.edgesGz, pack === "1" ? 1 : 2) : g.prep.edgesGz, "application/octet-stream");
      }
      if (path === "/api/hover" || path === "/api/hover/open" || path === "/api/hover/names" || path === "/api/hover/describe" || path === "/api/hover/print") {
        // what Lean says is at a position of a project file (server/hover.ts). Only the graph's
        // modules (meta.modules) reach Lean: the module names the file the graph was read from, so
        // no path from the client reaches the disk, and no other file in the project's folder — an
        // old copy, a CI script — is ever elaborated or imported
        if (!live.graph) return sendJson(res, { error: "not ready" }, 503);
        const mod = url.searchParams.get("module") ?? "";
        const rel = live.moduleFile(mod);
        if (rel === undefined) return sendJson(res, { error: `${mod.slice(0, 300)} is not a module of the graph` }, 404);
        // a read-only reader (CollabSpec decision 11) is answered what Lean already said of this
        // build, else asks it within bounds, per address and in all
        const keyOf = reader !== undefined && req.method === "GET" ? `${live.graph.fingerprint}\0${path}\0${url.search}` : null;
        const kept = keyOf ? this.bounds.answer(keyOf) : undefined;
        if (kept !== undefined) return sendJson(res, kept);
        if (reader !== undefined) {
          const wait = this.bounds.leanWait(req.socket.remoteAddress ?? "");
          if (wait) return sendJson(res, { error: "Lean is asked too often from here: try again in a moment.", retryAfter: wait }, 429, { "retry-after": String(wait) });
        }
        const reply = (body: unknown) => {
          if (keyOf && finalAnswer(body)) this.bounds.keep(keyOf, body);
          return sendJson(res, body);
        };
        if (path === "/api/hover/describe") {
          // a declaration by name, where the module on show is imported: what a name in a hover card
          // shows. The name is checked to be a name before it is written into Lean source.
          const name = url.searchParams.get("name") ?? "";
          if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
          return reply(await this.hover.describe(mod, name, 6000));
        }
        if (path === "/api/hover/print") {
          // what Lean's #print says of a declaration it generated from a command, which has no text
          // of its own (the source window, under the command that made it, when asked)
          const name = url.searchParams.get("name") ?? "";
          if (!isDeclName(name)) return sendJson(res, { error: "not a name" }, 400);
          return reply(await this.hover.print(mod, name, false, 6000));
        }
        if (rel === null) return sendJson(res, { error: `no source for ${mod}` }, 404);
        const text = readFileSync(join(live.project.root, rel), "utf8");
        const hash = lakeTextHash(text);
        if (path === "/api/hover/open") {
          try {
            await this.hover.open(rel, text, hash);
            return sendJson(res, { ok: true });
          } catch (e) {
            return sendJson(res, { error: this.hover.failure ?? (e instanceof Error ? e.message : String(e)) });
          }
        }
        // the page shows another text than there is now: it reads the source again first
        const want = url.searchParams.get("hash");
        if (want && want !== hash) return sendJson(res, { stale: true });
        if (path === "/api/hover/names") {
          // the positions of the names in a declaration's source, as JSON [[line, character], …]
          const r = await this.json(req, 1 << 20);
          if (r.error !== undefined) return sendJson(res, { error: r.error }, 400);
          const ps = r.body;
          const ok = Array.isArray(ps) && ps.length <= 5000 && ps.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => Number.isInteger(x) && x >= 0));
          if (!ok) return sendJson(res, { error: "positions" }, 400);
          return sendJson(res, await this.hover.names(rel, text, hash, ps as [number, number][], 8000));
        }
        const line = Number(url.searchParams.get("line")), character = Number(url.searchParams.get("character"));
        if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) return sendJson(res, { error: "position" }, 400);
        return reply(await this.hover.hover(rel, text, hash, line, character, 6000));
      }
      if (path === "/api/source") {
        // only the graph's modules, from the file the graph was read from: no path from the client
        // ever reaches the disk, and no file outside the graph is served
        if (!live.graph) return sendJson(res, { error: "not ready" }, 503);
        const mod = url.searchParams.get("module") ?? "";
        const rel = live.moduleFile(mod);
        if (!rel) return sendJson(res, { error: `no source for ${mod.slice(0, 300)}: it is not a module of the graph` }, 404);
        const text = readFileSync(join(live.project.root, rel), "utf8");
        const hash = lakeTextHash(text);
        // the usage pass's contexts of the module (shared/context.ts), when this is the text it
        // elaborated
        const contexts = live.contextsOf(mod);
        // the hash says whether this is the text the graph was read from (meta.modules[].compiled)
        return sendJson(res, { module: mod, file: rel, text, hash, ...(contexts && contexts.hash === hash ? { contexts } : {}) });
      }
      sendJson(res, { error: "not found" }, 404);
    }
  }
}

/** What a revoked link's holder is told, opening it or on a page it had opened. */
function revokedWords(r: { revokedBy?: string | null; revoked?: string | null }, kind: "personal" | "read-only"): string {
  return `This ${kind} link was revoked by ${r.revokedBy} on ${(r.revoked ?? "").slice(0, 10)}. Ask whoever ${kind === "personal" ? "invited you" : "gave it to you"} for a new one.`;
}

/** What a personal link that lets nobody in any more is told (410): revoked, by whom and when, or
 *  made anew by its holder, and when (CollabSpec decision 9). */
function endedWords(c: Extract<InviteCheck, { ended: unknown }>): string {
  if (c.ended === "revoked") return revokedWords(c.record, "personal");
  return `This personal link was made anew on ${c.at.slice(0, 10)}: it lets nobody in any more. Open the new one instead (My personal link, in the menu under your name where it was made anew).`;
}

/** an artwork's font file (assets/webfonts/) */
const FONT_PATH = /^\/fonts\/(source-sans-3|source-serif-4|jost)-[a-z-]+\.woff2$/;

const TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
};

// Pages are often far from the server (CollabSpec, "Far pages"): every byte counts, and what a
// browser has it should not fetch again. The page's files and the graph are sent compressed, with
// a tag naming their content; a browser that has that content already is told so (304) and sends
// nothing more. Everything else in JSON is compressed when it is large.

/** The tag naming a content. */
function tagOf(body: Buffer | Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/** Whether the request already has the content `etag` names. */
function fresh(req: IncomingMessage, etag: string): boolean {
  const have = req.headers["if-none-match"];
  return !!have && have.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

function acceptsGzip(req: IncomingMessage | undefined): boolean {
  return /\bgzip\b/.test(String(req?.headers["accept-encoding"] ?? ""));
}

/** the page's files as last read: compressed and tagged once per change on disk */
const files = new Map<string, { mtime: number; size: number; body: Buffer; gz: Buffer | null; etag: string }>();

function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  if (refused.has(res)) return;
  if (!existsSync(file)) return sendJson(res, { error: "not found" }, 404);
  const st = statSync(file);
  let f = files.get(file);
  if (!f || f.mtime !== st.mtimeMs || f.size !== st.size) {
    const body = readFileSync(file);
    f = { mtime: st.mtimeMs, size: st.size, body, gz: null, etag: tagOf(body) };
    files.set(file, f);
  }
  const head = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache", etag: f.etag, vary: "accept-encoding" };
  if (fresh(req, f.etag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  if (!acceptsGzip(req)) {
    res.writeHead(200, head);
    return void res.end(f.body);
  }
  f.gz ??= gzipSync(f.body, { level: 9 });
  res.writeHead(200, { ...head, "content-encoding": "gzip" });
  res.end(f.gz);
}

/** the most an agent's request body may be (docs/agent-api/requests.md: 1 MB) */
const AGENT_BODY = 1 << 20;
/** how long the rest of a body refused as too large is read before it is answered all the same,
 *  and the connection cut: long enough for a client to finish sending what it began, not for an
 *  endless body */
const TOO_LARGE_GRACE_MS = 2000;

class TooLarge extends Error {}

/** A request's body, refused (TooLarge) once it passes `limit` bytes: what comes after is not kept. */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    if (Number(req.headers["content-length"]) > limit) return fail(new TooLarge());
    req.on("data", (b: Buffer) => {
      if (size > limit) return;
      size += b.length;
      if (size > limit) {
        parts.length = 0;
        fail(new TooLarge());
      } else parts.push(b);
    });
    req.on("end", () => ok(Buffer.concat(parts).toString("utf8")));
    req.on("error", fail);
  });
}

/** Responses refused as too large and not answered yet (tooLarge): what the handler that asked for
 *  the body answers meanwhile is not sent. */
const refused = new WeakSet<ServerResponse>();

/** Answer 413 to a body too large and close the connection. The rest of the body is read and thrown
 *  away first, and the answer goes once it has all come: a connection closed while the client is
 *  still sending is reset on some systems (macOS), and the client never reads the answer. A client
 *  still sending after a short grace is answered all the same, and cut off. */
function tooLarge(req: IncomingMessage, res: ServerResponse, body: object): void {
  refused.add(res);
  let done = false;
  const answer = () => {
    if (done) return;
    done = true;
    refused.delete(res);
    sendJson(res, body, 413, { connection: "close" });
  };
  req.on("data", () => {});
  req.on("end", answer);
  req.resume();
  if (req.readableEnded) answer();
  setTimeout(() => {
    answer();
    setTimeout(() => req.socket.destroy(), 500).unref();
  }, TOO_LARGE_GRACE_MS).unref();
}

/** Send a JSON answer, once: a handler that answers after something else already did (a body too
 *  large, answered as it was read) is not heard. */
export function sendJson(res: ServerResponse, body: unknown, code = 200, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  sendJsonText(res, JSON.stringify(body), code, headers);
}

/** The same, of an answer written as JSON already. */
function sendJsonText(res: ServerResponse, text: string, code = 200, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  // a small answer is not worth compressing; a status with its build log, a source file, are; a
  // large one is compressed off the server's thread, which meanwhile answers others
  if (text.length > JSON_GZIP_FROM && acceptsGzip(res.req)) {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "content-encoding": "gzip", vary: "accept-encoding", ...headers });
    if (text.length < JSON_GZIP_AWAY_FROM) return void res.end(gzipSync(text));
    return void gzip(text, (e, gz) => (e ? res.destroy(e) : res.end(gz)));
  }
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(text);
}

/** what is sent whole under the tag of its revision, compressed, per what it is of (the review, the
 *  build status) */
const revisionGz = new WeakMap<object, { tag: string; gz: Promise<Buffer> }>();

/** A whole sent under the tag of its revision: the review (GET /api/review), tagged with its run and
 *  its revision (server/review.ts), and the build status (GET /api/build, server/live.ts). A page that
 *  has it is answered 304, which a reload is, and one that fell behind is sent it compressed — once a
 *  revision, off the server's thread when it is large, the same bytes for every page (a review of
 *  5,000 opinions on Sphere-Packing-Lean: 8.5 MB of JSON, 1.1 MB sent; the build status of
 *  NavierStokesAndEuler's 2,657 files: 362 KB, 42 KB sent). `of` is what it is of; `whole` writes it,
 *  asked only where it is sent. */
function sendRevision(req: IncomingMessage, res: ServerResponse, of: object, tag: string, whole: () => string): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  const head = { "content-type": "application/json", "cache-control": "private, no-cache", etag: tag, vary: "accept-encoding" };
  if (fresh(req, tag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  const text = whole();
  if (text.length <= JSON_GZIP_FROM || !acceptsGzip(req)) {
    res.writeHead(200, head);
    return void res.end(text);
  }
  let c = revisionGz.get(of);
  if (c?.tag !== tag) {
    const gz = text.length < JSON_GZIP_AWAY_FROM ? Promise.resolve(gzipSync(text)) : new Promise<Buffer>((ok, fail) => gzip(text, (e, b) => (e ? fail(e) : ok(b))));
    revisionGz.set(of, (c = { tag, gz }));
    // a compression that failed is tried again by the next page that asks
    gz.catch(() => revisionGz.get(of)?.gz === gz && revisionGz.delete(of));
  }
  c.gz.then(
    (gz) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(200, { ...head, "content-encoding": "gzip" });
      res.end(gz);
    },
    (e: Error) => res.destroy(e),
  );
}

/** Send a text that is not JSON (the agents' documentation, the MCP server's file), compressed
 *  where the client takes it. */
function sendText(req: IncomingMessage, res: ServerResponse, text: string, type: string, code = 200): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  const head = { "content-type": type, "cache-control": "no-store", vary: "accept-encoding" };
  if (text.length > JSON_GZIP_FROM && acceptsGzip(req)) {
    res.writeHead(code, { ...head, "content-encoding": "gzip" });
    return void res.end(gzipSync(text));
  }
  res.writeHead(code, head);
  res.end(text);
}

/** Send a file to download (a typeset document): as it is, never cached, named for the disk. */
function sendDownload(res: ServerResponse, f: ExportFile): void {
  if (res.headersSent || res.writableEnded || refused.has(res)) return;
  res.writeHead(200, { "content-type": f.type, "content-length": String(f.body.length), "content-disposition": `attachment; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "cache-control": "no-store" });
  res.end(f.body);
}

/** The Host a request was sent to, when it looks like one. */
function hostOf(req: IncomingMessage): string {
  return /^[A-Za-z0-9.:[\]-]{1,300}$/.test(req.headers.host ?? "") ? req.headers.host! : "127.0.0.1";
}

/** The server's address as the request's browser reached it: its Origin where it names the host
 *  the request was sent to (a page's POST carries it, with the scheme), else http:// and the Host. */
export function reachedAt(req: IncomingMessage): string {
  const host = hostOf(req);
  try {
    const o = new URL(String(req.headers.origin ?? ""));
    if (o.host === host && (o.protocol === "http:" || o.protocol === "https:")) return o.origin;
  } catch {
    // no Origin, or not an address: the Host
  }
  return `http://${host}`;
}

/** characters from which a JSON answer is sent compressed */
const JSON_GZIP_FROM = 2048;
/** characters from which a JSON answer is compressed off the server's thread: a snapshot's whole
 *  graph on NavierStokesAndEuler (GET /api/agent/history/graph, 105 MB of JSON) was 2 to 3 s of
 *  compressing, every page and agent waiting meanwhile */
export const JSON_GZIP_AWAY_FROM = 1 << 20;

/** the graph's parts as sent, each tagged once (a graph's buffers live as long as it does) */
const gzTags = new WeakMap<Buffer, string>();

/** A part of the graph, gzipped already: tagged, so that a page that has it gets 304; a client that
 *  does not take gzip (an agent's) is sent it as it is, made so off the server's thread. */
function sendGz(req: IncomingMessage, res: ServerResponse, gz: Buffer, type: string): void {
  if (refused.has(res)) return;
  let etag = gzTags.get(gz);
  if (!etag) gzTags.set(gz, (etag = tagOf(gz)));
  const head = { "content-type": type, "cache-control": "private, no-cache", etag, vary: "accept-encoding" };
  if (fresh(req, etag)) {
    res.writeHead(304, head);
    return void res.end();
  }
  if (!acceptsGzip(req))
    return void gunzip(gz, (e, plain) => {
      if (e) return res.destroy(e);
      res.writeHead(200, head);
      res.end(plain);
    });
  res.writeHead(200, { ...head, "content-encoding": "gzip" });
  res.end(gz);
}

/** the edges packed for pages (shared/edgecodec.ts), once per graph and format */
const packedEdges = new WeakMap<Buffer, Map<number, Buffer>>();

function packedGz(edgesGz: Buffer, format: 1 | 2): Buffer {
  let byFormat = packedEdges.get(edgesGz);
  if (!byFormat) packedEdges.set(edgesGz, (byFormat = new Map()));
  let p = byFormat.get(format);
  if (!p) {
    const raw = gunzipSync(edgesGz);
    const edges = new Int32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    let n = 0;
    for (let k = 0; k < edges.length; k += 3) n = Math.max(n, edges[k] + 1, edges[k + 1] + 1);
    p = gzipSync(packEdges(edges, n, format), { level: 9 });
    byFormat.set(format, p);
  }
  return p;
}

/** What a stop signal does to a server: end it at once, until it can stop gracefully (serve). */
let stopNow: () => void = () => process.exit(0);

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  // an installed package's server runs under the supervisor, which stays while it restarts into
  // another version (UpdateSpec decision 5); `--updates off`, and a checkout, run it as they are
  if (o.cmd === "serve" && FROM_PACKAGE && o.updates !== "off" && process.env.VISUALPROOF_SUPERVISED !== "1") {
    const site = o.remote ? deploySiteOf(o) : projectDirs(resolve(o.path), o.site, o.cache).site;
    process.exit(await supervise({ installedRoot: PACKAGE_ROOT, cacheRoot: o.cache ? resolve(o.cache) : cacheHome(), argv: process.argv.slice(2), site, mode: o.updates }));
  }
  // a stop asked before the server can stop gracefully (it reads the project, takes the site) ends
  // it at once, with status 0; once it can, the graceful stop does (`stopNow`, below)
  if (o.cmd === "serve") for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => stopNow());
  if (o.cmd === "doctor") {
    const report = doctor({ path: o.path || null, roots: o.roots, site: o.site, cache: o.cache });
    console.log(printReport(report, o.path || null));
    process.exit(report.checks.some((c) => c.level === "fail") ? 1 : 0);
  }
  // a live server outlives any one failed task: log it and keep serving (a picture is no server:
  // whatever fails ends it, with status 1)
  if (o.cmd !== "artwork") process.on("unhandledRejection", (e) => console.error("unhandled:", e instanceof Error ? e.message : e));
  // following a branch (DeploySpec): its clone in the cache, made at the first start, is the project
  const deploy = o.remote ? await openDeployment(o) : null;
  if (o.remote && !deploy) return;
  let project: Project;
  try {
    // a branch's clone is read before its build: the server builds it
    project = openProject(deploy ? deploy.folder.checkout : o.path, o.roots, !deploy && o.graph === null);
  } catch (e) {
    if (e instanceof ProjectError) {
      console.error(`visualproof: ${deploy ? `${deploy.branch} of ${deploy.remote.source ?? deploy.remote.url}, at ${shortCommit(deploy.head)}: ` : ""}${e.message}`);
      return endNotTheCode(1);
    }
    throw e;
  }
  // a picture: the site read, never made, locked or written (ExportSpec decision 21)
  if (o.cmd === "artwork") return artworkCommand(project, o);
  // a branch's site is the address's and the branch's, wherever the cache is
  const dirs = { ...projectDirs(project.root, o.site, o.cache), ...(deploy && o.site === null ? { site: deploySite(deploy.remote, deploy.branch) } : {}) };
  openSite(dirs.site);
  mkdirSync(dirs.cache, { recursive: true });
  // one server at a time writes a site; an export only reads it
  if (o.cmd !== "export") {
    try {
      const release = lockSite(dirs.site);
      process.on("exit", release);
    } catch (e) {
      if (!(e instanceof SiteBusy)) throw e;
      console.error(`visualproof: ${e.message}`);
      return endNotTheCode(1);
    }
  }
  useBundleDir(bundleDirIn(o.cache ? resolve(o.cache) : cacheHome()));

  if (o.cmd === "purge-file") {
    // the owner's alone, from the command line (AttachmentSpec decision 3): the bytes and what was
    // read of them go; the record and the links stay in the review's logs, which are never rewritten
    const lib = new Library(dirs.site, dirs.cache);
    console.log(lib.purge(o.sha!) ? `purged ${o.sha} from ${lib.dir}` : `${lib.dir} holds no file ${o.sha}`);
    return;
  }
  await ensureBundle();

  if (o.cmd === "export") {
    try {
      const log = (l: string) => console.log(l);
      // a snapshot carries the usage pass's findings: run here, as far as the cache does not hold them
      let ex = o.graph ? undefined : await extract(project, dirs, log);
      if (ex && o.jobs > 0) {
        const pass = new UsagePass(project, dirs, o.jobs, log);
        const plan = pass.plan(ex.graph);
        if (plan.todo.length) log(`usage pass: elaborating ${plan.todo.length} of ${plan.modules.length} modules, ${o.jobs} at a time`);
        const results = await pass.run(plan);
        if (results) {
          ex = mergeUsage(ex, plan, results, pass.status.failed, pass.status.ms ?? 0);
          saveMerged(dirs.cache, ex);
          for (const f of pass.status.failed) log(`usage pass: ${f.module}: ${f.error}`);
        }
      }
      const prep = await prepare(project, dirs, o.graph, log, ex ? { extraction: ex } : {});
      // the boards as they are kept: a snapshot carries them, frozen
      const views = new Views(dirs.site, LAYOUT_VERSION, () => {});
      const bytes = writeSnapshot(project, prep, o.out!, o.label, new ReviewStore(project.root, dirs.site).data, views.book);
      console.log(`wrote ${o.out} (${(bytes / 1e6).toFixed(1)} MB) — opens from disk, no server`);
    } catch (e) {
      console.error(`visualproof: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    return;
  }

  const review = new ReviewStore(project.root, dirs.site);
  const live = new Live(project, dirs, o.graph, review, o.editor, o.jobs);
  live.library.limit = o.libraryLimit;
  const hover = new LeanHover(project, dirs.cache);
  const ids = new Identities(o.identityHeader);
  let key: { key: string; made: boolean } | null = null;
  try {
    key = o.accessKeyFile ? loadKey(o.accessKeyFile) : null;
  } catch (e) {
    console.error(`visualproof: --access-key-file: ${e instanceof Error ? e.message : String(e)}`);
    return endNotTheCode(2);
  }
  process.on("exit", () => {
    hover.stop();
    // the usage pass's workers end with the server
    live.usage.cancel();
    // when tokens and personal links were last used is written now, not at the next minute
    live.tokens.close();
    live.invites.close();
    live.readOnly.close();
  });
  // the branch followed: asked every --poll minutes, each new head built in turn (DeploySpec)
  const deployment = deploy
    ? new Deployment({
        remote: deploy.remote,
        branch: deploy.branch,
        folder: deploy.folder,
        project,
        roots: o.roots,
        everyMs: (o.poll ?? DEFAULT_POLL_MINUTES) * 60_000,
        buildMs: (o.buildHours ?? DEFAULT_BUILD_HOURS) * 3600_000,
        mathlibCache: o.mathlibCache ?? "shared",
        head: deploy.head,
        hooks: {
          reading: () => live.reading,
          // the usage pass of the build before is cut short: what it finished is kept
          starting: () => live.usage.cancel(),
          toolchainChanged: () => hover.toolchainChanged(),
          // the pages are told at the live loop's next look, within a second
          changed: () => live.lookSoon(),
          log: (l) => live.say(l),
          ended: () => live.reread(),
        },
      })
    : null;
  live.deploy = deployment;
  const exporter = new Exporter(dirs.cache);
  const app = new App(live, hover, ids, new AgentApi(live, hover, o.agents), key ? new Access(key.key) : null, exporter, o.publicUrl, o.publicRead, o.allowedHosts);
  const server = createServer((req, res) => app.handle(req, res));
  const version = packageVersion();
  // run by the supervisor, which starts it again in another version (UpdateSpec decision 5)
  const supervised = typeof process.send === "function" && process.env.VISUALPROOF_SUPERVISED === "1";
  /** Stop (UpdateSpec decision 9): no new requests, the pages told why and their streams ended, the
   *  programs the server runs stopped, then the process ends: status 0, or RESTART_STATUS for the
   *  supervisor to start it again in another version. A second signal meanwhile changes nothing;
   *  whatever still waits, it ends within 5 s. */
  let stopping = false;
  /** the status the process ends with: a stop asked during a restart makes it a stop (0), so that
   *  the supervisor does not start it again */
  let exitStatus = 0;
  const stop = (status: number, why: { update: { from: string; to: string } } | { stopped: true }) => {
    if (stopping) {
      if ("stopped" in why) exitStatus = 0;
      return;
    }
    stopping = true;
    exitStatus = status;
    updates.stop();
    // a build going on is stopped with the programs, and done again at the next start
    deployment?.stop();
    server.close();
    live.end(why);
    hover.stop();
    live.usage.cancel();
    server.closeIdleConnections();
    setTimeout(() => process.exit(exitStatus), 5000);
    void stopChildren(2000).then(() => {
      server.closeAllConnections();
      process.exit(exitStatus);
    });
  };
  const cacheRoot = o.cache ? resolve(o.cache) : cacheHome();
  const updates = new Updates({
    mode: o.updates,
    cacheRoot,
    canRestart: supervised && FROM_PACKAGE,
    check: FROM_PACKAGE,
    checkout: !FROM_PACKAGE,
    // nobody on a page, nothing running that a restart would cut short (UpdateSpec decision 6)
    quiet: () => live.pages === 0 && !live.busy && !exporter.busy,
    restart: (to) => {
      process.send?.({ vp: "restart", to });
      stop(RESTART_STATUS, { update: { from: version, to } });
    },
    // the server's console alone: the log pages read (GET /api/status) is no place for paths and
    // commands of this machine
    log: (l) => console.log(l),
    changed: () => live.updatesChanged(),
    running: version,
    // the supervisor's word, believed only from it
    installedRoot: (supervised && process.env.VISUALPROOF_INSTALLED) || PACKAGE_ROOT,
    site: dirs.site,
    // what the supervisor set aside without a record of it (a full disk), believed only from it
    also: new Set(supervised ? unrecordedOf(process.env.VISUALPROOF_UNRECORDED) : []),
    film: () => filmStatus(),
  });
  // the tips' tour film, fetched on its first play (UpdateSpec decision 14; never under --updates off)
  useFilm({ cacheRoot, mode: o.updates, log: (l) => console.log(l) });
  live.updateStatus = (full) => updates.status(full);
  app.updates = updates;
  stopNow = () => stop(0, { stopped: true });
  // the supervisor went: this server goes with it rather than serve on alone
  if (supervised) process.on("disconnect", () => stop(0, { stopped: true }));
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(`visualproof: ${e.code === "EADDRINUSE" ? `${o.host}:${o.port} is in use already: give --port another` : e.message}`);
    return endNotTheCode(1);
  });
  server.listen(o.port, o.host, () => {
    console.log(`VisualProof — ${project.name} (${targetsInWords(project)})`);
    console.log(`  http://${o.host}:${o.port}/`);
    console.log(`  site: ${dirs.site}${review.error ? ` — the review: ${review.error}` : ""}`);
    console.log(`  cache: ${dirs.cache}`);
    console.log(`  names: ${ids.header ? `from the ${ids.header} header` : "as each page gives them"}`);
    console.log(`  editor: ${o.editor ?? "no link unless a reader sets one"}`);
    console.log(`  agents: ${o.agents} — their API is http://${o.host}:${o.port}/api/agent`);
    console.log(`  usage pass: ${o.graph ? "none for a saved graph" : o.jobs > 0 ? `${o.jobs} module(s) at a time` : "off (--jobs 0)"}`);
    // what the pass's workers may hold on a project on Mathlib, against what the machine has
    const memory = o.graph || o.jobs <= 0 ? null : jobsAdvice(o.jobs, onMathlib(project.root));
    if (memory)
      console.log(
        `  memory: ${inGB(freemem())} available; on Mathlib the pass's workers may hold up to ${inGB(WORKER_PEAK)} each, ${inGB(memory.need)} at ${o.jobs}: ` +
          `--jobs ${memory.fits} if memory runs short (it starts fewer while less than ${inGB(memoryFloor())} is available)`,
      );
    console.log(
      `  access: ${key ? `by its link only, /k/<the key in ${o.accessKeyFile}>${key.made ? " (a new key was made there)" : ""}${o.publicRead ? "; anyone else read-only (--public)" : ""}` : `anyone who reaches the port, by its address, localhost${[...(o.publicUrl ? [urlHost(o.publicUrl)] : []), ...o.allowedHosts].map((n) => `, ${n}`).join("")} (other names are refused: --allowed-host)`}`,
    );
    console.log(`  version: ${version}; updates ${updatesInWords(o.updates, version, supervised)}`);
    if (deployment) {
      const d = deployment.status(true);
      console.log(`  following: ${d.branch} of ${d.source ?? deployment.remote.url}, asked every ${o.poll ?? DEFAULT_POLL_MINUTES} min; a build stopped past ${limitInWords(deployment.buildMs)}`);
      console.log(`  clone: ${deployment.folder.checkout}`);
      console.log(`  builds: ${d.built ? `the tree holds the build of ${shortCommit(d.built)}${deployment.holds() ? ", cut short: it is done again" : ""}` : `none yet: the first, of ${shortCommit(deploy!.head)}, starts now, and the page says so until it is done`}; their logs in ${deployment.folder.logs}`);
      // where the project is on Mathlib, its cache: the user's, or the deployment's own (DeploySpec decision 2)
      console.log(`  Mathlib's cache: ${o.mathlibCache === "own" ? `${deployment.folder.mathlib}, the deployment's own` : `${sharedMathlibCache()}, the user's, shared by their builds`}`);
    }
    recordVersion(live, version, supervised);
    process.send?.({ vp: "listening", version });
    updates.start();
  });
  live.start();
  deployment?.start();
}

/** The site a branch's server keeps, as the supervisor finds it (UpdateSpec decision 7): `--site`,
 *  else the address's and the branch's — the default branch as it was last asked, without the network;
 *  null at a first start without --branch, which the server alone resolves. */
function deploySiteOf(o: Options): string | null {
  if (o.site !== null) return resolve(o.site);
  const branch = o.branch ?? recordedDefault(o.cache ? resolve(o.cache) : cacheHome(), o.remote!.url);
  return branch ? deploySite(o.remote!, branch) : null;
}

/** A branch's deployment as the server starts (DeploySpec decisions 1–2): the branch (the remote's
 *  default where none is given), its folder in the cache taken for this server, its clone made at
 *  the first start. Null where it cannot be had: said, and the server ends, which is not its code. */
async function openDeployment(o: Options): Promise<{ remote: Remote; branch: string; folder: DeployFolder; head: string } | null> {
  const remote = o.remote!;
  const cacheRoot = o.cache ? resolve(o.cache) : cacheHome();
  const branch = await branchToFollow(remote, o.branch, cacheRoot);
  if (typeof branch !== "string") {
    console.error(`visualproof: ${remote.source ?? remote.url}: ${branch.error}`);
    endNotTheCode(1);
    return null;
  }
  const folder = deployFolder(cacheRoot, remote, branch);
  try {
    process.on("exit", lockDeployment(folder, remote, branch));
  } catch (e) {
    if (!(e instanceof DeployBusy)) throw e;
    console.error(`visualproof: ${e.message}`);
    endNotTheCode(1);
    return null;
  }
  const c = await ensureClone(remote, branch, folder, (l) => console.log(l));
  if ("error" in c) {
    console.error(`visualproof: ${c.error}`);
    endNotTheCode(1);
    return null;
  }
  return { remote, branch, folder, head: c.commit };
}

/** What the server does with its releases, for its first lines (UpdateSpec decisions 2–4, 13). */
function updatesInWords(mode: UpdateMode, version: string, supervised: boolean): string {
  if (mode === "off") return "off (--updates off): the registry is never asked";
  if (!FROM_PACKAGE) return "none from a checkout";
  const minor = version.split(".").slice(0, 2).join(".");
  if (mode === "notify") return `notify — newer versions told of, never downloaded${supervised ? "; one installed meanwhile is restarted into" : ""}`;
  return supervised ? `auto — a patch of ${minor} taken by itself at a quiet moment; a newer version told of` : "auto, but without the supervisor: newer versions told of";
}

/** The versions the supervisor says it set aside without a record (VISUALPROOF_UNRECORDED). */
function unrecordedOf(text: string | undefined): string[] {
  try {
    const v = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The version that serves the site, recorded in the timeline where it is another than the last one
 *  recorded (UpdateSpec decision 10), with what the supervisor set aside before this one started. */
function recordVersion(live: Live, version: string, supervised: boolean): void {
  let setAside: { version: string; why: string } | undefined;
  try {
    const raw = JSON.parse((supervised && process.env.VISUALPROOF_SET_ASIDE) || "null") as { version?: unknown; why?: unknown } | null;
    if (raw && typeof raw.version === "string" && typeof raw.why === "string") setAside = { version: raw.version, why: raw.why };
  } catch {
    // nothing set aside that can be read
  }
  const was = live.timeline.lastVersion() ?? live.history?.lastVersion() ?? null;
  if (was !== version || setAside) live.timeline.add({ kind: "tool", from: was, to: version, ...(setAside ? { setAside } : {}) });
}

/** End the server with `status`, the supervisor told first that what ends it is not its code (the
 *  site is busy, the port is taken, the project cannot be read): a patch that ends so is not set
 *  aside (UpdateSpec decision 7). The message is sent before the process ends, not lost with it. */
function endNotTheCode(status: number): void {
  process.exitCode = status;
  if (process.send) process.send({ vp: "environment" }, () => process.exit(status));
  else process.exit(status);
}

/** The artwork command (ExportSpec decision 21): the build read as an export reads it, the picture a
 *  recipe says made of it (server/artcmd.ts), its files written; what it named said as the agents'
 *  API says it; problems said, and exit status 1. */
async function artworkCommand(project: Project, o: Options): Promise<void> {
  const fail = (why: string): never => {
    console.error(`visualproof artwork: ${why}`);
    process.exit(1);
  };
  try {
    await artwork(project, o, fail);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function artwork(project: Project, o: Options, fail: (why: string) => never): Promise<void> {
  const dirs = projectDirs(project.root, o.site, o.cache);
  const site = o.site ? dirs.site : null;
  if (site && !existsSync(site)) fail(`there is no site at ${site}`);
  let recipe: unknown;
  try {
    recipe = JSON.parse(readFileSync(o.recipe!, "utf8"));
  } catch (e) {
    fail(`the recipe ${o.recipe} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  // -o: a name, or a path without its extension, in a folder that is there
  const outBase = o.out ? o.out.replace(/\.(png|svg)$/i, "") : null;
  const dir = outBase ? dirname(outBase) : process.cwd();
  if (!existsSync(dir)) fail(`there is no folder ${dir} to write the files in`);
  mkdirSync(dirs.cache, { recursive: true });
  const log = (l: string) => console.log(l);
  let ex = o.graph ? undefined : await extract(project, dirs, log);
  if (ex && o.jobs > 0) {
    const pass = new UsagePass(project, dirs, o.jobs, log);
    const plan = pass.plan(ex.graph);
    if (plan.todo.length) log(`usage pass: elaborating ${plan.todo.length} of ${plan.modules.length} modules, ${o.jobs} at a time`);
    const results = await pass.run(plan);
    if (results) {
      ex = mergeUsage(ex, plan, results, pass.status.failed, pass.status.ms ?? 0);
      saveMerged(dirs.cache, ex);
    }
  }
  // the site's layout memory read and never written, nor the views laid out written to the cache;
  // without a site, none read: the board as a new site lays it out
  const prep = await prepare(project, dirs, o.graph, log, { ...(ex ? { extraction: ex } : {}), readOnlySite: true, ...(site ? {} : { freshLayout: true }) });
  const kept = site ? readProjectView(site, LAYOUT_VERSION) : { view: null, notes: 0 };
  if (kept.why) console.error(`visualproof artwork: the site's views cannot be read (${kept.why}): the Project view as a new site has it`);
  const review = site ? new ReviewStore(project.root, site).data : null;
  const a = makeArtwork(prep, review, projectView(kept.view), { recipe, screen: o.screen, name: outBase ? basename(outBase) : null, root: project.root, projectNotes: kept.notes });
  if (!("svg" in a)) {
    for (const p of a.problems) console.error(`visualproof artwork: ${p}`);
    process.exit(1);
  }
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  console.log(`names written: ${list(a.names.written)}`);
  if (a.names.ruledSkipped.length) console.log(`names a rule chose, left out where they would cover another: ${list(a.names.ruledSkipped)}`);
  if (a.names.left) console.log(`names or targets left out for room: ${a.names.left}`);
  console.log(`targets marked: ${list(a.targets)}`);
  console.log(`selection: ${a.selection ? `${a.selection.mode} of ${a.selection.name}` : "none"}`);
  if (a.notesLeftOut) console.log(`notes: ${a.notesLeftOut} on the board, not drawn (the command draws no notes yet)`);
  const both = !o.png && !o.svg;
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  if (both || o.svg) {
    const file = join(dir, a.file("svg"));
    writeFileSync(file, a.svg);
    console.log(`wrote ${file} (${mb(Buffer.byteLength(a.svg))})`);
  }
  if (both || o.png) {
    const png = await pngOf(a.svg);
    const file = join(dir, a.file("png"));
    writeFileSync(file, png);
    console.log(`wrote ${file} (${mb(png.length)}, ${a.look.w} × ${a.look.h})`);
  }
}

// run as the command (`node src/server/main.ts`, the `visualproof` bin), not when a test imports App
if (import.meta.main) void main();
