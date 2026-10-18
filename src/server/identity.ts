// Who records something (CollabSpec decision 3). By default the name the page gives, as it gives
// it: any name, changed at will, nothing checked (relaxed on 2026-10-07 — names used to be claimed
// with a secret). The page sends it with every request as `X-VisualProof-Name`, percent-encoded so
// that any script travels in a header. Behind a proxy that signs people in, the name is the one the
// proxy puts in its own header instead, and the page cannot change it.
//
// Someone invited by a personal link (CollabSpec decision 9, server/invites.ts) is who the link's
// cookie says, whatever the page sends: the link's id is who they are, and the name they go by is
// the link's, changed through the server. While their link is in force, nobody coming by the key's
// link (a guest) can go by that name: such a request is taken as one without a name, so that
// whatever needs one is refused and the page asks for another (`taken` says why).
//
// An agent says it is one (AgentSpec decision 1) with `X-VisualProof-Kind: agent` beside its name.
// Nothing checks that either: the kind is what makes its opinions advice, so an agent that does not
// say it is one is taken for a person, as a person who says so is taken for an agent.
//
// A private reader (CollabSpec decision 8) says so with every request, `X-VisualProof-Private`
// carrying what the page calls itself (its event stream's session). What they arrange is recorded
// without their name (layoutAuthor, below); their review keeps it.

import type { IncomingMessage } from "node:http";
import { validName, validSession } from "../shared/collab.ts";
import type { InviteCheck, InviteRecord, Invites } from "./invites.ts";

export const NAME_HEADER = "x-visualproof-name";
export const KIND_HEADER = "x-visualproof-kind";
export const PRIVATE_HEADER = "x-visualproof-private";

/** Who makes a request: a person, or an agent (AgentSpec.md). */
export type Kind = "person" | "agent";

export class Identities {
  /** the header an authenticating proxy names the reader in, or null: the page's name is taken */
  readonly header: string | null;
  /** the personal links (server/invites.ts), which say who their holders are; none behind a proxy
   *  that signs people in, whose names are the proxy's */
  invites: Invites | null = null;
  /** what each request's cookie said, read once per request */
  private seen = new WeakMap<IncomingMessage, InviteCheck>();

  constructor(header: string | null = null) {
    this.header = header ? header.toLowerCase() : null;
  }

  get mode(): "declared" | "header" {
    return this.header ? "header" : "declared";
  }

  /** What the personal link's cookie a request carries says: a link in force, one revoked, none. */
  link(req: IncomingMessage): InviteCheck {
    if (this.header || !this.invites) return null;
    if (!this.seen.has(req)) this.seen.set(req, this.invites.ofCookie(req.headers.cookie));
    return this.seen.get(req)!;
  }

  /** The holder of a personal link in force a request comes from, or null. */
  person(req: IncomingMessage): InviteRecord | null {
    const l = this.link(req);
    return l && "ok" in l ? l.ok : null;
  }

  /** The name a request is made under, or null when it gives none — or gives one a holder of a
   *  personal link goes by, and is not theirs. */
  who(req: IncomingMessage): string | null {
    const p = this.person(req);
    if (p) return p.name;
    const s = this.said(req);
    return s && !this.taken(req, s) ? s : null;
  }

  /** The holder of a personal link in force who goes by the name a guest's request gives, which is
   *  then not theirs to take; null for any other request. An agent's names are its own: it is
   *  marked as one wherever it is named. */
  taken(req: IncomingMessage, name = this.said(req)): InviteRecord | null {
    if (!name || !this.invites || this.header || this.person(req) || this.kind(req) === "agent") return null;
    return this.invites.holder(name) ?? null;
  }

  /** The name a request's headers give, checked to be a name. */
  private said(req: IncomingMessage): string | null {
    const raw = req.headers[this.header ?? NAME_HEADER];
    let s = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!s) return null;
    if (this.header) s = headerText(s);
    else {
      try {
        s = decodeURIComponent(s);
      } catch {
        return null;
      }
    }
    return validName(s) ? s : null;
  }

  /** Whether a request comes from an agent: it says so. A personal link's holder is a person. */
  kind(req: IncomingMessage): Kind {
    if (this.person(req)) return "person";
    const raw = req.headers[KIND_HEADER];
    return (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() === "agent" ? "agent" : "person";
  }

  /** Whether a request comes from a private page (CollabSpec decision 8): the session the page
   *  calls itself by, "" where it gives none, or null for any other request. An agent is never
   *  private, whatever it sends: its token or its name is who it is, and it is always listed. Nothing
   *  checks a page that says it is private either: it only gives up its name on what it arranges. */
  privateOf(req: IncomingMessage): string | null {
    if (this.kind(req) === "agent") return null;
    const raw = req.headers[PRIVATE_HEADER];
    const s = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (s === undefined) return null;
    return validSession(s) ? s : "";
  }
}

/** A proxy's header as the text it carries. Node reads a header's bytes one character each
 *  (Latin-1), so a name a proxy writes in UTF-8 — José, 许英特 — is read again as UTF-8 where its
 *  bytes are UTF-8 (a Latin-1 "José" is not, and stays); and a value that is MIME encoded-words
 *  (RFC 2047, `=?utf-8?q?Jos=C3=A9?=`), as Tailscale writes a name beyond ASCII, is decoded. */
export function headerText(s: string): string {
  let bytes: Buffer | null = null;
  if (/^(?:=\?utf-8\?[bq]\?[^?\s]*\?=\s*)+$/i.test(s)) {
    // the words one after the other, the spaces between them nothing (RFC 2047, section 6.2)
    const word = ([, enc, text]: RegExpMatchArray) =>
      enc.toLowerCase() === "b" ? Buffer.from(text, "base64") : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
    bytes = Buffer.concat([...s.matchAll(/=\?utf-8\?([bq])\?([^?\s]*)\?=/gi)].map(word));
  } else if (/[\u0080-\u00ff]/.test(s) && !/[^\u0000-\u00ff]/.test(s)) bytes = Buffer.from(s, "latin1");
  if (!bytes) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

/** The name a change to the layout is recorded under (CollabSpec decision 8): the caller's, or none
 *  for a private reader, who shows as "someone" — on the boards, in Activity, among pin authors and
 *  in the agents' answers. This is where a private reader's anonymity lives: whatever arranges a
 *  board — pins, folds, re-layouts, scopes and clusterings, views made, renamed and deleted, notes
 *  left on a board — takes its author from here, through server/views.ts (`handle`, whose `me` is
 *  this) and main.ts (an undo). The review is not layout: opinions, targets, key marks and trust
 *  take the caller's own name, and need one. */
export function layoutAuthor(caller: { name: string | null; private?: unknown }): string | null {
  return caller.private ? null : caller.name;
}
