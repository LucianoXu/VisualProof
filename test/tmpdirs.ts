// A test's folders (server/dirs.ts): its site in the folder it names, as the tests read it, the
// project's caches beside it, and the Lean programs where every run finds them again, compiled once
// per toolchain and version of their source.
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Dirs } from "../src/server/dirs.ts";

export const TEST_LEAN = join(tmpdir(), "visualproof-test-lean");

export function testDirs(site: string): Dirs {
  return { site, cache: `${site}-cache`, lean: TEST_LEAN };
}
