// The sky: nine thousand stars, the Milky Way, the warp, the odd shooting star,
// and the brightest star of all.
//
// Everything in the world scene is at infinity. The root follows the camera, and
// its meshes go in the OPAQUE list with a negative renderOrder, additive blending
// and no depth, so they are drawn first and the Earth always covers them (a
// transparent sky would be drawn after an opaque planet, and over it).
//
// The galactic frame is placed for the show's camera path (the numbers came from
// rig.js, see GAL_N / GAL_C). At the start the camera looks ~37 deg up over where
// the planet will rise, and the band crosses a portrait phone corner to corner. At
// sunrise it climbs out of the horizon on the left, it runs behind the globe, and
// from the brightest star on the warm core sits low in the frame with the band
// sweeping up past the star. The camera orbits ~0.35 deg/s; from the meteor on the
// rig turns the sky with it (p.rotation), so the brightest star stays among the
// same stars for the rest of the show.
//
// The Milky Way is baked on the GPU (fbm, domain warp, dust extinction) into a
// texture in galactic coordinates, spread over the first frames while it is still
// invisible. Most of its width goes to the longitudes the show actually faces. Per
// pixel, the sphere adds only hash-per-cell layers of faint unresolved stars,
// thinned by that texture, which is what makes the band read as starlight rather
// than airbrush.
//
// The opening (p.reveal) is eyes adjusting to the dark. The loading star becomes a
// real star, its nearest neighbours join it, and then the sky comes up in order of
// brightness, each star's moment also rippling outward from where the dot was, with
// every star igniting in a brief twinkle before it settles. The ripple is anchored
// to the SKY, not the screen: the rig zooms 40 -> 34 deg meanwhile, which slides the
// stars up the screen at ~110 px/s, and a screen-pinned ripple would pull a star's
// moment away from it faster than time passes (it would light up, then go out).

import * as THREE from 'three';
import { T } from './script.js';

// galactic north pole and galactic centre, in world space
const GAL_N = new THREE.Vector3(0.8582, -0.4486, -0.2495);
const GAL_C = new THREE.Vector3(-0.4515, -0.4282, -0.7828);

const R_SKY = 100; // radius of the sky sphere (well inside the camera's far plane)
// The first STAR_BASE are the opening's sky. The rest are fainter: they come in only as
// the zoom narrows the fov (uDeep), like a longer lens reaching deeper, so the narrow
// late frames keep a rich field instead of a few dozen stars.
const STAR_BASE = 9000;
const STAR_COUNT = 16000;
const FOV_DEEP = [33.5, 28.5];
const BAKE_BMAX = 22.5; // the baked band covers galactic latitude -22.5..22.5 deg
const MW_VMAX = 2.5; // the bake stores sqrt(v / VMAX)
// The show only ever faces galactic longitude ~-20..92 deg (every viewport, with the
// sky co-rotating from the meteor on), so that stretch gets LON_K of the texture's
// width: about 21 texels per degree instead of 11. The seam sits at LON_A, out of view.
const LON_A = -32;
const LON_B = 108;
const LON_K = 0.72;
const BAKE_STRIPS = 32;
// The rig's opening fov (rig.js `settle`, 40 -> 34). The reveal's origin is the sky
// point that was under the loading star at t = 0, found by undoing the zoom since.
// At a steady 34 (reduced motion) there is no zoom to undo.
const FOV_OPEN = 40;
const FOV_REST = 34;
// the rig's orbit (rig.js `az`, 0.35 deg/s about world +Y): undone for the seed, so it
// stays among the same neighbours instead of sliding ~7 px/s against them
const ORBIT_RATE = (0.35 * Math.PI) / 180;
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const REVEAL_T0 = T.skyReveal[0];
const REVEAL_DUR = T.skyReveal[1] - T.skyReveal[0];
// how long every star takes to finish igniting, after the last one starts
const REVEAL_TAIL = 1.4;
const DEFAULT_ORIGIN = [0.5, 0.5];

// ---------------------------------------------------------------- random
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// integer hash -> [0, 1), for anything that must be a pure function of an index
function hash(n) {
  let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const smoothstep = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// blackbody colour (Tanner Helland's fit), linear RGB with unit luminance, and
// desaturated: real stars are pale, a little warm or a little blue
function starColour(kelvin, sat) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = [r, g, b].map((v) => Math.pow(Math.min(255, Math.max(0, v)) / 255, 2.2));
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lin.map((v) => 1 + (v / lum - 1) * sat);
}

// ---------------------------------------------------------------- shared GLSL
const HASH = /* glsl */ `
  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

// galactic longitude (radians) <-> texture u, piecewise linear: [LON_A, LON_B] fills
// 0..LON_K, the rest of the circle the remainder
const LONMAP = /* glsl */ `
  const float LON_A = ${((LON_A * Math.PI) / 180).toFixed(6)};
  const float LON_SPAN = ${(((LON_B - LON_A) * Math.PI) / 180).toFixed(6)};
  const float LON_K = ${LON_K.toFixed(4)};
  float lonToU(float l) {
    float x = l - LON_A;
    x = x < 0.0 ? x + 6.2831853 : x;
    return x < LON_SPAN ? x / LON_SPAN * LON_K : LON_K + (x - LON_SPAN) / (6.2831853 - LON_SPAN) * (1.0 - LON_K);
  }
  float uToLon(float u) {
    float x = u < LON_K ? u / LON_K * LON_SPAN : LON_SPAN + (u - LON_K) / (1.0 - LON_K) * (6.2831853 - LON_SPAN);
    float l = LON_A + x;
    return l > 3.14159265 ? l - 6.2831853 : l;
  }
  // a direction in the galactic frame -> the bake's uv
  vec2 galUv(vec3 d) {
    float l = atan(-d.z, d.x);
    float b = asin(clamp(d.y, -1.0, 1.0));
    return vec2(lonToU(l), clamp(b / radians(${(BAKE_BMAX * 2).toFixed(1)}) + 0.5, 0.0, 1.0));
  }
`;

// The opening's timing, shared by the stars and the unresolved-star grain.
const IGNITE = /* glsl */ `
  uniform vec2 uOrigin; // device px, y up: the sky point that was under the loading star
  uniform float uRmax; // device px from the loading star to the farthest corner
  uniform float uRevT; // seconds into the reveal (runs on past its end until every star has settled)
  // distance from the origin, 0..~1 across the screen, with a few slow lobes so the
  // front is never a ring
  float rippleDist(vec2 px) {
    vec2 rel = px - uOrigin;
    float r = length(rel);
    float a = r > 0.5 ? atan(rel.y, rel.x) : 0.0;
    return r / uRmax * (1.0 + 0.12 * sin(3.0 * a + 1.1) + 0.08 * sin(5.0 * a + 4.2));
  }
  // a brief swell, peaking 0.09 s in and gone by ~0.45 s
  float swell(float tau) {
    return tau <= 0.0 ? 0.0 : (tau / 0.09) * exp(1.0 - tau / 0.09);
  }
  // a star igniting: a quick rise into a twinkling overshoot, then steady at 1
  float ignite(float tau, float A, float ph) {
    if (tau <= 0.0) return 0.0;
    return smoothstep(0.0, 0.16, tau) + A * swell(tau) * (1.0 + 0.3 * sin(tau * 52.0 + ph));
  }
