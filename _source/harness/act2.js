// Act two on its own, over a still CSS sky instead of the live one.
//   harness/act2.html?from=quiz|grade|letter   (&reduced for reduced motion)
//   &probe  crisp pink stripes behind everything, so any moment where the
//           frosted glass stops blurring (a pop) is unmistakable in a shot
// The hooks log to the console and stamp window.__steps, which act2-flow.cjs
// reads to time its screenshots of the grading and the letter.

import { runHarness } from './kit.js';
import { createAct2 } from '../src/act2.js';

runHarness({
  gl: false,
  setup({ q }) {
    if (q.has('probe')) document.documentElement.classList.add('h-probe');
    const from = ['quiz', 'grade', 'letter'].includes(q.get('from')) ? q.get('from') : 'quiz';
    const reducedMotion = q.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.__steps = {};
    window.__celebrations = [];
    const act2 = createAct2(document.getElementById('act2'), window.REINA || {}, {
      reducedMotion,
      onStep(name) {
        window.__steps[name] = performance.now();
        console.log(`[act2] onStep ${name}`);
      },
      celebrate(x, y, count) {
        window.__celebrations.push({ x, y, count, at: performance.now() });
        console.log(`[act2] celebrate x=${x.toFixed(3)} y=${y.toFixed(3)} count=${count}`);
      },
      // stands in for the director opening the minigame: back after 2s
      secret(back) {
        window.__secret = performance.now();
        console.log('[act2] secret');
        setTimeout(() => {
          console.log('[act2] secret back');
          back();
        }, 2000);
      },
    });
    act2.start(from);
    return { act2 };
  },
  frame() {},
});
