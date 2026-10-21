// An MP4 file of one H.264 track, from what WebCodecs' VideoEncoder gives (its chunks, in decode
// order, and the decoder configuration's `description`, the avcC record): the boxes a browser needs
// to play it, with the index (moov) before the samples (mdat), so that it plays as it arrives. No
// sound, a chunk of samples a second (players that read a chunk whole, as Apple's do, then stream it), no edit list. ISO/IEC 14496-12 (the boxes) and 14496-15 (avc1, avcC).

/** A box: its size, its four-letter type, then what it holds. */
function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/** A full box: a box whose first four bytes are a version and flags. */
function full(type, version, flags, ...parts) {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0);
  return box(type, vf, ...parts);
}

function u32(...v) {
  const b = Buffer.alloc(4 * v.length);
  v.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i));
  return b;
}

function u16(...v) {
  const b = Buffer.alloc(2 * v.length);
  v.forEach((x, i) => b.writeUInt16BE(x & 0xffff, 2 * i));
  return b;
}

const zeros = (n) => Buffer.alloc(n);

/** The unity matrix of mvhd and tkhd. */
const MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

/**
 * The file. `samples`: each `{ data: Uint8Array, key: boolean, pts: number }` in decode order, `pts`
 * its presentation time in the timescale's units; `fps` frames a second; `avcC` the encoder's
 * description. Every sample lasts one frame; a sample shown later than it is decoded (B-frames)
 * gets its offset in ctts, the first shown at time 0.
 */
