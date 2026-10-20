#!/usr/bin/env node
// visualproof serve <path>   — read a built Lean project and serve its declaration graph
// visualproof export <path>  — the same page, frozen into one HTML file

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { freemem, tmpdir } from "node:os";
import { bundleDirIn, ensureBundle, prepare, useBundleDir } from "./pipeline.ts";
import type { Prepared } from "./pipeline.ts";
import { makeArtwork, pngOf, projectView } from "./artcmd.ts";
import { SiteBusy, cacheHome, lockSite, openSite, projectDirs } from "./dirs.ts";
import { ProjectError, openProject, targetsInWords } from "./project.ts";
import type { Project } from "./project.ts";
import { Live } from "./live.ts";
import { ReviewStore } from "./review.ts";
import { LeanHover } from "./hover.ts";
import { Identities } from "./identity.ts";
import { LAYOUT_VERSION } from "../shared/graph.ts";
import { readProjectView, Views } from "./views.ts";
import { writeSnapshot } from "./snapshot.ts";
import { Access, loadKey, urlHost } from "./access.ts";
import { AgentApi } from "./agent.ts";
import { inGB, jobsAdvice, memoryFloor, onMathlib, UsagePass, mergeUsage, saveMerged, WORKER_PEAK } from "./usage.ts";
import { extract } from "./extract.ts";
import { Exporter } from "./export.ts";
import { Library } from "./library.ts";
import { doctor, packageVersion, printReport } from "./doctor.ts";
import { FROM_PACKAGE, PACKAGE_ROOT, Updates } from "./updates.ts";
import type { UpdateMode } from "./updates.ts";
import { RESTART_STATUS, supervise } from "./supervise.ts";
import { stopChildren } from "./children.ts";
import { filmStatus, useFilm } from "./film.ts";
import { branchToFollow, DEFAULT_BUILD_HOURS, DEFAULT_POLL_MINUTES, DeployBusy, deployFolder, Deployment, deploySite, ensureClone, limitInWords, lockDeployment, recordedDefault, sharedMathlibCache } from "./deploy.ts";
import type { DeployFolder, Remote } from "./deploy.ts";
import { shortCommit } from "../shared/deploy.ts";
import { parseArgs } from "./options.ts";
import type { Options } from "./options.ts";
import { App } from "./app.ts";

