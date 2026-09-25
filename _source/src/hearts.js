// Floating hearts, and the little bursts of them at the 100% moment.
//
// Each heart is an SDF (crisp at any DPR) with a soft glow, screen-blended in
// the overlay (CSS px, y down) as one instanced quad. Depth is faked the way a
// lens would: small hearts are dimmer, softer-edged and slower, so the field
// reads as deep rather than flat. Hearts arrive and leave by going out of focus
// (they soften into light), never by darkening into a flat shape. Every heart's
// whole life is a pure function of t and its seed; nothing is simulated, so any
// ?t= lands on the same frame and nothing is allocated per frame.

import * as THREE from 'three';

const MAX = 150;
const STREAM_LIFE_MAX = 10; // longest a streamed heart can live (s)
const BURST_DELAY = 0.3; // a burst's hearts leave over this long: a gush, not one shell
const BURST_LIFE_MAX = 6.0 + BURST_DELAY;
const SIZE_MAX = 34; // CSS px, the contract's largest heart
const NONE = Object.freeze([]); // a missing list, without a new array every frame

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, k) => a + (b - a) * k;

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// the palette, linear: mostly rose and pink, a few warm white, a few gold
const srgb = (hex) => new THREE.Color(hex); // three converts sRGB hex to linear
// [weight, colour, target luminance]. The pale ones sit brighter, or they read
// as grey rather than light, and they are only ever given to near hearts (see
// pick): a small, dim warm white is ash and a small, dim gold is olive.
const PALETTE = [
  [0.38, srgb(0xff9db5), 0.5], // rose
  [0.22, srgb(0xff7f9f), 0.43], // deeper rose
  [0.24, srgb(0xffbccb), 0.56], // blush
  [0.08, srgb(0xffe4e1), 0.8], // warm white (a breath of rose, so it glows rather than greys)
  [0.08, srgb(0xffd49a), 0.66], // gold, pale: champagne rather than brass
];
const BLUSH = 2; // what the pale ones cool toward as they dissolve
const PAL_R = new Float32Array(PALETTE.length);
const PAL_G = new Float32Array(PALETTE.length);
const PAL_B = new Float32Array(PALETTE.length);
const PAL_W = new Float32Array(PALETTE.length); // cumulative weight
const PAL_GAIN = new Float32Array(PALETTE.length); // equalises perceived brightness
{
  let acc = 0;
  PALETTE.forEach(([w, c, target], i) => {
    acc += w;
    PAL_W[i] = acc;
    PAL_R[i] = c.r;
    PAL_G[i] = c.g;
    PAL_B[i] = c.b;
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    PAL_GAIN[i] = target / lum;
  });
}
// near hearts draw from the whole palette, middle ones from the roses, far ones
// from rose and blush only: depth reads as distance, never as a darker colour
// (a far deep rose is a maroon smudge)
function pick(h, z) {
  if (z < 0.3) return h < 0.6 ? 0 : BLUSH;
  const u = z > 0.45 ? h * PAL_W[PALETTE.length - 1] : h * PAL_W[BLUSH];
  for (let i = 0; i < PALETTE.length; i++) if (u < PAL_W[i]) return i;
  return 0;
}

const VS = /* glsl */ `
  attribute vec4 iA; // x, y (px), size (px, the heart's height), tilt (rad)
  attribute vec4 iB; // r, g, b, alpha
  attribute vec2 iC; // edge softness (px), glow
  varying vec2 vP;   // heart space: point at (0,0), lobes near y = 1.1, y up
  varying vec4 vCol;
  varying float vUnit;
  varying vec2 vSG;
  varying vec2 vQuad; // -1..1 across the quad, to fade the glow out before its edge
  const float EXT = 1.9; // the quad covers the glow and the softest edge as well as the heart
  void main() {
    float S = iA.z;
    vQuad = position.xy * 2.0;
    vec2 l = position.xy * EXT * S;
    float c = cos(iA.w), s = sin(iA.w);
    vec2 r = vec2(c * l.x - s * l.y, s * l.x + c * l.y);
    float unit = S / 1.104;
    vP = vec2(l.x, -l.y) / unit + vec2(0.0, 0.53);
    vUnit = unit;
    vCol = iB;
    vSG = iC;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iA.xy + r, 0.0, 1.0);
  }
`;

