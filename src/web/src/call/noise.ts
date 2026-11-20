// LiveKit's words in the browser's console that say nothing anyone can act on, kept out of it. When
// a call goes — ended for everyone, the participant removed, the call left — the server closes the
// connection, and LiveKit's client logs each closed data channel as an error and a last negotiation
// as a warning: a dozen red lines for an ordinary end. They are held back a moment, and dropped if
// the call goes within it (or went just before); otherwise they are printed after all, for they then
// mean what they say. One warning of every join is dropped outright. From Cocoding's meetings.
//
// LiveKit logs through loglevel: a logger's `methodFactory` makes its methods, which is where a
// plug-in stands (the same place as LiveKit's own `setLogExtension`).

import { getLogger, LoggerNames } from "livekit-client";

/** logged as a call goes */
const GOING = [/^(Unknown )?DataChannel error on /, /^publisher data channel '\w+' closed unexpectedly/, /^could not createOffer with closed peer connection/];
/** logged at every join, of a track not yet known: nothing follows from it */
const ALWAYS = [/^received subscribed quality update for unknown track/];
/** how long such a line waits for the call to go */
const HOLD_MS = 2000;
/** how long after the call went such lines are still its going */
const AFTER_MS = 4000;

let installed = false;
let goneAt = -Infinity;
const held = new Set<() => void>();

/** The call went (left, ended, removed, lost): what LiveKit said of it just now, and says in the
 *  next moments, is not printed. */
export function callGone(): void {
  goneAt = Date.now();
  held.clear();
}

/** Put the filter on LiveKit's loggers, once. */
export function quietLiveKit(): void {
  if (installed) return;
  installed = true;
  for (const name of Object.values(LoggerNames)) {
    const logger = getLogger(name);
    const make = logger.methodFactory;
    logger.methodFactory = (method, level, loggerName) => {
      const raw = make(method, level, loggerName);
      return (...args: unknown[]) => {
        const msg = typeof args[0] === "string" ? args[0] : "";
        if (ALWAYS.some((r) => r.test(msg))) return;
        if (!GOING.some((r) => r.test(msg))) return raw(...args);
        if (Date.now() - goneAt < AFTER_MS) return;
        const print = () => {
          if (held.delete(print)) raw(...args);
        };
        held.add(print);
        setTimeout(print, HOLD_MS);
      };
    };
    // the logger's methods made again, with the filter
    logger.setLevel(logger.getLevel());
  }
}
