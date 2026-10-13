#!/usr/bin/env node
// VisualProof on real projects, at their scale: each built project served with a site and caches of
// its own in a temporary folder (never a real site), cold then warm, and measured. What it says is
// what the manual's figures come from, and what a change to the server, the page's data or Lean's
// part should leave no worse.
//
//   node scripts/scale.mjs <built Lean project>...      the checkout's server
//     --bin <command>     another `visualproof` (an installed package)
//     --jobs N            the usage pass's workers (default: the server's)
//     --target <name>     the theorem to probe (default: the largest TCB among a few theorems)
//     --export            typeset the target's review set too (needs XeLaTeX)
//     --out <dir>         where the sites, caches, logs and results.json go (default: a new
//                         temporary folder)
//
// Per project: the time to the graph and to the end of the usage pass, the most memory the server
// and its children (the usage pass's workers, Lean's language server) held at once, Lean's first
// answer, a restart from the caches; then, warm: the target's TCB, keys and why, its review set
// (and its document), a snapshot's graph, and a Lean worker's memory once its module is open.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const repo = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
let bin = null;
let jobs = null;
let target = null;
let typeset = false;
let out = null;
const projects = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bin") bin = args[++i];
  else if (args[i] === "--jobs") jobs = args[++i];
  else if (args[i] === "--target") target = args[++i];
  else if (args[i] === "--export") typeset = true;
  else if (args[i] === "--out") out = resolve(args[++i]);
  else projects.push(resolve(args[i]));
}
if (!projects.length) {
  console.error("usage: node scripts/scale.mjs <built Lean project>... [--bin command] [--jobs N] [--target name] [--export] [--out dir]");
  process.exit(2);
}
out ??= mkdtempSync(join(tmpdir(), "visualproof-scale-"));
const command = bin ? [bin] : [process.execPath, join(repo, "src", "server", "main.ts")];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const AGENT = { "x-visualproof-name": "ScaleProbe", "x-visualproof-kind": "agent", "content-type": "application/json" };

function freePort() {
  return new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** every process: its parent and resident memory (MB), and what it runs */
function processes() {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,args="], { encoding: "utf8", maxBuffer: 64 << 20 })
    .trim()
    .split("\n")
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      return { pid: Number(m[1]), ppid: Number(m[2]), mb: Math.round(Number(m[3]) / 1024), args: m[4] };
    });
}

/** the server's memory, and its descendants' */
function memory(pid) {
  const all = processes();
  const kids = all.filter((p) => p.ppid === pid);
  const desc = [];
  while (kids.length) {
    const k = kids.pop();
    desc.push(k);
    kids.push(...all.filter((p) => p.ppid === k.pid));
  }
  const self = all.find((p) => p.pid === pid)?.mb ?? 0;
  return { self, total: self + desc.reduce((n, p) => n + p.mb, 0), procs: desc };
}

async function call(base, path, init = {}) {
  const t = Date.now();
  const res = await fetch(base + path, { headers: AGENT, ...init });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t, kb: Math.round(text.length / 1024), gzKb: Math.round(gzipSync(text).length / 1024), text };
}

