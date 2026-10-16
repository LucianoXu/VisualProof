// Makes the showcase's site (site/) by playing the story (story.ts) against a real VisualProof
// server run from this checkout, one build of flt-regular after another (project.json), on the
// story's clock (fakeclock.mjs). Everything in the site is the server's own record of what the
// story's people and agent did through its API: their opinions, targets, trusted list, key marks,
// notes, views, the library's files and links, the history of the three builds and the timeline.
//
//   node showcase/flt-regular/generate.ts <builds> [--out showcase/flt-regular/site]
//                                         [--scratch <dir>] [--port 4297]
//
// <builds> holds a built checkout of flt-regular at each of the builds, named by its short commit
// (`setup.sh <builds> --all` makes them). The server writes its site and cache under --scratch (a
// fresh temporary folder by default), never into a checkout; the site is then copied to --out,
// leaving out what is the running server's alone. The documents (documents/*.tex) are typeset with
// XeLaTeX first. Each build's `.olean` files are dated when the story says it was built, which is
// what the history takes for its time (server/history.ts, buildTime).
//
// The ids the server makes (views, notes, links) are random, so two runs make the same story, not
// the same bytes.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { quoteOpinion } from "../../src/shared/comment.ts";
import { story } from "./story.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

/** project.json: where flt-regular is, and the builds the story reads, in order */
export interface ShowcaseProject {
  repository: string;
  builds: { commit: string; toolchain: string; builtAt: string; subject: string }[];
  served: string;
}

/** An opinion as the server recorded it: enough to quote it. */
export interface Said {
  name: string;
  by: string;
  at: string;
  comment?: string;
  agent?: boolean;
}

/** a clip or a whole file of the library a note carries */
export interface Carry {
  file: string;
  page?: number;
  region?: [number, number, number, number];
}

export interface Person {
  opinion(name: string, verdict: "approve" | "comment", comment?: string, o?: { for?: string }): Promise<Said>;
  target(name: string, on?: boolean): Promise<void>;
  trust(prefix: string, on: boolean): Promise<void>;
  key(target: string, name: string, on?: boolean): Promise<void>;
  /** a document of documents/, typeset, added to the library under `title`: its hash */
  upload(doc: string, title: string): Promise<string>;
  link(subject: string, file: string, place: { page: number; quote?: string; label?: string }): Promise<void>;
  /** a note of the project, attached to `decl` or on the ring: its id */
  note(text: string, o?: { decl?: string; carries?: Carry[]; open?: boolean }): Promise<string>;
  /** a kept, named view: its id */
  view(name: string, scope: string, o?: { clustering?: "namespace" | "module"; version?: number }): Promise<string>;
  linkView(view: string, target: string): Promise<void>;
}

export interface Agent {
  advise(name: string, verdict: "approve" | "comment", comment: string): Promise<Said>;
  /** POST /api/agent/note, as docs/agent-api/notes.md says: its id */
  note(text: string, o: Record<string, unknown>): Promise<string>;
  link(subject: string, file: string, place: { page: number; quote?: string; label?: string }): Promise<void>;
  view(name: string, scope: string, o?: { clustering?: "namespace" | "module" }): Promise<string>;
  arrange(view: string, o: Record<string, unknown>): Promise<void>;
  /** notes of the project a view is to show, or not (POST /api/agent/views/items) */
  items(view: string, o: { add?: string[]; remove?: string[] }): Promise<void>;
  /** a view's clusters as laid out (GET /api/agent/views/view): a top-level one's place is the
   *  board's, a nested one's its parent's */
  board(view: string): Promise<{ key: string; parent: string | null; at: [number, number]; r: number }[]>;
}

export interface Stage {
  /** stop the server on the build before, and start one on build `i` of project.json at `when` */
  build(i: number, when: string): Promise<void>;
  /** the story's time from now on: "YYYY-MM-DD HH:MM", the reviewers' local time (CEST) */
  at(when: string): Promise<void>;
  person(name: string): Person;
  agent(name: string): Agent;
  /** a quote of an opinion, as the page's Quote writes it */
  quote(name: string, said: Said): string;
  /** the history's snapshot of build `i` */
  snapshot(i: number): number;
}

