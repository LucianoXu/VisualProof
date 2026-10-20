// The source window's gutter (ReviewSpec, "The source window", the owner's decision of 2026-10-20):
// the file's own line numbers, muted, beside the code and beside the context above it, each line at
// its real number. Where the numbers shown are not contiguous — between the context and the code,
// and inside the context, where the lines between its commands are left out — a break shows: a
// dashed rule across the gutter (web/style.css). A line that wraps is numbered on its first row
// only.
//
// The numbers are not part of the text: each is drawn by CSS from the line's `data-n`
// (highlightLines), so that selecting and copying the code, quoting its lines into a comment, and
// the positions Lean's hovers are asked at all count in the source alone, as before.
//
// This is what the window draws, worked out apart from the page: which row shows which number, and
// where a break comes.

/** One row of the gutter: the number it shows, null where it shows none — a row on the same line as
 *  the row before (the elaborator's context gives each binder of a `variable` command, and each
 *  namespace of an `open`, apart), or a line whose place is not known (0) — and whether a break
 *  comes before it: a number not the one before's plus one. */
export interface GutterRow {
  n: number | null;
  gap: boolean;
}

/** The gutter of rows at the file's lines `lines` (1-based, in the order they are shown, which is
 *  the file's): the first row has no break before it, nothing being above it; an unknown line (0)
 *  neither shows a number nor breaks, and the row after it is compared with the last known one. */
export function gutterRows(lines: readonly number[]): GutterRow[] {
  let last = 0;
  return lines.map((line) => {
    if (!(line > 0)) return { n: null, gap: false };
    const row = { n: line === last ? null : line, gap: last > 0 && line !== last && line !== last + 1 };
    last = line;
    return row;
  });
}

/** How many digits the gutter of a window holds room for: those of the largest number it shows —
 *  the code's last line, which nothing above it passes. */
export function gutterDigits(largest: number): number {
  return String(Math.max(1, Math.floor(largest))).length;
}

/** What the gutter shows of a context folded to some of its commands, and of all of it: for each
 *  command at `lines`, its row with every command shown (`open`) and its row with only those of
 *  `kept` shown (`folded`, null for one folded away); and whether the code, starting at line
 *  `code`, comes after a break, either way. */
export function contextGutter(lines: readonly number[], kept: readonly boolean[], code: number): {
  open: GutterRow[];
  folded: (GutterRow | null)[];
  cut: { open: boolean; folded: boolean };
} {
  const open = gutterRows([...lines, code]);
  const shown = lines.flatMap((l, k) => (kept[k] ? [l] : []));
  const few = gutterRows([...shown, code]);
  let j = 0;
  const folded = lines.map((_, k) => (kept[k] ? few[j++] : null));
  return { open: open.slice(0, -1), folded, cut: { open: open[open.length - 1].gap, folded: few[few.length - 1].gap } };
}

/** The classes a row of the context carries for its gutter (web/style.css): `gap` (a break before
 *  it) and `again` (no number: on the line before's) as the context shows whole, `gap-f` and
 *  `again-f` as it shows folded; none for the second pair where it is folded away. */
export function rowMarks(open: GutterRow, folded: GutterRow | null): string {
  const marks = [open.gap && "gap", open.n === null && "again", folded?.gap && "gap-f", folded && folded.n === null && "again-f"];
  return marks.filter(Boolean).join(" ");
}

/** The classes of the context for the break between it and the code: `cut` as it shows whole,
 *  `cut-f` folded. */
export function cutMarks(cut: { open: boolean; folded: boolean }): string {
  return [cut.open && "cut", cut.folded && "cut-f"].filter(Boolean).join(" ");
}
