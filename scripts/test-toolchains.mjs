#!/usr/bin/env node
// The whole suite once per Lean toolchain of test/toolchains.json, the fixture built by each
// (VP_TOOLCHAIN, test/fixturecopy.ts), and a table of what passed. Exits 1 if anything failed.
//
//   npm run test:toolchains                       every toolchain, two suites at once
//   npm run test:toolchains -- --jobs 4           four at once (each suite runs Lean of its own)
//   npm run test:toolchains -- v4.28.0 v4.35.0    only these
//
// elan installs a toolchain the first time it is asked for one. Each suite's output is kept in a
// log under the system's temporary folder, named in the table.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
let jobs = 2;
const asked = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--jobs") jobs = Math.max(1, Number(args[++i]) || 1);
  else asked.push(args[i]);
}
const listed = JSON.parse(readFileSync(join(repo, "test", "toolchains.json"), "utf8")).toolchains;
const toolchains = asked.length ? asked : listed;
const logs = mkdtempSync(join(tmpdir(), "visualproof-toolchains-"));

/** One run of the suite: its counts, the names of the tests that failed, and its log. */
function run(tc) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--test", "--import", "./test/setup.ts", "test/*.test.ts"], { cwd: repo, env: { ...process.env, VP_TOOLCHAIN: tc }, stdio: ["ignore", "pipe", "pipe"] });
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
      resolve({ tc, code, pass: count("pass"), fail: count("fail"), todo: count("todo"), failed, s: Math.round((Date.now() - started) / 1000), log });
    });
  });
}

const results = [];
const queue = [...toolchains];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const tc = queue.shift();
      process.stderr.write(`${tc}: running\n`);
      const r = await run(tc);
      process.stderr.write(`${tc}: ${r.fail || r.code ? "FAILED" : "passed"} in ${r.s} s\n`);
      results.push(r);
    }
  }),
);

results.sort((a, b) => toolchains.indexOf(a.tc) - toolchains.indexOf(b.tc));
const ok = (r) => r.fail === 0 && r.code === 0;
console.log("");
console.log("| toolchain | result | pass | fail | todo | time |");
console.log("|---|---|---|---|---|---|");
for (const r of results) console.log(`| ${r.tc} | ${ok(r) ? "ok" : "FAILED"} | ${r.pass} | ${r.fail} | ${r.todo} | ${r.s} s |`);
for (const r of results.filter((x) => !ok(x))) {
  console.log(`\n${r.tc} (log: ${r.log}):`);
  for (const f of r.failed) console.log(`  ✖ ${f}`);
  if (!r.failed.length) console.log(`  the suite exited with ${r.code}`);
}
console.log(`\nlogs: ${logs}`);
process.exit(results.every(ok) ? 0 : 1);
