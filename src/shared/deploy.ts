// A branch of a git repository the server follows and builds itself (SPEC/DeploySpec.md), as the
// pages and agents are told it: where it comes from, the build going on, the newest commit waiting
// for it, the last build that ended; and the links into GitHub a page makes of it.

/** A step of a build: the commit fetched, checked out, Mathlib's cache got, `lake build`. */
export type DeployStep = "fetch" | "checkout" | "cache" | "build";

/** A build that ended (DeploySpec decision 6). */
export interface DeployBuild {
  commit: string;
  ok: boolean;
  /** when it ended, and how long it took */
  at: string;
  ms: number;
  /** `lake build`'s status; absent where it did not run (a fetch that failed, a commit that is no
   *  Lean project), null where it was stopped by a signal */
  exit?: number | null;
  /** why it failed, in words, where Lake's status alone does not say it */
  error?: string;
  /** it could not be tried (the remote or git failed): the same commit is tried again at the next
   *  look at the remote */
  retry?: true;
  /** the end of its log, the clone's folder written `.`: for those let in fully and agents, never a
   *  read-only reader (DeploySpec decision 11) */
  tail?: string;
}

export interface DeployStatus {
  /** the remote's host and path as a page shows it, no user name or password; null for a repository
   *  on this machine */
  source: string | null;
  /** the repository on GitHub (`owner/repo`) where the remote is github.com: "Open on GitHub" */
  github: string | null;
  branch: string;
  /** how often the remote is asked, in seconds */
  every: number;
  /** the last time the remote was asked: when, the branch's head then, or why it could not be */
  asked: { at: string; head: string | null; error?: string } | null;
  /** the build going on: of which commit, since when, at which step, and its last lines (for
   *  those let in fully and agents, as `last.tail`) */
  building: { commit: string; since: string; step: DeployStep; tail?: string } | null;
  /** the newest commit seen that waits for the build going on: the only one built after it */
  next: string | null;
  /** the last build that ended */
  last: DeployBuild | null;
  /** the commit whose build made what the tree's outputs are, which the graph is read from: the
   *  last whose build wrote outputs, or built it whole — a failed build that wrote none is not built
   *  (the owner's decision of 2026-10-19); null before the first */
  built: string | null;
}

/** The same without what is for those let in fully: the builds' logs. */
export function slimDeploy(d: DeployStatus): DeployStatus {
  const drop = <T extends { tail?: string }>(x: T | null): T | null => {
    if (!x || x.tail === undefined) return x;
    const { tail: _, ...rest } = x;
    return rest as T;
  };
  return { ...d, building: drop(d.building), last: drop(d.last) };
}

/** A commit as a page writes it. */
export const shortCommit = (c: string): string => c.slice(0, 7);

/** What a step is doing, in words. */
export const STEP_WORDS: Record<DeployStep, string> = {
  fetch: "fetching it",
  checkout: "checking it out",
  cache: "getting Mathlib's cache",
  build: "lake build",
};

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** A file of the repository at a commit on GitHub, lines `from` to `to` (from 1) marked. */
export function githubBlob(repo: string, commit: string, file: string, from: number, to: number): string {
  return `https://github.com/${repo}/blob/${commit}/${enc(file)}#L${from}${to > from ? `-L${to}` : ""}`;
}

/** A commit on GitHub. */
export function githubCommit(repo: string, commit: string): string {
  return `https://github.com/${repo}/commit/${commit}`;
}

/** A branch on GitHub. */
export function githubTree(repo: string, branch: string): string {
  return `https://github.com/${repo}/tree/${enc(branch)}`;
}
