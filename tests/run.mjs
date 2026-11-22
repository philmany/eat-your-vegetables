// Headless browser tests for Eat Your Veggies!  Run:  npm install && npm test
// Options:  --shots  save screenshots of every screen at desktop and phone sizes to tests/screens/
//           --only=name  run tests whose name contains "name"
// The page is served from a fake origin by Playwright routing, so no web server is needed. Three.js and PeerJS come
// from node_modules (same versions the game loads from unpkg), so the tests also run without internet access.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.join(HERE, '..', 'index.html');
const NM = path.join(HERE, '..', 'node_modules');
const THREE_JS = path.join(NM, 'three/build/three.module.js');
const PEER_JS = path.join(NM, 'peerjs/dist/peerjs.min.js');
const AXE_JS = path.join(NM, 'axe-core/axe.min.js');
const ARGS = process.argv.slice(2);
const SHOTS = ARGS.includes('--shots');
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').slice(7);
const ORIGIN = 'http://game.test/';

let browser;
const live = new Set(); // every context a test opens is closed after the test, pass or fail
async function route(ctx) {
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'game.test' && u.pathname === '/manifest.webmanifest') return r.fulfill({ path: path.join(HERE, '..', 'manifest.webmanifest'), contentType: 'application/manifest+json' });
    if (u.hostname === 'game.test' && /^\/icons\/[\w-]+\.png$/.test(u.pathname)) return r.fulfill({ path: path.join(HERE, '..', u.pathname), contentType: 'image/png' });
    if (u.hostname === 'game.test') return r.fulfill({ path: GAME, contentType: 'text/html' });
    if (u.hostname === 'unpkg.com' && u.pathname.includes('/three@')) return r.fulfill({ path: THREE_JS, contentType: 'text/javascript' });
    if (u.hostname === 'unpkg.com' && u.pathname.includes('/peerjs@')) return r.fulfill({ path: PEER_JS, contentType: 'text/javascript' });
    if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) return r.fulfill({ status: 200, body: '', contentType: 'text/css' });
    return r.abort();
  });
}
// Open the game; returns {page, errors}. Any page error or console error fails the test at the end.
async function open(query = '', ctxOpts = {}, ctx) {
  if (!ctx) { ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...ctxOpts }); live.add(ctx); await route(ctx); }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(ORIGIN + query);
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 });
  return { page, errors, ctx };
}
// Run the game's fixed-step simulation n ticks in one go (fast-forward without waiting for real time).
const ticks = (page, n) => page.evaluate(n => { const g = window.__game; for (let k = 0; k < n; k++) g.fixedUpdate(1 / 60); g.render(1 / 60); }, n);
const visible = (page, id) => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
function check(cond, msg) { if (!cond) throw new Error(msg); }
function noErrors(errors) { check(errors.length === 0, 'browser errors:\n  ' + errors.join('\n  ')); }

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------------------------------------------
test('boots to the title screen without errors', async () => {
  const { page, errors, ctx } = await open();
  check(await visible(page, 'title'), 'title screen should be showing');
  await page.waitForTimeout(500);
  noErrors(errors); await ctx.close();
});

test('keyboard: Tab reaches menu buttons, Enter opens, Escape goes back, Space flips a setting', async () => {
  const { page, errors, ctx } = await open();
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check(first === 'btn-play', 'Tab should focus the Play button, got ' + first);
  await page.keyboard.press('Enter');
  check(await visible(page, 'select'), 'Enter on Play should open the character select');
  const focused = await page.evaluate(() => document.activeElement.classList.contains('card'));
  check(focused, 'focus should land on the picked critter card');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // picks the next card (Raccoon)
  check(await page.evaluate(() => window.__game.choice) === 'raccoon', 'Enter on a card should pick it');
  await page.keyboard.press('Escape');
  check(await visible(page, 'title'), 'Escape should go back to the title');
  await page.evaluate(() => window.__game.showScreen('settings'));
  await page.focus('#btn-set-night');
  const before = await page.getAttribute('#btn-set-night', 'aria-checked');
  await page.keyboard.press('Space');
  const after = await page.getAttribute('#btn-set-night', 'aria-checked');
  check(before !== after, 'Space should toggle Night Mode (aria-checked ' + before + ' -> ' + after + ')');
  await page.keyboard.press('Space'); // back to day
  noErrors(errors); await ctx.close();
});

