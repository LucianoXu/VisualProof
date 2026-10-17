// The showcase's story: three people reviewing what flt-regular's main theorem says, over six weeks
// and three builds of the project, with Alice's AI assistant beside them. generate.ts plays it
// against a real server, one build after another, on the story's clock: what the site holds is what
// the server recorded, as it would have been recorded had they done it through the page.
//
// Alice, Bob and Charlie are fictional, and so are their words. The mathematics, the Lean names and
// the builds are flt-regular's (project.json): the declarations that change from one build to the
// next, and so the opinions that go stale, are the project's own.
//
// Times are the reviewers' local time (CEST). The story stops in the middle of the work: one
// comment is still open, two approvals are stale, and some of the review sets are not read yet.

import type { Stage } from "./generate.ts";

/** Every part of Mathlib this project uses, except its number theory: the trusted list Bob sets, so
 *  that the definitions the statement means come into the review. */
const MATHLIB_BUT_NUMBER_THEORY = [
  "Mathlib.Algebra",
  "Mathlib.Analysis",
  "Mathlib.Basic",
  "Mathlib.Data",
  "Mathlib.FieldTheory",
  "Mathlib.GroupTheory",
  "Mathlib.LinearAlgebra",
  "Mathlib.Logic",
  "Mathlib.Order",
  "Mathlib.RepresentationTheory",
  "Mathlib.RingTheory",
  "Mathlib.SetTheory",
  "Mathlib.Tactic",
  "Mathlib.Util",
];

const KUMMER = "eq_pow_prime_of_unit_of_congruent";
const KUMMER2 = "exists_pow_eq_of_zeta_sub_one_pow_dvd_sub_one";
const HILBERT94 = "dvd_card_classGroup_of_unramified_isCyclic";

