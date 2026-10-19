#!/usr/bin/env node
// The README's pictures, made again: the five posters (docs/images/artwork-*.webp), each drawn by
// this checkout's `visualproof artwork` from a recipe this script holds, of a project of the corpus
// (CONTRIBUTING.md, "Real projects") at its commit; and the board (docs/images/board.webp), the live
// demo's page in the middle of a review, taken in a headless Chromium on the flt-regular showcase
// served by this checkout. ImageMagick (`magick`, or `convert` before version 7) writes the WebP. A
// tool for development, not part of the package: the board needs Playwright (CONTRIBUTING.md, "Real
// projects").
//
//   node scripts/readme-figures.mjs [--sphere-packing <dir>] [--flt-regular <dir>]
//        [--prime-numbers <dir>] [--navier-stokes <dir>] [--cedar <dir>] [--showcase <dir>]
//        [--cache <dir>] [--only <name>[,<name>…]]
//
// Each picture takes the checkout its flag names, built (`lake exe cache get && lake build`), and
// only the pictures asked for (--only; all of them otherwise) need theirs: --cedar is cedar-spec's
// checkout, whose `cedar-lean` is drawn; --showcase the flt-regular build the showcase serves
// (showcase/flt-regular/setup.sh). --cache keeps the extractions between runs, one folder for all of
// them (an extraction takes minutes). Nothing is written into a checkout or into the repository but
// the pictures; the posters are drawn without a site, the board on a new copy of the showcase's.
//
// The same builds, recipes and scenario make the same pictures: the posters' PNGs to the byte
// (ExportSpec decision 21), the board's screen as Chromium draws it with WebGL in software (two
// takes the same to the pixel). The WebP is ImageMagick's, with its defaults, so its bytes are those
// of the same ImageMagick and libwebp. The board's dates are the page's, on the real clock: an
// opinion younger than 30 days is said as "n d ago".

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// the posters (2026-10-15): A2 portrait, light, a border; the clusters to depth 1 and the targets
// named; the main target's TCB lit, every edge drawn; the source in the foot; 640 px wide in the README
const POSTER = { size: "a2", orientation: "portrait", theme: "light", border: true, edges: "all", lit: true, keys: false, notes: false, source: true };
const POSTERS = [
  {
    name: "artwork-sphere-packing",
    flag: "--sphere-packing",
    commit: "1e98fb4",
    recipe: { ...POSTER, names: { clusters: 1 }, targets: ["SpherePacking.Dim8.MainTheorem", "SpherePacking.Dim24.MainTheorem"], selection: { name: "SpherePacking.Dim24.MainTheorem", mode: "tcb" }, title: "Sphere Packing", subtitle: "In 8 and 24 dimensions, spheres can pack no tighter" },
  },
  {
    name: "artwork-flt-regular",
    flag: "--flt-regular",
    commit: "bd81b78",
    recipe: { ...POSTER, names: { clusters: 1, omit: ["termM_"] }, targets: ["flt_regular", "FLT_small"], selection: { name: "flt_regular", mode: "tcb" }, title: "FLT Regular", subtitle: "Kummer's ideal numbers settle Fermat for every regular prime" },
  },
  {
    name: "artwork-prime-numbers",
    flag: "--prime-numbers",
    commit: "c39a751",
    recipe: { ...POSTER, names: { clusters: 1 }, targets: ["StrongPNT", "pi_asymp"], selection: { name: "StrongPNT", mode: "tcb" }, title: "Prime Numbers", subtitle: "How thinly they fall, and how little they stray" },
  },
  {
    name: "artwork-navier-stokes",
    flag: "--navier-stokes",
    commit: "f9e8bc5",
    roots: ["NavierStokes", "Euler"],
    recipe: { ...POSTER, names: { clusters: 1 }, targets: ["NavierStokes.Comparator.navier_stokes_breakdown_R3", "Euler.euler_breakdown_R3"], selection: { name: "NavierStokes.Comparator.navier_stokes_breakdown_R3", mode: "tcb" }, title: "Navier–Stokes", subtitle: "Smooth data, finite time, and then the flow breaks" },
  },
  {
    name: "artwork-cedar",
    flag: "--cedar",
    commit: "38d5204",
    sub: "cedar-lean",
    recipe: { ...POSTER, names: { clusters: 1 }, targets: ["Cedar.Thm.validation_is_sound", "Cedar.Thm.forbid_trumps_permit", "Cedar.Thm.isAuthorized_is_sound"], selection: { name: "Cedar.Thm.validation_is_sound", mode: "tcb" }, title: "Cedar", subtitle: "Who may do what: a policy language proved to keep its word" },
  },
];
// the board: a reader's window, at twice the pixels
const BOARD = { name: "board", flag: "--showcase", viewport: { width: 1440, height: 900 }, scale: 2, locale: "en-US", timezoneId: "Europe/Berlin" };
const NAMES = [...POSTERS.map((p) => p.name), BOARD.name];

