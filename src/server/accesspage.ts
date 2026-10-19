// What a browser is shown where nothing lets it in (CollabSpec decisions 7 and 12, the owner's
// decision of 2026-10-18). A server with `--access-key-file` answered every request without the key
// or its cookie 404 `{"error":"not found"}`, as if there were nothing there: whoever opened the
// address without the link, or in a browser that had forgotten the cookie, took the service for
// down. A browser asking for a page is now shown a small page that says the site is private and
// what to do; everything else — the API, the event stream, agents, files — is answered as before.
//
// The page tells an outsider that a VisualProof server is there, and nothing else: it is the same
// bytes on every server, made from the variant alone (and whether the address alone opens the site,
// `--public`), never from the site — no project name, version, people, counts or anything the site
// holds. Of a link that does not open the site, it never says which it was (a key replaced, a
// personal or read-only link revoked, one never made): only someone who once held a real link could
// tell revoked from unknown, and the names of who revoked it are the site's.
//
// Self-contained: its style inline (allowed by its digest, nothing else), light and dark by the
// system's choice, no script, nothing fetched.

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { KIND_HEADER } from "./identity.ts";

/** Which page: `private`, the site is private (no key, no cookie); `link`, a link that does not open
 *  the site (a wrong `/k/…`, a personal or read-only link unknown or revoked, or a revoked link's
 *  cookie); `host`, a server without a key reached by a name it does not answer (decision 12),
 *  addressed to whoever runs it. */
export type AccessPage = "private" | "link" | "host";

/** Whether a request is a browser asking for a page: GET or HEAD, accepting HTML, for a page's
 *  path — not the API (the event stream and the agents' documentation are in it), not a file (a
 *  name with an extension, but for `.html`; the fonts, the tips, pdf.js) — and from no agent: one
 *  that sends `Authorization: Bearer` or says it is one. A sign-in proxy's `Authorization: Basic`,
 *  passed on, is still a browser's. Anything else keeps the answer it had. */
export function asksForPage(req: IncomingMessage, path: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (/^Bearer\s/i.test(req.headers.authorization ?? "")) return false;
  const kind = req.headers[KIND_HEADER];
  if ((Array.isArray(kind) ? kind[0] : kind)?.trim().toLowerCase() === "agent") return false;
  if (!acceptsHtml(req.headers.accept)) return false;
  if (path === "/api" || path.startsWith("/api/") || /^\/(fonts|tips|pdfjs)\//.test(path)) return false;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !/\.[A-Za-z0-9]+$/.test(last) || /\.html$/i.test(last);
}

/** Whether an `Accept` header takes HTML: `text/html` among its media ranges, not at q=0. A browser
 *  navigating says so first; a script's fetch, curl and an `<img>` do not. */
export function acceptsHtml(accept: string | undefined): boolean {
  return (accept ?? "").split(",").some((range) => {
    const [type, ...params] = range.split(";").map((s) => s.trim());
    if (type.toLowerCase() !== "text/html") return false;
    const q = params.find((p) => /^q=/i.test(p));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/** The page's style: the wordmark as the page's `.logo` draws it (web/style.css), the page's
 *  colours, light or dark as the system is. */
const STYLE = `
:root { color-scheme: light dark; --bg: #f5f5f7; --text: #1d1d1f; --text-2: #6e6e73; --code: rgba(0, 0, 0, 0.05); --link: #6a4be0; --grad: linear-gradient(100deg, #5e5ce6 0%, #bf5af2 52%, #ff375f 100%); }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0b0d; --text: #f5f5f7; --text-2: #a1a1a6; --code: rgba(255, 255, 255, 0.08); --link: #ab97ff; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 20px; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif; }
main { max-width: 30rem; text-align: center; }
.logo { display: inline-block; margin-bottom: 18px; font-size: 40px; font-weight: 700; letter-spacing: -0.02em; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; }
p { margin: 0 0 8px; color: var(--text-2); }
code { font: 0.86em "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; padding: 1px 5px; border-radius: 5px; background: var(--code); color: var(--text); white-space: nowrap; }
a { color: var(--link); }
@media (max-width: 480px) { .logo { font-size: 34px; } h1 { font-size: 18px; } p { font-size: 15px; } }
`;

/** what the page's CSP allows: its style, by its digest; the `data:` icon (no request for one) */
export const ACCESS_PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(STYLE).digest("base64")}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** Each page's title and words, as HTML: the same for every server. */
const WORDS: Record<AccessPage, { title: string; head: string; lines: string[] }> = {
  private: {
    title: "Private",
    head: "This site is private",
    lines: ["Open it with the link you were given. If you could open it before, this browser has forgotten the link: open it again."],
  },
  link: {
    title: "Link no longer valid",
    head: "This link no longer opens this site",
    lines: ["It was replaced or revoked. Ask whoever runs the site for a new one."],
  },
  host: {
    title: "Name not answered",
    head: "This server does not answer this name",
    lines: ["It answers only the names it was started for. Whoever runs it can add this one: start it with <code>--public-url &lt;its address&gt;</code> or <code>--allowed-host &lt;name&gt;</code>."],
  },
};

/** The line a link's page adds where the address alone opens the site read-only (`--public`). */
const PUBLIC_LINE = `Anyone may read the site without one: <a href="/">open it read-only</a>.`;

/** The page, whole: made from `kind` alone, and whether the address opens the site read-only. */
export function accessPageHtml(kind: AccessPage, publicRead = false): string {
  const w = WORDS[kind];
  const lines = kind === "link" && publicRead ? [...w.lines, PUBLIC_LINE] : w.lines;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${w.title} · VisualProof</title>
<link rel="icon" href="data:,">
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="logo">VisualProof</div>
<h1>${w.head}</h1>
${lines.map((l) => `<p>${l}</p>`).join("\n")}
</main>
</body>
</html>
`;
}

/** Answer a request with the page: 403, never kept by a cache, with the headers a page needs to
 *  stand alone. Cookies to forget (a revoked link's) are set on `res` before. */
export function sendAccessPage(res: ServerResponse, kind: AccessPage, publicRead = false): void {
  if (res.headersSent || res.writableEnded) return;
  const body = Buffer.from(accessPageHtml(kind, publicRead));
  res.writeHead(403, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    // the same address answers JSON to what does not accept HTML
    vary: "accept",
    "content-security-policy": ACCESS_PAGE_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}
