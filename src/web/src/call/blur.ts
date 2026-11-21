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

import { BackgroundProcessor, BackgroundProcessorWrapper, supportsBackgroundProcessors } from "@livekit/track-processors";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { Track, TrackProcessor } from "livekit-client";

/** the processor's name on a track: what tells this effect's processor from any other */
export const PROCESSOR_NAME = "visualproof-background";
/** where the server serves the runtime and the model */
const BASE = "/mediapipe";
const MODEL = "selfie_segmenter.tflite";

/** Whether this browser can run the effect: WebGL 2, video frames, and a way to make a track. */
export const supported = (): boolean => supportsBackgroundProcessors();

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

/** Whether this browser draws WebGL in software (SwiftShader, llvmpipe: no usable GPU). There the
 *  segmentation runs on the CPU's own delegate, which costs a fraction of a GPU emulated by the CPU. */
let software: boolean | null = null;
function softwareGL(): boolean {
  if (software !== null) return software;
  software = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
  } catch {
    // no answer: the GPU, as the processor would
  }
  return software;
}

/** A blur processor of `radius` for a camera track; `frame` hears what each frame took, in ms. */
export async function blurProcessor(radius: number, frame: (ms: number) => void): Promise<TrackProcessor<Track.Kind.Video>> {
  const { model } = await load();
  return BackgroundProcessor(
    {
      mode: "background-blur",
      blurRadius: radius,
      assetPaths: { tasksVisionFileSet: new URL(BASE, location.href).href, modelAssetPath: model },
      segmenterOptions: { delegate: softwareGL() ? "CPU" : "GPU" },
      // the time on the page's thread: the segmentation (run there, synchronously) and the drawing
      onFrameProcessed: (s) => frame(s.filterTimeMs),
    },
    PROCESSOR_NAME,
  );
}

/** Change the radius of this effect's processor in place; false if `p` is not one. */
export async function setRadius(p: TrackProcessor<Track.Kind.Video> | undefined, radius: number): Promise<boolean> {
  if (!(p instanceof BackgroundProcessorWrapper) || p.name !== PROCESSOR_NAME) return false;
  await p.switchTo({ mode: "background-blur", blurRadius: radius });
  return true;
}
