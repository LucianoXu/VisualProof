// The build-status popover (HistorySpec decision 15): a click on the build status beside the logo
// opens it. It says when the build on show finished and the commit it was built from, lists the
// recent builds the history keeps (GET /api/history), and has the two ways into the history: the
// Time Machine, and the lost-and-found with the count of what it lists. Under them, what it showed
// before: the graph on show, what could not be read, and the files in trouble. A server that follows
// a branch of a git repository (DeploySpec) says so under the head: the build going on, the newest
// commit waiting for it, the last build that ended, with the end of its log where it failed.
//
// What it holds is a pure function of what the page knows (`popHtml`), tested in
// test/buildpop.test.ts; web/src/main.ts draws it and does what its buttons say.

import type { FileStatus } from "../../shared/build.ts";
import type { DeployStatus } from "../../shared/deploy.ts";
import { githubCommit, githubTree, shortCommit, STEP_WORDS } from "../../shared/deploy.ts";
import type { BuildLine } from "../../shared/lostfound.ts";
import { escapeHtml } from "./highlight.ts";

/** How many of the recent builds the popover lists. */
export const RECENT_BUILDS = 5;

export interface PopState {
  /** the graph on show, as the server told it */
  graph: { version: number; at: string; missing: string[]; usage?: { state: string; failed: number } } | null;
  extractError: string | null;
  /** the project's files and their build status; null before the first report */
  files: FileStatus[] | null;
  /** what a file's state is called, for the files in trouble */
  stateLabel: Record<string, string>;
  /** the builds the history keeps, oldest first, and the latest's id: undefined while they are being
   *  asked for, null where the server keeps none (a saved graph) */
  builds: { snapshots: BuildLine[]; current: number | null } | null | undefined;
  /** how many entries the lost-and-found lists, and of them how many are lost things (the rest are
   *  migrations); null before the server said */
  lost: { count: number; lost: number } | null;
  /** the branch the server follows and builds (DeploySpec), where it follows one */
  deploy?: DeployStatus | null;
  /** now, for "today" and "yesterday" */
  now?: Date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortName = (m: string) => m.split(".").slice(-2).join(".");

/** A time as the popover says it, in the reader's time zone: "today 13:08", "yesterday 09:40",
 *  "Oct 7 18:02", with the year where it is not this one. */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return `today ${hm}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `yesterday ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`} ${hm}`;
}

/** A build's commit: its short hash, the branch, and whether `.lean` files differed from it when
 *  the build was read (`edited`) or it is only the last commit before an imported build (`≈`). */
export function commitHtml(c: BuildLine["commit"]): string {
  if (!c) return `<span class="muted" title="The project is not a git repository, or git could not be read">no commit</span>`;
  const title = c.guessed
    ? "The last commit before this build: it was read before the history kept commits"
    : c.dirty
      ? ".lean files differed from this commit when the build was read"
      : "The commit checked out when the build was read";
  return (
    `<span class="bp-commit" title="${escapeHtml(title)}: ${escapeHtml(c.hash)}">${c.guessed ? "≈" : ""}<span class="mono">${escapeHtml(c.hash.slice(0, 7))}</span>` +
    (c.branch ? ` ${escapeHtml(c.branch)}` : "") +
    (c.dirty ? ` <span class="bp-dirty">edited</span>` : "") +
    `</span>`
  );
}

