// A small library for exercising a change in a real browser, as a scenario does
// (scripts/e2e/smoke.mjs is one): a server of this checkout on a built project — the flt-regular
// showcase, its site copied in, or any other with a site of its own — on a free port, with or
// without an access key, --public, --public-url; the people it lets in, each in a browser context of
// their own (a guest with a name, a person invited by a personal link, a read-only reader, a visitor
// of a public site); agents' tokens at a level, and the agents' API asked with them; pages in light
// or dark, on a desktop or a phone; screenshots named alike, in the order they are taken.
//
// Nothing it does writes into the repository or a real site: each server's folder — its site, key,
// log and PID — is a new folder under the system's temporary folder (`scratch`), and its cache one
// there too unless one of your own is given, which may be neither in the repository nor
// VisualProof's homes (server/dirs.ts). A server is stopped by the PID it was started with, never by
// a pattern: others run the same commands. It needs Playwright, which the package does not depend
// on (CONTRIBUTING.md: `npm install --no-save playwright && npx playwright install chromium`, or
// VP_CHROMIUM).

import { execFileSync, spawn } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cacheHome, dataHome } from "../../src/server/dirs.ts";

export const REPO = resolve(import.meta.dirname, "..", "..");

/** How a page is looked at: its theme and its screen. */
export const SCREENS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

