// Short titles of views (the owner's decision of 2026-10-10, shared/titles.ts): a view nobody named is
// called by its scope as the selection's chips say a pick, a name told apart from the project's
// others of its kind by as many parents as it takes, conditions condensed, a cluster's set read as
// the cluster, a past build briefly, about 30 characters and never more than 48; a name people gave
// never changes; the description in full beside it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { keysQuery, parseQuery, reviewScope } from "../src/shared/query.ts";
import { lastPart, nameParts, scopeTitle, TITLE_MAX, titleNames } from "../src/shared/titles.ts";
import { docTitle, PROJECT, titleOfScope, versionName, viewDescription, viewTitle } from "../src/shared/views.ts";

// the project's names: two namespaces end with Real, two files with Bridge, two declarations with main
const decls = ["My.Real.Exp.main", "My.Algebra.Lp.main", "My.Real.Bounds.le_of_tendsto", "My.Real.Bounds.helper", "My.Old.Real.legacy", "My.Real.Exp.exp_le", "Nat.add", "My.Fin.add"];
const modules = ["My.Real.Order.Bridge", "My.Topo.Bridge", "My.Real.Bounds", "My.Fin.Basic"];
const prefixes = (xs: string[], whole: boolean) => new Set(xs.flatMap((n) => nameParts(n).slice(0, whole ? undefined : -1).map((_, k, p) => p.slice(0, k + 1).join("."))));
const N = titleNames(() => decls, () => prefixes(decls.slice(0, 6).concat("My.Fin.add"), false), () => prefixes(modules, true));
const title = (scope: string, more: { version?: number } = {}, build?: (s: number) => string | null) => viewTitle({ id: "v1", name: null, scope: parseQuery(scope), ...more }, { names: N, build });

test("a name is its last part and as many parents as tell it apart from the project's others of its kind", () => {
  assert.equal(N.ns("My.Real"), "My.Real", "My.Old.Real ends with Real too");
  assert.equal(N.ns("My.Real.Bounds"), "Bounds");
  assert.equal(N.ns("My.Old.Real"), "Old.Real");
  assert.equal(N.file("My.Real.Order.Bridge"), "Order.Bridge", "My.Topo.Bridge ends with Bridge too");
  assert.equal(N.file("My.Real.Bounds"), "Bounds", "a file and a namespace are told apart within their kinds only");
  assert.equal(N.decl("My.Real.Exp.main"), "Exp.main");
  assert.equal(N.decl("My.Real.Bounds.le_of_tendsto"), "le_of_tendsto");
  assert.equal(N.decl("My.Fin.add"), "Fin.add", "an outside declaration counts: Nat.add");
  assert.equal(N.ns("Elsewhere.Real"), "Elsewhere.Real", "a name the project does not have is told apart from those it has");
  // without the graph, the last part, as a chip says it: one that says little alone keeps its parent
  assert.equal(lastPart("My.Real.Bounds"), "Bounds");
  assert.equal(lastPart("My.Basic.2"), "Basic.2");
  assert.equal(lastPart("My.A.ab"), "A.ab");
  assert.deepEqual(nameParts("My.«term_⊕.x_».y"), ["My", "«term_⊕.x_»", "y"]);
});

