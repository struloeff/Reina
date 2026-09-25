// The words of act one.
//
// Every line is a pure function of the show clock. From t alone each one knows
// how far it has arrived, how far it has left and where its idle float has
// carried it, so a seek or a frozen screenshot lands on exactly the frame a
// viewer would see. Values are rounded and cached as numbers per element, and a
// style string is built and written only when one of them changes, so a line at
// rest costs nothing and nothing is allocated for it.
//
// #back sits behind the planet. It is masked by the planet's disc (transparent
// inside, opaque just outside, with a soft edge), so its words slide behind the
// limb instead of floating over it. The mask is only applied while a visible
// #back line is actually near the disc; the rest of the time it is 'none', so a
// full-screen mask is not re-rasterised every frame while the planet moves.
//
// The markup is never reworded. At start-up l-lucky is split into word spans,
// "girlfriend" gets a span of its own (so it can glow), and the marker stroke is
// an SVG added inside .strike. Nothing else in the DOM changes.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const seg = (x, a, b) => clamp01((x - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const out2 = (k) => 1 - (1 - k) * (1 - k);
const out3 = (k) => 1 - (1 - k) * (1 - k) * (1 - k);
const inOutSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
const round = (v, p) => Math.round(v * p) / p;
const hash = (i, j) => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A lightly under-damped spring, released from rest: a soft start, the barest
// overshoot (about 2%) and a settle. The small residual left at k = 1 is folded
// back in, so it lands on exactly 1 and a line never snaps at the end.
const SPRING_Z = 0.78;
const SPRING_W = 7.4;
const SPRING_WD = SPRING_W * Math.sqrt(1 - SPRING_Z * SPRING_Z);
const springRaw = (k) => {
  const e = Math.exp(-SPRING_Z * SPRING_W * k);
  return 1 - e * (Math.cos(SPRING_WD * k) + ((SPRING_Z * SPRING_W) / SPRING_WD) * Math.sin(SPRING_WD * k));
};
const SPRING_END = springRaw(1);
const spring = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : springRaw(k) + (1 - SPRING_END) * k * k * k);

// a glide that is already moving when it starts (it starts hidden, so the speed
// is spent there) and comes to rest with no velocity at all, slowing all the way:
// e(0)=0, e'(0)=1.5, e(1)=1, e'(1)=0
const glide = (p) => 1.5 * p - 0.5 * p * p * p;

// a hand drawing a line: gets going fast, carries through, eases as it lifts off
const pen = (k) => 0.3 * smooth(k) + 0.7 * (1 - Math.pow(1 - k, 1.7));

// how long l-only's glide out from behind the globe lasts (the last part of its
// enterDur). Long enough that its middle clears the limb in about half a second.
const EMERGE_GLIDE = 2.05;

// the flare's bloom holds while the screen is still white from the flash, then
// decays onto the gold glow as the sky darkens, so the words outshine it
const FLARE_HOLD = 0.4;
const FLARE_TAU = 0.42;

// Glow parameters are quantised to this many steps. A text-shadow with a large
// blur is re-rasterised on every change (on the CPU, on iOS), so a swell costs a
// few dozen repaints instead of one per frame; 2.5% steps are not visible.
const GLOW_STEPS = 40;
const qGlow = (v) => Math.round(clamp01(v) * GLOW_STEPS) / GLOW_STEPS;

const SVG = 'http://www.w3.org/2000/svg';
let uid = 0; // keeps the svg ids unique even if createLines runs twice

/** a setter that touches the DOM only when the value actually changes */
function writer(el) {
  const last = Object.create(null);
  return (prop, v) => {
    if (last[prop] === v) return;
    last[prop] = v;
    el.style[prop] = v;
  };
}

// ------------------------------------------------------------------ word by word

function splitWords(doc, el) {
  const words = [];
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== 3) continue;
    const frag = doc.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.appendChild(doc.createTextNode(part));
        continue;
      }
      const span = doc.createElement('span');
      span.className = 'w';
      span.textContent = part;
      frag.appendChild(span);
      words.push({ el: span, text: part, delay: 0, o: 1, y: 0, b: 0 });
    }
    node.replaceWith(frag);
  }
  return words;
}