/** what a site keeps that lets someone in or speaks for them (server/tokens.ts, invites.ts,
 *  readonly.ts, talk.ts): never in a showcase */
export const SECRETS = ["agent-tokens.json", "person-invites.json", "readonly-links.json", "chat"];

/** "2026-09-07 09:10", CEST, as an ISO time. The story runs between September and the 25th of
 *  October, when summer time ends. */
function storyTime(when: string): string {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/.exec(when);
  if (!m) throw new Error(`a story time is "YYYY-MM-DD HH:MM": ${when}`);
  return new Date(`${m[1]}T${m[2]}:00+02:00`).toISOString();
}

function args(): { builds: string; out: string; scratch: string; port: number } {
  const a = process.argv.slice(2);
  const opt = (k: string) => {
    const i = a.indexOf(k);
    if (i < 0) return undefined;
    const v = a[i + 1];
    a.splice(i, 2);
    return v;
  };
  const out = opt("--out") ?? join(HERE, "site");
  const scratch = opt("--scratch") ?? mkdtempSync(join(tmpdir(), "visualproof-showcase-"));
  const port = Number(opt("--port") ?? 4297);
  if (a.length !== 1) {
    console.error("usage: node showcase/flt-regular/generate.ts <builds> [--out dir] [--scratch dir] [--port 4297]");
    process.exit(2);
  }
  return { builds: resolve(a[0]), out: resolve(out), scratch: resolve(scratch), port };
}

/** Date every `.olean` of the project's own build (not its packages') at `iso`. */
function dateBuild(root: string, iso: string): void {
  const t = new Date(iso);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".olean")) utimesSync(f, t, t);
    }
  };
  walk(join(root, ".lake", "build", "lib", "lean"));
}

