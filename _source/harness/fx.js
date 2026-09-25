// Harness for the two overlay effects: THE shooting star (meteor.js) and the
// hearts (hearts.js), on the real stage, driven by the rig so ?t= frames are
// the show's own. The sky here is a throwaway placeholder: a sparse starfield at
// the show's brightness, and a copy of sky.js's hero-star shader (copied, not
// imported, per SPEC section 5) so the meteor's hand-off is judged against the
// real star, spikes and all. The words are stand-ins positioned like the real ones.
//
//   ?only=meteor|hearts   draw one effect
//   ?nowords              hide the placeholder words
//   ?nosky                hide the placeholder stars and hero
//   ?reduced              frameAt(..., {reduced}) and p.reduced for both modules
//   ?flash=0.5            scale the director's screen flash
//   ?flash=radial         preview the flash proposed to the integrator: weaker,
//                         shorter, and centred on the star (patches the grade pass here only)
//   ?slip                 a stand-in for act two's glass report slip behind the score
//   ?count=28 ?burstY=.3  the burst's count and height (default 40 at .45)

import * as THREE from 'three';
import { runHarness } from './kit.js';
import { frameAt, smooth, pulse } from '../src/rig.js';
import { T } from '../src/script.js';
import { createMeteor } from '../src/meteor.js';
import { createHearts } from '../src/hearts.js';

