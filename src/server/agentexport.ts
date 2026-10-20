// The exported document (ExportSpec.md), the endpoints of server/agent.ts and the answers the page's
// Export takes too (server/appagent.ts): a view's document — its model as JSON, its head, its outline
// — at the view's own build or a past one (decision 16), typeset by XeLaTeX as a job (decision 11),
// one at a time per agent, and its files; and a link that opens the board as a picture (decision 20).

import { spawnSync } from "node:child_process";
import { childEnv } from "./children.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addressOf } from "../shared/sharesnap.ts";
import { encodeRecipe, readRecipe, RECIPE_PARAM, resolveRecipe, SAVE_PARAM } from "../shared/artrecipe.ts";
import { evaluate } from "../shared/query.ts";
import { authorLine, authorsOf, reviewTraces, viewTraces } from "../shared/doc/authors.ts";
import { itemsShownOn } from "../shared/noteplace.ts";
import { buildDoc, DocInputError, docNotes } from "../shared/doc/build.ts";
import { boardSpots } from "./boardspots.ts";
import { outlineOf } from "../shared/doc/outline.ts";
import { planDoc } from "../shared/doc/sections.ts";
import { docFiles, figureFiles, figureNotes } from "./figures.ts";
import type { DocInput, DocSource, DocView } from "../shared/doc/build.ts";
import { renderLatex } from "../shared/doc/latex.ts";
import type { DocModel } from "../shared/doc/model.ts";
import { readSettings, SETTINGS_HELP } from "../shared/doc/settings.ts";
import { reviewThen } from "../shared/pastgraph.ts";
import { fullWhen } from "../shared/titles.ts";
import { docTitle, fixedScope, PROJECT } from "../shared/views.ts";
import type { ViewData } from "../shared/views.ts";
import { titleContext } from "./agentviews.ts";
import type { ExportJob } from "./export.ts";
import { SERVER_WRITER } from "./review.ts";
import { lakeTextHash } from "./status.ts";
import { View } from "./agentgraph.ts";
import type { AgentApi, Answer, Ask, Caller } from "./agent.ts";
import { body, fail, needAgent, ok } from "./agent.ts";

/** The build the document of view `rec` is of (ExportSpec decision 16): the view's own where the
 *  request names none — the past build it is kept at, if it is (HistorySpec decision 19) — else
 *  the one `raw` names, as the Time Machine shows a view at another build than its own (null, 0 or
 *  the latest's id: the latest). Null for the latest build; or the answer why it cannot be had. */
export function exportAt(api: AgentApi, rec: ViewData, raw: unknown): number | null | Answer {
  if (raw === undefined || raw === "") return api.world.views?.pastOf(rec) ?? null;
  if (raw === null || raw === 0 || raw === "0" || raw === "null" || raw === "latest") return null;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id < 0) return fail(400, "version is a snapshot's id, or null for the latest build.", "GET /api/agent/history lists the snapshots; leave version out for the view's own build.");
  const h = api.world.history;
  if (!h?.get(id)) return fail(404, `There is no snapshot ${id}.`, "GET /api/agent/history lists them; leave version out for the view's own build.");
  return id === h.latest()?.id ? null : id;
}

/** The build a document's title says (ViewSpec decision 25), for view `rec` printed at `at`
 *  (exportAt; `raw` what the request named): that build where it is a past one; the build the view
 *  is kept at where the request named none, as its title says it everywhere; none for the latest
 *  named. */
export function titleVersion(api: AgentApi, rec: ViewData, at: number | null, raw: unknown): number | undefined {
  return at ?? (raw === undefined || raw === "" ? rec.version : undefined);
}

/** The exported document's input as a request sends it, read and checked: the view, the settings
 *  and the build (ExportSpec decisions 7, 12 and 16), the view's board as its page draws it (the
 *  owner's decisions of 2026-10-12: the document's order, and the notes it shows) and what the
 *  figures of those notes need of the library; or the answer why not. What was asked of a
 *  document until 2026-10-09 — targets, a preset, a content — is refused, and told what to ask
 *  instead. */
