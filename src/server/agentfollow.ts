// Following (docs/agent-api/following.md; AgentSpec decisions 1 and 7, CollabSpec decision 4), the
// endpoints of server/agent.ts: who is on the page and where each one looks (the companion), where the
// agent looks itself, which those following it see, and a link that opens exactly that; and a place
// in words, as the companion and the conversations tell it (placeOf).

import { ACTIVITY_KINDS, ACTIVITY_WHO, cleanView, MAX_PINNED, SCHEMES, validName } from "../shared/collab.ts";
import type { PaperWindow, Peer, PresenceView } from "../shared/collab.ts";
import { addressOf, readRegion, showing, writeSnapshot } from "../shared/sharesnap.ts";
import { parseQuery, printQuery, QueryError } from "../shared/query.ts";
import type { ReviewData } from "../shared/review.ts";
import { fileOf, linkOf } from "../shared/library.ts";
import { PROJECT, titleOfScope, viewTitle } from "../shared/views.ts";
import { focusOf, titleContext } from "./agentviews.ts";
import { agentKey } from "./presence.ts";
import { View } from "./agentgraph.ts";
import type { AgentApi, Answer, Ask } from "./agent.ts";
import { body, clampInt, fail, needAgent, ok, str, whoOf } from "./agent.ts";

/** Who is on the page and where each one is (AgentSpec decision 7): every person, with the place
 *  of their liveliest page, and the agents present; and how many private readers are here, who
 *  are not listed (CollabSpec decision 8). With `wait`, the answer waits until someone comes,
 *  goes or moves (the revision is not `since` any more), up to that many seconds. */
export async function companion(api: AgentApi, a: Ask): Promise<Answer> {
  const P = api.world.presence;
  const rawSince = a.query.get("since");
  const wait = clampInt(a.query.get("wait"), 0, 0, MAX_COMPANION_WAIT);
  let since: number | null = null;
  if (rawSince !== null && rawSince.trim() !== "") {
    since = Number(rawSince);
    if (!Number.isInteger(since) || since < 0) return fail(400, "since is a revision: the rev of an earlier answer.", "GET /api/agent/companion answers with rev; ask ?wait=30&since=<that rev> to wait for the next change.");
  }
  if (wait > 0) await P.waitChange(since ?? P.rev, wait * 1000);
  const mine = a.caller.kind === "agent" && a.caller.name ? agentKey(whoOf(a.caller)) : null;
  const peers = P.list();
  const people = new Map<string, Peer[]>();
  const agents: Record<string, unknown>[] = [];
  for (const p of peers) {
    if (p.agent) {
      agents.push({ name: p.name, idle: p.idle, ...(p.talk ? { state: p.talk.state, ...(p.talk.status ? { status: p.talk.status } : {}), lastSeen: p.talk.lastSeen } : {}), ...(p.id === mine ? { you: true } : {}), place: p.view ? placeOf(api, p.view) : null });
      continue;
    }
    const key = p.name ? `n:${p.name}` : `s:${p.id}`;
    people.set(key, [...(people.get(key) ?? []), p]);
  }
  const out = [...people.values()].map((ps) => {
    ps.sort((x, y) => Number(x.idle) - Number(y.idle));
    const p = ps[0];
    return { name: p.name, ...(p.verified ? { verified: true } : {}), idle: ps.every((x) => x.idle), pages: ps.length, place: p.view ? placeOf(api, p.view) : null };
  });
  out.sort((x, y) => Number(x.idle) - Number(y.idle) || (x.name ?? "\uffff").localeCompare(y.name ?? "\uffff"));
  // the person who shared with this agent, and whether they are here: the prompt does not say
  // where they are, this does
  const by = a.caller.token?.by;
  const sharedBy = by ? { name: by, here: out.some((p) => p.name === by) } : null;
  return ok({
    rev: P.rev,
    ...(since !== null ? { changed: P.rev !== since } : {}),
    now: new Date().toISOString(),
    ...(sharedBy ? { sharedBy } : {}),
    ...(sharedBy && !sharedBy.here ? { sharedByNote: `${by}, who shared with you, has no page open now: go on with what they asked; ?wait=60&since=<rev> tells you when someone comes.` } : {}),
    people: out,
    privateCount: P.privateCount(),
    agents,
    note: "privateCount: how many people are here privately — not listed, not followable, nothing known of where they are. Each person's place is that of their liveliest page: the view, the tool (how a click selects), what is selected (a query), the declaration their panel tells of, whether its source window is open (and collapsed), the source windows they pinned (pinned: declaration, collapsed), and, where their page says them, Activity (open, kind, who, mine: whose targets), the lost-and-found (lostAndFound.open), the colouring (kind or status), edges — all of which those following them see too. idle: no input for five minutes, or the page in the background. verified: invited by a personal link, so the name is theirs. To look where someone looks, POST /api/agent/view with their view and declaration; ?wait=<s>&since=<rev> waits for the next change (at most 60 s).",
  });
}

