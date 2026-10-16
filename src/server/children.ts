// The programs the server runs and waits for — the extractor and the Lean programs' build, the
// usage pass's `lake env`, Lean's language server, XeLaTeX, ImageMagick, Poppler, git, ps — kept
// here while they run, so that a server stopping stops them (UpdateSpec decision 9) rather than
// leave them working for nobody. Those that start programs of their own (Lake starts Lean, Lean's
// server its workers, XeLaTeX kpathsea's, ImageMagick its delegates) run in a process group of
// their own (`grouped`, spawn's `detached`), and are stopped with all they started; what is left
// at the server's exit is ended at once. The usage pass's workers have a stop of their own
// (server/usage.ts).

import type { ChildProcess } from "node:child_process";

const running = new Set<ChildProcess>();
/** the children that lead a process group of their own */
const groups = new WeakSet<ChildProcess>();

/** spawn's `detached` for a program run as a group (`grouped`): its own process group, where the
 *  platform has them */
export const DETACH = process.platform !== "win32";

/** Keep `child` as `tracked` does, as the leader of a process group of its own: spawned with
 *  `detached: DETACH`, and stopped with every program it started. */
export function grouped<C extends ChildProcess>(child: C): C {
  if (DETACH) groups.add(child);
  return tracked(child);
}

/** End `child` with `signal`: where it leads a process group, the whole group. */
export function end(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (groups.has(child) && child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // the group is gone: the child alone, if it is not
    }
  }
  child.kill(signal);
}

// what still runs as the server's process ends goes with it
process.once("exit", () => {
  for (const c of running) end(c, "SIGKILL");
});

/** Keep `child` until it exits; the same child, for `spawn(…)` to be wrapped in place. */
export function tracked<C extends ChildProcess>(child: C): C {
  running.add(child);
  const gone = () => running.delete(child);
  child.once("exit", gone);
  child.once("error", gone);
  return child;
}

/** The environment a program the server runs is given: the server's own, without what is the
 *  server's alone (`VISUALPROOF_*`: the supervisor's word to it, its test hooks; UpdateSpec decision
 *  9), with `extra` over it. */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("VISUALPROOF_")) env[k] = v;
  return { ...env, ...extra };
}

/** How many tracked programs run now. */
export function childCount(): number {
  return running.size;
}

/** Ask every tracked program to end (SIGTERM), and end those still there after `graceMs`
 *  (SIGKILL). Resolves once none runs, or at the end of the grace. */
export function stopChildren(graceMs = 2000): Promise<void> {
  if (!running.size) return Promise.resolve();
  for (const c of running) end(c, "SIGTERM");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (!running.size) {
        clearInterval(tick);
        return resolve();
      }
      if (Date.now() - t0 >= graceMs) {
        for (const c of running) end(c, "SIGKILL");
        running.clear();
        clearInterval(tick);
        resolve();
      }
    }, 50);
    tick.unref();
  });
}