export async function docInput(api: AgentApi, view: unknown, settings: unknown, retired: Record<string, unknown> = {}, version?: unknown): Promise<{ input: DocInput } | Answer> {
  const old = ["targets", "preset", "content"].filter((k) => retired[k] !== undefined);
  if (old.length) return fail(400, `A document is a view's now (2026-10-09): ${old.join(", ")} ${old.length === 1 ? "is" : "are"} no longer taken.`, VIEW_HINT);
  const v = api.graph();
  if (!(v instanceof View)) return v;
  if (typeof view !== "string" || !view) return fail(400, "view is the id of the view to export.", VIEW_HINT);
  const rec = api.world.views?.book.get(view);
  if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them; POST /api/agent/views/open {scope} opens one on a query.");
  const at = exportAt(api, rec, version);
  if (at !== null && typeof at === "object") return at;
  const st = readSettings(settings);
  if ("error" in st) return fail(400, `${st.error}.`, `Settings: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}.`);
  const tv = titleVersion(api, rec, at, version);
  const docView: DocView = {
    id: rec.id,
    name: rec.name,
    ...(rec.targets ? { targets: [...rec.targets] } : {}),
    scope: rec.scope,
    clustering: rec.clustering,
    hidden: [...rec.hidden[rec.clustering]],
    authors: viewAuthors(api, rec, at, v),
    ...(tv !== undefined ? { version: tv } : {}),
  };
  // the notes it may print, and what their images and clips need of the library
  const notes = api.world.views?.book.notes ?? [];
  const files = await docFiles(api.world.library, [...notes, ...(rec.notes ?? [])].map((n) => n.carries));
  if (at !== null) return pastInput(api, v, at, rec, docView, st.settings, files);
  const root = api.world.project.root;
  // each module's text as it is now, read once per document
  const source = (module: string): DocSource | null => {
    const m = v.modules.get(module);
    const rel = api.world.project.files.get(module) ?? m?.file;
    if (!rel) return null;
    try {
      const text = readFileSync(join(root, rel), "utf8");
      const hash = lakeTextHash(text);
      return { lines: text.split("\n"), edited: !!m?.compiled && hash !== m.compiled, contexts: api.world.contextsOf?.(module) ?? null, hash };
    } catch {
      return null;
    }
  };
  const review = api.world.review.data;
  return {
    input: {
      g: v.g,
      review,
      view: docView,
      settings: st.settings,
      source,
      fileOf: (module) => v.modules.get(module)?.file ?? null,
      // a branch's build is of its commit, not of what is checked out meanwhile (DeploySpec)
      build: { fingerprint: api.world.graph?.fingerprint ?? null, commit: shownOr(api.world.shownCommit?.(), root) },
      ...(tv !== undefined ? { titles: titleContext(api.world) } : {}),
      board: boardSpots({ g: v.g, review, rec, memory: api.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null, whole: v.meta.layouts?.[rec.clustering], notes }),
      files,
    },
  };
}

/** The input of the document of view `rec` at past build `at` (ExportSpec decision 16): its
 *  board's graph is that build's past graph, as the page makes it (server/pastdoc.ts), the review
 *  read there under the names then too, the board laid out as the Time Machine lays it out; its
 *  texts that build's, as the history keeps them. */
