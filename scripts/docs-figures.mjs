#!/usr/bin/env node
// The documentation's figures, made again: each is a picture `visualproof artwork` draws from a
// recipe, of the flt-regular showcase (showcase/flt-regular) at the build it serves, written as WebP
// into docs/images/. A tool for development, not part of the package.
//
//   node scripts/docs-figures.mjs <flt-regular checkout> [--cache dir] [--only name]
//
// The checkout is the one the showcase serves, built (showcase/flt-regular/setup.sh). The site is a
// copy of the showcase's, in a new temporary folder: the targets and key declarations drawn are its
// review's. The pictures are drawn by this checkout's server (src/server/main.ts); ImageMagick
// (`magick`, or `convert` before version 7) writes the WebP. The same build, site and recipes make
// the same pictures.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOWCASE = join(REPO, "showcase", "flt-regular");

// one theorem, three selections (MANUAL.md, "Concepts"): the theorem alone, its TCB, its key
// declarations; on a frame wider than the board, so that a name at its edge is not cut off
const look = { size: { w: 1200, h: 900 }, theme: "light", border: false, edges: "selection", keys: true, notes: false, source: false, title: "", subtitle: "", targets: ["flt_regular"] };
const FIGURES = [
  { name: "tcb-view-theorem", recipe: { ...look, names: { clusters: [], targets: true }, selection: { name: "flt_regular", mode: "plain" } } },
  { name: "tcb-view-tcb", recipe: { ...look, names: { clusters: [], targets: true, decls: ["IsRegularPrime", "IsRegularNumber", "FermatLastTheoremFor"] }, selection: { name: "flt_regular", mode: "tcb" } } },
  { name: "tcb-view-keys", recipe: { ...look, names: { clusters: [], targets: true, decls: ["IsRegularPrime", "FermatLastTheoremFor"] }, selection: { name: "flt_regular", mode: "keys" } } },
];
// the screen the board is drawn on, as a reader's: smaller than the default, so that names are large
const SCREEN = "800x800";

const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const cache = take("--cache");
const only = take("--only");
const checkout = argv.shift();
if (!checkout || checkout.startsWith("-") || argv.length) {
  console.error("usage: node scripts/docs-figures.mjs <flt-regular checkout> [--cache dir] [--only name]");
  process.exit(2);
}
const root = resolve(checkout);
if (!existsSync(join(root, ".lake", "build"))) {
  console.error(`${root} is not built: run showcase/flt-regular/setup.sh first.`);
  process.exit(2);
}
const project = JSON.parse(readFileSync(join(SHOWCASE, "project.json"), "utf8"));
let head = null;
try {
  head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // not a git checkout: said below
}
if (head !== project.served) console.warn(`warning: ${root} is at ${head ?? "no commit"}, not ${project.served}, the build the showcase serves.`);
const figures = only ? FIGURES.filter((f) => f.name === only) : FIGURES;
if (!figures.length) {
  console.error(`There is no figure ${only}: ${FIGURES.map((f) => f.name).join(", ")}.`);
  process.exit(2);
}

/** ImageMagick's command: `magick` from version 7, `convert` before. */
function imagemagick() {
  for (const cmd of ["magick", "convert"]) if (spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0) return cmd;
  console.error("ImageMagick is needed to write WebP: neither `magick` nor `convert` runs.");
  process.exit(2);
}
const im = imagemagick();

// the site: a copy, never the repository's
const work = mkdtempSync(join(tmpdir(), "visualproof-figures-"));
const site = join(work, "site");
cpSync(join(SHOWCASE, "site"), site, { recursive: true });
try {
  for (const f of figures) {
    const recipe = join(work, `${f.name}.json`);
    writeFileSync(recipe, JSON.stringify(f.recipe));
    const png = join(work, f.name);
    const args = [join(REPO, "src", "server", "main.ts"), "artwork", root, "--recipe", recipe, "--site", site, "--png", "--screen", SCREEN, "-o", png];
    if (cache) args.push("--cache", resolve(cache));
    console.log(`${f.name}:`);
    if (spawnSync(process.execPath, args, { stdio: "inherit" }).status !== 0) process.exit(1);
    const out = join(REPO, "docs", "images", `${f.name}.webp`);
    execFileSync(im, [`${png}.png`, "-quality", "82", "-define", "webp:method=6", out]);
    console.log(`  docs/images/${f.name}.webp (${(statSync(out).size / 1024).toFixed(0)} KB)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
