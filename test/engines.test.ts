// The same layout on every engine (CanvasSpec, "Dependency order"): the page's own layout worker
// (web/src/layoutworker.ts, bundled as the server bundles it) laid out in a browser gives what the
// server's Node gives, to the last bit — the fixture, the flt-regular showcase's builds as the Time
// Machine lays out their boards (afresh, kept in place against a later build's memory, with levels
// hidden), and a folder of 250 files, whose settling goes through the grids. In Chromium, and in
// Firefox and WebKit where Playwright has them. Needs Playwright, which the package does not depend
// on (CONTRIBUTING.md: `npm install --no-save playwright && npx playwright install chromium`, or
// VP_CHROMIUM); the fixture needs lake as well.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { bundlePage } from "../src/server/pipeline.ts";
import type { ClusterMode, RawGraph, ViewNode } from "../src/shared/graph.ts";
import { computeLayout, memoryOf } from "../src/shared/layout.ts";
import { layOut } from "../src/web/src/layoutworker.ts";
import type { LayoutAsk } from "../src/web/src/layoutworker.ts";
import { copyFixture, extractor } from "./fixturecopy.ts";
import { folderGraph, showcaseGraphs } from "./layoutgraphs.ts";
import type { LayoutGraph } from "./layoutgraphs.ts";

/** the extractor, compiled as the server runs it (test/fixturecopy.ts) */
const EXTRACT = await extractor();

/** what the test asks of Playwright, which is not a dependency (so not named to the type checker) */
interface Page {
  goto(url: string): Promise<unknown>;
  evaluate<R, A>(f: (a: A) => R | Promise<R>, a: A): Promise<R>;
  close(): Promise<void>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
type Kind = "chromium" | "firefox" | "webkit";
let pw: Record<Kind, { launch(o: { executablePath?: string }): Promise<Browser> }> | null = null;
// the browsers where Playwright installs them: test/setup.ts points the cache home elsewhere
process.env.PLAYWRIGHT_BROWSERS_PATH ??=
  process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "ms-playwright")
    : process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright")
      : join(homedir(), ".cache", "ms-playwright");
try {
  const name = "playwright";
  pw = await import(name);
} catch {
  pw = null;
}
let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

type Ask = Omit<LayoutAsk, "id">;
/** what each engine lays out, by name */
const asks: { name: string; ask: Ask }[] = [];
let dir = "";
let server: Server | null = null;
let base = "";

/** A graph's asks: afresh by both clusterings, then by namespace with its largest level hidden. */
function fresh(g: LayoutGraph): void {
  for (const mode of ["namespace", "module"] as ClusterMode[]) asks.push({ name: `${g.name} by ${mode}`, ask: { mode, nodes: g.nodes, edges: g.edges, hidden: [], mem: null } });
  const top = g.nodes.find((n) => !n.ext)?.name.split(".")[0];
  if (top) asks.push({ name: `${g.name} by namespace, ${top} hidden`, ask: { mode: "namespace", nodes: g.nodes, edges: g.edges, hidden: [top], mem: null } });
}

before(async () => {
  if (!pw) return;
  dir = mkdtempSync(join(tmpdir(), "vp-engines-"));
  if (haveLake) {
    const fx = copyFixture("vp-engines-fixture-");
    try {
      execFileSync("lake", ["build"], { cwd: fx, stdio: "ignore" });
      execFileSync("lake", ["env", ...EXTRACT, join(fx, "graph.json"), join(fx, ".lake/build/lib/lean"), "Fixture"], { cwd: fx, stdio: "ignore" });
      const g = JSON.parse(readFileSync(join(fx, "graph.json"), "utf8")) as RawGraph;
      fresh({
        name: "the fixture",
        nodes: [...g.nodes.map((n) => ({ name: n.name, module: n.module })), ...g.externals.map((e) => ({ name: e.name, module: e.module, ext: true as const }))],
        edges: Int32Array.from(g.edges.flat()),
      });
    } finally {
      rmSync(fx, { recursive: true, force: true });
    }
  }
  const builds = showcaseGraphs();
  for (const g of builds) fresh(g);
  // a past build's board as the Time Machine lays it out: kept in place against the memory of the
  // latest build's
  const latest = builds[builds.length - 1];
  for (const mode of ["namespace", "module"] as ClusterMode[]) {
    const mem = memoryOf(computeLayout(mode, latest.nodes as ViewNode[], latest.edges), latest.nodes as ViewNode[]);
    for (const g of builds.slice(0, -1)) asks.push({ name: `${g.name} by ${mode}, against the latest build's memory`, ask: { mode, nodes: g.nodes, edges: g.edges, hidden: [], mem } });
  }
  const folder = folderGraph(250);
  asks.push({ name: `${folder.name} by module`, ask: { mode: "module", nodes: folder.nodes, edges: folder.edges, hidden: [], mem: null } });
  // the page's bundle, as the server makes it, served with a page that starts its layout worker
  await bundlePage(dir, false);
  const files: Record<string, [string, string]> = {
    "/": ["text/html", "<!doctype html><title>layout</title>"],
    "/layout.js": ["text/javascript", readFileSync(join(dir, "layout.js"), "utf8")],
  };
  server = createServer((req, res) => {
    const f = files[req.url ?? ""];
    res.writeHead(f ? 200 : 404, { "content-type": f ? f[0] : "text/plain" });
    res.end(f ? f[1] : "");
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Each ask laid out in `browser`'s layout worker, as JSON. */
async function inBrowser(browser: Browser): Promise<string[]> {
  const page = await browser.newPage();
  await page.goto(base + "/");
  const out: string[] = [];
  for (const { ask } of asks) {
    out.push(
      await page.evaluate(
        ({ ask, edges }) =>
          new Promise<string>((ok, no) => {
            const w = new Worker("/layout.js", { type: "module" });
            w.onmessage = (e) => {
              w.terminate();
              if (e.data.layout) ok(JSON.stringify(e.data.layout));
              else no(new Error(e.data.error));
            };
            w.onerror = (e) => no(new Error(e.message));
            w.postMessage({ id: 1, ...ask, edges: Int32Array.from(edges) });
          }),
        { ask: { ...ask, edges: [] as number[] }, edges: [...ask.edges] },
      ),
    );
  }
  await page.close();
  return out;
}

for (const kind of ["chromium", "firefox", "webkit"] as Kind[]) {
  test(`${kind} lays out what Node lays out, to the last bit: the fixture, the showcase's builds and their past boards, a folder of 250 files`, { skip: !pw && "Playwright is not installed", timeout: 600_000 }, async (t) => {
    let browser: Browser;
    try {
      browser = await pw![kind].launch(kind === "chromium" && process.env.VP_CHROMIUM ? { executablePath: process.env.VP_CHROMIUM } : {});
    } catch {
      t.skip(`Playwright has no ${kind}`);
      return;
    }
    try {
      if (!haveLake) t.diagnostic("no lake: the fixture is left out");
      const got = await inBrowser(browser);
      asks.forEach(({ name, ask }, k) => assert.equal(got[k], JSON.stringify(layOut(ask)), `${name}: ${kind} and Node differ`));
      assert.equal(asks.length, haveLake ? 17 : 14);
    } finally {
      await browser.close();
    }
  });
}
