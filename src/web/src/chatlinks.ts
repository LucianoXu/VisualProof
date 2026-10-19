// Links in the conversations (CollabSpec decision 13, ViewSpec decision 21; the owner's decisions of
// 2026-10-19). A link of this site never shows as its address: it is a chip naming what it leads to
// — a declaration, a cluster, a note; for what someone saw, the view, the tool and the selection
// ("Case II · Rests on · `Foo.bar` +2") — in a message and in the box it is written in. A click on
// one goes there in the page, without a reload, as a share link is applied (web/src/main.ts). Any
// other http(s) link opens in a new tab, its host shown beside it.
//
// The chip is drawn from the link alone: the names it holds, and the view's title or the note's
// words from what the page knows (else "a view", "a note"); a link of this site the page cannot read
// stays a plain link. Copy link (the canvas's menu) and the box's link to what the reader sees make
// links without the key: the page's address up to its path, the key's `/k/<key>`, a personal link's
// `/i/…` and a read-only link's `/r/…` left out — everyone in a channel is let in already, and a link
// copied elsewhere opens nothing for whoever is not.

import { snapshotIn } from "../../shared/sharesnap.ts";
import { readSelection } from "./selection.ts";
import type { Tool } from "./selection.ts";
import { decodeState } from "./state.ts";
import type { ViewState } from "./state.ts";

/** a path that lets in: the key's, a personal link's, a read-only link's (server/access.ts,
 *  server/invites.ts, server/readonly.ts) */
const LETS_IN = /^\/[kir]\/[^/]+\/?$/;
/** the fragment's part that names a note, and that says it is a view's own (not the project's) */
export const NOTE = "note";
export const NOTE_OF_VIEW = "nv";

/** What a link of this site leads to. */
export interface SiteLink {
  /** the fragment, without `#`: what the page applies */
  hash: string;
  kind: "decl" | "cluster" | "note" | "seen" | "view" | "home";
  state: ViewState | null;
  /** the note it goes to: its id, and whether it is a view's own */
  note: { id: string; ofView: boolean } | null;
}

/** `url` as a link of this site (`origin`, the page's): one the page opens — its address, or a link
 *  that lets in — with a fragment it reads; null for any other, a link of this site it cannot read
 *  among them (it stays a plain link). */
export function siteLink(url: string, origin: string): SiteLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  if (u.pathname !== "/" && u.pathname !== "/index.html" && !LETS_IN.test(u.pathname)) return null;
  const hash = u.hash.replace(/^#/, "");
  if (!hash) return { hash, kind: "home", state: null, note: null };
  const p = new URLSearchParams(hash);
  const state = decodeState(hash);
  const note = noteIn(hash);
  if (note) return { hash, kind: "note", state, note };
  if (!state) return null;
  if (snapshotIn(hash)) return { hash, kind: "seen", state, note: null };
  const picks = readSelection(state.picks);
  const root = picks.length === 1 ? picks[0].root : null;
  const shown = state.shown;
  // one thing shown, and selected alone if at all: a link to it
  if (shown && picks.length <= 1 && (!picks.length || (root && ("decl" in shown ? "decl" in root && root.decl === shown.decl : "cluster" in root && root.cluster === shown.cluster))))
    return { hash, kind: "decl" in shown ? "decl" : "cluster", state, note: null };
  return { hash, kind: "view", state, note: null };
}

/** What the page knows to name a link by. */
export interface Namer {
  /** a view's title, by its id (null: a view this page does not know) */
  view(id: string): string | null;
  /** a note's first words, by its id (null: a note this page does not know) */
  note(id: string, ofView: boolean, view: string | null): string | null;
  /** a tool, as the mode buttons say it */
  tool(t: Tool): string;
}

/** A chip, as it is drawn: what it says — words, then a name in code, then how many more the
 *  selection holds — and its tooltip. */
export interface Chip {
  kind: SiteLink["kind"];
  words: string[];
  name: string | null;
  more: number;
  title: string;
}

const EXT = "⟨external⟩";
const clusterName = (key: string) => key.replace(EXT, "External");

/** The chip of a link of this site: a declaration's, a cluster's or a note's name; for a view or
 *  what someone saw, the view, the tool and the selection. */