`;

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT)
const SIMPLEX = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      s += a * snoise(p);
      p = p * 2.02 + vec3(17.1, 5.3, 11.7);
      a *= 0.5;
    }
    return s;
  }
`;

// ---------------------------------------------------------------- the Milky Way bake
// Galactic longitude l across (through LONMAP), latitude b up, +-BAKE_BMAX deg.
// rgb = sqrt(light / VMAX) (dark values keep their precision in 8 bits), a = dust
// transmission, which also thins the faint stars in the dark lanes.
const BAKE_FRAG = /* glsl */ `
  uniform vec2 uSize;
  ${HASH}
  ${SIMPLEX}
  ${LONMAP}
  float gauss(float x, float s) { return exp(-0.5 * x * x / (s * s)); }

  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    float l = uToLon(uv.x);
    float b = (uv.y - 0.5) * radians(${(BAKE_BMAX * 2).toFixed(1)});
    float L = degrees(l), B = degrees(b);
    // past ~17.5 deg the band has faded to nothing: skip all the noise there (whole
    // rows, so the branch is free)
    if (abs(B) > ${(BAKE_BMAX - 5).toFixed(1)}) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 d = vec3(cos(b) * cos(l), sin(b), -cos(b) * sin(l));

    // This galaxy is drawn at ~0.55 of its true angular size: through a 26-34 deg
    // portrait lens the real one is all bulge and fog, this one is a band. Ls / Bs are
    // "model" degrees (the shapes below are sized as on the real sky).
    const float S = 0.55;
    // and narrower still across (NB): on a phone the band is a backdrop behind the
    // words, a stripe of star clouds, not a fog across the frame
    const float NB = 0.6;
    float Ls = L / S, Bs = B / (S * NB);
    // noise coordinates, squashed a little in latitude so structure lies along the plane
    vec3 q = vec3(d.x, d.y * 1.7, d.z) / S;

    // the plane wanders a little, and so does everything in it
    vec3 flat3 = vec3(d.x, 0.0, d.z) / S;
    float meander = 0.8 * fbm(flat3 * 2.2 + 3.0, 3);
    float Bm = Bs - meander;

    // a light domain warp: enough to stop the noise looking like noise, not enough to swirl
    vec3 w = vec3(fbm(q * 2.5 + 1.7, 3), fbm(q * 2.5 + 9.2, 3), fbm(q * 2.5 + 4.4, 3));
    vec3 qw = q + 0.04 * w;

    // ---- starlight: a thin disc, brightest toward the centre, and a compact bulge
    float lon = 0.28 + 0.3 * exp(-pow(L / 85.0, 2.0)) + 0.3 * exp(-pow(L / 22.0, 2.0));
    // the big star clouds: Cygnus (what the opening looks at) and Scutum / Aquila
    lon += 0.42 * exp(-pow((L - 74.0) / 16.0, 2.0)) + 0.22 * exp(-pow((L - 28.0) / 10.0, 2.0));
    float sig = mix(2.8, 4.1, exp(-pow(Ls / 40.0, 2.0)));
    // (the wide exponential wings are kept faint: they were the fog)
    float disc = 0.92 * gauss(Bm, sig) + 0.08 * exp(-abs(Bm) / (1.8 * sig));
    float bulge = exp(-0.5 * (pow(Ls / 8.0, 2.0) + pow(Bs / 5.6, 2.0)));
    bulge += 0.18 * exp(-0.5 * (pow(Ls / 17.0, 2.0) + pow(Bs / 9.5, 2.0)));

    // star clouds: log-normal clumping at three scales (bright knots, dim gaps, the
    // way crowds of stars actually bunch), never hard-edged
    float c1 = fbm(qw * 5.5, 5);
    float c2 = fbm(qw * 15.0 + 3.0, 4);
    float clouds = clamp(0.5 + 0.95 * c1 + 0.45 * c2, 0.0, 1.6);
    float grain = fbm(q * 70.0 + 5.0, 3);
    float clump = exp(1.5 * c1 + 0.8 * c2 + 0.5 * grain);
    float light = lon * disc * (0.25 + 0.62 * clump);
    light += 0.55 * bulge * (0.75 + 0.3 * clump);

    // ---- dust: the great rift, offset above the plane from the centre out past
    // l = 80 and splitting the band; then dark patches with ragged, fractal edges and
    // the odd tendril (thresholded, domain-warped fbm, masked to the plane), never a web.
    // All of it lies within ~14 deg of the plane (tau < 0.003 beyond), so it is only
    // computed there.
    float tau = 0.0;
    if (abs(Bs) < 26.0) {
      vec3 qd = vec3(d.x, d.y * 2.3, d.z) / S;
      vec3 w2 = vec3(fbm(qd * 6.0 + 2.3, 3), fbm(qd * 6.0 + 7.9, 3), fbm(qd * 6.0 + 5.1, 3));
      qd += 0.07 * w + 0.025 * w2;
      float rz = smoothstep(-20.0, -3.0, L) * smoothstep(104.0, 80.0, L);
      float dn = fbm(qd * 8.0 + 3.1, 7);
      // high-frequency tearing for every dust edge, so nothing has a smooth outline
      float tear = fbm(qd * 34.0 + 9.0, 4);
      // the rift: one continuous lane, its edges torn by noise, its opacity patchy
      float riftB = 1.2 + 1.2 * fbm(flat3 * 4.0 + 8.0, 3) + 0.9 * fbm(qd * 11.0 + 5.0, 5);
      float riftW = 0.7 + 0.6 * (fbm(flat3 * 6.0 + 2.0, 2) * 0.5 + 0.5) + 1.1 * exp(-pow((L - 50.0) / 24.0, 2.0));
      float lane = gauss(Bm - riftB + 0.35 * tear, riftW) * rz * (1.1 + 1.6 * smoothstep(-0.3, 0.3, dn + 0.2 * tear));
      // a thinner lane along the plane on the other side of the centre
      float lane2 = gauss(Bm + 0.6 + 0.8 * fbm(qd * 9.0 + 15.0, 5), 0.7) * smoothstep(-8.0, -30.0, L) * smoothstep(-150.0, -60.0, L) * (0.6 + 1.4 * smoothstep(-0.2, 0.3, dn));
      // dark clouds come in regions, not evenly sprinkled: big, small, and rare knots
      float region = smoothstep(0.0, 0.45, fbm(qd * 2.2 + 40.0, 3));
      float big = fbm(qd * 4.5 + 17.0, 6);
      float patches = smoothstep(0.05, 0.5, big + 0.25 * tear) * region;
      float knots = smoothstep(0.25, 0.6, fbm(qd * 24.0 + 11.0, 6) + 0.25 * tear) * smoothstep(0.0, 0.3, dn) * region;
      float plane = exp(-abs(Bm) / 4.0) * smoothstep(170.0, 50.0, abs(L));
      tau = lane + lane2
        + 0.8 * patches * plane
        + 0.45 * knots * plane
        // dark wisps rising off the bulge (a nod to the Pipe and the Snake)
        + 1.3 * smoothstep(-0.15, 0.45, fbm(qd * 6.0 + 21.0, 6) + 0.2 * tear) * exp(-0.5 * (pow((Ls - 3.0) / 7.0, 2.0) + pow((Bs - 4.5) / 3.0, 2.0)));
    }
    vec3 ext = exp(-tau * vec3(0.97, 1.0, 1.04));

    // ---- colour: a pale gold core, cool blue-white outward, the star clouds bluer,
    // and broad patches drifting warm and cool, so the band never reads as flat grey
    // (at this low a level a neutral glow goes brown on a phone)
    vec3 warm = vec3(1.0, 0.84, 0.66);
    vec3 neutral = vec3(0.74, 0.85, 1.0);
    vec3 col = mix(neutral, warm, clamp(1.1 * bulge + 0.35 * exp(-pow(L / 30.0, 2.0)), 0.0, 1.0));
    col *= mix(vec3(1.0), vec3(0.86, 0.95, 1.12), clamp(clouds - 0.5, 0.0, 1.0) * 0.6);
    col *= mix(vec3(1.06, 0.97, 0.88), vec3(0.9, 0.97, 1.1), smoothstep(-0.35, 0.35, fbm(q * 1.6 + 23.0, 2)));
    vec3 glow = col * light * ext;

    // ---- two faint nebulae: a rose-violet one below the core, a teal one by the rift
    // (their noise is only evaluated where they are)
    if (abs(L - 8.0) < 16.0 && abs(B + 4.0) < 9.0) {
      vec2 o = (vec2(Ls, Bs) - vec2(15.0, -7.5)) / vec2(9.0, 5.0);
      float n1 = fbm(qw * 15.0 + 31.0, 5);
      float wisps = pow(1.0 - abs(fbm(qw * 9.0 + 13.0, 4)), 5.0);
      float neb = exp(-dot(o, o)) * smoothstep(-0.25, 0.5, n1) * (0.35 + 0.9 * wisps);
      glow += vec3(0.62, 0.40, 0.95) * neb * 0.2 * ext;
    }
    if (abs(L - 73.0) < 44.0 && abs(B - 3.6) < 8.5) {
      vec2 o = (vec2(L, Bs) - vec2(73.0, 6.5)) / vec2(8.0 / S, 4.5);
      float n1 = fbm(qw * 15.0 + 57.0, 5);
      float wisps = pow(1.0 - abs(fbm(qw * 10.0 + 3.0, 4)), 5.0);
      float neb = exp(-dot(o, o)) * smoothstep(-0.2, 0.55, n1) * (0.3 + 0.9 * wisps);
      glow += vec3(0.30, 0.78, 0.80) * neb * 0.16 * ext;
    }

    // fade out before the skipped rows (by here the glow is a few 1/1000ths)
    glow *= smoothstep(${(BAKE_BMAX - 5).toFixed(1)}, ${(BAKE_BMAX - 10).toFixed(1)}, abs(B));

    float dither = (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
    vec3 enc = sqrt(clamp(glow / ${MW_VMAX.toFixed(2)}, 0.0, 1.0));
    gl_FragColor = vec4(enc + dither, clamp(exp(-0.9 * tau) + dither, 0.0, 1.0));
  }
`;

