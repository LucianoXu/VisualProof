// Notes (AttachmentSpec decisions 12–19): the project's and a view's, written, edited, moved, made
// the other kind, added to a view or taken out of it; and what they carry, a file dropped on the
// canvas or an image pasted making one.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { ClusterMode } from "../../shared/graph.ts";
import { evaluate, parseQuery, printQuery } from "../../shared/query.ts";
import { newNoteId, noteExcerpt, withCarry } from "../../shared/sticky.ts";
import type { NoteCarry, NoteOp, StickyNote } from "../../shared/sticky.ts";
import type { ProjectNote, ProjectNoteOp } from "../../shared/projectnotes.ts";
import { itemOp } from "../../shared/items.ts";
import type { ItemOp } from "../../shared/items.ts";
import { derivesOn, existsIn } from "../../shared/noteplace.ts";
import { fixedScope } from "../../shared/views.ts";
import { menuItems } from "./ctxmenu.ts";
import type { MenuTarget } from "./ctxmenu.ts";
import type { Dropped, NoteKind } from "./sticky.ts";
import { notesOfFiles } from "./projectnotes.ts";
import { fileOf } from "../../shared/library.ts";
import { uploadFile } from "./library.ts";
import { typing } from "./typing.ts";
import { nameNow } from "./verified.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the notes give the page's other parts. */
export interface NotesPart {
  noteOps: (ops: NoteOp[]) => void;
  projectOps: (ops: ProjectNoteOp[], here?: boolean) => Promise<string | null>;
  noteOf: (id: string) => { kind: NoteKind; note: ProjectNote | StickyNote } | null;
  noteOpenHere: (id: string) => boolean;
  setNoteOpen: (id: string, open: boolean) => void;
  moveNote: (id: string, d: Dropped) => void;
  writeNote: (kind: NoteKind, at: { x: number; y: number }, world: [number, number]) => Promise<void>;
  editNote: (id: string, at?: { x: number; y: number }) => Promise<void>;
  switchNote: (id: string) => Promise<void>;
  itemTo: (id: string, to: string | null) => Promise<void>;
  openNoteMenu: (id: string, x: number, y: number) => void;
  noteRefused: () => string | null;
  attachTo: (id: string, c: NoteCarry) => Promise<boolean>;
  detach: (id: string, k: number) => Promise<void>;
  clipToNote: (c: NoteCarry, text: string) => Promise<boolean>;
}

