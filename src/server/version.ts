// Versions: this package's own, and the ranges package.json's `engines` writes, as `visualproof
// doctor` checks Node against them and a server checks a release it would take (server/updates.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";

let own: string | null = null;

/** The version of this package: read once, as the process started it, so that a package installed
 *  over it meanwhile does not change what it says it runs (UpdateSpec decision 5). */
export function packageVersion(): string {
  return (own ??= JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")).version as string);
}

export type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function cmp(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** A version as ranges compare it: its three numbers, and its prerelease identifiers ([] for a
 *  release; `22.18.0-rc.1` has ["rc", 1]). */
interface Full {
  v: Version;
  pre: (string | number)[];
}

/** npm's order: by the numbers, then a prerelease before its release, then the prerelease
 *  identifiers one by one (numbers before words, numbers by value, words as text), fewer first. */
function order(a: Full, b: Full): number {
  const c = cmp(a.v, b.v);
  if (c) return c;
  if (!a.pre.length || !b.pre.length) return (b.pre.length ? 1 : 0) - (a.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Prerelease identifiers, as npm takes them: none empty, a number without a leading zero. */
function prerelease(text: string | undefined): (string | number)[] | null {
  if (text === undefined) return [];
  const ids = text.split(".");
  if (ids.some((id) => !/^[0-9A-Za-z-]+$/.test(id) || /^0\d+$/.test(id))) return null;
  return ids.map((id) => (/^\d+$/.test(id) ? Number(id) : id));
}

/** A version as a range writes it: each part a number (no leading zero, as npm takes them) or a
 *  wildcard (`x`, `X`, `*`, or left out); a prerelease only on a version with all three parts. */
interface Partial {
  p: [number | null, number | null, number | null];
  pre: (string | number)[];
}

const NUM = "0|[1-9]\\d*";
const PART = `(${NUM}|[xX*])`;
const PARTIAL = new RegExp(`^v?${PART}(?:\\.${PART})?(?:\\.${PART})?(?:-([^+]+))?(?:\\+[0-9A-Za-z.-]+)?$`);

function partial(text: string): Partial | null {
  const m = PARTIAL.exec(text);
  if (!m) return null;
  const part = (x: string | undefined) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x));
  const p: Partial["p"] = [part(m[1]), part(m[2]), part(m[3])];
  // a wildcard leaves the parts after it wild (`1.x.3` is `1.x`)
  for (let i = 1; i < 3; i++) if (p[i - 1] === null) p[i] = null;
  const pre = prerelease(m[4]);
  if (pre === null || (pre.length && p[2] === null)) return null;
  return { p, pre };
}

/** The comparator `op v` of a desugared range: `v` the bound, `op` how a version stands to it. */
type Bound = [">=" | ">" | "<=" | "<" | "=", Full];

const lower = (x: Partial): Full => ({ v: [x.p[0] ?? 0, x.p[1] ?? 0, x.p[2] ?? 0], pre: x.pre });
/** the first release past what a partial version covers (`1.2` covers 1.2.x: 1.3.0); null for `*` */
function past(x: Partial): Full | null {
  const [a, b, c] = x.p;
  if (a === null) return null;
  if (b === null) return { v: [a + 1, 0, 0], pre: [] };
  if (c === null) return { v: [a, b + 1, 0], pre: [] };
  return { v: [a, b, c + 1], pre: [] };
}

/** One comparator as npm reads it (node-semver's desugaring), as bounds; null where it is no comparator. */
function bounds(op: string, text: string): Bound[] | null {
  const x = partial(text);
  if (!x) return null;
  const lo = lower(x);
  const hi = past(x);
  const wild = x.p[2] === null;
  switch (op) {
    case "":
    case "=":
      // one version, or an x-range
      return !wild ? [["=", lo]] : hi ? [[">=", lo], ["<", hi]] : [];
    case ">=":
      return [[">=", lo]];
    case ">":
      // past what it covers: `>1.2` is `>=1.3.0`; `>*`, nothing
      return !wild ? [[">", lo]] : hi ? [[">=", hi]] : [["<", { v: [0, 0, 0], pre: [0] }]];
    case "<":
      return [["<", lo]];
    case "<=":
      return !wild ? [["<=", lo]] : hi ? [["<", hi]] : [];
    case "~":
    case "~>": {
      // patches of the minor given (of the major, where only it is)
      const [a, b] = x.p;
      if (a === null) return [];
      return [[">=", lo], ["<", { v: b === null ? [a + 1, 0, 0] : [a, b + 1, 0], pre: [] }]];
    }
    case "^": {
      // the same leftmost part that is not zero
      const [a, b, c] = x.p;
      if (a === null) return [];
      const top: Version = a > 0 || b === null ? [a + 1, 0, 0] : b > 0 || c === null ? [0, b + 1, 0] : [0, 0, c + 1];
      return [[">=", lo], ["<", { v: top, pre: [] }]];
    }
  }
  return null;
}

/** an operator, spaces, a version: `>= 22.0.0` as `>=22.0.0`; never `> = 22` */
const COMPARATOR = /^(<=|>=|<|>|=|\^|~>|~)?\s*([^\s<>=^~]+)\s*/;

/** One alternative of a range (no `||`): a hyphen range, or comparators joined by spaces; null where
 *  npm could not read it. */
function alternative(text: string): Bound[] | null {
  const t = text.trim();
  if (!t) return [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (hyphen) {
    const a = partial(hyphen[1]);
    const b = partial(hyphen[2]);
    if (!a || !b) return null;
    const top = b.p[2] === null ? past(b) : null;
    return [[">=", lower(a)], ...(b.p[0] === null ? [] : top ? ([["<", top]] as Bound[]) : ([["<=", lower(b)]] as Bound[]))];
  }
  const out: Bound[] = [];
  for (let rest = t; rest; ) {
    const m = COMPARATOR.exec(rest);
    if (!m) return null;
    const b = bounds(m[1] ?? "", m[2]);
    if (!b) return null;
    out.push(...b);
    rest = rest.slice(m[0].length);
  }
  return out;
}

/** Whether `version` meets a range as package.json's `engines` writes one, as npm reads it:
 *  alternatives joined by `||`, each a hyphen range (`22.18.0 - 24`) or comparators joined by spaces
 *  — `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, a version, an x-range (`22`, `22.x`, `22.18.*`, `*`) —
 *  an operator apart from its version or not. An empty range, or one of spaces alone, is any
 *  version; one npm could not read, in any of its alternatives, none. Prereleases as npm takes them:
 *  22.18.0 is past 22.18.0-rc.1 (so `<=22.18.0-rc.1` excludes it), and a prerelease version meets an
 *  alternative only where one of its comparators is a prerelease of the same three numbers. */
export function satisfies(version: string, range: string | undefined | null): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version.trim());
  const pre = m ? prerelease(m[4]) : null;
  if (!m || pre === null) return false;
  const v: Full = { v: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
  if (range === undefined || range === null || !range.trim()) return true;
  const alts = range.split("||").map(alternative);
  if (alts.some((a) => a === null)) return false;
  return (alts as Bound[][]).some(
    (bs) =>
      bs.every(([op, w]) => {
        const c = order(v, w);
        return op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : op === "<" ? c < 0 : c === 0;
      }) &&
      (!v.pre.length || bs.some(([, w]) => w.pre.length > 0 && cmp(w.v, v.v) === 0)),
  );
}
