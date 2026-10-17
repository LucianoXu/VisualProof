// The supervisor (UpdateSpec decision 5): `visualproof serve` from an installed package runs the
// server as a child of this small process, which stays while the server restarts into another
// version. It runs the newest of the installed package and the patches of its minor downloaded
// into the cache (server/updates.ts, codeToRun), passes signals on, and ends with the server's
// status — except where the server asks to be started again (status 75, a restart into another
// version) or where a version downloaded fails as it starts: that one is set aside, and the one
// before it started again (decision 7).
//
// The child is told, by its environment, that it runs supervised (VISUALPROOF_SUPERVISED), where the
// installed package is (VISUALPROOF_INSTALLED: the one it watches for an `npm install`), and what was
// set aside before it started (VISUALPROOF_SET_ASIDE), which it records in the timeline. It says over
// IPC when it listens (`{vp: "listening", version}`), so that a version which stops before then is
// known to have failed, and when what ends it is not its code (`{vp: "environment"}`: the site is
// busy, the port taken).

import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import type { ChildProcess } from "node:child_process";
import { codeToRun, Versions } from "./updates.ts";
import type { UpdateMode } from "./updates.ts";

/** the status a server ends with to be started again, in another version */
export const RESTART_STATUS = 75;
/** a version downloaded that ends within this long of starting is set aside */
export const FAILS_WITHIN = 10 * 60_000;
/** more starts than this in RESTART_WINDOW, and the supervisor gives up */
const MAX_STARTS = 6;
const RESTART_WINDOW = 10 * 60_000;