/** A page's or an agent's place, as the companion tells it (and a conversation's message, where
 *  its writer was): with its source windows, the one following the selection and those pinned,
 *  each collapsed or not (decided 2026-10-09: what a follower's windows mirror), the build it
 *  browses in the Time Machine (HistorySpec decision 18), and what else those following it see
 *  (CollabSpec decision 4, the owner's decision of 2026-10-11): Activity and its filters, the
 *  lost-and-found, the colouring, the edges — each where the page says it (an agent says none). */
export function placeOf(api: AgentApi, v: PresenceView): {
  view: string;
  viewTitle: string | null;
  mode: string;
  tool: string;
  selection: string | null;
  declaration: string | null;
  source: boolean;
  sourceCollapsed: boolean;
  pinned: { declaration: string; collapsed: boolean }[];
  inWords: string;
} & Record<string, unknown> {
  const on = v.view ? api.world.views.book.get(v.view) : undefined;
  const titles = titleContext(api.world);
  // a view nobody keeps that the server forgot is called by its query, as a page calls it
  const title = on ? viewTitle(on, titles) : v.scope ? titleOfScope(v.scope, titles) : v.view ? null : "Project";
  const tool = TOOL_NAMES[v.mode] ?? v.mode;
  const words =
    (on && on.id !== PROJECT ? `the view ${JSON.stringify(title)}` : v.scope ? `a view on ${v.scope}` : "the Project view") +
    (on?.targets ? `, ${on.targets.join(" and ")}'s view` : "") +
    (v.focus !== undefined ? (v.focus ? `, focused on ${v.focus} for themselves` : ", with no focus for themselves") : "") +
    (v.sel ? `, ${v.source ? "reading the source of" : "looking at"} ${v.sel}` : "") +
    (v.selection ? `, with ${v.selection} selected` : "") +
    (v.pinned?.length ? `, with the source of ${v.pinned.map((w) => w.decl).join(", ")} pinned` : "");
  const built = v.history ? api.world.history?.get(v.history.snapshot)?.at ?? null : null;
  const then = v.history ? `, in the Time Machine at snapshot ${v.history.snapshot}${built ? ` (built ${built})` : ""}` : "";
  // the panels and the board besides, in words where they are not as a page starts
  const a = v.activity;
  const shownBy = a?.open
    ? `, with Activity open${a.kind !== "all" ? ` on ${ACTIVITY_WORDS[a.kind]}` : ""}${a.who !== "all" ? `, ${a.who} only` : ""}${a.mine ? `, on ${a.mine}'s targets` : ""}`
    : v.lostFound?.open
      ? ", with the lost-and-found open"
      : "";
  const drawn =
    (v.scheme ? `, coloured by ${v.scheme}` : "") + (v.edges === false ? ", edges hidden" : "");
  return {
    view: v.view ?? PROJECT,
    viewTitle: title,
    ...(on?.targets ? { targets: [...on.targets] } : {}),
    ...(v.scope ? { scope: v.scope } : {}),
    mode: v.mode,
    tool,
    selection: v.selection ?? null,
    declaration: v.sel,
    source: v.source,
    sourceCollapsed: v.source && v.sourceCollapsed === true,
    pinned: (v.pinned ?? []).map((w) => ({ declaration: w.decl, collapsed: w.collapsed })),
    ...(v.history ? { history: { snapshot: v.history.snapshot, built } } : {}),
    ...(v.activity ? { activity: { ...v.activity } } : {}),
    ...(v.lostFound ? { lostAndFound: { open: v.lostFound.open } } : {}),
    ...(v.scheme ? { colouring: v.scheme } : {}),
    ...(v.edges !== undefined ? { edges: v.edges } : {}),
    inWords: words + then + shownBy + drawn + ".",
  };
}