// The bake is ~80 noise evaluations per texel, too much for one frame on a phone. So
// it goes in strips, a couple per update, over the first frames of the show, while
// the Milky Way is still invisible (it fades in from 0.6 s, and the screen fades up
// from black). An update that needs it visible (a seek, a screenshot) finishes it
// at once. Until a strip lands its texels read as clear sky (transmission 1).
function createBaker(renderer, quality) {
  const max = renderer.capabilities.maxTextureSize || 4096;
  const W = Math.min(quality === 'low' ? 2048 : 4096, max);
  const H = W / 4; // 45 degrees of latitude: ~22 texels per degree, like the faced longitudes
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: new THREE.Vector2(W, H) } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // start as empty sky with no dust
  const prev = renderer.getRenderTarget();
  const clearColour = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, false, false);
  renderer.setClearColor(clearColour, clearAlpha);
  renderer.setRenderTarget(prev);

  let next = 0;
  return {
    texture: rt.texture,
    get done() {
      return next >= BAKE_STRIPS;
    },
    step(n) {
      if (next >= BAKE_STRIPS) return;
      const prevTarget = renderer.getRenderTarget();
      rt.scissorTest = true;
      for (let k = 0; k < n && next < BAKE_STRIPS; k++, next++) {
        const y0 = Math.floor((next * H) / BAKE_STRIPS);
        const y1 = Math.floor(((next + 1) * H) / BAKE_STRIPS);
        rt.scissor.set(0, y0, W, y1 - y0);
        renderer.setRenderTarget(rt); // applies the scissor
        renderer.render(mesh, cam); // autoClear clears only inside the scissor
      }
      rt.scissorTest = false;
      renderer.setRenderTarget(prevTarget);
      if (next >= BAKE_STRIPS) {
        geo.dispose();
        mat.dispose();
      }
    },
  };
}