const streams = [
  { start: 49.8, end: 60.6, every: 0.42, opacity: 1, band: [0.04, 0.96] },
  { start: 60.6, end: Infinity, every: 1.7, opacity: 0.55, band: [0.02, 0.98] },
];
const bursts = [{ at: 62, count: 40, x: 0.5, y: 0.45, spread: 1 }];

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// a copy of sky.js HERO_FRAG (2026-09-23, re-synced), so the burst is judged against the
// star that really takes over from it
const HERO_VERT = /* glsl */ `
  varying vec2 vOff;
  uniform float uHalf;
  void main() {
    vOff = position.xy * uHalf;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const HERO_FRAG = /* glsl */ `
  uniform float uI, uTime, uUnit, uDpr, uHalf;
  varying vec2 vOff;
  vec3 spikeColour(float x, float t) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + x * 1.2 - t * 0.07));
    return mix(vec3(1.0), rainbow, 0.12 * smoothstep(0.25, 0.95, x));
  }
  void main() {
    vec2 p = vOff;
    float r = length(p);
    float I = uI;
    float t = uTime;
    float tw = 1.0 + 0.05 * sin(t * 7.3) + 0.035 * sin(t * 12.9 + 1.3) + 0.03 * sin(t * 3.1 + 0.4);
    float sc = (0.62 + 0.1 * I) / sqrt(uDpr);
    float core = exp(-0.5 * r * r / (sc * sc)) * (1.4 + 2.2 * I) * tw;
    float halo = exp(-r / (uUnit * (1.1 + 1.0 * I))) * (0.16 + 0.12 * I) * tw;
    float glow = 0.035 * I * exp(-r / (uUnit * (2.5 + 2.5 * I)));
    vec3 shimmer = 1.0 + 0.07 * vec3(sin(t * 2.3), sin(t * 1.7 + 2.0), sin(t * 2.9 + 4.0));
    float win = 1.0 - smoothstep(0.35 * uHalf, 0.95 * uHalf, r);
    vec3 c = (vec3(1.0) * core + vec3(1.0, 0.94, 0.86) * shimmer * halo + vec3(1.0, 0.86, 0.7) * glow) * win;
    float len = uUnit * (8.0 + 13.5 * I);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float a = i == 2 ? 1.02 : 0.16 + fi * 1.5707963;
      vec2 dir = vec2(cos(a), sin(a));
      float al = abs(dot(p, dir));
      float ac = abs(dot(p, vec2(-dir.y, dir.x)));
      float L = len * (i == 2 ? 0.52 : 1.0) * (1.0 + 0.06 * sin(t * 1.9 + fi * 2.1) + 0.03 * sin(t * 5.3 + fi));
      float w = (0.36 + 0.0035 * al) * (0.8 + 0.08 * I) / mix(1.0, sqrt(uDpr), 0.5);
      float across = exp(-0.5 * ac * ac / (w * w));
      float x = al / L;
      vec3 xs = al / (L * vec3(1.02, 1.0, 0.98));
      vec3 along = pow(1.0 + xs * 7.0, vec3(-1.55)) * (1.0 - smoothstep(vec3(0.35), vec3(1.0), xs));
      float amp = (i == 2 ? 0.32 : 1.0) * (0.3 + 0.42 * I) * tw;
      c += spikeColour(x, t) * along * across * amp;
    }
    c *= 1.0 - smoothstep(0.9 * uHalf, uHalf, r);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function placeholderSky(stage) {
  const N = 260;
  const pos = new Float32Array(N * 3);
  const mag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = hash(i, 1);
    pos[i * 3 + 1] = hash(i, 2);
    mag[i] = Math.pow(hash(i, 3), 5); // mostly faint
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const stars = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uB: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aMag;
        uniform vec2 uSize; uniform float uDpr, uB;
        varying float vI;
        void main() {
          vI = (0.25 + 2.2 * aMag) * uB;
          gl_PointSize = (1.6 + 2.5 * aMag) * uDpr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uSize, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vI;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(vec3(0.95, 0.96, 1.0) * vI * exp(-r * r * 5.0), 1.0);
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -5;

  const hu = { uI: { value: 0 }, uTime: { value: 0 }, uUnit: { value: 1 }, uDpr: { value: 1 }, uHalf: { value: 50 } };
  const hero = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: hu,
      vertexShader: HERO_VERT,
      fragmentShader: HERO_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  hero.frustumCulled = false;
  hero.renderOrder = 20;
  stage.overlay.scene.add(stars, hero);

  return {
    update(t, F) {
      const { w, h, dpr } = stage.size;
      stars.material.uniforms.uSize.value.set(w, h);
      stars.material.uniforms.uDpr.value = dpr;
      stars.material.uniforms.uB.value = F.sky.brightness * F.sky.reveal;
      const H = F.sky.hero;
      const I = H.intensity;
      hero.visible = I > 0.001;
      if (!hero.visible) return;
      const unit = Math.min(1.6, Math.max(1, Math.min(w, h) / 390)) * (H.size || 1);
      const half = unit * (8 + 13.5 * I) * 1.12 + unit * 6;
      hero.position.set(H.x * w, H.y * h, 0);
      hero.scale.set(half, half, 1);
      hu.uI.value = I;
      hu.uTime.value = t;
      hu.uUnit.value = unit;
      hu.uDpr.value = dpr;
      hu.uHalf.value = half;
    },
  };
}

// The flash proposed to the integrator (rig.js + stage.js GradeShader), applied
// to this harness's grade pass only: weaker, quicker, and radiating from the star.
function radialFlash(stage) {
  const pass = stage.composer.passes[stage.composer.passes.length - 1];
  const U = pass.material.uniforms;
  U.uFlashAt = { value: new THREE.Vector2(0.5, 0.5) };
  pass.material.fragmentShader = pass.material.fragmentShader
    .replace('uniform vec2 uRes;', 'uniform vec2 uRes;\n    uniform vec2 uFlashAt;')
    .replace(
      'col = 1.0 - (1.0 - col) * (1.0 - uFlashColor * uFlash);',
      'float fr = length((vUv - uFlashAt) * vec2(uRes.x / uRes.y, 1.0));\n' +
        '      float fk = uFlash * (0.15 + 0.85 * exp(-fr / 0.3));\n' +
        '      col = 1.0 - (1.0 - col) * (1.0 - uFlashColor * fk);',
    );
  pass.material.needsUpdate = true;
  return (t, F, reduced) => {
    U.uFlashAt.value.set(F.meteor.to[0], 1 - F.meteor.to[1]);
    return (reduced ? 0.1 : 0.3) * pulse(t, T.flash, 0.06, 0.35);
  };
}

// stand-in words, shown on the real cues so the effects are judged in context
function placeholderWords(on) {
  const el = (id) => document.getElementById(id);
  const words = [
    [el('c-brightest'), 26.15, 30.0, 0.6, 1.0],
    [el('c-many'), 49.2, 56.0, 1.6, 1.2],
    [el('c-intro'), 57.6, 60.9, 1.2, 0.8],
    [el('c-score'), 61.2, 66.8, 0.6, 1.0],
  ];
  return (t) => {
    for (const [e, at, until, inDur, outDur] of words) {
      const a = on ? smooth(at, at + inDur, t) * (1 - smooth(until, until + outDur, t)) : 0;
      e.style.opacity = a.toFixed(3);
    }
  };
}

runHarness({
  setup({ stage, q }) {
    const only = q.get('only');
    const meteor = only === 'hearts' ? null : createMeteor(stage);
    const hearts = only === 'meteor' ? null : createHearts(stage);
    const sky = q.has('nosky') ? null : placeholderSky(stage);
    const words = placeholderWords(!q.has('nowords'));
    const fq = q.get('flash');
    const radial = fq === 'radial' ? radialFlash(stage) : null;
    const flashScale = fq !== null && fq !== 'radial' ? +fq : 1;
    const reduced = q.has('reduced');
    if (q.has('slip')) document.body.classList.add('has-slip');
    // ?count=28 ?burstY=0.285: the burst as act two would really fire it
    if (q.has('count')) bursts[0].count = +q.get('count');
    if (q.has('burstY')) {
      bursts[0].y = +q.get('burstY');
      document.getElementById('c-score').style.top = bursts[0].y * 100 + '%';
      document.querySelector('.slip').style.top = bursts[0].y * 100 + '%';
    }
    // one params object for the hearts, reused every frame
    const heartsP = { streams, bursts, reduced };
    return { meteor, hearts, sky, words, flashScale, radial, reduced, heartsP };
  },
  frame({ t, dt, stage, meteor, hearts, sky, words, flashScale, radial, reduced, heartsP }) {
    const F = frameAt(t, stage.size, stage.camera, { reduced });
    F.meteor.reduced = reduced;
    meteor?.update(t, dt, F.meteor);
    hearts?.update(t, dt, heartsP);
    sky?.update(t, F);
    words(t);
    stage.grade.uFlash.value = radial ? radial(t, F, reduced) : F.grade.flash * flashScale;
    stage.grade.uFade.value = F.grade.fade;
    stage.grade.uVignette.value = F.grade.vignette;
  },
});