/** What a stop signal does to a server: end it at once, until it can stop gracefully (serve). */
let stopNow: () => void = () => process.exit(0);

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  // an installed package's server runs under the supervisor, which stays while it restarts into
  // another version (UpdateSpec decision 5); `--updates off`, and a checkout, run it as they are
  if (o.cmd === "serve" && FROM_PACKAGE && o.updates !== "off" && process.env.VISUALPROOF_SUPERVISED !== "1") {
    const site = o.remote ? deploySiteOf(o) : projectDirs(resolve(o.path), o.site, o.cache).site;
    process.exit(await supervise({ installedRoot: PACKAGE_ROOT, cacheRoot: o.cache ? resolve(o.cache) : cacheHome(), argv: process.argv.slice(2), site, mode: o.updates }));
  }
  // a stop asked before the server can stop gracefully (it reads the project, takes the site) ends
  // it at once, with status 0; once it can, the graceful stop does (`stopNow`, below)
  if (o.cmd === "serve") for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => stopNow());
  if (o.cmd === "doctor") {
    const report = doctor({ path: o.path || null, roots: o.roots, site: o.site, cache: o.cache });
    console.log(printReport(report, o.path || null));
    process.exit(report.checks.some((c) => c.level === "fail") ? 1 : 0);
  }
  // a live server outlives any one failed task: log it and keep serving (a picture is no server:
  // whatever fails ends it, with status 1)
  if (o.cmd !== "artwork") process.on("unhandledRejection", (e) => console.error("unhandled:", e instanceof Error ? e.message : e));
  // following a branch (DeploySpec): its clone in the cache, made at the first start, is the project
  const deploy = o.remote ? await openDeployment(o) : null;
  if (o.remote && !deploy) return;
  let project: Project;
  try {
    // a branch's clone is read before its build: the server builds it
    project = openProject(deploy ? deploy.folder.checkout : o.path, o.roots, !deploy && o.graph === null);
  } catch (e) {
    if (e instanceof ProjectError) {
      console.error(`visualproof: ${deploy ? `${deploy.branch} of ${deploy.remote.source ?? deploy.remote.url}, at ${shortCommit(deploy.head)}: ` : ""}${e.message}`);
      return endNotTheCode(1);
    }
    throw e;
  }
  // a picture: the site read, never made, locked or written (ExportSpec decision 21)
  if (o.cmd === "artwork") return artworkCommand(project, o);
  // a branch's site is the address's and the branch's, wherever the cache is
  const dirs = { ...projectDirs(project.root, o.site, o.cache), ...(deploy && o.site === null ? { site: deploySite(deploy.remote, deploy.branch) } : {}) };
  openSite(dirs.site);
  mkdirSync(dirs.cache, { recursive: true });
  // one server at a time writes a site; an export only reads it
  if (o.cmd !== "export") {
    try {
      const release = lockSite(dirs.site);
      process.on("exit", release);
    } catch (e) {
      if (!(e instanceof SiteBusy)) throw e;
      console.error(`visualproof: ${e.message}`);
      return endNotTheCode(1);
    }
  }
  useBundleDir(bundleDirIn(o.cache ? resolve(o.cache) : cacheHome()));

  if (o.cmd === "purge-file") {
    // the owner's alone, from the command line (AttachmentSpec decision 3): the bytes and what was
    // read of them go; the record and the links stay in the review's logs, which are never rewritten
    const lib = new Library(dirs.site, dirs.cache);
    console.log(lib.purge(o.sha!) ? `purged ${o.sha} from ${lib.dir}` : `${lib.dir} holds no file ${o.sha}`);
    return;
  }
  await ensureBundle();

  if (o.cmd === "export") {
    try {
      const log = (l: string) => console.log(l);
      // a snapshot carries the usage pass's findings: run here, as far as the cache does not hold them
      let ex = o.graph ? undefined : await extract(project, dirs, log);
      if (ex && o.jobs > 0) {
        const pass = new UsagePass(project, dirs, o.jobs, log);
        const plan = pass.plan(ex.graph);
        if (plan.todo.length) log(`usage pass: elaborating ${plan.todo.length} of ${plan.modules.length} modules, ${o.jobs} at a time`);
        const results = await pass.run(plan);
        if (results) {
          ex = mergeUsage(ex, plan, results, pass.status.failed, pass.status.ms ?? 0);
          saveMerged(dirs.cache, ex);
          for (const f of pass.status.failed) log(`usage pass: ${f.module}: ${f.error}`);
        }
      }
      const prep = await prepare(project, dirs, o.graph, log, ex ? { extraction: ex } : {});
      // the boards as they are kept: a snapshot carries them, frozen
      const views = new Views(dirs.site, LAYOUT_VERSION, () => {});
      const bytes = writeSnapshot(project, prep, o.out!, o.label, new ReviewStore(project.root, dirs.site).data, views.book);
      console.log(`wrote ${o.out} (${(bytes / 1e6).toFixed(1)} MB) — opens from disk, no server`);
    } catch (e) {
      console.error(`visualproof: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    return;
  }

  const review = new ReviewStore(project.root, dirs.site);
  const live = new Live(project, dirs, o.graph, review, o.editor, o.jobs);
  live.library.limit = o.libraryLimit;
  const hover = new LeanHover(project, dirs.cache);
  const ids = new Identities(o.identityHeader);
  let key: { key: string; made: boolean } | null = null;
  try {
    key = o.accessKeyFile ? loadKey(o.accessKeyFile) : null;
  } catch (e) {
    console.error(`visualproof: --access-key-file: ${e instanceof Error ? e.message : String(e)}`);
    return endNotTheCode(2);
  }
  process.on("exit", () => {
    hover.stop();
    // the usage pass's workers end with the server
    live.usage.cancel();
    // when tokens and personal links were last used is written now, not at the next minute
    live.tokens.close();
    live.invites.close();
    live.readOnly.close();
  });
  // the branch followed: asked every --poll minutes, each new head built in turn (DeploySpec)
  const deployment = deploy
    ? new Deployment({
        remote: deploy.remote,
        branch: deploy.branch,
        folder: deploy.folder,
        project,
        roots: o.roots,
        everyMs: (o.poll ?? DEFAULT_POLL_MINUTES) * 60_000,
        buildMs: (o.buildHours ?? DEFAULT_BUILD_HOURS) * 3600_000,
        mathlibCache: o.mathlibCache ?? "shared",
        head: deploy.head,
        hooks: {
          reading: () => live.reading,
          // the usage pass of the build before is cut short: what it finished is kept
          starting: () => live.usage.cancel(),
          toolchainChanged: () => hover.toolchainChanged(),
          // the pages are told at the live loop's next look, within a second
          changed: () => live.lookSoon(),
          log: (l) => live.say(l),
          ended: () => live.reread(),
        },
      })
    : null;
  live.deploy = deployment;
  const exporter = new Exporter(dirs.cache);
  const app = new App(live, hover, ids, new AgentApi(live, hover, o.agents), key ? new Access(key.key) : null, exporter, o.publicUrl, o.publicRead, o.allowedHosts);
  const server = createServer((req, res) => app.handle(req, res));
  const version = packageVersion();
  // run by the supervisor, which starts it again in another version (UpdateSpec decision 5)
  const supervised = typeof process.send === "function" && process.env.VISUALPROOF_SUPERVISED === "1";
  /** Stop (UpdateSpec decision 9): no new requests, the pages told why and their streams ended, the
   *  programs the server runs stopped, then the process ends: status 0, or RESTART_STATUS for the
   *  supervisor to start it again in another version. A second signal meanwhile changes nothing;
   *  whatever still waits, it ends within 5 s. */
  let stopping = false;
  /** the status the process ends with: a stop asked during a restart makes it a stop (0), so that
   *  the supervisor does not start it again */
  let exitStatus = 0;
  const stop = (status: number, why: { update: { from: string; to: string } } | { stopped: true }) => {
    if (stopping) {
      if ("stopped" in why) exitStatus = 0;
      return;
    }
    stopping = true;
    exitStatus = status;
    updates.stop();
    // a build going on is stopped with the programs, and done again at the next start
    deployment?.stop();
    server.close();
    live.end(why);
    hover.stop();
    live.usage.cancel();
    server.closeIdleConnections();
    setTimeout(() => process.exit(exitStatus), 5000);
    void stopChildren(2000).then(() => {
      server.closeAllConnections();
      process.exit(exitStatus);
    });
  };
  const cacheRoot = o.cache ? resolve(o.cache) : cacheHome();
  const updates = new Updates({
    mode: o.updates,
    cacheRoot,
    canRestart: supervised && FROM_PACKAGE,
    check: FROM_PACKAGE,
    checkout: !FROM_PACKAGE,
    // nobody on a page, nothing running that a restart would cut short (UpdateSpec decision 6)
    quiet: () => live.pages === 0 && !live.busy && !exporter.busy,
    restart: (to) => {
      process.send?.({ vp: "restart", to });
      stop(RESTART_STATUS, { update: { from: version, to } });
    },
    // the server's console alone: the log pages read (GET /api/status) is no place for paths and
    // commands of this machine
    log: (l) => console.log(l),
    changed: () => live.updatesChanged(),
    running: version,
    // the supervisor's word, believed only from it
    installedRoot: (supervised && process.env.VISUALPROOF_INSTALLED) || PACKAGE_ROOT,
    site: dirs.site,
    // what the supervisor set aside without a record of it (a full disk), believed only from it
    also: new Set(supervised ? unrecordedOf(process.env.VISUALPROOF_UNRECORDED) : []),
    film: () => filmStatus(),
  });
  // the tips' tour film, fetched on its first play (UpdateSpec decision 14; never under --updates off)
  useFilm({ cacheRoot, mode: o.updates, log: (l) => console.log(l) });
  live.updateStatus = (full) => updates.status(full);
  app.updates = updates;
  stopNow = () => stop(0, { stopped: true });
  // the supervisor went: this server goes with it rather than serve on alone
  if (supervised) process.on("disconnect", () => stop(0, { stopped: true }));
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(`visualproof: ${e.code === "EADDRINUSE" ? `${o.host}:${o.port} is in use already: give --port another` : e.message}`);
    return endNotTheCode(1);
  });
  server.listen(o.port, o.host, () => {
    console.log(`VisualProof — ${project.name} (${targetsInWords(project)})`);
    console.log(`  http://${o.host}:${o.port}/`);
    console.log(`  site: ${dirs.site}${review.error ? ` — the review: ${review.error}` : ""}`);
    console.log(`  cache: ${dirs.cache}`);
    console.log(`  names: ${ids.header ? `from the ${ids.header} header` : "as each page gives them"}`);
    console.log(`  editor: ${o.editor ?? "no link unless a reader sets one"}`);
    console.log(`  agents: ${o.agents} — their API is http://${o.host}:${o.port}/api/agent`);
    console.log(`  usage pass: ${o.graph ? "none for a saved graph" : o.jobs > 0 ? `${o.jobs} module(s) at a time` : "off (--jobs 0)"}`);
    // what the pass's workers may hold on a project on Mathlib, against what the machine has
    const memory = o.graph || o.jobs <= 0 ? null : jobsAdvice(o.jobs, onMathlib(project.root));
    if (memory)
      console.log(
        `  memory: ${inGB(freemem())} available; on Mathlib the pass's workers may hold up to ${inGB(WORKER_PEAK)} each, ${inGB(memory.need)} at ${o.jobs}: ` +
          `--jobs ${memory.fits} if memory runs short (it starts fewer while less than ${inGB(memoryFloor())} is available)`,
      );
    console.log(
      `  access: ${key ? `by its link only, /k/<the key in ${o.accessKeyFile}>${key.made ? " (a new key was made there)" : ""}${o.publicRead ? "; anyone else read-only (--public)" : ""}` : `anyone who reaches the port, by its address, localhost${[...(o.publicUrl ? [urlHost(o.publicUrl)] : []), ...o.allowedHosts].map((n) => `, ${n}`).join("")} (other names are refused: --allowed-host)`}`,
    );
    console.log(`  version: ${version}; updates ${updatesInWords(o.updates, version, supervised)}`);
    if (deployment) {
      const d = deployment.status(true);
      console.log(`  following: ${d.branch} of ${d.source ?? deployment.remote.url}, asked every ${o.poll ?? DEFAULT_POLL_MINUTES} min; a build stopped past ${limitInWords(deployment.buildMs)}`);
      console.log(`  clone: ${deployment.folder.checkout}`);
      // a failed build that wrote nothing is not built (DeploySpec decision 6): before any that did,
      // none is, and the next is the next commit pushed
      const next = deployment.toBuild();
      const l = d.last;
      const why = l ? (l.error ?? (l.exit === null ? "lake build was stopped" : l.exit !== undefined ? `lake build exited with ${l.exit}` : null)) : null;
      const none = next
        ? `none yet: the first, of ${shortCommit(next)}, starts now, and the page says so until it is done`
        : `none yet: that of ${shortCommit(l?.commit ?? deploy!.head)} failed${why ? ` (${why})` : ""}, and the next commit pushed is built`;
      console.log(`  builds: ${d.built ? `the tree holds the build of ${shortCommit(d.built)}${deployment.holds() ? ", cut short: it is done again" : ""}` : none}; their logs in ${deployment.folder.logs}`);
      // where the project is on Mathlib, its cache: the user's, or the deployment's own (DeploySpec decision 2)
      console.log(`  Mathlib's cache: ${o.mathlibCache === "own" ? `${deployment.folder.mathlib}, the deployment's own` : `${sharedMathlibCache()}, the user's, shared by their builds`}`);
    }
    recordVersion(live, version, supervised);
    process.send?.({ vp: "listening", version });
    updates.start();
  });
  live.start();
  deployment?.start();
}

