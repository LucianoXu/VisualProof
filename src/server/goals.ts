// Lean's answers about goals, read for the InfoView (ReviewSpec, "The InfoView"; shared/goals.ts):
// its plain ones (`$/lean/plainGoal`, `$/lean/plainTermGoal`) and its interactive ones, through its
// RPC (`Lean.Widget.getInteractiveGoals`, `getInteractiveTermGoal`), whose text is tagged with what
// each subterm is: a reference into the RPC session (`{p: "12"}`), which Lean answers
// `infoToInteractive` about (the subterm's type and doc). A page is never given a reference: each
// subterm is numbered in the answer (`k`), and the server asks Lean by the reference it holds for
// that number. What is read is checked and bounded: a goal whose text runs past what a page shows
// is cut, and past a number of subterms the rest is text alone.

import { CHANGES } from "../shared/goals.ts";
import type { Change, Goal, Hyp, Tagged, TermGoal } from "../shared/goals.ts";
import { parsePlainGoal } from "../shared/goals.ts";

/** A reference Lean holds for an RPC session, as it gives it. */
export interface RpcRef {
  p: string;
}

/** the most subterms numbered in one answer: past it, the rest is text */
export const MAX_TAGS = 20_000;
/** the most characters of goals one answer carries, all its texts together */
export const MAX_TEXT = 400_000;
/** how deep a tagged text is read: deeper, it is text */
const MAX_DEPTH = 400;

const isRef = (x: unknown): x is RpcRef => !!x && typeof x === "object" && typeof (x as RpcRef).p === "string" && (x as RpcRef).p.length <= 64;

/** What one answer reads: the references its subterms are numbered by (`refs[k]`), and what is
 *  left of its bounds. */
export class Reading {
  refs: RpcRef[] = [];
  text = 0;
  cut = false;

  /** Lean's tagged text (`CodeWithInfos`: `{text}`, `{append: […]}`, `{tag: [info, text]}`) read
   *  as the page's; a subterm numbered by its reference. */
  code(c: unknown, depth = 0): Tagged {
    if (!c || typeof c !== "object") return "";
    if (depth > MAX_DEPTH) return this.take(plainText(c));
    const o = c as Record<string, unknown>;
    if (typeof o.text === "string") return this.take(o.text);
    if (Array.isArray(o.append)) {
      const parts = o.append.map((x) => this.code(x, depth + 1)).filter((x) => x !== "");
      return parts.length === 1 ? parts[0] : parts;
    }
    if (Array.isArray(o.tag) && o.tag.length === 2) {
      const [info, inner] = o.tag as [Record<string, unknown> | null, unknown];
      const t = this.code(inner, depth + 1);
      const ref = info && typeof info === "object" ? info.info : null;
      if (!isRef(ref) || this.refs.length >= MAX_TAGS || this.cut) return t;
      const d = info!.diffStatus;
      this.refs.push(ref);
      return { k: this.refs.length - 1, t, ...(CHANGES.includes(d as Change) ? { d: d as Change } : {}) };
    }
    return "";
  }

  /** a text, within what is left of the answer's */
  private take(s: string): string {
    if (this.cut) return "";
    const left = MAX_TEXT - this.text;
    if (s.length <= left) {
      this.text += s.length;
      return s;
    }
    this.cut = true;
    this.text = MAX_TEXT;
    return s.slice(0, Math.max(0, left)) + "…";
  }

  /** A hypothesis bundle as Lean gives it (`InteractiveHypothesisBundle`). */
  hyp(h: unknown): Hyp | null {
    if (!h || typeof h !== "object") return null;
    const o = h as Record<string, unknown>;
    const names = Array.isArray(o.names) ? o.names.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 300)) : [];
    if (!names.length) return null;
    const d = o.isInserted === true ? "inserted" : o.isRemoved === true ? "removed" : undefined;
    return { names, type: this.code(o.type), ...(o.val ? { val: this.code(o.val) } : {}), ...(d ? { d } : {}) };
  }

  /** A goal as Lean gives it (`InteractiveGoal`). */
  goal(g: unknown): Goal | null {
    if (!g || typeof g !== "object") return null;
    const o = g as Record<string, unknown>;
    const hyps = (Array.isArray(o.hyps) ? o.hyps : []).map((h) => this.hyp(h)).filter((h): h is Hyp => h !== null);
    const d = o.isInserted === true ? "inserted" : o.isRemoved === true ? "removed" : undefined;
    const prefix = typeof o.goalPrefix === "string" && o.goalPrefix.length <= 8 ? o.goalPrefix : "⊢ ";
    return { ...(typeof o.userName === "string" && o.userName ? { case: o.userName.slice(0, 300) } : {}), hyps, type: this.code(o.type), prefix, ...(d ? { d } : {}) };
  }
}

