// The call (CallSpec): one per server, on the LiveKit server the operator names (decisions 1 and 2).
// The server gives each page that joins a token for the room, and keeps a seat for it: whose page it
// is, under which name. Who is in the call is LiveKit's list of the room's participants, read while
// a call may be going on; the server keeps what it reads, tells every page of it (`call`), and
// removes a participant whose page went and did not come back, one removed on purpose that came back
// with a token it already had, and one that is no page's at all. A session lasts from its first
// participant until it has had none for 60 seconds. Nothing of a call is written but the room's id
// and the secret identities are made with (`<site>/call.json`): no recording, no transcript, nothing
// in the timeline (decision 7).
//
// A participant's identity is `p_` and 22 characters of an HMAC of what the page's tab calls itself
// in the call (shared/call.ts, CALL_TAB), which nobody else is told: a page that reloads joins as
// the participant it was, which LiveKit then replaces; nobody can take another page's place by the
// identity everyone in the call sees; and a server that restarts knows its pages again as they ask
// for a token anew, the call going on meanwhile on LiveKit.

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, RoomService } from "./livekit.ts";
import type { LiveKitKeys, LkParticipant } from "./livekit.ts";
import type { CallJoin, CallParticipant, CallState } from "../shared/call.ts";

/** An open page as the call needs it: what the server knows of its event stream. */
export interface CallPage {
  /** the stream's secret, which the page's requests carry */
  token: string;
  /** the id presence lists the page by */
  id: string;
  private: boolean;
  /** a read-only reader's: the read-only link it came by, or "public"; null for anyone else */
  readOnly: string | null;
  /** the name it goes by, a guest's as its heartbeats say it */
  name: string | null;
  /** the personal link it came by (CollabSpec decision 9) */
  person: string | null;
}

export interface CallHooks {
  /** the open page whose stream holds secret `token` */
  page(token: string): CallPage | null;
  /** the open page presence lists as `id` */
  pageById(id: string): CallPage | null;
  /** every page is told */
  send(event: string, data: unknown): void;
  /** one page is told */
  sendTo(token: string, event: string, data: unknown): void;
  log(line: string): void;
}

const FILE = "call.json";
/** how long a page's token lasts: LiveKit gives a page in the call fresh ones meanwhile */
export const TOKEN_TTL_S = 600;
/** how long a call without anyone in it is still the same session */
export const SESSION_GRACE_MS = 60_000;
/** how long a page whose stream closed may take to come back before its participant goes */
export const PAGE_GONE_MS = 45_000;
/** how often LiveKit is asked who is in the call, while one may be going on */
export const LOOK_MS = 2_000;
/** how long after a token was given a call may be starting */
export const STARTING_MS = 120_000;
/** how long a participant removed on purpose is kept out, unless a token is given for it again */
export const REMOVED_MS = 15 * 60_000;
/** at most this many tokens a minute per page, invites the same */
export const PER_MINUTE = 10;
const IDENTITY = /^p_[A-Za-z0-9_-]{22}$/;

/** A participant as the server knows it: the page it gave the token to, and under which name. */
interface Seat {
  token: string;
  name: string;
  /** the read-only link it came by; null for anyone let in fully */
  link: string | null;
  /** the personal link it came by (CollabSpec decision 9); null for anyone else */
  person: string | null;
  verified: boolean;
  /** when its page's stream closed; null while it is open */
  gone: number | null;
}

export interface CallOptions {
  /** where pages reach LiveKit (--livekit-url) */
  url: string;
  /** where the server asks LiveKit (--livekit-api, else the url as HTTP) */
  api: string;
  keys: LiveKitKeys;
  /** the site's folder, where the room's id and the identities' secret are kept; null: in memory
   *  (the tests) */
  site: string | null;
  hooks: CallHooks;
  fetch?: typeof fetch;
}

