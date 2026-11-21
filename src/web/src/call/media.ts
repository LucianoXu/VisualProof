// The call's media (CallSpec, "Media"): the reader's choices kept in this browser — microphone and
// camera on or off, which devices, the layout —, the codecs this browser can send, and the capture
// and publish options every track of the call is made with. Adapted from Cocoding's meetings.

import { AudioPresets, ScreenSharePresets, VideoPresets } from "livekit-client";
import type { AudioCaptureOptions, BackupVideoCodec, ScreenShareCaptureOptions, TrackPublishDefaults, TrackPublishOptions, VideoCaptureOptions, VideoCodec } from "livekit-client";
import { isBackgroundEffect } from "./model.ts";
import type { BackgroundEffect, LayoutMode } from "./model.ts";

/** One choice kept in this browser: read back with care, and the page works where storage is
 *  blocked (it then keeps the choice while it is open). */
export interface Kept<T> {
  get(): T;
  set(v: T): void;
}

function kept<T>(key: string, fallback: T, valid: (v: unknown) => v is T): Kept<T> {
  let mem: T | undefined;
  return {
    get() {
      if (mem !== undefined) return mem;
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          const v: unknown = JSON.parse(raw);
          if (valid(v)) return (mem = v);
        }
      } catch {
        // blocked, or not ours: the fallback
      }
      return fallback;
    },
    set(v) {
      mem = v;
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // kept while the page is open
      }
    },
  };
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isString = (v: unknown): v is string => typeof v === "string" && v.length < 512;
const isLayout = (v: unknown): v is LayoutMode => v === "auto" || v === "grid" || v === "speaker";

/** What the call keeps in this browser. */
export function callPrefs() {
  return {
    mic: kept("visualproof:call:mic", true, isBool),
    cam: kept("visualproof:call:cam", true, isBool),
    micDevice: kept("visualproof:call:mic-device", "", isString),
    camDevice: kept("visualproof:call:cam-device", "", isString),
    speakerDevice: kept("visualproof:call:speaker-device", "", isString),
    layout: kept<LayoutMode>("visualproof:call:layout", "auto", isLayout),
    /** the camera's background effect (web/src/call/effect.ts) */
    effect: kept<BackgroundEffect>("visualproof:call:background", "none", isBackgroundEffect),
  };
}
export type CallPrefs = ReturnType<typeof callPrefs>;

/** The video codec this browser sends: VP9 where it can, else VP8, else H.264. */
export function sendCodec(): VideoCodec {
  const codecs = typeof RTCRtpSender !== "undefined" && RTCRtpSender.getCapabilities ? (RTCRtpSender.getCapabilities("video")?.codecs ?? []) : [];
  const has = (name: string) => codecs.some((c) => c.mimeType.toLowerCase() === `video/${name}`);
  if (has("vp9")) return "vp9";
  if (has("vp8") || !codecs.length) return "vp8";
  return "h264";
}

/** How a camera captures: 1280×720. */
export function cameraCapture(p: CallPrefs, deviceId = p.camDevice.get()): VideoCaptureOptions {
  return { resolution: VideoPresets.h720.resolution, ...(deviceId ? { deviceId } : {}) };
}

/** How the microphone captures: the browser's noise suppression and echo cancellation, the gain
 *  kept even. */
export function micCapture(p: CallPrefs, deviceId = p.micDevice.get()): AudioCaptureOptions {
  return { noiseSuppression: true, echoCancellation: true, autoGainControl: true, ...(deviceId ? { deviceId } : {}) };
}

/** The defaults every track is published with: simulcast in three layers (VP9 makes them spatial
 *  layers of one stream, with a VP8 backup for whoever cannot receive it), screen share at up to
 *  1080p and 30 frames a second, Opus with DTX and RED. */
export function publishDefaults(): TrackPublishDefaults {
  const codec = sendCodec();
  const backup: BackupVideoCodec = codec === "h264" ? "h264" : "vp8";
  return {
    simulcast: true,
    videoCodec: codec,
    backupCodec: codec === "vp9" ? { codec: backup } : false,
    videoEncoding: VideoPresets.h720.encoding,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    audioPreset: AudioPresets.speech,
    dtx: true,
    red: true,
    stopMicTrackOnMute: false,
  };
}

/** How a presentation captures: the browser's own choice of a screen, a window or a tab (with the
 *  tab's sound where it offers it), at up to 1920×1080 and 30 frames a second, marked as detail —
 *  proofs and code, which must stay sharp. */
export function screenCapture(): ScreenShareCaptureOptions {
  return { audio: true, video: true, resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: "detail", selfBrowserSurface: "exclude", surfaceSwitching: "include", systemAudio: "include" };
}

/** How a presentation is sent: under constraint the frame rate gives way before the resolution. */
export function screenPublish(): TrackPublishOptions {
  return { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding, degradationPreference: "maintain-resolution" };
}

/** The devices of a kind this browser has (labels once a permission was given). */
export async function devices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind && d.deviceId);
  } catch {
    return [];
  }
}

/** A device's name: its label, or its kind and place in the list where the browser gives none. */
export function deviceName(d: MediaDeviceInfo, i: number): string {
  if (d.label) return d.label;
  return `${d.kind === "audioinput" ? "Microphone" : d.kind === "videoinput" ? "Camera" : "Speaker"} ${i + 1}`;
}

/** Whether this browser lets a page choose where audio plays. */
export const canChooseSpeaker = (): boolean => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/** Why a camera or microphone could not be had, in a sentence. */
export function mediaError(err: unknown, what: "camera" | "microphone" | "screen"): string {
  const name = err instanceof Error ? err.name : "";
  if (what === "screen" && name === "NotAllowedError") return "The screen was not shared.";
  if (name === "NotAllowedError" || name === "SecurityError") return `The ${what} is blocked for this page: allow it in the browser's site settings.`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${what} was found.`;
  if (name === "NotReadableError" || name === "AbortError") return `The ${what} is in use by another application.`;
  return `The ${what} could not be started${err instanceof Error && err.message ? `: ${err.message}` : "."}`;
}
