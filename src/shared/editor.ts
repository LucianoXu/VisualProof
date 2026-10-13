// "Open in editor": a link from a declaration to its place in an editor, made from a URL template.
// The server can be started with one (`--editor`), and a reader can set their own in the page (the
// ? sheet), because what opens an editor depends on the machine the page is read on: VS Code on the
// server itself (`vscode://file/{path}:{line}:{col}`), VS Code on a laptop reaching the server over
// SSH (`vscode://vscode-remote/ssh-remote+HOST{path}:{line}`), or a web view of the repository
// (`https://github.com/…/blob/main/{rel}#L{line}`).
//
// Placeholders: {path} is the file's absolute path on the server, {rel} its path in the project,
// {line} and {col} where the declaration starts, both counted from 1. The paths are percent-encoded
// where a URL needs it; the rest of the template is the owner's, and is left as written.

export const PLACEHOLDERS: readonly string[] = ["path", "rel", "line", "col"];

/** Where a declaration is, for the template. */
export interface EditorPlace {
  /** absolute, on the server */
  path: string;
  /** relative to the project's root */
  rel: string;
  /** 1-based */
  line: number;
  /** 1-based */
  col: number;
}

/** Schemes that do something inside the page rather than open something outside it: a template
 *  with one would run whatever it says the moment a reader clicks the link. */
const REFUSED = new Set(["javascript", "data", "vbscript", "blob", "about"]);

/** A place to try a template on, so that one which cannot make a URL is refused before anyone
 *  clicks it. */
const SAMPLE: EditorPlace = { path: "/home/a b/Project/A#1.lean", rel: "A#1.lean", line: 12, col: 3 };

/** Why `t` cannot be used as a template, or null when it can. */
export function invalidTemplate(t: string): string | null {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(t);
  if (!scheme) return "Not a URL: it has to start with a scheme, like vscode:// or https://.";
  if (REFUSED.has(scheme[1].toLowerCase())) return `A ${scheme[1]}: link runs inside the page; it cannot open an editor.`;
  if (/[\s\x00-\x1f\x7f]/.test(t)) return "A URL has no spaces in it; write a space as %20.";
  for (const [, name] of t.matchAll(/\{([^{}]*)\}/g))
    if (!PLACEHOLDERS.includes(name)) return `There is no {${name}}: the placeholders are {path}, {rel}, {line} and {col}.`;
  if (!/\{(?:path|rel)\}/.test(t)) return "It names no file: put {path} (the file on the server) or {rel} (the file in the project) in it.";
  if (expand(t, SAMPLE) === null) return "This does not make a URL once the placeholders are filled in.";
  return null;
}

/** A path as it may stand in a URL: percent-encoded, except for the slashes and the characters a
 *  path may hold as they are. `?` and `#` would end the path, so they are encoded too. */
function encodePath(p: string): string {
  return encodeURI(p).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

function expand(t: string, p: EditorPlace): string | null {
  try {
    const out = t.replace(/\{(path|rel|line|col)\}/g, (_, name: string, at: number) => {
      if (name === "line" || name === "col") return String(Math.max(1, Math.trunc(name === "line" ? p.line : p.col) || 1));
      const s = encodePath(name === "path" ? p.path : p.rel);
      // `vscode://file/{path}` with an absolute path: one slash, not two, since `file//data/…`
      // would name a host "data". A double slash (`file://{path}`) is the URL's own and stays.
      if (name === "path" && s.startsWith("/") && t[at - 1] === "/" && t[at - 2] !== "/") return s.slice(1);
      return s;
    });
    new URL(out);
    return out;
  } catch {
    // a path with half a character in it (encodeURI throws), or no URL at all
    return null;
  }
}

/** The link to `place` that template `t` makes; null when the template cannot be used. */
export function editorLink(t: string, place: EditorPlace): string | null {
  return invalidTemplate(t) ? null : expand(t, place);
}