export function viewPost(api: AgentApi, a: Ask): Answer {
  const no = needAgent(a.caller);
  if (no) return no;
  const me = whoOf(a.caller);
  const b = body(a);
  if (b.leave === true) {
    // an agent with a token that leaves is offline until it listens or asks again — unless its
    // MCP server says it is a session that a newer one replaced, which goes on
    if (a.caller.token && api.world.talk && !api.world.talk.left(a.caller.token.id, a.session ?? null)) return ok({ ok: true, left: false, note: "Another session of your token listens now: it stays." });
    api.world.presence.drop(agentKey(me));
    return ok({ ok: true, left: true });
  }
  const p = goingTo(api, a, b);
  if ("status" in p) return p;
  const { place: clean, temporary } = p;
  api.world.presence.agentBeat(me, clean);
  // what people who follow it see, said in words: the view, whose view it is (ViewSpec decision
  // 29), and the review's focus there — the agent's own, else the view's (decision 28)
  const on = clean.view ? api.world.views.book.get(clean.view) : undefined;
  const review = on?.targets ?? null;
  const focus = clean.focus !== undefined ? clean.focus : on ? focusOf(api.world, on) : null;
  const board =
    (on && on.id !== PROJECT ? `the view ${JSON.stringify(viewTitle(on, titleContext(api.world)))}` : "the Project view: everything") +
    (review ? `, ${review.join(" and ")}'s view` : "") +
    (focus ? `, the review focused on ${focus} with its strip (its whole review set, what the board does not hold shown as visitors)` : "");
  const paperFile = clean.paper ? fileOf(api.world.review.data, clean.paper.file) : null;
  const sel =
    (clean.sel ? `, looking at ${clean.sel}${clean.source ? " with its source open" : ""}` : "") +
    (clean.selection ? `, with ${clean.selection} selected` : "") +
    (paperFile ? `, with the reference window on ${JSON.stringify(paperFile.title)}${clean.paper!.page ? ` at page ${clean.paper!.page}` : ""}${clean.paper!.link ? ", the link lit" : ""}` : "");
  return ok({
    ok: true,
    view: clean,
    reviewView: review,
    followersSee: `${board}${sel}.`,
    ...(temporary ? { temporary: true, note: `${temporary} had no view: you are on a temporary view of its TCB, linked to it, as a person's click on it opens. The link lasts as long as the view: it goes when nobody is on it, unless someone keeps it — pins, folds or names it (views/arrange, views/rename) — and with it the link. POST /api/agent/views/link {id, target} links ${temporary} to another view.` } : {}),
  });
}

/** Where the agent would be with the fields of `b` over its own place, each checked as POST view
 *  takes it: where POST view puts it, and what POST view/link makes a link to. */
