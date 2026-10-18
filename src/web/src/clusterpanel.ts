// The panel of a cluster, when the thing last clicked is one (web/src/selection.ts): what it is — a
// namespace, a folder or a file, of the project or outside it — what it holds, by kind, how far the
// review of its declarations has come, whether it is trusted (web/src/trust.ts), what its files'
// builds say, and the clusters and declarations in it to go to; Fold or Unfold, Zoom in, a view of
// the cluster alone, and Hide this level (ViewSpec decision 24). It takes the declaration panel's
// place (#panel) and its look.

import type { FileStatus } from "../../shared/build.ts";
import type { ClusterMode, Layout } from "../../shared/graph.ts";
import { markOf, prefixLabel, progressOf } from "../../shared/review.ts";
import { nonStandardAxiom } from "../../shared/reviewqueue.ts";
import type { ReviewData } from "../../shared/review.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import { banner } from "./panel.ts";
import { clusterMembers, clusterWhat } from "./selection.ts";
import { SHIELD } from "./trust.ts";

export interface ClusterPanelHooks {
  /** the board on show: its graph, its layout and clustering, and its declarations' numbers in
   *  the whole graph */
  board(): { graph: Graph; layout: Layout; mode: ClusterMode; toFull(j: number): number };
  /** the review, for the status of each declaration */
  reviewData(): ReviewData;
  isFolded(c: number): boolean;
  /** fold or open it, for everyone on the board */
  toggleFold(c: number): void;
  /** go to a cluster or a declaration (the whole graph's numbering): a click there with the tool */
  goCluster(c: number): void;
  go(i: number): void;
  /** ring a declaration (the whole graph's numbering) or light a cluster up without moving there;
   *  null takes it away */
  preview(i: number | null): void;
  previewCluster(c: number | null): void;
  /** Zoom in: a view of the cluster alone; whether that is not the board on show */
  zoom(c: number): void;
  /** hide its level, for everyone on the board: what it holds moves up into its parent */
  hide(c: number): void;
  canZoom(c: number): boolean;
  /** whether it is trusted without review (web/src/trust.ts, state), and asking to change it */
  trust(c: number): { prefix: string | null; on: boolean; by: string | null; can: boolean; note?: string };
  trustClicked(c: number, anchor: HTMLElement): void;
  /** the build status of a module, when the page is live, and what its state is called; the
   *  project's modules under a prefix */
  fileOf(module: string): FileStatus | undefined;
  stateLabel(state: string): string | undefined;
  modulesUnder(prefix: string): string[];
  goToModule(m: string): void;
  close(): void;
  /** the places in papers the cluster is linked to, and Link to a paper…, as HTML (AttachmentSpec
   *  decision 7; web/src/paperlinks.ts answers its clicks); "" for none */
  links?(key: string, mode: ClusterMode): string;
}

/** how many declarations the panel lists, so that a cluster of thousands stays a panel */
const ROWS = 300;
const ORDER = ["axiom", "opaque", "structure", "class", "inductive", "def", "abbrev", "instance", "notation", "theorem", "external"];

export class ClusterPanel {
  private el: HTMLElement;
  private hooks: ClusterPanelHooks;
  private current: number | null = null;

