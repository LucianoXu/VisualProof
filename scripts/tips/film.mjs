// A film of chapters taken apart and put together again (scripts/tips-record.mjs): each chapter is
// recorded on its own — in a process of its own, the storyboard played up to it without a frame
// taken — and encoded on its own, its first frame a key frame; the film is its chapters' samples one
// after another, nothing encoded again. So a film is made of chapters recorded side by side, and a
// chapter recorded again replaces its part of the film that was (`split`, then `join`), the others
// kept to the byte. Its chapters' times and its captions follow from each chapter's length.

/** A chapter as recorded: its id, its length in frames, its captions (seconds from its start), and,
 *  where it was recorded rather than kept, its samples (`pts` in frames × 1000 from its start, as
 *  scripts/tips/mp4.mjs counts them) and the encoder's description (avcC). */

/** The chapters of a film that was, from its file (`readMp4`) and its data (`<id>.json`: chapters
 *  and captions in seconds): each chapter's samples, from its key frame, and its captions, both
 *  counted from its start. A chapter that does not begin on a key frame cannot be taken out. */
export function split(file, about) {
  const per = file.delta;
  const at = (s) => Math.round(s * file.fps);
  return about.chapters.map((c, i) => {
    const from = at(c.start), to = at(c.end);
    if (!file.samples[from]?.key) throw new Error(`film: chapter ${c.id} does not begin on a key frame (frame ${from})`);
    const samples = file.samples.slice(from, to).map((s) => ({ data: s.data, key: s.key, pts: s.pts - from * per }));
    const next = about.chapters[i + 1];
    const captions = about.captions
      .filter((k) => k.start >= c.start - 1e-6 && (!next || k.start < next.start - 1e-6))
      .map((k) => ({ start: k.start - c.start, end: k.end - c.start, text: k.text }));
    return { id: c.id, frames: to - from, captions, samples, avcC: file.avcC };
  });
}

/** One film of chapters, in their order: their samples one after another, each chapter's times and
 *  captions moved by the chapters before it. Every chapter must have been encoded alike (the same
 *  avcC), as one encoder's chapters are. */
export function join(chapters, fps) {
  const avcC = chapters[0]?.avcC;
  if (!avcC) throw new Error("film: no chapters");
  const samples = [], captions = [], times = [];
  let frame = 0;
  for (const c of chapters) {
    if (!Buffer.from(c.avcC).equals(Buffer.from(avcC))) throw new Error(`film: chapter ${c.id} was encoded otherwise than ${chapters[0].id} (avcC): record them together`);
    if (c.samples.length !== c.frames) throw new Error(`film: chapter ${c.id} has ${c.samples.length} samples for ${c.frames} frames`);
    if (!c.samples[0]?.key) throw new Error(`film: chapter ${c.id} does not begin on a key frame`);
    for (const s of c.samples) samples.push({ data: s.data, key: s.key, pts: s.pts + frame * 1000 });
    const start = frame / fps;
    for (const k of c.captions) captions.push({ start: start + k.start, end: start + k.end, text: k.text });
    frame += c.frames;
    times.push({ id: c.id, start, end: frame / fps });
  }
  return { samples, avcC, chapters: times, captions, frames: frame, duration: frame / fps };
}

/** Contiguous groups of the chapters to record, at most `jobs` of them, each recorded by a process
 *  of its own, so that the slowest finishes soonest: a group costs the film before it, played
 *  without a frame taken (`skip` seconds of work a second of film), and its own chapters, taken
 *  (`take`) — as measured with eight processes at once on 32 threads (2026-10-21). `seconds`: each
 *  chapter's length (the film that was, or a guess); `wanted`: the ids to record, in the film's
 *  order. */
export function groups(ids, seconds, wanted, jobs, { skip = 0.8, take = 9 } = {}) {
  const at = new Map();
  let t = 0;
  for (const id of ids) {
    at.set(id, t);
    t += seconds.get(id) ?? 0;
  }
  const want = ids.filter((id) => wanted.includes(id));
  const cost = (from, to) => at.get(want[from]) * skip + want.slice(from, to).reduce((s, id) => s + (seconds.get(id) ?? 0) * take, 0);
  // the best split of want[0..n) into k groups (a small table: thirteen chapters at most a few dozen)
  const n = want.length, k = Math.max(1, Math.min(jobs, n));
  const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let g = 1; g <= k; g++)
    for (let j = 1; j <= n; j++)
      for (let i = g - 1; i < j; i++) {
        const c = Math.max(best[g - 1][i], cost(i, j));
        if (c < best[g][j]) [best[g][j], cut[g][j]] = [c, i];
      }
  let g = k;
  while (g > 1 && best[g - 1][n] <= best[g][n]) g--;
  const out = [];
  for (let j = n; g > 0; g--) {
    const i = cut[g][j];
    out.unshift(want.slice(i, j));
    j = i;
  }
  return out;
}
