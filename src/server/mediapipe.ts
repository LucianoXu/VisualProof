// The call's background effect (SPEC/CallSpec.md, "The page"): what the browser runs it with, served
// by this server, never by a third party — MediaPipe's WebAssembly runtime (its loader and binary,
// with SIMD and without, which the browser chooses between) from `@mediapipe/tasks-vision` as it is
// installed beside the server, and the segmentation model from the page's own folder
// (web/mediapipe/, its source and licence in the README there). Five files by name, nothing else.

import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WEB } from "./pipeline.ts";
import { sendFile, sendJson } from "./send.ts";

/** where the page asks for them */
export const MEDIAPIPE_PATH = "/mediapipe/";
const RUNTIME = /^vision_wasm_(nosimd_)?internal\.(js|wasm)$/;
const MODEL = "selfie_segmenter.tflite";

let runtimeDir: string | null | undefined;
/** The runtime's folder, as the package is installed; null where it is not. */
function runtime(): string | null {
  if (runtimeDir !== undefined) return runtimeDir;
  try {
    runtimeDir = join(dirname(fileURLToPath(import.meta.resolve("@mediapipe/tasks-vision"))), "wasm");
  } catch {
    runtimeDir = null;
  }
  return runtimeDir;
}

/** Answer `GET /mediapipe/<name>`: one of the runtime's four files, or the model; 404 otherwise. */
export function serveMediapipe(req: IncomingMessage, res: ServerResponse, path: string): void {
  const name = path.slice(MEDIAPIPE_PATH.length);
  if (name === MODEL) return sendFile(req, res, join(WEB, "mediapipe", MODEL));
  const dir = RUNTIME.test(name) ? runtime() : null;
  if (!dir) return sendJson(res, { error: "not found" }, 404);
  sendFile(req, res, join(dir, name));
}
