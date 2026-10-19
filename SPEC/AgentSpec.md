# VisualProof Agent Spec

Supplements SPEC.md, "Agent". docs/agent-api/ is the agents' manual (served by
`GET /api/agent/docs`, a topic a page): every endpoint, parameter and answer, the tokens and the MCP server. Access
and tokens at rest: SECURITY.md. Presence, following and Share: CollabSpec.md.

## Decisions

1. **An agent is a user, marked as one.** It gives a name and says it is an agent
   (`X-VisualProof-Kind: agent`), or comes with a token of its own that says both (decision 7). It
   is listed among the people with its own mark, can be followed, and the timeline says what it did.
2. **Its opinions are advice**, at every level, full included. An agent's approve or comment is
   recorded in its own review log (ReviewSpec decision 5), with its text, marked as an agent's; it
   never counts towards a target's progress, never makes a declaration approved, commented or stale
   for people, and is shown apart ("Claude suggests: approve", "Claude comments"). People's
   opinions are the review; an agent's is a pre-review that points them where to look first.
3. **The interface is a JSON API** made for the questions an agent asks rather than for drawing a
   page, on the same server, review and rules as the page.
4. **Layout at level full** (decision 9): an agent drops and lets go of pins under its name; each
   request is one batch in the timeline, which anyone can undo at once.
5. **Pointing people at something.** An agent writes notes as people do (AttachmentSpec decisions
   12–20, ViewSpec decision 23): of the project by default, or a view's own; at a cluster, beside or
   attached to a declaration, or on the ring; carrying library files and clips of their pages. The
   timeline records them under its name, marked. It never moves anyone's view; people following it
   see what it looks at. It can also hand people a link to what it looks at, or to a place it
   describes, as Share's *Exactly what I see* makes one (CollabSpec decision 7); making it moves
   nobody, and the link carries no key.
6. **The first use: a pre-review of a target's TCB.** The agent walks the TCB in review order,
   reads each declaration and what Lean says about it, and gives advice with reasons. People start
   with what it comments on: the review strip counts the declarations agents comment on, and the
   target's review list marks them. Nobody has a *Next to review*: an agent reads the review set as
   a list (`GET /api/agent/tcb`, in review order; key declarations first with `key=first`).
