// Small WebGL2 helpers: programs, instanced buffers, colours.

export type RGBA = [number, number, number, number];

const colorCache = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour → premultiplied-ready straight RGBA in 0..1, by letting the browser parse it; with
 *  no browser (the artwork command, ExportSpec decision 21), as `parseColour` reads it. */
export function rgba(css: string, alpha = 1): RGBA {
  const key = css;
  let c = colorCache.get(key);
  if (!c) {
    if (typeof document === "undefined") c = parseColour(css);
    else {
      probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = css || "transparent";
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      c = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
    }
    colorCache.set(key, c);
  }
  return [c[0], c[1], c[2], c[3] * alpha];
}

/** the named colours the page's colours use, and those a canvas takes for granted */
const NAMED: Record<string, string> = { transparent: "#0000", black: "#000", white: "#fff", red: "#f00", green: "#008000", blue: "#00f", gray: "#808080", grey: "#808080", orange: "#ffa500", gold: "#ffd700" };

/** A CSS colour read without a browser, as a canvas would draw it (in 0..1, its alpha straight, its
 *  channels rounded to bytes as a canvas keeps them): `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 *  `rgb()`/`rgba()` (commas or spaces, numbers or percentages, `/ alpha`), `hsl()`/`hsla()` and a few
 *  names; anything else is transparent. */
export function parseColour(css: string): RGBA {
  let s = (css || "").trim().toLowerCase();
  s = NAMED[s] ?? s;
  const byte = (v: number) => Math.round(Math.min(255, Math.max(0, v))) / 255;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0) / 255, n(2) / 255, n(4) / 255, h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!fn) return [0, 0, 0, 0];
  const parts = fn[2].replace(/\//g, " / ").split(/[\s,]+/).filter((x) => x && x !== "/");
  const num = (x: string | undefined, scale: number) => (x === undefined ? NaN : x.endsWith("%") ? (parseFloat(x) / 100) * scale : parseFloat(x));
  const a = parts.length > 3 ? Math.min(1, Math.max(0, num(parts[3], 1))) : 1;
  if (fn[1].startsWith("rgb")) {
    const [r, g, b] = [0, 1, 2].map((i) => num(parts[i], 255));
    return [r, g, b].some(Number.isNaN) ? [0, 0, 0, 0] : [byte(r), byte(g), byte(b), Number.isNaN(a) ? 1 : Math.round(a * 255) / 255];
  }
  const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360, sat = num(parts[1], 1), l = num(parts[2], 1);
  if ([h, sat, l].some(Number.isNaN)) return [0, 0, 0, 0];
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const t = (x: number) => {
    x = (x + 1) % 1;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  return [byte(t(h + 1 / 3) * 255), byte(t(h) * 255), byte(t(h - 1 / 3) * 255), Number.isNaN(a) ? 1 : Math.round(a * 255) / 255];
}

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** A growable float buffer of fixed-stride instances, uploaded on demand; with no context (a
 *  renderer kept to its data, ExportSpec decision 21), never uploaded. */
export class Instances {
  data: Float32Array;
  count = 0;
  readonly stride: number;
  readonly buffer: WebGLBuffer | null;
  private gl: WebGL2RenderingContext | null;
  private uploaded = -1;
  private version = 0;

  constructor(gl: WebGL2RenderingContext | null, stride: number, capacity = 1024) {
    this.gl = gl;
    this.stride = stride;
    this.data = new Float32Array(stride * capacity);
    this.buffer = gl ? gl.createBuffer()! : null;
  }

  clear(): void {
    this.count = 0;
    this.version++;
  }

  /** Room for one more instance; returns its offset into `data`. */
  push(): number {
    if ((this.count + 1) * this.stride > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.version++;
    return this.count++ * this.stride;
  }

  touch(): void {
    this.version++;
  }

  upload(): void {
    if (this.uploaded === this.version) return;
    const gl = this.gl;
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * this.stride), gl.DYNAMIC_DRAW);
    this.uploaded = this.version;
  }
}