export async function story(s: Stage): Promise<void> {
  const alice = s.person("Alice");
  const bob = s.person("Bob");
  const charlie = s.person("Charlie");
  const ai = s.agent("Alice's AI");

  // ── Build 1: faae830, Lean v4.34.0-rc2 ────────────────────────────────────────────────────────
  await s.build(0, "2026-09-07 08:55");

  await s.at("2026-09-07 09:10");
  await alice.target("flt_regular");
  await s.at("2026-09-07 09:16");
  const plan = await alice.upload("review-plan", "Review plan: FLT for regular primes");
  await alice.note("**Start here.** What we review, what we trust, who reads what: the review plan.", { decl: "flt_regular", carries: [{ file: plan }], open: true });
  await alice.link("decl(flt_regular)", plan, { page: 1, quote: "has no solution in nonzero integers", label: "Review plan, §1" });
  await s.at("2026-09-07 09:24");
  const statementView = await alice.view("flt_regular: what the statement means", "tcb(flt_regular)");
  await alice.linkView(statementView, "flt_regular");

  await s.at("2026-09-07 09:41");
  await alice.opinion("IsRegularPrime", "approve", "`IsRegularPrime p` is `IsRegularNumber p` and nothing more: the name the theorem uses for primes.");

  await s.at("2026-09-07 10:05");
  const aiOnRegular = await ai.advise(
    "IsRegularNumber",
    "approve",
    "For a prime `p` this is Kummer's regularity: `p` does not divide the class number of ℚ(ζ_p), written as `p` coprime to the cardinality of the class group of `𝓞 (CyclotomicField p ℚ)`, which for a prime is the same thing.\n\nThe definition is made for every `n`; for composite `n` it is not a notion the literature uses, so it is worth checking that nothing states anything with it at a composite `n`.",
  );

  await s.at("2026-09-07 11:32");
  await bob.trust("Mathlib", false);
  for (const prefix of MATHLIB_BUT_NUMBER_THEORY) await bob.trust(prefix, true);
  const trustNote = await bob.note(
    "**Mathlib.NumberTheory is no longer trusted.** Everything else of Mathlib this project uses still is. The statement means what these definitions say, so we read them: as definitions, not as Mathlib's API.",
    { decl: "FermatLastTheoremFor" },
  );

  await s.at("2026-09-08 09:28");
  await charlie.target(KUMMER);
  const notes = await charlie.upload("kummer-notes", "Kummer's lemma in flt-regular: reading notes");
  await charlie.note("My reading notes on Kummer's lemma: §1 says what to check before approving it.", {
    decl: KUMMER,
    carries: [{ file: notes, page: 1, region: [0.1, 0.27, 0.9, 0.5] }],
  });
  await charlie.link(`decl(${KUMMER})`, notes, { page: 1, quote: "Kummer's lemma.", label: "Reading notes, §1" });
  await s.at("2026-09-08 10:12");
  const kummerView = await charlie.view(
    "Kummer's lemma: the class-group side",
    `file(FltRegular.NumberTheory.KummersLemma) or file(FltRegular.NumberTheory.Hilbert94) or file(FltRegular.NumberTheory.Hilbert92) or tcb(${KUMMER})`,
    { clustering: "module" },
  );
  await charlie.linkView(kummerView, KUMMER);

  await s.at("2026-09-08 11:04");
  await charlie.opinion(KUMMER2, "approve", "The second form, checked against my notes, §2: from `(ζ - 1) ^ p ∣ u - 1` a `p`-th root of `u` in `K`. Not yet a unit, as the notes say.");
  await s.at("2026-09-08 11:20");
  const charlieAsks = await charlie.opinion(
    "IsRegularNumber",
    "comment",
    "Defined for every `n`: `n.Coprime (Fintype.card (ClassGroup (𝓞 (CyclotomicField n ℚ))))`. For a prime this is Kummer's regularity. For composite `n` it is not the usual notion. Is anything stated for a composite `n`?",
  );
  await s.at("2026-09-08 11:46");
  await ai.link(`decl(${KUMMER2})`, notes, { page: 1, quote: "The second form", label: "Reading notes, §2" });

  await s.at("2026-09-08 14:05");
  await alice.opinion(
    "IsRegularNumber",
    "approve",
    `${s.quote("IsRegularNumber", charlieAsks)}\n\nNo: only \`IsRegularPrime\` uses it in a statement or a definition; elsewhere it is unfolded inside proofs. Nothing reaching \`flt_regular\` sees a composite \`n\`. The same point as\n\n${s.quote("IsRegularNumber", aiOnRegular)}`,
  );

  await s.at("2026-09-09 10:15");
  await bob.opinion(
    "FermatLastTheoremFor",
    "approve",
    "`FermatLastTheoremFor n` is `FermatLastTheoremWith ℕ n`: there are no nonzero naturals `a`, `b`, `c` with `a ^ n + b ^ n = c ^ n`. Over ℕ, not ℤ; for odd `n` the two are equivalent (a negative term moves across), and the proof itself goes to ℤ with `fermatLastTheoremFor_iff_int`. The classical statement.",
  );
  await s.at("2026-09-09 10:31");
  await bob.opinion("NumberField.RingOfIntegers", "approve", "`𝓞 K` is `integralClosure ℤ K` as a type: the algebraic integers of `K`. What the notation should mean.");

  await s.at("2026-09-10 16:20");
  await charlie.opinion(
    "CyclotomicField",
    "approve",
    "`CyclotomicField n K` is the splitting field of `cyclotomic n K`. For `K = ℚ` and `n ≥ 1` that is ℚ(ζ_n), as it should be; `n = 0` is a degenerate convention nothing here uses.",
  );
  await s.at("2026-09-10 16:48");
  await charlie.opinion(
    KUMMER,
    "approve",
    "Kummer's lemma as stated in my notes, §1. Regularity is assumed for `K` itself, `p.Coprime (Fintype.card (ClassGroup (𝓞 K)))`, not as `IsRegularPrime p`: the same thing, since every `p`-th cyclotomic field over ℚ is isomorphic to `CyclotomicField p ℚ` and the class number does not change. The congruence is divisibility by `p` in `𝓞 K`.",
  );

  await s.at("2026-09-11 09:02");
  await alice.opinion("flt_regular", "approve", "Kummer's theorem: `p` prime (`Fact p.Prime`), regular, odd. Nothing else is assumed, and the conclusion is Mathlib's `FermatLastTheoremFor p`.");

  await s.at("2026-09-14 15:37");
  await bob.opinion(
    "NumberField.instCommRingRingOfIntegers",
    "comment",
    "An instance: the ring structure `𝓞 K` gets from being a subalgebra. There is nothing to judge but that it is that one; I will read it together with `CyclotomicField.instField` before approving.",
  );

  await s.at("2026-09-15 18:10");
  await ai.advise(
    HILBERT94,
    "approve",
    "Hilbert's Theorem 94 for an odd prime degree: `L/K` Galois with a cyclic group, unramified at every finite prime (`Algebra.Unramified (𝓞 K) (𝓞 L)`), `[L : K]` prime and not 2; then `[L : K]` divides the class number of `K`. Ramification at the infinite places is not assumed away, but for an odd degree there is none, so the classical hypothesis holds.",
  );
  await s.at("2026-09-16 11:25");
  await charlie.opinion(
    "Hilbert92",
    "approve",
    "Hilbert's Theorem 92: for `K/k` cyclic of odd prime degree with generator `σ`, a unit `η` of norm 1 that is not `ε / σ ε` for any unit `ε`. The statement is the theorem; Theorem 94 is proved from it.",
  );

  // the meeting, at one screen: Alice records for the others what they say there
  await s.at("2026-09-17 10:40");
  const minutes = await alice.upload("meeting-0917", "Review meeting, 17 September 2026: minutes");
  const minutesNote = await alice.note("Minutes of the meeting of 17 September: the trusted list, `IsRegularNumber`, the key declarations.", { carries: [{ file: minutes }] });
  await alice.link("decl(IsRegularNumber)", minutes, { page: 1, quote: "Charlie approved it at the meeting", label: "Meeting of 17 September" });
  await s.at("2026-09-17 10:52");
  await alice.opinion("IsRegularNumber", "approve", "Approved at the meeting: only `IsRegularPrime` reaches the main theorem, and for a prime the definition is Kummer's.", { for: "Charlie" });
  await s.at("2026-09-17 11:05");
  await alice.opinion("flt_regular", "approve", "Approved at the meeting.", { for: "Bob" });
  await s.at("2026-09-17 11:12");
  await alice.key("flt_regular", "FermatLastTheoremFor");
  await alice.key("flt_regular", "IsRegularPrime");

  // ── Build 2: 91d8f19, Lean v4.35.0-rc2 and a new Mathlib ──────────────────────────────────────
  await s.build(1, "2026-09-23 08:50");

  await s.at("2026-09-23 09:18");
  const buildNote = await ai.note(
    "**The build of 22 September** (`91d8f19`, the bump to Lean v4.35.0-rc2): 77 declarations have a new version, 38 of them here in `Hilbert92`. Mathlib moved underneath them; their texts barely changed. In the review: Charlie's approvals of `Hilbert92` and `exists_pow_eq_of_zeta_sub_one_pow_dvd_sub_one` are stale. Nothing of `flt_regular`'s review set changed.",
    { decl: "Hilbert92", open: false },
  );
  await s.at("2026-09-23 09:44");
  await bob.view("Hilbert92 at faae830, before the bump", "file(FltRegular.NumberTheory.Hilbert92)", { clustering: "module", version: s.snapshot(0) });

  await s.at("2026-09-24 10:02");
  await charlie.opinion("Hilbert92", "approve", "Stale only because Mathlib moved underneath: What changed shows the same text. Approved again.");

  await s.at("2026-09-24 14:30");
  await bob.target("FltRegular.caseII");
  const caseIIView = await bob.view("Case II", "file(FltRegular.CaseII) or tcb(FltRegular.caseII)", { clustering: "module" });
  await bob.linkView(caseIIView, "FltRegular.caseII");
  await s.at("2026-09-24 15:12");
  await bob.opinion(
    "FltRegular.caseII",
    "approve",
    "Case II as stated: `p` an odd regular prime, `a * b * c ≠ 0`, the gcd of `a`, `b`, `c` is 1, and `p ∣ a * b * c`. The gcd hypothesis costs nothing: `flt_regular` reduces to coprime integers first (`fermatLastTheoremWith_of_fermatLastTheoremWith_coprime`).",
  );
  await s.at("2026-09-25 11:40");
  await bob.opinion(
    "exists_not_dvd_spanSingleton_eq",
    "approve",
    "A fact about Dedekind domains that case II needs: if `I / J` is principal and the prime `x` divides neither `I` nor `J`, its generator can be taken as `a / b` with `x` dividing neither `a` nor `b`. Stated as it should be.",
  );
  await s.at("2026-09-29 17:05");
  await bob.opinion("CyclotomicField.instField", "approve", "The field structure of the splitting field, nothing else.");

  // Alice asks her AI for a view made to be printed: Export → Document turns it into a PDF
  await s.at("2026-10-01 14:20");
  const print = await ai.view(
    "Fermat's Last Theorem for regular primes: the statement and its steps",
    `tcb(flt_regular) or decl(FltRegular.caseI, FltRegular.caseII, ${KUMMER}, ${HILBERT94}, Hilbert92) except external`,
    { clustering: "module" },
  );
  await ai.arrange(print, { hide: ["FltRegular"] });
  // the board is the document's outline, read from the bottom: the foundations, then case I, case
  // II and the theorem, the introduction above them all
  const nt = (await ai.board(print)).find((c) => c.key === "FltRegular.NumberTheory")!;
  const [x, top] = [nt.at[0], nt.at[1] - nt.r];
  await ai.arrange(print, {
    pins: [
      { cluster: "FltRegular.CaseI.Statement", at: [x - 25, top - 25] },
      { cluster: "FltRegular.CaseII.Statement", at: [x + 20, top - 45] },
      { cluster: "FltRegular.FltRegular", at: [x - 5, top - 85] },
    ],
  });
  // the review's working notes are not the document's prose
  await ai.items(print, { remove: [trustNote, minutesNote, buildNote] });
  await ai.note(
    "This document prints what `flt_regular` says and the statements of the steps of its proof. Proofs are not printed: Lean checked them. Definitions are printed whole, since the statement means what they say. The Mathlib definitions underneath are not printed; the review read them on the view *flt_regular: what the statement means*.",
    { view: print, at: [x, top - 130], open: true },
  );
  await ai.note("Kummer's lemma is where regularity is used: through Hilbert's Theorem 94, a unit that is not a p-th power would give an unramified cyclic extension of degree p, and so p would divide the class number.", {
    view: print,
    name: KUMMER,
    open: true,
  });
  await s.at("2026-10-02 09:30");
  await charlie.note("How Theorem 94 enters the proof of Kummer's lemma: my notes, §3.", {
    decl: HILBERT94,
    carries: [{ file: notes, page: 1, region: [0.1, 0.83, 0.9, 0.97] }],
  });

  // ── Build 3: b8a5f23, Lean v4.35.0 ───────────────────────────────────────────────────────────
  await s.build(2, "2026-10-14 08:45");

  await s.at("2026-10-14 09:26");
  await ai.advise(
    "exists_not_dvd_spanSingleton_eq",
    "approve",
    "New version since the build of 13 October: Mathlib made `FractionalIdeal.spanSingleton` a bundled map, which the statement now applies through a coercion. It means what it did. In the text only the proof changed (`spanSingleton_zero` left its `simp only`). Bob's approval is on the earlier version.",
  );
  await ai.note("Bob: your approval here went stale with the build of 13 October. What changed is one line of the proof; the statement reads the same.", {
    decl: "exists_not_dvd_spanSingleton_eq",
    open: true,
  });

  await s.at("2026-10-15 10:12");
  await alice.opinion("NumberField.instCommRingRingOfIntegers", "approve", "It is the subalgebra's ring structure, as Bob says; approving it from my side.");
}
