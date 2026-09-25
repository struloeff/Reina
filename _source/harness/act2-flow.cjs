// Walks act two the way she will - wrong answers first, then right ones - and
// screenshots every step: the quiz, the grading at fixed moments, the letter.
//
//   node harness/act2-flow.cjs --out <dir>                  390x844 @2, touch
//   node harness/act2-flow.cjs --small --out <dir>          360x740 @3, touch
//   node harness/act2-flow.cjs --landscape --out <dir>      844x390 @2, touch
//   node harness/act2-flow.cjs --desktop --out <dir>        1440x900 @1, mouse
//   --reduced       emulate prefers-reduced-motion
//   --from grade    start there instead (grade | letter), skipping the quiz
//   --secret        on question 3, tap "0" until the secret opens (the harness
//                   stands in for the minigame and comes back after 2s)
//   --probe         crisp pink stripes behind everything (harness ?probe)
//   --glass         instead of the walk, rapid frames through every handover
//                   that involves the frosted glass (the first question, a
//                   question swap, the quiz leaving, the slip arriving and
//                   leaving), over the probe stripes: the stripes behind a pill
//                   or the slip must stay smeared in every frame, never crisp
//
// Files are <dir>/<size>-NN-<step>.png. Page errors and warnings are printed.

const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wills/AppData/Roaming/npm/node_modules/gologin-agent-browser-cli/node_modules/playwright');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const has = (k) => argv.includes(k);

