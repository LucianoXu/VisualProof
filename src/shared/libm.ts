// The transcendental functions the layout uses, the same on every engine (CanvasSpec, "Dependency
// order", the same picture everywhere).
//
// ECMAScript fixes + − × ÷ and √ to the last bit, but leaves Math.sin, cos, acos, log1p, hypot and
// the like to each engine: Chrome and Node, two builds of V8, already differ in the last digit of
// some, and the layout amplifies a last digit into a different picture (a board laid out on the
// page beside the same board laid out on the server moved 91 of its 184 declarations). So the
// layout computes them here, from the operations every engine computes alike: ports of the fdlibm
// routines (Sun's freely distributable libm, as FreeBSD's msun keeps it) that V8 itself runs, and
// V8's own Math.hypot. On Node they give what Math gives to the last bit, so that no layout the
// server made before moves (test/libm.test.ts checks them against Node's Math on the inputs the
// layout has); on any other engine they give the same.
//
// Only what the layout needs: arguments past the reach of the medium-sized argument reduction (a
// quarter of a million radians) are not reduced exactly, and are never asked for.

// a double's two 32-bit words, read and written through one buffer
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
/** the index of the high word: the layout runs on little-endian machines, but this does not assume it */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

function hiWord(x: number): number {
  f64[0] = x;
  return u32[HI] | 0;
}
function loWord(x: number): number {
  f64[0] = x;
  return u32[LO] >>> 0;
}
function withHi(x: number, hi: number): number {
  f64[0] = x;
  u32[HI] = hi >>> 0;
  return f64[0];
}
function withLo(x: number, lo: number): number {
  f64[0] = x;
  u32[LO] = lo >>> 0;
  return f64[0];
}
function fromWords(hi: number, lo: number): number {
  u32[HI] = hi >>> 0;
  u32[LO] = lo >>> 0;
  return f64[0];
}

/** √(x² + y²), as V8 computes Math.hypot of two numbers: each divided by the larger magnitude,
 *  squared and summed (Kahan's compensation, which two terms leave at zero), the square root
 *  scaled back. */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  if (ax !== ax || ay !== ay) return NaN;
  const max = ax > ay ? ax : ay;
  if (max === 0) return 0;
  const a = ax / max, b = ay / max;
  return Math.sqrt(a * a + b * b) * max;
}

// fdlibm e_acos.c
const PI = 3.14159265358979311600e+00;
const PIO2_HI = 1.57079632679489655800e+00;
const PIO2_LO = 6.12323399573676603587e-17;
const pS0 = 1.66666666666666657415e-01;
const pS1 = -3.25565818622400915405e-01;
const pS2 = 2.01212532134862925881e-01;
const pS3 = -4.00555345006794114027e-02;
const pS4 = 7.91534994289814532176e-04;
const pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00;
const qS2 = 2.02094576023350569471e+00;
const qS3 = -6.88283971605453293030e-01;
const qS4 = 7.70381505559019352791e-02;

/** arccos x, in [0, π]. */
export function acos(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return hx > 0 ? 0.0 : PI + 2.0 * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x;
    const p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    const q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    const r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  } else if (hx < 0) {
    // x < -0.5
    const z = (1.0 + x) * 0.5;
    const p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    const q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    const s = Math.sqrt(z);
    const r = p / q;
    const w = r * s - PIO2_LO;
    return PI - 2.0 * (s + w);
  } else {
    // x > 0.5
    const z = (1.0 - x) * 0.5;
    const s = Math.sqrt(z);
    const df = withLo(s, 0);
    const c = (z - df * df) / (s + df);
    const p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    const q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    const r = p / q;
    const w = r * s + c;
    return 2.0 * (df + w);
  }
}

// fdlibm s_log1p.c
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const Lp1 = 6.666666666666735130e-01;
const Lp2 = 3.999999999940941908e-01;
const Lp3 = 2.857142874366239149e-01;
const Lp4 = 2.222219843214978396e-01;
const Lp5 = 1.818357216161805012e-01;
const Lp6 = 1.531383769920937332e-01;
const Lp7 = 1.479819860511658591e-01;

