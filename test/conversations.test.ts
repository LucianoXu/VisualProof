// The conversations in the page (CollabSpec decision 13, the owner's decisions of 2026-10-19): a link
// of this site never shows as its address — read into a chip naming what it leads to, in a message
// and in the box —, any other link opens elsewhere with its host; copied links carry no key; every
// message escaped first; what the box says, read back as text; what the reader has not seen, counted
// and marked; the reader's own agents; mentions marked; the window in front of the source windows,
// and nothing in it ends following.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, Peer } from "../src/shared/collab.ts";
import { chipOf, chipText, copyLink, hostOf, linksIn, noteHash, noteIn, segments, siteLink, siteOrigins, withoutKeys } from "../src/web/src/chatlinks.ts";
import type { Namer } from "../src/web/src/chatlinks.ts";
import { textOf } from "../src/web/src/chatinput.ts";
import type { BoxNode } from "../src/web/src/chatinput.ts";
import { renderMarkdown } from "../src/web/src/markdown.ts";
import { declPick, selectionText } from "../src/web/src/selection.ts";
import { encodeState } from "../src/web/src/state.ts";
import { inYours, keyActs, pressActs, YOURS } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";
import { markMentions, merge, ownAgents, unseen } from "../src/web/src/talk.ts";
import { site } from "./site.ts";

const O = "https://vp.example.org";
const names: Namer = {
  view: (id) => ({ v1: "Case II" })[id] ?? null,
  note: (id) => ({ n1: "Start here." })[id] ?? null,
  tool: (t) => (t === "plain" ? "Selection" : t === "apps" ? "Used by" : "Rests on"),
};
const chip = (url: string) => {
  const l = siteLink(url, O);
  return l ? chipOf(l, names) : null;
};

test("a link of this site is read into a chip naming what it leads to: a declaration, a cluster, a note, a view, what someone saw", () => {
  // a declaration (Copy link on one): its name
  const d = chip(`${O}/#${encodeState({ view: "v1", scope: null, mode: "tcb", picks: "tcb(Foo.bar)", shown: { decl: "Foo.bar" } })}`)!;
  assert.deepEqual([d.kind, d.words, d.name, d.more], ["decl", [], "Foo.bar", 0]);
  assert.equal(chipText(d), "Foo.bar");
  assert.match(d.title, /Go to Foo\.bar, on Case II/);
  // a cluster
  const c = chip(`${O}/#v=v1&mode=plain&c=FltRegular.CaseII`)!;
  assert.deepEqual([c.kind, c.name], ["cluster", "FltRegular.CaseII"]);
  // a note, by the words the page knows of it, else "a note"
  assert.equal(chipText(chip(`${O}/#v=v1&mode=tcb&note=n1`)!), "Note · “Start here.”");
  assert.equal(chipText(chip(`${O}/#v=v1&mode=tcb&note=zz&nv=1`)!), "Note · a note");
  // what someone saw: the view, the tool, the selection's first and how many more
  const sel = selectionText([declPick("tcb", "Foo.bar"), declPick("tcb", "Foo.baz"), declPick("plain", "Foo.qux")])!;
  const seen = chip(`${O}/#v=v1&mode=tcb&sel=${encodeURIComponent(sel)}&snap=jE30`)!;
  assert.equal(seen.kind, "seen");
  assert.equal(chipText(seen), "Case II · Rests on · Foo.bar +2");
  assert.match(seen.title, /^What someone saw: /);
  // a view the page does not know, by its query: "a view"; the Project's
  assert.equal(chipText(chip(`${O}/#q=${encodeURIComponent("ns(A)")}&mode=apps`)!), "a view · Used by");
  assert.equal(chipText(chip(`${O}/#mode=plain`)!), "the Project · Selection");
  // the key's link, a personal link, a read-only link: the same page, the same chip
  for (const p of ["/k/abc", "/i/vpp_0123456789_x", "/r/vpr_0123456789_y"]) assert.equal(chip(`${O}${p}#v=v1&mode=plain&s=Foo.bar`)?.name, "Foo.bar", p);
  // the address alone
  assert.equal(chipText(chip(`${O}/`)!), "this site");
  // not this site, not a page of it, not one the page can read: no chip
  for (const u of ["https://elsewhere.org/#mode=tcb", `${O}/api/agent`, `${O}/tips/tour.mp4`, `${O}/#hello`, "http://vp.example.org/#mode=tcb", "not a url"]) assert.equal(chip(u), null, u);
});

