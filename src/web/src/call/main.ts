// The call in its window (CallSpec, "The page"): the pre-join, then the call — its tiles in their
// layout, the controls, the People panel — on LiveKit's client. The call's own bundle (`call.js`),
// loaded the first time the window opens (web/src/pagecall.ts); the window, its button and the
// server's news of the call are the page's. Who each participant is comes from the server
// (`call`), never from what LiveKit says of them. Adapted from Cocoding's meetings (LemmaLight).

import { ConnectionQuality, createLocalAudioTrack, createLocalVideoTrack, DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import type { LocalAudioTrack, LocalVideoTrack, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, VideoTrack } from "livekit-client";
import { colorOf, initials } from "../../../shared/collab.ts";
import type { CallParticipant } from "../../../shared/call.ts";
import { callIcon } from "./icons.ts";
import type { CallIcon } from "./icons.ts";
import type { CallEnv, CallView, StartCall } from "./env.ts";
import { callFrame, callMode, clockText, handRaised, HAND_ATTRIBUTE, LAYOUTS, MORE_KEY, namesLine, nextSpeaker, parseReaction, peopleOrder, REACTION_MS, REACTION_TOPIC, REACTIONS, reactionPayload, screenKey, SPEAKER_HOLD_MS, subscriptions } from "./model.ts";
import type { Box, Reaction, Speaking, StageLayout, TileInfo } from "./model.ts";
import { callPrefs, cameraCapture, canChooseSpeaker, deviceName, devices, mediaError, micCapture, publishDefaults, screenCapture, screenPublish } from "./media.ts";
import { callGone, quietLiveKit } from "./noise.ts";

/** text as HTML: the bundle takes none of the page's highlighter for it */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (n: CallIcon, s = 16) => callIcon(n, s);
/** what a participant is called until the server has said who it is */
const UNNAMED = "Joining…";

/** A button of the control row. */
const btn = (act: string, ic: CallIcon, label: string, o: { on?: boolean; pressed?: boolean; title?: string; cls?: string; text?: boolean } = {}) =>
  `<button type="button" class="cl-ctl${o.cls ? ` ${o.cls}` : ""}${o.on === false ? " off" : ""}" data-act="${act}" aria-label="${esc(label)}" title="${esc(o.title ?? label)}"${o.pressed !== undefined ? ` aria-pressed="${o.pressed}"` : ""}>${icon(ic)}${o.text ? `<span>${esc(label)}</span>` : ""}</button>`;

export const startCall: StartCall = (env: CallEnv): CallView => {
  quietLiveKit();
  const prefs = callPrefs();
  const root = env.el;
  root.classList.add("cl-root");
  let room: Room | null = null;
  let joined = false;
  let joining = false;
  let leaving = false;
  let disposed = false;
  let identity: string | null = null;
  /** the name a read-only reader gives, as they last gave it */
  let roName = (() => {
    try {
      return localStorage.getItem("visualproof:call:name") ?? "";
    } catch {
      return "";
    }
  })();

  // ---------------------------------------------------------------- the pre-join

  let pre: { video: LocalVideoTrack | null; audio: LocalAudioTrack | null; meter: number; ctx: AudioContext | null; error: string | null } | null = null;

  const stopPreview = (keep: boolean) => {
    if (!pre) return;
    cancelAnimationFrame(pre.meter);
    void pre.ctx?.close().catch(() => undefined);
    if (!keep) {
      pre.video?.stop();
      pre.audio?.stop();
    }
    pre = null;
  };

  /** The pre-join's preview: the camera and the microphone as chosen, each started where it is on. */
  const preview = async () => {
    if (!pre) return;
    const p = pre;
    p.error = null;
    if (prefs.cam.get() && !p.video) {
      try {
        p.video = await createLocalVideoTrack(cameraCapture(prefs));
      } catch (e) {
        p.error = mediaError(e, "camera");
      }
    } else if (!prefs.cam.get() && p.video) {
      p.video.stop();
      p.video = null;
    }
    if (prefs.mic.get() && !p.audio) {
      try {
        p.audio = await createLocalAudioTrack(micCapture(prefs));
      } catch (e) {
        p.error = (p.error ? p.error + " " : "") + mediaError(e, "microphone");
      }
    } else if (!prefs.mic.get() && p.audio) {
      p.audio.stop();
      p.audio = null;
    }
    if (pre !== p) {
      p.video?.stop();
      p.audio?.stop();
      return;
    }
    drawPre();
    meter();
  };

  /** The microphone's level, under the preview, while the pre-join is there. */
  const meter = () => {
    if (!pre) return;
    cancelAnimationFrame(pre.meter);
    void pre.ctx?.close().catch(() => undefined);
    pre.ctx = null;
    const bar = root.querySelector<HTMLElement>(".cl-meter i");
    if (!pre.audio || !bar) return;
    try {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([pre.audio.mediaStreamTrack])).connect(an);
      const data = new Uint8Array(an.fftSize);
      pre.ctx = ctx;
      const tick = () => {
        if (!pre) return;
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        bar.style.width = `${Math.min(100, Math.round((peak / 128) * 160))}%`;
        pre.meter = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // no Web Audio: no level
    }
  };

  const optionsOf = async (kind: MediaDeviceKind, chosen: string) => {
    const list = await devices(kind);
    if (!list.length) return `<option value="">${kind === "audiooutput" ? "The system's" : "None found"}</option>`;
    return (kind === "audiooutput" ? `<option value="">The system's</option>` : "") + list.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === chosen ? " selected" : ""}>${esc(deviceName(d, i))}</option>`).join("");
  };

  const whoInCall = (): string => {
    const ps = (env.state()?.participants ?? []).filter((p) => p.id !== identity);
    if (!ps.length) return "Nobody is in the call yet: joining starts it.";
    const names = ps.map((p) => p.name ?? UNNAMED);
    return `${esc(namesLine(names))} ${names.length === 1 ? "is" : "are"} in the call.`;
  };

  const drawPre = () => {
    if (!pre || joined) return;
    const me = env.me();
    const name = me.readOnly ? roName : me.name;
    const shown = pre.video ? "" : `<div class="cl-av big" style="--c:${name ? colorOf(name) : "var(--text-3)"}">${esc(name ? initials(name) : "?")}</div>`;
    const keepVideo = root.querySelector<HTMLVideoElement>(".cl-preview video");
    root.innerHTML =
      `<div class="cl-pre">` +
      `<div class="cl-preview">${shown}<div class="cl-pre-toggles">` +
      btn("pre-mic", prefs.mic.get() ? "mic" : "micOff", prefs.mic.get() ? "Turn the microphone off" : "Turn the microphone on", { on: prefs.mic.get() }) +
      btn("pre-cam", prefs.cam.get() ? "call" : "camOff", prefs.cam.get() ? "Turn the camera off" : "Turn the camera on", { on: prefs.cam.get() }) +
      `</div></div>` +
      `<div class="cl-pre-side">` +
      `<div class="cl-pre-title">Ready to join?</div>` +
      `<div class="cl-pre-who muted">${whoInCall()}</div>` +
      (me.readOnly
        ? `<label class="cl-field">Your name, as the call shows it<input data-name maxlength="60" value="${esc(roName)}" placeholder="Your name" spellcheck="false" autocomplete="off"></label><div class="cl-note muted">You read this project by a read-only link: the others see you in the call, and nowhere else.</div>`
        : !me.name
          ? `<div class="cl-note">The call shows everyone by name: you give yours as you join.</div>`
          : "") +
      (me.private ? `<div class="cl-note">You are private: joining makes you visible, as everyone in a call is.</div>` : "") +
      `<div class="cl-devices">` +
      `<label>Camera<select data-dev="videoinput"></select></label>` +
      `<label>Microphone<select data-dev="audioinput"></select></label>` +
      (canChooseSpeaker() ? `<label>Speaker<select data-dev="audiooutput"></select></label>` : "") +
      `</div>` +
      `<div class="cl-meter" title="Your microphone's level"><i></i></div>` +
      (pre.error ? `<div class="cl-err">${esc(pre.error)}</div>` : "") +
      `<div class="cl-actions"><button type="button" class="rv-btn" data-act="cancel">Cancel</button><button type="button" class="rv-btn primary" data-act="join"${joining ? " disabled" : ""}>${joining ? "Joining…" : "Join now"}</button></div>` +
      `</div></div>`;
    const box = root.querySelector<HTMLElement>(".cl-preview")!;
    if (pre.video) {
      const v = keepVideo ?? document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.className = "mirror";
      pre.video.attach(v);
      box.prepend(v);
    }
    for (const sel of root.querySelectorAll<HTMLSelectElement>("[data-dev]")) {
      const kind = sel.dataset.dev as MediaDeviceKind;
      const chosen = kind === "videoinput" ? prefs.camDevice.get() : kind === "audioinput" ? prefs.micDevice.get() : prefs.speakerDevice.get();
      void optionsOf(kind, chosen).then((h) => (sel.innerHTML = h));
    }
    meter();
  };

  const showPre = () => {
    stopPreview(false);
    pre = { video: null, audio: null, meter: 0, ctx: null, error: null };
    root.innerHTML = `<div class="cl-pre"><div class="cl-preview"></div><div class="cl-pre-side"><div class="cl-pre-title">Ready to join?</div><div class="cl-pre-who muted">${whoInCall()}</div></div></div>`;
    void preview();
  };

  // ---------------------------------------------------------------- joining

  /** Join: a token for this page's tab, the room connected, the tracks published. */
  const join = async (tracks: { video: LocalVideoTrack | null; audio: LocalAudioTrack | null }): Promise<boolean> => {
    const me = env.me();
    let name: string | null = null;
    if (me.readOnly) {
      name = roName.trim();
      if (!name) {
        say("Give the name the call shows you by.");
        root.querySelector<HTMLInputElement>("[data-name]")?.focus();
        return false;
      }
    } else if (!me.name && !(await env.ensureName())) return false;
    if (me.private) await env.goVisible();
    let tok = await env.token(name);
    // gone visible a moment ago: the server hears it with the page's next heartbeat
    for (let k = 0; k < 6 && "error" in tok && tok.private; k++) {
      await new Promise((r) => setTimeout(r, 400));
      tok = await env.token(name);
    }
    if ("error" in tok) {
      if (tok.who && !me.readOnly && (await env.ensureName())) return join(tracks);
      say(tok.error);
      return false;
    }
    if (disposed || leaving) return false;
    const speakerId = prefs.speakerDevice.get();
    const r = new Room({
      adaptiveStream: { pixelDensity: "screen", pauseVideoInBackground: true },
      dynacast: true,
      videoCaptureDefaults: cameraCapture(prefs),
      audioCaptureDefaults: micCapture(prefs),
      publishDefaults: publishDefaults(),
      ...(speakerId && canChooseSpeaker() ? { audioOutput: { deviceId: speakerId } } : {}),
      // the page leaves the call itself as it goes (`pageGone`)
      disconnectOnPageLeave: false,
    });
    wire(r);
    try {
      await r.connect(tok.url, tok.token);
    } catch (e) {
      r.removeAllListeners();
      void r.disconnect().catch(() => undefined);
      say(`The call could not be reached: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (disposed || leaving) {
      r.removeAllListeners();
      void r.disconnect().catch(() => undefined);
      return false;
    }
    room = r;
    identity = tok.identity;
    joined = true;
    for (const p of r.remoteParticipants.values()) seen(p);
    try {
      if (tracks.audio) await r.localParticipant.publishTrack(tracks.audio, { source: Track.Source.Microphone });
      if (tracks.video) await r.localParticipant.publishTrack(tracks.video, { source: Track.Source.Camera });
    } catch (e) {
      say(`Your camera or microphone could not be sent: ${e instanceof Error ? e.message : String(e)}`);
    }
    buildCall();
    env.changed();
    return true;
  };

  const joinFromPre = async () => {
    if (!pre || joining) return;
    const field = root.querySelector<HTMLInputElement>("[data-name]");
    if (field) {
      roName = field.value.trim();
      try {
        localStorage.setItem("visualproof:call:name", roName);
      } catch {
        // kept while the page is open
      }
    }
    joining = true;
    drawPre();
    const tracks = { video: pre.video, audio: pre.audio };
    const ok = await join(tracks);
    joining = false;
    if (ok) stopPreview(true);
    else if (pre) drawPre();
  };

  /** Rejoin as the page was (a reload in the call): the pre-join passed. */
  const rejoin = async (o: { mic: boolean; cam: boolean }) => {
    root.innerHTML = `<div class="cl-wait muted">Joining the call…</div>`;
    let audio: LocalAudioTrack | null = null;
    let video: LocalVideoTrack | null = null;
    try {
      if (o.mic) audio = await createLocalAudioTrack(micCapture(prefs));
    } catch (e) {
      say(mediaError(e, "microphone"));
    }
    try {
      if (o.cam) video = await createLocalVideoTrack(cameraCapture(prefs));
    } catch (e) {
      say(mediaError(e, "camera"));
    }
    if (!(await join({ audio, video }))) {
      audio?.stop();
      video?.stop();
      showPre();
    }
  };

  // ---------------------------------------------------------------- what the room says

  /** when each participant raised their hand, as this page saw it */
  const handSince = new Map<string, number>();
  /** when each presentation started, as this page saw it */
  const screenSince = new Map<string, number>();
  /** when each participant last spoke */
  const spoke = new Map<string, number>();
  let loudest: string[] = [];
  let speaker: Speaking | null = null;
  let holdTimer = 0;
  let reconnecting = false;

  const seen = (p: Participant) => {
    if (handRaised(p.attributes)) handSince.set(p.identity, handSince.get(p.identity) ?? Date.now());
    else handSince.delete(p.identity);
  };

  const updateSpeaker = () => {
    speaker = nextSpeaker(speaker, loudest, Date.now());
    clearTimeout(holdTimer);
    if (speaker && loudest[0] !== undefined && loudest[0] !== speaker.key) holdTimer = window.setTimeout(() => (updateSpeaker(), schedule()), Math.max(50, SPEAKER_HOLD_MS - (Date.now() - speaker.since) + 20));
  };

  const audioBox = document.createElement("div");
  audioBox.className = "cl-audio";
  audioBox.hidden = true;
  document.body.append(audioBox);

  const wire = (r: Room) => {
    const redraw = () => schedule();
    r.on(RoomEvent.ParticipantConnected, (p) => {
      seen(p);
      schedule();
    })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        handSince.delete(p.identity);
        screenSince.delete(p.identity);
        schedule();
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) audioBox.append(track.attach());
        schedule();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) for (const el of track.detach()) el.remove();
        schedule();
      })
      .on(RoomEvent.TrackPublished, redraw)
      .on(RoomEvent.TrackUnpublished, redraw)
      .on(RoomEvent.TrackMuted, () => (schedule(), env.changed()))
      .on(RoomEvent.TrackUnmuted, () => (schedule(), env.changed()))
      .on(RoomEvent.LocalTrackPublished, () => (schedule(), env.changed()))
      .on(RoomEvent.LocalTrackUnpublished, () => (schedule(), env.changed()))
      .on(RoomEvent.ConnectionQualityChanged, redraw)
      .on(RoomEvent.ActiveSpeakersChanged, (list: Participant[]) => {
        const now = Date.now();
        for (const p of list) spoke.set(p.identity, now);
        loudest = list.filter((p) => p.identity !== identity).map((p) => p.identity);
        updateSpeaker();
        schedule();
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, p: Participant) => {
        seen(p);
        schedule();
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic !== REACTION_TOPIC || !p) return;
        const e = parseReaction(payload);
        if (e) react(p.identity, e);
      })
      .on(RoomEvent.Reconnecting, () => {
        reconnecting = true;
        schedule();
      })
      .on(RoomEvent.Reconnected, () => {
        reconnecting = false;
        schedule();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        callGone();
        if (room !== r) return;
        r.removeAllListeners();
        room = null;
        joined = false;
        reconnecting = false;
        audioBox.replaceChildren();
        env.changed();
        if (leaving || disposed || reason === DisconnectReason.CLIENT_INITIATED) return;
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) return env.dropped("elsewhere");
        if (reason === DisconnectReason.ROOM_DELETED) return env.dropped("ended");
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) return env.dropped("removed");
        drawLost();
        env.dropped("lost");
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, redraw)
      .on(RoomEvent.MediaDevicesError, (err: Error) => say(mediaError(err, /audio|microphone/i.test(err.message) ? "microphone" : "camera")));
  };

  // ---------------------------------------------------------------- the call's view

  let area: HTMLElement | null = null;
  let stage: HTMLElement | null = null;
  let side: HTMLElement | null = null;
  let bar: HTMLElement | null = null;
  let pop: HTMLElement | null = null;
  let popFor: string | null = null;
  let pinned: string | null = null;
  let gridPage = 0;
  let peopleOpen = false;
  let armed: string | null = null;
  const tiles = new Map<string, HTMLElement>();
  const resize = new ResizeObserver(() => schedule());

  const buildCall = () => {
    root.innerHTML =
      `<div class="cl-call">` +
      `<div class="cl-main"><div class="cl-stage"><button type="button" class="cl-nav prev" data-act="prev" aria-label="The page before" hidden>‹</button><button type="button" class="cl-nav next" data-act="next" aria-label="The next page" hidden>›</button><div class="cl-pager" hidden></div></div><aside class="cl-side" hidden></aside></div>` +
      `<div class="cl-banner" hidden></div>` +
      `<div class="cl-bar"></div>` +
      `<div class="cl-pop glass" hidden></div>` +
      `</div>`;
    area = root.querySelector(".cl-call");
    stage = root.querySelector(".cl-stage");
    side = root.querySelector(".cl-side");
    bar = root.querySelector(".cl-bar");
    pop = root.querySelector(".cl-pop");
    tiles.clear();
    resize.disconnect();
    resize.observe(root);
    schedule();
  };

  const drawLost = () => {
    root.innerHTML = `<div class="cl-wait"><div>The call was disconnected.</div><div class="cl-actions"><button type="button" class="rv-btn" data-act="close">Close</button><button type="button" class="rv-btn primary" data-act="rejoin">Rejoin</button></div></div>`;
    area = stage = side = bar = pop = null;
  };

  let scheduled = 0;
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      draw();
    });
  };

  /** Who a participant is, as the server says it. */
  const said = (id: string): CallParticipant | undefined => env.state()?.participants.find((p) => p.id === id);
  const nameOf = (p: Participant): string => (p.identity === identity ? (env.me().readOnly ? roName : env.me().name) || "You" : (said(p.identity)?.name ?? UNNAMED));

  const tileInfos = (r: Room): TileInfo[] => {
    const out: TileInfo[] = [];
    const add = (p: Participant, local: boolean) => {
      out.push({ key: p.identity, identity: p.identity, kind: "camera", local, since: p.joinedAt?.getTime() ?? 0 });
      if (p.isScreenShareEnabled) {
        if (!screenSince.has(p.identity)) screenSince.set(p.identity, Date.now());
        out.push({ key: screenKey(p.identity), identity: p.identity, kind: "screen", local, since: screenSince.get(p.identity)! });
      } else screenSince.delete(p.identity);
    };
    add(r.localParticipant, true);
    for (const p of r.remoteParticipants.values()) add(p, false);
    return out;
  };

  const participantOf = (r: Room, id: string): Participant | undefined => (id === r.localParticipant.identity ? r.localParticipant : r.remoteParticipants.get(id));

  /** The tile of `key`, made once and kept: its video element stays, as LiveKit's adaptive stream
   *  watches it. */
  const tileEl = (key: string): HTMLElement => {
    let el = tiles.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "cl-tile";
      el.dataset.key = key;
      el.innerHTML = `<video playsinline muted></video><div class="cl-av"></div><div class="cl-tag"></div><div class="cl-marks"></div><button type="button" class="cl-tmenu" data-act="tile" aria-label="More">${icon("more", 14)}</button><div class="cl-react"></div>`;
      tiles.set(key, el);
      stage!.append(el);
    }
    return el;
  };

  const attach = (el: HTMLElement, track: VideoTrack | undefined) => {
    const v = el.querySelector("video")!;
    const was = (v as HTMLVideoElement & { _track?: VideoTrack })._track;
    if (was === track) return;
    was?.detach(v);
    (v as HTMLVideoElement & { _track?: VideoTrack })._track = track;
    if (track) track.attach(v);
  };

  const draw = () => {
    if (!room || !area || !stage || !bar) return;
    const r = room;
    const box: Box = { w: root.clientWidth, h: root.clientHeight };
    const mode = callMode(box);
    area.classList.toggle("compact", mode === "compact");
    side!.hidden = mode === "compact" || !peopleOpen;
    // the stage's own box, the control row and the side panel left out
    const sb: Box = { w: stage.clientWidth, h: stage.clientHeight };
    const infos = tileInfos(r);
    const frame = callFrame({ tiles: infos, mode: prefs.layout.get(), pinned, speaker: speaker?.key ?? null, spoke, page: gridPage, box: sb, seen: env.seen(), call: mode });
    if (frame.layout) gridPage = frame.layout.page;
    // the tiles shown, where the layout puts them; the others gone from the stage
    const keep = new Set<string>();
    for (const t of infos) {
      const rect = frame.rects.get(t.key);
      if (!rect) continue;
      keep.add(t.key);
      const el = tileEl(t.key);
      const p = participantOf(r, t.identity);
      if (!p) continue;
      Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      const pub = p.getTrackPublication(t.kind === "screen" ? Track.Source.ScreenShare : Track.Source.Camera);
      const track = pub && !pub.isMuted ? (pub.videoTrack as VideoTrack | undefined) : undefined;
      attach(el, track);
      const name = nameOf(p);
      const sp = said(p.identity);
      el.classList.toggle("video", !!track);
      el.classList.toggle("mirror", t.local && t.kind === "camera");
      el.classList.toggle("screen", t.kind === "screen");
      el.classList.toggle("speaking", t.kind === "camera" && p.isSpeaking);
      el.classList.toggle("pinned", pinned === t.key);
      el.classList.toggle("unnamed", !t.local && !sp?.name);
      const av = el.querySelector<HTMLElement>(".cl-av")!;
      av.textContent = initials(name);
      av.style.setProperty("--c", t.local || sp?.name ? colorOf(name) : "var(--text-3)");
      const tag = t.kind === "screen" ? `${esc(name)} is presenting` : `${!p.isMicrophoneEnabled ? `<span class="cl-muted" title="Microphone off">${icon("micOff", 12)}</span>` : ""}<span class="cl-nm">${esc(name)}${t.local ? " (you)" : ""}</span>${sp?.verified ? `<span class="cl-ok" title="Invited by a personal link: the name is theirs">✓</span>` : ""}${sp?.readOnly ? `<span class="cl-ro">read-only</span>` : ""}`;
      const tagEl = el.querySelector<HTMLElement>(".cl-tag")!;
      if (tagEl.innerHTML !== tag) tagEl.innerHTML = tag;
      const poor = p.connectionQuality === ConnectionQuality.Poor || p.connectionQuality === ConnectionQuality.Lost;
      const marks = (t.kind === "camera" && handSince.has(p.identity) ? `<span class="cl-hand" title="Hand raised">✋</span>` : "") + (poor ? `<span class="cl-poor" title="A poor connection">${icon("weak", 12)}</span>` : "");
      const mk = el.querySelector<HTMLElement>(".cl-marks")!;
      if (mk.innerHTML !== marks) mk.innerHTML = marks;
    }
    for (const [k, el] of tiles)
      if (!keep.has(k)) {
        attach(el, undefined);
        el.remove();
        tiles.delete(k);
      }
    // the strip's +N
    let more = stage.querySelector<HTMLButtonElement>(".cl-more");
    const mr = frame.rects.get(MORE_KEY);
    if (mr && frame.layout) {
      if (!more) {
        more = document.createElement("button");
        more.type = "button";
        more.className = "cl-more";
        more.dataset.act = "people";
        stage.append(more);
      }
      more.textContent = `+${frame.layout.more.length}`;
      more.title = "Everyone in the call";
      Object.assign(more.style, { left: `${mr.x}px`, top: `${mr.y}px`, width: `${mr.w}px`, height: `${mr.h}px` });
    } else more?.remove();
    drawPager(frame.layout);
    // only what is shown is received
    const videos: { sid: string; tile: string }[] = [];
    const pubs = new Map<string, RemoteTrackPublication>();
    for (const p of r.remoteParticipants.values())
      for (const pub of p.videoTrackPublications.values()) {
        videos.push({ sid: pub.trackSid, tile: pub.source === Track.Source.ScreenShare ? screenKey(p.identity) : p.identity });
        pubs.set(pub.trackSid, pub);
      }
    for (const [sid, on] of subscriptions(videos, frame.shown, document.visibilityState === "visible")) {
      const pub = pubs.get(sid);
      if (pub && pub.isEnabled !== on) pub.setEnabled(on);
    }
    drawBar(mode);
    drawBanner();
    if (!side!.hidden) drawSide();
  };

  const drawPager = (l: StageLayout | null) => {
    const paged = !!l && l.kind === "grid" && l.pages > 1;
    stage!.querySelector<HTMLElement>(".cl-nav.prev")!.hidden = !paged || l!.page === 0;
    stage!.querySelector<HTMLElement>(".cl-nav.next")!.hidden = !paged || l!.page >= l!.pages - 1;
    const pager = stage!.querySelector<HTMLElement>(".cl-pager")!;
    pager.hidden = !paged;
    if (paged) pager.textContent = `${l!.page + 1} / ${l!.pages}`;
  };

  const drawBanner = () => {
    const b = root.querySelector<HTMLElement>(".cl-banner");
    if (!b || !room) return;
    const blocked = !room.canPlaybackAudio;
    b.hidden = !reconnecting && !blocked;
    const html = reconnecting ? `<span>Reconnecting to the call…</span>` : blocked ? `<span>The browser holds the call's sound back.</span><button type="button" class="rv-btn primary" data-act="audio">Play sound</button>` : "";
    if (b.innerHTML !== html) b.innerHTML = html;
  };

  const drawBar = (mode: "full" | "compact") => {
    const r = room!;
    const lp = r.localParticipant;
    const mic = lp.isMicrophoneEnabled;
    const cam = lp.isCameraEnabled;
    const hand = handSince.has(lp.identity);
    const me = env.me();
    const n = r.remoteParticipants.size + 1;
    let html: string;
    if (mode === "compact")
      html =
        btn("mic", mic ? "mic" : "micOff", mic ? "Turn the microphone off" : "Turn the microphone on", { on: mic }) +
        btn("cam", cam ? "call" : "camOff", cam ? "Turn the camera off" : "Turn the camera on", { on: cam }) +
        btn("hand", "hand", hand ? "Lower your hand" : "Raise your hand", { pressed: hand }) +
        `<span class="cl-gap"></span>` +
        btn("leave", "leave", "Leave the call", { cls: "bad" });
    else
      html =
        `<span class="cl-grp">${btn("mic", mic ? "mic" : "micOff", mic ? "Turn the microphone off" : "Turn the microphone on", { on: mic })}${btn("menu-mic", "up", "Microphone and speaker", { cls: "cl-caret" })}</span>` +
        `<span class="cl-grp">${btn("cam", cam ? "call" : "camOff", cam ? "Turn the camera off" : "Turn the camera on", { on: cam })}${btn("menu-cam", "up", "Camera", { cls: "cl-caret" })}</span>` +
        btn("present", "screen", lp.isScreenShareEnabled ? "Stop presenting" : "Present: a screen, a window or a tab", { pressed: lp.isScreenShareEnabled }) +
        btn("hand", "hand", hand ? "Lower your hand" : "Raise your hand", { pressed: hand }) +
        btn("menu-react", "smile", "React") +
        (me.readOnly ? "" : btn("follow-me", "follow", "Follow me", { text: true, title: "Ask everyone here to follow you: they see the board as you do (CallSpec decision 8)" })) +
        btn("people", "people", `People in the call (${n})`, { pressed: peopleOpen, text: false }) +
        btn("menu-layout", "layout", "Layout") +
        `<span class="cl-gap"></span>` +
        `<span class="cl-grp">${btn("leave", "leave", "Leave the call", { cls: "bad", text: true })}${me.readOnly ? "" : btn("menu-leave", "up", "End the call for everyone", { cls: "cl-caret bad" })}</span>`;
    if (bar!.dataset.sig !== html) {
      bar!.dataset.sig = html;
      bar!.innerHTML = html;
    }
  };

  const avatar = (name: string, known = true) => `<span class="cl-av small" style="--c:${known ? colorOf(name) : "var(--text-3)"}">${esc(initials(name))}</span>`;

  const drawSide = () => {
    if (!room || !side) return;
    const r = room;
    const me = env.me();
    const rows = peopleOrder(
      [r.localParticipant, ...r.remoteParticipants.values()].map((p) => ({ identity: p.identity, name: nameOf(p), local: p.identity === r.localParticipant.identity, hand: handSince.get(p.identity) ?? null, p })),
    );
    const inCall = rows
      .map(({ identity: id, name, local, hand, p }) => {
        const sp = said(id);
        return (
          `<div class="cl-row">${avatar(name, local || !!sp?.name)}<span class="cl-row-n">${esc(name)}${local ? " (you)" : ""}${sp?.verified ? ` <span class="cl-ok">✓</span>` : ""}${sp?.readOnly ? ` <span class="cl-ro">read-only</span>` : ""}</span>` +
          `${hand !== null ? `<span class="cl-hand">✋</span>` : ""}${!p.isMicrophoneEnabled ? `<span class="cl-muted" title="Microphone off">${icon("micOff", 12)}</span>` : ""}` +
          (local ? "" : `<button type="button" class="cl-tmenu" data-act="row" data-id="${esc(id)}" aria-label="More">${icon("more", 14)}</button>`) +
          `</div>`
        );
      })
      .join("");
    const inIds = new Set(env.state()?.participants.map((p) => p.page).filter(Boolean));
    const here = me.readOnly ? [] : env.here().filter((h) => !inIds.has(h.page));
    const html =
      `<div class="cl-side-h">In the call · ${rows.length}</div>${inCall}` +
      (here.length ? `<div class="cl-side-h">Here, not in the call</div>` + here.map((h) => `<div class="cl-row">${avatar(h.name)}<span class="cl-row-n">${esc(h.name)}${h.verified ? ` <span class="cl-ok">✓</span>` : ""}</span><button type="button" class="rv-btn cl-inv" data-act="invite" data-page="${esc(h.page)}">Invite</button></div>`).join("") : "");
    if (side.dataset.sig !== html) {
      side.dataset.sig = html;
      side.innerHTML = html;
    }
  };

  // ---------------------------------------------------------------- the popovers of the call

  const closePop = () => {
    if (!pop) return;
    pop.hidden = true;
    popFor = null;
    armed = null;
  };

  const openPop = async (key: string, anchor: HTMLElement, html: string | Promise<string>) => {
    if (!pop || !area) return;
    if (popFor === key && !pop.hidden) return closePop();
    popFor = key;
    pop.innerHTML = await html;
    pop.hidden = false;
    const a = anchor.getBoundingClientRect();
    const box = area.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(6, Math.min(a.left - box.left + a.width / 2 - w / 2, box.width - w - 6));
    const above = a.top - box.top - h - 6;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(above >= 6 ? above : Math.min(a.bottom - box.top + 6, box.height - h - 6))}px`;
  };

  const deviceMenu = async (kinds: MediaDeviceKind[]) => {
    let html = "";
    for (const kind of kinds) {
      const list = await devices(kind);
      const chosen = kind === "videoinput" ? prefs.camDevice.get() : kind === "audioinput" ? prefs.micDevice.get() : prefs.speakerDevice.get();
      const title = kind === "videoinput" ? "Camera" : kind === "audioinput" ? "Microphone" : "Speaker";
      html += `<div class="cl-pop-h">${title}</div>`;
      if (kind === "audiooutput") html += `<button type="button" class="cl-item${chosen === "" ? " on" : ""}" data-act="device" data-kind="${kind}" data-id="">The system's</button>`;
      html += list.length ? list.map((d, i) => `<button type="button" class="cl-item${d.deviceId === chosen ? " on" : ""}" data-act="device" data-kind="${kind}" data-id="${esc(d.deviceId)}">${esc(deviceName(d, i))}</button>`).join("") : `<div class="cl-item muted">None found</div>`;
    }
    return html;
  };

  const tileMenu = (key: string) => {
    const r = room;
    if (!r) return "";
    const id = key.replace(/#screen$/, "");
    const local = id === r.localParticipant.identity;
    const sp = said(id);
    const me = env.me();
    return (
      `<button type="button" class="cl-item" data-act="pin" data-key="${esc(key)}">${pinned === key ? "Unpin" : "Pin: show it large"}</button>` +
      (!local && sp?.page && !me.readOnly ? `<button type="button" class="cl-item" data-act="follow" data-page="${esc(sp.page)}">Follow ${esc(sp.name ?? "them")}</button><button type="button" class="cl-item" data-act="ask" data-page="${esc(sp.page)}">Ask ${esc(sp.name ?? "them")} to follow you</button>` : "") +
      (!local && !me.readOnly ? `<button type="button" class="cl-item bad" data-act="remove" data-id="${esc(id)}">Remove from the call</button>` : "")
    );
  };

  // ---------------------------------------------------------------- what the reader does

  const say = (text: string) => env.say(text);

  const setMic = async (on: boolean) => {
    if (!room) return;
    prefs.mic.set(on);
    try {
      await room.localParticipant.setMicrophoneEnabled(on, micCapture(prefs));
    } catch (e) {
      say(mediaError(e, "microphone"));
    }
    schedule();
    env.changed();
  };

  const setCam = async (on: boolean) => {
    if (!room) return;
    prefs.cam.set(on);
    try {
      await room.localParticipant.setCameraEnabled(on, cameraCapture(prefs));
    } catch (e) {
      say(mediaError(e, "camera"));
    }
    schedule();
    env.changed();
  };

  const react = (id: string, emoji: Reaction) => {
    const el = tiles.get(id)?.querySelector<HTMLElement>(".cl-react");
    if (!el) return;
    const s = document.createElement("span");
    s.textContent = emoji;
    el.append(s);
    setTimeout(() => s.remove(), REACTION_MS);
  };

  const leave = async () => {
    leaving = true;
    callGone();
    closePop();
    const r = room;
    room = null;
    joined = false;
    env.left();
    if (r) {
      r.removeAllListeners();
      await r.disconnect().catch(() => undefined);
    }
    audioBox.replaceChildren();
    env.changed();
    env.close();
  };

  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-name]")) roName = t.value;
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pop && !pop.hidden) {
      e.stopPropagation();
      closePop();
    } else if (e.key === "Enter" && (e.target as HTMLElement).matches("[data-name]")) void joinFromPre();
  });
  root.addEventListener("change", async (e) => {
    const sel = e.target as HTMLSelectElement;
    const kind = sel.dataset.dev as MediaDeviceKind | undefined;
    if (!kind) return;
    if (kind === "videoinput") {
      prefs.camDevice.set(sel.value);
      pre?.video?.stop();
      if (pre) pre.video = null;
    } else if (kind === "audioinput") {
      prefs.micDevice.set(sel.value);
      pre?.audio?.stop();
      if (pre) pre.audio = null;
    } else prefs.speakerDevice.set(sel.value);
    await preview();
  });
  document.addEventListener("pointerdown", (e) => {
    if (pop && !pop.hidden && !pop.contains(e.target as Node) && !(e.target as Element).closest?.("[data-act^=menu-], [data-act=tile], [data-act=row]")) closePop();
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act!;
    const r = room;
    switch (act) {
      case "cancel":
      case "close":
        stopPreview(false);
        return env.close();
      case "join":
        return void joinFromPre();
      case "rejoin":
        return showPre();
      case "pre-mic":
        prefs.mic.set(!prefs.mic.get());
        return void preview();
      case "pre-cam":
        prefs.cam.set(!prefs.cam.get());
        return void preview();
      case "mic":
        return void setMic(!r?.localParticipant.isMicrophoneEnabled);
      case "cam":
        return void setCam(!r?.localParticipant.isCameraEnabled);
      case "present":
        if (!r) return;
        try {
          const on = !r.localParticipant.isScreenShareEnabled;
          await r.localParticipant.setScreenShareEnabled(on, screenCapture(), screenPublish());
        } catch (err) {
          say(mediaError(err, "screen"));
        }
        return schedule();
      case "hand": {
        if (!r) return;
        const up = !handSince.has(r.localParticipant.identity);
        try {
          await r.localParticipant.setAttributes({ [HAND_ATTRIBUTE]: up ? "1" : "" });
        } catch {
          say("Your hand could not be raised: the call's server did not take it.");
        }
        seen(r.localParticipant);
        return schedule();
      }
      case "menu-react":
        return void openPop(act, b, `<div class="cl-reacts">${REACTIONS.map((x) => `<button type="button" class="cl-rx" data-act="rx" data-rx="${x}">${x}</button>`).join("")}</div>`);
      case "rx": {
        const emoji = b.dataset.rx as Reaction;
        closePop();
        if (!r) return;
        react(r.localParticipant.identity, emoji);
        await r.localParticipant.publishData(reactionPayload(emoji), { reliable: true, topic: REACTION_TOPIC }).catch(() => undefined);
        return;
      }
      case "follow-me": {
        const why = await env.askToFollow(null);
        return say(why ?? "Everyone here was asked to follow you.");
      }
      case "people":
        peopleOpen = !peopleOpen;
        return schedule();
      case "menu-layout":
        return void openPop(act, b, LAYOUTS.map((l) => `<button type="button" class="cl-item${prefs.layout.get() === l.mode ? " on" : ""}" data-act="layout" data-mode="${l.mode}" title="${esc(l.hint)}">${l.label}</button>`).join(""));
      case "layout":
        prefs.layout.set(b.dataset.mode as "auto" | "grid" | "speaker");
        closePop();
        return schedule();
      case "menu-mic":
        return void openPop(act, b, deviceMenu(canChooseSpeaker() ? ["audioinput", "audiooutput"] : ["audioinput"]));
      case "menu-cam":
        return void openPop(act, b, deviceMenu(["videoinput"]));
      case "device": {
        const kind = b.dataset.kind as MediaDeviceKind;
        const id = b.dataset.id ?? "";
        (kind === "videoinput" ? prefs.camDevice : kind === "audioinput" ? prefs.micDevice : prefs.speakerDevice).set(id);
        closePop();
        if (r) await r.switchActiveDevice(kind, id || "default").catch((err: unknown) => say(mediaError(err, kind === "videoinput" ? "camera" : "microphone")));
        return;
      }
      case "menu-leave":
        armed = null;
        return void openPop(act, b, `<button type="button" class="cl-item bad" data-act="end">End the call for everyone</button>`);
      case "end":
        if (armed !== "end") {
          armed = "end";
          b.textContent = "End it: everyone leaves";
          return;
        }
        closePop();
        callGone();
        return void env.end().then((why) => why && say(why));
      case "leave":
        return void leave();
      case "audio":
        return void r?.startAudio().then(schedule);
      case "prev":
        gridPage--;
        return schedule();
      case "next":
        gridPage++;
        return schedule();
      case "tile":
        return void openPop(`tile:${b.closest<HTMLElement>(".cl-tile")?.dataset.key}`, b, tileMenu(b.closest<HTMLElement>(".cl-tile")?.dataset.key ?? ""));
      case "row":
        return void openPop(`row:${b.dataset.id}`, b, tileMenu(b.dataset.id ?? ""));
      case "pin": {
        const key = b.dataset.key!;
        pinned = pinned === key ? null : key;
        closePop();
        return schedule();
      }
      case "follow":
        closePop();
        return env.follow(b.dataset.page!);
      case "ask": {
        closePop();
        const why = await env.askToFollow(b.dataset.page!);
        return say(why ?? "Asked.");
      }
      case "remove":
        if (armed !== `remove:${b.dataset.id}`) {
          armed = `remove:${b.dataset.id}`;
          b.textContent = "Remove: they leave the call";
          return;
        }
        closePop();
        return void env.remove(b.dataset.id!).then((why) => why && say(why));
      case "invite": {
        const why = await env.invite(b.dataset.page!);
        b.textContent = why ? "Not invited" : "Invited";
        (b as HTMLButtonElement).disabled = true;
        if (why) say(why);
        return;
      }
    }
  });
  const visible = () => schedule();
  document.addEventListener("visibilitychange", visible);

  return {
    start(o = {}) {
      if (joined || joining) return;
      leaving = false;
      if (o.rejoin) void rejoin(o.rejoin);
      else showPre();
    },
    get inCall() {
      return joined;
    },
    get mic() {
      return !!room?.localParticipant.isMicrophoneEnabled;
    },
    get cam() {
      return !!room?.localParticipant.isCameraEnabled;
    },
    toggleMic() {
      void setMic(!room?.localParticipant.isMicrophoneEnabled);
    },
    leave,
    stateChanged() {
      if (joined) schedule();
      else if (pre && !joining) {
        const who = root.querySelector<HTMLElement>(".cl-pre-who");
        if (who) who.innerHTML = whoInCall();
      }
    },
    shownChanged() {
      schedule();
    },
    pageGone() {
      leaving = true;
      callGone();
      const r = room;
      room = null;
      if (r) {
        r.removeAllListeners();
        void r.disconnect().catch(() => undefined);
      }
    },
    dispose() {
      disposed = true;
      callGone();
      stopPreview(false);
      resize.disconnect();
      document.removeEventListener("visibilitychange", visible);
      const r = room;
      room = null;
      if (r) {
        r.removeAllListeners();
        void r.disconnect().catch(() => undefined);
      }
      audioBox.remove();
      root.innerHTML = "";
    },
  };
};
