// Boot: read the preview flags, wait for fonts and the Earth, then run one loop
// that asks the director for a frame and draws it.

import * as THREE from 'three';
import { createStage } from './stage.js';
import { createClock } from './clock.js';
import { loadEarthTextures } from './textures.js';
import { createDirector } from './director.js';
import { T, CUES } from './script.js';
import { saveResume, takeResume, forgetResume } from './resume.js';

// ------------------------------------------------------------------- flags
// ?t=26        start 26 seconds in
// ?act=quiz    straight to the quiz (also: grade, letter)
// ?speed=2     run the show at double speed
// ?freeze      hold still on the first frame (for screenshots)
// ?debug       a clock in the corner
// ?lowq        lower resolution;  ?nogl  pretend WebGL is missing;  ?reduced  reduced motion
function readFlags() {
  const q = new URLSearchParams(location.search);
  const num = (k) => (q.has(k) && q.get(k) !== '' && isFinite(+q.get(k)) ? +q.get(k) : null);
  const act = ['quiz', 'grade', 'letter'].includes(q.get('act')) ? q.get('act') : null;
  const f = {
    t: num('t'),
    speed: num('speed'),
    act,
    freeze: q.has('freeze'),
    debug: q.has('debug'),
    lowq: q.has('lowq'),
    nogl: q.has('nogl'),
    reduced: q.has('reduced'),
  };
  f.any = [...q.keys()].length > 0;
  return f;
}

function flagStrip(flags) {
  if (!flags.any || flags.freeze) return;
  const el = document.createElement('div');
  el.className = 'preview-strip';
  el.textContent = `preview ${location.search} - this is not what she will see`;
  document.body.appendChild(el);
}

function debugReadout(director, clock, stage) {
  const el = document.createElement('div');
  el.className = 'debug-readout';
  document.body.appendChild(el);
  let frames = 0;
  let acc = 0;
  let fps = 0;
  return (dtReal) => {
    frames++;
    acc += dtReal;
    if (acc > 0.5) {
      fps = Math.round(frames / acc);
      frames = 0;
      acc = 0;
    }
    el.textContent = `t ${clock.t.toFixed(2)}  ${fps}fps  dpr ${stage ? stage.size.dpr.toFixed(2) : '-'}\n${director.describe(clock.t)}`;
  };
}

// if the first seconds run slowly, trade resolution for smoothness
function adaptiveQuality(stage) {
  const samples = [];
  let scale = 1;
  let settledAt = 0;
  return (dtReal, t) => {
    if (!stage || t < 1 || dtReal <= 0 || dtReal > 0.25) return;
    samples.push(dtReal);
    if (samples.length < 45) return;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples.length = 0;
    if (avg > 1 / 38 && scale > 0.6 && t - settledAt > 1.5) {
      scale = Math.max(0.6, scale - 0.15);
      stage.setDprScale(scale);
      settledAt = t;
    }
  };
}

// A phone can take the WebGL context away (switching apps, low memory), and
// iOS rarely gives it back. Rather than leave her a black screen, remember
// where the show was and reload into that moment when the page is next seen.
// Act two resumes at the quiz (or the letter, if she had reached it).
function watchContext(canvas, clock, director) {
  let lost = false;
  const reload = () => {
    saveResume(clock.t, director.mood);
    location.reload();
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    clock.pause();
    // if it is visible and nothing gives the context back soon, reload now
    setTimeout(() => lost && !document.hidden && reload(), 1500);
  });
  canvas.addEventListener('webglcontextrestored', () => lost && reload());
  document.addEventListener('visibilitychange', () => lost && !document.hidden && reload());
}

async function keepAwake() {
  try {
    let lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) {
        lock = await navigator.wakeLock?.request('screen').catch(() => null);
      }
    });
  } catch {
    /* not supported or not allowed; the show still runs */
  }
}

async function boot() {
  const flags = readFlags();
  flagStrip(flags);
  const content = window.REINA || {};
  const canvas = document.getElementById('sky');

  const fontsReady = document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]) : null;

  let stage = null;
  let textures = null;
  if (!flags.nogl) {
    try {
      const lowMemory = (navigator.deviceMemory && navigator.deviceMemory < 4) || flags.lowq;
      stage = createStage(canvas, { quality: lowMemory ? 'low' : 'high' });
      textures = await loadEarthTextures(THREE, stage.renderer);
    } catch (err) {
      console.warn('[reina] no WebGL, words only:', err);
      stage = null;
    }
  }
  if (!stage) document.documentElement.classList.add('no-gl');
  await fontsReady;

  // coming back from a lost WebGL context (see below), or from the page her
  // name in the letter links to: pick up where she was
  const resume = takeResume();
  // ...unless the browser kept this page alive while she was away (Back from
  // that page): the letter is still here, and the note left for a fresh load
  // must not send "watch it again" to the letter instead of the top
  addEventListener('pageshow', (e) => e.persisted && forgetResume());
  if (resume && !flags.act && flags.t === null) {
    if (resume.t >= T.act2) flags.act = resume.mood === 'letter' ? 'letter' : 'quiz';
    else flags.t = resume.t;
  }

  const start = flags.act ? T.act2 + 0.01 : flags.t ?? 0;
  const clock = createClock({ start, speed: flags.speed ?? 1, frozen: flags.freeze });
  const director = createDirector({ stage, textures, content, flags });
  if (stage) watchContext(canvas, clock, director);
  const readout = flags.debug ? debugReadout(director, clock, stage) : null;
  const adapt = adaptiveQuality(stage);

  window.__show = { clock, director, stage, T, CUES };
  document.documentElement.classList.add('is-ready');
  keepAwake();

  let frames = 0;
  let lastNow = null;
  const frame = (now) => {
    const dtReal = lastNow === null ? 0 : (now - lastNow) / 1000;
    lastNow = now;
    clock.tick(now);
    director.update(clock.t, clock.dt);
    if (stage) stage.render(clock.t, clock.dt);
    readout?.(dtReal);
    if (!flags.freeze) adapt(dtReal, clock.t);
    if (++frames === 3) window.__ready = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error('[reina] boot failed', err);
  document.documentElement.classList.add('is-ready', 'no-gl');
});