7. **Sharing with an agent.** Share's *AI agent* tab makes a token and a prompt that any agent able
   to make HTTP requests can act on alone; for everything else the prompt points at
   `GET /api/agent`, which must suffice for an agent new to VisualProof.
   - **Three choices**: the agent's name, its level and how long its token lasts. The prompt says
     who the agent is, its level and expiry, the server's address, the token, how to set up the MCP
     server (decision 8) and the ground rules; nothing of where the person is or what they want
     (they tell the agent; the companion says where they are).
   - **The name** is the one given, used as it is, by default "<their name>'s AI". It is unique among
     the tokens in force ("Alice's AI 2") and fixed for the token's life, so the review log's writer
     stays the same.
   - **A token per share, never the key.** The token fixes the agent's name (the identity is the
     token's, not the headers') and its level (read, advise or full; advise by default; at most the
     server's `--agents`); lasts 1, 7 (the default) or 30 days; reaches the agents' API only; and can
     be revoked at once.
   - **The prompt can be shown again** from Share while the token is in force, to its maker alone
     (the owner's decision of 2026-10-19: whoever holds the token reads the agent's private channel,
     decision 8); agents are refused. Its maker is the personal link that made it, where an invited
     person made it (CollabSpec decision 9), else the name it was made under. So the server keeps
     each token's secret in the site's token file, readable by its owner alone like the access key:
     whoever can read that file can read the key, and with the key make a token of their own.
     Revoking stays anyone's with a name, so that anyone can stop an agent at once.
   - **Companion**: an agent can see where every person is (view, mode, selection, the panel's
     declaration, the source windows) and wait until someone moves, to follow the people it helps.
8. **Talking with agents in the page** (the owner's decisions of 2026-10-19, which replace one
   conversation per agent shared by everyone).
   - **Two places** (CollabSpec decision 13): the public channel, where everyone with a name and
     every agent talk; and each agent's private channel with its maker (decision 7), which nobody
     else sees. There is no other private channel. The conversation window is the reader's own and
     has nothing to do with following.
   - **Agents listen; nothing is pushed.** An agent waits for messages (`GET /api/agent/inbox`, or
     the MCP server's `wait_for_message`); a wait returns the moment one is handed to it, with who
     wrote it, where they were and in which channel, or with nothing at the end of the longest wait.
     Handed to it: its maker's messages in its private channel, and a person's message in the public
     channel that mentions it (`@` and its name). Nothing else in the public channel is handed to it;
     it reads the channel when it wants (`GET /api/agent/channel`). **An agent's mention of another
     agent is shown, never handed**: no two agents talk on without a person.
   - **The agent listens by itself**, once set up and again after each answer; interrupted by its
     person (Esc ends the waiting call), it does what they ask, then listens again. The prompt, the
     install text and the entry say so.
   - **States**, inferred by the server, shown in the presence bar and the conversation window:
     *listening* (a wait open); *thinking* (from a message handed over until a reply or a new wait,
     with the time elapsed and what its requests show it doing); *working* (requests with nothing
     to answer); *offline* (no wait open and no request for as long as the wait it last asked for,
     plus 60 s). Its `status` line, in its own words, shows with the state until it replies or waits
     again.
   - **Messages queue** while it thinks or works and all come at its next wait, in order. An offline
     agent's private channel cannot be written to (409); a mention of it in the public channel is
     posted, and handed to it when it comes back.
   - **A new session picks up the conversation.** When the agent comes back from offline (it left,
     or went offline by the rule above), its first wait returns at once with its private channel
     since the last divider and the mentions it was not handed, labelled as earlier and to be read
     as context, not answered again; then anything new. Once per return. Nothing on the agent's
     machine needs to change for this.
   - **A new conversation**: its maker may start one in its private channel (also with an offline
     agent), at the rate of their messages. It appends a divider (same file, kept as long) with who
     and when; pages fold what came before it into one line. A divider right after a divider does
     nothing. The running agent is handed a notice at its next wait (at once if it listens): "X
     started a new conversation: disregard what came before." The page cannot erase what a running
     session holds (only `/clear` in its terminal can; the button's tooltip says so); later
     sessions are given only what follows the last divider. The public channel has no dividers.
   - **Its answers**: text (Markdown, declarations' names as links, links of the site shown as what
     they lead to, CollabSpec decision 13; no HTML), in the channel it answers — by default the one
     of the message it was handed last; it may also write in the public channel unasked. It moves
     its own view to what it explains, never anyone else's. Following an agent shows what it looks
     at, never its conversations.
   - **Asking people to follow it** (CollabSpec decision 10), at advise and full: everyone (private
     readers counted, never named) or one person by name, one request per 30 s. The banner says it
     is an agent. The agent is told who follows, declined or did not answer. Agents cannot be asked
     to follow.
   - Every agent with a token reads and writes the public channel and talks with its maker,
     whatever its level. Messages are untrusted input, the public channel's above all: the agent
     can do no more than its token allows, whoever asks. The ground rules (the prompt, the entry)
     tell it to take a request in the public channel as a request, and to ask its maker before
     changing the board on someone else's word. The channels are kept in the site, apart from the
     review's logs (the private ones 30 days, the public one 90); sending is rate-limited.
9. **Three levels.** An agent's level is the lower of its token's and the server's `--agents`.
   - **read**: it reads, shows what it looks at, typesets documents (ExportSpec decision 11),
     makes links to pictures of the board (ExportSpec decision 20, drafted 2026-10-15), and talks
     (decision 8).
   - **advise**: also advice (decision 2), notes (decision 5), files and links of the library
     (AttachmentSpec decision 20), its own changed, moved, archived or deleted; asking people to
     follow it (decision 8).
   - **full**: whatever a person can do through the page — targets and key declarations, trust
     (the outside world too), views (make, rename, duplicate, delete, rescope, arrange, fold, lay
     out), pins and undo, anyone's notes, files and links. Two things hold at every level:
     - **its opinions stay advice** (decision 2);
     - **agent tokens stay with people**: no agent makes, lists, shows or revokes a token (an agent
       that could make tokens could outlive its own revocation), nor makes, lists or revokes
       personal links (CollabSpec decision 9).
   - **Who did it is always recorded**, under the agent's name and marked: what goes into the
     review (targets, key declarations, trust) in its own log (`….agent.jsonl`, ReviewSpec decision
     5), every line marked; in the timeline what is an event there; on the board's notes what is not
     (a rescope, folds, pins; ViewSpec decision 9). People always see it was an agent, and undo it
     as anyone's. The level is checked when an event is written; a log read back from disk is
     replayed as written.

## Implementation notes

What docs/agent-api/ documents (endpoints, parameters, answers, the limits an agent meets, the
token's rules, the inbox, the MCP server's environment and tools) is not repeated here.

### The API (decisions 1–6)

- `GET /api/agent/endpoints` lists the server's endpoint table (server/agent.ts), so the reference is
  the code's own, and the entry (`GET /api/agent`) names the most used from it; each MCP tool, or
  each action of one, is an endpoint of it (server/mcptools.ts), served to the MCP server
  (`GET /api/agent/mcp/tools`), so a change of the API needs no new file on the agent's machine.
- Nothing checks `X-VisualProof-Kind`: the kind is what makes opinions advice, so an agent that does
  not say it is one passes for a person. `current()` (shared/review.ts) is people's opinions only,
  so every count, status, colour and queue ignores advice; `advice()` reads the agents'.
- The API reads the graph with the page's own shared code, so an agent and a page see the same
  graph, review queue, search and context.
- A note is the agent's own where an agent of its name wrote it. Notes, layouts and view changes go
  through the page's path (server/views.ts), so their author and timeline events are as a person's.
- **Presence**: an agent without a token is one entry per name, kept by its requests (at most 32
  listed). An agent with a token is one entry per token, listed while the token is in force, so
  nobody can speak for it by giving its name.

### The library and its links (AttachmentSpec decision 20)

- Writes are checked against who made what by the same methods as the page's routes ("One way in
  per operation, two doors"), and land in the agent's own log, marked `agent`. A file new to the
  library is carried by a note of the project on the ring, under the agent's name (AttachmentSpec
  decision 12). An upload's body is the file's bytes, not JSON.

### Sharing with an agent (decision 7)

- **Tokens** (server/tokens.ts): `vpa_<10 hex id>_<32 random bytes, base64url>`. The site keeps
  `agent-tokens.json` (mode 600): the secret, id, name, level, maker (and the maker's personal
  link's id, `makerPerson`, where an invited person made it), created, expires, revoked (by whom),
  lastUsed; pages and the API see all but the secret. A token is found by its id and compared
  in constant time, by digest (an unknown id against a fixed digest). lastUsed is written at most
  once a minute and when the server stops. An ended token's prompt is never shown; ended tokens are
  forgotten 30 days after they ended. A record without its secret is dropped.
- **The name** is the one given, or "<maker>'s AI" (the maker's name shortened to keep within 60
  characters), numbered " 2", " 3", … while another token in force has it in any case, fixed at
  creation. With a token the name and kind headers are **ignored, not refused**.
- **Scope** (server/main.ts): a `Bearer vpa_…` is looked at before the access key. A token above
  the server's level is refused when made (400); the level is held to `--agents` as it is now. The
  page's endpoints (`/api/share/agents`, `…/prompt`, `…/revoke`) refuse agents (403) and, but the
  list, need a name; the prompt, the token's maker (decision 7: the personal link where the record
  has one, else the name, as `sameName` compares names; 403 to anyone else). The prompt is asked for
  by POST, so the browser sends its Origin and the prompt names the server the same way each time.
- **The prompt** (server/prompt.ts) is made from the token and its record alone: who invites the
  agent, the server's address (`--public-url`, else the page's Origin where it names the Host, else
  `http://<Host>`), the token as a secret, who the agent is, its level and expiry, "start with GET
  /api/agent", the MCP server's setup for Claude Code (with a restart of the session, since MCP
  servers load when a session starts), the same over HTTP, and the ground rules.