export function pastInput(api: AgentApi, v: View, at: number, rec: ViewData, view: DocView, settings: DocInput["settings"], files: DocInput["files"]): { input: DocInput } | Answer {
  const h = api.world.history;
  if (!h) return fail(404, "This server keeps no history: it serves a saved graph, and has no past build to print.", "Export the view at the latest build: version null.");
  // the texts of a build kept before the history kept them are found once, at start (HistorySpec
  // decision 22): until then none would print
  if (h.sourcesOf(at) === null)
    return fail(503, `The source texts of snapshot ${at} are still being looked for: the server finds those of the builds kept before it kept texts once, as it starts.`, "Ask again in a few seconds.", { retryAfter: 5 }, { "retry-after": "5" });
  const b = api.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
  if (!b) return fail(404, `There is no snapshot ${at}.`, "GET /api/agent/history lists them.");
  const s = b.info;
  const c = s.commit;
  const review = reviewThen(api.world.review.data, b.past.nowName);
  const board = boardSpots({
    g: b.past.graph,
    review,
    rec,
    memory: api.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null,
    whole: v.meta.layouts?.[rec.clustering],
    past: { snapshot: at, nowName: b.past.nowName, now: v.g, nowReview: api.world.review.data },
    notes: api.world.views?.book.notes ?? [],
  });
  return {
    input: {
      g: b.past.graph,
      review,
      view,
      settings,
      source: b.source,
      fileOf: b.fileOf,
      build: { fingerprint: s.fingerprint, commit: c && { hash: c.hash, branch: c.branch, ...(c.dirty ? { dirty: true } : {}), ...(c.guessed ? { guessed: true } : {}) }, toolchain: s.toolchain },
      past: { snapshot: at, at: s.at, when: fullWhen(s.at), ...(s.approx ? { approx: true } : {}) },
      titles: titleContext(api.world),
      board,
      files,
    },
  };
}

/** The people who left a trace on view `rec`, in the order of their first (ExportSpec decision 15;
 *  shared/doc/authors.ts): from its record, who dropped its pins, and the timeline; and the review
 *  of what its document prints at build `at` (null: the latest), the declarations of the project it
 *  holds on that build's graph `v` or its past graph (the owner's decision, 2026-10-10). Someone
 *  invited by a personal link by the name they go by now, as the server's links say it, else the
 *  review's logs. */
export function viewAuthors(api: AgentApi, rec: ViewData, at: number | null, v: View): string[] {
  const people = new Map((api.world.people?.() ?? []).map((p) => [p.id, p.name]));
  const logs = api.world.review.data.people;
  const nameOf = (id: string) => people.get(id) ?? (Object.hasOwn(logs, id) ? logs[id].name : null);
  const past = at === null ? null : api.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
  const g = past ? past.past.graph : v.g;
  const d = past ? reviewThen(api.world.review.data, past.past.nowName) : api.world.review.data;
  const set = evaluate(rec.scope, { g, review: d });
  const held: string[] = [];
  for (let i = 0; i < g.projectCount; i++) if (set[i]) held.push(g.nodes[i].name);
  // the items it shows (AttachmentSpec decision 17, the owner's of 2026-10-11): every note of the
  // project on the Project; elsewhere what its scope gives, against that build's clusters, the
  // links and the declarations notes are attached to as that build names them, and what was added
  // to it, less what was taken out
  const shown = itemsShownOn(api.world.views?.book.notes ?? [], { all: fixedScope(rec), items: rec.items }, rec.clustering, g.nodes.filter((_, i) => set[i]), g.nodes, d.links, past?.past.nowName);
  const traces = viewTraces(rec, api.world.views?.book.authors.get(rec.id), api.world.timeline.events, shown);
  return authorsOf([...traces, ...reviewTraces(d, held)], nameOf, [SERVER_WRITER.name]);
}

/** What heads the document of view `view` (ExportSpec decisions 14 and 15) at the build `version`
 *  names (decision 16; left out, the view's own): its title and its author line as they print, for
 *  the page's Export window (GET /api/export/head). */
