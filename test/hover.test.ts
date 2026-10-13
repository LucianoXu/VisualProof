// Hover in the source window: Lean's own language server, asked from outside the project so that
// it reads the build and never writes one (server/hover.ts). The Lean part needs lake.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderHover } from "../src/web/src/highlight.ts";
import { isDeclName, LeanHover } from "../src/server/hover.ts";
import { openProject } from "../src/server/project.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { copyFixture } from "./fixturecopy.ts";

test("only names are written into Lean source", () => {
  for (const ok of ["Nat.le_add_right", "Fixture.Point.size", "Foo.«bar baz»", "x₁'", "Prod.fst", "_private.Foo.0.bar"]) assert.ok(isDeclName(ok), ok);
  for (const bad of ["a b", "x\n#eval 1", "Foo.", ".Foo", "a(b)", "«open»\n", "a.«b» c", ""]) assert.ok(!isDeclName(bad), JSON.stringify(bad));
});

test("Lean's hover text: code highlighted, rules, the doc after", () => {
  const html = renderHover("```lean\nFoo.bar (n : Nat) : Nat\n```\n***\nThe *bar* of `n`.", (w) => (w === "Nat" ? "Nat" : null));
  assert.ok(html.startsWith('<pre class="code">'), html);
  assert.ok(html.includes('data-ref="Nat"'), "names in the type are links");
  assert.ok(html.includes("<hr>"));
  assert.ok(html.includes("<em>bar</em>") && html.includes("<code>n</code>"));
});

