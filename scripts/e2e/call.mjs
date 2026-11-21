// The call in real browsers (CallSpec; scripts/e2e/harness.mjs): a server of this checkout with a key
// and --livekit-url, on a LiveKit server of the run's own (`livekit-server`, in dev mode on free
// ports of 127.0.0.1, its config and keys in the run's folder) — or one given. Chromium with a fake
// camera and microphone. Alice, a guest, starts the call from its button; Bob opens a call link
// (`/k/<key>?call`) and finds its pre-join at once; each sees the other's video. Alice's window
// maximized, made small (the compact call), collapsed to its pill. Bob raises his hand; Alice
// invites Cy, who is here, and Cy is told. A read-only link made to join the call lets Rita in under
// the name she gives, marked read-only; Alice removes her. Bob reloads in the call and rejoins.
// Alice copies the call link; then ends the call for everyone. A screenshot at each step.
//
//   node scripts/e2e/call.mjs --project <a built Lean project> [--livekit-server path]
//                             [--livekit-url ws://… --livekit-keys file] [--headed]
//
// --livekit-server: the LiveKit binary (default VP_LIVEKIT, else /opt/livekit/livekit-server, else
// livekit-server on the PATH). It writes in a new folder under the system's temporary folder, which
// it names; it exits 1 if a check failed or a page's console had an error.

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, camera, freePort, guest, report, scratch, serve } from "./harness.mjs";

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i < 0 ? undefined : argv[i + 1];
};
const project = opt("--project");
if (!project) {
  console.error("usage: node scripts/e2e/call.mjs --project <a built Lean project> [--livekit-server path] [--livekit-url ws://… --livekit-keys file] [--headed]");
  process.exit(2);
}
const dir = scratch("call");
const out = report(dir);
const cam = camera(join(dir, "shots"));
out.say(`call run in ${dir}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the run's own LiveKit
let lk = null;
let lkUrl = opt("--livekit-url");
let lkKeys = opt("--livekit-keys");
if (!lkUrl) {
  const bin = opt("--livekit-server") ?? process.env.VP_LIVEKIT ?? (existsSync("/opt/livekit/livekit-server") ? "/opt/livekit/livekit-server" : "livekit-server");
  const port = await freePort();
  const tcp = await freePort();
  const udp = 52000 + Math.floor(Math.random() * 1000);
  const secret = `e2e-${Math.random().toString(36).slice(2)}-0123456789abcdefghijklmnopqrstuvwxyz`;
  writeFileSync(join(dir, "livekit.yaml"), `port: ${port}\nbind_addresses:\n  - 127.0.0.1\nrtc:\n  tcp_port: ${tcp}\n  port_range_start: ${udp}\n  port_range_end: ${udp + 100}\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  APIe2e: ${secret}\nlogging:\n  level: warn\n`);
  lkKeys = join(dir, "livekit-keys");
  writeFileSync(lkKeys, `APIe2e: ${secret}\n`, { mode: 0o600 });
  // its log in the run's folder; it goes with the run, however the run ends
  const log = openSync(join(dir, "livekit.log"), "a");
  lk = spawn(bin, ["--config", join(dir, "livekit.yaml")], { stdio: ["ignore", log, log] });
  closeSync(log);
  process.on("exit", () => lk?.kill("SIGTERM"));
  lkUrl = `ws://127.0.0.1:${port}`;
  for (let k = 0; k < 60; k++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  out.say(`LiveKit ${bin} at ${lkUrl}, pid ${lk.pid}`);
}

const S = await serve({ project, dir: join(dir, "server"), args: ["--livekit-url", lkUrl, "--livekit-keys", lkKeys] });
out.say(`server ${S.url}, pid ${S.pid}, log ${S.log}`);
await S.ready();
const b = await browser({ headed: argv.includes("--headed"), args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const people = [];
/** a person whose page may use the camera and the microphone, and answers a page's question as it
 *  goes (a reload in the call) */
const media = async (p) => {
  await p.ctx.grantPermissions(["camera", "microphone", "clipboard-read", "clipboard-write"], { origin: S.url });
  p.page.on("dialog", (d) => void d.accept());
  // VP_DEBUG: the pages' warnings too, as they come
  if (process.env.VP_DEBUG) p.page.on("console", (m) => m.type() === "warning" && console.log(`  [${p.name} warns] ${m.text().slice(0, 200)}`));
  people.push(p);
  return p;
};
const until = async (p, f, arg, what, ms = 20_000) => {
  try {
    await p.page.waitForFunction(f, arg, { timeout: ms });
    return true;
  } catch {
    out.say(`  (waited ${ms / 1000} s for ${what})`);
    return false;
  }
};
const tiles = (p) => p.page.locator("#call .cl-tile").count();

try {
  // ---------------------------------------------------------------- Alice starts the call
  const alice = await media(await guest(b, S, "Alice"));
  // every WebGL context the page makes from here on, counted (the call's bundle is not loaded yet)
  await alice.page.evaluate(() => {
    window.__webgl = 0;
    for (const C of [HTMLCanvasElement, OffscreenCanvas]) {
      const get = C.prototype.getContext;
      const seen = new WeakSet();
      C.prototype.getContext = function (type, ...rest) {
        const ctx = get.call(this, type, ...rest);
        if (/webgl/.test(type) && ctx && !seen.has(ctx)) (seen.add(ctx), window.__webgl++);
        return ctx;
      };
    }
  });
  out.check(await until(alice, () => !document.getElementById("call-btn").hidden, null, "the call button"), "the bar has the call's button");
  await alice.page.click("#call-btn");
  out.check(await until(alice, () => !!document.querySelector("#call .cl-pre"), null, "the pre-join"), "the button opens the call window on the pre-join");
  out.check(await until(alice, () => !!document.querySelector("#call .cl-preview video"), null, "the camera's preview"), "the pre-join shows the camera's preview");
  await cam.shot(alice, "pre-join");
  // the background blurred, from the pre-join on: MediaPipe's runtime and model from this server
  const fetched = [];
  alice.page.on("response", (r) => {
    const u = new URL(r.url());
    // the page's own blob: URLs (the runtime, kept once fetched) are no fetch
    if (u.protocol === "blob:" || u.protocol === "data:") return;
    if (u.pathname.startsWith("/mediapipe/") || !u.host.startsWith("127.0.0.1")) fetched.push(`${r.status()} ${u.host}${u.pathname}`);
  });
  if (await alice.page.locator("#call select[data-effect]").count()) {
    // the pointer on the choice: the runtime fetched ahead, before anything is chosen
    await alice.page.hover("#call select[data-effect]");
    for (let k = 0; k < 100 && !fetched.some((f) => /vision_wasm_(nosimd_)?internal\.wasm$/.test(f)); k++) await sleep(100);
    out.check(fetched.some((f) => /vision_wasm_(nosimd_)?internal\.wasm$/.test(f)), "the pointer on the background's choice fetches the blur's runtime ahead");
    await alice.page.selectOption("#call select[data-effect]", "blur");
    // the runtime fetched (once a page), then the blur put on the preview
    for (let k = 0; k < 300 && !fetched.some((f) => /vision_wasm_(nosimd_)?internal\.wasm$/.test(f)); k++) await sleep(100);
    out.check(await until(alice, () => !document.querySelector("#call label")?.textContent?.includes("blurring") && !!document.querySelector("#call .cl-preview video"), null, "the blur on", 60_000), "Blur chosen in the pre-join: the preview goes on, blurred");
    await sleep(2000);
    out.check(!(await alice.page.locator("#call .cl-err").count()), "no error putting the blur on");
    out.check(fetched.some((f) => /^200 .*\/mediapipe\/vision_wasm_(nosimd_)?internal\.wasm$/.test(f)) && fetched.some((f) => /^200 .*selfie_segmenter\.tflite$/.test(f)), `the runtime and the model came from this server (${fetched.join(", ")})`);
    out.check(!fetched.some((f) => !/^\d+ 127\.0\.0\.1/.test(f)), "nothing was fetched from a third party");
    await cam.shot(alice, "pre-join-blur");
  } else out.check(false, "this browser offers the background effect");
  await alice.page.click("#call [data-act=join]");
  out.check(await until(alice, () => !!document.querySelector("#call .cl-call .cl-tile.video"), null, "Alice's own tile"), "joined: her own tile shows her camera");
  out.check(await until(alice, () => document.getElementById("call-badge").textContent === "1", null, "the count"), "the button counts 1 in the call");
  // the blur's check of WebGL asked once, the processor's one context: not one more at each drawing
  const glMade = await alice.page.evaluate(() => window.__webgl);
  out.check(glMade <= 3, `blurred and in the call, the page made ${glMade} WebGL contexts (at most 3: the check, the processor's)`);
  // Alice's blur going on: the frames it draws in 2 s (Alice alone in the call: headless, every page's
  // WebGL is drawn by one emulated graphics card, which a second page's board slows to a crawl)
  const blurFrames = async () => {
    const f0 = await alice.page.evaluate(() => window.visualproof.call.effectFrames());
    await sleep(2000);
    return (await alice.page.evaluate(() => window.visualproof.call.effectFrames())) - f0;
  };
  const blurBefore = await blurFrames();
  // more WebGL contexts on the page than the browser keeps (Chrome: 16): it drops the oldest, the
  // board's and the blur's — the board asks its own back, the blur is put on again by a new processor
  await alice.page.evaluate(() => {
    window.__held = [];
    for (let i = 0; i < 20; i++) window.__held.push(document.createElement("canvas").getContext("webgl2"));
  });
  out.check(await until(alice, () => document.getElementById("canvas").getContext("webgl2").isContextLost(), null, "the board's context dropped", 5000), "20 more WebGL contexts: the browser drops the board's");
  out.check(await until(alice, () => window.visualproof?.canvas?.gl?.restores === 1 && !document.getElementById("canvas").getContext("webgl2").isContextLost(), null, "the board's context asked back", 10_000), "the board asks its context back by itself, and is drawn again");
  await sleep(2000);
  const blurAfter = await blurFrames();
  out.check(blurBefore > 0 && blurAfter > 0, `Alice's blur goes on after its context was dropped: a new processor takes over (${blurAfter} frames in 2 s; before: ${blurBefore})`);
  out.check(!(await alice.page.locator("#call .cl-err").count()), "no error after the dropped contexts");
  await alice.page.evaluate(() => window.__held.splice(0).forEach((gl) => gl?.getExtension("WEBGL_lose_context")?.loseContext()));
  await sleep(500);
  await cam.shot(alice, "board-after-eviction");

  // ---------------------------------------------------------------- Bob comes by a call link
  const bob = await media(await guest(b, S, "Bob"));
  await bob.open(`/k/${S.key}?call`);
  out.check(await until(bob, () => !!document.querySelector("#call .cl-pre"), null, "Bob's pre-join"), "a call link opens the pre-join at once");
  out.check(!(await bob.page.evaluate(() => location.search.includes("call"))), "the address goes on without ?call");
  out.check(/Alice is in the call/.test(await bob.page.locator("#call .cl-pre-who").innerText()), "the pre-join says Alice is in the call");
  await bob.page.click("#call [data-act=join]");
  out.check(await until(bob, () => document.querySelectorAll("#call .cl-tile.video").length >= 2, null, "two videos on Bob's page"), "Bob sees Alice's video and his own");
  out.check(await until(alice, () => document.querySelectorAll("#call .cl-tile.video").length >= 2, null, "two videos on Alice's page"), "Alice sees Bob's video");
  out.check(await until(alice, () => [...document.querySelectorAll("#call .cl-nm")].some((e) => e.textContent === "Bob"), null, "Bob's name"), "Bob's tile is named by the server");
  await cam.shot(alice, "full-call");
  out.check(await until(bob, () => document.querySelectorAll("#call .cl-tile.video").length >= 2, null, "Alice's blurred video on Bob's page"), "Bob receives Alice's camera, blurred");
  // the board's WebGL context lost and given back (a page that blurs runs other WebGL beside the
  // board, which makes a reset of the graphics likelier): the board is drawn again
  await alice.page.evaluate(() => {
    const ext = document.getElementById("canvas").getContext("webgl2").getExtension("WEBGL_lose_context");
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 300);
  });
  out.check(await until(alice, () => window.visualproof?.canvas?.gl?.restores === 2 && !document.getElementById("canvas").getContext("webgl2").isContextLost(), null, "the board's context back"), "the board's WebGL context lost and back: the board is drawn again");
  await sleep(500);
  await cam.shot(alice, "board-restored");
  // ✕ pressed once asks, on one line, its question in full
  await alice.page.click("#call .cl-head [data-cl-close]");
  const armed = await alice.page.evaluate(() => {
    const x = document.querySelector("#call .cl-head [data-cl-close]");
    const r = x.getBoundingClientRect();
    return { armed: x.classList.contains("armed"), w: Math.round(r.width), h: Math.round(r.height), fits: x.scrollWidth <= x.clientWidth + 1 && x.scrollHeight <= x.clientHeight + 1 };
  });
  out.check(armed.armed && armed.h <= 26 && armed.w >= 120 && armed.fits, `✕ pressed once: "Leave the call?" on one line, in full (${armed.w}×${armed.h})`);
  await cam.shot(alice, "close-armed");
  out.check(await until(alice, () => !document.querySelector("#call .cl-head [data-cl-close]").classList.contains("armed"), null, "the ✕ disarmed", 6000), "not pressed again, ✕ is a cross again");

  // ---------------------------------------------------------------- picture-in-picture
  if (await alice.page.evaluate(() => "documentPictureInPicture" in window)) {
    await alice.page.click("#call [data-act=pip]");
    out.check(await until(alice, () => !document.querySelector("#call .cl-root") && !document.querySelector("#call .cl-away")?.hidden, null, "the call out of the page"), "picture-in-picture: the call leaves the page, the call window says where it went");
    out.check(
      await until(alice, () => {
        const d = window.documentPictureInPicture?.window?.document;
        const vs = d ? [...d.querySelectorAll(".cl-tile.video video")] : [];
        return vs.length >= 1 && vs.every((v) => v.readyState >= 2 && !v.paused);
      }, null, "videos playing in the picture-in-picture window"),
      "in its own window, the call's videos play",
    );
    // the window's size is the browser's to give (headless Chromium gives its own, 1280×720): the
    // call fits it, compact below 640×400
    const fit = await alice.page.evaluate(() => {
      const w = window.documentPictureInPicture?.window;
      return w ? { w: w.innerWidth, h: w.innerHeight, compact: !!w.document.querySelector(".cl-call.compact") } : null;
    });
    out.check(!!fit && fit.compact === (fit.w < 640 || fit.h < 400), `the call fits its own window (${fit?.w}×${fit?.h}: ${fit?.compact ? "compact" : "full"})`);
    await cam.shot(alice, "pip-away");
    await alice.page.evaluate(() => window.documentPictureInPicture?.window?.document.querySelector("[data-act=pip-back]")?.click());
    out.check(await until(alice, () => !!document.querySelector("#call .cl-root .cl-tile.video") && !!document.querySelector("#call .cl-away")?.hidden, null, "the call back in the page"), "Back into the page: the call is in its window again");
  } else out.check(false, "this browser has Document Picture-in-Picture");

  // ---------------------------------------------------------------- Alice's window
  await alice.page.click("#call [data-cl-max]");
  const maxed = await alice.page.evaluate(() => {
    const r = document.getElementById("call").getBoundingClientRect();
    return { max: document.getElementById("call").classList.contains("maximized"), w: r.width, vw: innerWidth };
  });
  out.check(maxed.max && maxed.w > maxed.vw - 40, `maximized, it fills the page's width (${Math.round(maxed.w)} of ${maxed.vw})`);
  await cam.shot(alice, "maximized");
  await alice.page.click("#call [data-cl-max]");
  // made small from its top left corner: the compact call
  const nw = await alice.page.locator("#call .fl-rz-nw").boundingBox();
  await alice.page.mouse.move(nw.x + nw.width / 2, nw.y + nw.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(nw.x + 330, nw.y + 230, { steps: 8 });
  await alice.page.mouse.up();
  out.check(await until(alice, () => !!document.querySelector("#call .cl-call.compact"), null, "the compact call"), "made small, the window shows the compact call");
  out.check((await tiles(alice)) === 1, "the compact call shows one tile");
  await cam.shot(alice, "compact");
  await alice.page.click("#call [data-collapse]");
  out.check(await until(alice, () => /Call · 2/.test(document.querySelector("#call .fl-pill-text")?.textContent ?? ""), null, "the pill"), "collapsed, its pill says Call · 2");
  await cam.shot(alice, "pill");
  await alice.page.click("#call .fl-pill-open");
  // back to a full call's size
  const nw2 = await alice.page.locator("#call .fl-rz-nw").boundingBox();
  await alice.page.mouse.move(nw2.x + nw2.width / 2, nw2.y + nw2.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(nw2.x - 330, nw2.y - 230, { steps: 8 });
  await alice.page.mouse.up();
  out.check(await until(alice, () => !!document.querySelector("#call .cl-call:not(.compact)"), null, "the full call again"), "made large again, the full call");

  // ---------------------------------------------------------------- a hand, People, an invite
  await bob.page.click("#call [data-act=hand]");
  out.check(await until(alice, () => !!document.querySelector("#call .cl-tile .cl-hand"), null, "Bob's hand"), "Bob raises his hand: Alice sees it on his tile");
  const cy = await media(await guest(b, S, "Cy"));
  await alice.page.click("#call [data-act=people]");
  out.check(await until(alice, () => [...document.querySelectorAll("#call .cl-side .cl-row-n")].some((e) => e.textContent.startsWith("Cy")), null, "Cy among those here"), "People lists Cy, here and not in the call");
  await cam.shot(alice, "people");
  await alice.page.click("#call .cl-side [data-act=invite]");
  out.check(await until(cy, () => /Alice<\/b> invites you/.test(document.getElementById("call-notice").innerHTML), null, "Cy's invite"), "Cy is told that Alice invites him");
  await cam.shot(cy, "invited");
  await cy.page.click("#call-notice [data-cn='0']");
  out.check(await until(cy, () => !!document.querySelector("#call .cl-pre"), null, "Cy's pre-join"), "Join opens the pre-join");
  await cy.page.click("#call [data-act=cancel]");

  // ---------------------------------------------------------------- a read-only link that joins the call
  const made = await S.ask("POST", "/api/share/readonly", { call: true }, "Olivia");
  out.check(made.status === 200 && made.json?.made?.call === true, "a read-only link made to join the call");
  const rita = await media(await guest(b, S, "Rita-guest"));
  await rita.ctx.clearCookies();
  await rita.open(`${made.json.made.link}?call`);
  out.check(await until(rita, () => !!document.querySelector("#call .cl-pre [data-name]"), null, "Rita's name field"), "a read-only reader's pre-join asks for the name the call shows");
  await rita.page.fill("#call [data-name]", "Rita");
  await rita.page.click("#call [data-act=join]");
  out.check(await until(alice, () => [...document.querySelectorAll("#call .cl-side .cl-row-n")].some((e) => /Rita/.test(e.textContent) && /read-only/.test(e.textContent)), null, "Rita in People"), "Rita is in the call, marked read-only");
  await cam.shot(alice, "read-only-joined");
  const ritaRow = alice.page.locator("#call .cl-side .cl-row", { hasText: "Rita" });
  await ritaRow.locator("[data-act=row]").click();
  await alice.page.click("#call .cl-pop [data-act=remove]");
  await alice.page.click("#call .cl-pop [data-act=remove]");
  out.check(await until(rita, () => /removed you from the call/.test(document.getElementById("call-notice").textContent), null, "Rita told"), "Alice removes Rita: Rita is told, and her window closes");

  // ---------------------------------------------------------------- Bob reloads in the call
  await bob.page.reload();
  await bob.ready();
  out.check(await until(bob, () => /reloaded/.test(document.getElementById("call-notice").textContent ?? ""), null, "Bob's Rejoin"), "reloaded in the call, Bob is offered Rejoin");
  await bob.page.click("#call-notice [data-cn='0']");
  out.check(await until(bob, () => document.querySelectorAll("#call .cl-tile.video").length >= 2, null, "Bob back in the call"), "Rejoin: Bob is back in the call, without the pre-join");
  out.check(await until(alice, () => document.getElementById("call-badge").textContent === "2", null, "two in the call"), "the call counts 2 again: the page Bob left behind was replaced");

  // ---------------------------------------------------------------- on a phone, in the dark
  const dan = await media(await guest(b, S, "Dan", { theme: "dark", screen: "phone" }));
  await dan.open(`/k/${S.key}?call`);
  out.check(await until(dan, () => !!document.querySelector("#call .cl-pre"), null, "Dan's pre-join"), "on a phone, a call link opens the pre-join, docked");
  await cam.shot(dan, "phone-pre-join");
  await dan.page.click("#call [data-act=join]");
  out.check(await until(dan, () => document.querySelectorAll("#call .cl-tile").length >= 1 && !!document.querySelector("#call .cl-call"), null, "Dan in the call"), "on a phone, Dan joins");
  await sleep(1500);
  await cam.shot(dan, "phone-call");
  await dan.page.click("#call [data-act=leave]");
  out.check(await until(dan, () => document.getElementById("call").hidden, null, "Dan's window closed"), "Leave closes the window");

  // ---------------------------------------------------------------- the call link, and the end
  await alice.page.evaluate(() => navigator.clipboard.writeText(""));
  await alice.page.click("#call [data-cl-link]");
  // copied once the page has asked the server for the link's way in
  let copied = "";
  for (let k = 0; k < 50 && !copied; k++) {
    copied = await alice.page.evaluate(() => navigator.clipboard.readText());
    if (!copied) await sleep(100);
  }
  out.check(copied === `${S.url}/k/${S.key}?call${new URL(copied).hash}`, `Copy call link: the guest link with ?call (${copied.replace(S.key, "<key>")})`);
  await alice.page.click("#call [data-act=menu-leave]");
  await alice.page.click("#call .cl-pop [data-act=end]");
  await alice.page.click("#call .cl-pop [data-act=end]");
  out.check(await until(bob, () => /ended the call/.test(document.getElementById("call-notice").textContent), null, "Bob told the call ended"), "Alice ends the call for everyone: Bob is told");
  out.check(await until(alice, () => document.getElementById("call-badge").hidden, null, "nobody in the call"), "nobody is in the call");
  await cam.shot(bob, "ended");
} catch (e) {
  out.check(false, `the scenario ran through: ${e instanceof Error ? e.stack : String(e)}`);
}
const status = out.finish(people);
await b.close();
await S.stop();
lk?.kill("SIGTERM");
process.exit(status);
