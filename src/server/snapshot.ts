// `visualproof export`: the page, its code and its data in one HTML file that opens from disk.
// A snapshot is frozen: it shows the build it was taken from and never updates.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ViewMeta } from "../shared/graph.ts";
import type { ReviewData } from "../shared/review.ts";
import type { ModuleContexts } from "../shared/context.ts";
import { WEB, WEBFONTS, bundleDir } from "./pipeline.ts";
import type { Prepared } from "./pipeline.ts";
import type { ViewBook } from "../shared/views.ts";
import type { Project } from "./project.ts";
import { lakeTextHash } from "./status.ts";

/** Text that sits inside a <script> element must not close it. */
function scriptSafe(s: string): string {
  return s.replace(/<\/script/gi, "<\\/script");
}

export function writeSnapshot(project: Project, prep: Prepared, out: string, label: string, review: ReviewData, views: ViewBook): number {
  const meta: ViewMeta = JSON.parse(gunzipSync(prep.metaGz).toString("utf8"));
  // the sources a card can show: every project module's file, with the usage pass's contexts where
  // they are of that text
  const sources: Record<string, { file: string; text: string; hash: string; contexts?: ModuleContexts }> = {};
  for (const m of meta.modules) {
    if (!m.file) continue;
    try {
      const text = readFileSync(join(project.root, m.file), "utf8");
      const hash = lakeTextHash(text);
      const contexts = prep.usage?.contexts[m.name];
      sources[m.name] = { file: m.file, text, hash, ...(contexts && contexts.hash === hash ? { contexts } : {}) };
    } catch {
      // a file deleted since the build: the card says so
    }
  }
  const b64 = (buf: Buffer) => buf.toString("base64");
  // the artwork's fonts within the page, which has no server to ask for them
  const css = readFileSync(join(WEB, "style.css"), "utf8").replace(/url\("\/fonts\/([a-z0-9-]+\.woff2)"\)/g, (_, f: string) => `url("data:font/woff2;base64,${b64(readFileSync(join(WEBFONTS, f)))}")`);
  const js = readFileSync(join(bundleDir(), "app.js"), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  const info = { createdAt: new Date().toISOString(), label };
  const html = readFileSync(join(WEB, "index.html"), "utf8")
    .replace(`<link rel="stylesheet" href="/style.css">`, () => `<style>\n${css}\n</style>`)
    .replace(
      `<script type="module" src="/app.js"></script>`,
      () =>
        `<script id="vp-static" type="application/json">${scriptSafe(JSON.stringify(info))}</script>\n` +
        `<script id="vp-meta" type="application/octet-stream">${b64(prep.metaGz)}</script>\n` +
        `<script id="vp-edges" type="application/octet-stream">${b64(prep.edgesGz)}</script>\n` +
        `<script id="vp-sources" type="application/octet-stream">${b64(gzipSync(JSON.stringify(sources)))}</script>\n` +
        // the review as it stood: shown, not changed (ReviewSpec decision 7)
        `<script id="vp-review" type="application/octet-stream">${b64(gzipSync(JSON.stringify(review)))}</script>\n` +
        // the kept views (ViewSpec.md), the targets' links with them, and their layouts' memory: the
        // boards as they were; the project's notes (AttachmentSpec decision 13), each shown where its
        // boards hold it
        `<script id="vp-views" type="application/octet-stream">${b64(gzipSync(JSON.stringify({ views: views.kept(), memory: Object.fromEntries(views.kept().map((v) => [v.id, views.memory.get(v.id) ?? {}])), notes: views.notes })))}</script>\n` +
        `<script type="module">\n${scriptSafe(js)}\n</script>`,
    );
  writeFileSync(out, html);
  return html.length;
}
