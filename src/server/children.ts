// The programs the server runs and waits for — the extractor and the Lean programs' build, the
// usage pass's `lake env`, XeLaTeX, ImageMagick, Poppler, git, ps — kept here while they run, so
// that a server stopping stops them (UpdateSpec decision 9) rather than leave them working for
// nobody. Lean's language server (server/hover.ts) and the usage pass's workers (server/usage.ts)
// have stops of their own.

import type { ChildProcess } from "node:child_process";

const running = new Set<ChildProcess>();

/** Keep `child` until it exits; the same child, for `spawn(…)` to be wrapped in place. */
export function tracked<C extends ChildProcess>(child: C): C {
  running.add(child);
  const gone = () => running.delete(child);
  child.once("exit", gone);
  child.once("error", gone);
  return child;
}

/** How many tracked programs run now. */
export function childCount(): number {
  return running.size;
}

/** Ask every tracked program to end (SIGTERM), and end those still there after `graceMs`
 *  (SIGKILL). Resolves once none runs, or at the end of the grace. */
export function stopChildren(graceMs = 2000): Promise<void> {
  if (!running.size) return Promise.resolve();
  for (const c of running) c.kill("SIGTERM");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (!running.size) {
        clearInterval(tick);
        return resolve();
      }
      if (Date.now() - t0 >= graceMs) {
        for (const c of running) c.kill("SIGKILL");
        running.clear();
        clearInterval(tick);
        resolve();
      }
    }, 50);
    tick.unref();
  });
}
