// The secret: catch the shooting stars.
//
// Act two asks the director for it (tap "0" ten times on the third question),
// the director calls start(onDone). A card says she found something, a round
// runs for `seconds`, a result card offers `again` and `back`, and `back` hands
// the score to onDone and gets out of the way.
//
// The stars are the show's meteor in miniature, drawn in the overlay (CSS px,
// y down), additively and in HDR: the heads sit far above 1 so the bloom pass
// turns them into light, the trains stay under the bloom threshold and cool
// from white through pale gold to a faint violet. Four instanced draws: tails,
// particles (sparks shed in flight, the glitter a caught star dissolves into),
// heads, and glints (the catch's little star and a miss's faint ripple).
// Every pool is fixed at creation, so a frame allocates nothing.
//
// Unlike the show, a game is event-driven: it runs on accumulated dt, never on
// the show clock, and is never shot with ?t=. The star schedule is seeded per
// round, so a given seed always throws the same stars at the same game times.
// Without WebGL (stage null) the same simulation drives plain DOM elements.

import * as THREE from 'three';

const MAX_STARS = 10;
const N_P = 384; // particles
const N_G = 12; // glints and ripples
const MAX_SCHED = 120;
const LEAD = 0.55; // seconds between "start" and the round's clock starting
const HIT_R = 48; // CSS px: generous, for thumbs
const TRAIL = 0.11; // s of the head's recent path that still counts (a thumb lands where the eye last saw it)
const BURN = 0.24; // last share of a star's life spent burning out
const ACC = 0.14; // a touch of acceleration along the path
const SHUTTER = 0.03; // s of motion blur on particles
const BEST_KEY = 'reina.minigame.best';
// kept in step with .mg-score in minigame.css; wide soft shadows on OLED black
// read as a grey smudge, so the resting glow is small and faint
const SCORE_GLOW = '0 0 10px rgba(255, 255, 255, 0.2), 0 0 26px rgba(170, 190, 255, 0.1)';
const SCORE_GLOW_HOT = '0 0 12px rgba(255, 238, 206, 0.8), 0 0 30px rgba(255, 200, 120, 0.36)';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const pathK = (k) => k * (1 - ACC + ACC * k);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

// ---------------------------------------------------------------- tails
// One ribbon per star behind its head. vQ.x is px behind the head, vQ.y px
// across. The gradient is fixed in px behind the head (lmax long), clipped where
// the star came in and, as it burns out or is caught, drained from the far end.
const TAIL_VS = /* glsl */ `
  attribute vec4 iA; // head x, y, direction x, y
  attribute vec4 iB; // back (px), travelled (px), lmax (px), brightness
  attribute vec4 iC; // half width (px), scale, drain 0..1, seed
  varying vec2 vQ;
  varying vec4 vB;
  varying vec4 vC;
  void main() {
    float d = mix(-16.0 * iC.y, iB.x, position.x + 0.5); // room for the round cap ahead of the head
    float e = position.y * 2.0 * iC.x;
    vec2 n = vec2(-iA.w, iA.z);
    vec2 P = iA.xy - iA.zw * d + n * e;
    vQ = vec2(d, e);
    vB = iB;
    vC = iC;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 0.0, 1.0);
  }
`;
const TAIL_FS = /* glsl */ `
  uniform float uDpr;
  varying vec2 vQ;
  varying vec4 vB;
  varying vec4 vC;
  ${GLSL_COMMON}
  vec3 tailColor(float u) {
    vec3 hot = vec3(1.0, 0.94, 0.86);
    vec3 gold = vec3(1.0, 0.68, 0.32);
    vec3 violet = vec3(0.46, 0.4, 1.0);
    vec3 c = mix(hot, gold, smoothstep(0.04, 0.36, u));
    return mix(c, violet, smoothstep(0.4, 0.9, u));
  }
  void main() {
    float d = vQ.x;
    // ahead of the head the ribbon ends in a round cap, not a straight cut:
    // measure across as the distance from the head itself
    float e = length(vec2(min(d, 0.0), vQ.y));
    float trav = vB.y;
    float lmax = vB.z;
    float scale = vC.y;
    float drain = vC.z;
    float u = clamp(d / lmax, 0.0, 1.0);
    float I = pow(1.0 - u, 1.4) * (0.32 + 0.68 * exp(-u * 3.4));
    // born where it came in (softly), drained from the far end as it goes out
    float fadeLen = clamp(trav * 0.45, 1.0, 46.0);
    float m = clamp((trav - d) / fadeLen, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    m *= smoothstep(-16.0 * scale, -6.0 * scale, d); // the cap's last glow, before the quad ends
    float cut = lmax * (1.0 - drain);
    m *= 1.0 - step(0.001, drain) * smoothstep(cut * 0.3, cut + 0.001, d);
    float knots = 0.86 + 0.28 * vnoise((trav - d) / 22.0 + vC.w * 17.0);
    float px = 1.0 / uDpr;
    // a train with body near the head (a warm glow wider than the hairline),
    // so the head reads as the bright end of it, not a ball on a thread
    float sc = mix(1.1, 0.34, sqrt(u)) * sqrt(scale);
    float scE = max(sc, 0.75 * px);
    float core = exp(-0.5 * e * e / (scE * scE)) * (sc / scE);
    float sg = mix(5.2, 2.3, sqrt(u)) * scale;
    float glow = exp(-0.5 * e * e / (sg * sg));
    float sh = mix(12.0, 7.0, u) * scale;
    float halo = exp(-0.5 * e * e / (sh * sh));
    vec3 col = mix(tailColor(u), vec3(1.0, 0.97, 0.93), 0.4 * (1.0 - u)) * core * 0.95
             + tailColor(min(1.0, u * 1.12 + 0.04)) * glow * 0.8
             + vec3(0.42, 0.36, 1.0) * halo * 0.07 * (0.4 + u);
    col *= I * m * knots * vB.w;
    // the train stays under the bloom threshold with a soft knee (see meteor.js):
    // a gradient crossing it mid-tail would draw a dark notch across the tail
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    float Lk = L < 0.56 ? L : 0.56 + 0.18 * (1.0 - exp(-(L - 0.56) / 0.18));
    col *= Lk / max(L, 1e-4);
    // a white-hot neck carries the head into the train
    float hot = exp(-max(d, 0.0) / (8.0 * scale));
    col += vec3(1.0, 0.97, 0.93) * core * 1.7 * hot * m * vB.w;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- heads
// A white-hot point, sharper at the leading edge and drawn out a little behind
// into the train. The glow around it is the bloom's: any halo drawn here at
// more than a few hundredths comes out of the tone curve as a grey coma. A
// caught head swells and flashes as it goes.
const HEAD_VS = /* glsl */ `
  attribute vec4 iA; // x, y, direction x, y
  attribute vec4 iB; // brightness, swell, scale, flash
  uniform float uHalf;
  varying vec2 vQ;
  varying vec4 vB;
  varying float vHs;
  void main() {
    float hs = uHalf * iB.z * max(iB.y, 0.6);
    vec2 l = position.xy * 2.0 * hs;
    vec2 n = vec2(-iA.w, iA.z);
    vec2 P = iA.xy + iA.zw * l.x + n * l.y;
    vQ = l;
    vB = iB;
    vHs = hs;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 0.0, 1.0);
  }