test("titles of typical scopes, said as the chips say a pick", () => {
  // a namespace, a file
  assert.equal(title("ns(My.Real.Bounds)"), "ns Bounds");
  assert.equal(title("file(My.Real.Order.Bridge)"), "file Order.Bridge");
  // TCB of a declaration; of a namespace's cluster, without what is outside the project, as a
  // namespace's cluster is read: before, "TCB of namespace My.Real except the outside world"
  assert.equal(title("tcb(My.Real.Bounds.le_of_tendsto)"), "TCB of le_of_tendsto");
  assert.equal(title("tcb(ns(My.Real) except external)"), "TCB of ns My.Real");
  assert.equal(title("tcb(ns(My.Real.Bounds) except external)"), "TCB of ns Bounds");
  // uses and used by, of a file's cluster too
  assert.equal(title("uses(My.Real.Exp.exp_le)"), "what exp_le uses");
  assert.equal(title("usedBy(My.Real.Exp.main)"), "what uses Exp.main");
  assert.equal(title("uses(file(My.Topo.Bridge))"), "what file Topo.Bridge uses");
  // the key declarations: a target's, a Keys pick, another target's in a TCB
  assert.equal(title("key(My.Real.Exp.exp_le)"), "keys of exp_le");
  assert.equal(viewTitle({ id: "v1", name: null, scope: keysQuery("My.Real.Exp.exp_le", "targets") }, { names: N }), "keys exp_le rests on");
  assert.equal(viewTitle({ id: "v1", name: null, scope: keysQuery("My.Real.Bounds.helper", ["My.Real.Exp.exp_le"]) }, { names: N }), "keys of exp_le in TCB of helper");
  // a cluster's Zoom in, on the Project and within a board of a target's review set (the board's scope as a condition)
  assert.equal(title("ns(My.Real.Bounds) except external"), "ns Bounds");
  assert.equal(viewTitle({ id: "v1", name: null, scope: { op: "and", a: parseQuery("tcb(ns(My.Real.Bounds) except external)"), b: reviewScope("My.Real.Exp.exp_le") } }, { names: N }), "TCB of ns Bounds in ★exp_le", "within a target's review set");
  // a selection of several picks, zoomed in
  assert.equal(title("decl(My.Real.Bounds.helper) or tcb(My.Real.Exp.main)"), "helper + TCB of Exp.main");
  assert.equal(title("decl(My.Real.Bounds.helper, My.Fin.add, My.Real.Exp.main)"), "helper, Fin.add +1");
  // the outside world's clusters
  assert.equal(title("external"), "outside world");
  assert.equal(title("(ns(Mathlib.Order) and external) except decl(Mathlib.Order)"), "ns Order (outside)");
  assert.equal(title("file(Mathlib.Order) and external"), "file Order (outside)");
});

test("conditions condensed, and a title kept short", () => {
  assert.equal(title("tcb(My.Real.Bounds.le_of_tendsto) except trusted"), "TCB of le_of_tendsto − trusted");
  assert.equal(title("tcb(My.Real.Bounds.le_of_tendsto) except external"), "TCB of le_of_tendsto − outside", "a board without the outside world says so");
  assert.equal(title("all except decl(My.Real.Bounds.helper)"), "everything − helper");
  assert.equal(title("ns(My.Real.Bounds) and kind(theorem, def)"), "ns Bounds, only theorems or defs");
  assert.equal(title("ns(My.Real.Bounds) and status(stale)"), "ns Bounds, only stale");
  assert.equal(title("tcb(My.Real.Exp.main) and ns(My.Real.Bounds)"), "TCB of Exp.main in ns Bounds");
  assert.equal(title("tcb(My.Real.Exp.main) and sorry"), "TCB of Exp.main, only with sorry");
  assert.equal(title("tcb(My.Real.Exp.main) except (trusted or external)"), "TCB of Exp.main − (trusted + outside world)");
  // conditions that do not fit are said by an ellipsis; nothing is longer than TITLE_MAX
  const long = title("tcb(My.Real.Bounds.le_of_tendsto) except trusted except external and kind(theorem) and status(unreviewed) except decl(My.Real.Bounds.helper)");
  assert.ok(long.length <= TITLE_MAX && long.endsWith(" …"), long);
  assert.ok(long.startsWith("TCB of le_of_tendsto − trusted − outside"), long);
  const huge = scopeTitle(parseQuery(`decl(${"VeryLong".repeat(20)})`));
  assert.ok(huge.length <= TITLE_MAX && huge.endsWith("…"));
  // without the graph's names, each name by its last part
  assert.equal(viewTitle({ id: "v1", name: null, scope: parseQuery("tcb(ns(My.Real) except external)") }), "TCB of ns Real");
});

