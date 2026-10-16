// The source text of every build the history keeps (HistorySpec decisions 20–23, the owner's of
// 2026-10-10), borrowing git's content-addressed design: each text of a project file is a blob named
// by its SHA-256, `history/sources/<sha256>.gz`, written once whatever number of builds compiled it,
// and a snapshot's manifest says, per module, which blob its build was compiled from. A build so
// adds only the files that changed.
//
// Only what was built is kept. Lake's trace records the hash of the text each module was compiled
// from (server/status.ts, `compiledTextHash`); a text is kept for a module only where its Lake hash
// is that one: the file as it is when the build is read, else the file in the commit checked out
// then. A file edited after the build matches neither, and its text is not kept: a text that is not
// the build's is never shown as the build's.
//
// The snapshots made before the history kept sources are backfilled once, in the background, at
// start (`backfillSources`). Their builds' hashes are known where the project's cache still holds what
// says them — the view of an extraction of that build (`view/<fingerprint>-v*.meta.json.gz`,
// `modules[].compiled`), or the present trace of a module not compiled since — and a text is kept
// there only where its Lake hash is that one. Elsewhere the hash is gone, and the best check left is
// the places the snapshot recorded: a text is kept where it is the one candidate that agrees with
// every one of them (`misfit`) — its project imports, where each declaration starts and ends, its
// doc comment and the name it declares — and the manifest says so (`check: "places"`), so that the
// page and the agents can say how the text was matched to its build. Where several agree, the
// commit of a build read clean is taken, and of a build read with edits none is, one of them not
// being the build's. Candidates are read with git,
// read-only: the build's commit, the commits made on top of it, the working tree and the blobs kept
// already. Nothing is ever written into the project or its `.git`.

import { spawn, spawnSync } from "node:child_process";
import { tracked } from "./children.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { History, SnapshotInfo } from "./history.ts";
import type { Project } from "./project.ts";
import { compiledTextHash, lakeTextHash, parseImports } from "./status.ts";

/** Which text a module's build was compiled from, as a snapshot's manifest keeps it. */
export interface SourceRef {
  /** the module's file, relative to the project */
  file: string;
  /** the Lake hash of the text the build compiled, where it is known (the module's trace) */
  lake?: string;
  /** the SHA-256 of the text kept (`history/sources/<blob>.gz`); absent where none is */
  blob?: string;
  /** how the text was found to be the build's: its Lake hash is the build's (`lake`), or, where that
   *  hash is no longer known, it is the one candidate that agrees with every place the snapshot
   *  recorded (`places`) */
  check?: "lake" | "places";
  /** where the text was read: the working tree (`tree`), a commit (`git:<hash>`), a blob kept for
   *  another build (`kept`) */
  from?: string;
  /** why no text is kept */
  why?: string;
}

/** module → its text, for one snapshot */
export type SourceMap = Record<string, SourceRef>;

/** What a snapshot's index line says of its texts: how many modules have one kept, of those with a
 *  file; how many of them were matched by their places alone; and the gzipped bytes of the blobs
 *  written for it and of all those it lists. */
export interface SourcesSummary {
  kept: number;
  of: number;
  places: number;
  bytes: { new: number; all: number };
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The blobs: each text once, gzipped, named by its SHA-256. */
export class SourceStore {
  readonly dir: string;
  /** blobs known to be on disk, and their gzipped sizes */
  private sizes = new Map<string, number>();

  constructor(historyDir: string) {
    this.dir = join(historyDir, "sources");
  }

  /** Keep `text`: its blob, its gzipped size, and whether it was written now (no build had it). */
  put(text: string): { blob: string; size: number; fresh: boolean } {
    const blob = sha256(text);
    let size = this.sizes.get(blob);
    if (size !== undefined) return { blob, size, fresh: false };
    const f = join(this.dir, `${blob}.gz`);
    if (existsSync(f)) {
      size = statSync(f).size;
      this.sizes.set(blob, size);
      return { blob, size, fresh: false };
    }
    mkdirSync(this.dir, { recursive: true });
    const gz = gzipSync(text);
    writeFileSync(`${f}.tmp`, gz);
    renameSync(`${f}.tmp`, f);
    this.sizes.set(blob, gz.length);
    return { blob, size: gz.length, fresh: true };
  }