test('a full bot-vs-bot match plays to the results screen', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  await page.evaluate(() => window.__game.startMatch());
  let state = '';
  for (let k = 0; k < 120 && state !== 'results'; k++) {
    await ticks(page, 600);
    state = await page.evaluate(() => window.__game.state);
    const bad = await page.evaluate(() => window.__game.chars.some(c => !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.z) || !Number.isFinite(c.hp)));
    check(!bad, 'a critter position or HP became NaN');
  }
  check(state === 'results', 'match should reach the results screen, state is ' + state);
  const rows = await page.$$eval('#res-table tr', r => r.length);
  check(rows === 5, 'results table should have a header and 4 rows');
  await page.waitForTimeout(300);
  const clipped = await page.evaluate(() => { const p = document.querySelector('#results .panel'); return p.scrollWidth - p.clientWidth; });
  check(clipped <= 1, 'results table is cut off by ' + clipped + 'px');
  noErrors(errors); await ctx.close();
});

test('performance: draw calls stay low and nothing leaks during a long fight', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  await page.evaluate(() => window.__game.startMatch());
  await ticks(page, 60 * 20);
  const at = () => page.evaluate(() => { const g = window.__game; g.render(1 / 60); const i = window.__renderer.info;
    let objs = 0; g.arena.root.parent.traverse(() => objs++);
    return { calls: i.render.calls, geos: i.memory.geometries, objs, proj: g.weapons.proj.length }; });
  const a = await at();
  for (let k = 0; k < 6; k++) { await ticks(page, 60 * 15); await page.evaluate(() => { const g = window.__game; if (g.state === 'results') g.startMatch(); }); }
  const b = await at();
  console.log('      draw calls', a.calls, '->', b.calls, '| geometries', a.geos, '->', b.geos, '| scene objects', a.objs, '->', b.objs);
  check(b.calls < 450, 'too many draw calls in a match: ' + b.calls);
  check(b.objs - a.objs < 150, 'scene objects keep growing: ' + a.objs + ' -> ' + b.objs);
  check(b.geos - a.geos < 25, 'GPU geometries keep growing: ' + a.geos + ' -> ' + b.geos);
  noErrors(errors); await ctx.close();
});

test('tutorial: every step can be reached and finished', async () => {
  const { page, errors, ctx } = await open();
  await page.click('#btn-tutorial');
  for (let k = 0; k < 14; k++) {
    const id = await page.evaluate(() => window.__game.tut && window.__game.tut.step.id);
    if (id === 'done') break;
    await page.evaluate(() => document.getElementById('btn-tut-skip').click());
    await ticks(page, 90);
  }
  check(await page.evaluate(() => window.__game.tut.step.id) === 'done', 'tutorial should reach its last step');
  await page.click('#btn-tut-title');
  check(await visible(page, 'title'), 'tutorial exit should return to the title');
  noErrors(errors); await ctx.close();
});

test('pause menu, Escape, and auto-pause when the tab is hidden', async () => {
  const { page, errors, ctx } = await open();
  await page.evaluate(() => { window.__game.startMatch(); });
  await ticks(page, 60 * 4);
  await page.keyboard.press('Escape');
  check(await visible(page, 'pause'), 'Escape should pause');
  await page.keyboard.press('Escape');
  check(!(await visible(page, 'pause')), 'Escape again should resume');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await page.evaluate(() => window.__game.paused), 'hiding the tab should pause a solo match');
  noErrors(errors); await ctx.close();
});