// ---------------------------------------------------------------- the stars
function makeStars() {
  const rand = mulberry32(20260923);
  const gaussR = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  // one extra instance at the end: the seed, the star the loading dot becomes. Its
  // direction is a uniform (see update), and aProp.w = -1 marks it
  const dir = new Float32Array((STAR_COUNT + 1) * 3);
  const prop = new Float32Array((STAR_COUNT + 1) * 4); // intensity, twinkle rate, phase, reveal jitter
  const col = new Float32Array((STAR_COUNT + 1) * 3);
  const wrapL = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

  // a handful of loose open clusters, near the plane
  const clusters = [];
  for (let k = 0; k < 16; k++) clusters.push({ l: wrapL(-110 + rand() * 230), b: gaussR() * 3, r: 0.25 + rand() * 0.6, n: 12 + Math.floor(rand() * 26) });
  let ci = 0;
  let cleft = clusters[0].n;

  for (let i = 0; i < STAR_COUNT; i++) {
    // magnitude: N(<m) ~ 10^(0.45 m), from about -1.4 to 6.6 (the deep ones 4.8 and fainter)
    const deep = i >= STAR_BASE;
    let m = Math.max(-1.4, 6.6 + 2.2 * Math.log10(Math.max(1e-9, rand())));
    if (deep && m < 4.8) m = 4.8 + 1.8 * rand();
    let l, b;
    if (ci < clusters.length && i % 7 === 3) {
      // a cluster member: faint, tight around the cluster centre
      const c = clusters[ci];
      m = 4.6 + rand() * 2.0;
      l = c.l + (gaussR() * c.r) / Math.max(0.2, Math.cos((c.b * Math.PI) / 180));
      b = c.b + gaussR() * c.r;
      if (--cleft <= 0 && ++ci < clusters.length) cleft = clusters[ci].n;
    } else if (rand() < 0.16 + 0.62 * smoothstep(1.5, 6.6, m)) {
      // the disc: faint stars crowd the plane (bright ones are mostly near us, everywhere)
      if (rand() < 0.13) {
        l = gaussR() * 5.5;
        b = gaussR() * 3.9;
      } else {
        l = rand() < 0.55 ? rand() * 360 - 180 : gaussR() * 55;
        const sig = 0.55 * (3.4 + 3.4 * Math.exp(-Math.pow(l / 45, 2))); // the band is drawn at 0.55 scale
        b = (rand() < 0.5 ? -1 : 1) * sig * -Math.log(1 - rand() * 0.999) * 0.85;
      }
    } else {
      b = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
      l = rand() * 360 - 180;
    }
    l = (wrapL(l) * Math.PI) / 180;
    b = (Math.max(-89.9, Math.min(89.9, b)) * Math.PI) / 180;
    dir[i * 3] = Math.cos(b) * Math.cos(l);
    dir[i * 3 + 1] = Math.sin(b);
    dir[i * 3 + 2] = -Math.cos(b) * Math.sin(l);

    // display intensity: flux compressed (the eye, not the photometer), with the faint
    // end let down further, so the crowd of faint stars has depth instead of reading
    // as one even sprinkle
    const flux = Math.pow(10, -0.4 * (m - 6.6));
    prop[i * 4] = Math.pow(flux, 0.5) * Math.pow(10, -0.1 * Math.max(0, m - 5));
    prop[i * 4 + 1] = rand();
    prop[i * 4 + 2] = rand() * 6.2832;
    prop[i * 4 + 3] = rand() + (deep ? 2 : 0); // the reveal jitter; + 2 marks a deep star

    // temperature: mostly white, some blue-white, some warm
    const r = rand();
    const K =
      r < 0.09 ? 3100 + rand() * 1000 : r < 0.3 ? 4100 + rand() * 1300 : r < 0.64 ? 5400 + rand() * 1700 : r < 0.9 ? 7100 + rand() * 3000 : 10000 + rand() * 14000;
    const c = starColour(K, 0.72);
    col.set(c, i * 3);
  }
  // the seed: about magnitude 2, white with the faintest blue, like the loader's glow
  prop.set([9.0, 0.37, 1.3, -1], STAR_COUNT * 4);
  col.set(starColour(8200, 0.72), STAR_COUNT * 3);
  return { dir, prop, col };
}