  /** A blob's gzipped size; 0 where it is not there. */
  size(blob: string): number {
    let size = this.sizes.get(blob);
    if (size === undefined) {
      try {
        size = statSync(join(this.dir, `${blob}.gz`)).size;
      } catch {
        return 0;
      }
      this.sizes.set(blob, size);
    }
    return size;
  }

  /** A blob's text; null where it is not there, or is not what its name says. */
  text(blob: string): string | null {
    if (!/^[0-9a-f]{64}$/.test(blob)) return null;
    try {
      const text = gunzipSync(readFileSync(join(this.dir, `${blob}.gz`))).toString("utf8");
      return sha256(text) === blob ? text : null;
    } catch {
      return null;
    }
  }

  /** The bytes the blobs hold on disk. */
  bytes(): number {
    let total = 0;
    try {
      for (const f of readdirSync(this.dir)) total += statSync(join(this.dir, f)).size;
    } catch {
      // nothing there yet
    }
    return total;
  }
}

/** What a snapshot recorded of a module, which a text compiled into it must agree with. */
export interface ModuleShape {
  imports: string[];
  nodes: { name: string; kind: string; range?: [number, number, number, number]; doc?: string; gen?: string }[];
}

/** a doc comment's words, however they are laid out */
const words = (s: string) => s.replace(/\s+/g, " ").trim();

/** Where `text` disagrees with what the snapshot recorded of a module compiled from it (`shape`);
 *  null where it agrees with every place. Its project imports (`isModule` tells a project module)
 *  are the module's; each declaration's range lies in it, starting on a token and ending on one; a
 *  range that opens with a doc comment holds the declaration's doc; and where its command writes a
 *  name, it is the declaration's. A text that agrees may still differ inside a declaration, where no
 *  place moves: that is why a Lake hash, where known, is the check. */
export function misfit(text: string, shape: ModuleShape, isModule: (m: string) => boolean): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const imports = new Set(parseImports(text).filter(isModule));
  if (imports.size !== new Set(shape.imports).size || shape.imports.some((m) => !imports.has(m))) return "its imports differ";
  const cps = new Map<number, string[]>();
  const chars = (l: number) => {
    let c = cps.get(l);
    if (!c) cps.set(l, (c = [...lines[l - 1]]));
    return c;
  };
  for (const n of shape.nodes) {
    const r = n.range;
    if (!r) continue;
    const [l0, c0, l1, c1] = r;
    if (l0 < 1 || l1 < l0 || l1 > lines.length) return `${n.name} lies past its end`;
    // Lean's columns count code points, and a range is its first token to its last
    const first = chars(l0);
    const last = chars(l1);
    if (c0 >= first.length || /\s/.test(first[c0]) || (c0 > 0 && !/\s/.test(first[c0 - 1]))) return `${n.name} does not start where it did`;
    if (c1 < 1 || c1 > last.length || /\s/.test(last[c1 - 1])) return `${n.name} does not end where it did`;
    const opening = first.slice(c0).join("");
    if (n.doc !== undefined && opening.startsWith("/--")) {
      const body = lines.slice(l0 - 1, l1).join("\n").slice(lines[l0 - 1].length - opening.length);
      const end = body.indexOf("-/");
      if (end < 0 || words(body.slice(3, end)) !== words(n.doc)) return `${n.name}'s doc comment differs`;
    }
    // where its command writes a name, it is the declaration's: whole, or its last parts, written
    // inside the namespace
    if (n.gen === undefined && n.kind !== "instance" && n.kind !== "notation") {
      const declared = lines.slice(l0 - 1, l1).flatMap((l) => {
        const m = DECLARES.exec(l);
        return m ? [m[1].replace(/^_root_\./, "").replace(/\.\{.*$/, "").replace(/[«»]/g, "")] : [];
      });
      const own = n.name.replace(/[«»]/g, "");
      if (declared.length && !declared.some((d) => d === own || own.endsWith(`.${d}`))) return `${n.name} is not declared where it was`;
    }
  }
  return null;
}

/** a line that declares something by name, as shared/excerpt.ts reads one, and the name */
const DECLARES = /^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|partial|unsafe|nonrec|scoped|local)\s+)*(?:class\s+inductive|theorem|lemma|def|abbrev|structure|class|inductive|axiom|opaque|irreducible_def)\s+([^\s:({[]\S*)/;

// ------------------------------------------------------------------------------------------- git

/** Git, read-only and taking no lock, run from the project's folder: its output, or null. */
function gitSync(root: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout : null;
}

/** The same, off the event loop, with `input` on its standard input: its output as bytes, or null. */
function git(root: string, args: string[], input?: string): Promise<Buffer | null> {
  return new Promise((ok) => {
    const p = tracked(spawn("git", ["-C", root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["pipe", "pipe", "ignore"] }));
    const out: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.on("error", () => ok(null));
    p.on("close", (code) => ok(code === 0 ? Buffer.concat(out) : null));
    p.stdin.on("error", () => {});
    p.stdin.end(input ?? "");
  });
}

/** A file as commit `commit` has it (`git show <commit>:./<file>`, relative to the project); null
 *  where it has none. */
export function fileAt(root: string, commit: string, file: string): string | null {
  if (!/^[0-9a-f]{7,64}$/.test(commit)) return null;
  return gitSync(root, ["show", `${commit}:./${file}`]);
}

// --------------------------------------------------------------------------- at a build's reading

/** The texts a build being read was compiled from (HistorySpec decision 21), kept in `store`: per
 *  module of the graph that has a file, the Lake hash its trace records and, where the file as it is
 *  now has that hash — else the file in `commit`, the commit checked out now — that text; and the
 *  gzipped bytes of the blobs written for them now. */
export function keepSources(p: Project, modules: string[], commit: string | null, store: SourceStore): { map: SourceMap; written: number } {
  const out: SourceMap = {};
  let written = 0;
  const put = (text: string) => {
    const r = store.put(text);
    if (r.fresh) written += r.size;
    return r.blob;
  };
  for (const m of modules) {
    const file = p.files.get(m);
    if (!file) continue;
    const lake = compiledTextHash(p, m, file);
    if (!lake) {
      out[m] = { file, why: "its build left no hash of the text it was compiled from" };
      continue;
    }
    let text: string | null = null;
    try {
      text = readFileSync(join(p.root, file), "utf8");
    } catch {
      // gone since the build: the commit may have it
    }
    if (text !== null && lakeTextHash(text) === lake) {
      out[m] = { file, lake, blob: put(text), check: "lake", from: "tree" };
      continue;
    }
    const then = commit ? fileAt(p.root, commit, file) : null;
    if (then !== null && lakeTextHash(then) === lake) {
      out[m] = { file, lake, blob: put(then), check: "lake", from: `git:${commit}` };
      continue;
    }
    out[m] = { file, lake, why: "its file was edited after the build, and the commit does not have the text it was compiled from" };
  }
  return { map: out, written };
}

/** What a manifest's texts come to: kept and of how many, matched by places, and their bytes. */
export function summarize(map: SourceMap, store: SourceStore, written: number): SourcesSummary {
  let kept = 0, places = 0, all = 0;
  const seen = new Set<string>();
  for (const r of Object.values(map)) {
    if (!r.blob) continue;
    kept++;
    if (r.check === "places") places++;
    if (!seen.has(r.blob)) {
      seen.add(r.blob);
      all += store.size(r.blob);
    }
  }
  return { kept, of: Object.keys(map).length, places, bytes: { new: written, all } };
}

// ------------------------------------------------------------------------------------- backfill

/** How a backfilled snapshot came out, for the log. */
export interface BackfillReport {
  id: number;
  of: number;
  /** kept by their Lake hash, by places alone, and not kept, by why */
  lake: number;
  places: number;
  missing: Record<string, number>;
  /** where the hashes known came from: a view of the build's extraction, a present trace */
  hashes: { view: number; trace: number };
  written: number;
}

/** The Lake hashes of the texts a snapshot's build compiled, from what the project's cache still holds:
 *  the view of any extraction it was read from, and the present trace of every module whose `.olean`
 *  is not newer than the build (not compiled since, so its trace is the build's). */
function knownHashes(cacheDir: string, p: Project, info: SnapshotInfo, reads: string[], modules: string[]): { hashes: Map<string, string>; view: number; trace: number } {
  const hashes = new Map<string, string>();
  let view = 0, trace = 0;
  const viewDir = join(cacheDir, "view");
  let files: string[] = [];
  try {
    files = readdirSync(viewDir);
  } catch {
    // no views kept
  }
  for (const fp of reads) {
    for (const f of files.filter((x) => x.startsWith(`${fp}-v`) && x.endsWith(".meta.json.gz"))) {
      try {
        const meta = JSON.parse(gunzipSync(readFileSync(join(viewDir, f))).toString("utf8")) as { modules: { name: string; compiled?: string | null }[] };
        for (const m of meta.modules)
          if (m.compiled && !hashes.has(m.name)) {
            hashes.set(m.name, m.compiled);
            view++;
          }
      } catch {
        // a view being written, or of another shape: the traces may say
      }
    }
  }
  const at = Date.parse(info.at);
  for (const m of modules) {
    if (hashes.has(m)) continue;
    const file = p.files.get(m);
    if (!file) continue;
    try {
      if (statSync(join(p.libDir, ...m.split(".")) + ".olean").mtimeMs > at + 1) continue;
    } catch {
      continue;
    }
    const h = compiledTextHash(p, m, file);
    if (h) {
      hashes.set(m, h);
      trace++;
    }
  }
  return { hashes, view, trace };
}

/** The commit a snapshot was read at, and the commits made on top of it, nearest first, at most
 *  `most`: where a build's edits were committed afterwards. */
async function commitsFrom(root: string, commit: string, most = 64): Promise<string[]> {
  const out = await git(root, ["log", "--format=%H", "--ancestry-path", "--reverse", "--all", `^${commit}`]);
  const later = out ? out.toString("utf8").split("\n").filter((h) => /^[0-9a-f]{40,64}$/.test(h)) : [];
  return [commit, ...later.slice(0, most)];
}

/** Each `.lean` file's blob in each of `commits`, by path relative to the project. */
async function treesOf(root: string, commits: string[]): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for (const c of commits) {
    const ls = await git(root, ["ls-tree", "-r", c, "--", "."]);
    const files = new Map<string, string>();
    for (const line of ls ? ls.toString("utf8").split("\n") : []) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+\.lean)$/.exec(line);
      if (m) files.set(m[2], m[1]);
    }
    out.set(c, files);
  }
  return out;
}

