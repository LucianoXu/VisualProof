// The project live: a new graph swapped in where the reader is, the build status in the pill and
// its popover (web/src/buildpop.ts), the page following its server into another version (UpdateSpec
// decision 8, web/src/reload.ts), and the server's event stream that tells of them all.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { BuildDelta, BuildRev, BuildStatus } from "../../shared/build.ts";
import type { ChatEvent, Invited, PrivateCount, StreamHello } from "../../shared/collab.ts";
import type { ViewMeta } from "../../shared/graph.ts";
import type { ReviewRev } from "../../shared/review.ts";
import { LiveBuild } from "./buildread.ts";
import { Graph } from "../../shared/viewgraph.ts";
import type { AskAnswered, AskFollow } from "../../shared/askfollow.ts";
import { popHtml, stepPill } from "./buildpop.ts";
import type { BuildLine } from "../../shared/lostfound.ts";
import { keepFocus } from "./keepfocus.ts";
import { Popover } from "./popover.ts";
import { PAGE_VERSION, Reloader } from "./reload.ts";
import { setPeople } from "./verified.ts";
import { $, STATE_LABEL } from "./page.ts";
import type { GraphInfo, Page } from "./page.ts";

/** What following the server gives the page's other parts. */
export interface LivePart {
  pill: HTMLElement;
  pop: HTMLElement;
  renderBuild: () => void;
  renderPop: () => void;
  buildPop: Popover;
  listen: () => void;
}

