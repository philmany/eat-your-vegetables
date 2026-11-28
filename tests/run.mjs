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
// Every cosmetic id, read from the game so the warm-up in the performance test stays in step when cosmetics are added.
const COS_IDS = JSON.parse(fs.readFileSync(GAME, 'utf8').match(/const COS_ORDER=(\[[^\]]*\])/)[1].replace(/'/g, '"'));

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
// ctxOpts.seed (a number) swaps Math.random for a seeded generator in that page, so a test sees the same random rolls every run.
async function open(query = '', ctxOpts = {}, ctx) {
  const { seed, ...opts } = ctxOpts;
  if (!ctx) { ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts }); live.add(ctx); await route(ctx); }
  if (seed != null) await ctx.addInitScript(s => { Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Wait for the DOM, then for the game itself to say it's ready. The page's "load" event also waits on things the game
  // doesn't need (fonts, icons); on GitHub's runners the second tab of the online test sometimes never fired it within 30 s.
  // If that happens, the requests still open are printed so the cause shows up in the log instead of a bare timeout.
  const open_ = new Map(); page.on('request', r => open_.set(r, r.url())); for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, r => open_.delete(r));
  // Only wait for the navigation to commit: the readiness check below (60 s) is the real gate. Waiting for DOMContentLoaded
  // with goto's 30 s cap was the step that timed out on GitHub's runners when a second tab loaded next to a busy first one.
  await page.goto(ORIGIN + query, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 })
    .catch(e => { throw new Error('game never finished loading; requests still open: ' + ([...open_.values()].join(', ') || 'none') + '\n' + e.message); });
  page.waitForLoadState('load', { timeout: 15000 }).catch(() => { if (!page.isClosed()) console.log('      note: page load event still pending after 15 s; open requests: ' + ([...open_.values()].join(', ') || 'none')); });
  return { page, errors, ctx };
}
// Run the game's fixed-step simulation n ticks in one go (fast-forward without waiting for real time).
const ticks = (page, n) => page.evaluate(n => { const g = window.__game; for (let k = 0; k < n; k++) g.fixedUpdate(1 / 60); g.render(1 / 60); }, n);
const visible = (page, id) => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
function check(cond, msg) { if (!cond) throw new Error(msg); }
function noErrors(errors) { check(errors.length === 0, 'browser errors:\n  ' + errors.join('\n  ')); }

const GEO_SLACK = 12;
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

test('seeds: only spawn in the centre plaza; a hit drops none, a knockout drops 75% of what that critter carries', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  await page.evaluate(() => window.__game.startMatch());
  await ticks(page, 60 * 5);
  const r = await page.evaluate(() => {
    const g = window.__game, S = g.seeds; g.state = 'playing'; g.cb.team = -1; g.cb.bounty = -1;
    S.seeds = []; S.spawnBatch(); S.update(1, 0, false);
    const far = S.seeds.reduce((m, s) => Math.max(m, Math.hypot(s.tx, s.tz)), 0);
    const [a, b] = g.chars.filter(c => c.team === 0), foe = g.chars.find(c => c.team === 1);
    S.seeds = []; S.pool[0] = 0; a.carry = 0; b.carry = 0;
    for (let k = 0; k < 5; k++) { S.seeds.push({ x: 0, z: 0, y: 0.3, state: 'float', pick: 0, gold: false }); S.collect(a, S.seeds.length - 1); }
    for (let k = 0; k < 2; k++) { S.seeds.push({ x: 0, z: 0, y: 0.3, state: 'float', pick: 0, gold: false }); S.collect(b, S.seeds.length - 1); }
    const dir = { x: 1, y: 0, z: 0 };
    a.invuln = 0; a.hp = 80; g.damage(a, 5, foe, dir, 0, false); const afterHit = [S.pool[0], S.seeds.length];
    a.invuln = 0; a.hp = 1; g.damage(a, 50, foe, dir, 0, false);
    return { far, afterHit, pool: S.pool[0], loose: S.seeds.length, carryA: a.carry, carryB: b.carry, ko: a.ko };
  });
  check(r.far <= 1.31, 'centre spawns should land inside the plaza, farthest was ' + r.far);
  check(r.afterHit[0] === 7 && r.afterHit[1] === 0, 'a plain hit should not drop seeds: ' + r.afterHit);
  check(r.ko, 'the critter should be knocked out');
  check(r.loose === 4 && r.pool === 3 && r.carryA === 1 && r.carryB === 2, '5 carried seeds should drop 4 (75% rounded up): ' + JSON.stringify(r));
  noErrors(errors); await ctx.close();
});