const FS = /* glsl */ `
  uniform float uDpr;
  varying vec2 vP;
  varying vec4 vCol;
  varying float vUnit;
  varying vec2 vSG;
  varying vec2 vQuad;
  float dot2(vec2 v) { return dot(v, v); }
  // Inigo Quilez's exact heart SDF (point at the origin, lobes up)
  float sdHeart(vec2 p) {
    p.x = abs(p.x);
    if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - 0.35355339;
    return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
  }
  void main() {
    // a touch narrower than the textbook heart: less clip-art, more drawn
    vec2 p = vec2(vP.x * 1.06, vP.y);
    float d = sdHeart(p) * vUnit;          // px, negative inside
    float S = vUnit * 1.104;
    float edge = max(vSG.x, 0.6 / uDpr);
    float fill = 1.0 - smoothstep(-edge, edge, d);
    // like a heart-shaped bokeh: a translucent body, brighter toward the rim,
    // a little brighter in the lobes than at the point. As a heart goes out of
    // focus its rim melts into the body, as a real lens's would.
    float focus = clamp(1.0 - edge / (0.16 * S), 0.0, 1.0);
    float rim = smoothstep(-0.26 * S, -0.01 * S, d);
    float up = clamp(vP.y / 1.1, 0.0, 1.0);
    float body = 0.62 + (0.26 * rim * rim + 0.12 * up) * focus;
    float dg = max(d, 0.0) / (0.1 * S + 1.2);
    vec2 win = 1.0 - smoothstep(0.62, 0.98, abs(vQuad));
    float glow = (0.55 * exp(-dg * dg) + 0.45 * exp(-dg * 1.8)) * vSG.y * win.x * win.y;
    float k = fill * body + (1.0 - fill) * glow;
    // the rim runs a touch warmer and paler, the body keeps the colour
    vec3 col = mix(vCol.rgb, vec3(1.0, 0.92, 0.9) * max(vCol.r, vCol.g), 0.18 * fill * rim * focus);
    // fading hearts dissolve into pale light rather than darkening: a dim
    // saturated rose on black reads as a maroon sticker, not as light
    col = mix(vec3(1.0, 0.9, 0.92) * dot(col, vec3(0.299, 0.587, 0.114)) * 1.3, col, vCol.a);
    // A heart is never a light source: a soft knee holds it under the bloom
    // threshold (.8, a hard step), or a pale heart turns into a lamp. The min()
    // keeps screen blending sane: at 1 the destination's factor (1 - src) would
    // go negative over the bright stars.
    vec3 c = col * k * vCol.a;
    float L = dot(c, vec3(0.299, 0.587, 0.114));
    float Lk = L < 0.5 ? L : 0.5 + 0.2 * (1.0 - exp(-(L - 0.5) / 0.2));
    gl_FragColor = vec4(min(c * (Lk / max(L, 1e-4)), vec3(0.98)), 1.0);
  }
`;

/**
 * createHearts(stage) -> { object, update(t, dt, p) }
 * p = { streams: [{ start, end, every, opacity, band:[fx0, fx1] }],
 *       bursts:  [{ at, count, x, y, spread }],
 *       reduced? }   (see SPEC.md)
 * reduced (optional): bursts fade in where they land instead of flying out, and
 * sway and tilt drop to a third.
 */
