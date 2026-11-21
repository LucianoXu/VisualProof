# VisualProof Call Spec

A video call among the people on a server — camera, microphone, screen — in a window of the page,
beside the board they look at together. It runs on a LiveKit server (https://docs.livekit.io) that
whoever runs VisualProof names; the media never passes through VisualProof. What it trusts and
exposes: SECURITY.md, "Calls". For users: docs/MANUAL.md, "Calls". The call's model and much of its
code come from Cocoding's meetings (LemmaLight), adapted to VisualProof's people, its windows and
its event stream (the owner's decision of 2026-11-20: that code may be public).

## Decisions

The owner's decisions of 2026-11-20.

1. **Off unless the command line turns it on.** `visualproof serve … --livekit-url wss://… --livekit-keys
   <file|env>`: the server's calls run on that LiveKit server — the operator's own, or LiveKit
   Cloud; VisualProof depends on no deployment of anyone's. `--livekit-keys` names a file that holds
   `<key>: <secret>` (one line, the form of LiveKit's own keys file) or `env`
   (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). `--livekit-api <http(s)://…>` is where the server asks
   LiveKit (its room service), where that is not the address the pages use (a LiveKit on the same
   machine, at `http://127.0.0.1:7880`). Without `--livekit-url` there is no call: the page shows
   nothing of it, and its paths answer 404.
2. **One call per server**, as there is one workspace (CollabSpec decision 1). Its LiveKit room is
   `visualproof-<id>`, the id random and kept in the site (`call.json`), so that servers that share
   a LiveKit server never meet. A call's **session** lasts from its first participant until it has
   had none for 60 seconds.
3. **Everyone let in fully joins, as equals**: guests by the key, people invited by a personal link,
   anyone on a server without a key, the people a sign-in proxy names. Anyone in the call ends it
   for everyone, removes a participant, and invites someone who is here. A reader without a name
   gives one first, in the call's own window. A private reader (CollabSpec decision 8) goes visible
   to join: in a call one is seen. Agents have no place in a call.
4. **Read-only readers join only by a read-only link made to join the call.** A read-only link is
   made able to join the call or not (Share: *Can join the call*), and anyone let in fully switches
   it later. Its holder joins under a name they give, marked *read-only*, and is seen in the call
   alone — nowhere else on the page (CollabSpec decision 11). In the call they join and leave, and
   do nothing to anyone else. `--public`'s readers, and those of a link that cannot join, are
   offered no call.
5. **The call window**: a floating window (web/src/floatwin.ts), as the conversation window is —
   moved by its title bar, resized from every edge and corner, collapsed to a pill, in the windows'
   one order — and **maximized** by a button of its title bar (a floating window that has the
   button: the call's), which restores it again. It opens on the pre-join, at a medium size
   (720×480, the viewport permitting) at the bottom right of the board; at 640×400 and larger it
   shows the full call, smaller the compact call. Where the reader puts it and how large are their
   own, kept in this browser, and never followed (CollabSpec decision 4). On a phone and a tall
   screen it docks with the other windows (PhoneSpec decision 21), on an upright monitor in the
   work area (decision 34).
6. **The call link is a way in with `?call`**: no new kind of access. A page opened at an address
   with `?call` opens the call window on the pre-join at once; joining is one press, *Join now* (a
   browser starts a camera and sound only from a press). *Copy call link* — in the call window's
   title bar — copies the guest link as Share makes it (`/k/<key>` where the
   server has a key, the address where it has none), with `?call` and the view on show; Share's
   guest link has a switch *Join the call*. A read-only reader whose link joins the call copies
   their own link with `?call`; Share shows a read-only link that joins the call with it.
7. **Nothing is kept of a call**: no recording, no transcript, nothing in the timeline nor the
   site, as the following room keeps nothing. The server tells the pages who is in it (`call`).
   There is no transcription (the owner's decision); recording is for later, if decided.
9. **The camera's background blurred, and the call out of the page** (the owner's decision of
   2026-11-21, 0.12.1): the background None, Blur or Strong blur, chosen in the pre-join and in the
   camera's menu, run in the browser on a model and a runtime this server serves (never a third
   party's); and *Picture-in-picture*, which takes the call out of the page into a small window over
   every other — the call itself where the browser has Document Picture-in-Picture (Chrome, Edge),
   the large tile's video in the browser's own picture-in-picture elsewhere (Safari). No layout of
   its own for phones (the owner's decision).
8. **Following is how a call shows the board**: the call's controls hold *Ask everyone to follow
   me*, and a participant's menu holds *Follow* and *Ask to follow*, as their initials' does
   (web/src/peermenu.ts). Screen share is for anything else.

## As built

### The server (server/call.ts, server/livekit.ts, server/appcall.ts)

- **LiveKit, by hand**: an access token is a JWT signed with HS256 by the key's secret (`iss` the
  key, `sub` the identity, `nbf`, `exp`, `name`, `video` the grant); the room service is LiveKit's
  Twirp API (`POST <api>/twirp/livekit.RoomService/<Method>`, a JSON body, a token with `roomAdmin`,
  or `roomCreate` to delete the room). No LiveKit server SDK: nothing more on the server's side.
- **A participant's identity** is `p_` and 22 characters: an HMAC of the page's session (what a
  page calls itself in its event stream's address, which nobody else is told) under the call's
  secret, kept in `call.json` beside the room's id. A page that reloads is the participant it was,
  and LiveKit replaces the one it left behind; nobody can take another page's identity, though
  everyone in the call sees it; and a server that restarts knows its pages again as their streams
  come back, the call going on meanwhile on LiveKit.
- **A token** (`POST /api/call/token`) is given to a page's open event stream, by its secret, as a
  heartbeat is: it lasts 10 minutes (LiveKit gives a page in the call fresh ones), and grants
  joining the room, publishing the camera, the microphone, a screen and its sound, subscribing,
  sending data, and setting the page's own attributes (the raised hand). Its `name` is the
  reader's; the pages never read what LiveKit says of a participant's name: who each participant
  is comes from the server (`call`). At most 10 a minute per page.
- **Who is in the call** is LiveKit's list of the room's participants, read every 3 seconds while
  the call has a session or a token was given in the last 2 minutes, and after every join, leave,
  removal and end; nothing is read otherwise. A participant whose page's stream is closed, and has
  not come back for 45 seconds (a reload's, a restart's), is removed; so is one LiveKit lists whose
  identity is no page's at all. A page that goes says so (`POST /api/call/leave`, with
  `navigator.sendBeacon` as it goes).
- **Removed on purpose** — by someone in the call, or as its read-only link is revoked or stops
  joining the call, or its personal link is revoked —, a participant is removed again whenever it
  shows in the list, until a token is given for its identity again: LiveKit lets a token it gave
  join again, however it was removed.
- **Ending** deletes the room: every participant is disconnected at once, and the session ends.
- **The `call` event**, to every page at its stream's start and at each change, only where calls are
  on: `{session: {id, started} | null, participants: [{id, name, page?, verified?, readOnly?,
  joined}]}` — `page` the participant's page as presence lists it (none for a private or read-only
  page), so that the pages mark who is in the call among the initials and offer the person's menu.
  A page that is invited is sent `call-invite` `{from, at}`; one removed, `call-removed` `{by}`;
  the call ended, `call-ended` `{by}`.

| Method and path | Request | Response |
|---|---|---|
| `POST /api/call/token` | `{token, name?}` | `{url, token, identity, room}` |
| `POST /api/call/leave` | `{token}` | `{ok}` |
| `POST /api/call/end` | `{token}` | `{ok}` |
| `POST /api/call/remove` | `{token, identity}` | `{ok}` |
| `POST /api/call/invite` | `{token, to}` (a page's id in presence) | `{ok}` |

`token` is the page's stream secret (`hello`). The token answers 401 `{who: true}` without a name
(`name` is a read-only reader's), 403 to a read-only reader whose link does not join the call, to
an agent, and to a page with no open stream, 409 to a private page, 429 beyond its rate, 503 where
LiveKit cannot be reached; `end`, `remove` and `invite` answer 403 to a page not in the call and to
a read-only reader. Read-only links (`/api/share/readonly`) take `{call}` when made, and
`POST /api/share/readonly/call {id, call}` switches one; `/api/identity` says to a read-only reader
whether their link joins the call (`readOnly.call`).

### The page (web/src/call/, web/src/pagecall.ts)

- **Loaded when wanted**: the call's code and LiveKit's client are a bundle of their own
  (`call.js`), loaded the first time the call window opens; the page does not carry them otherwise.
- **The call button** (`#call-btn`, in the bar beside the conversations): the number of people in the
  call, in the accent's colour while it runs; pressed, the call window in front (on the pre-join,
  or the call); pressed again with the window in front, the call collapses to its pill, the
  pre-join closes. On a phone it is an item of ⋯. Its notice (`#call-notice`) says that someone started the call, with *Join*,
  to the pages not in it; that someone invites the reader, for 60 seconds, with *Join* and a short
  sound; that they were removed; that the call was ended.
- **The pre-join**: the camera's preview (mirrored), the microphone's level, the camera, microphone
  and speaker chosen (where the browser lets the page choose a speaker), microphone and camera on
  or off — remembered in this browser —, who is in the call, the name where the reader has none,
  what joining does for a private reader, and *Join now*.
- **The full call**: *Auto* (a screen share large, the other tiles in a strip; else the grid),
  *Grid* (16 tiles a page, paged) and *Speaker* (who speaks large, the others in a strip by who
  spoke last, the large tile kept at least 1.5 seconds). A tile is the video, or the initials in
  the person's colour (shared/collab.ts, `colorOf`), with the name, a muted microphone's mark, a
  ring while speaking, a raised hand, a mark where the connection is poor; one's own tile is
  mirrored; a tile is pinned large from its menu. The controls: microphone and camera (each with
  its devices), *Present*, *Raise hand*, reactions (shown over the sender's tile for 4 seconds),
  *Follow me* (everyone here asked to follow the reader), *People* (in the call, raised hands
  first; then who is here and not in it, with *Invite*), the layout, and *Leave* with *End the call
  for everyone* beside it, which asks first (pressed twice, as Revoke is). A tile's ⋯, and a
  participant's row in People: *Pin*, *Follow*, *Ask to follow you*, *Remove from the call* (pressed
  twice). The window's title bar: *Call*, how many are in it and for how long; *Copy call link*;
  maximize; collapse; ✕, which in the call leaves it, pressed twice.
- **The compact call**: the pinned tile, else the newest screen share, else who speaks; and the
  microphone, the camera, the hand and *Leave*.
- **Media**: as Cocoding's (§13.4 there): cameras at 1280×720 with three layers (VP9 where the
  browser has it, VP8 beside it), each tile sent the layer its size needs and nothing while unseen,
  a screen at up to 1920×1080, 30 frames a second; Opus with discontinuous transmission and
  redundancy; the browser's echo cancellation and noise suppression.
- **Reloading** a page in the call offers *Rejoin* (the button in the accent's colour and a
  notice) while the session runs and for 5 minutes after the page went; it joins at once, with the
  camera and the microphone as they were. A page in the call asks before it is closed, and does not
  reload itself into a new version while it is (UpdateSpec decision 8: the call is something a
  reload would cut short).
- **Lost**: a connection lost says so in the window, with *Rejoin*; LiveKit's own reconnection is
  shown while it tries.
- **The background** (web/src/call/effect.ts, blur.ts; from Cocoding's meetings): LiveKit's track
  processor around MediaPipe's selfie segmentation, which finds the person in each frame so that
  only what is behind them is blurred (Blur 12 px, Strong blur 36 px); kept in this browser, and put
  on the pre-join's preview, whose track is the one sent — what the others see is what the preview
  showed. The camera is never sent bare by surprise: joining waits for the effect, and a camera
  turned on in the call goes out only once it carries it; where it cannot be put on, the camera is
  not sent, and the page says so. The runtime (MediaPipe's WebAssembly, about 9.4 MB, from
  `@mediapipe/tasks-vision`) and the model (`web/mediapipe/selfie_segmenter.tflite`, 250 KB) are
  served at `/mediapipe/…` (server/mediapipe.ts) where the server has a call, fetched once a page
  — ahead, as soon as the pointer is on the background's choice or the camera's menu; the
  segmentation runs on the graphics card, or on the processor where the browser draws in software.
  Where a frame takes more than 30 ms on average, the page says so once, so that the reader may turn
  it off. A browser that cannot blur (no WebGL 2, no video frames) is offered none. WebGL contexts
  are few (0.12.2): whether the browser can blur is asked once a page, of a context given back at
  once (before, the processor's own check made one at every drawing of the pre-join and of the
  camera's menu, kept until collected: a wait on the graphics process each — the first Blur
  stalled — and past 16 the browser dropped the oldest, the board's); a processor's context is given
  back when it is done; one lost under the camera (the graphics card reset, or dropped for newer
  ones) is replaced by a new processor, at most three times a minute.
- **Picture-in-picture**, in the control row where the browser has it: with Document
  Picture-in-Picture the call itself moves into a window of its own over every other (420×300
  asked: the compact call; made larger, the full call), the page's look and theme with it; the
  call window says it is there, with *Back into the page*, as the window's button is too; closing
  that window brings the call back. Its videos go on while the page is in the background. Elsewhere
  the large tile's video goes into the browser's own picture-in-picture, with the microphone, the
  camera and leaving offered there where the browser lets a page offer them.
- **The board's drawing survives the graphics card's reset** (web/src/gl/renderer.ts): a WebGL
  context lost — the graphics card reset, or dropped by the browser for newer ones (Chrome keeps 16
  a page and drops the oldest, the board's) — is asked back, and everything is put on the card
  again and drawn; before, the board stayed blank until reloaded. Chrome gives a dropped context
  back only once another goes, maybe never: the board asks for it itself (`restoreContext`), after
  a second, then later and later, up to every 15 seconds, while it is not back and the page is in
  sight.
