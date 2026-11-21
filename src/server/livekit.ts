// LiveKit, by hand (CallSpec, "As built"): the calls run on a LiveKit server the operator names
// (--livekit-url, --livekit-keys; CallSpec decision 1), which the server speaks to in two ways
// alone — the access tokens it gives pages, JWTs signed with the key's secret, and LiveKit's room
// service, its Twirp API, for who is in a room, a participant removed and a room deleted. Both are
// small enough to write here: the server takes no LiveKit SDK, and nothing of it but these lines
// knows LiveKit's wire.

import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** A LiveKit API key and its secret: the secret signs every token, and is never sent. */
export interface LiveKitKeys {
  key: string;
  secret: string;
}

const KEY = /^[A-Za-z0-9_.-]{1,256}$/;
const SECRET = /^\S{1,1024}$/;

/** The keys --livekit-keys names: the file's (readable by its owner alone), one line
 *  `<key>: <secret>` as LiveKit's own keys file has it; or, `env`, the server's LIVEKIT_API_KEY and
 *  LIVEKIT_API_SECRET. Or why the server does not start. */
export function loadLiveKitKeys(spec: string, env: NodeJS.ProcessEnv = process.env): LiveKitKeys | { error: string } {
  if (spec === "env") {
    const key = (env.LIVEKIT_API_KEY ?? "").trim();
    const secret = (env.LIVEKIT_API_SECRET ?? "").trim();
    if (!key || !secret) return { error: "env: LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not both set in the server's environment" };
    if (!KEY.test(key) || !SECRET.test(secret)) return { error: "env: LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not one LiveKit gives (letters, digits and _ . - for the key; no spaces in the secret)" };
    return { key, secret };
  }
  let mode: number;
  try {
    const st = statSync(spec);
    if (!st.isFile()) return { error: `${spec} is not a file: give the file that holds the LiveKit key and its secret, one line "<key>: <secret>"` };
    mode = st.mode;
  } catch {
    return { error: `${spec}: there is no such file. Write there the LiveKit key and its secret, one line "<key>: <secret>", and make it readable by the server's user alone: chmod 600 ${spec}` };
  }
  // as an ssh key: a file others may read is refused, not used (POSIX modes; Windows has none)
  if (process.platform !== "win32" && (mode & 0o077) !== 0) return { error: `${spec} may be read or written by others than its owner (mode ${(mode & 0o777).toString(8)}): chmod 600 ${spec}` };
  let text: string;
  try {
    text = readFileSync(spec, "utf8");
  } catch (e) {
    return { error: `${spec} cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
  return parseKeys(text, spec);
}

/** A keys file's text: one line `<key>: <secret>`, beside blank lines and comments (#). */
export function parseKeys(text: string, where = "the file"): LiveKitKeys | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return { error: `${where} is empty: write there the LiveKit key and its secret, one line "<key>: <secret>"` };
  if (lines.length > 1) return { error: `${where} holds ${lines.length} lines: VisualProof takes one key, one line "<key>: <secret>"` };
  const m = /^([^:\s]+)\s*:\s*(\S+)$/.exec(lines[0]);
  if (!m || !KEY.test(m[1]) || !SECRET.test(m[2])) return { error: `${where} does not hold a key as LiveKit's keys file does: one line "<key>: <secret>"` };
  return { key: m[1], secret: m[2] };
}

/** What a token lets its holder do in a room (LiveKit's video grant, as its JWT carries it). */
export interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  roomCreate?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  /** what may be published: camera, microphone, screen_share, screen_share_audio */
  canPublishSources?: string[];
  /** the participant's own name, metadata and attributes (a raised hand) */
  canUpdateOwnMetadata?: boolean;
}

/** A JWT signed with HS256 by `secret`. */
export function signJwt(payload: object, secret: string): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

/** A LiveKit access token: the key's (`iss`), for `identity` (`sub`) where it joins a room, valid
 *  from now for `ttl` seconds, with the participant's `name` and what it may do. */
export function accessToken(keys: LiveKitKeys, o: { identity?: string; name?: string; ttl: number; video: VideoGrant }, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return signJwt({ iss: keys.key, ...(o.identity ? { sub: o.identity } : {}), nbf: t, exp: t + o.ttl, ...(o.name !== undefined ? { name: o.name } : {}), video: o.video }, keys.secret);
}

/** A participant as the room service lists it (the fields the server reads). */
export interface LkParticipant {
  sid: string;
  identity: string;
  /** JOINING, JOINED, ACTIVE or DISCONNECTED */
  state: string;
  /** seconds since the epoch */
  joinedAt: number;
  /** STANDARD for a page; an egress, an agent and the like are other kinds */
  kind: string;
}

/** What LiveKit answered other than yes: its status and Twirp's code (`not_found`, …). */
export class LiveKitError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The address the server asks LiveKit at: --livekit-api, else the pages' --livekit-url as HTTP. */
export function apiOf(url: string, api: string | null): string {
  return (api ?? url.replace(/^ws(s?):\/\//, "http$1://")).replace(/\/+$/, "");
}

/** LiveKit's room service (its Twirp API, JSON): each request with a token of its own, a minute
 *  long, that grants what the request needs and nothing more. */
export class RoomService {
  private api: string;
  private keys: LiveKitKeys;
  private fetch: typeof fetch;
  /** how long a request may take before it counts as unanswered */
  timeoutMs = 10_000;

  constructor(api: string, keys: LiveKitKeys, fetchImpl: typeof fetch = fetch) {
    this.api = api.replace(/\/+$/, "");
    this.keys = keys;
    this.fetch = fetchImpl;
  }

  private async call(method: string, body: object, video: VideoGrant): Promise<unknown> {
    const token = accessToken(this.keys, { ttl: 60, video });
    let r: Response;
    try {
      r = await this.fetch(`${this.api}/twirp/livekit.RoomService/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new LiveKitError(0, "unavailable", `LiveKit (${this.api}) could not be reached: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      let code = "";
      let msg = text.slice(0, 200);
      try {
        const b = JSON.parse(text) as { code?: unknown; msg?: unknown };
        if (typeof b.code === "string") code = b.code;
        if (typeof b.msg === "string") msg = b.msg;
      } catch {
        // not Twirp's JSON: a proxy's page
      }
      // not_found only where LiveKit says so: a 404 of a proxy's, or of a wrong --livekit-api, is no
      // room gone, and nothing it asked was done
      throw new LiveKitError(r.status, code || "unknown", `LiveKit answered ${method} with ${r.status}${msg ? `: ${msg}` : ""}`);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new LiveKitError(r.status, "malformed", `LiveKit's answer to ${method} is not JSON`);
    }
  }

  /** The room's participants; none where LiveKit has no such room (nobody was in it lately). */
  async participants(room: string): Promise<LkParticipant[]> {
    let b: unknown;
    try {
      b = await this.call("ListParticipants", { room }, { roomAdmin: true, room });
    } catch (e) {
      if (e instanceof LiveKitError && e.code === "not_found") return [];
      throw e;
    }
    const list = (b as { participants?: unknown } | null)?.participants;
    return Array.isArray(list) ? list.map(participantOf).filter((p): p is LkParticipant => p !== null) : [];
  }

  /** Remove a participant from the room; one LiveKit does not know (gone already) is no error.
   *  Nothing of its tokens is revoked (`revokeTokenTs` 1: LiveKit's own default, a minute ahead,
   *  would keep the page out that long where it enforces it): the server keeps one removed on
   *  purpose out itself (server/call.ts). */
  async remove(room: string, identity: string): Promise<void> {
    try {
      await this.call("RemoveParticipant", { room, identity, revokeTokenTs: 1 }, { roomAdmin: true, room });
    } catch (e) {
      if (!(e instanceof LiveKitError && e.code === "not_found")) throw e;
    }
  }

  /** Delete the room: every participant is disconnected at once. A room LiveKit does not know is
   *  no error. */
  async deleteRoom(room: string): Promise<void> {
    try {
      await this.call("DeleteRoom", { room }, { roomCreate: true });
    } catch (e) {
      if (!(e instanceof LiveKitError && e.code === "not_found")) throw e;
    }
  }
}

/** A participant of the room service's JSON, or null for one without an identity. Its numbers are
 *  int64s, which protobuf's JSON writes as strings. */
function participantOf(x: unknown): LkParticipant | null {
  const p = x as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || typeof p.identity !== "string" || !p.identity) return null;
  // seconds since the epoch, within reason: anything else is none
  const n = (v: unknown) => {
    const x = typeof v === "number" ? v : typeof v === "string" && /^\d{1,12}$/.test(v) ? Number(v) : 0;
    return Number.isFinite(x) && x > 0 && x < 1e11 ? x : 0;
  };
  return {
    sid: typeof p.sid === "string" ? p.sid : "",
    identity: p.identity,
    state: typeof p.state === "string" ? p.state : "ACTIVE",
    joinedAt: n(p.joinedAt ?? p.joined_at),
    kind: typeof p.kind === "string" ? p.kind : "STANDARD",
  };
}
