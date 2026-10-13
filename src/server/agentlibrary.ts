// The library and its links for agents (AttachmentSpec decision 20, the owner's of 2026-10-10:
// "everything through the API"): what the page does with the library, its files' pages and text and
// the links, an agent does through these endpoints, and through VisualProof's MCP server's tools,
// which relay them (server/mcptools.ts). They are server/agent.ts's, in its shape
// (server/agentviews.ts, AgentEndpoint), and call the operations the page's routes call
// (server/library.ts), so that both doors keep the same rules. At level advise an agent adds files
// and makes links, and edits, archives or removes its own; at level full also what others made
// (AgentSpec decision 9). Everything it does is recorded in its own log, marked as an agent's.
//
// A file is uploaded as its bytes, the body of the request (the MCP tool library's action add_file
// reads a file on the agent's machine and sends it so); a page and a clip are answered as PNG images, which
// the MCP server hands an agent that reads images as an image.

import { MIME, MAX_FILE } from "../shared/library.ts";
import type { Answer, Ask, Caller, Need, World } from "./agent.ts";
import { fail } from "./agent.ts";
import type { AgentEndpoint } from "./agentviews.ts";
import { graphOf } from "./agentviews.ts";
import { libraryApiOf } from "./library.ts";
import type { Asker, LibAnswer, LibraryApi } from "./library.ts";

/** Where an agent uploads a file's bytes: main.ts reads the body of this one as bytes, not JSON. */
export const UPLOAD_PATH = "/api/agent/library/upload";

/** The body main.ts gives the upload endpoint: the bytes as they came. */
export interface UploadBody {
  bytes: Buffer;
}

/** The library's operations for the agents' API: the same object as the page's routes use. */
export function libraryFor(world: World): LibraryApi | null {
  const lib = world.library;
  if (!lib) return null;
  return libraryApiOf(world, () => ({
    review: world.review,
    project: world.project,
    library: lib,
    graph: () => graphOf(world),
    // every file the library takes shows on the Project: a note carries it, on the ring
    fileAdded: (f, who, note) => void world.views.fileAdded(f, { by: who.name, agent: who.agent, person: who.person ?? null }, note),
  }));
}

/** An answer of the library as the agents' API answers: JSON, or bytes to download (a file, a page
 *  or a clip as an image). */
function answer(a: LibAnswer, name = "file"): Answer {
  if (a.bytes) {
    const ext = Object.entries(MIME).find(([, m]) => m === a.bytes!.type)?.[0] ?? "bin";
    return { status: a.status, body: null, file: { body: a.bytes.data, type: a.bytes.type, name: `${name}.${ext === "jpeg" ? "jpg" : ext}` } };
  }
  const b = a.body as Record<string, unknown> | null;
  // every refusal says what to do instead (AgentSpec, "The API")
  if (a.status >= 400 && b && typeof b === "object" && !b.hint) return { status: a.status, body: { ...b, hint: "GET /api/agent explains the library's endpoints." } };
  // the review's change is for pages, which apply it at once; an agent reads what it made
  if (b && typeof b === "object" && "change" in b) {
    const { change: _change, ...rest } = b;
    return { status: a.status, body: rest };
  }
  return { status: a.status, body: a.body };
}

/** The agents' endpoints about the library and its links. `refuse` says why an agent may not do
 *  what needs `need`. */
