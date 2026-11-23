// An extraction's file, read. One string holds 512 MB at most (V8), and a project of a million
// declarations writes several GB: past WHOLE the file is read a piece at a time — its top-level
// arrays an element at a time, each parsed on its own — and its edges, a hundred million triples,
// are never held as arrays: they are packed as they are read (RawGraph.packed), as the view packs
// them anyway (server/view.ts).

import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import type { RawGraph } from "../shared/graph.ts";

/** A file up to this size is read whole. */
export const WHOLE = 256 * 1024 * 1024;
const CHUNK = 32 * 1024 * 1024;

const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c, COLON = 0x3a, MINUS = 0x2d;
const OPEN_OBJ = 0x7b, CLOSE_OBJ = 0x7d, OPEN_ARR = 0x5b, CLOSE_ARR = 0x5d;
const space = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/** The graph a file holds, and the SHA-256 of its bytes (what `sha256(text)` is of a file read
 *  whole). `whole`: the size past which it is read in pieces, of `piece` bytes. */
export function readGraphFile(file: string, whole = WHOLE, piece = CHUNK): { graph: RawGraph; sha256: string } {
  if (statSync(file).size <= whole) {
    const text = readFileSync(file, "utf8");
    return { graph: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
  }
  return readInPieces(file, piece);
}

/** What is said where a graph read in pieces reaches what cannot take it yet: a server, an exported
 *  snapshot, the usage pass. Its edges are packed (RawGraph.packed), and those read `edges`. */
export const TOO_LARGE = "this project's graph is too large to be served, exported or given a usage pass yet (its extraction is read in pieces): `visualproof artwork --jobs 0` draws it";

/** The graph alone. */
export function readGraph(file: string, whole = WHOLE): RawGraph {
  return readGraphFile(file, whole).graph;
}

/** A JSON object's file read a piece at a time: a top-level array gives its elements one by one,
 *  any other top-level value is parsed whole; `edges`, an array of triples of integers, is packed
 *  into one Int32Array, never parsed. */
function readInPieces(file: string, piece: number): { graph: RawGraph; sha256: string } {
  const out: Record<string, unknown> = {};
  const hash = createHash("sha256");
  let packed = new Int32Array(1 << 22);
  let filled = 0;
  const push = (v: number) => {
    if (filled === packed.length) {
      const more = new Int32Array(packed.length * 2);
      more.set(packed);
      packed = more;
    }
    packed[filled++] = v;
  };

  // where the scan is: `depth` 1 inside the top-level object; `key` the member being read, `arr`
  // the array it is (elements at depth 2), `edges` when that array is the edges'
  let depth = 0;
  let inStr = false, esc = false;
  let key: string | null = null;
  let afterColon = false;
  let arr: unknown[] | null = null;
  let edges = false;
  // what is being collected to parse: a key, a value, an array's element — its bytes so far, and
  // where it goes on in this chunk (-1: nothing is being collected)
  let parts: Buffer[] = [];
  let from = -1;
  // the number being read in the edges
  let num = 0, neg = false, digits = false;

  const take = (chunk: Buffer, to: number): string => {
    const piece = chunk.subarray(from, to);
    const text = parts.length ? Buffer.concat([...parts, piece]).toString("utf8") : piece.toString("utf8");
    parts = [];
    from = -1;
    return text;
  };
  const endNumber = () => {
    if (digits) push(neg ? -num : num);
    num = 0;
    neg = false;
    digits = false;
  };

  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(piece);
    for (;;) {
      const n = readSync(fd, chunk, 0, piece, null);
      if (n === 0) break;
      hash.update(chunk.subarray(0, n));
      if (from >= 0) from = 0;
      for (let i = 0; i < n; i++) {
        const b = chunk[i];
        if (inStr) {
          if (esc) esc = false;
          else if (b === BACKSLASH) esc = true;
          else if (b === QUOTE) {
            inStr = false;
            // a key of the top-level object
            if (depth === 1 && !afterColon) key = JSON.parse(take(chunk, i + 1)) as string;
          }
          continue;
        }
        if (edges) {
          // [[1,2,3],[4,5,6]]: digits make numbers; anything else ends one
          if (b >= 0x30 && b <= 0x39) {
            num = num * 10 + (b - 0x30);
            digits = true;
          } else if (b === MINUS) neg = true;
          else {
            endNumber();
            if (b === OPEN_ARR) depth++;
            else if (b === CLOSE_ARR) {
              depth--;
              if (depth === 1) {
                edges = false;
                afterColon = false;
                key = null;
              }
            }
          }
          continue;
        }
        if (b === QUOTE) {
          inStr = true;
          if (from < 0 && (depth === 1 || (arr && depth === 2))) from = i;
          continue;
        }
        if (space(b)) continue;
        if (b === OPEN_OBJ || b === OPEN_ARR) {
          depth++;
          if (depth === 2 && afterColon && key !== null && from < 0) {
            if (b === OPEN_ARR && !arr) {
              // a top-level array: its elements come one by one
              if (key === "edges") edges = true;
              else arr = [];
              continue;
            }
            from = i;
          } else if (depth === 3 && arr && from < 0) from = i;
          continue;
        }
        if (b === CLOSE_OBJ || b === CLOSE_ARR) {
          if (arr && depth === 2) {
            // the array ends, and its last element with it
            if (from >= 0) arr.push(JSON.parse(take(chunk, i)));
            out[key!] = arr;
            arr = null;
            afterColon = false;
            key = null;
          } else if (depth === 1) {
            // the object ends, and its last value with it
            if (from >= 0 && key !== null) out[key] = JSON.parse(take(chunk, i));
          } else if (depth === 2 && !arr && from >= 0) {
            // a top-level object or (never an array here) value closes
            out[key!] = JSON.parse(take(chunk, i + 1));
            afterColon = false;
            key = null;
          }
          depth--;
          continue;
        }
        if (b === COLON) {
          if (depth === 1) afterColon = true;
          continue;
        }
        if (b === COMMA) {
          if (arr && depth === 2) {
            if (from >= 0) arr.push(JSON.parse(take(chunk, i)));
          } else if (depth === 1) {
            if (from >= 0 && key !== null) out[key] = JSON.parse(take(chunk, i));
            afterColon = false;
            key = null;
          }
          continue;
        }
        // a number, true, false or null begins: a top-level value, or an array's element
        if (from < 0 && ((depth === 1 && afterColon) || (arr && depth === 2))) from = i;
      }
      // what is being collected goes on in the next chunk
      if (from >= 0) parts.push(Buffer.from(chunk.subarray(from, n)));
    }
  } finally {
    closeSync(fd);
  }
  if (depth !== 0 || inStr) throw new Error(`${file} is not a whole JSON file: it ends inside a value`);
  const graph = out as unknown as RawGraph;
  if (filled % 3 !== 0) throw new Error(`${file}: its edges are not triples`);
  graph.edges = [];
  // a copy of its own size: the buffer it grew in is up to twice as large, and whoever is given the
  // edges (a layout's worker) is given their whole buffer
  graph.packed = packed.slice(0, filled);
  return { graph, sha256: hash.digest("hex") };
}