/** One run of the server: until the usage pass ends (cold) or the graph is read (warm). */
async function serve(project, dir, phase, probe) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  const child = spawn(command[0], [...command.slice(1), "serve", project, "--port", String(port), "--site", join(dir, "site"), "--cache", join(dir, "cache"), ...(jobs ? ["--jobs", jobs] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", (b) => (log += b));
  const closed = new Promise((ok) => child.on("close", ok));
  const r = { graphS: null, usageS: null, usage: null, peakMB: 0, peakServerMB: 0, peakWorkers: 0 };
  for (;;) {
    await sleep(1000);
    if (child.exitCode !== null) {
      r.error = `the server ended (${child.exitCode})`;
      break;
    }
    const m = memory(child.pid);
    r.peakMB = Math.max(r.peakMB, m.total);
    r.peakServerMB = Math.max(r.peakServerMB, m.self);
    r.peakWorkers = Math.max(r.peakWorkers, m.procs.filter((p) => /Usage|vp-usage/.test(p.args)).length);
    let st;
    try {
      st = await (await fetch(base + "/api/status")).json();
    } catch {
      continue;
    }
    if (st.extractError) {
      r.error = st.extractError;
      break;
    }
    if (r.graphS === null && st.state === "ready" && st.graph) r.graphS = (Date.now() - t0) / 1000;
    if (r.graphS !== null && ["done", "off", "cancelled"].includes(st.usage?.state)) {
      r.usageS = (Date.now() - t0) / 1000;
      r.usage = { modules: st.usage.total, cached: st.usage.cached, failed: st.usage.failed?.length ?? 0, passS: st.usage.ms === null ? null : st.usage.ms / 1000 };
      break;
    }
  }
  if (r.graphS !== null) {
    const meta = await call(base, "/api/meta");
    r.meta = { kb: meta.kb, gzKb: meta.gzKb, ms: meta.ms };
    const edges = await call(base, "/api/edges?pack=2");
    r.edges = { kb: edges.kb, ms: edges.ms };
    // what the server says of its work: the extraction, the layouts, the history's snapshot
    r.layout = [...log.matchAll(/layout by (\w+): (\d+) clusters, (\d+) ms/g)].map((m) => ({ by: m[1], clusters: Number(m[2]), ms: Number(m[3]) }));
    const wrote = /\[extract\] wrote .* \((\d+) ms\)/.exec(log);
    if (wrote) r.extractMs = Number(wrote[1]);
    const snap = /history: snapshot \d+ of a new build: (\d+) declarations in (\d+) KB/.exec(log);
    if (snap) r.snapshotKb = Number(snap[2]);
    if (probe) await probe(base, JSON.parse(meta.text), child.pid, r);
  }
  child.kill("SIGTERM");
  await closed;
  writeFileSync(join(dir, `serve-${phase}.log`), log);
  return r;
}

/** Warm: what a reader and an agent ask of a large target, and of the history. */
async function probe(base, meta, pid, r) {
  r.graph = { projectDecls: meta.projectCount, nodes: meta.nodes.length, modules: meta.modules.length, edges: meta.edgeCount };
  let name = target;
  if (!name) {
    // the theorem whose TCB is the largest: a few thousand questions, each a few ms
    const theorems = meta.nodes.filter((n) => !n.ext && n.kind === "theorem").map((n) => n.name).slice(0, 5000);
    let best = null;
    for (const n of theorems) {
      const t = JSON.parse((await call(base, `/api/agent/tcb?target=${encodeURIComponent(n)}&include=all&limit=1`)).text);
      if (!best || (t.total ?? 0) > best.total) best = { name: n, total: t.total ?? 0 };
    }
    name = best?.name;
  }
  if (!name) return;
  const q = encodeURIComponent(name);
  const tcb = await call(base, `/api/agent/tcb?target=${q}&include=all&limit=500`);
  const t = JSON.parse(tcb.text);
  r.target = { name, members: t.total, needReview: t.counts?.needReview, trusted: t.trustedNotCounted, tcbMs: tcb.ms, tcbKb: tcb.kb };
  r.target.keysMs = (await call(base, `/api/agent/keys?target=${q}&members=1`)).ms;
  r.target.whyMs = (await call(base, `/api/agent/why?target=${q}&name=${q}`)).ms;
  const open = await call(base, "/api/agent/views/open", { method: "POST", body: JSON.stringify({ scope: `tcb(${name}) except trusted or (uses(${name}) and kind(axiom) and nonstandard)` }) });
  const view = JSON.parse(open.text);
  r.reviewSet = { status: open.status, ms: open.ms, holds: view.holds };
  if (typeset && open.status === 200) {
    const t0 = Date.now();
    let job = JSON.parse((await call(base, "/api/agent/export", { method: "POST", body: JSON.stringify({ view: view.view?.id ?? view.view }) })).text);
    while (job.job?.state === "running" && Date.now() - t0 < 30 * 60_000) {
      await sleep(2000);
      job = JSON.parse((await call(base, `/api/agent/export/job?id=${job.job.id}`)).text);
    }
    r.document = { state: job.job?.state ?? job.error, pages: job.job?.pages, s: (Date.now() - t0) / 1000, error: job.job?.error?.slice(0, 300) };
  }
  const hist = JSON.parse((await call(base, "/api/agent/history")).text);
  const snap = (hist.snapshots ?? [])[0];
  if (snap) {
    r.snapshot = { id: snap.id };
    for (const part of ["whole", "nodes", "edges"]) {
      const g = await call(base, `/api/agent/history/graph?id=${snap.id}${part === "whole" ? "" : `&part=${part}`}`);
      r.snapshot[part] = { status: g.status, kb: g.kb, gzKb: g.gzKb, ms: g.ms };
    }
  }
  const mod = meta.nodes.find((n) => n.name === name)?.module;
  const t0 = Date.now();
  const describe = await call(base, `/api/hover/describe?module=${encodeURIComponent(mod)}&name=${q}`);
  r.lean = { module: mod, describeStatus: describe.status, firstS: (Date.now() - t0) / 1000 };
  r.lean.againMs = (await call(base, `/api/hover/describe?module=${encodeURIComponent(mod)}&name=${q}`)).ms;
  const m = memory(pid);
  r.lean.memoryMB = m.total;
  r.lean.workersMB = m.procs.filter((p) => /lean/.test(p.args)).map((p) => p.mb);
}

const results = {};
for (const project of projects) {
  const dir = join(out, basename(project));
  mkdirSync(dir, { recursive: true });
  process.stderr.write(`${project}: cold\n`);
  const cold = await serve(project, dir, "cold", null);
  process.stderr.write(`${project}: warm\n`);
  const warm = await serve(project, dir, "warm", probe);
  results[project] = { cold, warm };
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
}

console.log("");
console.log("| project | declarations | modules | graph, cold | usage pass | peak memory | graph, warm | target's TCB |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [p, { cold, warm }] of Object.entries(results)) {
  const g = warm.graph ?? {};
  console.log(`| ${basename(p)} | ${g.projectDecls ?? "?"} | ${g.modules ?? "?"} | ${cold.graphS ?? cold.error} s | ${cold.usage ? `${cold.usage.passS} s, ${cold.usage.modules} modules` : "-"} | ${(cold.peakMB / 1024).toFixed(1)} GB | ${warm.graphS} s | ${warm.target ? `${warm.target.members} (${warm.target.tcbMs} ms)` : "-"} |`);
}
console.log(`\nresults: ${join(out, "results.json")}`);