### Talking with agents (decision 8)

- **The inbox** (server/talk.ts): a wait that ended at its time counts as open 15 s longer, so an
  agent asking again at once is not shown leaving. A wait whose connection closes is over, so
  nothing is handed to nobody. Messages written before the server started count as read. Each
  entry says its channel (`private`, or `public` for a mention); a reply (`POST /api/agent/reply`)
  names the channel it goes to, by default the channel of the last message handed to it to answer
  (`private` before any).
- **Who takes part**: only agents with a token, whose presence entry is the token's, so nobody
  speaks as one by giving its name; an agent known by its headers alone neither reads nor writes
  a channel (403).
- **The private channel**: `<site>/chat/<token id>.jsonl`, kept 30 days. Read, written and divided
  by the token's maker alone (decision 7; 403 to anyone else, agents included, and nothing of it on
  their pages' streams). A divider is a line `{kind: "divider", from, text}`, its text the agent's
  notice. `POST /api/chat/new {agent}`: from its maker (401 without a name; 403 to anyone else), on
  their message rate (429); where the conversation is empty or ends with a divider it answers
  `{ok, unchanged: true}` and writes nothing. A divider needs no answer, so it does not make the
  agent *thinking*.
- **The public channel** (CollabSpec decision 13) for agents: `GET /api/agent/channel?since=<id>`
  reads it (`limit`, 50 by default, 200 at most), and the reply writes there with `channel:
  "public"`. A mention is `@` and a name as listed (shared/mentions.ts), matched as names are
  (`sameName`), the longest that fits, nothing of a name going on after it nor before its `@`; a
  person's message mentioning several agents is handed to each. The agents it is handed to are
  fixed as it is written — those mentioned that are listed then — and kept with it in the file
  (`to`), told to nobody.
