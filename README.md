# Eat Your Veggies! 🥕

A 2v2 garden brawl in the browser. Pick a vegetable-loving critter, team up with a bot or a friend, and fight for magic seeds in a chunky isometric arena. Plays on desktop and phones.

**Play it:** https://philmany.github.io/eat-your-vegetables/

## How to play

Every 12 seeds triggers a **Seed Surge** (speed and attack-speed buff). Rounds are 2:30, best of 3. Berry bushes heal. Pick a mode on the title screen or in the online lobby:

- **Seed Surge** (default): most surges wins the round.
- **Team Deathmatch:** most knockouts wins; ties go to surges, then a draw.

**Comebacks:** a trailing team respawns in 3 s instead of 4, gets a **Golden Seed** on its side (3 seeds, heals 1 heart), and the leader carries a **Bounty** (+1 knockout and 3 seeds).

## Online Play

**Online Play** → **Host a game** gives a 4-digit code and invite link. Your friend joins, both pick critters and press **Ready**. The host chooses **Vs** (each of you + a bot) or **Co-op vs bots** (Easy, Normal, Hard), plus the mode.

Peer-to-peer via the free [PeerJS](https://peerjs.com/) service, so no accounts or servers. The host's tab runs the match, so keep it open; some strict office or school networks block joins. Test on one computer with `?net=local` in two tabs.

## Controls

| Desktop | Phone (landscape) | Action |
| --- | --- | --- |
| WASD + mouse aim | Left-thumb joystick | Move and aim |
| Left click (hold) | ATTACK | Attack |
| Right click | SPECIAL | Weapon special (Energy) |
| E | Tap the item | Grab a ripe vegetable (new weapon) or seeds |
| Q | HEDGE | Plant a hedge (20 Energy, max 3) |
| Space | ROLL | Dodge roll (1.5 s cooldown) |
| Esc / M | | Pause / mute |

Music toggles from the title screen.

## Tech

One self-contained `index.html` using [Three.js](https://threejs.org/) 0.160 (from unpkg) and a locked isometric camera. No build step; serve the folder with any static host:

```sh
cd eat-your-vegetables
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

Headless browser tests (Playwright + axe-core) cover boot, keyboard navigation, a full bot match, draw-call and memory budgets, the tutorial, pause, two-tab Online Play, phone touch controls, reduced motion and menu accessibility. Three.js and PeerJS load from `node_modules`, so no internet is needed:

```sh
cd eat-your-vegetables
npm install
npx playwright install chromium
npm test              # add --shots (npm run test:shots) to save screenshots of every screen to tests/screens/
```
