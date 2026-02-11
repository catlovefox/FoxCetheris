(() => {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d", { alpha: true });

  const stage = document.getElementById("stage");
  const home = document.getElementById("home");
  const hintText = document.getElementById("stageHintText");
  const year = document.getElementById("year");

  year.textContent = String(new Date().getFullYear());

  // --- Core animation config
  const CONFIG = {
    baseDensity: 1.05, // higher => more particles; scaled by area
    maxParticles: 2600,
    minParticles: 900,
    driftSeconds: 2.8,
    gatherSeconds: 5.6,
    holdSeconds: 1.8,
    fadeSeconds: 1.9,
    wind: 0.06,
    driftSpeedMin: 0.35,
    driftSpeedMax: 1.25,
  };

  const CHARS = "01<>[]{}();=+-*/_:$#@!&|~^%";

  // Target mode: "text" is the most robust for file:// usage.
  const TARGET_MODE = "text"; // "text" | "image"
  const TARGET_TEXT = "CetherisFox";
  const FOX_IMAGE_SRC = "./fox.png"; // optional fallback if you switch TARGET_MODE to "image"
  let foxImage = null;

  let w = 0, h = 0, dpr = 1;
  let particles = [];
  let targets = [];
  let centerYRatio = 0.52;

  const state = {
    t0: performance.now(),
    mode: "drift", // drift -> gather -> hold -> fade -> done
    startedAt: performance.now(),
    gatherStart: 0,
    holdStart: 0,
    fadeStart: 0,
    skip: false,
  };

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    centerYRatio = window.matchMedia("(max-width: 700px)").matches ? 0.5 : 0.52;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (TARGET_MODE === "text") {
      targets = buildTextTargets(w, h, TARGET_TEXT);
    } else if (foxImage) {
      targets = buildImageTargets(w, h, foxImage);
    } else {
      targets = buildTextTargets(w, h, TARGET_TEXT);
    }

    const desired = targets.length > 0 ? targets.length : desiredParticleCount(w, h);
    particles = seedParticles(w, h, desired);
  }

  function desiredParticleCount(width, height) {
    const area = width * height;
    let desired = Math.floor(Math.sqrt(area) * 42 * CONFIG.baseDensity);
    desired = Math.max(CONFIG.minParticles, Math.min(CONFIG.maxParticles, desired));
    return desired;
  }

  function buildTextTargets(width, height, text) {
    // Sample on a reduced canvas for performance, then scale back up.
    const scale = Math.max(2, Math.min(4, Math.floor(Math.min(width, height) / 240)));
    const ow = Math.max(1, Math.floor(width / scale));
    const oh = Math.max(1, Math.floor(height / scale));

    const off = document.createElement("canvas");
    off.width = ow;
    off.height = oh;
    const octx = off.getContext("2d", { alpha: true });
    octx.clearRect(0, 0, ow, oh);

    // Typography tuned for the "Data Forest" vibe but still legible.
    const fontSize = Math.floor(Math.min(oh * 0.26, ow * 0.14));
    octx.font = `800 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillStyle = "#fff";
    octx.fillText(text, ow * 0.5, oh * centerYRatio);

    const img = octx.getImageData(0, 0, ow, oh);
    const data = img.data;

    const desired = desiredParticleCount(width, height);
    const stride = Math.max(1, Math.floor(Math.min(ow, oh) / 180));
    const candidates = [];
    for (let y = 0; y < oh; y += stride) {
      for (let x = 0; x < ow; x += stride) {
        const a = data[(y * ow + x) * 4 + 3];
        if (a > 16) {
          const jx = (Math.random() - 0.5) * stride * 0.9;
          const jy = (Math.random() - 0.5) * stride * 0.9;
          candidates.push({ x: x + jx, y: y + jy });
        }
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const pick = candidates.slice(0, Math.min(desired, candidates.length));
    return pick.map(pt => ({
      x: pt.x * scale,
      y: pt.y * scale,
    }));
  }

  function buildImageTargets(width, height, imgEl) {
    const size = Math.floor(Math.min(width, height) * 0.56);
    const cx = Math.floor(width * 0.5);
    const cy = Math.floor(height * centerYRatio);

    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d", { alpha: true });

    // Draw image onto offscreen (contain), then sample pixels to create a mask.
    octx.clearRect(0, 0, size, size);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    const iw = imgEl.naturalWidth || imgEl.width;
    const ih = imgEl.naturalHeight || imgEl.height;
    const s = Math.min(size / iw, size / ih);
    const dw = iw * s;
    const dh = ih * s;
    const dx = (size - dw) * 0.5;
    const dy = (size - dh) * 0.5;
    octx.drawImage(imgEl, dx, dy, dw, dh);

    const img = octx.getImageData(0, 0, size, size);
    const data = img.data;

    // Determine particle count from area but cap it.
    const area = width * height;
    let desired = Math.floor(Math.sqrt(area) * 42 * CONFIG.baseDensity);
    desired = Math.max(CONFIG.minParticles, Math.min(CONFIG.maxParticles, desired));

    // Sample pixels where alpha is present. Use a stride to keep it performant.
    const stride = Math.max(2, Math.floor(size / 110));
    const candidates = [];
    for (let y = 0; y < size; y += stride) {
      for (let x = 0; x < size; x += stride) {
        const base = (y * size + x) * 4;
        const r = data[base] / 255;
        const g = data[base + 1] / 255;
        const b = data[base + 2] / 255;
        const a = data[base + 3] / 255;
        // If the image has transparency, honor alpha; otherwise treat dark pixels as "inside".
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const hasTransparency = a < 0.98;
        const inside = hasTransparency ? (a > 0.25) : (luminance < 0.55);
        if (inside) {
          // Feather edges a bit by jittering.
          const jx = (Math.random() - 0.5) * stride * 0.7;
          const jy = (Math.random() - 0.5) * stride * 0.7;
          candidates.push({ x: x + jx, y: y + jy });
        }
      }
    }

    // Shuffle and pick desired points.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    const pick = candidates.slice(0, Math.min(desired, candidates.length));
    const left = cx - size * 0.5;
    const top = cy - size * 0.5;
    return pick.map(pt => ({
      x: left + pt.x,
      y: top + pt.y,
    }));
  }

  function seedParticles(width, height, n) {
    const list = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const sp = lerp(CONFIG.driftSpeedMin, CONFIG.driftSpeedMax, Math.random());
      const size = lerp(10, 16, Math.random());
      list[i] = {
        x, y,
        vx: (Math.random() - 0.5) * 0.15,
        vy: sp,
        ch: CHARS[(Math.random() * CHARS.length) | 0],
        alpha: lerp(0.18, 0.68, Math.random()),
        size,
        glow: Math.random() < 0.13,
        tx: x,
        ty: y,
      };
    }
    return list;
  }

  function setTargets() {
    // Map particles to targets with a little randomness so it doesn't look like a grid.
    for (let i = 0; i < particles.length; i++) {
      const t = targets[i % targets.length];
      const jitter = 1.3;
      particles[i].tx = t.x + (Math.random() - 0.5) * jitter;
      particles[i].ty = t.y + (Math.random() - 0.5) * jitter;
    }
  }

  function drawBackground(now) {
    // Subtle moving fog bands to suggest "forest" depth.
    const t = (now - state.t0) * 0.00006;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(7, 20, 18, 0.0)");
    g.addColorStop(0.5, "rgba(124, 255, 194, 0.03)");
    g.addColorStop(1, "rgba(7, 20, 18, 0.0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "rgba(161, 246, 218, 0.16)";
    const bandH = Math.max(80, Math.floor(h * 0.12));
    for (let i = 0; i < 3; i++) {
      const y = (h * (0.22 + i * 0.26)) + Math.sin(t * (2 + i)) * 22;
      ctx.fillRect(0, y, w, bandH);
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const p of particles) {
      const a = clamp01(p.alpha);
      ctx.globalAlpha = a;
      if (p.glow) {
        ctx.shadowColor = "rgba(124, 255, 194, 0.45)";
        ctx.shadowBlur = 16;
        ctx.fillStyle = "rgba(161, 246, 218, 0.92)";
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(161, 246, 218, 0.78)";
      }
      ctx.font = `${p.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillText(p.ch, p.x, p.y);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function step(now) {
    ctx.clearRect(0, 0, w, h);
    drawBackground(now);

    if (state.skip) {
      state.mode = "done";
    }

    if (state.mode === "drift") {
      const elapsed = (now - state.startedAt) / 1000;
      // Drift for a short while then gather automatically.
      if (elapsed > CONFIG.driftSeconds) {
        if (!targets.length) {
          targets = buildTextTargets(w, h, TARGET_TEXT);
        }
        if (particles.length !== targets.length) {
          particles = seedParticles(w, h, targets.length);
        }
        state.mode = "gather";
        state.gatherStart = now;
        setTargets();
        if (hintText) hintText.textContent = "它们在聚拢，像风把光带回同一个地方";
      }

      for (const p of particles) {
        p.x += p.vx + Math.sin((now * 0.001) + p.y * 0.01) * CONFIG.wind;
        p.y += p.vy;
        if (p.y > h + 24) {
          p.y = -24;
          p.x = Math.random() * w;
          p.vy = lerp(CONFIG.driftSpeedMin, CONFIG.driftSpeedMax, Math.random());
          p.ch = CHARS[(Math.random() * CHARS.length) | 0];
        }
        if (Math.random() < 0.03) p.ch = CHARS[(Math.random() * CHARS.length) | 0];
      }
    } else if (state.mode === "gather") {
      const t = clamp01((now - state.gatherStart) / (CONFIG.gatherSeconds * 1000));
      const k = easeOutCubic(t);
      for (const p of particles) {
        // A springy pull: feels alive, not like a teleport.
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        p.x += dx * (0.05 + 0.22 * k);
        p.y += dy * (0.05 + 0.22 * k);
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.alpha = lerp(p.alpha, 0.82, 0.06);
        if (Math.random() < 0.02) p.ch = CHARS[(Math.random() * CHARS.length) | 0];
      }
      if (t >= 1) {
        state.mode = "hold";
        state.holdStart = now;
        if (hintText) hintText.textContent = "在这里";
      }
    } else if (state.mode === "hold") {
      const t = clamp01((now - state.holdStart) / (CONFIG.holdSeconds * 1000));
      const breathe = 1 + Math.sin(now * 0.0022) * 0.006;
      for (const p of particles) {
        p.x = lerp(p.x, p.tx, 0.08);
        p.y = lerp(p.y, p.ty, 0.08);
        // Tiny breathing pulse around center.
        const cx = w * 0.5, cy = h * centerYRatio;
        p.x = cx + (p.x - cx) * breathe;
        p.y = cy + (p.y - cy) * breathe;
        p.alpha = lerp(p.alpha, 0.88, 0.03);
      }
      if (t >= 1) {
        state.mode = "fade";
        state.fadeStart = now;
        if (hintText) hintText.textContent = "我们正在醒来";
      }
    } else if (state.mode === "fade") {
      const t = clamp01((now - state.fadeStart) / (CONFIG.fadeSeconds * 1000));
      const k = easeInOutSine(t);
      const fade = 1 - k;
      for (const p of particles) {
        p.alpha = Math.max(0, p.alpha * 0.93) * fade;
      }
      // Fade out stage UI.
      stage.style.opacity = String(1 - k);
      if (t >= 1) state.mode = "done";
    } else if (state.mode === "done") {
      revealHome();
      return; // stop looping
    }

    drawParticles();
    requestAnimationFrame(step);
  }

  function revealHome() {
    stage.style.display = "none";
    home.classList.remove("hidden");
    // A tiny delayed focus to avoid scroll jumps.
    setTimeout(() => {
      try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (_) {}
    }, 0);
  }

  // No manual skip button; animation always runs to completion.
  window.addEventListener("resize", () => {
    resize();
  });

  // Start immediately; load the fox mask in the background to avoid "no animation" stalls.
  resize();
  requestAnimationFrame(step);

  // Optional: load image target if you switch modes later.
  (async () => {
    if (TARGET_MODE !== "image") return;
    const img = new Image();
    img.decoding = "async";
    img.src = FOX_IMAGE_SRC;
    try {
      // decode() gives us a reliable "ready" signal in modern browsers.
      if (img.decode) await img.decode();
    } catch (_) {
      // Fallback to onload below.
    }
    if (!img.complete) {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load fox image"));
      });
    }
    foxImage = img;
    if (state.mode === "drift") resize();
    else {
      targets = buildImageTargets(w, h, foxImage);
      setTargets();
    }
  })().catch(() => {
    // Ignore image load failures in text mode.
  })();
})();
