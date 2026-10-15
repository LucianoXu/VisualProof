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
- **The project's toolchain**, which elan installs, and Lean's own kernel and language server.

## What a running server exposes

- **The network.** It listens on `127.0.0.1` unless given `--host`. Beyond this machine, let in
  only the people meant to be there: `--access-key-file` admits those given the access link
  (`/k/<key>`) or a personal link made in Share (`/i/vpp_…`, revoked on its own), and answers
  everything else 404; or put an authenticating proxy in front. Agents send the key, or a token
  made in Share (`vpa_…`), which reaches the agents' API alone and lasts a few days.
- **Read-only readers.** Anyone let in can make a read-only link in Share (`/r/vpr_…`): it lets
  whoever holds it read what a guest reads — the graph, the sources, the review, the history, the
  library's files — and nothing else. The server refuses every other request from them (403)
  whatever the page sends, never lets them reach the agents' API, and bounds what they cost:
  Lean's answers at 60 a minute per address and 300 in all (429 beyond), kept per build; one
  printed document typeset at a time for all of them; 400 event streams of their own; git, for the
  project's commit, run at most once every 3 seconds whoever asks. A link lasts
  until revoked, which ends its pages at once. With `--public` the address alone makes a read-only
  reader of whoever comes without the key or a link: it puts the whole project, its review and its
  library online, so give it only to a project meant to be public.
- **The project's git remote.** Where the project is a git repository, the page is told its remote's
  address and the commit checked out, read when a page asks (`GET /api/git`; an artwork's foot shows
  them): the host and path alone,
  never a user name, password or token written into the remote's URL, and nothing for a remote that
  is a path on the machine. Git is only asked, never written to.
- **Links that save a picture.** A link to an artwork (ExportSpec decision 20) carries its recipe
  after `#`, unsigned: anyone who can send a reader a link — not only an agent the server answered —
  can make it, and make the reader's browser save the picture the page draws of the board, PNG or
  SVG, at most the largest size an artwork has (16,384 pixels a side), as Save PNG and Save SVG
  would. Nothing else: the page reads the recipe as settings, the browser asks before a site saves
  several files, and the link holds no key.
- **The artwork command.** `visualproof artwork` reads the build, the cache and, with `--site`, the
  site (the review, the views); it never writes the site or the project. It writes its files and
  the cache, as `visualproof export` does, and runs no Lean but the usage pass's (`--jobs`).
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
- **Uploads.** PDFs and images of at most 50 MB each, the library at most `--library-limit` (2 GB
  by default). The server reads PDFs with Poppler: keep it up to date. Pages draw them with pdf.js,
  whose script engine is never served, so a PDF's JavaScript does not run.
- **Agents.** A token has a level: `read`, `advise` or `full` (and `--agents` caps it for the whole
  server). At `full` an agent can do whatever a person can through the page; its opinions stay
  advice and are never counted.

## Secrets at rest

The site folder (`--site`) holds the agents' tokens and the read-only links in full (Share shows
them again), and the personal links' digests; the access key is
wherever `--access-key-file` names. Keep both readable by the server's user alone, back the site
folder up as you would any secret, and never commit it.

## Deploying

- Run the server as an unprivileged user, never as root.
- Give it `--access-key-file`, or an authenticating proxy that is the only way in; `--public` only
  for a project meant to be public.
- Put TLS in front of anything that leaves a trusted network.
- Keep the project's toolchain, Poppler and Node up to date.
