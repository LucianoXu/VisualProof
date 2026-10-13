// The timeline (CollabSpec decision 5): what happened on a server. The server stores builds, TCB
// changes, re-layouts, targets taken off and prefixes trusted or no longer trusted; opinions,
// targets and key marks are read from the review's logs by the page itself, so the logs bring their
// own history. Since M6 (AgentSpec.md) it also stores the layouts agents made — each request one
// batch, with what it replaced, so it can be undone — and their undoing. What an agent did carries
// `agent`: since an agent at level full may do what a person does (AgentSpec decision 9), that is
// also a target it took off and a prefix it trusted or no longer trusted. Since M7 (ViewSpec.md),
// the views saved for everyone, renamed, deleted and laid out afresh; since 2026-10-09, the notes
// on a view written, edited and deleted, by people and agents alike (ViewSpec decision 23), and a
// view's scope changed (ExportSpec decision 15: who left a trace on a view authors its document). A note
// event of the kind agents left about a declaration before is not read. What someone invited by a
// personal link did carries `person`, their link's id (CollabSpec decision 9), so that the page
// shows it under the name they go by now, with its mark.

import { SITE_BODY, SITE_STMT } from "./graph.ts";
import type { PlaceOp } from "./places.ts";
import { byName } from "./review.ts";

/** at most this many names are listed in one event; the counts stay exact */
export const NAMES_LISTED = 100;

export type StoredEvent =
  | {
      id: number;
      at: string;
      kind: "build";
      /** modules whose build failed now, and did not before */
      failed: string[];
      /** modules that failed before and build now */
      fixed: string[];
      /** modules with a `sorry` now, and without before */
      sorry: string[];
      /** modules whose `sorry` went */
      sorryGone: string[];
      /** how many files were built again */
      rebuilt: number;
    }
  | {
      id: number;
      at: string;
      kind: "tcb";
      /** the target whose TCB changed */
      target: string;
      added: string[];
      removed: string[];
      changed: string[];
      counts: { added: number; removed: number; changed: number };
      /** opinions that were about the version before, and are stale now */
      stale: number;
    }
  /** a re-layout of the whole canvas, as stored before views: no longer made (a board's re-layout
   *  is a `view` event, `what: relayout`), still shown by Activity where one is stored */
  | { id: number; at: string; kind: "relayout"; by: string }
  | { id: number; at: string; kind: "untarget"; by: string; agent?: true; person?: string; name: string }
  /** a prefix trusted without review, or no longer (ReviewSpec decision 3) */
  | { id: number; at: string; kind: "trust" | "untrust"; by: string; agent?: true; person?: string; prefix: string }
  /** a note written, edited or deleted: a view's (ViewSpec decision 23), or the project's
   *  (AttachmentSpec decision 13; since 2026-10-11), whose `view` and `title` are "": `note` its id,
   *  `text` as it is after (before, for a deletion), `title` what the view was called then. A build
   *  that carried a project note to the cluster its declarations moved to is an edit by VisualProof
   *  that says so (`carried`: the clustering, the cluster it was in and the one it is in now). */
  | { id: number; at: string; kind: "note"; by: string | null; agent?: true; person?: string; what: "created" | "edited" | "deleted"; view: string; title: string; note: string; text: string; carried?: { mode: "namespace" | "module"; from: string; to: string } }
  /** pins dropped or let go at once (AgentSpec decision 4): `ops` what was done, `undo` what puts
   *  back what was there before, `count` how many declarations and clusters it moved */
  | { id: number; at: string; kind: "layout"; by: string; agent?: true; count: number; ops: PlaceOp[]; undo: PlaceOp[] }
  /** a layout batch undone: `restored` pins put back; `kept`, what was left because someone moved
   *  it since; `by` null for a private reader (CollabSpec decision 8) */
  | { id: number; at: string; kind: "undo"; by: string | null; agent?: true; person?: string; of: number; restored: number; kept: string[] }
  /** a view (ViewSpec.md) saved for everyone (made, or kept once someone arranged or named it),
   *  renamed, rescoped (`scope`, since 2026-10-09: what makes someone one of its exported document's
   *  authors, ExportSpec decision 15; a target's view's too, ViewSpec decision 28),
   *  deleted, laid out afresh (its pins dropped), or kept at a past build (`version`, HistorySpec
   *  decision 19: `snapshot` its id, null for the latest again, `built` when it was built), or made a
   *  target's view (`linked`, ViewSpec decision 29: `target` the target; on a deletion, `targets` the
   *  targets the view was linked to, which have no view after, the owner's decisions of 2026-10-11 —
   *  a deletion recorded before a view could be several targets' says its one as `target`), or a note of the project
   *  added to it or taken out of it (`items`, the owner's decision of 2026-10-11, shared/items.ts:
   *  `note` its id, `text` its text then, `shown` whether the view shows it by it — added, or put
   *  back — or not — taken out): `name` as it is after, `was` before a rename or a deletion, `scope`
   *  its query's text (after a rescoping); `by` null for someone without a name (a private reader,
   *  CollabSpec decision 8) */
  | { id: number; at: string; kind: "view"; by: string | null; agent?: true; person?: string; what: "created" | "renamed" | "scope" | "deleted" | "relayout" | "version" | "linked" | "items"; view: string; name: string | null; was?: string | null; target?: string; targets?: string[]; scope: string; snapshot?: number | null; built?: string; note?: string; text?: string; shown?: boolean };

