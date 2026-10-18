// The transcendental functions the layout computes itself (shared/libm.ts): close to the engine's
// own everywhere, and on the inputs the layout has, to the last bit what Node's Math gave the layout
// before it computed them itself (Node 22 and 24, whose V8 runs the same fdlibm routines), so that
// no layout made before moves. The digests below were taken from Node's Math.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { acos, cos, hypot, log1p, sin } from "../src/shared/libm.ts";

const digest = (xs: number[]) => createHash("sha256").update(new Uint8Array(Float64Array.from(xs).buffer)).digest("hex").slice(0, 16);

let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

/** the angles the layout turns through: round a placed disc (shared/layout.ts, settle), and round a
 *  spot on the hexagonal rings searched for a free one (nearestFree) */
const angles = (): number[] => {
  const a: number[] = [];
  for (let s = 0; s < 24; s++) a.push((2 * Math.PI * s) / 24);
  for (let ring = 1; ring < 400; ring++) for (let k = 0; k < 6 * ring; k++) a.push((2 * Math.PI * k) / (6 * ring));
  return a;
};

/** the heights at which a chord cuts a unit disc's area as the settle looks for them, by halving */
const chords = (): number[] => {
  const t: number[] = [];
  for (let s = 0; s <= 2000; s++) {
    const f = s / 2000;
    let lo = -1, hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      t.push(mid);
      if ((acos(mid) - mid * Math.sqrt(1 - mid * mid)) / Math.PI > f) lo = mid;
      else hi = mid;
    }
  }
  return t;
};

test("the layout's angles, chords, conductances and lengths are what Node's Math gave, to the last bit", () => {
  const a = angles();
  assert.equal(digest(a.map(cos)), "c1d4b0e6036cb56a");
  assert.equal(digest(a.map(sin)), "19ae9a31f29b2472");
  assert.equal(digest(chords().map(acos)), "6965e16199ed248a");
  // a conductance is log(1 + the dependencies between two children), a whole number
  assert.equal(digest(Array.from({ length: 1 << 20 }, (_, i) => log1p(i + 1))), "4dc6cbbf60e31467");
  seed = 7;
  const tenths = Array.from({ length: 200000 }, () => [Math.round((rnd() - 0.5) * 40000) / 10, Math.round((rnd() - 0.5) * 40000) / 10]);
  assert.equal(digest(tenths.map(([x, y]) => hypot(x, y))), "35e389c8496b56dc");
});

test("they are within a unit in the last place of the engine's own, and right at their edges", () => {
  const ulp = (v: number) => {
    const b = new Float64Array([Math.abs(v)]);
    const u = new BigInt64Array(b.buffer);
    u[0] += 1n;
    return b[0] - Math.abs(v);
  };
  const near = (got: number, want: number, what: string) => assert.ok(Object.is(got, want) || Math.abs(got - want) <= ulp(want), `${what}: ${got} against ${want}`);
  seed = 99;
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 2 * 10 ** (rnd() * 5 - 2);
    near(cos(x), Math.cos(x), `cos ${x}`);
    near(sin(x), Math.sin(x), `sin ${x}`);
    const t = rnd() * 2 - 1;
    near(acos(t), Math.acos(t), `acos ${t}`);
    const l = rnd() * 10 ** (rnd() * 12 - 6);
    near(log1p(l), Math.log1p(l), `log1p ${l}`);
    const p = (rnd() - 0.5) * 10 ** (rnd() * 8 - 3), q = (rnd() - 0.5) * 10 ** (rnd() * 8 - 3);
    near(hypot(p, q), Math.hypot(p, q), `hypot ${p} ${q}`);
  }
  assert.equal(acos(1), 0);
  assert.equal(acos(-1), Math.PI);
  assert.ok(Number.isNaN(acos(1.5)));
  assert.equal(log1p(0), 0);
  assert.equal(log1p(-1), -Infinity);
  assert.ok(Number.isNaN(log1p(-2)));
  assert.equal(cos(0), 1);
  assert.ok(Object.is(sin(-0), -0));
  assert.equal(hypot(0, 0), 0);
  assert.equal(hypot(3, 4), 5);
  assert.equal(hypot(-Infinity, NaN), Infinity);
  assert.ok(Number.isNaN(hypot(NaN, 1)));
});