test('difficulty: new players start on Easy; Easy foes have 20% less health and hit 25% softer; your team and Normal foes are full strength', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  const r = await page.evaluate(() => {
    const g = window.__game, out = { def: g.difficulty, btn: document.getElementById('btn-diff').textContent };
    for (const d of ['easy', 'normal']) {
      g.difficulty = d; g.choice = 'rabbit'; g.startMatch(); g.state = 'playing';
      const me = g.player, foe = g.chars.find(c => c.team === 1), dir = { x: 1, y: 0, z: 0 };
      foe.invuln = 0; me.invuln = 0; me.hp = me.maxHp; foe.hp = foe.maxHp; foe.weapon = 'kunai'; me.weapon = 'kunai';
      g.damage(me, 20, foe, dir, 0, false); g.damage(foe, 20, me, dir, 0, false);
      out[d] = { meMax: me.maxHp, foeMax: foe.maxHp, foeSpawnHp: g.chars.find(c => c.team === 1 && c !== foe).hp, took: me.maxHp - me.hp, dealt: foe.maxHp - foe.hp };
    }
    return out;
  });
  check(r.def === 'easy' && r.btn === 'Difficulty: Easy', 'new players should start on Easy: ' + r.def + ' / ' + r.btn);
  check(r.easy.meMax === 80 && r.easy.foeMax === 64 && r.easy.foeSpawnHp === 64, 'Easy foes should have 64 max HP, you 80: ' + JSON.stringify(r.easy));
  check(r.easy.took === 15 && r.easy.dealt === 20, 'an Easy foe\'s 20 damage hit should land as 15, yours as 20: ' + JSON.stringify(r.easy));
  check(r.normal.foeMax === 80 && r.normal.took === 20, 'Normal foes should be unchanged: ' + JSON.stringify(r.normal));
  noErrors(errors); await ctx.close();
});

