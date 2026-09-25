// THE shooting star: one meteor from the top left to where the brightest star is
// about to be born, and the burst that hands off to it.
//
// Drawn in the overlay (CSS px, y down), additively, in HDR: the head sits far
// above 1 so the bloom pass turns it into light, while the train stays just
// under the bloom threshold and cools from white through pale gold to a faint
// blue-violet as it fades. Four draws: the tail (one ribbon quad), the head (one
// sprite), the sparks (instanced streaks) and the burst (one sprite).
//
// Everything is a function of p.progress and t, never of accumulated dt, so a
// frozen frame at ?t=25.7 is exactly the frame the show plays.

import * as THREE from 'three';
import { T } from './script.js';

// seconds per unit of progress, so the burst's ring and embers keep real-time
// speeds even if the flight is retimed
const DUR = T.meteor[1] - T.meteor[0];
const ACC = 0.26; // share of the path given to acceleration: a touch, not a swoop
const DRAIN = 0.35; // progress 1..1.35: the tail flows into the end point
const RING = 0.12; // the burst's forward crescent: a breath, not a shockwave
const G_EMBER = 1.6; // embers are heavier than the trail's glitter: they arc down

const N_TRAIL = 20; // sparks shed along the flight
const N_EMBER = 8; // embers thrown out by the burst
const N_SPARK = N_TRAIL + N_EMBER;

// The hero star's diffraction spikes (sky.js HERO_FRAG): a cross at 0.16 rad and
// a fainter pair at 1.02 rad, in overlay space (y down). The burst's rays lie
// exactly on them, so the burst and the star it hands off to read as one star.
// If either moves, move both (ideally from one export in script.js).
const HERO_SPIKE_A = 0.16;
const HERO_SPIKE_B = 1.02;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
// fraction of the path covered at progress p, and its slope
const sOf = (p) => {
  const k = clamp01(p);
  return k * (1 - ACC + ACC * k);
};
const dsOf = (p) => 1 - ACC + 2 * ACC * clamp01(p);

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// smooth 1D value noise, for the flicker
function vnoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, 71) * (1 - u) + hash(i + 1, 71) * u;
}

const GLSL_COMMON = /* glsl */ `
  float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h1(i), h1(i + 1.0), f);
  }
`;

