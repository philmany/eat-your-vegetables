# Eat Your Vegetables 🥕

A 2v2 garden brawl in the browser. Pick a cute vegetable-loving critter, team up with a bot, and fight another team for magic seeds in a chunky, colourful isometric arena.

**Play it:** https://philmany.github.io/eat-your-vegetables/

## How to play

Grab magic seeds. Every 12 seeds triggers a **Seed Surge** (a speed and attack-speed buff). The team with the most surges wins the round. Best of 3.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (screen-relative, 8 directions) |
| Mouse | Aim (you face the cursor) |
| Left click | Attack (hold to keep swinging) |
| Right click | Weapon special (costs Energy) |
| E | Pick up a ripe vegetable (swaps your weapon) or nearby seeds |
| Q | Plant a hedge on the tile you face (20 Energy, max 2) |
| Space | Dodge roll (brief invulnerability, 1.5 s cooldown) |
| Esc | Pause |
| M | Mute / unmute |

## Tech

One self-contained `index.html`. Rendering uses [Three.js](https://threejs.org/) 0.160 (loaded from unpkg) with a locked isometric camera. No build step: open the file in a browser or serve the folder with any static host.

```sh
cd eat-your-vegetables
python3 -m http.server 8000
# then open http://localhost:8000
```