// When each word starts: a steady cascade in reading order, a small breath after
// each comma, and the last phrase ("wonderful person that you are.") landing a
// touch slower. Scaled so the last word has settled exactly at the end of enterDur.
function timeWords(words, enterDur) {
  const wordDur = Math.min(1.25, enterDur * 0.36);
  let lastComma = -1;
  words.forEach((w, i) => {
    if (/,$/.test(w.text)) lastComma = i;
  });
  const gaps = [];
  let total = 0;
  for (let i = 0; i < words.length - 1; i++) {
    let g = 1;
    if (/[,;:]$/.test(words[i].text)) g += 0.55;
    if (i >= lastComma && lastComma >= 0) g += 0.3;
    gaps.push(g);
    total += g;
  }
  const unit = total > 0 ? Math.max(0, enterDur - wordDur) / total : 0;
  let d = 0;
  words.forEach((w, i) => {
    w.delay = d;
    if (i < gaps.length) d += gaps[i] * unit;
  });
  return wordDur;
}

// ------------------------------------------------------------------ the marker strike

const STRIKE_N = 44;

function makeStrike(doc, el, spec) {
  const word = el.querySelector('.strike');
  if (!word) return null;
  const id = ++uid;

  // "girlfriend" gets its own span for the glow, and the two words are kept on
  // one line so the joke is always read in one glance
  let gf = null;
  const next = word.nextSibling;
  if (next && next.nodeType === 3) {
    const m = /^(\s+)(\S+)([\s\S]*)$/.exec(next.textContent);
    if (m) {
      gf = doc.createElement('span');
      gf.className = 'gf';
      gf.textContent = m[2];
      const pair = doc.createElement('span');
      pair.className = 'pair';
      word.replaceWith(pair);
      pair.append(word, doc.createTextNode(m[1]), gf);
      next.textContent = m[3];
    }
  }

  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'strike-ink');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const defs = doc.createElementNS(SVG, 'defs');
  // The reveal: everything left of the pen, plus a disc the size of the stroke
  // at the pen, so the moving front is the round nib of a marker, not a wipe.
  // One clip region (a union), so there is no seam where the two meet.
  const clip = doc.createElementNS(SVG, 'clipPath');
  const clipId = `strike-reveal-${id}`;
  clip.setAttribute('id', clipId);
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const rect = doc.createElementNS(SVG, 'rect');
  rect.setAttribute('x', '-50');
  rect.setAttribute('y', '-50');
  rect.setAttribute('width', '0');
  rect.setAttribute('height', '1000');
  const nib = doc.createElementNS(SVG, 'circle');
  nib.setAttribute('r', '0');
  clip.append(rect, nib);
  // marker ink is densest where the pen lands and thins as it speeds up and lifts
  const grad = doc.createElementNS(SVG, 'linearGradient');
  const gradId = `strike-ink-${id}`;
  grad.setAttribute('id', gradId);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  for (const [o, a] of [[0, 1], [0.1, 0.96], [0.55, 0.9], [1, 0.72]]) {
    const stop = doc.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', String(o));
    stop.setAttribute('stop-opacity', String(a));
    grad.appendChild(stop);
  }
  defs.append(clip, grad);
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('fill', `url(#${gradId})`);
  path.setAttribute('clip-path', `url(#${clipId})`);
  svg.append(defs, path);
  word.appendChild(svg);

  return {
    spec,
    word,
    gf,
    svg,
    path,
    grad,
    rect,
    nib,
    setWord: writer(word),
    setGf: gf ? writer(gf) : null,
    // the centre line and half-width of the stroke, in the svg's own px
    cx: new Float32Array(STRIKE_N + 1),
    cy: new Float32Array(STRIKE_N + 1),
    hw: new Float32Array(STRIKE_N + 1),
    xs: 0,
    xe: 1,
    x0: 0, // where the reveal starts and ends
    x1: 0,
    front: NaN, // cached, so the svg is touched only while the pen moves
    fade: NaN,
    dim: NaN,
    glowK: NaN,
    glowG: NaN,
    seed: id * 7 + 3,
  };
}

let metricsCtx = null;

