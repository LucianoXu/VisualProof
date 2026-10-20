// The Export window followed (the owner's decision of 2026-10-20; CollabSpec, "Surfaces"): whoever
// follows a reader sees their Export window as theirs is — open or not, its settings, the document
// typeset: Generate's progress, then the same downloads, read by the job's id — and their own window,
// open when following starts, is replaced by it. Read only: a control of it pressed ends following,
// and the window, with those settings, is theirs. What presence carries of it is checked as every
// field is; an agent has none.

import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlace, cleanExport, cleanView } from "../src/shared/collab.ts";
import type { ExportWindowView, PresenceView } from "../src/shared/collab.ts";
import { ExportModal } from "../src/web/src/exportmodal.ts";
import type { ExportHooks, ExportJobState, ExportView } from "../src/web/src/exportmodal.ts";
import { keyActs, pressActs } from "../src/web/src/surfaces.ts";
import type { PageEl } from "../src/web/src/surfaces.ts";

const ID = "0123456789abcdef0123456789abcdef";
const VIEW: ExportView = { id: "va", title: "A", heading: "A", fixed: false, plan: { count: 3, sectionCount: 1, outside: { count: 0, by: [] } } };

function box() {
  return { hidden: true, innerHTML: "", classList: { add() {}, remove() {} }, addEventListener() {}, querySelector: () => null, title: "" } as unknown as HTMLElement;
}

const tick = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));

/** A page's Export window: what it asks the server, what it tells those following it, what it keeps. */
function page(jobs: Map<string, ExportJobState | string> = new Map(), more: Partial<ExportHooks> = {}) {
  const el = box();
  const polled: string[] = [];
  const started: unknown[] = [];
  let changed = 0;
  let saved: ExportHooks["saved"] extends () => infer R ? R : never = { settings: { paper: "a4", fontSize: 11, codeSize: 8.5, contents: true } };
  const linear: boolean[] = [];
  const modal = new ExportModal(box(), el, {
    view: () => VIEW,
    saved: () => saved,
    save: (v) => (saved = v),
    head: async (v) => ({ title: `Title of ${v}`, author: "Alice" }),
    start: async (body) => (started.push(body), jobs.get("start") ?? { id: ID, state: "running" }),
    poll: async (id) => (polled.push(id), jobs.get(id) ?? "There is no such document: it was never asked for, or has left the cache."),
    shown: (open) => linear.push(open),
    changed: () => changed++,
    ...more,
  });
  return { el, modal, polled, started, linear, changed: () => changed, saved: () => saved, set: (k: string, value: string, checked = false) => (modal as unknown as { changed(t: unknown): void }).changed({ dataset: { set: k }, value, checked }) };
}

const generate = (m: ExportModal) => (m as unknown as { generate(): Promise<void> }).generate();

test("what those following see of the window: closed; open, with its settings; the document's job by its id as it goes, and each change told", async () => {
  const jobs = new Map<string, ExportJobState | string>([[ID, { id: ID, state: "done", pages: 4, ms: 2100 }]]);
  const a = page(jobs);
  assert.deepEqual(a.modal.state(), { open: false });
  a.modal.open();
  assert.deepEqual(a.modal.state(), { open: true, settings: { paper: "a4", fontSize: 11, codeSize: 8.5, contents: true } });
  const told = a.changed();
  assert.ok(told > 0, "opening is told");
  a.set("paper", "letter");
  a.set("fontSize", "12");
  a.set("contents", "", false);
  assert.deepEqual(a.modal.state().settings, { paper: "letter", fontSize: 12, codeSize: 8.5, contents: false });
  assert.ok(a.changed() >= told + 3, "each setting is told");
  // Generate: running before the server names it, then by its id, then done
  const going = generate(a.modal);
  assert.deepEqual(a.modal.state().job, { id: "", state: "running" });
  await tick();
  assert.deepEqual(a.modal.state().job, { id: ID, state: "running" });
  await going;
  assert.deepEqual(a.modal.state().job, { id: ID, state: "done" });
  // as presence carries it, the server takes it whole
  assert.deepEqual(cleanView({ mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [], export: a.modal.state() })!.export, a.modal.state());
  a.modal.close();
  assert.deepEqual(a.modal.state(), { open: false });
});