export function exportHead(api: AgentApi, view: string, version?: unknown): Answer {
  const rec = view ? api.world.views?.book.get(view) : undefined;
  if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them.");
  const at = exportAt(api, rec, version);
  if (at !== null && typeof at === "object") return at;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const authors = viewAuthors(api, rec, at, v);
  const { version: _kept, ...base } = rec;
  const tv = titleVersion(api, rec, at, version);
  return ok({ view: rec.id, title: docTitle({ ...base, ...(tv !== undefined ? { version: tv } : {}) }, titleContext(api.world)), author: authorLine(authors), authors });
}

/** The outline of the document of view `view` at the build `version` names (ExportSpec decision
 *  18; left out, the view's own): its sections, declarations and notes in the document's order,
 *  without their text, from the board as its page draws it (as `document` reads it). What the
 *  page's linear form draws (GET /api/export/outline); a view too large to print has one too. */
export function exportOutline(api: AgentApi, view: string, version?: unknown): Answer {
  const rec = view ? api.world.views?.book.get(view) : undefined;
  if (!rec) return fail(404, `There is no view ${view.slice(0, 200)}.`, "GET /api/agent/views lists them.");
  const at = exportAt(api, rec, version);
  if (at !== null && typeof at === "object") return at;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const notes = api.world.views?.book.notes ?? [];
  const memory = api.world.views?.book.memoryOf(rec.id, rec.clustering) ?? null;
  const whole = v.meta.layouts?.[rec.clustering];
  let g = v.g;
  let review = api.world.review.data;
  let past: Parameters<typeof boardSpots>[0]["past"];
  if (at !== null) {
    const b = api.pasts.get(at, v.g, v.version, (m) => v.modules.get(m)?.file ?? null);
    if (!b) return fail(404, `There is no snapshot ${at}.`, "GET /api/agent/history lists them.");
    past = { snapshot: at, nowName: b.past.nowName, now: v.g, nowReview: review };
    g = b.past.graph;
    review = reviewThen(review, b.past.nowName);
  }
  const set = evaluate(rec.scope, { g, review });
  const plan = planDoc(g, set, rec.clustering, rec.hidden[rec.clustering] ?? []);
  const board = boardSpots({ g, review, rec, memory, whole, notes, ...(past ? { past } : {}) });
  return ok({ view: rec.id, ...(at !== null ? { version: at } : {}), outline: outlineOf(plan, g, board) });
}

/** The exported document's model (ExportSpec decision 6) of view `view` with `settings` at the
 *  build `version` names (decision 16; left out, the view's own), as a request sends them: what
 *  the page's Export and an agent typeset (POST /api/export, POST /api/agent/export), and what
 *  agents read as JSON (GET /api/agent/export). `retired`: the rest of the request, where what is
 *  no longer taken is looked for. */
export async function document(api: AgentApi, view: unknown, settings: unknown, retired: Record<string, unknown> = {}, version?: unknown): Promise<{ doc: DocModel; notes: string[] } | Answer> {
  const r = await docInput(api, view, settings, retired, version);
  if (!("input" in r)) return r;
  try {
    const doc = buildDoc(r.input);
    // what the document does not say of how it was made (decision 8), and of its order and figures
    const { board, files } = r.input;
    const notes = [...docNotes(doc), ...(board?.fresh ? [FRESH_BOARD] : []), ...(files ? figureNotes(board?.notes ?? [], r.input.review, files) : [])];
    return { doc, notes };
  } catch (e) {
    // a view of nothing of the project, or of more than a document prints
    if (e instanceof DocInputError) return fail(400, `${e.message}.`, VIEW_HINT);
    throw e;
  }
}

/** Typeset a document (ExportSpec decisions 6 and 11): the job that does it, at once — 202 while
 *  it runs, 200 once done (the same document asked again, or one the cache holds). For the page's
 *  POST /api/export and the agents' POST /api/agent/export alike; an agent (`agent`, the caller)
 *  has one job running at most, and is answered 429 while it has, with that job. */
