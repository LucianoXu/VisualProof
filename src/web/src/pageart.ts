// The artwork mode (ExportSpec decisions 19 and 20, web/src/artframe.ts): the board drawn as a
// picture with the artwork's settings, the bar out of reach but for Share and Search, and a link's
// recipe opened and its files saved.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { GitSource } from "../../shared/graph.ts";
import { holdTheme } from "./theme.ts";
import { decodeRecipe, readRecipe, resolveRecipe } from "../../shared/artrecipe.ts";
import { ArtFrame } from "./artframe.ts";
import type { ArtSettings } from "./artwork.ts";
import { sourceLine, titleOf, untilStill } from "./artwork.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the artwork gives the page's other parts. */
export interface ArtPart {
  ART_KEYS: Set<string>;
  art: ArtFrame;
  artReach: () => void;
  openRecipe: (link: { text: string; save: ("png" | "svg")[] }) => Promise<void>;
}

export function artPart(page: Page): ArtPart {
  const { data, store, S } = page;

  /** In the artwork mode (ExportSpec decision 19, the owner's decision of 2026-10-15): of the bar,
   *  what is out of reach — all but Share and Search; and the keys that still act. */
  const ART_INERT = "#bar .brand, #bar .library-wrap, #export-btn, #activity-btn, #bar .talk-wrap, #bar .peers-wrap, #bar .who-wrap, #help-btn, #bar .more-wrap";
  const ART_KEYS = new Set(["/", "1", "2", "3", "f", "+", "=", "-", "_", "e", "[", "]", "l"]);
  // the board as a picture (ExportSpec decision 19, web/src/artframe.ts): the board itself, drawn
  // with the artwork's settings (`artLook`, drawLook below), a frame over it saying what is saved
  page.artLook = null;
  /** the project's git source and commit as git says them, asked when the page opens and again
   *  whenever the artwork comes (its foot; GET /api/git): a commit made after the build is told */
  let gitNow: GitSource | null = null;
  /** the last asking of it, which a link's recipe waits for before it saves (openRecipe) */
  let gitAsked: Promise<void> = data.git().then((git) => {
    gitNow ??= git;
  });
  const art = new ArtFrame($("#art"), $("#art-panel"), $("#art-sky") as HTMLCanvasElement, page.canvas, {
    title: () => page.views.title(page.nav.board.id),
    saved: () => S.artwork as Partial<ArtSettings> | undefined,
    save: (s) => {
      S.artwork = { ...s };
      store.save();
    },
    // a picture is drawn by kind or by status: Mine, the reader's own, starts it by status
    now: () => ({ scheme: page.canvas.scheme === "kind" ? "kind" : "status", theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" }),
    look: (s) => {
      const coming = !page.artLook && !!s;
      page.artLook = s && { ...s };
      drawLook();
      if (coming)
        gitAsked = data.git().then((git) => {
          gitNow = git;
          art.refresh();
        });
    },
    changed: () => page.people.report(),
    notes: () => page.stickies.asDrawn(),
    // the commit checked out now; on a past build's board, that build's, with the project's source
    source: () => {
      const then = page.vg().meta.project.git;
      const git = page.pastShown() ? then && { ...then, source: then.source ?? gitNow?.source ?? null } : gitNow;
      return git ? sourceLine(git) : null;
    },
    // the targets a picture can mark: every one of the review's, by the name the board writes
    targets: () =>
      Object.keys(page.review.data.targets)
        .map((name) => ({ name, label: name.split(".").pop() ?? name }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name)),
    // the title where the reader gave none: the project's name, its declarations and its targets
    titles: () => titleOf(page.meta.project.name, page.meta.projectCount, Object.keys(page.review.data.targets).length),
    say: (text) => page.say(text),
  });
  // the board's names are written in an artwork's fonts once they are there
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (!page.artLook) return;
    page.canvas.invalidate();
    page.canvas.request();
  });
  /** The board drawn with the artwork's settings while its mode is on, or as the reader's own again
   *  (ExportSpec decision 19): the colouring and the theme, the background, the notes, the edges, the
   *  names, the targets and the selection; the panels put away for the frame. The reader's own
   *  choices are kept as they are, under it. */
  const drawLook = () => {
    const a = page.artLook;
    document.body.classList.toggle("framing", !!a);
    document.body.classList.toggle("art-nonotes", !!a && !a.notes);
    if (a && a.background !== "theme") document.body.dataset.artBg = a.background;
    else delete document.body.dataset.artBg;
    // the cells and the starfield are dark, on a dark ground round the frame
    if (a && a.style !== "board") document.body.dataset.artStyle = a.style;
    else delete document.body.dataset.artStyle;
    artReach();
    if (a) page.linear.hide("reader", "followed");
    holdTheme(a ? (a.style === "board" ? a.theme : "dark") : null);
    page.canvas.setArt(a && { labels: a.labels, namesFrom: a.namesFrom, hidden: new Set(a.hiddenNames), shown: new Set(a.shownNames), ruled: new Set(a.ruledNames), edges: a.edges, targets: a.targets, shownTargets: new Set(a.shownTargets), keys: a.keys, style: a.style });
    page.applyScheme();
    page.syncEdges();
    page.apply();
  };
  /** Of the bar in the artwork mode, Share and Search alone (the owner's decision of 2026-10-15): the
   *  rest is out of reach until the mode is left, by the pointer and by the keyboard — but the people
   *  while the reader follows someone, whose initials clicked again end following (CollabSpec,
   *  "Following ends" and "What following leaves"): the mode is the follower's own once it has. */
  const artReach = () => {
    for (const el of document.querySelectorAll<HTMLElement>(ART_INERT)) el.inert = !!page.artLook && !(page.people.following && el.matches(".peers-wrap"));
  };
  /** when the board was last drawn: a link's recipe saves its files once the board is still */
  let drawnAt = 0;
  page.canvas.onFrame = () => {
    drawnAt = performance.now();
    page.stickies.frame();
    // the artwork's list of names follows what its frame holds
    art.frame();
  };
  /** Open a link's artwork recipe (ExportSpec decision 20, shared/artrecipe.ts) on the board its
   *  address opened, the selection it carries made: resolved against this board, the artwork mode
   *  opened with what it says (not kept as this reader's settings until they change one), the whole
   *  board fitted in its frame; the files it asks for saved once the board has been still a moment,
   *  with its fonts and the git commit there. What it names that this board has not is said in a
   *  line; `data-artwork-saved` on the page says what was saved, for a script that waits for it. */
  const openRecipe = async (link: { text: string; save: ("png" | "svg")[] }) => {
    const read = readRecipe(decodeRecipe(link.text));
    if ("error" in read) return page.say(`This link's artwork could not be read: ${read.error}`);
    const L = page.canvas.layout;
    const { look, problems, left } = resolveRecipe(read.recipe, {
      clusters: L.clusters,
      clusterOf: (name) => {
        const i = page.g.byName.get(name);
        const j = i === undefined ? -1 : page.toView(i);
        return j < 0 ? undefined : L.cluster[j];
      },
      targets: Object.keys(page.review.data.targets),
      projectCount: page.g.projectCount,
    });
    if (problems.length || left) page.say(`This link's artwork: ${[...problems, ...(left ? [`${left} names left out, more than an artwork carries`] : [])].join("; ")}.`);
    if (art.isOpen) await art.close();
    // come: the board drawn with the look, which asked for the git commit as it came (gitAsked)
    await art.open(look);
    if (!link.save.length) return;
    const since = performance.now();
    await gitAsked;
    await document.fonts?.ready;
    // drawn since the mode came, then still for 800 ms (the overview's edges come from a worker), at
    // most 20 s
    page.canvas.request();
    await untilStill({ now: () => performance.now(), drawnAt: () => drawnAt, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, since);
    // a browser asks before a site saves several files at once (the owner's decision of 2026-10-15:
    // the reader is told)
    if (link.save.length > 1) page.say(`Saving the picture as ${link.save.map((k) => k.toUpperCase()).join(" and ")}: your browser may ask to allow this site to download several files.`);
    const made = await art.save(link.save);
    document.documentElement.dataset.artworkSaved = made.length ? made.join(",") : "none";
  };

  return { ART_KEYS, art, artReach, openRecipe };
}