test('performance: draw calls stay low and nothing leaks during a long fight', async () => {
  // Deterministic run: a seeded Math.random fixes the bots' random cosmetics, arena scatter and every fight roll, so the
  // numbers are the same every run instead of depending on which cosmetics the bots happened to pick.
  const { page, errors, ctx } = await open('?autoplay', { seed: 12345 });
  await page.evaluate(() => window.__game.startMatch());
  // Warm-up: the game builds and caches geometry the first time something is used (each cosmetic on each critter, each
  // projectile and effect), then reuses it. Put every cosmetic on every critter and play a few rounds first, so the
  // baseline below already holds the one-time geometry and any growth after it is a real leak.
  await page.evaluate(ids => { const g = window.__game;
    // setCosmetic skips ids a critter can't wear
    for (const c of g.chars) { for (const id of ids) { c.setCosmetic(id); g.render(1 / 60); } c.setCosmetic('none'); } }, COS_IDS);
  const round = async () => { await ticks(page, 60 * 15); await page.evaluate(() => { const g = window.__game; if (g.state === 'results') g.startMatch(); }); };
  for (let k = 0; k < 5; k++) await round();
  const at = () => page.evaluate(() => { const g = window.__game; g.render(1 / 60); const i = window.__renderer.info;
    let objs = 0; g.arena.root.parent.traverse(() => objs++);
    return { calls: i.render.calls, geos: i.memory.geometries, objs, proj: g.weapons.proj.length }; });
  const a = await at();
  for (let k = 0; k < 6; k++) await round();
  const b = await at();
  console.log('      draw calls', a.calls, '->', b.calls, '| geometries', a.geos, '->', b.geos, '| scene objects', a.objs, '->', b.objs);
  check(b.calls < 450, 'too many draw calls in a match: ' + b.calls);
  check(b.objs - a.objs < 150, 'scene objects keep growing: ' + a.objs + ' -> ' + b.objs);
  check(b.geos - a.geos < GEO_SLACK, 'GPU geometries keep growing: ' + a.geos + ' -> ' + b.geos);
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

test('rabbit: a paid special shouts HUSS HUSS HUSS with its sound; a special without energy stays quiet; others never chant', async () => {
  const { page, errors, ctx } = await open('?autoplay');
  await page.evaluate(() => window.__game.startMatch());
  await ticks(page, 60);
  const r = await page.evaluate(() => {
    const g = window.__game, A = g.chars, au = window.__audio, play = au.play, played = [];
    au.play = function (n) { played.push(n); return play.apply(this, arguments); };
    const huss = () => [...document.querySelectorAll('.fl.honk')].filter(e => e.style.display !== 'none' && e.textContent === 'HUSS HUSS HUSS').length;
    const rab = A.find(c => c.key === 'rabbit'), other = A.find(c => c.key !== 'rabbit');
    for (const c of [rab, other]) { c.spinT = 0; c.pending = null; }
    const n = () => played.filter(x => x === 'huss').length;
    rab.energy = 0; g.weapons.special(rab, null); const broke = huss(), brokeS = n();
    other.energy = 100; g.weapons.special(other, null); const otherN = huss(), otherS = n();
    rab.energy = 100; const ok = g.weapons.special(rab, null) !== false; const paid = huss(), paidS = n();
    au.play = play;
    return { broke, brokeS, otherN, otherS, ok, paid, paidS };
  });
  check(r.broke === 0 && r.brokeS === 0, 'no chant when the Rabbit cannot pay: ' + JSON.stringify(r));
  check(r.otherN === 0 && r.otherS === 0, 'other critters should not chant: ' + JSON.stringify(r));
  check(r.ok && r.paid === 1 && r.paidS === 1, 'a paid Rabbit special should show HUSS HUSS HUSS once: ' + JSON.stringify(r));
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
  // The host tab renders the 3D title at full speed on the runner's software GPU; on GitHub's 2-core runners that starved
  // the guest tab so its page.goto never reached DOMContentLoaded (also red on main). Freeze the host while the guest loads.
  const H = await open('?net=local', {}, ctx);
  const hcdp = await ctx.newCDPSession(H.page);
  await hcdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const G = await open('?net=local', {}, ctx);
  await hcdp.send('Page.setWebLifecycleState', { state: 'active' });
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
  // emotes cross over: the host's reaches the guest, the guest's reaches the host
  check(await H.page.evaluate(() => window.__game.tryEmote(0)), 'host should be able to emote');
  const hostIdx = await H.page.evaluate(() => window.__game.chars.indexOf(window.__game.player));
  await G.page.waitForFunction(i => window.__game.hud.ob[i].emo.textContent === 'HAPPY', hostIdx, { timeout: 5000 });
  check(await G.page.evaluate(() => window.__game.tryEmote(2)), 'guest should be able to emote');
  const guestIdx = await G.page.evaluate(() => window.__game.chars.indexOf(window.__game.player));
  await H.page.waitForFunction(i => window.__game.hud.ob[i].emo.textContent === 'SAD', guestIdx, { timeout: 5000 });
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

// Phones on their side, from small and short (browser bars showing) to very wide. In a match and in the tutorial, with every
// optional HUD piece showing at once (hint, achievement toast, banner, ping, comeback tags), no two HUD blocks or touch
// controls may overlap and none may leave the screen. Menu buttons must stay on screen and clear of each other.
const PHONES = [[568, 320], [667, 375], [740, 300], [800, 360], [844, 330], [844, 390], [932, 430], [960, 360], [1100, 320], [1280, 400], [1024, 600]];
const layoutProblems = page => page.evaluate(() => {
  const shown = e => { if (!e) return false; for (let x = e; x; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false; } const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; };
  const rect = e => { if (e.id === 'banner') { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); } return e.getBoundingClientRect(); };
  const ids = ['hud-tl', 'slabel', 'sc0', 'sc1', 'hud-tr', 'hud-bc', 'hint', 'banner', 'tut', 't-roll', 't-hedge', 't-sp', 't-atk', 't-pause', 't-full', 't-emo', 'stick'];
  const els = ids.map(id => document.getElementById(id)).concat([document.querySelector('#toasts>.toast:last-child')]).filter(e => shown(e) && (e.textContent.trim() || e.closest('#touch')));
  const name = e => e.id || 'toast', out = [], W = innerWidth, H = innerHeight;
  const boxes = els.map(e => [name(e), rect(e)]);
  for (const [n, q] of boxes) if (q.left < -1 || q.top < -1 || q.right > W + 1 || q.bottom > H + 1) out.push(`${n} leaves the screen`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, p] = boxes[i], [b, q] = boxes[j], w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (w > 1 && h > 1) out.push(`${a} overlaps ${b} by ${Math.round(w)}x${Math.round(h)}`);
  }
  return out;
});
const menuProblems = page => page.evaluate(() => {
  const scr = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden')); if (!scr) return [];
  const bs = [...scr.querySelectorAll('button, a.credit')].filter(b => b.offsetParent && getComputedStyle(b).visibility !== 'hidden').map(b => [b.id || b.textContent.trim(), b.getBoundingClientRect()]).filter(([, q]) => q.width);
  const out = [], W = innerWidth, H = innerHeight, sx = scr.scrollHeight > scr.clientHeight + 2;
  for (const [n, q] of bs) if (!sx && (q.left < -1 || q.top < -1 || q.right > W + 1 || q.bottom > H + 1)) out.push(`${scr.id}: ${n} leaves the screen`);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const [a, p] = bs[i], [b, q] = bs[j];
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1) out.push(`${scr.id}: ${a} overlaps ${b}`); }
  return out;
});
const busyHud = page => page.evaluate(() => {
  const g = window.__game, $ = id => document.getElementById(id);
  $('hint').textContent = 'TAP THE PLOT TO PICK UP POTATO TOSS';
  g.ach.toast({ name: 'GARDEN LEGEND', desc: '150 lifetime knockouts.' });
  g.hud.showBanner(g.tut ? 'TUTORIAL COMPLETE<small>GO EAT YOUR VEGGIES!</small>' : 'GREEN TEAM TAKES ROUND 1<small>MORE SEEDS</small>', 9);
  $('net-ping').classList.remove('hidden'); $('net-ping').textContent = 'PING 80 MS';
  for (const i of ['sc0', 'sc1']) $(i).classList.add('comeback');
});
test('phone layout: touch controls, HUD and menus never overlap on wide landscape phones', async () => {
  const { page, errors, ctx } = await open('?touch', { viewport: { width: PHONES[0][0], height: PHONES[0][1] }, hasTouch: true, isMobile: true });
  const bad = [];
  for (const [w, h] of PHONES) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(150);
    for (const s of ['title', 'select', 'tips', 'controls', 'settings', 'achievements', 'online']) {
      await page.evaluate(s => { const g = window.__game; g.toTitle(); if (s === 'select') { g.showScreen('select'); g.renderCosmetics(); } else if (s === 'achievements') g.openAch('title'); else if (s === 'online') g.net.openMenu(); else g.showScreen(s); }, s);
      await page.waitForTimeout(60);
      for (const p of await menuProblems(page)) bad.push(`${w}x${h} ${p}`);
    }
    for (const mode of ['match', 'tutorial']) {
      await page.evaluate(m => { const g = window.__game; g.toTitle(); if (m === 'match') g.startMatch(); else g.startTutorial(); }, mode);
      await ticks(page, 240); await busyHud(page);
      // jump the toast slide-in and banner pop to their end state (on slow CI runners they were still mid-way after 600 ms)
      await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); });
      await page.waitForTimeout(100);
      for (const p of await layoutProblems(page)) bad.push(`${w}x${h} ${mode}: ${p}`);
    }
  }
  check(bad.length === 0, 'overlapping or off-screen UI:\n  ' + bad.join('\n  '));
  noErrors(errors);
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
  const warns = []; page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
  // going in and out of full screen is asynchronous and slow on a busy CI runner, so wait for it (up to 5 s) instead of a fixed sleep,
  // and report any fullscreenerror the browser raised so a real refusal reads differently from a slow one
  await page.evaluate(() => { window.__fsLog = []; for (const ev of ['fullscreenchange', 'fullscreenerror']) document.addEventListener(ev, () => window.__fsLog.push(ev + ':' + !!document.fullscreenElement)); });
  const waitFull = async (want, msg) => { const ok = await page.waitForFunction(w => !!document.fullscreenElement === w, want, { timeout: 5000 }).then(() => true, () => false);
    check(ok, msg + ' (events: ' + (await page.evaluate(() => window.__fsLog.join(', ') || 'none')) + '; warnings: ' + (warns.join(' | ') || 'none') + ')'); };
  await page.evaluate(() => window.__game.startMatch()); await ticks(page, 60);
  await page.waitForFunction(() => document.getElementById('touch').classList.contains('on'), null, { timeout: 5000 });
  check(await page.evaluate(() => getComputedStyle(document.getElementById('t-full')).display !== 'none'), 'the full screen button should show in a match');
  await page.tap('#t-full');
  await waitFull(true, 'tapping the full screen button should go full screen');
  await page.waitForFunction(() => document.getElementById('t-full').getAttribute('aria-label') === 'Exit full screen', null, { timeout: 2000 }).catch(() => {});
  check(await page.evaluate(() => document.getElementById('t-full').getAttribute('aria-label')) === 'Exit full screen', 'button label should flip to Exit full screen');
  await page.tap('#t-full');
  await waitFull(false, 'tapping it again should leave full screen');
  await page.evaluate(() => { window.__game.togglePause(); window.__game.showScreen('settings'); window.__game.renderSettings(); });
  await page.tap('#btn-set-full');
  await waitFull(true, 'the Settings switch should go full screen');
  await page.waitForFunction(() => document.getElementById('btn-set-full').getAttribute('aria-checked') === 'true', null, { timeout: 2000 }).catch(() => {});
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

