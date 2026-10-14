// A live server on a small project, serving on a free port, as the tests of the server meet it
// (test/server.test.ts, test/agentshare.test.ts); and an event stream read as it comes.

import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { App } from "../src/server/main.ts";
import { Access } from "../src/server/access.ts";
import { Exporter } from "../src/server/export.ts";
import { AgentApi } from "../src/server/agent.ts";
import type { AgentLevel } from "../src/server/agent.ts";
import { LeanHover } from "../src/server/hover.ts";
import { Identities } from "../src/server/identity.ts";
import { Live } from "../src/server/live.ts";
import { openProject } from "../src/server/project.ts";
import { ReviewStore } from "../src/server/review.ts";
import { lakeTextHash } from "../src/server/status.ts";
import { testDirs } from "./tmpdirs.ts";
import type { ClusterMode, Layout, ViewMeta, ViewNode } from "../src/shared/graph.ts";
import { LAYOUT_VERSION, SITE_STMT } from "../src/shared/graph.ts";
import { computeLayout } from "../src/shared/layout.ts";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SOURCE = "namespace N\ndef a : Nat := 0\ndef b : Nat := a\nend N\n";

/** A project whose graph has one module, M, beside two files that are no module of it (an old
 *  copy, a CI script); a live server on it, with a graph of its own, serving on a free port. */
export async function site(opts: { key?: string; exporter?: boolean; agents?: AgentLevel; publicUrl?: string; publicRead?: boolean; identityHeader?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vp-server-"));
  writeFileSync(join(dir, "lean-toolchain"), "leanprover/lean4:v4.33.1\n");
  writeFileSync(join(dir, "M.lean"), SOURCE);
  mkdirSync(join(dir, "_attic"));
  writeFileSync(join(dir, "_attic", "Old.lean"), "#eval IO.println \"an old copy\"\n");
  mkdirSync(join(dir, "ci"));
  writeFileSync(join(dir, "ci", "Axioms.lean"), "import M\n#print axioms N.b\n");
  const project = openProject(dir, ["M"], false);
  const nodes: ViewNode[] = [
    { name: "N.a", kind: "def", module: "M", ax: 0, hash: "ha" },
    { name: "N.b", kind: "def", module: "M", ax: 0, hash: "hb" },
    { name: "Nat", kind: "inductive", module: "Init.Prelude", ax: 0, ext: true },
  ];
  const edges = new Int32Array([1, 0, SITE_STMT, 0, 2, SITE_STMT]);
  const meta: ViewMeta = {
    schema: 1,
    layoutVersion: LAYOUT_VERSION,
    project: { name: "fixture", root: dir, roots: ["M"], toolchain: "tc", extractedAt: "", extractMs: 1 },
    modules: [{ name: "M", file: "M.lean", imports: [], compiled: lakeTextHash(SOURCE) }],
    nodes,
    projectCount: 2,
    axioms: [],
    axiomSets: [[]],
    layouts: { namespace: computeLayout("namespace", nodes, edges), module: computeLayout("module", nodes, edges) } as Record<ClusterMode, Layout>,
    edgeCount: 2,
  };
  const state = join(dir, "state");
  mkdirSync(state);
  const dirs = testDirs(state);
  const live = new Live(project, dirs, null, new ReviewStore(dir, join(dir, "review")));
  live.graph = { version: 1, fingerprint: "f", at: "", missing: [], prep: { fingerprint: "f", cached: true, metaGz: gzipSync(JSON.stringify(meta)), edgesGz: gzipSync(Buffer.from(edges.buffer)) } };
  const hover = new LeanHover(project, dirs.cache);
  const app = new App(live, hover, new Identities(opts.identityHeader ?? null), new AgentApi(live, hover, opts.agents ?? "full"), opts.key ? new Access(opts.key) : null, opts.exporter ? new Exporter(dirs.cache) : null, opts.publicUrl ?? null, opts.publicRead ?? false);
  const server: Server = createServer((req, res) => app.handle(req, res));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ask = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await r.text();
    let json: Json | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON: the test says so
    }
    return { status: r.status, json, headers: r.headers };
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
    hover.stop();
    live.tokens.close();
    live.invites.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, live, hover, app, base, port: (server.address() as AddressInfo).port, ask, close };
}

/** An event stream, read as it comes. */
export function stream(port: number, path: string, headers: Record<string, string> = {}) {
  const events: { event: string; data: Json }[] = [];
  let res: IncomingMessage | null = null;
  const opened = new Promise<number>((ok) => {
    const req = get({ host: "127.0.0.1", port, path, headers }, (r) => {
      res = r;
      let buf = "";
      r.setEncoding("utf8");
      r.on("data", (d: string) => {
        buf += d;
        for (let k = buf.indexOf("\n\n"); k >= 0; k = buf.indexOf("\n\n")) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) events.push({ event, data: data ? JSON.parse(data) : null });
        }
      });
      ok(r.statusCode ?? 0);
    });
    req.on("error", () => ok(0));
  });
  const until = async (f: () => boolean, ms = 3000) => {
    for (const end = Date.now() + ms; !f() && Date.now() < end; ) await new Promise((ok) => setTimeout(ok, 10));
    assert.ok(f(), "waited in vain");
  };
  const last = (event: string) => [...events].reverse().find((e) => e.event === event)?.data;
  return { events, opened, until, last, close: () => (res as IncomingMessage | null)?.destroy() };
}