// The ink: a filled, tapered shape round a wobbling centre line - the blob where
// the pen lands, a slightly rising stroke with a hint of sag and hand tremor, and
// a thin flick where it lifts off. Built in real px for the measured word, so
// nothing is stretched.
function shapeStrike(K, fs, doc) {
  const w = K.word.offsetWidth;
  const h = K.word.offsetHeight;
  if (!w || !h) return;

  // where the middle of the lowercase letters is, from the font's own metrics
  let yMid = h * 0.6;
  try {
    if (!metricsCtx) metricsCtx = doc.createElement('canvas').getContext('2d');
    const c = metricsCtx;
    const cs = doc.defaultView.getComputedStyle(K.word);
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText('xo');
    if (m.fontBoundingBoxAscent && m.actualBoundingBoxAscent) {
      const A = m.fontBoundingBoxAscent;
      const D = m.fontBoundingBoxDescent;
      const baseline = (h - (A + D)) / 2 + A;
      yMid = baseline - m.actualBoundingBoxAscent * 0.5;
    }
  } catch {
    /* keep the estimate */
  }

  const padL = 0.34 * fs;
  const padR = 0.42 * fs;
  const W = w + padL + padR;
  const thick = Math.min(7.5, Math.max(2.8, 0.125 * fs));
  const xs = padL - 0.05 * fs; // starts just before the word (clear of "best"), overshoots a little at the end
  const xe = padL + w + 0.12 * fs;
  const r1 = hash(K.seed, 1) * 6.283;
  const r2 = hash(K.seed, 2) * 6.283;
  const r3 = hash(K.seed, 3) * 6.283;

  const N = STRIKE_N;
  const { cx, cy, hw } = K;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    cx[i] = mix(xs, xe, u);
    cy[i] =
      yMid +
      0.1 * fs * (0.5 - u) + // rises gently to the right
      0.022 * fs * Math.sin(Math.PI * u) + // a little sag, the arm's arc
      0.011 * fs * Math.sin(6.283 * (1.6 * u) + r1) + // tremor
      0.006 * fs * Math.sin(6.283 * (3.7 * u) + r2) -
      0.06 * fs * Math.pow(smooth(seg(u, 0.82, 1)), 2); // the flick as the pen lifts
    const land = 0.66 + 0.34 * smooth(seg(u, 0, 0.08));
    const lift = 1 - 0.84 * Math.pow(smooth(seg(u, 0.7, 1)), 1.25);
    const pressure = 1 + 0.07 * Math.sin(6.283 * (2.2 * u) + r3);
    hw[i] = 0.5 * thick * land * lift * pressure;
  }

  const f = (v) => v.toFixed(2);
  const top = [];
  const bot = [];
  let tx0 = 1;
  let ty0 = 0;
  let tx1 = 1;
  let ty1 = 0;
  for (let i = 0; i <= N; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(N, i + 1);
    let tx = cx[b] - cx[a];
    let ty = cy[b] - cy[a];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    if (i === 0) [tx0, ty0] = [tx, ty];
    if (i === N) [tx1, ty1] = [tx, ty];
    // normal pointing up the screen (y is down)
    const nx = ty;
    const ny = -tx;
    top.push(`${f(cx[i] + nx * hw[i])} ${f(cy[i] + ny * hw[i])}`);
    bot.push(`${f(cx[i] - nx * hw[i])} ${f(cy[i] - ny * hw[i])}`);
  }
  // round caps: the full blob where the pen lands, a tiny one at the flick
  const cap = (px, py, tx, ty, r, from, to) => {
    const pts = [];
    for (let j = 1; j < 6; j++) {
      const th = mix(from, to, j / 6);
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(`${f(px + (tx * c + ty * s) * r)} ${f(py + (ty * c - tx * s) * r)}`);
    }
    return pts;
  };
  const endCap = cap(cx[N], cy[N], tx1, ty1, hw[N], Math.PI / 2, -Math.PI / 2);
  const startCap = cap(cx[0], cy[0], tx0, ty0, hw[0], -Math.PI / 2, -1.5 * Math.PI);
  const d = `M${top.join('L')}L${endCap.join('L')}L${bot.reverse().join('L')}L${startCap.join('L')}Z`;
  K.path.setAttribute('d', d);
  K.grad.setAttribute('x1', f(xs));
  K.grad.setAttribute('x2', f(xe));
  K.grad.setAttribute('y1', '0');
  K.grad.setAttribute('y2', '0');

  K.svg.setAttribute('viewBox', `0 0 ${f(W)} ${f(h)}`);
  K.svg.setAttribute('width', f(W));
  K.svg.setAttribute('height', f(h));
  K.svg.style.left = `${f(-padL)}px`;
  K.xs = xs;
  K.xe = xe;
  K.x0 = xs - hw[0] - 1;
  K.x1 = xe + hw[N] + 1;
  K.front = NaN; // re-place the pen for the new shape
}

// ------------------------------------------------------------------ one line

