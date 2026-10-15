// The WebGL renderer: named layers of instanced circles and segments, drawn in order. Everything is
// stored in world coordinates; the camera is a uniform, so panning and zooming upload nothing.

import { Instances, program } from "./gl.ts";

const CIRCLE_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_geo;     // x, y, r, unit (0 world, 1 px, 2 dot)
layout(location=2) in vec4 a_fill;
layout(location=3) in vec4 a_stroke;
layout(location=4) in vec4 a_extra;   // stroke width px, flags, ring offset px, min radius px
uniform vec2 u_cam;
uniform float u_k;
uniform vec2 u_view;
uniform float u_dot;
out vec2 v_local;
out float v_r;
out vec4 v_fill;
out vec4 v_stroke;
out vec3 v_extra;
void main() {
  float r = a_geo.w < 0.5 ? a_geo.z * u_k : (a_geo.w < 1.5 ? a_geo.z : a_geo.z * u_dot);
  r = max(r, a_extra.w);
  float ext = max(r, r + a_extra.z + a_extra.x * 0.5) + 2.0;
  vec2 c = (a_geo.xy - u_cam) * u_k + u_view * 0.5;
  vec2 p = c + a_corner * ext;
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_local = a_corner * ext;
  v_r = r;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_extra = a_extra.xyz;
}`;

const CIRCLE_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_r;
in vec4 v_fill;
in vec4 v_stroke;
in vec3 v_extra;
uniform float u_aa;
out vec4 o;
void main() {
  float d = length(v_local);
  float w = max(fwidth(d), u_aa);
  int flags = int(v_extra.y + 0.5);
  float fa = (1.0 - smoothstep(v_r - w, v_r + w, d)) * v_fill.a;
  // an artwork's looks (ExportSpec decision 19): a glow fading from the centre to nothing at the
  // edge; or a fill fading from a light up and to the left to a quarter at the edge
  if ((flags & 4) != 0) fa = pow(1.0 - clamp(d / max(v_r, 0.001), 0.0, 1.0), 2.0) * v_fill.a;
  else if ((flags & 8) != 0) fa *= mix(1.0, 0.25, clamp(length(v_local / max(v_r, 1.0) - vec2(-0.25, -0.3)) / 1.3, 0.0, 1.0));
  vec3 fill = v_fill.rgb;
  if ((flags & 2) != 0) {
    // a soft light from the top left, for folded clusters
    float t = clamp(length(v_local / max(v_r, 1.0) - vec2(-0.4, -0.4)) / 1.5, 0.0, 1.0);
    fill = mix(min(fill * 1.3 + 0.1, 1.0), fill * 0.82, t);
  }
  float sa = 0.0;
  if (v_extra.x > 0.0) {
    float rr = v_r + v_extra.z;
    sa = (1.0 - smoothstep(v_extra.x * 0.5 - w, v_extra.x * 0.5 + w, abs(d - rr))) * v_stroke.a;
    // a halo: the ring fading from full on its circle to nothing at its edges
    if ((flags & 16) != 0) sa = pow(clamp(1.0 - abs(d - rr) / (v_extra.x * 0.5), 0.0, 1.0), 2.0) * v_stroke.a;
    if ((flags & 1) != 0) {
      float s = atan(v_local.y, v_local.x) * rr;
      if (mod(s, 9.0) > 5.0) sa = 0.0;
    }
  }
  vec4 col = vec4(v_stroke.rgb * sa, sa) + vec4(fill * fa, fa) * (1.0 - sa);
  if (col.a < 0.002) discard;
  o = col;
}`;