export class CallRoom {
  /** where pages reach LiveKit */
  readonly url: string;
  /** the LiveKit room: `visualproof-<id>` */
  readonly room: string;
  readonly service: RoomService;
  private keys: LiveKitKeys;
  private secret: Buffer;
  private hooks: CallHooks;
  private seats = new Map<string, Seat>();
  /** removed on purpose, by identity: when; kept out until a token is given for it again */
  private removed = new Map<string, number>();
  /** who LiveKit listed last, of the pages' participants */
  private present: LkParticipant[] = [];
  session: { id: string; started: string } | null = null;
  private emptySince: number | null = null;
  private lastToken = 0;
  private readonly started = Date.now();
  /** what the pages were told last */
  private told = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private looking: Promise<void> | null = null;
  private again = false;
  private rates = new Map<string, number[]>();
  /** why LiveKit could not be asked, the last time it could not; null since it answered */
  unavailable: string | null = null;

  constructor(o: CallOptions) {
    this.url = o.url;
    this.keys = o.keys;
    this.hooks = o.hooks;
    this.service = new RoomService(o.api, o.keys, o.fetch);
    const kept = o.site ? readKept(join(o.site, FILE)) : null;
    const made = kept ?? { room: randomBytes(6).toString("hex"), secret: randomBytes(32).toString("base64url") };
    if (o.site && !kept) writeKept(join(o.site, FILE), made);
    this.room = `visualproof-${made.room}`;
    this.secret = Buffer.from(made.secret, "base64url");
  }