export function createHearts(stage) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const A = new Float32Array(MAX * 4);
  const B = new Float32Array(MAX * 4);
  const C = new Float32Array(MAX * 2);
  const attrA = new THREE.InstancedBufferAttribute(A, 4).setUsage(THREE.DynamicDrawUsage);
  const attrB = new THREE.InstancedBufferAttribute(B, 4).setUsage(THREE.DynamicDrawUsage);
  const attrC = new THREE.InstancedBufferAttribute(C, 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', attrA);
  geo.setAttribute('iB', attrB);
  geo.setAttribute('iC', attrC);
  geo.instanceCount = 0;

  const uDpr = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: { uDpr },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // screen blend: order-independent like additive, but where hearts overlap
    // they saturate instead of summing past the bloom threshold into a glare
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  stage.overlay.scene.add(mesh);

  let n = 0;
  // the clear zones of the bursts alive this frame (a few at most), which the
  // streams part round too
  const ZX = new Float32Array(4);
  const ZY = new Float32Array(4);
  const ZW = new Float32Array(4);
  const ZT = new Float32Array(4);
  let nZone = 0;
  // `alpha` dims; `blur` (0..1) is how far the heart has dissolved, and turns
  // into defocus: a softer edge and a slightly larger circle of confusion
  function put(x, y, size, tilt, pal, gain, alpha, blur, soft, glow) {
    if (alpha <= 0.002 || n >= MAX) return;
    const s = Math.min(SIZE_MAX, size * (1 + 0.1 * blur));
    const o = n * 4;
    A[o] = x;
    A[o + 1] = y;
    A[o + 2] = s;
    A[o + 3] = tilt;
    // the pale ones cool to blush as they dissolve: dim gold is brown and dim
    // warm white is grey, but dim blush is still a rose
    const c = pal > BLUSH ? blur * 0.85 : 0;
    const g0 = gain * PAL_GAIN[pal] * (1 - c);
    const g1 = gain * PAL_GAIN[BLUSH] * c;
    B[o] = PAL_R[pal] * g0 + PAL_R[BLUSH] * g1;
    B[o + 1] = PAL_G[pal] * g0 + PAL_G[BLUSH] * g1;
    B[o + 2] = PAL_B[pal] * g0 + PAL_B[BLUSH] * g1;
    B[o + 3] = alpha;
    C[n * 2] = soft + blur * 0.22 * s;
    C[n * 2 + 1] = glow;
    n++;
  }

  // Hearts rising past a burst's score part round it, like water round a
  // stone: in a band about the score's height, x is pushed out of the clear
  // zone (half extents cw, ch) by a smooth, monotonic amount that fades to
  // nothing above and below the band. sgn is the side the heart keeps to; wt
  // eases the push in and out.
  function part(x, y, cx, cy, cw, ch, sgn, wt) {
    const ey = (y - cy) / (ch * 1.3);
    const band = Math.max(0, 1 - ey * ey);
    const m = cw * 1.1 * band * band * wt;
    if (m < 0.5) return x;
    const u = sgn * (x - cx);
    return cx + sgn * (u + m * Math.exp(-Math.max(u, 0) / m));
  }
  // the clear zone round a burst's centre, about the size of a big numeral
  const zoneW = (md) => Math.min(0.25 * md, 150);

  // depth z in 0..1 (1 = nearest) sets size, brightness, softness and speed
  const sizeOf = (z) => 10 + 21 * z;
  const gainOf = (z) => lerp(0.5, 1.0, z);
  const softOf = (z) => lerp(1.7, 0.0, Math.sqrt(z));

  function streamHeart(t, w, h, S, si, i, calm) {
    const born = S.start + i * S.every;
    const a = t - born;
    if (a < 0) return;
    const s0 = si * 131; // this stream's seeds: hash(i, s0 + k)
    const z = Math.pow(hash(i, s0 + 1), 1.35);
    const life = lerp(9.3, 7.2, z) + (hash(i, s0 + 2) - 0.5) * 0.8;
    if (a >= life) return;
    const k = a / life;
    const size = sizeOf(z) * (0.92 + 0.16 * hash(i, s0 + 3));
    // x: golden-ratio spacing with a little jitter, so they never clump
    const band0 = S.band ? S.band[0] : 0.04;
    const band1 = S.band ? S.band[1] : 0.96;
    let fx = (0.5 + i * 0.6180339887 + (hash(i, s0 + 4) - 0.5) * 0.24) % 1;
    fx = band0 + (band1 - band0) * fx;
    // rise: from just below the bottom edge to near the top, easing in like
    // something buoyant letting go
    const y0 = h + size * 0.9;
    const y1 = h * 0.06;
    const y = lerp(y0, y1, k * (0.82 + 0.18 * k));
    // sway, with the tilt leaning into it
    const f = 0.09 + 0.08 * hash(i, s0 + 5);
    const ph = 6.2832 * hash(i, s0 + 6);
    const amp = (4 + 12 * z) * (0.7 + 0.6 * hash(i, s0 + 7)) * calm;
    const wv = 6.2832 * f * a + ph;
    let x = fx * w + amp * Math.sin(wv);
    // while a burst is celebrating, the stream parts round its score as well
    for (let b = 0; b < nZone; b++) x = part(x, y, ZX[b], ZY[b], ZW[b], ZW[b] * 0.6, fx * w >= ZX[b] ? 1 : -1, ZT[b]);
    const tilt =
      ((hash(i, s0 + 8) - 0.5) * 0.3 + 0.2 * Math.cos(wv) * (0.6 + 0.4 * z) + 0.06 * Math.sin(0.37 * a + ph)) * calm;
    // come into focus over the bottom sixth, hold, and dissolve between 30%
    // and 10% of the height
    const env = smooth(h + size * 0.6, h * 0.84, y) * smooth(h * 0.1, h * 0.3, y);
    const gain = gainOf(z) * (0.9 + 0.2 * hash(i, s0 + 10));
    const pal = pick(hash(i, s0 + 9), z);
    put(x, y, size, tilt, pal, gain, env * (S.opacity ?? 1), 1 - env, softOf(z), lerp(0.22, 0.4, z));
  }

  function burstHeart(t, w, h, Bu, seed, j, calm, reduced) {
    // this burst's seeds: hash(j, seed + 977 * k)
    const a = t - Bu.at - BURST_DELAY * hash(j, seed + 11723);
    if (a < 0) return;
    const life = 4.0 + 2.0 * hash(j, seed + 977);
    if (a >= life) return;
    // mostly small and far, a few near: a deep, delicate cloud, not a pile
    const z = Math.pow(hash(j, seed + 1954), 1.5);
    const size = sizeOf(z) * (0.9 + 0.2 * hash(j, seed + 2931));
    const md = Math.min(w, h);
    const spread = Bu.spread ?? 1;
    const cx = Bu.x * w;
    const cy = Bu.y * h;
    // Where they land: anywhere in an ellipse fitted to the screen, outside a
    // clear zone round the centre about the size of a big numeral. The burst
    // celebrates the score; it must never sit on it, and never frame it (40
    // hearts all at one radius is a wreath, and a wreath is a greeting card),
    // so every heart may land anywhere from the zone's edge to the rim.
    const sx = Math.min(0.48 * w, 0.66 * md, 440) * spread;
    const sy = Math.min(0.32 * h, 0.6 * md, 320) * spread;
    const cw = zoneW(md);
    const ch = cw * 0.6;
    // direction and distance from R2 low-discrepancy pairs (lightly jittered
    // per burst): the cloud fills evenly, with no rings, rows or clumps
    const u1 = (0.5 + j * 0.7548776662 + (hash(j, seed + 3908) - 0.5) * 0.1) % 1;
    const u2 = (0.5 + j * 0.569840291 + (hash(j, seed + 4885) - 0.5) * 0.1) % 1;
    const ang = u1 * 6.2831853;
    let dx = Math.cos(ang);
    let dy = Math.sin(ang) * 0.85 - 0.2; // leaning upward
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    // the nearest a heart may land in this direction is just outside the zone
    const edge = 1 / Math.hypot((dx * sx) / cw, (dy * sy) / ch);
    const r0 = Math.min(0.9, 1.12 * edge);
    const rr = r0 + (1 - r0) * Math.sqrt(u2); // area-uniform: a field, not a shell
    // they leave from halfway out, so the first frames are a bloom of separate
    // hearts round the score, not one blot on it
    const pop = reduced ? 1 : 0.5 + 0.5 * (1 - Math.exp(-a / 0.36));
    // then buoyancy takes over, gently, each at its own very different pace (so
    // the cloud draws out into a drift rather than rising as one shape), and it
    // keeps opening a little as it goes
    const vUp = (14 + 44 * z) * (0.5 + hash(j, seed + 9770)) * (h / 844);
    const tb = 0.9;
    const rise = vUp * (a - tb * (1 - Math.exp(-a / tb)));
    const open = (reduced ? 0 : 5 + 7 * z) * a;
    const f = 0.1 + 0.08 * hash(j, seed + 5862);
    const ph = 6.2832 * hash(j, seed + 6839);
    const swayIn = smooth(0.3, 1.8, a);
    const amp = (4 + 10 * z) * swayIn * calm;
    const wv = 6.2832 * f * a + ph;
    let x = cx + dx * (sx * rr * pop + open) + amp * Math.sin(wv);
    const y = cy + dy * (sy * rr * pop + open) - rise;
    x = part(x, y, cx, cy, cw, ch, dx >= 0 ? 1 : -1, 1);
    // scale in with the softest overshoot, so it blooms rather than pops
    const sk = clamp01(a / 0.6);
    const grow = reduced ? 1 : 1 + 1.7 * Math.pow(sk - 1, 3) + 0.7 * Math.pow(sk - 1, 2);
    const tilt0 = (hash(j, seed + 7816) - 0.5) * 1.1;
    const tilt = (tilt0 * Math.exp(-a / 0.9) + 0.18 * Math.cos(wv) * swayIn) * calm;
    // they come into focus as they appear and go out of it as they leave
    const env = smooth(0, reduced ? 0.8 : 0.35, a) * (1 - smooth(life * 0.6, life, a));
    const pal = pick(hash(j, seed + 8793), z);
    put(x, y, size * Math.max(0.05, grow), tilt, pal, gainOf(z), env, 1 - env, softOf(z), lerp(0.24, 0.42, z));
  }

  function update(t, dt, p) {
    const { w, h } = stage.size;
    uDpr.value = stage.size.dpr;
    const reduced = !!p.reduced;
    const calm = reduced ? 0.3 : 1;
    n = 0;
    nZone = 0;
    // bursts first, so a crowded moment never drops the celebration
    const bursts = p.bursts || NONE;
    for (let bi = 0; bi < bursts.length; bi++) {
      const Bu = bursts[bi];
      const a = t - Bu.at;
      if (a < 0 || a > BURST_LIFE_MAX) continue;
      const seed = (Math.round(Bu.at * 1000) * 7 + bi * 7919) | 0;
      for (let j = 0; j < Bu.count && n < MAX; j++) burstHeart(t, w, h, Bu, seed, j, calm, reduced);
      if (nZone < ZX.length) {
        ZX[nZone] = Bu.x * w;
        ZY[nZone] = Bu.y * h;
        ZW[nZone] = zoneW(Math.min(w, h));
        ZT[nZone] = smooth(0, 0.8, a) * (1 - smooth(BURST_LIFE_MAX - 1.5, BURST_LIFE_MAX, a));
        nZone++;
      }
    }
    const streams = p.streams || NONE;
    for (let si = 0; si < streams.length; si++) {
      const S = streams[si];
      if (t < S.start || !(S.every > 0)) continue;
      const last = Math.min(Math.floor((t - S.start) / S.every), Math.ceil((S.end - S.start) / S.every) - 1);
      const first = Math.max(0, Math.ceil((t - S.start - STREAM_LIFE_MAX) / S.every));
      // newest first: if the cap bites, it is the old, faded ones that go
      for (let i = last; i >= first && n < MAX; i--) streamHeart(t, w, h, S, si, i, calm);
    }
    geo.instanceCount = n;
    mesh.visible = n > 0;
    if (n > 0) {
      attrA.needsUpdate = true;
      attrB.needsUpdate = true;
      attrC.needsUpdate = true;
    }
  }

  return { object: mesh, update };
}