// Small markers (dots, rings) as point sprites: one vertex each instead of an instanced quad.
// Much cheaper where WebGL runs in software, and no worse on a GPU.
const POINT_VS = `#version 300 es
layout(location=1) in vec4 a_geo;
layout(location=2) in vec4 a_fill;
layout(location=3) in vec4 a_stroke;
layout(location=4) in vec4 a_extra;
uniform vec2 u_cam;
uniform float u_k;
uniform vec2 u_view;
uniform float u_dot;
uniform float u_dpr;
out float v_ext;
out float v_r;
out vec4 v_fill;
out vec4 v_stroke;
out vec3 v_extra;
void main() {
  float r = a_geo.w < 0.5 ? a_geo.z * u_k : (a_geo.w < 1.5 ? a_geo.z : a_geo.z * u_dot);
  r = max(r, a_extra.w);
  float ext = max(r, r + a_extra.z + a_extra.x * 0.5) + 1.5;
  vec2 c = (a_geo.xy - u_cam) * u_k + u_view * 0.5;
  gl_Position = vec4(c.x / u_view.x * 2.0 - 1.0, 1.0 - c.y / u_view.y * 2.0, 0.0, 1.0);
  gl_PointSize = 2.0 * ext * u_dpr;
  v_ext = ext;
  v_r = r;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_extra = a_extra.xyz;
}`;

const POINT_FS = CIRCLE_FS.replace("in vec2 v_local;", "in float v_ext;").replace(
  "float d = length(v_local);",
  "vec2 v_local = (gl_PointCoord * 2.0 - 1.0) * v_ext;\n  float d = length(v_local);",
);

// Bundled edges (Holten 2006). An edge is a uniform cubic B-spline through the world positions of
// the clusters on its tree path, straightened by beta. Positions come from a texture the canvas
// refreshes when things move, so the curves follow motion without being rebuilt. Each edge is one
// instance drawn as a triangle strip of 2 (SEGS + 1) vertices: every vertex evaluates the spline
// once, from the four control points of its span, and takes its normal from the derivative. An edge
// through eight clusters has nine spans: at 14 pieces it showed its corners, at 48 it reads as the
// curve it is (the owner's request, 2026-10-10). The cost is vertices alone — about 150,000 a frame
// for the 1,500 edges a board draws — and a frame took no longer, even rendered without a GPU.
export const BUNDLE_SEGS = 48;
const BUNDLE_VS = `#version 300 es
layout(location=1) in vec4 a_i0;      // control point indices 0..3 (positions texture)
layout(location=2) in vec4 a_i1;      // control point indices 4..7
layout(location=3) in vec4 a_meta;    // count, beta, width px, -
layout(location=4) in vec4 a_c0;      // colour at the source
layout(location=5) in vec4 a_c1;      // colour at the target
uniform vec2 u_cam;
uniform float u_k;
uniform vec2 u_view;
uniform highp sampler2D u_pos;
uniform int u_segs;
out float v_across;
out float v_hw;
out vec4 v_color;
vec2 P(int j) {
  int i = int((j < 4 ? a_i0[j] : a_i1[j - 4]) + 0.5);
  return texelFetch(u_pos, ivec2(i % 1024, i / 1024), 0).xy;
}
void main() {
  int n = int(a_meta.x + 0.5);
  float beta = a_meta.y;
  int k = gl_VertexID / 2;
  float side = float(gl_VertexID % 2) * 2.0 - 1.0;
  float t = float(k) / float(u_segs);
  vec2 a = P(0), b = P(n - 1);
  // clamped uniform cubic B-spline over the control points straightened towards the chord
  float x = t * float(n + 1);
  int s = min(int(x), n);
  float f = x - float(s);
  vec2 q0, q1, q2, q3;
  float den = float(max(n - 1, 1));
  int j0 = clamp(s - 2, 0, n - 1), j1 = clamp(s - 1, 0, n - 1), j2 = clamp(s, 0, n - 1), j3 = clamp(s + 1, 0, n - 1);
  q0 = mix(a + (b - a) * (float(j0) / den), P(j0), beta);
  q1 = mix(a + (b - a) * (float(j1) / den), P(j1), beta);
  q2 = mix(a + (b - a) * (float(j2) / den), P(j2), beta);
  q3 = mix(a + (b - a) * (float(j3) / den), P(j3), beta);
  float f2 = f * f, f3 = f2 * f, g = 1.0 - f;
  vec2 w = q0 * (g * g * g / 6.0) + q1 * ((4.0 - 6.0 * f2 + 3.0 * f3) / 6.0)
         + q2 * ((1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0) + q3 * (f3 / 6.0);
  vec2 tg = q0 * (-0.5 * g * g) + q1 * (0.5 * (3.0 * f2 - 4.0 * f))
          + q2 * (0.5 * (-3.0 * f2 + 2.0 * f + 1.0)) + q3 * (0.5 * f2);
  // the ends are clamped (repeated control points), where the derivative vanishes
  if (dot(tg, tg) < 1e-12) tg = q3 - q0;
  if (dot(tg, tg) < 1e-12) tg = b - a;
  if (dot(tg, tg) < 1e-12) tg = vec2(1.0, 0.0);
  vec2 nrm = normalize(vec2(-tg.y, tg.x));
  float hw = a_meta.z * 0.5 + 1.0;
  vec2 p = (w - u_cam) * u_k + u_view * 0.5 + nrm * side * hw;
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_across = side * hw;
  v_hw = a_meta.z * 0.5;
  v_color = mix(a_c0, a_c1, t);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec2 a_corner;  // along in {0,1}, across in {-1,1}
layout(location=1) in vec4 a_seg;     // x0, y0, x1, y1
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_extra;   // width px
uniform vec2 u_cam;
uniform float u_k;
uniform vec2 u_view;
out float v_across;
out float v_hw;
out vec4 v_color;
void main() {
  vec2 p0 = (a_seg.xy - u_cam) * u_k + u_view * 0.5;
  vec2 p1 = (a_seg.zw - u_cam) * u_k + u_view * 0.5;
  vec2 d = p1 - p0;
  float len = max(length(d), 1e-4);
  vec2 n = vec2(-d.y, d.x) / len;
  float hw = a_extra.x * 0.5 + 1.0;
  vec2 p = mix(p0, p1, a_corner.x) + n * a_corner.y * hw;
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_across = a_corner.y * hw;
  v_hw = a_extra.x * 0.5;
  v_color = a_color;
}`;

