# BATTLESHIPS 3D

Classic Battleship, rebuilt as a single 3D naval theatre. Two grids face each
other across an open strait instead of sitting behind cardboard screens — you
see your own fleet on the water the whole time, and you watch every shell arc
over to the enemy side and land.

Play in the browser against the Admiralty A.I., or link up directly with a
friend over peer-to-peer WebRTC. No accounts, no server, no build step.

**Play:** https://sburrell23.github.io/Battleships-3D/

---

## Features

**The battlefield**
- One continuous ocean with both grids on it, rendered in three.js
- Procedurally generated warships — carrier, battleship, cruiser, submarine,
  destroyer — each built from its class and length at runtime
- Shader-driven sea with trochoidal swell, capillary ripples, whitecaps and a
  sun-glitter track; the battle sits in a clear pocket that dissolves into haze
- Floating steel boom barriers that bend along the swell and carry your colours
- Shells arc on a ballistic path with smoke trails; misses throw a water
  column, hits throw fire, debris and a shockwave, and sunk hulls roll over and
  settle as burning wrecks that stay on the board

**Playing**
- Single combat vs. A.I. at three difficulties
- Two-player peer-to-peer over a short battle code or an invite link
- Lobby rules: grid size, fleet composition, turn timer, extra-shot-on-hit,
  whether hulls may touch
- Six fleet colours, which tint your hulls, your boom, your grid and your ensign
- Four camera modes — overview, your waters, enemy waters, free flight — plus
  orbit, pan, zoom and an action camera that snaps to each impact

**Presentation**
- Every sound effect is synthesised at runtime with the Web Audio API: main
  battery fire, shell whistle, water columns, hull explosions, the groan of a
  ship going under, bosun's calls and a brass victory fanfare
- Riveted steel UI with hand-authored SVG iconography (no icon fonts, no emoji)
- Esc settings: volumes, FPS cap, anti-aliasing, shadows, ocean detail,
  particle density, render scale, camera shake, action zoom, FPS counter

## Difficulty

Measured over 400 simulated games on a standard 10x10 board (17 ship tiles).
Fewer shots is stronger.

| Tier | Behaviour | Avg. shots to clear the board |
| --- | --- | --- |
| Ensign | Scattershot; follows up on a strike only about half the time | ~66 |
| Commander | Parity sweep, then hunts along the axis of any wounded hull | ~50 |
| Admiral | Full probability-density plot over every hull still afloat | ~46 |

## Controls

| Input | Action |
| --- | --- |
| `1` `2` `3` `4` | Overview / your waters / enemy waters / free camera |
| Left drag | Orbit |
| Right drag | Pan |
| Wheel | Zoom |
| `W` `A` `S` `D`, `Q` `E`, `Shift` | Fly in free camera |
| `R` | Rotate hull while deploying |
| `F` | Auto-deploy the fleet |
| `Space` | Ready up |
| `Esc` | Settings |

## Running it locally

No dependencies and no bundler — it is plain ES modules. Any static server
works; one is included:

```bash
node scripts/dev-server.mjs
```

Then open `http://localhost:5173`.

Two browser tabs are enough to test multiplayer: host in one, paste the battle
code into the other.

## How the multiplayer works

Connections are direct browser-to-browser WebRTC data channels brokered by the
public PeerJS signalling cloud. The host reserves a six-character battle code;
the challenger dials it.

Each side keeps its own fleet privately and acts as referee for shots fired at
it. The attacker sends `fire {x, y}`; the defender resolves it against its own
board and answers with `result {hit, sunk, ship, defeated}`. Neither side ever
receives the other's layout until the match ends, and enemy salvoes are always
launched from a randomly chosen tile of the enemy grid so the firing animation
cannot leak where their ships actually are.

## Layout

```
index.html              markup for every screen and HUD
src/styles.css          riveted steel theme
src/main.js             app controller: screen flow, lobby handshake, match wiring
src/core/
  constants.js          world scale, fleet classes, palettes
  board.js              the rulebook: placement, fire resolution, fleet state
  ai.js                 the three A.I. tiers
  net.js                PeerJS transport
  game.js               match orchestration: deployment, turns, timers
  audio.js              synthesised sound effects and the music bus
  settings.js           persisted settings
src/render/
  world.js              renderer, sky dome, ocean
  waves.js              the single source of truth for the sea surface
  grid.js               battle grids, booms, markers, hull wrecks
  ships.js              procedural warship models
  fx.js                 shells, splashes, explosions, smoke, fire, shake
  camera.js             camera rig, presets, free flight, action zoom
  stage.js              frame loop, raycasting, shot choreography
src/ui/
  icons.js              hand-authored SVG icon set
  ui.js                 DOM layer
```

`src/render/waves.js` generates both the GLSL and the CPU height query from one
table of wave parameters, so the ocean, the targeting overlays, the booms and
everything floating stay on exactly the same surface.

## Credits

Music: *Naval Silence*.

Everything else — models, textures, sound effects, icons — is generated by the
game at runtime.
