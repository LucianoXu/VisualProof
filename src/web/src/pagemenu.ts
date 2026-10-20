// The canvas's menu (ViewSpec, "The canvas's menu"; web/src/ctxmenu.ts): what can be done with a
// declaration, a cluster, a note or the empty canvas, each item doing what the page does elsewhere.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { artNameId } from "../../shared/collab.ts";
import { evaluate, parseQuery, printQuery, sameQuery } from "../../shared/query.ts";
import { keyMarked, under, validPrefix } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { scopeWith, scopeWithout } from "../../shared/scopeedit.ts";
import { noteExcerpt } from "../../shared/sticky.ts";
import { fixedScope } from "../../shared/views.ts";
import type { Target } from "./canvas.ts";
import { ContextMenu, menuItems } from "./ctxmenu.ts";
import type { MenuContext, MenuTarget, TrustTo } from "./ctxmenu.ts";
import { clusterSet, selectionText } from "./selection.ts";
import { chipText, copyLink, noteHash } from "./chatlinks.ts";
import { isPhone } from "./phone.ts";
import { encodeState } from "./state.ts";
import { $, short } from "./page.ts";
import type { Page } from "./page.ts";

/** What the canvas's menu gives the page's other parts. */
export interface MenuPart {
  ctxMenu: ContextMenu;
  menuContext: (part: Query | null) => MenuContext;
  openMenu: (t: Target | null, x: number, y: number, world: [number, number], keys?: boolean, folded?: boolean) => void;
  menuOnSelection: () => void;
}