/** The site a branch's server keeps, as the supervisor finds it (UpdateSpec decision 7): `--site`,
 *  else the address's and the branch's — the default branch as it was last asked, without the network;
 *  null at a first start without --branch, which the server alone resolves. */
function deploySiteOf(o: Options): string | null {
  if (o.site !== null) return resolve(o.site);
  const branch = o.branch ?? recordedDefault(o.cache ? resolve(o.cache) : cacheHome(), o.remote!.url);
  return branch ? deploySite(o.remote!, branch) : null;
}

/** A branch's deployment as the server starts (DeploySpec decisions 1–2): the branch (the remote's
 *  default where none is given), its folder in the cache taken for this server, its clone made at
 *  the first start. Null where it cannot be had: said, and the server ends, which is not its code. */
async function openDeployment(o: Options): Promise<{ remote: Remote; branch: string; folder: DeployFolder; head: string } | null> {
  const remote = o.remote!;
  const cacheRoot = o.cache ? resolve(o.cache) : cacheHome();
  const branch = await branchToFollow(remote, o.branch, cacheRoot);
  if (typeof branch !== "string") {
    console.error(`visualproof: ${remote.source ?? remote.url}: ${branch.error}`);
    endNotTheCode(1);
    return null;
  }
  const folder = deployFolder(cacheRoot, remote, branch);
  try {
    process.on("exit", lockDeployment(folder, remote, branch));
  } catch (e) {
    if (!(e instanceof DeployBusy)) throw e;
    console.error(`visualproof: ${e.message}`);
    endNotTheCode(1);
    return null;
  }
  const c = await ensureClone(remote, branch, folder, (l) => console.log(l));
  if ("error" in c) {
    console.error(`visualproof: ${c.error}`);
    endNotTheCode(1);
    return null;
  }
  return { remote, branch, folder, head: c.commit };
}