function goingTo(api: AgentApi, a: Ask, b: Record<string, unknown>): { place: PresenceView; temporary: string | null } | Answer {
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const was = api.world.presence.agentView(whoOf(a.caller)) ?? { mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [] };
  const next: PresenceView = { ...was, cam: null };
  if (b.mode !== undefined) {
    if (typeof b.mode !== "string" || !Object.hasOwn(TOOL_NAMES, b.mode))
      return fail(400, "mode is plain, deps, tcb, keys or apps.", "deps, tcb and keys are the steps of Rests on: what it uses, its TCB, the key declarations in its TCB; apps is what uses it.");
    next.mode = b.mode;
  }
  /** On a view (ViewSpec.md), as a page is: people following go to it, and a view nobody keeps
   *  lives while the agent is there. */
  const onView = (id: string): Answer | null => {
    const w = api.world.views.book.get(id);
    if (!w) return fail(404, `There is no view ${id}.`, "GET /api/agent/views lists them; POST /api/agent/views/open opens one on a query.");
    Object.assign(next, { view: w.id, scope: w.kept ? null : printQuery(w.scope), clusterMode: w.clustering, tabs: [...new Set([...next.tabs, w.id])].slice(-20) });
    return null;
  };
  if (b.view !== undefined) {
    const bad = b.view === null ? onView(PROJECT) : typeof b.view === "string" ? onView(b.view) : fail(400, "view is a view's id, or null for the Project.", "GET /api/agent/views lists them.");
    if (bad) return bad;
  }
  // a target with no view, asked for (`review`): the view nobody keeps a click on it opens
  let temporary: string | null = null;
  if (b.review !== undefined) {
    // a target's view, the one it is linked to (ViewSpec decision 29), as a click on the target
    // opens it; with none, a view nobody keeps of its TCB, linked to it while it lasts (the owner's
    // decision of 2026-10-11)
    if (b.review === null) {
      if (next.view && api.world.views.book.get(next.view)?.targets) onView(PROJECT);
    } else {
      const t = api.find(v, str(b.review), "review");
      if (typeof t !== "number") return t;
      const target = v.g.nodes[t].name;
      if (!api.world.review.data.targets[target])
        return fail(400, `${target} is not a target: it has no view of its own.`, "GET /api/agent/targets lists the targets; POST /api/agent/views/open opens a view on tcb(<name>) for anything else.");
      const linked = api.world.views.book.viewOf(target);
      if (!linked) temporary = target;
      const bad = onView((linked ?? api.world.views.openTarget(target, a.caller.name, true)).id);
      if (bad) return bad;
      next.mode = "tcb";
    }
  }
  if (b.sel !== undefined) {
    if (b.sel === null) next.sel = null;
    else {
      const j = api.find(v, str(b.sel), "sel");
      if (typeof j !== "number") return j;
      next.sel = v.g.nodes[j].name;
    }
  }
  if (b.selection !== undefined) {
    // what a page selects is a query (web/src/selection.ts): people who follow select the same
    if (b.selection === null) next.selection = null;
    else {
      const hint = "A query's text, its parts joined by or: decl(A.b) or tcb(A.c) or tcb(ns(A.D) except external).";
      if (typeof b.selection !== "string") return fail(400, "selection is a query's text, or null.", hint);
      try {
        next.selection = printQuery(parseQuery(b.selection));
      } catch (e) {
        if (!(e instanceof QueryError)) throw e;
        return fail(400, `selection: at ${e.at + 1}, ${e.message}.`, hint);
      }
    }
  }
  if (b.source !== undefined) next.source = b.source === true;
  // its own focus on its view, as a person's (ViewSpec decision 28): those following it take it;
  // on another view it starts from that view's own
  if (b.focus !== undefined) {
    // a tool's arguments say "view" and "none" where JSON says false and null
    if (b.focus === false || b.focus === "view") delete next.focus;
    else if (b.focus === null || b.focus === "none") next.focus = null;
    else {
      const t = api.find(v, str(b.focus), "focus");
      if (typeof t !== "number") return t;
      const target = v.g.nodes[t].name;
      if (!Object.hasOwn(api.world.review.data.targets, target)) return fail(400, `${target} is not a target: nothing can be focused on it.`, "GET /api/agent/targets lists the targets.");
      next.focus = target;
    }
  } else if (next.view !== was.view) delete next.focus;
  // the reference window shown to those who follow (AttachmentSpec decision 20): a link's place,
  // or a file of the library at a page; null closes it
  if (b.paper !== undefined) {
    const p = paperOf(api.world.review.data, b.paper);
    if (typeof p === "string") return fail(400, p, "paper is {link} (a link's id: its file at its place, lit), or {file, page?} (a file's SHA-256 and a page from 1), or null to close the window.");
    if (p) next.paper = p;
    else delete next.paper;
  }
  return { place: cleanView(next)!, temporary };
}

