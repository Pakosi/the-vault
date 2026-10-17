# Vault games: module contract

Each game is one ES module in this folder: `export default function start(api, opts)`.
No imports except optional CDN ESM from cdn.jsdelivr.net with an exact version. Everything else inline. Plain JS, no build.

api:
- `api.open(html, { wide: true })` -> returns the panel card element. Put a `<canvas class="game" width=.. height=..>` in it. Elements with `data-close` close the panel.
- `api.onClose(fn)` register cleanup: cancel rAF/intervals, remove key/mouse listeners. MUST be used; panel can close any time.
- `api.close()`, `api.chips()`, `api.addChips(delta)` (negative to bet), `api.toast(msg)`, `api.broadcast(text)` (short brag line, third person, e.g. "won 5,000 chips at poker"), `api.playerName()`, `api.playerColor()`.
- `api.mirror(canvas)` call each frame (or ~10x/s) with the game canvas so the 3D arcade cabinet screen shows it.

Look: dark luxury. Panel HTML pattern:
  <div class="eyebrow">Arcade · Astro Run</div><h2>Astro <em>Run</em></h2>
  <canvas class="game" width="800" height="500"></canvas>
  <div class="result" id="...">status line</div>
  <div class="row"><button class="primary">Start</button><button data-close>Leave</button></div>
CSS vars: --gold #d6b26e, --cream #f1e9db, --muted #a59d90, --neon #ff3d7f, --cyan #3de0ff, --ok #56d68b. Fonts: "Bodoni Moda" display, Manrope body.
Keys: listen on window with capture, call e.preventDefault()+e.stopPropagation() for keys you use while panel open (game also uses WASD for walking; it ignores keys while a panel is open, but stop propagation anyway). Support mouse/touch where sensible.
Canvas: draw at fixed internal resolution; map pointer coords with getBoundingClientRect scaling.
Chips: games with stakes take a bet before a round and pay out; arcade games award chips by score (modest: a decent run ~200-1000).

Test: http://localhost:8100/games/_harness.html?g=<name> (server already running; harness logs to #log and console). Use playwright: import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'; launch with args ['--use-angle=swiftshader','--enable-unsafe-swiftshader']. Take screenshots to verify it renders and plays (simulate inputs). Fix all console errors.