export async function exportStart(api: AgentApi, body: unknown, agent: Caller | null): Promise<Answer> {
  const ex = api.exporter;
  if (!ex) return fail(404, "This server does not export documents.", "GET /api/agent/export gives the document's model as JSON.");
  if (!ex.available()) return fail(503, "XeLaTeX is not installed on the server, so documents cannot be typeset here.", "GET /api/agent/export gives the document's model as JSON.");
  const owner = agent ? jobOwner(agent) : null;
  const was = owner ? api.exportJobs.get(owner) : undefined;
  const busy = was ? ex.job(was) : null;
  if (busy?.state === "running")
    return fail(429, "You have a document being typeset already: one at a time.", `Wait for it (GET /api/agent/export/job?id=${busy.id}), then ask again.`, { job: busy }, { "retry-after": "5" });
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const d = await document(api, b.view, b.settings, b, b.version);
  if (!("doc" in d)) return d;
  // another request of the same agent may have started one while this was being built
  const raced = owner ? api.exportJobs.get(owner) : undefined;
  const running = raced && raced !== was ? ex.job(raced) : null;
  if (running?.state === "running")
    return fail(429, "You have a document being typeset already: one at a time.", `Wait for it (GET /api/agent/export/job?id=${running.id}), then ask again.`, { job: running }, { "retry-after": "5" });
  const job = ex.compile(renderLatex(d.doc), d.notes, figureFiles(d.doc, api.world.library));
  if (owner && job.state === "running") api.exportJobs.set(owner, job.id);
  return { status: job.state === "running" ? 202 : 200, body: { job, ...(agent ? jobLinks(job) : {}) } };
}

/** How a typesetting job is doing, by its id; for agents with what to ask next. */
export function exportJob(api: AgentApi, id: string, agent: boolean): Answer {
  const job = api.exporter?.job(id) ?? null;
  if (!job) return fail(404, "There is no such document: it was never asked for, or has left the cache.", "POST /api/agent/export starts one; the same request again finds it while it is kept.");
  return ok({ job, ...(agent ? jobLinks(job) : {}) });
}

/** A file of a typeset document: the PDF, the .tex, the style file, or the sources' zip. 409
 *  while it is still being typeset (with Retry-After) or where it failed, 404 where it is unknown
 *  or has left the cache. */
export function exportFile(api: AgentApi, id: string, what: string | null): Answer {
  const w = what ?? "pdf";
  if (w !== "pdf" && w !== "tex" && w !== "sty" && w !== "zip") return fail(400, "what is pdf, tex, sty or zip.", "pdf (the default): the document; tex and sty: its LaTeX and the style file; zip: everything needed to typeset it again.");
  const ex = api.exporter;
  const job = ex?.job(id) ?? null;
  if (!ex || !job) return fail(404, "There is no such document: it was never asked for, or has left the cache.", "POST /api/agent/export starts one; the same request again finds it while it is kept.");
  if (job.state === "running") return fail(409, "That document is still being typeset.", `Ask again in a few seconds, or wait for GET /api/agent/export/job?id=${job.id} to say done.`, { job }, { "retry-after": "2" });
  if (job.state === "failed") return fail(409, `That document could not be typeset: ${(job.error ?? "XeLaTeX failed").replace(/\.$/, "")}.`, "Its job has the end of XeLaTeX's log (GET /api/agent/export/job).", { job });
  const f = ex.file(id, w);
  if (!f) return fail(404, "That document has left the cache.", "Ask for it again: POST /api/agent/export.");
  return { status: 200, body: null, file: f };
}

export async function exportGet(api: AgentApi, a: Ask): Promise<Answer> {
  const raw = a.query.get("settings");
  let settings: unknown;
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch {
      return fail(400, "settings is not JSON.", 'Send settings as a JSON object, URL-encoded, e.g. {"paper":"letter"}.');
    }
  }
  const r = await document(api, a.query.get("view") ?? undefined, settings, Object.fromEntries(a.query), a.query.get("version") ?? undefined);
  return "doc" in r ? ok(r.doc) : r;
}

