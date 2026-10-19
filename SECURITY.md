# Security

## Reporting a vulnerability

Report it privately, through GitHub's private vulnerability reporting: the repository's
**Security** tab, **Report a vulnerability**. Please do not open a public issue for it. Fixes go
into the latest release only.

## What VisualProof trusts

- **The project it serves.** Reading a project runs its Lean code, as building it does: the
  extractor and the usage pass import its modules, which runs their `initialize` declarations, and
  the usage pass elaborates each module again, which runs the project's macros and elaborators.
  Serve only a project you would build yourself.
- **Whoever can push to a branch it follows.** `visualproof serve <git URL>` builds each new commit
  of that branch itself (SPEC/DeploySpec.md): `lake exe cache get` where the project is on Mathlib,
  then `lake build`. **Whoever can push to that branch runs code on this machine**, with the
  server's user's rights: the lakefile, the dependencies' lakefiles, Mathlib's cache program, and
  whatever elaboration runs (macros, elaborators, `#eval`, `initialize`). That code can read and
  write what the server's user can — the site's folder with its tokens and links, the access key's
  file, the user's SSH keys and git credentials — and reach the network. So: run such a server as a
  user of its own, which holds nothing else; give it a deploy key that reads that repository alone
  (or a credential helper scoped to it), never a key that can push; and protect the branch on the
  forge (pull requests reviewed before they land, no force-push), since a push to it is a deploy.
  There is no sandbox yet: the build runs as the server's user, in programs of its own. Only that
  branch is ever fetched: never a pull request's ref nor a fork's.
- **The project's toolchain**, which elan installs, and Lean's own kernel and language server.
- **The npm registry and VisualProof's publisher**, as at the first install, and unattended: with
  `--updates auto` (the default) a server downloads the patch releases of the version it runs,
  through npm, and restarts into them by itself, nobody looking (SPEC/UpdateSpec.md). What it
  takes is what the registry serves for `visualproof@<version>`: npm checks the tarball against the
  registry's own hash (its `integrity`); the package's provenance and the registry's signatures are
  not checked. Its dependencies are resolved again at each patch (no lock file: `--no-package-lock`),
  within the ranges its package.json allows. The trust root is VisualProof's publishing path: a
  release is a tag on `main` published by the repository's release workflow, in its `npm`
  environment, which only the owner approves (CONTRIBUTING.md). `--updates notify` downloads
  nothing; `--updates off` asks the registry nothing.

## What a running server exposes

- **The network.** It listens on `127.0.0.1` unless given `--host`. Beyond this machine, let in
  only the people meant to be there: `--access-key-file` admits those given the access link
  (`/k/<key>`) or a personal link made in Share (`/i/vpp_…`, revoked on its own), and answers
  everything else 404; or put an authenticating proxy in front. Agents send the key, or a token
  made in Share (`vpa_…`), which reaches the agents' API alone and lasts a few days.
- **Who is not let in.** A browser asking for a page (GET or HEAD, accepting HTML, not the API nor a
  file, no `Authorization: Bearer`) is shown, rather than the 404, a page saying the site is private
  — or that its link no longer opens it, alike for a key replaced and for a personal or read-only
  link revoked or never made, naming nobody — 403. It is the same page on every server, made of
  nothing the site holds: whoever comes learns that a VisualProof server is there, and nothing else —
  not the project, the version, the people or how many there are. No script, nothing fetched, a CSP
  of `default-src 'none'`, never cached. A browser the key lets in is still told who revoked a link
  and when; so is what does not ask for a page (a 410), as before.
- **Web pages on this machine.** Without `--access-key-file`, whoever reaches the port is in, and a
  web page a browser here opens could reach it too, by DNS rebinding: its own name made to resolve
  to this machine, its scripts would then read and write the server as their own site. So a server
  without a key answers a request only for an IP address (IPv6 in brackets), `localhost` and the
  names under it, `--public-url`'s host and the names given with `--allowed-host`, at any port; any
  other name, and a request without one, is answered 403, whatever it asks — to a browser asking
  for a page, a page for whoever runs the server, which names the options and does not repeat the
  name. A page reaches an address only as that address, and browsers resolve `localhost`
  themselves, so neither can be a name the page chose. With a key, the key keeps out whoever was
  not given it, by any name.