const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const usage = `usage: node scripts/readme-figures.mjs [--sphere-packing <dir>] [--flt-regular <dir>] [--prime-numbers <dir>] [--navier-stokes <dir>] [--cedar <dir>] [--showcase <dir>] [--cache <dir>] [--only <name>[,<name>…]]`;
const dirs = Object.fromEntries([...POSTERS, BOARD].map((f) => [f.name, take(f.flag)]));
const cache = take("--cache");
const only = take("--only");
if (argv.length) {
  console.error(usage);
  process.exit(2);
}
const wanted = only ? only.split(",").map((s) => s.trim()) : NAMES;
const unknown = wanted.filter((n) => !NAMES.includes(n));
if (unknown.length) {
  console.error(`There is no picture ${unknown.join(", ")}: ${NAMES.join(", ")}.`);
  process.exit(2);
}
for (const f of [...POSTERS, BOARD]) {
  if (!wanted.includes(f.name)) continue;
  const dir = dirs[f.name];
  if (!dir) {
    console.error(`${f.name} needs ${f.flag} <its checkout, built>.\n${usage}`);
    process.exit(2);
  }
  const root = join(resolve(dir), f.sub ?? "");
  if (!existsSync(join(root, ".lake", "build"))) {
    console.error(`${root} is not built: lake exe cache get && lake build${f === BOARD ? " (showcase/flt-regular/setup.sh)" : ""}.`);
    process.exit(2);
  }
}

