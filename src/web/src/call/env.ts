// What the call's own bundle (web/src/call/main.ts, `call.js`) and the page (web/src/pagecall.ts)
// give each other: the page hands the call the window's body and what it knows — who the reader is,
// who is here, what the server says of the call — and the call hands back a view the page drives.
// Types alone: the page carries none of the call's code until its window first opens.

import type { CallJoin, CallState } from "../../../shared/call.ts";

/** Why a request of the call's was refused, or null where it was done. */
export type Refusal = string | null;

export interface CallEnv {
  /** the call window's body: the call fills it */
  el: HTMLElement;
  /** what the server says of the call now (`call`); null before it says anything */
  state(): CallState | null;
  /** the reader as the call needs them */
  me(): { name: string | null; readOnly: boolean; private: boolean; page: string | null };
  /** the people here, not in the call: their page in presence, their name */
  here(): { page: string; name: string; verified: boolean }[];
  /** a token for this page's tab; `name` a read-only reader's, which they give in the pre-join */
  token(name: string | null): Promise<CallJoin | { error: string; who?: boolean; private?: boolean }>;
  end(): Promise<Refusal>;
  remove(identity: string): Promise<Refusal>;
  invite(page: string): Promise<Refusal>;
  /** this page left the call: the server is told (its participant goes at once) */
  left(): void;
  /** the reader's name, asked for in the page's own window where there is none; null if declined */
  ensureName(): Promise<string | null>;
  /** the reader goes visible (CollabSpec decision 8): in a call one is seen */
  goVisible(): Promise<void>;
  /** follow the person whose page is `page`, as their initials' menu does */
  follow(page: string): void;
  /** ask the person whose page is `page` — or, null, everyone — to follow the reader */
  askToFollow(page: string | null): Promise<Refusal>;
  /** Copy call link (CallSpec decision 6) */
  copyLink(): void;
  /** said for a moment, where the page says things */
  say(text: string): void;
  /** joined, left, the microphone switched: the button and the window's title are drawn again */
  changed(): void;
  /** whether the call's window is seen: open, not collapsed, the page in front */
  seen(): boolean;
  /** LiveKit put this page out of the call: the call ended, the participant was removed, it went on
   *  in another tab of this browser, or the connection was lost for good */
  dropped(why: "ended" | "removed" | "elsewhere" | "lost"): void;
  /** close the window (the pre-join's Cancel) */
  close(): void;
}

/** The call in its window, as the page drives it. */
export interface CallView {
  /** The pre-join; or, rejoining (a page reloaded in a call), the call at once, the microphone and
   *  the camera as they were. */
  start(o?: { rejoin?: { mic: boolean; cam: boolean } }): void;
  readonly inCall: boolean;
  /** the microphone is on, in the call */
  readonly mic: boolean;
  readonly cam: boolean;
  toggleMic(): void;
  /** leave the call: the window closes after */
  leave(): Promise<void>;
  /** the server told something new of the call, or of who is here */
  stateChanged(): void;
  /** the window was collapsed or opened again, or the page hidden or shown */
  shownChanged(): void;
  /** the page goes: out of the call at once, without a word */
  pageGone(): void;
  dispose(): void;
}

export type StartCall = (env: CallEnv) => CallView;
