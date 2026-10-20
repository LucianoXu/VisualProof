// A declaration outside the project, where it is written (ReviewSpec, "The source window", the
// owner's decision of 2026-10-20): a package of the project's lake-manifest, or Lean's core, as the
// server finds it (server/outside.ts) and tells the page and the agents with the file's text.

import { githubBlob } from "./deploy.ts";

/** The package an outside file is in, as a page and an agent are told it beside its text. */
export interface OutsideWhere {
  /** the package's name in the lake-manifest; `Lean` for Lean's core */
  package: string;
  core: boolean;
  /** its revision: the commit the manifest pins, or the toolchain's release (`v4.35.0`); null where
   *  none is known (a path dependency, a nightly) */
  rev: string | null;
  /** the file on GitHub (DeploySpec decision 13, the owner's decision of 2026-10-20): the package's
   *  repository, the revision and the path there; null where the package's address is not a GitHub
   *  repository, or its revision neither a commit nor a release */
  github: { repo: string; rev: string; path: string } | null;
  /** the package is at another revision than when the graph was read (a dependency updated since,
   *  a branch being built): the declaration is found by name in the present text, which is not what
   *  was compiled */
  changed?: true;
}

/** The package in words, as the window's title bar and the agents say it: `mathlib at 089be84`,
 *  `Lean v4.35.0`. */
export function packageWords(o: Pick<OutsideWhere, "package" | "core" | "rev">): string {
  if (!o.rev) return o.package;
  return o.core ? `${o.package} ${o.rev}` : `${o.package} at ${o.rev.slice(0, 7)}`;
}

/** "Open on GitHub" for lines `from` to `to` (from 1) of an outside file: its package's repository at
 *  the revision; null where there is none. */
export function outsideLink(o: Pick<OutsideWhere, "github">, from: number, to: number): string | null {
  return o.github ? githubBlob(o.github.repo, o.github.rev, o.github.path, from, to) : null;
}
