#!/usr/bin/env node
// The tests whose answers can depend on the Lean toolchain, once per toolchain, the fixture built
// by each (VP_TOOLCHAIN, test/fixturecopy.ts), and a table of what passed. Exits 1 if anything
// failed.
//
//   npm run test:toolchains                       the oldest and the newest toolchain, at once
//   npm run test:toolchains -- --all              every toolchain of test/toolchains.json, two at once
//   npm run test:toolchains -- --jobs 4           four at once (each run builds the fixture and runs Lean)
//   npm run test:toolchains -- v4.29.1 v4.34.1    only these
//   node scripts/test-toolchains.mjs --files      the test files it runs, a line each (CI runs them)
//
// Those tests are the files that import test/fixturecopy.ts, themselves or through another module
// of test/ (toolchainTests): the toolchain under test reaches a test there alone. The rest of the
// suite runs no Lean and answers the same on every toolchain, and `npm test` runs it once;
// test/matrix.test.ts keeps both true. The oldest and the newest by default, locally: every
// difference Lean has made so far (test/golden/known-differences.json, the tests that ask
// `leanAtLeast`) shows on one of them, and CI runs every toolchain of the list before a merge
// (.github/workflows/toolchains.yml).
//
// elan installs a toolchain the first time it is asked for one. Each run's output is kept in a log
// under the system's temporary folder, named in the table.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportedToolchains } from "../src/server/doctor.ts";

const REPO = join(import.meta.dirname, "..");

/** The test files whose answers can depend on the toolchain under test, as paths from the
 *  repository, sorted: those that import test/fixturecopy.ts, themselves or through another module of
 *  test/ (an import, a dynamic import, an export from). Read from the sources, so that no list is
 *  kept: a new test that builds the fixture is among them by the import that builds it. */
export function toolchainTests(repo = REPO) {
  const dir = join(repo, "test");
  const local = (f) => [...readFileSync(join(dir, f), "utf8").matchAll(/(?:\bfrom|\bimport\(?)\s*["']\.\/([^"']+)["']/g)].map((m) => m[1]);
  const seen = new Map();
  const reaches = (f) => {
    if (f === "fixturecopy.ts") return true;
    if (!seen.has(f)) {
      // a cycle reaches nothing more through the module already being looked at
      seen.set(f, false);
      let deps = [];
      try {
        deps = local(f);
      } catch {
        // no such module: nothing reached through it
      }
      seen.set(f, deps.some(reaches));
    }
    return seen.get(f);
  };
  return readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts") && reaches(f))
    .sort()
    .map((f) => `test/${f}`);
}

/** The toolchains asked for: those named; every one listed (`all`); else the oldest and the newest,
 *  the range the doctor says is tested (server/doctor.ts). */
export function chosenToolchains(named, all, repo = REPO) {
  if (named.length) return named;
  const listed = JSON.parse(readFileSync(join(repo, "test", "toolchains.json"), "utf8")).toolchains;
  if (all) return listed;
  const { floor, newest } = supportedToolchains();
  return [...new Set([floor, newest])];
}

/** One run of the tests on toolchain `tc`: its counts, the names of the tests that failed, and its
 *  log. */
function run(tc, files, logs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--test", "--import", "./test/setup.ts", ...files], { cwd: REPO, env: { ...process.env, VP_TOOLCHAIN: tc }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("close", (code) => {
      const log = join(logs, `${tc}.log`);
      writeFileSync(log, out);
      const count = (k) => Number(new RegExp(`^ℹ ${k} (\\d+)$`, "m").exec(out)?.[1] ?? 0);
      // the failing tests are listed again after "✖ failing tests:", each on a line of its own
      const tail = out.slice(out.indexOf("✖ failing tests:") + 1);
      const failed = [...new Set([...tail.matchAll(/^✖ (.+?) \(\d[\d.]*m?s\)/gm)].map((m) => m[1]))];
      resolve({ tc, code, pass: count("pass"), fail: count("fail"), skip: count("skipped"), todo: count("todo"), failed, s: Math.round((Date.now() - started) / 1000), log });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let jobs = 2;
  let all = false;
  const named = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--jobs") jobs = Math.max(1, Number(args[++i]) || 1);
    else if (args[i] === "--all") all = true;
    else if (args[i] === "--files") return void console.log(toolchainTests().join("\n"));
    else named.push(args[i]);
  }
  const files = toolchainTests();
  const toolchains = chosenToolchains(named, all);
  const logs = mkdtempSync(join(tmpdir(), "visualproof-toolchains-"));
  process.stderr.write(`${files.length} test files on ${toolchains.length} toolchain${toolchains.length === 1 ? "" : "s"} (${toolchains.join(", ")})${all || named.length ? "" : "; --all for every one"}\n`);
  const started = Date.now();
  const results = [];
  const queue = [...toolchains];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (queue.length) {
        const tc = queue.shift();
        process.stderr.write(`${tc}: running\n`);
        const r = await run(tc, files, logs);
        process.stderr.write(`${tc}: ${r.fail || r.code ? "FAILED" : "passed"} in ${r.s} s\n`);
        results.push(r);
      }
    }),
  );

  results.sort((a, b) => toolchains.indexOf(a.tc) - toolchains.indexOf(b.tc));
  const ok = (r) => r.fail === 0 && r.code === 0;
  console.log("");
  console.log("| toolchain | result | pass | fail | skipped | todo | time |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of results) console.log(`| ${r.tc} | ${ok(r) ? "ok" : "FAILED"} | ${r.pass} | ${r.fail} | ${r.skip} | ${r.todo} | ${r.s} s |`);
  for (const r of results.filter((x) => !ok(x))) {
    console.log(`\n${r.tc} (log: ${r.log}):`);
    for (const f of r.failed) console.log(`  ✖ ${f}`);
    if (!r.failed.length) console.log(`  the run exited with ${r.code}`);
  }
  console.log(`\n${files.length} test files: ${files.map((f) => f.replace(/^test\/|\.test\.ts$/g, "")).join(", ")}`);
  console.log(`in all ${Math.round((Date.now() - started) / 1000)} s; logs: ${logs}`);
  process.exit(results.every(ok) ? 0 : 1);
}

if (import.meta.main) await main();
