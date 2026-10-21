// The types of scripts/tips/film.mjs, for the tests that take films apart and join them.

import type { Read, Sample } from "./mp4.d.mts";

export interface Caption {
  start: number;
  end: number;
  text: string;
}

/** A chapter as recorded, or as taken from a film: its length in frames, its captions and samples
 *  counted from its start, its encoder's description. */
export interface Part {
  id: string;
  frames: number;
  captions: Caption[];
  samples: Sample[];
  avcC: Uint8Array;
}

/** What a film's data (`<id>.json`) says of its chapters and captions. */
export interface About {
  chapters: { id: string; start: number; end: number }[];
  captions: Caption[];
}

export function split(file: Read, about: About): Part[];
export function join(chapters: Part[], fps: number): { samples: Sample[]; avcC: Uint8Array; chapters: { id: string; start: number; end: number }[]; captions: Caption[]; frames: number; duration: number };
export function groups(ids: string[], seconds: Map<string, number>, wanted: string[], jobs: number, cost?: { skip?: number; take?: number }): string[][];