/** A link to what the agent looks at, or to a place it gives over its own, as a person's Share makes
 *  one with Exactly what I see (CollabSpec decision 7, the owner's decision of 2026-10-12): the
 *  address, and after it a snapshot of everything followed, which the page that opens it applies
 *  once. It moves nobody, the agent neither. It holds no key: it opens for whoever is let in. */
export async function viewLink(api: AgentApi, a: Ask): Promise<Answer> {
  const no = needAgent(a.caller);
  if (no) return no;
  const b = body(a);
  const p = goingTo(api, a, b);
  if ("status" in p) return p;
  const v = api.graph();
  if (!(v instanceof View)) return v;
  const place: Record<string, unknown> = { ...p.place };
  // what a page shows besides, which an agent's own place says nothing of: each as given, checked
  const bool = (k: string): Answer | null => {
    if (b[k] === undefined) return null;
    if (typeof b[k] !== "boolean") return fail(400, `${k} is true or false.`, "Leave it out for what the opener's page shows of its own.");
    place[k] = b[k];
    return null;
  };
  // (proofEdges, said until 2026-10-15, is no more: left as it is, as any word not known)
  const bad = bool("sourceCollapsed") ?? bool("edges");
  if (bad) return bad;
  if (b.lostFound !== undefined) {
    if (typeof b.lostFound !== "boolean") return fail(400, "lostFound is true (open) or false.", "The lost-and-found has no filters.");
    place.lostFound = { open: b.lostFound };
  }
  if (b.scheme !== undefined) {
    if (!SCHEMES.includes(b.scheme as never)) return fail(400, `scheme is ${SCHEMES.join(" or ")}.`, "The legend's colouring: by kind, or by the review's status.");
    place.scheme = b.scheme;
  }
  if (b.activity !== undefined) {
    const o = b.activity && typeof b.activity === "object" ? (b.activity as Record<string, unknown>) : null;
    const kind = o?.kind ?? "all", who = o?.who ?? "all";
    if (!o || typeof o.open !== "boolean" || !ACTIVITY_KINDS.includes(kind as never) || !ACTIVITY_WHO.includes(who as never) || (o.mine !== undefined && (typeof o.mine !== "string" || !validName(o.mine))))
      return fail(400, "activity is {open, kind?, who?, mine?}.", `open: true or false; kind: ${ACTIVITY_KINDS.join(", ")}; who: ${ACTIVITY_WHO.join(", ")}; mine: the name whose targets "My targets" keeps to.`);
    place.activity = { open: o.open, kind, who, ...(o.mine !== undefined ? { mine: o.mine } : {}) };
  }
  if (b.pinned !== undefined) {
    if (!Array.isArray(b.pinned) || b.pinned.length > MAX_PINNED) return fail(400, `pinned is a list of at most ${MAX_PINNED} windows, [{name, collapsed?}].`, "Each a source window pinned on a declaration, the first pinned first.");
    const pinned: { decl: string; collapsed: boolean }[] = [];
    for (const w of b.pinned) {
      const i = api.find(v, w && typeof w === "object" ? str((w as Record<string, unknown>).name) : null, "pinned's name");
      if (typeof i !== "number") return i;
      pinned.push({ decl: v.g.nodes[i].name, collapsed: (w as Record<string, unknown>).collapsed === true });
    }
    place.pinned = pinned;
  }
  if (b.history !== undefined && b.history !== null) {
    const id = b.history;
    if (!Number.isInteger(id) || !api.world.history?.get(id as number)) return fail(404, `There is no snapshot ${String(id)}.`, "history is a snapshot's id (GET /api/agent/history): the link opens the Time Machine at that build; null or left out for none.");
    place.history = { snapshot: id };
  }
  let region = null;
  if (b.region !== undefined && b.region !== null) {
    region = readRegion(b.region);
    if (!region) return fail(400, "region is [x, y, w, h]: a centre and a width and height, in the board's world.", "Leave it out, and the opener's page frames the board as for any link.");
  }
  const view = cleanView(place)!;
  const exact = b.exact !== false;
  // the build a view nobody keeps shows travels with its query, in the address
  const rec = view.view ? api.world.views.book.get(view.view) : undefined;
  const address = addressOf({ ...view, version: rec && !rec.kept ? rec.version ?? null : null });
  const shown = region ? showing(region) : null;
  const snap = exact ? await writeSnapshot({ ...view, cam: shown?.cam ?? null }, shown?.screen ?? null) : null;
  const link = `${a.base ?? ""}/#${address}${snap ? `&snap=${snap}` : ""}`;
  const { tabs: _tabs, cam: _cam, ...carried } = view;
  return ok({
    ok: true,
    link,
    exact,
    carries: exact ? { ...carried, ...(region ? { region } : {}) } : { view: view.view, scope: view.scope, mode: view.mode, selection: view.selection ?? null, sel: view.sel },
    length: link.length,
    note: "It holds no key: it opens for whoever is let in already — the people on this page. Opened, the page shows what it carries once, the region given framed on the opener's screen, and the reader is free after; what is no longer there is said in a line. To let someone new in, a person sends the guest link from Share.",
    ...(p.temporary ? { temporary: true } : {}),
  });
}

