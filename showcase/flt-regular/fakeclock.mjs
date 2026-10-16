// The story's clock, for the server the generator drives (generate.ts): loaded with
// `node --import`, it makes `Date` tell the time the file named by VP_FAKE_CLOCK holds (an ISO
// time), running on from the moment it was written there, so that what the server records is
// dated in the story, not when the showcase was generated. The generator writes the next time and
// waits for it to be read before its next request. Nothing else is changed: timers, `performance`
// and the files' own times run on the machine's clock.

import { readFileSync, watchFile } from "node:fs";

const file = process.env.VP_FAKE_CLOCK;
if (file) {
  const RealDate = Date;
  let base = { story: RealDate.now(), real: RealDate.now() };
  const read = () => {
    try {
      const t = RealDate.parse(readFileSync(file, "utf8").trim());
      if (Number.isFinite(t)) base = { story: t, real: RealDate.now() };
    } catch {
      // not written yet: the machine's time until it is
    }
  };
  read();
  watchFile(file, { interval: 20, persistent: false }, read);
  const now = () => base.story + (RealDate.now() - base.real);
  class StoryDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() {
      return now();
    }
  }
  globalThis.Date = StoryDate;
}