export function notesPart(page: Page): NotesPart {
  const { data, reader } = page;

  // ---------------------------------------------------------------- notes
  //
  // A note is the project's unless it is made a view's (AttachmentSpec decisions 13–19): the
  // project's are written, edited, moved, opened or collapsed and deleted as operations on the
  // project's notes (web/src/projectnotes.ts), a view's as the view's operations (shared/sticky.ts);
  // both are applied here at once and sent to everyone, the server recording who wrote one as it
  // records who dropped a pin. Writing, editing and deleting one is under the reader's name (the
  // timeline says who); opening and moving one, as a fold and a pin, are not. Where a note goes on a
  // board is the notes layer's (web/src/sticky.ts, placeFor).

  /** Change the notes of the board on show's view, for everyone on it. */
  const noteOps = (ops: NoteOp[]) => {
    page.sync.arrange(ops);
    page.stickies.render();
  };
  /** Change the project's notes, for everyone, from a board that can be arranged. `here`: the notes
   *  written are written in the board on show, which they are added to (the owner's decision of
   *  2026-10-11: what is written or dropped in a view is that view's, wherever it is put), but on the
   *  Project, which holds every one. Resolves to why they were refused, said already, or null. */
  const projectOps = async (ops: ProjectNoteOp[], here = false): Promise<string | null> => {
    if (page.frozen()) {
      page.say(page.frozenWhy());
      return page.frozenWhy();
    }
    const written = here && !fixedScope(page.nav.board.rec) ? page.nav.board.id : null;
    const added: ItemOp[] = written ? ops.flatMap((o): ItemOp[] => (o.op === "pnote" ? [{ op: "item", note: o.note.id, in: "add" }] : [])) : [];
    const r = page.projectNotes.send(ops, written);
    // the view's record takes them at once, as the server's answer does for the others
    if (written && added.length) page.views.ops(written, added);
    page.stickies.render();
    const { error, who } = await r;
    if (who) page.people.lost();
    if (error) {
      // refused: what this page applied at once is taken back, as the server holds them
      page.say(error);
      await page.projectNotes.load();
      if (written && added.length) page.views.ops(written, added.map((o) => ({ ...o, in: null })));
    }
    page.stickies.render();
    return error;
  };
  /** A note on the board on show, of either kind, by its id. */
  const noteOf = (id: string): { kind: NoteKind; note: ProjectNote | StickyNote } | null => {
    const v = page.nav.board.rec.notes?.find((n) => n.id === id);
    if (v) return { kind: "view", note: v };
    const p = page.projectNotes.get(id);
    return p ? { kind: "project", note: p } : null;
  };
  /** Whether note `id` is open on this page: as its reader left it, where it is theirs alone. */
  const noteOpenHere = (id: string): boolean => page.ownOpen.get(id) ?? !!noteOf(id)?.note.open;
  /** Open note `id`, or collapse it: for everyone, as its own state; on a read-only reader's page for
   *  them alone, which shares nothing (CollabSpec decision 11). */
  const setNoteOpen = (id: string, open: boolean) => {
    const n = noteOf(id);
    if (!n) return;
    if (reader) {
      page.ownOpen.set(id, open);
      page.stickies.render();
    } else if (n.kind === "project") void projectOps([{ op: "pnote-open", id, open }]);
    else noteOps([{ op: "note-open", id, open }]);
  };
  /** A note let go somewhere: attached to a declaration — its place under every clustering, its
   *  places beside it where it falls back to — or detached from the one it was attached to and put
   *  at its place under the board's clustering, or its view note's place (the owner's decision of
   *  2026-10-12). */
  const moveNote = (id: string, d: Dropped) => {
    const had = noteOf(id)?.note.decl;
    const attach = d.decl || had ? d.decl : undefined;
    const to = d.to;
    if (to?.kind === "view" || (!to && page.nav.board.rec.notes?.some((n) => n.id === id))) {
      const ops: NoteOp[] = [];
      if (attach !== undefined) ops.push({ op: "note-decl", id, decl: attach });
      if (to?.kind === "view") ops.push({ op: "note-move", id, place: to.place });
      if (ops.length) noteOps(ops);
      return;
    }
    const ops: ProjectNoteOp[] = [];
    if (attach !== undefined) ops.push({ op: "pnote-decl", id, decl: attach });
    if (to) ops.push({ op: "pnote-move", id, mode: to.mode, place: to.place });
    if (d.also) ops.push({ op: "pnote-move", id, mode: d.also.mode, place: d.also.place });
    if (ops.length) void projectOps(ops);
  };
  /** Write a note at a spot of the board, in an editor at a point of the window: the project's
   *  (Add a note here), or this view's own (Add a note for this view). */
  const writeNote = async (kind: NoteKind, at: { x: number; y: number }, world: [number, number]) => {
    if (page.frozen()) return page.say(page.frozenWhy());
    const why = await page.named();
    if (why) return page.say(why.replace("A view is made", "A note is written"));
    const board = page.nav.board.id;
    const label = kind === "project" ? (fixedScope(page.nav.board.rec) ? "A note of the project, on the Project and every view whose scope gives it" : "A note of the project, on this view, the Project and every view whose scope gives it") : `A note of “${page.views.title(board)}” alone`;
    page.stickies.edit(at, "", label, (text) => {
      if (text === null || page.nav.board.id !== board) return;
      const to = page.stickies.placeFor(kind, world);
      if (!to) return;
      const who = { open: true, by: page.people.name, at: new Date().toISOString() };
      if (to.kind === "project") void projectOps([{ op: "pnote", note: { id: newNoteId(), text, places: { [to.mode]: to.place }, ...who } }], true);
      else noteOps([{ op: "note", note: { id: newNoteId(), text, place: to.place, ...who } }]);
    });
  };
  /** Edit a note's text, in an editor over it. */
  const editNote = async (id: string, at?: { x: number; y: number }) => {
    const n = noteOf(id);
    if (!n) return;
    if (page.frozen()) return page.say(page.frozenWhy());
    const why = await page.named();
    if (why) return page.say(why.replace("A view is made", "A note is edited"));
    const board = page.nav.board.id;
    page.stickies.edit(page.stickies.screenOf(id) ?? at ?? { x: innerWidth / 2 - 150, y: innerHeight / 3 }, n.note.text, "Edit the note", (text) => {
      if (text === null || text === n.note.text || page.nav.board.id !== board || !noteOf(id)) return;
      // stamped here as the server stamps it, which it does again under the name it takes
      const edit = { id, text, by: page.people.name, at: new Date().toISOString() };
      if (n.kind === "project") void projectOps([{ op: "pnote-edit", ...edit }]);
      else noteOps([{ op: "note-edit", ...edit }]);
    });
  };
  /** Make a note the other kind, keeping its text, its author and where it is on this board: a note
   *  of the project this view's own (Only in this view), or this view's the project's (In every
   *  view). */
  const switchNote = async (id: string) => {
    const n = noteOf(id);
    if (!n) return;
    if (page.frozen()) return page.say(page.frozenWhy());
    const why = await page.named();
    if (why) return page.say(why.replace("A view is made", "A note is made the project's or a view's"));
    const spot = page.stickies.spotOf(id);
    const to: NoteKind = n.kind === "project" ? "view" : "project";
    const at = spot && page.stickies.placeFor(to, spot);
    if (!at) return page.say("That note is not on the board now: bring it into view first.");
    // sent as no page's: the server tells every page, this one too, which applies both sides then
    const r = await page.views.post("note-kind", { id: page.nav.board.id, note: id, to, place: at.place, mode: page.cm(), token: null });
    if (r.who) page.people.lost();
    if (r.error) return page.say(r.error);
    // a snapshot has no stream to hear it on: both sides are read again
    if (data.snapshot) {
      await page.projectNotes.load();
      await page.views.record(page.nav.board.id, true);
    }
    page.stickies.render();
    page.say(to === "view" ? `The note is “${page.views.title(page.nav.board.id)}”'s alone now.` : "The note is the project's now: the Project, this view and every view whose scope gives it show it.");
  };
  // ---------------------------------------------------------------- items
  //
  // A note of the project is an item, and items belong to views as declarations do (the owner's
  // decision of 2026-10-11, shared/items.ts): the Project holds every one; another view shows what
  // its scope gives and what was added to it, less what was taken out. The note's menu adds it to
  // another view (Add to view ▸) or takes it out of this one (Remove from this view), for everyone on
  // that view, as Add to view and Remove from this view change a declaration's view; what is written
  // or dropped in a view is added to it (projectOps).

  /** Whether a view's scope gives a note by itself (shared/noteplace.ts, derivesOn): the board on
   *  show as it is (a past build's, with the links as it reads them), another view by its scope on
   *  the graph on show; null where its scope cannot be read here. */
  const derivedIn = (v: { id: string; scope: string; clustering: ClusterMode }): ((n: ProjectNote) => boolean) | null => {
    if (v.id === page.nav.board.id) return derivesOn(page.cm(), page.vg().nodes, existsIn(page.nav.board.full.nodes), page.boardReview().links, page.nav.board.past?.past.nowName);
    try {
      const set = evaluate(parseQuery(v.scope), { g: page.g, review: page.review.data });
      return derivesOn(v.clustering, page.g.nodes.filter((_, i) => set[i]), existsIn(page.g.nodes), page.review.data.links);
    } catch {
      return null;
    }
  };
  /** What a note of the project's menu offers of the views: every view whose scope can change but
   *  this one, the kept ones first, each saying whether it shows the note already (✓); and whether it
   *  can be taken out of this one (not on the Project). */
  const noteViews = (n: ProjectNote): { views: { id: string; title: string; holds: boolean; temporary?: boolean }[]; remove: boolean } => {
    const rec = page.nav.board.rec;
    const views_ = page.views.summaries
      .filter((v) => !fixedScope(v) && v.id !== rec.id)
      .sort((a, b) => Number(b.kept) - Number(a.kept))
      .slice(0, 40)
      .map((v) => {
        const listed = v.items?.add.includes(n.id) ? "add" : v.items?.remove.includes(n.id) ? "remove" : null;
        const holds = listed !== "remove" && (listed === "add" || !!derivedIn(v)?.(n));
        return { id: v.id, title: page.views.title(v.id), holds, ...(v.kept ? {} : { temporary: true }) };
      });
    return { views: views_, remove: !fixedScope(rec) };
  };
  /** Add note `id` of the project to view `to` (Add to view ▸), or take it out of the board on show
   *  (`to` null: Remove from this view), for everyone on that view: on its add list only where its
   *  scope does not give it, on its remove list only where it does (shared/items.ts, itemOp). */
  const itemTo = async (id: string, to: string | null) => {
    const n = page.projectNotes.get(id);
    if (!n) return;
    const here = to === null || to === page.nav.board.id;
    const rec = page.nav.board.rec;
    const v = here ? { id: rec.id, scope: printQuery(rec.scope), clustering: rec.clustering, items: rec.items } : page.views.summary(to!);
    if (!v) return;
    const gives = derivedIn(v);
    if (!gives) return page.say(`The scope of “${page.views.title(v.id)}” cannot be read here.`);
    const op = itemOp(here ? page.nav.board.rec.items : v.items, id, to === null ? "remove" : "add", gives(n));
    const what = `the note “${noteExcerpt(n.text, 40)}”`;
    if (!op) return page.say(to === null ? `This view does not show ${what}.` : `“${page.views.title(v.id)}” shows ${what} already.`);
    if (here) {
      await page.sync.arrange([op]);
      page.stickies.render();
      return page.say(`Took ${what} out of this view; the Project and every other view keep it as they had it.`);
    }
    const r = await page.views.post("arrange", { id: v.id, ops: [op] });
    if (r.who) page.people.lost();
    if (r.error) return page.say(r.error);
    // a snapshot has no server to tell it: its record of the view takes it here
    if (data.snapshot) page.views.ops(v.id, [op]);
    page.sync.afterPost();
    page.say(`Added ${what} to “${page.views.title(v.id)}”.`);
  };

  /** A note's menu: edit, open or collapse, the other kind, add it to a view or take it out of this
   *  one, delete. */
  const openNoteMenu = (id: string, x: number, y: number) => {
    const n = noteOf(id);
    if (!n) return;
    const t: MenuTarget = {
      kind: "note",
      open: noteOpenHere(id),
      view: n.kind === "view",
      ...(reader ? { own: true } : {}),
      carries: (n.note.carries ?? []).map(carryLabel),
      attach: !data.snapshot && !reader,
      ...(n.kind === "project" ? { items: noteViews(n.note as ProjectNote) } : {}),
    };
    const items = menuItems(t, page.menuContext(null));
    if (!items.length) return;
    $("#tip").hidden = true;
    page.menuOn = { t, note: id, part: null, world: page.canvas.toWorld(x, y), at: { x, y } };
    const by = n.note.by ? ` by ${nameNow(n.note.by, n.note.person)}${n.note.person ? " ✓" : ""}` : "";
    page.ctxMenu.show(items, x, y, `${n.kind === "view" ? "This view's note" : "Note"}${by}`);
  };

  // ---------------------------------------------------------------- what notes carry
  //
  // A note carries files of the library and clips of their pages (AttachmentSpec decision 12): a
  // file dropped on the canvas, or an image pasted, is added to the library and makes a note of the
  // project carrying it where it was let go, its title as its text, open for editing; a box of a
  // PDF's page is made into a note from the reference window (Clip to a note); and a note's menu
  // attaches a file or a clip to it (Attach…) or takes one off (Detach). Changing what a note carries
  // is an edit of the note, under the reader's name, as an edit of its text is.

  /** Why no note can be made, or given what it carries, on this board: a preview of a view, which
   *  nothing arranges, or a snapshot of the page, which has no library. Null where it can. */
  const noteRefused = (): string | null =>
    page.frozen() ? page.frozenWhy() : data.snapshot ? "A snapshot of the page carries no library: a note carries the files the server keeps." : null;

  /** A file or a clip a note carries, in a few words: what the note's menu lists. */
  const carryLabel = (c: NoteCarry): string => {
    const f = fileOf(page.review.data, c.file);
    if (!f) return "A file the library has no record of";
    const title = f.title.length > 48 ? f.title.slice(0, 47) + "…" : f.title;
    return f.type !== "pdf" ? title : c.region ? `A clip of ${title}, p. ${c.page}` : c.page ? `${title}, p. ${c.page}` : title;
  };

  /** Edit what note `n` carries, its text as it is: an edit of the note. Why it was refused, or null. */
  const editCarries = async (n: { kind: NoteKind; note: ProjectNote | StickyNote }, carries: NoteCarry[]): Promise<string | null> => {
    const edit = { id: n.note.id, text: n.note.text, carries, by: page.people.name, at: new Date().toISOString() };
    if (n.kind === "project") return projectOps([{ op: "pnote-edit", ...edit }]);
    noteOps([{ op: "note-edit", ...edit }]);
    return null;
  };

  /** Say why something was not done; false, for what answers whether it was. */
  const refused = (why: string): false => {
    page.say(why);
    return false;
  };

  /** Attach a file or a clip to note `id` (its menu's Attach…). Whether it was. */
  const attachTo = async (id: string, c: NoteCarry): Promise<boolean> => {
    const no = noteRefused();
    if (no) return refused(no);
    const n = noteOf(id);
    if (!n) return refused("That note is not on this board any more.");
    const why = await page.named();
    if (why) return refused(why.replace("A view is made", "A note is edited"));
    const next = withCarry(n.note.carries, c);
    if (typeof next === "string") return refused(next);
    if (await editCarries(n, next)) return false;
    page.say(`Attached ${carryLabel(c)} to the note.`);
    return true;
  };

  /** Take the `k`-th of what note `id` carries off it (its menu's Detach): the file stays in the
   *  library. */
  const detach = async (id: string, k: number) => {
    const n = noteOf(id);
    const c = n?.note.carries?.[k];
    if (!n || !c) return;
    const no = noteRefused();
    if (no) return page.say(no);
    const why = await page.named();
    if (why) return page.say(why.replace("A view is made", "A note is edited"));
    if (!(await editCarries(n, n.note.carries!.filter((_, j) => j !== k)))) page.say(`${carryLabel(c)} is off the note; it stays in the library.`);
  };

  /** Open note `id`'s editor once it is drawn, the view brought to it first where it does not show
   *  or shows collapsed (a note made from the reference window, perhaps far from what is in view). */
  const editWhenShown = (id: string, bring: boolean) => {
    const look = page.stickies.lookOf(id);
    if (bring && look !== "open") {
      page.stickies.flyTo(id);
      setTimeout(() => void editNote(id), 620);
    } else void editNote(id);
  };

  /** Where a note made from the reference window goes (Clip to a note): beside the declaration
   *  selected on the board, in its cluster; in the cluster selected; else on the ring, in the order
   *  notes were written. With where that is, in words. */
  const clipPlace = (): { places: ProjectNote["places"]; where: string } | null => {
    const i = page.selected();
    const j = i === null ? -1 : page.toView(i);
    const c = page.shownCluster();
    const to = j >= 0 ? page.stickies.placeBeside(j) : c >= 0 ? page.stickies.placeInCluster(c) : null;
    if ((j >= 0 || c >= 0) && !to) return null;
    if (!to) return { places: {}, where: "on the ring around the board" };
    const key = "in" in to.place ? to.place.in[0][0] : null;
    return { places: { [to.mode]: to.place }, where: key ? `in ${key.split(".").slice(-2).join(".")}` : "on the ring around the board" };
  };

  /** Clip to a note, from the reference window: a note of the project carrying the clip, with that
   *  text, open for editing. Whether it was made. */
  const clipToNote = async (c: NoteCarry, text: string): Promise<boolean> => {
    const no = noteRefused();
    if (no) return refused(no);
    const why = await page.named();
    if (why) return refused(why.replace("A view is made", "A note is written"));
    const at = clipPlace();
    if (!at) return refused("This board is not drawn yet.");
    const id = newNoteId();
    if (await projectOps([{ op: "pnote", note: { id, text, places: at.places, open: true, by: page.people.name, at: new Date().toISOString(), carries: [c] } }], true)) return false;
    page.say(`Clipped to a note ${at.where}.`);
    editWhenShown(id, true);
    return true;
  };

  /** Files dropped on the canvas at a point of the window, or an image pasted: each added to the
   *  library and made a note of the project carrying it, spaced apart from that spot, its title as
   *  its text; one alone opens for editing. A file the library refuses says why and makes no note. */
  const addNotesOf = async (files: File[], at: { x: number; y: number }) => {
    const no = noteRefused();
    if (no) return page.say(no);
    // a file is added to the library under a name, as a link is made (AttachmentSpec decision 1)
    if (!(await page.people.ensure())) return page.say("A file is added to the library under your name: give one first.");
    const board = page.nav.board.id;
    const spots = page.stickies.placesFor(page.canvas.toWorld(at.x, at.y), files.length);
    if (!spots) return page.say("This board is not drawn yet.");
    const refusals: string[] = [];
    const made = await notesOfFiles(files, spots, {
      upload: (f) => uploadFile(f, page.papers.headers()),
      take: (c) => page.takeChange(c),
      write: (note) => projectOps([{ op: "pnote", note }], true),
      still: () => page.nav.board.id === board,
      say: (text) => page.say(text),
      refused: (why) => void refusals.push(why),
      by: page.people.name,
      lost: () => page.people.lost(),
    });
    if (made.length === 1) editWhenShown(made[0], false);
    // what was refused is said with the notes made, which would otherwise say over it
    else if (made.length) page.say(`${made.length} notes made, each carrying its file: double-click one to add words.${refusals.map((r) => ` ${r}`).join("")}`);
  };

  /** Whether an event is on the canvas: the board itself, a card on it, or a note — not a panel, a
   *  bar or a window over it. */
  const onCanvas = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.id === "canvas" || !!el.closest?.("#stickies, #cards"));
  };
  // a file dragged over the canvas is taken there, and let go it makes a note at that spot; dropped
  // on the Library's list, it is added there alone (web/src/library.ts)
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files") || !onCanvas(e.target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    if (e.defaultPrevented || !onCanvas(e.target)) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void addNotesOf(files, { x: e.clientX, y: e.clientY });
  });
  /** where the pointer last was over the canvas: where a pasted image makes its note */
  let pointerAt: { x: number; y: number } | null = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      pointerAt = onCanvas(e.target) ? { x: e.clientX, y: e.clientY } : pointerAt;
    },
    { passive: true },
  );
  // an image pasted, anywhere but in a field, makes a note where the pointer last was on the canvas,
  // else in the middle of what is in view; it is named by when it was pasted, as it has no name
  document.addEventListener("paste", (e) => {
    if (typing(e.target) || typing(document.activeElement)) return;
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    e.preventDefault();
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
    const pasted = images.map((f, k) => new File([f], `Pasted image ${when}${images.length > 1 ? ` (${k + 1})` : ""}.${f.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`, { type: f.type }));
    const I = page.canvas.insets;
    void addNotesOf(pasted, pointerAt ?? { x: (I.left + innerWidth - I.right) / 2, y: (I.top + innerHeight - I.bottom) / 2 });
  });

  return {
    noteOps, projectOps, noteOf, noteOpenHere, setNoteOpen, moveNote, writeNote, editNote, switchNote, itemTo, openNoteMenu, noteRefused, attachTo, detach,
    clipToNote,
  };
}
