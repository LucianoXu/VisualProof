// The timeline as agents read it (docs/agent-api/history.md; CollabSpec decision 5), the endpoint of
// server/agent.ts: what the review's logs record — opinions and their withdrawals, targets, key
// marks, the library's files and links — and what the server's timeline holds, oldest first, since
// a time or an event, or about one declaration.

import { withoutReasons } from "../shared/timeline.ts";
import { noteNames } from "../shared/sticky.ts";
import type { AgentApi, Answer, Ask } from "./agent.ts";
import { clampInt, fail, ok } from "./agent.ts";

export function activity(api: AgentApi, a: Ask): Answer {
  const since = (a.query.get("since") ?? "").trim();
  const limit = clampInt(a.query.get("limit"), 100, 1, 1000);
  let after = "";
  if (since) {
    if (/^\d+$/.test(since)) {
      // an event id: what came after it
      const e = api.world.timeline.events.find((x) => x.id === Number(since));
      after = e?.at ?? "";
    } else if (!Number.isNaN(Date.parse(since))) after = new Date(since).toISOString();
    else return fail(400, "since is neither a time nor an event id.", "Give since=<ISO time>, e.g. the `now` of your last answer, or an event's id.");
  }
  const d = api.world.review.data;
  const out: Record<string, unknown>[] = [];
  // what the review's logs record, as the page reads it
  for (const [name, ops] of Object.entries(d.opinions))
    for (const o of ops) {
      out.push({ at: o.at, kind: "opinion", by: o.by, ...(o.recordedBy ? { recordedBy: o.recordedBy.by } : {}), agent: !!o.agent, name, verdict: o.verdict, ...(o.comment ? { comment: o.comment } : {}), ...(o.withdrawn ? { withdrawn: true } : {}) });
      // its withdrawal (ReviewSpec decision 9): whose it was, and who typed it for them
      const w = o.withdrawn;
      if (w) out.push({ at: w.at, kind: "withdrawal", by: o.by, ...(w.recordedBy ? { recordedBy: w.recordedBy.by } : {}), agent: !!o.agent, name, verdict: o.verdict, of: o.at });
    }
  // what an agent did at level full is marked as an agent's, as its advice is
  for (const [name, t] of Object.entries(d.targets)) out.push({ at: t.at, kind: "target", by: t.by, agent: !!t.agent, name });
  for (const [target, marks] of Object.entries(d.keys)) for (const [name, m] of Object.entries(marks)) out.push({ at: m.at, kind: "key", by: m.by, agent: !!m.agent, target, name });
  // the library's files and links (AttachmentSpec.md), as the review's history of them keeps
  // them: what was done, and what to — a file by its hash and its title then, a link by its id,
  // subject, label and file, an edit with what changed
  const WHAT = { file: "added", "file-edit": "edited", "file-archive": "archived", "file-restore": "restored", link: "made", "link-edit": "edited", unlink: "removed" } as const;
  for (const h of d.libraryHistory ?? []) {
    const { op, at, by, agent, person: _person, ...rest } = h;
    out.push({ at, kind: "sha" in h ? "file" : "link", what: WHAT[op], by, agent: !!agent, ...rest });
  }
  const undone = new Map<number, number>();
  for (const e of api.world.timeline.events) if (e.kind === "undo") undone.set(e.of, e.id);
  for (const e of api.world.timeline.events) {
    // a note of the kind agents left about a declaration before notes were on the board: not read
    if (e.kind === "note" && !("what" in e)) continue;
    // what someone did says whether an agent did it
    const who = "by" in e ? { agent: !!(e as { agent?: true }).agent } : {};
    if (e.kind === "layout") {
      // the operations themselves are the server's business: what moved, and whether it was undone
      const { ops, undo: _u, ...rest } = e;
      out.push({ ...rest, ...who, moved: ops.flatMap((o) => (o.op === "clear" ? [] : [o.key])).slice(0, 100), undoneBy: undone.get(e.id) ?? null });
    } else out.push({ ...withoutReasons(e), ...who });
  }
  const about = (a.query.get("name") ?? "").trim();
  // a note is about the declarations it names; a link, about the declaration it is on, or was on
  // before an edit
  const on = `decl(${about})`;
  const kept = out.filter((e) => (!after || (e.at as string) > after) && (!about || e.name === about || e.target === about || (e.kind === "note" && typeof e.text === "string" && noteNames(e.text).includes(about)) || (e.kind === "link" && (e.subject === on || e.wasSubject === on)))).sort((x, y) => ((x.at as string) < (y.at as string) ? -1 : (x.at as string) > (y.at as string) ? 1 : 0));
  return ok({ now: new Date().toISOString(), events: kept.slice(-limit), more: Math.max(0, kept.length - limit) });
}
