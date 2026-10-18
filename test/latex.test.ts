// The exported document as LaTeX (shared/doc/latex.ts) and its compilation (server/export.ts):
// nothing that reaches the .tex can act as LaTeX — hostile names, comments, code and headings print
// as written — and a small document typesets with XeLaTeX, Lean's Unicode included, its runs cached
// and its temporary directories gone; its sections numbered three levels deep, a paragraph-level
// heading below; its contents in two columns, the body following on the first page; the head card
// saying what the view holds from outside the project. The compile is skipped where XeLaTeX is not
// installed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { tokenizeLean, tokenLines } from "../src/shared/lexer.ts";
import { DOC_VERSION } from "../src/shared/doc/model.ts";
import type { CodeBlock, CodeToken, DeclEntry, DocModel, Item, Section } from "../src/shared/doc/model.ts";
import { DEFAULT_SETTINGS } from "../src/shared/doc/settings.ts";
import { anchor, escapeLatex, escapeName, escapeVerbatim, renderLatex } from "../src/shared/doc/latex.ts";
import { crc32, Exporter, pagesOf, README, rerun, zip } from "../src/server/export.ts";

const HOSTILE = ["\\input{/etc/passwd}", "\\write18{rm -rf /}", "\\catcode`\\@=11", "}{\\end{document}", "%", "#1", "$x$", "^^5c^^5cinput", "~", "a\u0000b\u0007c\u001bd", "\\csname foo\\endcsname"];

/** Whether `tex` holds, outside the document's own macros, a command a reader wrote: every
 *  backslash in it must start one of the macros VisualProof writes, or an escape it uses. */