export function libraryEndpoints(world: World, refuse: (c: Caller, need: Need) => Answer | null): AgentEndpoint[] {
  const body = (a: Ask) => (a.body && typeof a.body === "object" && !Array.isArray(a.body) && !Buffer.isBuffer(a.body) ? (a.body as Record<string, unknown>) : {});
  const api = (): LibraryApi | Answer => libraryFor(world) ?? fail(404, "This server keeps no library.", "");
  /** Writes say who makes them, and that it is an agent; then what their level allows: adding at
   *  advise, and at full changing what others made (`full` in the asker). */
  const asker = (a: Ask): Asker | Answer => {
    if (a.caller.kind !== "agent") return fail(400, "This API records what agents do: say you are one.", "Send X-VisualProof-Kind: agent with every request, beside X-VisualProof-Name.");
    if (!a.caller.name) return fail(401, "Say who you are first.", "Send X-VisualProof-Name: <your name>, e.g. Claude.", { who: true });
    const no = refuse(a.caller, "advise");
    if (no) return no;
    return { name: a.caller.name, agent: true, person: null, full: refuse(a.caller, "full") === null };
  };
  const q = (a: Ask, k: string) => a.query.get(k);
  const sha = "a file's SHA-256 (64 hex digits), as GET /api/agent/library lists it";
  const subject = "decl(<full name>) for a declaration, ns(<namespace>) or file(<module prefix>) for a cluster, as a view's scope names them";
  const place =
    "page: the page, from 1 (a PDF's links are at a page; an image has none); region: [left, top, right, bottom] in fractions of the page from its top left (0–1; the word boxes of GET library/text are in the same units); quote: the text quoted, or {text, before?, after?} with a little of the text around it";
  const read = (run: (l: LibraryApi, a: Ask) => LibAnswer | Promise<LibAnswer>, name?: (a: Ask) => string) => async (a: Ask): Promise<Answer> => {
    const l = api();
    if (!("list" in l)) return l;
    return answer(await run(l, a), name?.(a));
  };
  const write = (run: (l: LibraryApi, a: Ask, who: Asker) => LibAnswer | Promise<LibAnswer>) => async (a: Ask): Promise<Answer> => {
    const l = api();
    if (!("list" in l)) return l;
    const who = asker(a);
    if (!("full" in who)) return who;
    return answer(await run(l, a, who));
  };
  return [
    {
      method: "GET", path: "/api/agent/library",
      about: "The project's library (AttachmentSpec decision 1): the PDFs and images people and agents added, each with its record — title (the PDF's own, else the file's name), type, size, pages, who added it and when, the URL it came from, how many links point into it, and whether this server has its bytes (have: false — a link's file added elsewhere; it can be added again, only a file of that hash) — the archived apart, and how full the library is.",
      params: {},
      returns: "{files: [{sha, title, type, size, pages?, by, at, agent?, url?, name?, have, links}], archived: […], used, limit, maxFile}",
      run: read((l) => l.list()),
    },
    {
      method: "GET", path: "/api/agent/library/file",
      about: "One file's record and every link into it.",
      params: { sha },
      returns: "{file, links: [{id, subject, file, page?, region?, quote?, label, by, at, agent?}]}",
      run: read((l, a) => l.file(q(a, "sha"))),
    },
    {
      method: "GET", path: "/api/agent/library/bytes",
      about: "A file's bytes, as it was added (files never change): a PDF or an image. The MCP tool library (action save) writes them to a file on your machine.",
      params: { sha },
      returns: "the file (application/pdf, image/png, image/jpeg, image/webp or image/gif)",
      run: read((l, a) => l.bytes(q(a, "sha")), (a) => (q(a, "sha") ?? "file").slice(0, 12)),
    },
    {
      method: "POST", path: "/api/agent/library/url", needs: "advise",
      about: `Add the file at an address to the library: the server fetches it once and keeps it (an arXiv abstract's address, arxiv.org/abs/…, gives its PDF). http and https only; never an address of a private or local network; at most ${MAX_FILE / (1024 * 1024)} MB; the type is read from the bytes: a PDF, PNG, JPEG, WebP or GIF, never SVG. The same bytes are stored once: a file already in the library is answered as it is (existed: true), restored where it was archived.`,
      params: { url: "the file's address" },
      returns: "{ok, file, existed}",
      run: write((l, a, who) => l.addUrl(body(a).url, who)),
    },
    {
      method: "POST", path: UPLOAD_PATH, needs: "advise",
      about: `Upload a file to the library: its bytes are the body of the request (not JSON; e.g. curl --data-binary @paper.pdf), its name in the query. A PDF, PNG, JPEG, WebP or GIF, at most ${MAX_FILE / (1024 * 1024)} MB, its type read from the bytes. With sha, the bytes of a file a link names that this server lacks, and no other. The MCP tool library (action add_file) reads a file on your machine and sends it.`,
      params: { name: "the file's name, in the query", sha: "optional, in the query: the file a link names, whose bytes these must be" },
      returns: "{ok, file, existed, filled?}",
      run: write(async (l, a, who) => {
        const b = a.body as Partial<UploadBody> | null;
        if (!b || !Buffer.isBuffer(b.bytes)) return { status: 400, body: { error: "The body is the file's bytes.", hint: "Send them as they are (curl --data-binary @file), the name in the query; the MCP tool library (action add_file) does it from a path on your machine." } };
        // an MCP server from before uploads sends the path as JSON: it cannot read files
        if (b.bytes[0] === 0x7b && b.bytes.length < 65536 && /"file"\s*:/.test(b.bytes.toString("utf8")))
          return { status: 400, body: { error: "The body is the file's bytes, not JSON naming a path.", hint: "Your MCP server is older than uploads: download it again (GET /api/agent/mcp) and restart your session; or send the bytes with curl --data-binary @file." } };
        return l.add(b.bytes, { name: q(a, "name"), expect: q(a, "sha") }, who);
      }),
    },
    {
      method: "POST", path: "/api/agent/library/edit", needs: "advise",
      about: "Edit a file's title. Your own at level advise; anyone's at full. A note that carries the file alone and whose text is its title, or the name it was added under, takes the new title by itself, as an edit by VisualProof; words someone wrote stay.",
      params: { sha, title: "the new title" },
      returns: "{ok, changed, file}",
      run: write((l, a, who) => l.editFile(body(a).sha, body(a).title, who)),
    },
    {
      method: "POST", path: "/api/agent/library/archive", needs: "advise",
      about: "Archive a file — nothing is deleted: it leaves the library's list, its links say so, and it is restored from the archive — or restore it (on: false). Your own at level advise; anyone's at full.",
      params: { sha, on: "true (default): archive; false: restore" },
      returns: "{ok, changed, file}",
      run: write((l, a, who) => l.archive(body(a).sha, body(a).on, who)),
    },
    {
      method: "GET", path: "/api/agent/library/text",
      about: "A PDF's page as text, with the place of every word: [text, left, top, right, bottom] in fractions of the page from its top left, the units a link's region is in, so that a region can be made from words' boxes; lines says where each line starts among the words.",
      params: { sha, page: "the page, from 1 (default 1)" },
      returns: "{file, title, page, pages, size: {width, height} (points), text, words: [[text, x0, y0, x1, y1]], lines}",
      run: read((l, a) => l.text(q(a, "sha"), q(a, "page"))),
    },
    {
      method: "GET", path: "/api/agent/library/search",
      about: "Search a PDF's text: every match's page, the boxes of its words (fractions of the page) and the text around it — what a link's page, region and quote are made from.",
      params: { sha, q: "the text to find (case and line breaks do not matter)", limit: "how many matches (default 50, at most 500)" },
      returns: "{file, title, q, matches: [{page, boxes, text, before, after}], more}",
      run: read((l, a) => l.search(q(a, "sha"), q(a, "q"), q(a, "limit"))),
    },
    {
      method: "GET", path: "/api/agent/library/page",
      about: "A PDF's page drawn as a PNG image, for an agent that reads images (the MCP tool library, action page, hands it over as an image).",
      params: { sha, page: "the page, from 1", width: "its width in pixels: 400, 800, 1200 (default), 1600 or 2000" },
      returns: "image/png",
      run: read((l, a) => l.page(q(a, "sha"), q(a, "page"), q(a, "width")), (a) => `page-${q(a, "page") ?? 1}`),
    },
    {
      method: "GET", path: "/api/agent/library/clip",
      about: "A region of a PDF's page drawn as a PNG image: a figure, a theorem's statement.",
      params: { sha, page: "the page, from 1", region: "left,top,right,bottom: fractions of the page from its top left", width: "its width in pixels: 400, 800 (default), 1200, 1600 or 2000" },
      returns: "image/png",
      run: read((l, a) => l.clip(q(a, "sha"), q(a, "page"), q(a, "region"), q(a, "width")), (a) => `clip-${q(a, "page") ?? 1}`),
    },
    {
      method: "GET", path: "/api/agent/links",
      about: "Links (AttachmentSpec decision 4): those of a subject — a declaration or a cluster — or into a file, in the order they were made; all of them with neither. A declaration's own links come first when the page opens its source beside the paper (decision 8); one with none shows the innermost cluster around it that has one.",
      params: { subject, file: sha },
      returns: "{links: [{id, subject, file, fileTitle, page?, region?, quote?, label, by, at, agent?, archived?, have}]}",
      run: read((l, a) => l.links({ subject: q(a, "subject"), file: q(a, "file") })),
    },
    {
      method: "POST", path: "/api/agent/link", needs: "advise",
      about: "Link a declaration or a cluster to a place in a file of the library: a page with quoted text, a region, or both; an image whole or a region of it. Find the place with library/search or library/text. The label is what the page lists (\"Theorem 3, p. 12\"); left out, the page and the quote's first words. Recorded in your review log, marked as an agent's.",
      params: { subject, file: sha, page: place, region: "see page", quote: "see page", label: "optional: e.g. Theorem 3, p. 12" },
      returns: "{ok, link}",
      run: write((l, a, who) => l.link(body(a), who)),
    },
    {
      method: "POST", path: "/api/agent/link/edit", needs: "advise",
      about: "Edit a link: its label, its place (page, region, quote; null takes a part away) or its subject. Your own at level advise; anyone's at full.",
      params: { id: "the link's id", label: "optional", page: "optional", region: "optional", quote: "optional", subject: "optional" },
      returns: "{ok, changed, link}",
      run: write((l, a, who) => l.editLink(body(a), who)),
    },
    {
      method: "POST", path: "/api/agent/unlink", needs: "advise",
      about: "Remove a link. Your own at level advise; anyone's at full.",
      params: { id: "the link's id" },
      returns: "{ok, removed}",
      run: write((l, a, who) => l.unlink(body(a).id, who)),
    },
  ];
}
