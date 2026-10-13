// What is in force where a declaration is written, read from its file as Lean would read it: the
// namespaces and sections around it, the `open` commands (an `open … in` right before it
// included), the `variable`s, `universe`s, options and section-local commands. The page reads the
// namespaces and opens to link the short names in a declaration's source (web/src/scope.ts); the
// agents' API answers with all of it (server/agent.ts, `context`); shared/context.ts writes it as
// the block of Lean shown above a declaration's source and recorded with what an opinion judged.
// This is the text, read without elaborating it: where Lean is running, what Lean says wins.

import type { Graph } from "./viewgraph.ts";

export interface Scope {
  /** the namespaces around the declaration, innermost first */
  namespaces: string[];
  /** the namespaces opened where it starts */
  opens: string[];
  /** names opened one by one (`open A (x)`, `open A renaming x → y`): short name → full name */
  aliases: Map<string, string>;
}

/** A command in force, as written: comments taken out, its lines joined, white space as one
 *  space. `in`: written as `… in` right before the declaration, so for it alone. */
export interface Command {
  /** 1-based */
  line: number;
  text: string;
  in?: true;
  /** a `variable` Lean included in the declaration (only where the context is the
   *  elaborator's, `FileContext.exact`) */
  used?: true;
}

/** Everything in force where a declaration starts, outermost first. */
export interface FileContext {
  /** read from the elaborator's scope by the usage pass (server/usage.ts), not from the text: the
   *  opens resolved, a `variable` for each binder, and the variables Lean included marked `used` */
  exact?: true;
  /** the namespace the declaration is written in ("" at the top) */
  namespace: string;
  /** the namespaces around it, innermost first */
  namespaces: string[];
  /** the namespaces, sections and `mutual` blocks it sits in, outermost first; `noncomputable`:
   *  a `noncomputable section` */
  blocks: { kind: "namespace" | "section" | "mutual"; name: string | null; line: number; noncomputable?: true }[];
  /** each `open` in force, with the namespaces of the graph it opens (`scoped`: notation and
   *  instances only) */
  opens: (Command & { namespaces: string[]; scoped?: true })[];
  /** each `variable` in force; `text` is its binders */
  variables: Command[];
  /** each `universe` in force; `text` is its names */
  universes: Command[];
  /** each `set_option` in force; `text` is the option and its value */
  options: Command[];
  /** commands that hold to the end of their section: local and scoped notation, instances and
   *  attributes, `include` and `omit` */
  local: Command[];
}

/** The namespaces that exist in the graph: every proper prefix of a declaration's name. */
const namespaceSets = new WeakMap<Graph, Set<string>>();
export function namespacesOf(g: Graph): Set<string> {
  let s = namespaceSets.get(g);
  if (!s) {
    s = new Set();
    for (const v of g.nodes) {
      let k = v.name.indexOf(".");
      while (k > 0) {
        s.add(v.name.slice(0, k));
        k = v.name.indexOf(".", k + 1);
      }
    }
    namespaceSets.set(g, s);
  }
  return s;
}

interface Frame {
  kind: "top" | "namespace" | "section" | "mutual";
  /** the namespace this frame adds, "" for anything but a namespace */
  ns: string;
  /** what `end` names to close it */
  name: string | null;
  line: number;
  /** a `noncomputable section`: what is in it may be noncomputable without saying so */
  noncomputable?: true;
  /** what `open` resolved to, for linking names */
  opens: string[];
  aliases: Map<string, string>;
  /** the commands themselves, for the context */
  open: FileContext["opens"];
  variables: Command[];
  universes: Command[];
  options: Command[];
  local: Command[];
}

const frame = (kind: Frame["kind"], ns: string, name: string | null, line: number): Frame => ({
  kind, ns, name, line, opens: [], aliases: new Map(), open: [], variables: [], universes: [], options: [], local: [],
});