export interface SuperviseOptions {
  /** the installed package's folder */
  installedRoot: string;
  /** the root of the caches: the patches are in its `versions/` */
  cacheRoot: string;
  /** the arguments the server is run with (`serve …`) */
  argv: string[];
  /** the site it serves: failures soon after a version served, and paused patches, are this site's */
  site?: string | null;
  /** --updates: under notify, the installed package alone */
  mode?: UpdateMode;
  log?: (line: string) => void;
  /** how long to wait before starting a version again after the `n`th uncounted kill in a row (a
   *  test gives none) */
  backoff?: (n: number) => number;
  /** runs a server's code: a test gives its own */
  run?: (main: string, argv: string[], env: NodeJS.ProcessEnv) => ChildProcess;
  now?: () => number;
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const defaultRun = (main: string, argv: string[], env: NodeJS.ProcessEnv): ChildProcess =>
  spawn(process.execPath, [main, ...argv], { stdio: ["inherit", "inherit", "inherit", "ipc"], env });

/** The status a process ended by `signal` is said to end with, as shells say it: 128 + its number. */
export function signalStatus(signal: NodeJS.Signals): number {
  return 128 + (osConstants.signals[signal] ?? 0);
}

/** How a version's failure counts (UpdateSpec decision 7): a SIGKILL never (the kernel's when
 *  memory runs out, an operator's kill -9); a SIGABRT — V8's when the heap reaches its limit — only
 *  before the version served: a version that runs out of memory as it starts, where the one before
 *  it did not, is the version's fault; one that runs out once it serves may be a reader's request.
 *  Either way it is started again (a version killed at every start ends in the too-many-starts stop
 *  below, which pauses it). */
function resource(signal: NodeJS.Signals | null, listened: boolean): boolean {
  return signal === "SIGKILL" || (signal === "SIGABRT" && listened);
}

/** failures soon after it served are counted for a day after the last one */
const STRIKES_FOR = 24 * 3600_000;

/** Run the server until it ends for good; the status it ended with — 0 once a stop was asked,
 *  whatever the server does meanwhile. A version from the cache is set aside (UpdateSpec decision 7)
 *  where it fails before it serves (for every site: it is about the version), or twice soon after it
 *  served (for this site: it may be about its project; a second site's sets it aside for all);
 *  where the version started after one was set aside fails as soon, the fault was not the first
 *  one's: it is taken back (what was recorded kept), this site's patches up to it are paused — it
 *  runs the installed package until a newer patch is out — and the supervisor ends. So does it
 *  after too many starts, pausing the patch it was starting. */
export function supervise(o: SuperviseOptions): Promise<number> {
  const log = o.log ?? ((l: string) => console.error(`visualproof: ${l}`));
  const run = o.run ?? defaultRun;
  const now = o.now ?? Date.now;
  const site = o.site ?? null;
  const versions = new Versions(o.cacheRoot);
  const starts: number[] = [];
  const backoff = o.backoff ?? ((n: number) => Math.min(300_000, 5000 * 2 ** (n - 1)));
  /** kills in a row that do not count (out of memory): each start after one waits longer, and is
   *  not one of the starts that make the supervisor give up */
  let kills = 0;
  /** failures soon after it served, by version, and when the last one was */
  const strikes = new Map<string, { n: number; at: number }>();
  /** versions set aside whose record could not be written (a full disk): set aside all the same */
  const unrecorded = new Set<string>();
  let child: ChildProcess | null = null;
  let stopping = false;
  /** the version set aside last, which the next child is told of */
  let setAside: { version: string; why: string } | null = null;
  const forward = (sig: NodeJS.Signals) => {
    stopping = true;
    child?.kill(sig);
  };
  for (const s of SIGNALS) process.on(s, forward);
  return new Promise((resolve) => {
    let ended = false;
    const done = (status: number) => {
      if (ended) return;
      ended = true;
      for (const s of SIGNALS) process.off(s, forward);
      // a stop was asked: whatever the server did meanwhile (a restart, a signal before its own
      // handlers), the stop is what happened
      resolve(stopping ? 0 : status);
    };
    const pause = (v: string, why: string) => {
      if (!site) return;
      if (versions.pause(site, v, why)) log(`this site's patches up to ${v} are not taken until a newer one is out (${why}): the installed package runs`);
      else log(`this site's patches could not be paused (${versions.root} cannot be written): ${why}`);
    };
    const start = (uncounted = false): void => {
      if (stopping) return done(0);
      const t = now();
      if (!uncounted) starts.push(t);
      while (starts.length && t - starts[0] > RESTART_WINDOW) starts.shift();
      let code = codeToRun(o.installedRoot, versions, { mode: o.mode, site, also: unrecorded });
      // marked before it is started, so that no prune removes it meanwhile; chosen again where one
      // did just before the mark
      if (code.cached) {
        versions.markRunning(code.version, process.pid);
        if (!versions.ready().includes(code.version)) {
          versions.unmarkRunning(code.version, process.pid);
          code = codeToRun(o.installedRoot, versions, { mode: o.mode, site, also: unrecorded });
          if (code.cached) versions.markRunning(code.version, process.pid);
        }
      }
      if (starts.length > MAX_STARTS) {
        log(`the server was started ${starts.length} times in ten minutes: giving up`);
        if (code.cached) {
          versions.unmarkRunning(code.version, process.pid);
          pause(code.version, `VisualProof ${code.version} was started ${starts.length} times in ten minutes`);
        }
        return done(1);
      }
      const env: NodeJS.ProcessEnv = { ...process.env, VISUALPROOF_SUPERVISED: "1", VISUALPROOF_INSTALLED: o.installedRoot };
      // what it set aside without a record (a full disk): the server never restarts into it
      if (unrecorded.size) env.VISUALPROOF_UNRECORDED = JSON.stringify([...unrecorded]);
      else delete env.VISUALPROOF_UNRECORDED;
      // the version set aside just before this one started: told to it (the timeline), and taken
      // back if this one fails as soon
      const after = setAside;
      if (after) env.VISUALPROOF_SET_ASIDE = JSON.stringify(after);
      else delete env.VISUALPROOF_SET_ASIDE;
      setAside = null;
      let listened: number | null = null;
      // what ended it is not its code (the site busy, the port taken): never set aside for that
      let environment = false;
      const c = run(code.main, o.argv, env);
      child = c;
      // a version of the cache's, which no other server removes while this one runs it: marked as
      // it starts, by its process
      const pid = c.pid;
      if (code.cached) {
        if (pid) versions.markRunning(code.version, pid);
        versions.unmarkRunning(code.version, process.pid);
      }
      c.on("message", (m: unknown) => {
        const said = m && typeof m === "object" ? (m as { vp?: unknown }).vp : null;
        if (said === "listening") {
          listened = now();
          kills = 0;
        }
        else if (said === "environment") environment = true;
      });
      c.once("error", (e) => {
        log(`the server could not be started: ${e.message}`);
        done(1);
      });
      c.once("exit", (status, signal) => {
        child = null;
        if (code.cached && pid) versions.unmarkRunning(code.version, pid);
        const ends = status ?? (signal ? signalStatus(signal) : 1);
        if (stopping) return done(0);
        if (status === RESTART_STATUS) return start();
        if (status === 0 || environment) return done(ends);
        const how = signal ? `was ended by ${signal}` : `exited with status ${status}`;
        const soon = listened === null || now() - listened < FAILS_WITHIN;
        const counts = !resource(signal, listened !== null);
        if (after && soon && counts) {
          // the version before it fails as soon: the fault was not the one set aside's
          versions.unmarkBad(after.version);
          unrecorded.delete(after.version);
          log(`VisualProof ${code.version} ${how} as well: ${after.version} is taken back from those set aside (the fault is not its); stopping`);
          pause(after.version, `${after.version}, and the version before it, failed as they started`);
          return done(ends);
        }
        if (!code.cached || !soon) return done(ends);
        const aside = (why: string, where: string | null) => {
          if (!versions.markBad(code.version, why, where)) {
            unrecorded.add(code.version);
            log(`VisualProof ${code.version} ${why}: set aside, though ${versions.root} could not record it (a full disk?)`);
          } else log(`VisualProof ${code.version} ${why}: set aside${where ? " for this site" : ""}; starting the version before it`);
          setAside = { version: code.version, why };
          start();
        };
        if (!counts) {
          kills++;
          const wait = backoff(kills);
          log(`VisualProof ${code.version} ${how}${listened === null ? " as it started" : " soon after it started"} (out of memory?): started again${wait ? ` in ${Math.round(wait / 1000)} s` : ""}`);
          if (!wait) return start(true);
          setTimeout(() => start(true), wait);
          return;
        }
        if (listened === null) return aside(`${how} before it served`, null);
        const was = strikes.get(code.version);
        const n = was && now() - was.at < STRIKES_FOR ? was.n + 1 : 1;
        strikes.set(code.version, { n, at: now() });
        if (n >= 2) return aside(`${how} twice soon after it started`, site ?? "");
        log(`VisualProof ${code.version} ${how} soon after it started: started again`);
        start();
      });
    };
    start();
  });
}