export function menuPart(page: Page): MenuPart {
  const { data, reader, site } = page;

  // ---------------------------------------------------------------- the canvas's menu
  //
  // A right click on the canvas, or the ContextMenu key or Shift+F10 on what is selected (ViewSpec,
  // "The canvas's menu", decided 2026-10-09): what can be done with a declaration, a cluster or the
  // empty canvas, as web/src/ctxmenu.ts lists it, each item doing what the page does elsewhere —
  // the panel's review, the modes, Duplicate, the scope chips, trusting from the side panel.

  page.menuOn = null;
  const ctxMenu = new ContextMenu($("#ctxmenu"), {
    chose: (act, name) => void menuAct(act, name),
    // what it was open on was lit for it: no longer
    closed: () => page.canvas.preview(null),
  });
  // a right click elsewhere on the page keeps the browser's menu; while this one is open, it is
  // the only one (the ContextMenu key reaches the page as a right click too)
  document.addEventListener("contextmenu", (e) => {
    if (ctxMenu.open) e.preventDefault();
  });
  /** A name can be had for what is recorded under one: given here, or by the proxy. */
  const canName = () => !data.snapshot && !reader && (!!page.people.name || page.people.mode === "declared");
  /** Whether two scopes hold the same set, on the whole graph and the review as they are. */
  const sameSet = (a: Query, b: Query): boolean => {
    const x = evaluate(a, { g: page.g, review: page.boardReview() }), y = evaluate(b, { g: page.g, review: page.boardReview() });
    for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
    return true;
  };
  /** A namespace to trust from the menu, where trusting it can be done from here (TrustTo). */
  const trustOf = (prefix: string | null): TrustTo | null => {
    if (!prefix || !validPrefix(prefix)) return null;
    const by = page.review.data.trusted.filter((t) => under(prefix, t));
    return by.includes(prefix) ? { prefix, on: true } : by.length ? null : { prefix, on: false };
  };
  /** Where the menu is open and what the reader may do there. `part`: what it is open on, as a part
   *  of a scope — the kept views that hold all of it already are said so. */
  const menuContext = (part: Query | null): MenuContext => {
    const rec = page.nav.board.rec;
    const has = part && evaluate(part, { g: page.g, review: page.boardReview() });
    const holds = (scope: string): boolean => {
      if (!has) return false;
      try {
        const set = evaluate(parseQuery(scope), { g: page.g, review: page.boardReview() });
        for (let j = 0; j < has.length; j++) if (has[j] && !set[j]) return false;
        return true;
      } catch {
        return false;
      }
    };
    return {
      fixed: fixedScope(rec),
      review: page.reviewName(),
      // every view whose scope can change, the kept ones first, then those open now and not kept
      // yet, which adding to keeps (ViewSpec decision 21)
      views: page.views.summaries
        .filter((v) => !fixedScope(v) && v.id !== rec.id)
        .sort((a, b) => Number(b.kept) - Number(a.kept))
        .slice(0, 40)
        .map((v) => ({ id: v.id, title: page.views.title(v.id), holds: holds(v.scope), ...(v.kept ? {} : { temporary: true }) })),
      // a preview of the view at another build is arranged by nobody here; a past build is not
      // reviewed (the owner's decision of 2026-10-10)
      arrange: (!!data.snapshot || canName()) && !page.frozen(),
      here: fixedScope(rec) ? null : rec.id,
      write: canName() && !page.blocked() && !page.pastShown(),
      past: page.pastShown(),
      preview: page.frozen(),
      // a phone: a source takes the whole screen, nothing is pinned beside it (PhoneSpec decision 13)
      noPin: isPhone(),
      // a link to it, without the key, wherever there is a server to open it (CollabSpec decision 13)
      link: !data.snapshot,
    };
  };
  /** Open the menu on what is at a point of the window: a declaration or a cluster of the board,
   *  or the empty canvas; `keys`: from the keyboard; `folded`: a cluster folded where the menu is
   *  open (the linear form's own folds). What it is open on is lit while it is. */
  const openMenu = (t: Target | null, x: number, y: number, world: [number, number], keys = false, folded?: boolean) => {
    const title = page.views.title(page.nav.board.id);
    // the menu says what it is on: the pointer's tooltip goes
    $("#tip").hidden = true;
    if (t?.kind === "node" || t?.kind === "visitor") {
      // a visitor is a declaration as any, but for what is on the board (ViewSpec decision 27)
      const visitor = t.kind === "visitor";
      const i = visitor ? page.g.byName.get(page.visitors[t.k]?.name ?? "") : page.toFull(t.i);
      if (i === undefined) return;
      const name = page.g.nodes[i].name;
      const r = page.reviewRoot();
      // an artwork's names by selection: its name shown in the picture, or not (ExportSpec decision 19)
      const artName = t.kind === "node" ? artNameId("decl", page.canvas.g.nodes[t.i].name) : undefined;
      const inArt = artName ? page.art.nameChosen(artName) : undefined;
      const mt: MenuTarget = {
        kind: "decl",
        name,
        ext: page.g.isExt(i),
        key: r !== null && page.flow.keyable(r, i) ? keyMarked(page.boardReview(), page.g.nodes[r].name, name) : null,
        target: Object.hasOwn(page.boardReview().targets, name),
        ns: page.g.isExt(i) ? null : trustOf(name.split(".").slice(0, -1).join(".") || null),
        ...(visitor ? { visitor: true } : {}),
        ...(inArt !== undefined ? { art: inArt } : {}),
      };
      // a scope is written in the names of now, as a move keeps it (a past graph's renamed one)
      page.menuOn = { t: mt, i, part: { op: "decl", names: [page.declNow(i)] }, world, at: { x, y }, ...(artName ? { artName } : {}) };
      if (t.kind === "node") page.canvas.preview(t.i);
      ctxMenu.show(menuItems(mt, menuContext(page.menuOn.part), title), x, y, name, keys);
    } else if (t?.kind === "cluster") {
      const cl = page.canvas.layout.clusters[t.c];
      const st = page.trust.state(cl, page.cm());
      const artName = artNameId("cluster", cl.key);
      const inArt = page.art.nameChosen(artName);
      const mt: MenuTarget = {
        kind: "cluster",
        key: cl.key,
        folded: folded ?? page.canvas.folded.has(t.c),
        folder: page.cm() === "module",
        trust: st.prefix && (st.on || !st.by) ? { prefix: st.prefix, on: st.on } : null,
        ...(inArt !== undefined ? { art: inArt } : {}),
      };
      page.menuOn = { t: mt, c: t.c, part: clusterSet(cl.key, page.cm()), world, at: { x, y }, artName };
      page.canvas.previewCluster(t.c);
      ctxMenu.show(menuItems(mt, menuContext(page.menuOn.part), title), x, y, cl.key.replace("⟨external⟩", "External"), keys);
    } else {
      const mt: MenuTarget = { kind: "canvas" };
      page.menuOn = { t: mt, part: null, world, at: { x, y } };
      ctxMenu.show(menuItems(mt, menuContext(null), title), x, y, title, keys);
    }
  };
  /** The ContextMenu key or Shift+F10: the menu on what the panel tells of, where it is on the
   *  canvas (kept within the canvas's free part), or on the empty canvas in its middle. */
  const menuOnSelection = () => {
    const I = page.canvas.insets;
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    const inside = (p: [number, number]): [number, number] => [Math.max(I.left + 8, Math.min(W - I.right - 8, p[0])), Math.max(I.top + 8, Math.min(H - I.bottom - 8, p[1]))];
    const i = page.selected();
    const c = page.shownCluster();
    let t: Target | null = null;
    let at: [number, number];
    const k = i === null ? -1 : page.visitorOf(i);
    if (i !== null && page.toView(i) >= 0) {
      t = { kind: "node", i: page.toView(i) };
      at = page.canvas.toScreen(...page.canvas.posOf(page.toView(i)));
    } else if (k >= 0 && page.canvas.visitorPos(k)) {
      t = { kind: "visitor", k };
      at = page.canvas.toScreen(...page.canvas.visitorPos(k)!);
    } else if (c >= 0) {
      t = { kind: "cluster", c };
      at = page.canvas.screenOf("cluster", page.canvas.layout.clusters[c].key)!;
    } else at = [I.left + (W - I.left - I.right) / 2, I.top + (H - I.top - I.bottom) / 2];
    const [x, y] = inside(at);
    openMenu(t, x, y, page.canvas.toWorld(x, y), true);
  };
  /** Copy text to the clipboard; where the browser refuses (a page not served securely), through a
   *  field selected for the moment. */
  const copyText = async (text: string, said = `Copied ${text}`) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const f = document.createElement("textarea");
      f.value = text;
      f.style.cssText = "position: fixed; opacity: 0; pointer-events: none";
      document.body.append(f);
      f.select();
      document.execCommand("copy");
      f.remove();
    }
    page.say(said);
  };
  /** Copy link (ViewSpec decision 21, CollabSpec decision 13): a link to what the menu was opened on
   *  — a declaration, a cluster, a note — or, on the empty canvas, to what the reader sees (decision
   *  7's snapshot, whatever Share's switch), on the board on show; never with the key. The page says
   *  it was copied, as a conversation will show it. */
  const copyLinkTo = async (on: NonNullable<Page["menuOn"]>) => {
    const t = on.t;
    const base = page.current();
    let hash: string;
    if (t.kind === "decl") hash = encodeState({ ...base, picks: selectionText([page.pickDecl(t.name)]), shown: { decl: t.name } });
    else if (t.kind === "cluster" && on.c !== undefined) hash = encodeState({ ...base, picks: selectionText([page.pickCluster(on.c)]), shown: { cluster: t.key } });
    else if (t.kind === "cluster") hash = encodeState({ ...base, picks: null, shown: { cluster: t.key } });
    else if (t.kind === "note" && on.note) hash = noteHash(encodeState(base), on.note, page.noteOf(on.note)?.kind === "view");
    else hash = await page.seenHash();
    const url = copyLink({ origin: site.base, pathname: location.pathname }, hash);
    const c = page.chipFor(url);
    await copyText(url, `Link copied: ${c ? chipText(c) : "this page"}. It carries no key: whoever opens it must be let in already.`);
  };
  /** What the menu was open on, in a few words. */
  const menuWhat = (t: MenuTarget) => (t.kind === "decl" ? short(t.name) : t.kind === "cluster" ? short(t.key) : "it");
  /** Take `part` out of the board on show (`scope except part`): for everyone on it; on the Project,
   *  whose scope stays, in a copy of it named `name`, shown in a tab. */
  const removeFromBoard = async (part: Query, what: string, name?: string) => {
    const rec = page.nav.board.rec;
    const next = scopeWithout(rec.scope, part, sameSet);
    if (sameQuery(next, rec.scope)) return page.say(`This board does not hold ${what}.`);
    if (!fixedScope(rec)) {
      const why = await page.sync.setScope(next);
      if (why) page.say(why);
      return;
    }
    const why = (await page.named()) ?? (await page.made(await page.views.post("create", { name: name ?? `${page.views.title(rec.id)} without ${what}`, from: rec.id, scope: printQuery(next) })));
    if (why) page.say(why);
  };
  /** Add `part` to a view (`scope or part`), for everyone on it: a kept one, or the board on show,
   *  where a visitor so becomes a member (ViewSpec decision 27), shown at once. */
  const addToView = async (id: string, part: Query, what: string) => {
    const v = page.views.summary(id);
    const here = id === page.nav.board.id;
    if (!v && !here) return;
    let scope: Query;
    try {
      scope = here ? page.nav.board.rec.scope : parseQuery(v!.scope);
    } catch {
      return page.say(`The scope of “${page.views.title(id)}” cannot be read here.`);
    }
    const next = scopeWith(scope, part, sameSet);
    if (sameQuery(next, scope)) return page.say(`“${page.views.title(id)}” holds ${what} already.`);
    if (here) {
      const why = await page.sync.setScope(next);
      return page.say(why ?? `Added ${what} to this view: a member of it now.`);
    }
    const r = await page.views.post("scope", { id, scope: printQuery(next) });
    if (r.who) page.people.lost();
    if (r.error) return page.say(r.error);
    page.sync.afterPost();
    page.say(`Added ${what} to “${page.views.title(id)}”.`);
  };

  /** Do what was chosen in the menu. */
  const menuAct = async (act: string, name?: string) => {
    const on = page.menuOn;
    if (!on) return;
    const t = on.t;
    const what = menuWhat(t);
    const i = on.i;
    if (act.startsWith("add:")) return on.part && addToView(act.slice(4), on.part, what);
    if (act.startsWith("detach:")) return on.note ? void page.detach(on.note, Number(act.slice(7))) : undefined;
    if (act.startsWith("item:")) return on.note ? void page.itemTo(on.note, act.slice(5)) : undefined;
    switch (act) {
      case "art-name":
        if (on.artName && (t.kind === "decl" || t.kind === "cluster")) page.art.showName(on.artName, !t.art);
        return;
      case "source":
        if (i !== undefined) page.sources.show(i);
        return;
      case "pin":
        if (i !== undefined) page.sources.openPinned(i);
        return;
      case "tcb":
      case "deps":
      case "apps":
        // a pick under that mode, as its button does
        if (t.kind !== "decl") return;
        page.useTool(act);
        page.syncTool();
        page.clickOn(page.pickDecl(t.name), false);
        return;
      case "copy":
        if (t.kind === "decl") await copyText(t.name);
        return;
      case "link":
        await copyLinkTo(on);
        return;
      case "remove":
      case "remove-new":
        if (on.part) await removeFromBoard(on.part, what, name);
        return;
      case "add-new": {
        if (!on.part) return;
        const why = (await page.named()) ?? (await page.made(await page.views.post("create", { name: name ?? what, scope: printQuery(on.part) })));
        if (why) page.say(why);
        return;
      }
      case "key":
        if (i !== undefined) page.toggleKey(i);
        return;
      case "target": {
        if (t.kind !== "decl" || !(await page.people.ensure())) return;
        const why = await page.submit({ op: "target", name: t.name, on: !t.target });
        if (why) page.say(why);
        return;
      }
      case "approve":
      case "comment": {
        // the review box, in the panel, with the focus where the opinion is given
        if (i === undefined) return;
        if (page.selected() !== i) page.go(i);
        setTimeout(() => {
          const box = act === "approve" ? $("#panel").querySelector<HTMLElement>('[data-rv="approve"]') : $("#panel").querySelector<HTMLElement>("[data-rv-comment]");
          box?.focus();
          box?.scrollIntoView({ block: "nearest" });
        }, 60);
        return;
      }
      case "trust": {
        const to = t.kind === "decl" ? t.ns : t.kind === "cluster" ? t.trust : null;
        if (to) page.trust.ask(to.prefix, !to.on, on.at);
        return;
      }
      case "fold":
        if (on.linear && t.kind === "cluster") page.linear.toggleFold(t.key);
        else if (on.c !== undefined) page.canvas.toggleFold(on.c);
        return;
      case "hide":
        if (t.kind === "cluster") page.hideLevel(t.key);
        return;
      case "fit":
        if (on.linear) page.linear.fit();
        else page.canvas.fit();
        return;
      case "relayout":
        await page.relayout();
        return;
      case "note":
      case "note-view":
        await page.writeNote(act === "note" ? "project" : "view", on.at, on.world);
        return;
      case "note-edit":
        if (on.note) await page.editNote(on.note, on.at);
        return;
      case "note-toggle":
        if (on.note) page.setNoteOpen(on.note, !page.noteOpenHere(on.note));
        return;
      case "note-kind":
        if (on.note) await page.switchNote(on.note);
        return;
      case "item-remove":
        if (on.note) await page.itemTo(on.note, null);
        return;
      case "note-attach": {
        const n = on.note ? page.noteOf(on.note) : null;
        const no = page.noteRefused();
        if (no) return page.say(no);
        if (n) page.papers.chooseToAttach(n.note.id, noteExcerpt(n.note.text, 40));
        return;
      }
      case "note-delete": {
        const n = on.note ? page.noteOf(on.note) : null;
        const where = n?.kind === "project" ? "the project, for everyone, on the Project and every view that shows it" : `“${page.views.title(page.nav.board.id)}”, for everyone on it`;
        if (!n || !confirm(`Delete this note from ${where}?\n\n${n.note.text.slice(0, 200)}`)) return;
        if (await page.named()) return;
        if (n.kind === "project") void page.projectOps([{ op: "pnote-delete", id: n.note.id }]);
        else page.noteOps([{ op: "note-delete", id: n.note.id }]);
        return;
      }
    }
  };

  return { ctxMenu, menuContext, openMenu, menuOnSelection };
}
