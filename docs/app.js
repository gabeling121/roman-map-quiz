(() => {
  "use strict";
  const D = window.MAPDATA;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("map");
  const panel = document.getElementById("panel");
  const PLACES = D.places;
  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
  const MASTER = 3; // box level that counts as "mastered"

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem("rmq_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("rmq_" + k, JSON.stringify(v)); } catch {} },
  };
  let stats = store.get("stats", {});
  const stat = id => (stats[id] ||= { box: 0, right: 0, wrong: 0 });
  function record(id, firstTry) {
    const s = stat(id);
    if (firstTry) { s.right++; s.box = Math.min(MASTER, s.box + 1); }
    else { s.wrong++; s.box = Math.max(0, s.box - 1); }
    store.set("stats", stats);
  }

  // ---------------------------------------------------------------- svg build
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  const defs = el("defs", {}, svg);
  el("path", { d: D.land, "clip-rule": "evenodd" }, el("clipPath", { id: "landClip" }, defs));
  el("path", { d: D.frame + D.land, "clip-rule": "evenodd" }, el("clipPath", { id: "seaClip" }, defs));
  const pat = el("pattern", { id: "peaks", patternUnits: "userSpaceOnUse", width: 12, height: 9 }, defs);
  el("rect", { width: 12, height: 9, fill: "#dcc79c" }, pat);
  el("path", { d: "M1,8L6,2L11,8", fill: "#b89a66", stroke: "#6e5634", "stroke-width": 0.8 }, pat);

  el("path", { d: D.land, class: "land", "fill-rule": "evenodd" }, svg);
  if (D.lakes) el("path", { d: D.lakes, class: "lake" }, svg);
  el("path", { d: D.rivers, class: "bgriver" }, svg);
  const decor = el("g", {}, svg);
  for (const d of D.decor) {
    const t = el("text", { x: d.at[0], y: d.at[1], "text-anchor": "middle", class: "decor " + d.k }, decor);
    t.textContent = d.t;
  }

  const layers = { sea: el("g", {}, svg), area: el("g", {}, svg), mount: el("g", {}, svg), line: el("g", {}, svg), point: el("g", {}, svg), label: el("g", {}, svg) };
  const els = {};
  const pointEls = [];
  for (const p of PLACES) {
    const isPoint = p.kind === "city" || p.kind === "volcano";
    const layer = isPoint ? layers.point : layers[{ river: "line", sea: "sea", mountains: "mount" }[p.kind] || "area"];
    const cls = { sea: "sea", mountains: "mount", river: "riv" }[p.kind] || p.kind;
    const g = el("g", { class: "place " + cls, "data-id": p.id }, layer);
    if (p.kind === "region" || p.kind === "sea" || p.kind === "mountains") {
      const attrs = { d: p.path, class: "region" };
      if (p.kind === "region") attrs["clip-path"] = "url(#landClip)";
      if (p.kind === "sea") attrs["clip-path"] = "url(#seaClip)";
      const shape = el("path", attrs, g);
      if (p.color) shape.style.setProperty("--c", p.color);
      if (p.hitR) pointEls.push({ c: el("circle", { cx: p.at[0], cy: p.at[1], class: "hit" }, g), r: p.hitR });
    } else if (p.kind === "river") {
      el("path", { d: p.path, class: "riverhit" }, g);
      el("path", { d: p.path, class: "riverline" }, g);
    } else {
      const hit = el("circle", { cx: p.at[0], cy: p.at[1], class: "hit" }, g);
      const ring = el("circle", { cx: p.at[0], cy: p.at[1], r: 6, class: "ring" }, g);
      let mark;
      if (p.kind === "volcano") {
        mark = el("path", { class: "volc" }, g);
      } else {
        mark = el("circle", { cx: p.at[0], cy: p.at[1], class: "dot" }, g);
      }
      pointEls.push({ c: hit, r: 13 }, { c: mark, r: 4.5, volc: p.kind === "volcano", at: p.at });
      void ring;
    }
    const [lx, ly] = p.lab || (isPoint ? [p.at[0] + 8, p.at[1] + 4] : p.at);
    const t = el("text", { x: lx, y: ly, "text-anchor": p.anchor || (isPoint ? "start" : "middle"), class: "lbl" }, layers.label);
    t.textContent = p.label;
    if (p.kind === "river" || p.kind === "sea") t.setAttribute("font-style", "italic");
    els[p.id] = { g, lbl: t };
  }

  const mark = (id, c, on = true) => { els[id].g.classList.toggle(c, on); els[id].lbl.classList.toggle(c, on); };
  const clearAll = (...cs) => { for (const id in els) for (const c of cs) mark(id, c, false); };

  // ---------------------------------------------------------------- viewport (pan / zoom)
  const vb = { x: 0, y: 0, w: D.w, h: D.h };
  function upp() { // svg units per screen pixel
    const r = svg.getBoundingClientRect();
    return Math.max(vb.w / (r.width || 1), vb.h / (r.height || 1));
  }
  function applyVB() {
    const minW = 90, maxW = D.w * 1.2;
    const k = Math.min(Math.max(vb.w, minW), maxW) / vb.w;
    if (k !== 1) { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w *= k; vb.h *= k; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; }
    vb.x = Math.min(Math.max(vb.x, -vb.w * 0.5), D.w - vb.w * 0.5);
    vb.y = Math.min(Math.max(vb.y, -vb.h * 0.5), D.h - vb.h * 0.5);
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const u = upp();
    svg.style.setProperty("--lbl", (14 * u).toFixed(2) + "px");
    for (const pe of pointEls) {
      const r = pe.r * u;
      if (pe.volc) {
        const [x, y] = pe.at, s = r * 1.5;
        pe.c.setAttribute("d", `M${x - s},${y + s * 0.8}L${x},${y - s}L${x + s},${y + s * 0.8}Z`);
      } else pe.c.setAttribute("r", r);
    }
  }
  function toSvg(cx, cy) {
    const pt = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
    return [pt.x, pt.y];
  }
  function zoomAt(cx, cy, f) {
    const [sx, sy] = toSvg(cx, cy);
    vb.x = sx - (sx - vb.x) / f; vb.y = sy - (sy - vb.y) / f; vb.w /= f; vb.h /= f;
    applyVB();
  }
  let anim = 0;
  function flyTo(x, y, w, h) {
    const from = { ...vb }, to = { x, y, w, h }, t0 = performance.now(), id = ++anim;
    const step = now => {
      if (id !== anim) return;
      const t = Math.min(1, (now - t0) / 450), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (const k of ["x", "y", "w", "h"]) vb[k] = from[k] + (to[k] - from[k]) * e;
      applyVB();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const resetView = () => flyTo(0, 0, D.w, D.h);
  function focusPlace(id, always) {
    const b = els[id].g.getBBox();
    if (!always && (b.width > 200 || b.height > 200)) return resetView();
    const w = Math.max(360, b.width * 2.2), h = w * D.h / D.w;
    flyTo(b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h / 2, w, h);
  }

  document.getElementById("zin").onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.5); };
  document.getElementById("zout").onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.5); };
  document.getElementById("zreset").onclick = resetView;
  svg.addEventListener("wheel", e => { e.preventDefault(); anim++; zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

  const ptrs = new Map();
  let drag = null;
  svg.addEventListener("pointerdown", e => {
    anim++;
    try { svg.setPointerCapture(e.pointerId); } catch {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { moved: ptrs.size > 1, sx: e.clientX, sy: e.clientY, pinch: null };
  });
  svg.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId) || !drag) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
      drag.moved = true; svg.classList.add("dragging");
      const u = upp();
      vb.x -= (e.clientX - prev.x) * u; vb.y -= (e.clientY - prev.y) * u;
      applyVB();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (drag.pinch) {
        const u = upp();
        vb.x -= (mx - drag.pinch.mx) * u; vb.y -= (my - drag.pinch.my) * u;
        applyVB();
        zoomAt(mx, my, dist / drag.pinch.dist);
      }
      drag.pinch = { dist, mx, my };
    }
  });
  const endPtr = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) {
      svg.classList.remove("dragging");
      if (drag && !drag.moved && e.type === "pointerup") tap(e.clientX, e.clientY);
      drag = null;
    } else if (drag) drag.pinch = null;
  };
  svg.addEventListener("pointerup", endPtr);
  svg.addEventListener("pointercancel", endPtr);

  function placesAt(x, y) {
    const out = [];
    for (const e of document.elementsFromPoint(x, y)) {
      const g = e.closest && e.closest(".place");
      if (g && !out.includes(g.dataset.id)) out.push(g.dataset.id);
    }
    return out;
  }
  function tap(x, y) {
    const hits = placesAt(x, y);
    if (modeObj.tap) modeObj.tap(hits);
  }

  // ---------------------------------------------------------------- helpers
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const stars = id => "★".repeat(stat(id).box) + "☆".repeat(MASTER - stat(id).box);
  const ISLANDS = new Set(["sicilia", "creta", "rhodus", "britannia"]);
  const kindWord = p => ISLANDS.has(p.id) ? "island" : ({ city: "city", volcano: "volcano", river: "river", mountains: "mountains", sea: "sea", region: "land" }[p.kind]);
  const group = p => (p.kind === "city" || p.kind === "volcano") ? "pt" : p.kind === "river" ? "riv" : "area";

  // Weakest first (lowest mastery box), random within each level
  function buildQueue(onlyWeak) {
    let ids = PLACES.map(p => p.id);
    if (onlyWeak) { const w = ids.filter(id => stat(id).box < MASTER); if (w.length) ids = w; }
    return shuffle(ids).sort((a, b) => stat(a).box - stat(b).box);
  }

  function roundHeader(r) {
    const n = r.queue.length;
    return `<div class="row"><span class="muted">Question ${Math.min(r.i + 1, n)} of ${n}</span>
      <span class="muted" style="margin-left:auto">Score: ${r.score}</span></div>
      <div class="bar"><div style="width:${(r.i / n) * 100}%"></div></div>`;
  }

  function roundStart(mode) {
    const weak = PLACES.some(p => stat(p.id).right + stat(p.id).wrong > 0) && PLACES.some(p => stat(p.id).box < MASTER);
    panel.innerHTML = `<h2>${TITLES[mode]}</h2><p>${INTRO[mode]}</p>
      ${mode === "type" ? macronToggle() : ""}
      <button class="btn primary" id="go-all">Start: all ${PLACES.length}</button>
      ${weak ? `<button class="btn" id="go-weak">Practice weak spots (${PLACES.filter(p => stat(p.id).box < MASTER).length})</button>` : ""}`;
    bindMacronToggle();
    panel.querySelector("#go-all").onclick = () => modeObj.begin(buildQueue(false));
    const gw = panel.querySelector("#go-weak");
    if (gw) gw.onclick = () => modeObj.begin(buildQueue(true));
  }

  function roundEnd(r, mode) {
    clearAll("target", "picked", "wrong");
    resetView();
    const n = r.queue.length, pct = Math.round(100 * r.score / n);
    const cheer = pct === 100 ? "Perfect! Optimē!" : pct >= 80 ? "Great job! Bene!" : pct >= 50 ? "Good work -- keep practicing!" : "Nice try -- practice makes perfect!";
    panel.innerHTML = `<h2>Round complete</h2><div class="big">${r.score} / ${n}</div><p>${cheer}</p>
      ${r.missed.length ? `<p class="muted">To review:</p><p>${r.missed.map(id => `<b>${esc(byId[id].name)}</b>`).join(", ")}</p>` : ""}
      ${r.missed.length ? `<button class="btn primary" id="again-miss">Practice these ${r.missed.length}</button>` : ""}
      <button class="btn" id="again">Play again</button>`;
    const am = panel.querySelector("#again-miss");
    if (am) am.onclick = () => modeObj.begin(shuffle([...r.missed]));
    panel.querySelector("#again").onclick = () => roundStart(mode);
  }

  const TITLES = { explore: "Explore the map", find: "Find it", name: "Name it", type: "Type it", progress: "Your progress" };
  const INTRO = {
    find: "I'll give you a name -- tap it on the map. Zoom in (pinch or +) for small places like Rhodus.",
    name: "A place will glow gold on the map. Pick its Latin name.",
    type: "A place will glow gold. Type its Latin name. Spelling counts!",
  };

  // ---------------------------------------------------------------- modes
  const modes = {};

  modes.explore = {
    enter() {
      svg.classList.add("show-labels");
      this.render(null);
    },
    exit() { svg.classList.remove("show-labels"); clearAll("picked"); },
    render(id) {
      const p = id && byId[id];
      panel.innerHTML = `<h2>Explore the map</h2>
        <p class="muted">Tap anything on the map to learn about it. Pinch or scroll to zoom, drag to move.</p>
        <label class="toggle"><input type="checkbox" id="lbls" ${svg.classList.contains("show-labels") ? "checked" : ""}> Show all names on map</label>
        ${p ? `<div class="card"><div class="latin">${esc(p.label)}</div><div class="en">${esc(p.en)} &middot; ${kindWord(p)}</div><p>${esc(p.fact)}</p></div>`
            : `<div class="card muted">Tip: turn names off and see how many you can say out loud before tapping.</div>`}
        <p class="muted">All ${PLACES.length} places:</p>
        <div class="row">${PLACES.map(q => `<button class="btn small" data-go="${q.id}">${esc(q.name)}</button>`).join("")}</div>`;
      panel.querySelector("#lbls").onchange = e => svg.classList.toggle("show-labels", e.target.checked);
      panel.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { this.pick(b.dataset.go); focusPlace(b.dataset.go, true); });
    },
    pick(id) { clearAll("picked"); mark(id, "picked"); this.render(id); },
    tap(hits) { if (hits.length) this.pick(hits[0]); },
  };

  modes.find = {
    enter() { roundStart("find"); },
    exit() { clearAll("revealed", "target", "wrong"); clearTimeout(this.t); },
    begin(queue) {
      clearAll("revealed", "target", "wrong");
      resetView();
      this.r = { queue, i: 0, score: 0, missed: [], tries: 0, busy: false };
      this.ask();
    },
    ask() {
      const r = this.r;
      if (r.i >= r.queue.length) return roundEnd(r, "find");
      const p = byId[r.queue[r.i]];
      r.tries = 0; r.busy = false;
      panel.innerHTML = `${roundHeader(r)}<p class="muted">Tap on the map:</p>
        <div class="big">${esc(p.name)}</div><p class="muted">(${kindWord(p)})</p>
        <div class="fb" id="fb"></div><button class="btn small" id="skip">Show me</button>`;
      panel.querySelector("#skip").onclick = () => this.reveal();
    },
    reveal() {
      const r = this.r, id = r.queue[r.i];
      r.tries = Math.max(r.tries, 2);
      mark(id, "target");
      focusPlace(id);
      const fb = panel.querySelector("#fb");
      fb.className = "fb bad"; fb.textContent = "Here it is -- tap the glowing spot.";
    },
    tap(hits) {
      const r = this.r;
      if (!r || r.busy || r.i >= r.queue.length || !hits.length) return;
      const id = r.queue[r.i], fb = panel.querySelector("#fb");
      if (hits.includes(id)) {
        r.busy = true;
        const first = r.tries === 0;
        record(id, first);
        if (first) r.score++; else r.missed.push(id);
        mark(id, "target", false); mark(id, "revealed");
        fb.className = "fb good"; fb.textContent = first ? "Correct! " + byId[id].name : "Yes, that's it!";
        clearTimeout(this.t);
        this.t = setTimeout(() => { r.i++; this.ask(); }, first ? 800 : 1300);
      } else {
        r.tries++;
        const w = hits[0];
        mark(w, "wrong");
        setTimeout(() => mark(w, "wrong", false), 1300);
        fb.className = "fb bad";
        fb.textContent = `That's ${byId[w].name}. ${r.tries >= 2 ? "" : "Try again!"}`;
        if (r.tries >= 2) this.reveal();
      }
    },
  };

  modes.name = {
    enter() { roundStart("name"); },
    exit() { clearAll("target", "revealed"); },
    begin(queue) {
      clearAll("target", "revealed");
      this.r = { queue, i: 0, score: 0, missed: [] };
      this.ask();
    },
    ask() {
      const r = this.r;
      clearAll("target", "revealed");
      if (r.i >= r.queue.length) return roundEnd(r, "name");
      const p = byId[r.queue[r.i]];
      mark(p.id, "target"); focusPlace(p.id);
      const same = shuffle(PLACES.filter(q => q.id !== p.id && group(q) === group(p)));
      const other = shuffle(PLACES.filter(q => q.id !== p.id && group(q) !== group(p)));
      const opts = shuffle([p, ...same.concat(other).slice(0, 3)]);
      panel.innerHTML = `${roundHeader(r)}<p>What is the <b>glowing</b> ${kindWord(p)} called?</p>
        <div class="choices">${opts.map(o => `<button class="btn" data-a="${o.id}">${esc(o.name)}</button>`).join("")}</div>
        <div class="fb" id="fb"></div><div id="after"></div>`;
      panel.querySelectorAll("[data-a]").forEach(b => b.onclick = () => this.answer(b.dataset.a));
    },
    answer(a) {
      const r = this.r, p = byId[r.queue[r.i]];
      const ok = a === p.id;
      record(p.id, ok);
      if (ok) r.score++; else r.missed.push(p.id);
      panel.querySelectorAll("[data-a]").forEach(b => {
        b.disabled = true;
        if (b.dataset.a === p.id) b.classList.add("right"); else if (b.dataset.a === a) b.classList.add("nope");
      });
      mark(p.id, "target", false); mark(p.id, "revealed");
      const fb = panel.querySelector("#fb");
      fb.className = "fb " + (ok ? "good" : "bad");
      fb.textContent = ok ? "Correct!" : `It's ${p.name}.`;
      const next = () => { r.i++; this.ask(); };
      if (ok) setTimeout(next, 900);
      else {
        panel.querySelector("#after").innerHTML = `<p class="muted">${esc(p.en)}: ${esc(p.fact)}</p><button class="btn primary" id="next">Next</button>`;
        panel.querySelector("#next").onclick = next;
      }
    },
  };

  // Strict spelling. Capital letters never matter; long marks only if the toggle is on.
  const needMacrons = () => store.get("macrons", false);
  function norm(s, keepMacrons) {
    s = s.normalize("NFC").toLowerCase().replace(/[()\/,.\-]/g, " ").replace(/\s+/g, " ").trim();
    if (!keepMacrons) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s;
  }
  function checkTyped(p, typed) {
    const m = needMacrons();
    const t = norm(typed, m);
    return [p.name, ...p.alt].some(a => norm(a, m) === t);
  }
  function macronToggle() {
    return `<label class="toggle"><input type="checkbox" id="mac" ${needMacrons() ? "checked" : ""}> Long marks count (ā ē ō) -- e.g. Alpēs Montēs</label>`;
  }
  function bindMacronToggle() {
    const m = panel.querySelector("#mac");
    if (m) m.onchange = e => store.set("macrons", e.target.checked);
  }
  function diffHtml(want, got) {
    let out = "";
    for (let i = 0; i < want.length; i++) {
      const ok = got[i] !== undefined && norm(got[i], needMacrons()) === norm(want[i], needMacrons());
      out += ok ? esc(want[i]) : `<span class="x">${esc(want[i])}</span>`;
    }
    return out;
  }

  modes.type = {
    enter() { roundStart("type"); },
    exit() { clearAll("target", "revealed"); },
    begin(queue) {
      clearAll("target", "revealed");
      this.r = { queue, i: 0, score: 0, missed: [] };
      this.ask();
    },
    ask() {
      const r = this.r;
      clearAll("target", "revealed");
      if (r.i >= r.queue.length) return roundEnd(r, "type");
      const p = byId[r.queue[r.i]];
      r.wrong = false; r.hint = 0; r.done = false;
      mark(p.id, "target"); focusPlace(p.id);
      panel.innerHTML = `${roundHeader(r)}<p>Type the Latin name of the <b>glowing</b> ${kindWord(p)}:</p>
        <input class="answer" id="ans" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
        <div class="macrons">${["ā", "ē", "ī", "ō", "ū"].map(c => `<button data-c="${c}" tabindex="-1">${c}</button>`).join("")}</div>
        <div class="row"><button class="btn primary" id="check">Check</button><button class="btn small" id="hint">Hint</button></div>
        <div class="fb" id="fb"></div><div id="after"></div>`;
      const inp = panel.querySelector("#ans");
      inp.addEventListener("keydown", e => { if (e.key === "Enter") this.check(); });
      panel.querySelector("#check").onclick = () => this.check();
      panel.querySelector("#hint").onclick = () => {
        r.hint++; r.wrong = true;
        inp.value = p.name.slice(0, r.hint); inp.focus();
      };
      panel.querySelectorAll("[data-c]").forEach(b => {
        b.onpointerdown = e => e.preventDefault();
        b.onclick = () => {
          const s = inp.selectionStart ?? inp.value.length, e2 = inp.selectionEnd ?? s;
          inp.value = inp.value.slice(0, s) + b.dataset.c + inp.value.slice(e2);
          inp.focus(); inp.setSelectionRange(s + 1, s + 1);
        };
      });
      if (window.matchMedia("(pointer: fine)").matches) inp.focus();
    },
    check() {
      const r = this.r, p = byId[r.queue[r.i]];
      if (r.done) return;
      const inp = panel.querySelector("#ans"), fb = panel.querySelector("#fb");
      const v = inp.value;
      if (!v.trim()) return;
      if (checkTyped(p, v)) {
        r.done = true;
        const first = !r.wrong;
        record(p.id, first);
        if (first) r.score++; else r.missed.push(p.id);
        mark(p.id, "target", false); mark(p.id, "revealed");
        fb.className = "fb good";
        fb.textContent = first ? `Correct! ${p.label}` : "Now you've got it!";
        panel.querySelector("#after").innerHTML = "";
        inp.blur();
        setTimeout(() => { r.i++; this.ask(); }, first ? 900 : 1200);
      } else {
        r.wrong = true;
        fb.className = "fb bad";
        fb.textContent = "Not quite. Correct spelling:";
        panel.querySelector("#after").innerHTML =
          `<p class="diff">${diffHtml(p.name, v.trim())}</p><p class="muted">Type it correctly to keep going.</p>`;
        inp.select();
      }
    },
  };

  modes.progress = {
    enter() { resetView(); this.render(); },
    exit() { clearAll("revealed"); },
    render() {
      clearAll("revealed");
      PLACES.forEach(p => { if (stat(p.id).box >= MASTER) mark(p.id, "revealed"); });
      const mastered = PLACES.filter(p => stat(p.id).box >= MASTER).length;
      const rows = [...PLACES].sort((a, b) => stat(a.id).box - stat(b.id).box || a.name.localeCompare(b.name));
      panel.innerHTML = `<h2>Your progress</h2>
        <div class="big">${mastered} / ${PLACES.length} mastered</div>
        <div class="bar"><div style="width:${100 * mastered / PLACES.length}%"></div></div>
        <p class="muted">Each right answer on the first try earns a star; a miss takes one away. 3 stars = mastered (shown green on the map).</p>
        <table class="prog">${rows.map(p => `<tr><td><b>${esc(p.name)}</b> <span class="muted">${esc(p.en)}</span></td><td class="stars">${stars(p.id)}</td></tr>`).join("")}</table>
        <p><button class="btn small" id="reset">Reset progress</button></p>`;
      panel.querySelector("#reset").onclick = () => {
        if (confirm("Erase all stars and start over?")) { stats = {}; store.set("stats", stats); this.render(); }
      };
    },
  };

  let modeName = null, modeObj = {};
  function setMode(m) {
    if (modeObj.exit) modeObj.exit();
    modeName = m; modeObj = modes[m];
    document.querySelectorAll("#modes button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    modeObj.enter();
  }
  document.querySelectorAll("#modes button").forEach(b => b.onclick = () => setMode(b.dataset.mode));

  applyVB();
  new ResizeObserver(applyVB).observe(svg);
  setMode("explore");

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