const LINE_FS = `#version 300 es
precision highp float;
in float v_across;
in float v_hw;
in vec4 v_color;
uniform float u_aa;
out vec4 o;
void main() {
  float w = max(fwidth(v_across), u_aa);
  float a = (1.0 - smoothstep(v_hw - w, v_hw + w, abs(v_across))) * v_color.a;
  if (a < 0.002) discard;
  o = vec4(v_color.rgb * a, a);
}`;

/** Floats per circle instance: geo(4) fill(4) stroke(4) extra(4). */
export const CIRCLE_STRIDE = 16;
/** Floats per segment instance: seg(4) color(4) extra(4). */
export const LINE_STRIDE = 12;
/** Floats per bundled edge: indices(8) meta(4) colours(8). */
export const BUNDLE_STRIDE = 20;

export const UNIT_WORLD = 0, UNIT_PX = 1, UNIT_DOT = 2;
export const FLAG_DASHED = 1, FLAG_SHADED = 2;
/** an artwork's looks (ExportSpec decision 19): a glow, its fill fading from the centre to nothing; a
 *  fill fading from a light at the top left to a quarter at the edge; a ring fading to its edges */
export const FLAG_GLOW = 4, FLAG_RADIAL = 8, FLAG_HALO = 16;

/** Write one bundled edge: up to 8 control point indices into the positions texture. */
export function bundle(L: Instances, path: readonly number[], beta: number, widthPx: number, c0: readonly number[], c1: readonly number[]): void {
  bundlePath(L, path, 0, path.length, beta, widthPx, c0, c1);
}