const NAMESPACE = /^namespace\s+(\S+)/;
const SECTION = /^(?:@\[[^\]]*\]\s*)?(?:(?:noncomputable|public|private)\s+)*section\b(?:\s+([^\s-]\S*))?/;
const MUTUAL = /^mutual\b/;
const END = /^end\b(?:\s+([^\s-]\S*))?/;
const OPEN = /^open\s+(.*)$/;
const VARIABLE = /^variable\b\s*(.*)$/;
const UNIVERSE = /^universe\s+(.*)$/;
const OPTION = /^set_option\s+(.*)$/;
/** what holds to the end of its section besides the above */
const LOCAL = /^(?:(?:local|scoped)[\s[]|attribute\s*\[\s*(?:local|scoped)\b|include\b|omit\b)/;
/** attributes alone on their line belong to the declaration below */
const ATTRIBUTES = /^@\[[^\]]*\]$/;
/** `… in`: the command holds for the next command only. Only these commands are read so; a
 *  declaration's text that happens to end in `in` is not one. */
const IN = /\sin$/;
const IN_HEAD = /^(?:open|set_option|variable|universe|include|omit|attribute|local|scoped)\b/;

/** A line without its comments, and how deep in nested block comments it ends. String literals
 *  are kept whole, so that `"--"` in a notation is not a comment. */
function stripComments(line: string, depth: number): { text: string; depth: number } {
  let out = "";
  for (let k = 0; k < line.length; k++) {
    const c = line[k], d = line[k + 1];
    if (depth > 0) {
      if (c === "/" && d === "-") {
        depth++;
        k++;
      } else if (c === "-" && d === "/") {
        depth--;
        k++;
      }
      continue;
    }
    if (c === "/" && d === "-") {
      depth++;
      k++;
      continue;
    }
    if (c === "-" && d === "-") break;
    if (c === '"') {
      let j = k + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      out += line.slice(k, j + 1);
      k = j;
      continue;
    }
    out += c;
  }
  return { text: out, depth };
}

/** Read a file up to line `upto` (0-based, the line a declaration's text starts on): the frames in
 *  force there, and the commands written `… in` right before it. */
function walk(lines: string[], upto: number, hasNamespace: (n: string) => boolean): { stack: Frame[]; pending: Frame | null } {
  const stack: Frame[] = [frame("top", "", null, 0)];
  /** `open … in` and the like apply to the next command only */
  let pending: Frame | null = null;
  const current = () => stack.map((f) => f.ns).filter(Boolean).join(".");
  /** What `open X` opens: X under the namespaces around it, innermost first, or X itself. */
  const resolveNs = (x: string): string[] => {
    const cur = current().split(".").filter(Boolean);
    const out: string[] = [];
    for (let k = cur.length; k >= 0; k--) {
      const n = [...cur.slice(0, k), x].join(".");
      if (hasNamespace(n)) out.push(n);
    }
    return out;
  };
  /** `open …` (its arguments): what it opens, into a frame, and the command as written. */
  const open = (args: string, cmd: Command, into: Frame) => {
    const words = args.trim().split(/\s+/);
    const scoped = words[0] === "scoped";
    const spaces: string[] = [];
    const rest = scoped ? args.trim().slice("scoped".length) : args;
    // `open A (x y)`, `open A hiding x`, `open A renaming x → y`
    const paren = /^([^\s(]+)\s*\(([^)]*)\)/.exec(rest.trim());
    const renaming = /^([^\s]+)\s+renaming\s+(.*)$/.exec(rest.trim());
    if (paren) {
      for (const ns of resolveNs(paren[1])) {
        spaces.push(ns);
        if (!scoped) for (const x of paren[2].trim().split(/\s+/)) if (x) into.aliases.set(x, `${ns}.${x}`);
      }
    } else if (renaming) {
      for (const ns of resolveNs(renaming[1])) {
        spaces.push(ns);
        if (!scoped)
          for (const pair of renaming[2].split(",")) {
            const [from, to] = pair.split(/→|->/).map((s) => s.trim());
            if (from && to) into.aliases.set(to, `${ns}.${from}`);
          }
      }
    } else {
      const hiding = rest.indexOf(" hiding ");
      for (const w of (hiding >= 0 ? rest.slice(0, hiding) : rest).trim().split(/\s+/)) {
        if (!w) continue;
        const ns = resolveNs(w);
        spaces.push(...ns);
        // scoped opens bring notation and instances, no names
        if (!scoped) into.opens.push(...ns);
      }
    }
    into.open.push({ ...cmd, namespaces: [...new Set(spaces)], ...(scoped ? { scoped: true as const } : {}) });
  };

  /** What a whole command does, once all its lines are read. */
  const finish = (text: string, line: number) => {
    let m: RegExpExecArray | null;
    if ((m = NAMESPACE.exec(text))) {
      stack.push(frame("namespace", m[1], m[1], line));
      pending = null;
      return;
    }
    if ((m = SECTION.exec(text))) {
      const f = frame("section", "", m[1] ?? null, line);
      if (/\bnoncomputable\s+section\b/.test(text)) f.noncomputable = true;
      stack.push(f);
      pending = null;
      return;
    }
    if (MUTUAL.test(text)) {
      stack.push(frame("mutual", "", null, line));
      pending = null;
      return;
    }
    if ((m = END.exec(text))) {
      // `end A.B` closes as many namespaces as its name has parts, `namespace A.B` being one
      let parts = m[1] ? m[1].split(".").length : 1;
      while (parts > 0 && stack.length > 1) parts -= (stack.pop()!.name ?? "_").split(".").length;
      pending = null;
      return;
    }
    if (ATTRIBUTES.test(text)) return;
    const head = IN_HEAD.test(text);
    // `open A in def x …` on one line holds for that command alone, which is not the one asked about
    if (head && !VARIABLE.test(text) && /\sin\s/.test(text)) {
      pending = null;
      return;
    }
    const onlyNext = head && IN.test(text);
    const body = onlyNext ? text.replace(IN, "") : text;
    // a command that is not `… in` uses up what was pending: a declaration, or anything else
    const into = onlyNext ? (pending ??= frame("top", "", null, line)) : stack[stack.length - 1];
    if (!onlyNext) pending = null;
    const cmd = (t: string): Command => ({ line: line + 1, text: t, ...(onlyNext ? { in: true as const } : {}) });
    if ((m = OPEN.exec(body))) open(m[1], cmd(body), into);
    else if ((m = VARIABLE.exec(body))) into.variables.push(cmd(m[1]));
    else if ((m = UNIVERSE.exec(body))) into.universes.push(cmd(m[1]));
    else if ((m = OPTION.exec(body))) into.options.push(cmd(m[1]));
    else if (LOCAL.test(body)) into.local.push(cmd(body.length > 400 ? body.slice(0, 400) + "…" : body));
  };

  let depth = 0;
  /** the command being read: its first line, and its text so far */
  let reading: { line: number; text: string } | null = null;
  for (let l = 0; l < upto && l < lines.length; l++) {
    const line = lines[l];
    const inComment = depth > 0;
    const s = stripComments(line, depth);
    depth = s.depth;
    const text = s.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    // a command starts at the line's first column, outside a comment; anything else continues it
    if (!inComment && !/^\s/.test(line)) {
      if (reading) finish(reading.text, reading.line);
      reading = { line: l, text };
    } else if (reading) reading.text += " " + text;
  }
  if (reading) finish(reading.text, reading.line);
  return { stack, pending };
}

/** The scope at line `upto` of a file (the line a declaration's text starts on): what a short name
 *  written there can mean. */
export function scopeAt(lines: string[], upto: number, hasNamespace: (n: string) => boolean): Scope {
  const { stack, pending } = walk(lines, upto, hasNamespace);
  const frames = pending ? [...stack, pending] : stack;
  const cur = stack.map((f) => f.ns).filter(Boolean).join(".").split(".").filter(Boolean);
  const namespaces: string[] = [];
  for (let k = cur.length; k > 0; k--) namespaces.push(cur.slice(0, k).join("."));
  const aliases = new Map<string, string>();
  for (const f of frames) for (const [k, v] of f.aliases) aliases.set(k, v);
  return { namespaces, opens: [...new Set(frames.flatMap((f) => f.opens))], aliases };
}

/** Everything in force at line `upto` of a file, as written: the context a declaration there is
 *  read in. */
export function contextAt(lines: string[], upto: number, hasNamespace: (n: string) => boolean): FileContext {
  const { stack, pending } = walk(lines, upto, hasNamespace);
  const frames = pending ? [...stack, pending] : stack;
  const namespace = stack.map((f) => f.ns).filter(Boolean).join(".");
  const cur = namespace.split(".").filter(Boolean);
  const namespaces: string[] = [];
  for (let k = cur.length; k > 0; k--) namespaces.push(cur.slice(0, k).join("."));
  return {
    namespace,
    namespaces,
    blocks: stack.slice(1).map((f) => ({ kind: f.kind as "namespace" | "section" | "mutual", name: f.name, line: f.line + 1, ...(f.noncomputable ? { noncomputable: true as const } : {}) })),
    opens: frames.flatMap((f) => f.open),
    variables: frames.flatMap((f) => f.variables),
    universes: frames.flatMap((f) => f.universes),
    options: frames.flatMap((f) => f.options),
    local: frames.flatMap((f) => f.local),
  };
}
