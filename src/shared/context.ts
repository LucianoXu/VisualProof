// The context a declaration is read in (TCBSpec.md, decision 4): what is in force where it is
// written — its namespaces and sections, what is opened, the `variable`s, universes, local and
// scoped notation, instances and attributes, options — shown with its text as a block of Lean, and
// recorded with it as the text an opinion judged. The page (the source window, the text an opinion
// is compared with), the server (server/reviewapi.ts, which binds what an opinion judged) and the
// agents' API (server/agent.ts) all read it here, so all three say the same.
//
// It comes from the usage pass (server/usage.ts) where that elaborated the module: the elaborator's
// own scope before the command, in the same shape (FileContext, `exact`), with the opens resolved and
// the variables Lean included in the declaration marked. Elsewhere — a module the pass has not
// reached or could not elaborate, a file changed since it was compiled — it is read from the file's
// text (shared/scope.ts, `contextAt`), without elaborating it. `readContext` is the one place that
// chooses.

import { excerptOf } from "./excerpt.ts";
import type { DeclarationText } from "./excerpt.ts";
import { contextAt } from "./scope.ts";
import type { FileContext } from "./scope.ts";

export type { FileContext } from "./scope.ts";

/** One command of the context, as Lean syntax. */
export interface ContextLine {
  /** 1-based line of the file where it is written */
  line: number;
  kind: "namespace" | "section" | "mutual" | "open" | "variable" | "universe" | "option" | "local";
  /** the command, as written (comments taken out, its lines joined) */
  text: string;
  /** for a `variable`: the names it binds */
  binds?: string[];
  /** for a `variable`: Lean included it in the declaration (an exact context only) */
  used?: true;
}

/** The usage pass's contexts of one module (server/usage.ts, RawUsage): those its commands are
 *  written in, and for each unit which one, with the variables Lean included in it. */
export interface ModuleContexts {
  /** the Lake hash of the text they were read from: the module's compiled text */
  hash: string;
  contexts: FileContext[];
  /** a unit's name → the index of its context, then the indices of the `variables` of that
   *  context Lean included in it */
  decls: Record<string, number[]>;
}

/** The elaborator's context for the unit `name`, when the pass has one for its module and the text
 *  read now (Lake hash `hash`) is the one it elaborated; null otherwise. */
export function exactContext(m: ModuleContexts | null | undefined, name: string, hash: string | null | undefined): FileContext | null {
  if (!m || !hash || m.hash !== hash) return null;
  const d = m.decls[name];
  const c = d && m.contexts[d[0]];
  if (!c) return null;
  const used = new Set(d.slice(1));
  return { ...c, exact: true, variables: c.variables.map((v, k) => (used.has(k) ? { ...v, used: true as const } : v)) };
}

/** The context in force at line `upto` (0-based) of a file, where a declaration's text starts: the
 *  elaborator's (`exactContext`) where there is one, else read from the text. */
export function readContext(lines: string[], upto: number, exact: FileContext | null = null): FileContext {
  if (exact) return exact;
  // the block is the text as written: which namespaces of the graph an `open` brings in is not
  // part of it, so it is the same wherever it is read
  return contextAt(lines, upto, () => false);
}

/** The context as commands of Lean, in the order they are written. */
export function contextLines(c: FileContext): ContextLine[] {
  const out: ContextLine[] = [];
  const inn = (x: { in?: true }) => (x.in ? " in" : "");
  for (const b of c.blocks) {
    const text =
      b.kind === "namespace" ? `namespace ${b.name}`
      : b.kind === "mutual" ? "mutual"
      : `${b.noncomputable ? "noncomputable " : ""}section${b.name ? ` ${b.name}` : ""}`;
    out.push({ line: b.line, kind: b.kind, text });
  }
  for (const o of c.opens) out.push({ line: o.line, kind: "open", text: o.text + inn(o) });
  for (const v of c.variables) out.push({ line: v.line, kind: "variable", text: `variable ${v.text}${inn(v)}`, binds: binderNames(v.text), ...(v.used ? { used: true as const } : {}) });
  for (const u of c.universes) out.push({ line: u.line, kind: "universe", text: `universe ${u.text}` });
  for (const o of c.options) out.push({ line: o.line, kind: "option", text: `set_option ${o.text}${inn(o)}` });
  for (const x of c.local) out.push({ line: x.line, kind: "local", text: x.text + inn(x) });
  // a block opens before what is written in it on the same line (never, in practice)
  const rank = (k: ContextLine["kind"]) => (k === "namespace" || k === "section" || k === "mutual" ? 0 : 1);
  return out.sort((a, b) => a.line - b.line || rank(a.kind) - rank(b.kind));
}

