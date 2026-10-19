// `visualproof serve <git URL>` as the command meets it (server/main.ts, SPEC/DeploySpec.md): the
// command line checked before anything runs, a clone that cannot be made said and ended (not the
// code's fault), and a server that clones, builds with a Lake of the test's own, says so in its
// first lines and in GET /api/status, and stops with its build's state kept.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const MAIN = join(import.meta.dirname, "..", "src", "server", "main.ts");
const ROOT = mkdtempSync(join(tmpdir(), "vp-deployserve-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const G = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: G });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const serve = (...args: string[]) => spawnSync(process.execPath, [MAIN, "serve", ...args], { encoding: "utf8", env: { ...process.env, VISUALPROOF_UPDATES: "off" }, timeout: 60_000 });

test("the command line: what is refused before anything runs", () => {
  for (const [args, said] of [
    [["http://github.com/A/B"], /https/],
    [["https://token@github.com/A/B"], /no user name, password or token/],
    [["git://github.com/A/B"], /not followed/],
    [["https://github.com/A/B", "--branch", "a..b"], /not a branch name/],
    [["https://github.com/A/B", "--poll", "0"], /--poll 0: say how often/],
    [["https://github.com/A/B", "--graph", "g.json"], /--graph does not go with a git address/],
    [[ROOT, "--branch", "main"], /--branch and --poll go with a git address/],
  ] as [string[], RegExp][]) {
    const r = serve(...args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, said, args.join(" "));
  }
  const ex = spawnSync(process.execPath, [MAIN, "export", "https://github.com/A/B", "-o", join(ROOT, "x.html")], { encoding: "utf8", timeout: 30_000 });
  assert.equal(ex.status, 2);
  assert.match(ex.stderr, /only serve follows a branch/);
});

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

test("a server that follows a branch: it clones, builds, says so, and keeps its state through a stop", async () => {
  const bare = join(ROOT, "remote.git");
  const work = join(ROOT, "work");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: G });
  spawnSync("git", ["init", "-q", "-b", "main", work], { env: G });
  writeFileSync(join(work, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  writeFileSync(join(work, "lakefile.toml"), 'name = "m"\ndefaultTargets = ["M"]\n\n[[lean_lib]]\nname = "M"\n');
  writeFileSync(join(work, "M.lean"), "def x := 1\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "m");
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "origin", "main");
  const head = git(work, "rev-parse", "HEAD");
  // a branch the remote has not: said, and ended with 1 (not the code's fault)
  const none = serve(`file://${bare}`, "--branch", "dev", "--site", join(ROOT, "site0"), "--cache", join(ROOT, "cache0"), "--port", String(await freePort()));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /cannot clone .*\(dev\): couldn't find remote ref refs\/heads\/dev/);
  // a Lake of the test's own, on the PATH: its builds succeed
  const bin = join(ROOT, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "lake"), `#!/bin/sh\nif [ "$1" = "build" ]; then mkdir -p .lake/build/lib/lean; date +%s%N > .lake/build/lib/lean/M.olean; echo "✔ [1/1] Built M"; exit 0; fi\nexit 1\n`);
  chmodSync(join(bin, "lake"), 0o755);
  const port = await freePort();
  const cache = join(ROOT, "cache");
  const p = spawn(process.execPath, [MAIN, "serve", `file://${bare}`, "--site", join(ROOT, "site"), "--cache", cache, "--port", String(port), "--jobs", "0"], { env: { ...process.env, VISUALPROOF_UPDATES: "off", PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (b: Buffer) => (out += b));
  p.stderr.on("data", (b: Buffer) => (out += b));
  const until = async (f: () => boolean | Promise<boolean>, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((ok) => setTimeout(ok, 100))) if (await f()) return;
    assert.fail(`waited in vain:\n${out}`);
  };
  const status = async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()) as { deploy?: { built: string | null; branch: string; last?: { ok: boolean } } };
    } catch {
      return null;
    }
  };
  await until(async () => (await status())?.deploy?.built === head);
  assert.match(out, /cloning file:\/\/.* \(main\) into /);
  assert.match(out, /following: main of file:\/\//);
  assert.match(out, /builds: none yet: the first, of [0-9a-f]{7}, starts now/);
  assert.match(out, new RegExp(`build: ${head.slice(0, 7)} built in`));
  assert.equal((await status())?.deploy?.last?.ok, true);
  // the default branch, asked and remembered
  assert.equal(JSON.parse(readFileSync(join(cache, "deploy", "remotes.json"), "utf8"))[`file://${bare}`].branch, "main");
  p.kill("SIGTERM");
  const code = await new Promise<number | null>((ok) => p.on("exit", ok));
  assert.equal(code, 0);
  const [dir] = readdirSync(join(cache, "deploy")).filter((f) => f !== "remotes.json");
  const state = JSON.parse(readFileSync(join(cache, "deploy", dir, "state.json"), "utf8"));
  assert.equal(state.outputs.commit, head);
  assert.equal(state.building, null);
  assert.equal(existsSync(join(cache, "deploy", dir, ".lock")), false);
});
