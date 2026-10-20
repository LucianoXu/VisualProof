// The review and the build on the board (web/src/status.ts): where each declaration stands, the
// targets' stars, the key declarations' diamonds; and the colour scheme, Kind, Status or Mine, with
// its legend (web/src/legend.ts).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { Author } from "../../shared/review.ts";
import { Legend } from "./legend.ts";
import { mineCodes, mineState, SCHEMES_SHOWN, statusCodes, statusState } from "./status.ts";
import type { Scheme } from "./status.ts";
import { invitedId } from "./verified.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the colour scheme gives the page's other parts. */
export interface SchemePart {
  syncStatus: () => void;
  ownScheme: () => Scheme;
  applyScheme: () => void;
  chooseScheme: (s: Scheme) => void;
  /** the next scheme, as `c` steps: Kind, Status, Mine, and round again */
  nextScheme: () => Scheme;
  /** a declaration's state (an index into STATUSES) in the scheme in force, Status's by kind: what
   *  a visitor is drawn with, in the whole graph's numbering */
  pointState: (i: number) => number;
  /** whose opinions Mine shows and `mine(…)` reads: the reader's own, or the followed reader's; null
   *  for a reader without a name */
  mineAuthor: () => Author | null;
  /** the followed reader whose opinions those are, by name; null where they are the reader's own */
  mineWhose: () => string | null;
  /** whose they are may have changed (the reader's name, following someone or no longer): what
   *  shows them is drawn again */
  mineChanged: () => void;
  legend: Legend;
}

export function schemePart(page: Page): SchemePart {
  const { store, S } = page;

  // ---------------------------------------------------------------- whose review Mine is
  //
  // The Mine scheme and the query's `mine(…)` (the owner's decision of 2026-10-20) read one reader's
  // own opinions: this reader's — by their personal link where they came by one, else by their name
  // as their log writes it —, or while they follow someone, that person's, since what they see is
  // followed (CollabSpec decision 4). A reader without a name has none.

  const mineWhose = (): string | null => {
    const k = page.people.followedKey;
    return k && (k.startsWith("v:") || k.startsWith("n:")) ? k.slice(2) : null;
  };
  const mineAuthor = (): Author | null => {
    const whose = mineWhose();
    if (whose !== null) {
      // someone invited by a personal link is their link; a guest their name
      const id = page.people.followedKey!.startsWith("v:") ? invitedId(whose) : null;
      return id ? { by: whose, person: id } : { by: whose };
    }
    const me = page.people.name?.trim() || null;
    const person = page.people.person?.id ?? null;
    return person ? { by: me ?? "", person } : me ? { by: me } : null;
  };
  /** Whose the review Mine reads was, as last drawn: what follows it is made again when it changes. */
  let mineWas = "";
  const mineKey = () => JSON.stringify(mineAuthor());

  /** The codes the canvas colours by, Status's or Mine's (web/src/status.ts). */
  const syncCodes = () => {
    const G = page.vg();
    const d = page.boardReview();
    mineWas = mineKey();
    // a past build's status is its review against now's opinions; its files' builds are not known
    page.canvas.setStatus(page.canvas.scheme === "mine" ? mineCodes(d, G, mineAuthor()) : statusCodes(d, G, page.pastShown() ? new Map() : page.fileIndex));
  };

  /** The review and the build on the canvas: the targets' stars, and where each declaration of
   *  the board stands (web/src/status.ts) — its colour in the Status or the Mine scheme, the
   *  clusters' progress and the legend's counts. What agents advise is not among it: it stays in the
   *  panel. */
  const syncStatus = () => {
    const G = page.vg();
    syncCodes();
    page.canvas.setTargets(Object.keys(page.review.data.targets).map((n) => G.byName.get(n)).filter((j): j is number => j !== undefined));
    // key declarations carry a diamond: where the review has a focus its target's, elsewhere every
    // target's (ExportSpec decision 4); each with the targets it is key for, so that an artwork whose
    // targets are chosen draws their keys alone (decision 19)
    const r = page.reviewRoot();
    const roots = r !== null ? [r] : Object.keys(page.review.data.targets).map((n) => page.g.byName.get(n)).filter((j): j is number => j !== undefined);
    const keys = new Map<number, number[]>();
    for (const t of roots) for (const k of page.flow.keys(t).keys) if (k !== t) keys.set(k, [...(keys.get(k) ?? []), t]);
    const onBoard = (k: number) => G.byName.get(page.g.nodes[k].name);
    const drawn = [...keys].flatMap(([k, ts]) => {
      const j = onBoard(k);
      return j === undefined ? [] : [{ j, of: ts.map(onBoard).filter((t): t is number => t !== undefined) }];
    });
    page.canvas.setKeys(
      drawn.map((d) => d.j),
      drawn.map((d) => d.of),
    );
    legend.render();
    // an artwork's targets by selection list them
    page.art.refresh();
  };

  const pointState = (i: number): number => {
    const g = page.g;
    const d = page.boardReview();
    if (page.canvas.scheme === "mine") return mineState(d, g, i, mineAuthor());
    return statusState(d, g, i, g.isExt(i) || page.pastShown() ? undefined : page.fileIndex.get(g.nodes[i].module), g.axiomsOf(i).includes("sorryAx"));
  };

  // ---------------------------------------------------------------- the colour scheme
  //
  // Kind, Status or Mine (CanvasSpec, "Colour schemes"): the reader's own, kept apart for a board
  // where the review has a focus (Status unless the reader chose otherwise there) and for every other
  // (Kind). Like the edges, and unlike the theme, it is what the board shows: followed (CollabSpec
  // decision 4), never shared on the board.

  /** The review has a focus on the board on show: where the review strip shows. */
  const onReview = () => page.reviewRoot() !== null;
  /** the reader's own colouring here, under an artwork's (drawLook) */
  const ownScheme = () => store.schemeFor(onReview());
  const applyScheme = () => {
    const was = page.canvas.scheme;
    page.canvas.setScheme(page.artLook?.scheme ?? ownScheme());
    // Mine colours by codes of its own: worked out again as it comes or goes, a visitor's too
    if ((was === "mine") !== (page.canvas.scheme === "mine")) {
      syncCodes();
      page.drawVisitors();
    }
    legend.render();
  };
  const chooseScheme = (s: Scheme) => {
    store.setScheme(onReview(), s);
    applyScheme();
    page.people.report();
  };
  const nextScheme = (): Scheme => SCHEMES_SHOWN[(SCHEMES_SHOWN.indexOf(ownScheme()) + 1) % SCHEMES_SHOWN.length];
  const mineChanged = () => {
    const k = mineKey();
    if (k === mineWas) return;
    mineWas = k;
    // what reads it follows as it does a change of the review: the colouring, the boards whose scope
    // reads mine(…), what is lit
    page.reviewChanged();
  };
  const legend = new Legend($("#legend"), {
    scheme: () => page.canvas.scheme,
    setScheme: chooseScheme,
    counts: () => page.canvas.counts(),
    isOpen: () => !!S.legend,
    setOpen: (open) => {
      S.legend = open;
      store.save();
    },
    keyEdges: () => S.mode === "keys",
    mineWhose,
    mineNone: () => mineAuthor() === null,
  });

  return { syncStatus, ownScheme, applyScheme, chooseScheme, nextScheme, pointState, mineAuthor, mineWhose, mineChanged, legend };
}