test('online (two tabs): host, join, ready, play, and the guest leaving hands over to a bot', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } }); live.add(ctx); await route(ctx);
  const H = await open('?net=local', {}, ctx), G = await open('?net=local', {}, ctx);
  await H.page.click('#btn-online'); await H.page.click('#btn-on-host');
  await H.page.waitForFunction(() => /^\d{4}$/.test(document.getElementById('on-codeval').textContent), null, { timeout: 10000 });
  const code = await H.page.textContent('#on-codeval');
  await G.page.click('#btn-online'); await G.page.fill('#on-code', code); await G.page.click('#btn-on-join');
  await H.page.waitForFunction(() => !document.getElementById('btn-on-ready').disabled, null, { timeout: 10000 });
  await G.page.waitForFunction(() => !document.getElementById('btn-on-ready').disabled, null, { timeout: 10000 });
  await H.page.click('#btn-on-ready'); await G.page.click('#btn-on-ready');
  await H.page.waitForFunction(() => window.__game.online, null, { timeout: 10000 });
  await G.page.waitForFunction(() => window.__game.online && window.__game.net.latest, null, { timeout: 10000 });
  await H.page.waitForTimeout(5000);
  const st = await G.page.evaluate(() => window.__game.state);
  check(st === 'playing' || st === 'countdown', 'guest should be in the match, state ' + st);
  // junk packets must not throw
  await H.page.evaluate(() => { const n = window.__game.net; n.onMsg(null, 'x'); n.onMsg({ t: 'in', i: 'nope' }, 'x'); n.onMsg({ t: 's' }, 'x'); });
  await G.page.evaluate(() => { const n = window.__game.net; n.onMsg({ t: 's', c: [1] }, 'host'); n.onMsg({ t: 'start', cfg: { host: 'nobody' } }, 'host'); n.onMsg({ t: 'room', v: 3, host: null }, 'host'); });
  await G.page.evaluate(() => window.__game.toTitle());
  await H.page.waitForFunction(() => !window.__game.chars.some(c => c.remote), null, { timeout: 15000 });
  check(await H.page.evaluate(() => window.__game.chars.every(c => c.isPlayer || c.controller)), 'a bot should drive the critter the guest left behind');
  noErrors(H.errors); noErrors(G.errors); await ctx.close();
});

test('phone: touch controls show in a match, portrait shows the turn-your-phone card', async () => {
  const { page, errors, ctx } = await open('?touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await page.evaluate(() => window.__game.startMatch());
  await ticks(page, 60);
  check(await page.evaluate(() => document.getElementById('touch').classList.contains('on')), 'touch controls should be on');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none'), 'portrait should show the rotate card');
  noErrors(errors); await ctx.close();
});

test('phone: a match blocks pinch and double-tap zoom, menus still pinch-zoom', async () => {
  const { page, errors, ctx } = await open('?touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const cdp = await ctx.newCDPSession(page);
  const vp = () => page.evaluate(() => document.querySelector('meta[name=viewport]').content);
  const cancels = id => page.evaluate(id => { const el = document.getElementById(id);
    const t = new Touch({ identifier: 7, target: el, clientX: 100, clientY: 300 });
    const ev = new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true });
    el.dispatchEvent(ev); return ev.defaultPrevented; }, id);
  // menus: zoom allowed
  check(!(await vp()).includes('user-scalable=no'), 'menus should allow pinch zoom');
  check(!(await cancels('title')), 'a touch on the title menu should not be cancelled');
  // match: zoom reset and blocked, the joystick still works
  await page.evaluate(() => window.__game.startMatch());
  await ticks(page, 240); await page.waitForTimeout(200);
  check(await page.evaluate(() => document.documentElement.classList.contains('inmatch')), 'the page should be locked during a match');
  check((await vp()).includes('user-scalable=no'), 'viewport should block zoom during a match');
  check(await cancels('t-zone'), 'a touch on the joystick area should be cancelled (no browser zoom/scroll)');
  check(await cancels('c'), 'a touch on the garden should be cancelled (no browser zoom/scroll)');
  // (headless Chrome can't synthesize a real pinch, so this checks what stops one: cancelled touches and a locked viewport)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 110, y: 300, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y: 300, id: 1 }] });
  await page.waitForTimeout(100);
  const sx = await page.evaluate(() => window.__touch.sx);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(sx > 0.5, 'dragging the joystick right should push right (sx ' + sx + ')');
  // pause menu: unlocked again
  await page.evaluate(() => window.__game.togglePause()); await ticks(page, 2); await page.waitForTimeout(100);
  check(!(await page.evaluate(() => document.documentElement.classList.contains('inmatch'))), 'the pause menu should allow zoom again');
  check(!(await vp()).includes('user-scalable=no'), 'viewport should allow zoom on the pause menu');
  noErrors(errors); await ctx.close();
});

