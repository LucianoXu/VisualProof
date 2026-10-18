// What tells the live loop (server/live.ts) to look at the build again. It looked every second at
// every module's files, three stats each and three more, and listed every process (`ps`): on
// NavierStokesAndEuler (2,657 modules) 26,000 stats a second, 7 to 10 % of a core with nothing
// happening. Now the folders the modules' sources and outputs are in are watched (`fs.watch`:
// inotify, FSEvents, ReadDirectoryChangesW), and the loop looks when one says something moved in
// it, while a build goes on and settles, and every SAFETY_MS besides. Where watching cannot be
// trusted, the loop looks every second as before: on a network or FUSE filesystem, which does not
// tell of changes made elsewhere (statfs, Linux); where a folder cannot be watched (too many
// watches); or once looks found changes no watch told of, twice.

import { existsSync, statfsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import type { Project } from "./project.ts";
import type { ModuleInfo } from "./status.ts";

/** how often the loop looks whatever the watches say: a change they did not tell is found then */
export const SAFETY_MS = 30_000;
/** looks that found a change no watch told, before the watches are given up */
const MISSES = 2;

/** Linux filesystems that do not tell inotify of changes made elsewhere (linux/magic.h): NFS, SMB
 *  and CIFS, FUSE (sshfs, virtiofs: Docker's shares), 9p (WSL's Windows drives), Ceph, AFS, Coda,
 *  VirtualBox's shared folders, GPFS, Lustre */
const REMOTE: ReadonlyMap<number, string> = new Map([
  [0x6969, "NFS"], [0x517b, "SMB"], [0xff534d42, "CIFS"], [0xfe534d42, "SMB2"], [0x65735546, "FUSE"], [0x01021997, "9p"],
  [0x00c36400, "Ceph"], [0x5346414f, "AFS"], [0x73757245, "Coda"], [0x786f4256, "vboxsf"], [0x47504653, "GPFS"], [0x0bd00bd0, "Lustre"],
]);

/** Why the live loop looks at the build's files at a tick (server/live.ts), if it does. */
export interface LookReasons {
  /** a watch said something moved since the last look */
  heard: boolean;
  /** the watches cannot be trusted: every tick looks */
  polling: boolean;
  /** compiles running now, and whether their set is not the one of the last look */
  running: number;
  runsChanged: boolean;
  /** the last look found a build going on (BuildStatus.active) */
  active: boolean;
  /** ms since the files last moved, and since the last look */
  sinceMove: number;
  sinceLook: number;
  /** the files as last found are not the build last read: it is read once they settle */
  unread: boolean;
  /** how long a build's files must be quiet before it is read, and the loop's tick */
  settle: number;
  tick: number;
}

/** Whether the live loop looks at the build's files now: when a watch said something moved, where
 *  the watches cannot be trusted, while a compile runs or the set of them changed, while a build
 *  goes on and settles or its files are still to be read, and every SAFETY_MS besides. A server
 *  at rest does none of these. */
export function shouldLook(r: LookReasons): boolean {
  return r.heard || r.polling || r.running > 0 || r.runsChanged || r.active || r.sinceMove < r.settle + 2 * r.tick || r.unread || r.sinceLook >= SAFETY_MS;
}

/** The folders a project's modules are in: their sources' and their outputs'. */
export function moduleDirs(p: Project, mods: Map<string, ModuleInfo>): Set<string> {
  const out = new Set<string>();
  for (const m of mods.values()) {
    out.add(dirname(join(p.root, m.file)));
    out.add(dirname(join(p.libDir, ...m.name.split("."))));
  }
  return out;
}

/** The filesystem `dir` is on, where it is one that does not tell of changes made elsewhere. */
function remoteFs(dir: string): string | null {
  if (process.platform !== "linux") return null;
  try {
    return REMOTE.get(statfsSync(dir).type) ?? null;
  } catch {
    return null;
  }
}

export class BuildWatch {
  /** something moved since the last look; at first, so that the first look is made at once */
  dirty = true;
  /** why the folders are not watched and the loop looks every second; null while they are */
  polling: string | null = null;
  private watchers = new Map<string, FSWatcher>();
  private misses = 0;
  private say: (line: string) => void;

  constructor(say: (line: string) => void = () => {}) {
    this.say = say;
  }

  /** Watch the folders `dirs` (each, or where it is not there yet, the nearest one above it that is,
   *  up to `root`), and no others. */
  watch(dirs: Iterable<string>, root: string): void {
    if (this.polling) return;
    const wanted = new Set<string>();
    for (const d of dirs) {
      let at = d;
      // an output folder not built yet: the project's own folder at the highest
      while (!existsSync(at) && at !== root && dirname(at) !== at) at = dirname(at);
      wanted.add(at);
    }
    for (const [d, w] of this.watchers)
      if (!wanted.has(d)) {
        w.close();
        this.watchers.delete(d);
      }
    for (const d of wanted) {
      if (this.watchers.has(d)) continue;
      const fs = remoteFs(d);
      if (fs) return this.poll(`${d} is on ${fs}, which does not tell of changes made elsewhere`);
      let w: FSWatcher;
      try {
        // never what keeps the server running
        w = watch(d, { persistent: false });
      } catch (e) {
        return this.poll(`${d} cannot be watched (${e instanceof Error ? e.message : String(e)})`);
      }
      w.on("change", () => (this.dirty = true));
      // a folder gone, a watch the system dropped: watched again at the next look that finds it
      w.on("error", () => {
        w.close();
        if (this.watchers.get(d) === w) this.watchers.delete(d);
        this.dirty = true;
      });
      this.watchers.set(d, w);
    }
  }

  /** A look found a change no watch told of: the watches are made again, and given up once that
   *  happened MISSES times. */
  missed(): void {
    if (this.polling) return;
    if (++this.misses >= MISSES) return this.poll("looks found changes no watch told of");
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    // made again at the next look, made at once
    this.dirty = true;
  }

  /** How many folders are watched. */
  get size(): number {
    return this.watchers.size;
  }

  private poll(why: string): void {
    this.polling = why;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    this.say(`watch: ${why}; the build is looked at every second`);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