const STAR_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute vec4 aProp;
  attribute vec3 aColor;
  uniform vec2 uRes;
  uniform vec2 uFocus;
  uniform float uDpr, uTime, uBright, uTwinkle, uWarp, uSeedK, uDeep;
  uniform vec3 uSeedDir;
  uniform sampler2D uMW;
  varying vec3 vCol;
  varying vec2 vLocal;
  varying vec4 vShape; // sigma, streak length, halo amplitude, halo radius
  varying float vPeak;
  ${LONMAP}
  ${IGNITE}

  void main() {
    float seed = step(aProp.w, -0.5);
    vec3 dir = seed > 0.5 ? uSeedDir : aDir;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(dir * ${R_SKY.toFixed(1)}, 1.0);
    if (clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 ndc = clip.xy / clip.w;
    float I = aProp.x;
    float lg = log2(I);
    float px = sqrt(uDpr);

    // shape in device pixels
    // (never under ~0.6 px, or a faint star would shimmer as the sky drifts across pixels)
    float sigma = max((0.5 + 0.12 * lg) * px, 0.62);
    // after the zoom the lens gathers more of each point (the band's glow does not
    // gain): the faint field comes up to meet the dimmer, softer sky of the late beats
    float peak = 0.075 * I * mix(1.0, uDpr, 0.45) * (1.0 + 0.7 * uDeep);
    // a soft ceiling: the brightest field stars stay points with a small halo instead
    // of blooming into orbs (the brightest star owns the bloom); faint ones barely change
    peak = peak / (1.0 + peak / 1.6);
    float haloA = 0.018 * smoothstep(5.0, 30.0, I) * sqrt(I);
    float haloR = (1.6 + 0.35 * lg) * px;

    // twinkle: slow and faster sines, stronger on the bright ones
    float f1 = 2.2 + 3.1 * aProp.y, f2 = 7.5 + 6.0 * fract(aProp.y * 7.31);
    float tw = 0.62 * sin(uTime * f1 + aProp.z) + 0.38 * sin(uTime * f2 + aProp.z * 2.7);
    float amp = (0.05 + 0.2 * smoothstep(3.0, 25.0, I)) * uTwinkle;
    peak *= 1.0 + amp * tw;
    haloA *= 1.0 + amp * 0.6 * tw;

    // faint stars behind the dust lanes are dimmed with the band
    float trans = texture2D(uMW, galUv(dir)).a;
    peak *= mix(1.0, 0.08 + 0.92 * trans, smoothstep(6.0, 1.5, I));

    // the reveal. Each star's moment: brightest first (the limiting magnitude climbing
    // steadily, so they arrive by the dozen, then by the hundred), plus the ripple out
    // from the loading star, plus a jitter. Near the origin brightness gives way to
    // distance, so the loading star's nearest neighbours join it within ~0.3 s.
    float deep = step(1.5, aProp.w);
    float jit = aProp.w - 2.0 * deep;
    float mk = clamp((4.0 - lg) / 4.5, 0.0, 1.0); // 0 = magnitude ~1 or brighter, 1 = the faintest
    float dw = rippleDist((ndc * 0.5 + 0.5) * uRes);
    float near = smoothstep(0.05, 0.4, dw);
    float tS = 0.1 + 2.2 * pow(mk, 1.25) * mix(0.05, 1.0, near) + 1.4 * pow(dw, 1.3) + 0.4 * jit * mix(0.2, 1.0, near);
    float rev = ignite(uRevT - tS, 0.5 + 0.55 * (1.0 - mk), aProp.z);
    // the seed is there from the first frame (the grade fades it up with the screen),
    // swells once as the dot hands over, then sinks back and leaves (uSeedK)
    rev = mix(rev, (1.0 + 1.1 * swell(uRevT - 0.16)) * uSeedK, seed);
    // the deep stars come in with the zoom, each at its own moment of it
    float k = rev * uBright * mix(1.0, smoothstep(jit * 0.6, jit * 0.6 + 0.4, uDeep), deep);

    // the warp: streak radially away from the focus of the zoom. The length grows
    // with distance from the focus only so far, so the edges get a lurch, not a
    // jump to lightspeed
    vec2 p = ndc * 0.5 * uRes;
    vec2 rel = p - uFocus * 0.5 * uRes;
    float rl = length(rel);
    vec2 axis = rl > 0.001 ? rel / rl : vec2(1.0, 0.0);
    float len = uWarp * 0.2 * min(rl, 0.4 * min(uRes.x, uRes.y));
    // a streak spreads the same light over more pixels: the faint ones all but vanish,
    // the bright ones draw the lines
    k *= mix(1.0, clamp(2.0 * sigma / (sigma + len), 0.12, 1.0), smoothstep(0.0, 3.0, len));

    float R = max(3.3 * sigma, haloA > 0.0 ? haloR * 6.0 : 0.0) + 1.0;
    vec2 side = vec2(-axis.y, axis.x);
    float along = position.x < 0.0 ? -len - R : R;
    float across = position.y * R;
    vLocal = vec2(along, across);
    vShape = vec4(sigma, len, haloA, haloR);

    // the brightest ones scintillate in colour, just perceptibly
    float ct = sin(uTime * (5.3 + 3.0 * aProp.y) + aProp.z * 3.1) * 0.1 * smoothstep(10.0, 30.0, I) * uTwinkle;
    vCol = aColor * vec3(1.0 + ct, 1.0, 1.0 - ct) * k;
    vPeak = peak;

    vec2 off = axis * along + side * across;
    gl_Position = clip;
    gl_Position.xy += off / (0.5 * uRes) * clip.w;
    if (k <= 0.0005) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying vec2 vLocal;
  varying vec4 vShape;
  varying float vPeak;
  void main() {
    float sigma = vShape.x, len = vShape.y;
    float s = vLocal.x;
    float sc = clamp(s, -len, 0.0);
    float ds = s - sc;
    float d2 = ds * ds + vLocal.y * vLocal.y;
    // the streak fades toward its tail
    float fade = len > 0.0 ? mix(1.0, 0.18, -sc / len) : 1.0;
    float core = exp(-0.5 * d2 / (sigma * sigma)) * vPeak;
    float halo = vShape.z * exp(-sqrt(d2) / vShape.w);
    gl_FragColor = vec4(vCol * (core + halo) * fade, 1.0);
  }
`;

// ---------------------------------------------------------------- the Milky Way sphere
// The camera sits at the sphere's centre, so the interpolated position, normalised,
// is exactly the pixel's view direction: the texture is looked up per pixel from it,
// with no UV seam and no dependence on the tessellation.
const MW_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MW_FRAG = /* glsl */ `
  uniform sampler2D uMW;
  uniform vec2 uRes, uFocus;
  uniform float uGain, uMilky, uBright, uPxAng, uWarp, uDeep;
  varying vec3 vDir;
  ${HASH}
  ${LONMAP}
  ${IGNITE}

  // one layer of faint, unresolved stars: at most one per 3D cell, pinned to the
  // sphere and kept clear of the cell walls so none is ever cut in half. A layer
  // whose cells shrink under ~5 device px fades out (there it would only shimmer)
  vec3 starLayer(vec3 d, float K, float dens, float gain, float dw) {
    float cellPx = 1.0 / (uPxAng * K);
    float vis = smoothstep(3.2, 5.5, cellPx);
    if (vis <= 0.0) return vec3(0.0);
    vec3 p = d * K;
    vec3 c = floor(p);
    vec3 h = hash33(c);
    vec3 q = normalize(c + 0.2 + 0.6 * h) * K;
    vec3 f = q - c;
    float sigma = min(0.62 / cellPx, 0.09);
    float m = 3.2 * sigma;
    float inside = step(m, min(min(f.x, f.y), f.z)) * step(max(max(f.x, f.y), f.z), 1.0 - m);
    vec3 h2 = hash33(c + 71.37);
    float present = step(h2.y, dens);
    vec3 dp = p - q;
    float prof = exp(-0.5 * dot(dp, dp) / (sigma * sigma));
    float mag = (0.035 + 0.5 * pow(h2.x, 3.0)) * gain * vis;
    // the faintest of all: they fill in last, rippling out like the rest
    float rev = ignite(uRevT - (1.0 + 1.8 * pow(dw, 1.2) + 0.8 * h2.z), 0.35, h.y * 6.28);
    vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.8, 0.88, 1.0), h.x);
    return tint * (inside * present * prof * mag * rev);
  }

  void main() {
    vec3 d = normalize(vDir);
    vec4 m = texture2D(uMW, galUv(d));
    vec3 raw = m.rgb * m.rgb; // 0..1 of VMAX
    // the warp: the glow only softens a touch along the streaks (a few taps back toward
    // the focus, stepped in direction space so no texture seam can show). The band
    // itself stays put; the stars carry the motion
    if (uWarp > 0.004) {
      vec2 rel = gl_FragCoord.xy - (uFocus * 0.5 + 0.5) * uRes;
      vec2 stepPx = -rel * (uWarp * 0.018 / 5.0);
      vec3 dd = stepPx.x * dFdx(d) + stepPx.y * dFdy(d);
      vec3 acc = raw;
      float wsum = 1.0;
      for (int i = 1; i <= 5; i++) {
        float wt = 1.0 - float(i) / 6.0;
        vec3 s = texture2D(uMW, galUv(normalize(d + dd * float(i)))).rgb;
        acc += s * s * wt;
        wsum += wt;
      }
      raw = acc / wsum;
    }
    // the long exposure: the brightest star clouds come up first, then the fainter
    // band around them, and the dust lanes last, as the light either side of them
    // arrives. Never a wipe: the order is the band's own brightness
    float lum = dot(raw, vec3(0.3, 0.55, 0.15));
    // (e front-loads the rig's eased 0..1, so the brightest clouds glimmer from ~2 s;
    // the toe keeps each region dark until its own light has "arrived")
    float nb = sqrt(clamp(lum / 0.3, 0.0, 1.0));
    float e = pow(uMilky, 0.55);
    float dev = smoothstep(0.0, 1.0, (e * 1.8 - (1.0 - nb)) / 0.8);
    vec3 col = raw * uGain * dev * (0.45 + 0.55 * e);

    // unresolved stars, three layers of them: sparse off the band, crowded and a
    // little brighter in the star clouds, missing in the dust. This grain is what
    // makes the band read as starlight
    // (the density follows the clouds' own contrast, so they read as crowds of stars,
    // and the glow under them is only the part too faint to resolve)
    float n = clamp(lum / 0.4, 0.0, 1.0) * (0.3 + 0.7 * dev);
    float dens = (0.07 + 0.93 * pow(n, 0.85)) * (0.1 + 0.9 * m.a);
    float g = (0.6 + 0.7 * n) * (1.0 + 0.45 * uDeep);
    float dw = rippleDist(gl_FragCoord.xy);
    vec3 grain = starLayer(d, 240.0, dens * 0.8, g, dw)
      + starLayer(d.zxy * vec3(1.0, -1.0, 1.0), 360.0, dens, g * 0.85, dw)
      + starLayer(d.yzx * vec3(-1.0, 1.0, 1.0), 540.0, dens, g * 0.7, dw);
    col += grain * (1.0 - 0.3 * smoothstep(0.03, 0.3, uWarp)); // the band holds still through the warp
    gl_FragColor = vec4(col * uBright, 1.0);
  }
