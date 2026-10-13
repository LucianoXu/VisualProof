// Small WebGL2 helpers: programs, instanced buffers, colours.

export type RGBA = [number, number, number, number];

const colorCache = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour → premultiplied-ready straight RGBA in 0..1, by letting the browser parse it. */
export function rgba(css: string, alpha = 1): RGBA {
  const key = css;
  let c = colorCache.get(key);
  if (!c) {
    probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = css || "transparent";
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    c = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
    colorCache.set(key, c);
  }
  return [c[0], c[1], c[2], c[3] * alpha];
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

/** A growable float buffer of fixed-stride instances, uploaded on demand. */
export class Instances {
  data: Float32Array;
  count = 0;
  readonly stride: number;
  readonly buffer: WebGLBuffer;
  private gl: WebGL2RenderingContext;
  private uploaded = -1;
  private version = 0;

  constructor(gl: WebGL2RenderingContext, stride: number, capacity = 1024) {
    this.gl = gl;
    this.stride = stride;
    this.data = new Float32Array(stride * capacity);
    this.buffer = gl.createBuffer()!;
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
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * this.stride), gl.DYNAMIC_DRAW);
    this.uploaded = this.version;
  }
}
