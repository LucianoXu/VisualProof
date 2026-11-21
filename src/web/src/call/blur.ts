// The background effect's machinery (CallSpec, "The page"): LiveKit's track processor
// (@livekit/track-processors) around MediaPipe's selfie segmentation, which finds the person in each
// camera frame so that only what is behind them is blurred. In the call's own bundle (`call.js`).
// Adapted from Cocoding's meetings (LemmaLight).
//
// The model and MediaPipe's WebAssembly runtime are served by this server (server/mediapipe.ts),
// never by a third party: the processor's own defaults (a CDN, Google's storage) are never reached.
// The processor loads the runtime and the model each time it starts — with every restart of the
// camera (turned on again, another device) — about 10 MB; so they are fetched once a page, kept as
// blob: URLs, and MediaPipe's resolver of the runtime's files hands those out.

import { BackgroundProcessor, BackgroundProcessorWrapper, BackgroundTransformer, ProcessorWrapper } from "@livekit/track-processors";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { Track, TrackProcessor } from "livekit-client";

/** the processor's name on a track: what tells this effect's processor from any other */
export const PROCESSOR_NAME = "visualproof-background";
/** where the server serves the runtime and the model */
const BASE = "/mediapipe";
const MODEL = "selfie_segmenter.tflite";

/** What a WebGL 2 context says of this browser, asked once a page: whether there is one, and whether
 *  it is drawn in software (SwiftShader, llvmpipe: no usable GPU; there the segmentation runs on the
 *  CPU's own delegate, which costs a fraction of a GPU emulated by the CPU). The context asked is
 *  given back at once. The processor's own check made a context each time it was asked — at every
 *  drawing of the pre-join and of the camera's menu, and for every processor — none of them given
 *  back: each costs the page's thread a wait on the graphics process (what made the first Blur
 *  stall), and past 16 the browser drops the oldest context, the board's. */
let probed: { webgl2: boolean; software: boolean } | null = null;
function probe(): { webgl2: boolean; software: boolean } {
  if (probed) return probed;
  probed = { webgl2: false, software: false };
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      probed = { webgl2: true, software: /swiftshader|llvmpipe|softpipe|software/i.test(renderer) };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // no answer: no WebGL 2, as far as the effect goes
  }
  return probed;
}

/** the processor's own check, as it asks it (video frames, an offscreen canvas, WebGL 2), answered
 *  from the one probe */
const transformerSupported = (): boolean =>
  typeof OffscreenCanvas !== "undefined" && typeof VideoFrame !== "undefined" && typeof createImageBitmap !== "undefined" && probe().webgl2;
Object.defineProperty(BackgroundTransformer, "isSupported", { get: transformerSupported, configurable: true });

let canRun: boolean | null = null;
/** Whether this browser can run the effect: WebGL 2, video frames, and a way to make a track. */
export const supported = (): boolean => (canRun ??= transformerSupported() && ProcessorWrapper.isSupported);

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
interface Files {
  fileset: WasmFileset;
  model: string;
}
let files: Promise<Files> | null = null;
const resolveFiles = FilesetResolver.forVisionTasks.bind(FilesetResolver);

async function blobUrl(url: string, type: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${url.replace(/^.*\//, "")} could not be loaded (${res.status})`);
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}

/** The runtime (the variant this browser runs: with SIMD or without) and the model, fetched once. */
function load(): Promise<Files> {
  files ??= (async () => {
    const real = await resolveFiles(new URL(BASE, location.href).href);
    const [loader, wasm, model] = await Promise.all([
      blobUrl(real.wasmLoaderPath, "text/javascript"),
      blobUrl(real.wasmBinaryPath, "application/wasm"),
      blobUrl(`${BASE}/${MODEL}`, "application/octet-stream"),
    ]);
    return { fileset: { wasmLoaderPath: loader, wasmBinaryPath: wasm }, model };
  })();
  // a failure is not kept: the next choice of an effect tries again
  files.catch(() => (files = null));
  return files;
}

/** Fetch the runtime and the model ahead (about 3 MB compressed), off the page's thread: when the
 *  reader is about to choose an effect, so that choosing it does not wait for them. */
export function prefetch(): void {
  if (supported()) load().catch(() => undefined);
}

// MediaPipe's resolver, which the processor calls on every start, answers with the files kept
FilesetResolver.forVisionTasks = async () => (await load()).fileset;

// MediaPipe's runtime says on the console's error channel which TensorFlow Lite delegate it made, at
// every start: nothing anyone can act on, and it is not printed
{
  const error = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^INFO: (Created|Initialized) TensorFlow Lite/.test(args[0])) return;
    error(...args);
  };
}

/** A blur processor of `radius` for a camera track; `frame` hears what each frame took, in ms;
 *  `lost` that its WebGL context was lost under it (the graphics card reset, or dropped by the
 *  browser for newer ones): its camera then shows nothing, until another processor takes over. */
export async function blurProcessor(radius: number, frame: (ms: number) => void, lost: () => void): Promise<TrackProcessor<Track.Kind.Video>> {
  const { model } = await load();
  const p = BackgroundProcessor(
    {
      mode: "background-blur",
      blurRadius: radius,
      assetPaths: { tasksVisionFileSet: new URL(BASE, location.href).href, modelAssetPath: model },
      segmenterOptions: { delegate: probe().software ? "CPU" : "GPU" },
      // the time on the page's thread: the segmentation (run there, synchronously) and the drawing
      onFrameProcessed: (s) => frame(s.filterTimeMs),
    },
    PROCESSOR_NAME,
  );
  givesBackItsContexts(p, lost);
  return p;
}

/** The processor draws on a canvas of its own, whose WebGL context MediaPipe shares; when the
 *  processor is done with it for good (stopped, its track stopped — not restarted, which keeps the
 *  segmenter and so its canvas), the context is given back to the browser at once, rather than when
 *  the canvas is collected: until then it counts among the contexts the browser keeps. A context
 *  lost under the running processor is told (`lost`). */
function givesBackItsContexts(p: ProcessorWrapper<Record<string, unknown>>, lost: () => void): void {
  const canvases = new Set<OffscreenCanvas | HTMLCanvasElement>();
  let done = false;
  const onLost = () => {
    if (!done) lost();
  };
  const init = p.init.bind(p);
  p.init = async (opts) => {
    await init(opts);
    const c = p.canvas;
    if (c && !canvases.has(c)) {
      canvases.add(c);
      c.addEventListener("webglcontextlost", onLost);
    }
  };
  const destroy = p.destroy.bind(p);
  p.destroy = async (opts) => {
    if (!opts?.willProcessorRestart) done = true;
    await destroy(opts);
    if (!done) return;
    for (const c of canvases) {
      c.removeEventListener("webglcontextlost", onLost);
      // the canvas has its WebGL 2 context (setupWebGL made it): asked, it is that one, never a new one
      const gl = c.getContext("webgl2") as WebGL2RenderingContext | null;
      if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    canvases.clear();
  };
}

/** Change the radius of this effect's processor in place; false if `p` is not one. */
export async function setRadius(p: TrackProcessor<Track.Kind.Video> | undefined, radius: number): Promise<boolean> {
  if (!(p instanceof BackgroundProcessorWrapper) || p.name !== PROCESSOR_NAME) return false;
  await p.switchTo({ mode: "background-blur", blurRadius: radius });
  return true;
}
