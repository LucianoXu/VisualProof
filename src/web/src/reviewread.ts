// When the page reads the whole review again (GET /api/review), and how often. The event stream
// never carries the whole review (server/live.ts): it says which revision the server holds
// (`review-rev`, as it opens and at a change that is no delta), and the page that holds another
// reads it. One reading is out at a time: a revision said while one is out, that the reading did not
// bring, is read once it is back, in one reading more.

import type { ReviewRev } from "../../shared/review.ts";

/** Whether a page holding review `held` holds less than the server's `told`: another run of the
 *  server's, or an older revision. */
export function behind(held: ReviewRev, told: ReviewRev): boolean {
  return held.epoch !== told.epoch || held.rev < told.rev;
}

export class WholeReview<T extends ReviewRev> {
  private read: () => Promise<T>;
  private take: (r: T) => void;
  private held: () => ReviewRev;
  /** the reading out; once it is back, whether another is wanted whatever it brought, and the
   *  newest revision said meanwhile */
  private out: Promise<void> | null = null;
  private again = false;
  private said: ReviewRev | null = null;

  /** `read` asks for the whole review, `take` takes it on, `held` is the revision the page holds. */
  constructor(read: () => Promise<T>, take: (r: T) => void, held: () => ReviewRev) {
    this.read = read;
    this.take = take;
    this.held = held;
  }

  /** The server holds revision `told`: read where the page holds another. */
  told(told: ReviewRev): void {
    if (!behind(this.held(), told)) return;
    if (this.out) this.said = told;
    else void this.fetch();
  }

  /** Read the whole review (a change this page cannot apply: one missed, another run's), or once
   *  the reading out is back. A reading that fails is left: the next revision said reads again. */
  fetch(): Promise<void> {
    if (this.out) {
      this.again = true;
      return this.out;
    }
    this.out = this.read()
      .then(this.take, () => {})
      .finally(() => {
        this.out = null;
        const said = this.said;
        const again = this.again || (said !== null && behind(this.held(), said));
        this.said = null;
        this.again = false;
        if (again) void this.fetch();
      });
    return this.out;
  }

  /** Whether a reading is out. */
  get reading(): boolean {
    return this.out !== null;
  }
}
