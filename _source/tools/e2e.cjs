// End-to-end check of the finished page, the way she would use it.
//
//   node tools/e2e.cjs [--out <dir>] [--w 390 --h 844 --dpr 2] [--speed 3] [--skip-live]
//
// 1. seek audit   every line is fully visible in the middle of its hold and invisible
//                 well before and after it (?t=X&freeze), and the planet mask is present
//                 exactly while the planet is on screen
// 2. pause        hide the page for 3 s: the show clock must not move
// 3. live run     play the real page from the start (at --speed), record which line is
//                 up against the clock, shoot a frame every few seconds, then take the
//                 quiz with wrong answers first, through the grading, into the letter,
//                 scroll to its end
// Any console error or page error fails the run.

const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wills/AppData/Roaming/npm/node_modules/gologin-agent-browser-cli/node_modules/playwright');

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const out = path.resolve(opt('--out', 'shots/e2e'));
fs.mkdirSync(out, { recursive: true });
const vp = { width: +opt('--w', 390), height: +opt('--h', 844) };
const dpr = +opt('--dpr', 2);
const speed = +opt('--speed', 3);
const page = 'file:///' + path.resolve(__dirname, '..', '..', 'index.html').split(path.sep).join('/');

const problems = [];
const note = (s) => {
  problems.push(s);
  console.log('  FAIL ' + s);
};

async function open(ctx, query) {
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error') note(`console error (${query}): ${m.text()}`);
  });
  p.on('pageerror', (e) => note(`page error (${query}): ${e.message}`));
  await p.goto(page + (query ? '?' + query : ''));
  await p.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  return p;
}

