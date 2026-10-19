// The build status as the page holds it, kept up with the server's (the owner's decision of
// 2026-10-19; shared/build.ts). The event stream never carries the whole status: it says which
// revision the server holds (`build-rev`, as it opens and at a change sent as no delta) and each
// change after as the files whose status changed (`build-delta`), which the page applies to the
// revision it holds. Where it holds another — a change it missed, another run of the server's — it
// reads the whole (GET /api/build, compressed and tagged). One reading is out at a time; the changes
// that come meanwhile are kept, and applied to what it brings. A server from before 0.6.0 sends the
// whole status at every change (`build`), which is taken as it comes.

import { applyBuildDelta } from "../../shared/build.ts";
import type { BuildDelta, BuildRev, BuildStatus, BuildWhole } from "../../shared/build.ts";

/** How many changes are kept while a reading is out: more, and the page reads again once it is back
 *  (a reading that takes minutes, on a link that barely moves). */
export const MAX_WAITING = 64;

/** Whether a page holding revision `held` holds less than the server's `told`: another run of the
 *  server's, or an older revision. */
export function behindBuild(held: BuildRev, told: BuildRev): boolean {
  return held.epoch !== told.epoch || held.rev < told.rev;
}

export class LiveBuild {
  private read: () => Promise<BuildWhole>;
  private take: (status: BuildStatus | null) => void;
  private held: BuildWhole = { epoch: "", rev: 0, status: null };
  /** the reading out; once it is back, whether another is wanted whatever it brought, the newest
   *  revision said meanwhile, and the changes that came meanwhile */
  private out: Promise<void> | null = null;
  private again = false;
  private said: BuildRev | null = null;
  private waiting: BuildDelta[] = [];
  /** counts the statuses a server from before 0.6.0 sent whole: a reading out when one came brings
   *  what that server no longer holds */
  private wholes = 0;

  /** `read` asks for the whole status, `take` shows the status the page now holds. */
  constructor(read: () => Promise<BuildWhole>, take: (status: BuildStatus | null) => void) {
    this.read = read;
    this.take = take;
  }

  /** The status the page holds: null before it read one. */
  get status(): BuildStatus | null {
    return this.held.status;
  }

  /** The revision the page holds. */
  get rev(): BuildRev {
    return { epoch: this.held.epoch, rev: this.held.rev };
  }

  /** Whether a reading is out. */
  get reading(): boolean {
    return this.out !== null;
  }

  /** The server holds revision `told` (`build-rev`): read where the page holds another. */
  told(told: BuildRev): void {
    if (!behindBuild(this.held, told)) return;
    if (this.out) this.said = told;
    else void this.fetch();
  }

  /** A change (`build-delta`): applied to the revision held, or kept while a reading is out; one the
   *  page holds already is let go, and one it cannot apply has it read the whole. */
  delta(d: BuildDelta): void {
    if (this.out) {
      this.waiting.push(d);
      if (this.waiting.length > MAX_WAITING) {
        this.waiting = [];
        this.again = true;
      }
      return;
    }
    if (d.epoch === this.held.epoch && d.rev <= this.held.rev) return;
    const next = applyBuildDelta(this.held, d);
    if (!next) return void this.fetch();
    this.held = next;
    this.take(next.status);
  }

  /** The whole status, from a server from before 0.6.0 (`build`). */
  whole(status: BuildStatus): void {
    this.wholes++;
    this.waiting = [];
    this.said = null;
    this.held = { epoch: "", rev: 0, status };
    this.take(status);
  }

  /** Read the whole status (a change the page cannot apply, a revision it does not hold), or once the
   *  reading out is back. A reading that fails is left: the next change or revision said reads
   *  again; the changes kept meanwhile are applied where they follow what the page holds. */
  fetch(): Promise<void> {
    if (this.out) {
      this.again = true;
      return this.out;
    }
    const wholes = this.wholes;
    this.out = this.read()
      .then(
        (w) => {
          if (wholes !== this.wholes || !w || typeof w.epoch !== "string" || typeof w.rev !== "number") return false;
          if (w.epoch === this.held.epoch && w.rev <= this.held.rev) return false;
          this.held = w;
          return true;
        },
        () => false,
      )
      .then((took) => {
        // the changes that came while it was out, from the revision it brought on
        const kept = this.waiting;
        this.waiting = [];
        let changed = took;
        for (const d of kept) {
          if (d.epoch === this.held.epoch && d.rev <= this.held.rev) continue;
          const next = applyBuildDelta(this.held, d);
          // a gap: read again, unless this reading failed (the next change reads)
          if (!next) {
            if (took) this.again = true;
            break;
          }
          this.held = next;
          changed = true;
        }
        if (changed) this.take(this.held.status);
      })
      .finally(() => {
        this.out = null;
        const said = this.said;
        const again = this.again || (said !== null && behindBuild(this.held, said));
        this.said = null;
        this.again = false;
        if (again) void this.fetch();
      });
    return this.out;
  }
}
