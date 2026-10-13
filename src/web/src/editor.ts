// "Open in editor" (shared/editor.ts) in the page: the template in force, and the link it makes for
// a declaration. The server's template (`--editor`, told in /api/status) is a default for everyone
// on it; a reader's own, set in the ? sheet and kept in this browser, wins, since the URL that
// opens an editor depends on the reader's machine. A snapshot carries no server template: there,
// only a reader's own makes links.

import { editorLink, invalidTemplate } from "../../shared/editor.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import type { Store } from "./store.ts";

export class Editor {
  /** the server's template; null when it has none (and in a snapshot) */
  readonly server: string | null;
  private store: Store;

  constructor(store: Store, server: string | null) {
    this.store = store;
    this.server = server && !invalidTemplate(server) ? server : null;
  }

  /** the reader's own template, when they set one */
  get mine(): string | null {
    return this.store.data.editor ?? null;
  }

  /** Set the reader's own template; "" goes back to the server's. Why not, when it cannot be used. */
  set(t: string): string | null {
    const s = t.trim();
    const why = s ? invalidTemplate(s) : null;
    if (why) return why;
    if (s) this.store.data.editor = s;
    else delete this.store.data.editor;
    this.store.save();
    return null;
  }

  /** the template in force: the reader's, else the server's */
  get template(): string | null {
    const mine = this.mine;
    return mine && !invalidTemplate(mine) ? mine : this.server;
  }

  /** The link to declaration `i` in the editor: at `at` (a line and column of the file as it is
   *  now, both from 1), else where it was compiled. Null without a template, and for what has no
   *  file in the project or no recorded place. */
  href(g: Graph, i: number, at?: { line: number; col: number }): string | null {
    const t = this.template;
    const v = g.nodes[i];
    if (!t || g.isExt(i) || !v.range) return null;
    const rel = g.meta.modules.find((m) => m.name === v.module)?.file;
    if (!rel) return null;
    const root = g.meta.project.root.replace(/\/+$/, "");
    return editorLink(t, { path: `${root}/${rel}`, rel, line: at?.line ?? v.range[0], col: at?.col ?? v.range[1] + 1 });
  }
}

/** The "Open in editor" link. A web page (a repository's view of the file) opens in a tab of its
 *  own; an editor's scheme hands the link to the editor, and a new tab would only be left empty. */
export function editorAnchor(href: string): string {
  const tab = /^https?:/i.test(href) ? ` target="_blank" rel="noopener"` : "";
  return `<a class="link editor-link" href="${escapeHtml(href)}"${tab} title="Open it in your editor (the link is set under ?)">Open in editor</a>`;
}