- **Read-only readers.** Anyone let in can make a read-only link in Share (`/r/vpr_…`): it lets
  whoever holds it read what a guest reads — the graph, the sources, the review, the history, the
  library's files — and nothing else. The server refuses every other request from them (403)
  whatever the page sends, never lets them reach the agents' API, and bounds what they cost:
  Lean's answers at 60 a minute per address and 300 in all (429 beyond), kept per build; one
  printed document typeset at a time for all of them; 400 event streams of their own; git, for the
  project's commit, run at most once every 3 seconds whoever asks; of the library's PDFs, only the
  pages and clips the notes show are drawn for them (the cache keeps each), the files themselves
  served as they are. A link lasts
  until revoked, which ends its pages at once. With `--public` the address alone makes a read-only
  reader of whoever comes without the key or a link: it puts the whole project, its review and its
  library online, so give it only to a project meant to be public.
- **The project's git remote.** Where the project is a git repository, the page is told its remote's
  address and the commit checked out, read when a page asks (`GET /api/git`; an artwork's foot shows
  them): the host and path alone,
  never a user name, password or token written into the remote's URL, and nothing for a remote that
  is a path on the machine. Git is only asked, never written to. A branch the server follows: the
  commit of the build on show, on that branch.
- **A branch it follows** (SPEC/DeploySpec.md). The credentials are git's own — an SSH key, a deploy
  key, a credential helper: VisualProof stores none, and refuses an address with a user name,
  password or token in it. It follows `https://`, `ssh://` and git's scp-like `git@host:path`, and
  `file://` (a repository on this machine); never `http://`, `git://`, `ext::` or any other scheme,
  and git is held to the address's protocol (`GIT_ALLOW_PROTOCOL`) whatever a redirect or a
  configuration says. The branch is checked by git (`git check-ref-format --branch`); git and Lake
  are run with argument arrays, never through a shell, as process groups of their own, without the
  server's `VISUALPROOF_*` variables or anything that points git at another repository; nothing
  they start waits on a prompt (`GIT_TERMINAL_PROMPT=0`, no askpass, ssh in batch mode: an unknown
  host key fails, so add it to `known_hosts` first). The remote is asked every `--poll` minutes
  (`git ls-remote` of the branch's ref alone). What the build writes is in the deployment's folder
  of the cache, and where the build tools write for any build: elan's toolchains (`~/.elan`) and
  Mathlib's cache (`~/.cache/mathlib`). The pages are told the branch, the remote (host and path),
  the build going on, the commit waiting and why a build failed; the end of a build's log, its paths
  written from the clone's folder (`.`) and the home (`~`), goes to those let in fully and to
  agents, never to a read-only reader.
- **Links that save a picture.** A link to an artwork (ExportSpec decision 20) carries its recipe
  after `#`, unsigned: anyone who can send a reader a link — not only an agent the server answered —
  can make it, and make the reader's browser save the picture the page draws of the board, PNG or
  SVG, at most the largest size an artwork has (16,384 pixels a side), as Save PNG and Save SVG
  would. Nothing else: the page reads the recipe as settings, the browser asks before a site saves
  several files, and the link holds no key.
- **The artwork command.** `visualproof artwork` reads the build, the cache and, with `--site`, the
  site (the review, the views); it never writes the site or the project, nor the views the cache
  keeps for a server. It writes its files and, in the cache, the extraction and the usage pass's
  results, as `visualproof export` does, and runs no Lean but the usage pass's (`--jobs`).
- **Plain HTTP.** The server speaks HTTP only: the key and the cookies cross the network in the
  clear. Beyond a trusted network, put a TLS reverse proxy (or a VPN such as Tailscale) in front.
  Its cookies are `HttpOnly` and `SameSite=Lax`.
- **`--identity-header`** takes a person's name from a header as it comes. Use it only when the
  proxy that sets it is the only way to reach the server.
- **Lean, on the server.** Hovers and the agents' `describe` and `print` write `#check` and `#print`
  of a name into a scratch file Lean's language server elaborates, in the cache directory. Only a
  name that passes `isDeclName` (a dotted Lean name) is ever written there: no Lean source from a
  page or an agent reaches Lean.
- **Fetching by URL.** Whoever can write a note can make the server fetch an address for the
  library. It fetches `http` and `https` only, never an address that is loopback, private,
  link-local, reserved or the server's own, checked on every address the name resolves to, on the
  connection itself (against DNS rebinding) and again at every redirect (at most 5); at most 50 MB,
  within 60 s.
- **Its own updates.** At start and once a day the server runs `npm view visualproof versions`
  (and the `engines` of the newest releases), as `visualproof doctor` does once (unless
  `VISUALPROOF_UPDATES=off`): npm's own requests to the registry npm is configured with, which carry
  nothing of the project. npm runs under the server's own Node, in the versions' folder (so no
  project's `.npmrc` applies), without the server's `VISUALPROOF_*` variables. Under auto it then
  runs, for a patch, `npm install --prefix=<root>/versions/.<version>.tmp-<pid> --ignore-scripts
  --omit=dev --no-package-lock visualproof@<version>` (`<root>` the caches' root, `--cache`); checks
  the package's `engines` against this Node; runs the downloaded server once, `--version`, to check
  it says its version — the downloaded code runs there, before it is marked ready; and renames the
  folder into `<root>/versions/<version>/`. `GET /api/updates` tells a read-only reader and an
  agent the running version alone; those let in fully, also what is newer, the command that
  installs it, and what was set aside and why (Activity tells the others the version alone). A
  read-only reader's `GET /api/status` has no log and no review folder; the updates' lines go to
  the server's console alone.
- **The tips' tour film.** The first time a page plays the tour, the server fetches the film from
  the project's GitHub release (`releases/download/tour-1/`, redirects followed only to GitHub's own
  asset hosts, https), once for every reader, bounded by the size the package pins and checked
  against the sha256 it pins before it is kept, in the caches' root (`media/`, `0700`) — and serves
  it from there: no reader's browser reaches GitHub. Any reader who may play it, read-only readers
  too, can cause that one fetch. What is not the pinned film is removed, and not asked for again
  for a day. `--updates off` stops it: the tour shows its stills and captions alone.
- **Uploads.** PDFs and images of at most 50 MB each, the library at most `--library-limit` (2 GB
  by default). The server reads PDFs with Poppler: keep it up to date. Pages draw them with pdf.js,
  whose script engine is never served, so a PDF's JavaScript does not run.
- **Agents.** A token has a level: `read`, `advise` or `full` (and `--agents` caps it for the whole
  server). At `full` an agent can do whatever a person can through the page; its opinions stay
  advice and are never counted.
- **The conversations.** The public channel is read and written by everyone with a name and every
  agent with a token: what is written there is untrusted input to every agent. A person's message
  there is handed to the agents it mentions; the agents' ground rules (the prompt, the entry, the
  MCP server's instructions) say that a request there is a request, not their maker's, and to ask
  their maker before changing the board on someone else's word; and no agent can do more than its
  token allows, whoever asks. An agent's mention of an agent is never handed to it, so agents do
  not talk on among themselves. An agent's private channel is read and written by the person who
  made its token alone — their personal link where they came by one, else their name — so it is as
  private as names are: a guest's is open to whoever gives that guest's name, while an invited
  person's and a proxy's names are protected. The token's prompt, which holds the token (and so the
  private channel), is shown again to its maker alone; revoking a token is anyone's with a name.
  Read-only readers have no channel, and their streams carry no message. Where a writer was is
  handed to agents, never sent to pages. A link copied from the page (Copy link, the conversation's
  box) carries no key: only Share's links let anyone in.

## Secrets at rest

The site folder (`--site`) holds the agents' tokens and the read-only links in full (Share shows
them again), the personal links' digests, and the conversations (`chat/`: the public channel 90
days, the private ones 30); the access key is
wherever `--access-key-file` names. Keep both readable by the server's user alone, back the site
folder up as you would any secret, and never commit it.

## Code at rest

The caches' root (`--cache`, by default `~/.cache/visualproof/`) holds, in `versions/`, the patches
a server downloaded, which the supervisor runs: it is code, as the installed package is; and in
`media/` the tips' tour film, checked against the package's sha256 (refused, as `versions/` is,
where another may write the folder). `versions/`
is made `0700`; a folder in it that another user owns, or that its group or others may write, is
refused and its patch never run. Keep the caches' root the server's user's alone, as the site. A branch the server follows is
cloned and built in `deploy/` of the caches' root: the clone, its build's outputs and its
dependencies, which the server's Lean programs import; and each build's log.

## Deploying

- Run the server as an unprivileged user, never as root. A server that follows a branch, as a user
  of its own (above: whoever can push to the branch runs code as that user).
- Give it `--access-key-file`, or an authenticating proxy that is the only way in; `--public` only
  for a project meant to be public.
- Put TLS in front of anything that leaves a trusted network.
- Keep the project's toolchain, Poppler and Node up to date. A server takes VisualProof's patches
  by itself (`--updates auto`); a newer minor version is told of in its log, `visualproof doctor`
  and the page's help, and installed by hand. On a machine that must not reach the network, give
  `--updates off`.
