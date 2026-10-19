# VisualProof Deploy Spec

How a server follows a branch of a git repository and builds what it shows, beside the workspace it
reads as its owner builds it (SPEC.md, "Deployment"): what is followed and how it is asked, where
the clone is, how a build is made, what the board, the history and the pages show of it, what
survives a restart, and what it trusts. The history of builds: HistorySpec.md. The updater:
UpdateSpec.md. What it trusts and exposes: SECURITY.md. For users: docs/MANUAL.md, "Following a
branch".

## Decisions

The owner's decisions of 2026-10-18, beside what is marked *proposed* (the owner has not decided
those: they are what 0.5.0 does until decided otherwise).

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
   the branch>/<repo>/`, made at the first start: an empty repository whose `origin` is the URL, the
   branch fetched alone, its head checked out detached — in a folder of its own, moved into place
   once whole.
   - *Proposed*: the site, without `--site`, is the URL's and the branch's
     (`<data home>/sites/<repo>-<hash>`), not the clone's path: a review does not move with
     `--cache`. One server follows a branch with a cache at a time (`.lock` in the deployment's
     folder, as a site is held); a second is refused, saying which process holds it.
   - *Proposed*: what the build's own tools write for any build stays where they write it: elan's
     toolchains (`~/.elan`) and Mathlib's cache (`~/.cache/mathlib`, shared by the user's builds,
     so that a deployment fetches only what they have not; `MATHLIB_CACHE_DIR` would make it the
     deployment's own, at the price of a whole cache each).
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
14. *Proposed*: **a build that takes longer than 6 hours is stopped**, and is failed (its commit is
    not tried again): a commit that loops forever does not hold the branch's later commits back
    for good. Not an option yet.

### The workspace

15. **The workspace mode stays exactly as it is** (the owner's decision of 2026-10-18): a folder is
    read as its owner's builds leave it, and never built.

## Implementation notes

### Where (server/deploy.ts)

- `parseRemote`, `isGitAddress`, `branchProblem`: the address and the branch (decisions 1, 10).
- `deployFolder`, `deploySite`, `branchToFollow` (with `remotes.json`), `ensureClone`,
  `lockDeployment`: the folder, the site, the default branch, the clone, the lock (decision 2).
- `gitEnv`, `buildEnv`, `noPrompts`: the programs' environment (decisions 9, 10); `run`: a program
  with an argument array, as a group of its own (server/children.ts), stopped past its time.
- `askRemote`: `ls-remote` of the branch's ref, the exact ref alone (a pattern matches refs that
  end so), or `--symref HEAD`.
- `Deployment`: the polling (`poll`, every `everyMs`), the queue (`want`, the newest head seen;
  `done`, the last commit tried; `later`, one whose try could not be made), the build (`attempt`),
  the tree held (`holds`), the commit of the tree's outputs (`commit`), and what pages are told
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
- server/main.ts: `--branch`, `--poll`, the checks before anything runs, `openDeployment` before
  the project is read, the supervisor's site (`deploySiteOf`, without the network), the terminal's
  lines, `GET /api/git`, the read-only reader's `GET /api/status`.

### On disk (`<cache>/deploy/`)

- `remotes.json`: `{<url>: {branch, at}}`, the default branches as last asked.
- `<repo>-<hash>/<repo>/`: the clone (the project; its `.lake` the builds' outputs and packages).
- `<repo>-<hash>/state.json`: `{version: 1, url, branch, outputs: {commit, at} | null, building:
  {commit, since} | null, done, last: DeployBuild | null, head: {commit, at} | null}` — `outputs`
  the commit whose `lake build` last ran in the tree, `building` a build that changed the tree and
  has not ended (one found at a start was cut short), `done` the last commit tried, `head` the newest
  seen. Written whole (a file moved into place).
- `<repo>-<hash>/logs/<commit>.log`: everything a build's programs wrote, with the commands (`$ git
  …`, `$ lake build`); a build done again writes it again; the newest 30 kept. `0600`.
- `<repo>-<hash>/.lock`: the server that follows the branch with this cache.

### What pages and agents are told (shared/deploy.ts)

- `DeployStatus`: `{source, github, branch, every, asked: {at, head, error?}, building: {commit,
  since, step}, next, last: DeployBuild, built}`; `DeployBuild`: `{commit, ok, at, ms, exit?, error?,
  retry?, tail?}`. `slimDeploy` takes the tail out.
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
