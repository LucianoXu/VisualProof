// "Open in editor" (shared/editor.ts): a URL template, filled in for a declaration's place.

import assert from "node:assert/strict";
import { test } from "node:test";
import { editorLink, invalidTemplate } from "../src/shared/editor.ts";

const place = { path: "/home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean", rel: "Mathlib/NumberTheory/FLT/Four.lean", line: 23, col: 1 };

test("VS Code, here and over SSH: the absolute path follows the template's slash without doubling it", () => {
  assert.equal(editorLink("vscode://file/{path}:{line}", place), "vscode://file/home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean:23");
  assert.equal(editorLink("vscode://file/{path}:{line}:{col}", { ...place, col: 5 }), "vscode://file/home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean:23:5");
  assert.equal(
    editorLink("vscode://vscode-remote/ssh-remote+lab{path}:{line}", place),
    "vscode://vscode-remote/ssh-remote+lab/home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean:23",
  );
  // the double slash of `file://` is the URL's own: the path keeps its first slash
  assert.equal(editorLink("file://{path}", place), "file:///home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean");
});

test("the path in the project, for a clone elsewhere or a repository's web view", () => {
  assert.equal(
    editorLink("https://github.com/o/r/blob/main/{rel}#L{line}", place),
    "https://github.com/o/r/blob/main/Mathlib/NumberTheory/FLT/Four.lean#L23",
  );
  assert.equal(editorLink("vscode://file/home/me/clone/{rel}:{line}", place), "vscode://file/home/me/clone/Mathlib/NumberTheory/FLT/Four.lean:23");
});

test("paths are escaped where a URL needs it; slashes and the template stay as they are", () => {
  const odd = { path: "/home/a b/Ünï#1/50%?.lean", rel: "Ünï#1/50%?.lean", line: 2, col: 1 };
  assert.equal(editorLink("vscode://file/{path}:{line}", odd), "vscode://file/home/a%20b/%C3%9Cn%C3%AF%231/50%25%3F.lean:2");
  assert.equal(editorLink("x-editor://open?file={rel}&line={line}", odd), "x-editor://open?file=%C3%9Cn%C3%AF%231/50%25%3F.lean&line=2");
  // a place before line 1 or with no column says 1
  assert.equal(editorLink("vscode://file/{path}:{line}:{col}", { ...place, line: 0, col: Number.NaN }), "vscode://file/home/me/mathlib4/Mathlib/NumberTheory/FLT/Four.lean:1:1");
});

test("a template has to be a URL with a scheme that opens something, and name a file", () => {
  assert.equal(invalidTemplate("vscode://file/{path}:{line}:{col}"), null);
  assert.equal(invalidTemplate("vscode://vscode-remote/ssh-remote+HOST{path}:{line}"), null);
  for (const bad of [
    "code --goto {path}:{line}",
    "/usr/bin/code {path}",
    "{path}:{line}",
    "javascript:alert({line})//{path}",
    "JavaScript:alert(1)//{path}",
    "data:text/html,{path}",
    "vscode://file/{file}:{line}",
    "vscode://file/{}{path}",
    "vscode://open?line={line}",
    "vscode://file/{path} :{line}",
    "",
  ]) {
    assert.notEqual(invalidTemplate(bad), null, bad);
    assert.equal(editorLink(bad, place), null, bad);
  }
  assert.match(invalidTemplate("vscode://file/{file}")!, /\{file\}/);
  assert.match(invalidTemplate("vscode://open?line={line}")!, /\{path\}/);
});