/** A bundled edge whose `len` control points are `paths[off ..]` (the overview's packed looks,
 *  web/src/overview.ts). */
export function bundlePath(L: Instances, paths: ArrayLike<number>, off: number, len: number, beta: number, widthPx: number, c0: readonly number[], c1: readonly number[]): void {
  const o = L.push();
  const d = L.data;
  for (let k = 0; k < 8; k++) d[o + k] = paths[off + Math.min(k, len - 1)];
  d[o + 8] = len; d[o + 9] = beta; d[o + 10] = widthPx; d[o + 11] = 0;
  d[o + 12] = c0[0]; d[o + 13] = c0[1]; d[o + 14] = c0[2]; d[o + 15] = c0[3];
  d[o + 16] = c1[0]; d[o + 17] = c1[1]; d[o + 18] = c1[2]; d[o + 19] = c1[3];
}


export type Kind = "circles" | "points" | "lines" | "bundles";

interface Layer {
  kind: Kind;
  inst: Instances;
  vao: WebGLVertexArrayObject;
  visible: boolean;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private circleProg: WebGLProgram;
  private pointProg: WebGLProgram;
  private bundleProg: WebGLProgram;
  private posTex: WebGLTexture;
  private posRows = 0;
  private dpr = 1;
  private lineProg: WebGLProgram;
  private layers = new Map<string, Layer>();
  private order: string[] = [];
  private circleCorners: WebGLBuffer;
  private lineCorners: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
    this.circleProg = program(gl, CIRCLE_VS, CIRCLE_FS);
    this.pointProg = program(gl, POINT_VS, POINT_FS);
    this.bundleProg = program(gl, BUNDLE_VS, LINE_FS);
    this.posTex = gl.createTexture()!;
    this.lineProg = program(gl, LINE_VS, LINE_FS);
    this.circleCorners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleCorners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.lineCorners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineCorners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
  }

  /** A layer, created on first use; layers draw in the order they were first asked for. */
  layer(name: string, kind: Kind): Instances {
    const hit = this.layers.get(name);
    if (hit) return hit.inst;
    const gl = this.gl;
    const stride = kind === "lines" ? LINE_STRIDE : kind === "bundles" ? BUNDLE_STRIDE : CIRCLE_STRIDE;
    const inst = new Instances(gl, stride);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    if (kind === "circles" || kind === "lines") {
      gl.bindBuffer(gl.ARRAY_BUFFER, kind === "lines" ? this.lineCorners : this.circleCorners);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffer);
    const groups = kind === "lines" ? 3 : kind === "bundles" ? 5 : 4;
    for (let a = 0; a < groups; a++) {
      gl.enableVertexAttribArray(1 + a);
      gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, stride * 4, a * 16);
      // points: one vertex per marker; quads and bundled edges: one instance each
      gl.vertexAttribDivisor(1 + a, kind === "points" ? 0 : 1);
    }
    gl.bindVertexArray(null);
    this.layers.set(name, { kind, inst, vao, visible: true });
    this.order.push(name);
    return inst;
  }

  /** World positions the bundled edges read: (x, y) pairs, 1024 per texture row. */
  setPositions(xy: Float32Array): void {
    const gl = this.gl;
    const count = xy.length / 2;
    const rows = Math.max(1, Math.ceil(count / 1024));
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const padded = new Float32Array(rows * 1024 * 2);
    padded.set(xy);
    if (rows !== this.posRows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1024, rows, 0, gl.RG, gl.FLOAT, padded);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.posRows = rows;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, rows, gl.RG, gl.FLOAT, padded);
    }
  }

  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  private uniform(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uniforms.get(prog);
    if (!m) this.uniforms.set(prog, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(prog, name));
    return m.get(name)!;
  }

  /** For diagnosis: hide or show a layer. */
  setVisible(name: string, on: boolean): void {
    const L = this.layers.get(name);
    if (L) L.visible = on;
  }

  /** The layers drawn, in their order: what an artwork's SVG writes as vectors (ExportSpec decision
   *  19, web/src/artwork.ts). */
  drawn(): { name: string; kind: Kind; data: Float32Array; count: number; stride: number }[] {
    return this.order.flatMap((name) => {
      const L = this.layers.get(name)!;
      return L.visible && L.inst.count ? [{ name, kind: L.kind, data: L.inst.data, count: L.inst.count, stride: L.inst.stride }] : [];
    });
  }

  /** The most pixels a side of what this context draws at once can have. */
  maxSide(): number {
    const gl = this.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(dims[0], dims[1], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);
  }

  /** Draw every layer through camera `cam`, on `w` × `h` CSS pixels of `dpr` pixels each. `aa`: the
   *  least width an edge's soft rim has, in CSS pixels — a picture drawn at more pixels than the
   *  screen's (an artwork's PNG) keeps it as wide in pixels as the screen does. */
  render(cam: { x: number; y: number; k: number }, w: number, h: number, dpr: number, dotPx: number, aa = 0.35): void {
    const gl = this.gl;
    gl.viewport(0, 0, Math.round(w * dpr), Math.round(h * dpr));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const name of this.order) {
      const L = this.layers.get(name)!;
      if (!L.visible || L.inst.count === 0) continue;
      L.inst.upload();
      const prog =
        L.kind === "circles" ? this.circleProg
        : L.kind === "points" ? this.pointProg
        : L.kind === "bundles" ? this.bundleProg
        : this.lineProg;
      gl.useProgram(prog);
      const u = (name: string) => this.uniform(prog, name);
      gl.uniform2f(u("u_cam"), cam.x, cam.y);
      gl.uniform1f(u("u_k"), cam.k);
      gl.uniform2f(u("u_view"), w, h);
      gl.uniform1f(u("u_aa"), aa);
      if (L.kind === "circles" || L.kind === "points") gl.uniform1f(u("u_dot"), dotPx);
      if (L.kind === "points") gl.uniform1f(u("u_dpr"), dpr);
      gl.bindVertexArray(L.vao);
      if (L.kind === "bundles") {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.posTex);
        gl.uniform1i(u("u_pos"), 1);
        gl.uniform1i(u("u_segs"), BUNDLE_SEGS);
      }
      if (L.kind === "points") gl.drawArrays(gl.POINTS, 0, L.inst.count);
      else if (L.kind === "bundles") gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * (BUNDLE_SEGS + 1), L.inst.count);
      else gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.inst.count);
    }
    gl.bindVertexArray(null);
  }
}

