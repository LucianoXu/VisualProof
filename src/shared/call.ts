// The call as the server tells the pages of it (CallSpec): who is in it, as the server knows them —
// never as LiveKit, or a participant, says it — and what one page is told alone.

/** A participant of the call. */
export interface CallParticipant {
  /** LiveKit's identity: `p_` and 22 characters (server/call.ts) */
  id: string;
  /** the name they go by; null while the server does not know the page yet (it restarted) */
  name: string | null;
  /** their page as presence lists it: none for a read-only reader's (not listed: CollabSpec
   *  decision 11) */
  page?: string;
  /** invited by a personal link (CollabSpec decision 9): the name is theirs */
  verified?: true;
  /** a read-only reader, by a read-only link that joins the call (CallSpec decision 4) */
  readOnly?: true;
  /** when they joined, as LiveKit says it; null where it does not */
  joined: string | null;
}

/** `call`: the call now, to every page where calls are on. */
export interface CallState {
  /** from its first participant until it has had none for 60 seconds (CallSpec decision 2) */
  session: { id: string; started: string } | null;
  participants: CallParticipant[];
}

/** `call-invite`: someone in the call invites this page's reader. */
export interface CallInvite {
  from: string;
  at: string;
}

/** `call-removed`, `call-ended`: who removed this page's participant, or ended the call. */
export interface CallBy {
  by: string | null;
}

/** What a page's request for a token is answered (POST /api/call/token). */
export interface CallJoin {
  url: string;
  token: string;
  identity: string;
  room: string;
}

/** What a tab of a page calls itself in the call (web/src/call/tab.ts): the server's identity of
 *  its participant is made of it, and nobody else is told it. */
export const CALL_TAB = /^[A-Za-z0-9_-]{16,64}$/;