`;
const HEAD_FS = /* glsl */ `
  uniform float uDpr;
  varying vec2 vQ;
  varying vec4 vB;
  varying float vHs;
  void main() {
    float s = vB.z * vB.y;
    float a = vQ.x / s;
    float r = length(vec2(a * (a > 0.0 ? 1.6 : 0.6), vQ.y / s));
    float sc = max(0.95, 0.8 / uDpr);
    float core = exp(-0.5 * r * r / (sc * sc));
    float inner = exp(-r / 1.5);
    float outer = exp(-r / 5.0);
    vec3 col = vec3(1.0, 0.98, 0.96) * core * (3.2 + 1.6 * vB.w)
             + vec3(1.0, 0.94, 0.84) * inner * (0.5 + 0.3 * vB.w)
             + vec3(0.9, 0.9, 1.0) * outer * 0.03;
    col *= vB.x * smoothstep(vHs, vHs * 0.6, length(vQ));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- particles
// Short streaks along each particle's velocity (a shutter's worth of motion blur).
const PART_VS = /* glsl */ `
  attribute vec4 iA; // x, y, streak x, y (px)
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
const PART_FS = /* glsl */ `
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
    float fade = 1.0 - 0.7 * a / max(vLen, 1e-3);
    gl_FragColor = vec4(vCol * k * fade, 1.0);
  }
`;

// ---------------------------------------------------------------- glints
// kind 0, a catch: a tiny star is born where the head was, with the hero star's
// own spikes (0.16 rad and a fainter pair at 1.02, as sky.js and meteor.js), so
// each catch rhymes with the show's burst. kind 1, a miss: a faint hairline
// ripple, so a tap on empty sky still answers.
const GLINT_VS = /* glsl */ `
  attribute vec4 iA; // x, y, age (s), duration (s)
  attribute vec4 iB; // kind, size (px), intensity, scale
  varying vec2 vQ;
  varying vec4 vA;
  varying vec4 vB;
  varying float vHw;
  void main() {
    float hw = iB.x < 0.5 ? iB.y * 1.15 : 30.0 * iB.w;
    vec2 l = position.xy * 2.0 * hw;
    vQ = l;
    vA = iA;
    vB = iB;
    vHw = hw;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iA.xy + l, 0.0, 1.0);
  }