/** What the server does with its releases, for its first lines (UpdateSpec decisions 2–4, 13). */
function updatesInWords(mode: UpdateMode, version: string, supervised: boolean): string {
  if (mode === "off") return "off (--updates off): the registry is never asked";
  if (!FROM_PACKAGE) return "none from a checkout";
  const minor = version.split(".").slice(0, 2).join(".");
  if (mode === "notify") return `notify — newer versions told of, never downloaded${supervised ? "; one installed meanwhile is restarted into" : ""}`;
  return supervised ? `auto — a patch of ${minor} taken by itself at a quiet moment; a newer version told of` : "auto, but without the supervisor: newer versions told of";
}

/** The versions the supervisor says it set aside without a record (VISUALPROOF_UNRECORDED). */
function unrecordedOf(text: string | undefined): string[] {
  try {
    const v = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The version that serves the site, recorded in the timeline where it is another than the last one
 *  recorded (UpdateSpec decision 10), with what the supervisor set aside before this one started. */
function recordVersion(live: Live, version: string, supervised: boolean): void {
  let setAside: { version: string; why: string } | undefined;
  try {
    const raw = JSON.parse((supervised && process.env.VISUALPROOF_SET_ASIDE) || "null") as { version?: unknown; why?: unknown } | null;
    if (raw && typeof raw.version === "string" && typeof raw.why === "string") setAside = { version: raw.version, why: raw.why };
  } catch {
    // nothing set aside that can be read
  }
  const was = live.timeline.lastVersion() ?? live.history?.lastVersion() ?? null;
  if (was !== version || setAside) live.timeline.add({ kind: "tool", from: was, to: version, ...(setAside ? { setAside } : {}) });
}

/** End the server with `status`, the supervisor told first that what ends it is not its code (the
 *  site is busy, the port is taken, the project cannot be read): a patch that ends so is not set
 *  aside (UpdateSpec decision 7). The message is sent before the process ends, not lost with it. */
function endNotTheCode(status: number): void {
  process.exitCode = status;
  if (process.send) process.send({ vp: "environment" }, () => process.exit(status));
  else process.exit(status);
}

/** The artwork command (ExportSpec decision 21): the build read as an export reads it, the picture a
 *  recipe says made of it (server/artcmd.ts), its files written; what it named said as the agents'
 *  API says it; problems said, and exit status 1. */
async function artworkCommand(project: Project, o: Options): Promise<void> {
  const fail = (why: string): never => {
    console.error(`visualproof artwork: ${why}`);
    process.exit(1);
  };
  try {
    await artwork(project, o, fail);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function artwork(project: Project, o: Options, fail: (why: string) => never): Promise<void> {
  const dirs = projectDirs(project.root, o.site, o.cache);
  const site = o.site ? dirs.site : null;
  if (site && !existsSync(site)) fail(`there is no site at ${site}`);
  let recipe: unknown;
  try {
    recipe = JSON.parse(readFileSync(o.recipe!, "utf8"));
  } catch (e) {
    fail(`the recipe ${o.recipe} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  // -o: a name, or a path without its extension, in a folder that is there
  const outBase = o.out ? o.out.replace(/\.(png|svg)$/i, "") : null;
  const dir = outBase ? dirname(outBase) : process.cwd();
  if (!existsSync(dir)) fail(`there is no folder ${dir} to write the files in`);
  mkdirSync(dirs.cache, { recursive: true });
  const log = (l: string) => console.log(l);
  let ex = o.graph ? undefined : await extract(project, dirs, log);
  if (ex && o.jobs > 0) {
    const pass = new UsagePass(project, dirs, o.jobs, log);
    const plan = pass.plan(ex.graph);
    if (plan.todo.length) log(`usage pass: elaborating ${plan.todo.length} of ${plan.modules.length} modules, ${o.jobs} at a time`);
    const results = await pass.run(plan);
    if (results) {
      ex = mergeUsage(ex, plan, results, pass.status.failed, pass.status.ms ?? 0);
      saveMerged(dirs.cache, ex);
    }
  }
  // the site's layout memory read and never written, nor the views laid out written to the cache;
  // without a site, none read: the board as a new site lays it out
  const prep = await prepare(project, dirs, o.graph, log, { ...(ex ? { extraction: ex } : {}), readOnlySite: true, ...(site ? {} : { freshLayout: true }) });
  const kept = site ? readProjectView(site, LAYOUT_VERSION) : { view: null, notes: 0 };
  if (kept.why) console.error(`visualproof artwork: the site's views cannot be read (${kept.why}): the Project view as a new site has it`);
  const review = site ? new ReviewStore(project.root, site).data : null;
  const a = makeArtwork(prep, review, projectView(kept.view), { recipe, screen: o.screen, name: outBase ? basename(outBase) : null, root: project.root, projectNotes: kept.notes });
  if (!("svg" in a)) {
    for (const p of a.problems) console.error(`visualproof artwork: ${p}`);
    process.exit(1);
  }
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  console.log(`names written: ${list(a.names.written)}`);
  if (a.names.ruledSkipped.length) console.log(`names a rule chose, left out where they would cover another: ${list(a.names.ruledSkipped)}`);
  if (a.names.left) console.log(`names or targets left out for room: ${a.names.left}`);
  console.log(`targets marked: ${list(a.targets)}`);
  console.log(`selection: ${a.selection ? `${a.selection.mode} of ${a.selection.name}` : "none"}`);
  if (a.notesLeftOut) console.log(`notes: ${a.notesLeftOut} on the board, not drawn (the command draws no notes yet)`);
  const both = !o.png && !o.svg;
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  if (both || o.svg) {
    const file = join(dir, a.file("svg"));
    writeFileSync(file, a.svg);
    console.log(`wrote ${file} (${mb(Buffer.byteLength(a.svg))})`);
  }
  if (both || o.png) {
    const png = await pngOf(a.svg);
    const file = join(dir, a.file("png"));
    writeFileSync(file, png);
    console.log(`wrote ${file} (${mb(png.length)}, ${a.look.w} × ${a.look.h})`);
  }
}

// run as the command (`node src/server/main.ts`, the `visualproof` bin), not when a test imports App
if (import.meta.main) void main();
