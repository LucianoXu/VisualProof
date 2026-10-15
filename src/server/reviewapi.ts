// What the review records, as the server checks and binds it (decided 2026-10-08): whoever asks —
// a page through POST /api/review, an agent through /api/agent — says only what they decide (approve,
// or comment with text; a target on or off; trust on or off; a key declaration of a target on
// or off, ExportSpec decision 1). Who asks is the writer, a person or an
// agent, as the request came in: an agent's events go to its own log, marked, its opinions as
// advice (AgentSpec decisions 2 and 9); whether an agent may record each is its level's to say,
// checked before it gets here (server/agent.ts, `needOf`). What an opinion is about is the
// server's to say, from the graph and the compiled file: the declaration's content hash and the text
// judged (the context it is written in and the compiled excerpt, as the source window shows them,
// or the statement where there is no source);
// whatever hash or text a request carries is ignored. A name that is not a declaration of the graph
// is refused, and so is an opinion on a declaration whose file changed since it was compiled (the
// graph, and the hash, are about the compiled text, not what the reviewer would read). A target is a
// declaration of the project. A key declaration is marked for a target, and is a member of what its
// review holds (shared/reviewqueue.ts).
//
// Every refusal is an answer: a status, and words that say what to do instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exactContext, judgedText } from "../shared/context.ts";
import type { ModuleContexts } from "../shared/context.ts";
import type { ViewMeta } from "../shared/graph.ts";
import { MAX_TEXT, STANDARD_AXIOMS, validPrefix } from "../shared/review.ts";
import type { ReviewOp } from "../shared/review.ts";
import { reviewSet } from "../shared/reviewqueue.ts";
import type { NewEvent, StoredEvent } from "../shared/timeline.ts";
import type { Graph } from "../shared/viewgraph.ts";
import type { AppendResult, ReviewStore, Writer } from "./review.ts";
import { lakeTextHash } from "./status.ts";

/** The graph on show, as the review reads it: the agents' API keeps it (server/agent.ts, View). */
export interface GraphView {
  g: Graph;
  meta: ViewMeta;
  /** each module's file (relative to the project) and the hash of the text it was compiled from */
  modules: Map<string, { file: string | null; compiled: string | null }>;
}

/** What the review reads and writes: the project's files, the review's logs, the timeline. */
export interface ReviewWorld {
  project: { root: string; files: Map<string, string>; toolchain: string };
  review: Pick<ReviewStore, "data" | "append">;
  timeline: { add(e: NewEvent): StoredEvent };
  /** the usage pass's contexts of a module of the graph on show (server/usage.ts), if it has them */
  contextsOf?(module: string): ModuleContexts | null;
  /** the holder of a personal link in force who goes by `name` (CollabSpec decision 9) */
  invited?(name: string): { id: string; name: string } | undefined;
}

/** An answer, as server/agent.ts shapes them: an HTTP status and a JSON body. */
export interface ReviewAnswer {
  status: number;
  body: unknown;
}

/** A refusal: what went wrong, and what to do instead. */
export interface Refusal {
  status: number;
  error: string;
  hint: string;
}

const refuse = (status: number, error: string, hint: string): Refusal => ({ status, error, hint });
const answer = (r: Refusal): ReviewAnswer => ({ status: r.status, body: { error: r.error, hint: r.hint } });

/** What an opinion on a declaration is about: its content hash (none for what has no version, the
 *  outside world's declarations and axioms the graph only names), and the text judged. */
export interface Bound {
  name: string;
  hash?: string;
  text?: string;
  statement?: string;
  /** a non-standard axiom: needs review whatever is trusted (ReviewSpec decision 3) */
  axiom: boolean;
  /** a declaration of the graph outside the project */
  external: boolean;
}

export class ReviewApi {
  private world: ReviewWorld;
  /** the graph on show, or null until it has been read */
  private view: () => GraphView | null;

  constructor(world: ReviewWorld, view: () => GraphView | null) {
    this.world = world;
    this.view = view;
  }

  /** The graph, or the answer that there is none yet. */
  graph(): GraphView | Refusal {
    return this.view() ?? refuse(503, "The graph has not been read yet.", "The server is reading the project; try again in a few seconds.");
  }

