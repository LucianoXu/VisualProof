// The exported document's settings (ExportSpec decision 7): every option a user can set, with its
// default, checked the same way wherever it comes from — the Export modal (web/src/exportmodal.ts),
// POST /api/export, the agents' endpoints. The modal sets the common ones; the rest keep their
// defaults. They are the document's style; what it holds is the view's (ExportSpec decision 12), and
// so are its title and its author line (decisions 14 and 15): no setting gives them.
// What a renderer does with them is its own business (shared/doc/latex.ts); the style file it loads
// can go further (ExportSpec.md, "Customising the style").

/** The document's settings. Every field has a default (DEFAULT_SETTINGS); a request may send any
 *  subset of them. */
export interface DocSettings {
  /** the paper size */
  paper: "a4" | "letter";
  /** the margins on every side, in millimetres (10–40) */
  margin: number;
  /** the text's size, in points */
  fontSize: 10 | 11 | 12;
  /** the code's size, in points (6–12, in halves) */
  codeSize: number;
  /** a table of contents after the head card, in two columns, the body following on the same page */
  contents: boolean;
}

export const DEFAULT_SETTINGS: Readonly<DocSettings> = Object.freeze({
  paper: "a4",
  margin: 22,
  fontSize: 11,
  codeSize: 8.5,
  contents: true,
});

/** Settings there were until 2026-10-08 (ExportSpec decision 7): the colour scheme, line numbers
 *  and the context (none is printed), and the key graph's figure (the document has none); until
 *  2026-10-09, the appendix (`supportIndex`: the document has none), and the title and the author
 *  line (`title`, `author`: the view's title and the people who left a trace on it, decisions 14 and
 *  15). A request that sends one is taken as before and the setting ignored, so that a page or an
 *  agent made earlier still exports. */
export const RETIRED_SETTINGS: readonly string[] = ["scheme", "lineNumbers", "context", "figure", "supportIndex", "title", "author"];

/** What each setting is, for the agents' index and the docs. */
export const SETTINGS_HELP: Record<keyof DocSettings, string> = {
  paper: "a4 | letter",
  margin: "millimetres on every side, 10–40",
  fontSize: "the text's size in points: 10, 11 or 12",
  codeSize: "the code's size in points, 6–12 in steps of 0.5",
  contents: "true: a table of contents after the head card, in two columns (the sections, and the declarations where the document is short), the body following on the same page",
};

/** The settings a request asks for, over the defaults; or why they cannot be had. Unknown fields
 *  are refused, so that a misspelt option is said rather than ignored; a retired one is ignored. */
export function readSettings(raw: unknown): { settings: DocSettings } | { error: string } {
  if (raw === undefined || raw === null) return { settings: { ...DEFAULT_SETTINGS } };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "settings is an object of options" };
  const o = raw as Record<string, unknown>;
  const s: DocSettings = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(o)) {
    if (RETIRED_SETTINGS.includes(k)) continue;
    if (!Object.hasOwn(DEFAULT_SETTINGS, k)) return { error: `${k} is not a setting (${Object.keys(DEFAULT_SETTINGS).join(", ")})` };
    if (v === undefined) continue;
    switch (k as keyof DocSettings) {
      case "paper":
        if (v !== "a4" && v !== "letter") return { error: "paper is a4 or letter" };
        s.paper = v;
        break;
      case "margin":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 10 || v > 40) return { error: "margin is in millimetres, 10–40" };
        s.margin = Math.round(v);
        break;
      case "fontSize":
        if (v !== 10 && v !== 11 && v !== 12) return { error: "fontSize is 10, 11 or 12" };
        s.fontSize = v;
        break;
      case "codeSize":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 6 || v > 12) return { error: "codeSize is in points, 6–12" };
        s.codeSize = Math.round(v * 2) / 2;
        break;
      case "contents":
        if (typeof v !== "boolean") return { error: `${k} is true or false` };
        s.contents = v;
        break;
    }
  }
  return { settings: s };
}
