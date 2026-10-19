// A smoke run of the server and the page together in a real browser (scripts/e2e/harness.mjs): the
// flt-regular showcase served with a key; Alice, invited by a personal link, and Bob, a guest; an
// agent at level advise. The agent writes in public and both are told; Bob answers it with an @
// mention, which the agent is handed, and its reply reaches him. A read-only reader has no
// conversations. In light, then dark, a screenshot of each page; Alice on a phone. Then the showcase
// served --public with --public-url: a visitor reads without the key, and an agent's prompt names
// the public address.
//
//   npm run test:e2e -- --showcase <flt-regular checkout> [--cache dir] [--port n] [--headed]
//
// The checkout is built at the commit the showcase serves (showcase/flt-regular/setup.sh). --cache:
// a cache of your own (it is written: a copy, never a server's); by default one kept under the
// system's temporary folder between runs, the first run extracting the project. --port: the first
// of two ports (the private server's, then the public one's); by default free ones. It writes in a
// new folder under the system's temporary folder, which it names, the screenshots in its shots/;
// it exits 1 if a check failed or a page's console had an error.

import { join } from "node:path";
import { browser, camera, guest, invited, reader, report, scratch, serve, visitor } from "./harness.mjs";

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i < 0 ? undefined : argv[i + 1];
};
const checkout = opt("--showcase");
if (!checkout) {
  console.error("usage: npm run test:e2e -- --showcase <flt-regular checkout> [--cache dir] [--port n] [--headed]");
  process.exit(2);
}
const port = opt("--port") ? Number(opt("--port")) : undefined;
const dir = scratch("smoke");
const out = report(dir);
const cam = camera(join(dir, "shots"));
out.say(`smoke run in ${dir}`);

const S = await serve({ project: checkout, showcase: "flt-regular", dir: join(dir, "private"), cache: opt("--cache"), port });
out.say(`server ${S.url}, pid ${S.pid}, log ${S.log}`);
let t0 = Date.now();
await S.ready();
out.say(`ready in ${Math.round((Date.now() - t0) / 1000)} s`);
const b = await browser({ headed: argv.includes("--headed") });
const people = [];

// ---------------------------------------------------------------- an agent at level advise
const ai = await S.agent({ level: "advise", name: "Smoke AI" });
const entry = await ai.ask("GET", "");
out.check(entry.status === 200 && entry.json?.you?.level === "advise", `the agent's token is at level advise (${entry.json?.you?.level})`);
const refused = await ai.ask("POST", "views/create", { name: "Not mine to make" });
out.check(refused.status === 403, `an advise token cannot make a view (${refused.status})`);
// joined: its first wait answers at once with what came while it was away
await ai.ask("GET", "inbox?wait=0");

/** The agent's inbox until `f` finds a message there, within `s` seconds. */
async function handed(f, s = 30) {
  for (const end = Date.now() + s * 1000; Date.now() < end; ) {
    const r = await ai.ask("GET", "inbox?wait=5");
    const m = r.json?.messages?.find(f);
    if (m) return m;
  }
  return null;
}
const texts = (p) => p.page.$$eval("#convo .tk-msg .tk-text", (ms) => ms.map((m) => m.innerText));

