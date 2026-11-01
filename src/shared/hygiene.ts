// Names Lean's macro hygiene makes. A macro that writes a declaration under a name of its own, not one
// the reader wrote — Mathlib's `irreducible_def X` writes the value as `definition` and the opaque
// constant holding it as `wrapped` — has Lean add macro scopes to it, so that it clashes with nothing:
// `Fixture.definition._@.Fixture.Tagged._hyg.3` (with `._hygCtx` before `._hyg` on newer toolchains).
// The extractor folds such constants into the declaration the command writes (ViewNode.also). The
// page says them by what the macro wrote (`definition`, `wrapped`), and never asks Lean about one:
// what it names cannot be written in Lean source, so no `#check` or `#print` reaches it
// (server/hover.ts, `isDeclName`, refuses it).

/** Whether a name carries macro scopes: one Lean's hygiene made. */
export function hygienic(name: string): boolean {
  return name.includes("._@.");
}

/** A name without its macro scopes: what the macro wrote (`Fixture.definition`), as Lean's
 *  `Name.eraseMacroScopes` reads it; any other name as it is. */
export function withoutMacroScopes(name: string): string {
  const k = name.indexOf("._@.");
  return k < 0 ? name : name.slice(0, k);
}