export function mp4({ width, height, fps, avcC, samples }) {
  if (!samples.length) throw new Error("mp4: no samples");
  const timescale = fps * 1000;
  const delta = 1000;
  const n = samples.length;
  const duration = n * delta;
  // presentation offsets: dts is the decode index; a stream without reordering has none
  const offsets = samples.map((s, i) => Math.round(s.pts) - i * delta);
  const shift = Math.min(...offsets);
  const reordered = offsets.some((o) => o !== shift);

  const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(0x200), Buffer.from("isomiso2avc1mp41", "latin1"));

  const mvhd = full("mvhd", 0, 0, u32(0, 0, timescale, duration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const tkhd = full("tkhd", 0, 3, u32(0, 0, 1, 0, duration), zeros(8), u16(0, 0, 0, 0), MATRIX, u32(width << 16, height << 16));
  const mdhd = full("mdhd", 0, 0, u32(0, 0, timescale, duration), u16(0x55c4, 0)); // language "und"
  const hdlr = full("hdlr", 0, 0, u32(0), Buffer.from("vide", "latin1"), zeros(12), Buffer.from("VideoHandler\0", "latin1"));
  const vmhd = full("vmhd", 0, 1, u16(0, 0, 0, 0));
  const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
  const avc1 = box(
    "avc1",
    zeros(6), u16(1), // reserved, data reference index
    zeros(16), // pre_defined, reserved
    u16(width, height),
    u32(0x00480000, 0x00480000), // 72 dpi
    u32(0), u16(1), // reserved, frame count
    zeros(32), // compressor name
    u16(0x0018, 0xffff), // depth, pre_defined -1
    box("avcC", Buffer.from(avcC)),
  );
  const stsd = full("stsd", 0, 0, u32(1), avc1);
  const stts = full("stts", 0, 0, u32(1, n, delta));
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stss = full("stss", 0, 0, u32(keys.length, ...keys));
  const ctts = reordered ? full("ctts", 0, 0, u32(n), ...offsets.map((o) => u32(1, o - shift))) : null;
  // a chunk a second: the samples of each second together, their chunk's offset in stco
  const per = Math.max(1, Math.round(fps));
  const chunks = Math.ceil(n / per);
  const last = n - (chunks - 1) * per;
  const stsc = full("stsc", 0, 0, ...(last === per || chunks === 1 ? [u32(1, 1, chunks === 1 ? n : per, 1)] : [u32(2, 1, per, 1), u32(chunks, last, 1)]));
  const stsz = full("stsz", 0, 0, u32(0, n), ...samples.map((s) => u32(s.data.byteLength)));
  const moovWith = (offset) => {
    const starts = [];
    for (let c = 0, at = offset; c < chunks; c++) {
      starts.push(at);
      for (let i = c * per; i < Math.min(n, (c + 1) * per); i++) at += samples[i].data.byteLength;
    }
    const stco = full("stco", 0, 0, u32(chunks, ...starts));
    const stbl = box("stbl", stsd, stts, ...(ctts ? [ctts] : []), stss, stsc, stsz, stco);
    const minf = box("minf", vmhd, dinf, stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    return box("moov", mvhd, box("trak", tkhd, mdia));
  };
  // the samples start after ftyp, moov and mdat's own header; moov's size does not depend on the offsets
  const offset = ftyp.length + moovWith(0).length + 8;
  const mdat = box("mdat", ...samples.map((s) => Buffer.from(s.data.buffer, s.data.byteOffset, s.data.byteLength)));
  return Buffer.concat([ftyp, moovWith(offset), mdat]);
}

/** What a file holds, read back box by box (for the checks): each box's type, size and children. */
export function boxes(buf, from = 0, to = buf.length) {
  const out = [];
  const parents = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf"]);
  for (let p = from; p + 8 <= to; ) {
    const size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    if (size < 8 || p + size > to) throw new Error(`mp4: box ${type} at ${p} runs past its parent`);
    out.push({ type, size, at: p, children: parents.has(type) ? boxes(buf, p + 8, p + size) : [] });
    p += size;
  }
  return out;
}

/** A file `mp4` wrote, read back: its frame size, its timescale and frame length, the encoder's
 *  description (avcC) and its samples in decode order, `{ data, key, pts }` as `mp4` takes them — so
 *  that the chapters of a film can be taken apart and put together again without encoding them anew
 *  (scripts/tips/film.mjs). One H.264 track, as `mp4` writes it. */
export function readMp4(buf) {
  const find = (list, type) => {
    const b = list.find((x) => x.type === type);
    if (!b) throw new Error(`mp4: no ${type}`);
    return b;
  };
  const top = boxes(buf);
  const trak = find(find(top, "moov").children, "trak");
  const mdia = find(trak.children, "mdia");
  const stbl = find(find(mdia.children, "minf").children, "stbl");
  const body = (b) => b.at + 8;
  // full boxes: version and flags first
  const fb = (type) => {
    const b = stbl.children.find((x) => x.type === type);
    return b ? body(b) + 4 : null;
  };
  const mdhd = body(find(mdia.children, "mdhd")) + 4;
  const timescale = buf.readUInt32BE(mdhd + 8);
  const tkhd = body(find(trak.children, "tkhd")) + 4;
  const width = buf.readUInt32BE(tkhd + 72) >>> 16, height = buf.readUInt32BE(tkhd + 76) >>> 16;
  // stsd: one avc1 entry, its fixed fields (78 bytes) then its boxes, avcC among them
  const avc1 = fb("stsd") + 4;
  if (buf.toString("latin1", avc1 + 4, avc1 + 8) !== "avc1") throw new Error("mp4: not avc1");
  const avcCBox = boxes(buf, avc1 + 8 + 78, avc1 + buf.readUInt32BE(avc1)).find((x) => x.type === "avcC");
  if (!avcCBox) throw new Error("mp4: no avcC");
  const avcC = Buffer.from(buf.subarray(body(avcCBox), avcCBox.at + avcCBox.size));
  const stts = fb("stts");
  if (buf.readUInt32BE(stts) !== 1) throw new Error("mp4: samples of different lengths");
  const delta = buf.readUInt32BE(stts + 8);
  const stsz = fb("stsz");
  const n = buf.readUInt32BE(stsz + 4);
  const sizes = Array.from({ length: n }, (_, i) => buf.readUInt32BE(stsz + 8 + 4 * i));
  const stss = fb("stss");
  const keys = new Set(Array.from({ length: buf.readUInt32BE(stss) }, (_, i) => buf.readUInt32BE(stss + 4 + 4 * i) - 1));
  const ctts = fb("ctts");
  const offsets = new Array(n).fill(0);
  if (ctts !== null)
    for (let e = 0, i = 0; e < buf.readUInt32BE(ctts); e++) {
      const count = buf.readUInt32BE(ctts + 4 + 8 * e), off = buf.readUInt32BE(ctts + 8 + 8 * e);
      for (let k = 0; k < count; k++) offsets[i++] = off;
    }
  // where each sample is: chunks (stco) of so many samples each (stsc)
  const stco = fb("stco"), stsc = fb("stsc");
  const chunkStarts = Array.from({ length: buf.readUInt32BE(stco) }, (_, c) => buf.readUInt32BE(stco + 4 + 4 * c));
  const runs = Array.from({ length: buf.readUInt32BE(stsc) }, (_, r) => ({ first: buf.readUInt32BE(stsc + 4 + 12 * r) - 1, per: buf.readUInt32BE(stsc + 8 + 12 * r) }));
  const samples = [];
  for (let c = 0, i = 0; c < chunkStarts.length; c++) {
    const per = runs.filter((r) => r.first <= c).at(-1).per;
    for (let k = 0, at = chunkStarts[c]; k < per && i < n; k++, i++) {
      samples.push({ data: buf.subarray(at, at + sizes[i]), key: keys.has(i), pts: i * delta + offsets[i] });
      at += sizes[i];
    }
  }
  if (samples.length !== n) throw new Error(`mp4: ${samples.length} of ${n} samples found`);
  return { width, height, timescale, delta, fps: timescale / delta, avcC, samples };
}
