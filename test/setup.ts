// Loaded before every test file (`--import`, package.json): the homes of VisualProof's sites and
// caches (server/dirs.ts) are temporary folders, so that no test reads or writes the user's own.
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_DATA_HOME = join(tmpdir(), "visualproof-test", "data");
process.env.XDG_CACHE_HOME = join(tmpdir(), "visualproof-test", "cache");
