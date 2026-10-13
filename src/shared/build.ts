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