/** the longest the companion waits for someone to move, in seconds */
const MAX_COMPANION_WAIT = 60;

/** the tools, how a click selects, as the page names them (web/src/main.ts, MODE_NAME) */
/** The page's tools by name (web/src/main.ts): the modes Selection and Used by, and the three steps
 *  of the mode Rests on, Uses, TCB and Keys (ViewSpec decision 20). */
const TOOL_NAMES: Record<string, string> = { plain: "Selection", deps: "Uses", tcb: "TCB", keys: "Keys", apps: "Used by" };

/** Activity's kinds of event, as its filters name them (web/src/activity.ts) */
const ACTIVITY_WORDS: Record<string, string> = { review: "Review", build: "Builds", change: "Changes" };

/** What `view {paper}` asks the reference window to show: a link's place, or a file at a page; null to
 *  close it; or why it cannot. */
function paperOf(d: ReviewData, raw: unknown): PaperWindow | null | string {
  if (raw === null || raw === false) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "paper is an object.";
  const o = raw as Record<string, unknown>;
  if (o.link !== undefined) {
    const l = typeof o.link === "string" ? linkOf(d, o.link) : null;
    if (!l) return `There is no link ${String(o.link)}.`;
    return { file: l.file, ...(l.page ? { page: l.page } : {}), link: l.id };
  }
  const f = typeof o.file === "string" ? fileOf(d, o.file) : null;
  if (!f) return `The library has no file ${String(o.file)}.`;
  if (o.page !== undefined && (!Number.isInteger(o.page) || (o.page as number) < 1 || (f.pages && (o.page as number) > f.pages))) return `page is 1 to ${f.pages ?? "its last"}.`;
  return { file: f.sha, ...(o.page !== undefined ? { page: o.page as number } : f.type === "pdf" ? { page: 1 } : {}) };
}