/** log(1 + x), exact for small x. */
export function log1p(x: number): number {
  const hx = hiWord(x);
  const ax = hx & 0x7fffffff;
  let k = 1;
  let f = 0, c = 0, hu = 0;
  if (hx < 0x3fda827a) {
    // 1 + x < √2
    if (ax >= 0x3ff00000) return x === -1.0 ? -Infinity : NaN;
    if (ax < 0x3e200000) {
      // |x| < 2^-29
      if (ax < 0x3c900000) return x;
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      // √2/2 - 1 <= x < √2 - 1
      k = 0;
      f = x;
      hu = 1;
    }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u: number;
    if (hx < 0x43400000) {
      u = 1.0 + x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      // the correction term
      c = k > 0 ? 1.0 - (u - x) : x - (u - 1.0);
      c /= u;
    } else {
      u = x;
      hu = hiWord(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    // u, or u/2, normalised into [√2/2, √2]
    if (hu < 0x6a09e) {
      u = withHi(u, hu | 0x3ff00000);
    } else {
      k += 1;
      u = withHi(u, hu | 0x3fe00000);
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1.0;
  }
  const hfsq = 0.5 * f * f;
  if (hu === 0) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      c += k * LN2_LO;
      return k * LN2_HI + c;
    }
    const R = hfsq * (1.0 - 0.66666666666666666 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - ((R - (k * LN2_LO + c)) - f);
  }
  const s = f / (2.0 + f);
  const z = s * s;
  const R = z * (Lp1 + z * (Lp2 + z * (Lp3 + z * (Lp4 + z * (Lp5 + z * (Lp6 + z * Lp7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + (k * LN2_LO + c))) - f);
}

// fdlibm k_sin.c, k_cos.c
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1.0;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1.0 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const iz = 0.5 * z - qx;
  const a = 1.0 - qx;
  return a - (iz - (z * r - x * y));
}

// fdlibm e_rem_pio2.c, without the large arguments' reduction
const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c,
  0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb, 0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c,
  0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];

/** x reduced by a multiple n of π/2 into [-π/4, π/4], as y0 + y1; returns n. */
const red = new Float64Array(2);
function remPio2(x: number): number {
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    red[0] = x;
    red[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3π/4: n = ±1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        red[0] = z - PIO2_1T;
        red[1] = (z - red[0]) - PIO2_1T;
      } else {
        z -= PIO2_2;
        red[0] = z - PIO2_2T;
        red[1] = (z - red[0]) - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      red[0] = z + PIO2_1T;
      red[1] = (z - red[0]) + PIO2_1T;
    } else {
      z += PIO2_2;
      red[0] = z + PIO2_2T;
      red[1] = (z - red[0]) + PIO2_2T;
    }
    return -1;
  }
  if (ix > 0x413921fb) throw new RangeError("libm: argument out of range");
  // medium size: |x| <= 2^19 π/2
  let t = Math.abs(x);
  const n = Math.trunc(t * INVPIO2 + 0.5);
  const fn = n;
  let r = t - fn * PIO2_1;
  let w = fn * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    red[0] = r - w;
  } else {
    const j = ix >> 20;
    red[0] = r - w;
    let i = j - ((hiWord(red[0]) >> 20) & 0x7ff);
    if (i > 16) {
      // a second iteration, good to 118 bits
      t = r;
      w = fn * PIO2_2;
      r = t - w;
      w = fn * PIO2_2T - ((t - r) - w);
      red[0] = r - w;
      i = j - ((hiWord(red[0]) >> 20) & 0x7ff);
      if (i > 49) {
        // a third, 151 bits
        t = r;
        w = fn * PIO2_3;
        r = t - w;
        w = fn * PIO2_3T - ((t - r) - w);
        red[0] = r - w;
      }
    }
  }
  red[1] = (r - red[0]) - w;
  if (hx < 0) {
    red[0] = -red[0];
    red[1] = -red[1];
    return -n;
  }
  return n;
}

/** sin x, for |x| up to 2^19 π/2. */
export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(red[0], red[1], 1);
    case 1:
      return kernelCos(red[0], red[1]);
    case 2:
      return -kernelSin(red[0], red[1], 1);
    default:
      return -kernelCos(red[0], red[1]);
  }
}

/** cos x, for |x| up to 2^19 π/2. */
export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(red[0], red[1]);
    case 1:
      return -kernelSin(red[0], red[1], 1);
    case 2:
      return -kernelCos(red[0], red[1]);
    default:
      return kernelSin(red[0], red[1], 1);
  }
}