export function chipOf(l: SiteLink, n: Namer): Chip {
  const st = l.state;
  const view = st?.view ? (n.view(st.view) ?? "a view") : st?.scope ? "a view" : "the Project";
  if (l.kind === "home") return { kind: l.kind, words: ["this site"], name: null, more: 0, title: "This site, as it opens" };
  if (l.kind === "note") {
    const said = n.note(l.note!.id, l.note!.ofView, st?.view ?? null);
    return { kind: l.kind, words: ["Note", said ? `“${said}”` : "a note"], name: null, more: 0, title: `Go to the note${said ? ` “${said}”` : ""}${st?.view ? `, on ${view}` : ""}` };
  }
  if ((l.kind === "decl" || l.kind === "cluster") && st?.shown) {
    const name = "decl" in st.shown ? st.shown.decl : clusterName(st.shown.cluster);
    return { kind: l.kind, words: [], name, more: 0, title: `Go to ${l.kind === "cluster" ? "the cluster " : ""}${name}, on ${view}` };
  }
  // a view, or what someone saw: the view, the tool, the selection's first thing and how many more
  const picks = readSelection(st?.picks);
  const first = picks[0]?.root;
  const name = first ? ("decl" in first ? first.decl : clusterName(first.cluster)) : null;
  const words = [view, n.tool(st?.mode ?? "tcb"), ...(picks.length && !name ? ["a selection"] : [])];
  const seen = l.kind === "seen" ? "What someone saw: " : "";
  return { kind: l.kind, words, name, more: Math.max(0, picks.length - 1), title: `${seen}${[...words, ...(name ? [name] : [])].join(" · ")}${picks.length > 1 ? ` and ${picks.length - 1} more` : ""} — opens here once` };
}

/** The chip's words as plain text, as the page says it was copied: "Case II · Rests on · Foo.bar +2". */
export function chipText(c: Chip): string {
  return [...c.words, ...(c.name ? [c.name] : [])].join(" · ") + (c.more ? ` +${c.more}` : "");
}

/** A link to what the page shows, without the key (CollabSpec, "Copied links"): the page's address up
 *  to its path, a path that lets in left out, then `#` and the fragment. */
export function copyLink(at: { origin: string; pathname: string }, hash: string): string {
  const path = LETS_IN.test(at.pathname) ? "/" : at.pathname || "/";
  return `${at.origin}${path}#${hash.replace(/^#/, "")}`;
}

/** The note a fragment names (`note=`, and `nv=1` for a view's own), or null. */
export function noteIn(hash: string): { id: string; ofView: boolean } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const id = p.get(NOTE);
  return id && /^[\w-]{1,64}$/.test(id) ? { id, ofView: p.get(NOTE_OF_VIEW) === "1" } : null;
}

/** The fragment of a link to a note: the board it is on, and the note (a view's own, or the
 *  project's). */
export function noteHash(boardHash: string, id: string, ofView: boolean): string {
  const base = boardHash.replace(/^#/, "").split("&").filter((p) => p && !p.startsWith(`${NOTE}=`) && !p.startsWith(`${NOTE_OF_VIEW}=`) && !p.startsWith("snap=")).join("&");
  return `${base ? base + "&" : ""}${NOTE}=${encodeURIComponent(id)}${ofView ? `&${NOTE_OF_VIEW}=1` : ""}`;
}

/** an http(s) address written in text: up to a space or what cannot be in one unescaped */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`\\]+/gi;

/** The addresses in a text, each where it is: its trailing punctuation left out (a sentence's full
 *  stop, a closing bracket it does not open). */
export function linksIn(text: string): { url: string; start: number; end: number }[] {
  const out: { url: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    for (;;) {
      const last = url.at(-1)!;
      if (/[.,;:!?*_~]/.test(last)) url = url.slice(0, -1);
      else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
      else if (last === "]" || last === "}") url = url.slice(0, -1);
      else break;
    }
    if (/^https?:\/\/[^/]/i.test(url)) out.push({ url, start: m.index!, end: m.index! + url.length });
  }
  return out;
}

/** A text cut into its plain parts and its links of this site (`site` says which), in order: what the
 *  box shows as text and as chips (web/src/chatinput.ts). */
export function segments(text: string, site: (url: string) => boolean): ({ text: string } | { url: string })[] {
  const out: ({ text: string } | { url: string })[] = [];
  let at = 0;
  for (const l of linksIn(text)) {
    if (!site(l.url)) continue;
    if (l.start > at) out.push({ text: text.slice(at, l.start) });
    out.push({ url: l.url });
    at = l.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** `text` with every link of this site (`origin`) that lets in — the key's, a personal link's, a
 *  read-only link's — made the page's address, the secret left out: a link written in a
 *  conversation never hands anyone a way in, nor a personal link's holder's name (CollabSpec
 *  decision 13: Share makes the links that let people in). */
export function withoutKeys(text: string, origin: string): string {
  let out = "";
  let at = 0;
  for (const l of linksIn(text)) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (u.origin !== origin || !LETS_IN.test(u.pathname)) continue;
    out += text.slice(at, l.start) + copyLink({ origin, pathname: "/" }, u.hash);
    at = l.end;
  }
  return out + text.slice(at);
}

/** The host an address names, as it is shown beside a link to elsewhere. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