  /** What an opinion on `name` is about: bound to the declaration's present, compiled version. */
  bind(v: GraphView, name: unknown): Bound | Refusal {
    if (typeof name !== "string" || !name.trim() || name.length > 2000) return refuse(400, "name is missing.", "Give the declaration's full name.");
    const { g, meta } = v;
    const i = g.byName.get(name);
    if (i === undefined) {
      // an axiom the target rests on that the graph has no declaration for (shared/reviewqueue.ts):
      // it has a name and nothing else, which is what the opinion is bound to
      if (meta.axioms.includes(name) && !STANDARD_AXIOMS.includes(name)) return { name, axiom: true, external: true };
      return refuse(404, `There is no declaration ${name} in the graph.`, "Opinions are given on the graph's declarations, by full name.");
    }
    const n = g.nodes[i];
    const axiom = n.kind === "axiom" && !STANDARD_AXIOMS.includes(n.name);
    if (g.isExt(i)) return { name, axiom, external: true };
    const rel = this.world.project.files.get(n.module);
    let lines: string[] | null = null;
    let hash: string | null = null;
    if (rel) {
      try {
        const text = readFileSync(join(this.world.project.root, rel), "utf8");
        const compiled = v.modules.get(n.module)?.compiled ?? null;
        hash = lakeTextHash(text);
        if (compiled && hash !== compiled)
          return refuse(409, `${n.module} changed since it was compiled: an opinion is about the compiled version, which is not what is there now.`, "Review it once the file is compiled again.");
        lines = text.split("\n");
      } catch {
        // a file gone since the build: the statement is what there is to judge
      }
    }
    // the text judged is the declaration's with the context it is written in, as the page shows
    // it (shared/context.ts)
    const t = lines && n.range ? judgedText(lines, false, n.name, n.range, exactContext(this.world.contextsOf?.(n.module), n.name, hash)) : null;
    const judged = t && t.text && t.text.length <= MAX_TEXT ? { text: t.text } : n.type && n.type.length <= MAX_TEXT ? { statement: n.type } : {};
    return { name, ...(n.hash ? { hash: n.hash } : {}), ...judged, axiom, external: false };
  }

  /** What a writer records: a person from the page (POST /api/review), under the name the
   *  request's headers give (CollabSpec decision 3) or, invited by a personal link, under their link
   *  (decision 9), or an agent, under its name, through either door (its API, or the page's at
   *  level full), marked as an agent's. */
  post(body: unknown, who: Writer): ReviewAnswer {
    if (!body || typeof body !== "object" || Array.isArray(body)) return answer(refuse(400, "The body is not a JSON object.", "Send {op, …}."));
    const b = body as Record<string, unknown>;
    const d = this.world.review.data;
    const me = who.name;
    const by = me;
    // every event an agent records says so, and the timeline's own events say so too; so does every
    // one of someone invited by a personal link, by the link's id
    const agent = { ...(who.agent ? { agent: true as const } : {}), ...(who.person ? { person: who.person } : {}) };
    switch (b.op) {
      case "opinion": {
        // "dispute" was the old name of a comment (renamed 2026-10-09): refused, with the new name
        if (b.verdict === "dispute") return answer(refuse(400, "verdict is approve or comment: \"dispute\" is now \"comment\".", "Use comment: send {op: \"opinion\", name, verdict: \"comment\", comment}."));
        if (b.verdict !== "approve" && b.verdict !== "comment") return answer(refuse(400, "verdict is approve or comment.", "Send {op: \"opinion\", name, verdict, comment}."));
        if (b.comment !== undefined && typeof b.comment !== "string") return answer(refuse(400, "comment is text.", "Send the comment as a string."));
        const comment = typeof b.comment === "string" ? b.comment.trim() : "";
        if (comment.length > 10000) return answer(refuse(400, "The comment is longer than 10,000 characters.", "Say it shorter."));
        if (b.verdict === "comment" && !comment) return answer(refuse(400, "A comment needs text.", "Write it in the box, then Comment."));
        const voice = this.voice(b.for, who);
        if ("status" in voice) return answer(voice);
        const v = this.graph();
        if ("status" in v) return answer(v);
        const x = this.bind(v, b.name);
        if ("status" in x) return answer(x);
        // an agent's opinion is advice, whatever its level (AgentSpec decision 2)
        return this.record({ op: "opinion", name: x.name, by, verdict: b.verdict, ...(comment ? { comment } : {}), ...(x.hash ? { hash: x.hash } : {}), ...(x.text !== undefined ? { text: x.text } : x.statement !== undefined ? { statement: x.statement } : {}), ...voice, ...agent }, who);
      }
      case "target": {
        if (typeof b.on !== "boolean") return answer(refuse(400, "on is true or false.", "Send {op: \"target\", name, on}."));
        if (typeof b.name !== "string" || !b.name) return answer(refuse(400, "name is missing.", "Give the declaration's full name."));
        // a target no longer in the graph (renamed, deleted) can still be taken off
        if (b.on) {
          const v = this.graph();
          if ("status" in v) return answer(v);
          const i = v.g.byName.get(b.name);
          if (i === undefined || v.g.isExt(i)) return answer(refuse(404, `${b.name} is not a declaration of the project.`, "A target is a declaration of the project, whose TCB is reviewed."));
        }
        const was = Object.hasOwn(d.targets, b.name);
        const r = this.record({ op: "target", name: b.name, by, on: b.on, ...agent }, who);
        // a target taken off leaves no trace in the review's state: the timeline keeps who did it
        if (r.status === 200 && was && !b.on) this.world.timeline.add({ kind: "untarget", by: me, ...agent, name: b.name });
        return r;
      }
      case "trust": {
        if (!validPrefix(b.prefix)) return answer(refuse(400, "prefix is not a dotted Lean name.", "A module or a namespace, e.g. Mathlib.Order or Nat; @external for the whole outside world."));
        if (typeof b.on !== "boolean") return answer(refuse(400, "on is true or false.", "Send {op: \"trust\", prefix, on}."));
        const was = d.trusted.includes(b.prefix);
        const r = this.record({ op: "trust", prefix: b.prefix, by, on: b.on, ...agent }, who);
        // the review's state keeps the list, not who changed it: the timeline does
        if (r.status === 200 && was !== b.on) this.world.timeline.add({ kind: b.on ? "trust" : "untrust", by: me, ...agent, prefix: b.prefix });
        return r;
      }
      case "key": {
        if (typeof b.on !== "boolean") return answer(refuse(400, "on is true or false.", "Send {op: \"key\", target, name, on}."));
        if (typeof b.target !== "string" || !b.target || b.target.length > 2000) return answer(refuse(400, "target is missing.", "Give the target's full name."));
        if (typeof b.name !== "string" || !b.name || b.name.length > 2000) return answer(refuse(400, "name is missing.", "Give the declaration's full name."));
        if (b.name === b.target) return answer(refuse(400, "A target is always key for itself.", "Mark the declarations its review holds that matter for reading it."));
        // a mark on what is gone from the graph, or from the review, can still be taken off
        if (b.on) {
          const v = this.graph();
          if ("status" in v) return answer(v);
          const t = v.g.byName.get(b.target);
          if (t === undefined || !Object.hasOwn(d.targets, b.target))
            return answer(refuse(409, `${b.target} is not a target.`, "Key declarations are a target's: mark it as a target first (☆ Mark as target)."));
          const i = v.g.byName.get(b.name);
          if (i === undefined) return answer(refuse(404, `There is no declaration ${b.name} in the graph.`, "Mark declarations of the graph, by full name."));
          if (!reviewSet(v.g, d, t)[i])
            return answer(
              refuse(409, `${b.name} is not among what the review of ${b.target} holds.`, "A key declaration is one of the declarations its target's review holds: its TCB without what is trusted, and the non-standard axioms it rests on."),
            );
        }
        return this.record({ op: "key", target: b.target, name: b.name, by, on: b.on, ...agent }, who);
      }
      default:
        return answer(refuse(400, "op is opinion, target, trust or key.", "Send {op, …}."));
    }
  }

