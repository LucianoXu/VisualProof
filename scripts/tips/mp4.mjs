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