/** Lean's interactive goals (`InteractiveGoals`, `{goals}`), or null where it has none there. */
export function readInteractiveGoals(r: unknown, reading: Reading): Goal[] | null {
  if (!r || typeof r !== "object" || !Array.isArray((r as { goals?: unknown }).goals)) return null;
  return (r as { goals: unknown[] }).goals.map((g) => reading.goal(g)).filter((g): g is Goal => g !== null);
}

/** Lean's interactive term goal (`InteractiveTermGoal`: hypotheses, type, range), or null. */
export function readInteractiveTermGoal(r: unknown, reading: Reading): TermGoal | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const range = readRange(o.range);
  if (!range) return null;
  const hyps = (Array.isArray(o.hyps) ? o.hyps : []).map((h) => reading.hyp(h)).filter((h): h is Hyp => h !== null);
  return { hyps, type: reading.code(o.type), range };
}

/** Lean's plain goals (`PlainGoal`: `{goals: [text], rendered}`), or null. */
export function readPlainGoals(r: unknown): Goal[] | null {
  if (!r || typeof r !== "object" || !Array.isArray((r as { goals?: unknown }).goals)) return null;
  let left = MAX_TEXT;
  return (r as { goals: unknown[] }).goals
    .filter((g): g is string => typeof g === "string")
    .map((g) => {
      const s = g.length > left ? g.slice(0, Math.max(0, left)) + "…" : g;
      left = Math.max(0, left - g.length);
      return parsePlainGoal(s);
    });
}

/** Lean's plain term goal (`PlainTermGoal`: `{goal: text, range}`), or null. */
export function readPlainTermGoal(r: unknown): TermGoal | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const range = readRange(o.range);
  if (typeof o.goal !== "string" || !range) return null;
  const g = parsePlainGoal(o.goal.slice(0, MAX_TEXT));
  return { hyps: g.hyps, type: g.type, range };
}

/** An LSP range as [line, character, endLine, endCharacter]. */
function readRange(r: unknown): TermGoal["range"] | null {
  const o = r as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } } | null;
  const ns = [o?.start?.line, o?.start?.character, o?.end?.line, o?.end?.character];
  return ns.every((n) => Number.isInteger(n) && (n as number) >= 0) ? (ns as TermGoal["range"]) : null;
}

/** What Lean says of a subterm (`InfoPopup`: its type, the term with its implicit arguments, its
 *  constant's doc), as text. */
export function readInfo(r: unknown): { expr?: string; type?: string; doc?: string } {
  if (!r || typeof r !== "object") return {};
  const o = r as Record<string, unknown>;
  const text = (c: unknown) => {
    const reading = new Reading();
    const t = reading.code(c);
    const flat = (x: Tagged): string => (typeof x === "string" ? x : Array.isArray(x) ? x.map(flat).join("") : flat(x.t));
    return flat(t);
  };
  return {
    ...(o.exprExplicit ? { expr: text(o.exprExplicit) } : {}),
    ...(o.type ? { type: text(o.type) } : {}),
    ...(typeof o.doc === "string" && o.doc ? { doc: o.doc.slice(0, 20_000) } : {}),
  };
}

/** How many widgets Lean has at a place (`GetWidgetsResponse`, `{widgets: […]}`): only counted. */
export function readWidgets(r: unknown): number {
  const ws = r && typeof r === "object" ? (r as { widgets?: unknown }).widgets : null;
  return Array.isArray(ws) ? ws.length : 0;
}

/** Every reference Lean gave in an answer, to release it when the answer is let go: walked with a
 *  stack of its own, however deep the answer is. */
export function refsIn(x: unknown): RpcRef[] {
  const out: RpcRef[] = [];
  const stack: unknown[] = [x];
  while (stack.length) {
    const y = stack.pop();
    if (!y || typeof y !== "object") continue;
    if (Array.isArray(y)) {
      for (const z of y) stack.push(z);
      continue;
    }
    const o = y as Record<string, unknown>;
    if (isRef(o) && Object.keys(o).length === 1) out.push({ p: o.p });
    else for (const v of Object.values(o)) stack.push(v);
  }
  return out;
}

/** A tagged text's characters alone, read with a stack of its own: what is deeper than a page
 *  reads tags in. */
function plainText(c: unknown): string {
  let out = "";
  const stack: unknown[] = [c];
  while (stack.length) {
    const y = stack.pop();
    if (!y || typeof y !== "object") continue;
    const o = y as Record<string, unknown>;
    if (typeof o.text === "string") out += o.text;
    else if (Array.isArray(o.append)) for (let i = o.append.length - 1; i >= 0; i--) stack.push(o.append[i]);
    else if (Array.isArray(o.tag) && o.tag.length === 2) stack.push(o.tag[1]);
  }
  return out;
}
