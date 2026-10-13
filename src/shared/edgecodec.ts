// The edges as they travel to a page: the graph's (source, destination, site) triples, packed. A
// page far from the server waits on every byte, and the triples as 32-bit integers are mostly
// zeros: grouped by source, with each source's destinations ascending and written as the
// difference from the one before, almost every number fits in a byte. Gzipped, flt-regular's
// 31,432 edges take 21 KB instead of 85 KB.
//
// The format: "VPE2", then unsigned LEB128 varints — the number of nodes n, then for each node
// how many edges leave it, then for each edge in that order ((destination − previous destination)
// << 4) | site, the previous destination starting at 0 for each source. Sites are 4 bits
// (shared/graph.ts, SITE_*; "VPE1", read still, had 3, before the grammar site). The order of the
// edges is not kept: the graph does not depend on it.

const MAGIC = [0x56, 0x50, 0x45, 0x32]; // "VPE2"
/** bits of a site in each format, by the magic's last byte */
const SITE_BITS: Record<number, number> = { 0x31: 3, 0x32: 4 };

/** Pack the triples of `edges` (a graph of `n` nodes). `format` 1 is for a page from before the
 *  grammar site: it takes grammar for a proof, which no TCB follows either. */
export function packEdges(edges: Int32Array, n: number, format: 1 | 2 = 2): Uint8Array {
  const bits = format === 1 ? 3 : 4;
  const unit = 2 ** bits;
  const siteOf = (s: number) => (format === 1 ? (s & 8 ? (s & 7) | 4 : s) & 7 : s);
  const m = edges.length / 3;
  const count = new Int32Array(n);
  for (let e = 0; e < m; e++) count[edges[3 * e]]++;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + count[i];
  // each source's destinations, then sorted: (dst << bits | site) sorts by destination
  const keys = new Float64Array(m);
  const fill = start.slice(0, n);
  for (let e = 0; e < m; e++) keys[fill[edges[3 * e]]++] = edges[3 * e + 1] * unit + siteOf(edges[3 * e + 2]);
  for (let i = 0; i < n; i++) keys.subarray(start[i], start[i + 1]).sort();
  const out = new Uint8Array(4 + 5 * (1 + n + m));
  out.set(MAGIC);
  out[3] = format === 1 ? 0x31 : 0x32;
  let p = 4;
  const put = (v: number) => {
    while (v >= 128) {
      out[p++] = (v & 127) | 128;
      v = Math.floor(v / 128);
    }
    out[p++] = v;
  };
  put(n);
  for (let i = 0; i < n; i++) put(count[i]);
  for (let i = 0; i < n; i++) {
    let prev = 0;
    for (let k = start[i]; k < start[i + 1]; k++) {
      const dst = Math.floor(keys[k] / unit);
      put((dst - prev) * unit + (keys[k] % unit));
      prev = dst;
    }
  }
  return out.subarray(0, p);
}

/** Whether `bytes` are packed edges (the magic, of this format or the one before), not the
 *  triples themselves. */
export function isPackedEdges(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && MAGIC.slice(0, 3).every((b, k) => bytes[k] === b) && bytes[3] in SITE_BITS;
}

/** The triples packed into `bytes`; throws if they are not packed edges or are cut short. */
export function unpackEdges(bytes: Uint8Array): Int32Array<ArrayBuffer> {
  if (!isPackedEdges(bytes)) throw new Error("not packed edges");
  const unit = 2 ** SITE_BITS[bytes[3]];
  let p = 4;
  const get = (): number => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (p >= bytes.length) throw new Error("packed edges cut short");
      const b = bytes[p++];
      v += (b & 127) * scale;
      if (b < 128) return v;
      scale *= 128;
    }
  };
  const n = get();
  const count = new Int32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) m += count[i] = get();
  const edges = new Int32Array(3 * m);
  let e = 0;
  for (let i = 0; i < n; i++) {
    let prev = 0;
    for (let c = 0; c < count[i]; c++, e++) {
      const v = get();
      const dst = prev + Math.floor(v / unit);
      edges[3 * e] = i;
      edges[3 * e + 1] = dst;
      edges[3 * e + 2] = v % unit;
      prev = dst;
    }
  }
  return edges;
}
