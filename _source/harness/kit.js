// Shared scaffolding for harness pages: a module on its own, on the real stage
// (same renderer, bloom, tone mapping and grading as the show), driven by a
// clock that honours ?t=, ?freeze and ?speed= exactly like the real page, and
// sets window.__ready so tools/shot.cjs knows when to shoot.
//
//   import { runHarness } from './kit.js';
//   runHarness({
//     textures: true,                        // load the Earth maps (tex passed to setup)
//     setup({ THREE, stage, tex, q }) { ... return anything },   // q = URLSearchParams
//     frame({ t, dt, stage, q, ...whatSetupReturned }) { ... },
//   });
//
// The page needs <canvas id="sky"></canvas> and ../../assets/show.css or a harness css bundle.

import * as THREE from 'three';
import { createStage } from '../src/stage.js';
import { loadEarthTextures } from '../src/textures.js';

export async function runHarness({ textures = false, gl = true, setup, frame }) {
  const q = new URLSearchParams(location.search);
  const stage = gl ? createStage(document.getElementById('sky'), { quality: q.has('lowq') ? 'low' : 'high' }) : null;
  const tex = gl && textures ? await loadEarthTextures(THREE, stage.renderer, { base: '../../assets/' }) : null;
  if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  const ctx = (await setup({ THREE, stage, tex, q })) || {};
  let t = q.has('t') ? +q.get('t') : 0;
  const freeze = q.has('freeze');
  const speed = q.has('speed') ? +q.get('speed') : 1;
  let last = null;
  let frames = 0;
  window.__harness = { get t() { return t; }, seek(v) { t = v; } };
  const loop = (now) => {
    let dt = last === null ? 0 : Math.min((now - last) / 1000, 1 / 15);
    last = now;
    if (freeze || document.hidden) dt = 0;
    dt *= speed;
    t += dt;
    frame({ t, dt, stage, q, THREE, ...ctx });
    if (stage) stage.render(t, dt);
    if (++frames === 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