export function livePart(page: Page): LivePart {
  const { data, reader } = page;

  let updating = false;
  let extractError: string | null = null;
  let offline = false;
  /** the version the server restarts into (`update`), until the page is back with it */
  let updatingTo: string | null = null;
  /** the version the page waits to reload into, while a reload would cut something short */
  let reloadOffered: string | null = null;

  /** A new graph from the server, swapped in where the reader is: same view, same camera, same
   *  selection (by name and key, which a new numbering leaves as they are); every board is
   *  computed again. A board of a past build stays one, measured against the new graph. */
  const install = async (next: ViewMeta, edges: ArrayBuffer) => {
    page.meta = next;
    page.present = new Graph(page.meta, new Int32Array(edges));
    page.compiled = new Map(page.meta.modules.map((m) => [m.name, m.compiled]));
    page.edits.clear();
    page.served.clear();
    page.servedContexts.clear();
    data.forget();
    // the pinned windows show their declarations in the new graph, found by name, as the files are
    // now (the following window follows the selection, found by name too); on a past board they
    // stay on its build, whose graph is made again against the new one as the board is drawn
    if (!page.pastShown()) {
      for (const w of page.sources.all) w.g = page.present;
      page.sources.redraw((name) => page.present.byName.get(name));
    }
    page.views.graphChanged();
    page.tm.presentChanged();
    page.targetTcbs.clear();
    // a declaration selected that this build renamed: the selection is on its name now
    const followed = page.followSelection();
    // the board on show again, of the new graph (showBoard takes it as `g`)
    await page.nav.redraw();
    page.trust.render();
    page.activity.changed();
    if (followed) page.selectionFollowed();
  };

  // ---------------------------------------------------------------- build status

  const pill = $("#build");
  const pop = $("#build-pop");
  const bar = $<HTMLElement>("#progress > div");
  const shortName = (m: string) => m.split(".").slice(-2).join(".");

  const renderBuild = () => {
    if (data.snapshot) return;
    pill.hidden = false;
    let cls = "ok";
    let text = "Built";
    const c = page.build?.counts;
    if (offline && updatingTo) {
      cls = "building";
      text = `Updating to ${updatingTo}…`;
    } else if (offline) {
      cls = "off";
      text = "Offline";
    } else if (reloadOffered) {
      text = "Updated — reload";
    } else if (page.build?.active) {
      cls = "building";
      const p = page.build.progress;
      // a branch's build: its step, where Lake says nothing of its progress (DeploySpec)
      text = p ? `Building ${p.done} / ${p.total}` : page.deploy?.building ? stepPill(page.deploy.building) : "Building";
      if (p?.current.length) text += ` · ${shortName(p.current[0])}${p.current.length > 1 ? ` +${p.current.length - 1}` : ""}`;
    } else if (c && c.failed + c.unbuilt > 0) {
      cls = "bad";
      text = `${c.failed + c.unbuilt} failed` + (c.blocked ? ` · ${c.blocked} blocked` : "");
    } else if (page.deploy?.last && !page.deploy.last.ok) {
      // a branch's build that failed with no file to show it (its lakefile, a fetch)
      cls = "bad";
      text = `${page.deploy.last.retry ? "Not built" : "Build failed"} · ${page.deploy.last.commit.slice(0, 7)}`;
    } else if (c && c.stale > 0) {
      cls = "stale";
      text = `${c.stale} out of date`;
    } else if (c && c.sorry > 0) {
      cls = "warn";
      text = `Built · ${c.sorry} with sorry`;
    }
    if (updating) text += " · reading…";
    else if (page.graphInfo?.missing.length) text += " · partial graph";
    // the usage pass runs: the notation each declaration is written in, and its exact context, come
    // with the next graph (server/usage.ts)
    else if (page.graphInfo?.usage?.state === "pending") text += " · reading notation…";
    pill.className = `build-pill ${cls}`;
    pill.querySelector(".b-text")!.textContent = text;
    const prog = page.build?.active && page.build.progress ? page.build.progress.done / Math.max(1, page.build.progress.total) : 0;
    bar.style.width = `${Math.round(prog * 100)}%`;
    bar.parentElement!.classList.toggle("on", !!page.build?.active);
    if (!pop.hidden) renderPop();
  };

  /** the builds the history keeps, as last read (undefined: being read; null: none kept here) */
  let builds: { snapshots: BuildLine[]; current: number | null } | null | undefined;
  /** the builds read again, once the popover shows them */
  let buildsStale = true;
  const readBuilds = () => {
    buildsStale = false;
    void (data.lost?.builds() ?? Promise.resolve(null)).then((b) => {
      builds = b;
      if (!pop.hidden) renderPop();
    });
  };
  const renderPop = () => {
    if (buildsStale) readBuilds();
    const html = popHtml({
      graph: page.graphInfo,
      extractError,
      files: page.build?.files ?? null,
      stateLabel: STATE_LABEL,
      builds: data.lost ? builds : null,
      lost: page.lostDrawer.counts,
      deploy: page.deploy,
    });
    // drawn again as the build goes on: the keyboard keeps its place in it
    keepFocus(pop, () => (pop.innerHTML = html));
    // a build's log is read from its end, where it says what failed
    for (const l of pop.querySelectorAll<HTMLElement>(".bp-log")) l.scrollTop = l.scrollHeight;
  };

  // the build-status popover (HistorySpec decision 15, web/src/buildpop.ts): it closes on a press
  // elsewhere, Esc, or the pill again
  const buildPop = new Popover(pill, pop, { changed: (open) => open && renderPop() });
  pop.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-module]");
    if (b) return page.goToModule(b.dataset.module!);
    const bp = t.closest<HTMLElement>("[data-bp]")?.dataset.bp;
    const snap = t.closest<HTMLElement>("[data-snapshot]")?.dataset.snapshot;
    if (!bp && snap === undefined) return;
    buildPop.toggle(false);
    if (bp === "lost") page.lostDrawer.toggle(true);
    else page.timeMachine(snap !== undefined ? { snapshot: Number(snap) } : undefined);
  });

  // the views as they are, sent on every (re)connection: the first is what the page loaded with
  let reconnected = false;
  /** Follow the server: what it sends goes to the view on show, so it starts once one is. */
  // the page follows its server into another version (UpdateSpec decision 8, web/src/reload.ts): it
  // reloads where it is, unless that would cut short what the reader is doing; the pill offers it
  // meanwhile, and a click on it reloads at once
  const reloader = new Reloader({
    busy: () => {
      const a = document.activeElement;
      if ((a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && (a.type === "text" || a.type === "search"))) && a.value.trim()) return "text being typed";
      if (a instanceof HTMLElement && a.isContentEditable) return "text being typed";
      if (page.stickies.editing) return "a note being written";
      if (page.canvas.pressed) return "a drag";
      if (page.exportModal.isOpen) return "the export window";
      if (page.artLook) return "the artwork mode";
      if (page.linear.shown) return "the linear form";
      return null;
    },
    kept: () => ({
      root: page.meta.project.root,
      at: Date.now(),
      sources: {
        following: page.sources.following ? { name: page.sources.following.name, collapsed: page.sources.following.collapsed } : null,
        pinned: page.sources.pinned.map((p) => ({ name: p.name, collapsed: p.collapsed })),
      },
      review: page.reviewBox.keptDrafts,
      talk: page.talk.keptDrafts,
      notes: reader ? [...page.ownOpen] : [],
    }),
    offer: (v) => {
      reloadOffered = v;
      renderBuild();
    },
    reload: () => location.reload(),
  });
  pill.addEventListener(
    "click",
    (e) => {
      if (!reloadOffered) return;
      e.stopImmediatePropagation();
      reloader.go();
    },
    true,
  );
  /** The build status the page now holds, shown: the pill, the Status colours, the outline, the
   *  panel's banners. */
  const takeBuild = (status: BuildStatus | null) => {
    page.build = status;
    page.fileIndex = page.files();
    page.canvas.setBuild(page.pastShown() ? null : page.build?.files ?? null);
    page.syncStatus();
    page.outline.render();
    renderBuild();
    // a file may have been edited: what was read of the sources, and what was known of them, goes
    data.forget();
    page.edits.clear();
    page.served.clear();
    page.servedContexts.clear();
    page.sources.redraw((name) => page.g.byName.get(name));
    page.showSelected();
  };
  // the first reading is the one made as the page loaded
  const liveBuild = new LiveBuild(() => {
    const first = page.firstBuild;
    page.firstBuild = null;
    return first ?? data.build();
  }, takeBuild);
  const listen = () => {
    if (data.snapshot) return;
    // the build status read as the page loaded, shown now that a board is
    if (page.firstBuild) void liveBuild.fetch();
    // the server names the stream, and tells this page alone the secret its heartbeats carry: the
    // others see the page go when it closes; it takes the build status as changes
    const es = new EventSource(`/api/events?session=${page.people.session}&build=delta`);
    es.addEventListener("hello", (e) => {
      const hello = JSON.parse((e as MessageEvent).data) as StreamHello;
      // the conversations are read again once the heartbeat named this page's stream: what of them
      // it is sent depends on the name (CollabSpec decision 13)
      void page.people.connected(hello).then(() => !reader && page.talk.connected());
      updatingTo = null;
      reloader.hello(hello.server);
      // the release this page's code is of, once it is the server's (GuideSpec decision 11): a page
      // about to reload into another tells nothing, so that What's new waits for the new code
      const release = hello.server?.version;
      if (release && (!PAGE_VERSION || release === PAGE_VERSION)) page.hearRelease(release);
      renderBuild();
    });
    // the server restarts into another version (UpdateSpec decision 8): the pill says so while it is
    // away, and the page reloads into it when it is back
    es.addEventListener("update", (e) => {
      updatingTo = (JSON.parse((e as MessageEvent).data) as { to?: string }).to ?? null;
      renderBuild();
    });
    es.addEventListener("presence", (e) => page.people.setPeers(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("private", (e) => page.people.setPrivateCount((JSON.parse((e as MessageEvent).data) as PrivateCount).count));
    // the people invited by a personal link, as they are called now (CollabSpec decision 9): what
    // each did shows under that name, in Activity and on the notes
    es.addEventListener("people", (e) => {
      setPeople(JSON.parse((e as MessageEvent).data) as Invited[]);
      page.activity.changed();
      page.stickies.render();
    });
    es.addEventListener("activity", (e) => page.activity.add(JSON.parse((e as MessageEvent).data)));
    // the lost-and-found changed: how many entries it lists (HistorySpec decision 12); a build was
    // kept: the popover's recent builds are read again
    es.addEventListener("lost", (e) => page.lostDrawer.news(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("history", () => {
      buildsStale = true;
      if (!pop.hidden) renderPop();
    });
    es.addEventListener("chat", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as ChatEvent;
      page.talk.add(d.channel, d.message);
    });
    // a request to follow someone, its answers to this page's own, and one ended on the server
    // (CollabSpec decision 10)
    es.addEventListener("ask", (e) => page.asking.asked(JSON.parse((e as MessageEvent).data) as AskFollow));
    es.addEventListener("ask-answer", (e) => page.asking.answered(JSON.parse((e as MessageEvent).data) as AskAnswered));
    es.addEventListener("ask-end", (e) => page.asking.ended((JSON.parse((e as MessageEvent).data) as { id: string }).id));
    es.addEventListener("views", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.all && !reconnected) {
        reconnected = true;
        d.all = false;
      }
      page.sync.listed(d);
      // the page was away: the project's notes are read again too
      if (d.all) void page.projectNotes.load().then(() => page.stickies.render());
    });
    // the project's notes, as another page, an agent or the server changed them
    es.addEventListener("note-ops", (e) => {
      if (page.projectNotes.take(JSON.parse((e as MessageEvent).data))) page.stickies.render();
    });
    es.addEventListener("view-ops", (e) => page.sync.ops(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("view-memory", (e) => page.sync.memory(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => {
      offline = false;
      renderBuild();
    };
    es.onerror = () => {
      offline = true;
      renderBuild();
      // refused rather than lost (a server with as many pages open as it serves): the browser does
      // not try again by itself, so the page does, a while later — unless the link this page came by
      // was revoked (CollabSpec decisions 9 and 11), which the server says (410): the page is
      // reloaded, and the server's page says the link no longer opens the site (decision 7)
      if (es.readyState === EventSource.CLOSED)
        void fetch("/api/identity")
          .then((r) => (r.status === 410 ? location.reload() : setTimeout(listen, 10_000)))
          .catch(() => setTimeout(listen, 10_000));
    };
    // the build status (web/src/buildread.ts): which revision the server holds, as the stream opens
    // and at a change sent as no delta; each change after as the files whose status changed; a
    // server from before 0.6.0 sends it whole
    es.addEventListener("build-rev", (e) => liveBuild.told(JSON.parse((e as MessageEvent).data) as BuildRev));
    es.addEventListener("build-delta", (e) => liveBuild.delta(JSON.parse((e as MessageEvent).data) as BuildDelta));
    es.addEventListener("build", (e) => liveBuild.whole(JSON.parse((e as MessageEvent).data) as BuildStatus));
    // a build read: the Time Machine's timeline has a tick more (HistorySpec, the snapshots)
    es.addEventListener("history", () => void page.tm.historyChanged());
    // which review the server holds (as the stream opens, and at a change that is no delta): read
    // again where this page holds another; what changes comes as deltas
    es.addEventListener("review-rev", (e) => page.wholeReview.told(JSON.parse((e as MessageEvent).data) as ReviewRev));
    // the branch's builds (DeploySpec): the pill and the popover say them
    es.addEventListener("deploy", (e) => {
      page.deploy = JSON.parse((e as MessageEvent).data);
      renderBuild();
    });
    es.addEventListener("review-delta", (e) => page.takeChange(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("extracting", () => {
      updating = true;
      renderBuild();
    });
    es.addEventListener("idle", () => {
      updating = false;
      renderBuild();
    });
    es.addEventListener("extract-error", (e) => {
      extractError = JSON.parse((e as MessageEvent).data).error;
      renderBuild();
    });
    es.addEventListener("graph", async (e) => {
      const info: GraphInfo = JSON.parse((e as MessageEvent).data);
      extractError = null;
      // the same version of the same server's: nothing new (a server restarted counts again)
      if (page.graphInfo && info.version === page.graphInfo.version && info.instance === page.graphInfo.instance) return;
      try {
        const [next, edges] = await Promise.all([data.meta(info.version, info.instance), data.edges(info.version, info.instance)]);
        page.graphInfo = info;
        await install(next, edges);
      } catch {
        // superseded while loading: the next graph event brings the newer one
      }
      renderBuild();
    });
  };

  return { pill, pop, renderBuild, renderPop, buildPop, listen };
}