/** A checkout's commit, or null. */
function headOf(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** ImageMagick's command: `magick` from version 7, `convert` before. */
function imagemagick() {
  for (const cmd of ["magick", "convert"]) if (spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0) return cmd;
  console.error("ImageMagick is needed to write WebP: neither `magick` nor `convert` runs.");
  process.exit(2);
}
const im = imagemagick();

/** A port nobody listens on. */
function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} KB`;
const sleep = (ms) => new Promise((d) => setTimeout(d, ms));

/** A poster: the recipe drawn by this checkout's `visualproof artwork` (no site: the board as a new
 *  site lays it out, the recipe's targets), then 640 px wide as WebP. */
function poster(p, work) {
  const root = join(resolve(dirs[p.name]), p.sub ?? "");
  const head = headOf(root);
  if (!head?.startsWith(p.commit)) console.warn(`warning: ${root} is at ${head ?? "no commit"}, not ${p.commit}, the commit the poster shows.`);
  const recipe = join(work, `${p.name}.json`);
  writeFileSync(recipe, JSON.stringify(p.recipe));
  const png = join(work, p.name);
  const args = [join(REPO, "src", "server", "main.ts"), "artwork", root, ...(p.roots ?? []).flatMap((r) => ["--root", r]), "--recipe", recipe, "--png", "-o", png];
  if (cache) args.push("--cache", resolve(cache));
  console.log(`${p.name}:`);
  if (spawnSync(process.execPath, args, { stdio: "inherit" }).status !== 0) throw new Error(`${p.name}: the artwork command failed`);
  const out = join(REPO, "docs", "images", `${p.name}.webp`);
  execFileSync(im, [`${png}.png`, "-resize", "640x", out]);
  console.log(`  docs/images/${p.name}.webp (${kb(out)})`);
}

/** The board: the showcase served by this checkout on a new copy of its site, behind a key of its
 *  own; Alice's page as a returning reader's (her name set, the Activity and the help seen), the
 *  Status scheme with its legend folded, the TCB of flt_regular selected and zoomed into a view of
 *  its own, the theorem's panel and the review plan beside it. */
async function board(work) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error("The board needs Playwright: npm install --no-save playwright && npx playwright install chromium");
    process.exit(2);
  }
  console.log(`${BOARD.name}:`);
  const key = randomBytes(32).toString("base64url");
  const keyFile = join(work, "key");
  writeFileSync(keyFile, key, { mode: 0o600 });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const args = [join(REPO, "scripts", "showcase.mjs"), resolve(dirs[BOARD.name]), "--site", join(work, "site"), "--port", String(port), "--access-key-file", keyFile];
  if (cache) args.push("--cache", resolve(cache));
  const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((d) => child.once("exit", d));
    }
  };
  let browser;
  try {
    // ready once the graph is read and the usage pass is done
    for (const t0 = Date.now(); ; await sleep(500)) {
      if (child.exitCode !== null) throw new Error(`the server ended (${child.exitCode})`);
      try {
        const s = await (await fetch(`${url}/api/status`, { headers: { authorization: `Bearer ${key}` } })).json();
        if (s.state === "ready" && s.usage?.state === "done") break;
      } catch {
        // not listening yet
      }
      if (Date.now() - t0 > 20 * 60_000) throw new Error("the server was not ready within 20 minutes");
    }
    // WebGL in software
    browser = await playwright.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    const ctx = await browser.newContext({ viewport: BOARD.viewport, deviceScaleFactor: BOARD.scale, colorScheme: "light", reducedMotion: "no-preference", locale: BOARD.locale, timezoneId: BOARD.timezoneId });
    const page = await ctx.newPage();
    const wait = (ms) => page.waitForTimeout(ms);
    // let in by the key's link, which leaves a cookie
    await page.goto(`${url}/k/${key}`);
    await wait(500);
    await page.goto(`${url}/#v=project&mode=tcb`);
    await wait(5000);
    const notNow = page.getByRole("button", { name: "Not now" });
    if (await notNow.count()) await notNow.click();
    await wait(300);
    // the reader: Alice
    await page.getByText("Set your name").first().click();
    await wait(400);
    await page.getByText("Set your name…").first().click();
    await wait(400);
    await page.locator("#who-input").fill("Alice");
    await page.keyboard.press("Enter");
    await wait(800);
    // the Activity seen (the server's update from the version the site was last served by), the help
    await page.locator("#activity-btn").click();
    await wait(1200);
    await page.locator("#activity-btn").click();
    await wait(600);
    await page.locator("#help-btn").click();
    await wait(1200);
    await page.keyboard.press("Escape");
    await wait(600);
    // the theorem selected: its TCB, its panel
    await page.goto(`${url}/#mode=tcb&s=flt_regular`);
    await wait(5000);
    // the Status scheme, its legend folded
    await page.getByRole("button", { name: /Kind/ }).first().click();
    await wait(500);
    await page.getByText("Status", { exact: true }).first().click();
    await wait(500);
    await page.getByRole("button", { name: "Fold the legend" }).click();
    await wait(500);
    // the TCB zoomed into a view of its own
    await page.locator("button", { hasText: /^Zoom in$/ }).first().click();
    await wait(10000);
    const png = join(work, `${BOARD.name}.png`);
    await page.screenshot({ path: png });
    const out = join(REPO, "docs", "images", `${BOARD.name}.webp`);
    execFileSync(im, [png, out]);
    console.log(`  docs/images/${BOARD.name}.webp (${kb(out)})`);
  } finally {
    await browser?.close();
    await stop();
  }
}

const work = mkdtempSync(join(tmpdir(), "visualproof-readme-figures-"));
try {
  for (const p of POSTERS) if (wanted.includes(p.name)) poster(p, work);
  if (wanted.includes(BOARD.name)) await board(work);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
