// A small PDF made by hand, for the tests of the library (test/library.test.ts): its pages, each a
// few lines of text in Helvetica, and a title of its own where one is given — what poppler reads
// back as words with their places, page images and clips. The bytes of a few images besides: just
// enough of each format for its type to be read from them.

/** A PDF of `pages`, each a list of lines from the top of a US letter page. */
export function tinyPdf(pages: string[][], title?: string): Buffer {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) - 1 + 1;
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  const pagesId = objs.length + pages.length * 2 + 1;
  for (const lines of pages) {
    const text = lines.map((l, k) => `BT /F1 12 Tf 72 ${720 - 18 * k} Td (${esc(l)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const info = title ? add(`<< /Title (${esc(title)}) >>`) : 0;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, k) => {
    offsets.push(Buffer.byteLength(out));
    out += `${k + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** The first bytes of an image of each type the library takes, and of things it does not. */
export const MAGIC = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]),
  gif: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1"),
  webp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBPVP8 ")]),
  svg: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  html: Buffer.from("<!doctype html><html><body>Not the PDF</body></html>"),
};
