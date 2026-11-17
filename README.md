# Eat Your Vegetables 🥕

A 2v2 garden brawl in the browser. Pick a cute vegetable-loving critter, team up with a bot, and fight another team for magic seeds in a chunky, colourful isometric arena.

**Play it:** https://philmany.github.io/eat-your-vegetables/

## How to play

Grab magic seeds. Every 12 seeds triggers a **Seed Surge** (a speed and attack-speed buff). The team with the most surges wins the round. Best of 3.

## Online Play

Play with a friend over the internet: **you + a bot vs. your friend + a bot**.

1. Click **Online Play**, then **Host a game**. You get a 4-digit room code and an invite link.
2. Your friend opens the link (or clicks Online Play and types the code).
3. Each of you picks a critter (your friend picks from the other team), then both press **Ready**. The match starts.

Your friend sees the arena from their own side. No accounts or servers to set up: players connect directly
(peer-to-peer) using the free [PeerJS](https://peerjs.com/) matchmaking service. The host's browser runs the match,
so the host should keep the game tab open. A few strict networks (some offices and schools) block direct
connections; if a join keeps failing, try another network.

**Test on one computer:** open the game with `?net=local` in two tabs (or two windows), host in one and join in the other.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move (screen-relative, 8 directions) |
| Mouse | Aim (you face the cursor) |
| Left click | Attack (hold to keep swinging) |
| Right click | Weapon special (costs Energy) |
| E | Pick up a ripe vegetable (swaps your weapon) or nearby seeds |
| Q | Plant a hedge on the tile you face (20 Energy, max 3) |
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