/** An event without the id and time the server gives it. */
export type NewEvent = StoredEvent extends infer E ? (E extends StoredEvent ? Omit<E, "id" | "at"> : never) : never;

/** The graph as the TCB needs it: names, content hashes, statement and body edges. */
export class TcbIndex {
  readonly names: string[];
  readonly hashes: string[];
  readonly byName = new Map<string, number>();
  private start: Int32Array;
  private dst: Int32Array;

  /** `edges`: (source, target, site) triples, as the server serves them. */
  constructor(nodes: { name: string; hash?: string }[], edges: Int32Array) {
    const n = nodes.length;
    this.names = nodes.map((v) => v.name);
    this.hashes = nodes.map((v) => v.hash ?? "");
    this.names.forEach((name, i) => this.byName.set(name, i));
    const keep = SITE_STMT | SITE_BODY;
    this.start = new Int32Array(n + 1);
    for (let e = 0; e + 2 < edges.length; e += 3) if (edges[e + 2] & keep) this.start[edges[e] + 1]++;
    for (let i = 0; i < n; i++) this.start[i + 1] += this.start[i];
    this.dst = new Int32Array(this.start[n]);
    const at = this.start.slice(0, n);
    for (let e = 0; e + 2 < edges.length; e += 3) if (edges[e + 2] & keep) this.dst[at[edges[e]]++] = edges[e + 1];
  }

  /** A declaration's TCB, itself included: name → content hash ("" where there is none), as the
   *  timeline compares a target's from one graph to the next (server/events.ts). */
  tcb(root: number): Record<string, string> {
    const seen = new Uint8Array(this.names.length);
    const stack = [root];
    seen[root] = 1;
    // keyed by names: no prototype, so that `toString` is a name like any (shared/review.ts)
    const out = byName<string>();
    while (stack.length) {
      const u = stack.pop()!;
      out[this.names[u]] = this.hashes[u];
      for (let e = this.start[u]; e < this.start[u + 1]; e++) {
        const v = this.dst[e];
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    return out;
  }
}

/** What changed between two TCBs (`TcbIndex.tcb`): the names added, removed, and whose content hash
 *  changed, each sorted. Own keys only: `toString` is a name like any. */
export function tcbDiff(then: Record<string, string>, now: Record<string, string>): { added: string[]; removed: string[]; changed: string[] } {
  const added = Object.keys(now).filter((k) => !Object.hasOwn(then, k)).sort();
  const removed = Object.keys(then).filter((k) => !Object.hasOwn(now, k)).sort();
  const changed = Object.keys(now).filter((k) => Object.hasOwn(then, k) && then[k] !== now[k]).sort();
  return { added, removed, changed };
}
