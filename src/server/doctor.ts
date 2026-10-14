// `visualproof doctor [<lean-project>]`: what this machine, and a project, need for VisualProof to
// run, each checked, with what to do where it falls short. It changes nothing: it runs no Lake (in a
// project's folder that would install its toolchain, and Lake may build), and makes no folder.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { projectDirs, siteHolder } from "./dirs.ts";
import { ProjectError, openProject } from "./project.ts";

/** ok; fail: VisualProof cannot run until it is fixed; warn: it runs, without something; info: optional */
export type Level = "ok" | "fail" | "warn" | "info";

export interface Check {
  level: Level;
  what: string;
  /** what to do, where it falls short */
  fix?: string;
}

export interface Report {
  checks: Check[];
  /** the command that serves the project, when nothing failed */
  ready: string | null;
}

/** What the doctor asks of the machine: a program's output, or null when it cannot be run. */
export type Run = (cmd: string, args: string[]) => string | null;

export const run: Run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  return r.error || r.status !== 0 ? null : `${r.stdout}${r.stderr}`;
};

/** The package's own file, read where both a checkout and the installed package have it. */
function packageFile(rel: string): string {
  return join(import.meta.dirname, "..", "..", rel);
}

export function packageVersion(): string {
  return JSON.parse(readFileSync(packageFile("package.json"), "utf8")).version;
}

type Version = [number, number, number];

function parseVersion(v: string): Version | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Whether a version meets a range of the forms package.json's `engines` uses: alternatives
 *  joined by `||`, each of `^x.y.z`, `>=x.y.z`, `<x.y.z`, joined by spaces. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split("||").some((alt) =>
    alt.trim().split(/\s+/).every((part) => {
      const m = /^(\^|>=|<|)(\d+\.\d+\.\d+)$/.exec(part);
      if (!m) return false;
      const w = parseVersion(m[2])!;
      if (m[1] === "^") return v[0] === w[0] && cmp(v, w) >= 0;
      if (m[1] === ">=") return cmp(v, w) >= 0;
      if (m[1] === "<") return cmp(v, w) < 0;
      return cmp(v, w) === 0;
    }),
  );
}

/** A toolchain as elan names it: `leanprover/lean4:v4.33.1`, whether the project writes it so, or
 *  as a bare version, or elan lists it as its folder's name (`leanprover--lean4---v4.33.1`). */
export function toolchainName(t: string): string {
  const s = t.trim().replace(/\s+\(.*\)$/, "");
  if (/^[\w.-]+--[\w.-]+---/.test(s)) return s.replace("---", ":").replace("--", "/");
  return s.includes(":") ? s : `leanprover/lean4:${s.startsWith("v") ? s : `v${s}`}`;
}

/** The Lean versions supported (test/toolchains.json): the oldest, and the newest tested. */
export function supportedToolchains(): { floor: string; newest: string } {
  const t = JSON.parse(readFileSync(packageFile("test/toolchains.json"), "utf8")) as { floor: string; toolchains: string[] };
  const newest = [...t.toolchains].sort((a, b) => cmp(parseVersion(a)!, parseVersion(b)!)).at(-1)!;
  return { floor: t.floor, newest };
}

/** Where a toolchain stands: before the oldest supported, within what is tested, or after it. A
 *  release candidate counts as its release. */
export function toolchainSupport(toolchain: string, s = supportedToolchains()): "old" | "tested" | "new" | "other" {
  const name = toolchainName(toolchain);
  if (!name.startsWith("leanprover/lean4:")) return "other";
  const v = parseVersion(name);
  if (!v) return "other";
  if (cmp(v, parseVersion(s.floor)!) < 0) return "old";
  return cmp(v, parseVersion(s.newest)!) > 0 ? "new" : "tested";
}