  constructor(el: HTMLElement, hooks: ClusterPanelHooks) {
    this.el = el;
    this.hooks = hooks;
    // the element is the declaration panel's too (web/src/panel.ts): only while it tells of a
    // cluster does anything here answer
    el.addEventListener("click", (e) => {
      const c = this.current;
      if (c === null) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-close]")) return this.hooks.close();
      if (t.closest("[data-cp-fold]")) return this.hooks.toggleFold(c);
      if (t.closest("[data-cp-zoom]")) return this.hooks.zoom(c);
      if (t.closest("[data-cp-hide]")) return this.hooks.hide(c);
      const trust = t.closest<HTMLElement>("[data-trust]");
      if (trust) return this.hooks.trustClicked(c, trust);
      const kid = t.closest<HTMLElement>("[data-cluster]");
      if (kid) return this.hooks.goCluster(Number(kid.dataset.cluster));
      const row = t.closest<HTMLElement>("[data-go]");
      if (row) return this.hooks.go(Number(row.dataset.go));
      const mod = t.closest<HTMLElement>("[data-module]");
      if (mod) this.hooks.goToModule(mod.dataset.module!);
    });
    // a row under the pointer lights up what it stands for, where it lies
    el.addEventListener("mouseover", (e) => {
      if (this.current === null) return;
      const t = e.target as HTMLElement;
      const kid = t.closest<HTMLElement>("[data-cluster]");
      if (kid) return this.hooks.previewCluster(Number(kid.dataset.cluster));
      const row = t.closest<HTMLElement>("[data-go]");
      if (row) this.hooks.preview(Number(row.dataset.go));
    });
    el.addEventListener("mouseout", (e) => {
      if (this.current === null) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-cluster]")) this.hooks.previewCluster(null);
      else if (t.closest("[data-go]")) this.hooks.preview(null);
    });
  }

  /** The cluster on show, in the board's layout; null when the panel tells of something else. */
  get shown(): number | null {
    return this.current;
  }

  hide(): void {
    if (this.current === null) return;
    this.current = null;
    this.el.classList.remove("open");
  }

  /** Drawn again where it is (a fold, the review, a build changed), its scroll kept. */
  refresh(): void {
    if (this.current !== null) this.show(this.current);
  }

  show(c: number): void {
    const same = c === this.current && this.el.classList.contains("open");
    const keepScroll = this.el.scrollTop;
    this.current = c;
    const { graph: G, layout: L, mode, toFull } = this.hooks.board();
    const cl = L.clusters[c];
    const esc = escapeHtml;
    const members = clusterMembers(L, c);
    const kids = L.clusters.flatMap((x, k) => (x.parent === c ? [k] : [])).sort((a, b) => (L.clusters[a].label < L.clusters[b].label ? -1 : 1));
    const here = members.filter((j) => L.cluster[j] === c);
    const modules = mode === "module" && !cl.ext ? this.hooks.modulesUnder(cl.key) : [];
    const folded = this.hooks.isFolded(c);

    // what it holds: in the project and outside it, by kind
    let own = 0;
    const kinds = new Map<string, number>();
    for (const j of members) {
      if (!G.isExt(j)) own++;
      const k = G.isExt(j) ? "external" : G.nodes[j].kind;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    const outside = members.length - own;
    const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
    const kindChips = [...kinds]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([k, n]) => `<span class="chip cp-kind"><span class="dot k-${k}"></span>${esc(k)} <b>${n.toLocaleString()}</b></span>`)
      .join("");

    // how far the review of its declarations has come, as a target's is told
    const d = this.hooks.reviewData();
    const p = progressOf(d, members.map((j) => ({ name: G.nodes[j].name, module: G.nodes[j].module, ext: G.isExt(j), hash: G.nodes[j].hash, axiom: nonStandardAxiom(G, j) })));
    const free = members.length - p.total;
    const open = p.total - p.approved - p.commented - p.stale;
    const pct = (x: number) => (p.total ? ((100 * x) / p.total).toFixed(1) : "0");
    const reviewed = p.total
      ? `<div class="rv-target"><div class="rv-prog"><b>${p.approved}</b> / ${p.total} approved` +
        (p.commented ? ` · <span class="commented">${p.commented} commented</span>` : "") +
        (p.stale ? ` · ${p.stale} stale` : "") +
        ` · ${open} not yet reviewed` +
        (free ? ` <span class="muted">(${free.toLocaleString()} trusted, not counted)</span>` : "") +
        `</div><div class="rv-bar"><i class="ok" style="width:${pct(p.approved)}%"></i><i class="commented" style="width:${pct(p.commented)}%"></i><i class="stale" style="width:${pct(p.stale)}%"></i></div></div>`
      : `<div class="rv-target"><div class="rv-prog muted">${members.length ? `All ${members.length.toLocaleString()} trusted without review: nothing to review.` : "Nothing here on this board."}</div></div>`;

    // trusted or not, and the shield to change it
    const t = this.hooks.trust(c);
    const shield = (cls: string) => `<span class="cp-shield${cls}">${SHIELD}</span>`;
    const trust = !t.prefix
      ? `${shield("")}<span class="muted">Outside the project, trust goes by module: cluster by file to trust a part of it.</span>`
      : t.on
        ? `${shield(" on")}<span>Trusted without review: not counted in any target's progress, in need of no opinion.</span>` +
          (t.can ? `<button class="rv-btn" data-trust>Stop trusting…</button>` : t.note ? `<span class="muted">${esc(t.note)}</span>` : "")
        : t.by
          ? `${shield(" on under")}<span>Trusted without review, under <code>${esc(prefixLabel(t.by))}</code>; that is undone from Trusted in the side panel.</span>`
          : `${shield("")}<span>Not trusted: its declarations count in the targets' progress and need review.</span>` +
            (t.can ? `<button class="rv-btn" data-trust>Trust…</button>` : t.note ? `<span class="muted">${esc(t.note)}</span>` : "");

    // what its files' builds say, when the board is by file and the page is live
    let build = "";
    const known = modules.flatMap((m) => {
      const f = this.hooks.fileOf(m);
      return f ? [f] : [];
    });
    if (known.length) {
      const bad = known.filter((f) => this.hooks.stateLabel(f.state));
      build =
        `<div class="sec">Build <span class="muted">${modules.length} file${modules.length === 1 ? "" : "s"}</span></div>` +
        (bad.length
          ? bad
              .map((f) => `<button class="row cp-mod" data-module="${esc(f.module)}" title="Show ${esc(f.module)}"><span class="o-st st-${f.state}"></span>${esc(f.module)} <span class="muted">${esc(this.hooks.stateLabel(f.state)!)}</span></button>`)
              .join("")
          : `<div class="muted cp-note">All built and up to date.</div>`);
    }

    // the clusters inside, and the declarations right here, by kind
    const kidRows = kids
      .map((k) => {
        const x = L.clusters[k];
        return `<button class="row cp-kid${this.hooks.isFolded(k) ? " folded" : ""}" data-cluster="${k}" title="${esc(x.key)}"><span class="dot cluster-dot"></span><span class="cp-l">${esc(x.label)}</span><span class="cp-n">${x.count.toLocaleString()}</span></button>`;
      })
      .join("");
    const groups = new Map<string, number[]>();
    for (const j of here.slice(0, ROWS)) {
      const k = G.isExt(j) ? "external" : G.nodes[j].kind;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(j);
    }
    const declRows = [...groups]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([k, js]) => {
        js.sort((a, b) => (G.nodes[a].name < G.nodes[b].name ? -1 : 1));
        return (
          `<div class="grp"><div class="grp-h"><span class="dot k-${k}"></span>${esc(k)} <span class="muted">${js.length}</span></div>` +
          js
            .map((j) => {
              const v = G.nodes[j];
              return `<button class="row rv-${markOf(d, v.name, v.module, G.isExt(j), v.hash, nonStandardAxiom(G, j))}" data-go="${toFull(j)}" title="Go to ${esc(v.name)}">${esc(G.short(j))}</button>`;
            })
            .join("") +
          `</div>`
        );
      })
      .join("");
    const below = members.length - here.length;

    const ext = cl.ext;
    const key = cl.key.replace("⟨external⟩", "External");
    this.el.innerHTML = `
      ${modules.includes(cl.key) ? banner(this.hooks.fileOf(cl.key)) : ""}
      <div class="p-head">
        <div class="p-kind"><span class="dot cluster-dot"></span>${esc(clusterWhat(cl, mode, (m) => modules.includes(m), kids.length > 0))}${folded ? `<span class="chip">folded</span>` : ""}</div>
        <button class="icon" data-close title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <h1 class="p-name">${esc(cl.label === "External" ? "Outside the project" : cl.label)}</h1>
      <div class="p-ns">${esc(key)}</div>
      <div class="p-mod">
        <button class="link" data-cp-fold title="${folded ? "Open it" : "Fold it into one body"}, for everyone on this board (or double-click it)">${folded ? "Unfold" : "Fold"}</button>
        ${this.hooks.canZoom(c) ? `<button class="link" data-cp-zoom title="Open a view of this cluster alone, laid out on its own, in a tab">Zoom in</button>` : ""}
        <button class="link" data-cp-hide title="Take this level out of the board, for everyone on it: its clusters and declarations move up into its parent, and the exported document's sections follow (⚙ Board shows it again)">Hide this level</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="n grad-name">${members.length.toLocaleString()}</div><div class="l">declarations<br><span class="muted">${own && outside ? `${own.toLocaleString()} own + ${outside.toLocaleString()} outside` : ext ? "outside the project" : "in the project"}</span></div></div>
        <div class="stat"><div class="n grad-name">${here.length.toLocaleString()}</div><div class="l">right here<br><span class="muted">not in a cluster inside</span></div></div>
        <div class="stat"><div class="n grad-name">${kids.length.toLocaleString()}</div><div class="l">clusters<br><span class="muted">inside</span></div></div>
      </div>
      <div class="cp-kinds">${kindChips}</div>
      ${this.hooks.links?.(cl.key, mode) ?? ""}
      <div class="sec">Review <span class="muted">— of its declarations</span></div>
      ${reviewed}
      <div class="sec">Trust</div>
      <div class="cp-trust">${trust}</div>
      ${build}
      ${kids.length ? `<div class="sec">Clusters inside <span class="muted">${kids.length}</span></div><div class="cp-list">${kidRows}</div>` : ""}
      ${
        here.length
          ? `<div class="sec">Declarations here <span class="muted">${here.length.toLocaleString()}${below ? ` · ${below.toLocaleString()} more in the clusters inside` : ""}</span></div>` +
            `<div class="tcb-list">${declRows}</div>` +
            (here.length > ROWS ? `<div class="muted cp-note">… and ${(here.length - ROWS).toLocaleString()} more: Zoom in to see them all.</div>` : "")
          : ""
      }
    `;
    this.el.classList.add("open");
    this.el.scrollTop = same ? keepScroll : 0;
  }
}
