// Advice (AgentSpec decision 2, ReviewSpec decisions 8 and 9), the endpoints of server/agent.ts an
// agent gives its opinions by: on a declaration's present version, bound to the text it judged as
// the page's opinions are (server/reviewapi.ts); on several at once; and its own taken back. Advice
// is recorded marked as an agent's: shown apart, never counted, at every level. Nobody approves
// twice (ReviewSpec decision 1, the owner's decision of 2026-10-20): an approval of the version its
// advice approves already writes nothing, and is answered `unchanged`.

import { STANDARD_AXIOMS } from "../shared/review.ts";
import { appended } from "./reviewapi.ts";
import { View } from "./agentgraph.ts";
import type { AgentApi, Answer, Ask, Caller } from "./agent.ts";
import { body, fail, needAgent, ok, str } from "./agent.ts";

export function opinionPost(api: AgentApi, a: Ask): Answer {
  // several at once: as POST opinions answers them
  if (body(a).opinions !== undefined) return opinionsPost(api, a);
  const no = needAgent(a.caller) ?? api.refuse(a.caller, "advise");
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const r = advise(api, v, body(a), a.caller);
  if (r.status !== 200) return r;
  if ((r.body as { unchanged?: boolean }).unchanged) return ok({ ok: true, ...(r.body as object), counted: false });
  return ok({ ok: true, ...(r.body as object), counted: false, note: "Recorded as advice: shown apart to people, never counted." });
}

/** What an approval of the version one approved already is answered with: nothing was written. */
const UNCHANGED = "Your advice there is an approval of this version already: nothing was recorded, a comment with it neither. Withdraw it first (POST /api/agent/opinion/withdraw) to approve again with other words, or comment.";

/** The agent's advice on a declaration taken back (ReviewSpec decision 9): its own, never anyone
 *  else's; afterwards it has none there, its earlier advice not restored. A name the graph folds
 *  into a declaration is that declaration's; a name the graph no longer has keeps what was said of
 *  it, which can be withdrawn too. */
export function withdrawPost(api: AgentApi, a: Ask): Answer {
  const no = needAgent(a.caller) ?? api.refuse(a.caller, "advise");
  if (no) return no;
  const b = body(a);
  if (b.for !== undefined) return fail(403, "An agent withdraws its own advice alone.", "Leave out for: what you withdraw is your own advice.");
  const name = str(b.name)?.trim() ?? "";
  if (!name) return fail(400, "name is missing.", "Give the full name of the declaration you advised on.");
  const v = api.graph();
  const folded = v instanceof View && !v.g.byName.has(name) ? v.g.foldedInto.get(name) : undefined;
  const unit = folded === undefined ? name : (v as View).g.nodes[folded].name;
  const r = api.reviews.post({ op: "withdraw", name: unit }, { name: a.caller.name!, agent: true });
  const rb = r.body as { error?: string; hint?: string; withdrawn?: unknown };
  if (r.status !== 200) return fail(r.status, rb.error ?? "Refused.", rb.hint ?? "GET /api/agent describes this endpoint.");
  return ok({ ok: true, withdrawn: rb.withdrawn, ...(unit !== name ? { asked: name, foldedInto: unit } : {}), note: "Your advice there is withdrawn: you have none on it now, and your earlier advice is not restored. It stays in the history." });
}

/** Advice on several declarations at once: each item is checked and recorded as one opinion
 *  would be, and answered on its own — one refused does not refuse the others. */
export function opinionsPost(api: AgentApi, a: Ask): Answer {
  const no = needAgent(a.caller) ?? api.refuse(a.caller, "advise");
  if (no) return no;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const items = body(a).opinions;
  if (!Array.isArray(items) || !items.length || items.length > MAX_OPINIONS)
    return fail(400, `opinions is a list of 1 to ${MAX_OPINIONS} {name, verdict, comment}.`, 'Send {"opinions": [{"name": …, "verdict": "approve", "comment": …}, …]}.');
  const results = items.map((x, k) => {
    const r = advise(api, v, x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {}, a.caller);
    return { index: k, name: (x as { name?: unknown } | null)?.name ?? null, status: r.status, ...(r.body as object) };
  });
  const done = results.filter((r) => r.status === 200);
  // an approval of the version it approved already writes nothing (ReviewSpec decision 1)
  const unchanged = done.filter((r) => (r as { unchanged?: boolean }).unchanged).length;
  const recorded = done.length - unchanged;
  return ok({ ok: true, recorded, ...(unchanged ? { unchanged } : {}), refused: items.length - done.length, counted: false, note: "Each item is answered on its own (its status); what was recorded is advice: shown apart to people, never counted.", results });
}

