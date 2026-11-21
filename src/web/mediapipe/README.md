# The call's background effect: its model

The file the call's background blur needs that is not code and not in `node_modules`
(SPEC/CallSpec.md; `web/src/call/blur.ts`). The server serves it as `/mediapipe/selfie_segmenter.tflite`,
beside MediaPipe's WebAssembly runtime, which it serves from `@mediapipe/tasks-vision` (Apache-2.0)
as it is installed (`server/mediapipe.ts`): nothing of the effect comes from a third party.

## selfie_segmenter.tflite

MediaPipe's selfie segmentation model (float16), which finds the person in a camera frame so that
only what is behind them is blurred.

- Source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite,
  the model `@livekit/track-processors` 0.8 loads by default; taken from Cocoding's copy (LemmaLight),
  fetched there on 2026-11-08 (object generation 1683436453600523, last modified 2023-05-07).
- Size: 249,537 bytes. SHA-256: `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`.
- Licence: Apache License 2.0, as Google publishes the MediaPipe models
  (https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#selfie-model;
  https://www.apache.org/licenses/LICENSE-2.0). Copyright Google LLC.

To replace it, fetch the new file once, put it here under the same name, and update this README.