for (const theme of ["light", "dark"]) {
  const A = await invited(b, S, "Alice", { theme });
  const B = await guest(b, S, "Bob", { theme });
  people.push(A, B);
  out.check((await A.page.$eval("#who", (w) => w.textContent.trim())).includes("Alice"), `${theme}: Alice's personal link says who she is`);

  // the agent writes in public, unasked: both are told
  const hello = `Hello from the smoke run (${theme}): \`flt_regular\` is the theorem under review.`;
  const said = await ai.ask("POST", "reply", { text: hello, channel: "public" });
  out.check(said.json?.channel === "public", `${theme}: the agent writes in the public channel (${said.status})`);
  for (const p of [A, B]) {
    const told = await p.page.waitForFunction(() => !document.getElementById("talk-badge").hidden, null, { timeout: 10_000 }).then(() => true, () => false);
    out.check(told, `${theme}: ${p.name}'s conversations button counts the agent's message`);
  }

  // Bob answers it, mentioning it: the agent is handed his message, and its reply reaches him
  await B.page.click("#talk-btn");
  await B.page.waitForSelector("#convo:not([hidden])");
  await B.page.waitForTimeout(500);
  out.check((await texts(B)).some((t) => t.startsWith(`Hello from the smoke run (${theme})`)), `${theme}: Bob reads the agent's message`);
  await B.page.click("#convo .cv-input");
  await B.page.keyboard.type("@Smoke");
  await B.page.waitForSelector("#convo .cv-mention", { timeout: 5000 }).catch(() => {});
  const offered = await B.page.$$eval("#convo .cv-mention", (bs) => bs.map((x) => x.textContent));
  const k = offered.findIndex((c) => c.includes("Smoke AI"));
  out.check(k >= 0, `${theme}: @ offers the agent (${offered.join(", ")})`);
  for (let i = 0; i < k; i++) await B.page.keyboard.press("ArrowDown");
  await B.page.keyboard.press("Enter");
  await B.page.keyboard.type(`which lemmas does it lean on? (${theme})`);
  await B.page.keyboard.press("Enter");
  const asked = await handed((m) => m.from === "Bob" && m.text.includes(`(${theme})`));
  out.check(asked?.channel === "public", `${theme}: the agent is handed Bob's mention, in public (${asked?.channel})`);
  await ai.ask("POST", "reply", { text: `@Bob \`flt_regular\` leans on \`caseI\` and \`caseII\` (${theme}).` });
  const replied = await B.page.waitForFunction((t) => [...document.querySelectorAll("#convo .tk-msg .tk-text")].some((m) => m.innerText.includes(t)), `(${theme}).`, { timeout: 10_000 }).then(() => true, () => false);
  out.check(replied, `${theme}: the agent's reply reaches Bob`);
  await cam.shot(B, "public-channel");
  await A.page.click("#talk-btn");
  await A.page.waitForSelector("#convo:not([hidden])");
  await A.page.waitForTimeout(500);
  out.check((await texts(A)).some((t) => t.includes(`(${theme}).`)), `${theme}: Alice reads the exchange`);
  await cam.shot(A, "public-channel");

  // a read-only reader: the board, no conversations, nothing written
  const R = await reader(b, S, { theme });
  people.push(R);
  const hidden = await R.page.$eval("#talk-btn", (x) => x.hidden);
  const chat = await R.ask("POST", "/api/chat", { channel: "public", text: "let me in" });
  out.check(hidden && chat.status === 403, `${theme}: a read-only reader has no conversations, and cannot write (${chat.status})`);
  await cam.shot(R, "read-only");
  for (const p of [A, B, R]) await p.close();
}

// ---------------------------------------------------------------- a phone
const P = await invited(b, S, "Alice", { theme: "light", screen: "phone" });
people.push(P);
out.check(await P.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "on a phone the page is no wider than the screen");
await cam.shot(P, "board");
await P.close();
const stopped = await S.stop();
out.say(`the private server stopped (${stopped.code ?? stopped.signal})`);

// ---------------------------------------------------------------- served --public, --public-url
const PUBLIC = "https://visualproof.example.org";
const Q = await serve({ project: checkout, showcase: "flt-regular", dir: join(dir, "public"), cache: opt("--cache"), port: port && port + 1, public: true, publicUrl: PUBLIC });
t0 = Date.now();
await Q.ready();
out.say(`public server ${Q.url} ready in ${Math.round((Date.now() - t0) / 1000)} s`);
const V = await visitor(b, Q, { theme: "dark" });
people.push(V);
const vChat = await V.ask("POST", "/api/chat", { channel: "public", text: "hello" });
out.check((await V.page.$eval("#talk-btn", (x) => x.hidden)) && vChat.status >= 400, `a visitor without the key reads, and cannot write (${vChat.status})`);
await cam.shot(V, "public-visitor");
await V.close();
const reading = await Q.agent({ level: "read" });
out.check(reading.prompt.includes(PUBLIC), "an agent's prompt names the --public-url address");
out.check((await reading.ask("GET", "")).json?.you?.level === "read", "a read token is at level read");
await Q.stop();
await b.close();

out.say(`screenshots: ${cam.dir}`);
for (const f of cam.taken) out.say(`  ${f}`);
process.exit(out.finish(people));