/** Whether `p` is `dir` or inside it. */
export function within(p, dir) {
  const r = relative(resolve(dir), resolve(p));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

/** Why a folder may not be written by a scenario, or null: the repository, VisualProof's homes (a
 *  real site's, the caches its servers share) are never its. */
export function refused(dir, homes = { data: dataHome(), cache: cacheHome() }) {
  if (within(dir, REPO)) return `${dir} is in the repository`;
  if (within(dir, homes.data)) return `${dir} is in VisualProof's data home, where real sites are`;
  if (within(dir, homes.cache)) return `${dir} is in VisualProof's cache home, which real servers share`;
  return null;
}

function writable(dir) {
  const why = refused(dir);
  if (why) throw new Error(`a scenario writes only in folders of its own: ${why}`);
  return resolve(dir);
}

/** A new folder for one scenario's run, under the system's temporary folder. */
export function scratch(name) {
  return writable(mkdtempSync(join(tmpdir(), `visualproof-e2e-${name}-`)));
}

/** A screenshot's file name: the order it was taken in, the theme and screen, whose page, and what
 *  it shows, in lower case with dashes — `03-dark-desktop-bob-public-reply.png`. */
export function shotName(n, look, who, what) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${String(n).padStart(2, "0")}-${look.theme}-${look.screen}-${slug(who)}-${slug(what)}.png`;
}

/** A port nobody listens on, as the system gives one. */
export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const running = new Set();
let guarded = false;
/** A server outlives no scenario: each is stopped by its PID when the scenario ends, fails or is
 *  interrupted. */
function guard() {
  if (guarded) return;
  guarded = true;
  process.on("exit", () => {
    for (const s of running) s.kill();
  });
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      for (const s of running) s.kill();
      process.exit(130);
    });
}

/** Start a server of this checkout on `project` (a built Lean project): in `dir` (a folder of
 *  `scratch`, or a new one) its site, its key and its log, its cache in `cache` (by default one kept
 *  under the temporary folder between runs, so that a project is extracted once). With `showcase`
 *  (a folder of showcase/, "flt-regular"), the site is a copy of that showcase's; else a new one.
 *  `key` (default true): a key, which the people and agents below are let in by; `public`,
 *  `publicUrl`, `agents` as serve's options; `args`, more of them. `--updates off`: a scenario never
 *  asks npm's registry. */
export async function serve(o) {
  const cache = writable(o.cache ?? join(tmpdir(), "visualproof-e2e-cache"));
  if (o.dir) writable(o.dir);
  const project = resolve(o.project);
  if (!existsSync(join(project, ".lake", "build"))) throw new Error(`${project} is not built (lake build; for the showcase, showcase/${o.showcase ?? "flt-regular"}/setup.sh)`);
  const dir = o.dir ? resolve(o.dir) : scratch("server");
  mkdirSync(dir, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const site = join(dir, "site");
  if (o.showcase) {
    const from = join(REPO, "showcase", o.showcase);
    if (!existsSync(join(from, "site"))) throw new Error(`There is no showcase ${o.showcase}.`);
    cpSync(join(from, "site"), site, { recursive: true });
    // the build the showcase serves, as scripts/showcase.mjs warns
    const served = JSON.parse(readFileSync(join(from, "project.json"), "utf8")).served;
    let head = null;
    try {
      head = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      // not a git checkout: said below
    }
    if (head !== served) console.warn(`warning: ${project} is at ${head ?? "no commit"}, not ${served}, the build the showcase serves.`);
  }
  const key = o.key === false ? null : randomBytes(32).toString("base64url");
  const keyFile = join(dir, "key");
  if (key) writeFileSync(keyFile, key + "\n", { mode: 0o600 });
  const port = o.port ?? (await freePort());
  const args = ["serve", project, "--site", site, "--cache", cache, "--port", String(port), "--host", "127.0.0.1", "--updates", "off"];
  if (key) args.push("--access-key-file", keyFile);
  if (o.public) args.push("--public");
  if (o.publicUrl) args.push("--public-url", o.publicUrl);
  if (o.agents) args.push("--agents", o.agents);
  args.push(...(o.args ?? []));
  const log = join(dir, "server.log");
  const out = openSync(log, "a");
  const child = spawn(process.execPath, [join(REPO, "src", "server", "main.ts"), ...args], { cwd: dir, stdio: ["ignore", out, out] });
  closeSync(out);
  writeFileSync(join(dir, "server.pid"), `${child.pid}\n`);
  guard();
  running.add(child);
  let exited = null;
  const ended = new Promise((ok) => child.on("exit", (code, signal) => ok((exited = { code, signal }))));
  const url = `http://127.0.0.1:${port}`;
  const auth = key ? { authorization: `Bearer ${key}` } : {};
  /** A request to the server as someone given the key, under `name` if one is given. */
  const ask = async (method, path, body, name) => {
    const r = await fetch(url + path, { method, headers: { ...auth, "content-type": "application/json", ...(name ? { "x-visualproof-name": encodeURIComponent(name) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON: `text` says what it was
    }
    return { status: r.status, json, text };
  };
  const tail = () => readFileSync(log, "utf8").split("\n").slice(-20).join("\n");
  const server = {
    url,
    port,
    key,
    public: !!o.public,
    pid: child.pid,
    dir,
    site,
    cache,
    log,
    /** the project's root as the page keys what it keeps in the browser by (`visualproof:<root>`) */
    root: project,
    ask,
    /** personal links made, by name: a person's second browser opens the same one */
    links: new Map(),
    /** Ready to be read: the graph read (and, with `usage`, the usage pass done), within `ms`. */
    async ready({ usage = false, ms = 20 * 60_000 } = {}) {
      for (const t0 = Date.now(); ; await sleep(500)) {
        if (exited) throw new Error(`the server ended (${exited.code ?? exited.signal}); ${log}:\n${tail()}`);
        try {
          const s = (await ask("GET", "/api/status")).json;
          if (s?.state === "ready" && (!usage || s.usage?.state === "done")) return s;
        } catch {
          // not listening yet
        }
        if (Date.now() - t0 > ms) throw new Error(`the server was not ready within ${ms / 1000} s; ${log}:\n${tail()}`);
      }
    },
    /** An agent's token at `level` (default advise), made in Share by `by` (default Olivia), and its
     *  requests to the agents' API: `ask("GET", "inbox?wait=20")`. */
    async agent({ level = "advise", name, by = "Olivia" } = {}) {
      const r = await ask("POST", "/api/share/agents", { level, ...(name ? { name } : {}) }, by);
      if (r.status !== 200) throw new Error(`no token: ${r.status} ${r.text}`);
      const token = /vpa_[0-9a-f]{10}_[A-Za-z0-9_-]{43}/.exec(r.json.prompt)?.[0];
      if (!token) throw new Error("the prompt holds no token");
      return {
        token,
        id: r.json.token.id,
        name: r.json.token.name,
        level,
        prompt: r.json.prompt,
        /** `path` after /api/agent/ ("inbox?wait=5"); "" for the entry */
        async ask(method, path, body) {
          const a = await fetch(`${url}/api/agent${path ? `/${path.replace(/^\/+/, "")}` : ""}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
          return { status: a.status, json: await a.json().catch(() => null) };
        },
      };
    },
    /** Stop it by its PID: asked to (SIGTERM), then made to after `ms`. */
    async stop(ms = 20_000) {
      if (!exited) {
        child.kill("SIGTERM");
        if (!(await Promise.race([ended, sleep(ms).then(() => false)]))) child.kill("SIGKILL");
        await ended;
      }
      running.delete(child);
      return exited;
    },
  };
  return server;
}

/** Chromium, with WebGL in software for the board (`--use-angle=swiftshader`); `headed` to watch
 *  it. VP_CHROMIUM: a Chromium of your own. */
export async function browser({ headed = false } = {}) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("This needs Playwright: npm install --no-save playwright && npx playwright install chromium");
  }
  return playwright.chromium.launch({
    headless: !headed,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    ...(process.env.VP_CHROMIUM ? { executablePath: process.env.VP_CHROMIUM } : {}),
  });
}

/** Screenshots in `dir`, numbered in the order they are taken (shotName). */
export function camera(dir) {
  mkdirSync(writable(dir), { recursive: true });
  let n = 0;
  const taken = [];
  return {
    dir,
    taken,
    async shot(person, what) {
      const file = join(dir, shotName(++n, person.look, person.name, what));
      await person.page.screenshot({ path: file });
      taken.push(file);
      return file;
    },
  };
}

/** A person's page, in a browser context of its own: `look` {theme: light|dark, screen:
 *  desktop|phone}; `name`, the name the page gives (a guest's), none for whoever the server knows
 *  (a personal link) or who reads alone. The page as a returning reader has it: the tour taken, no
 *  tip in place. Errors in its console are kept. */
async function person(b, server, who, look, name, kind) {
  const l = { theme: look?.theme ?? "light", screen: look?.screen ?? "desktop" };
  const ctx = await b.newContext({ ...SCREENS[l.screen], colorScheme: l.theme });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.url });
  await ctx.addInitScript(
    ([root, theme, reviewer]) => {
      try {
        localStorage.setItem("visualproof:theme", theme);
        const k = `visualproof:${root}`;
        const was = JSON.parse(localStorage.getItem(k) || "{}");
        localStorage.setItem(k, JSON.stringify({ ...was, guided: true, ...(reviewer && !was.reviewer ? { reviewer } : {}) }));
        localStorage.setItem("visualproof:tips", JSON.stringify({ shown: {}, counts: {}, done: [], off: true }));
      } catch {
        // storage blocked: the page as a first visit has it
      }
    },
    [server.root, l.theme, name ?? null],
  );
  const page = await ctx.newPage();
  const errors = [];
  // what a scenario asks through `ask` and is refused is its own probe, not the page's error
  const asked = new Set();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (/^Failed to load resource/.test(m.text()) && url && asked.has(new URL(url).pathname)) return;
    errors.push(url ? `${m.text()} (${url})` : m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  const p = {
    name: who,
    kind,
    look: l,
    ctx,
    page,
    errors,
    /** Go to `path` of the server (or a whole address), and wait for the board. */
    async open(path = "/") {
      await page.goto(/^https?:/.test(path) ? path : server.url + path);
      await p.ready();
    },
    /** The board is there (the loader gone), and what it started has settled for `settle` ms. */
    async ready({ ms = 120_000, settle = 1500 } = {}) {
      await page.waitForFunction(() => document.getElementById("loader")?.classList.contains("gone"), null, { timeout: ms });
      await page.waitForTimeout(settle);
    },
    /** A request from the page, with its cookie and its origin, under its name: `{status, json}`.
     *  Refused, it is not counted among the page's errors. */
    ask(method, path, body) {
      asked.add(new URL(path, server.url).pathname);
      return page.evaluate(
        async ([m, u, b, n]) => {
          const r = await fetch(u, { method: m, headers: { "content-type": "application/json", ...(n ? { "x-visualproof-name": encodeURIComponent(n) } : {}) }, body: b === null ? undefined : JSON.stringify(b) });
          return { status: r.status, json: await r.json().catch(() => null) };
        },
        [method, path, body ?? null, name ?? null],
      );
    },
    close: () => ctx.close(),
  };
  return p;
}

/** A guest: let in by the key's link (or, without a key, as anyone is), with `name` given. */
export async function guest(b, server, name, look) {
  const p = await person(b, server, name, look, name, "guest");
  await p.open(server.key ? `/k/${server.key}` : "/");
  return p;
}

/** A person invited by a personal link, which `by` makes in Share (once per name: a second browser
 *  of theirs opens the same link). */
export async function invited(b, server, name, look, { by = "Olivia" } = {}) {
  let link = server.links.get(name);
  if (!link) {
    const r = await server.ask("POST", "/api/share/people", { name }, by);
    if (r.status !== 200) throw new Error(`no personal link for ${name}: ${r.status} ${r.text}`);
    link = r.json.link;
    server.links.set(name, link);
  }
  const p = await person(b, server, name, look, null, "invited");
  await p.open(link);
  return p;
}

/** A read-only reader, let in by a read-only link `by` makes in Share (a server with a key). */
export async function reader(b, server, look, { by = "Olivia", name = "Reader" } = {}) {
  const r = await server.ask("POST", "/api/share/readonly", {}, by);
  if (r.status !== 200) throw new Error(`no read-only link: ${r.status} ${r.text}`);
  const p = await person(b, server, name, look, null, "reader");
  await p.open(r.json.made.link);
  return p;
}

/** Whoever comes without the key or a link: on a --public server, a read-only visitor; on a private
 *  one, the page that says it is private (not waited for as a board). */
export async function visitor(b, server, look, { name = "Visitor" } = {}) {
  const p = await person(b, server, name, look, null, "visitor");
  if (server.key && !server.public) await p.page.goto(server.url + "/");
  else await p.open("/");
  return p;
}

/** A scenario's checks and lines, and its end: every check passed, and no page's console had an
 *  error. `finish` writes them to `<dir>/result.txt` and gives the exit status. */
export function report(dir) {
  const lines = [];
  let failures = 0;
  const say = (...a) => {
    const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    lines.push(line);
    console.log(line);
  };
  return {
    say,
    check(ok, what) {
      say(`${ok ? "PASS" : "FAIL"} ${what}`);
      if (!ok) failures++;
      return ok;
    },
    finish(people = []) {
      const errors = people.flatMap((p) => p.errors.map((e) => `${p.name} (${p.look.theme}, ${p.look.screen}): ${e}`));
      if (errors.length) say(`console errors:\n  ${errors.join("\n  ")}`);
      say(`${failures ? `${failures} FAILED` : "all passed"}${errors.length ? `, ${errors.length} console errors` : ""}`);
      writeFileSync(join(dir, "result.txt"), lines.join("\n") + "\n");
      return failures || errors.length ? 1 : 0;
    },
  };
}