test("--public-url: links of the server's public address are this site's too, and the page makes its own with it", async () => {
  const P = "https://vp.example.org";
  const own = "http://10.0.0.5:4173";
  // the page is told it; a server without one says nothing
  const S = await site({ publicUrl: P });
  const plain = await site();
  try {
    assert.equal((await S.ask("GET", "/api/status")).json?.publicUrl, P);
    assert.equal((await plain.ask("GET", "/api/status")).json?.publicUrl, undefined);
  } finally {
    await S.close();
    await plain.close();
  }
  // the site's addresses: the page's own and the public one; links made with the public one
  const at = siteOrigins(own, P);
  assert.deepEqual(at, { origins: [own, P], base: P });
  assert.deepEqual(siteOrigins(P, `${P}/`), { origins: [P], base: P });
  assert.deepEqual(siteOrigins(own, null), { origins: [own], base: own });
  assert.deepEqual(siteOrigins(own, "not an address"), { origins: [own], base: own });
  // an agent's link (made with the public address) is a chip on a page reached at another, and so
  // is one of the page's own address; any other host's is not
  const hash = encodeState({ view: "v1", scope: null, mode: "tcb", picks: "tcb(Foo.bar)", shown: { decl: "Foo.bar" } });
  for (const o of [P, own]) assert.equal(siteLink(`${o}/#${hash}`, at.origins)?.kind, "decl", o);
  assert.equal(siteLink(`https://elsewhere.org/#${hash}`, at.origins), null);
  assert.equal(siteLink(`${P}/#${hash}`, own), null, "one address alone: the page's");
  // a link that lets in, of either address, goes without its secret, keeping its address
  assert.equal(withoutKeys(`${P}/r/vpr_0123456789_tok#mode=tcb and ${own}/k/secret#mode=plain`, at.origins), `${P}/#mode=tcb and ${own}/#mode=plain`);
  // Copy link, from a page let in by the key at its own address: the public address, no key
  assert.equal(copyLink({ origin: at.base, pathname: "/k/secret" }, "mode=tcb"), `${P}/#mode=tcb`);
});

test("copied links carry no key: the page's address up to its path, the key's, a personal link's or a read-only link's left out", () => {
  assert.equal(copyLink({ origin: O, pathname: "/" }, "v=v1&mode=tcb"), `${O}/#v=v1&mode=tcb`);
  for (const p of ["/k/secretkey", "/i/vpp_0123456789_token", "/r/vpr_0123456789_token/"]) {
    const l = copyLink({ origin: O, pathname: p }, "#mode=tcb");
    assert.equal(l, `${O}/#mode=tcb`);
    assert.ok(!/secret|token/.test(l));
  }
  assert.equal(copyLink({ origin: O, pathname: "/index.html" }, "mode=tcb"), `${O}/index.html#mode=tcb`);
  // a link that lets in, written or pasted in a conversation, goes without its secret: Share makes
  // the links that let people in
  assert.equal(withoutKeys(`see ${O}/k/secret#mode=tcb&s=A.b and ${O}/i/vpp_0123456789_tok, https://x.org/k/y`, O), `see ${O}/#mode=tcb&s=A.b and ${O}/#, https://x.org/k/y`);
  // a note's link: the board, and the note; a snapshot or an older note left out
  const h = noteHash("#v=v1&mode=tcb&snap=jX&note=old", "n2", true);
  assert.equal(h, "v=v1&mode=tcb&note=n2&nv=1");
  assert.deepEqual(noteIn(h), { id: "n2", ofView: true });
  assert.deepEqual(noteIn("mode=tcb&note=n3"), { id: "n3", ofView: false });
  assert.equal(noteIn("mode=tcb&note=<x>"), null);
});