test("a follower's window: opened as the other's, with their settings, without taking the focus; their progress, then the same downloads; closed with theirs", async () => {
  const jobs = new Map<string, ExportJobState | string>();
  const b = page(jobs);
  const settings = { paper: "letter", fontSize: 12, codeSize: 9, contents: false } as const;
  // the other opens it and generates: the job is running
  jobs.set(ID, { id: ID, state: "running", at: new Date().toISOString(), startedHere: Date.now() - 7000 });
  b.modal.follow({ open: true, settings, job: { id: ID, state: "running" } });
  assert.equal(b.el.hidden, false);
  assert.deepEqual(b.linear, [true], "the linear form beside it, as the other's");
  assert.match(b.el.innerHTML, /<option value="letter" selected>Letter<\/option>/);
  assert.match(b.el.innerHTML, /<option value="12" selected>12 pt<\/option>/);
  assert.match(b.el.innerHTML, /<option value="9" selected>9 pt<\/option>/);
  assert.ok(!/data-set="contents" checked/.test(b.el.innerHTML));
  assert.match(b.el.innerHTML, /Typesetting with XeLaTeX/);
  assert.match(b.el.innerHTML, /data-ex-go disabled>Generating…/);
  await tick();
  // counted from when the other asked for it, by the server's clock (drawn again as the other's
  // presence comes again, the job the same: followed here already, not asked for again)
  b.modal.follow({ open: true, settings, job: { id: ID, state: "running" } });
  assert.match(b.el.innerHTML, /Typesetting with XeLaTeX… <span class="ex-secs">7 s<\/span>/);
  assert.deepEqual(b.polled, [ID]);
  // it is done: the same file, from the export's cache, offered here too
  jobs.set(ID, { id: ID, state: "done", pages: 4, ms: 2100, notes: ["P.size: proofs found by reading its text"] });
  await tick(750);
  assert.match(b.el.innerHTML, /<b>4 pages<\/b>, typeset in 2\.1 s/);
  assert.match(b.el.innerHTML, new RegExp(`href="/api/export/file\\?id=${ID}&what=pdf" download>Download PDF`));
  assert.match(b.el.innerHTML, /Notes \(1\)/);
  // the other's presence says done now: nothing is asked again
  const asked = b.polled.length;
  b.modal.follow({ open: true, settings, job: { id: ID, state: "done" } });
  await tick();
  assert.equal(b.polled.length, asked);
  // what those following the follower see is the same
  assert.deepEqual(b.modal.state(), { open: true, settings, job: { id: ID, state: "done" } });
  // the other closes it: closed here, the form with it
  b.modal.follow({ open: false });
  assert.equal(b.el.hidden, true);
  assert.deepEqual(b.linear, [true, false]);
});

test("a follower's own window, open when following starts, is replaced by the other's — or closed with theirs", async () => {
  const jobs = new Map<string, ExportJobState | string>([[ID, { id: ID, state: "done", pages: 2, ms: 900 }]]);
  const b = page(jobs);
  b.modal.open();
  b.set("codeSize", "10");
  await generate(b.modal);
  assert.match(b.el.innerHTML, /Download PDF/);
  // the other's is open, at their settings, with nothing typeset
  const theirs: ExportWindowView = { open: true, settings: { paper: "a4", fontSize: 10, codeSize: 7, contents: true } };
  b.modal.follow(theirs);
  assert.deepEqual(b.modal.state(), theirs, "nothing of the follower's own over it");
  assert.ok(!/Download PDF/.test(b.el.innerHTML));
  // the other's is closed: so is the follower's
  b.modal.open();
  b.modal.follow({ open: false });
  assert.equal(b.el.hidden, true);
  // a page from before, or an agent, says nothing of it: the follower's own stays (web/src/surfaces.ts applyOwn)
  assert.ok(!("export" in agentPlace(cleanView({ mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [], export: theirs }))!));
});

test("following ends: the window is the follower's, with the settings it showed; Generate makes that document", async () => {
  const jobs = new Map<string, ExportJobState | string>([[ID, { id: ID, state: "done", pages: 2, ms: 900 }]]);
  const b = page(jobs);
  const settings = { paper: "letter", fontSize: 10, codeSize: 7.5, contents: false } as const;
  b.modal.follow({ open: true, settings });
  // nothing more comes from the other: what the window shows is the follower's own now
  await generate(b.modal);
  assert.deepEqual((b.started[0] as { settings: unknown }).settings, settings);
  assert.deepEqual(b.saved(), { settings }, "and kept as theirs, as any settings they generate with");
});

