// Act two: a quiz she can't fail, a teacher's red pen grading it, and the
// letter that 100% unlocks.
//
// Unlike act one this is driven by her taps, not by t. It sits transparent over
// the live sky and talks to the director through two hooks: onStep(name) as it
// enters 'quiz', 'grade' and 'letter' (the sky changes mood), and
// celebrate(x, y, count) at the 100% moment (hearts burst from the score).
//
// Every visible word comes from `content` (window.REINA). The only characters
// made up here are the numerals and the "%" of the score.

import { rememberLetter } from './resume.js';

const NS = 'http://www.w3.org/2000/svg';

// the pacing, in ms. Slow enough to feel handmade, quick enough to never wait on
const MS = {
  ask: 1200, // the question area follows the intro
  next: 820, // a right answer glows this long before its question lifts away
  swap: 200, // the next question starts arriving while the last one leaves
  arm: 400, // a question that just arrived ignores taps this long: the right answer
  // to one question sits where the next one's right answer lands, so a second tap
  // meant for the old one must not answer the new one before she has read it
  last: 1350, // the fourth answer is savoured a little longer
  slipIn: 750, // the slip settles before the pen starts
  check: 360, // one red check
  checkGap: 240, // the pen lifts and moves to the next row
  loop: 820, // the circle round 100%
  hold: 2700, // "passed <3" holds before the letter (long enough for the heart burst to clear)
  para: 800, // letter paragraphs, one after another
  paraCatchUp: 320, // ...and faster when she has scrolled ahead of them
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOutSine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the score is measured, so its face must have arrived first (on a preview that
// starts at the grading, nothing has asked for it yet)
const scoreFont = () =>
  Promise.race([
    document.fonts?.load?.('italic 400 80px "Instrument Serif"') ?? Promise.resolve(),
    sleep(2500),
  ]).catch(() => {});

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function s(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// k runs 0..1 over `ms` on animation frames, so it pauses with the page
function tween(ms, fn, ease = easeOut) {
  return new Promise((done) => {
    if (ms <= 0) {
      fn(1);
      done();
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const k = clamp01((now - t0) / ms);
      fn(ease(k));
      if (k < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
}

// seeded, so every pen stroke is the same shape on every visit
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ the pen
// A pen stroke with pressure. An SVG stroke has one width, so instead the
// centreline is offset by half the local width to either side and filled; that
// lets it swell and taper like ink. Drawing it in is just building the outline
// for the first k of its length, with a round nib at the leading edge.
function ink(pts, widths) {
  const n = pts.length;
  const cum = new Float64Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    tx[i] = (b[0] - a[0]) / l;
    ty[i] = (b[1] - a[1]) / l;
  }
  const total = cum[n - 1];
  const f = (v) => Math.round(v * 100) / 100;

  function d(k) {
    if (k <= 0) return '';
    const L = Math.min(1, k) * total;
    let m = 0;
    while (m < n - 1 && cum[m + 1] <= L) m++;
    const xs = [];
    const ys = [];
    const ws = [];
    const us = [];
    const vs = [];
    for (let i = 0; i <= m; i++) {
      xs.push(pts[i][0]);
      ys.push(pts[i][1]);
      ws.push(widths[i]);
      us.push(tx[i]);
      vs.push(ty[i]);
    }
    if (m < n - 1) {
      const q = (L - cum[m]) / (cum[m + 1] - cum[m] || 1);
      if (q > 0.01) {
        xs.push(pts[m][0] + (pts[m + 1][0] - pts[m][0]) * q);
        ys.push(pts[m][1] + (pts[m + 1][1] - pts[m][1]) * q);
        ws.push(widths[m] + (widths[m + 1] - widths[m]) * q);
        us.push(tx[m]);
        vs.push(ty[m]);
      }
    }
    const c = xs.length;
    const left = [];
    const right = [];
    for (let i = 0; i < c; i++) {
      const r = ws[i] / 2;
      left.push(f(xs[i] - vs[i] * r) + ' ' + f(ys[i] + us[i] * r));
      right.push(f(xs[i] + vs[i] * r) + ' ' + f(ys[i] - us[i] * r));
    }
    // round nibs at both ends: from one side, round the end, to the other
    const cap = (i, dir) => {
      const out = [];
      const r = ws[i] / 2;
      for (let j = 1; j < 6; j++) {
        const a = (j / 6) * Math.PI;
        const nx = -vs[i] * Math.cos(a) + us[i] * dir * Math.sin(a);
        const ny = us[i] * Math.cos(a) + vs[i] * dir * Math.sin(a);
        out.push(f(xs[i] + nx * r) + ' ' + f(ys[i] + ny * r));
      }
      return out;
    };
    const tip = cap(c - 1, 1);
    const tail = cap(0, -1).reverse();
    return 'M' + left.concat(tip, right.reverse(), tail).join('L') + 'Z';
  }
  return { total, d };
}

function quad(p0, c, p1, step) {
  const len = (Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]) + Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) / 2;
  const n = Math.max(4, Math.ceil(len / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const e = t * t;
    out.push([a * p0[0] + b * c[0] + e * p1[0], a * p0[1] + b * c[1] + e * p1[1]]);
  }
  return out;
}

function arcFractions(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

// A teacher's check, in a 30 x 26 box: a short stroke down into the turn, then
// a long one flicked up and away, heaviest at the turn and thinning to nothing.
function checkShape(seed, weight) {
  const r = rng(seed);
  const j = (a) => (r() * 2 - 1) * a;
  const A = [3 + j(1.2), 13 + j(1.6)];
  const B = [11.2 + j(0.9), 23.4 + j(0.7)];
  const C = [28.6 + j(0.9), 2.2 + j(1.4)];
  const c1 = [5.4 + j(0.8), 19.6 + j(1)];
  const c2 = [16.8 + j(1.2), 11.4 + j(1.4)];
  const first = quad(A, c1, B, 0.5);
  const pts = first.concat(quad(B, c2, C, 0.5).slice(1));
  const rot = j(0.13);
  const sc = 1 + j(0.08);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  for (const p of pts) {
    const x = (p[0] - 15) * sc;
    const y = (p[1] - 13) * sc;
    p[0] = 15 + x * cs - y * sn;
    p[1] = 13 + x * sn + y * cs;
  }
  const u = arcFractions(pts);
  const turn = u[first.length - 1];
  const widths = u.map((v, i) => {
    const w = v < turn ? 0.5 + 0.62 * smooth(0, turn * 0.85, v) : 1.12 - 0.92 * Math.pow(smooth(turn, 1, v), 0.85);
    return weight * w * (1 + 0.05 * Math.sin(i * 0.9 + seed));
  });
  return ink(pts, widths);
}

// The loop round the score: an oval a little bigger than the number, begun
// above the "%" and drawn anticlockwise, once round and a bit more, so the end
// overshoots its start on a slightly wider path, the way a pen really does.
// It leans with the italic, and it is checked against the two corners where
// the ink reaches furthest (the top of the "%", the foot of the "1") and grown
// until it clears both, so the pen never touches a glyph.
const SLANT = 0.19; // Instrument Serif italic leans about 11 degrees

function loopShape(seed, w, h, weight) {
  const r = rng(seed);
  const turns = 1.17;
  const a0 = -0.8;
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const p3 = r() * 6.28;
  const k = h / 50; // the drift of the overshoot scales with the number
  const hh = h / 2;
  // the ink fills a leaning parallelogram, not its bounding box
  const hw = Math.max(hh, w / 2 - SLANT * hh);
  const corners = [
    [w / 2, -hh],
    [-w / 2, hh],
  ];
  const clear = Math.max(5, h * 0.12) + weight / 2;

  const build = (rx, ry) => {
    const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = Math.ceil((per * turns) / 1.2);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const a = a0 - u * turns * Math.PI * 2;
      // slow irregularities (an egg, a flat side), and a slight spiral outward
      // so the last stretch passes outside the first instead of retracing it
      const wob = 1 + 0.03 * Math.sin(a + p3) + 0.026 * Math.sin(2 * a + p1) + 0.012 * Math.sin(3 * a + p2) + 0.1 * smooth(0.5, 1, u);
      const x = Math.cos(a) * rx * wob + 4 * k * u;
      const y = Math.sin(a) * ry * wob - 3 * k * u;
      pts.push([x - SLANT * y, y]); // lean with the italic
    }
    return pts;
  };
  // how far the pen passes from a corner, or -1 if the corner is outside it
  const clearance = (pts, c) => {
    let best = Infinity;
    let wind = 0;
    let prev = Math.atan2(pts[0][1] - c[1], pts[0][0] - c[0]);
    for (const p of pts) {
      best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1]));
      const a = Math.atan2(p[1] - c[1], p[0] - c[0]);
      let d = a - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      wind += d;
      prev = a;
    }
    return Math.abs(wind) > 1.8 * Math.PI ? best : -1;
  };

  let rx = hw + Math.max(16, h * 0.34);
  let ry = hh + Math.max(12, h * 0.34);
  let pts = build(rx, ry);
  for (let tries = 0; tries < 30; tries++) {
    if (Math.min(...corners.map((c) => clearance(pts, c))) >= clear) break;
    rx *= 1.015;
    ry *= 1.015;
    pts = build(rx, ry);
  }

  // a pen presses harder pulling down and to the left, lighter pushing up
  const n = pts.length;
  const widths = pts.map((p, i) => {
    const u = i / (n - 1);
    const q = pts[Math.min(n - 1, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const dl = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;
    const pull = ((q[0] - o[0]) * -0.5 + (q[1] - o[1]) * 0.87) / dl;
    const press = 1 + 0.28 * pull;
    return weight * press * (0.4 + 0.6 * smooth(0, 0.07, u)) * (1 - 0.8 * smooth(0.78, 1, u)) * (1 + 0.06 * Math.sin(u * 19 + p1));
  });
  let ex = 0;
  let ey = 0;
  for (const p of pts) {
    ex = Math.max(ex, Math.abs(p[0]));
    ey = Math.max(ey, Math.abs(p[1]));
  }
  return { ...ink(pts, widths), ex, ey };
}

// ------------------------------------------------------------------ act two
export function createAct2(root, content = {}, hooks = {}) {
  const quiz = content.quiz || {};
  const letter = content.letter || {};
  const questions = (quiz.questions || []).filter((q) => q && Array.isArray(q.options) && q.options.length);
  const wrongLines = (quiz.wrong || []).filter(Boolean);
  const reduced =
    !!hooks.reducedMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const step = (name) => {
    root.dataset.step = name;
    hooks.onStep?.(name);
  };
  const firstRight = (q) => (q.options.find((o) => o.correct) || q.options[0]).text;

  // focus follows the questions only for someone using a keyboard; on a phone
  // a programmatic focus would just flash rings nobody asked for
  let keyboard = false;
  addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) keyboard = true;
  }, true);
  addEventListener('pointerdown', () => (keyboard = false), true);

  // ---------------------------------------------------------------- quiz
  async function runQuiz() {
    step('quiz');
    const scene = h('div', 'a2-scene a2-quiz');
    const intro = h('p', 'a2-intro', quiz.intro || '');
    const area = h('div', 'a2-qarea');
    const dots = h('ol', 'a2-dots');
    dots.setAttribute('aria-hidden', 'true');
    const dotEls = questions.map(() => dots.appendChild(h('li', 'a2-dot')));
    const qstage = h('div', 'a2-qstage');
    const reply = h('p', 'a2-reply');
    reply.setAttribute('aria-live', 'polite');
    area.append(dots, qstage, reply);
    scene.append(intro, area);
    root.append(scene);

    void scene.offsetWidth;
    scene.classList.add('is-on', 'is-intro');
    await sleep(reduced ? 700 : MS.ask);
    scene.classList.add('is-asking');

    let lastWrong = -1;
    const say = (text) => {
      // the same line again (a button tapped twice): a small nod, not a re-entrance
      const shown = [...reply.children].find((c) => !c.classList.contains('is-out'));
      if (text && shown && shown.textContent === text) {
        if (!reduced) shown.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
        return;
      }
      for (const old of reply.children) {
        old.classList.add('is-out');
        setTimeout(() => old.remove(), 320);
      }
      if (text) reply.append(h('span', 'a2-reply-line', text));
    };

    // The secret (content.minigame): enough taps on an option marked `secret`
    // and act two asks the director for it with hooks.secret(back). The quiz
    // steps aside while it runs and comes back, unanswered, when back() is called.
    let current = null;
    let away = false;
    let armUntil = 0;
    const arm = () => (armUntil = performance.now() + MS.arm);
    const armed = () => performance.now() >= armUntil;
    const secretTaps = typeof hooks.secret === 'function' && content.minigame ? Math.max(1, Math.round(+content.minigame.taps || 10)) : 0;
    const openSecret = () => {
      if (away) return;
      away = true;
      say('');
      scene.classList.add('is-away');
      scene.inert = true;
      let returned = false;
      const back = () => {
        if (returned) return;
        returned = true;
        away = false;
        arm(); // the options fade back in under the game's last card
        scene.inert = false;
        scene.classList.remove('is-away');
        if (keyboard) current?.querySelector('button')?.focus({ preventScroll: true });
      };
      setTimeout(() => {
        try {
          hooks.secret(back);
        } catch (err) {
          console.error('[act2]', err);
          back();
        }
      }, reduced ? 0 : 380);
    };

    const answers = [];
    const randomWrong = () => {
      // never the same random line twice in a row
      if (!wrongLines.length) return '';
      let k = Math.floor(Math.random() * wrongLines.length);
      if (wrongLines.length > 1 && k === lastWrong) k = (k + 1 + Math.floor(Math.random() * (wrongLines.length - 1))) % wrongLines.length;
      lastWrong = k;
      return wrongLines[k];
    };
    for (let i = 0; i < questions.length; i++) {
      root.dataset.q = String(i);
      dotEls[i].classList.add('is-now');
      const { el, done } = ask(questions[i], i, dotEls[i], { say, randomWrong, secretTaps, openSecret, armed });
      if (current) {
        const leaving = current;
        leaving.classList.add('is-after');
        leaving.setAttribute('aria-hidden', 'true');
        setTimeout(() => leaving.remove(), 620);
        await sleep(MS.swap);
      }
      // the first one too: the question area only moves, its parts fade themselves
      el.classList.add('is-before');
      qstage.append(el);
      void el.offsetWidth;
      el.classList.remove('is-before');
      el.classList.add('is-current');
      arm();
      if (keyboard) el.querySelector('button')?.focus({ preventScroll: true });
      current = el;
      answers.push(await done);
      dotEls[i].classList.remove('is-now');
      say('');
      if (i === questions.length - 1) await sleep(MS.last - MS.next);
    }

    scene.classList.add('is-leaving');
    await sleep(reduced ? 500 : 560);
    runGrade(answers);
    setTimeout(() => scene.remove(), 1400);
  }

  // one question: resolves with the right answer she chose, once it has glowed
  function ask(q, index, dot, { say, randomWrong, secretTaps, openSecret, armed = () => true }) {
    const el = h('div', 'a2-q');
    const title = h('h2', 'a2-ask', q.ask || '');
    title.id = `a2-ask-${index}`;
    const opts = h('div', 'a2-opts');
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-labelledby', title.id);
    opts.dataset.n = String(q.options.length); // a phone on its side puts four in one row (act2.css)
    el.append(title, opts);

    const anyRight = q.options.some((o) => o.correct);
    // every option right (all "Reina"): any tap lights them all; a question
    // with no right answer marked can't be failed either
    const allRight = !anyRight || q.options.every((o) => o.correct);
    let done = false;
    let resolve;
    const result = new Promise((r) => (resolve = r));

    const buttons = q.options.map((o, j) => {
      const b = h('button', 'a2-opt');
      b.type = 'button';
      const label = h('span', 'a2-opt-label', o.text ?? '');
      b.append(label);
      let taps = 0;
      b.addEventListener('click', () => {
        if (done || !armed()) return;
        if (o.correct || !anyRight) {
          done = true;
          right(j, o.text);
        } else if (o.secret && secretTaps && ++taps >= secretTaps) {
          taps = 0;
          found(b);
        } else {
          wrong(b, o);
        }
      });
      opts.append(b);
      return b;
    });

    // the tap that finds the secret: no shake this time, a brief warm glint
    function found(b) {
      if (!reduced)
        b.animate(
          [
            { boxShadow: '0 0 0 1px rgba(255, 226, 168, 0)', offset: 0 },
            { boxShadow: '0 0 0 1px rgba(255, 226, 168, 0.5), 0 0 26px rgba(255, 214, 150, 0.45)', offset: 0.3 },
            { boxShadow: '0 0 0 1px rgba(255, 226, 168, 0), 0 0 40px rgba(255, 214, 150, 0)' },
          ],
          { duration: 700, easing: 'ease-out' },
        );
      openSecret();
    }

    function wrong(b, o) {
      b.classList.add('is-wrong');
      if (reduced) b.animate([{ opacity: 0.25 }, { opacity: 0.5 }], { duration: 360, easing: 'ease-out' });
      else
        b.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-7px)', offset: 0.14 },
            { transform: 'translateX(6px)', offset: 0.32 },
            { transform: 'translateX(-4px)', offset: 0.5 },
            { transform: 'translateX(2.5px)', offset: 0.68 },
            { transform: 'translateX(-1px)', offset: 0.84 },
            { transform: 'translateX(0)' },
          ],
          { duration: 480, easing: 'ease-out' },
        );
      say(o.say || randomWrong());
    }

    function right(j, text) {
      // 2x2, or one row on a phone on its side: read it off the layout
      const cols = Math.max(1, getComputedStyle(opts).gridTemplateColumns.split(' ').filter(Boolean).length);
      say('');
      const lit = allRight ? buttons : [buttons[j]];
      for (const b of buttons) {
        b.setAttribute('aria-disabled', 'true');
        if (!lit.includes(b)) b.classList.add('is-quiet');
      }
      // all four: the one she touched first, the rest a breath later, outward
      lit.forEach((b) => {
        const k = buttons.indexOf(b);
        const dist = Math.abs((k % cols) - (j % cols)) + Math.abs(Math.floor(k / cols) - Math.floor(j / cols));
        setTimeout(() => {
          b.classList.remove('is-wrong');
          b.classList.add('is-right');
          const tick = s('svg', { class: 'a2-tick', viewBox: '0 0 30 26', 'aria-hidden': 'true' });
          const path = s('path');
          tick.append(path);
          b.querySelector('.a2-opt-label').append(tick);
          const shape = checkShape(11 + index * 7 + k, 2.6);
          tween(reduced ? 0 : 340, (e) => path.setAttribute('d', shape.d(e)), easeInOutSine);
        }, reduced ? 0 : dist * 80);
      });
      dot.classList.add('is-lit');
      setTimeout(() => resolve(text), MS.next + (allRight && buttons.length > 1 ? 160 : 0));
    }

    return { el, done: result };
  }

  // --------------------------------------------------------------- grading
  async function runGrade(answers) {
    step('grade');
    await scoreFont();
    const scene = h('div', 'a2-scene a2-grade');
    const slip = h('div', 'a2-slip');
    const score = h('div', 'a2-score');
    const val = h('span', 'a2-score-val');
    const num = h('span', 'a2-num', '100');
    const pct = h('span', 'a2-pct', '%');
    val.append(num, pct);
    score.append(val);
    const rows = h('ol', 'a2-rows');
    const marks = questions.map((q, i) => {
      const li = h('li', 'a2-row');
      const mark = s('svg', { class: 'a2-mark', viewBox: '0 0 30 26', 'aria-hidden': 'true' });
      const path = s('path');
      mark.append(path);
      const question = h('p', 'a2-row-q');
      question.append(h('span', 'a2-row-n', String(i + 1)), document.createTextNode(q.ask || ''));
      const answer = h('p', 'a2-row-a', answers[i] ?? firstRight(q));
      li.append(mark, question, answer);
      rows.append(li);
      return { li, path, shape: checkShape(101 + i * 13, 2.2) };
    });
    const opened = h('p', 'a2-opened', quiz.opened || '');
    slip.append(score, rows);
    scene.append(slip, opened);
    root.append(scene);

    // the number sits in a box as wide as "100", so counting up never wobbles
    // the layout; the em unit keeps that true if the text size changes
    const fontPx = parseFloat(getComputedStyle(val).fontSize) || 80;
    num.style.minWidth = num.getBoundingClientRect().width / fontPx + 'em';
    num.textContent = '0';

    void scene.offsetWidth;
    scene.classList.add('is-on');
    await sleep(reduced ? 500 : MS.slipIn);

    const n = marks.length || 1;
    let shown = 0;
    const countTo = (v) => {
      const from = shown;
      shown = v;
      val.style.setProperty('--k', String(v / 100));
      if (!reduced) val.animate([{ transform: 'scale(1.045)', filter: 'brightness(1.35)' }, { transform: 'none', filter: 'none' }], { duration: 560, easing: 'cubic-bezier(.2,.7,.2,1)' });
      return tween(reduced ? 0 : 420, (e) => {
        const shownNow = String(Math.round(from + (v - from) * e));
        if (num.textContent !== shownNow) num.textContent = shownNow;
      });
    };

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      await tween(reduced ? 0 : MS.check, (e) => m.path.setAttribute('d', m.shape.d(e)), easeInOutSine);
      m.li.classList.add('is-marked');
      countTo(Math.round((100 * (i + 1)) / n));
      await sleep(reduced ? 380 : MS.checkGap + (i === marks.length - 1 ? 60 : 0));
    }
    if (!marks.length) await countTo(100);
    await sleep(reduced ? 200 : 140);

    // circle it
    const loop = await drawLoop(val, reduced ? 0 : MS.loop, 0.72, () => {
      const r = val.getBoundingClientRect();
      hooks.celebrate?.((r.left + r.width / 2) / innerWidth, (r.top + r.height / 2) / innerHeight, 40);
    });
    const refit = () => loop.fit();
    addEventListener('resize', refit);

    await sleep(reduced ? 120 : 60);
    opened.classList.add('is-in');
    await sleep(reduced ? 1800 : MS.hold);

    scene.classList.add('is-leaving');
    await sleep(reduced ? 500 : 620);
    runLetter();
    setTimeout(() => {
      removeEventListener('resize', refit);
      scene.remove();
    }, 1600);
  }

  // the hand-drawn loop round the score, fitted to the glyphs themselves
  // (measured, not guessed), redrawn if the text changes size
  async function drawLoop(val, ms, fireAt, onFire) {
    const svgEl = s('svg', { class: 'a2-loop', 'aria-hidden': 'true' });
    const path = s('path');
    svgEl.append(path);
    val.append(svgEl);
    let shape = null;
    let k = 0;
    const fit = () => {
      const box = glyphBox(val);
      const weight = Math.max(2.2, box.h * 0.036);
      shape = loopShape(7, box.w, box.h, weight);
      // centred on the digits, with room for the nib and the glow
      const W = 2 * Math.ceil(shape.ex + weight + 10);
      const H = 2 * Math.ceil(shape.ey + weight + 10);
      svgEl.setAttribute('viewBox', `${-W / 2} ${-H / 2} ${W} ${H}`);
      svgEl.setAttribute('width', W);
      svgEl.setAttribute('height', H);
      svgEl.style.left = box.cx - W / 2 + 'px';
      svgEl.style.top = box.cy - H / 2 + 'px';
      path.setAttribute('d', shape.d(k));
    };
    fit();
    let fired = false;
    await tween(ms, (e) => {
      k = e;
      path.setAttribute('d', shape.d(e));
      if (!fired && e >= fireAt) {
        fired = true;
        onFire();
      }
    }, easeInOutSine);
    if (!fired) onFire();
    return { fit };
  }

  // where the digits actually are inside the score, in its own px
  function glyphBox(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 80;
    const fallback = { cx: r.width / 2, cy: r.height * 0.53, w: r.width * 0.92, h: size * 0.68 };
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const m = c.measureText(el.textContent);
      if (!m.fontBoundingBoxAscent) return fallback;
      const lh = parseFloat(cs.lineHeight) || size;
      const baseline = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      const top = baseline - m.actualBoundingBoxAscent;
      const bottom = baseline + m.actualBoundingBoxDescent;
      const left = r.width - m.width - m.actualBoundingBoxLeft; // the number is right-aligned in its box
      const right = r.width - m.width + m.actualBoundingBoxRight;
      return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
    } catch {
      return fallback;
    }
  }

  // The countdown under the letter (content.countdown): days, hours, minutes
  // and seconds to `until`, then it rests at zero. Every digit sits in its own
  // fixed cell, so the numbers never shuffle sideways as they tick, and only a
  // digit that changed is written.
  function countdown(cd) {
    const until = cd ? Date.parse(cd.until) : NaN;
    if (!Number.isFinite(until)) return null;
    const names = Array.isArray(cd.units) ? cd.units : [];
    const box = h('div', 'a2-count');
    const row = box.appendChild(h('div', 'a2-count-row'));
    // beneath the numbers, so it reads on from them: "30 days ... until i see you again"
    const label = cd.label ? box.appendChild(h('p', 'a2-count-label', cd.label)) : null;
    row.setAttribute('role', 'timer');
    if (label) {
      label.id = 'a2-count-label';
      row.setAttribute('aria-labelledby', label.id);
    }
    const units = [0, 1, 2, 3].map((i) => {
      const u = row.appendChild(h('div', 'a2-count-unit'));
      const num = u.appendChild(h('span', 'a2-count-num'));
      if (names[i]) u.appendChild(h('span', 'a2-count-name', names[i]));
      return { num, cells: [] };
    });
    const show = () => {
      const left = Math.max(0, Math.floor((until - Date.now()) / 1000));
      const vals = [Math.floor(left / 86400), Math.floor(left / 3600) % 24, Math.floor(left / 60) % 60, left % 60];
      vals.forEach((v, i) => {
        const u = units[i];
        const txt = String(v).padStart(2, '0');
        while (u.cells.length < txt.length) u.cells.unshift(u.num.insertBefore(h('span', 'a2-count-digit'), u.num.firstChild));
        while (u.cells.length > txt.length) u.cells.shift().remove();
        for (let k = 0; k < txt.length; k++) if (u.cells[k].textContent !== txt[k]) u.cells[k].textContent = txt[k];
      });
      return left;
    };
    // tick on the second boundary; at zero there is nothing left to do
    const tick = () => {
      if (show() > 0) setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return box;
  }

  // ---------------------------------------------------------------- letter
  function runLetter() {
    step('letter');
    const scene = h('div', 'a2-scene a2-letter');
    scene.tabIndex = 0; // so arrow keys and space scroll it
    scene.setAttribute('role', 'region');
    const col = h('article', 'a2-col');
    const blocks = [];
    const add = (el) => {
      el.classList.add('a2-rv');
      col.append(el);
      blocks.push(el);
      return el;
    };
    if (letter.greeting) {
      const g = add(h('p', 'a2-greet', letter.greeting));
      g.id = 'a2-greet';
      scene.setAttribute('aria-labelledby', g.id);
      // her name in the greeting secretly goes to another page (letter.nameLink).
      // Not an <a>: a real link would give itself away with a hand cursor, the
      // address in the corner of the window, and a preview on a long press
      const link = letter.nameLink;
      const at = link && link.href && link.word ? letter.greeting.indexOf(link.word) : -1;
      if (at !== -1) {
        const name = h('span', 'a2-name', link.word);
        name.addEventListener('click', () => {
          if (getSelection && !getSelection().isCollapsed) return; // she was selecting text, not tapping
          // so Back (or any way home) lands on the letter, not the top of the show
          rememberLetter();
          location.href = link.href;
        });
        g.textContent = '';
        g.append(letter.greeting.slice(0, at), name, letter.greeting.slice(at + link.word.length));
      }
    }
    for (const p of letter.paragraphs || []) if (p) add(h('p', 'a2-para', p));
    if (letter.signoff || letter.signature) {
      const sign = add(h('div', 'a2-sign'));
      if (letter.signoff) sign.append(h('p', 'a2-signoff', letter.signoff));
      if (letter.signature) sign.append(h('p', 'a2-signature', letter.signature));
    }
    const count = countdown(content.countdown);
    if (count) add(count);
    if (letter.again) {
      const end = add(h('div', 'a2-end'));
      end.append(h('span', 'a2-end-star'));
      // the page itself, without any preview flags: the show from the top
      const a = h('a', 'a2-again', letter.again);
      a.href = location.pathname;
      end.append(a);
    }
    scene.append(col);
    root.append(scene);

    void scene.offsetWidth;
    scene.classList.add('is-on');
    scene.focus({ preventScroll: true });

    // Paragraphs arrive one after another while she reads the first screen;
    // below that, each waits until she scrolls it into view (and catches up
    // quickly if she scrolls ahead of them).
    // (the fold sits past the bottom edge, so the paragraph straddling it arrives
    // on its own and shows half-dissolved under the fade: the cue there is more)
    const fold = scene.clientHeight * 1.15;
    const firstPage = new Set(blocks.filter((b) => b.offsetTop < fold));
    const inView = new Set();
    let next = 0;
    let lastAt = performance.now() + (reduced ? 0 : 150) - MS.para;
    let timer = 0;
    const pump = () => {
      if (timer || next >= blocks.length) return;
      const b = blocks[next];
      if (!inView.has(b) && !firstPage.has(b)) return;
      const gap = firstPage.has(b) ? MS.para : MS.paraCatchUp;
      timer = setTimeout(() => {
        timer = 0;
        b.classList.add('is-in');
        lastAt = performance.now();
        next++;
        if (next >= blocks.length) io?.disconnect();
        pump();
      }, Math.max(0, lastAt + gap - performance.now()));
    };
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              for (const e of entries) if (e.isIntersecting) inView.add(e.target);
              pump();
            },
            { root: scene, rootMargin: '0px 0px -8% 0px', threshold: 0 },
          )
        : null;
    if (io) blocks.forEach((b) => io.observe(b));
    else blocks.forEach((b) => inView.add(b));
    // Tab can jump to "watch it again" before it has arrived: whatever takes
    // focus arrives at once, with everything above it, so focus never sits on
    // something invisible
    scene.addEventListener('focusin', (e) => {
      const k = blocks.findIndex((b) => b.contains(e.target));
      if (k < next) return;
      clearTimeout(timer);
      timer = 0;
      while (next <= k) blocks[next++].classList.add('is-in');
      lastAt = performance.now();
      if (next >= blocks.length) io?.disconnect();
      pump();
    });
    pump();
  }

  let started = false;
  return {
    start(from = 'quiz') {
      if (started) return;
      started = true;
      root.hidden = false;
      root.textContent = '';
      root.classList.add('a2');
      root.classList.toggle('a2--reduced', reduced);
      const run =
        from === 'letter' ? runLetter : from === 'grade' || !questions.length ? () => runGrade(questions.map(firstRight)) : runQuiz;
      Promise.resolve()
        .then(run)
        .catch((err) => console.error('[act2]', err));
    },
  };
}