function strayCommands(tex: string): string[] {
  const ours = /^\\(vp[A-Za-z]+|begin|end|item|emph|textbf|textbackslash|textasciicircum|textasciitilde|textasciigrave|definecolor|documentclass|usepackage|hypersetup|\\|[{}$&#%_,])/;
  const out: string[] = [];
  for (let i = tex.indexOf("\\"); i >= 0; i = tex.indexOf("\\", i + 1)) {
    const rest = tex.slice(i, i + 40);
    if (!ours.test(rest)) out.push(rest);
    // `\\` is one escape: skip its second backslash
    if (rest.startsWith("\\\\")) i++;
  }
  return out;
}

test("prose is escaped: every character LaTeX gives a meaning to prints as itself", () => {
  assert.equal(escapeLatex("\\input{/etc/passwd}"), "\\textbackslash{}input\\{/etc/passwd\\}");
  assert.equal(escapeLatex("100% & #1 $x$ a_b ^ ~"), "100\\% \\& \\#1 \\$x\\$ a\\_b \\textasciicircum{} \\textasciitilde{}");
  assert.equal(escapeLatex("^^5c"), "\\textasciicircum{}\\textasciicircum{}5c", "no ^^ notation survives");
  assert.equal(escapeLatex("a\u0000b\u0007c\u001bd\u2028e"), "abcde", "control characters are dropped");
  assert.equal(escapeLatex("x\ny\tz"), "x y z", "a line break in a one-line text is a space");
  assert.equal(escapeLatex("a -- b ``c''"), "a -{}- b \\textasciigrave{}\\textasciigrave{}c''", "no dash or quote ligature changes the text");
  // what Libertinus lacks is set in JuliaMono, runs of it at once; quotes and dashes stay
  assert.equal(escapeLatex("⟪x⟫ ∀ n : ℕ, a ⊗ b"), "\\vpSym{⟪}x\\vpSym{⟫} \\vpSym{∀} n : \\vpSym{ℕ}, a \\vpSym{⊗} b");
  assert.equal(escapeLatex("“quoted” — dash"), "“quoted” — dash");
  assert.equal(escapeLatex("→↦"), "\\vpSym{→↦}");
  for (const h of HOSTILE) assert.deepEqual(strayCommands(escapeLatex(h)), [], h);
  // a name breaks after its dots, each part escaped
  assert.equal(escapeName("A.b_c.«x y»"), "A.\\vpBreak{}b\\_c.\\vpBreak{}«x y»");
  // anchors are letters, digits and hyphens under a prefix, whatever the id
  assert.match(anchor("d1}\\x{"), /^vp:[A-Za-z0-9.:-]+$/);
  assert.notEqual(anchor("a.b"), anchor("a-b"));
});

test("code is escaped for Verbatim with \\ { } as command characters", () => {
  assert.equal(escapeVerbatim("\\input{/etc/passwd}"), "\\vpBS{}input\\vpLB{}/etc/passwd\\vpRB{}");
  assert.equal(escapeVerbatim("a\tb"), "a  b");
  assert.equal(escapeVerbatim("a\u0000\u0007b\rc"), "abc");
  // what Verbatim prints as it is stays: % # $ ^ ~ and Lean's Unicode
  assert.equal(escapeVerbatim("% # $ ^^5c ~ ⟪ ⟫ ℕ ∀ ⊗"), "% # $ ^^5c ~ ⟪ ⟫ ℕ ∀ ⊗");
  for (const h of HOSTILE) assert.ok(!/\\(?!vp(BS|LB|RB)\{\})/.test(escapeVerbatim(h)), h);
});

/** A code block as the builder makes it: the tokens of shared/lexer.ts, line by line. */
function codeOf(src: string, proofElided = false): CodeBlock {
  const lines = tokenLines(tokenizeLean(src)).map((l) => l.map((t): CodeToken => [t.kind, t.text]));
  if (proofElided) lines[lines.length - 1].push(["text", " "], ["elided", ":= …"]);
  return { lines, proofElided, from: "source" };
}

/** A small document: a declaration in no section, sections three levels deep and a fourth and
 *  fifth below them (paragraph-level headings, unnumbered), a theorem whose proof is left out, a
 *  definition with the proofs inside it left out where the pass found them and one where reading
 *  its text did, a docstring with code and emphasis, and hostile names, comments, code and headings
 *  everywhere a reader's text goes. */
function sample(): DocModel {
  const root: DeclEntry = {
    id: "Polynomial.Roots.Degree.root",
    name: "Polynomial.Roots.Degree.root",
    short: "root",
    kind: "def",
    module: "Polynomial.Roots.Degree",
    file: "Polynomial/Roots/Degree.lean",
    line: 41,
    doc: [
      { t: "p", inl: [{ t: "text", s: "The root multiset of " }, { t: "em", s: "Definition 2.3" }, { t: "text", s: ": the polynomial has " }, { t: "code", s: "⟪pk, c⟫ : ℕ → ℕ" }, { t: "text", s: " and " }, { t: "strong", s: "ends" }, { t: "text", s: " if \\input{/etc/passwd} 50% & #2." }] },
      { t: "code", code: codeOf("def guess (b : Bool) : ℕ := if b then 1 else 0 -- {braces} \\cmd") },
      { t: "list", items: [[{ t: "text", s: "one ∀ x" }], [{ t: "code", s: "two_{}" }]] },
    ],
    code: codeOf(
      "/-- The root, with `\\input{/etc/passwd}` in its docstring. -/\ndef root (p : Separable R) : Eval R ℕ := ⟪ p.coeff ⊗ degree ⟫ ∘ fun x ↦ x ≤ 3 ∧ ∑ i, f i\n  -- a very long comment line that goes on and on past the right margin of the page so that it has to be broken somewhere sensible, with \\write18{x}\n  \"a string with } and { and \\\\ inside\" ++ sorry",
    ),
  };
  const decl = (name: string, kind: string, code: CodeBlock): DeclEntry => ({ ...root, id: name, name, short: name.split(".").pop()!, kind, doc: null, code });
  const adversary: DeclEntry = {
    ...decl("Polynomial.Roots.Separable", "structure", codeOf("structure Separable (R : Ring) where\n  coeff : R.carrier → R.carrier")),
    line: 12,
    doc: [{ t: "p", inl: [{ t: "text", s: "A polynomial: } \\catcode`\\@=11 {" }] }],
  };
  const lawful = decl("Polynomial.Roots.instMonoid", "instance", {
    lines: [
      [["keyword", "instance"], ["text", " : "], ["type", "Lawful"], ["text", " "], ["type", "Nat"], ["text", " "], ["keyword", "where"]],
      [["text", "  "], ["ident", "op_assoc"], ["text", " := "], ["elided", "…"]],
      [["text", "  "], ["ident", "op_comm"], ["text", " := "], ["elided", "…"], ["text", " "], ["comment", "-- stays"]],
      [["text", "  "], ["ident", "op_zero"], ["text", " := "], ["number", "0"]],
    ],
    proofElided: false,
    from: "source",
    proofsCut: 2,
  });
  const edited = decl("Polynomial.Roots.edited", "def", {
    lines: [[["keyword", "def"], ["text", " "], ["ident", "edited"], ["text", " (n : "], ["type", "Nat"], ["text", ") : "], ["type", "Fin"], ["text", " 5 := ⟨0, "], ["elided", "…"], ["text", "⟩"]]],
    proofElided: false,
    from: "edited",
    proofsCut: 1,
    textCut: "edited",
  });
  const target = { ...decl("Polynomial.Algebra.Monic.monic_roots", "theorem", codeOf("theorem monic_roots (p : Separable R) :\n    card (root p) ≤ 2 * q * ε", true)), line: 90 };
  const hostile = decl("Polynomial.«added}\\input{x}»", "def", codeOf("def «added}\\input{x}» := 0"));
  const deep = decl("Polynomial.Eval.Map.Proof.Invariant.Step.inv", "theorem", codeOf("theorem inv : True", true));
  const sec = (key: string, title: string, level: number, decls: DeclEntry[], sections: Section[] = []): Section => ({ id: `section:${key}`, key, title, level, items: items(decls, sections) });
  return {
    version: DOC_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    view: { id: "v1", title: "key declarations of monic_roots", scope: "key(Polynomial.Algebra.Monic.monic_roots)", clustering: "namespace", hidden: ["Polynomial"] },
    head: {
      title: "mathlib: key declarations of 100% {hostile} #titles",
      author: "Alice & Bob \\input{x}",
      project: "mathlib_}",
      roots: ["Polynomial"],
      fingerprint: "55f2cfb7deadbeef",
      commit: { hash: "e404003", branch: "main" },
      toolchain: "leanprover/lean4:v4.33.1",
      past: null,
      trusted: { prefixes: ["Batteries", "Init", "Lean", "Mathlib", "Std", "@external"], standardAxioms: ["Classical.choice", "Quot.sound", "propext"] },
      outside: { count: 300, by: [{ name: "Mathlib", count: 203 }, { name: "Init", count: 97 }] },
    },
    items: items([hostile], [
      sec("Polynomial.Roots", "Roots}\\x{", 1, [root, adversary, lawful, edited]),
      sec("Polynomial.Algebra", "Algebra", 1, [], [sec("Polynomial.Algebra.Monic", "Monic", 2, [target])]),
      sec("Polynomial.Eval", "Eval", 1, [], [
        sec("Polynomial.Eval.Map", "Map", 2, [], [
          sec("Polynomial.Eval.Map.Proof", "Proof", 3, [], [
            sec("Polynomial.Eval.Map.Proof.Invariant", "Invariant", 4, [], [sec("Polynomial.Eval.Map.Proof.Invariant.Step", "Invariant.Step", 4, [deep])]),
          ]),
        ]),
      ]),
    ]),
    count: { declarations: 7, sections: 8, notes: 0 },
  };
}

/** Declarations then sections, as a document's or a section's items. */
const items = (decls: DeclEntry[], sections: Section[] = []): Item[] => [...decls.map((decl): Item => ({ t: "decl", decl })), ...sections.map((section): Item => ({ t: "section", section }))];

test("a whole document: semantic macros only, nothing a reader wrote acts as LaTeX", () => {
  const tex = renderLatex(sample());
  assert.match(tex, /\\documentclass\[11pt\]\{article\}\n\\usepackage\{visualproof\}/);
  assert.match(tex, /\\vpSetup\{paper=a4, margin=22mm, codesize=8.5pt\}/);
  assert.match(tex, /\\definecolor\{vpTkkeyword\}\{HTML\}\{AD3DA4\}/, "the code's palette, as the page has it");
  // no figure, no part of a target, no appendix, nothing of the review
  for (const no of ["vpFigure", "\\vpNode", "\\vpEdge", "vpLegend", "{vpK", "tikz", "\\vpPart", "\\vpAppendix", "\\vpIndex", "\\vpMembers", "\\vpSeeAlso", "\\vpIncluded", "\\vpKeyFor"]) assert.ok(!tex.includes(no), no);
  assert.deepEqual(strayCommands(tex), [], "every command is the document's own");
  for (const h of ["\\input{", "\\write18", "\\catcode", "\\csname"]) assert.ok(!tex.includes(h), h);
  assert.equal(tex.split("\\end{document}").length, 2, "the document ends once");
  // a theorem's proof is the builder's to leave out; what stands for it is printed as an omission
  assert.match(tex, /\\vpTkElided\{:=\} \\vpTkElided\{…\}/);
  // so are the proofs inside a definition, however they were found: the document does not say how;
  // no line is numbered
  assert.match(tex, /\\begin\{vpCode\}\n\\vpTkKeyword\{instance\}.*\n {2}op_assoc := \\vpTkElided\{…\}\n {2}op_comm := \\vpTkElided\{…\} \\vpTkComment\{--\} \\vpTkComment\{stays\}\n {2}op_zero/);
  assert.ok(tex.includes("\\vpTkKeyword{def} edited (n : \\vpTkType{Nat}) : \\vpTkType{Fin} 5 := ⟨0, \\vpTkElided{…}⟩\n\\end{vpCode}\n\\end{vpDecl}"));
  assert.ok(!tex.includes("vpValueElided") && !tex.includes("textCut"), "no word of how the proofs were found");
  for (const no of ["firstnumber", "numbers=", "\\vpLineNo", "vpContext"]) assert.ok(!tex.includes(no), no);
  // a declaration: its anchor, its short name, its kind as plain text, unnumbered
  assert.match(tex, /\\begin\{vpDecl\}\{vp:Polynomial\.2e\.Roots\.2e\.Degree\.2e\.root\}\{root\}\{def\}/);
  // what sits in no section comes first, under no heading; then the sections, each with its
  // number, title, the cluster's key, its bookmark's level and text
  assert.match(tex, /\\end\{vpContents\}\n\\vpBookmark\{vp:Polynomial\.2e\.\.ab\.added[^}]*\}\{0\}/);
  assert.match(tex, /\\vpSection\{vp:section\.3a\.Polynomial\.2e\.Roots\}\{1\}\{1\}\{Roots\\\}\\textbackslash\{\}x\\\{\}\{Polynomial\.\\vpBreak\{\}Roots\}\{0\}\{Roots x\}\n\\vpBookmark\{vp:Polynomial\.2e\.Roots\.2e\.Degree\.2e\.root\}\{1\}/);
  assert.match(tex, /\\vpSection\{[^}]*\}\{2\}\{2\.1\}\{Monic\}/);
  assert.match(tex, /\\vpSection\{[^}]*\}\{3\}\{3\.1\.1\}\{Proof\}/);
  // below the third level: paragraph-level headings, unnumbered, their bookmarks nested as deep as
  // the sections are
  // (a key's argument holds the \\vpBreak{} of each dot)
  const arg = String.raw`\{(?:[^{}]|\{\})*\}`;
  assert.match(tex, new RegExp(String.raw`\\vpSection${arg}\{4\}\{\}\{Invariant\}${arg}\{3\}`));
  assert.match(tex, new RegExp(String.raw`\\vpSection${arg}\{4\}\{\}\{Invariant\.Step\}${arg}\{4\}\{Invariant\.Step\}\n\\vpBookmark${arg}\{5\}`));
  // nothing says what a declaration rests on, nor is anything an explanation
  assert.ok(!/rests? on|vpRestsOn|vpPartIntro|vpExplanation|\\vpRef\{|\\vpPlainRef/i.test(tex));
  // the docstring is body text, escaped as everything a reader's text is
  assert.match(tex, /\\begin\{vpDocstring\}\nThe root multiset of \\emph\{Definition 2\.3\}/);
  // the paper and sizes
  const letter = renderLatex({ ...sample(), settings: { ...sample().settings, paper: "letter", fontSize: 10, codeSize: 9 } });
  assert.match(letter, /\\documentclass\[10pt\]/);
  assert.match(letter, /paper=letter, margin=22mm, codesize=9pt/);
  // every macro and environment the .tex uses is in the style file's interface
  const sty = readFileSync(join(import.meta.dirname, "..", "src", "assets", "latex", "visualproof.sty"), "utf8");
  const header = sty.slice(0, sty.indexOf("\\NeedsTeXFormat"));
  for (const m of new Set([...tex.matchAll(/\\(vp[A-Z][A-Za-z]*)/g)].map((x) => x[1]))) assert.ok(header.includes(`\\${m}`) || (header.includes(m) && /^vpTk/.test(m)), `${m} is in the interface`);
  for (const old of ["vpPart", "vpMembers", "vpIndexItem", "vpContentsPart"]) assert.ok(!sty.includes(old), `${old} is gone`);
  // the sources' README names macros of the interface, none gone
  const named = [...README.matchAll(/\\(?:begin\{)?(vp[A-Z][A-Za-z]*)/g)].map((x) => x[1]);
  assert.ok(named.length >= 3, README);
  for (const m of named) assert.ok(header.includes(m), `the README's ${m} is in the interface`);
});

test("the head card: the project, the build and its commit, the toolchain, the trusted boundary, what the view holds from outside; no time", () => {
  const tex = renderLatex(sample());
  const card = tex.slice(tex.indexOf("\\begin{vpCard}"), tex.indexOf("\\end{vpCard}"));
  const labels = [...card.matchAll(/\\vpCardRow\{([^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Project", "Build", "Commit", "Toolchain", "Trusted without review", "Standard axioms", "Also on this view"]);
  assert.match(card, /\\vpCardRow\{Build\}\{\\vpMono\{55f2cfb7deadbeef\}\}/);
  assert.match(card, /\\vpCardRow\{Commit\}\{\\vpMono\{e404003\} on \\vpMono\{main\}\}/);
  assert.match(card, /everything outside the project/);
  assert.match(card, /\\vpCardRow\{Also on this view\}\{300 declarations from outside the project \(Mathlib 203, Init 97\), not printed\}/);
  // the title says who made it, never when; nothing in the document is a time
  assert.match(tex, /\\vpTitle\{mathlib: key declarations of 100\\% \\\{hostile\\\} \\#titles\}\{Alice \\& Bob \\textbackslash\{\}input\\\{x\\\}\}\n/);
  assert.ok(!/\d{4}-\d\d-\d\d|UTC/.test(tex), "no date or time");
  // no commit known, nothing from outside: no row for either
  const s = sample();
  const none = renderLatex({ ...s, head: { ...s.head, commit: null, outside: { count: 0, by: [] } } });
  assert.ok(!none.includes("\\vpCardRow{Commit}") && !none.includes("Also on this view"));
  // counted in thousands, as the Export window counts them
  const large = renderLatex({ ...s, head: { ...s.head, outside: { count: 2640, by: [{ name: "Mathlib", count: 2210 }, { name: "Init", count: 430 }] } } });
  assert.match(large, /\{2,640 declarations from outside the project \(Mathlib 2,210, Init 430\), not printed\}/);
  // many libraries: the six largest named, the rest together
  const many = renderLatex({ ...s, head: { ...s.head, outside: { count: 8, by: "ABCDEFGH".split("").map((name) => ({ name, count: 1 })) } } });
  assert.match(many, /8 declarations from outside the project \(A 1, B 1, C 1, D 1, E 1, F 1, others 2\)/);
});

test("a past build's head card and a declaration whose text then is not kept: the style's own macros, everything escaped", () => {
  const s = sample();
  const hostile = (s.items[0] as Extract<Item, { t: "decl" }>).decl;
  const lost = { ...hostile, code: { ...hostile.code, from: "statement" as const, notKept: true as const } };
  const tex = renderLatex({
    ...s,
    head: { ...s.head, commit: { hash: "fb28396d1e2c", branch: "main_}", dirty: true }, past: { snapshot: 2, at: "2026-10-09T20:27:00.000Z", when: "Oct 9, 2026, 22:27 (UTC+2) {x}", places: 550, notKept: 3 } },
    items: [{ t: "decl", decl: lost }],
  });
  const card = tex.slice(tex.indexOf("\\begin{vpCard}"), tex.indexOf("\\end{vpCard}"));
  const labels = [...card.matchAll(/\\vpCardRow\{([^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Project", "Build", "Commit", "Source text", "Toolchain", "Trusted without review", "Standard axioms", "Also on this view"]);
  assert.match(card, /\\vpCardRow\{Build\}\{Oct 9, 2026, 22:27 \(UTC\+2\) \\\{x\\\}\}/);
  assert.match(card, /\\vpCardRow\{Commit\}\{\\vpMono\{fb28396\} on \\vpMono\{main\\_\\\}\}, edited\}/);
  assert.match(card, /for 550 declarations matched to the build by the places it recorded, its hash not being kept; not kept for 3 declarations, whose statements are printed instead/);
  assert.match(tex, /\\end\{vpCode\}\n\\vpDeclNote\{Its source text at this build is not kept: printed is its statement, as the build recorded it\.\}\n\\end\{vpDecl\}/);
  assert.deepEqual(strayCommands(tex), [], "every command is the document's own");
  const sty = readFileSync(join(import.meta.dirname, "..", "src", "assets", "latex", "visualproof.sty"), "utf8");
  const header = sty.slice(0, sty.indexOf("\\NeedsTeXFormat"));
  for (const m of new Set([...tex.matchAll(/\\(vp[A-Z][A-Za-z]*)/g)].map((x) => x[1]))) assert.ok(header.includes(`\\${m}`) || (header.includes(m) && /^vpTk/.test(m)), `${m} is in the interface`);
  // an approximate build, a guessed commit
  const guessed = renderLatex({ ...s, head: { ...s.head, commit: { hash: "abc1234def", branch: null, guessed: true }, past: { snapshot: 1, at: "2026-10-08T13:15:00.000Z", when: "Oct 8, 2026, 15:15 (UTC+2)", approx: true, places: 0, notKept: 0 } } });
  assert.match(guessed, /\\vpCardRow\{Build\}\{about Oct 8, 2026, 15:15 \(UTC\+2\)\}/);
  assert.match(guessed, /\\vpCardRow\{Commit\}\{probably \\vpMono\{abc1234\}\}/);
  assert.match(guessed, /\\vpCardRow\{Source text\}\{as this build compiled it\}/);
});

test("the table of contents: the sections with their numbers, and the declarations where the document is short", () => {
  const tex = renderLatex(sample());
  const toc = tex.slice(tex.indexOf("\\begin{vpContents}"), tex.indexOf("\\end{vpContents}"));
  // right after the head card, and the body right after it: no page break anywhere the document
  // writes
  assert.match(tex, /\\end\{vpCard\}\n\\begin\{vpContents\}\n/);
  for (const no of ["\\clearpage", "\\newpage", "\\pagebreak", "\\twocolumn"]) assert.ok(!tex.includes(no), no);
  const lines = toc.split("\n").slice(1).filter(Boolean);
  const a = (id: string) => `vp:${id.replace(/\./g, ".2e.").replace(/:/g, ".3a.")}`;
  assert.deepEqual(lines.slice(0, 8), [
    `\\vpContentsDecl{${lines[0].match(/\{([^}]*)\}/)![1]}}{1}{«added\\}\\textbackslash{}input\\{x\\}»}`,
    `\\vpContentsSection{${a("section:Polynomial.Roots")}}{1}{1}{Roots\\}\\textbackslash{}x\\{}`,
    `\\vpContentsDecl{${a("Polynomial.Roots.Degree.root")}}{2}{root}`,
    `\\vpContentsDecl{${a("Polynomial.Roots.Separable")}}{2}{Separable}`,
    `\\vpContentsDecl{${a("Polynomial.Roots.instMonoid")}}{2}{instMonoid}`,
    `\\vpContentsDecl{${a("Polynomial.Roots.edited")}}{2}{edited}`,
    `\\vpContentsSection{${a("section:Polynomial.Algebra")}}{1}{2}{Algebra}`,
    `\\vpContentsSection{${a("section:Polynomial.Algebra.Monic")}}{2}{2.1}{Monic}`,
  ]);
  assert.ok(lines.includes(`\\vpContentsSection{${a("section:Polynomial.Eval.Map.Proof.Invariant.Step")}}{4}{}{Invariant.Step}`), "every level, where the document is short");
  // a long document lists the first three levels of sections alone
  const s = sample();
  const long = renderLatex({ ...s, count: { declarations: 500, sections: 8, notes: 0 } });
  const longToc = long.slice(long.indexOf("\\begin{vpContents}"), long.indexOf("\\end{vpContents}"));
  assert.ok(!longToc.includes("vpContentsDecl") && !longToc.includes("{4}{}{Invariant"));
  assert.match(longToc, /\{3\}\{3\.1\.1\}\{Proof\}/);
  // the style sets it in two columns, and lets the body follow it on its page
  const sty = readFileSync(join(import.meta.dirname, "..", "src", "assets", "latex", "visualproof.sty"), "utf8");
  const def = (macro: string) => sty.slice(sty.indexOf(macro), sty.indexOf("\n\n", sty.indexOf(macro)));
  assert.match(def("\\newenvironment{vpContents}"), /\\begin\{multicols\}\{2\}[^]*\\end\{multicols\}/);
  assert.ok(!/\\clearpage|\\newpage/.test(def("\\newenvironment{vpContents}")));
  assert.ok(!/\\clearpage|\\newpage/.test(def("\\newcommand\\vp@sectionbreak")) && def("\\newcommand\\vpSection[7]").includes("\\vp@sectionbreak"));
  // the setting leaves it out: the body follows the head card
  const without = renderLatex({ ...s, settings: { ...s.settings, contents: false } });
  assert.ok(!without.includes("vpContents"));
  assert.match(without, /\\end\{vpCard\}\n\\vpBookmark\{/);
});

test("the log of a run: pages written, and whether to run again", () => {
  assert.equal(pagesOf("…\nOutput written on doc.pdf (12 pages, 34567 bytes).\n"), 12);
  assert.equal(pagesOf("Output written on doc.pdf (1 page, 3456 bytes)."), 1);
  assert.equal(pagesOf("No pages of output."), null);
  assert.ok(rerun("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right."));
  assert.ok(rerun("LaTeX Warning: There were undefined references."));
  assert.ok(!rerun("Output written on doc.pdf (2 pages)."));
});

test("a zip of the sources reads back", (t) => {
  assert.equal(crc32(Buffer.from("The quick brown fox jumps over the lazy dog")), 0x414fa339);
  const z = zip([{ name: "a.txt", data: Buffer.from("hello ⟪ ⟫\n".repeat(50)) }, { name: "fonts/b.bin", data: Buffer.from([0, 1, 2, 255]) }]);
  if (spawnSync("unzip", ["-v"], { stdio: "ignore" }).status !== 0) return t.skip("unzip is not installed");
  const dir = mkdtempSync(join(tmpdir(), "vp-zip-"));
  try {
    writeFileSync(join(dir, "x.zip"), z);
    const r = spawnSync("unzip", ["-tq", join(dir, "x.zip")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const haveXelatex = spawnSync("xelatex", ["--version"], { stdio: "ignore" }).status === 0;
const state = mkdtempSync(join(tmpdir(), "vp-export-"));
after(() => rmSync(state, { recursive: true, force: true }));

test("a small document typesets with XeLaTeX, Lean's Unicode included; a second request is the same job", { skip: haveXelatex ? false : "xelatex is not installed" }, async () => {
  const ex = new Exporter(state, { timeoutMs: 120_000 });
  assert.ok(ex.available());
  const tex = renderLatex(sample());
  // what the export notes besides the document rides on its job
  const job = ex.compile(tex, ["The proofs inside 1 definition were found by reading the text."]);
  assert.equal(job.state, "running");
  assert.deepEqual(job.notes, ["The proofs inside 1 definition were found by reading the text."]);
  assert.equal(ex.compile(tex, job.notes), job, "the same document is the same job while it runs");
  const done = await ex.wait(job.id);
  assert.equal(done?.state, "done", `${done?.error}\n${done?.log}`);
  assert.equal(done?.notes?.length, 1);
  assert.ok((done?.pages ?? 0) >= 3, `pages: ${done?.pages}`);
  assert.ok((done?.runs ?? 0) >= 2, "a second run resolves the page references");
  const pdf = ex.file(job.id, "pdf");
  assert.ok(pdf && pdf.body.subarray(0, 5).toString() === "%PDF-");
  assert.equal(ex.file(job.id, "tex")?.body.toString("utf8"), tex);
  assert.match(ex.file(job.id, "sty")?.body.toString("utf8") ?? "", /\\ProvidesPackage\{visualproof\}/);
  const z = ex.file(job.id, "zip");
  assert.ok(z && z.body.readUInt32LE(0) === 0x04034b50);
  // the temporary directories are gone; the cache holds the document
  assert.deepEqual(readdirSync(join(state, "export")).filter((d) => d.startsWith("run-")), []);
  assert.ok(existsSync(join(state, "export", "cache", job.id, "doc.pdf")));
  // a server started afresh finds it in the cache, with its notes; a request asking for it again
  // says its own
  assert.deepEqual(new Exporter(state).job(job.id)?.notes, done?.notes);
  const again = new Exporter(state).compile(tex);
  assert.equal(again.state, "done");
  assert.equal(again.cached, true);
  assert.equal(again.notes, undefined);
});

const havePdftotext = spawnSync("pdftotext", ["-v"], { stdio: "ignore" }).status === 0;

test("the first page: the head card, the contents in two columns, and the body following on it", { skip: !haveXelatex ? "xelatex is not installed" : !havePdftotext && "pdftotext is not installed" }, async () => {
  const ex = new Exporter(state);
  /** the words of the typeset document's first page, each with where it starts, and the page's width */
  const firstPage = async (doc: DocModel) => {
    const job = await ex.wait(ex.compile(renderLatex(doc)).id);
    assert.equal(job?.state, "done", job?.error);
    const r = spawnSync("pdftotext", ["-f", "1", "-l", "1", "-bbox", "-", "-"], { input: ex.file(job!.id, "pdf")!.body, encoding: "utf8" });
    const width = Number(/<page width="([\d.]+)"/.exec(r.stdout)?.[1]);
    const words = [...r.stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
    return { width, words, text: words.map((w) => w.text).join(" ") };
  };
  const s = sample();
  const p1 = await firstPage(s);
  assert.match(p1.text, /Contents/);
  // the head card's row of what the view holds from outside the project (its labels come first in
  // pdftotext's order)
  assert.match(p1.text, /Also on this view .*300 declarations from outside the project \(Mathlib 203, Init 97\), not printed/);
  // the contents in two columns: a later section's line in the right one, beside the first's
  const at = (text: string) => p1.words.find((w) => w.text === text)!;
  assert.ok(at("Invariant.Step").x > p1.width / 2, "the last line is in the right column");
  assert.ok(at("root").x < p1.width / 2);
  assert.ok(Math.abs(at("Invariant.Step").y - at("root").y) < 80, "beside the first lines, not under them");
  // the body follows on the same page: the declaration in no section, then the first section's head
  // and its key, with no line of what it rests on
  const key = p1.words.find((w) => w.text === "Polynomial.Roots");
  assert.ok(key && key.y > at("Invariant.Step").y, p1.text);
  assert.doesNotMatch(p1.text, /rests on|Appendix/i);
  // without the contents, the body follows the head card
  const p2 = await firstPage({ ...s, settings: { ...s.settings, contents: false } });
  assert.doesNotMatch(p2.text, /Contents/);
  assert.match(p2.text, /not printed .*«added/);
});

test("a section's heading is kept with what follows it, its first subsection's heading too: never alone at the foot of a page", { skip: !haveXelatex ? "xelatex is not installed" : !havePdftotext && "pdftotext is not installed" }, async () => {
  // sections that hold a subsection first, each after a declaration of another length, so that
  // some of them come near the foot of a page
  const s = sample();
  const one = (s.items.find((x) => x.t === "section") as { section: Section }).section.items.find((x) => x.t === "decl") as { decl: DeclEntry };
  const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const groups: Section[] = [...L].map((c, i) => {
    const filler: DeclEntry = { ...one.decl, id: `F${c}.f`, name: `F${c}.f`, short: "f", doc: null, code: codeOf(Array.from({ length: 1 + ((i * 7) % 13) }, (_, k) => `def f${k} : Nat := ${k}`).join("\n")) };
    const inner: Section = { id: `section:G${c}.I`, key: `G${c}.I`, title: `Inner${c}${c}`, level: 2, items: [{ t: "decl", decl: filler }] };
    return { id: `section:G${c}`, key: `G${c}`, title: `Group${c}${c}`, level: 1, items: [{ t: "section", section: inner }] };
  });
  const doc: DocModel = { ...s, settings: { ...s.settings, contents: false }, items: groups.map((section): Item => ({ t: "section", section })) };
  const ex = new Exporter(state);
  const job = await ex.wait(ex.compile(renderLatex(doc)).id);
  assert.equal(job?.state, "done", job?.error);
  const pdf = ex.file(job!.id, "pdf")!.body;
  const pageOf = new Map<string, number>();
  for (let p = 1; p <= job!.pages!; p++) {
    const text = spawnSync("pdftotext", ["-f", String(p), "-l", String(p), "-", "-"], { input: pdf, encoding: "utf8" }).stdout;
    for (const m of text.matchAll(/(Group|Inner)([A-Z])\2/g)) if (!pageOf.has(m[0])) pageOf.set(m[0], p);
  }
  for (const c of L) assert.equal(pageOf.get(`Group${c}${c}`), pageOf.get(`Inner${c}${c}`), `Group${c}${c} and its first subsection on one page`);
});

test("the typeset document has every glyph: no character is missing from its fonts", { skip: haveXelatex ? false : "xelatex is not installed" }, async () => {
  // typeset by hand to read the log, which the exporter does not keep for a document that worked
  const dir = mkdtempSync(join(state, "glyphs-"));
  const ex = new Exporter(state);
  const tex = renderLatex(sample()).replace("\\end{document}", "\\vpInlineCode{⟪ ⟫ ℕ ∀ ⊗ → ≤ ∘ ↦ ∑ ⦃ ⦄ ≠ ⁻¹ ₁ 𝔽}\n\\end{document}");
  const job = await ex.wait(ex.compile(tex).id);
  assert.equal(job?.state, "done", job?.error);
  // the same run again where the log can be read
  writeFileSync(join(dir, "doc.tex"), tex);
  writeFileSync(join(dir, "visualproof.sty"), readFileSync(join(import.meta.dirname, "..", "src", "assets", "latex", "visualproof.sty")));
  spawnSync("ln", ["-s", join(import.meta.dirname, "..", "src", "assets", "fonts"), join(dir, "fonts")]);
  spawnSync("xelatex", ["-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "doc.tex"], { cwd: dir, stdio: "ignore", env: { ...process.env, openin_any: "p", openout_any: "p" } });
  const log = readFileSync(join(dir, "doc.log"), "utf8");
  assert.ok(!/Missing character/.test(log), log.split("\n").filter((l) => /Missing character/.test(l)).slice(0, 5).join("\n"));
  assert.ok(!/Overfull \\hbox \((\d{3,}|[5-9]\d)\./.test(log), "nothing sticks out of the page by more than 50pt");
});

test("a document that has left the cache (newer ones took its place) is typeset again when asked again, not answered with files that are gone", async () => {
  // a XeLaTeX of its own that writes a page at once, so that the cache's turnover is quick to see
  const dir = mkdtempSync(join(state, "turnover-"));
  const fake = join(dir, "xelatex");
  writeFileSync(fake, '#!/bin/sh\nprintf "%%PDF-1.4\\n" > doc.pdf\nprintf "Output written on doc.pdf (1 page, 9 bytes).\\n" > doc.log\n');
  chmodSync(fake, 0o755);
  const ex = new Exporter(dir, { xelatex: fake, maxCached: 1 });
  const a = await ex.wait(ex.compile("A").id);
  assert.equal(a?.state, "done", a?.error);
  // the newer document's files push the older's out of the cache
  utimesSync(join(dir, "export", "cache", a!.id), new Date(0), new Date(0));
  const b = await ex.wait(ex.compile("B").id);
  assert.equal(b?.state, "done", b?.error);
  assert.ok(!existsSync(join(dir, "export", "cache", a!.id)), "the older document has left the cache");
  assert.equal(ex.job(a!.id), null, "it is no longer known: its files are gone");
  assert.equal(ex.file(a!.id, "pdf"), null);
  // asked again, it is typeset again
  const again = ex.compile("A");
  assert.equal(again.id, a!.id);
  assert.equal(again.state, "running");
  assert.equal((await ex.wait(again.id))?.state, "done");
  assert.ok(ex.file(a!.id, "pdf")?.body.toString().startsWith("%PDF"));
});

test("a document that fails, or takes too long, says why; its temporary directory goes all the same", { skip: haveXelatex ? false : "xelatex is not installed" }, async () => {
  const dir = mkdtempSync(join(state, "fail-"));
  const ex = new Exporter(dir);
  const bad = await ex.wait(ex.compile("\\documentclass{article}\\begin{document}\\nosuchmacro\\end{document}\n").id);
  assert.equal(bad?.state, "failed");
  assert.match(bad?.error ?? "", /Undefined control sequence/);
  assert.match(bad?.log ?? "", /nosuchmacro/, "the end of the log, where the error is");
  assert.equal(ex.file(bad!.id, "pdf"), null);
  const hurried = new Exporter(dir, { timeoutMs: 1 });
  const slow = await hurried.wait(hurried.compile(renderLatex(sample())).id);
  assert.equal(slow?.state, "failed");
  assert.match(slow?.error ?? "", /longer than/);
  assert.deepEqual(readdirSync(join(dir, "export")).filter((d) => d.startsWith("run-")), []);
});