/** Git's blobs, read at once (`git cat-file --batch`): by their ids, as text. */
async function readBlobs(root: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let k = 0; k < ids.length; k += 500) {
    const part = ids.slice(k, k + 500);
    const buf = await git(root, ["cat-file", "--batch"], part.join("\n") + "\n");
    if (!buf) continue;
    let at = 0;
    while (at < buf.length) {
      const nl = buf.indexOf(10, at);
      if (nl < 0) break;
      const head = buf.toString("utf8", at, nl).split(" ");
      at = nl + 1;
      if (head[1] !== "blob") continue;
      const size = Number(head[2]);
      out.set(head[0], buf.toString("utf8", at, at + size));
      at += size + 1;
    }
  }
  return out;
}

const pause = () => new Promise((ok) => setImmediate(ok));

/** Backfill the texts of the snapshots whose manifests keep none (made before the history kept
 *  sources), oldest first, once each: a manifest backfilled keeps its texts and is not looked at
 *  again. Runs off the event loop's way, git read-only; what it finds is logged, a line per
 *  snapshot. */
export async function backfillSources(h: History, p: Project, cacheDir: string, log: (l: string) => void): Promise<BackfillReport[]> {
  const store = h.sources;
  const reports: BackfillReport[] = [];
  const todo = h.list().filter((s) => h.sourcesOf(s.id) === null);
  if (!todo.length) return reports;
  log(`history: backfilling the source texts of ${todo.length} snapshot(s) kept before the texts were`);
  const t0 = Date.now();
  // the blobs kept already, by file: candidates for every build
  const keptFor = new Map<string, Set<string>>();
  const remember = (file: string, blob: string) => {
    const s = keptFor.get(file);
    if (s) s.add(blob);
    else keptFor.set(file, new Set([blob]));
  };
  for (const s of h.list())
    for (const r of Object.values(h.sourcesOf(s.id) ?? {})) if (r.blob) remember(r.file, r.blob);
  const repo = gitSync(p.root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
  // what a text's imports are read against: every module of the project any build had, so that a
  // later text that imports a module this build did not have yet does not agree with it
  const project = new Set(h.list().flatMap((s) => h.modulesOf(s.id)));
  for (const s of todo) {
    const modules = h.modulesOf(s.id);
    const known = knownHashes(cacheDir, p, s, h.readsOf(s.id), modules);
    const commit = s.commit?.hash && repo ? s.commit.hash : null;
    const commits = commit ? await commitsFrom(p.root, commit) : [];
    const trees = commits.length ? await treesOf(p.root, commits) : new Map<string, Map<string, string>>();
    const ids = new Set<string>();
    for (const m of modules) {
      const file = p.files.get(m);
      if (file) for (const t of trees.values()) if (t.has(file)) ids.add(t.get(file)!);
    }
    const blobs = await readBlobs(p.root, [...ids]);
    const map: SourceMap = {};
    const report: BackfillReport = { id: s.id, of: 0, lake: 0, places: 0, missing: {}, hashes: { view: known.view, trace: known.trace }, written: 0 };
    const miss = (m: string, ref: SourceRef, why: string) => {
      map[m] = { ...ref, why };
      report.missing[why] = (report.missing[why] ?? 0) + 1;
    };
    let n = 0;
    for (const m of modules) {
      // a module no file stands for now (removed since) is read under the path its name gives
      const file = p.files.get(m) ?? `${m.split(".").join("/")}.lean`;
      report.of++;
      if (++n % 50 === 0) await pause();
      // the candidates, likeliest first: the commit read, those made on top of it, the working
      // tree, the blobs kept already; each text once
      const cands: { text: string; from: string }[] = [];
      const seen = new Set<string>();
      const add = (text: string | null | undefined, from: string) => {
        if (text === null || text === undefined) return;
        const k = sha256(text);
        if (seen.has(k)) return;
        seen.add(k);
        cands.push({ text, from });
      };
      for (const c of commits) add(blobs.get(trees.get(c)?.get(file) ?? ""), `git:${c}`);
      try {
        add(readFileSync(join(p.root, file), "utf8"), "tree");
      } catch {
        // not there now
      }
      for (const b of keptFor.get(file) ?? []) add(store.text(b), "kept");
      const lake = known.hashes.get(m);
      const ref: SourceRef = { file, ...(lake ? { lake } : {}) };
      let pick: { text: string; from: string; check: "lake" | "places" } | null = null;
      if (lake) {
        const c = cands.find((x) => lakeTextHash(x.text) === lake);
        if (!c) {
          miss(m, ref, "no text with the hash its build compiled was found");
          continue;
        }
        pick = { ...c, check: "lake" };
      } else {
        const shape = h.moduleShape(s.id, m);
        if (!shape) {
          miss(m, ref, "its snapshot cannot be read");
          continue;
        }
        const fit = cands.filter((x) => misfit(x.text, shape, (y) => project.has(y) || p.files.has(y)) === null);
        if (!fit.length) {
          miss(m, ref, cands.length ? "no text agrees with the places its build recorded" : "no text of its file was found");
          continue;
        }
        // several texts agree: the commit read wins where the build was read clean from it, else
        // nothing is kept, since one of them is not the build's
        const one = fit.length === 1 ? fit[0] : !s.commit?.dirty && !s.commit?.guessed && commit ? fit.find((x) => x.from === `git:${commit}`) : undefined;
        if (!one) {
          miss(m, ref, "several texts agree with the places its build recorded");
          continue;
        }
        pick = { ...one, check: "places" };
      }
      const put = store.put(pick.text);
      if (put.fresh) report.written += put.size;
      remember(file, put.blob);
      map[m] = { ...ref, blob: put.blob, check: pick.check, from: pick.from };
      if (pick.check === "lake") report.lake++;
      else report.places++;
    }
    // a reading of the build since the backfill began kept its texts itself: those stand
    if (!h.setSources(s.id, map, report.written)) {
      log(`history: snapshot ${s.id} was read again meanwhile, and kept its texts itself`);
      continue;
    }
    reports.push(report);
    const missing = Object.entries(report.missing).map(([why, k]) => `${k} ${why}`).join("; ");
    log(
      `history: snapshot ${s.id} (${s.commit ? `${s.commit.hash.slice(0, 7)}${s.commit.dirty ? " dirty" : ""}` : "no commit"}): ` +
        `${report.lake + report.places} of ${report.of} module texts kept — ${report.lake} by their Lake hash (${known.view} hashes from a view of the build, ${known.trace} from present traces), ${report.places} by their places alone` +
        `${missing ? `; not kept: ${missing}` : ""}; ${(report.written / 1024).toFixed(0)} KB written`,
    );
  }
  log(`history: source texts backfilled in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return reports;
}
