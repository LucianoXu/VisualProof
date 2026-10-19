# VisualProof Deploy Spec

How a server follows a branch of a git repository and builds what it shows, beside the workspace it
reads as its owner builds it (SPEC.md, "Deployment"): what is followed and how it is asked, where
the clone is, how a build is made, what the board, the history and the pages show of it, what
survives a restart, and what it trusts. The history of builds: HistorySpec.md. The updater:
UpdateSpec.md. What it trusts and exposes: SECURITY.md. For users: docs/MANUAL.md, "Following a
branch".

## Decisions

The owner's decisions of 2026-10-18 and, where they say so, of 2026-10-19, beside what is marked
*proposed* (the owner has not decided those: they are what VisualProof does until decided
otherwise).

### What is followed

1. **A git URL where the project goes** (the owner's decision of 2026-10-18): `visualproof serve
   https://github.com/<owner>/<repo> --branch main`. `--branch` defaults to the remote's default
   branch. VisualProof builds what it shows itself: one build per commit, never someone's
   half-edited working tree.
   - *Proposed*: the command line. A git address is what git calls one: a URL (`scheme://…`) or
     scp-like (`[user@]host:path`, a colon before any slash); anything else is a folder, as before
     (a folder whose name has a colon: `./a:b`). `--branch <name>` and `--poll <minutes>` go with an
     address alone; `--graph` does not. The other commands (`export`, `artwork`, `doctor`,
     `purge-file`) take the clone's folder, which the server names as it starts; an address there
     says so.
   - *Proposed*: without `--branch`, the remote's default branch is asked at each start
     (`git ls-remote --symref <url> HEAD`) and recorded (`<cache>/deploy/remotes.json`), so that a
     start without the network follows the branch it followed; with neither, the server says to
     give `--branch` and ends.
2. **Its own clone in the cache, per URL and branch** (the owner's decision of 2026-10-18), never
   the user's workspace; nothing written anywhere else. `<cache>/deploy/<repo>-<hash of the URL and
   the branch>/clone/<repo>/`, made at the first start: an empty repository whose `origin` is the
   URL, the branch fetched alone, its head checked out detached — in a folder of its own, moved into
   place once whole.
   - **Every repository's name is safe** (the owner's decision of 2026-10-19): the clone is in
     `clone/` of the deployment's folder, apart from what the folder keeps of its own (`state.json`,
     `logs/`, `mathlib-cache/`, `.lock`), whatever the repository is called, and **an existing
     deployment is never cloned again** for it: a clone made by 0.5.0, named after its repository
     beside those (`<repo>-<hash>/<repo>/`), is kept where it is, with its builds and the project's
     caches (keyed by its path).
     - *Proposed*: a clone of 0.5.0 whose name is one of the folder's own (a repository called
       `logs` or `state.json`, whose logs or state went into it) is moved into `clone/` at the start,
       what it built with it, rather than cloned again.
   - *Proposed*: the site, without `--site`, is the URL's and the branch's
     (`<data home>/sites/<repo>-<hash>`), not the clone's path: a review does not move with
     `--cache`. One server follows a branch with a cache at a time (`.lock` in the deployment's
     folder, as a site is held); a second is refused, saying which process holds it.
   - *Proposed*: what the build's own tools write for any build stays where they write it: elan's
     toolchains (`~/.elan`), and Mathlib's cache unless the deployment has its own (below).
   - **Mathlib's cache: the user's, or the deployment's own** (the owner's decision of 2026-10-19).
     By default `lake exe cache get` keeps Mathlib's files where the user's builds do
     (`~/.cache/mathlib`, or wherever the server's environment says: `MATHLIB_CACHE_DIR`,
     `XDG_CACHE_HOME`), shared, so that a deployment fetches only what they have not.
     `--mathlib-cache own` gives the deployment its own, in its folder of the cache
     (`<cache>/deploy/<repo>-<hash>/mathlib-cache/`), so that removing that folder removes it too,
     and apart from the user's builds (before Mathlib of August 2026, #42752, two `lake exe cache
     get` at once in one folder could leave a corrupt file there). What the cache's files unpack
     into, the build of Mathlib in the clone's `.lake` (about 8 GB), is there either way.
   - **The deployment's own Mathlib cache keeps one version** (the owner's decision of 2026-10-19):
     after each `lake exe cache get` that succeeded, `lake exe cache clean`, so that it holds the
     version of Mathlib checked out alone, about 0.45 GB (8,684 files for Mathlib of August 2026),
     and a bump of Mathlib on the branch, which fetches nearly the whole again (a file's hash
     changes with its imports'), leaves the version before deleted rather than kept. It never runs
     on the shared cache.
     - *Proposed*: what `clean` deletes, as Mathlib's cache program says it (`Cache/Main.lean`,
       `cleanCache` in `Cache/IO.lean`; the same in the Mathlib of February, August and September
       2026, Lean v4.28 to v4.34, read): every `.ltar` of the cache folder that the hash map of the
       Mathlib checked out (from `Mathlib.lean`, its dependencies with it) does not name — which is
       what `get` fetches, so nothing the checked-out Mathlib needs — and nothing else. It runs only
       with `--mathlib-cache own`, and only where the Mathlib checked out reads `MATHLIB_CACHE_DIR`
       (its `Cache/IO.lean` says so: since February 2025): one before keeps its cache with the
       user's, and would clean theirs. A `clean` that fails is said in the build's log, and the next
       build's cleans. Measured: a bump from Mathlib of August 2026 (8,684 files, 440 MB) to
       September's (8,908, 449 MB) left 8,908 files, none of August's (17,592 without it).
     - *Proposed*: `--mathlib-cache shared|own`, a word as `--updates` and `--agents` take, rather
       than a folder: the deployment's own cache is in its folder of the cache, where nothing else
       writes (a folder of one's own choosing is `MATHLIB_CACHE_DIR` in the server's environment,
       with `shared`). It goes with a git address alone, as `--poll`; a folder is never built.
     - *Proposed*: only `MATHLIB_CACHE_DIR` is set, for `lake exe cache get` and `lake build`. Mathlib
       reads it since February 2025 (#21480, on Lean v4.17.0-rc1): the Mathlib of every supported
       toolchain (v4.28.0 and after) does; an older one reads `XDG_CACHE_HOME` alone, and would
       keep its files in the shared cache. `XDG_CACHE_HOME` is not moved: Lake finds its own
       cache by it (`$XDG_CACHE_HOME/lake`) and git its credential cache's socket
       (`$XDG_CACHE_HOME/git/credential/socket`), which a build's dependencies may need.
3. **Polling the remote** (the owner's decision of 2026-10-18): `git ls-remote <url>
   refs/heads/<branch>` every 2 minutes by default; `--poll <minutes>` changes it (0.05 to 1440).
   Webhooks are later, not now. Asked at once at the start.
4. **Only the configured branch** (the owner's decision of 2026-10-18): never a pull request's ref,
   nor a fork's. Only `refs/heads/<branch>` is asked of and fetched
   (`+refs/heads/<branch>:refs/remotes/origin/<branch>`, no tags, no submodules); a force-push is
   followed as any new head.

### Building

5. **On a new head** (the owner's decision of 2026-10-18): fetch, check out that commit detached,
   `lake exe cache get` where Mathlib is in the manifest (`lake-manifest.json` names a package
   `mathlib`), then `lake build` — in programs of their own, never the server's process. **One
   build at a time**; heads that arrive during a build: **only the newest is built after it**.
   - *Proposed*: `lake build` builds the default targets, or what `--root` names. The checkout is
     `--force`d and the tree cleaned of what is not tracked, `.lake` kept (the build's outputs and
     the packages). Mathlib's cache that cannot be had is asked once more, then `lake build` builds
     what it lacks.
   - *Proposed*: **the tree is read only between builds.** A build starts only once nothing reads
     the tree (an extraction, a graph being made ready to serve), and from its start to its end
     nothing is read of it; the usage pass of the build before is cut short as the build starts
     (what it finished is kept), and a graph being served as the fetch went on is let finish before
     the checkout. Once a build ends, whatever came of it, the live loop reads the tree again as it
     reads a workspace's build, once it settles (a usage pass cut short is done then, from what it
     finished); and otherwise only where a build wrote something (the outputs' stamp, not the
     sources'): a branch's sources change only with a checkout.
   - *Proposed*: **a try that does not build the tree leaves it as the last build had it**: a
     commit that is no Lean project VisualProof can read (no `lean-toolchain`, no default target), a
     checkout or `lake` that cannot be run — the tree is checked out at the last build's commit
     again, so that what is read of it, and a restart, are that build's.
   - *Proposed*: a commit tried is not tried again, whatever came of it, but where the try could
     not be made (the commit could not be fetched, git or Lake could not be run): then it is tried
     again at the next look at the remote, not before.
6. **The board keeps answering meanwhile** (the owner's decision of 2026-10-18), showing the last
   build read; the existing machinery shows the build in progress (the pill, `Building 3 / 40`, the
   files' states), and the history records each build's commit (major ticks per commit: HistorySpec
   decision 16). **A failed build is shown as failed builds are**: the files that failed, in Status
   and in the build popover; the popover also gives the commit and the end of the build's log.
   - *Proposed*: the pill says the step where Lake says nothing of its progress (`Fetching a1b2c3d`,
     `Checking out …`, `Mathlib's cache …`, `Building …`), and `Build failed · a1b2c3d` (or `Not
     built` where it could not be made) where no file says it. The popover, under its buttons: the
     branch and the remote (linked on GitHub), how often and when last it was asked, the build going
     on, its step and its last lines, the newest commit waiting for it ("commits pushed before it are not built"),
     the last build that ended — when, how long, why it failed, the end of its log.
   - *Proposed*: the history keeps a snapshot per build as it does (HistorySpec decision 4), keyed
     by the build's newest `.olean`: a failing commit whose build wrote no newer `.olean` (it only
     failed) is no new build, and has no tick of its own; the popover says its failure.
   - **What is said built is the commit whose build the board reads** (the owner's decision of
     2026-10-19): the last whose build wrote outputs. A failed build that wrote none (no newer
     `.olean` of the project: a lakefile that does not elaborate, a first file that fails, a build
     stopped before it wrote any) shows as failed, not as built: the popover says it failed and
     that the board shows the build before ("The build of d470b61 failed …: … The board shows the
     build of 4789b65"), the pill `Build failed · d470b61`, the loading page and the agents' status
     (`built`) the build before, and the history's snapshot of that build, read again, keeps its
     commit.
     - *Proposed*: a build that succeeds is built whatever it wrote: a commit that changes no Lean
       file has the build before as its own, up to date.
     - *Proposed*: the tree stays checked out at the failed commit, so that its files show what
       failed (Status, the popover's files); a restart reads it as it is, neither cut short nor to
       be built again. Before any build wrote outputs, none is built: nothing is read, and the
       loading page says the first build failed and that the next commit pushed is built.
     - *Proposed*: Lake (since Lean v4.29) removes a failed file's `.olean`, so a failed build that
       wrote nothing can leave less of the build before to read: what can still be read is read, as
       that build's; where nothing can (a restart: the board's graph was the server's alone), the
       loading page says the failed build left nothing that can be read, with its log.
7. **The first start, before any build exists** (the owner's decision of 2026-10-18): it says so
   clearly, on the page and in the terminal, never a dead end.
   - *Proposed*: the terminal says the clone being made, then where it is, and "none yet: the first,
     of a1b2c3d, starts now, and the page says so until it is done". The loading page says what is
     being done ("The first build of github.com/A/B (main) at a1b2c3d: lake build, 3 of 8 files… The
     board appears once it is done"), what failed and why, and what comes next (tried again at the
     next look, or the next commit pushed is built, the remote asked every 2 min), with the end of
     the log; it never stops asking, and shows the board as soon as a build can be read.
   - *Proposed*: the clone is made before the server listens: where it cannot be made (the remote
     unreachable, a credential missing, a branch it has not), the server says why and ends, which
     is not its code (UpdateSpec decision 7).

### Restarts

8. **It survives the updater's restarts** (the owner's decision of 2026-10-18; UpdateSpec: patches
   swapped seamlessly): the clone persists in the cache, and a build in progress is resumed or
   redone, never left half.
   - *Proposed*: a build in progress is no quiet moment (UpdateSpec decision 6): the restart waits
     for its end, a day at most. A build cut short (a restart taken anyway, a stop) is recorded so
     before the tree changes (`state.json`, `building`), and the next server holds the tree — reads
     nothing of it — and builds the newest head (the one cut short where the remote cannot be asked):
     redone, Lake keeping what it finished, so that it resumes. A server whose tree holds a whole
     build reads it at once.

### What it trusts

9. **Credentials are git's own** (the owner's decision of 2026-10-18): an SSH key, a deploy key, a
   credential helper; VisualProof stores no token. `GIT_TERMINAL_PROMPT=0` and the SSH equivalent,
   so that nothing ever waits on a prompt.
   - *Proposed*: an address with a user name, password or token in it (`https://<token>@…`) is
     refused, saying to let git find the credential. git runs without askpass (`GIT_ASKPASS` empty,
     `SSH_ASKPASS_REQUIRE=never`, `GCM_INTERACTIVE=never`), ssh in batch mode (`-o BatchMode=yes`
     after the ssh command git would run: `GIT_SSH_COMMAND`, else `core.sshCommand`, else `ssh`; a
     `GIT_SSH` program is left as it is), every program without a terminal of its own. An unknown
     host key fails: it is added to `known_hosts` first. The same holds for the git Lake runs for
     the dependencies.
10. **Safety** (the owner's decision of 2026-10-18): git and Lake are run with argument arrays,
    never a shell; the URL's scheme allowlisted (https, ssh and scp-like); the branch checked
    (`git check-ref-format --branch`); the builder's environment carries no access key or token of
    VisualProof's.
    - *Proposed*: `file://` (a repository on this machine: one others push to over ssh, a test's) is
      followed in production too; `http://` (nothing checks what comes), `git://`, `ext::` and any
      other scheme are refused, and git is held to the address's protocol (`GIT_ALLOW_PROTOCOL`)
      whatever a redirect or a configuration says. An address or a path starting with `-`, or with
      `.` or `..` in its path, is refused; a branch starting with `-` or holding `@{`, before git
      reads it.
    - *Proposed*: git and Lake are run without the server's `VISUALPROOF_*` variables and without
      what would point git at another repository (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_*`, …).
11. **Whoever can push to that branch runs code on this machine** (the owner's decision of
    2026-10-18, SECURITY.md): the lakefile, and what elaboration runs, with the server's user's
    rights — so run it as a dedicated user and protect the branch. No sandbox in 0.5 (bubblewrap is
    later).
    - *Proposed*: what pages are told of the builds: the build going on, the commit waiting, the
      last build and why it failed, to every reader; the end of its log, its paths written from the
      clone's folder (`.`) and the home (`~`), to those let in fully and to agents, never to a
      read-only reader (whose `GET /api/status` has no log either: CollabSpec decision 11).
    - **No path of the machine in the log the pages are told** (the owner's decision of 2026-10-19):
      the paths are named so whether the log writes them as given or resolved, as Lean, elan and
      Lake print them: the home's realpath reads `~`, and the realpath of what elan and Lake use
      under it its path under the home: `~/.elan` (or `$ELAN_HOME`), `~/.cache` (or `$XDG_CACHE_HOME`: Lake's cache,
      Mathlib's), `$MATHLIB_CACHE_DIR` where it is set. Where the home or a folder under it is
      reached through a symlink (`~/.elan` → `/data/.elan`), `/data/.elan/toolchains/…/bin/lean`
      reads `~/.elan/toolchains/…/bin/lean`. The deployment's folder, which holds the clone, its logs
      and its own Mathlib cache, is written from the clone's (`../..`). A path is named so where it is
      whole or begins a longer one (`/home/ann` is not in `/home/anne`), the longest first; the clone
      not made yet is resolved as the folder it will be in. A folder those variables name outside the
      home keeps the path given.

### What a build is of

12. *Proposed*: **a build's commit is the one its build checked out**, on the branch followed — not
    what is checked out as it is read: each snapshot's (HistorySpec decision 4: never `dirty`, a
    clean checkout), `GET /api/git` (an artwork's foot: the build on show, not the one going on),
    an exported document's, and the graph's (`GraphInfo.commit`).
13. **"Open on GitHub"** (the owner's decision of 2026-10-18) in the source window where the remote
    is github.com: a link to `blob/<commit>/<file>#L<a>-L<b>` of the build shown.
    - *Proposed*: where the text shown is that commit's: the build of now, its file not changed
      since it was compiled (a module a failed build did not rebuild is not that commit's text); a
      past build, a clean one whose kept text came from its tree or its commit. The lines are those
      the window shows, from the doc comment above the declaration to its end. The popover links
      the branch and each commit there.
14. **A build that takes longer than `--build-timeout` hours is stopped** (the owner's decision of
    2026-10-19), 6 by default, and is failed (its commit is not tried again): a commit that loops
    forever does not hold the branch's later commits back for good.
    - *Proposed*: from 0.05 (3 minutes) to 168 (a week), fractions too (`1.5`), refused outside
      with a line that says so, as `--poll` is; with a folder it is refused, as `--poll` is (a
      folder is never built: decision 15). The time is `lake build`'s, each run of it: a build
      done again after a restart (decision 8) has the whole time again.
    - *Proposed*: the failure says the limit in words, in the popover and the loading page, and in
      the build's log: "it took longer than 6 hours (--build-timeout): stopped" (`1 h 30 min`,
      `3 min`); the server's first lines say it ("a build stopped past 6 hours").

### The workspace

15. **The workspace mode stays exactly as it is** (the owner's decision of 2026-10-18): a folder is
    read as its owner's builds leave it, and never built.

## Implementation notes

### Where (server/deploy.ts)

- `parseRemote`, `isGitAddress`, `branchProblem`: the address and the branch (decisions 1, 10).
- `deployFolder`, `deploySite`, `branchToFollow` (with `remotes.json`), `ensureClone`,
  `lockDeployment`: the folder, the site, the default branch, the clone, the lock (decision 2).
- `gitEnv`, `buildEnv`, `noPrompts`: the programs' environment (decisions 9, 10; `buildEnv`'s
  `MATHLIB_CACHE_DIR` where the deployment has its own Mathlib cache, decision 2;
  `sharedMathlibCache`, where the user's is); `run`: a program with an argument array, as a group
  of its own (server/children.ts), stopped past its time.
- `parseBuildHours`, `limitInWords`: `--build-timeout` and its limit in words (decision 14);
  `Deployment`'s `buildMs`.
- `askRemote`: `ls-remote` of the branch's ref, the exact ref alone (a pattern matches refs that
  end so), or `--symref HEAD`.
- `Deployment`: the polling (`poll`, every `everyMs`), the queue (`want`, the newest head seen;
  `done`, the last commit tried; `later`, one whose try could not be made; `toBuild`, the next to
  build), the build (`attempt`: whether `lake build` wrote outputs is the project's newest `.olean`
  before and after it, `buildTime`, as the history tells a new build), the tree held (`holds`), the
  commit of the tree's outputs (`commit`: decision 6, what is said built), and what pages are told
  (`status`). Its hooks: `reading` (the live loop reads the tree), `starting` (the usage pass is
  cut short), `toolchainChanged` (Lean's language server starts again with the new toolchain,
  server/hover.ts), `ended` (the live loop reads the tree again: `reread`), `log`. `next` is said
  only while a build is going on; a commit whose try is to be made again, by the last build's.
- The project is the server's one object, refreshed in place from each commit
  (`openProject(…, false)`: its toolchain, name and roots), after the checkout and again after the
  build (the modules a library's globs give, once built).
- server/live.ts: `deploy` (the hooks it reads: `holds`, `commit`, `busy`, `status`); the tick
  reads a branch's tree only where `holds()` is false and the outputs' stamp moved (or `reread`);
  the usage pass's graph is not served while `holds()`; `busy` and the
  build status's `active` include a build going on; `reading` is an extraction or a graph being
  served (`installing`); the snapshot's commit is `deploy.commit()`; `shownCommit()`,
  `following()`; `stop()` ends the loop (a test's end).
- server/main.ts: `--branch`, `--poll`, `--build-timeout`, `--mathlib-cache`, the checks before
  anything runs (a folder with any of them is refused, naming them), `openDeployment` before
  the project is read, the supervisor's site (`deploySiteOf`, without the network), the terminal's
  lines, `GET /api/git`, the read-only reader's `GET /api/status`.

### On disk (`<cache>/deploy/`)

- `remotes.json`: `{<url>: {branch, at}}`, the default branches as last asked.
- `<repo>-<hash>/clone/<repo>/`: the clone (the project; its `.lake` the builds' outputs and
  packages), named after the repository inside a folder of its own, so that no name collides with
  the folder's own entries (decision 2); a clone of 0.5.0 stays at `<repo>-<hash>/<repo>/`
  (`deployFolder` takes it where its `.git` is, unless its name is one of the folder's own:
  `ensureClone` moves that one into `clone/`).
- `<repo>-<hash>/state.json`: `{version: 1, url, branch, outputs: {commit, at} | null, ran,
  building: {commit, since} | null, done, last: DeployBuild | null, head: {commit, at} | null}` —
  `outputs` the commit whose build last wrote outputs in the tree, or succeeded (what is said built:
  decision 6), `ran` the commit whose `lake build` last ran there, whatever came of it (what the
  tree is checked out at between builds: one checked out otherwise at a start was cut short; 0.5.0
  kept none, its `outputs` being this, and is read so), `building` a build that changed the tree and
  has not ended (one found at a start was cut short), `done` the last commit tried, `head` the newest
  seen. Written whole (a file moved into place).
- `<repo>-<hash>/logs/<commit>.log`: everything a build's programs wrote, with the commands (`$ git
  …`, `$ lake build`); a build done again writes it again; the newest 30 kept. `0600`.
- `<repo>-<hash>/.lock`: the server that follows the branch with this cache.
- `<repo>-<hash>/mathlib-cache/`: Mathlib's cache, with `--mathlib-cache own` (decision 2): the
  files `lake exe cache get` fetched (`<hash>.ltar`) for the version of Mathlib the last build got,
  `lake exe cache clean` deleting the others after each `get` (`cleanMathlibCache`, where
  `mathlibReadsCacheDir`).

### What pages and agents are told (shared/deploy.ts)

- `DeployStatus`: `{source, github, branch, every, asked: {at, head, error?}, building: {commit,
  since, step}, next, last: DeployBuild, built}` (`built`: the commit whose build the board reads,
  decision 6); `DeployBuild`: `{commit, ok, at, ms, exit?, error?, retry?, tail?}`. `slimDeploy`
  takes the tail out.
- The event `deploy`, as a stream opens and whenever it changes (a read-only reader's slim); `GET
  /api/status` `deploy`; `GraphInfo.commit`; `GET /api/agent/history` `following` (agents; the
  page's `GET /api/history` has none).
- The page: web/src/buildpop.ts (`deployHtml`, the popover's part; `deployWaiting`, the loading
  page; `stepPill`), web/src/main.ts (the pill, the loader, the `deploy` event), web/src/sourcewin.ts
  ("Open on GitHub", `githubLink` and `builtCommit` hooks).

### Known limits, left as they are

- During a build the source window shows the commit being built (the clone's file): where it
  changed, as "changed since it was compiled", without "Open on GitHub"; the build's own text comes
  back with the build.
- A failing commit that wrote no newer `.olean` has no snapshot (decision 6's notes).
- The first start needs the remote: no page is served until the clone is made (decision 7's notes).
- Lean projects in a folder of the repository (not its root) are not followed yet.
