# Requests, answers and tokens

How to talk to the API: the form of requests and answers, errors, tokens, and the three endpoints
that describe the API itself. The rules are in the [index](README.md).

## Requests and answers

- `GET` parameters go in the query string, URL-encoded (`curl -G --data-urlencode name=…`).
- A `POST` body is a JSON object, `content-type: application/json`, at most 1 MB (a larger one is
  refused with 413).
- Names are full Lean names (`FltRegular.CaseI.f0k₁`), as `search` returns them.
- **A server that lets in only those given its link** (`--access-key-file`) answers 404 to
  everything, `/api/agent` included, unless the request carries `Authorization: Bearer <key>` (the
  key is the last part of the link you were given, `…/k/<key>`) or an agent token of its own,
  `Authorization: Bearer vpa_…`. **A server without a key** answers only its IP addresses,
  `localhost` and the names it was given (`--public-url`, `--allowed-host`): another name is 403,
  in plain text — use the address your prompt gives.
- Every answer is JSON — but the documentation, the MCP server's file and install text, and the
  files you download. **Every error
  is `{error, hint}`**: what went wrong and what to do. A name that does not exist answers 404 with
  `didYouMean` (the same name in another case, a typo or two away, then search hits). A name the
  graph folds into a declaration ([words](words.md), Folded names) is answered for that declaration.
- **503 with `Retry-After`** (and `retryAfter` in the body): ask again after that many seconds — the
  graph is still being read, or Lean is still loading a module's imports.
- **Several at once.** One request can carry what would otherwise take several:
  `declaration?include=…` (a declaration with its source, context, references and what Lean says),
  `declaration?names=…` or `declarations?names=…` (up to 25), `POST opinion {opinions}` or
  `POST opinions` (up to 100 pieces of advice). Each part or item is answered on its own: one that
  fails says why, with its own `status`, and does not refuse the others.

```bash
H=(-H "Authorization: Bearer $TOKEN")      # or: -H "X-VisualProof-Name: Claude" -H "X-VisualProof-Kind: agent"
B=$VISUALPROOF/api/agent                   # the server's address (http://127.0.0.1:4173 by default), then /api/agent
curl -s "${H[@]}" "$B"                                   # the entry
curl -s "${H[@]}" -G "$B/declaration" --data-urlencode name=IsRegularPrime \
  --data-urlencode include=source,context,uses
curl -s "${H[@]}" -H "content-type: application/json" -X POST "$B/opinion" \
  -d '{"name":"<a declaration>","verdict":"approve","comment":"<your reasons>"}'
```

The examples in these pages are real answers from a server showing
[flt-regular](https://github.com/leanprover-community/flt-regular) at `bd81b78ba6` (Lean
v4.33.0-rc2), shortened (`…`); the people (Alice, Bob) and what they marked are made up, and so is
`MyProject.Example.halve` and what is said of it wherever a comment faults a declaration, so that no
example faults a real one. The history's examples follow an edit made for them: one theorem
deleted, another renamed.

## Tokens

Share in the page (*AI agent*) makes a token for one agent and a prompt that carries it. A token:

- is `vpa_<id>_<secret>`, sent as `Authorization: Bearer vpa_…` with every request. It is a secret:
  never print it, and store it nowhere but where a tool's configuration needs it — e.g. a curl
  config readable by you alone (`umask 077; mkdir -p ~/.visualproof; printf 'header =
  "Authorization: Bearer %s"\n' "$TOKEN" > ~/.visualproof/curl.cfg`, then `curl -K
  ~/.visualproof/curl.cfg …`). The server keeps it, readable by its owner alone, so that people can
  show your prompt again from Share while the token is in force (agents are refused that).
- **fixes who you are**: the name you act under is the one the person gave you, as they wrote it —
  by default theirs with "'s AI", `Alice's AI` — numbered while another agent in force has it
  (`Alice's AI 2`), the same for the token's life: your advice, notes and layouts are recorded
  under it. You are an agent whatever you say: `X-VisualProof-Name` and `X-VisualProof-Kind` are
  **ignored** with a token, never refused (the entry says so in `you.note` when a request named
  someone else).
- **fixes what you may change**: `read`, `advise` (the default) or `full`, chosen by the person, at
  most the server's `--agents` at the time — and held to the server's as it is now, should it be
  restarted with less. A refusal says which of the two refused (403, with a hint).
- **reaches this API only**, `/api/agent/*`: the page, its data and the page's own API answer a
  token 404, as they answer anyone who was not let in.
- **lasts** 1, 7 (the default) or 30 days, and can be **revoked** from Share by anyone with a name.
  An expired or revoked token is answered **401** at once, `{error, hint}` saying which and when
  ("This token was revoked by Alice at …"); ask the person for a new one. A token that is not one of
  the server's is answered as an outsider is (404 where the server keeps people out, 401 where
  anyone may come in).

## `GET /api/agent` — the entry

What an agent reads first, small on purpose (about 5 KB): `about`; `you` (`name`, `kind`, `level`,
`may: {read, advise, full}`; with a token `token: {id, madeBy, level, expires}`, and `note` where a
request named someone else; without one, `warning` / `warningName` where a header is missing);
`level`, what it lets you do; `requests`, how to send them; `start`, the first requests for an agent
new here; `rules`, every rule in a line; `docs` and `topics`, where these pages are; `endpoints`, the
most used, in a line each (a level they need in parentheses); `errors`; `graph` (`project`,
`version`, `declarations`, `external`, `targets` — how many —, `trusted`; null until the graph is
read).

## `GET /api/agent/docs` and `GET /api/agent/docs/<topic>`

The [index](README.md), and each topic, as Markdown (`text/markdown`); `?topic=<topic>` is the same
as the path. An unknown topic is 404, with the topics in `topics`.

## `GET /api/agent/endpoints?path=`

Every endpoint as the server's own table says it: `{endpoints: [{method, path, about, params,
returns, needs?}]}` — `params` the query parameters of a GET or the JSON fields of a POST, `needs`
the level beyond `read` it takes (`--agents advise or full`, `--agents full`). `path=/api/agent/tcb`
(or `path=tcb`) keeps that path's; one no endpoint has is 404.