- **The first wait after offline**: a mark is set by a request that finds the agent offline, by its
  leave, and by a wait whose `X-VisualProof-Session` differs from the last one's. A first request
  since the server started is marked only where the token's `lastUsed` is older than 1800 s plus
  60 s, or never, so a session that listened across a restart is not. The first wait finding the
  mark clears it and answers at once with one entry `{id: 0, kind: "earlier", from: "VisualProof",
  text, count, omitted, missed?}` (the newest messages of its private channel since the last divider
  and the mentions it was not handed, in order, at most 50 and 20,000 characters), then the new
  messages. `text` holds it all, so an MCP server that shows only `from`
  and `text` shows it whole. It does not make the agent *thinking*. `missed` counts the mentions
  among it, which came while it was away and were never handed to it: the entry says it may answer
  one in the public channel where it still asks something of it (the rest is not to be answered
  again).
- **The MCP server** (src/mcp/visualproof-mcp.mjs) only relays; tools and actions the token's level
  does not allow are left out of its list.
  - `wait_for_message` holds the inbox open in requests of at most 50 s (a proxy may close a
    connection silent for a minute, and fetch gives up on an answer not begun in five) until a
    message comes or `VISUALPROOF_WAIT_SECONDS` (1800) is over. Meanwhile it sends
    `notifications/progress` with the call's `progressToken` every 30 s, which resets Claude Code's
    30-minute idle timeout for stdio calls. A cancelled call ends its request, unanswered.
  - A server it cannot reach is asked again within the wait (after 1, 2, 5, 10, 30 s); 401, 403 or
    404 end the wait for good. Where VisualProof cannot be reached when it starts, it lists a
    stand-in `connection` tool and sends `tools/list_changed` once it can.
  - Its waits send `X-VisualProof-Session`, a random id per process, so that a session that ended
    without leaving (killed) is still told from a new one. When its client goes (stdin closes, or a
    signal) it sends the agent's leave, so people see it offline at once.
  - It speaks MCP revisions up to 2025-11-25 and answers a client asking for another with that one.
    Its instructions stay within the 2,048 characters Claude Code keeps, with 60-character names.
  - The instructions, the prompt, the install text, the entry and the wait's descriptions all say
    that the first wait after the agent joins may bring earlier messages, to read and not answer;
    that a message comes from its maker or from the public channel, and a reply goes back where it
    came from; and the public channel's ground rule (decision 8).
- **Input methods**: an Enter that commits a composition (pinyin, say) only commits it, in the
  conversation's box and in every field that acts on Enter: while composing, with keyCode 229, or
  within 80 ms after `compositionend` (Safari sends it then).
- **The page**: every message, a person's as an agent's, is escaped first, then given bold,
  italics, code, fenced code, declarations' names (full, or a dotted suffix only one declaration
  has) as links, and links (CollabSpec decision 13). A person's message to an agent not yet handed
  over is marked "not read yet": in a private channel, by its agent; in the public channel, by each
  agent it mentions that is listed ("not read yet by …").

### Asking people to follow it (decision 8)

- `POST /api/agent/ask-follow` is a person's request (CollabSpec, "Requests to follow") from the
  agent's presence entry, under its name, marked `agent`; its rate is counted per token (else per
  name). An agent not listed (one without a token beyond the 32) is refused (409). The answer waits
  for the request to end, every page answered or 30 s and 3 s, or for the agent to go away.

### Level full (decision 9)

- **One way in per operation, two doors.** Every operation of decision 9 has an endpoint in the
  agents' API and an MCP tool (or a tool's action). The page's own API, reached by an agent with its headers, checks the
  level and records the request as the agent's: `POST /api/review` (an opinion at advise, anything
  else at full), `/api/views/*` but opening one, `/api/layout/undo` (full). The same code is behind
  both doors. A token still reaches the agents' API alone, so the page's API meets only agents known
  by their headers, at the server's `--agents`: widening a token's reach would widen what a leaked
  token opens, for nothing the agents' API lacks.
- **The review's format** (shared/review.ts): every event may carry `agent: true`, set by the server
  from who asks. Every line of an agent's log carries it; a line there without it, or one with it in
  a person's log, is a problem (it would pass for the other). The replay keeps the mark on targets
  and key marks; the timeline's `untarget`, `trust` and `untrust` carry `agent`, as views', layouts'
  and notes' do.
- **The page**: Activity marks these as the agent's (the robot, "(agent)", the Agents filter); "My
  targets" leaves out what an agent of the reader's name marked. Notes on a board name an agent
  without its robot.
