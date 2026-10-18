// A file of the library fetched by URL (AttachmentSpec decision 1, "Implementation notes"): only http
// and https, never an address of a private or local network or of the server, checked on every
// address a name resolves to and at every redirect; at most so many bytes, within a time limit; an
// arXiv abstract's address gives its PDF, and a paper on arXiv is titled as its abstract page says.
// Everything is fetched from a server of the test's own on the loopback, which the guard refuses
// unless the test lets it through, arXiv included (`arxivOrigin`) — never from the internet.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { arxivId, arxivPdf, blockedAddress, citationTitle, defaultAllowed, fetchPage, fetchUrl, MAX_PAGE } from "../src/server/fetchurl.ts";
import { MAX_FILE } from "../src/shared/library.ts";
import { tinyPdf } from "./pdf.ts";
import { site } from "./site.ts";

const PDF = tinyPdf([["A paper fetched by its address."]], "Fetched");

/** A server on the loopback answering each path as `routes` says. */
async function serve(routes: Record<string, (res: import("node:http").ServerResponse) => void>): Promise<{ server: Server; base: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const r = routes[req.url ?? ""];
    if (r) r(res);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, close: () => new Promise((ok) => (server.closeAllConnections(), server.close(() => ok()))) };
}

const loopbackOnly = { allowed: (a: string) => a === "127.0.0.1" };

