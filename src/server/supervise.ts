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
  log?: (line: string) => void;
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

/** A signal that ends a process for what it took, not for what its code did: the kernel's when
 *  memory runs out (and an operator's kill -9). A version is never set aside for it. */
const RESOURCE: ReadonlySet<string> = new Set(["SIGKILL"]);

/** Run the server until it ends for good; the status it ended with. A version from the cache is set
 *  aside (UpdateSpec decision 7) where it fails before it serves, or fails twice soon after it
 *  started (a SIGKILL never counting); where the version started after one was set aside fails as
 *  soon, the fault was not the first one's: it is taken back, and the supervisor ends. */
export function supervise(o: SuperviseOptions): Promise<number> {
  const log = o.log ?? ((l: string) => console.error(`visualproof: ${l}`));
  const run = o.run ?? defaultRun;
  const now = o.now ?? Date.now;
  const versions = new Versions(o.cacheRoot);
  const starts: number[] = [];
  /** failures soon after it served, by version, while this supervisor runs */
  const strikes = new Map<string, number>();
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
    const done = (status: number) => {
      for (const s of SIGNALS) process.off(s, forward);
      resolve(status);
    };
    const start = () => {
      const t = now();
      starts.push(t);
      while (starts.length && t - starts[0] > RESTART_WINDOW) starts.shift();
      if (starts.length > MAX_STARTS) {
        log(`the server was started ${starts.length} times in ten minutes: giving up`);
        return done(1);
      }
      const code = codeToRun(o.installedRoot, versions);
      const env: NodeJS.ProcessEnv = { ...process.env, VISUALPROOF_SUPERVISED: "1", VISUALPROOF_INSTALLED: o.installedRoot };
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
      c.on("message", (m: unknown) => {
        const said = m && typeof m === "object" ? (m as { vp?: unknown }).vp : null;
        if (said === "listening") listened = now();
        else if (said === "environment") environment = true;
      });
      c.once("error", (e) => {
        log(`the server could not be started: ${e.message}`);
        done(1);
      });
      c.once("exit", (status, signal) => {
        child = null;
        const ended = status ?? (signal ? signalStatus(signal) : 1);
        if (stopping) return done(ended);
        if (status === RESTART_STATUS) return start();
        if (status === 0 || environment) return done(ended);
        const how = signal ? `was ended by ${signal}` : `exited with status ${status}`;
        const soon = listened === null || now() - listened < FAILS_WITHIN;
        if (after && soon) {
          versions.unmarkBad(after.version);
          log(`VisualProof ${code.version} ${how} as well: ${after.version} is taken back from those set aside (the fault is not its); stopping`);
          return done(ended);
        }
        if (!code.cached || !soon) return done(ended);
        const aside = (why: string) => {
          versions.markBad(code.version, why);
          setAside = { version: code.version, why };
          log(`VisualProof ${code.version} ${why}: set aside; starting the version before it`);
          start();
        };
        if (listened === null) return aside(`${how} before it served`);
        if (signal && RESOURCE.has(signal)) {
          log(`VisualProof ${code.version} ${how} soon after it started (out of memory?): started again`);
          return start();
        }
        const n = (strikes.get(code.version) ?? 0) + 1;
        strikes.set(code.version, n);
        if (n >= 2) return aside(`${how} twice soon after it started`);
        log(`VisualProof ${code.version} ${how} soon after it started: started again`);
        start();
      });
    };
    start();
  });
}
