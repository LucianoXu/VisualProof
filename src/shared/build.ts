// Build status, as the server reports it to the page.

export type FileState =
  | "ok" // built, no sorry
  | "sorry" // built, and some declaration uses sorry
  | "failed" // the last build of this file failed: its .olean is gone, its trace remains
  | "unbuilt" // never built
  | "building" // a lean process is compiling it right now
  | "queued" // a build is running and this file is out of date
  | "stale" // the source, or something it imports, changed since its build
  | "blocked"; // something it imports failed, so its build is from before

export interface FileStatus {
  module: string;
  file: string | null;
  state: FileState;
  /** warnings recorded by the last successful build */
  warnings: number;
  /** for blocked: the failed or unbuilt modules underneath; for stale: the changed ones */
  because?: string[];
  /** when the current .olean was written (ms since epoch), if there is one */
  builtAt?: number;
}

export interface BuildStatus {
  /** a build is running (a lean process for this project, or build outputs still changing) */
  active: boolean;
  /** progress of the running build, over the files it is expected to rebuild */
  progress: { done: number; total: number; current: string[] } | null;
  files: FileStatus[];
  counts: Record<FileState, number>;
}

// How the build status travels (the owner's decision of 2026-10-19): the event stream never
// carries it whole. It says which revision the server holds (`build-rev`, as a stream opens and at a
// change sent as no delta), and each change after it as the files whose status changed
// (`build-delta`), which a page applies to the status it holds; a page that holds another revision
// reads the whole status (GET /api/build, compressed and tagged with the revision). On
// NavierStokesAndEuler the whole is 362 KB of JSON, and went to every page as its stream opened and
// again at every change while a build ran.

/** Which build status the server holds: its process (UpdateSpec decision 8: another's revisions
 *  are counted again) and the revision, counted from 0 (no status yet) at every change. */
export interface BuildRev {
  epoch: string;
  rev: number;
}

/** The whole build status, as a page takes it on (GET /api/build): null before the first look. */
export interface BuildWhole extends BuildRev {
  status: BuildStatus | null;
}

/** A change of the build status (`build-delta`), from revision `base` to `rev`: the files whose
 *  status changed or that are new (`files`), the modules no longer among them (`gone`), and the
 *  rest whole — whether a build runs, how far it is, the counts. */
export interface BuildDelta extends BuildRev {
  base: number;
  active: boolean;
  progress: BuildStatus["progress"];
  counts: BuildStatus["counts"];
  files: FileStatus[];
  gone: string[];
}

/** What changed from the files as last sent (`sent`: each file's status as JSON, by module) to
 *  `next`'s: the files changed or new, the modules gone, and `next`'s files as JSON, by module, for
 *  the next change. */
export function buildChanges(sent: ReadonlyMap<string, string>, next: BuildStatus): { files: FileStatus[]; gone: string[]; texts: Map<string, string> } {
  const texts = new Map<string, string>();
  const files: FileStatus[] = [];
  for (const f of next.files) {
    const t = JSON.stringify(f);
    texts.set(f.module, t);
    if (sent.get(f.module) !== t) files.push(f);
  }
  const gone = [...sent.keys()].filter((m) => !texts.has(m));
  return { files, gone, texts };
}

/** `held` with change `d` applied: the files changed replaced where they are, those new added at the
 *  end, those gone taken out. Null where it is no change of what is held: of another run of the
 *  server's, or from another revision (a change missed between). */
export function applyBuildDelta(held: BuildWhole, d: BuildDelta): BuildWhole | null {
  if (d.epoch !== held.epoch || d.base !== held.rev) return null;
  const changed = new Map(d.files.map((f) => [f.module, f]));
  const gone = new Set(d.gone);
  const files: FileStatus[] = [];
  for (const f of held.status?.files ?? []) {
    if (gone.has(f.module)) continue;
    const c = changed.get(f.module);
    files.push(c ?? f);
    if (c) changed.delete(f.module);
  }
  files.push(...changed.values());
  return { epoch: d.epoch, rev: d.rev, status: { active: d.active, progress: d.progress, files, counts: d.counts } };
}