export function exportPost(api: AgentApi, a: Ask): Promise<Answer> | Answer {
  const no = needAgent(a.caller);
  if (no) return no;
  return exportStart(api, a.body, a.caller);
}

export function exportFileGet(api: AgentApi, a: Ask): Answer {
  // an MCP server from before it saved files (0.3.0) relays `saveTo` as a parameter and would hand the
  // model a PDF as text: it is told to update instead
  const what = a.query.get("what") ?? "pdf";
  if (a.query.has("saveTo") && (what === "pdf" || what === "zip"))
    return fail(400, "Your MCP server cannot save files yet.", "Download it again (GET /api/agent/mcp, as GET /api/agent/mcp/install says), restart your client, then save it again (the export tool, action file).");
  return exportFile(api, a.query.get("id") ?? "", what);
}

/** A link to a picture of the board (ExportSpec decision 20, drafted 2026-10-15): a recipe
 *  (shared/artrecipe.ts) checked, and resolved against the board of the view it names — the
 *  Project's layout in the view's clustering — so that a name, a target or a cluster the board has
 *  not is refused here rather than drawn as a picture unlike the one meant; the selection it gives
 *  goes in the address, the recipe after it. The page that opens the link resolves it again
 *  against the board it opens on, opens the artwork mode, and saves the files asked for. Nothing
 *  changes here, and the link holds no key. */
export async function artwork(api: AgentApi, a: Ask): Promise<Answer> {
  const no = needAgent(a.caller);
  if (no) return no;
  const b = body(a);
  const read = readRecipe(b.recipe);
  if ("error" in read) return fail(400, read.error, read.hint);
  const r = read.recipe;
  const save = b.save === undefined || b.save === null ? [] : typeof b.save === "string" ? b.save.split(",").map((k) => k.trim()) : null;
  if (!save || save.some((k) => k !== "png" && k !== "svg")) return fail(400, "save is png, svg or png,svg.", "The files the page saves once the board is ready; left out, none.");
  const v = api.graph();
  if (!(v instanceof View)) return v;
  let sel: string | null = null;
  if (r.selection) {
    const i = api.find(v, r.selection.name, "selection.name");
    if (typeof i !== "number") return i;
    sel = v.g.nodes[i].name;
  }
  const rec = r.view && r.view !== PROJECT ? api.world.views?.book.get(r.view) : undefined;
  if (r.view && r.view !== PROJECT && !rec) return fail(404, `There is no view ${r.view}.`, "GET /api/agent/views lists them; left out, the Project.");
  const L = v.meta.layouts[rec?.clustering ?? "namespace"];
  const res = resolveRecipe(r, {
    clusters: L.clusters,
    clusterOf: (name) => {
      const i = v.g.byName.get(name);
      return i === undefined ? undefined : L.cluster[i];
    },
    targets: Object.keys(api.world.review.data.targets),
    projectCount: v.meta.projectCount,
  });
  if (res.problems.length)
    return fail(404, `The recipe names what the board has not: ${res.problems.join("; ")}.`, "Clusters by key (GET /api/agent/views/view lists a view's), declarations and targets by full name (GET /api/agent/search; the targets: GET /api/agent/targets). A target of the review the graph no longer has is left out unsaid where the recipe does not name it.", { problems: res.problems });
  const address = addressOf({ view: rec ? rec.id : null, scope: null, mode: r.selection?.mode ?? "tcb", selection: null, sel });
  const link = `${a.base ?? ""}/#${address}&${RECIPE_PARAM}=${encodeRecipe(r)}${save.length ? `&${SAVE_PARAM}=${[...new Set(save)].join(",")}` : ""}`;
  const look = res.look;
  return ok({
    ok: true,
    link,
    length: link.length,
    size: [look.w, look.h],
    names: look.labels === "chosen" ? res.named : look.labels,
    targets: look.targets === "chosen" ? look.shownTargets : look.targets,
    selection: sel ? { name: sel, mode: r.selection!.mode ?? "tcb" } : null,
    // names and targets beyond what the artwork carries, left out: said, not refused
    left: res.left,
    note: "It holds no key: it opens for whoever is let in already, or for a script that enters with the key (scripts/artwork-batch.mjs). The page that opens it resolves the recipe again against its board, opens the artwork mode fitted to the whole board, and saves the files asked for on that machine; nothing comes back here.",
  });
}