function makeLine(doc, cue, index) {
  const el = doc.getElementById(cue.id);
  if (!el) return null;
  const L = {
    cue,
    el,
    st: el.style,
    freq: [0, 1, 2, 3, 4].map((j) => 0.85 + 0.3 * hash(index + 1, j + 11)),
    phase: [0, 1, 2, 3, 4].map((j) => hash(index + 1, j) * 6.283),
    fs: 16,
    centre: 0, // its settled centre, in layer px
    cx: 0,
    tw: 0, // the words' own width and height (the box is wider than the words)
    th: 0,
    words: null,
    wordDur: 1,
    strike: null,
    parts: [],
    shown: null,
    inBack: !!el.closest('#back'),
    // the last values written, as numbers
    n: { x: NaN, y: NaN, s: NaN, rx: NaN, ry: NaN, rz: NaN, o: NaN, b: NaN, ls: NaN, wc: null, glow: NaN },
  };
  if (cue.enter === 'words') {
    L.words = splitWords(doc, el);
    L.wordDur = timeWords(L.words, cue.enterDur);
  }
  if (cue.strike) L.strike = makeStrike(doc, el, cue.strike);
  for (const p of cue.parts || []) {
    const pe = el.querySelector(p.sel);
    if (pe) L.parts.push({ p, el: pe, st: pe.style, vis: null, o: NaN, b: NaN });
  }
  return L;
}

// scratch for one line's frame (reused; nothing is allocated per frame)
const S = { o: 1, x: 0, y: 0, s: 1, b: 0, ls: 0, rx: 0, ry: 0, rz: 0, tilt: false };

