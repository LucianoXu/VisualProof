// The types of scripts/tips/mp4.mjs, for the tests that read what it writes.

/** A frame as the encoder gave it: its bytes, whether it is a sync sample, when it is shown (in
 *  thousandths of a frame). */
export interface Sample {
  data: Uint8Array;
  key: boolean;
  pts: number;
}

export function mp4(o: { width: number; height: number; fps: number; avcC: Uint8Array; samples: Sample[] }): Buffer;

/** A box of a file read back: its type, its size, where it is, the boxes it holds. */
export interface Box {
  type: string;
  size: number;
  at: number;
  children: Box[];
}

export function boxes(buf: Buffer, from?: number, to?: number): Box[];