`;

// ---------------------------------------------------------------- ambient shooting stars
// Act one's few are placed by hand, in the quiet between the big moments (never in
// the sunrise, never near THE meteor at 25-26, never straddling the rig's gates at
// 3 / 24.4 / 28.8, and on the side away from the brightest star). From 60 s on,
// one every 9 +- 1.5 s, seeded. Drawn in screen space but in the world pass, before
// the Earth, so the planet hides one that crosses it.
const M_ACT1 = [
  [5.2, 0], // [start, side: 0 left, 1 right]
  [16.4, 1],
  [35.2, 0],
  [44.6, 0],
  [53.4, 1],
];
const M_FROM = 60;
const M_SLOT = 9;
const M_JIT = 3;

const METEOR_VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform vec2 uA, uB; // tail start and head, device px from the top left
  uniform float uR;
  varying vec2 vLocal;
  void main() {
    vec2 ab = uB - uA;
    float len = max(length(ab), 0.001);
    vec2 axis = ab / len;
    vec2 side = vec2(-axis.y, axis.x);
    // position.x: -1 = past the tail, +1 = past the head
    float along = position.x < 0.0 ? -len - uR : uR;
    float across = position.y * uR;
    vLocal = vec2(along, across);
    vec2 p = uB + axis * along + side * across;
    gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  }
`;

const METEOR_FRAG = /* glsl */ `
  uniform float uLen, uI, uW;
  varying vec2 vLocal;
  void main() {
    float s = vLocal.x, c = vLocal.y;
    float sc = clamp(s, -uLen, 0.0);
    float u = uLen > 0.0 ? -sc / uLen : 0.0; // 0 at the head, 1 at the tail's end
    float w = uW * mix(1.0, 0.45, u);
    float ds = s - sc;
    float tail = exp(-0.5 * (ds * ds + c * c) / (w * w)) * pow(1.0 - u, 1.6);
    float r2 = s * s + c * c;
    float head = exp(-0.5 * r2 / (uW * uW)) * 2.2 + exp(-sqrt(r2) / (uW * 1.8)) * 0.14;
    vec3 tailCol = mix(vec3(0.95, 0.97, 1.0), vec3(1.0, 0.72, 0.5), smoothstep(0.1, 0.9, u));
    vec3 c3 = tailCol * tail * 0.9 + vec3(0.9, 1.0, 0.97) * head;
    gl_FragColor = vec4(c3 * uI, 1.0);
  }
`;

// ---------------------------------------------------------------- the brightest star
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
    // a hint of spectrum toward the ends of the spikes, drifting slowly (kept light:
    // on the dim tips a stronger tint reads as dirty amber, not as colour)
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + x * 1.2 - t * 0.07));
    return mix(vec3(1.0), rainbow, 0.12 * smoothstep(0.25, 0.95, x));
  }

  void main() {
    vec2 p = vOff; // CSS px from the star's centre, y down
    float r = length(p);
    float I = uI;
    float t = uTime;
    float tw = 1.0 + 0.05 * sin(t * 7.3) + 0.035 * sin(t * 12.9 + 1.3) + 0.03 * sin(t * 3.1 + 0.4);

    // white-hot core, crisp in device pixels
    float sc = (0.62 + 0.1 * I) / sqrt(uDpr);
    float core = exp(-0.5 * r * r / (sc * sc)) * (1.4 + 2.2 * I) * tw;
    // soft halo and a wide faint glow; the glow is where the colour lives
    float halo = exp(-r / (uUnit * (1.1 + 1.0 * I))) * (0.16 + 0.12 * I) * tw;
    float glow = 0.035 * I * exp(-r / (uUnit * (2.5 + 2.5 * I)));
    vec3 shimmer = 1.0 + 0.07 * vec3(sin(t * 2.3), sin(t * 1.7 + 2.0), sin(t * 2.9 + 4.0));
    // the round terms fade over a long radius, so no edge of the quad can ever show
    float win = 1.0 - smoothstep(0.35 * uHalf, 0.95 * uHalf, r);
    vec3 c = (vec3(1.0) * core + vec3(1.0, 0.94, 0.86) * shimmer * halo + vec3(1.0, 0.86, 0.7) * glow) * win;

    // diffraction spikes: a cross, and one fainter pair off the axis
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
      vec3 xs = al / (L * vec3(1.02, 1.0, 0.98)); // red reaches a touch further than blue
      vec3 along = pow(1.0 + xs * 7.0, vec3(-1.55)) * (1.0 - smoothstep(vec3(0.35), vec3(1.0), xs));
      float amp = (i == 2 ? 0.32 : 1.0) * (0.3 + 0.42 * I) * tw;
      c += spikeColour(x, t) * along * across * amp;
    }

    c *= 1.0 - smoothstep(0.9 * uHalf, uHalf, r);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ---------------------------------------------------------------- createSky
