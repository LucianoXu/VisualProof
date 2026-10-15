// Moves (HistorySpec.md, the owner's decisions of 2026-10-09): what was said about a declaration
// follows it to another name. A move is an event of the review's logs, appended like any other and
// never rewritten: replayed, it carries the opinions given on `from` (their comments with them), its
// target mark and the key marks on it — as a declaration of a target's review, and as a target —
// over to `to`. Each thing carried keeps the names it was on before (`was`), so that undoing a move,
// an un-move (`on: false`), takes back exactly what that move carried and leaves what was said of
// `to` since. A move the server found as a rename, or one a person made onto a declaration that
// appeared as the other went, also says that `to` *is* `from` renamed (`rename`): the version of
// whatever refers to it is then made with `from`'s identity (TCBSpec decision 3), so that renaming
// it stales nothing. Since 2026-10-11 a move carries the links on the declaration too
// (AttachmentSpec decision 6): a link on `decl(from)` is on `decl(to)` after it, its `was` saying
// where it was. Moving a note's mention, a pin or a view's scope is the views' business
// (server/views.ts); this file is what the server and the pages replay.
//
// Declarations are keyed by name; every object keyed by names here has no prototype, as in
// shared/review.ts.

import type { Query } from "./query.ts";

export interface MoveEvent {
  op: "move";
  at: string;
  by: string;
  from: string;
  to: string;
  /** true: carried over; false: an un-move, which takes back what the move from `from` to `to`
   *  carried */
  on: boolean;
  /** `to` is `from` renamed: what refers to it keeps its version */
  rename?: true;
  /** the server found it (a rename of high confidence): why it is sure; only in the server's log */
  auto?: string;
  /** the snapshot of the build it was found at (server/history.ts) */
  snap?: number;
  agent?: true;
  /** made by someone invited by a personal link, in their log: the link's id (CollabSpec decision 9) */
  person?: string;
}

/** What a move carries, as a review holds it. Only the fields a move reads and writes. */
interface Movable {
  /** the names it was given on before the moves that brought it here, oldest first */
  was?: string[];
}

interface Data {
  targets: Record<string, Movable>;
  opinions: Record<string, (Movable & { at: string })[]>;
  keys: Record<string, Record<string, Movable & { wasOf?: string[] }>>;
  /** `to` → `from` for each rename in force: what identities are read from */
  renamed?: Record<string, string>;
  /** the links into the library's files (shared/library.ts), by subject */
  links?: (Movable & { subject: string })[];
}

/** A declaration as a link's subject names it (shared/library.ts, declSubject). */
const declOf = (name: string) => `decl(${name})`;

const own = (o: object, k: string) => Object.hasOwn(o, k);
const noProto = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const byTime = <T extends { at: string }>(xs: T[]) => xs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

/** One move replayed onto a review. */
export function applyMove(d: Data, e: MoveEvent): void {
  if (e.from === e.to) return;
  if (e.on) carry(d, e.from, e.to);
  else takeBack(d, e.from, e.to);
  if (!e.rename) return;
  const links = (d.renamed ??= noProto<string>());
  if (e.on) {
    // renamed back (`to` is where `from` came from): `to` is itself again, and `from` is no one's
    if (identityIn(links, e.from) === e.to) {
      delete links[e.to];
      delete links[e.from];
    } else links[e.to] = e.from;
  } else if (own(links, e.to) && links[e.to] === e.from) delete links[e.to];
}

function carry(d: Data, from: string, to: string): void {
  const moved = <T extends Movable>(x: T): T => ({ ...x, was: [...(x.was ?? []), from] });
  if (own(d.opinions, from)) {
    const os = d.opinions[from].map(moved);
    delete d.opinions[from];
    d.opinions[to] = byTime([...(own(d.opinions, to) ? d.opinions[to] : []), ...os]);
  }
  if (own(d.targets, from)) {
    if (!own(d.targets, to)) d.targets[to] = moved(d.targets[from]);
    delete d.targets[from];
  }
  // a key mark on it, in each target's review
  for (const t of Object.keys(d.keys)) {
    const ks = d.keys[t];
    if (!own(ks, from)) continue;
    if (!own(ks, to)) ks[to] = moved(ks[from]);
    delete ks[from];
  }
  // its own key marks, as a target
  if (own(d.keys, from)) {
    const ks = (own(d.keys, to) ? d.keys[to] : (d.keys[to] = noProto()));
    for (const [n, m] of Object.entries(d.keys[from])) if (n !== to && !own(ks, n)) ks[n] = { ...m, wasOf: [...(m.wasOf ?? []), from] };
    delete d.keys[from];
  }
  // the links on it, in the order they were made
  if (d.links) d.links = d.links.map((l) => (l.subject === declOf(from) ? { ...moved(l), subject: declOf(to) } : l));
}