/** The context as one block of Lean, a command per line; "" where nothing is in force. */
export function contextText(c: FileContext): string {
  return contextLines(c)
    .map((l) => l.text)
    .join("\n");
}

/** The text an opinion records as judged: the context block, a blank line, then the declaration's
 *  text; just the text where no context is in force. */
export function withContext(context: string, text: string): string {
  return context ? `${context}\n\n${text}` : text;
}

/** What an opinion on the declaration `name` judges, in its file's `lines`: its context and its
 *  text, as the source window shows them. `edited`: the file is not the text that was compiled,
 *  and the declaration is found by name in it; null when it is not there. `exact`: its context as
 *  the elaborator has it (`exactContext`), when there is one. */
export function judgedText(lines: string[], edited: boolean, name: string, range: readonly number[], exact: FileContext | null = null): DeclarationText | null {
  const at = excerptOf(lines, edited, name, range);
  if (!at) return null;
  const text = lines.slice(at.start, at.end + 1).join("\n");
  return { text: withContext(contextText(readContext(lines, at.start, edited ? null : exact)), text), edited };
}

/** The names a `variable` command's binders bind: `(x y : α)`, `{α : Type}`, `[inst : C α]`
 *  give theirs; an anonymous instance binder `[C α]` gives none. */
export function binderNames(binders: string): string[] {
  const names: string[] = [];
  const open = "({[⦃", close = ")}]⦄";
  let depth = 0, start = -1;
  for (let k = 0; k < binders.length; k++) {
    const ch = binders[k];
    if (open.includes(ch)) {
      if (depth++ === 0) start = k + 1;
    } else if (close.includes(ch) && depth > 0) {
      if (--depth === 0) {
        const inside = binders.slice(start, k);
        const colon = topColon(inside);
        if (colon >= 0) for (const w of inside.slice(0, colon).trim().split(/\s+/)) if (w && w !== "_" && IDENT.test(w)) names.push(w);
      }
    }
  }
  return names;
}

const IDENT = /^[\p{L}_][\p{L}\p{N}_'!?₀-₉ₐ-ₜ.]*$/u;

/** Where the binder's ` : ` is, outside any bracket; -1 when there is none. */
function topColon(s: string): number {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if ("({[⦃".includes(ch)) depth++;
    else if (")}]⦄".includes(ch)) depth--;
    else if (ch === ":" && depth === 0 && s[k + 1] !== "=") return k;
  }
  return -1;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Which `variable` lines of a context the declaration uses: where the context is the
 *  elaborator's, those Lean included (`used`); elsewhere those binding a name that occurs in its
 *  statement or its text, and the anonymous instance binders about such a name — a hint for the
 *  eye, read from the words alone: Lean includes a variable by what the elaborated declaration
 *  mentions, which a word can only suggest. */
export function usedVariables(lines: readonly ContextLine[], texts: readonly string[], exact = false): Set<number> {
  if (exact) return new Set(lines.flatMap((l, k) => (l.used ? [k] : [])));
  const occurs = (name: string) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_'!?.])${escapeRe(name)}(?![\\p{L}\\p{N}_'!?])`, "u");
    return texts.some((t) => re.test(t));
  };
  const used = new Set<number>();
  const usedNames = new Set<string>();
  lines.forEach((l, k) => {
    if (l.kind !== "variable" || !l.binds?.length) return;
    const hit = l.binds.filter(occurs);
    if (hit.length) {
      used.add(k);
      for (const n of hit) usedNames.add(n);
    }
  });
  // `variable [DecidableEq α]` is about `α`: used when `α` is
  lines.forEach((l, k) => {
    if (l.kind !== "variable" || l.binds?.length || used.has(k)) return;
    for (const w of l.text.split(/[^\p{L}\p{N}_'!?₀-₉ₐ-ₜ.]+/u)) if (usedNames.has(w)) used.add(k);
  });
  return used;
}
