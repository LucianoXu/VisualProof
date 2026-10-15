#!/usr/bin/env node
// Pictures of many boards, unattended (ExportSpec decision 20): for each job of a batch file, ask a
// VisualProof server for a link to a picture of its board as a recipe says
// (POST /api/agent/artwork), open the link in a headless Chromium let in with the server's key, and
// save the PNG and SVG the page makes. A tool for development, not part of the package: it needs
// Playwright (CONTRIBUTING.md, "Scripts").
//
//   node scripts/artwork-batch.mjs <batch.json> [--out <dir>] [--headed]
//
// The batch file:
//   { "out": "pictures",                         where the files go (relative to the batch file)
//     "viewport": [1920, 1200],                  the browser's window: how large the frame is on
//                                                screen, so how large names are in the picture
//     "recipe": { … },                           what every job's recipe starts from
//     "save": "png,svg",
//     "jobs": [ { "server": "http://127.0.0.1:4173", "keyFile": "~/vp.key" (or "key": "…"),
//                 "recipe": { … }, "name": "MyProjectA2", "save": "png" } ] }
//
// A job's recipe is laid over the batch's, field by field (`names` as a whole). The files are named
// `<name>.png` and `<name>.svg`, the name made safe for every file system (no `< > : " / \ | ? *`,
// no trailing dot or space, no reserved device name, no `NAME~N` shape), and no two jobs' the same
// (in any case): a later one takes a number. The key goes only to the job's own server, as a Bearer
// on its requests, and is never printed.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const headed = args.includes("--headed");
if (headed) args.splice(args.indexOf("--headed"), 1);
const outArg = flag("--out");
const file = args[0];
if (!file) {
  console.error("usage: node scripts/artwork-batch.mjs <batch.json> [--out <dir>] [--headed]");
  process.exit(2);
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error("This script needs Playwright: npm install --no-save playwright && npx playwright install chromium");
  process.exit(2);
}

const home = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const batch = JSON.parse(readFileSync(file, "utf8"));
const here = dirname(resolve(file));
const out = resolve(here, home(outArg ?? batch.out ?? "."));
mkdirSync(out, { recursive: true });
const [vw, vh] = Array.isArray(batch.viewport) ? batch.viewport : [1920, 1200];

/** A name every file system takes (the Vault's naming rules: Windows is the strictest): no reserved
 *  device name, with an extension or none. */
function safeName(name) {
  let s = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/~(\d)/g, "-$1").slice(0, 90).replace(/[. ]+$/, "") || "Artwork";
  if (/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(\.|$)/i.test(s)) s = `_${s}`;
  return s;
}

/** the names taken, in any case: macOS and Windows tell no two apart by case alone */
const taken = new Set();
function uniqueName(name) {
  let s = name;
  for (let k = 2; taken.has(s.toLowerCase()); k++) s = `${name}-${k}`;
  taken.add(s.toLowerCase());
  return s;
}

/** A PNG's width and height, from its header. */
function pngSize(path) {
  const b = readFileSync(path);
  return b.length > 24 && b.toString("latin1", 1, 4) === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}

const browser = await playwright.chromium.launch({ headless: !headed, ...(process.env.VP_CHROMIUM ? { executablePath: process.env.VP_CHROMIUM } : {}) });
let failed = 0;
try {
  for (const [n, job] of (batch.jobs ?? []).entries()) {
    const server = String(job.server ?? batch.server ?? "").replace(/\/+$/, "");
    const keyFile = job.keyFile ?? batch.keyFile;
    const key = job.key ?? batch.key ?? (keyFile ? readFileSync(home(isAbsolute(keyFile) || keyFile.startsWith("~/") ? keyFile : join(here, keyFile)), "utf8").trim() : null);
    const recipe = { ...(batch.recipe ?? {}), ...(job.recipe ?? {}) };
    const save = String(job.save ?? batch.save ?? "png,svg");
    const name = uniqueName(safeName(job.name ?? `Artwork ${n + 1}`));
    // the key is never printed, whatever says it
    const hide = (text) => (key ? String(text).split(key).join("<key>").split(encodeURIComponent(key)).join("<key>") : String(text));
    const say = (line) => console.log(hide(`[${n + 1}] ${name}: ${line}`));
    try {
      // the link, from the agents' API: the key lets the request in, the headers say it is a script's
      const r = await fetch(`${server}/api/agent/artwork`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-visualproof-name": "artwork-batch", "x-visualproof-kind": "agent", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ recipe, save }),
      });
      const a = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${server} answered ${r.status}: ${a.error ?? "?"}${a.hint ? ` (${a.hint})` : ""}`);
      if (a.names && typeof a.names === "object") say(`names: ${a.names.clusters.length + a.names.ruled.length} clusters (${a.names.ruled.length} by the rule, each where it covers no other name), ${a.names.decls.length} declarations${a.left ? `; ${a.left} left out for room` : ""}`);
      // the page, let in by the key as a Bearer on the requests to this server alone (server/access.ts
      // takes one on every path), opened on this server: the link may name the server's public
      // address, where the browser has nothing
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      try {
        const origin = new URL(server).origin;
        if (key) await context.route((u) => u.origin === origin, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${key}` } }));
        const page = await context.newPage();
        const kinds = save.split(",").filter((k) => k === "png" || k === "svg");
        const got = [];
        page.on("download", (d) => got.push(d));
        await page.goto(`${origin}/${new URL(a.link).hash}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.documentElement.dataset.artworkSaved !== undefined, null, { timeout: 300_000 });
        const said = await page.evaluate(() => document.documentElement.dataset.artworkSaved);
        if (said === "none") throw new Error("the page made no file (the artwork mode could not open, or the browser could not draw the picture)");
        // the files the page says it made, each a download
        const made = said.split(",");
        for (let t = 0; got.length < made.length && t < 600; t++) await page.waitForTimeout(100);
        for (const d of got) {
          // a PNG or an SVG, nothing else
          const ext = d.suggestedFilename().split(".").pop()?.toLowerCase();
          if (ext !== "png" && ext !== "svg") continue;
          const path = join(out, `${name}.${ext}`);
          await d.saveAs(path);
          const size = ext === "png" ? pngSize(path) : null;
          say(`${path} (${statSync(path).size.toLocaleString("en")} bytes${size ? `, ${size[0]} × ${size[1]}` : ""})`);
        }
        if (made.length < kinds.length) throw new Error(`the page made ${made.join(" and ")} of ${kinds.join(" and ")}`);
        if (got.length < made.length) throw new Error(`${got.length} of ${made.length} files came`);
      } finally {
        await context.close();
      }
    } catch (e) {
      failed++;
      say(`failed: ${e.message}`);
    }
  }
} finally {
  await browser.close();
}
if (!existsSync(out)) mkdirSync(out, { recursive: true });
process.exit(failed ? 1 : 0);