test("what a follower cannot read: a document gone from the cache says so; one the other's server refused says why", async () => {
  const b = page(new Map());
  b.modal.follow({ open: true, job: { id: ID, state: "done" } });
  await tick();
  assert.match(b.el.innerHTML, /class="banner warn">There is no such document: it was never asked for, or has left the cache\. Generate makes it again\./);
  assert.match(b.el.innerHTML, /data-ex-go>Generate</, "Generate is offered");
  const c = page(new Map());
  c.modal.follow({ open: true, job: { id: "", state: "failed", error: "XeLaTeX is not installed on the server, so documents cannot be typeset here" } });
  assert.match(c.el.innerHTML, /Typesetting failed: XeLaTeX is not installed on the server, so documents cannot be typeset here\./);
  assert.deepEqual(c.polled, [], "nothing to ask for");
  // the other asked, and the server has not answered yet: their progress, nothing asked
  const d = page(new Map());
  d.modal.follow({ open: true, job: { id: "", state: "running" } });
  assert.match(d.el.innerHTML, /Typesetting with XeLaTeX/);
  assert.deepEqual(d.polled, []);
  // closed with the other's, its seconds stop being counted
  d.modal.follow({ open: false });
});

test("the window's presence is checked as every field: settings out of range and a job that is none are not carried", () => {
  assert.deepEqual(cleanExport({ open: false, settings: { paper: "letter" } }), { open: false });
  assert.deepEqual(cleanExport({ open: true, settings: { paper: "letter", fontSize: 12, codeSize: 9.2, contents: false, margin: 30 } }), { open: true, settings: { paper: "letter", fontSize: 12, codeSize: 9, contents: false } }, "the window's own settings, a code size rounded to a half");
  for (const bad of [{ paper: "a3" }, { fontSize: 14 }, { codeSize: 99 }, { contents: "yes" }, "letter"]) assert.deepEqual(cleanExport({ open: true, settings: bad }), { open: true }, JSON.stringify(bad));
  for (const job of [{ id: "x", state: "done" }, { id: ID, state: "printing" }, { id: "", state: "done" }, { id: 5, state: "running" }]) assert.deepEqual(cleanExport({ open: true, job }), { open: true }, JSON.stringify(job));
  const failed = cleanExport({ open: true, job: { id: "", state: "failed", error: "line\nbreak " + "x".repeat(900), log: "the whole log" } })!;
  assert.equal(failed.job!.error!.length, 500);
  assert.ok(!failed.job!.error!.includes("\n"));
  assert.ok(!("log" in failed.job!), "the log is the job's to give");
  for (const bad of [null, "open", { open: "yes" }, { settings: {} }]) assert.equal(cleanExport(bad), null);
  const v: Partial<PresenceView> = cleanView({ mode: "tcb", sel: null, source: false, clusterMode: "namespace", cam: null, view: null, scope: null, tabs: [], export: { open: "no" } })!;
  assert.ok(!("export" in v));
});

/** An element of the page as the rule reads it (test/surfaces.test.ts). */
const at = (...chain: string[]): PageEl | null =>
  chain.reduce<PageEl | null>((parentElement, own) => {
    const mine = own.split("|");
    return { matches: (sel: string) => sel.split(",").some((s) => mine.includes(s.trim())), parentElement };
  }, null);

test("read only for the follower: Export pressed, a setting, Generate, a download, Close, the Artwork tab, typing in it end following; reading it does not", () => {
  assert.equal(pressActs(at("#export-btn")), true, "opened or closed from the bar");
  assert.equal(pressActs(at("#more-pop", "#more-pop [data-for=export-btn]")), true, "or from a phone's ⋯");
  for (const control of ["select", "button", "a[href]", "input"]) assert.equal(pressActs(at("#export-modal", ".ex-box", control)), true, control);
  assert.equal(pressActs(at("#export-modal", ".ex-box", "#export-modal .ex-check")), true, "a check's words press its box");
  assert.equal(pressActs(at("#export-modal", ".ex-box", "#export-modal [data-ex-art]")), true, "the Artwork tab");
  assert.equal(keyActs({ key: "ArrowDown" }, at("#export-modal", ".ex-box", "select"), true), true, "a setting changed from the keyboard");
  // its text, its notes and the log folded or read, scrolled: reading
  assert.equal(pressActs(at("#export-modal", ".ex-box")), false);
  assert.equal(pressActs(at("#export-modal", ".ex-box", "summary")), false);
});