test("addresses in a text, without the punctuation after them; a text cut into words and links of this site", () => {
  const t = `See ${O}/#v=v1&mode=tcb, and (https://en.wikipedia.org/wiki/Regular_(prime)). Done: https://a.org/x.`;
  assert.deepEqual(linksIn(t).map((l) => l.url), [`${O}/#v=v1&mode=tcb`, "https://en.wikipedia.org/wiki/Regular_(prime)", "https://a.org/x"]);
  assert.deepEqual(linksIn("ftp://x.org javascript:alert(1) http://"), []);
  const segs = segments(t, (u) => u.startsWith(O));
  assert.deepEqual(segs.map((s) => ("url" in s ? `[${s.url}]` : s.text)), ["See ", `[${O}/#v=v1&mode=tcb]`, ", and (https://en.wikipedia.org/wiki/Regular_(prime)). Done: https://a.org/x."]);
  assert.equal(hostOf("https://en.wikipedia.org/wiki/x"), "en.wikipedia.org");
});

test("every message is escaped first: its links drawn as the conversation draws them, any other scheme left as text, no HTML of the writer's", () => {
  const urls = (url: string, label: string | null) => (url.startsWith(O) ? `<CHIP:${url}>` : `<EXT:${url}|${label ?? ""}>`);
  const html = renderMarkdown(`**Look** at ${O}/#mode=tcb&s=A.b and [the paper](https://arxiv.org/abs/1) <img src=x onerror=alert(1)> [x](javascript:alert(1)) \`${O}/#in-code\``, () => null, urls);
  assert.match(html, /<b>Look<\/b> at <CHIP:https:\/\/vp\.example\.org\/#mode=tcb&s=A\.b> and <EXT:https:\/\/arxiv\.org\/abs\/1\|the paper>/);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), html);
  assert.ok(html.includes("[x](javascript:alert(1))"), "another scheme stays text");
  assert.ok(html.includes(`<code>${O}/#in-code</code>`), "an address in code is code");
  // without the conversation's drawing (a comment), an address stays text
  assert.ok(!renderMarkdown(`${O}/#mode=tcb`, () => null).includes("<CHIP"));
});

test("what the box says, as text: its words, each chip as its link apart from the words beside it, a line for each break", () => {
  const text = (s: string): BoxNode => ({ nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] });
  const chipN = (href: string): BoxNode => ({ nodeType: 1, nodeName: "SPAN", textContent: "Foo.bar", childNodes: [text("Foo.bar")], dataset: { href } });
  const el = (name: string, kids: BoxNode[]): BoxNode => ({ nodeType: 1, nodeName: name, textContent: null, childNodes: kids, dataset: {} });
  const L = `${O}/#mode=tcb&s=Foo.bar`;
  assert.equal(textOf(el("DIV", [text("Look at"), chipN(L), text("please.")])), `Look at ${L} please.`);
  assert.equal(textOf(el("DIV", [chipN(L)])), L, "no space at the end");
  assert.equal(textOf(el("DIV", [text("one"), el("BR", []), text("two"), el("DIV", [text("three")])])), "one\ntwo\nthree");
  // the break that only lets the caret stand on an empty last line says nothing
  const end: BoxNode = { nodeType: 1, nodeName: "BR", textContent: null, childNodes: [], dataset: { end: "" } };
  assert.equal(textOf(el("DIV", [text("one"), el("BR", []), end])), "one\n");
});

const msg = (id: number, from: string, kind: ChatMessage["kind"], over: Partial<ChatMessage> = {}): ChatMessage => ({ id, at: "2026-10-19T10:00:00.000Z", from, kind, channel: "public", text: `m${id}`, ...over });

