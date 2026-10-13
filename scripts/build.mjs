// The package's contents (`npm run build`, run before `npm pack`): the server compiled to
// JavaScript (tsconfig.build.json), the page bundled (server/pipeline.ts, bundlePage), and what
// the server reads beside its code copied as it is: the Lean programs, the MCP server, the exported
// document's assets, the page's HTML and style. The output mirrors src/, so the paths the server
// finds them by hold in both. Node runs TypeScript from a checkout, never from node_modules.
//
//   node scripts/build.mjs [outdir]     (default: dist/)
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { bundlePage } from "../src/server/pipeline.ts";

const REPO = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] ?? join(REPO, "dist"));

rmSync(out, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(REPO, "tsconfig.build.json"), "--outDir", out], { stdio: "inherit" });
for (const dir of ["extractor", "mcp", "assets"]) cpSync(join(REPO, "src", dir), join(out, dir), { recursive: true });
for (const file of ["index.html", "style.css"]) cpSync(join(REPO, "src", "web", file), join(out, "web", file));
// no source maps: the bundle is not minified, and they would double its size
await bundlePage(join(out, "web", "bundle"), false);
console.log(`built ${out}`);
