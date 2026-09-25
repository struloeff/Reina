// The secret on its own, on the real stage (same renderer, bloom, tone mapping
// and grading as the show), over a throwaway placeholder starfield so the game
// sits in a sky like the real one. No other builder's module is imported.
//
//   harness/minigame.html            the found card, as the director opens it
//   ?auto                            straight into a round
//   ?seed=N                          a fixed star schedule (round r uses N + r*7919)
//   ?reduced                         reduced motion
//   ?nogl                            no WebGL: the DOM/CSS fallback
//   ?closed                          do not open it (window.__minigame.open() does)
//
// The hooks log to the console and stamp window.__moods / __celebrations /
// __done; celebrate() also pops three placeholder hearts, so the catch can be
// judged with them. window.__minigame is the test hook: state, score, time,
// round, heads() (live heads in CSS px), and speed (frames of update per frame,
// for fast-forwarding a round in a flow test).

import * as THREE from 'three';
import { runHarness } from './kit.js';
import { createMinigame } from '../src/minigame.js';

const q0 = new URLSearchParams(location.search);
if (q0.has('nogl')) document.documentElement.classList.add('h-nogl');

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// a few hundred faint points in screen space, a handful brighter, gently twinkling
function placeholderSky(stage) {
  const N = 560;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const siz = new Float32Array(N);
  const ph = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const place = () => {
    const { w, h } = stage.size;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = hash(i, 1) * w;
      pos[i * 3 + 1] = hash(i, 2) * h;
    }
    geo.attributes.position && (geo.attributes.position.needsUpdate = true);
  };
  for (let i = 0; i < N; i++) {
    const m = Math.pow(hash(i, 3), 3.2); // mostly faint
    const b = 0.1 + 0.9 * m;
    const tint = hash(i, 4);
    const r = tint < 0.15 ? 0.78 : tint > 0.9 ? 1.0 : 0.95;
    const g = tint < 0.15 ? 0.85 : tint > 0.9 ? 0.86 : 0.95;
    const bl = tint < 0.15 ? 1.0 : tint > 0.9 ? 0.7 : 0.95;
    col[i * 3] = r * b * 0.75;
    col[i * 3 + 1] = g * b * 0.75;
    col[i * 3 + 2] = bl * b * 0.75;
    siz[i] = 1.1 + 2.4 * m;
    ph[i] = hash(i, 5) * 6.283;
  }
  place();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      uniform float uDpr, uTime;
      varying vec3 vCol;
      void main() {
        vCol = color * (0.85 + 0.15 * sin(uTime * (1.3 + fract(phase) * 2.0) + phase * 7.0));
        gl_PointSize = size * uDpr;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vCol * exp(-r * r * 3.5), 1.0);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  stage.overlay.scene.add(pts);
  stage.onResize(place);
  return mat.uniforms;
}

// stands in for the director's heart burst: three small glowing hearts pop
// out of the catch and float up
const HEART = '<svg viewBox="0 0 32 30"><path d="M16 29 C 6 21, 0 15, 0 8.5 C 0 3.6, 3.8 0, 8.4 0 C 11.6 0, 14.4 1.8, 16 4.6 C 17.6 1.8, 20.4 0, 23.6 0 C 28.2 0, 32 3.6, 32 8.5 C 32 15, 26 21, 16 29 Z" fill="currentColor"/></svg>';
const HEART_COLS = ['#ff9db5', '#ffb3c6', '#ffe2a8', '#ff8aa8', '#fff1e4'];
let heartN = 0;
function heartPop(fx, fy, count) {
  const layer = document.querySelector('.h-hearts');
  const x = fx * innerWidth;
  const y = fy * innerHeight;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'h-heart';
    el.innerHTML = HEART;
    el.style.color = HEART_COLS[heartN++ % HEART_COLS.length];
    const s = 11 + 7 * hash(heartN, 9);
    el.style.width = el.style.height = s + 'px';
    layer.append(el);
    const a = -Math.PI / 2 + (i - (count - 1) / 2) * 0.9 + (hash(heartN, 11) - 0.5) * 0.4;
    const r = 26 + 16 * hash(heartN, 12);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const rot = (hash(heartN, 13) - 0.5) * 30;
    el.animate(
      [
        { transform: `translate3d(${x - s / 2}px, ${y - s / 2}px, 0) scale(0.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate3d(${px - s / 2}px, ${py - s / 2}px, 0) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.18 },
        { transform: `translate3d(${px - s / 2}px, ${py - s / 2 - 70}px, 0) scale(0.9) rotate(${-rot}deg)`, opacity: 0 },
      ],
      { duration: 1900, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
    ).onfinish = () => el.remove();
  }
}

runHarness({
  gl: !q0.has('nogl'),
  setup({ stage, q }) {
    const skyU = stage ? placeholderSky(stage) : null;
    const reducedMotion = q.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.__moods = [];
    window.__celebrations = [];
    window.__done = null;
    const mg = createMinigame(stage, document.getElementById('minigame'), window.REINA || {}, {
      reducedMotion,
      seed: q.has('seed') ? +q.get('seed') : undefined,
      celebrate(x, y, count) {
        window.__celebrations.push({ x, y, count, at: performance.now() });
        console.log(`[minigame] celebrate x=${x.toFixed(3)} y=${y.toFixed(3)} count=${count}`);
        heartPop(x, y, count);
      },
      onMood(name) {
        window.__moods.push(name);
        console.log(`[minigame] onMood ${name}`);
      },
    });
    const open = () =>
      mg.start((score) => {
        window.__done = { score, at: performance.now() };
        console.log(`[minigame] onDone ${score}`);
        document.querySelector('.h-done').textContent = `onDone(${score})`;
      });
    if (!q.has('closed')) open();
    if (q.has('auto')) document.querySelector('#minigame .mg-start')?.click();
    let speed = 1;
    window.__minigame = {
      get state() {
        return mg.state;
      },
      get score() {
        return mg.score;
      },
      get time() {
        return mg.time;
      },
      get round() {
        return mg.round;
      },
      get active() {
        return mg.active;
      },
      heads: () => mg.heads(),
      get speed() {
        return speed;
      },
      set speed(v) {
        speed = Math.max(1, Math.round(v));
      },
      open,
    };
    return { mg, skyU, getSpeed: () => speed };
  },
  frame({ t, dt, stage, mg, skyU, getSpeed }) {
    if (skyU) {
      skyU.uDpr.value = stage.size.dpr;
      skyU.uTime.value = t;
    }
    const n = getSpeed();
    for (let i = 0; i < n; i++) mg.update(t, dt);
  },
});
