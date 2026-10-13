// Who may reach the server (server/access.ts): with a key, only those given its link — a cookie
// for a browser, the key itself for an agent — and nothing at all for anyone else.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Access, KEY_PATH, loadKey, newKey } from "../src/server/access.ts";

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage;

test("the link lets a browser in with a cookie; the key lets an agent in; nothing else gets in", () => {
  const key = newKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const A = new Access(key);
  assert.equal(A.link, `${KEY_PATH}${key}`, "the link a page that is in may share");
  assert.equal(A.admit(req(), "/"), "out");
  assert.equal(A.admit(req(), "/api/agent"), "out");
  assert.equal(A.admit(req(), `${KEY_PATH}${key.slice(1)}`), "out", "a wrong key");
  assert.equal(A.admit(req(), KEY_PATH), "out");
  const entered = A.admit(req(), `${KEY_PATH}${key}`);
  assert.ok(typeof entered === "object");
  const cookie = entered.enter.split(";")[0];
  assert.match(entered.enter, /HttpOnly/);
  assert.ok(!cookie.includes(key), "the key itself is in no cookie");
  assert.equal(A.admit(req({ cookie: `other=1; ${cookie}` }), "/api/events"), "in");
  assert.equal(A.admit(req({ cookie: `${cookie}x` }), "/"), "out");
  assert.equal(A.admit(req({ cookie: `visualproof_access=${key}` }), "/"), "out", "the key is not the cookie");
  assert.equal(A.admit(req({ authorization: `Bearer ${key}` }), "/api/agent/views"), "in");
  assert.equal(A.admit(req({ authorization: `Bearer ${newKey()}` }), "/api/agent"), "out");
  assert.equal(new Access(newKey()).admit(req({ cookie }), "/"), "out", "a new key: the old cookies are out");
});

test("a key file is made once, readable by its owner alone, and must hold a key", () => {
  const dir = mkdtempSync(join(tmpdir(), "vp-access-"));
  try {
    const file = join(dir, "VisualProof.key");
    const made = loadKey(file);
    assert.equal(made.made, true);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(loadKey(file), { key: made.key, made: false });
    assert.equal(readFileSync(file, "utf8").trim(), made.key);
    writeFileSync(file, "short\n");
    assert.throws(() => loadKey(file), /does not hold a key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