let size = 'phone';
let vp = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
if (has('--small')) (size = 'small'), (vp = { width: 360, height: 740, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
if (has('--landscape')) (size = 'landscape'), (vp = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
if (has('--desktop')) (size = 'desktop'), (vp = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
const reduced = has('--reduced');
const glass = has('--glass');
const probe = has('--probe') || glass;
const from = glass ? 'quiz' : opt('--from', 'quiz');
const outDir = path.resolve(opt('--out', 'shots/act2'));
fs.mkdirSync(outDir, { recursive: true });
const tag = size + (reduced ? '-rm' : '') + (glass ? '-glass' : '');

const page = path.resolve(__dirname, 'act2.html');
const url = 'file:///' + page.split(path.sep).join('/') + `?from=${from}` + (reduced ? '&reduced' : '') + (probe ? '&probe' : '');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  // the page's own clock for each handover: the first time a scene or question
  // gains is-asking / is-after / is-leaving / is-on, keyed like "a2-quiz.is-asking"
  await ctx.addInitScript(() => {
    window.__marks = {};
    new MutationObserver((recs) => {
      for (const r of recs) {
        const el = r.target;
        if (!el.classList) continue;
        const own = [...el.classList].find((c) => c.startsWith('a2-') && c !== 'a2-scene');
        for (const c of ['is-asking', 'is-after', 'is-leaving', 'is-on']) {
          const key = `${own}.${c}`;
          if (el.classList.contains(c) && window.__marks[key] == null) window.__marks[key] = performance.now();
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const p = await ctx.newPage();
  let problems = 0;
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      problems++;
      console.log(`  [${m.type()}] ${m.text()}`);
    } else if (m.text().startsWith('[act2]')) console.log('  ' + m.text());
  });
  p.on('pageerror', (e) => {
    problems++;
    console.log('  [pageerror] ' + e.message);
  });

  let n = 0;
  const shot = async (name) => {
    const file = path.join(outDir, `${tag}-${String(++n).padStart(2, '0')}-${name}.png`);
    await p.screenshot({ path: file });
    console.log(file);
  };
  const wait = (ms) => p.waitForTimeout(ms);
  const tap = async (text, nth = 0) => {
    const b = p.locator('.a2-q.is-current').getByRole('button', { name: text, exact: true }).nth(nth);
    if (vp.hasTouch) await b.tap();
    else await b.click();
  };
  const question = (i) => p.waitForFunction((i) => document.getElementById('act2').dataset.q === String(i), i);
  // wait until `ms` after the module announced `step`, measured on the page's clock
  const after = (step, ms) =>
    p.waitForFunction(([s, ms]) => window.__steps && window.__steps[s] != null && performance.now() - window.__steps[s] >= ms, [step, ms], {
      polling: 16,
      timeout: 60000,
    });

  // wait until `ms` after the handover `key` began (see __marks above)
  const since = (key, ms) =>
    p.waitForFunction(([k, ms]) => window.__marks[k] != null && performance.now() - window.__marks[k] >= ms, [key, ms], {
      polling: 8,
      timeout: 60000,
    });
  const burst = async (key, list) => {
    for (const ms of list) {
      await since(key, ms);
      await shot(`${key.replace(/^a2-/, '').replace('.is-', '-')}-${ms}`);
    }
  };

  await p.goto(url);
  await p.waitForFunction('window.__ready === true');

  if (glass) {
    await burst('a2-quiz.is-asking', [120, 450, 800, 1300]);
    await tap('Will');
    await burst('a2-q.is-after', [0, 150, 350, 600, 900]);
    await question(1);
    await wait(900);
    await tap('2');
    await question(2);
    await wait(900);
    await tap('67');
    await question(3);
    await wait(900);
    await tap('Reina', 1);
    await burst('a2-quiz.is-leaving', [0, 120, 350, 650]);
    await burst('a2-grade.is-on', [60, 250, 500, 750, 1000, 1300]);
    await burst('a2-grade.is-leaving', [0, 60, 200, 400, 650]);
    console.log(problems ? `  ${problems} console problem(s)` : '  no console errors');
    await browser.close();
    return;
  }

  if (from === 'quiz') {
    await wait(700);
    await shot('intro');
    await question(0);
    await wait(2000);
    await shot('q1');
    await tap('Reina');
    await wait(650);
    await shot('q1-wrong');
    await tap('Will');
    await wait(450);
    await shot('q1-right');

    await question(1);
    await wait(1100);
    await shot('q2');
    await tap('6');
    await wait(650);
    await shot('q2-wrong');
    await tap('7');
    await wait(650);
    await shot('q2-wrong-again');
    await tap('2');
    await wait(450);
    await shot('q2-right');

    await question(2);
    await wait(1100);
    await shot('q3');
    await tap('0');
    await wait(650);
    await shot('q3-wrong');
    if (has('--secret')) {
      const taps = await p.evaluate(() => (window.REINA.minigame && window.REINA.minigame.taps) || 10);
      for (let k = 2; k < taps; k++) {
        await tap('0');
        await wait(120);
      }
      await wait(300);
      await shot('q3-almost');
      await tap('0');
      await wait(220);
      await shot('q3-found');
      await wait(800);
      await shot('q3-away');
      await p.waitForFunction(() => window.__secret && performance.now() - window.__secret > 2000 + 1400);
      await shot('q3-back');
    }
    await tap('67');
    await wait(450);
    await shot('q3-right');

    await question(3);
    await wait(1100);
    await shot('q4');
    await tap('Reina', 2);
    await wait(600);
    await shot('q4-all');
  }

  if (from !== 'letter') {
    for (const s of [0.4, 1.2, 2.0, 2.8, 3.6, 4.6, 5.6]) {
      await after('grade', s * 1000);
      await shot(`grade-${s.toFixed(1)}s`);
    }
  }

  await after('letter', 350);
  await shot('letter-arrive');
  await after('letter', 2200);
  await shot('letter-mid');
  await after('letter', 5200);
  await shot('letter-first-page');
  await p.evaluate(() => {
    const el = document.querySelector('.a2-letter');
    el.scrollTop = el.scrollHeight;
  });
  await wait(900);
  await shot('letter-scrolling');
  await wait(3200);
  await shot('letter-end');

  const info = await p.evaluate(() => ({
    celebrations: window.__celebrations,
    steps: Object.keys(window.__steps || {}),
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }));
  console.log('  steps', info.steps.join(' > '), '| celebrations', JSON.stringify(info.celebrations), '| overflowX', info.overflowX);
  console.log(problems ? `  ${problems} console problem(s)` : '  no console errors');
  await browser.close();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