test("what the reader has not seen: the public messages counted, not their own; marked where they are mentioned or one of their agents said something", () => {
  const threads = new Map<string, ChatMessage[]>([
    ["public", [msg(1, "Bob", "person"), msg(2, "Alice", "person"), msg(3, "Bob", "person", { mentions: ["Alice"] })]],
    ["ag1", [msg(1, "Alice", "person", { channel: "private" }), msg(2, "Alice's AI", "agent", { channel: "private" })]],
  ]);
  assert.deepEqual(unseen(threads, {}, "Alice", ["ag1"]), { count: 2, marked: true });
  assert.deepEqual(unseen(threads, { public: 2, ag1: 2 }, "Alice", ["ag1"]), { count: 1, marked: true }, "mentioned in what is new");
  assert.deepEqual(unseen(threads, { public: 3, ag1: 1 }, "Alice", ["ag1"]), { count: 0, marked: true }, "her agent answered");
  assert.deepEqual(unseen(threads, { public: 3, ag1: 2 }, "Alice", ["ag1"]), { count: 0, marked: false });
  // her agent answering in public marks it too; another's does not
  threads.get("public")!.push(msg(4, "Alice's AI", "agent"), msg(5, "Bob's AI", "agent"));
  assert.deepEqual(unseen(threads, { public: 3, ag1: 2 }, "Alice", ["ag1"]), { count: 2, marked: true });
  assert.deepEqual(unseen(threads, { public: 4, ag1: 2 }, "Alice", ["ag1"]), { count: 1, marked: false });
  // merged by id, each once, in order
  assert.deepEqual(merge([msg(3, "x", "person"), msg(1, "x", "person")], [msg(2, "x", "person"), msg(3, "y", "person")]).map((m) => [m.id, m.from]), [[1, "x"], [2, "x"], [3, "x"]]);
});

test("the reader's own agents: those whose token they made, by their personal link where it was one, else by the name; never one without a token", () => {
  const talk = { state: "listening" as const, since: "", doing: null, status: null, read: 0, readPublic: 0, lastSeen: null };
  const peers: Peer[] = [
    { id: "a", name: "Alice's AI", view: null, idle: false, agent: true, talk, by: "Alice", byPerson: "p1" },
    { id: "b", name: "Bob's AI", view: null, idle: false, agent: true, talk, by: "Bob" },
    { id: "c", name: "Old", view: null, idle: false, agent: true, by: "Alice" },
    { id: "d", name: "Alice", view: null, idle: false },
  ];
  assert.deepEqual(ownAgents(peers, { name: "Alicia", person: "p1" }).map((p) => p.id), ["a"]);
  assert.deepEqual(ownAgents(peers, { name: "Alice", person: null }).map((p) => p.id), [], "not whoever gives her name");
  assert.deepEqual(ownAgents(peers, { name: "bob", person: null }).map((p) => p.id), ["b"]);
  assert.deepEqual(ownAgents(peers, { name: null, person: null }), []);
});

test("mentions are marked in a message's text, never inside a tag; the reader's own apart", () => {
  const html = `<a href="#" title="@Bob">x</a> @Bob and @bob's AI, @Alice; mail@Bob`;
  const out = markMentions(html, ["Bob", "Alice", "Bob's AI"], "alice");
  assert.ok(out.startsWith(`<a href="#" title="@Bob">`), "attributes left alone");
  assert.match(out, /<span class="tk-at">@Bob<\/span> and <span class="tk-at">@bob's AI<\/span>, <span class="tk-at me">@Alice<\/span>; mail@Bob$/);
  assert.ok(!markMentions("plain @Carol", [], "Carol").includes("tk-at"));
});

/** An element of the page as the rule reads it (test/surfaces.test.ts). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("the conversation window is the reader's own, whole: nothing pressed or typed in it ends following; nor do its button and a mention's notice", () => {
  const y = YOURS.find((s) => s.id === "conversation");
  assert.ok(y && "where" in y && "whole" in y && y.where.includes("#convo") && y.where.includes("#talk-btn") && y.where.includes("#talk-notice"));
  const box = at("#windows", "#convo", ".cv-body", ".cv-form", ".cv-input");
  assert.equal(inYours(box), true);
  assert.equal(keyActs({ key: "a" }, box, true), false, "typing");
  assert.equal(keyActs({ key: "Enter" }, box, true), false, "sending");
  for (const el of [at("#windows", "#convo", ".cv-head", "button"), at("#windows", "#convo", ".cv-thread", "a"), at("#windows", "#convo", ".fl-rz"), at("#bar", ".talk-wrap", "#talk-btn"), at("#bar", ".talk-wrap", "#talk-notice")])
    assert.equal(pressActs(el), false);
  // the following strip too
  assert.equal(pressActs(at("#windows", "#following", ".fl-strip", "button")), false);
  // the pin is gone
  assert.ok(!YOURS.some((s) => (s.id as string) === "talkPin"));
});
