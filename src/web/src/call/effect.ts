// The camera's background effect (CallSpec, "The page"): None, Blur or Strong blur, kept in this
// browser (web/src/call/media.ts), put on the camera's track from the pre-join's preview on — the
// track the call publishes is the preview's, so what the others receive is what the preview showed.
// Switching it in the call changes the published track in place. What the effect costs is watched
// (model.ts, FrameLoad): when a frame takes too long on average, `slow` says so, once, so that the
// reader can turn it off. Adapted from Cocoding's meetings (LemmaLight).

import type { LocalVideoTrack } from "livekit-client";
import * as blur from "./blur.ts";
import { blurRadius, FrameLoad } from "./model.ts";
import type { BackgroundEffect } from "./model.ts";

/** The browser cannot run the effect (no WebGL 2, no video frames). */
export class EffectUnsupported extends Error {
  constructor() {
    super("This browser cannot blur the background.");
    this.name = "EffectUnsupported";
  }
}

export interface EffectEvents {
  /** the effect costs this computer too much: `ms` a frame on average */
  slow(ms: number): void;
  /** the effect, lost under the camera, could not be put back on */
  failed(e: unknown): void;
}

/** how many times an effect lost under the camera is put back on within a minute, at most: past that
 *  the page holds more WebGL than the browser keeps, and another processor would push out another */
const HEALS_A_MINUTE = 3;

export class CameraEffect {
  private readonly events: EffectEvents;
  /** the effect each track carries; a track not here carries none */
  private readonly on = new WeakMap<LocalVideoTrack, BackgroundEffect>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly load = new FrameLoad();
  private heals: number[] = [];
  /** the frames the effect has drawn on this page (for diagnosis: the call's test reads it) */
  frames = 0;

  constructor(events: EffectEvents) {
    this.events = events;
  }

  /** Whether this browser can blur at all: where it cannot, no effect is offered. */
  get supported(): boolean {
    return blur.supported();
  }

  /** The reader is about to choose an effect: its runtime is fetched meanwhile. */
  prefetch(): void {
    blur.prefetch();
  }

  /** the effect `track` carries now */
  of(track: LocalVideoTrack | null | undefined): BackgroundEffect {
    return (track && this.on.get(track)) ?? "none";
  }

  /** an effect is being put on (the first time, its runtime is loading) */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** Once every change asked for is done (what Join waits for: the camera is never sent bare while
   *  its effect is being put on). */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Put `effect` on `track`. Changes run one after another, in the order asked. It fails when the
   *  browser cannot run the effect (EffectUnsupported) or its runtime could not be loaded; the track
   *  then carries what it carried before. */
  apply(track: LocalVideoTrack, effect: BackgroundEffect): Promise<void> {
    this.pending++;
    const run = this.queue.then(() => this.change(track, effect)).finally(() => this.pending--);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async change(track: LocalVideoTrack, effect: BackgroundEffect): Promise<void> {
    const was = this.of(track);
    if (was === effect) return;
    if (effect === "none") {
      if (track.getProcessor()) await track.stopProcessor();
      this.on.delete(track);
      this.load.reset(performance.now());
      return;
    }
    if (!blur.supported()) throw new EffectUnsupported();
    // one strength to the other: the same processor, its radius changed
    if (was !== "none" && (await blur.setRadius(track.getProcessor(), blurRadius(effect)))) {
      this.on.set(track, effect);
      return;
    }
    let p: Awaited<ReturnType<typeof blur.blurProcessor>> | null = null;
    p = await blur.blurProcessor(
      blurRadius(effect),
      (ms) => this.frame(ms),
      () => p && this.lost(track, p),
    );
    await track.setProcessor(p);
    this.on.set(track, effect);
    this.load.reset(performance.now());
  }

  /** The processor's WebGL context was lost under the camera (the graphics card reset, or the
   *  browser dropped it for newer ones), which then shows nothing: the effect is put on again, by a
   *  processor of its own. */
  private lost(track: LocalVideoTrack, p: unknown): void {
    const effect = this.of(track);
    if (effect === "none" || track.getProcessor() !== p) return;
    const now = performance.now();
    this.heals = this.heals.filter((t) => now - t < 60_000);
    if (this.heals.length >= HEALS_A_MINUTE) return this.events.failed(new Error("The background effect keeps losing the graphics card."));
    this.heals.push(now);
    this.on.delete(track);
    this.apply(track, effect).catch((e: unknown) => this.events.failed(e));
  }

  private frame(ms: number): void {
    this.frames++;
    if (!this.load.add(ms, performance.now())) return;
    const avg = this.load.mean();
    if (avg !== null) this.events.slow(avg);
  }
}
