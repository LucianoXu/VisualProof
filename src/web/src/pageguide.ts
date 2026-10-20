// The guide (GuideSpec, web/src/guide.ts): the tour's and Show me's own moves on the reader's page,
// the help's About, and the moments of tips in place that a press makes.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import { Guide, restsOnCounts } from "./guide.ts";
import type { RestsOn } from "./guide.ts";
import { reducedMotion } from "./tipcards.ts";
import { declPick, restsOn, retool, selectionQuery, shownOf } from "./selection.ts";
import type { Pick, Shown, Tool } from "./selection.ts";
import { isPhone } from "./phone.ts";
import { tipsPart } from "./state.ts";
import type { Visitor } from "./visitors.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the guide gives the page's other parts. */
export interface GuidePart {
  guide: Guide;
}

export function guidePart(page: Page): GuidePart {
  const { data, store, S, reader, editor } = page;

  /** The project as read, for the About part of the help sheet: how much the graph holds, when it
   *  was read and under which toolchain (it was a line at the foot of the page until 2026-10-08). */
  const about = () =>
    `${page.meta.projectCount.toLocaleString()} declarations · ${(page.meta.nodes.length - page.meta.projectCount).toLocaleString()} outside the project · ` +
    `${page.meta.edgeCount.toLocaleString()} edges. Read ${new Date(page.meta.project.extractedAt).toLocaleString()}, under ${page.meta.project.toolchain}.`;
  // the guide (GuideSpec): the tour on a first visit, the ? sheet at any time, its tips; tips in place
  /** The tour's and Show me's own moves (GuideSpec decisions 3 and 7): a theorem selected, a tool
   *  chosen, as a click and a mode's button would, but without a step in the history each, and
   *  without anything a tip in place counts as the reader's doing. */
  const tourSelect = (i: number) => {
    if (page.selected() !== i) {
      if (page.toView(i) < 0) page.visitOn(i, page.selected());
      const p = page.pickDecl(page.g.nodes[i].name);
      page.picks = [p];
      page.shown = shownOf(p);
      page.apply();
    }
    page.reveal(i);
    // with reduced motion nothing in the tour glides (GuideSpec decision 4): the camera is there at once
    if (reducedMotion()) page.canvas.arrive();
  };
  const tourTool = (m: Tool) => {
    if (m === S.mode) return;
    S.mode = m;
    if (restsOn(m)) S.restsOn = m;
    page.syncTool();
    const r = retool(page.picks, page.shown, m, (root) => page.keysFor(root));
    if (r.picks === page.picks) return;
    page.picks = r.picks;
    page.shown = r.shown;
    page.apply();
  };
  /** Where the reader is when the tour begins, put back when it ends (GuideSpec decision 3): the
   *  tool and the step of Rests on a 2 resumes, the selection, the visitors, the camera; the address
   *  as it was, so that the tour leaves no step in the history. */
  interface TourPlace {
    mode: Tool;
    restsOn: Tool | undefined;
    picks: Pick[];
    shown: Shown | null;
    visitors: Visitor[];
    cam: { x: number; y: number; k: number };
  }
  const tourPlace = (): TourPlace => ({ mode: S.mode, restsOn: S.restsOn, picks: page.picks, shown: page.shown, visitors: page.visitors, cam: { ...page.canvas.cam } });
  const tourBack = (p: TourPlace) => {
    S.mode = p.mode;
    S.restsOn = p.restsOn;
    store.save();
    page.syncTool();
    page.picks = p.picks;
    page.shown = p.shown;
    page.visitors = p.visitors;
    page.apply();
    if (reducedMotion()) page.canvas.jumpTo(p.cam);
    else page.canvas.glideTo(p.cam, 450);
    page.writeAddress(false);
  };
  /** What Keys lights beside declaration `name` on the board on show, as the tour's Keys view counts
   *  it: the key declarations of the review's focus here, else the target's own. */
  const keysLit = (name: string): number => {
    const q = selectionQuery([declPick("keys", name, page.keysFor({ decl: name }))]);
    return q ? Math.max(0, page.litOn(q).count - 1) : 0;
  };
  /** The declaration the tour shows things on (GuideSpec decision 3): the selection; a target whose
   *  Keys view lights key declarations, else a target; else a theorem whose TCB is worth a look and
   *  not a wall, one whose proofs use more than its statement first, so that the TCB leaves
   *  something out. */
  const findExample = (): number | null => {
    if (page.selected() !== null) return page.selected();
    const targets = Object.keys(page.review.data.targets)
      .map((n) => page.g.byName.get(n))
      .filter((i): i is number => i !== undefined);
    const keyed = targets.find((i) => keysLit(page.g.nodes[i].name) > 0);
    if (keyed !== undefined) return keyed;
    if (targets.length) return targets[0];
    let fallback: number | null = null;
    let tries = 0;
    for (let i = 0; i < page.g.projectCount && tries < 400; i++) {
      if (page.g.nodes[i].kind !== "theorem") continue;
      tries++;
      let n = 0, u = 0;
      const tcb = page.g.reach([i], SITE_STMT | SITE_BODY, "out");
      for (let j = 0; j < page.g.projectCount; j++) n += tcb[j];
      if (n < 6 || n > 300) continue;
      const uses = page.g.reach([i], SITE_STMT | SITE_BODY | SITE_PROOF | SITE_GRAMMAR, "out");
      for (let j = 0; j < page.g.projectCount; j++) u += uses[j];
      if (u > n) return i;
      fallback ??= i;
    }
    return fallback;
  };
  /** The same, found once for a graph, a board, a revision of the review and a selection: the
   *  sheet asks it of each card, at each key typed in its filter. */
  let exampleOf: { key: unknown[]; i: number | null } | null = null;
  const tourExample = (): number | null => {
    const key = [page.g, page.nav.board, page.review.epoch, page.review.rev, page.selected()];
    if (exampleOf && exampleOf.key.every((x, k) => x === key[k])) return exampleOf.i;
    const i = findExample();
    exampleOf = { key, i };
    return i;
  };
  /** What the tour's TCB step says of declaration `i` (GuideSpec decision 2): what each of its
   *  views lights on the board on show, as the selection bar counts it, the theorem apart; what is
   *  lit split, as the bar splits it, into what is to be read and what is trusted (a prefix the
   *  review trusts, a standard axiom: TCBSpec decision 7), and assumed. */
  const restsOnOf = (i: number): RestsOn => {
    const name = page.g.nodes[i].name;
    const G = page.vg();
    const d = page.boardReview();
    const lit = (tool: Tool) => {
      const q = selectionQuery([declPick(tool, name, page.keysFor({ decl: name }))]);
      return q ? page.litOn(q).set : null;
    };
    const counts = restsOnCounts(G, d, page.toView(i), { tcb: lit("tcb"), uses: lit("deps"), keys: lit("keys") });
    return { name: page.g.nodes[i].display ?? name.split(".").pop()!, ...counts, target: page.isTarget(name) };
  };
  /** A tip's Show me (GuideSpec decision 7; web/src/tips.ts), done on the reader's own page: the tour's
   *  theorem selected in a mode, a window or a popover opened, the linear form, the Time Machine —
   *  never anything shared, and nothing a tip in place counts as the reader's doing. What to ring
   *  after it, as a phone shows it; null when there is nothing to show here. */
  const showMe = (action: string): string | null => {
    const i = tourExample();
    const phone = isPhone();
    const pick = (m: Tool | null): boolean => {
      if (i === null) return false;
      if (m) tourTool(m);
      tourSelect(i);
      return true;
    };
    switch (action) {
      case "ring-modes":
        return phone ? "#more-btn" : "#lightup";
      case "rests-steps":
        return pick("tcb") ? (phone ? "#more-btn" : "#rests-steps") : null;
      case "used-by": {
        if (i === null) return null;
        // the first of its TCB's definitions besides it, else itself
        const tcb = page.g.reach([i], SITE_STMT | SITE_BODY, "out");
        let d = i;
        for (let j = 0; j < page.g.projectCount; j++) if (tcb[j] && j !== i && page.g.nodes[j].kind === "def") { d = j; break; }
        tourTool("apps");
        tourSelect(d);
        return phone ? "#more-btn" : "#lightup [data-mode=apps]";
      }
      case "open-source":
        if (!pick(null)) return null;
        if (!page.sources.following) page.sources.toggle(page.selected());
        return ".sw-win";
      case "colour-status":
        if (page.ownScheme() !== "status") page.chooseScheme("status");
        $("#legend [data-lg-open]")?.click();
        return "#legend";
      case "ring-review":
        return pick(null) ? "#panel .rv" : null;
      case "ring-target":
        return pick(null) ? (phone ? "#panel [data-rv-target]" : "#panel [data-rv-target], #targets") : null;
      case "ring-key":
        // the targets are in ☰ on a phone
        return page.reviewRoot() !== null && pick(null) ? "#panel [data-rv-key]" : phone ? "#side-btn" : "#targets";
      case "what-changed": {
        const d = $("#panel details[data-rv-changes]") as HTMLDetailsElement | null;
        if (!d) return null;
        d.open = true;
        return "#panel [data-rv-changes]";
      }
      case "ring-trusted":
        return phone ? "#side-btn" : "#trusted-btn";
      case "library-pair":
        return phone ? "#more-btn" : "#library-btn";
      case "ring-lock":
        if (!page.eyesPop.open) page.eyesPop.toggle(true);
        return "#lock-btn";
      case "ring-zoom":
        return pick("tcb") ? "#selbar [data-zoom]" : null;
      case "ring-board":
        return phone ? "#side-btn" : "#board-btn";
      case "ring-peers":
        return "#peers";
      // Share, the library and Export are in ⋯ on a phone
      case "ring-share":
      case "share-readonly":
      case "share-agent":
        return phone ? "#more-btn" : "#share-btn";
      case "linear":
        if (!page.linear.asked) page.linear.toggle();
        return "#linear";
      case "ring-export":
        return phone ? "#more-btn" : "#export-btn";
      case "time-machine":
        if (!page.tm.active) void page.openTimeMachine();
        return "#tmbar";
      case "ring-lost":
        if ($("#build-pop").hidden) $("#build").click();
        return "#build-pop [data-bp=lost]";
    }
    return null;
  };
  /** Whether a Show me has something to show on this page. */
  const canShowMe = (action: string): boolean => {
    if (["rests-steps", "used-by", "open-source", "ring-review", "ring-target", "ring-zoom", "tcb-three"].includes(action)) return tourExample() !== null;
    // what a phone has not: the lock, the linear form (PhoneSpec)
    if (isPhone() && (action === "ring-lock" || action === "linear")) return false;
    if (action === "ring-peers") return !$("#peers").hidden;
    if (action === "what-changed") return !!$("#panel details[data-rv-changes]");
    if (action === "share-readonly") return page.readOnlyLinks;
    if (action === "share-agent" || action === "ring-lock") return !reader;
    if (action === "time-machine" || action === "ring-lost") return !data.snapshot;
    return true;
  };
  const guide = new Guide(store, {
    project: () => page.meta.project.name,
    about,
    snapshot: () => !!data.snapshot,
    readOnly: () => !!data.snapshot || !!reader,
    following: () => page.people.followedName !== null,
    busy: () => !!page.artLook,
    example: tourExample,
    select: tourSelect,
    setTool: tourTool,
    place: tourPlace,
    back: (p) => tourBack(p as TourPlace),
    // Show me's moves, one step in the history
    record: page.commit,
    restsOn: restsOnOf,
    frameLit: () => {
      const q = selectionQuery(page.picks);
      const lit = q && page.litOn(q);
      if (lit?.count) page.canvas.fitTo(lit.set, !reducedMotion());
    },
    show: showMe,
    canShow: canShowMe,
    // the read-only link's tip on a server that makes them (web/src/share.ts)
    applies: (t) => t.id !== "read-only-link" || page.readOnlyLinks,
    ended: () => {},
    editor: () => ({ server: editor.server, mine: editor.mine }),
    setEditor: (t) => {
      const why = editor.set(t);
      // the panel and the source windows show the link, or no longer do
      if (!why) {
        page.sources.redraw((name) => page.g.byName.get(name));
        page.showSelected();
      }
      return why;
    },
    updates: () => (data.snapshot ? Promise.resolve(null) : data.updates()),
    clips: () => (data.snapshot ? Promise.resolve(new Set<string>()) : data.tipClips()),
    // the film in the address while it shows (`tips`), and not once the sheet closes
    shown: (open, chapter) => {
      const part = tipsPart(open, chapter);
      if (part === page.filmPart) return;
      page.filmPart = part;
      page.writeAddress(false);
    },
    tour: () => (data.snapshot ? Promise.resolve(null) : data.tourJson()),
  });
  page.offerTip = (rule) => guide.inPlace.offer(rule);
  page.didTip = (rule) => guide.inPlace.did(rule);
  page.countTip = (name, rule) => guide.inPlace.count(name, rule);
  page.hearRelease = (v) => guide.serverIs(v);
  if (page.heardRelease) guide.serverIs(page.heardRelease);
  if (!data.snapshot && !reader) void data.shareInfo().then((i) => (page.readOnlyLinks = !!i.readOnlyLinks), () => {});
  // the moments of tips in place that a press makes: Share opened again, Export opened; and what a
  // tip teaches, done — the Read-only link tab opened, What changed opened
  let shareOpened = 0;
  $("#share-btn").addEventListener("click", () =>
    setTimeout(() => {
      if (!$("#share-pop").hidden && ++shareOpened >= 2 && page.readOnlyLinks) page.offerTip("share-twice");
    }, 300),
  );
  $("#export-btn").addEventListener("click", () => setTimeout(() => page.exportModal.isOpen && page.offerTip("first-export"), 300));
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("#share-pop [data-tab=readonly]")) page.didTip("share-twice");
      else if (t.closest("#panel [data-rv-changes] > summary")) page.didTip("stale-opinion");
    },
    true,
  );

  return { guide };
}