function takeBack(d: Data, from: string, to: string): void {
  const came = (x: Movable) => x.was?.[x.was.length - 1] === from;
  const back = <T extends Movable>(x: T): T => {
    const was = x.was!.slice(0, -1);
    const y = { ...x };
    if (was.length) y.was = was;
    else delete y.was;
    return y;
  };
  if (own(d.opinions, to)) {
    const all = d.opinions[to];
    const os = all.filter(came);
    if (os.length) {
      const stay = all.filter((o) => !came(o));
      if (stay.length) d.opinions[to] = stay;
      else delete d.opinions[to];
      d.opinions[from] = byTime([...(own(d.opinions, from) ? d.opinions[from] : []), ...os.map(back)]);
    }
  }
  if (own(d.targets, to) && came(d.targets[to])) {
    if (!own(d.targets, from)) d.targets[from] = back(d.targets[to]);
    delete d.targets[to];
  }
  for (const t of Object.keys(d.keys)) {
    const ks = d.keys[t];
    if (!own(ks, to) || !came(ks[to])) continue;
    if (!own(ks, from)) ks[from] = back(ks[to]);
    delete ks[to];
  }
  if (own(d.keys, to)) {
    const ks = d.keys[to];
    const marks = Object.entries(ks).filter(([, m]) => m.wasOf?.[m.wasOf.length - 1] === from);
    if (marks.length) {
      const into = own(d.keys, from) ? d.keys[from] : (d.keys[from] = noProto());
      for (const [n, m] of marks) {
        const wasOf = m.wasOf!.slice(0, -1);
        const y = { ...m };
        if (wasOf.length) y.wasOf = wasOf;
        else delete y.wasOf;
        if (!own(into, n)) into[n] = y;
        delete ks[n];
      }
      if (!Object.keys(ks).length) delete d.keys[to];
    }
  }
  if (d.links) d.links = d.links.map((l) => (l.subject === declOf(to) && came(l) ? { ...back(l), subject: declOf(from) } : l));
}

/** The identity of a unit's name under the renames in force (`renamed`: `to` → `from`): the first
 *  name it had, followed back through each rename. */
export function identityIn(renamed: Record<string, string> | undefined, name: string): string {
  if (!renamed) return name;
  let n = name;
  // a chain is as long as the renames of one declaration; a loop cannot be made (applyMove), but a
  // log edited by hand could hold one
  for (let k = 0; k < 1000 && own(renamed, n); k++) {
    const p = renamed[n];
    if (p === name) break;
    n = p;
  }
  return n;
}

/** Whether a move would change nothing: nothing to carry or take back, and no identity to link or
 *  unlink. Such a request writes nothing. */
export function moveIsIdle(d: Data, e: Pick<MoveEvent, "from" | "to" | "on" | "rename">): boolean {
  if (e.from === e.to) return true;
  const came = (x: Movable) => x.was?.[x.was.length - 1] === e.from;
  const links = d.renamed ?? noProto<string>();
  if (e.on) {
    const carries =
      own(d.opinions, e.from) || own(d.targets, e.from) || own(d.keys, e.from) || Object.values(d.keys).some((ks) => own(ks, e.from)) || !!d.links?.some((l) => l.subject === declOf(e.from));
    return !carries && (!e.rename || (own(links, e.to) && links[e.to] === e.from));
  }
  const back =
    (own(d.opinions, e.to) && d.opinions[e.to].some(came)) ||
    (own(d.targets, e.to) && came(d.targets[e.to])) ||
    Object.values(d.keys).some((ks) => own(ks, e.to) && came(ks[e.to])) ||
    (own(d.keys, e.to) && Object.values(d.keys[e.to]).some((m) => m.wasOf?.[m.wasOf.length - 1] === e.from)) ||
    !!d.links?.some((l) => l.subject === declOf(e.to) && came(l));
  return !back && !(e.rename && own(links, e.to) && links[e.to] === e.from);
}

/** A move's line, read: the event, or why it is not one. */
export function readMove(o: Record<string, unknown>, at: string, by: string, agent: boolean): MoveEvent | string {
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!str(o.from, 2000)) return "from";
  if (!str(o.to, 2000)) return "to";
  if (o.from === o.to) return "a move to the same name";
  if (typeof o.on !== "boolean") return "on";
  if (o.rename !== undefined && o.rename !== true) return "rename";
  if (o.auto !== undefined && !str(o.auto, 200)) return "auto";
  if (o.snap !== undefined && !(Number.isInteger(o.snap) && (o.snap as number) > 0)) return "snap";
  return {
    op: "move",
    at,
    by,
    from: o.from as string,
    to: o.to as string,
    on: o.on,
    ...(o.rename ? { rename: true as const } : {}),
    ...(o.auto !== undefined ? { auto: o.auto as string } : {}),
    ...(o.snap !== undefined ? { snap: o.snap as number } : {}),
    ...(agent ? { agent: true as const } : {}),
  };
}

/** A view's scope with declaration `from` named `to` instead: in `decl(…)`, the roots of a closure,
 *  and the targets of `key(…)`. The same object where it does not name it. */
export function renameInQuery(q: Query, from: string, to: string): Query {
  const names = (xs: string[]) => (xs.includes(from) ? [...new Set(xs.map((x) => (x === from ? to : x)))] : xs);
  switch (q.op) {
    case "decl": {
      const n = names(q.names);
      return n === q.names ? q : { ...q, names: n };
    }
    case "tcb":
    case "uses":
    case "usedBy":
    case "refs": {
      if (q.of === "selection") return q;
      if (Array.isArray(q.of)) {
        const n = names(q.of);
        return n === q.of ? q : { ...q, of: n };
      }
      const of = renameInQuery(q.of, from, to);
      return of === q.of ? q : { ...q, of };
    }
    case "key": {
      if (q.of === "targets") return q;
      const n = names(q.of);
      return n === q.of ? q : { ...q, of: n };
    }
    case "and":
    case "or":
    case "except": {
      const a = renameInQuery(q.a, from, to);
      const b = renameInQuery(q.b, from, to);
      return a === q.a && b === q.b ? q : { ...q, a, b };
    }
    default:
      return q;
  }
}

/** A note's text with declaration `from`, written in full between backticks, named `to` instead
 *  (`` `A.f` `` → `` `A.g` ``); the same text where it does not mention it so. */
export function renameInNote(text: string, from: string, to: string): string {
  return text.includes("`" + from + "`") ? text.split("`" + from + "`").join("`" + to + "`") : text;
}