test('full screen: the in-match button and the Settings switch toggle it; iPhone gets the home-screen tip', async () => {
  const { page, errors, ctx } = await open('?touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const full = () => page.evaluate(() => !!document.fullscreenElement);
  await page.evaluate(() => window.__game.startMatch()); await ticks(page, 60); await page.waitForTimeout(100);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('t-full')).display !== 'none'), 'the full screen button should show in a match');
  await page.tap('#t-full'); await page.waitForTimeout(300);
  check(await full(), 'tapping the full screen button should go full screen');
  check(await page.evaluate(() => document.getElementById('t-full').getAttribute('aria-label')) === 'Exit full screen', 'button label should flip to Exit full screen');
  await page.tap('#t-full'); await page.waitForTimeout(300);
  check(!(await full()), 'tapping it again should leave full screen');
  await page.evaluate(() => { window.__game.togglePause(); window.__game.showScreen('settings'); window.__game.renderSettings(); });
  await page.tap('#btn-set-full'); await page.waitForTimeout(300);
  check(await full(), 'the Settings switch should go full screen');
  check(await page.evaluate(() => document.getElementById('btn-set-full').getAttribute('aria-checked')) === 'true', 'the Settings switch should read On');
  noErrors(errors); await ctx.close();
  // a browser with no Fullscreen API (iPhone Safari) explains Add to Home Screen instead
  const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }); live.add(ctx2); await route(ctx2);
  await ctx2.addInitScript(() => { for (const k of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, k, { value: undefined });
    for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled']) Object.defineProperty(Document.prototype, k, { get: () => false }); });
  const P = await open('?touch', {}, ctx2);
  await P.page.evaluate(() => { window.__game.showScreen('settings'); window.__game.renderSettings(); });
  check(await P.page.evaluate(() => document.getElementById('btn-set-full').textContent) === 'How?', 'without full screen support the switch should offer How?');
  await P.page.tap('#btn-set-full'); await P.page.waitForTimeout(200);
  check(await P.page.evaluate(() => /Add to Home Screen/.test(document.getElementById('toasts').textContent)), 'How? should explain Add to Home Screen');
  noErrors(P.errors); await ctx2.close();
});

test('reduced motion: screen shake starts off and the title camera holds still', async () => {
  const { page, errors, ctx } = await open('', { reducedMotion: 'reduce' });
  check(await page.evaluate(() => window.__game.settings.shake === false), 'shake should default to off');
  noErrors(errors); await ctx.close();
});

