// Plays the secret end to end in a real browser, the way she would: the found
// card, start, a whole round tapping real shooting stars (catching most,
// letting some go), the result card, `again`, and `back` - then checks that
// onDone fired with the score the card showed.
//
//   node harness/minigame-flow.cjs --out <dir>/phone                 390x844 @2, touch (default)
//   node harness/minigame-flow.cjs --small --out <dir>/small         360x740 @3, touch
//   node harness/minigame-flow.cjs --desktop --out <dir>/desktop     1440x900 @1, mouse
//   --seed N (default 7)   --q "reduced"   --quick (no screenshots mid-round)
//
// WebGL runs on SwiftShader, so the page draws a few frames a second; the game
// runs on its own clock (dt clamped per frame), so it simply plays slower in
// real time. Screenshots are timed off the game's clock, not the wall's.

const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wills/AppData/Roaming/npm/node_modules/gologin-agent-browser-cli/node_modules/playwright');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const has = (k) => argv.includes(k);

let vp = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
if (has('--small')) vp = { width: 360, height: 740, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
if (has('--desktop')) vp = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const touch = vp.hasTouch;
const seed = opt('--seed', '7');
const extra = opt('--q', '');
const outPrefix = path.resolve(opt('--out', 'shots/minigame/flow'));
fs.mkdirSync(path.dirname(outPrefix), { recursive: true });
const page0 = 'file:///' + path.resolve(__dirname, 'minigame.html').split(path.sep).join('/');
const url = `${page0}?seed=${seed}${extra ? '&' + extra : ''}`;

const problems = [];
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!ok) problems.push(msg);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      console.log(`  [${m.type()}] ${m.text()}`);
      if (m.type() === 'error') errors.push(m.text());
    }
  });
  page.on('pageerror', (e) => {
    console.log('  [pageerror] ' + e.message);
    errors.push(e.message);
  });

  const t0 = Date.now();
  const shot = async (name) => {
    const file = `${outPrefix}-${name}.png`;
    await page.screenshot({ path: file });
    const g = await page.evaluate(() => window.__minigame.time).catch(() => null);
    console.log(`${file}  (game ${g == null ? '-' : g.toFixed(2)}s, wall ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  };
  const tapAt = async (x, y) => {
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  const tapEl = async (sel) => {
    const loc = page.locator(sel);
    if (touch) await loc.tap();
    else await loc.click();
  };
  const G = () => page.evaluate(() => ({ state: window.__minigame.state, t: window.__minigame.time, score: window.__minigame.score, round: window.__minigame.round, heads: window.__minigame.heads() }));

  await page.goto(url);
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });

  // 1. the found card: `found` alone for a beat, then the card
  await page.waitForTimeout(700);
  await shot('1-found');
  await page.waitForFunction(() => document.querySelector('#minigame .mg-intro.is-ready'), null, { timeout: 20000 });
  await page.waitForTimeout(2600);
  await shot('2-card');
  check(await page.evaluate(() => window.__minigame.state === 'intro'), 'the card is up (state intro)');

  // 2. start
  await tapEl('#minigame .mg-start');
  await page.waitForFunction(() => window.__minigame.state === 'play', null, { timeout: 10000 });
  check((await page.evaluate(() => window.__moods.slice())).includes('game'), "onMood('game') on start");

  // 3. play the round by tapping live heads. Every fifth star is let go.
  const quick = has('--quick');
  const marks = quick ? [] : [2, 8, 26];
  let mark = 0;
  let burstShot = quick;
  let rippleDone = false;
  const tapped = new Set();
  let taps = 0;
  let lastScore = 0;
  let seen = new Set();
  for (;;) {
    const s = await G();
    if (s.state !== 'play') break;
    for (const h of s.heads) seen.add(h.id);
    if (mark < marks.length && s.t >= marks[mark]) {
      await shot(`3-play-t${marks[mark]}`);
      mark++;
      continue;
    }
    if (!rippleDone && s.t > 4.5) {
      // a tap on empty sky: a faint ripple, no point
      rippleDone = true;
      const empty = [
        [vp.width * 0.5, vp.height * 0.92],
        [vp.width * 0.12, vp.height * 0.85],
        [vp.width * 0.88, vp.height * 0.85],
      ].find(([x, y]) => s.heads.every((h) => Math.hypot(h.x - x, h.y - y) > 120));
      if (empty) {
        await tapAt(empty[0], empty[1]);
        const after = await page.evaluate(() => window.__minigame.score);
        check(after === s.score, 'a tap on empty sky scores nothing');
      }
      continue;
    }
    const cand = s.heads.filter((h) => h.catchable && h.k > 0.3 && !tapped.has(h.id) && h.id % 5 !== 3 && h.x > 4 && h.x < vp.width - 4 && h.y > 4 && h.y < vp.height - 4);
    if (!cand.length) {
      await page.waitForTimeout(30);
      continue;
    }
    cand.sort((a, b) => b.k - a.k);
    const h = cand[0];
    tapped.add(h.id);
    // lead the head by about a frame, as a thumb does
    await tapAt(h.x + h.vx * 0.05, h.y + h.vy * 0.05);
    taps++;
    if (!burstShot && s.t > 10) {
      burstShot = true;
      await page.waitForTimeout(60);
      await shot('4-catch');
    }
    const sc = await page.evaluate(() => window.__minigame.score);
    lastScore = sc;
  }
  const r1 = await G();
  console.log(`  round 1: ${taps} taps at ${seen.size} stars, score ${lastScore}`);
  check(lastScore >= Math.round(taps * 0.7), `most taps caught (${lastScore}/${taps})`);
  check(seen.size >= 25, `enough stars in a round (${seen.size})`);
  const cel = await page.evaluate(() => window.__celebrations.length);
  check(cel === lastScore, `celebrate() once per catch (${cel})`);
  const cel0 = await page.evaluate(() => window.__celebrations[0] || null);
  check(!!cel0 && cel0.count === 3 && cel0.x >= 0 && cel0.x <= 1 && cel0.y >= 0 && cel0.y <= 1, 'celebrate(x, y, 3) in viewport fractions');

  // 4. the result card
  await page.waitForFunction(() => window.__minigame.state === 'result', null, { timeout: 20000 });
  await page.waitForTimeout(2200);
  await shot('5-result');
  const resText = await page.evaluate(() => document.querySelector('#minigame .mg-res').textContent);
  const bestText = await page.evaluate(() => document.querySelector('#minigame .mg-best').textContent);
  console.log(`  result card: "${resText}"  "${bestText}"`);
  check(resText.includes(String(lastScore)), 'the result shows the score');
  const stored = await page.evaluate(() => {
    try {
      return +localStorage.getItem('reina.minigame.best');
    } catch {
      return null;
    }
  });
  check(stored === null || stored >= lastScore, `best kept in localStorage (${stored})`);

  // 5. again: a second round starts
  await tapEl('#minigame .mg-again');
  await page.waitForFunction(() => window.__minigame.state === 'play', null, { timeout: 10000 });
  const r2 = await G();
  check(r2.round === 2 && r2.score === 0 && r2.t < 1, `again starts a fresh second round (round ${r2.round}, score ${r2.score}, t ${r2.t.toFixed(2)})`);
  // catch three, then fast-forward to the end
  let caught2 = 0;
  const tapped2 = new Set();
  while (caught2 < 3) {
    const s = await G();
    if (s.state !== 'play' || s.t > 20) break;
    const c = s.heads.filter((h) => h.catchable && h.k > 0.25 && !tapped2.has(h.id) && h.x > 4 && h.x < vp.width - 4 && h.y > 4 && h.y < vp.height - 4);
    if (!c.length) {
      await page.waitForTimeout(30);
      continue;
    }
    tapped2.add(c[0].id);
    await tapAt(c[0].x + c[0].vx * 0.05, c[0].y + c[0].vy * 0.05);
    caught2 = await page.evaluate(() => window.__minigame.score);
  }
  await page.evaluate(() => (window.__minigame.speed = 8));
  await page.waitForFunction(() => window.__minigame.state === 'result', null, { timeout: 120000 });
  await page.evaluate(() => (window.__minigame.speed = 1));
  const score2 = await page.evaluate(() => window.__minigame.score);
  await page.waitForTimeout(1800);
  await shot('6-result2');

  // 6. back: the quiz again, with the score
  await tapEl('#minigame .mg-back');
  await page.waitForFunction(() => window.__done !== null, null, { timeout: 10000 });
  const done = await page.evaluate(() => window.__done);
  check(done.score === score2, `onDone(${done.score}) fired with the second round's score (${score2})`);
  check((await page.evaluate(() => window.__moods.slice())).slice(-1)[0] === 'quiz', "onMood('quiz') on back");
  await page.waitForFunction(() => document.getElementById('minigame').hidden === true, null, { timeout: 5000 });
  check(await page.evaluate(() => !window.__minigame.active), 'root hidden and inactive after back');
  await shot('7-back');

  check(errors.length === 0, `no console errors (${errors.length})`);
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall good');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
