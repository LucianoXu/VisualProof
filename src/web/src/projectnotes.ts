// The project's notes as this page holds them (AttachmentSpec decisions 13–19, shared/projectnotes.ts):
// every one, whichever board is on show — the notes layer (web/src/sticky.ts) decides which the board
// shows and where. What this page does to one is applied here at once and sent to the server, which
// tells every page (`note-ops`); what the others do comes back the same way, this page's own skipped.
// A page that was away reads them all again.

import type { ClusterMode } from "../../shared/graph.ts";
import { applyProjectNoteOp } from "../../shared/projectnotes.ts";
import type { ClusterPlace, ProjectNote, ProjectNoteOp } from "../../shared/projectnotes.ts";
import type { ReviewChange } from "../../shared/review.ts";
import { newNoteId } from "../../shared/sticky.ts";
import type { ViewsApi } from "./data.ts";
import type { Uploaded } from "./library.ts";

/** What making notes of files needs (`notesOfFiles`). */
export interface FileNotes {
  /** add a file to the library */
  upload(f: File): Promise<Uploaded>;
  /** apply at once the review's change an upload brought: the file's record */
  take(c: ReviewChange): void;
  /** write a note of the project for everyone: why it was refused, said already, or null */
  write(n: ProjectNote): Promise<string | null>;
  /** whether the board the files were dropped on is still on show */
  still(): boolean;
  say(text: string): void;
  /** the name the reader writes under, and that the server took none from the page */
  by: string | null;
  lost(): void;
}

/** Files dropped on the canvas, or an image pasted (AttachmentSpec decision 12): each added to the
 *  library and made a note of the project carrying it, at its own place (`places`, one a file), its
 *  title as its text, open. A file the library refuses — its type, its size, the library's limit —
 *  says why and makes no note, and the others go on; a note refused, or another board shown, stops
 *  there. The notes made, by id. */
export async function notesOfFiles(files: readonly File[], places: readonly { mode: ClusterMode; place: ClusterPlace }[], d: FileNotes): Promise<string[]> {
  const made: string[] = [];
  for (const [k, file] of files.entries()) {
    d.say(`Adding ${file.name} to the library…`);
    const r = await d.upload(file);
    if (!r.ok) {
      if (r.who) d.lost();
      d.say(`${file.name}: ${r.error}`);
      continue;
    }
    if (r.change) d.take(r.change);
    if (!d.still()) break;
    const id = newNoteId();
    const note: ProjectNote = { id, text: r.file.title, places: { [places[k].mode]: places[k].place }, open: true, by: d.by, at: new Date().toISOString(), carries: [{ file: r.file.sha }] };
    if (await d.write(note)) break;
    made.push(id);
  }
  return made;
}

export class ProjectNotes {
  /** every note of the project, in the order they were written */
  list: ProjectNote[] = [];
  private api: ViewsApi;
  /** this page's event stream as the server named it, and the secret that says what it sends is its
   *  own (web/src/boardsync.ts does the same for the views' operations) */
  private stream: () => { id: string; token: string } | null;

  constructor(api: ViewsApi, stream: () => { id: string; token: string } | null) {
    this.api = api;
    this.stream = stream;
  }

  async load(): Promise<void> {
    this.list = await this.api.notes();
  }

  get(id: string): ProjectNote | null {
    return this.list.find((n) => n.id === id) ?? null;
  }

  /** Operations another page, an agent or the server made; false for this page's own, which are
   *  applied already, and for what changed nothing. */
  take(d: { ops: ProjectNoteOp[]; from: string | null }): boolean {
    if (d.from !== null && d.from === this.stream()?.id) return false;
    let changed = false;
    for (const o of d.ops) if (applyProjectNoteOp(this.list, structuredClone(o))) changed = true;
    return changed;
  }

  /** This page changes the project's notes: applied here at once, then sent. A note written in a
   *  view (`written`: the board on show, but the Project) is added to it by the server, as the page
   *  adds it to its own record of the view. Resolves to why the server refused, or null (`who`: it
   *  took no name from this page). */
  async send(ops: ProjectNoteOp[], written: string | null = null): Promise<{ error: string | null; who: boolean }> {
    for (const o of ops) applyProjectNoteOp(this.list, structuredClone(o));
    const r = await this.api.post("notes", { ops, token: this.stream()?.token ?? null, ...(written ? { in: written } : {}) });
    return { error: r.error ?? null, who: !!r.who };
  }
}
