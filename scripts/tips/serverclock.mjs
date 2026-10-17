// The server's clock while a film is recorded (scripts/tips-record.mjs): loaded with `node --import`,
// it stops `Date` at the time the file TIPS_CLOCK holds (an ISO time), which the recorder writes at
// every frame, so that what the server records during a film (an opinion, a note, a message) is
// dated by the film's clock, the same in every recording. Timers and `performance` run on the
// machine's clock.

import { readFileSync, watchFile } from "node:fs";

const file = process.env.TIPS_CLOCK;
if (file) {
  let t = Date.now();
  const read = () => {
    try {
      const v = Date.parse(readFileSync(file, "utf8").trim());
      if (Number.isFinite(v)) t = v;
    } catch {
      // being written: the time before
    }
  };
  read();
  watchFile(file, { interval: 10, persistent: false }, read);
  const RealDate = Date;
  class FilmDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(t);
      else super(...args);
    }
    static now() {
      return t;
    }
  }
  globalThis.Date = FilmDate;
}
