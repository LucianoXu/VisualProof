// The types of scripts/tips-record.mjs, for the test that reads its storyboards and what it makes.

export interface Size {
  width: number;
  height: number;
}

/** One thing done in a film: one verb (camera, move, click, choose, pdf, tap, key, type, drag,
 *  swipe, pinch, wheel, scroll, wait, waitFor, hide, poster, filmPoster, fade, caption, agent, eval)
 *  and how. */
export type Step = Record<string, any>;

/** A chapter of a film: its id and what is done in it. */
export interface Chapter {
  id: string;
  steps: Step[];
}

/** A film as its storyboard says it (scripts/tips/storyboards/<id>.mjs). */
export interface Storyboard {
  id: string;
  /** what it plays on: Sphere-Packing-Lean from an empty site, or the flt-regular showcase */
  on: "sphere" | "showcase";
  /** false: the film goes elsewhere (--film), the repository keeping its data and stills */
  kept?: boolean;
  /** the pointer's pace, px a second */
  pace?: number;
  /** the address's fragment the page opens on: the view, the tool, the selection */
  address?: string;
  /** done before the film begins, unrecorded */
  before?: Step[];
  /** a film of one chapter; or, in chapters, a film whose times and key frames are kept */
  steps?: Step[];
  chapters?: Chapter[];
  /** the files it hands the page: a name, then the .tex in scripts/tips/ typeset for it */
  files?: Record<string, string>;
  /** a phone's film: touch, a finger for the pointer */
  phone?: boolean;
  viewport?: Size;
  /** the film's size, if not FILM.out */
  out?: Size;
  fps?: number;
  bitrate?: number;
  keyEvery?: number;
  /** the frame's width on the page at first, in CSS pixels */
  width?: number;
  /** the reader's name, if not Alice */
  reader?: string;
  pointer?: { x: number; y: number };
  hidePointer?: boolean;
  /** how long a frame may wait for the server (Lean's language server, a document typeset) */
  patience?: number;
  settle?: number;
  store?: Record<string, unknown>;
}

export const FILM: { viewport: Size; out: Size; fps: number; bitrate: number; keyEvery: number; now: string; pace: number; reading: number; shownAtLeast: number; warnAbove: number; stillMax: number };

/** A caption of a film: from, to (seconds), what it says. */
export interface Caption {
  start: number;
  end: number;
  text: string;
}

export function readingTime(text: string): number;
export const BOARDS: string;
export function storyboards(dir?: string): Promise<Map<string, Storyboard>>;
export function chaptersOf(board: Storyboard): Chapter[];
