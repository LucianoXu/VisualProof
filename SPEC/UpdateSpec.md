# VisualProof Update Spec

How a running VisualProof follows its own releases, beyond SPEC.md ("Deployment": "Websites served by
this tool will check for updates periodically, and seamlessly update"): what it asks of the registry
and how often, which releases it takes by itself and which it only tells of, how it takes one
without losing anything, and how the open pages follow. Releases themselves, and what a release may
change: CONTRIBUTING.md, "Branches and releases".

## Decisions

The owner's decisions of 2026-10-16.

### Knowing of a release

1. **The registry is asked through npm**, npm's own script run by the Node that runs the server
   (`lib/node_modules/npm/bin/npm-cli.js` beside it; else `npm` on the PATH), in the versions'
   folder (no project's `.npmrc` applies), so that the user's registry, proxy and certificates hold
   as for any `npm install`: the versions of `visualproof` (`npm view visualproof versions`), and the
   Node range of the newest beyond the running one (`engines`, read as npm reads ranges; an empty
   one runs anywhere). Nothing of the project is sent. At start (half a minute after
   the server listens, unless it asked within the hour) and then once a day, with up to two hours
   more so that servers started together do not ask together. Releases only: never a release
   candidate (npm's `next`). A release whose Node range this Node does not meet is neither taken nor
   told of as one to install; the log says what it needs. What was found is kept in `updates.json`
   in the caches' root (`--cache`, not a project's cache), so that a restart knows it at once. A
   check that fails, however, leaves the next one a day on.
2. **Three modes**, `--updates auto|notify|off` (or `VISUALPROOF_UPDATES`), auto by default:
   - **auto** — a patch is taken by itself (decision 3), a newer minor told of (decision 4);
   - **notify** — any newer release is told of, with its command; nothing is downloaded;
   - **off** — the registry is never asked, and the server runs as it did before 0.4: one process,
     no supervisor (decision 5). For a machine kept offline.
3. **What is taken unattended is a patch**: a release of the minor the server runs (0.4.1 for 0.4.0;
   the owner's decision D1). Patches change no part of what is public — the command line, the site's
   form, the agents' API (CONTRIBUTING.md) — so a server takes one without anyone looking.
4. **A newer minor is told of, never taken** (the owner's decision D2): in 0.x a minor may change
   the command line or the site's form. The log says it as the check finds it; `visualproof doctor`
   and the help's About part say it, with the command that installs it where this one is installed
   (`npm install --global visualproof@0.5.0`, or `--prefix` the folder it was installed in) and its
   release notes. Once someone installs it, the server restarts into it by itself (decision 6).

### Taking a patch

5. **Side by side, under a supervisor.** A patch is downloaded into the caches' root,
   `versions/<v>/` (`npm install --prefix=… --ignore-scripts --omit=dev --no-package-lock`, into a
   folder of its own first: npm checks it against the registry's integrity), checked to run on this
   Node (its `engines`, then `--version` says `<v>`), and marked ready; the installed package is
   never written over. `visualproof serve` from an installed package is a small supervisor that runs
   the server as a child: the newest of the installed package and the ready patches of its minor
   that runs on this Node and is not set aside. It passes signals on and ends with the server's
   status, unless the server asks to be started again (decision 9).
   - `versions/` is shared by the user's servers: each marks the version it runs
     (`running-<pid>`), moves a download into place only where none is (another's copy is as
     good), and removes only versions of its own minor older than the one it would step back to
     that no living server runs, and the downloads of servers that died midway.
   - It is code the servers run: made `0700`; a folder another owns or others may write is
     refused (decision 12).
   - Not `npm install --global` from the server: it would write files under a running process,
     which reads some of them as it goes (the Lean programs' sources, the layout worker, the page),
     into a folder that may be root's, with no way back.
   - `visualproof --version` says the installed package; the server says, in its first lines and in
     its pages, the version it runs.
6. **At a quiet moment**: nobody on a page (read-only readers too) and nothing running that a
   restart would cut short — an extraction, a re-layout, the usage pass, a document being typeset.
   Looked for every minute. A patch waits a day at most, then is taken anyway, the pages following
   (decision 8). A package installed while the server runs (someone's `npm install`) waits ten
   minutes at most: its files are no longer the ones the server started with. A server restarts
   only into what the supervisor would run (the two read the same: the version, its engines, what
   is set aside), and not where the Node it runs on is gone (an upgrade removed it): it keeps
   running, and says why.
7. **A version that fails is set aside**: a patch that ends before it serves, or fails twice within
   ten minutes of serving, is recorded in `versions/bad.json` with why, and the version before it
   started again; a SIGKILL (the kernel's when memory runs out) never counts, the patch is started
   again. Where the version started after one was set aside fails as soon, the fault was not the
   first one's: it is taken back, and the supervisor ends with the status. One set aside is tried
   again a day later, and kept aside for good after its third failure. What ends a server that is
   not its code — the site held by another server, the port taken, the project unreadable — sets
   nothing aside. What is set aside, and why, is said in the log, by the doctor and to full readers
   (decision 11).

### The pages, and stopping

8. **Open pages follow their server.** A page is told which server answers as its event stream
   opens (`hello`: the version it runs and its process). A page of another version reloads where it
   is: the address, the camera and the browser's storage keep the view, the mode, the selection and
   the tabs, and the page keeps for the reload what it alone holds — its source windows, the drafts
   of comments and of messages to agents, a read-only reader's notes opened or collapsed. The reload
   waits while it would cut something short — text being typed, a drag, a note being written, the
   export window, the artwork mode, the linear form — the build pill offering it meanwhile
   ("Updated — reload", which reloads at once). The pages back from a restart reload each within
   five seconds, not all at once, and a tab reloads once for a version, whether or not its storage
   is refused. A page of the same version and another process (a restart) reads the graph again:
   graph versions are counted per process. While the server is away for a restart into another
   version, the pill says "Updating to 0.4.2…".
9. **Stopping is graceful**: on SIGINT, SIGTERM or SIGHUP the server takes no new request, tells
   each page why (`update` for a restart into another version, `bye` for a stop) and ends its
   stream, stops what it runs (Lean's language server, the usage pass's workers, the extractor, the
   Lean programs' build, XeLaTeX, ImageMagick, Poppler, git) — those that start programs of their
   own as a process group, with all they started — writes when tokens and links were last used, and
   lets the site go; within five seconds whatever still waits. Status 0 for a stop, 75 for a restart
   into another version; a stop asked during a restart is a stop (0). A child ended by a signal
   ends the supervisor with 128 + its number. A supervised server whose supervisor went stops too.

### The record, and who is told

10. **The version is part of the audit record.** The timeline records the VisualProof version that
    serves the site where it is another than the one recorded before ("Updated from 0.4.1 to
    0.4.2"; "VisualProof 0.4.0 serves the site" the first time), and a version set aside before it
    (decision 7); Activity shows it with the builds. Each snapshot of a build records the version
    that read it. A release that changes what the extractor makes of a build changes versions and
    stales opinions through what already does so, the update standing beside it in Activity.
11. **Who is told what**: `GET /api/updates` and the `updates` event give everything to those let
    in fully (the version running, the installed one where it is another, the mode, when the
    registry was last asked, a newer release: whether this server takes it, else the command, and
    its notes; the versions set aside, and why); a read-only reader and an agent are told the version
    alone, by one rule for both. The log of `GET /api/status`, and where the review is kept, are not
    a read-only reader's; the updates' own lines go to the server's console alone. The agents' API's
    entry names the version; the MCP server's file carries the version of the server it came from.
12. **What it trusts, and sends** (SECURITY.md): under auto, the npm registry and the package's
    publisher are trusted as at the first install, unattended: the registry's hash is checked, not
    provenance; dependencies are resolved again at each patch; the trust root is the release path
    (a tag on `main`, the `npm` environment the owner approves). The check sends npm's own requests
    and nothing of the project. `versions/` is code the servers run: the caches' root is kept the
    user's alone. `--updates off` for a machine that asks nothing of the network.
13. **Where none of it applies**: a checkout (`node src/server/main.ts`) never asks the registry
    and runs no supervisor — its updates are git's; nor do `export` and `artwork`; `--updates off`.
    0.3.0 has no updater: its servers are upgraded by hand to 0.4.0, the first that takes its
    patches.

## Implementation notes

- `server/updates.ts`: the versions (release only, newer, same minor; `choose`), npm (`npmPath`,
  `registryVersions`, `registryEngines`), the commands (`installCommand`, `notesOf`), the patches
  kept (`Versions`: `ready`, `bad`, `fetch`, `prune`), the code a supervisor runs (`codeToRun`), and
  `Updates`: the check and its timers, the download, the quiet moment (`look`), the status.
- `server/supervise.ts`: the supervisor. The child's environment says `VISUALPROOF_SUPERVISED=1`,
  `VISUALPROOF_INSTALLED` (the installed package it watches) and `VISUALPROOF_SET_ASIDE` (what was
  set aside before it); over IPC the child says `{vp: "listening", version}`, `{vp: "restart", to}`
  and `{vp: "environment"}` (what ends it is not its code). More than six starts in ten minutes,
  and it gives up.
- `server/children.ts`: the programs the server runs, tracked to be stopped; `grouped` (spawned
  detached, ended with `kill(-pid)`) for those that start programs of their own; `childEnv`, their
  environment without `VISUALPROOF_*`.
- The supervisor's variables are read only by a supervised server. `VISUALPROOF_UPDATE_TEST_MS`
  shortens every wait for `npm run test:updates`, honoured only where npm's registry is a loopback
  address (`npm_config_registry`), as the test's is and a server's never is.
- `server/main.ts`: `--updates`, the supervisor's start, `stop()`, `GET /api/updates`, the version
  recorded at start (`recordVersion`); `/api/meta?v=&i=` refuses another process's version (409).
- `server/live.ts`: `instance`, `toolVersion`, `hello`'s `server`, `GraphInfo.instance`,
  `updatesChanged`, `end`.
- `web/src/reload.ts`: the page's version (`__VP_VERSION__`, defined as the page is bundled), what
  is kept (`keep`, `takeKept`, sessionStorage `visualproof:reload`, ten minutes at most), `Reloader`.
- The timeline's `tool` event (`shared/timeline.ts`), drawn by `web/src/activity.ts`.