/** How long something took, in words: "0.7 s", "3 min 12 s", "1 h 4 min". */
export function took(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** What a build of a branch the server follows came to, in words: why it failed. */
export function failedWhy(l: NonNullable<DeployStatus["last"]>): string {
  return l.error ?? (l.exit === null ? "lake build was stopped" : `lake build exited with ${l.exit}`);
}

/** What the popover says of the branch the server follows (DeploySpec decision 6): where it comes
 *  from and how often it is asked, the build going on, the newest commit waiting for it, and the
 *  last build that ended — where it failed, why, and the end of its log (to those let in fully). A
 *  commit links to GitHub where the remote is there. */
export function deployHtml(d: DeployStatus, now = new Date()): string {
  const gh = d.github;
  const commit = (c: string) =>
    gh
      ? `<a class="mono" href="${escapeHtml(githubCommit(gh, c))}" target="_blank" rel="noopener" title="${escapeHtml(c)}: open the commit on GitHub">${escapeHtml(shortCommit(c))}</a>`
      : `<span class="mono" title="${escapeHtml(c)}">${escapeHtml(shortCommit(c))}</span>`;
  const from = d.source ? (gh ? `<a href="${escapeHtml(githubTree(gh, d.branch))}" target="_blank" rel="noopener">${escapeHtml(d.source)}</a>` : escapeHtml(d.source)) : "a repository on this machine";
  const every = d.every >= 60 ? `${Math.round(d.every / 6) / 10} min` : `${d.every} s`;
  let html =
    `<div class="bp-deploy"><div class="bp-follow">Following <b>${escapeHtml(d.branch)}</b> of ${from}: each new commit is built here, ` +
    `the remote asked every ${every}${d.asked ? `, last ${escapeHtml(stamp(d.asked.at, now))}` : ""}.</div>`;
  if (d.asked?.error) html += `<div class="banner bad">The remote could not be asked: ${escapeHtml(d.asked.error)}</div>`;
  if (d.building) html += `<div class="banner info">Building ${commit(d.building.commit)} since ${escapeHtml(stamp(d.building.since, now))}: ${STEP_WORDS[d.building.step]}.</div>`;
  if (d.next) html += `<div class="bp-next">Then ${commit(d.next)}, the newest commit pushed meanwhile: commits pushed before it are not built.</div>`;
  const l = d.last;
  if (l) {
    html += l.ok
      ? `<div class="bp-last">Last built ${commit(l.commit)} ${escapeHtml(stamp(l.at, now))}, in ${took(l.ms)}.</div>`
      : `<div class="banner bad">The build of ${commit(l.commit)} ${l.retry ? "could not be made" : "failed"} ${escapeHtml(stamp(l.at, now))}, after ${took(l.ms)}: ${escapeHtml(failedWhy(l))}.` +
        `${l.retry ? " It is tried again at the next look at the remote." : d.built === l.commit ? " The board shows what could be read of it." : ` The board shows the build of ${d.built ? commit(d.built) : "nothing yet"}.`}</div>` +
        (l.tail ? `<pre class="bp-log" aria-label="The end of the build's log">${escapeHtml(l.tail)}</pre>` : "");
  } else if (!d.building) html += `<div class="muted">No build yet.</div>`;
  return html + `</div>`;
}

/** What the loading page says while a server that follows a branch has no graph to show yet
 *  (DeploySpec decision 7) — never a dead end: what is being done, what failed and why, what comes
 *  next. `st` is what /api/status says besides: whether the build could be read, and how far
 *  `lake build` is. The title, and the log shown under it (null: the server's own). */
export function deployWaiting(d: DeployStatus, st: { state: string; error?: string; progress?: { done: number; total: number } | null }): { title: string; log: string | null } {
  const where = `${d.source ?? "the repository"} (${d.branch})`;
  const every = d.every >= 60 ? `${Math.round(d.every / 6) / 10} min` : `${d.every} s`;
  if (d.building) {
    const p = d.building.step === "build" && st.progress?.total ? `, ${st.progress.done} of ${st.progress.total} files` : "";
    return { title: `${d.built ? "Building" : "The first build of"} ${where} at ${shortCommit(d.building.commit)}: ${STEP_WORDS[d.building.step]}${p}… The board appears once it is done.`, log: null };
  }
  const l = d.last;
  if (!d.built) {
    if (l && !l.ok)
      return {
        title:
          `The first build of ${where} at ${shortCommit(l.commit)} ${l.retry ? "could not be made" : "failed"}: ${failedWhy(l)}. ` +
          (l.retry ? `It is tried again at the next look at the remote, every ${every}.` : `The next commit pushed to ${d.branch} is built: the remote is asked every ${every}.`),
        log: l.tail ?? null,
      };
    if (d.asked?.error) return { title: `The remote could not be asked: ${d.asked.error}. It is asked again every ${every}.`, log: null };
    return { title: `Waiting for the first build of ${where}…`, log: null };
  }
  if (st.state === "error")
    return {
      title: `The build of ${where} at ${shortCommit(d.built)} left nothing that can be read${l && !l.ok ? `: ${failedWhy(l)}` : ""}. The next commit pushed to ${d.branch} is built: the remote is asked every ${every}.`,
      log: l?.tail ?? st.error ?? null,
    };
  return { title: `Reading the build of ${where} at ${shortCommit(d.built)}…`, log: null };
}

/** What the build pill says of a step of a build going on, where Lake's progress does not say it. */
export function stepPill(b: NonNullable<DeployStatus["building"]>): string {
  const what = { fetch: "Fetching", checkout: "Checking out", cache: "Mathlib's cache", build: "Building" }[b.step];
  return `${what} ${shortCommit(b.commit)}`;
}

/** What the popover holds. */
export function popHtml(s: PopState): string {
  const now = s.now ?? new Date();
  let html = "";
  if (s.builds !== null) {
    const list = s.builds?.snapshots ?? [];
    const latest = list.find((b) => b.id === s.builds?.current) ?? list[list.length - 1];
    html +=
      `<div class="bp-head">` +
      (s.builds === undefined
        ? `<span class="muted">Reading the history…</span>`
        : latest
          ? `<span class="bp-built" title="When the build finished: its newest .olean">Built ${latest.approx ? "about " : ""}${escapeHtml(stamp(latest.at, now))}</span>${commitHtml(latest.commit)}`
          : `<span class="muted">No build is kept yet.</span>`) +
      `</div>`;
    if (s.deploy) html += deployHtml(s.deploy, now);
    const lost = s.lost;
    const what = lost ? `${lost.lost} lost, ${lost.count - lost.lost} migration${lost.count - lost.lost === 1 ? "" : "s"} listed` : "";
    html +=
      `<div class="bp-btns">` +
      `<button class="bp-btn" data-bp="tm" title="The project as it was at an earlier build: what changed since, and when (HistorySpec)"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>Time Machine</button>` +
      `<button class="bp-btn" data-bp="lost" title="What was said of declarations the graph no longer has, and what moved to a new name${what ? `: ${what}` : ""}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 6h11v7.5h-11zM4 3.5h8L13.5 6h-11z"/><path d="M6.5 8.5h3"/></svg>Lost-and-found` +
      (lost && lost.count ? `<span class="bp-count${lost.lost ? " lost" : ""}">${lost.count > 999 ? "999+" : lost.count}</span>` : "") +
      `</button></div>`;
    // the newest first: each opens the Time Machine there
    const recent = list.slice(-RECENT_BUILDS).reverse();
    if (recent.length) {
      html += `<div class="pop-h">Recent builds <span class="muted">${list.length > recent.length ? `${recent.length} of ${list.length}` : ""}</span></div>`;
      for (const b of recent) {
        const notes = [
          `${b.counts.nodes.toLocaleString("en-US")} declarations`,
          b.renames?.high ? `${b.renames.high} renamed` : "",
          b.missing.length ? `${b.missing.length} file${b.missing.length === 1 ? "" : "s"} unread` : "",
        ].filter(Boolean);
        html +=
          `<button class="bp-build${b.id === latest?.id ? " on" : ""}" data-snapshot="${b.id}" title="Open the Time Machine at this build">` +
          `<span class="bp-when">${b.approx ? "≈ " : ""}${escapeHtml(stamp(b.at, now))}</span>${commitHtml(b.commit)}` +
          `<span class="bp-notes">${escapeHtml(notes.join(" · "))}</span></button>`;
      }
    }
  }
  const g = s.graph;
  const files = s.files ?? [];
  const trouble = files.filter((f) => s.stateLabel[f.state]);
  const order = ["failed", "unbuilt", "building", "queued", "blocked", "stale", "sorry"];
  // the files that changed or broke themselves first, then those that only inherit it
  const rank = (f: FileStatus) => order.indexOf(f.state) * 2 + (f.because ? 1 : 0);
  trouble.sort((a, b) => rank(a) - rank(b) || (a.module < b.module ? -1 : 1));
  const row = (f: FileStatus) =>
    `<button class="pf" data-module="${escapeHtml(f.module)}"><span class="o-st st-${f.state}"></span>` +
    `<span class="pf-name">${escapeHtml(f.module)}</span><span class="pf-st">${s.stateLabel[f.state]}` +
    (f.because ? ` · ${escapeHtml(f.because.slice(0, 2).map(shortName).join(", "))}${f.because.length > 2 ? "…" : ""}` : "") +
    `</span></button>`;
  const when = g ? new Date(g.at).toLocaleTimeString() : "";
  html +=
    `<div class="pop-h">Graph ${g ? `v${g.version}, read ${escapeHtml(when)}` : ""}</div>` +
    (s.extractError ? `<div class="banner bad">${escapeHtml(s.extractError)}</div>` : "") +
    (g?.usage?.state === "pending"
      ? `<div class="banner info">The usage pass is elaborating the modules: the notation each declaration is written in, and the context as Lean has it, come with the next version of the graph.</div>`
      : g?.usage?.failed
        ? `<div class="banner warn">${g.usage.failed} file(s) could not be elaborated by the usage pass: their declarations have no notation edges, and their context is read from the text.</div>`
        : "") +
    (g?.missing.length
      ? `<div class="banner warn">${g.missing.length} file(s) could not be read and are missing from the graph: ` +
        `${g.missing.slice(0, 6).map((m) => escapeHtml(shortName(m))).join(", ")}${g.missing.length > 6 ? ", …" : ""}</div>`
      : "") +
    (trouble.length
      ? `<div class="pop-h">Files <span class="muted">${trouble.length} of ${files.length}</span></div>${trouble.slice(0, 200).map(row).join("")}`
      : `<div class="muted pop-ok">All ${files.length} files built and up to date.</div>`);
  return html;
}
