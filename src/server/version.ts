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

/** Whether a version meets a range of the forms package.json's `engines` uses: alternatives
 *  joined by `||`, each of `^x.y.z`, `>=x.y.z`, `<x.y.z`, joined by spaces. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split("||").some((alt) =>
    alt.trim().split(/\s+/).every((part) => {
      const m = /^(\^|>=|<|)(\d+\.\d+\.\d+)$/.exec(part);
      if (!m) return false;
      const w = parseVersion(m[2])!;
      if (m[1] === "^") return v[0] === w[0] && cmp(v, w) >= 0;
      if (m[1] === ">=") return cmp(v, w) >= 0;
      if (m[1] === "<") return cmp(v, w) < 0;
      return cmp(v, w) === 0;
    }),
  );
}
