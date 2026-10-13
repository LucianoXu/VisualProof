// pdf.js as the page bundles it (web/src/paperview.ts): its legacy build, minified, which is the
// same library as the package's main entry, whose types it has, made for browsers that lack what
// the modern build uses (Safari, the owner's decision of 2026-10-11).
declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export * from "pdfjs-dist";
}