  /** Append a writer's event to their log; the answer carries the change, which the page applies
   *  at once, and the event as written. */
  /** Whose an opinion is to be (ReviewSpec decision 8): the asker's own where `asked` is absent or
   *  names them; else another person's, recorded for them — by their link's id where `asked` is an
   *  invited person's name — and never an agent's, nor by an agent. */
  private voice(asked: unknown, who: Writer): { for?: string; forPerson?: string } | Refusal {
    if (asked === undefined) return {};
    if (who.agent) return refuse(403, "An agent records no opinion for anyone else.", "Leave out for: your opinion is your own, and advice.");
    if (typeof asked !== "string" || !asked.trim() || asked.trim().length > 120) return refuse(400, "for is the name of the person the opinion is recorded for, at most 120 characters.", "Send {op: \"opinion\", name, verdict, for: \"<their name>\"}.");
    const name = asked.trim();
    const held = this.world.invited?.(name);
    // one's own name, or one's own link: one's own opinion
    if (held ? held.id === who.person : name === who.name.trim()) return {};
    const d = this.world.review.data;
    const agentNamed = Object.values(d.opinions).some((ops) => ops.some((o) => o.agent && o.by === name)) || Object.values(d.targets).some((t) => t.agent && t.by === name);
    if (agentNamed) return refuse(400, `${name} is an agent: nobody records an opinion for an agent.`, "Record it for a person, or as your own.");
    return held ? { for: held.name, forPerson: held.id } : { for: name };
  }

  private record(op: ReviewOp, who: Writer): ReviewAnswer {
    return appended(this.world.review.append(who, op, this.world.project.toolchain));
  }
}

/** An append's result as an answer: the change and the event written (none where nothing changed:
 *  a target marked that is one), or why nothing was written. */
export function appended(r: AppendResult): ReviewAnswer {
  if ("status" in r) return { status: r.status, body: { error: r.error, hint: r.status === 409 ? "Mend that line of the log by hand (or ask its writer to); VisualProof never rewrites a log." : "Send {op, …}." } };
  return { status: 200, body: { ok: true, change: r.change, ...(r.change ? { event: r.event } : {}) } };
}
