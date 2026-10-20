// The review on the page (ReviewSpec.md): as the board on show reads it, the source text an opinion
// records, what is recorded and refused, the review's focus (ViewSpec decision 28) and its key
// declarations, the review box and the strip; and the review as the server tells it, the whole
// once and then each change, everything that shows it following.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { lightUp, zoomScope } from "../../shared/board.ts";
import type { Lit } from "../../shared/board.ts";
import { printQuery, readsReview } from "../../shared/query.ts";
import { keyMarked, keyMarks } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { applyEvent, logFileName, problemsText, readEvent, validPersonId } from "../../shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent, ReviewRequest, ReviewWhole } from "../../shared/review.ts";
import { viewFocus } from "../../shared/views.ts";
import { WholeReview } from "./reviewread.ts";
import type { ReviewState } from "./data.ts";
import { exactContext, judgedText } from "../../shared/context.ts";
import type { ModuleContexts } from "../../shared/context.ts";
import type { DeclarationText } from "../../shared/excerpt.ts";
import { READ_ONLY } from "./people.ts";
import { readerFocus } from "./focus.ts";
import { ReviewBox } from "./reviewbox.ts";
import { ReviewFlow } from "./reviewqueue.ts";
import { clusterPick, declPick, selectionQuery } from "./selection.ts";
import type { KeysOf, Pick, Root } from "./selection.ts";
import { reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";
import { $, PAST_REVIEW, READ_ONLY_REVIEW } from "./page.ts";
import type { Page } from "./page.ts";

/** What the review gives the page's other parts. */
export interface ReviewPart {
  boardReview: () => ReviewData;
  edits: Map<string, boolean>;
  served: Map<string, string[] | null>;
  servedContexts: Map<string, { contexts: ModuleContexts | null; hash: string | null }>;
  editedNow: (i: number) => boolean | null;
  edited: (i: number) => Promise<boolean>;
  submit: (op: ReviewRequest) => Promise<string | null>;
  flow: ReviewFlow;
  flowNow: ReviewFlow;
  blocked: () => string | null;
  isTarget: (name: string) => boolean;
  heldTargets: () => string[];
  linkedTargets: () => string[];
  viewFocusName: () => string | null;
  reviewName: () => string | null;
  reviewRoot: () => number | null;
  keysFor: (r: Root, target?: string | null) => KeysOf;
  pickDecl: (name: string, target?: string | null) => Pick;
  pickCluster: (c: number) => Pick;
  walk: (i: number) => void;
  reviewBox: ReviewBox;
  declNow: (i: number) => string;
  clickedDecls: () => number[];
  keyMarking: () => { target: string; fresh: number; already: number; names: string[] } | null;
  toggleKey: (i?: number | null) => void;
  litOn: (q: Query) => Lit;
  zoomOf: (q: Query | null, lit?: Lit | null) => Query | null;
  renderStrip: () => void;
  syncFocus: () => void;
  reviewChanged: () => void;
  wholeReview: WholeReview<ReviewWhole>;
  takeChange: (c: ReviewChange) => void;
}

export function reviewPart(page: Page): ReviewPart {
  const { data, store, S, kept, reader } = page;

  /** The review as the board on show reads it, by its declarations' names: on a past graph, what was
   *  said of a declaration renamed since — kept under its name now — is read under its name then too
   *  (web/src/past.ts, reviewThen), made once per revision of the review and past graph. */
  let readThen: { data: ReviewData; rev: number; past: PastGraph; out: ReviewData } | null = null;
  const boardReview = (): ReviewData => {
    const past = page.nav.board?.past?.past;
    if (!past || !past.nowName.size) return page.review.data;
    if (readThen?.data !== page.review.data || readThen.rev !== page.review.rev || readThen.past !== past) readThen = { data: page.review.data, rev: page.review.rev, past, out: reviewThen(page.review.data, past.nowName) };
    return readThen.out;
  };
  // which modules' present text is not the text the graph was read from (its declarations' places,
  // statements and hashes are about the compiled one): found out from the served source's hash
  page.compiled = new Map(page.meta.modules.map((m) => [m.name, m.compiled]));
  const edits = new Map<string, boolean>();
  // the lines of each file read with it (null where it could not be read): what an opinion
  // records, and what a stale one is compared with; and the usage pass's contexts of that text,
  // where it has them (shared/context.ts)
  const served = new Map<string, string[] | null>();
  const servedContexts = new Map<string, { contexts: ModuleContexts | null; hash: string | null }>();
  const editedNow = (i: number): boolean | null => (page.g.isExt(i) ? false : edits.get(page.g.nodes[i].module) ?? null);
  const edited = async (i: number): Promise<boolean> => {
    if (page.g.isExt(i)) return false;
    const mod = page.g.nodes[i].module;
    const known = edits.get(mod);
    if (known !== undefined) return known;
    const c = page.compiled.get(mod);
    const src = await data.source(mod);
    const e = !!c && !!src?.hash && src.hash !== c;
    edits.set(mod, e);
    served.set(mod, src ? src.text.split("\n") : null);
    servedContexts.set(mod, { contexts: src?.contexts ?? null, hash: src?.hash ?? null });
    return e;
  };
  /** A declaration's text as the source window shows it, with the context it is written in above
   *  it: what an opinion records (shared/context.ts), and what a stale one is compared with;
   *  undefined until its file has been read. */
  const textNow = (i: number): DeclarationText | null | undefined => {
    const v = page.g.nodes[i];
    if (page.g.isExt(i) || !v.range) return null;
    const lines = served.get(v.module);
    const e = edits.get(v.module);
    if (lines === undefined || e === undefined) return undefined;
    const c = servedContexts.get(v.module);
    return lines && judgedText(lines, e, v.name, v.range, exactContext(c?.contexts, v.name, c?.hash));
  };

  /** Record something in the review; resolves to why it was refused, or null. The answer carries
   *  the change, applied at once (the reader sees their board follow); the event that tells every
   *  page the same change is then known and skipped. An opinion that changed nothing was an approval
   *  of the version approved already (ReviewSpec decision 1, the owner's decision of 2026-10-20),
   *  another page's meanwhile: said, so that a comment sent with it stays in the box. */
  const submit = (op: ReviewRequest): Promise<string | null> =>
    // a past build is not reviewed: the review is given on the graph of now
    page.pastShown() ? Promise.resolve(PAST_REVIEW) : data.postReview(op).then(
      (c) => {
        if (c) takeChange(c);
        else if (op.op === "opinion") return `${op.for ? `${op.for}'s` : "Your"} approval of this version stands already: nothing was recorded.`;
        tipsOnReview(op);
        return null;
      },
      (e: Error & { who?: boolean }) => {
        // the server no longer knows this page's name: it is asked for again on the next try
        if (e.who) page.people.lost();
        return e.message;
      },
    );

  // the review flow where the review has a focus (ViewSpec decision 28): the focus's review set in
  // review order, the next one to review, why a declaration is in it (web/src/reviewqueue.ts)
  const flow = new ReviewFlow({ graph: () => page.g, review: () => boardReview(), reader: () => page.people.name });
  /** The same on the graph on show, whatever build the board shows: how far each target's review has
   *  come is the review's now (the targets list, the views menu) */
  const flowNow = new ReviewFlow({ graph: () => page.present, review: () => page.review.data, reader: () => page.people.name });
  /** Why this reader's opinions are refused until their log is fixed by hand (a line of it cannot
   *  be read, server/review.ts), or null. */
  const blocked = (): string | null => {
    const me = page.people.name?.trim();
    if (!me) return null;
    // someone invited by a personal link writes to their link's log (CollabSpec decision 9)
    const mine = logFileName(me, false, page.people.person?.id ?? null);
    const p = page.review.problems.find((x) => x.file === mine);
    return p ? `Your review log (log/${mine}) has a line that cannot be read — line ${p.line}: ${p.why}. Nothing more is written to it until it is fixed by hand.` : null;
  };
  const isTarget = (name: string): boolean => Object.hasOwn(boardReview().targets, name);
  /** The targets the board on show holds, by name. */
  const heldTargets = (): string[] =>
    Object.keys(boardReview().targets)
      .filter((n) => {
        const i = page.g.byName.get(n);
        return i !== undefined && page.toView(i) >= 0;
      })
      .sort();
  /** The targets linked to the view on show (ViewSpec decision 29), in the order they were linked. */
  const linkedTargets = (): string[] => (page.nav.board?.rec.targets ?? []).filter(isTarget);
  /** The view's own focus, everyone's (shared/views.ts, viewFocus). */
  const viewFocusName = (): string | null => (page.nav.board ? viewFocus(page.nav.board.rec, isTarget, heldTargets) : null);
  /** The target the review is on for this reader (ViewSpec decision 28): their own focus where they
   *  chose one, else the view's; null where there is none, and the review strip and its keys stand
   *  aside. */
  const reviewName = (): string | null => (page.nav.board ? readerFocus(page.mine, viewFocusName(), isTarget, [...linkedTargets(), ...heldTargets()]) : null);
  /** The same in the whole graph's numbering. */
  const reviewRoot = () => {
    const t = reviewName();
    return t === null ? null : page.g.byName.get(t) ?? null;
  };
  /** Whose key declarations a Keys pick of `r` holds (ViewSpec decision 20) where the review's focus
   *  is `target` (by default the board on show's): that target's; elsewhere a target's own when the
   *  target itself is clicked — a click on a target selects it and its key declarations — and every
   *  target's for anything else. */
  const keysFor = (r: Root, target: string | null = reviewName()): KeysOf =>
    target ?? ("decl" in r && Object.hasOwn(boardReview().targets, r.decl) ? r.decl : null);
  /** A declaration clicked with the tool, on the board on show or (`target`) on another. */
  const pickDecl = (name: string, target?: string | null): Pick => declPick(S.mode, name, keysFor({ decl: name }, target));
  /** A cluster of the board clicked with the tool. */
  const pickCluster = (c: number): Pick => {
    const cl = page.canvas.layout.clusters[c];
    return clusterPick(S.mode, cl, page.cm(), keysFor({ cluster: cl.key, by: page.cm() }));
  };
  /** The Selection tool, nothing selected again (walking a TCB chooses it). */
  const toSelection = () => {
    if (S.mode === "plain") return;
    S.mode = "plain";
    store.save();
    page.syncTool();
  };
  /** Walking a target's TCB (a row of its review list, the strip's target): the declaration alone,
   *  under the Selection tool whatever the tool was (ViewSpec decision 15); Rests on or Used by then
   *  show it and the rest of the board. */
  const walk = (i: number) => {
    toSelection();
    page.go(i);
  };

  const reviewBox = new ReviewBox(page.g, {
    review: () => ({
      data: boardReview(),
      error: page.review.error,
      blocked: blocked(),
      readOnly: !!data.snapshot || page.pastShown() || !!reader,
      ...(page.pastShown() ? { note: `Today's review, against this build. ${PAST_REVIEW}` } : reader ? { note: READ_ONLY_REVIEW } : {}),
      reviewer: page.people.name,
      // someone invited by a personal link is their link (CollabSpec decision 9): their opinions
      // are told by it, as Withdraw finds them
      person: page.people.person?.id ?? null,
    }),
    ensureReviewer: () => page.people.ensure(),
    submit,
    said: (text) => page.say(text),
    // the opinions folded or shown, the reader's own, kept in this browser: every review box at once,
    // the panel's and each source window's
    opinionsShown: () => !store.data.opinionsFolded,
    showOpinions: (shown) => {
      store.data.opinionsFolded = shown ? undefined : true;
      store.save();
      page.showSelected();
    },
    queue: (i) => flow.queue(i),
    progress: (i) => flow.progress(i),
    reviewLens: (i) => page.reviewTarget(i),
    // the view the target is linked to (ViewSpec decision 29), or none, and linking it to the view
    // on show
    targetView: (i) => {
      const name = declNow(i);
      if (!isTarget(name)) return null;
      const id = page.views.linkedTo(name);
      return { title: id === undefined ? null : page.views.title(id), here: id === page.nav.board.id, why: page.linkWhy(name) };
    },
    linkHere: (i) => void page.linkTo(declNow(i)).then((why) => why && page.say(why)),
    editedNow,
    edited,
    textNow,
    text: async (i) => {
      await edited(i);
      return textNow(i) ?? null;
    },
    reviewRoot: () => reviewRoot(),
    keyable: (r, i) => flow.keyable(r, i),
    isKey: (r, i) => flow.isKey(r, i),
    keyProgress: (i) => flow.keyProgress(i),
    // a view made from the board on show: at its build, leaving the Time Machine for it; focused on
    // the target it is made from (ViewSpec decision 28). A read-only reader makes no views, and is
    // not offered one (CollabSpec decision 11)
    ...(reader
      ? {}
      : {
          keyView: (i: number) => {
            void page.openDerived(printQuery({ op: "key", of: [declNow(i)] }), null, undefined, declNow(i)).then((ok) => {
              if (ok === true) page.commit();
              else if (typeof ok === "string") page.say(ok);
            });
          },
        }),
    go: (i) => page.go(i),
    openSource: (name, from, to, quoted, root) => page.openSourceAt(name, from, to, quoted, root),
  });
  if (kept) reviewBox.restoreDrafts(kept.review);
  /** What declaration `i` of the board's graph is called now: on a past graph, the name a rename
   *  since gave it, which the review, the views' records and their scopes speak (HistorySpec decision
   *  8); else its name. */
  const declNow = (i: number): string => page.nav.board?.past?.past.nowName.get(page.g.nodes[i].name) ?? page.g.nodes[i].name;
  /** The declarations clicked (the selection's picks' roots), in the whole graph's numbering. */
  const clickedDecls = (): number[] =>
    page.picks.flatMap((p) => {
      const j = p.root && "decl" in p.root ? page.g.byName.get(p.root.decl) : undefined;
      return j === undefined ? [] : [j];
    });
  /** What "Mark selected as key" would mark where the review has a focus (web/src/selbar.ts): the
   *  declarations clicked that the focus's TCB holds, trusted or not (ExportSpec decision 1), not key
   *  yet; null where there is no focus. */
  const keyMarking = () => {
    const r = reviewRoot();
    // a past build is not reviewed: the review box says so
    if (r === null || data.snapshot || page.pastShown() || reader) return null;
    const xs = clickedDecls().filter((j) => flow.keyable(r, j));
    const already = xs.filter((j) => flow.isKey(r, j)).length;
    return { target: page.g.short(r), fresh: xs.length - already, already, names: xs.filter((j) => !flow.isKey(r, j)).map((j) => page.g.nodes[j].name) };
  };
  /** Mark or unmark a declaration as key for the focus (k): the one in the panel, or in the source
   *  window the key was pressed in. */
  const toggleKey = (i = page.selected()) => {
    const r = reviewRoot();
    if (r === null || i === null || i === r || data.snapshot) return;
    if (reader) return page.say(READ_ONLY);
    if (page.pastShown()) return page.say(PAST_REVIEW);
    if (!flow.keyable(r, i)) return page.say(`${page.g.short(i)} is not in ${page.g.short(r)}'s TCB: only what it holds can be key for it.`);
    const target = page.g.nodes[r].name;
    void page.people.ensure().then((me) => {
      if (!me) return;
      void submit({ op: "key", target, name: page.g.nodes[i].name, on: !keyMarked(page.review.data, target, page.g.nodes[i].name) }).then((why) => why && page.say(why));
    });
  };

  /** What a query lights up on the board on show: computed on the whole graph the board was taken
   *  from, then cut to what the board holds (shared/board.ts, lightUp). */
  const litOn = (q: Query): Lit => lightUp(page.nav.board.full, boardReview(), page.nav.board.bs, q);
  /** Zoom in (ViewSpec decision 13): the scope of a view of what `q` lights up on this board, which
   *  holds exactly that; null when it would hold nothing, or just what this board holds. */
  const zoomOf = (q: Query | null, lit: Lit | null = q && litOn(q)): Query | null =>
    q && lit && zoomScope(q, page.nav.board.rec.scope, lit, page.nav.board.bs);
  /** The tips in place what is recorded may be the moment of: a target's second declaration
   *  approved on a view focused on it, while it has no key declaration; a key marked ends that. */
  let approvedInFocus = 0;
  const tipsOnReview = (op: ReviewRequest) => {
    if (op.op === "key" && op.on) return page.didTip("key-in-target");
    if (op.op !== "opinion" || op.verdict !== "approve") return;
    const r = reviewRoot();
    const i = page.g.byName.get(op.name);
    if (r === null || i === undefined || !flow.inReview(r, i) || keyMarks(page.review.data, page.g.nodes[r].name).length) return;
    if (++approvedInFocus >= 2) page.offerTip("key-in-target");
  };

  /** The review strip, wherever the review has a focus (ReviewSpec, "Reviewing a target"; ViewSpec
   *  decision 28): it stays while the reader goes from one declaration to the next. */
  const renderStrip = () => {
    const r = reviewRoot();
    const bar = $("#lensbar");
    bar.hidden = r === null;
    if (r !== null) flow.renderStrip(r);
  };
  /** The focus may have changed (the reader's choice, the view's, the targets, the board's set): what
   *  depends on it follows, and the header says it. */
  const syncFocus = () => {
    const f = reviewName();
    if (f !== page.focusWas) {
      page.focusWas = f;
      page.syncStatus();
      page.applyScheme();
    }
    page.focusMenu.render();
  };
  // the review strip: its target's name goes back to the target
  $("#lens-title").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
    if (b) walk(Number(b.dataset.go));
  });

  /** The review changed, once per change whoever made it (this reader, someone else, the logs on disk):
   *  everything that shows it follows. A board whose scope reads the review (trusted, statuses,
   *  advice) may hold another set now: the board on show is drawn again at once. */
  const reviewChanged = () => {
    const followed = page.followSelection();
    page.targetTcbs.clear();
    page.views.reviewChanged();
    if (page.views.board(page.nav.board.id) !== page.nav.board) void page.nav.redraw().then(() => page.boardPanel.render());
    page.syncStatus();
    page.trust.reviewChanged();
    page.renderTrusted();
    // what is lit reads the review when a pick does (key declarations, trust, statuses), and the
    // key graph's edges under Keys always: lit again; else what shows the review is drawn again
    const q = selectionQuery(page.picks);
    if (followed || S.mode === "keys" || (q && readsReview(q))) page.apply();
    else {
      page.outline.render();
      // a visitor's colour by status, and its diamond, are the review's too
      page.drawVisitors();
      renderStrip();
      page.showSelected();
      page.renderSelBar();
    }
    page.activity.changed();
    page.boardPanel.render();
    page.renderTabs();
    page.papers.refresh();
    // what notes carry is drawn from the library's records, which are the review's
    page.stickies.render();
    if (followed) page.selectionFollowed();
  };
  /** The whole review (where this page holds another revision than the server's, or events came in
   *  between): taken unless this page holds that revision already. */
  const takeWhole = (st: ReviewState) => {
    if (st.epoch === page.review.epoch && st.rev <= page.review.rev) return;
    page.review = st;
    reviewChanged();
  };
  /** The whole review read again (GET /api/review, which a page holding it is answered 304): where
   *  the event stream says the server holds another revision, and where a change cannot be applied;
   *  one reading out at a time (web/src/reviewread.ts). */
  const wholeReview = new WholeReview(data.review, takeWhole, () => page.review);
  /** A change of the review (shared/review.ts, ReviewChange): its events applied to the review this
   *  page holds when it is the one they follow; once only, whether it came as the answer to this
   *  page's request or as the event every page gets. Anything else — a change missed, another run
   *  of the server — has the whole review read again. An event of a kind no longer recorded is
   *  skipped, as the server's replay skips it (the server sends none). */
  const takeChange = (c: ReviewChange) => {
    if (c.epoch === page.review.epoch && c.rev <= page.review.rev) return;
    // each event read as its log was: an agent's marked as one, an invited person's with their id
    const read = (e: unknown) => {
      const o = e as { agent?: unknown; person?: unknown };
      return readEvent(e, o.agent === true, validPersonId(o.person) ? o.person : null);
    };
    const events = c.epoch === page.review.epoch && c.base === page.review.rev && c.events ? c.events.map(read).filter((e) => e !== null) : null;
    if (!events || events.some((e) => typeof e === "string")) {
      void wholeReview.fetch();
      return;
    }
    // a replay that changed nothing (a new graph's reading, server/review.ts): the revision moves on
    const same = !events.length && JSON.stringify(c.problems) === JSON.stringify(page.review.problems);
    for (const e of events as ReviewEvent[]) applyEvent(page.review.data, e);
    page.review = { ...page.review, rev: c.rev, problems: c.problems, error: problemsText(c.problems) };
    if (!same) reviewChanged();
  };

  return {
    boardReview, edits, served, servedContexts, editedNow, edited, submit, flow, flowNow, blocked, isTarget, heldTargets, linkedTargets, viewFocusName,
    reviewName, reviewRoot, keysFor, pickDecl, pickCluster, walk, reviewBox, declNow, clickedDecls, keyMarking, toggleKey, litOn, zoomOf, renderStrip,
    syncFocus, reviewChanged, wholeReview, takeChange,
  };
}