`;
const GLINT_FS = /* glsl */ `
  uniform float uDpr;
  varying vec2 vQ;
  varying vec4 vA;
  varying vec4 vB;
  varying float vHw;
  float spike(vec2 q, float a, float len, float w) {
    vec2 D = vec2(cos(a), sin(a));
    float al = abs(dot(q, D));
    float ac = dot(q, vec2(-D.y, D.x));
    return exp(-0.5 * ac * ac / (w * w)) * pow(max(0.0, 1.0 - al / len), 2.4);
  }
  void main() {
    vec2 q = vQ;
    float r = length(q);
    float k = clamp(vA.z / vA.w, 0.0, 1.0);
    float px = 1.0 / uDpr;
    vec3 col;
    if (vB.x < 0.5) {
      // flashes up in a few frames, then lets go
      float env = vA.z < 0.05 ? vA.z / 0.05 : pow(1.0 - clamp((vA.z - 0.05) / (vA.w - 0.05), 0.0, 1.0), 2.2);
      // a crisp point with long fine rays: the bloom supplies the glow, and a
      // wide halo here would blow the catch out into a white blob
      float core = exp(-0.5 * r * r / 1.3) * 3.6 * env;
      float halo = exp(-r / (1.8 + 2.4 * env)) * 0.3 * env;
      float sw = max(0.5, 0.8 * px);
      float len = vB.y * (0.35 + 0.65 * sqrt(env));
      float sp = spike(q, 0.16, len, sw) + spike(q, 1.7308, len, sw)
               + 0.32 * (spike(q, 1.02, 0.55 * len, sw) + spike(q, 2.5908, 0.55 * len, sw));
      sp *= 3.0 * env * env;
      col = vec3(1.0, 0.97, 0.92) * (core + halo + sp) + vec3(1.0, 0.84, 0.56) * exp(-r / 12.0) * 0.04 * env;
      col *= vB.z;
    } else {
      float rr = mix(5.0, 24.0, 1.0 - pow(1.0 - k, 2.2)) * vB.w;
      float w = max(0.9, 1.2 * px);
      float ring = exp(-0.5 * (r - rr) * (r - rr) / (w * w));
      col = vec3(0.86, 0.9, 1.0) * ring * 0.32 * pow(1.0 - k, 1.5) * vB.z;
    }
    col *= smoothstep(vHw, vHw * 0.7, r);
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

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// "you caught {n}." -> text, a highlighted numeral, text
function fillN(el, template, n, numCls) {
  el.textContent = '';
  const parts = String(template || '').split('{n}');
  parts.forEach((p, i) => {
    if (p) el.append(p);
    if (i < parts.length - 1) el.append(h('span', numCls, String(n)));
  });
}

/**
 * createMinigame(stage | null, root, content, hooks) -> { start(onDone), update(t, dt), get active }
 * content: window.REINA (its .minigame block is used; a bare minigame block also works)
 * hooks: { celebrate(fx, fy, count), onMood(name), reducedMotion?, seed? }
 *   celebrate gets viewport fractions, like act two's. seed fixes the star schedule.
 * Also exposed, for tests: state, score, time, round, heads().
 */
export function createMinigame(stage, root, content, hooks = {}) {
  const M = (content && content.minigame) || content || {};
  const seconds = Math.max(5, +M.seconds || 30);
  const reduced = !!(hooks.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
  const gl = !!stage;

  // ------------------------------------------------------------ state
  let active = false;
  let state = 'idle'; // idle | intro | play | end | result | leaving
  let onDoneCb = null;
  let score = 0;
  let best = 0;
  let round = 0;
  let gameT = 0; // the round's clock: -LEAD..seconds
  let clock = 0; // everything visual: accumulated dt while active
  let introNext = 0; // clock of the next preview star behind the intro card
  const timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    while (timers.length) clearTimeout(timers.pop());
  };
  try {
    best = Math.max(0, parseInt(localStorage.getItem(BEST_KEY), 10) || 0);
  } catch {
    best = 0;
  }

  const size = () => (gl ? stage.size : { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });

  // ------------------------------------------------------------ the schedule
  // Precomputed at round start from the seed: when each star comes, how long it
  // lives, and five numbers that pick its edge and heading. Geometry is resolved
  // at spawn against the live screen size, so a rotation mid-round is harmless.
  const sch = {
    n: 0,
    next: 0,
    at: new Float32Array(MAX_SCHED),
    life: new Float32Array(MAX_SCHED),
    r: new Float32Array(MAX_SCHED * 5),
  };
  function buildSchedule(seed) {
    const rnd = mulberry32(seed);
    let t = 0.35;
    let n = 0;
    while (t < seconds - 0.8 && n < MAX_SCHED) {
      const k = t / seconds;
      // lifetimes shorten and gaps close as the round goes on
      const life = Math.min(2.6, Math.max(1.3, lerp(2.55, 1.35, Math.pow(k, 0.85)) * (0.9 + 0.2 * rnd())));
      const cap = Math.round(lerp(2, 5, Math.pow(k, 0.9)));
      let alive = 0;
      let firstEnd = Infinity;
      for (let i = 0; i < n; i++) {
        const e = sch.at[i] + sch.life[i];
        if (sch.at[i] <= t && e > t) {
          alive++;
          if (e < firstEnd) firstEnd = e;
        }
      }
      if (alive >= cap) {
        t = firstEnd + 0.05;
        continue;
      }
      sch.at[n] = t;
      sch.life[n] = life;
      for (let j = 0; j < 5; j++) sch.r[n * 5 + j] = rnd();
      n++;
      // the first star arrives alone, so she learns what to do
      const gap = n === 1 ? 1.1 : lerp(0.95, 0.34, Math.pow(k, 1.1)) * (0.62 + 0.76 * rnd());
      t += gap;
    }
    sch.n = n;
    sch.next = 0;
  }

  // ------------------------------------------------------------ stars
  const S = {
    live: new Uint8Array(MAX_STARS), // 0 free, 1 flying, 2 caught
    id: new Int32Array(MAX_STARS),
    sx: new Float32Array(MAX_STARS),
    sy: new Float32Array(MAX_STARS),
    dx: new Float32Array(MAX_STARS),
    dy: new Float32Array(MAX_STARS),
    len: new Float32Array(MAX_STARS),
    born: new Float32Array(MAX_STARS), // clock
    life: new Float32Array(MAX_STARS),
    lmax: new Float32Array(MAX_STARS),
    seed: new Float32Array(MAX_STARS),
    hx: new Float32Array(MAX_STARS),
    hy: new Float32Array(MAX_STARS),
    trav: new Float32Array(MAX_STARS),
    env: new Float32Array(MAX_STARS), // head brightness now
    drain: new Float32Array(MAX_STARS),
    caught: new Float32Array(MAX_STARS), // clock of the catch
    quick: new Float32Array(MAX_STARS), // clock when told to burn out early (round over)
    play: new Uint8Array(MAX_STARS), // 1 = a round's star, 0 = a preview behind the card
  };
  let nextId = 1;
  let scl = 1;
  const fx = mulberry32(0x5eed); // particles only: never touches the schedule

  function spawn(life, r0, r1, r2, r3, r4, playable) {
    let i = -1;
    for (let j = 0; j < MAX_STARS; j++)
      if (!S.live[j]) {
        i = j;
        break;
      }
    if (i < 0) return;
    const { w, h } = size();
    const m = 14;
    // an edge (mostly the top, as meteors fall), a point along it, and a heading
    // through the middle of the screen, turned a little so no two paths rhyme
    let x, y;
    if (r0 < 0.42) {
      x = w * (0.06 + 0.88 * r1);
      y = -m;
    } else if (r0 < 0.64) {
      x = -m;
      y = h * (0.1 + 0.55 * r1);
    } else if (r0 < 0.86) {
      x = w + m;
      y = h * (0.1 + 0.55 * r1);
    } else {
      x = w * (0.1 + 0.8 * r1);
      y = h + m;
    }
    const tx = w * (0.2 + 0.6 * r2);
    const ty = h * (0.24 + 0.52 * r3);
    const ang = Math.atan2(ty - y, tx - x) + (r4 - 0.5) * 0.6;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // how far until it would leave the screen
    const ex = dx > 1e-4 ? (w + m - x) / dx : dx < -1e-4 ? (-m - x) / dx : Infinity;
    const ey = dy > 1e-4 ? (h + m - y) / dy : dy < -1e-4 ? (-m - y) / dy : Infinity;
    const exit = Math.max(60, Math.min(ex, ey));
    const k = playable ? clamp01(gameT / seconds) : 0.2;
    const vmax = lerp(300, 520, k) * scl;
    const len = Math.min(exit * (0.78 + 0.3 * r2), vmax * life);
    S.live[i] = 1;
    S.id[i] = nextId++;
    S.sx[i] = x;
    S.sy[i] = y;
    S.dx[i] = dx;
    S.dy[i] = dy;
    S.len[i] = len;
    S.born[i] = clock;
    S.life[i] = life;
    S.lmax[i] = (170 + 80 * r3) * scl;
    S.seed[i] = r4;
    S.caught[i] = -1;
    S.quick[i] = -1;
    S.play[i] = playable ? 1 : 0;
    S.hx[i] = x;
    S.hy[i] = y;
    S.trav[i] = 0;
    S.env[i] = 0;
    S.drain[i] = 0;
  }

  // where star i's head is `age` seconds after its birth (into tmp); returns px travelled
  const tmp = new Float32Array(2);
  function headAt(i, age) {
    const s = S.len[i] * pathK(clamp01(age / S.life[i]));
    tmp[0] = S.sx[i] + S.dx[i] * s;
    tmp[1] = S.sy[i] + S.dy[i] * s;
    return s;
  }

  // ------------------------------------------------------------ particles
  const P = {
    x: new Float32Array(N_P),
    y: new Float32Array(N_P),
    vx: new Float32Array(N_P),
    vy: new Float32Array(N_P),
    born: new Float32Array(N_P).fill(-99),
    life: new Float32Array(N_P).fill(1),
    w: new Float32Array(N_P),
    r: new Float32Array(N_P),
    g: new Float32Array(N_P),
    b: new Float32Array(N_P),
    tw: new Float32Array(N_P), // twinkle rate, rad/s (0 = steady)
    ph: new Float32Array(N_P),
    drag: new Float32Array(N_P),
    grav: new Float32Array(N_P),
  };
  let pNext = 0;
  function emit(x, y, vx, vy, life, w, r, g, b, tw, drag, grav) {
    const i = pNext;
    pNext = (pNext + 1) % N_P;
    P.x[i] = x;
    P.y[i] = y;
    P.vx[i] = vx;
    P.vy[i] = vy;
    P.born[i] = clock;
    P.life[i] = life;
    P.w[i] = w;
    P.r[i] = r;
    P.g[i] = g;
    P.b[i] = b;
    P.tw[i] = tw;
    P.ph[i] = fx() * 6.283;
    P.drag[i] = drag;
    P.grav[i] = grav;
  }
  // a colour along the train: white-hot, pale gold, faint violet (as TAIL_FS)
  const col3 = new Float32Array(3);
  function trainColor(u) {
    const a = smooth(0.04, 0.36, u);
    const c = smooth(0.4, 0.9, u);
    col3[0] = lerp(1.0, 0.46, c);
    col3[1] = lerp(lerp(0.94, 0.68, a), 0.4, c);
    col3[2] = lerp(lerp(0.86, 0.32, a), 1.0, c);
  }

  // ------------------------------------------------------------ glints
  const G = {
    x: new Float32Array(N_G),
    y: new Float32Array(N_G),
    born: new Float32Array(N_G).fill(-99),
    dur: new Float32Array(N_G).fill(1),
    kind: new Float32Array(N_G),
    size: new Float32Array(N_G),
    k: new Float32Array(N_G),
  };
  let gNext = 0;
  function glint(x, y, kind, dur, sizePx, intensity) {
    const i = gNext;
    gNext = (gNext + 1) % N_G;
    G.x[i] = x;
    G.y[i] = y;
    G.born[i] = clock;
    G.dur[i] = dur;
    G.kind[i] = kind;
    G.size[i] = sizePx;
    G.k[i] = intensity;
  }

  // ------------------------------------------------------------ GL
  let R = null;
  if (gl) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const dpr = { value: 1 };
    const group = new THREE.Group();
    group.visible = false;
    const inst = (n, names) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute('position', quad.getAttribute('position'));
      const arrs = {};
      for (const nm of names) {
        const a = new Float32Array(n * 4);
        const attr = new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(nm, attr);
        arrs[nm] = { a, attr };
      }
      geo.instanceCount = 0;
      return { geo, arrs };
    };
    const tails = inst(MAX_STARS, ['iA', 'iB', 'iC']);
    const heads = inst(MAX_STARS, ['iA', 'iB']);
    const parts = inst(N_P, ['iA', 'iB']);
    const glints = inst(N_G, ['iA', 'iB']);
    const headHalf = { value: 26 };
    const meshes = [
      [tails, additive(TAIL_VS, TAIL_FS, { uDpr: dpr }), 30],
      [parts, additive(PART_VS, PART_FS, { uDpr: dpr }), 31],
      [heads, additive(HEAD_VS, HEAD_FS, { uDpr: dpr, uHalf: headHalf }), 32],
      [glints, additive(GLINT_VS, GLINT_FS, { uDpr: dpr }), 33],
    ];
    for (const [g, mat, order] of meshes) {
      const mesh = new THREE.Mesh(g.geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      group.add(mesh);
    }
    group.renderOrder = 30;
    stage.overlay.scene.add(group);
    R = { group, dpr, tails, heads, parts, glints };
  }

  // ------------------------------------------------------------ DOM
  root.classList.add('mg');
  if (reduced) root.classList.add('mg--reduced');
  if (!gl) root.classList.add('mg--dom');
  root.setAttribute('aria-label', M.title || '');
  root.textContent = '';

  const field = h('div', 'mg-field'); // the +1s, and the stars without WebGL
  field.setAttribute('aria-hidden', 'true');
  const hud = h('div', 'mg-hud');
  const scoreEl = h('div', 'mg-score', '0');
  scoreEl.setAttribute('aria-live', 'polite');
  const timerEl = h('div', 'mg-timer');
  const timerBar = h('i', 'mg-timer-bar');
  timerEl.append(timerBar);
  timerEl.setAttribute('aria-hidden', 'true');
  hud.append(scoreEl, timerEl);

  const intro = h('div', 'mg-scene mg-intro');
  const foundEl = h('p', 'mg-found', M.found || '');
  const introCard = h('div', 'mg-card');
  const titleEl = h('h2', 'mg-title', M.title || '');
  const hintEl = h('p', 'mg-hint', M.hint || '');
  const startBtn = h('button', 'mg-btn mg-start', M.start || '');
  startBtn.type = 'button';
  introCard.append(titleEl, hintEl, startBtn);
  intro.append(foundEl, introCard);

  const result = h('div', 'mg-scene mg-result');
  const resCard = h('div', 'mg-card');
  const resEl = h('p', 'mg-res');
  const bestEl = h('p', 'mg-best');
  const backBtn = h('button', 'mg-btn mg-back', M.back || '');
  backBtn.type = 'button';
  const againBtn = h('button', 'mg-link mg-again', M.again || '');
  againBtn.type = 'button';
  resCard.append(resEl, bestEl, backBtn, againBtn);
  result.append(resCard);
  root.append(field, hud, intro, result);

  // the +1s: a small pool, animated by the compositor
  const plus = [];
  for (let i = 0; i < 6; i++) {
    const el = h('span', 'mg-plus', '+1');
    field.append(el);
    plus.push(el);
  }
  let plusNext = 0;

  // stars without WebGL: a head and a tail per pool slot, and some glitter dots
  const dom = [];
  const domDots = [];
  let dotNext = 0;
  if (!gl) {
    for (let i = 0; i < MAX_STARS; i++) {
      const el = h('div', 'mg-dstar');
      const tail = h('i', 'mg-dtail');
      el.append(tail, h('b', 'mg-dhead'));
      el.style.opacity = '0';
      field.append(el);
      dom.push({ el, tail, shown: false });
    }
    for (let i = 0; i < 24; i++) {
      const d = h('i', 'mg-ddot');
      field.append(d);
      domDots.push(d);
    }
  }

  // The timer drains on a paused animation whose currentTime is the round's
  // clock: one number per frame, no strings, and the warm last five seconds are
  // just keyframes.
  let timerAnim = null;
  const late = Math.max(0, (seconds - 5) / seconds);
  const cool = { backgroundColor: 'rgba(247, 241, 234, 0.6)', boxShadow: '0 0 6px rgba(200, 214, 255, 0.25)' };
  function makeTimerAnim() {
    if (timerAnim || !timerBar.animate) return;
    timerAnim = timerBar.animate(
      [
        { transform: 'scaleX(1)', ...cool, offset: 0 },
        { transform: `scaleX(${(1 - late).toFixed(4)})`, ...cool, offset: late },
        {
          transform: `scaleX(${(0.5 * (1 - late)).toFixed(4)})`,
          backgroundColor: 'rgba(255, 222, 160, 0.95)',
          boxShadow: '0 0 8px rgba(255, 206, 130, 0.75), 0 0 22px rgba(255, 160, 90, 0.35)',
          offset: late + (1 - late) * 0.5,
        },
        { transform: 'scaleX(0)', backgroundColor: 'rgba(255, 170, 150, 1)', boxShadow: '0 0 10px rgba(255, 160, 130, 0.85), 0 0 26px rgba(255, 100, 120, 0.4)', offset: 1 },
      ],
      { duration: seconds * 1000, fill: 'both', easing: 'linear' },
    );
    timerAnim.pause();
  }
  let timerLast = -1;
  function setTimer(g) {
    const k = Math.min(seconds, Math.max(0, g));
    if (timerAnim) {
      if (k !== timerLast) timerAnim.currentTime = k * 1000;
    } else if (Math.abs(k - timerLast) > 0.01) {
      timerBar.style.transform = `scaleX(${(1 - k / seconds).toFixed(4)})`;
    }
    timerLast = k;
  }

  function show(scene) {
    for (const s of [intro, result]) s.classList.toggle('is-on', s === scene);
  }
  function setState(s) {
    state = s;
    root.dataset.state = s;
  }
  function mood(name) {
    try {
      hooks.onMood?.(name);
    } catch (err) {
      console.error('[minigame]', err);
    }
  }

  function clearStars() {
    S.live.fill(0);
    P.born.fill(-99);
    G.born.fill(-99);
    for (const d of dom) {
      d.el.style.opacity = '0';
      d.shown = false;
    }
  }

  // ------------------------------------------------------------ flow
  function start(onDone) {
    clearTimers();
    onDoneCb = typeof onDone === 'function' ? onDone : null;
    score = 0;
    round = 0;
    active = true;
    root.hidden = false;
    clearStars();
    hud.classList.remove('is-on');
    result.classList.remove('is-in', 'is-leaving');
    setState('intro');
    show(intro);
    intro.classList.remove('is-ready', 'is-out', 'is-in');
    void intro.offsetWidth;
    intro.classList.add('is-in');
    introNext = clock + 1.5;
    // `found` alone for a beat, then the card rises in beneath it
    later(reduced ? 500 : 1150, () => {
      if (state !== 'intro') return;
      intro.classList.add('is-ready');
      later(900, () => {
        if (state === 'intro' && matchMedia('(hover: hover)').matches) startBtn.focus({ preventScroll: true });
      });
    });
  }

  function play() {
    if (state !== 'intro' && state !== 'result') return;
    clearTimers();
    round++;
    score = 0;
    scoreEl.textContent = '0';
    gameT = -LEAD;
    timerLast = -1;
    makeTimerAnim();
    setTimer(0);
    const seed = hooks.seed != null && hooks.seed !== '' ? (+hooks.seed | 0) + round * 7919 : (Math.random() * 2 ** 31) | 0;
    buildSchedule(seed);
    // preview stars behind the card burn out rather than vanish
    for (let i = 0; i < MAX_STARS; i++) if (S.live[i] === 1 && S.quick[i] < 0) S.quick[i] = clock;
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    intro.classList.add('is-out');
    result.classList.remove('is-in');
    later(reduced ? 250 : 560, () => {
      if (state === 'play' || state === 'end') show(null);
    });
    hud.classList.add('is-on');
    root.classList.add('is-playing');
    setState('play');
    mood('game');
  }

  function endRound() {
    setState('end');
    root.classList.remove('is-playing');
    for (let i = 0; i < MAX_STARS; i++) if (S.live[i] === 1 && S.quick[i] < 0) S.quick[i] = clock;
    const isBest = score > best;
    if (isBest) {
      best = score;
      try {
        localStorage.setItem(BEST_KEY, String(best));
      } catch {
        /* private mode: the best lives as long as the page does */
      }
    }
    fillN(resEl, M.result, score, 'mg-n');
    fillN(bestEl, M.best, best, 'mg-bn');
    bestEl.classList.toggle('is-new', isBest);
    later(reduced ? 450 : 950, () => {
      if (state !== 'end') return;
      hud.classList.remove('is-on');
      setState('result');
      show(result);
      void result.offsetWidth;
      result.classList.add('is-in');
      later(1000, () => {
        if (state === 'result' && matchMedia('(hover: hover)').matches) backBtn.focus({ preventScroll: true });
      });
    });
  }

  function back() {
    if (state !== 'result') return;
    clearTimers();
    setState('leaving');
    result.classList.remove('is-in');
    result.classList.add('is-leaving');
    const final = score;
    // the quiz starts coming back while the card is still going
    later(reduced ? 120 : 240, () => {
      mood('quiz');
      const cb = onDoneCb;
      onDoneCb = null;
      try {
        cb?.(final);
      } catch (err) {
        console.error('[minigame]', err);
      }
    });
    later(reduced ? 300 : 600, () => {
      root.hidden = true;
      active = false;
      result.classList.remove('is-leaving');
      show(null);
      clearStars();
      if (R) R.group.visible = false;
      setState('idle');
    });
  }

  startBtn.addEventListener('click', play);
  againBtn.addEventListener('click', play);
  backBtn.addEventListener('click', back);

  // ------------------------------------------------------------ catching
  function catchStar(i) {
    S.live[i] = 2;
    S.caught[i] = clock;
    score++;
    scoreEl.textContent = String(score);
    const { w, h } = size();
    const k = (clock - S.born[i]) / S.life[i];
    const v = (S.len[i] / S.life[i]) * (1 - ACC + 2 * ACC * clamp01(k)); // px/s along the path
    const vx = S.dx[i] * v;
    const vy = S.dy[i] * v;
    const hx = S.hx[i];
    const hy = S.hy[i];
    if (gl) {
      glint(hx, hy, 0, reduced ? 0.4 : 0.6, 42 * scl, 1);
      // glitter from the head: mostly white-gold, some gold, a little violet
      const nHead = reduced ? 6 : 18;
      for (let j = 0; j < nHead; j++) {
        const a = fx() * 6.283;
        const sp = (40 + 150 * Math.pow(fx(), 0.7)) * scl;
        const c = fx();
        let r = 1.0;
        let g = 0.93;
        let b = 0.8;
        let I = 2.2 + 2.2 * fx();
        if (c > 0.86) {
          r = 0.72;
          g = 0.62;
          b = 1.0;
          I = 1.2 + 0.8 * fx();
        } else if (c > 0.55) {
          g = 0.74;
          b = 0.4;
          I = 1.4 + 1.2 * fx();
        }
        emit(hx, hy, Math.cos(a) * sp + vx * 0.22, Math.sin(a) * sp + vy * 0.22, 0.65 + 0.6 * fx(), 0.65 + 0.5 * fx(), r * I, g * I, b * I, 14 + 18 * fx(), 3.2, 46 * scl);
      }
      // the train comes apart into glitter where it hung in the sky
      const nTail = reduced ? 3 : 12;
      const reach = Math.min(S.trav[i], S.lmax[i] * 0.75);
      for (let j = 0; j < nTail; j++) {
        const u = Math.pow(fx(), 1.4);
        const d = u * reach;
        trainColor(d / S.lmax[i]);
        const I = (1.3 - u) * (0.9 + 0.8 * fx());
        const a = fx() * 6.283;
        const sp = (8 + 30 * fx()) * scl;
        emit(hx - S.dx[i] * d, hy - S.dy[i] * d, Math.cos(a) * sp + vx * 0.06, Math.sin(a) * sp + vy * 0.06, 0.5 + 0.55 * fx(), 0.55 + 0.35 * fx(), col3[0] * I, col3[1] * I, col3[2] * I, 10 + 16 * fx(), 2.0, 22 * scl);
      }
    } else {
      domBurst(hx, hy);
    }
    // +1, a little above the thumb
    const el = plus[plusNext];
    plusNext = (plusNext + 1) % plus.length;
    const px = Math.min(w - 28, Math.max(28, hx));
    const py = Math.max(44, hy - 40);
    el.getAnimations?.().forEach((a) => a.cancel());
    const at = (dy, s) => `translate3d(${px}px, ${py + dy}px, 0) translate(-50%, -50%) scale(${s})`;
    // The easing lives on the keyframes, not the effect: an effect-level ease-out
    // squeezed the whole timeline, so the +1 peaked at 55 ms and was under half
    // strength by 190 ms, a grey flicker over the real sky. Now it pops in, holds
    // while it drifts up, and fades over the last half.
    el.animate(
      reduced
        ? [
            { transform: at(0, 1), opacity: 0 },
            { transform: at(0, 1), opacity: 1, offset: 0.12 },
            { transform: at(0, 1), opacity: 0.92, offset: 0.5 },
            { transform: at(0, 1), opacity: 0 },
          ]
        : [
            { transform: at(8, 0.86), opacity: 0, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
            { transform: at(-2, 1), opacity: 1, offset: 0.1 },
            { transform: at(-14, 1), opacity: 0.92, offset: 0.45, easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
            { transform: at(-30, 1), opacity: 0 },
          ],
      { duration: 950, fill: 'both' },
    );
    // the numeral takes the tick with a gentle pulse
    scoreEl.getAnimations?.().forEach((a) => a.cancel());
    scoreEl.animate(
      reduced
        ? [{ textShadow: SCORE_GLOW_HOT }, { textShadow: SCORE_GLOW }]
        : [
            { transform: 'scale(1)', textShadow: SCORE_GLOW },
            { transform: 'scale(1.1)', textShadow: SCORE_GLOW_HOT, offset: 0.22 },
            { transform: 'scale(1)', textShadow: SCORE_GLOW },
          ],
      { duration: 460, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    );
    try {
      navigator.vibrate?.(8);
    } catch {
      /* not everywhere */
    }
    try {
      hooks.celebrate?.(hx / w, hy / h, 3);
    } catch (err) {
      console.error('[minigame]', err);
    }
  }

  function onDown(e) {
    if (state !== 'play' || gameT < 0) return;
    if (e.target.closest && e.target.closest('button')) return;
    if (e.cancelable) e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    // the nearest head, measured to the stretch of path it covered in the last
    // TRAIL seconds: a thumb lands where the eye last saw the star
    let bestI = -1;
    let bestD = HIT_R * HIT_R;
    for (let i = 0; i < MAX_STARS; i++) {
      if (S.live[i] !== 1 || !S.play[i] || S.env[i] < 0.12) continue;
      const age = clock - S.born[i];
      headAt(i, age - TRAIL);
      const ax = tmp[0];
      const ay = tmp[1];
      headAt(i, age + 0.02);
      const bx = tmp[0] - ax;
      const by = tmp[1] - ay;
      const L2 = bx * bx + by * by;
      const k = L2 > 1e-6 ? clamp01(((x - ax) * bx + (y - ay) * by) / L2) : 1;
      const qx = ax + bx * k - x;
      const qy = ay + by * k - y;
      // the head itself wins over the path behind it by a few px
      const d2 = qx * qx + qy * qy + (1 - k) * 36;
      if (d2 < bestD) {
        bestD = d2;
        bestI = i;
      }
    }
    if (bestI >= 0) catchStar(bestI);
    else if (gl) glint(x, y, 1, 0.42, 0, 1);
    else domRipple(x, y);
  }
  root.addEventListener('pointerdown', onDown, { passive: false });
  // no zoom, no scroll, no callout while the thumb is busy
  root.addEventListener(
    'touchstart',
    (e) => {
      if (state === 'play' && e.cancelable && !(e.target.closest && e.target.closest('button'))) e.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener('contextmenu', (e) => {
    if (state === 'play') e.preventDefault();
  });

  // ------------------------------------------------------------ DOM fallback
  function domBurst(x, y) {
    const n = reduced ? 4 : 10;
    for (let j = 0; j < n; j++) {
      const d = domDots[dotNext];
      dotNext = (dotNext + 1) % domDots.length;
      const a = fx() * 6.283;
      const r = 18 + 46 * fx();
      d.getAnimations?.().forEach((an) => an.cancel());
      d.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0) scale(1)`, opacity: 1 },
          { transform: `translate3d(${x + Math.cos(a) * r}px, ${y + Math.sin(a) * r + 14}px, 0) scale(0.4)`, opacity: 0 },
        ],
        { duration: 700 + 400 * fx(), easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
      );
    }
  }
  function domRipple(x, y) {
    const d = domDots[dotNext];
    dotNext = (dotNext + 1) % domDots.length;
    d.getAnimations?.().forEach((an) => an.cancel());
    d.animate(
      [
        { transform: `translate3d(${x}px, ${y}px, 0) scale(1)`, opacity: 0.4 },
        { transform: `translate3d(${x}px, ${y}px, 0) scale(5)`, opacity: 0 },
      ],
      { duration: 420, easing: 'ease-out', fill: 'both' },
    );
  }

  // ------------------------------------------------------------ per frame
  function simulate(dt) {
    const { w, h } = size();
    scl = Math.min(1.35, Math.max(1, Math.sqrt(Math.min(w, h) / 390)));

    for (let i = 0; i < MAX_STARS; i++) {
      if (!S.live[i]) continue;
      if (S.live[i] === 2) {
        // caught: the head blooms and lets go, the train drains after it
        const c = clock - S.caught[i];
        S.env[i] = Math.max(0, 1 - c / (reduced ? 0.22 : 0.3));
        S.drain[i] = Math.min(1, c / 0.34);
        if (c > 0.4) S.live[i] = 0;
        continue;
      }
      const age = clock - S.born[i];
      const k = age / S.life[i];
      let quick = 1;
      if (S.quick[i] >= 0) {
        const q = (clock - S.quick[i]) / 0.45;
        quick = 1 - clamp01(q);
        if (q >= 1) {
          S.live[i] = 0;
          continue;
        }
      }
      if (k >= 1) {
        S.live[i] = 0;
        continue;
      }
      S.trav[i] = headAt(i, age);
      S.hx[i] = tmp[0];
      S.hy[i] = tmp[1];
      // ignites fast, burns out with a last small flare
      const ign = smooth(0, 0.14, age);
      const b = smooth(1 - BURN, 1, k);
      const flare = 1 + 0.35 * Math.sin(Math.PI * clamp01(b * 1.6)) * (1 - b);
      const flick = 0.92 + 0.08 * Math.sin(clock * 37 + S.seed[i] * 40) * Math.sin(clock * 23.3 + S.seed[i] * 17);
      S.env[i] = ign * (1 - b * b) * flare * flick * quick;
      S.drain[i] = Math.max(b * 0.9, 1 - quick);
      // sparks shed from the head now and then
      if (gl && !reduced && S.env[i] > 0.3 && fx() < dt * 11) {
        const v = S.len[i] / S.life[i];
        const a = (fx() - 0.5) * 2.4;
        const sp = (10 + 24 * fx()) * scl;
        const I = 1.0 + 1.1 * fx();
        emit(S.hx[i], S.hy[i], S.dx[i] * v * 0.14 - S.dy[i] * sp * a, S.dy[i] * v * 0.14 + S.dx[i] * sp * a, 0.3 + 0.35 * fx(), 0.55 + 0.3 * fx(), I, 0.82 * I, 0.56 * I, 0, 2.6, 30 * scl);
      }
    }

    if (gl) writeGL(dt);
    else writeDOM();
  }

  function writeGL(dt) {
    R.dpr.value = size().dpr;
    const tA = R.tails.arrs.iA.a;
    const tB = R.tails.arrs.iB.a;
    const tC = R.tails.arrs.iC.a;
    const hA = R.heads.arrs.iA.a;
    const hB = R.heads.arrs.iB.a;
    let n = 0;
    for (let i = 0; i < MAX_STARS; i++) {
      if (!S.live[i]) continue;
      const o = n * 4;
      const caught = S.live[i] === 2;
      const cA = caught ? clock - S.caught[i] : 0;
      tA[o] = hA[o] = S.hx[i];
      tA[o + 1] = hA[o + 1] = S.hy[i];
      tA[o + 2] = hA[o + 2] = S.dx[i];
      tA[o + 3] = hA[o + 3] = S.dy[i];
      tB[o] = Math.min(S.trav[i], S.lmax[i]) + 8;
      tB[o + 1] = S.trav[i];
      tB[o + 2] = S.lmax[i];
      tB[o + 3] = caught ? 1 - Math.min(1, cA / 0.34) : Math.min(1, S.env[i] * 1.15 + S.drain[i] * 0.5);
      tC[o] = 30 * scl;
      tC[o + 1] = scl;
      tC[o + 2] = S.drain[i];
      tC[o + 3] = S.seed[i];
      // a caught head swells and flashes once, then goes
      hB[o] = caught ? Math.max(0, 1 - cA / 0.2) : S.env[i];
      hB[o + 1] = caught ? 1 + 0.2 * Math.min(1, cA / 0.1) : 0.75 + 0.25 * S.env[i];
      hB[o + 2] = scl;
      hB[o + 3] = caught ? Math.max(0, 1 - cA / 0.12) : 0;
      n++;
    }
    R.tails.geo.instanceCount = n;
    R.heads.geo.instanceCount = n;
    R.tails.arrs.iA.attr.needsUpdate = true;
    R.tails.arrs.iB.attr.needsUpdate = true;
    R.tails.arrs.iC.attr.needsUpdate = true;
    R.heads.arrs.iA.attr.needsUpdate = true;
    R.heads.arrs.iB.attr.needsUpdate = true;

    const pA = R.parts.arrs.iA.a;
    const pB = R.parts.arrs.iB.a;
    let m = 0;
    for (let i = 0; i < N_P; i++) {
      const age = clock - P.born[i];
      if (age < 0 || age >= P.life[i]) continue;
      const dr = Math.exp(-P.drag[i] * dt);
      P.vx[i] *= dr;
      P.vy[i] = P.vy[i] * dr + P.grav[i] * dt;
      P.x[i] += P.vx[i] * dt;
      P.y[i] += P.vy[i] * dt;
      const k = age / P.life[i];
      let e = Math.min(1, age / 0.04) * Math.pow(1 - k, 1.6);
      if (P.tw[i] > 0) e *= 0.55 + 0.45 * Math.sin(P.ph[i] + age * P.tw[i]);
      const o = m * 4;
      pA[o] = P.x[i];
      pA[o + 1] = P.y[i];
      pA[o + 2] = P.vx[i] * SHUTTER;
      pA[o + 3] = P.vy[i] * SHUTTER;
      pB[o] = P.r[i] * e;
      pB[o + 1] = P.g[i] * e;
      pB[o + 2] = P.b[i] * e;
      pB[o + 3] = P.w[i];
      m++;
    }
    R.parts.geo.instanceCount = m;
    R.parts.arrs.iA.attr.needsUpdate = true;
    R.parts.arrs.iB.attr.needsUpdate = true;

    const gA = R.glints.arrs.iA.a;
    const gB = R.glints.arrs.iB.a;
    let q = 0;
    for (let i = 0; i < N_G; i++) {
      const age = clock - G.born[i];
      if (age < 0 || age >= G.dur[i]) continue;
      const o = q * 4;
      gA[o] = G.x[i];
      gA[o + 1] = G.y[i];
      gA[o + 2] = age;
      gA[o + 3] = G.dur[i];
      gB[o] = G.kind[i];
      gB[o + 1] = G.size[i];
      gB[o + 2] = G.k[i];
      gB[o + 3] = scl;
      q++;
    }
    R.glints.geo.instanceCount = q;
    R.glints.arrs.iA.attr.needsUpdate = true;
    R.glints.arrs.iB.attr.needsUpdate = true;
  }

  function writeDOM() {
    for (let i = 0; i < MAX_STARS; i++) {
      const d = dom[i];
      if (!S.live[i]) {
        if (d.shown) {
          d.el.style.opacity = '0';
          d.shown = false;
        }
        continue;
      }
      d.shown = true;
      const tl = Math.min(S.trav[i], S.lmax[i]) * (1 - S.drain[i] * 0.8);
      d.el.style.transform = `translate3d(${S.hx[i].toFixed(1)}px, ${S.hy[i].toFixed(1)}px, 0) rotate(${Math.atan2(S.dy[i], S.dx[i]).toFixed(3)}rad)`;
      d.el.style.opacity = Math.min(1, S.env[i]).toFixed(3);
      d.tail.style.width = tl.toFixed(1) + 'px';
    }
  }

  function update(t, dt) {
    if (!active) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    clock += dt;
    if (R) R.group.visible = true;

    if (state === 'intro' && !reduced) {
      // now and then a star behind the card, so she sees what she is about to catch
      if (clock >= introNext) {
        spawn(2.2, fx() < 0.6 ? 0.1 : 0.7, fx(), fx(), 0.1 + 0.2 * fx(), fx(), false);
        introNext = clock + 2.4 + 1.6 * fx();
      }
    } else if (state === 'play') {
      gameT += dt;
      while (sch.next < sch.n && gameT >= sch.at[sch.next]) {
        const j = sch.next++;
        const r = sch.r;
        spawn(sch.life[j], r[j * 5], r[j * 5 + 1], r[j * 5 + 2], r[j * 5 + 3], r[j * 5 + 4], true);
      }
      setTimer(gameT);
      if (gameT >= seconds) endRound();
    }
    simulate(dt);
  }

  return {
    get active() {
      return active;
    },
    start,
    update,
    // for tests and the harness
    get state() {
      return state;
    },
    get score() {
      return score;
    },
    get time() {
      return gameT;
    },
    get round() {
      return round;
    },
    heads() {
      const out = [];
      for (let i = 0; i < MAX_STARS; i++) {
        if (S.live[i] !== 1 || !S.play[i]) continue;
        const v = S.len[i] / S.life[i];
        out.push({
          id: S.id[i],
          x: S.hx[i],
          y: S.hy[i],
          vx: S.dx[i] * v,
          vy: S.dy[i] * v,
          k: (clock - S.born[i]) / S.life[i],
          catchable: S.env[i] >= 0.12,
        });
      }
      return out;
    },
  };
}