/** Whether a folder could be made and written here: it, or the nearest folder above it that is. */
function writable(dir: string): boolean {
  let d = resolve(dir);
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  try {
    accessSync(d, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function install(what: "poppler" | "xelatex", platform: NodeJS.Platform): string {
  if (what === "poppler") return platform === "darwin" ? "brew install poppler" : "install poppler-utils (Debian, Ubuntu: sudo apt install poppler-utils)";
  return platform === "darwin" ? "install MacTeX, or brew install --cask mactex-no-gui" : "install TeX Live's XeLaTeX (Debian, Ubuntu: sudo apt install texlive-xetex texlive-latex-extra)";
}

export interface DoctorOptions {
  /** the Lean project, if one is to be checked */
  path: string | null;
  roots: string[];
  site: string | null;
  cache: string | null;
  run?: Run;
  node?: string;
  platform?: NodeJS.Platform;
}

export function doctor(o: DoctorOptions): Report {
  const exec = o.run ?? run;
  const node = o.node ?? process.versions.node;
  const platform = o.platform ?? process.platform;
  const checks: Check[] = [];
  const engines: string = JSON.parse(readFileSync(packageFile("package.json"), "utf8")).engines?.node ?? "";
  checks.push(
    satisfies(node, engines)
      ? { level: "ok", what: `Node ${node}` }
      : { level: "fail", what: `Node ${node}: VisualProof needs ${engines.replace(/\s*\|\|\s*/g, " or ")}`, fix: "install a newer Node (https://nodejs.org), the current LTS" },
  );

  const elan = exec("elan", ["--version"]);
  const installed = new Set(
    (elan ? (exec("elan", ["toolchain", "list"]) ?? "") : "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^no installed toolchains/i.test(l))
      .map(toolchainName),
  );
  checks.push(
    elan
      ? { level: "ok", what: `${elan.trim().split("\n")[0].replace(/\s+\(.*\)$/, "")}, ${installed.size} toolchain(s) installed` }
      : { level: "fail", what: "elan not found: it runs each project's Lean and Lake", fix: "install elan: https://github.com/leanprover/elan" },
  );

  const poppler = ["pdfinfo", "pdftotext", "pdftoppm"].filter((p) => exec(p, ["-v"]) === null);
  checks.push(
    poppler.length === 0
      ? { level: "ok", what: `Poppler ${/version\s+([\d.]+)/.exec(exec("pdfinfo", ["-v"]) ?? "")?.[1] ?? ""}`.trimEnd() }
      : { level: "warn", what: `Poppler: ${poppler.join(", ")} not found: the library cannot read PDFs`, fix: install("poppler", platform) },
  );
  const xelatex = exec("xelatex", ["--version"]);
  checks.push(
    xelatex
      ? { level: "ok", what: `XeLaTeX (${/TeX Live \d+|MiKTeX[^\s)]*/.exec(xelatex)?.[0] ?? "found"})` }
      : { level: "info", what: "XeLaTeX not found: needed only for the printed document (Export)", fix: install("xelatex", platform) },
  );
  if (exec("git", ["--version"]) === null) {
    checks.push({ level: "info", what: "git not found: builds are kept without their commit, and past sources only as the builds kept them" });
  }

  if (o.path === null) return { checks, ready: null };

  let project;
  try {
    project = openProject(o.path, o.roots, false);
  } catch (e) {
    if (!(e instanceof ProjectError)) throw e;
    checks.push({ level: "fail", what: e.message });
    return { checks, ready: null };
  }
  const { root, toolchain, roots, libDir } = project;
  const name = toolchainName(toolchain);
  const support = toolchainSupport(name);
  const range = supportedToolchains();
  checks.push(
    support === "tested"
      ? { level: "ok", what: `${name}: supported (${range.floor} to ${range.newest} are tested)` }
      : support === "old"
        ? { level: "fail", what: `${name}: older than ${range.floor}, the oldest Lean VisualProof reads`, fix: "update the project's toolchain, or use it with a Lean VisualProof supports" }
        : support === "new"
          ? { level: "warn", what: `${name}: newer than ${range.newest}, the newest tested; it probably works`, fix: "if the graph cannot be read, report it: https://github.com/LucianoXu/VisualProof/issues" }
          : { level: "warn", what: `${name}: not a release of leanprover/lean4; VisualProof is tested on releases` },
  );
  if (elan && !installed.has(name)) {
    checks.push({ level: "warn", what: `${name} is not installed: elan downloads it when VisualProof first runs Lake here`, fix: `elan toolchain install ${name}` });
  }
  const from = o.roots.length ? "--root" : existsSync(join(root, "lakefile.toml")) ? "lakefile.toml" : "lakefile.lean";
  const missing = roots.filter((r) => !existsSync(join(libDir, ...r.split(".")) + ".olean"));
  const mathlib = ["lakefile.toml", "lakefile.lean", "lake-manifest.json"].some((f) => existsSync(join(root, f)) && /mathlib/i.test(readFileSync(join(root, f), "utf8")));
  checks.push(
    missing.length === 0
      ? { level: "ok", what: `built: ${roots.join(", ")} (from ${from})` }
      : {
          level: "fail",
          what: `not built: ${missing.join(", ")} (${relative(root, join(libDir, ...missing[0].split("."))) + ".olean"} is missing; from ${from})`,
          fix: `in ${root}: ${mathlib ? "lake exe cache get && " : ""}lake build${o.roots.length === 0 && from === "lakefile.lean" ? ", or name the modules to read with --root" : ""}`,
        },
  );
  const dirs = projectDirs(root, o.site, o.cache);
  for (const [what, dir] of [["site", dirs.site], ["cache", dirs.cache]] as const) {
    if (!writable(dir)) checks.push({ level: "fail", what: `the ${what} ${dir} cannot be written`, fix: `give --${what} a folder of your own` });
  }
  const holder = siteHolder(dirs.site);
  checks.push(
    holder === null
      ? { level: "ok", what: `site ${dirs.site}` }
      : { level: "info", what: `site ${dirs.site}: a server (process ${holder}) is serving it; another needs a --site of its own` },
  );
  const failed = checks.some((c) => c.level === "fail");
  const args = [o.path, ...o.roots.flatMap((r) => ["--root", r]), ...(o.site ? ["--site", o.site] : []), ...(o.cache ? ["--cache", o.cache] : [])];
  return { checks, ready: failed ? null : `visualproof serve ${args.map((a) => (/^[\w./:@%+=-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}` };
}

const MARK: Record<Level, string> = { ok: "✓", fail: "✗", warn: "!", info: "·" };

export function printReport(r: Report, project: string | null): string {
  const lines = [`VisualProof ${packageVersion()}`];
  for (const c of r.checks) {
    lines.push(`  ${MARK[c.level]} ${c.what}`);
    if (c.fix && c.level !== "ok") lines.push(`      ${c.fix}`);
  }
  if (r.ready) lines.push("", `Ready: ${r.ready}`);
  else if (project === null && !r.checks.some((c) => c.level === "fail")) lines.push("", "To check a project too: visualproof doctor <lean-project>");
  return lines.join("\n");
}
