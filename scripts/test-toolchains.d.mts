// The types of scripts/test-toolchains.mjs, for the test that keeps its choice of tests whole.

/** The test files whose answers can depend on the toolchain under test, as paths from the
 *  repository, sorted: those that import test/fixturecopy.ts, themselves or through another module
 *  of test/. */
export function toolchainTests(repo?: string): string[];

/** The toolchains asked for: those named; every one listed (`all`); else the oldest and the newest. */
export function chosenToolchains(named: string[], all: boolean, repo?: string): string[];