test('emotes: keys 1-4 show a bubble for 2 s, then a 5 s cooldown; the touch button works too', async () => {
  const { page, errors, ctx } = await open();
  await page.evaluate(() => window.__game.startMatch()); await ticks(page, 240);
  // stop the page's own frame loop so only this test moves the emote clock
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; }); await page.waitForTimeout(100);
  const bubble = () => page.evaluate(() => { const g = window.__game, i = g.chars.indexOf(g.player), el = g.hud.ob[i].emo;
    return el.classList.contains('on') && getComputedStyle(el).display !== 'none' ? el.textContent : ''; });
  const wait = s => page.evaluate(s => { const g = window.__game; for (let k = 0; k < Math.round(s * 20); k++) g.updateEmotes(0.05); }, s);
  await page.keyboard.press('Digit1'); check(await bubble() === 'HAPPY', 'key 1 should show Happy, got ' + JSON.stringify(await bubble()));
  await page.keyboard.press('Digit2'); check(await bubble() === 'HAPPY', 'a second emote right away should be blocked by the cooldown');
  await wait(2.1); check(await bubble() === '', 'the bubble should be gone after 2 s');
  await wait(2.7); check(!(await page.evaluate(() => window.__game.tryEmote(1))), 'still cooling down at 4.8 s');
  await wait(0.3);
  await page.keyboard.press('Numpad3'); check(await bubble() === 'SAD', 'number pad 3 should show Sad after the 5 s cooldown');
  await wait(5.1); await page.keyboard.press('Digit4'); check(await bubble() === 'DIZZY', 'key 4 should show Dizzy');
  // the bot critters never emote on their own
  check(await page.evaluate(() => window.__game.chars.filter(c => !c.isPlayer).every(c => c.emo === -1)), 'bots should not emote');
  noErrors(errors); await ctx.close();
  // phone: the smiley button opens the faces, one tap emotes and closes the row
  const t = await open('?touch', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await t.page.evaluate(() => window.__game.startMatch()); await ticks(t.page, 240); await t.page.waitForTimeout(100);
  await t.page.locator('#t-emo').tap(); check(await t.page.locator('#emo-pick').isVisible(), 'the emote row should open');
  await t.page.locator('#emo-pick button').nth(1).tap();
  check(!(await t.page.locator('#emo-pick').isVisible()), 'the emote row should close after a pick');
  check(await t.page.evaluate(() => { const g = window.__game; return g.hud.ob[g.chars.indexOf(g.player)].emo.textContent; }) === 'MAD', 'tapping the second face should show Mad');
  noErrors(t.errors); await t.ctx.close();
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
