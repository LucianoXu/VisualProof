# VisualProof's MCP server

`GET /api/agent/mcp` serves it (a token of your own): one file, `visualproof-mcp.mjs`, no
dependencies, Node 18 or later. An MCP client runs it as a local (stdio) server with, in its
environment, `VISUALPROOF_URL` (the server), `VISUALPROOF_TOKEN` (your token) and
`VISUALPROOF_WAIT_SECONDS` (the longest `wait_for_message` waits: 1800 by default; **50** for a
client that ends a tool call after a minute whatever it reports, such as Claude Desktop).

It takes its tools from the server (`GET /api/agent/mcp/tools`: the instructions for the model —
the server's address and project, who you are and when your token expires —, each tool with the
request it makes, and the documentation's topics), so it never needs an update when the API
changes. A tool of one domain's operations takes an **`action`**; each tool offers only the actions
your level allows, with their arguments; a tool allowing none is not offered. The server still
refuses what your level does not allow.

## The tools

Each wraps the endpoints of a topic, which says what their answers hold. `*`: the default action.

| tool | actions (level beyond read) | endpoints, topic |
|---|---|---|
| `docs` | — (`topic`; none: the index) | `GET docs`, this documentation |
| `companion` | — | `GET companion`, [following](following.md) |
| `search` | — | `GET search`, [reading](reading.md) |
| `declaration` | — (`name`, or `names` for several) | `GET declaration`, [reading](reading.md) |
| `source` | `source`\*, `context`, `module` | `GET source`, `context`, `module`, [reading](reading.md) |
| `lean` | `describe`, `print` | `GET describe`, `print`, [reading](reading.md) |
| `refs` | `uses`, `users` | `GET uses`, `users`, [tcb](tcb.md) |
| `review` | `targets`, `tcb`, `keys`, `why` | `GET targets`, `tcb`, `keys`, `why`, [tcb](tcb.md) |
| `activity` | — | `GET activity`, [history](history.md) |
| `opinion` (advise) | `give`\* (`name`…, or `opinions`), `withdraw` | `POST opinion`, `opinion/withdraw`, [advice](advice.md) |
| `view` | `move`\*, `link`; `ask_follow` (advise) | `POST view`, `view/link`, `ask-follow`, [following](following.md) |
| `wait_for_message` | — (no arguments) | `GET inbox`, below and [talking](talking.md) |
| `reply`, `status`, `conversation`, `channel` | — | `POST reply`, `POST status`, `GET conversation`, `GET channel`, [talking](talking.md) |
| `notes` | `list`; `write`, `edit`, `move`, `delete` (advise; anyone's at full) | `GET notes`, `POST note`, `note/edit`, `note/move`, `note/delete`, [notes](notes.md) |
| `views` | `list`, `read`, `open`; `create`, `duplicate`, `rename`, `delete`, `scope`, `items`, `focus`, `link`, `arrange`, `relayout` (full) | `GET views`, `views/view`, `POST views/…`, [views](views.md) |
| `pins` | `place`; `pin`, `undo` (full) | `GET place`, `POST pins`, `undo`, [views](views.md) |
| `mark` (full) | `target`, `key` | `POST target`, `key`, [tcb](tcb.md) |
| `trust` (full) | — | `POST trust`, [tcb](tcb.md) |
| `library` | `list`, `file`, `text`, `search`, `page`, `clip`, `save`; `add_url`, `add_file`, `edit`, `archive` (advise) | `library/…`, [library](library.md) |
| `links` | `list`; `make`, `edit`, `remove` (advise) | `GET links`, `POST link`, `link/edit`, `unlink`, [library](library.md) |
| `history` | `snapshots`, `diff`, `moves`, `last`, `lost`, `archived`; `attach`, `unmove`, `archive` (full) | `history/…`, [history](history.md) |
| `export` | `model`, `typeset`, `job`, `file`, `artwork` | `export`, `export/job`, `export/file`, `artwork`, [export](export.md) |

Paths are under `/api/agent/`; `history/graph` has no tool (large: over HTTP, [history](history.md)).

- **Files.** `export` (`file`) and `library` (`save`) do not hand the model a file's bytes: they
  save it as `saveTo` names it, an absolute path on your machine, never over a file that exists.
  `library` (`add_file`) reads the file `path` names on your machine and sends its bytes. `library`
  (`page`, `clip`) hands you the page as an image.
- **Resources.** The documentation is also offered as MCP resources, `visualproof://docs` (the
  index) and `visualproof://docs/<topic>`, Markdown.
- **The instructions** it gives the client (at most 2,048 characters, as Claude Code keeps them) say
  where you are and who, to listen, how to answer, and that the `docs` tool explains the rest.

## `wait_for_message`

No arguments. It holds your inbox open, in requests of at most 50 s, until a message comes, and
returns at once:

```
A message from the page, after 3.0 s of listening:

Alice wrote to you, in your private channel, on the view "TCB of flt_regular", looking at IsRegularNumber (message 1, 2026-10-12T22:21:31.672Z):
Why does flt_regular need IsRegularNumber at all?

Answer with reply (move your own view to what you explain first, with view), then call wait_for_message again.
```

A mention in the public channel reads "Bob wrote in the public channel, mentioning you"; `reply`
goes back there. Once the longest wait is over: `Nothing: no one wrote in 30 min. Call
wait_for_message again to go on listening.` The first call after you join may bring the earlier
messages first ("Earlier in this conversation, before you joined — …"), and a new conversation its
notice; neither is to be answered ([talking](talking.md)).

- Its waits name its session (`X-VisualProof-Session`, a random id per process), so VisualProof
  knows a new session even when the one before ended without saying it left.
- While it waits it sends `notifications/progress` about every 30 s (`VISUALPROOF_PROGRESS_SECONDS`)
  with the request's `progressToken`, so a client that ends idle calls does not end it (Claude
  Code's stdio idle timeout, 30 minutes, is reset by progress).
- A server it cannot reach is asked again within the wait (after 1, 2, 5, 10, 30 s). A call the
  client cancels (`notifications/cancelled`: Esc in Claude Code) ends its request at once,
  unanswered. A second wait takes the first one's place, which says so (`replaced`).
- When the token ends it says so (who revoked it, or when it expired), and so does every wait
  after. When its client goes (stdin closes, or a signal) it tells the server you left: offline at
  once. An `initialize` asking for a revision it does not speak is answered with `2025-11-25`.

## Installing it

`GET /api/agent/mcp/install` says how, per client, as plain text; Share's prompt gives Claude Code's
steps: download the file to `~/.visualproof/visualproof-mcp.mjs`, `claude mcp add --env
VISUALPROOF_URL=<server> --env VISUALPROOF_TOKEN=<token> --env VISUALPROOF_WAIT_SECONDS=1800
--transport stdio visualproof -- node "$HOME/.visualproof/visualproof-mcp.mjs"`, then the person
restarts the session in the same folder (`claude --continue`): MCP servers load when a session
starts. The agent then listens at once: `wait_for_message`, `reply`, `wait_for_message`…

While `wait_for_message` waits, what the person types in Claude Code waits until the call returns,
unless they press Esc, which ends the wait: the agent does what they ask, then listens again. Claude
Code (2.1.212 and later) moves a call still running after two minutes to the background: the agent
may end its turn, what the person typed is taken, and the wait's result arrives as a task
notification that gives the agent a turn of its own. The agent does not call `wait_for_message`
again meanwhile: a second wait would take the first one's place.

An MCP server older than 0.5.0 does not know actions: download it again and restart the session.
