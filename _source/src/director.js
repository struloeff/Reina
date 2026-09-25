// The director. Every frame it asks the rig (rig.js) where the camera, the
// planet, the sun and the sky are at time t, hands those to the modules, tells
// the words where the planet's disc is so they can hide behind it, and starts
// act two on cue. Everything in act one is a function of t, so the show can be
// paused, resumed or jumped into (?t=26) and always lands on the same frame.

import { T, CUES } from './script.js';
import { frameAt } from './rig.js';
import { createSky } from './sky.js';
import { createEarth } from './earth.js';
import { createMeteor } from './meteor.js';
import { createHearts } from './hearts.js';
import { createLines } from './lines.js';
import { createAct2 } from './act2.js';
import { createMinigame } from './minigame.js';

export function createDirector({ stage, textures, content, flags }) {
  const reduced = flags.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const gl = !!stage;

  let now = 0;
  let mood = 'show'; // show | quiz | grade | letter | game

  // Hearts: a stream through the last line of the show, then a sparse one behind
  // the quiz that stops for the game and the letter (words and targets need the
  // room) and starts again when she comes back from the game. Hearts are a pure
  // function of t and these lists, so ending a stream never removes a heart
  // that is already in the air.
  const streams = [{ start: T.hearts, end: T.act2, every: 0.42, opacity: 1, band: [0.04, 0.96] }];
  const bursts = [];
  const quietStream = (from) => ({ start: from, end: Infinity, every: 2.2, opacity: 0.45, band: [0.02, 0.98] });
  streams.push(quietStream(T.act2 + 2));
  function setMood(name) {
    if (name === mood) return;
    const busy = (m) => m === 'game' || m === 'letter';
    const last = streams[streams.length - 1];
    if (busy(name) && last.end === Infinity) last.end = Math.max(now, last.start);
    if (!busy(name) && busy(mood) && name !== 'show') streams.push(quietStream(now + 0.5));
    mood = name;
  }
  const celebrate = (x = 0.5, y = 0.45, count = 40) => {
    bursts.push({ at: now, count, x, y, spread: 1 });
  };

  const lines = createLines(document, CUES, { reducedMotion: reduced });
  const minigame = createMinigame(gl ? stage : null, document.getElementById('minigame'), content.minigame || {}, {
    reducedMotion: reduced,
    celebrate,
    onMood: setMood,
  });
  const act2 = createAct2(document.getElementById('act2'), content, {
    reducedMotion: reduced,
    onStep: setMood,
    celebrate,
    // tapping "0" enough times: the game, then straight back to that question
    secret(back) {
      minigame.start((score) => back(score));
    },
  });

  const sky = gl ? createSky(stage) : null;
  const earth = gl ? createEarth(stage, textures) : null;
  const meteor = gl ? createMeteor(stage) : null;
  const hearts = gl ? createHearts(stage) : null;

  let act2Started = false;
  const startAct2 = (from) => {
    if (act2Started) return;
    act2Started = true;
    document.body.classList.add('in-act2');
    act2.start(from);
  };
  if (flags.act) startAct2(flags.act);

  let lastSize = '';
  function publishLayout(L, size) {
    const key = size.w + 'x' + size.h;
    if (key === lastSize) return;
    lastSize = key;
    root.style.setProperty('--globe-cx', L.globe.cx + 'px');
    root.style.setProperty('--globe-cy', L.globe.cy + 'px');
    root.style.setProperty('--globe-r', L.globe.r + 'px');
    root.style.setProperty('--hero-x', L.hero.x * 100 + '%');
    root.style.setProperty('--hero-y', L.hero.y * 100 + '%');
  }

  function update(t, dt) {
    now = t;
    const size = gl ? stage.size : { w: window.innerWidth, h: window.innerHeight };
    const F = frameAt(t, size, gl ? stage.camera : null, { reduced, mood });
    publishLayout(F.layout, size);

    if (gl) {
      earth.update(t, dt, F.earth);
      sky.update(t, dt, F.sky);
      meteor.update(t, dt, F.meteor);
      hearts.update(t, dt, { streams, bursts });
      stage.grade.uFlash.value = F.grade.flash;
      stage.grade.uFlashAt.value.set(F.grade.flashAt[0], 1 - F.grade.flashAt[1]);
      stage.grade.uFade.value = F.grade.fade;
      stage.grade.uVignette.value = F.grade.vignette;
    }
    minigame.update(t, dt);

    lines.update(t, dt, {
      earthDisc: gl && F.earthVisible ? { x: F.disc.cx, y: F.disc.cy, r: F.disc.r } : null,
      globe: F.layout.globe,
      reducedMotion: reduced,
    });

    if (t >= T.act2) startAct2('quiz');
  }

  function describe(t) {
    const cue = CUES.find((c) => t >= c.at && t < c.until + (c.exitDur || 0)) || null;
    const next = CUES.find((c) => c.at > t);
    const where = cue ? cue.id : act2Started ? mood : '-';
    return `${where}  next ${next ? next.id + '@' + next.at : t < T.act2 ? 'act2@' + T.act2 : '-'}`;
  }

  return {
    update,
    describe,
    minigame, // exposed for tools/e2e.cjs (heads())
    get mood() {
      return mood;
    },
  };
}