/** Check and record one piece of advice: the answer is `{recorded}`, or why it is refused. What
 *  it is about — the declaration's hash and the text judged — is bound as the page's opinions are
 *  (server/reviewapi.ts). */
function advise(api: AgentApi, v: View, b: Record<string, unknown>, me: Caller): Answer {
  const name = str(b.name)?.trim() ?? "";
  // an axiom the target rests on that the graph has no declaration for is advised on by its name
  const named = !v.g.byName.has(name) && v.meta.axioms.includes(name) && !STANDARD_AXIOMS.includes(name);
  // a name folded into a declaration is advice on that declaration, which the answer names
  let unit = name;
  if (!named) {
    const i = api.find(v, name);
    if (typeof i !== "number") return i;
    unit = v.g.nodes[i].name;
  }
  const verdict = b.verdict;
  // an agent's advice is its own: people record for one another at one screen, agents never
  // (ReviewSpec decision 8)
  if (b.for !== undefined) return fail(403, "An agent records no opinion for anyone else.", "Leave out for: your advice is your own.");
  // "dispute" was the old name of a comment (renamed 2026-10-09): refused, with the new name
  if (verdict === "dispute") return fail(400, "verdict is approve or comment: \"dispute\" is now \"comment\".", "Use comment: send {name, verdict: \"comment\", comment}.");
  if (verdict !== "approve" && verdict !== "comment") return fail(400, "verdict is approve or comment.", "Send {name, verdict, comment}.");
  const comment = typeof b.comment === "string" ? b.comment.trim() : "";
  if (b.comment !== undefined && typeof b.comment !== "string") return fail(400, "comment is text.", "Send the reasons as a string.");
  if (verdict === "comment" && !comment) return fail(400, "A comment needs text: say what is wrong, unclear or worth checking.", "People start with what you comment on; tell them where to look and why.");
  if (comment.length > 10000) return fail(400, "The comment is longer than 10,000 characters.", "Say it shorter; a note (POST /api/agent/note) can carry more.");
  const x = api.reviews.bind(v, unit);
  if ("status" in x) return fail(x.status, x.error, x.status === 409 ? "Wait for the build, then advise again; GET /api/agent/source shows what changed." : x.hint);
  // advice is about one version of a declaration: one without a content hash (outside the project)
  // has no version to be about, and would never show as given on an earlier one — except a
  // non-standard axiom, which needs review whatever it is, by its name
  if (!x.hash && !x.axiom) return fail(400, `${x.name} is outside the project: there is no version of it to advise on.`, "Advise on the project's own declarations; a note (POST /api/agent/note) can point people at an outside one.");
  const judged = x.text !== undefined ? { text: x.text } : x.statement !== undefined ? { statement: x.statement } : {};
  const r = api.world.review.append(
    { name: me.name ?? "", agent: true },
    { op: "opinion", name: x.name, by: me.name ?? "", verdict, ...(comment ? { comment } : {}), ...(x.hash ? { hash: x.hash } : {}), ...judged, agent: true },
    api.world.project.toolchain,
  );
  if ("status" in r) {
    const a = appended(r);
    return { status: a.status, body: a.body };
  }
  const folded = unit !== name ? { asked: name, foldedInto: unit } : {};
  // nobody approves twice (ReviewSpec decision 1, the owner's decision of 2026-10-20): its advice
  // there is an approval of this version already, and nothing is written, the words with it neither
  if (!r.change) return ok({ unchanged: true, name: x.name, note: UNCHANGED, ...folded });
  return ok({ recorded: { name: x.name, verdict, ...(comment ? { comment } : {}), hash: x.hash ?? null, judged: judged.text !== undefined ? "source" : judged.statement !== undefined ? "statement" : null }, ...folded });
}

export const MAX_OPINIONS = 100;