export function createSky(stage) {
  const root = new THREE.Group();
  root.name = 'sky';
  const galaxy = new THREE.Group(); // the fixed galactic orientation, under the director's rotation
  {
    const n = GAL_N.clone().normalize();
    const c = GAL_C.clone().addScaledVector(n, -GAL_C.dot(n)).normalize();
    const e = new THREE.Vector3().crossVectors(n, c);
    galaxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(c, n, e.negate()));
  }
  root.add(galaxy);
  stage.scene.add(root);

  const baker = createBaker(stage.renderer, stage.quality);
  const mwTex = baker.texture;

  // the opening's clock and origin, one set of uniforms shared by stars and grain
  const revealUniforms = {
    uOrigin: { value: new THREE.Vector2(0, 0) },
    uRmax: { value: 1 },
    uRevT: { value: REVEAL_DUR + REVEAL_TAIL + 20 },
  };

  // --- Milky Way sphere
  const mwUniforms = {
    uMW: { value: mwTex },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGain: { value: 0.08 }, // a low glow: the grain carries the band
    uMilky: { value: 0 },
    uBright: { value: 1 },
    uPxAng: { value: 0.0005 },
    uWarp: { value: 0 },
    uDeep: { value: 0 },
    uFocus: { value: new THREE.Vector2(0, 0) },
    ...revealUniforms,
  };
  const mwMesh = new THREE.Mesh(
    new THREE.SphereGeometry(R_SKY, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: mwUniforms,
      vertexShader: MW_VERT,
      fragmentShader: MW_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  mwMesh.renderOrder = -30;
  mwMesh.frustumCulled = false;
  galaxy.add(mwMesh);

  // --- stars
  const stars = makeStars();
  const sgeo = new THREE.InstancedBufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  sgeo.setIndex([0, 1, 2, 0, 2, 3]);
  sgeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(stars.dir, 3));
  sgeo.setAttribute('aProp', new THREE.InstancedBufferAttribute(stars.prop, 4));
  sgeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(stars.col, 3));
  sgeo.instanceCount = STAR_COUNT + 1; // + the seed
  const starUniforms = {
    uMW: { value: mwTex },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: new THREE.Vector2(0, 0) },
    uDpr: { value: 1 },
    uTime: { value: 0 },
    uBright: { value: 1 },
    uTwinkle: { value: 1 },
    uWarp: { value: 0 },
    uSeedDir: { value: new THREE.Vector3(0, 0, -1) },
    uSeedK: { value: 0 },
    uDeep: { value: 0 },
    ...revealUniforms,
  };
  const starMesh = new THREE.Mesh(
    sgeo,
    new THREE.ShaderMaterial({
      uniforms: starUniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  starMesh.renderOrder = -20;
  starMesh.frustumCulled = false;
  galaxy.add(starMesh);

  // --- ambient meteor (one at a time; the schedule never overlaps two)
  const meteorUniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uA: { value: new THREE.Vector2() },
    uB: { value: new THREE.Vector2() },
    uR: { value: 10 },
    uLen: { value: 0 },
    uI: { value: 0 },
    uW: { value: 1 },
  };
  const meteorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: meteorUniforms,
      vertexShader: METEOR_VERT,
      fragmentShader: METEOR_FRAG,
      side: THREE.DoubleSide, // built in y-down pixels, so its winding flips
      blending: THREE.AdditiveBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  meteorMesh.renderOrder = -10;
  meteorMesh.frustumCulled = false;
  meteorMesh.visible = false;
  root.add(meteorMesh);

  // --- the brightest star, in the overlay (screen space, CSS px, y down)
  const heroUniforms = {
    uI: { value: 0 },
    uTime: { value: 0 },
    uUnit: { value: 1 },
    uDpr: { value: 1 },
    uHalf: { value: 50 },
  };
  const hero = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: heroUniforms,
      vertexShader: HERO_VERT,
      fragmentShader: HERO_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  hero.renderOrder = 20;
  hero.frustumCulled = false;
  hero.visible = false;
  stage.overlay.scene.add(hero);

  const fwd = new THREE.Vector3();
  const seedDir = new THREE.Vector3();
  const galaxyInv = new THREE.Quaternion();

  // the meteor due at time t, if any (one reused object: no allocation per frame)
  const meteor = { k: 0, t0: 0, dur: 0, left: true };
  const meteorDur = (k) => 0.45 + 0.4 * hash(k * 5 + 2);
  const hit = (k, t0, left) => {
    meteor.k = k;
    meteor.t0 = t0;
    meteor.dur = meteorDur(k);
    meteor.left = left;
    return meteor;
  };
  function meteorAt(t) {
    if (t < M_FROM) {
      for (let i = 0; i < M_ACT1.length; i++) {
        const t0 = M_ACT1[i][0];
        if (t >= t0 && t < t0 + meteorDur(1000 + i)) return hit(1000 + i, t0, M_ACT1[i][1] === 0);
      }
      return null;
    }
    const k0 = Math.floor((t - M_FROM) / M_SLOT);
    for (let k = Math.max(0, k0 - 1); k <= k0 + 1; k++) {
      const t0 = M_FROM + 2 + k * M_SLOT + (hash(k * 5 + 1) - 0.5) * M_JIT;
      if (t >= t0 && t < t0 + meteorDur(k)) return hit(k, t0, hash(k * 5 + 3) < 0.5);
    }
    return null;
  }

  function updateMeteor(t, p, W, H, dpr) {
    const m = p.meteors ? meteorAt(t) : null;
    const allow = (p.meteors ? 1 : 0) * (1 - smoothstep(0.0, 0.05, p.warp || 0));
    if (!m || allow <= 0 || p.brightness <= 0) {
      meteorMesh.visible = false;
      return;
    }
    const k = m.k;
    const left = m.left;
    const diag = Math.hypot(W, H);
    // start in the upper part of the screen, in an outer third; head down and outward
    const x0 = (left ? 0.06 + 0.26 * hash(k * 5 + 4) : 0.68 + 0.26 * hash(k * 5 + 4)) * W;
    const y0 = (0.05 + (left ? 0.22 : 0.1) * hash(k * 7 + 11)) * H; // the right side keeps above the brightest star
    const ang = ((14 + 38 * hash(k * 7 + 12)) * Math.PI) / 180;
    const dx = (left ? -1 : 1) * Math.cos(ang);
    const dy = Math.sin(ang);
    const path = (0.09 + 0.08 * hash(k * 7 + 13)) * diag;
    const u = (t - m.t0) / m.dur; // 0..1
    const travel = 1 - Math.pow(1 - u, 1.25); // a touch of deceleration
    const hx = x0 + dx * path * travel;
    const hy = y0 + dy * path * travel;
    const tail = Math.min(path * travel, path * 0.62);
    // ablation: it brightens, flares a little, and burns out
    const env = smoothstep(0, 0.22, u) * (1 - smoothstep(0.62, 1.0, u)) * (0.85 + 0.35 * Math.sin(u * Math.PI));
    const flicker = 1 + 0.12 * Math.sin(t * 61 + k) * Math.sin(t * 23 + k * 3);
    meteorUniforms.uRes.value.set(W * dpr, H * dpr);
    meteorUniforms.uB.value.set(hx * dpr, hy * dpr);
    meteorUniforms.uA.value.set((hx - dx * tail) * dpr, (hy - dy * tail) * dpr);
    meteorUniforms.uLen.value = tail * dpr;
    meteorUniforms.uW.value = 0.75 * Math.sqrt(dpr) + 0.2;
    meteorUniforms.uR.value = 9 * dpr;
    meteorUniforms.uI.value = 0.75 * env * flicker * allow * p.brightness;
    meteorMesh.visible = true;
  }

  function updateHero(t, h, W, H, dpr) {
    const I = h ? h.intensity : 0;
    if (!(I > 0.001)) {
      hero.visible = false;
      return;
    }
    const unit = Math.min(1.6, Math.max(1, Math.min(W, H) / 390)) * (h.size || 1);
    const half = unit * (8 + 13.5 * I) * 1.12 + unit * 6;
    hero.position.set(h.x * W, h.y * H, 0);
    hero.scale.set(half, half, 1);
    heroUniforms.uI.value = I;
    heroUniforms.uTime.value = t;
    heroUniforms.uUnit.value = unit;
    heroUniforms.uDpr.value = dpr;
    heroUniforms.uHalf.value = half;
    hero.visible = true;
  }

  return {
    object: root,
    /** @internal the baked Milky Way, for the harness */
    _milkyWay: mwTex,
    update(t, dt, p) {
      const cam = stage.camera;
      const { w: W, h: H, dpr } = stage.size;
      root.position.copy(cam.position);
      if (p.rotation) root.rotation.copy(p.rotation);

      const bright = Math.max(0, p.brightness ?? 1);
      const reveal = p.reveal ?? 1;
      const warp = p.warp || 0;
      const milky = p.milkyWay ?? 1;

      // four strips a frame while the screen fades up from black (done in ~8 frames,
      // before the first neighbours of the seed ignite, so no star's dust dimming
      // lands mid-ignition); all of it at once for a seek or a frozen frame
      if (!baker.done) baker.step(milky > 0.0005 || t > 0.3 ? BAKE_STRIPS : 4);

      // where the zoom expands from (the lens-shifted optical axis), for the streaks
      fwd.set(0, 0, -1).applyQuaternion(cam.quaternion).add(cam.position).project(cam);
      const pxAng = (2 * Math.tan(((cam.fov * Math.PI) / 180) / 2)) / (H * dpr);
      const deep = smoothstep(FOV_DEEP[0], FOV_DEEP[1], cam.fov);

      // --- the opening. The seconds into the reveal carry on past its end, so the
      // last stars finish their ignition instead of freezing mid-twinkle
      const RW = W * dpr;
      const RH = H * dpr;
      const revT = reveal * REVEAL_DUR + (reveal >= 1 ? Math.max(0, t - REVEAL_T0 - REVEAL_DUR) : 0);
      const opening = revT < REVEAL_DUR + REVEAL_TAIL;
      // (after it, a fixed "long since", with the ripple measured from the screen centre:
      // a frame that seeks straight past the opening never set the origin, and with it
      // at (0, 0) and a 1 px radius every star's moment lay hours away)
      revealUniforms.uRevT.value = opening ? revT : REVEAL_DUR + REVEAL_TAIL + 20;
      if (!opening) {
        revealUniforms.uOrigin.value.set(RW / 2, RH / 2);
        revealUniforms.uRmax.value = Math.hypot(RW, RH) / 2;
      }
      let seedK = 0;
      if (opening) {
        // the loading star's point in the sky: it was at revealOrigin at t = 0, and the
        // zoom since has carried it away from the lens axis by f(now) / f(0)
        const ro = p.revealOrigin || DEFAULT_ORIGIN;
        const ox = ro[0] * RW;
        const oy = (1 - ro[1]) * RH;
        const fx = (fwd.x * 0.5 + 0.5) * RW;
        const fy = (fwd.y * 0.5 + 0.5) * RH;
        const fov0 = Math.abs(cam.fov - FOV_REST) < 1e-3 ? cam.fov : FOV_OPEN;
        const zoom = Math.tan((fov0 * Math.PI) / 360) / Math.tan((cam.fov * Math.PI) / 360);
        const sx = fx + (ox - fx) * zoom;
        const sy = fy + (oy - fy) * zoom;
        revealUniforms.uOrigin.value.set(sx, sy);
        revealUniforms.uRmax.value = Math.max(Math.hypot(ox, oy), Math.hypot(RW - ox, oy), Math.hypot(ox, RH - oy), Math.hypot(RW - ox, RH - oy));
        // the seed sits exactly there: from the loading dot's size and place, a real
        // star that drifts with the others, sinks to an ordinary one as its
        // neighbours arrive, and goes before anything else moves
        seedK = (1 - 0.72 * smoothstep(1.3, 3.4, revT)) * (1 - smoothstep(3.8, 5.4, revT));
        seedDir.set((sx / RW) * 2 - 1, (sy / RH) * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
        seedDir.applyAxisAngle(WORLD_Y, -ORBIT_RATE * (t - REVEAL_T0));
        galaxyInv.copy(root.quaternion).multiply(galaxy.quaternion).invert();
        starUniforms.uSeedDir.value.copy(seedDir.applyQuaternion(galaxyInv));
      }
      starUniforms.uSeedK.value = seedK;

      mwUniforms.uRes.value.set(W * dpr, H * dpr);
      mwUniforms.uMilky.value = milky;
      mwUniforms.uBright.value = bright;
      mwUniforms.uPxAng.value = pxAng;
      mwUniforms.uWarp.value = warp;
      mwUniforms.uDeep.value = deep;
      mwUniforms.uFocus.value.set(fwd.x, fwd.y);
      mwMesh.visible = bright > 0.0005;

      starUniforms.uRes.value.set(W * dpr, H * dpr);
      starUniforms.uFocus.value.set(fwd.x, fwd.y);
      starUniforms.uDpr.value = dpr;
      starUniforms.uTime.value = t;
      starUniforms.uBright.value = bright;
      starUniforms.uTwinkle.value = p.twinkle ?? 1;
      starUniforms.uWarp.value = warp;
      starUniforms.uDeep.value = deep;
      starMesh.visible = bright > 0.0005;

      updateMeteor(t, p, W, H, dpr);
      updateHero(t, p.hero, W, H, dpr);
    },
  };
}
