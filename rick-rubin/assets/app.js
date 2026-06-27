/* Rick Rubin Latent Space — interpretable "meaning axes" map (Canvas 2D) */
(() => {
  "use strict";

  const GENRE_COLORS = {
    "Hip-Hop":        "#f4c430",
    "Thrash/Metal":   "#ff3b30",
    "Hard Rock":      "#ff7a1a",
    "Alt-Rock":       "#b14cff",
    "Folk/Americana": "#2ec4b6",
    "Country":        "#8bd450",
    "Pop/Soul":       "#ff5da2",
  };
  const FALLBACK_COLOR = "#9aa0aa";

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("tooltip");
  const np = document.getElementById("nowplaying");

  let tracks = [];
  let axes = [];
  let xKey = "acoustic";
  let yKey = "energy";

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const cam = { scale: 1, x: 0, y: 0 };
  let baseScale = 1;

  let hoverIdx = -1;
  let playingIdx = -1;
  let highlightGenre = null;
  let pointerW = null;          // pointer position in WORLD coords (for repulsion)
  const audio = new Audio();
  audio.preload = "none";
  let t0 = performance.now();

  // idle-float + cursor-repulsion tuning (world units; axis range is [-1,1])
  const FLOAT_AMP = 0.018;      // idle drift radius
  const REPEL_R = 0.34;         // cursor influence radius
  const REPEL_STR = 0.14;       // max push distance

  // ---------- layout ----------
  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fitView();
  }
  function fitView() {
    const margin = Math.min(W, H) * 0.16 + 60;
    baseScale = Math.min((W - margin * 2) / 2, (H - margin * 2) / 2);
    cam.scale = 1; cam.x = W / 2; cam.y = H / 2;
  }
  function worldToScreen(wx, wy) {
    return [cam.x + wx * baseScale * cam.scale, cam.y - wy * baseScale * cam.scale];
  }
  function screenToWorld(sx, sy) {
    return [(sx - cam.x) / (baseScale * cam.scale), -(sy - cam.y) / (baseScale * cam.scale)];
  }

  // ---------- targets + animation ----------
  function setTargets() {
    tracks.forEach((t, i) => {
      t._tx = t.axes[xKey] ?? 0;
      t._ty = t.axes[yKey] ?? 0;
      if (t._cx === undefined) { t._cx = t._tx; t._cy = t._ty; }
      if (t._fx === undefined) {           // per-dot idle-float params (deterministic)
        t._phx = (i * 1.7) % 6.283;
        t._phy = (i * 2.9 + 1.3) % 6.283;
        t._fx = 0.18 + (i % 5) * 0.035;    // slow, varied frequencies
        t._fy = 0.16 + (i % 7) * 0.029;
        t._px = 0; t._py = 0;              // eased cursor-repulsion offset
      }
    });
  }

  function dotRadius() { return Math.max(3.4, 5.6 * Math.sqrt(cam.scale)); }

  function draw() {
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);

    // axis cross + gridlines (world-anchored)
    drawGrid();

    const r = dotRadius();
    const ts = now / 1000;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      // ease home position toward the axis target
      t._cx += (t._tx - t._cx) * 0.14;
      t._cy += (t._ty - t._cy) * 0.14;

      // idle float (gentle drift around home)
      const fx = FLOAT_AMP * Math.sin(ts * t._fx * 6.283 + t._phx);
      const fy = FLOAT_AMP * Math.cos(ts * t._fy * 6.283 + t._phy);

      // cursor repulsion (push away from pointer, eased in/out)
      let tpx = 0, tpy = 0;
      if (pointerW) {
        const ddx = t._cx - pointerW[0], ddy = t._cy - pointerW[1];
        const dist = Math.hypot(ddx, ddy);
        if (dist < REPEL_R) {
          const f = (1 - dist / REPEL_R), inv = dist > 1e-4 ? 1 / dist : 0;
          tpx = ddx * inv * f * REPEL_STR;
          tpy = ddy * inv * f * REPEL_STR;
        }
      }
      t._px += (tpx - t._px) * 0.18;
      t._py += (tpy - t._py) * 0.18;

      const [sx, sy] = worldToScreen(t._cx + fx + t._px, t._cy + fy + t._py);
      t._sx = sx; t._sy = sy;             // remember rendered pos for hit-testing
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const color = GENRE_COLORS[t.genre] || FALLBACK_COLOR;
      const dim = highlightGenre && t.genre !== highlightGenre;

      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.14 : 0.92;
      ctx.fill();
      if (!dim) {
        ctx.globalAlpha = 0.9; ctx.lineWidth = 0.8;
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (hoverIdx >= 0) {
      const t = tracks[hoverIdx];
      ctx.beginPath(); ctx.arc(t._sx, t._sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.stroke();
    }
    if (playingIdx >= 0) {
      const t = tracks[playingIdx];
      const phase = ((now - t0) % 1400) / 1400;
      ctx.beginPath(); ctx.arc(t._sx, t._sy, r + 4 + phase * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - phase)})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(t._sx, t._sy, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    }

    // keep tooltip glued to hovered dot while it floats/animates
    if (hoverIdx >= 0 && tooltip.classList.contains("show")) {
      placeTooltip(tracks[hoverIdx]._sx, tracks[hoverIdx]._sy);
    }

    requestAnimationFrame(draw);
  }

  function drawGrid() {
    const [ox, oy] = worldToScreen(0, 0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    // gridlines at -0.5, 0.5
    for (const g of [-0.5, 0.5]) {
      let [gx] = worldToScreen(g, 0); let [, gy] = worldToScreen(0, g);
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
    // center cross
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  }

  // ---------- hit testing ----------
  function pickAt(sx, sy) {
    const r = dotRadius() + 6;
    let best = -1, bestD = r * r;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (highlightGenre && t.genre !== highlightGenre) continue;
      if (t._sx === undefined) continue;
      const dx = t._sx - sx, dy = t._sy - sy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---------- tooltip ----------
  function showTooltip(i) {
    const t = tracks[i];
    const color = GENRE_COLORS[t.genre] || FALLBACK_COLOR;
    tooltip.innerHTML = `
      <div class="tt-row">
        <img class="tt-art" src="${t.artworkUrl}" alt="" onerror="this.style.visibility='hidden'">
        <div class="tt-meta">
          <div class="tt-title">${esc(t.title)}</div>
          <div class="tt-artist">${esc(t.artist)}</div>
          <div class="tt-sub">${esc(t.album)} · ${t.year}</div>
        </div>
      </div>
      <span class="tt-genre" style="background:${color}22;color:${color}">${esc(t.genre)}</span>
      <div class="tt-play-hint">${i === playingIdx ? "♪ playing — click to stop" : "click to play 30s preview"}</div>`;
    tooltip.classList.add("show");
  }
  function placeTooltip(sx, sy) {
    const tw = 248, th = tooltip.offsetHeight || 120;
    let x = sx + 16, y = sy + 16;
    if (x + tw > W - 8) x = sx - tw - 16;
    if (y + th > H - 8) y = sy - th - 16;
    tooltip.style.left = x + "px"; tooltip.style.top = y + "px";
  }
  function hideTooltip() { tooltip.classList.remove("show"); }
  function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

  // ---------- playback ----------
  function play(i) {
    if (i === playingIdx) { stop(); return; }
    const t = tracks[i];
    playingIdx = i; t0 = performance.now();
    audio.src = t.previewUrl; audio.play().catch(() => {});
    document.getElementById("np-art").src = t.artworkUrl;
    document.getElementById("np-title").textContent = t.title;
    document.getElementById("np-artist").textContent = t.artist;
    np.classList.add("show");
  }
  function stop(){ audio.pause(); playingIdx = -1; np.classList.remove("show"); }
  audio.addEventListener("ended", stop);
  document.getElementById("np-stop").addEventListener("click", stop);

  // ---------- pointer ----------
  let dragging=false, moved=false, lastX=0, lastY=0, downX=0, downY=0;
  canvas.addEventListener("pointerdown", e => {
    dragging=true; moved=false; lastX=downX=e.clientX; lastY=downY=e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    pointerW = screenToWorld(e.clientX, e.clientY);   // drive repulsion field
    if (dragging) {
      const dx=e.clientX-lastX, dy=e.clientY-lastY;
      if (Math.abs(e.clientX-downX)+Math.abs(e.clientY-downY) > 4) moved=true;
      cam.x+=dx; cam.y+=dy; lastX=e.clientX; lastY=e.clientY; hideTooltip(); return;
    }
    const i = pickAt(e.clientX, e.clientY);
    hoverIdx = i;
    if (i>=0){ showTooltip(i); placeTooltip(e.clientX,e.clientY); canvas.style.cursor="pointer"; }
    else { hideTooltip(); canvas.style.cursor="grab"; }
  });
  canvas.addEventListener("pointerup", e => {
    dragging=false;
    if (!moved){ const i=pickAt(e.clientX,e.clientY); if(i>=0) play(i); }
  });
  canvas.addEventListener("pointerleave", () => { hideTooltip(); hoverIdx=-1; pointerW=null; });
  canvas.addEventListener("wheel", e => {
    e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY*0.0015));
  }, { passive:false });
  function zoomAt(sx, sy, factor) {
    const ns = Math.min(40, Math.max(0.4, cam.scale*factor));
    const [wx, wy] = screenToWorld(sx, sy);
    cam.scale = ns;
    const [nsx, nsy] = worldToScreen(wx, wy);
    cam.x += sx - nsx; cam.y += sy - nsy;
  }
  let pinch=null;
  canvas.addEventListener("touchmove", e => {
    if (e.touches.length===2){ e.preventDefault();
      const [a,b]=e.touches; const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
      const mx=(a.clientX+b.clientX)/2, my=(a.clientY+b.clientY)/2;
      if (pinch) zoomAt(mx,my,d/pinch); pinch=d; }
  }, { passive:false });
  canvas.addEventListener("touchend", () => { pinch=null; });
  document.getElementById("reset-view").addEventListener("click", fitView);

  // ---------- axis controls + edge labels ----------
  function axById(k){ return axes.find(a => a.key === k); }
  function updateAxisLabels() {
    const ax = axById(xKey), ay = axById(yKey);
    document.getElementById("lab-right").textContent = ax.posLabel + " →";
    document.getElementById("lab-left").textContent  = "← " + ax.negLabel;
    document.getElementById("lab-top").textContent   = "↑ " + ay.posLabel;
    document.getElementById("lab-bottom").textContent= ay.negLabel + " ↓";
  }
  function buildAxisControls() {
    const opts = axes.map(a => `<option value="${a.key}">${esc(a.label)}</option>`).join("");
    const xs = document.getElementById("x-axis"), ys = document.getElementById("y-axis");
    xs.innerHTML = opts; ys.innerHTML = opts; xs.value = xKey; ys.value = yKey;
    xs.addEventListener("change", () => { xKey = xs.value; setTargets(); updateAxisLabels(); });
    ys.addEventListener("change", () => { yKey = ys.value; setTargets(); updateAxisLabels(); });
    updateAxisLabels();
  }

  // ---------- legend ----------
  function buildLegend() {
    const counts = {}; tracks.forEach(t => counts[t.genre]=(counts[t.genre]||0)+1);
    const el = document.getElementById("legend-items");
    const order = Object.keys(GENRE_COLORS).filter(g => counts[g]);
    el.innerHTML = order.map(g => `
      <div class="lg-item" data-genre="${esc(g)}">
        <span class="lg-dot" style="background:${GENRE_COLORS[g]}"></span>
        <span>${esc(g)}</span><span class="lg-count">${counts[g]}</span>
      </div>`).join("");
    el.querySelectorAll(".lg-item").forEach(item => item.addEventListener("click", () => {
      const g = item.dataset.genre;
      highlightGenre = (highlightGenre===g) ? null : g;
      el.querySelectorAll(".lg-item").forEach(it =>
        it.classList.toggle("dim", highlightGenre && it.dataset.genre!==highlightGenre));
    }));
  }

  document.getElementById("enter").addEventListener("click", () =>
    document.getElementById("intro").classList.add("hide"));

  // ---------- boot ----------
  Promise.all([
    fetch("tracks.json").then(r => r.json()),
    fetch("axes.json").then(r => r.json()),
  ]).then(([tdata, adata]) => {
    tracks = tdata; axes = adata;
    document.getElementById("track-count").textContent = tracks.length;
    setTargets(); buildAxisControls(); buildLegend(); resize();
    requestAnimationFrame(draw);
  }).catch(err => {
    document.getElementById("title-sub").textContent = "failed to load data";
    console.error(err);
  });

  window.addEventListener("resize", resize);
})();