// ---------------------------------------------------------------- the tail
// A ribbon along the path behind the head. vQ.x is px behind the head, vQ.y px
// across. The brightness gradient is fixed in px behind the head (uLmax long);
// it is clipped where the meteor ignited and, while draining, slides into the
// end point.
const TAIL_VS = /* glsl */ `
  uniform vec2 uHead;
  uniform vec2 uDir;
  uniform float uBack;
  uniform float uHalfW;
  varying vec2 vQ;
  void main() {
    float d = mix(-6.0, uBack, position.x + 0.5);
    float e = position.y * 2.0 * uHalfW;
    vec2 n = vec2(-uDir.y, uDir.x);
    vec2 P = uHead - uDir * d + n * e;
    vQ = vec2(d, e);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 0.0, 1.0);
  }
`;
const TAIL_FS = /* glsl */ `
  uniform float uLmax;
  uniform float uTrav;
  uniform float uShift;
  uniform float uBright;
  uniform float uDpr;
  uniform float uScale;
  varying vec2 vQ;
  ${GLSL_COMMON}
  vec3 tailColor(float u) {
    vec3 hot = vec3(1.0, 0.94, 0.86);
    vec3 gold = vec3(1.0, 0.66, 0.30);
    vec3 violet = vec3(0.42, 0.38, 1.0);
    vec3 c = mix(hot, gold, smoothstep(0.03, 0.34, u));
    return mix(c, violet, smoothstep(0.36, 0.86, u));
  }
  void main() {
    float d = vQ.x;
    float e = abs(vQ.y);
    float dd = d + uShift;              // px behind the head, in the gradient's frame
    float u = clamp(dd / uLmax, 0.0, 1.0);
    // a long taper: white-hot for a few px, then a slow cooling fall-off
    float I = pow(1.0 - u, 1.35) * (0.3 + 0.7 * exp(-u * 3.6));
    // born at the ignition point (softly), swallowed at the end point
    float fadeLen = clamp(uTrav * 0.5, 1.0, 70.0);
    float m = clamp((uTrav - dd) / fadeLen, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    m *= smoothstep(-2.5, 1.5, d);
    // the train is uneven, as real ones are; the knots stay put on the sky
    float knots = 0.84 + 0.32 * vnoise((uTrav - dd) / 26.0);
    // across: a hairline core that tapers, a soft glow, a faint violet halo
    float px = 1.0 / uDpr;
    float sc = mix(0.95, 0.32, sqrt(u)) * sqrt(uScale);
    float scE = max(sc, 0.75 * px);
    float core = exp(-0.5 * e * e / (scE * scE)) * (sc / scE);
    float sg = mix(4.2, 2.2, u) * uScale;
    float glow = exp(-0.5 * e * e / (sg * sg));
    float sh = mix(13.0, 8.0, u) * uScale;
    float halo = exp(-0.5 * e * e / (sh * sh));
    vec3 col = mix(tailColor(u), vec3(1.0, 0.97, 0.93), 0.4 * (1.0 - u)) * core * 0.95
             + tailColor(min(1.0, u * 1.12 + 0.04)) * glow * 0.5
             + vec3(0.4, 0.36, 1.0) * halo * 0.05 * (0.4 + u);
    col *= I * m * knots * uBright;
    // The train stays under the bloom threshold (.8, a hard step): where a
    // long gradient crosses it mid-tail the bloom's source simply ends, and the
    // finest bloom level draws that end as a dark notch across the tail. A soft
    // knee keeps it below on every screen; only the first few px behind the
    // head run white-hot, and they cross the threshold inside the head's glow.
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    float Lk = L < 0.56 ? L : 0.56 + 0.18 * (1.0 - exp(-(L - 0.56) / 0.18));
    col *= Lk / max(L, 1e-4);
    float hot = exp(-max(dd, 0.0) / (7.0 * uScale));
    col += vec3(1.0, 0.97, 0.93) * core * 2.4 * hot * m * uBright;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- the head
// White-hot, a little sharper at the leading edge, with a cool blue-white halo.
const HEAD_VS = /* glsl */ `
  uniform vec2 uHead;
  uniform vec2 uDir;
  uniform float uHalf;
  varying vec2 vQ;
  void main() {
    vec2 l = position.xy * 2.0 * uHalf;
    vec2 n = vec2(-uDir.y, uDir.x);
    vec2 P = uHead + uDir * l.x + n * l.y;
    vQ = l;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 0.0, 1.0);
  }
