// What changed between two versions of a declaration's text, line by line: the text a stale
// opinion was given on against the text there is now (ReviewSpec decision 2). A longest common
// subsequence over lines, shown as the changed lines with a few unchanged ones around them; longer
// unchanged runs collapse into one row, so that a one-line edit in a long definition reads at a
// glance.

export type DiffRow =
  | { op: "same" | "del" | "add"; text: string }
  /** unchanged lines left out */
  | { op: "skip"; lines: number };

export interface LineDiff {
  /** empty when the two texts have the same lines */
  rows: DiffRow[];
  added: number;
  removed: number;
}

/** Beyond this many cells the table costs more than a reader gains from a minimal diff: the part
 *  that differs is then shown as removed whole, then added whole. */
const MAX_CELLS = 4_000_000;

/** The lines of `before` and `after` compared; `context` unchanged lines stay on each side of a
 *  change. A line ending in a carriage return is the same line without it: a file saved with other
 *  line endings has not changed. */
export function lineDiff(before: string, after: string, context = 2): LineDiff {
  const a = before.split("\n").map((l) => l.replace(/\r$/, ""));
  const b = after.split("\n").map((l) => l.replace(/\r$/, ""));
  // most edits are local: what the two share at the start and the end needs no table
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);

  const ops: { op: "same" | "del" | "add"; text: string }[] = a.slice(0, head).map((text) => ({ op: "same" as const, text }));
  if ((A.length + 1) * (B.length + 1) > MAX_CELLS) {
    for (const text of A) ops.push({ op: "del", text });
    for (const text of B) ops.push({ op: "add", text });
  } else {
    // L[i][j]: the longest common subsequence of A from i and B from j
    const w = B.length + 1;
    const L = new Int32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) {
        ops.push({ op: "same", text: A[i++] });
        j++;
      } else if (j >= B.length || (i < A.length && L[(i + 1) * w + j] >= L[i * w + j + 1])) ops.push({ op: "del", text: A[i++] });
      else ops.push({ op: "add", text: B[j++] });
    }
  }
  for (const text of a.slice(a.length - tail)) ops.push({ op: "same", text });

  const added = ops.filter((o) => o.op === "add").length;
  const removed = ops.filter((o) => o.op === "del").length;
  if (!added && !removed) return { rows: [], added, removed };

  // how far each line is from the nearest change, counted in rows
  const near = new Array<number>(ops.length).fill(Infinity);
  for (let k = 0, last = -Infinity; k < ops.length; k++) {
    if (ops[k].op !== "same") last = k;
    near[k] = k - last;
  }
  for (let k = ops.length - 1, next = Infinity; k >= 0; k--) {
    if (ops[k].op !== "same") next = k;
    near[k] = Math.min(near[k], next - k);
  }
  const rows: DiffRow[] = [];
  for (let k = 0; k < ops.length; ) {
    if (near[k] <= context) {
      rows.push(ops[k++]);
      continue;
    }
    let end = k;
    while (end < ops.length && near[end] > context) end++;
    // a marker for one line takes the room of the line itself: it is shown instead
    if (end - k > 1) rows.push({ op: "skip", lines: end - k });
    else rows.push(ops[k]);
    k = end;
  }
  return { rows, added, removed };
}
