// Balance simulation for Eat Your Veggies!  Run:  npm run sim  (options: --n=40 matches per cell, --par=4 browsers in parallel)
// Plays whole offline matches headless and fast-forwarded (no rendering), then prints win rates.
// "You" is driven by the game's own bot brain, using every control the bots use: move, attack, dodge, specials,
// Bulwark, hedges, seed and berry pickups, weapon plots. Two skill levels stand in for real players:
//   competent = knows all the controls (Normal-bot smarts)   novice = just picked the game up (Easy-bot smarts)
//   rookie    = first few matches: slower and sloppier than an Easy bot, rarely dodges, specials or hedges
// Bots react instantly to everything on screen, so even "rookie" plays tighter than a real first-timer; treat the
// numbers as a comparison between versions, not as a promise of a human's win rate.
// Your teammate is always a Normal bot, as in the real game. Matches rotate through all four critters and both modes.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = process.env.GAME || path.join(HERE, '..', 'index.html'); // GAME=old.html npm run sim compares another version
const NM = path.join(HERE, '..', 'node_modules');
const ARGS = process.argv.slice(2);
const arg = (k, d) => { const a = ARGS.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const N = +arg('n', 40), PAR = +arg('par', 4);
const PLAYERS = arg('players', 'competent,novice,rookie').split(',');
const DIFFS = arg('diffs', 'easy,normal,hard').split(',');
// Fixed player profiles, so changing the game's own bot tables never changes "you" (copied from the pre-PR-27 Normal and Easy bots).
const COMPETENT = { react: 0.3, aim: 0.16, aggr: 0.62, atkDelay: 0.2, dodge: 0.35, special: 0.45, lead: 0.5, hedge: 0.5, think: 0.3, greed: 1, focus: 0.5 };
const NOVICE = { react: 0.7, aim: 0.5, aggr: 0.3, atkDelay: 0.8, dodge: 0.06, special: 0.12, lead: 0, hedge: 0.15, think: 0.6, greed: 0, focus: 0 };
const ROOKIE = { label: 'Rookie', react: 1.0, aim: 0.7, aggr: 0.35, atkDelay: 0.9, dodge: 0.03, special: 0.08, lead: 0, hedge: 0.05, think: 0.9, greed: 0, focus: 0 };
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};

async function route(ctx) {
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'game.test') return r.fulfill({ path: GAME, contentType: 'text/html' });
    if (u.hostname === 'unpkg.com' && u.pathname.includes('/three@')) return r.fulfill({ path: path.join(NM, 'three/build/three.module.js'), contentType: 'text/javascript' });
    if (u.hostname === 'unpkg.com' && u.pathname.includes('/peerjs@')) return r.fulfill({ path: path.join(NM, 'peerjs/dist/peerjs.min.js'), contentType: 'text/javascript' });
    if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) return r.fulfill({ status: 200, body: '', contentType: 'text/css' });
    return r.abort();
  });
}

// One match inside the page. Returns {win, rounds:[us,them], ko:[us,them], dmgDealt, dmgTaken}.
function playMatch({ diff, player, key, mode, PROFILE }) {
  const g = window.__game, CH = ['rabbit', 'raccoon', 'goose', 'possum'];
  g.difficulty = diff; g.choice = key; g.modeSP = mode; g.startMatch();
  const me = g.player, ally = g.chars.find(c => c !== me && c.team === me.team).controller;
  me.controller = new ally.constructor(g, me, 'normal'); me.controller.p = PROFILE; // the bot brain as "you"
  me.maxHp = 80; me.atkMul = 1; me.hp = 80;
  const ko = [0, 0], dmg = [0, 0];
  let t = 0;
  while (g.state !== 'results' && t < 60 * 60 * 20) {
    const before = g.chars.map(c => c.stats.ko), dm = g.chars.map(c => c.stats.dmg);
    g.fixedUpdate(1 / 60); t++;
    g.chars.forEach((c, i) => { const side = c.team === me.team ? 0 : 1; ko[side] += c.stats.ko - before[i]; dmg[side] += c.stats.dmg - dm[i]; });
  }
  const us = g.wins[me.team], them = g.wins[1 - me.team];
  return { win: us > them ? 1 : us < them ? -1 : 0, rounds: [us, them], ko, dmg, ticks: t, myKo: me.stats.ko, myDeaths: me.stats.deaths };
}

const jobs = [];
for (const player of PLAYERS) for (const diff of DIFFS) for (let i = 0; i < N; i++)
  jobs.push({ PROFILE: { competent: COMPETENT, novice: NOVICE, rookie: ROOKIE }[player], player, diff, key: ['rabbit', 'raccoon', 'goose', 'possum'][i % 4], mode: i % 8 < 4 ? 'seeds' : 'tdm' });

const browser = await chromium.launch({ ...exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const t0 = Date.now();
async function worker() {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } }); await route(ctx);
  const page = await ctx.newPage(); page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://game.test/?autoplay', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 });
  await page.evaluate(() => { window.__game.render = () => {}; try { localStorage.setItem('eyv-tips-off', '1'); } catch (e) {} });
  while (jobs.length) { const j = jobs.shift(); const r = await page.evaluate(playMatch, j); results.push({ ...j, ...r }); process.stdout.write('.'); }
  await ctx.close();
}
await Promise.all(Array.from({ length: PAR }, worker));
await browser.close();
console.log(`\n${results.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0) + '%';
console.log('player     vs bots   win   draw  loss  2-0 | KOs us:them  dmg us:them | your KO:KOd | win by critter (R/Rc/G/P)  | seeds / tdm');
for (const player of PLAYERS) for (const diff of DIFFS) {
  const r = results.filter(x => x.player === player && x.diff === diff), n = r.length;
  const sum = f => r.reduce((a, x) => a + f(x), 0);
  const by = k => { const s = r.filter(x => x.key === k); return pct(s.filter(x => x.win > 0).length, s.length); };
  const md = m => { const s = r.filter(x => x.mode === m); return pct(s.filter(x => x.win > 0).length, s.length); };
  console.log(`${player.padEnd(10)} ${diff.padEnd(8)} ${pct(sum(x => x.win > 0), n).padStart(5)} ${pct(sum(x => x.win === 0), n).padStart(5)} ${pct(sum(x => x.win < 0), n).padStart(5)} ${pct(sum(x => x.rounds[0] === 2 && x.rounds[1] === 0), n).padStart(4)} | ${(sum(x => x.ko[0]) / n).toFixed(1).padStart(5)} : ${(sum(x => x.ko[1]) / n).toFixed(1).padEnd(5)} ${(sum(x => x.dmg[0]) / n).toFixed(0).padStart(5)} : ${(sum(x => x.dmg[1]) / n).toFixed(0).padEnd(5)}| ${(sum(x => x.myKo) / n).toFixed(1).padStart(4)} : ${(sum(x => x.myDeaths) / n).toFixed(1).padEnd(5)}| ${['rabbit', 'raccoon', 'goose', 'possum'].map(by).join(' ').padEnd(26)} | ${md('seeds')} / ${md('tdm')}`);
}
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(results));