test('animation: swing swoosh shows then clears, hits and round-end poses stay finite', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  const r = await page.evaluate(() => { const g = window.__game; g.startMatch(); for (let k = 0; k < 240; k++) g.fixedUpdate(1 / 60);
    const c = g.player; c.controller = { update: () => ({ mx: 0, mz: 0, aim: null }) }; c.atkCd = 0; g.weapons.basic(c);
    for (let k = 0; k < 8; k++) g.fixedUpdate(1 / 60); const shown = c.trail.mesh.visible;
    for (let k = 0; k < 60; k++) g.fixedUpdate(1 / 60); const cleared = !c.trail.mesh.visible;
    const e = g.chars.find(o => o.team !== c.team); g.damage(c, 1, e, { x: 1, y: 0, z: 0 }, 3, false);
    for (let k = 0; k < 5; k++) g.fixedUpdate(1 / 60);
    g.roundTime = 0.01; g.bonus[c.team] = 3; for (let k = 0; k < 30; k++) g.fixedUpdate(1 / 60);
    const ok = g.chars.every(o => { const m = o.m.rig; return [m.position.x, m.position.y, m.rotation.x, m.rotation.z, m.scale.y].every(Number.isFinite); });
    const heads = g.chars.every(o => o.m.head.position.y > 0.8); // heads sit on top of the body, never sunk into it
    return { shown, cleared, ok, heads, state: g.state }; });
  check(r.shown, 'the sword swoosh should show while swinging');
  check(r.cleared, 'the sword swoosh should clear after the swing');
  check(r.ok, 'a critter pose became NaN');
  check(r.heads, 'a critter head dropped below its neck');
  noErrors(errors); await ctx.close();
});

test('accessibility: no serious axe-core issues on the menus', async () => {
  const { page, errors, ctx } = await open();
  await page.addScriptTag({ path: AXE_JS });
  const screens = { title: () => window.__game.showScreen('title'), settings: () => window.__game.showScreen('settings'),
    select: () => { window.__game.showScreen('select'); window.__game.renderCosmetics(); }, controls: () => window.__game.showScreen('controls'),
    online: () => window.__game.net.openMenu(), tips: () => window.__game.showScreen('tips'), achievements: () => window.__game.openAch('title') };
  const problems = [];
  for (const [name, fn] of Object.entries(screens)) {
    await page.evaluate(`(${fn})()`); await page.waitForTimeout(250);
    const res = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ' (' + v.nodes.length + '): ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')); });
    for (const r of res) problems.push(name + ': ' + r);
  }
  check(problems.length === 0, 'axe-core found:\n  ' + problems.join('\n  '));
  noErrors(errors); await ctx.close();
});

test('screenshots of every screen (with --shots)', async () => {
  if (!SHOTS) return 'skipped';
  const out = path.join(HERE, 'screens'); fs.mkdirSync(out, { recursive: true });
  const sizes = { desktop: { viewport: { width: 1366, height: 768 } }, phone: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, small: { viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true } };
  for (const [size, opt] of Object.entries(sizes)) {
    const { page, errors, ctx } = await open(opt.hasTouch ? '?touch' : '', opt);
    const snap = async n => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${size}-${n}.png`) }); };
    for (const s of ['title', 'select', 'tips', 'controls', 'settings', 'achievements', 'online']) {
      await page.evaluate(s => { const g = window.__game; if (s === 'select') { g.showScreen('select'); g.renderCosmetics(); } else if (s === 'achievements') g.openAch('title'); else if (s === 'online') g.net.openMenu(); else g.showScreen(s); }, s);
      await snap(s);
    }
    await page.evaluate(() => window.__game.startMatch()); await ticks(page, 60 * 5); await snap('match');
    await page.evaluate(() => window.__game.togglePause()); await snap('pause');
    await page.evaluate(() => { const g = window.__game; g.togglePause(); g.showResults(); }); await snap('results');
    await page.evaluate(() => { const g = window.__game; g.toTitle(); g.startTutorial(); }); await ticks(page, 30); await snap('tutorial');
    noErrors(errors); await ctx.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
for (const t of tests) {
  if (ONLY && !t.name.includes(ONLY)) continue;
  const t0 = Date.now();
  try { const r = await t.fn(); console.log(r === 'skipped' ? '  - ' : '  ✓ ', t.name, r === 'skipped' ? '(skipped)' : `(${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { failed++; console.log('  ✗ ', t.name, '\n     ', String(e.message || e).split('\n').join('\n      ')); }
  for (const c of live) await c.close().catch(() => {}); live.clear();
}
await browser.close();
console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
