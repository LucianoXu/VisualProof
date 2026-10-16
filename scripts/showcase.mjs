// Serve a showcase (showcase/<name>/): its committed site, copied first, on a checkout of the project
// it was made from, with this checkout's server.
//
//   npm run showcase -- <checkout> [--showcase flt-regular] [--site dir] [serve's options…]
//
// The server writes in its site, and the repository's copy is never served: without --site the
// site is copied into a new temporary folder; with --site, into that folder when it is missing or
// empty, which is then served as it is on every later run (a deployment's own copy). The other
// options go to `visualproof serve` as they are: --port, --host, --cache, --access-key-file and
// --public for a read-only public site, …
//
// The checkout should be the one the showcase's project.json serves, built, with its `.olean` files
// dated at that build's time as the showcase's setup.sh leaves them: the history takes a build's
// time from them, and another time is another build.

import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const take = (flag) => {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const name = take("--showcase") ?? "flt-regular";
const siteArg = take("--site");
const checkout = argv.shift();
if (!checkout || checkout.startsWith("-")) {
  console.error("usage: npm run showcase -- <checkout> [--showcase flt-regular] [--site dir] [serve's options…]");
  process.exit(2);
}
const root = resolve(checkout);
const dir = join(REPO, "showcase", name);
if (!existsSync(join(dir, "site"))) {
  console.error(`There is no showcase ${name}: no ${join(dir, "site")}.`);
  process.exit(2);
}

// the checkout: the build the showcase serves, dated as its history says
const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const served = project.builds.find((b) => b.commit === project.served);
let head = null;
try {
  head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // not a git checkout: said below
}
if (head !== project.served) console.warn(`warning: ${root} is at ${head ?? "no commit"}, not ${project.served}, the build the showcase serves.`);
let newest = 0;
const walk = (d) => {
  let ents = [];
  try {
    ents = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith(".olean")) newest = Math.max(newest, statSync(f).mtimeMs);
  }
};
walk(join(root, ".lake", "build", "lib", "lean"));
if (!newest) {
  console.error(`${root} is not built: run showcase/${name}/setup.sh first.`);
  process.exit(2);
}
if (served && newest !== Date.parse(served.builtAt))
  console.warn(`warning: the build in ${root} is dated ${new Date(newest).toISOString()}, not ${served.builtAt}: the history will take it for a new build (setup.sh dates it).`);

// the site: a copy, never the repository's
let site;
if (siteArg) {
  site = resolve(siteArg);
  if (!existsSync(site) || readdirSync(site).length === 0) cpSync(join(dir, "site"), site, { recursive: true });
} else {
  site = join(mkdtempSync(join(tmpdir(), `visualproof-showcase-${name}-`)), "site");
  cpSync(join(dir, "site"), site, { recursive: true });
}
console.log(`showcase ${name}: its site served from ${site}`);

const child = spawn(process.execPath, [join(REPO, "src", "server", "main.ts"), "serve", root, "--site", site, ...argv], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