`;
const HEAD_FS = /* glsl */ `
  uniform float uBright;
  uniform float uHalf;
  uniform float uDpr;
  uniform float uScale;
  varying vec2 vQ;
  void main() {
    float a = vQ.x / uScale;
    float r = length(vec2(a * (a > 0.0 ? 1.5 : 0.7), vQ.y / uScale));
    float sc = max(1.05, 0.8 / uDpr);
    float core = exp(-0.5 * r * r / (sc * sc));
    float inner = exp(-r / 2.2);
    float outer = exp(-r / 9.0);
    vec3 col = vec3(1.0, 0.98, 0.96) * core * 6.5
             + vec3(1.0, 0.95, 0.88) * inner * 0.8
             + vec3(0.7, 0.8, 1.0) * outer * 0.1;
    col *= uBright * smoothstep(uHalf, uHalf * 0.6, length(vQ));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- sparks
// Short streaks along each spark's velocity (a shutter's worth of motion blur).
const SPARK_VS = /* glsl */ `
  attribute vec4 iA; // x, y, streak vector x, y (px)
  attribute vec4 iB; // r, g, b (HDR), width (px)
  varying vec2 vQ;
  varying vec3 vCol;
  varying float vLen;
  varying float vW;
  void main() {
    vec2 s = iA.zw;
    float L = length(s);
    vec2 dir = L > 1e-4 ? s / L : vec2(1.0, 0.0);
    float pad = 3.0 * iB.w + 1.0;
    float along = mix(-pad, L + pad, position.x + 0.5);
    float across = position.y * 2.0 * pad;
    vec2 n = vec2(-dir.y, dir.x);
    vec2 P = iA.xy - dir * along + n * across;
    vQ = vec2(along, across);
    vCol = iB.rgb;
    vLen = L;
    vW = iB.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 0.0, 1.0);
  }
`;
const SPARK_FS = /* glsl */ `
  uniform float uDpr;
  varying vec2 vQ;
  varying vec3 vCol;
  varying float vLen;
  varying float vW;
  void main() {
    float a = clamp(vQ.x, 0.0, vLen);
    vec2 q = vec2(vQ.x - a, vQ.y);
    float wE = max(vW, 0.75 / uDpr);
    float k = exp(-0.5 * dot(q, q) / (wE * wE)) * (vW / wE);
    float fade = 1.0 - 0.75 * a / max(vLen, 1e-3);
    gl_FragColor = vec4(vCol * k * fade, 1.0);
  }
`;

// ---------------------------------------------------------------- the burst
// A star being born: a hot core that swells, long thin rays that reach out along
// the hero star's own spikes and draw back into them, and a soft crescent of
// light carried on ahead by the meteor's momentum. The core and its glow fade
// with p.burst; the sky's hero star, drawn at the same point, is what remains.
const BURST_VS = /* glsl */ `
  uniform vec2 uAt;
  uniform float uHalf;
  varying vec2 vQ;
  void main() {
    vec2 l = position.xy * 2.0 * uHalf;
    vQ = l;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(uAt + l, 0.0, 1.0);
  }
`;
const BURST_FS = /* glsl */ `
  uniform float uBurst;   // 0..1 envelope
  uniform float uAge;     // seconds since the burst's peak (negative before)
  uniform float uR;       // reference radius, px
  uniform float uHalf;
  uniform float uDpr;
  uniform float uBright;
  uniform float uRing;    // the crescent's share (0 under reduced motion)
  uniform vec2 uDir;      // the meteor's direction of travel
  varying vec2 vQ;
  const float SPIKE_A = ${HERO_SPIKE_A.toFixed(4)}; // = sky.js HERO_FRAG's cross
  const float SPIKE_B = ${HERO_SPIKE_B.toFixed(4)}; // = its fainter pair
  // one diffraction line through the centre (both rays), tapering to its tips
  float spike(vec2 q, float a, float len, float w) {
    vec2 D = vec2(cos(a), sin(a));
    float al = abs(dot(q, D));
    float ac = dot(q, vec2(-D.y, D.x));
    return exp(-0.5 * ac * ac / (w * w)) * pow(max(0.0, 1.0 - al / len), 2.6);
  }
  void main() {
    vec2 q = vQ;
    float r = length(q);
    float px = 1.0 / uDpr;
    float b = uBurst;

    // the core swells, and its glow with it (the bloom does most of the work)
    float core = exp(-0.5 * r * r / 4.0) * 9.0 * b;
    float halo = exp(-r / (3.5 + 4.0 * b)) * 1.1 * b;
    float wide = exp(-r / (0.1 * uR)) * 0.16 * b;

    // the star's own spikes, reaching out fast and drawing back into it
    float sw = max(0.55, 0.8 * px);
    float spLen = uR * (0.12 + 0.62 * b);
    float spikes = spike(q, SPIKE_A, spLen, sw) + spike(q, SPIKE_A + 1.5707963, spLen, sw)
                 + 0.3 * spike(q, SPIKE_B, 0.52 * spLen, sw);
    spikes *= 2.4 * b * b;

    // the ring, as a crescent: light carried on ahead of where the meteor
    // stopped, swelling outward and gone in half a second. Weighted hard toward
    // the direction of travel, so it never closes into a halo.
    float age = max(uAge, 0.0);
    float k = clamp(age / 0.5, 0.0, 1.0);
    float rr = uR * 0.56 * (1.0 - pow(1.0 - k, 2.4));
    // (a broad band, so it reads as light pushed outward, never as a drawn arc)
    float rw2 = 6.0 + 0.45 * rr;
    float ramp = smoothstep(0.1, 0.26, age) * pow(1.0 - k, 1.5) * uRing;
    float lop = 0.5 + 0.5 * dot(q / max(r, 1e-3), uDir);
    ramp *= lop * lop * lop * lop;
    float sd = r - rr;
    // a soft front and a long wake that fills back to the star: a lobe of light
    // leaning forward, with no dark gap that would draw it as a band
    float rg = sd > 0.0 ? exp(-0.5 * sd * sd / (rw2 * rw2 * 0.55)) : exp(sd / (1.3 * rw2));
    // cool white, with the faintest warmth on its outer edge
    vec3 ringCol = mix(vec3(0.84, 0.88, 1.0), vec3(1.0, 0.95, 0.88), smoothstep(-rw2, 0.5 * rw2, sd)) * rg * ramp;

    vec3 hot = vec3(1.0, 0.97, 0.93);
    vec3 col = hot * (core + halo) + vec3(0.95, 0.95, 1.0) * wide
             + vec3(1.0, 0.97, 0.92) * spikes + ringCol;
    // a long, soft window: the sprite's edge must never draw a circle of its own
    col *= uBright * smoothstep(uHalf, uHalf * 0.6, r);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function additive(vs, fs, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: vs,
    fragmentShader: fs,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * createMeteor(stage) -> { object, update(t, dt, p) }
 * p = { progress, from:[fx,fy], to:[fx,fy], burst, intensity, reduced? }  (see SPEC.md)
 * reduced (optional): no crescent and no embers; the flight and the light stay.
 */
export function createMeteor(stage) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const group = new THREE.Group();
  group.renderOrder = 20;

  const dpr = { value: 1 };
  const scl = { value: 1 }; // widths grow a little on big screens
  const U = {
    head: new THREE.Vector2(),
    dir: new THREE.Vector2(1, 0),
    at: new THREE.Vector2(),
  };

  const tailMat = additive(TAIL_VS, TAIL_FS, {
    uHead: { value: U.head },
    uDir: { value: U.dir },
    uBack: { value: 100 },
    uHalfW: { value: 24 },
    uLmax: { value: 100 },
    uTrav: { value: 0 },
    uShift: { value: 0 },
    uBright: { value: 1 },
    uDpr: dpr,
    uScale: scl,
  });
  const headMat = additive(HEAD_VS, HEAD_FS, {
    uHead: { value: U.head },
    uDir: { value: U.dir },
    uHalf: { value: 64 },
    uBright: { value: 1 },
    uDpr: dpr,
    uScale: scl,
  });
  const burstMat = additive(BURST_VS, BURST_FS, {
    uAt: { value: U.at },
    uDir: { value: U.dir },
    uHalf: { value: 200 },
    uBurst: { value: 0 },
    uAge: { value: -1 },
    uR: { value: 200 },
    uBright: { value: 1 },
    uRing: { value: RING },
    uDpr: dpr,
  });
  const sparkMat = additive(SPARK_VS, SPARK_FS, { uDpr: dpr });

  const tail = new THREE.Mesh(quad, tailMat);
  const head = new THREE.Mesh(quad, headMat);
  const burst = new THREE.Mesh(quad, burstMat);

  const sparkGeo = new THREE.InstancedBufferGeometry();
  sparkGeo.index = quad.index;
  sparkGeo.setAttribute('position', quad.getAttribute('position'));
  const sA = new Float32Array(N_SPARK * 4);
  const sB = new Float32Array(N_SPARK * 4);
  const attrA = new THREE.InstancedBufferAttribute(sA, 4).setUsage(THREE.DynamicDrawUsage);
  const attrB = new THREE.InstancedBufferAttribute(sB, 4).setUsage(THREE.DynamicDrawUsage);
  sparkGeo.setAttribute('iA', attrA);
  sparkGeo.setAttribute('iB', attrB);
  sparkGeo.instanceCount = 0;
  const sparks = new THREE.Mesh(sparkGeo, sparkMat);

  for (const m of [tail, sparks, head, burst]) {
    m.frustumCulled = false;
    group.add(m);
  }
  tail.renderOrder = 20;
  sparks.renderOrder = 21;
  head.renderOrder = 22;
  burst.renderOrder = 23;
  group.visible = false;
  stage.overlay.scene.add(group);

  // every spark's character, fixed once (seeded)
  const K = {
    born: new Float32Array(N_SPARK), // progress at birth
    life: new Float32Array(N_SPARK), // seconds
    fwd: new Float32Array(N_SPARK), // trail: share of the head's speed it keeps; ember: direction (rad)
    side: new Float32Array(N_SPARK), // trail: sideways kick; ember: speed (px/s at scale 1)
    size: new Float32Array(N_SPARK),
    heat: new Float32Array(N_SPARK),
    tau: new Float32Array(N_SPARK), // seconds for the air to take its speed
  };
  for (let i = 0; i < N_SPARK; i++) {
    const h = (k) => hash(i, 1000 + k);
    if (i < N_TRAIL) {
      // spread evenly through the flight (lightly jittered, so no two are born
      // together), a little denser late on as the head heats up. They lag
      // behind it as bright beads strung along the train, the way a fireball
      // fragments, alternating sides by a hair so neighbours never pair up
      K.born[i] = 0.12 + 0.86 * Math.pow((i + 0.35 + 0.3 * h(1)) / N_TRAIL, 0.85);
      K.life[i] = 0.25 + 0.4 * h(2);
      K.fwd[i] = 0.25 + 0.45 * h(3);
      K.side[i] = (i % 2 ? 1 : -1) * (3 + 12 * h(4));
      K.size[i] = 0.36 + 0.26 * h(5) * h(5);
      K.tau[i] = 0.3;
    } else {
      // thrown out anywhere, at very uneven speeds, each slowed by the air at
      // its own rate: they scatter and arc down instead of stopping on a circle
      K.born[i] = 1;
      K.life[i] = 0.4 + 0.5 * h(2);
      K.fwd[i] = h(3) * Math.PI * 2; // direction
      K.side[i] = 60 + 260 * Math.pow(h(4), 1.5); // speed
      K.size[i] = 0.3 + 0.25 * h(5);
      K.tau[i] = 0.3 + 0.2 * h(7);
    }
    K.heat[i] = h(6);
  }

  const P = { fx: 0, fy: 0, tx: 0, ty: 0, dx: 1, dy: 0, len: 1 };

  function update(t, dt, p) {
    const prog = p.progress;
    const age = (prog - 1) * DUR; // seconds since the burst
    const on = prog > -0.05 && age < 1.6;
    group.visible = on;
    if (!on) return;

    const { w, h } = stage.size;
    dpr.value = stage.size.dpr;
    const I = p.intensity ?? 1;
    const reduced = !!p.reduced;
    const minDim = Math.min(w, h);
    const scale = Math.min(1.6, Math.max(0.9, minDim / 400));
    scl.value = Math.min(1.5, Math.max(1, Math.sqrt(minDim / 420)));

    P.fx = p.from[0] * w;
    P.fy = p.from[1] * h;
    P.tx = p.to[0] * w;
    P.ty = p.to[1] * h;
    const ddx = P.tx - P.fx;
    const ddy = P.ty - P.fy;
    P.len = Math.max(1, Math.hypot(ddx, ddy));
    P.dx = ddx / P.len;
    P.dy = ddy / P.len;
    U.dir.set(P.dx, P.dy);

    // ---- head
    const s = sOf(prog);
    const hx = P.fx + ddx * s;
    const hy = P.fy + ddy * s;
    U.head.set(hx, hy);
    const flicker = 0.86 + 0.28 * vnoise(t * 23.0) * (0.7 + 0.3 * vnoise(t * 61.0 + 9.0));
    const ignite = smooth(-0.02, 0.14, prog);
    // it brightens as it falls into thicker air, and flares as it ends
    const heat = 0.52 + 0.48 * s + 0.7 * smooth(0.8, 1.0, prog);
    const headOn = 1 - smooth(1.0, 1.05, prog);
    headMat.uniforms.uBright.value = I * ignite * heat * flicker * headOn;
    headMat.uniforms.uHalf.value = 64 * scl.value;
    head.visible = headOn > 0;

    // ---- tail
    const Lmax = Math.hypot(w, h) / 3;
    const drain = clamp01((prog - 1) / DRAIN);
    const trav = s * P.len;
    tailMat.uniforms.uLmax.value = Lmax;
    tailMat.uniforms.uTrav.value = trav;
    tailMat.uniforms.uShift.value = Lmax * Math.pow(drain, 1.25);
    tailMat.uniforms.uBack.value = Math.min(Lmax, trav) + 4;
    tailMat.uniforms.uHalfW.value = 26 * scl.value;
    tailMat.uniforms.uBright.value =
      I * ignite * (0.62 + 0.38 * Math.min(heat, 1.2)) * (0.9 + 0.1 * flicker) * Math.pow(1 - drain, 0.7);
    tail.visible = drain < 1 && trav > 0.5;

    // ---- burst
    const bIn = p.burst || 0;
    burst.visible = bIn > 0.002 || (age > 0 && age < 1.0);
    // the burst's attack starts a few frames before the head arrives: it rides
    // on the head until then, so there is never a second star ahead of it
    U.at.set(prog < 1 ? hx : P.tx, prog < 1 ? hy : P.ty);
    const R = Math.min(minDim * 0.5, 170 + minDim * 0.15); // a burst, not a sun, on a laptop
    burstMat.uniforms.uR.value = R;
    burstMat.uniforms.uHalf.value = R * 0.95; // room for the crescent's soft front
    burstMat.uniforms.uBurst.value = bIn;
    burstMat.uniforms.uAge.value = age;
    burstMat.uniforms.uBright.value = I;
    // reduced motion keeps the light and drops what flies outward
    burstMat.uniforms.uRing.value = reduced ? 0 : RING;

    // ---- sparks
    let n = 0;
    const nx = -P.dy;
    const ny = P.dx;
    const g = 70 * scale; // px/s^2, a gentle fall
    const nSpark = reduced ? N_TRAIL : N_SPARK;
    for (let i = 0; i < nSpark; i++) {
      const born = K.born[i];
      const a = (prog - born) * DUR;
      const life = K.life[i];
      if (a <= 0 || a >= life) continue;
      const k = a / life;
      const tau = K.tau[i];
      let x0, y0, vx, vy, gi;
      if (i < N_TRAIL) {
        const sb = sOf(born);
        x0 = P.fx + ddx * sb;
        y0 = P.fy + ddy * sb;
        const v = (P.len * dsOf(born)) / DUR; // the head's speed when it shed this spark
        vx = P.dx * v * K.fwd[i] + nx * K.side[i] * scale;
        vy = P.dy * v * K.fwd[i] + ny * K.side[i] * scale;
        gi = g * 0.3; // they barely fall in their half second: they stay on the train
      } else {
        x0 = P.tx;
        y0 = P.ty;
        const ang = K.fwd[i];
        const sp = K.side[i] * scale;
        vx = Math.cos(ang) * sp;
        vy = Math.sin(ang) * sp - 20 * scale;
        gi = g * G_EMBER;
      }
      const e = Math.exp(-a / tau);
      const x = x0 + vx * tau * (1 - e);
      const y = y0 + vy * tau * (1 - e) + 0.5 * gi * a * a;
      const cvx = vx * e;
      const cvy = vy * e + gi * a;
      // a short shutter: glints with a hint of motion, not dashes
      const shutter = i < N_TRAIL ? 0.014 : 0.03;
      // cools from white-gold toward amber as it dies, and twinkles (smooth noise
      // of t, so it never beats against the display's refresh rate)
      const tw = 0.7 + 0.3 * vnoise(t * 17.0 + i * 3.7);
      const fade = Math.pow(1 - k, 1.4) * Math.min(1, a / 0.05) * tw * I;
      const hot = 1 - k * (0.35 + 0.35 * K.heat[i]);
      const bright = (i < N_TRAIL ? 2.3 : 1.5) * fade;
      const o = n * 4;
      sA[o] = x;
      sA[o + 1] = y;
      sA[o + 2] = cvx * shutter;
      sA[o + 3] = cvy * shutter;
      sB[o] = bright * 1.0;
      sB[o + 1] = bright * (0.42 + 0.5 * hot);
      sB[o + 2] = bright * (0.12 + 0.72 * hot * hot);
      sB[o + 3] = K.size[i];
      n++;
    }
    sparkGeo.instanceCount = n;
    sparks.visible = n > 0;
    if (n > 0) {
      attrA.needsUpdate = true;
      attrB.needsUpdate = true;
    }
  }

  return { object: group, update };
}
