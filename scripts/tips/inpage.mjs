// What the recorder puts in the page before it loads (Playwright's addInitScript): a pointer drawn
// over the page, the page's own animations held to the faked clock, and the server's answers and
// pushes held until a frame is over. It runs in the page: no imports, nothing from Node.

export function inPage() {
  // the page's work on its own thread rather than in workers, whose answers come back in real time,
  // so at a different frame from one recording to the next; the page falls back to it by itself
  // (web/src/edgequeue.ts, layoutqueue.ts)
  delete window.Worker;

  // requests on their way, and answers held back: an answer reaches the page only between two frames
  // (`quiet`), never while the clock runs one, so that it comes at the same frame every time
  let flying = 0;
  const held = [];
  const fetch0 = window.fetch.bind(window);
  // a heartbeat answered: the server tells every page where everyone is a moment later (at most every
  // 500 ms), which the recorder waits for before the next frame
  let beats = 0;
  window.fetch = (...a) => {
    flying++;
    if (/\/api\/presence\b/.test(String(a[0]?.url ?? a[0]))) beats++;
    return new Promise((done, fail) => {
      fetch0(...a)
        .then(async (r) => {
          const body = r.status === 204 || r.status === 304 ? null : await r.arrayBuffer();
          held.push(() => done(new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers })));
        })
        .catch((e) => held.push(() => fail(e)))
        .finally(() => flying--);
    });
  };

  // the server's pushes (the page's event stream) held the same way: an event reaches the page only
  // between two frames; `events` counts what came, by type, for the recorder to wait on
  const events = {};
  const ES = window.EventSource;
  class HeldEventSource {
    constructor(url, opts) {
      this.es = new ES(url, opts);
      const hold = (type, fn) => (e) => {
        events[type] = (events[type] ?? 0) + 1;
        held.push(() => fn.call(this, e));
      };
      this.hold = hold;
      for (const t of ["open", "error", "message"])
        this.es.addEventListener(t, (e) => {
          const fn = this[`on${t}`];
          if (fn) hold(t, fn)(e);
        });
    }
    addEventListener(type, fn, opts) {
      this.es.addEventListener(type, this.hold(type, fn), opts);
    }
    get readyState() {
      return this.es.readyState;
    }
    get url() {
      return this.es.url;
    }
    close() {
      this.es.close();
    }
  }
  for (const k of ["CONNECTING", "OPEN", "CLOSED"]) HeldEventSource[k] = ES[k];
  window.EventSource = HeldEventSource;

  // images loaded as soon as they are made, not once they come near the screen (a note's, the
  // library's: `loading="lazy"`), so that none is still on its way when a frame is taken
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        for (const img of n.matches("img") ? [n] : n.querySelectorAll("img")) if (img.loading === "lazy") img.loading = "eager";
      }
  }).observe(document, { childList: true, subtree: true });

  // no caret blinking in a field being typed in: the browser blinks it in real time (the document is
  // not there yet when this runs)
  const style = document.createElement("style");
  style.textContent = "* { caret-color: transparent !important; }";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));

  const tips = (window.__tips = {
    events,
    /** How many heartbeats the page has sent: the recorder waits for what the server says after one. */
    beats: () => beats,
    /** Nothing is still to come: no request on its way, every image loaded and decoded, every font.
     *  Answers that came are given to the page now, and it is not quiet until it has taken them. */
    quiet() {
      if (flying > 0) return false;
      if (held.length) {
        for (const give of held.splice(0)) give();
        return false;
      }
      for (const img of document.images) {
        if (!img.complete) return false;
        if (!img.__tipsDecoded && img.naturalWidth) {
          img.__tipsDecoded = true;
          flying++;
          img.decode().catch(() => {}).finally(() => flying--);
          return false;
        }
      }
      return document.fonts.status === "loaded";
    },

    /** Every animation of the page (CSS transitions and animations, Web Animations) at the faked
     *  time since it began: the page's own clock is faked, the compositor's is not. */
    sync() {
      const now = performance.now();
      for (const a of document.getAnimations()) {
        if (a.__tipsStart === undefined) {
          a.__tipsStart = now;
          a.pause();
        }
        a.currentTime = now - a.__tipsStart;
      }
    },

    /** Where a declaration's dot is on the screen, or null when it is not drawn (folded away, off
     *  the board). Through the page's handle for its own checks (web/src/main.ts, `visualproof`). */
    decl(name) {
      // the board's own graph: a view's holds its declarations alone, numbered as its board numbers them
      const c = window.visualproof?.canvas;
      const i = c?.g.byName.get(name);
      if (i === undefined || !(i < c.px.length)) return null;
      const [sx, sy] = c.toScreen(c.px[i], c.py[i]);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
      const r = c.canvas.getBoundingClientRect();
      if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return null;
      return { x: r.left + sx, y: r.top + sy };
    },

    /** The box round what is lit on the board (the selection and what its tool lights), on the
     *  screen: where a clip looks once something is selected. */
    lit() {
      const c = window.visualproof?.canvas;
      const r = c?.canvas.getBoundingClientRect();
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const i of c?.activeList ?? []) {
        const [sx, sy] = c.toScreen(c.px[i], c.py[i]);
        if (!Number.isFinite(sx) || sx < 0 || sy < 0 || sx > r.width || sy > r.height) continue;
        [x0, y0, x1, y1] = [Math.min(x0, sx), Math.min(y0, sy), Math.max(x1, sx), Math.max(y1, sy)];
      }
      return x0 <= x1 ? { x: r.left + x0, y: r.top + y0, w: x1 - x0, h: y1 - y0 } : null;
    },

    /** A box on the screen: an element's (the first shown that the selector finds; with `text`, the
     *  innermost one inside `in` whose text is that), a declaration's dot (`decl:<name>`), or a
     *  point's. */
    rect(target) {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      };
      if (target && typeof target === "object" && "text" in target) {
        const all = [...document.querySelectorAll(`${target.in ?? "body"} *`)].filter((e) => e.textContent.trim() === target.text);
        for (const el of all.filter((e) => !all.some((o) => o !== e && e.contains(o)))) {
          const b = box(el);
          if (b) return b;
        }
        return null;
      }
      if (target === "lit") return tips.lit();
      // a section's heading in the linear form (Export), by its label: its name, on the line
      if (target && typeof target === "object" && "section" in target) {
        const L = window.visualproof?.linear;
        const row = L?.rows.find((r) => r.kind === "section" && !r.start && (r.label === target.section || r.name === target.section));
        if (!row) return null;
        const v = L.view(), r = L.el.getBoundingClientRect();
        const y = v.top + (row.y0 + 11 - L.cam.y) * L.cam.k, x = L.labelX(row) + 13;
        return { x: r.left + x, y: r.top + y - 8, w: Math.max(40, L.nameEnd(row) - x), h: 16 };
      }
      // a cluster's circle on the board, at a point of it: `at` turns (0: the top of its rim, 0.5:
      // the bottom), `rim` the fraction of its radius out from the middle
      if (target && typeof target === "object" && "cluster" in target) {
        const c = window.visualproof?.canvas;
        const d = c?.clusterDisc(target.cluster);
        if (!d) return null;
        const r = c.canvas.getBoundingClientRect();
        const a = 2 * Math.PI * (target.at ?? 0) - Math.PI / 2;
        const f = target.rim ?? 0;
        const x = r.left + d[0] + Math.cos(a) * d[2] * f, y = r.top + d[1] + Math.sin(a) * d[2] * f;
        return { x: x - 4, y: y - 4, w: 8, h: 8 };
      }
      if (typeof target === "string" && target.startsWith("decl:")) {
        const p = tips.decl(target.slice(5));
        return p && { x: p.x - 20, y: p.y - 20, w: 40, h: 40 };
      }
      if (typeof target === "string") {
        for (const el of document.querySelectorAll(target)) {
          const b = box(el);
          if (b) return b;
        }
        return null;
      }
      return { w: 0, h: 0, ...target };
    },

    /** What the browser itself would show, drawn over the page, since a headless one shows none: a
     *  download's bubble (`saved`: the file's name, its size) or a downloaded PDF's pages
     *  (`pdf`: the file's name, its pages as images). `null` takes it away. */
    shown(what) {
      document.getElementById("__tips-shown")?.remove();
      if (!what) return;
      const el = document.createElement("div");
      el.id = "__tips-shown";
      el.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;font:13px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d1d1f";
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const icon = '<svg width="18" height="18" viewBox="0 0 18 18" style="flex:none"><path d="M9 2v9m0 0l-3.5-3.5M9 11l3.5-3.5M3 14.5h12" fill="none" stroke="#7c5cff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      if (what.saved) {
        el.style.cssText += ";top:58px;right:16px;display:flex;gap:10px;align-items:center;padding:10px 14px;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.06)";
        el.innerHTML = `${icon}<div><div style="font-weight:600">${esc(what.saved)}</div><div style="color:#6e6e73">Saved · ${esc(what.size)}</div></div>`;
      } else if (what.pdf) {
        el.style.cssText += ";inset:0;display:flex;flex-direction:column;background:#e8e8ed";
        el.innerHTML =
          `<div style="display:flex;gap:10px;align-items:center;padding:12px 18px;background:#f5f5f7;border-bottom:1px solid rgba(0,0,0,.08)">${icon}<b>${esc(what.pdf)}</b><span style="color:#6e6e73">${what.pages.length} of ${what.count} pages</span></div>` +
          `<div style="flex:1;display:flex;gap:28px;align-items:center;justify-content:center;padding:28px">${what.pages.map((src) => `<img src="${src}" style="height:100%;max-height:780px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.18)">`).join("")}</div>`;
      }
      document.documentElement.appendChild(el);
    },

    /** The drawn pointer: an arrow (or, on a phone, a finger's dot), a ring where it pressed, fading
     *  over `ring` (1 to 0), and a key cap beside it while `key` is shown, at `keyAlpha`. */
    pointer({ x, y, finger = false, ring = 0, ringX = x, ringY = y, key = "", keyAlpha = 0, hidden = false, second = null }) {
      let root = document.getElementById("__tips");
      if (!root) {
        root = document.createElement("div");
        root.id = "__tips";
        root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:strict";
        root.innerHTML =
          '<div data-r style="position:absolute;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;border:3px solid #7c5cff;box-sizing:border-box"></div>' +
          '<svg data-a width="24" height="32" viewBox="0 0 24 32" style="position:absolute;margin:-2px 0 0 -2px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))"><path d="M2 2 L2 25 L8 19.2 L12.4 29 L16.6 27.2 L12.3 17.6 L20.5 17.6 Z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>' +
          '<div data-f style="position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(124,92,255,.32);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>' +
          '<div data-g style="position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(124,92,255,.32);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>' +
          '<div data-k style="position:absolute;font:600 15px/1 system-ui,sans-serif;padding:6px 10px;border-radius:8px;background:#fff;color:#111;border:1px solid rgba(0,0,0,.18);box-shadow:0 2px 8px rgba(0,0,0,.22);min-width:12px;text-align:center"></div>';
        document.documentElement.appendChild(root);
      }
      const [r, a, f, g, k] = ["r", "a", "f", "g", "k"].map((d) => root.querySelector(`[data-${d}]`));
      a.style.display = finger || hidden ? "none" : "";
      f.style.display = finger && !hidden ? "" : "none";
      a.style.transform = f.style.transform = `translate(${x}px, ${y}px)`;
      // a pinch's other finger
      g.style.display = second && !hidden ? "" : "none";
      if (second) g.style.transform = `translate(${second.x}px, ${second.y}px)`;
      r.style.opacity = String(ring);
      r.style.transform = `translate(${ringX}px, ${ringY}px) scale(${1.7 - 0.7 * ring})`;
      k.textContent = key;
      k.style.opacity = String(key ? keyAlpha : 0);
      k.style.transform = `translate(${x + 22}px, ${y + 26}px)`;
    },
  });
}