  /** Ask LiveKit who is in the call now, and from then on while a call may be going on. */
  start(): void {
    void this.look();
    this.timer = setInterval(() => {
      if (this.active()) void this.look();
    }, LOOK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
    this.timer = this.soon = null;
  }

  /** Whether a call may be going on: one has a session, someone is in it, a token was given lately,
   *  or the server has just started and may find one. */
  private active(now = Date.now()): boolean {
    return this.session !== null || this.present.length > 0 || now - this.lastToken < STARTING_MS || now - this.started < PAGE_GONE_MS + LOOK_MS;
  }

  /** The identity of the participant a tab joins as. */
  identityOf(tab: string): string {
    return `p_${createHmac("sha256", this.secret).update(`visualproof call\0${tab}`).digest("base64url").slice(0, 22)}`;
  }

  /** 0 where `key` may go now (and it is counted), else the seconds to wait. */
  allow(key: string, now = Date.now()): number {
    const ts = (this.rates.get(key) ?? []).filter((t) => now - t < 60_000);
    if (ts.length >= PER_MINUTE) {
      this.rates.set(key, ts);
      return Math.max(1, Math.ceil((ts[0] + 60_000 - now) / 1000));
    }
    ts.push(now);
    this.rates.set(key, ts);
    if (this.rates.size > 1000) for (const [k, v] of this.rates) if (!v.some((t) => now - t < 60_000)) this.rates.delete(k);
    return 0;
  }

  /** A token for `page`'s tab, under `name`; `link` the read-only link it came by, if it did. A token
   *  given for an identity removed on purpose lets it in again: joining is deliberate. */
  give(page: CallPage, tab: string, name: string, link: string | null, now = Date.now()): CallJoin {
    const identity = this.identityOf(tab);
    this.removed.delete(identity);
    this.seats.set(identity, { token: page.token, name, link, person: page.person, verified: page.person !== null, gone: null });
    this.lastToken = now;
    const token = accessToken(this.keys, {
      identity,
      name,
      ttl: TOKEN_TTL_S,
      video: {
        room: this.room,
        roomJoin: true,
        canPublish: true,
        canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"],
        canSubscribe: true,
        canPublishData: true,
        // the raised hand is the participant's own attribute
        canUpdateOwnMetadata: true,
      },
    }, now);
    this.lookSoon();
    return { url: this.url, token, identity, room: this.room };
  }

  /** The identity of the participant a page has in the call now, or null. */
  inCall(token: string): string | null {
    for (const p of this.present) if (this.seats.get(p.identity)?.token === token) return p.identity;
    return null;
  }

  /** Whether a page holds a seat: it was given a token, and has not left. */
  seated(token: string): boolean {
    for (const s of this.seats.values()) if (s.token === token) return true;
    return false;
  }

  /** A page leaves: its participant is removed now, nothing kept out. */
  async leave(token: string): Promise<void> {
    const mine = [...this.seats].filter(([, s]) => s.token === token).map(([id]) => id);
    for (const id of mine) this.seats.delete(id);
    await Promise.all(mine.map((id) => this.service.remove(this.room, id).catch((e: unknown) => this.said(e))));
    this.lookSoon();
  }

  /** Someone in the call removes a participant: it is disconnected, its page told, and kept out
   *  until it asks for a token again. False where it is not in the call. */
  async remove(identity: string, by: string | null): Promise<boolean> {
    if (!this.present.some((p) => p.identity === identity)) return false;
    const seat = this.seats.get(identity);
    await this.cut(identity);
    if (seat) this.hooks.sendTo(seat.token, "call-removed", { by });
    return true;
  }

  /** Remove on purpose, telling nobody: a participant whose read-only or personal link ended. */
  private async cut(identity: string): Promise<void> {
    this.removed.set(identity, Date.now());
    this.seats.delete(identity);
    await this.service.remove(this.room, identity);
    this.lookSoon();
  }

  /** The participants of a page's stream go, on purpose: its link was revoked, or stopped joining
   *  the call. */
  cutPage(token: string): void {
    for (const [id, s] of [...this.seats]) if (s.token === token) void this.cut(id).catch((e: unknown) => this.said(e));
  }

  /** The participants of read-only link `link` go, on purpose: it no longer joins the call, or was
   *  revoked — a page whose stream had closed already too. */
  cutLink(link: string): void {
    for (const [id, s] of [...this.seats]) if (s.link === link) void this.cut(id).catch((e: unknown) => this.said(e));
  }

  /** The participants of personal link `person` go, on purpose: it was revoked — a page whose stream
   *  had closed already too. */
  cutPerson(person: string): void {
    for (const [id, s] of [...this.seats]) if (s.person === person) void this.cut(id).catch((e: unknown) => this.said(e));
  }

  /** End the call for everyone: the room is deleted, every page told; whoever was in it is kept out
   *  until they ask for a token again. */
  async end(by: string | null): Promise<void> {
    await this.service.deleteRoom(this.room);
    const now = Date.now();
    for (const p of this.present) this.removed.set(p.identity, now);
    for (const id of this.seats.keys()) this.removed.set(id, now);
    this.seats.clear();
    this.present = [];
    this.session = null;
    this.emptySince = null;
    this.hooks.send("call-ended", { by });
    this.publish();
  }

  /** Someone in the call invites the reader of page `to`: their page is told. */
  invite(to: string, from: string): "ok" | "none" | "in" {
    const page = this.hooks.pageById(to);
    if (!page || page.private) return "none";
    if (this.inCall(page.token)) return "in";
    this.hooks.sendTo(page.token, "call-invite", { from, at: new Date().toISOString() });
    return "ok";
  }

  /** A page's event stream closed: its participant has a while to come back (a reload, a lost
   *  connection) before it goes. */
  streamClosed(token: string, now = Date.now()): void {
    for (const s of this.seats.values()) if (s.token === token && s.gone === null) s.gone = now;
  }

  /** The call as the pages are told it. */
  state(): CallState {
    return { session: this.session, participants: this.present.map((p) => this.entry(p)) };
  }

  private entry(p: LkParticipant): CallParticipant {
    const seat = this.seats.get(p.identity);
    const page = seat && seat.gone === null ? this.hooks.page(seat.token) : null;
    // a page's name as its heartbeats say it now; a read-only reader's as they gave it
    const name = seat ? (seat.link === null ? (page?.name ?? seat.name) : seat.name) : null;
    return {
      id: p.identity,
      name,
      ...(page && !page.private && page.readOnly === null ? { page: page.id } : {}),
      ...(seat?.verified ? { verified: true as const } : {}),
      ...(seat?.link ? { readOnly: true as const } : {}),
      joined: p.joinedAt ? new Date(p.joinedAt * 1000).toISOString() : null,
    };
  }

  /** Tell the pages, where something changed. */
  private publish(): void {
    const s = this.state();
    const text = JSON.stringify(s);
    if (text === this.told) return;
    this.told = text;
    this.hooks.send("call", s);
  }

  /** Ask LiveKit again in a moment: someone joins, leaves or is removed. */
  lookSoon(ms = 400): void {
    if (this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      void this.look();
    }, ms);
    this.soon.unref?.();
  }