test("the addresses the server never fetches from: loopback, private, link-local, unique-local, multicast, reserved, IPv4 written as IPv6", () => {
  for (const a of ["127.0.0.1", "127.255.0.9", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.0.8"])
    assert.ok(blockedAddress(a), a);
  for (const a of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "64:ff9b::a00:1", "2001:db8::1", "::ffff:7f00:1", "not an address"])
    assert.ok(blockedAddress(a), a);
  for (const a of ["93.184.216.34", "151.101.1.69", "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5", "::ffff:93.184.216.34", "2a00:1450:4001:80b::200e"]) assert.ok(!blockedAddress(a), a);
  // the server's own interfaces, whatever range they are in
  assert.ok(!defaultAllowed("127.0.0.1"));
});

test("an arXiv abstract's address gives its PDF; any other address stays as it is", () => {
  assert.equal(arxivPdf("https://arxiv.org/abs/1910.09336"), "https://arxiv.org/pdf/1910.09336");
  assert.equal(arxivPdf("http://export.arxiv.org/abs/1910.09336v2?context=cs"), "https://arxiv.org/pdf/1910.09336v2");
  assert.equal(arxivPdf("https://arxiv.org/abs/math/0601001"), "https://arxiv.org/pdf/math/0601001");
  assert.equal(arxivPdf("https://example.org/abs/1"), "https://example.org/abs/1");
  // a PDF on arXiv is known by its identifier too, with or without .pdf and a version
  assert.equal(arxivId("https://www.arxiv.org/pdf/1910.09336v2.pdf"), "1910.09336v2");
  assert.equal(arxivId("https://arxiv.org/pdf/1910.09336"), "1910.09336");
  assert.equal(arxivId("https://arxiv.org/abs/math/0211159v1/"), "math/0211159v1");
  assert.equal(arxivId("https://example.org/pdf/1910.09336"), null);
  assert.equal(arxivId("https://arxiv.org/list/math.NT/new"), null);
  // fetched wherever the options put arXiv
  assert.equal(arxivPdf("https://arxiv.org/pdf/1910.09336v2.pdf", "http://127.0.0.1:9/"), "http://127.0.0.1:9/pdf/1910.09336v2");
  assert.equal(arxivPdf("https://example.org/paper.pdf", "http://127.0.0.1:9"), "https://example.org/paper.pdf");
});

test("a page's citation_title: its content, character references decoded and whitespace made single, whatever the order and quotes of its attributes", () => {
  const page = (meta: string) => `<!DOCTYPE html><html><head><title>[1910.09336] Something else</title>\n<meta name="citation_author" content="Lovelace, Ada" />\n${meta}\n</head><body></body></html>`;
  assert.equal(citationTitle(page('<meta name="citation_title" content="Games &amp; Proofs:\n   a  &#34;tiny&#34; &lt;survey&gt; &#x2014; caf&#233;" />')), 'Games & Proofs: a "tiny" <survey> — café');
  assert.equal(citationTitle(page("<META content='Order > Chaos' NAME='Citation_Title'>")), "Order > Chaos");
  assert.equal(citationTitle(page('<meta name=citation_title content="Unquoted name">')), "Unquoted name");
  // none, an empty one, a reference that is no character
  assert.equal(citationTitle(page('<meta name="citation_date" content="2019/02/20" />')), null);
  assert.equal(citationTitle(page('<meta name="citation_title" content="   " />')), null);
  assert.equal(citationTitle(page('<meta name="citation_title" content="A &#0; B &nosuch; C" />')), "A \ufffd B &nosuch; C");
});

test("a page is fetched with the same guard as a file, within the bytes a page may take", async () => {
  const S = await serve({
    "/abs/1": (res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<meta name="citation_title" content="Café">');
    },
    "/hop": (res) => {
      res.writeHead(302, { location: "/abs/1" });
      res.end();
    },
    "/inside": (res) => {
      res.writeHead(302, { location: "http://10.1.2.3/abs/1" });
      res.end();
    },
    "/huge": (res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(Buffer.alloc(MAX_PAGE + 1, 0x20));
    },
  });
  try {
    assert.equal(((await fetchPage(`${S.base}/abs/1`)) as { status: number }).status, 403);
    const got = await fetchPage(`${S.base}/hop`, loopbackOnly);
    assert.ok(got.ok);
    assert.equal(got.text, '<meta name="citation_title" content="Café">');
    assert.equal(got.url, `${S.base}/abs/1`);
    assert.equal(((await fetchPage(`${S.base}/inside`, loopbackOnly)) as { status: number }).status, 403);
    // at most MAX_PAGE, whatever the options allow a file
    assert.equal(((await fetchPage(`${S.base}/huge`, { ...loopbackOnly, maxBytes: MAX_FILE })) as { status: number }).status, 413);
  } finally {
    await S.close();
  }
});

test("only http and https; the loopback refused as it resolves, and at a redirect into a private range; within the bytes and the time a file may take", async () => {
  const S = await serve({
    "/paper.pdf": (res) => {
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Fetched Paper.pdf"' });
      res.end(PDF);
    },
    "/hop": (res) => {
      res.writeHead(302, { location: "/paper.pdf" });
      res.end();
    },
    "/inside": (res) => {
      res.writeHead(302, { location: "http://10.1.2.3/secret.pdf" });
      res.end();
    },
    "/metadata": (res) => {
      res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    },
    "/file": (res) => {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    },
    "/big": (res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(Buffer.concat([PDF, Buffer.alloc(4096)]));
    },
    "/slow": () => {
      // never answers
    },
    "/missing": (res) => {
      res.writeHead(500);
      res.end();
    },
  });
  try {
    // the guard as it stands refuses the loopback the test serves from
    const own = await fetchUrl(`${S.base}/paper.pdf`);
    assert.equal(own.ok, false);
    assert.equal((own as { status: number }).status, 403);
    assert.match((own as { error: string }).error, /127\.0\.0\.1/);
    const name = await fetchUrl(`http://localhost:${new URL(S.base).port}/paper.pdf`);
    assert.equal((name as { status: number }).status, 403, "a name that resolves to the loopback");
    // let through for the test: the bytes, the address they came from, the name the answer gives
    const got = await fetchUrl(`${S.base}/hop`, loopbackOnly);
    assert.ok(got.ok);
    assert.deepEqual(got.bytes, PDF);
    assert.equal(got.url, `${S.base}/paper.pdf`);
    assert.equal(got.name, "Fetched Paper.pdf");
    // a redirect into a private range, or the cloud's metadata address, or off http
    const inside = await fetchUrl(`${S.base}/inside`, loopbackOnly);
    assert.equal((inside as { status: number }).status, 403);
    assert.match((inside as { error: string }).error, /10\.1\.2\.3/);
    assert.equal(((await fetchUrl(`${S.base}/metadata`, loopbackOnly)) as { status: number }).status, 403);
    assert.equal(((await fetchUrl(`${S.base}/file`, loopbackOnly)) as { status: number }).status, 400);
    assert.equal(((await fetchUrl("ftp://example.org/x.pdf", loopbackOnly)) as { status: number }).status, 400);
    assert.equal(((await fetchUrl("http://user:pw@example.org/x.pdf", loopbackOnly)) as { status: number }).status, 400);
    // too many bytes, too long, not the file
    assert.equal(((await fetchUrl(`${S.base}/big`, { ...loopbackOnly, maxBytes: PDF.length + 100 })) as { status: number }).status, 413);
    const slow = await fetchUrl(`${S.base}/slow`, { ...loopbackOnly, timeoutMs: 300 });
    assert.equal(slow.ok, false);
    assert.equal(((await fetchUrl(`${S.base}/missing`, loopbackOnly)) as { status: number }).status, 502);
  } finally {
    await S.close();
  }
});

test("a fetch's time is the whole of it, the answer's head included; what is not the file is never read on", { timeout: 15_000 }, async () => {
  // a head sent a byte at a time is never idle, and a redirect's body may never end: both on a socket
  // of the test's own, which counts what it still sends once the fetch has answered
  let sent = 0;
  const socks = new Set<import("node:net").Socket>();
  const raw = createNetServer((sock) => {
    socks.add(sock);
    sock.on("error", () => {});
    sock.once("data", (d) => {
      const path = d.toString().split(" ")[1];
      // for three seconds at most, so that a fetch that waits for the end still ends
      const until = Date.now() + 3000;
      const tick = (f: () => void) => {
        const t = setInterval(() => (sock.destroyed ? clearInterval(t) : Date.now() > until ? sock.destroy() : f()), 5);
      };
      if (path === "/trickle") {
        sock.write("HTTP/1.1 200 OK\r\nX-Slow: ");
        tick(() => sock.write("a"));
      } else if (path === "/endless" || path === "/error") {
        sock.write(`HTTP/1.1 ${path === "/error" ? "500 Internal Server Error" : "302 Found\r\nLocation: /nothing"}\r\nTransfer-Encoding: chunked\r\n\r\n`);
        const chunk = Buffer.alloc(64 * 1024, 0x61);
        tick(() => {
          sock.write(`${chunk.length.toString(16)}\r\n`);
          sock.write(chunk);
          sock.write("\r\n");
          sent += chunk.length;
        });
      } else sock.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
  });
  await new Promise<void>((ok) => raw.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(raw.address() as AddressInfo).port}`;
  try {
    const t0 = Date.now();
    const slow = await fetchUrl(`${base}/trickle`, { ...loopbackOnly, timeoutMs: 400 });
    assert.equal(slow.ok, false);
    assert.ok(Date.now() - t0 < 2000, `answered after ${Date.now() - t0} ms, not within its 400`);
    for (const path of ["/endless", "/error"]) {
      const r = await fetchUrl(`${base}${path}`, loopbackOnly);
      assert.equal((r as { status: number }).status, 502);
      const then = sent;
      await new Promise((ok) => setTimeout(ok, 300));
      assert.ok(sent - then < 1024 * 1024, `${path}: ${sent - then} bytes more read after the fetch answered`);
    }
  } finally {
    for (const s of socks) s.destroy();
    await new Promise((ok) => raw.close(ok));
  }
});

test("added by URL, the file is recorded with where it came from; the server's own network is refused from the page too", async () => {
  const P = await serve({
    "/paper.pdf": (res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(PDF);
    },
  });
  const S = await site();
  try {
    const name = { "x-visualproof-name": "Alice" };
    const refused = await S.ask("POST", "/api/library/url", { url: `${P.base}/paper.pdf` }, name);
    assert.equal(refused.status, 403);
    S.live.library.fetchOptions = loopbackOnly;
    const r = await S.ask("POST", "/api/library/url", { url: `${P.base}/paper.pdf` }, name);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json!.file.url, `${P.base}/paper.pdf`);
    assert.equal(r.json!.file.title, "Fetched");
    assert.equal(r.json!.file.by, "Alice");
  } finally {
    await S.close();
    await P.close();
  }
});

test("a paper on arXiv, added by its abstract's address or its PDF's, is titled as its abstract page says, the page fetched once, for a file new to the library; else as before", async () => {
  const hits: Record<string, number> = {};
  const pdf = (bytes: Buffer, name: string) => (res: import("node:http").ServerResponse) => {
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"` });
    res.end(bytes);
  };
  const abs = (path: string, html: string | null) => (res: import("node:http").ServerResponse) => {
    hits[path] = (hits[path] ?? 0) + 1;
    res.writeHead(html === null ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
    res.end(html ?? "");
  };
  const meta = (title: string) => `<!DOCTYPE html><html><head><title>[x] ignored</title>\n<meta name="citation_title" content="${title}" />\n</head></html>`;
  // as arXiv serves them: a PDF whose own title is its identifier, or none, under the identifier's name
  const A = tinyPdf([["The Lean mathematical library."]], "1910.09336v2");
  const B = tinyPdf([["A working draft."]], "A Working Title");
  const C = tinyPdf([["A paper whose abstract page says no title."]], "Its Own Title");
  const D = tinyPdf([["A paper whose abstract page is not there."]]);
  const E = tinyPdf([["A paper elsewhere, its title an arXiv identifier."]], "arXiv:2105.01234v2 [math.NT]");
  const P = await serve({
    "/pdf/1910.09336": pdf(A, "1910.09336v2.pdf"),
    "/abs/1910.09336": abs("/abs/1910.09336", meta("The Lean &amp;\n    Mathlib Library")),
    "/pdf/2001.00001v2": pdf(B, "2001.00001v2.pdf"),
    "/abs/2001.00001v2": abs("/abs/2001.00001v2", meta("The Final Title")),
    "/pdf/2002.00002": pdf(C, "2002.00002v1.pdf"),
    "/abs/2002.00002": abs("/abs/2002.00002", "<!DOCTYPE html><html><head><title>No meta</title></head></html>"),
    "/pdf/2003.00003": pdf(D, "2003.00003v1.pdf"),
    "/abs/2003.00003": abs("/abs/2003.00003", null),
    "/elsewhere.pdf": pdf(E, "Elliptic Curves.pdf"),
  });
  const S = await site();
  try {
    const name = { "x-visualproof-name": "Alice" };
    S.live.library.fetchOptions = { ...loopbackOnly, arxivOrigin: P.base };
    const add = async (url: string) => {
      const r = await S.ask("POST", "/api/library/url", { url }, name);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return r.json!;
    };
    // by the abstract's address: the PDF and the abstract page both from where arXiv is
    const a = await add("https://arxiv.org/abs/1910.09336");
    assert.equal(a.existed, false);
    assert.equal(a.file.title, "The Lean & Mathlib Library");
    assert.equal(a.file.url, `${P.base}/pdf/1910.09336`);
    assert.equal(a.file.name, "1910.09336v2.pdf");
    // by the PDF's address, with .pdf and a version: the abstract's title before the PDF's own
    const b = await add("https://arxiv.org/pdf/2001.00001v2.pdf");
    assert.equal(b.file.title, "The Final Title");
    // the same file again, by either address: the file as it is, the abstract page not fetched again
    assert.equal(hits["/abs/1910.09336"], 1);
    assert.equal((await add("https://arxiv.org/abs/1910.09336")).existed, true);
    assert.equal((await add("http://export.arxiv.org/pdf/1910.09336")).existed, true);
    assert.equal(hits["/abs/1910.09336"], 1);
    // an abstract page without a title: the PDF's own; none at all: the file's name, as before
    assert.equal((await add("https://arxiv.org/abs/2002.00002")).file.title, "Its Own Title");
    assert.equal(hits["/abs/2002.00002"], 1);
    assert.equal((await add("https://www.arxiv.org/abs/2003.00003")).file.title, "2003.00003v1");
    assert.equal(hits["/abs/2003.00003"], 1);
    // a PDF elsewhere whose own title is only an identifier keeps its file's name; no page is fetched
    const before = Object.values(hits).reduce((x, y) => x + y, 0);
    assert.equal((await add(`${P.base}/elsewhere.pdf`)).file.title, "Elliptic Curves");
    assert.equal(Object.values(hits).reduce((x, y) => x + y, 0), before);
  } finally {
    await S.close();
    await P.close();
  }
});
