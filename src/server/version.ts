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

/** A version as a range writes it: each part a number, or a wildcard (`x`, `X`, `*`, or left out). */
type Partial = [number | null, number | null, number | null];

function partial(text: string): Partial | null {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) return null;
  const part = (x: string | undefined) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x));
  const p: Partial = [part(m[1]), part(m[2]), part(m[3])];
  // a wildcard leaves the parts after it wild (`1.x.3` is `1.x`)
  for (let i = 1; i < 3; i++) if (p[i - 1] === null) p[i] = null;
  return p;
}

/** The comparator `op v` of a desugared range: `v` the bound, `op` how a version stands to it. */
type Bound = [">=" | ">" | "<=" | "<", Version];

const lower = (p: Partial): Version => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
/** the first version past what a partial version covers (`1.2` covers 1.2.x: 1.3.0); null for `*` */
function past(p: Partial): Version | null {
  if (p[0] === null) return null;
  if (p[1] === null) return [p[0] + 1, 0, 0];
  if (p[2] === null) return [p[0], p[1] + 1, 0];
  return [p[0], p[1], p[2] + 1];
}

/** One comparator as npm reads it (node-semver's desugaring), as bounds; null where it is no comparator. */
function bounds(c: string): Bound[] | null {
  const m = /^(<=|>=|<|>|=|\^|~>?|)(.*)$/.exec(c);
  const op = m![1];
  const p = partial(m![2]);
  if (!p) return null;
  const lo = lower(p);
  const hi = past(p);
  const wild = p[2] === null;
  switch (op) {
    case "":
    case "=":
      // an x-range, or one version
      return hi ? [[">=", lo], ["<", hi]] : [];
    case ">=":
      return [[">=", lo]];
    case ">":
      // past what it covers: `>1.2` is `>=1.3.0`
      return wild ? (hi ? [[">=", hi]] : [["<", [0, 0, 0]]]) : [[">", lo]];
    case "<":
      return [["<", lo]];
    case "<=":
      return wild ? (hi ? [["<", hi]] : []) : [["<=", lo]];
    case "~":
    case "~>": {
      // patches of the minor given (of the major, where only it is)
      if (p[0] === null) return [];
      const top: Version = p[1] === null ? [p[0] + 1, 0, 0] : [p[0], p[1] + 1, 0];
      return [[">=", lo], ["<", top]];
    }
    case "^": {
      // the same leftmost part that is not zero
      if (p[0] === null) return [];
      let top: Version;
      if (p[0] > 0 || p[1] === null) top = [p[0] + 1, 0, 0];
      else if (p[1] > 0 || p[2] === null) top = [0, p[1] + 1, 0];
      else top = [0, 0, p[2] + 1];
      return [[">=", lo], ["<", top]];
    }
  }
  return null;
}

/** One alternative of a range (no `||`): a hyphen range, or comparators joined by spaces. */
function alternative(text: string): Bound[] | null {
  // an operator may stand apart from its version (`>= 22.0.0`)
  const t = text.trim().replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, "$1");
  if (!t) return [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (hyphen) {
    const a = partial(hyphen[1]);
    const b = partial(hyphen[2]);
    if (!a || !b) return null;
    const top = b[2] === null ? past(b) : null;
    return [[">=", lower(a)], ...(b[0] === null ? [] : top ? ([["<", top]] as Bound[]) : ([["<=", lower(b)]] as Bound[]))];
  }
  const out: Bound[] = [];
  for (const c of t.split(/\s+/)) {
    const b = bounds(c);
    if (!b) return null;
    out.push(...b);
  }
  return out;
}

/** Whether `version` meets a range as package.json's `engines` writes one (npm's ranges):
 *  alternatives joined by `||`, each a hyphen range (`22.18.0 - 24`) or comparators joined by spaces
 *  — `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, a version, an x-range (`22`, `22.x`, `22.18.*`, `*`) —
 *  an operator apart from its version or not. An empty range, or one of spaces alone, is any
 *  version; a range npm could not read either, none. */
export function satisfies(version: string, range: string | undefined | null): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  if (range === undefined || range === null || !range.trim()) return true;
  return range.split("||").some((alt) => {
    const bs = alternative(alt);
    return (
      bs !== null &&
      bs.every(([op, w]) => {
        const c = cmp(v, w);
        return op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c < 0;
      })
    );
  });
}