/** documents/*.tex typeset into `dir`: each document's PDF by its name. */
function typeset(dir: string): Map<string, string> {
  mkdirSync(dir, { recursive: true });
  const docs = new Map<string, string>();
  for (const f of readdirSync(join(HERE, "documents"))) {
    if (!f.endsWith(".tex") || f === "preamble.tex") continue;
    const name = f.slice(0, -4);
    const r = spawnSync("xelatex", ["-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, f], { cwd: join(HERE, "documents"), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`xelatex ${f} failed:\n${(r.stdout ?? "").slice(-2000)}`);
    docs.set(name, join(dir, `${name}.pdf`));
  }
  return docs;
}

class Server {
  child: ChildProcess | null = null;
  readonly port: number;
  readonly site: string;
  readonly cache: string;
  readonly clock: string;
  readonly log: string;
  constructor(port: number, site: string, cache: string, clock: string, log: string) {
    this.port = port;
    this.site = site;
    this.cache = cache;
    this.clock = clock;
    this.log = log;
  }

  /** Serve `root` and wait for its graph with notation and contexts (the usage pass's), which the
   *  text an opinion records is read with. */
  async start(root: string): Promise<void> {
    const elan = join(homedir(), ".elan", "bin");
    const env = { ...process.env, VP_FAKE_CLOCK: this.clock, PATH: existsSync(elan) ? `${elan}:${process.env.PATH}` : process.env.PATH };
    const argv = ["--import", join(HERE, "fakeclock.mjs"), join(REPO, "src", "server", "main.ts"), "serve", root, "--site", this.site, "--cache", this.cache, "--host", "127.0.0.1", "--port", String(this.port)];
    const child = spawn(process.execPath, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    let out = "";
    await new Promise<void>((ok, fail) => {
      const read = (b: Buffer) => {
        const s = b.toString();
        out += s;
        writeFileSync(this.log, s, { flag: "a" });
        if (/graph v\d+ ready(?!;)/.test(out)) ok();
      };
      child.stdout!.on("data", read);
      child.stderr!.on("data", read);
      child.on("exit", (code) => fail(new Error(`the server stopped (${code}) before its graph was ready; see ${this.log}`)));
    });
  }

  async stop(): Promise<void> {
    const c = this.child;
    if (!c || c.exitCode !== null) return;
    const gone = new Promise((ok) => c.on("exit", ok));
    c.kill("SIGTERM");
    await gone;
    this.child = null;
  }
}

async function main(): Promise<void> {
  const o = args();
  const project = JSON.parse(readFileSync(join(HERE, "project.json"), "utf8")) as ShowcaseProject;
  const site = join(o.scratch, "site");
  if (existsSync(site)) throw new Error(`${site} exists: a story is played on a new site`);
  mkdirSync(o.scratch, { recursive: true });
  const clock = join(o.scratch, "clock");
  const server = new Server(o.port, site, join(o.scratch, "cache"), clock, join(o.scratch, "server.log"));
  const base = `http://127.0.0.1:${o.port}`;
  const docs = typeset(join(o.scratch, "documents"));
  const snapshots: number[] = [];
  console.log(`scratch: ${o.scratch}`);

  type Who = { name: string; agent: boolean };
  const call = async (who: Who, method: string, path: string, body?: unknown, bytes?: Buffer): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { "x-visualproof-name": encodeURIComponent(who.name) };
    if (who.agent) headers["x-visualproof-kind"] = "agent";
    if (bytes) headers["content-type"] = "application/octet-stream";
    else if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base + path, { method, headers, body: bytes ? new Uint8Array(bytes) : body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      j = { error: text };
    }
    if (!r.ok || typeof j.error === "string") throw new Error(`${who.name}: ${method} ${path} ${JSON.stringify(body ?? "").slice(0, 200)} → ${r.status} ${text.slice(0, 600)}`);
    return j;
  };
  const review = async (who: Who, op: Record<string, unknown>) => call(who, "POST", "/api/review", op);
  const said = (j: Record<string, unknown>): Said => {
    const e = j.event as Said & { name: string };
    return { name: e.name, by: e.by, at: e.at, ...(e.comment ? { comment: e.comment } : {}), ...(e.agent ? { agent: true } : {}) };
  };
  const uploaded = new Map<string, string>();
  let notes = 0;

  const person = (name: string): Person => {
    const who = { name, agent: false };
    return {
      async opinion(decl, verdict, comment, x) {
        return said(await review(who, { op: "opinion", name: decl, verdict, ...(comment ? { comment } : {}), ...(x?.for ? { for: x.for } : {}) }));
      },
      async target(decl, on = true) {
        await review(who, { op: "target", name: decl, on });
      },
      async trust(prefix, on) {
        await review(who, { op: "trust", prefix, on });
      },
      async key(target, decl, on = true) {
        await review(who, { op: "key", target, name: decl, on });
      },
      async upload(doc, title) {
        const file = docs.get(doc);
        if (!file) throw new Error(`no document ${doc} in documents/`);
        const j = await call(who, "POST", `/api/library/upload?name=${encodeURIComponent(`${doc}.pdf`)}&note=0`, undefined, readFileSync(file));
        const sha = (j.file as { sha: string }).sha;
        await call(who, "POST", "/api/library/edit", { sha, title });
        uploaded.set(doc, sha);
        return sha;
      },
      async link(subject, file, place) {
        await call(who, "POST", "/api/library/link", { subject, file, ...place });
      },
      async note(text, x = {}) {
        const note = {
          id: `n${(++notes).toString(36).padStart(8, "0")}`,
          text,
          places: {},
          open: x.open ?? false,
          by: name,
          at: new Date().toISOString(),
          ...(x.decl ? { decl: { name: x.decl, at: [24, -24] } } : {}),
          ...(x.carries ? { carries: x.carries } : {}),
        };
        await call(who, "POST", "/api/views/notes", { ops: [{ op: "pnote", note }] });
        return note.id;
      },
      async view(title, scope, x = {}) {
        const j = await call(who, "POST", "/api/views/create", { name: title, scope, ...(x.clustering ? { clustering: x.clustering } : {}), ...(x.version !== undefined ? { version: x.version } : {}) });
        return (j.view as { id: string }).id;
      },
      async linkView(view, target) {
        await call(who, "POST", "/api/views/link", { id: view, target });
      },
    };
  };

  const agent = (name: string): Agent => {
    const who = { name, agent: true };
    return {
      async advise(decl, verdict, comment) {
        await call(who, "POST", "/api/agent/opinion", { name: decl, verdict, comment });
        // the answer says what was recorded, not when: the declaration's advice does
        const d = await call(who, "GET", `/api/agent/declaration?name=${encodeURIComponent(decl)}`);
        const mine = ((d.review as { advice: { by: string; at: string }[] }).advice ?? []).filter((a) => a.by === name);
        if (!mine.length) throw new Error(`${name}'s advice on ${decl} is not there`);
        return { name: decl, by: name, at: mine[mine.length - 1].at, comment, agent: true };
      },
      async note(text, x) {
        return String((await call(who, "POST", "/api/agent/note", { text, ...x })).id);
      },
      async link(subject, file, place) {
        await call(who, "POST", "/api/agent/link", { subject, file, ...place });
      },
      async view(title, scope, x = {}) {
        const j = await call(who, "POST", "/api/agent/views/create", { name: title, scope, ...x });
        return (j.view as { id: string }).id;
      },
      async arrange(view, x) {
        await call(who, "POST", "/api/agent/views/arrange", { id: view, ...x });
      },
      async items(view, x) {
        await call(who, "POST", "/api/agent/views/items", { id: view, ...x });
      },
      async board(view) {
        const j = await call(who, "GET", `/api/agent/views/view?id=${encodeURIComponent(view)}`);
        return j.clusters as { key: string; parent: string | null; at: [number, number]; r: number }[];
      },
    };
  };

  const at = async (when: string) => {
    writeFileSync(clock, storyTime(when));
    // the server polls the clock's file every 20 ms (fakeclock.mjs)
    await sleep(200);
  };

  const stage: Stage = {
    async build(i, when) {
      const b = project.builds[i];
      const root = join(o.builds, b.commit.slice(0, 7));
      if (!existsSync(join(root, ".lake", "build", "lib", "lean"))) throw new Error(`${root} is not a built checkout of ${b.commit}: run setup.sh ${o.builds} --all`);
      await server.stop();
      dateBuild(root, b.builtAt);
      await at(when);
      console.log(`build ${i + 1}: ${b.commit.slice(0, 7)} (${b.toolchain}), from ${when}`);
      await server.start(root);
      const h = await call({ name: "Showcase", agent: true }, "GET", "/api/agent/history");
      const list = (h.snapshots ?? h.builds) as { id: number; at: string }[];
      const mine = list.find((s) => s.at === new Date(b.builtAt).toISOString());
      if (!mine) throw new Error(`no snapshot of the build of ${b.builtAt}: ${JSON.stringify(list).slice(0, 400)}`);
      snapshots[i] = mine.id;
    },
    at,
    person,
    agent,
    quote: (name, s) => quoteOpinion(name, { by: s.by, at: s.at, comment: s.comment ?? "", ...(s.agent ? { agent: true } : {}) }),
    snapshot: (i) => snapshots[i],
  };

  try {
    await story(stage);
  } finally {
    await server.stop();
  }

  // the site, without the running server's lock; no secret was made for it, and none may be there
  const secrets = SECRETS.filter((f) => existsSync(join(site, f)));
  if (secrets.length) throw new Error(`the site holds secrets: ${secrets.join(", ")}`);
  rmSync(o.out, { recursive: true, force: true });
  cpSync(site, o.out, { recursive: true, filter: (src) => !/[/\\]\.lock$/.test(src) });
  const leaks: string[] = [];
  const look = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) look(f);
      else if (!f.endsWith(".pdf")) {
        const t = (f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString("utf8");
        for (const p of [o.builds, o.scratch, homedir()]) if (t.includes(p)) leaks.push(`${f}: ${p}`);
      }
    }
  };
  look(o.out);
  if (leaks.length) throw new Error(`the site names paths of this machine:\n${leaks.join("\n")}`);
  console.log(`site: ${o.out}`);
}

// played when run, not when imported (the tests read its exports)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
