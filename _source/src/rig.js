// The camera, the sun and every continuous 3D value of the show, as one pure
// function of time: frameAt(t, size, camera) places the camera and returns
// the params for earth / sky / meteor and the grading pass. The director calls it
// every frame; harness pages call it to render exactly what the show renders at
// any given moment.
//
// Placing the planet: the camera always looks straight at the Earth's centre and
// the picture is shifted (a lens shift, setViewOffset) so the disc lands exactly
// where layout() says, at exactly the radius it says. With the centre on the
// optical axis the silhouette is a true circle, which is what lets the words
// behind the planet be masked by that circle precisely.

import * as THREE from 'three';
import { T, layout } from './script.js';

const DEG = Math.PI / 180;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const seg = (t, [a, b]) => clamp01((t - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const easeIn = (k) => k * k * k;
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
// attack-then-exponential-decay envelope, peaking at `at`
export const pulse = (t, at, attack, tau) =>
  t < at - attack ? 0 : t < at ? (t - (at - attack)) / attack : Math.exp(-(t - at) / tau);

/** where the Earth's disc is on screen at time t: {cx, cy, r} in CSS px */
export function discAt(t, L) {
  if (t < T.lift[0]) {
    const k = easeOut(seg(t, T.earthrise));
    return { cx: L.dome.cx, cy: lerp(L.below.cy, L.dome.cy, k), r: L.dome.r };
  }
  if (t < T.recede[0]) {
    const k = easeInOut(seg(t, T.lift));
    return { cx: L.globe.cx, cy: lerp(L.dome.cy, L.globe.cy, k), r: lerp(L.dome.r, L.globe.r, k) };
  }
  // it shrinks where it is: the lens shift follows the disc, so moving it here
  // would pan the whole sky while it zooms
  const k = easeIn(seg(t, T.recede));
  const r = Math.exp(lerp(Math.log(L.globe.r), Math.log(1.1), k));
  return { cx: L.globe.cx, cy: L.globe.cy, r };
}

const camDir = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
const camBack = new THREE.Vector3();
const sunA = new THREE.Vector3();
const sunB = new THREE.Vector3();
const skyTurn = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Place `camera` for time t and return every continuous value of the frame.
 * size = {w, h}; opts = { reduced, mood } (mood: 'show' | 'quiz' | 'grade' | 'letter').
 * The returned objects are reused between calls: read them, don't keep them.
 */
export function frameAt(t, size, camera, { reduced = false, mood = 'show' } = {}) {
  const L = layout(size.w, size.h);
  const disc = discAt(t, L);
  const earthOpacity = 1 - smooth(T.dotOut[0], T.dotOut[1], t);

  // the opening eases in from a little wide (40 -> 34 degrees) while the sky
  // appears; the zoom at 20s narrows it further (34 -> 26)
  const settle = reduced ? 34 : lerp(40, 34, easeOut(seg(t, T.settle)));
  const fov = lerp(settle, 26, easeInOut(seg(t, T.zoom)) * (reduced ? 0.4 : 1));
  const swing = easeInOut(seg(t, T.lift)) * (reduced ? 0.35 : 1);
  const az = (-8 + 0.35 * t + 22 * swing) * DEG;
  const el = (6 + 6 * swing) * DEG;

  const f = size.h / 2 / Math.tan((fov * DEG) / 2);
  const alpha = Math.atan(disc.r / f);
  const dist = 1 / Math.sin(Math.max(alpha, 1e-7));
  camDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  if (camera) {
    camera.fov = fov;
    camera.position.copy(camDir).multiplyScalar(dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(size.w, size.h, size.w / 2 - disc.cx, size.h / 2 - disc.cy, size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(camRight, camUp, camBack);
  }

  // The sun, relative to the camera. A: just behind the top edge of the
  // horizon, a little right of centre, rising over it. B: upper left and a
  // little in front, so the globe is a bright gibbous with its night side (and
  // cities) on the right.
  const limbX = Math.min(0.9, (0.22 * size.w) / L.dome.r);
  const gamma = Math.asin(limbX);
  const beta = Math.atan(L.dome.r / f) + lerp(-5, 1.4, easeInOut(seg(t, T.sunrise))) * DEG;
  sunA
    .copy(camDir)
    .multiplyScalar(-Math.cos(beta))
    .addScaledVector(camUp, Math.sin(beta) * Math.cos(gamma))
    .addScaledVector(camRight, Math.sin(beta) * Math.sin(gamma))
    .normalize();
  // (up .6 rather than .5 puts the ocean glint on the Mediterranean, not the Libyan coast)
  sunB.copy(camDir).multiplyScalar(0.35).addScaledVector(camRight, -0.8).addScaledVector(camUp, 0.6).normalize();
  const swap = easeInOut(seg(t, [T.lift[0], T.lift[0] + 2.2]));
  const sunDir = sunA.lerp(sunB, swap).normalize();

  // which longitude faces us: Europe's lights under the sunrise, then the
  // Apollo 17 side of the world (Africa) as a whole globe. It decreases over
  // time so the planet turns the way the real one does (eastward).
  // (19E under the sunrise at t=9, ~42E for the globe at t=16: the two views
  // the Earth was tuned on)
  const lonFacing = (lerp(19, 49.4, swing) - 1.1 * (t - 9)) * DEG;
  const spin = az - lonFacing;

  // sky brightness: full, then down for the meteor, back softer, and in act two
  // brighter for the game, dimmer behind the letter
  const dimK = easeInOut(seg(t, T.dim));
  const backK = easeInOut(seg(t, T.skyBack));
  let brightness = lerp(1, 0.12, dimK) + 0.5 * backK;
  const moodSky = mood === 'letter' ? 0.5 : mood === 'game' ? 0.95 : 0.75;
  if (t > T.act2) brightness = lerp(brightness, moodSky, smooth(T.act2, T.act2 + 1.5, t));
  // the brightest star is born in the burst (a 60 ms swell, not a step), rests
  // at ~1, and steps back behind the letter so it never sits on the words
  const heroRest = t > T.act2 ? (mood === 'letter' ? 0.3 : 0.7) : 1.05;
  const heroIntensity = smooth(T.flash - 0.06, T.flash, t) * (heroRest + 5.5 * Math.exp(-Math.max(0, t - T.flash) / 0.45));

  // after the meteor beat the sky turns with the camera's slow orbit, so the
  // brightest star (drawn in screen space) stays among the same stars
  const lk = t - T.dim[0];
  skyTurn.y = lk > 0 ? 0.35 * DEG * (lk - 0.3 * (1 - Math.exp(-lk / 0.3))) : 0;

  return {
    layout: L,
    disc,
    earthVisible: earthOpacity > 0 && t > T.earthrise[0] - 0.1 && disc.cy - disc.r < size.h,
    earth: {
      spin,
      cloudSpin: spin + t * 0.004,
      sunDir,
      opacity: earthOpacity,
      lights: 1,
      atmosphere: 1,
      glare: smooth(T.sunrise[0], T.sunrise[0] + 1.2, t) * (1 - smooth(T.lift[0] + 0.1, T.lift[0] + 0.9, t)),
      dot: smooth(7, 2, disc.r),
      discR: disc.r,
    },
    sky: {
      reveal: seg(t, T.skyReveal),
      revealOrigin: [0.5, 0.5], // where the loading star breathed: the sky grows out of it
      brightness,
      milkyWay: easeInOut(seg(t, T.milkyWay)),
      twinkle: 1,
      warp: reduced ? 0 : 0.55 * Math.sin(Math.PI * seg(t, [T.recede[0], T.recede[0] + 2.6])),
      meteors: (t > 3 && t < T.dim[0] - 0.4) || t > T.skyBack[1] ? 1 : 0,
      hero: { x: L.hero.x, y: L.hero.y, intensity: heroIntensity, size: 1 },
      rotation: skyTurn,
    },
    meteor: {
      progress: (t - T.meteor[0]) / (T.meteor[1] - T.meteor[0]),
      from: size.w > size.h ? [-0.04, 0.03] : [-0.08, 0.06],
      to: [L.hero.x, L.hero.y],
      burst: pulse(t, T.flash, 0.08, 0.45),
      intensity: 1,
    },
    grade: {
      // the flash comes from the star: strongest there, a soft wash elsewhere,
      // and gone in about a second. (A full-screen .8 flash turned the phone into
      // a grey card and hid the burst.)
      flash: (reduced ? 0.12 : 0.5) * pulse(t, T.flash, 0.06, 0.28),
      flashAt: [L.hero.x, L.hero.y],
      fade: 1 - smooth(0, 0.5, t),
      vignette: mood === 'letter' ? 0.5 : 0.35,
    },
  };
}