/** Write one circle instance. */
export function circle(
  L: Instances,
  x: number, y: number, r: number, unit: number,
  fill: readonly number[], stroke: readonly number[] | null = null,
  strokePx = 0, flags = 0, ringOffset = 0, minPx = 0,
): void {
  const o = L.push();
  const d = L.data;
  d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = unit;
  d[o + 4] = fill[0]; d[o + 5] = fill[1]; d[o + 6] = fill[2]; d[o + 7] = fill[3];
  if (stroke) {
    d[o + 8] = stroke[0]; d[o + 9] = stroke[1]; d[o + 10] = stroke[2]; d[o + 11] = stroke[3];
  } else {
    d[o + 8] = d[o + 9] = d[o + 10] = d[o + 11] = 0;
  }
  d[o + 12] = strokePx; d[o + 13] = flags; d[o + 14] = ringOffset; d[o + 15] = minPx;
}

/** Write one segment instance. */
export function segment(L: Instances, x0: number, y0: number, x1: number, y1: number, color: readonly number[], widthPx: number): void {
  const o = L.push();
  const d = L.data;
  d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
  d[o + 4] = color[0]; d[o + 5] = color[1]; d[o + 6] = color[2]; d[o + 7] = color[3];
  d[o + 8] = widthPx; d[o + 9] = 0; d[o + 10] = 0; d[o + 11] = 0;
}
