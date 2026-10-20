// The review and the build on the board (web/src/status.ts): where each declaration stands, the
// targets' stars, the key declarations' diamonds; and the colour scheme, Kind or Status, with its
// legend (web/src/legend.ts).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { Legend } from "./legend.ts";
import { statusCodes } from "./status.ts";
import type { Scheme } from "./status.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the colour scheme gives the page's other parts. */
export interface SchemePart {
  syncStatus: () => void;
  ownScheme: () => Scheme;
  applyScheme: () => void;
  chooseScheme: (s: Scheme) => void;
  legend: Legend;
}

export function schemePart(page: Page): SchemePart {
  const { store, S } = page;

  /** The review and the build on the canvas: the targets' stars, and where each declaration of
   *  the board stands (web/src/status.ts) — its colour in the Status scheme, the clusters' progress
   *  and the legend's counts. What agents advise is not among it: it stays in the panel. */
  const syncStatus = () => {
    const G = page.vg();
    // a past build's status is its review against now's opinions; its files' builds are not known
    page.canvas.setStatus(statusCodes(page.boardReview(), G, page.pastShown() ? new Map() : page.fileIndex));
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

  // ---------------------------------------------------------------- the colour scheme
  //
  // Kind or Status (CanvasSpec, "Colour schemes"): the reader's own, kept apart for a board where the
  // review has a focus (Status unless the reader chose otherwise there) and for every other (Kind).
  // Like the edges, and unlike the theme, it is what the board shows: followed (CollabSpec decision
  // 4), never shared on the board.

  /** The review has a focus on the board on show: where the review strip shows. */
  const onReview = () => page.reviewRoot() !== null;
  /** the reader's own colouring here, under an artwork's (drawLook) */
  const ownScheme = () => store.schemeFor(onReview());
  const applyScheme = () => {
    page.canvas.setScheme(page.artLook?.scheme ?? ownScheme());
    legend.render();
  };
  const chooseScheme = (s: Scheme) => {
    store.setScheme(onReview(), s);
    applyScheme();
    page.people.report();
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
  });

  return { syncStatus, ownScheme, applyScheme, chooseScheme, legend };
}
