// Harness for the words of act one, without WebGL. A throwaway 2D canvas stands
// in for the sky: a few stars, the planet's disc as a dim blue circle with a thin
// rim (from frameAt(...).disc, which needs no camera), a rough sunrise glare, the
// hero star and the flash - just enough context to judge the mask, the glows and
// legibility. The words themselves are the real module on the real CSS.
//
//   harness/lines.html?t=12.9&freeze          one frame
//   harness/lines.html?t=30&reduced           reduced motion
//   harness/lines.html?t=13&nosky             words only (no stand-in canvas)
//   harness/lines.html?t=15&onlyDur=3.8       preview l-only with another enterDur
//   harness/lines.html?t=15&nogl              no planet (the director's no-WebGL case)

import { runHarness } from './kit.js';
import { frameAt } from '../src/rig.js';
import { CUES, T } from '../src/script.js';
import { createLines } from '../src/lines.js';

const hash = (i, j) => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

runHarness({
  gl: false,
  setup({ q }) {
    const reduced = q.has('reduced');
    const onlyDur = q.has('onlyDur') ? +q.get('onlyDur') : null;
    const cues = CUES.map((c) => (c.id === 'l-only' && onlyDur ? { ...c, enterDur: onlyDur } : c));
    const lines = createLines(document, cues, { reducedMotion: reduced });
    const canvas = document.getElementById('sky');
    const ctx = canvas.getContext('2d');
    const stars = Array.from({ length: 420 }, (_, i) => ({
      x: hash(i, 1),
      y: hash(i, 2),
      r: 0.35 + Math.pow(hash(i, 3), 6) * 1.3,
      a: 0.15 + Math.pow(hash(i, 4), 3) * 0.75,
    }));
    return { lines, canvas, ctx, stars, reduced, nosky: q.has('nosky'), nogl: q.has('nogl') };
  },
  frame({ t, dt, lines, canvas, ctx, stars, reduced, nosky, nogl }) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = { w, h };
    const F = frameAt(t, size, null, { reduced });
    const L = F.layout;

    // what the director publishes on resize
    const root = document.documentElement.style;
    root.setProperty('--globe-cx', L.globe.cx + 'px');
    root.setProperty('--globe-cy', L.globe.cy + 'px');
    root.setProperty('--globe-r', L.globe.r + 'px');
    root.setProperty('--hero-x', L.hero.x * 100 + '%');
    root.setProperty('--hero-y', L.hero.y * 100 + '%');

    // ------------------------------------------------ the stand-in sky
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!nosky) {
      const b = F.sky.brightness;
      for (const s of stars) {
        const show = Math.min(1, Math.max(0, (F.sky.reveal * 1.25 - s.x) / 0.2));
        if (show <= 0) continue;
        ctx.fillStyle = `rgba(235,240,255,${s.a * b * show * 0.8})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, 6.283);
        ctx.fill();
      }

      const d = F.disc;
      if (F.earthVisible && !nogl) {
        const op = F.earth.opacity;
        ctx.save();
        ctx.globalAlpha = op;
        const gr = ctx.createRadialGradient(d.cx - d.r * 0.3, d.cy - d.r * 0.3, 0, d.cx, d.cy, d.r);
        gr.addColorStop(0, '#1b3a6e');
        gr.addColorStop(1, '#081631');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, Math.max(0.5, d.r), 0, 6.283);
        ctx.fill();
        // a rough atmosphere: a soft luminous band just outside the limb, about
        // as thick as the real one, so the mask's edge can be judged against it
        if (d.r > 8) {
          const band = Math.max(5, 0.022 * d.r);
          const ag = ctx.createRadialGradient(d.cx, d.cy, d.r - 1.5, d.cx, d.cy, d.r + band);
          const warm = t < T.lift[0] + 1;
          ag.addColorStop(0, warm ? 'rgba(255,170,90,0.75)' : 'rgba(150,195,255,0.7)');
          ag.addColorStop(0.35, warm ? 'rgba(120,150,255,0.35)' : 'rgba(110,160,255,0.3)');
          ag.addColorStop(1, 'rgba(60,90,200,0)');
          ctx.fillStyle = ag;
          ctx.beginPath();
          ctx.arc(d.cx, d.cy, d.r + band, 0, Math.PI * 2);
          ctx.moveTo(d.cx + d.r - 1.5, d.cy);
          ctx.arc(d.cx, d.cy, Math.max(0.5, d.r - 1.5), 0, Math.PI * 2);
          ctx.fill('evenodd');
        }
        // a rough sunrise: a warm glare on the limb, right of centre
        const glare = F.earth.glare;
        if (glare > 0.01 && t < T.lift[1]) {
          const sx = d.cx + 0.22 * w;
          const sy = d.cy - Math.sqrt(Math.max(0, d.r * d.r - (0.22 * w) ** 2));
          const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.55);
          gg.addColorStop(0, `rgba(255,236,200,${0.85 * glare})`);
          gg.addColorStop(0.08, `rgba(255,210,150,${0.35 * glare})`);
          gg.addColorStop(1, 'rgba(255,180,120,0)');
          ctx.fillStyle = gg;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
      }

      const hi = F.sky.hero.intensity;
      if (hi > 0) {
        const hx = F.sky.hero.x * w;
        const hy = F.sky.hero.y * h;
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 4 + 7 * hi);
        hg.addColorStop(0, 'rgba(255,255,255,1)');
        hg.addColorStop(0.15, `rgba(255,248,235,${Math.min(1, 0.5 * hi)})`);
        hg.addColorStop(1, 'rgba(200,215,255,0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hx, hy, 4 + 7 * hi, 0, 6.283);
        ctx.fill();
      }

      if (F.grade.flash > 0.002) {
        ctx.fillStyle = `rgba(255,248,232,${F.grade.flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
    if (F.grade.fade > 0.002) {
      ctx.fillStyle = `rgba(0,0,0,${F.grade.fade})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ------------------------------------------------ the words, exactly as the director drives them
    lines.update(t, dt, {
      earthDisc: F.earthVisible && !nogl ? { x: F.disc.cx, y: F.disc.cy, r: F.disc.r } : null,
      globe: L.globe,
      reducedMotion: reduced,
    });
  },
});
