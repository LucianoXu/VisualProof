// The command line, as server/main.ts reads it: each command's options, the usage `--help` prints,
// and what is checked before anything runs — what goes only with a git address, with a key or with
// a command, a branch's name, a template that cannot make a link — each said in a line, with status 2.

import { join, resolve } from "node:path";
import { AGENT_LEVELS } from "./agent.ts";
import type { AgentLevel } from "./agent.ts";
import { branchProblem, DEFAULT_BUILD_HOURS, DEFAULT_POLL_MINUTES, isGitAddress, MATHLIB_CACHES, MAX_BUILD_HOURS, MIN_BUILD_HOURS, MIN_POLL_MINUTES, parseBuildHours, parseRemote } from "./deploy.ts";
import type { MathlibCache, Remote } from "./deploy.ts";
import { cacheHome, dataHome } from "./dirs.ts";
import { packageVersion } from "./doctor.ts";
import { UPDATE_MODES } from "./updates.ts";
import type { UpdateMode } from "./updates.ts";
import { DEFAULT_JOBS } from "./usage.ts";
import { invalidTemplate } from "../shared/editor.ts";
import { DEFAULT_LIBRARY_LIMIT, validSha } from "../shared/library.ts";

export interface Options {
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
           (deploy/<repo>-<hash>/mathlib-cache/): about 0.45 GB, the version of Mathlib checked
           out alone (\`lake exe cache clean\` after each fetch), removed with that folder

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
           sends (a proxy in front): the links Share and Copy link make, and the prompt Share
           makes for an agent, carry it.

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

export function parseArgs(argv: string[]): Options {
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