test("Lean's output is read a frame at a time: what cannot be read is skipped, a crashed worker's file opened again, one that keeps crashing given up on for a while", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-hover-frames-"));
  try {
    const hover = new LeanHover({ root: dir, name: "x", toolchain: "", roots: [], libDir: "", files: new Map() }, dir);
    const inner = hover as unknown as { read(d: Buffer): void; starting: Promise<void> | null; waiting: Map<number, (m: unknown) => void> };
    // no Lean here: what it would say is handed to the reader below
    inner.starting = Promise.resolve();
    const frame = (o: unknown) => {
      const s = typeof o === "string" ? o : JSON.stringify(o);
      return Buffer.from(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
    };
    let answered: unknown = null;
    inner.waiting.set(7, (m) => (answered = m));
    // not JSON, a header with no length, frames not shaped as Lean shapes them: skipped, never thrown
    const garbage = Buffer.concat([frame("{not json"), Buffer.from("X-Other: 1\r\n\r\n"), frame({ method: "$/lean/fileProgress" }), frame({ method: "$/lean/fileProgress", params: { textDocument: { uri: 5 }, processing: "x" } }), frame({ method: "textDocument/publishDiagnostics", params: null }), frame(null)]);
    assert.doesNotThrow(() => inner.read(garbage));
    // and what comes after is read, even split across reads
    const answer = frame({ jsonrpc: "2.0", id: 7, result: "ok" });
    inner.read(answer.subarray(0, 10));
    inner.read(answer.subarray(10));
    assert.deepEqual(answered, { jsonrpc: "2.0", id: 7, result: "ok" });
    // a file Lean has open, whose worker crashes: opened again, as a new version, twice
    const text = "def x := 1\n";
    const doc = await hover.open("A.lean", text, "h1");
    const fatal = (version: number) => frame({ method: "$/lean/fileProgress", params: { textDocument: { uri: doc.uri, version }, processing: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, kind: 2 }] } });
    inner.read(fatal(1));
    assert.deepEqual([hover.state().restarts, hover.state().files[0].version], [1, 2]);
    inner.read(fatal(1));
    assert.equal(hover.state().restarts, 1, "said again of the version before: that worker is replaced already");
    inner.read(fatal(2));
    assert.deepEqual([hover.state().restarts, hover.state().files[0].version], [2, 3]);
    // a third time in a row: given up on for a while, and what is asked about it is told why
    inner.read(fatal(3));
    assert.deepEqual(hover.state().files, []);
    assert.equal(hover.state().givenUp.length, 1);
    const r = await hover.hover("A.lean", text, "h1", 0, 0, 100);
    assert.match(r.error ?? "", /crashed 3 times in a row/);
    // a question Lean is not there to answer is answered so, at once
    assert.deepEqual(await (hover as unknown as { request(m: string, p: unknown): Promise<unknown> }).request("textDocument/hover", {}), { error: { message: "Lean is not running" } });
    hover.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

let haveLake = true;
try {
  execFileSync("lake", ["--version"], { stdio: "ignore" });
} catch {
  haveLake = false;
}

/** Every file under `dir` with its modification time. */
function listing(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return out;
}

test("hover asks Lean, reads the build, and writes nothing into the project", { skip: !haveLake && "no lake" }, async () => {
  const dir = copyFixture("vp-hover-");
  const state = mkdtempSync(join(tmpdir(), "vp-hover-state-"));
  // stopped however the test ends: a Lean server left running holds the test process open
  let started: LeanHover | null = null;
  try {
    execFileSync("lake", ["build"], { cwd: dir, stdio: "ignore" });
    const before = listing(join(dir, ".lake"));
    const p = openProject(dir, [], true);
    const hover = new LeanHover(p, state);
    started = hover;
    const rel = "Fixture/Basic.lean";
    const text = readFileSync(join(dir, rel), "utf8");
    const lines = text.split("\n");
    const line = lines.findIndex((l) => l.startsWith("theorem size_le"));
    const at = (word: string, from = 0) => lines[line].indexOf(word, from) + 1;
    // asked two things at once while it starts: Lean answers both (a request before the handshake
    // ends once made Lean's server exit)
    const [, first] = await Promise.all([hover.open(rel, text, lakeTextHash(text)), hover.names(rel, text, lakeTextHash(text), [[line, 0]], 60000)]);
    assert.ok(!first.error, JSON.stringify(first));
    // a name used in the statement: its full name and type
    let a = await hover.hover(rel, text, lakeTextHash(text), line, at("p.size") + 2, 60000);
    for (let k = 0; a.pending && k < 20; k++) a = await hover.hover(rel, text, lakeTextHash(text), line, at("p.size") + 2, 60000);
    assert.ok(a.contents?.includes("Fixture.Point.size"), JSON.stringify(a));
    // a bound variable: its type
    const b = await hover.hover(rel, text, lakeTextHash(text), line, at("(p") , 60000);
    assert.ok(/p : (Fixture\.)?Point/.test(b.contents ?? ""), JSON.stringify(b));
    // every name at once: a variable, a field by dot notation, a type, a lemma
    const size = lines[line].indexOf("p.size");
    const names = await hover.names(rel, text, lakeTextHash(text), [[line, size], [line, size + 2], [line, lines[line].indexOf("Point")], [line, lines[line].indexOf("Nat.le")]], 60000);
    assert.deepEqual(names.heads, ["p", "Fixture.Point.size", "Fixture.Point", "Nat.le_add_right"], JSON.stringify(names));
    // a declaration by name, as a name in a hover card asks: in a scratch file of our own
    let d = await hover.describe("Fixture.Basic", "Fixture.Point.size", 60000);
    for (let k = 0; d.pending && k < 20; k++) d = await hover.describe("Fixture.Basic", "Fixture.Point.size", 60000);
    assert.ok(d.contents?.includes("Fixture.Point.size") && d.contents.includes("Taxicab size"), JSON.stringify(d));
    // another name: the scratch file changes, and Lean is asked once it has checked it again
    const e = await hover.describe("Fixture.Basic", "Fixture.Point", 60000);
    assert.ok(e.contents?.includes("A point in the plane"), JSON.stringify(e));
    assert.ok((await hover.describe("Fixture.Basic", "x\n#eval 1", 1000)).error, "anything but a name is refused");
    // a name Lean does not know: no contents (the hover there would explain `@`), and why
    const unknown = await hover.describe("Fixture.Basic", "Fixture.nope", 60000);
    assert.equal(unknown.contents, null, JSON.stringify(unknown));
    assert.match(unknown.refused ?? "", /[Uu]nknown/);
    // a name the graph folds into its owner, here a constructor, is a name Lean knows
    const mk = await hover.describe("Fixture.Basic", "Fixture.Point.mk", 60000);
    assert.ok(mk.contents?.includes("Fixture.Point.mk"), JSON.stringify(mk));
    // what #print shows, read from Lean's messages: a structure's fields and constructor; a
    // theorem's statement with its proof left out, unless asked for
    const point = await hover.print("Fixture.Basic", "Fixture.Point", false, 60000);
    assert.match(point.messages?.[0].text ?? "", /fields:[\s\S]*Fixture\.Point\.x : Nat[\s\S]*constructor:/, JSON.stringify(point));
    const thm = await hover.print("Fixture.Basic", "Fixture.size_le", false, 60000);
    assert.deepEqual(thm.messages, [{ severity: "information", text: "theorem Fixture.size_le : ∀ (p : Fixture.Point), p.x ≤ p.size :=\n⋯" }]);
    const proof = await hover.print("Fixture.Basic", "Fixture.size_le", true, 60000);
    assert.match(proof.messages?.[0].text ?? "", /Nat\.le_add_right/);
    // describing and printing take turns in the one scratch file
    const [again, sized] = await Promise.all([hover.describe("Fixture.Basic", "Fixture.Point.size", 60000), hover.print("Fixture.Basic", "Fixture.Point.size", false, 60000)]);
    assert.ok(again.contents?.includes("Taxicab size"), JSON.stringify(again));
    assert.match(sized.messages?.[0].text ?? "", /^def Fixture\.Point\.size : Fixture\.Point → Nat :=\nfun p => p\.x \+ p\.y$/);
    const nope = await hover.print("Fixture.Basic", "Fixture.nope", false, 60000);
    assert.deepEqual(nope.messages?.map((m) => m.severity), ["error"]);
    assert.match(nope.messages?.[0].text ?? "", /[Uu]nknown constant/);
    assert.ok((await hover.print("Fixture.Basic", "x\n#eval 1", false, 1000)).error, "anything but a name is refused");
    // a worker that dies (the kernel's OOM killer picks the largest process): Lean says the file's
    // progress is a fatal error and would start no other until the file changes; the file is opened
    // again and what is asked is answered, not left pending
    const workers = () => execFileSync("ps", ["-o", "pid=,args=", "--ppid", String((hover as unknown as { proc: { pid: number } }).proc.pid)], { encoding: "utf8" }).split("\n").filter((l) => l.trim());
    const worker = (file: string) => Number(workers().find((l) => l.includes(file))!.trim().split(/\s+/)[0]);
    const restarted = async (n: number) => {
      // a loaded machine (a CI runner, several suites at once) restarts slowly: up to a minute
      for (let k = 0; hover.state().restarts < n && k < 2400; k++) await new Promise((ok) => setTimeout(ok, 25));
      assert.equal(hover.state().restarts, n);
    };
    process.kill(worker("Fixture/Basic.lean"), "SIGKILL");
    await restarted(1);
    assert.equal(hover.state().files.find((f) => f.file === rel)?.version, 2, "opened again, as a new version");
    const inPoint = lines[line].indexOf("Point") + 1;
    // the file opened again may answer nothing while its new worker starts, on a loaded machine:
    // asked again after a moment, for up to a minute as the restart is waited for
    let c = await hover.hover(rel, text, lakeTextHash(text), line, inPoint, 60000);
    for (let k = 0; (c.pending || c.error || c.contents == null) && k < 240; k++) {
      await new Promise((ok) => setTimeout(ok, 250));
      c = await hover.hover(rel, text, lakeTextHash(text), line, inPoint, 60000);
    }
    assert.ok(c.contents?.includes("Fixture.Point"), JSON.stringify(c));
    // the scratch file's worker too: describe and print go on
    process.kill(worker("Describe.lean"), "SIGKILL");
    await restarted(2);
    const printed = await hover.print("Fixture.Basic", "Fixture.Point.size", false, 60000);
    assert.match(printed.messages?.[0].text ?? "", /^def Fixture\.Point\.size/, JSON.stringify(printed));
    assert.equal(hover.state().state, "running");
    hover.stop();
    // nothing under .lake was written or touched
    const afterwards = listing(join(dir, ".lake"));
    assert.deepEqual([...afterwards.keys()].sort(), [...before.keys()].sort(), "files appeared or vanished under .lake");
    for (const [f, t] of before) assert.equal(afterwards.get(f), t, `${f} was written`);
  } finally {
    started?.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
