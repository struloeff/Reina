// Screenshots of the page (or a harness page) at chosen moments, at real device sizes.
//
//   node tools/shot.cjs ../index.html --times 2,9,14,26.3 --phone --out shots/run1
//   node tools/shot.cjs harness/earth.html --q "scene=globe" --times 0 --desktop --out shots/earth
//
// Options
//   --times a,b,c    one frame per time, loaded with ?t=<time>&freeze (plus --q)
//   --q "k=v&k2"     extra query string for every frame
//   --phone          390x844 @2x, touch      (default)
//   --small          360x740 @3x, touch
//   --landscape      844x390 @2x, touch
//   --desktop        1440x900 @1x
//   --wide           1920x1080 @1x
//   --w N --h N --dpr N    custom size
//   --out prefix     files are <prefix>-t<time>.png, plus <prefix>-sheet.png when there are several
//   --settle ms      wait after the page says it is ready (default 500)
//   --wait ms        instead of freezing, let it RUN this long after load, then shoot (use with --times 0)
//
// Page console errors and warnings are printed, so a blank frame always comes with a reason.
// WebGL runs on SwiftShader (software), so frames take a second or two each.

const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/wills/AppData/Roaming/npm/node_modules/gologin-agent-browser-cli/node_modules/playwright');

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i === -1 ? d : argv[i + 1];
};
const has = (k) => argv.includes(k);

const page = argv[0];
if (!page || page.startsWith('--')) {
  console.error('usage: node tools/shot.cjs <page.html|url> [--times 1,2] [--phone|--desktop|...] [--out prefix]');
  process.exit(2);
}

let vp = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
if (has('--small')) vp = { width: 360, height: 740, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
if (has('--landscape')) vp = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
if (has('--desktop')) vp = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
if (has('--wide')) vp = { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
if (opt('--w')) vp.width = +opt('--w');
if (opt('--h')) vp.height = +opt('--h');
if (opt('--dpr')) vp.deviceScaleFactor = +opt('--dpr');

const times = (opt('--times', '0') + '').split(',').map((s) => s.trim()).filter(Boolean);
const extra = opt('--q', '');
const settle = +opt('--settle', 500);
const runFor = opt('--wait') ? +opt('--wait') : null;
const outPrefix = path.resolve(opt('--out', 'shots/shot'));
fs.mkdirSync(path.dirname(outPrefix), { recursive: true });

const baseUrl = /^https?:|^file:/.test(page) ? page : 'file:///' + path.resolve(page).split(path.sep).join('/');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const files = [];
  for (const t of times) {
    const p = await ctx.newPage();
    p.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text()}`);
    });
    p.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    const q = [runFor === null ? `t=${t}&freeze` : t !== '0' ? `t=${t}` : '', extra].filter(Boolean).join('&');
    const url = baseUrl + (q ? (baseUrl.includes('?') ? '&' : '?') + q : '');
    const started = Date.now();
    await p.goto(url);
    try {
      await p.waitForFunction('window.__ready === true', null, { timeout: +opt('--timeout', 120000) });
    } catch {
      console.log('  [shot] page never set window.__ready - shooting anyway');
    }
    await p.waitForTimeout(runFor === null ? settle : runFor);
    const file = `${outPrefix}-t${t}.png`;
    await p.screenshot({ path: file });
    files.push({ t, file });
    console.log(`${file}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    await p.close();
  }
  if (files.length > 1) {
    const cols = Math.min(files.length, vp.width > vp.height ? 3 : 5);
    const cellW = vp.width > vp.height ? 480 : 260;
    const html = `<!doctype html><body style="margin:0;background:#222;font:12px monospace;color:#ddd">
      <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:6px;padding:6px">
      ${files.map((f) => `<figure style="margin:0"><img style="width:${cellW}px;display:block" src="file:///${f.file.split(path.sep).join('/')}"><figcaption>t=${f.t}</figcaption></figure>`).join('')}
      </div></body>`;
    const sheetHtml = `${outPrefix}-sheet.html`;
    fs.writeFileSync(sheetHtml, html);
    const p = await browser.newPage({ viewport: { width: cols * (cellW + 6) + 6, height: 400 }, deviceScaleFactor: 1 });
    await p.goto('file:///' + sheetHtml.split(path.sep).join('/'));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${outPrefix}-sheet.png`, fullPage: true });
    fs.unlinkSync(sheetHtml);
    console.log(`${outPrefix}-sheet.png`);
  }
  await browser.close();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
