# The library and links

The project's references (papers, photos), and links to places in them.

## Files and links

- **File**: a PDF, or a PNG, JPEG, WebP or GIF image (never SVG), at most 50 MB, named by the
  SHA-256 of its bytes (`sha`). The server keeps the bytes, never the project; its record (title,
  type, size, pages, who added it, where from) and links are events of the review's logs. A
  file never changes: a revised paper is another file.
- **Link**: a **subject** — `decl(<full name>)`, `ns(<namespace>)` or `file(<module prefix>)` — to
  a **place**: a PDF page with a quote, a region, or both; or an image, whole or a region.
- **Region**: `[left, top, right, bottom]`, fractions of the page from its top left (0–1), as
  `library/text`'s word boxes.
- **Quote**: the text, or `{text, before?, after?}`: words around it tell repeated text apart.
- **Label**: as the panel shows it ("📄 Theorem 3, p. 12"); default: the page, the quote's first words.

Reading: any level. Advise: add files, make links; edit, archive and remove your own. Full: others'
too (403 otherwise). Recorded in your log, as an agent's.

## Endpoints

Under `/api/agent/`. MCP: `library` (`list`, `file`, `save`, `text`, `search`, `page`, `clip`,
`add_url`, `add_file`, `edit`, `archive`), `links` (`list`, `make`, `edit`, `remove`).

| endpoint | what |
|---|---|
| `GET library` | the files (each with `have`: whether this server has its bytes — one added elsewhere comes through the logs without — and its link count), the archived apart, `used` and `limit` in bytes |
| `GET library/file?sha=` | a file's record and every link into it |
| `GET library/bytes?sha=` | the file (MCP `save` writes it to a path you give) |
| `GET library/text?sha=&page=` | a PDF page: `text`, `words` (`[text, left, top, right, bottom]`), `lines` (each line's start among the words), `pages`, `size` in points |
| `GET library/search?sha=&q=&limit=` | every match of `q` in the PDF (case and line breaks loosely): `page`, `boxes` of its words, `text`, `before`, `after` |
| `GET library/page?sha=&page=&width=` | the page as a PNG, 400, 800, 1200 (default), 1600 or 2000 px wide (MCP `page`: as an image) |
| `GET library/clip?sha=&page=&region=&width=` | a region as a PNG, `region=left,top,right,bottom` |
| `GET links?subject=&file=` | a subject's or a file's links, in the order made; all without either |
| `POST library/url {url}` | add the file at an address, fetched once (http and https only, no private or local address, 60 s); an arXiv abstract gives its PDF. Same bytes again: `existed: true` |
| `POST library/upload?name=&sha=` | add a file, **its bytes the body** (`curl --data-binary @paper.pdf -H 'content-type: application/pdf'`). `sha`: only the bytes of a file a link names that this server lacks (409 otherwise). MCP `add_file` sends a file from your machine |
| `POST library/edit {sha, title}` | retitle (at first the PDF's title, else the file name); a note carrying only this file, whose text is its title or added name, follows (an edit by VisualProof); written words stay |
| `POST library/archive {sha, on}` | archive (`on` true, default): nothing deleted, it leaves the library, its links say so; `false` restores |
| `POST link {subject, file, page?, region?, quote?, label?}` | a PDF's link is at a page, an image's at none; not to an archived file (409) |
| `POST link/edit {id, label?, page?, region?, quote?, subject?}` | `null` removes a part of the place |
| `POST unlink {id}` | remove a link |

A new file comes with a project note on the Project's ring, collapsed, titled by the file, under
your name ([notes](notes.md)); another view shows it where a link brings it or it is added
(`views/items`, [views](views.md)).

```json
POST /api/agent/link
{ "subject": "decl(flt_regular)", "file": "<sha256>", "page": 4,
  "quote": { "text": "theorem flt_regular", "before": "… for regular primes. -/" } }
→ { "ok": true, "link": { "id": "l0b747fac7736", …, "by": "Claude", "agent": true, "fileTitle": "…", … } }
```

## What people see

A declaration's links show in its panel (References), a cluster's in its own; opening a
declaration's source opens its first link (else its innermost linked cluster's) beside it.
`POST /api/agent/view {"paper": {"link": "<id>"}}` ([following](following.md)) opens the reference
window there for your followers, the link lit, beside the source window if open.

Links follow a declaration's rename, and a cluster's when a build moves all of it into one other
cluster; a link whose subject is gone goes to the lost-and-found ([history](history.md)). The export
([export](export.md)) prints a declaration's links under it ("Reference: …"), a cluster's under its
section, the cited files at the end ("References").
