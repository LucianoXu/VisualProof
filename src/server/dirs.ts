// Where the server keeps what it writes, in two places (the owner's decision of 2026-10-13): the
// site and the cache. Nothing is written into the project, and nothing into this repository.
//
//   site   what one running VisualProof site holds, which cannot be derived again: the review's
//          logs (`log/`, server/review.ts), the history of the builds it saw, the library's files,
//          the views and their layouts (and the notes they keep), the timeline, the TCB baselines,
//          conversations with agents, agents' tokens, personal links. Local: it holds secrets, and
//          is backed up, never committed
//   cache  what a rebuild makes again: extractions, the usage pass's results, the prepared views,
//          what was read of the library's files, typeset documents, Lean's language server's
//          folder; and, shared by every project, the Lean programs compiled per toolchain and the
//          page's bundle
//
// The site is one folder, `--site` (relative to the current directory, or absolute; by default
// `<data home>/sites/<key>`), made with a README that says what it is; one server at a time holds
// it (`.lock`). The caches are under one root, `--cache` (by default the cache home): the project's
// in `projects/<key>`, the Lean programs in `lean/`, the page's bundle in `web/`. The homes follow
// the platform, and `XDG_DATA_HOME` / `XDG_CACHE_HOME` when set, on any platform.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/** The folders of one project. */
export interface Dirs {
  /** the site: the review and what this running site accumulates, local, backed up, never committed */
  site: string;
  /** the project's caches */
  cache: string;
  /** the Lean programs compiled per toolchain, shared by the projects */
  lean: string;
}

/** What the homes are found from: the process's, unless a test says otherwise. */
export interface HomeEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

const here = (): HomeEnv => ({ platform: process.platform, env: process.env, home: homedir() });

/** Where VisualProof keeps its sites. */
export function dataHome(h: HomeEnv = here()): string {
  if (h.env.XDG_DATA_HOME) return join(h.env.XDG_DATA_HOME, "visualproof");
  if (h.platform === "darwin") return join(h.home, "Library", "Application Support", "visualproof");
  if (h.platform === "win32") return join(h.env.LOCALAPPDATA ?? join(h.home, "AppData", "Local"), "visualproof", "data");
  return join(h.home, ".local", "share", "visualproof");
}

/** Where VisualProof keeps its caches. */
export function cacheHome(h: HomeEnv = here()): string {
  if (h.env.XDG_CACHE_HOME) return join(h.env.XDG_CACHE_HOME, "visualproof");
  if (h.platform === "darwin") return join(h.home, "Library", "Caches", "visualproof");
  if (h.platform === "win32") return join(h.env.LOCALAPPDATA ?? join(h.home, "AppData", "Local"), "visualproof", "cache");
  return join(h.home, ".cache", "visualproof");
}

/** A project's name among the others: its folder's name and a hash of its path. */
export function projectKey(root: string): string {
  return `${basename(root)}-${createHash("sha1").update(root).digest("hex").slice(0, 8)}`;
}

/** The folders of the project at `root`: its site where `site` says (relative to the current
 *  directory, as `--cache` is: the owner's decision of 2026-10-14) or
 *  under the data home, its caches under `cacheRoot` or the cache home. */
export function projectDirs(root: string, site: string | null, cacheRoot: string | null, h: HomeEnv = here()): Dirs {
  const cache = cacheRoot ? resolve(cacheRoot) : cacheHome(h);
  return {
    site: site === null ? join(dataHome(h), "sites", projectKey(root)) : resolve(site),
    cache: join(cache, "projects", projectKey(root)),
    lean: join(cache, "lean"),
  };
}

/** What the site's folder is, for whoever finds it in the project: written when the folder is
 *  made (by the server, or with the first log), one already there left as it is. */
export const SITE_README = `# This VisualProof site's folder

VisualProof keeps here what this site holds of the project: what reviewers said about its
declarations (\`log/\`), the history of the builds it saw, the library's files, the views and their
layouts, the timeline, conversations with agents, agents' tokens and personal links.

It is local. It holds secrets (agents' tokens, personal links): it is not meant to be committed.
Back it up: none of it can be derived again. What VisualProof can derive again is in its cache
(\`--cache\`), not here.

- \`log/\` holds one file per writer: \`<name>-<hash>.jsonl\` for a person,
  \`<name>-<hash>.agent.jsonl\` for an AI agent: its opinions are advice, never counted; what else
  it did (a target, a key declaration, a trusted prefix) counts as a person's would, and is shown
  as an agent's. The hash is of the writer's exact name, which every line carries; the file's
  name is only a container.
- Someone invited by a personal link writes to \`<id>.person.jsonl\`, the id being their link's:
  every line carries it (\`person\`) beside the name it was written under, and a \`name\` line says
  they go by another name from then on. All they wrote shows under the latest.
- \`log/visualproof.server.jsonl\` is VisualProof's own: the renames it found between two builds,
  each a move that carries what was said of the declaration to its new name, and the links it
  carried to a cluster a build renamed as a whole.
- Each line is one event: an opinion on a declaration (bound to its version), a target marked
  or taken off, a prefix trusted without review or no longer, a key declaration of a target marked
  or unmarked, a move of what was said of one declaration to another (or its undoing), a file
  added to the project's library (named by its SHA-256: its bytes are kept beside, in \`files/\`)
  and its title, archiving and restoring, a link from a declaration or a cluster to a place in one,
  edited or removed.
- Files are only ever appended to, each writer to their own.
- The review is what replaying every file gives: one writer's events in the order of their file,
  different writers' by time.
- Do not edit a line by hand. A line VisualProof cannot read (a line cut short) is reported;
  nothing more is written to that file until it is fixed by hand.
`;

/** The site's folder, made if it is not there: then with its README. One already there, made by
 *  hand or by an earlier version, is left as it is. True when it was made now. */
export function openSite(dir: string): boolean {
  if (existsSync(dir)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), SITE_README);
  return true;
}

/** Another server holds the site. */
export class SiteBusy extends Error {
  readonly dir: string;
  readonly pid: number;
  constructor(dir: string, pid: number) {
    super(`another VisualProof server (process ${pid}) is using the site ${dir}; stop it first, or give this one a --site of its own`);
    this.dir = dir;
    this.pid = pid;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // a process of another user's is there all the same
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The living process that holds the site, if one does: what `lockSite` would refuse, without
 *  taking it (`visualproof doctor`). */
export function siteHolder(dir: string): number | null {
  try {
    const held = Number(readFileSync(join(dir, ".lock"), "utf8").trim());
    return Number.isInteger(held) && held > 0 && alive(held) ? held : null;
  } catch {
    return null;
  }
}

/** Takes the site for this process (`.lock`, holding its id), so that two servers never write the
 *  same site: SiteBusy while another living process holds it; the lock of one that died is taken
 *  over. The answer lets it go, as the process exits. */
export function lockSite(dir: string, pid: number = process.pid): () => void {
  const file = join(dir, ".lock");
  for (let tries = 0; ; tries++) {
    try {
      writeFileSync(file, `${pid}\n`, { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || tries > 3) throw e;
      let held = NaN;
      try {
        held = Number(readFileSync(file, "utf8").trim());
      } catch {
        // let go meanwhile
      }
      if (held === pid) break;
      if (Number.isInteger(held) && held > 0 && alive(held)) throw new SiteBusy(dir, held);
      try {
        unlinkSync(file);
      } catch {
        // taken over by another meanwhile: tried again
      }
    }
  }
  return () => {
    try {
      if (readFileSync(file, "utf8").trim() === String(pid)) unlinkSync(file);
    } catch {
      // gone already
    }
  };
}
