// Fingers on the board, on a phone: one finger moves the board, two pinch it open, a tap on
// IsRegularPrime selects it and the sheet rises on its statement. The whole screen, upright; on the
// view of what flt_regular's statement means, whose board a phone's screen holds whole.
export default {
  id: "phone-fingers",
  on: "showcase",
  phone: true,
  bitrate: 320_000,
  viewport: { width: 390, height: 844 },
  out: { width: 360, height: 780 },
  width: 390,
  address: "v=v5cp2t1n&mode=plain",
  steps: [
    { camera: { x: 195, y: 422 }, cut: true },
    { wait: 400 },
    // the board glides on a little after the finger leaves it: the pinch waits for it to rest
    { swipe: { x: 200, y: 560 }, by: { x: 0, y: -90 }, ms: 600, after: 900 },
    { pinch: { x: 195, y: 400 }, apart: 70, scale: 2, ms: 900, after: 500 },
    { tap: "decl:IsRegularPrime", ms: 1100 },
    { poster: true },
    { wait: 300 },
  ],
};