  /** Ask LiveKit who is in the call, and act on it: keep out who is to be kept out, start and end
   *  the session, tell the pages. One look at a time; one asked meanwhile follows it. */
  look(now?: number): Promise<void> {
    if (this.looking) {
      this.again = true;
      return this.looking;
    }
    this.looking = this.lookNow(now).finally(() => {
      this.looking = null;
      if (this.again) {
        this.again = false;
        void this.look();
      }
    });
    return this.looking;
  }

  private async lookNow(at?: number): Promise<void> {
    let list: LkParticipant[];
    try {
      list = await this.service.participants(this.room);
    } catch (e) {
      this.said(e);
      return;
    }
    if (this.unavailable) this.hooks.log("call: LiveKit answers again");
    this.unavailable = null;
    const now = at ?? Date.now();
    for (const [id, t] of this.removed) if (now - t > REMOVED_MS) this.removed.delete(id);
    const out: string[] = [];
    const ours: LkParticipant[] = [];
    for (const p of list) {
      // an egress, an agent and the like are no page's: left alone
      if (p.kind && p.kind !== "STANDARD") continue;
      if (p.state === "DISCONNECTED") continue;
      const seat = this.seats.get(p.identity);
      const page = seat && seat.gone === null ? this.hooks.page(seat.token) : null;
      if (seat && seat.gone === null && !page) seat.gone = now;
      const keep =
        IDENTITY.test(p.identity) &&
        !this.removed.has(p.identity) &&
        // a page the server does not know (it restarted) has a while to ask for a token again
        (seat ? seat.gone === null || now - seat.gone < PAGE_GONE_MS : now - this.started < PAGE_GONE_MS) &&
        // a page that went private leaves: in a call one is seen
        !page?.private;
      if (keep) ours.push(p);
      else out.push(p.identity);
    }
    for (const id of out) this.seats.delete(id);
    await Promise.all(out.map((id) => this.service.remove(this.room, id).catch((e: unknown) => this.said(e))));
    // the seats of pages gone that LiveKit no longer lists are forgotten
    for (const [id, s] of [...this.seats]) if (s.gone !== null && now - s.gone >= PAGE_GONE_MS && !ours.some((p) => p.identity === id)) this.seats.delete(id);
    this.present = ours;
    if (ours.length) {
      this.emptySince = null;
      this.session ??= { id: randomBytes(6).toString("hex"), started: new Date(now).toISOString() };
    } else if (this.session) {
      this.emptySince ??= now;
      if (now - this.emptySince >= SESSION_GRACE_MS) {
        this.session = null;
        this.emptySince = null;
      }
    }
    this.publish();
  }

  /** LiveKit could not be asked: said once, until it answers again. */
  private said(e: unknown): void {
    const why = e instanceof Error ? e.message : String(e);
    if (this.unavailable === null) this.hooks.log(`call: ${why}`);
    this.unavailable = why;
  }
}

/** What `call.json` keeps: the room's id, and the secret identities are made with. */
interface Kept {
  room: string;
  secret: string;
}

function readKept(file: string): Kept | null {
  if (!existsSync(file)) return null;
  try {
    const k = JSON.parse(readFileSync(file, "utf8")) as Partial<Kept>;
    if (typeof k.room === "string" && /^[0-9a-f]{12}$/.test(k.room) && typeof k.secret === "string" && /^[A-Za-z0-9_-]{43}$/.test(k.secret)) return { room: k.room, secret: k.secret };
  } catch {
    // made anew below
  }
  renameSync(file, `${file}.broken-${Date.now()}`);
  return null;
}

function writeKept(file: string, k: Kept): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(k, null, 1) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}