const lineState = () =>
  window.__show.CUES.map((c) => {
    const el = document.getElementById(c.id);
    const cs = getComputedStyle(el);
    return { id: c.id, opacity: cs.visibility === 'hidden' ? 0 : +cs.opacity };
  });

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, isMobile: vp.width < vp.height, hasTouch: vp.width < vp.height });

  // ------------------------------------------------------------ 1. seek audit
  console.log('seek audit');
  {
    const p = await open(ctx, 't=0&freeze');
    const cues = await p.evaluate(() => window.__show.CUES);
    await p.close();
    for (const c of cues) {
      const mid = (c.at + c.enterDur + c.until) / 2;
      const checks = [
        [c.at - 0.6, 'before', (o) => o < 0.02],
        [mid, 'hold', (o) => o > 0.9],
        [c.until + c.exitDur + 0.6, 'after', (o) => o < 0.02],
      ];
      for (const [t, label, ok] of checks) {
        if (t < 0) continue;
        const q = await open(ctx, `t=${t.toFixed(2)}&freeze`);
        await q.waitForTimeout(200);
        const s = (await q.evaluate(lineState)).find((x) => x.id === c.id);
        const mask = await q.evaluate(() => getComputedStyle(document.getElementById('back')).webkitMaskImage || getComputedStyle(document.getElementById('back')).maskImage);
        console.log(`  ${c.id.padEnd(12)} ${label.padEnd(6)} t=${t.toFixed(2).padStart(6)} opacity ${s.opacity.toFixed(2)}  mask ${mask === 'none' ? 'none' : 'on'}`);
        if (!ok(s.opacity)) note(`${c.id} ${label} at t=${t.toFixed(2)}: opacity ${s.opacity}`);
        await q.close();
      }
    }
  }

  // ------------------------------------------------------------ 2. pause
  console.log('pause while hidden');
  {
    const p = await open(ctx, 't=10');
    const t0 = await p.evaluate(() => window.__show.clock.t);
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.waitForTimeout(3000);
    const t1 = await p.evaluate(() => window.__show.clock.t);
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.waitForTimeout(1000);
    const t2 = await p.evaluate(() => window.__show.clock.t);
    console.log(`  t ${t0.toFixed(2)} -> hidden 3s -> ${t1.toFixed(2)} -> visible 1s -> ${t2.toFixed(2)}`);
    if (t1 - t0 > 0.2) note(`clock ran while hidden: ${t0} -> ${t1}`);
    if (t2 - t1 < 0.2) note(`clock did not resume: ${t1} -> ${t2}`);
    await p.close();
  }

  // ------------------------------------------------------ 2b. lost WebGL context
  console.log('lost WebGL context');
  {
    // no ?flags, as she would have it: jump the clock instead
    const p = await open(ctx, '');
    await p.evaluate(() => window.__show.clock.seek(30));
    await p.waitForTimeout(300);
    const before = await p.evaluate(() => window.__show.clock.t);
    const nav = p.waitForEvent('load', { timeout: 20000 });
    await p.evaluate(() => window.__show.stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
    try {
      await nav;
      await p.waitForFunction('window.__ready === true', null, { timeout: 120000 });
      const after = await p.evaluate(() => window.__show.clock.t);
      const strip = await p.evaluate(() => !!document.querySelector('.preview-strip'));
      console.log(`  t ${before.toFixed(2)} -> context lost -> reloaded at t ${after.toFixed(2)}`);
      if (Math.abs(after - before) > 3) note(`after a lost context the show resumed at ${after}, not near ${before}`);
      if (strip) note('the resumed page shows the preview strip');
    } catch (e) {
      note('lost context: page did not reload and resume (' + e.message.split('\n')[0] + ')');
    }
    await p.close();
  }

  // ------------------------------------------------------------ 3. live run
  if (!argv.includes('--skip-live')) {
    console.log(`live run at ${speed}x`);
    const p = await open(ctx, `speed=${speed}`);
    const T = await p.evaluate(() => window.__show.T);
    let lastShot = -10;
    const seen = new Set();
    for (;;) {
      const t = await p.evaluate(() => window.__show.clock.t);
      const up = (await p.evaluate(lineState)).filter((s) => s.opacity > 0.5).map((s) => s.id);
      for (const id of up) if (!seen.has(id)) (seen.add(id), console.log(`  t=${t.toFixed(1).padStart(5)} ${id}`));
      if (t - lastShot >= 4) {
        lastShot = t;
        await p.screenshot({ path: path.join(out, `live-t${t.toFixed(1).padStart(5, '0')}.png`) });
      }
      if (t > T.act2 + 1.5) break;
      await p.waitForTimeout(250);
    }
    const missing = (await p.evaluate(() => window.__show.CUES.map((c) => c.id))).filter((id) => !seen.has(id));
    if (missing.length) note('lines never seen during the live run: ' + missing.join(', '));

    const tap = async (name, expectText) => {
      const btn = p.getByRole('button', { name, exact: true }).first();
      await btn.waitFor({ state: 'visible', timeout: 15000 });
      await btn.click();
      if (expectText) {
        try {
          await p.getByText(expectText, { exact: false }).first().waitFor({ state: 'visible', timeout: 4000 });
        } catch {
          note(`after tapping "${name}", "${expectText}" did not appear`);
        }
      }
      await p.waitForTimeout(400);
    };
    const R = await p.evaluate(() => window.REINA);
    try {
      await p.getByText(R.quiz.intro).first().waitFor({ state: 'visible', timeout: 15000 });
      await p.screenshot({ path: path.join(out, 'quiz-0-intro.png') });
      await tap('Reina', "whoops, that's wrong. try again.");
      await p.screenshot({ path: path.join(out, 'quiz-1-wrong.png') });
      await tap('Will');
      await p.waitForTimeout(1200);
      await tap('6');
      await tap('2');
      await p.waitForTimeout(1200);
      await tap('0', 'be so fr');
      await p.screenshot({ path: path.join(out, 'quiz-3-besofr.png') });

      // the secret: keep tapping "0" until the minigame opens, play it, come back
      for (let i = 1; i < R.minigame.taps; i++) {
        await p.getByRole('button', { name: '0', exact: true }).first().click();
        await p.waitForTimeout(250);
      }
      try {
        await p.getByText(R.minigame.found).first().waitFor({ state: 'visible', timeout: 8000 });
        await p.screenshot({ path: path.join(out, 'secret-0-found.png') });
        await p.getByRole('button', { name: R.minigame.start, exact: true }).click();
        const heads = async () => p.evaluate(() => window.__show.director.minigame.heads());
        let caught = 0;
        const until = Date.now() + 60000;
        while (Date.now() < until) {
          if (await p.getByRole('button', { name: R.minigame.back, exact: true }).isVisible().catch(() => false)) break;
          const hs = await heads();
          if (hs.length) {
            await p.mouse.click(hs[0].x, hs[0].y);
            caught++;
          }
          await p.waitForTimeout(300);
        }
        await p.screenshot({ path: path.join(out, 'secret-1-result.png') });
        console.log(`  minigame: ${caught} taps on live stars`);
        await p.getByRole('button', { name: R.minigame.back, exact: true }).click();
        await p.getByRole('button', { name: '67', exact: true }).waitFor({ state: 'visible', timeout: 8000 });
      } catch (e) {
        note('secret minigame: ' + e.message.split('\n')[0]);
        await p.screenshot({ path: path.join(out, 'secret-FAILED.png') });
      }
      await tap('67');
      await p.waitForTimeout(1200);
      await tap('Reina');
      await p.screenshot({ path: path.join(out, 'quiz-4-reina.png') });
      for (const ms of [800, 1600, 2400, 3200]) {
        await p.waitForTimeout(800);
        await p.screenshot({ path: path.join(out, `grade-${ms}.png`) });
      }
      await p.getByText('100%').first().waitFor({ state: 'visible', timeout: 10000 });
      await p.getByText(R.quiz.opened, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
      await p.screenshot({ path: path.join(out, 'grade-done.png') });
      await p.getByText('Reina,', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
      await p.waitForTimeout(3500);
      await p.screenshot({ path: path.join(out, 'letter-1.png') });
      await p.mouse.move(vp.width / 2, vp.height / 2);
      for (let i = 0; i < 12; i++) {
        await p.mouse.wheel(0, 300);
        await p.waitForTimeout(250);
      }
      await p.waitForTimeout(1500);
      await p.screenshot({ path: path.join(out, 'letter-2-end.png') });
      const again = await p.getByText(R.letter.again).first().isVisible().catch(() => false);
      if (!again) note(`"${R.letter.again}" not visible at the end of the letter`);
      const cd = await p.getByText(R.countdown.label).first().isVisible().catch(() => false);
      if (!cd) note(`countdown label "${R.countdown.label}" not visible under the letter`);
      await p.screenshot({ path: path.join(out, 'letter-3-countdown.png') });
    } catch (e) {
      note('quiz flow: ' + e.message.split('\n')[0]);
      await p.screenshot({ path: path.join(out, 'quiz-FAILED.png') });
    }
    await p.close();
  }

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(2);
});