export function createLines(doc, cues, opts = {}) {
  const win = doc.defaultView || window;
  const back = doc.getElementById('back');
  const lines = cues.map((c, i) => makeLine(doc, c, i)).filter(Boolean);
  const canBalance = !!(win.CSS && CSS.supports && CSS.supports('text-wrap', 'balance'));

  let vh = win.innerHeight || 800;
  let mW = -1;
  let mH = -1;
  let mGcy = NaN;
  let mGr = NaN;
  let dirty = true;
  const markDirty = () => {
    dirty = true;
  };
  win.addEventListener('resize', markDirty);
  win.visualViewport?.addEventListener('resize', markDirty);
  doc.fonts?.ready.then(markDirty);

  // older browsers without text-wrap: balance: find the narrowest width that
  // keeps the same number of lines, which is what balance does
  function balance(el) {
    el.style.maxWidth = '';
    const h0 = el.offsetHeight;
    const lh = parseFloat(win.getComputedStyle(el).lineHeight) || 30;
    if (h0 < lh * 1.5) return;
    let lo = el.clientWidth * 0.4;
    let hi = el.clientWidth;
    while (hi - lo > 2) {
      const mid = (lo + hi) / 2;
      el.style.maxWidth = mid + 'px';
      if (el.offsetHeight > h0) lo = mid;
      else hi = mid;
    }
    el.style.maxWidth = Math.ceil(hi) + 'px';
  }

  function measure() {
    vh = back ? back.clientHeight || win.innerHeight : win.innerHeight;
    const range = doc.createRange();
    for (const L of lines) {
      if (!canBalance) {
        balance(L.el);
        for (const P of L.parts) balance(P.el);
      }
      const cs = win.getComputedStyle(L.el);
      L.fs = parseFloat(cs.fontSize) || 16;
      const anchor = parseFloat(cs.getPropertyValue('--anchor'));
      L.th = L.el.offsetHeight;
      L.centre = L.el.offsetTop + L.th * (0.5 + (isFinite(anchor) ? anchor / 100 : -0.5));
      L.cx = L.el.offsetLeft + L.el.offsetWidth / 2;
      L.tw = L.el.offsetWidth;
      if (L.inBack) {
        // the words' own width, in layout px: the line's transform is lifted for
        // the measurement (a range's rect is transformed), then put back
        const tf = L.st.transform;
        L.st.transform = 'none';
        range.selectNodeContents(L.el);
        const w = range.getBoundingClientRect().width;
        L.st.transform = tf;
        if (w > 0) L.tw = Math.min(L.tw, w);
      }
      if (L.strike) shapeStrike(L.strike, L.fs, doc);
    }
  }

  // --------------------------------------------------------------- the mask
  const edgeOf = (r) => Math.max(6, Math.round(0.015 * r));
  let mOn = false;
  let mX = NaN;
  let mY = NaN;
  let mR = NaN;
  function mask(d) {
    if (!back) return;
    if (!d) {
      if (!mOn) return;
      mOn = false;
      back.style.webkitMaskImage = 'none';
      back.style.maskImage = 'none';
      return;
    }
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    const r = Math.round(d.r);
    if (mOn && x === mX && y === mY && r === mR) return;
    mOn = true;
    mX = x;
    mY = y;
    mR = r;
    const m = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + edgeOf(r)}px)`;
    back.style.webkitMaskImage = m;
    back.style.maskImage = m;
  }

  // is this line (where S has put it this frame, glow included) close enough to
  // the disc that the mask would change a single pixel of it?
  function nearDisc(L, d) {
    const reach = d.r + edgeOf(d.r) + 0.9 * L.fs + 8;
    const dx = Math.max(0, Math.abs(d.x - (L.cx + S.x)) - (L.tw / 2) * S.s);
    const dy = Math.max(0, Math.abs(d.y - (L.centre + S.y)) - (L.th / 2) * S.s);
    return dx * dx + dy * dy < reach * reach;
  }

  // --------------------------------------------------------------- enter / exit / idle

  function rise(k, dist) {
    const m = spring(k);
    S.y = (1 - m) * dist;
    S.s = mix(0.96, 1, m);
    // the blur clears ahead of the opacity, so a line is never a half-visible
    // smear with no letterforms (which read as grey bars on the small body lines)
    S.b = 8 * (1 - out2(seg(k, 0, 0.8)));
    S.o = out2(seg(k, 0.12, 0.7));
  }

  function enter(L, t, env, reduced) {
    const c = L.cue;
    const k = clamp01((t - c.at) / c.enterDur);
    if (reduced) {
      // fades only. l-only fades in at its slot as the globe lifts off it.
      S.o = c.enter === 'emerge' ? inOutSine(seg(k, 0.45, 1)) : inOutSine(k);
      return false;
    }
    switch (c.enter) {
      case 'rise':
        rise(k, 0.05 * vh);
        break;
      case 'lift': {
        // It rises out of the planet: it starts just behind the horizon (the
        // mask hides it) and comes up on a slow start, so it crosses the limb in
        // full view - ends first, where the dome is lower, then the middle - and
        // glides on to its place above. Hidden means below the horizon where it
        // is lowest under the words, i.e. at their ends; the box's own leading
        // keeps the ink a few px lower still.
        const d = env.earthDisc;
        let dist = 0.18 * vh;
        if (d) {
          const hw = Math.min(d.r, L.tw / 2);
          const horizon = d.y - Math.sqrt(d.r * d.r - hw * hw);
          const behind = horizon - 0.12 * L.fs - (L.centre - L.th / 2);
          if (behind > 0) dist = clamp(behind, 0.12 * vh, 0.32 * vh);
        }
        const e = smooth(k);
        S.y = (1 - e) * dist;
        S.s = mix(0.97, 1, e);
        S.b = 3.5 * (1 - out2(seg(k, 0, 0.7))); // light, so the words read as they come over the limb
        S.o = smooth(seg(k, 0, d ? 0.16 : 0.6));
        break;
      }
      case 'emerge': {
        // From behind the globe: the line waits, invisible, at the deepest point
        // behind the settled disc where even its corners are still covered, then
        // glides down and out under the lower limb to its slot. Everything is in
        // the globe's own frame (offset and scale follow the live disc), so the
        // planet covers it until it is out; the mask does the revealing and the
        // line itself is already at full opacity. The glide is the last
        // EMERGE_GLIDE seconds of enterDur, starting as the globe settles.
        const g = env.globe;
        const d = env.earthDisc;
        if (!d || !g || !(g.r > 0)) {
          rise(k, 0.05 * vh); // no planet (no WebGL): nothing to come out from behind
          return k < 1;
        }
        const G = Math.min(EMERGE_GLIDE, c.enterDur);
        const p = clamp01((t - (c.at + c.enterDur - G)) / G);
        const cSlot = L.centre - g.cy; // its centre below the globe's, at rest
        // (its opacity is still 0 here, so a tight fit is enough)
        const halfW = L.tw / 2 + 2;
        const inner = g.r - 3;
        // Where even its corners are covered. A line wider than the globe (a
        // laptop, a phone on its side) can never be hidden whole, so it need not
        // start deeper than one radius above its slot: its ends show either way.
        const hidden = Math.sqrt(Math.max(0, inner * inner - halfW * halfW)) - L.th / 2;
        const c0 = Math.min(cSlot, Math.max(0, hidden, cSlot - g.r));
        const e = glide(p);
        S.y = d.y + mix(c0, cSlot, e) * (d.r / g.r) - L.centre;
        S.x = d.x - g.cx;
        S.s = mix(0.96, 1, e);
        // soft while it is behind, sharpening as it comes out (its ends, peeking
        // round the limb first, should read as letters, not smudges)
        S.b = 2.4 * (1 - smooth(seg(p, 0.02, 0.8)));
        S.o = smooth(seg(p, 0, 0.2));
        return p > 0 && p < 1;
      }
      case 'focus': {
        S.s = mix(0.9, 1, out3(k));
        S.b = 6 * (1 - out2(seg(k, 0, 0.82)));
        S.ls = 0.04 * (1 - out3(k));
        S.o = smooth(seg(k, 0, 0.5));
        break;
      }
      case 'flare': {
        // born in the flash: over-bright and a touch large, settling to gold
        const since = t - c.at;
        S.o = out3(seg(since, 0, c.enterDur));
        S.s = 1 + 0.035 * Math.exp(-since / 0.5);
        S.b = 3 * (1 - out2(seg(since, 0, 0.45)));
        return since < 1.8;
      }
      case 'words':
        S.o = 1; // the words carry their own opacity
        return false;
      default: // 'fade'
        S.o = inOutSine(k);
    }
    return k < 1;
  }

  function exit(L, t, reduced) {
    const c = L.cue;
    const k = clamp01((t - c.until) / Math.max(1e-3, c.exitDur));
    if (k <= 0) return false;
    if (reduced) {
      S.o *= 1 - inOutSine(k);
      return false;
    }
    if (c.exit === 'sink') {
      // it drifts down while the rising globe comes up over it; the fade is held
      // back so that it is the planet, not the fade, that takes it
      S.o *= 1 - smooth(seg(k, 0.55, 1));
      S.y += 0.06 * vh * inOutSine(k);
      S.b += 2.2 * k;
    } else {
      S.o *= 1 - inOutSine(k);
      S.b += 2.2 * k * k;
    }
    return true;
  }

  function idle(L, t) {
    const f = L.freq;
    const ph = L.phase;
    if (L.cue.idle === 'drift') {
      S.x += 2.4 * Math.sin(t * 0.61 * f[0] + ph[0]) + 1.0 * Math.sin(t * 1.37 * f[1] + ph[1]);
      S.y += 3.2 * Math.sin(t * 0.47 * f[2] + ph[2]) + 1.1 * Math.sin(t * 1.13 * f[3] + ph[3]);
      S.rz += 0.2 * Math.sin(t * 0.37 * f[4] + ph[4]);
    } else if (L.cue.idle === 'orbit') {
      const w = t * 0.5 * f[0] + ph[0];
      S.x += 5 * Math.sin(w);
      S.y += 3 * Math.cos(w);
      S.rx += 2.6 * Math.sin(t * 0.41 * f[1] + ph[1]);
      S.ry += 3.4 * Math.cos(t * 0.33 * f[2] + ph[2]);
      S.rz += 0.22 * Math.sin(t * 0.29 * f[3] + ph[3]);
      S.tilt = true;
    }
  }

  // write S to the line: numbers are compared first, strings built only on change
  function apply(L, animating) {
    const n = L.n;
    const st = L.st;
    const x = round(S.x, 10);
    const y = round(S.y, 10);
    const s = Math.abs(S.s - 1) > 2e-4 ? round(S.s, 5000) : 1;
    const rz = round(S.rz, 1000);
    const rx = S.tilt ? round(S.rx, 100) : 0;
    const ry = S.tilt ? round(S.ry, 100) : 0;
    if (x !== n.x || y !== n.y || s !== n.s || rz !== n.rz || rx !== n.rx || ry !== n.ry) {
      n.x = x;
      n.y = y;
      n.s = s;
      n.rz = rz;
      n.rx = rx;
      n.ry = ry;
      let tf = `translateY(var(--anchor)) translate3d(${x}px,${y}px,0)`;
      if (rx || ry) tf += ` perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      if (rz) tf += ` rotate(${rz}deg)`;
      if (s !== 1) tf += ` scale(${s})`;
      st.transform = tf;
    }
    const o = S.o >= 0.999 ? 1 : S.o <= 0 ? 0 : round(S.o, 1000);
    if (o !== n.o) {
      n.o = o;
      st.opacity = String(o);
    }
    const b = S.b < 0.04 ? 0 : round(S.b, 20);
    if (b !== n.b) {
      n.b = b;
      st.filter = b ? `blur(${b}px)` : '';
    }
    const ls = S.ls < 5e-4 ? 0 : round(S.ls, 10000);
    if (ls !== n.ls) {
      n.ls = ls;
      st.letterSpacing = ls ? `${ls}em` : '';
    }
    if (animating !== n.wc) {
      n.wc = animating;
      st.willChange = animating ? 'transform, opacity, filter' : '';
    }
  }

  // --------------------------------------------------------------- the special parts

  function words(L, t, reduced) {
    const at = L.cue.at;
    for (const w of L.words) {
      let o = 1;
      let y = 0;
      let b = 0;
      if (!reduced) {
        const k = clamp01((t - at - w.delay) / L.wordDur);
        if (k < 1) {
          o = out2(seg(k, 0, 0.6));
          o = o >= 0.999 ? 1 : round(o, 1000);
          y = (1 - spring(k)) * 0.42 * L.fs;
          y = Math.abs(y) < 0.05 ? 0 : round(y, 10);
          b = 5 * (1 - out2(seg(k, 0, 0.85)));
          b = b < 0.04 ? 0 : round(b, 20);
        }
      }
      const s = w.el.style;
      if (o !== w.o) {
        w.o = o;
        s.opacity = o === 1 ? '' : String(o);
      }
      if (y !== w.y) {
        w.y = y;
        s.transform = y ? `translate3d(0,${y}px,0)` : '';
      }
      if (b !== w.b) {
        w.b = b;
        s.filter = b ? `blur(${b}px)` : '';
      }
    }
  }

  function strike(L, t, reduced) {
    const K = L.strike;
    const { at, dur } = K.spec;
    const k = clamp01((t - at) / dur);

    // the pen: the reveal runs left to right, its front a disc the width of the ink there
    let front;
    let fade = 1;
    if (reduced) {
      front = K.x1 + 10;
      fade = k >= 1 ? 1 : round(inOutSine(k), 1000);
    } else {
      front = k <= 0 ? -60 : k >= 1 ? K.x1 + 10 : round(K.x0 + pen(k) * (K.x1 - K.x0), 10);
    }
    if (front !== K.front) {
      K.front = front;
      K.rect.setAttribute('width', String(Math.max(0, front + 50)));
      if (!reduced && k > 0 && k < 1) {
        const u = clamp01((front - K.xs) / (K.xe - K.xs)) * STRIKE_N;
        const i = Math.min(STRIKE_N - 1, Math.floor(u));
        const fr = u - i;
        const cy = mix(K.cy[i], K.cy[i + 1], fr);
        const hw = mix(K.hw[i], K.hw[i + 1], fr);
        K.nib.setAttribute('cx', String(front));
        K.nib.setAttribute('cy', String(round(cy, 10)));
        K.nib.setAttribute('r', String(round(hw * 1.12 + 0.35, 100)));
      } else {
        K.nib.setAttribute('r', '0');
      }
    }
    if (fade !== K.fade) {
      K.fade = fade;
      K.svg.style.opacity = fade === 1 ? '' : String(fade);
    }

    // then "friend" steps back and "girlfriend" warms up
    const kd = qGlow(smooth(seg(t, at + dur * 0.5, at + dur + 0.7)));
    if (kd !== K.dim) {
      K.dim = kd;
      if (kd <= 0) {
        K.setWord('color', '');
        K.setWord('textShadow', '');
      } else {
        K.setWord('color', `rgba(255,244,227,${round(1 - 0.5 * kd, 1000)})`);
        K.setWord(
          'textShadow',
          kd >= 1
            ? 'none'
            : `0 0 10px rgba(255,236,204,${round(0.44 * (1 - kd), 1000)}),0 0 30px rgba(255,206,142,${round(0.16 * (1 - kd), 1000)})`,
        );
      }
    }
    if (!K.setGf) return;
    const s0 = at + dur * 0.7;
    const kg = qGlow(smooth(seg(t, s0, s0 + 1.1)));
    const g = kg + qGlow(Math.sin(Math.PI * seg(t, s0, s0 + 1.8))) * 0.4; // a swell that settles
    if (kg === K.glowK && g === K.glowG) return;
    K.glowK = kg;
    K.glowG = g;
    if (kg <= 0) {
      K.setGf('color', '');
      K.setGf('textShadow', '');
      return;
    }
    K.setGf('color', `rgb(255,${Math.round(mix(244, 247, kg))},${Math.round(mix(227, 236, kg))})`);
    K.setGf(
      'textShadow',
      `0 0 ${round(mix(1, 3, g), 10)}px rgba(255,244,228,${round(0.45 * g, 1000)}),` +
        `0 0 ${round(mix(10, 12, g), 10)}px rgba(255,${Math.round(mix(236, 222, kg))},${Math.round(mix(204, 196, kg))},${round(mix(0.44, 0.72, g), 1000)}),` +
        `0 0 ${round(mix(30, 34, g), 10)}px rgba(255,${Math.round(mix(206, 178, kg))},${Math.round(mix(142, 168, kg))},${round(mix(0.16, 0.3, g), 1000)})`,
    );
  }

  // The over-bright bloom of the flare. It holds while the screen is still white
  // from the flash and then decays as the sky darkens, so for a moment the words
  // clearly outshine what is behind them, and it lands on exactly the CSS gold
  // glow (.line--gold). The bloom is cream, never amber: a glow darker than the
  // white-out behind it would print as a tan box around the words.
  const cr = (a, b, g) => Math.round(mix(a, b, g));
  function flareGlow(L, t, reduced) {
    const since = t - L.cue.at;
    const g = reduced ? 0 : qGlow(since < FLARE_HOLD ? 1 : Math.exp(-(since - FLARE_HOLD) / FLARE_TAU));
    if (g === L.n.glow) return;
    L.n.glow = g;
    if (g <= 0) {
      L.st.color = '';
      L.st.textShadow = '';
      return;
    }
    L.st.color = `rgb(255,${cr(244, 255, g)},${cr(227, 252, g)})`;
    L.st.textShadow =
      `0 0 ${round(mix(1, 4, g), 10)}px rgba(255,255,255,${round(0.9 * g, 1000)}),` +
      `0 0 ${round(mix(10, 20, g), 10)}px rgba(255,${cr(236, 250, g)},${cr(204, 238, g)},${round(mix(0.44, 0.95, g), 1000)}),` +
      `0 0 ${round(mix(30, 80, g), 10)}px rgba(255,${cr(206, 244, g)},${cr(142, 225, g)},${round(mix(0.16, 0.6, g), 1000)})`;
  }

  function parts(L, t, reduced) {
    for (const P of L.parts) {
      const on = t >= P.p.at;
      const k = on ? clamp01((t - P.p.at) / Math.max(1e-3, P.p.enterDur || 1)) : 0;
      const o = !on ? 0 : k >= 1 ? 1 : round(inOutSine(k), 1000);
      const b = reduced || !on || k >= 1 ? 0 : round(2 * (1 - out2(k)), 20);
      if (on !== P.vis) {
        P.vis = on;
        P.st.visibility = on ? 'visible' : 'hidden';
      }
      if (o !== P.o) {
        P.o = o;
        P.st.opacity = String(o);
      }
      if (b !== P.b) {
        P.b = b;
        P.st.filter = b ? `blur(${b}px)` : '';
      }
    }
  }

  function hide(L) {
    if (L.shown === false) return;
    L.shown = false;
    const n = L.n;
    L.st.visibility = 'hidden';
    L.st.opacity = '0';
    L.st.filter = '';
    L.st.willChange = '';
    n.o = 0;
    n.b = 0;
    n.wc = false;
    for (const P of L.parts) {
      P.vis = false;
      P.st.visibility = 'hidden';
    }
  }

  // --------------------------------------------------------------- the frame

  return {
    update(t, dt, env = {}) {
      const reduced = env.reducedMotion ?? !!opts.reducedMotion;
      const g = env.globe;
      const W = win.innerWidth;
      const H = win.innerHeight;
      const gcy = g ? g.cy : -1;
      const gr = g ? g.r : -1;
      if (dirty || W !== mW || H !== mH || gcy !== mGcy || gr !== mGr) {
        dirty = false;
        mW = W;
        mH = H;
        mGcy = gcy;
        mGr = gr;
        measure();
      }
      const d = env.earthDisc || null;
      let near = false;

      for (const L of lines) {
        const c = L.cue;
        if (t < c.at || t >= c.until + c.exitDur) {
          hide(L);
          continue;
        }
        if (L.shown !== true) {
          L.shown = true;
          L.st.visibility = 'visible';
        }
        S.o = 1;
        S.x = S.y = S.b = S.ls = S.rx = S.ry = S.rz = 0;
        S.s = 1;
        S.tilt = false;
        const entering = enter(L, t, env, reduced);
        const leaving = exit(L, t, reduced);
        if (!reduced) idle(L, t);
        // the mask is needed only while a visible line behind the planet is near it
        if (L.inBack && d && !near && S.o > 0.002 && nearDisc(L, d)) near = true;

        apply(L, (entering || leaving) && !reduced);
        if (L.words) words(L, t, reduced);
        if (L.strike) strike(L, t, reduced);
        if (c.enter === 'flare') flareGlow(L, t, reduced);
        if (L.parts.length) parts(L, t, reduced);
      }
      mask(near ? d : null);
    },
  };
}