test("a name people gave never changes; the Project; a target's view by its scope; a past build briefly; the description in full", () => {
  assert.equal(viewTitle({ id: "v1", name: "my reading list", scope: parseQuery("tcb(ns(My.Real) except external)") }, { names: N }), "my reading list");
  assert.equal(viewTitle({ id: "v1", name: "Project · Oct 9, 22:27 (2)", scope: parseQuery("all"), version: 3 }, { names: N }), "Project · Oct 9, 22:27 (2)", "a name made before stays as it was");
  assert.equal(viewTitle({ id: PROJECT, name: null, scope: parseQuery("all") }), "Project");
  // a view linked to a target is titled as any view (the owner's decision of 2026-10-12), the ★
  // beside it: one marking made before, on the review set, and a click's, on the TCB
  assert.equal(viewTitle({ id: "review:My.Real.Exp.main", name: null, targets: ["My.Real.Exp.main"], scope: reviewScope("My.Real.Exp.main") }, { names: N }), "review ★Exp.main");
  assert.equal(viewTitle({ id: "v2", name: null, targets: ["My.Real.Exp.main"], scope: parseQuery("tcb(My.Real.Exp.main)") }, { names: N }), "TCB of Exp.main");
  // a view nobody named, kept at a build (made from a board of a past build): the build briefly, or
  // its number where the build is not known
  assert.equal(title("tcb(ns(My.Real.Bounds) except external)", { version: 4 }, () => "Oct 9 22:27"), "TCB of ns Bounds @ Oct 9 22:27");
  assert.equal(title("tcb(ns(My.Real.Bounds) except external)", { version: 4 }), "TCB of ns Bounds @ build 4");
  assert.ok(title("tcb(My.Real.Bounds.le_of_tendsto) except trusted except external and kind(theorem)", { version: 4 }, () => "Oct 9 22:27").length <= TITLE_MAX);
  // Save as new view: the title at that build, a build the name ended with replaced, and a number
  // only where another view has the name
  const none = new Set<string>();
  assert.equal(versionName("Project", "Oct 9 22:27", none), "Project @ Oct 9 22:27");
  assert.equal(versionName("Project", "Oct 9 22:27", new Set(["Project @ Oct 9 22:27"])), "Project @ Oct 9 22:27 (2)");
  assert.equal(versionName("Project @ Oct 9 22:27 (2)", "Oct 8 14:15", none), "Project @ Oct 8 14:15");
  assert.equal(versionName("Project · Oct 9, 22:27 (2)", "Oct 8 14:15", none), "Project @ Oct 8 14:15", "a name of the older form too");
  assert.equal(versionName("TCB of ns Bounds", "Oct 9 22:27", none), "TCB of ns Bounds @ Oct 9 22:27");
  assert.ok(versionName("x".repeat(80), "Oct 9 22:27", none).length <= TITLE_MAX);
  // a tab whose view the server forgot: by its query's text; text that cannot be read, as it is
  assert.equal(titleOfScope("tcb(ns(My.Real.Bounds) except external)", { names: N }, 4), "TCB of ns Bounds @ build 4");
  assert.equal(titleOfScope("tcb(", { names: N }), "tcb(");
  // the description: the scope in full, as before
  assert.equal(viewDescription({ scope: parseQuery("tcb(ns(My.Real) except external)") }), "TCB of namespace My.Real except the outside world");
  assert.equal(viewDescription({ scope: parseQuery("tcb(My.Real.Exp.main) except trusted") }), "TCB of main, except what is trusted");
  // the exported document's title: the short title with a capital, a namespace in full
  assert.equal(docTitle({ id: "v1", name: null, scope: parseQuery("ns(My.Real.Bounds) except external") }, { names: N }), "Namespace Bounds");
  assert.equal(docTitle({ id: "v1", name: null, scope: parseQuery("tcb(ns(My.Real) except external)") }, { names: N }), "TCB of ns My.Real");
});
