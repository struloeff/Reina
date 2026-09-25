// Harness for src/earth.js: the Earth on the real stage, driven by the rig, so
// ?t=X&freeze is exactly the show's frame at X.
//
//   ?nosky        no placeholder stars
//   ?guide        the rig's disc as a thin ring (checks the silhouette lands on it)
//   ?words        a rough stand-in for the line on screen at that moment
//   ?nosun        hide the sun and its starburst (to judge the air on its own)
//   ?uHR=0.01     override any shader uniform by name (numbers only)

import * as THREE from 'three';
import { runHarness } from './kit.js';
import { frameAt } from '../src/rig.js';
import { createEarth } from '../src/earth.js';

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// a throwaway starfield so the planet can be judged against stars
function placeholderSky(stage) {
  const n = 4000;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = hash(i * 3 + 1) * 2 - 1;
    const a = hash(i * 3 + 2) * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    pos.set([s * Math.cos(a) * 100, z * 100, s * Math.sin(a) * 100], i * 3);
    mag[i] = Math.pow(hash(i * 3 + 3), 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uDpr: { value: 1 }, uB: { value: 1 } },
    vertexShader: `attribute float aMag; uniform float uDpr; varying float vA;
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.6 + aMag * 2.4) * uDpr; vA = 0.12 + aMag * 1.2; }`,
    fragmentShader: `uniform float uB; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(smoothstep(1.0, 0.2, d) * vA * uB), 1.0); }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -10;
  pts.frustumCulled = false;
  stage.scene.add(pts);
  return {
    update(F) {
      pts.position.copy(stage.camera.position);
      mat.uniforms.uDpr.value = stage.size.dpr;
      mat.uniforms.uB.value = F.sky.brightness * F.sky.reveal * 0.8;
    },
  };
}

function discGuide(stage) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3060, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.998, 1.0, 512), mat);
  ring.frustumCulled = false;
  stage.overlay.scene.add(ring);
  return {
    update(F) {
      ring.position.set(F.disc.cx, F.disc.cy, 0);
      ring.scale.setScalar(F.disc.r);
    },
  };
}

// Trying rig changes before proposing them (the rig is not ours to edit):
//   ?spinDeg=4    turn the planet 4 degrees further east under the camera
//   ?sunUp=0.6    the globe's sun (rig sunB) with this up component instead of 0.5
function rigProbe(stage, q) {
  const spin = q.has('spinDeg') ? (+q.get('spinDeg') * Math.PI) / 180 : 0;
  const up = q.has('sunUp') ? +q.get('sunUp') : null;
  if (!spin && up === null) return null;
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upV = new THREE.Vector3();
  const back = new THREE.Vector3();
  return (F) => {
    F.earth.spin += spin;
    F.earth.cloudSpin += spin;
    if (up !== null) {
      stage.camera.matrixWorld.extractBasis(right, upV, back);
      dir.copy(stage.camera.position).normalize();
      F.earth.sunDir.copy(dir).multiplyScalar(0.35).addScaledVector(right, -0.8).addScaledVector(upV, up).normalize();
    }
  };
}

// stand-in lines (the real words, from index.html) for composition only
const STAND_INS = [
  { from: 1.6, to: 8.5, text: 'Hey Reina', y: (L, h) => 0.4 * h },
  { from: 8.4, to: 13.9, text: 'out of all the people on earth...', y: (L, h) => 0.32 * h },
  { from: 12.6, to: 20.2, text: "you're the only one for me <3", y: (L) => L.globe.cy + L.globe.r + 56 },
  { from: 20.9, to: 25.3, text: 'and out of all the stars in the night sky...', y: (L, h) => 0.5 * h },
];

runHarness({
  textures: true,
  setup({ stage, tex, q }) {
    const sky = q.has('nosky') ? null : placeholderSky(stage);
    const earth = createEarth(stage, tex);
    const guide = q.has('guide') ? discGuide(stage) : null;
    const overrides = [...q.entries()].filter(([k, v]) => k in earth.uniforms && v !== '' && isFinite(+v));
    for (const [k] of overrides) earth.tuned.add(k);
    let words = null;
    if (q.has('words')) {
      words = document.createElement('p');
      words.className = 'stand-in';
      document.body.appendChild(words);
    }
    return { sky, earth, guide, overrides, words, nosun: q.has('nosun'), probe: rigProbe(stage, q) };
  },
  frame({ t, dt, stage, sky, earth, guide, overrides, words, nosun, probe }) {
    // before update, so values derived from a pinned uniform follow it (uHR ->
    // the shell's size), and after, so the per-frame writes don't undo it
    for (const [k, v] of overrides) earth.uniforms[k].value = +v;
    const F = frameAt(t, stage.size, stage.camera);
    if (probe) probe(F);
    sky?.update(F);
    earth.update(t, dt, F.earth);
    for (const [k, v] of overrides) earth.uniforms[k].value = +v;
    if (nosun) earth.parts.sun.visible = false;
    guide?.update(F);
    stage.grade.uFlash.value = F.grade.flash;
    stage.grade.uFade.value = F.grade.fade;
    stage.grade.uVignette.value = F.grade.vignette;
    if (words) {
      const s = STAND_INS.find((w) => t >= w.from && t < w.to);
      words.style.display = s ? '' : 'none';
      if (s) {
        words.textContent = s.text;
        words.style.top = s.y(F.layout, stage.size.h) + 'px';
      }
    }
  },
});
