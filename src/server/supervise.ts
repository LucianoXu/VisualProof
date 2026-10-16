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

/** Run the server until it ends for good; the status it ended with. */
export function supervise(o: SuperviseOptions): Promise<number> {
  const log = o.log ?? ((l: string) => console.error(`visualproof: ${l}`));
  const run = o.run ?? defaultRun;
  const now = o.now ?? Date.now;
  const versions = new Versions(o.cacheRoot);
  const starts: number[] = [];
  let child: ChildProcess | null = null;
  let stopping = false;
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
      if (setAside) env.VISUALPROOF_SET_ASIDE = JSON.stringify(setAside);
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
        if (stopping) return done(status ?? 0);
        if (status === RESTART_STATUS) return start();
        // a patch from the cache that failed as it started, or soon after: set aside, and the
        // version before it started instead
        const soon = listened === null || now() - listened < FAILS_WITHIN;
        if (code.cached && soon && status !== 0 && !environment) {
          const why = `${signal ? `ended by ${signal}` : `exited with status ${status}`} ${listened === null ? "before it served" : "soon after it started"}`;
          versions.markBad(code.version, why);
          setAside = { version: code.version, why };
          log(`VisualProof ${code.version} ${why}: set aside; starting the version before it`);
          return start();
        }
        done(status ?? (signal ? 128 + (signal === "SIGKILL" ? 9 : signal === "SIGTERM" ? 15 : 1) : 1));
      });
    };
    start();
  });
}