/** The parameters of the export endpoints, as a GET takes them. */
export const EXPORT_PARAMS = {
  view: "the view's id (GET /api/agent/views lists them; project for the Project; POST /api/agent/views/open {scope} gives one for a query, e.g. key(T)). A view kept at a past build makes that build's document",
  settings: `optional, a JSON object: ${Object.entries(SETTINGS_HELP).map(([k, h]) => `${k} — ${h}`).join("; ")}`,
  version: "optional: the build to print the view at, a snapshot's id (GET /api/agent/history), as the Time Machine shows a view at another build than its own; null or 0 for the latest. Left out: the view's own build",
};

/** What an export's notes say where no page had laid the view's board out for what it holds now
 *  (server/boardspots.ts): the order is the board the server laid out. */
export const FRESH_BOARD =
  "No page had laid out this view's board for what it holds now: the document follows the board as the server laid it out from the view's memory, by the rules a page follows, which is the board a page will show when it next opens the view.";

/** What a request is told of a view to export. */
export const VIEW_HINT =
  "Export a view, by its id: {view, settings}. What the view holds is what the document prints. A target's key document is its Key view: POST /api/agent/views/open {\"scope\": \"key(<target>)\"}, then export that view; the full review set is a view of its scope, tcb(<target>) except trusted or (uses(<target>) and kind(axiom) and nonstandard), opened the same way; any other view is a curated set.";

/** Whose typesetting job a request starts: an agent's own token, else its name. */
export function jobOwner(c: Caller): string {
  return c.token ? `token:${c.token.id}` : `name:${c.name ?? ""}`;
}

/** What an agent asks next about a job: how it is doing while it runs, its files once it is done. */
export function jobLinks(job: ExportJob): Record<string, unknown> {
  const at = (what: string) => `/api/agent/export/file?id=${job.id}&what=${what}`;
  if (job.state === "running") return { next: `GET /api/agent/export/job?id=${job.id}` };
  if (job.state === "done") return { files: { pdf: at("pdf"), tex: at("tex"), sty: at("sty"), zip: at("zip") } };
  return {};
}

/** The project's commit, where it is a git repository: `git rev-parse`, which only reads (and is
 *  told to take no lock), asked at most once every ten seconds. Null where git is not there or the
 *  project is not a repository. */
/** The commit a document of the graph on show is of: a branch's build's, else what git says now. */
export function shownOr(shown: { hash: string; branch: string } | null | undefined, root: string): { hash: string; branch: string | null } | null {
  return shown === undefined ? commitOf(root) : shown;
}

export function commitOf(root: string): { hash: string; branch: string | null } | null {
  const now = Date.now();
  const was = commits.get(root);
  if (was && now - was.at < 10_000) return was.commit;
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5000, env: childEnv({ GIT_OPTIONAL_LOCKS: "0" }), stdio: ["ignore", "pipe", "ignore"] });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const hash = git("rev-parse", "HEAD");
  const branch = hash ? git("rev-parse", "--abbrev-ref", "HEAD") : null;
  const commit = hash && /^[0-9a-f]{7,64}$/.test(hash) ? { hash, branch: branch && branch !== "HEAD" ? branch : null } : null;
  commits.set(root, { at: now, commit });
  return commit;
}

export const commits = new Map<string, { at: number; commit: { hash: string; branch: string | null } | null }>();
