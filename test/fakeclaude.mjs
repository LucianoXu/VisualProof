#!/usr/bin/env node
// A stand-in for Claude Code's `claude -p` (test/hosted.test.ts), copied into a test's folder and run
// by the server as it runs Claude Code for an agent of its own (server/hosted.ts). It writes what it
// was given — its arguments, its environment, its stdin, its folder — to calls.jsonl beside itself,
// and does what behave.json beside itself says, answering in stream-json as Claude Code does:
//
//   reply     starts the MCP server of --mcp-config as Claude Code would, lists its tools (to
//             tools.json), and answers with its reply tool
//   text      answers with its last words only (no reply tool)
//   send      asks the MCP server's library tool to send `path`, its answer to sent.json
//   refuse    Claude Code refused the OAuth token
//   limit     the usage limit, which resets at `resetsAt` (seconds)
//   slow      takes a minute
//   nosession has no session to resume (a --resume fails as Claude Code's does), then answers

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const here = dirname(process.argv[1]);
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const behave = existsSync(join(here, "behave.json")) ? JSON.parse(readFileSync(join(here, "behave.json"), "utf8")) : { mode: "reply" };
let stdin = "";
for await (const c of process.stdin) stdin += c;
const session = opt("--session-id") ?? opt("--resume");
appendFileSync(join(here, "calls.jsonl"), JSON.stringify({ args, env: process.env, stdin, cwd: process.cwd(), mode: behave.mode }) + "\n");
const out = (e) => process.stdout.write(JSON.stringify(e) + "\n");
const result = (text, more = {}) => out({ type: "result", subtype: "success", is_error: false, result: text, session_id: session, ...more });

/** The MCP server of --mcp-config, run as Claude Code runs it, spoken to over stdio. */
async function mcp(calls) {
  const config = JSON.parse(readFileSync(opt("--mcp-config"), "utf8")).mcpServers.visualproof;
  const p = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  createInterface({ input: p.stdout }).on("line", (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let id = 0;
  const ask = (method, params) =>
    new Promise((ok) => {
      const k = ++id;
      waiting.set(k, ok);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: k, method, params }) + "\n");
    });
  await ask("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fake", version: "1" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await ask("tools/list", {})).result.tools;
  const answers = [];
  for (const [name, a] of calls) answers.push((await ask("tools/call", { name, arguments: a })).result);
  p.stdin.end();
  await new Promise((ok) => p.on("exit", ok));
  return { tools, answers };
}

out({ type: "system", subtype: "init", session_id: session, tools: [] });
switch (behave.mode) {
  case "reply": {
    const text = behave.text ?? "Answered.";
    const r = await mcp([["reply", { text }]]);
    writeFileSync(join(here, "tools.json"), JSON.stringify({ tools: r.tools.map((t) => t.name), answers: r.answers }));
    out({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__visualproof__reply", input: { text } }] } });
    result("Done.");
    break;
  }
  case "text":
    result(behave.text);
    break;
  case "send": {
    const r = await mcp([["library", { action: "add_file", path: behave.path }]]);
    writeFileSync(join(here, "sent.json"), JSON.stringify(r.answers));
    result("");
    break;
  }
  case "refuse":
    out({ type: "system", subtype: "api_retry", attempt: 1, error_status: 401, error: "authentication_failed" });
    out({ type: "result", subtype: "success", is_error: true, api_error_status: 401, result: "Failed to authenticate. API Error: 401 OAuth access token is invalid." });
    process.exit(1);
    break;
  case "limit":
    out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: behave.resetsAt, rateLimitType: "five_hour" } });
    out({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "You've hit your session limit" });
    process.exit(1);
    break;
  case "slow":
    await new Promise((ok) => setTimeout(ok, 60_000));
    result("too late");
    break;
  case "nosession":
    if (opt("--resume")) {
      process.stderr.write(`No conversation found with session ID: ${session}\n`);
      process.exit(1);
    }
    result("A new session.");
    break;
}
