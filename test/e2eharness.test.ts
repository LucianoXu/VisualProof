// The end-to-end harness (scripts/e2e/harness.mjs) without a browser: what it writes is never in the
// repository nor in VisualProof's homes, where real sites and the caches their servers share are;
// its screenshots' names.

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO, refused, scratch, serve, shotName, within } from "../scripts/e2e/harness.mjs";

test("a scenario writes in folders of its own: never the repository, a real site's home or the cache home", async () => {
  const homes = { data: "/home/a/.local/share/visualproof", cache: "/home/a/.cache/visualproof" };
  for (const d of [REPO, join(REPO, "test", "x"), `${homes.data}/sites/p-1`, homes.cache, `${homes.cache}/projects`]) assert.ok(refused(d, homes), d);
  for (const d of [join(tmpdir(), "visualproof-e2e-x"), "/home/a/.cache/visualproof-e2e", `${REPO}-scratch`]) assert.equal(refused(d, homes), null, d);
  assert.ok(within("/a/b/c", "/a/b") && within("/a/b", "/a/b") && !within("/a/bc", "/a/b") && !within("/a", "/a/b"));
  const d = scratch("unit");
  try {
    assert.ok(within(d, tmpdir()) && existsSync(d));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  // refused before anything is started or written
  await assert.rejects(serve({ project: join(REPO, "test", "fixture"), cache: join(REPO, "cache") }), /in the repository/);
  await assert.rejects(serve({ project: join(REPO, "test", "fixture"), dir: join(REPO, "site") }), /in the repository/);
});

test("screenshots are named by their order, the theme and screen, whose page and what it shows", () => {
  assert.equal(shotName(3, { theme: "dark", screen: "desktop" }, "Bob", "public channel"), "03-dark-desktop-bob-public-channel.png");
  assert.equal(shotName(12, { theme: "light", screen: "phone" }, "Alice's AI", "Read-only: the board!"), "12-light-phone-alice-s-ai-read-only-the-board.png");
});
