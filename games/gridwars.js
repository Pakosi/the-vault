// GRID WARS: light-cycle arena vs three AI riders.
export default function start(api) {
  const W = 800, H = 500;
  const card = api.open(`
    <div class="eyebrow">Arcade · Grid Wars</div><h2>Grid <em>Wars</em></h2>
    <canvas class="game" width="${W}" height="${H}"></canvas>
    <div class="result" id="gwStatus">Arrows / WASD turn · hold Space to boost · P pause · swipe to turn, tap to boost on touch</div>
    <div class="row"><button class="primary" id="gwStart">Start</button><button data-close>Leave</button></div>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#gwStatus');
  const startBtn = card.querySelector('#gwStart');

  const BEST_KEY = 'vault.gridwars.best';
  const loadBest = () => { try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ } };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;

  // ---------- arena ----------
  const CELL = 5, COLS = 160, ROWS = 92, OY = 40;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const grid = new Uint8Array(COLS * ROWS);
  const seen = new Int32Array(COLS * ROWS); let stamp = 1;
  const queueBuf = new Int32Array(COLS * ROWS);
  const blocked = (x, y) => x < 0 || y < 0 || x >= COLS || y >= ROWS || grid[y * COLS + x] !== 0;
  const cx = (x) => x * CELL + CELL / 2, cy = (y) => OY + y * CELL + CELL / 2;

  function flood(sx, sy, cap) {
    if (blocked(sx, sy)) return 0;
    stamp++;
    let h = 0, t = 0, n = 0;
    queueBuf[t++] = sy * COLS + sx; seen[sy * COLS + sx] = stamp;
    while (h < t && n < cap) {
      const idx = queueBuf[h++]; n++;
      const x = idx % COLS, y = (idx / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const j = ny * COLS + nx;
        if (grid[j] !== 0 || seen[j] === stamp) continue;
        seen[j] = stamp; queueBuf[t++] = j;
      }
    }
    return n;
  }

  // ---------- state ----------
  const ROSTER = [
    { name: 'YOU', col: '#3de0ff', ai: false },
    { name: 'VEGA', col: '#ff3d7f', ai: true },
    { name: 'ORION', col: '#ffb13d', ai: true },
    { name: 'NOVA', col: '#56d68b', ai: true },
  ];
  let bikes = [];
  let mode = 'title'; // title | countdown | play | roundEnd | over
  let paused = false, best = loadBest();
  let score = 0, round = 0, lives = 3, phaseT = 0, time = 0, shake = 0, flash = 0, boost = 1, roundMsg = '', roundSub = '', overT = 0, earned = 0, newBest = false;
  let parts = [], pops = [];
  let demo = true, tick = 0;

  function setupRound() {
    grid.fill(0);
    const starts = [[24, (ROWS >> 1) + 8, 1], [COLS - 25, (ROWS >> 1) - 8, 3], [(COLS >> 1) - 22, 10, 2], [(COLS >> 1) + 22, ROWS - 11, 0]];
    const lvl = Math.min(round, 8);
    bikes = ROSTER.map((r, i) => {
      const [x, y, dir] = starts[i];
      const b = {
        id: i + 1, ...r, ai: demo ? true : r.ai, x, y, dir, alive: true, acc: 0, pts: [[x, y]], q: [], deadT: 0, boosting: false,
        wins: bikes[i] ? bikes[i].wins : 0,
        cap: 140 + lvl * 50, err: Math.max(0.004, 0.05 - lvl * 0.006), aggr: i === 1 ? 0.9 : i === 2 ? 0.4 : 0.15, noise: Math.max(2, 10 - lvl),
      };
      grid[y * COLS + x] = b.id;
      return b;
    });
    boost = 1; parts = []; pops = [];
  }
  const speedNow = () => Math.min(34, 20 + round * 1.6);
  const you = () => bikes[0];

  function startGame() {
    demo = false; score = 0; round = 0; lives = 3; newBest = false; paused = false;
    bikes = [];
    nextRound();
    startBtn.textContent = 'Restart';
    statusEl.textContent = 'Last bike standing wins the round. Derez rivals by boxing them in.';
  }
  function nextRound() {
    round++; setupRound(); mode = 'countdown'; phaseT = 3;
  }
  function startDemo() { demo = true; round = 3; bikes = []; setupRound(); mode = 'title'; }

  // ---------- simulation ----------
  function turn(b, d) {
    if (d === b.dir || d === (b.dir + 2) % 4) return;
    b.dir = d; b.pts.push([b.x, b.y]);
  }
  function aiThink(b) {
    const opts = [b.dir, (b.dir + 3) % 4, (b.dir + 1) % 4];
    const P = you();
    let bestS = -Infinity, bestD = b.dir;
    const careless = Math.random() < b.err;
    for (const d of opts) {
      const nx = b.x + DX[d], ny = b.y + DY[d];
      let s;
      if (blocked(nx, ny)) s = -1e9;
      else {
        let run = 0, x = nx, y = ny;
        while (run < 24 && !blocked(x + DX[d], y + DY[d])) { x += DX[d]; y += DY[d]; run++; }
        const space = careless ? 60 : flood(nx, ny, b.cap);
        s = space * 2 + run * 1.5 + (d === b.dir ? 8 : 0) + rnd(0, b.noise);
        if (run < 2) s -= 20;
        // avoid cells another head could enter on its next move
        for (const o of bikes) {
          if (o === b || !o.alive) continue;
          if (Math.abs(o.x + DX[o.dir] - nx) + Math.abs(o.y + DY[o.dir] - ny) === 0) s -= 400;
          else if (Math.abs(o.x - nx) + Math.abs(o.y - ny) <= 2) s -= 25;
        }
        // hunt: steer toward a point ahead of the target to cut it off
        const tgt = !demo && P.alive ? P : bikes.find((o) => o.alive && o !== b);
        if (tgt && space >= b.cap * 0.9) {
          const px = tgt.x + DX[tgt.dir] * 10, py = tgt.y + DY[tgt.dir] * 10;
          const k = Math.min(run, 10), ex = nx + DX[d] * k, ey = ny + DY[d] * k;
          s -= (Math.abs(ex - px) + Math.abs(ey - py)) * b.aggr;
        }
      }
      if (s > bestS) { bestS = s; bestD = d; }
    }
    if (bestD !== b.dir) turn(b, bestD);
  }
  function step(b) {
    if (b.ai) aiThink(b);
    else while (b.q.length) { const d = b.q.shift(); if (d !== b.dir && d !== (b.dir + 2) % 4) { turn(b, d); break; } }
    const nx = b.x + DX[b.dir], ny = b.y + DY[b.dir];
    if (blocked(nx, ny)) {
      for (const o of bikes) if (o !== b && o.alive && o.x === nx && o.y === ny && o.tick === tick) derez(o); // simultaneous head-on
      derez(b);
      return;
    }
    b.x = nx; b.y = ny; b.tick = tick; grid[ny * COLS + nx] = b.id;
  }
  function derez(b) {
    if (!b.alive) return;
    b.alive = false; b.deadT = 0; b.pts.push([b.x, b.y]);
    const x = cx(b.x), y = cy(b.y);
    for (let i = 0; i < 46; i++) { const a = rnd(0, TAU), v = rnd(40, 340); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.4, 1.1), max: 1.1, col: Math.random() < 0.3 ? '#ffffff' : b.col, size: rnd(1.5, 3.5) }); }
    parts.push({ ring: true, x, y, r: 3, rr: 70, life: 0.5, max: 0.5, col: b.col });
    const P = you();
    shake = Math.max(shake, b === P ? 16 : 7); if (b === P) flash = 0.4;
    if (!demo && mode === 'play') {
      if (b !== P && P.alive) { const pts = 250 * round; score += pts; pops.push({ x, y: y - 10, text: `${b.name} DEREZZED +${pts}`, col: b.col, life: 1.4 }); }
    }
  }
  function clearTrail(b) { for (let i = 0; i < grid.length; i++) if (grid[i] === b.id) grid[i] = 0; }

  function endRound() {
    const alive = bikes.filter((b) => b.alive);
    const P = you();
    mode = 'roundEnd'; phaseT = 2.8;
    const winner = alive[0];
    if (winner) winner.wins++;
    if (P.alive) {
      const pts = 1000 * round; score += pts;
      roundMsg = 'ROUND WON'; roundSub = `+${pts.toLocaleString()} · last bike standing`;
    } else {
      lives--;
      roundMsg = 'DEREZZED'; roundSub = winner ? `${winner.name} takes round ${round}` : 'Nobody survived';
      if (lives <= 0) phaseT = 2.0;
    }
  }
  function gameOver() {
    mode = 'over'; overT = 0; score = Math.floor(score);
    earned = Math.min(1500, Math.floor(score / 25));
    if (score > best) { best = score; saveBest(best); newBest = true; }
    if (earned > 0) { api.addChips(earned); api.toast(`Grid Wars: +${earned} chips`); }
    if (you().wins >= 3) api.broadcast(`won ${you().wins} rounds of Grid Wars`);
    statusEl.textContent = `Game over · score ${score.toLocaleString()} · ${you().wins} rounds won · +${earned} chips · best ${best.toLocaleString()}`;
    startBtn.textContent = 'Play again';
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 35); flash = Math.max(0, flash - dt);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.ring) p.r += (p.rr - p.r) * Math.min(1, dt * 8); else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    }
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.life -= dt; p.y -= 24 * dt; if (p.life <= 0) pops.splice(i, 1); }
    for (const b of bikes) if (!b.alive && b.deadT >= 0) { b.deadT += dt; if (b.deadT > 0.9) { clearTrail(b); b.deadT = -1; } }

    if (mode === 'over') { overT += dt; return; }
    if (mode === 'countdown') { phaseT -= dt; if (phaseT <= 0) mode = 'play'; return; }
    if (mode === 'roundEnd') {
      phaseT -= dt;
      if (phaseT <= 0) { if (lives <= 0) gameOver(); else nextRound(); }
      return;
    }
    // play / title(demo)
    const P = you();
    const fast = !demo && !P.alive ? 2.5 : 1;
    P.boosting = !demo && P.alive && wantBoost() && boost > 0.02;
    if (P.boosting) boost = Math.max(0, boost - dt * 0.55); else boost = Math.min(1, boost + dt * 0.12);
    const sp = (demo ? 24 : speedNow());
    for (const b of bikes) if (b.alive) b.acc += dt * sp * fast * (b.boosting ? 1.7 : 1);
    let moved = true, guard = 0;
    while (moved && guard++ < 50) {
      moved = false; tick++;
      for (const b of bikes) if (b.alive && b.acc >= 1) { b.acc -= 1; step(b); moved = true; }
    }
    if (P.boosting && Math.random() < 0.8) parts.push({ x: cx(P.x) - DX[P.dir] * 6, y: cy(P.y) - DY[P.dir] * 6, vx: -DX[P.dir] * 80 + rnd(-30, 30), vy: -DY[P.dir] * 80 + rnd(-30, 30), life: 0.3, max: 0.3, col: '#ffffff', size: 2 });
    if (!demo && P.alive) score += dt * 10;
    const alive = bikes.filter((b) => b.alive).length;
    if (demo) { if (alive <= 1) { phaseT += dt; if (phaseT > 1.5) { phaseT = 0; setupRound(); } } return; }
    if (alive <= 1 || (!P.alive && alive === 0)) endRound();
  }
  const wantBoost = () => keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight') || tapBoost > time;

  // ---------- render ----------
  const glow = (c, b) => { ctx.shadowColor = c; ctx.shadowBlur = b; };
  const noGlow = () => { ctx.shadowBlur = 0; };
  function neon(text, x, y, size, col, o = {}) {
    ctx.save();
    ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 800} ${size}px Manrope, Arial`;
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
    glow(col, o.blur ?? 14); ctx.fillStyle = o.fill || col; ctx.fillText(text, x, y); noGlow();
    ctx.restore();
  }
  function chrome(text, x, y, size) {
    ctx.save();
    ctx.font = `italic 900 ${size}px Manrope, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#9fe9ff'); g.addColorStop(0.5, '#0a2a40'); g.addColorStop(0.62, '#3de0ff'); g.addColorStop(1, '#d6b26e');
    glow('#3de0ff', 26); ctx.fillStyle = g; ctx.fillText(text, x, y); noGlow();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.strokeText(text, x, y);
    ctx.restore();
  }

  const floor = document.createElement('canvas'); floor.width = W; floor.height = H - OY;
  (function paintFloor() {
    const b = floor.getContext('2d');
    const g = b.createRadialGradient(W / 2, (H - OY) / 2, 40, W / 2, (H - OY) / 2, W * 0.7);
    g.addColorStop(0, '#0c1424'); g.addColorStop(1, '#03040a');
    b.fillStyle = g; b.fillRect(0, 0, W, H - OY);
    b.strokeStyle = 'rgba(61,224,255,0.07)'; b.lineWidth = 1;
    b.beginPath();
    for (let x = 0; x <= COLS; x += 4) { b.moveTo(x * CELL + 0.5, 0); b.lineTo(x * CELL + 0.5, ROWS * CELL); }
    for (let y = 0; y <= ROWS; y += 4) { b.moveTo(0, y * CELL + 0.5); b.lineTo(W, y * CELL + 0.5); }
    b.stroke();
    b.strokeStyle = 'rgba(61,224,255,0.16)';
    b.beginPath();
    for (let x = 0; x <= COLS; x += 20) { b.moveTo(x * CELL + 0.5, 0); b.lineTo(x * CELL + 0.5, ROWS * CELL); }
    for (let y = 0; y <= ROWS; y += 20) { b.moveTo(0, y * CELL + 0.5); b.lineTo(W, y * CELL + 0.5); }
    b.stroke();
  })();

  function drawBackground() {
    ctx.fillStyle = '#020207'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(floor, 0, OY);
    // parallax under-grid: a deeper, larger lattice that drifts against the player's position
    const P = you();
    const ox = P ? -(P.x - COLS / 2) * CELL * 0.12 : 0, oy = P ? -(P.y - ROWS / 2) * CELL * 0.12 : 0;
    ctx.save(); ctx.beginPath(); ctx.rect(0, OY, W, H - OY); ctx.clip();
    ctx.strokeStyle = 'rgba(180,80,255,0.08)'; ctx.lineWidth = 2;
    ctx.beginPath();
    const s = 64, bx = ((ox + time * 6) % s + s) % s, by = ((oy + time * 3) % s + s) % s;
    for (let x = bx - s; x < W + s; x += s) { ctx.moveTo(x, OY); ctx.lineTo(x, H); }
    for (let y = OY + by - s; y < H + s; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // pulse scan sweep
    const sweep = OY + ((time * 90) % (H - OY + 120)) - 60;
    const sg = ctx.createLinearGradient(0, sweep - 60, 0, sweep + 2);
    sg.addColorStop(0, 'rgba(61,224,255,0)'); sg.addColorStop(1, 'rgba(61,224,255,0.06)');
    ctx.fillStyle = sg; ctx.fillRect(0, sweep - 60, W, 62);
    ctx.restore();
    // arena wall
    glow('#3de0ff', 18); ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = 2;
    ctx.strokeRect(1, OY + 1, W - 2, H - OY - 2); noGlow();
  }

  function drawTrail(b) {
    let alpha = 1;
    if (!b.alive) { if (b.deadT < 0) return; alpha = Math.max(0, 1 - b.deadT / 0.9); }
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.lineJoin = 'miter'; ctx.lineCap = 'square';
    ctx.beginPath();
    b.pts.forEach((p, i) => (i ? ctx.lineTo(cx(p[0]), cy(p[1])) : ctx.moveTo(cx(p[0]), cy(p[1]))));
    if (b.alive) ctx.lineTo(cx(b.x), cy(b.y));
    glow(b.col, 14); ctx.strokeStyle = b.col; ctx.lineWidth = 3.4; ctx.stroke(); noGlow();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1; ctx.stroke();
    if (!b.alive) {
      // derez flicker: break the trail into flecks
      ctx.fillStyle = b.col;
      for (let i = 0; i < 30; i++) { const p = b.pts[(Math.random() * b.pts.length) | 0]; ctx.fillRect(cx(p[0]) + rnd(-20, 20), cy(p[1]) + rnd(-20, 20), 2, 2); }
    }
    ctx.restore();
  }
  function drawBike(b) {
    if (!b.alive) return;
    const x = cx(b.x), y = cy(b.y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(x, y, 0, x, y, 34);
    lg.addColorStop(0, b.col + '88'); lg.addColorStop(1, b.col + '00');
    ctx.fillStyle = lg; ctx.fillRect(x - 34, y - 34, 68, 68);
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(x, y); ctx.rotate(b.dir * Math.PI / 2);
    glow(b.col, 14);
    ctx.fillStyle = '#0a0a12'; ctx.strokeStyle = b.col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(4.2, -3); ctx.lineTo(4.2, 6); ctx.lineTo(-4.2, 6); ctx.lineTo(-4.2, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-1.2, -7, 2.4, 3);
    ctx.fillStyle = b.col; ctx.fillRect(-4.2, 3, 8.4, 1.6);
    noGlow(); ctx.restore();
  }

  function drawHUD() {
    ctx.fillStyle = 'rgba(4,4,12,0.92)'; ctx.fillRect(0, 0, W, OY);
    ctx.fillStyle = 'rgba(61,224,255,0.25)'; ctx.fillRect(0, OY - 1, W, 1);
    neon(String(Math.floor(score)).padStart(7, '0'), 14, 15, 18, '#3de0ff', { align: 'left', weight: 900, blur: 8 });
    neon('BEST ' + String(Math.max(best, Math.floor(score))).padStart(7, '0'), 14, 31, 9, '#d6b26e', { align: 'left', weight: 700, blur: 0 });
    neon(demo ? 'DEMO' : `ROUND ${round}`, 158, 15, 14, '#f1e9db', { align: 'left', weight: 900, blur: 6 });
    // lives
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < lives ? '#3de0ff' : 'rgba(255,255,255,0.12)'; if (i < lives) glow('#3de0ff', 6); ctx.fillRect(160 + i * 14, 27, 9, 5); noGlow(); }
    // roster
    bikes.forEach((b, i) => {
      const x = 300 + i * 92;
      ctx.globalAlpha = b.alive ? 1 : 0.35;
      ctx.fillStyle = b.col; ctx.fillRect(x, 10, 4, 20);
      neon(b.name, x + 10, 15, 11, b.col, { align: 'left', weight: 800, blur: b.alive ? 6 : 0 });
      neon(`${b.wins} WIN${b.wins === 1 ? '' : 'S'}`, x + 10, 29, 9, '#a59d90', { align: 'left', weight: 700, blur: 0 });
      ctx.globalAlpha = 1;
    });
    // boost meter
    neon('BOOST', W - 112, 20, 9, '#a59d90', { align: 'right', weight: 800, blur: 0 });
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(W - 104, 16, 90, 8);
    const P = you();
    glow('#3de0ff', P && P.boosting ? 14 : 4); ctx.fillStyle = P && P.boosting ? '#ffffff' : '#3de0ff'; ctx.fillRect(W - 104, 16, 90 * boost, 8); noGlow();
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
    drawBackground();
    for (const b of bikes) drawTrail(b);
    for (const b of bikes) drawBike(b);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1); ctx.globalAlpha = a;
      if (p.ring) { ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else { ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.restore();
    for (const p of pops) { ctx.globalAlpha = clamp(p.life, 0, 1); neon(p.text, clamp(p.x, 110, W - 110), clamp(p.y, OY + 20, H - 20), 13, p.col, { weight: 900 }); ctx.globalAlpha = 1; }
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = `rgba(220,250,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    drawHUD();

    const mid = OY + (H - OY) / 2;
    if (mode === 'title') {
      ctx.fillStyle = 'rgba(2,3,10,0.55)'; ctx.fillRect(0, OY, W, H - OY);
      chrome('GRID WARS', W / 2, mid - 80, 88);
      neon('· LIGHT-CYCLE ARENA ·', W / 2, mid - 22, 12, '#d6b26e', { weight: 700, blur: 6 });
      if (Math.floor(time * 2) % 2 === 0) neon('PRESS SPACE  ·  TAP TO ENTER THE GRID', W / 2, mid + 30, 19, '#3de0ff', { weight: 900 });
      neon('ARROWS / WASD TURN    HOLD SPACE BOOST    LAST BIKE STANDING WINS', W / 2, mid + 72, 11, '#f1e9db', { weight: 700, blur: 0 });
      neon('BEST  ' + best.toLocaleString(), W / 2, mid + 108, 15, '#ff3d7f', { weight: 900 });
    } else if (mode === 'countdown') {
      const n = Math.ceil(phaseT);
      const f = phaseT - Math.floor(phaseT);
      ctx.globalAlpha = clamp(f * 1.5, 0, 1);
      chrome(String(n), W / 2, mid - 10, 70 + (1 - f) * 40);
      ctx.globalAlpha = 1;
      neon(`ROUND ${round}`, W / 2, mid + 60, 16, '#d6b26e', { weight: 800 });
      // highlight the player's bike
      const P = you(); const r = 16 + Math.sin(time * 10) * 3;
      ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = 1.5; glow('#3de0ff', 10); ctx.beginPath(); ctx.arc(cx(P.x), cy(P.y), r, 0, TAU); ctx.stroke(); noGlow();
      neon('YOU', cx(P.x), cy(P.y) - 26, 11, '#3de0ff', { weight: 900 });
    } else if (mode === 'roundEnd') {
      ctx.fillStyle = 'rgba(2,3,10,0.45)'; ctx.fillRect(0, OY, W, H - OY);
      chrome(roundMsg, W / 2, mid - 20, 64);
      neon(roundSub, W / 2, mid + 34, 16, roundMsg === 'ROUND WON' ? '#56d68b' : '#ff3d7f', { weight: 800 });
      if (lives <= 0) neon('NO LIVES LEFT', W / 2, mid + 64, 13, '#a59d90', { weight: 700, blur: 0 });
    } else if (mode === 'over') {
      ctx.fillStyle = `rgba(2,3,10,${Math.min(0.7, overT)})`; ctx.fillRect(0, OY, W, H - OY);
      chrome('END OF LINE', W / 2, mid - 80, 66);
      neon('SCORE  ' + Math.floor(score).toLocaleString(), W / 2, mid - 10, 26, '#3de0ff', { weight: 900 });
      neon((newBest ? 'NEW BEST!  ' : 'BEST  ') + best.toLocaleString(), W / 2, mid + 24, 15, newBest ? '#ffd36e' : '#d6b26e', { weight: 800 });
      neon(`${you().wins} ROUNDS WON   ·   +${earned} CHIPS`, W / 2, mid + 54, 15, '#56d68b', { weight: 800, blur: 8 });
      if (overT > 1 && Math.floor(time * 2) % 2 === 0) neon('PRESS SPACE  ·  TAP TO PLAY AGAIN', W / 2, mid + 110, 17, '#ff3d7f', { weight: 900 });
    }
    if (paused && mode === 'play') { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, OY, W, H - OY); neon('PAUSED', W / 2, mid, 40, '#3de0ff', { italic: true, weight: 900 }); }
  }

  // ---------- input ----------
  const keys = new Set();
  const DIRKEY = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  const USED = new Set([...Object.keys(DIRKEY), 'Space', 'ShiftLeft', 'ShiftRight', 'KeyP', 'Enter']);
  function queueDir(d) {
    if (demo || !(mode === 'play' || mode === 'countdown')) return;
    const P = you(); if (!P || !P.alive) return;
    if (mode === 'countdown') { if (d !== (P.dir + 2) % 4) { P.dir = d; P.pts = [[P.x, P.y]]; } return; }
    if (P.q.length < 3) P.q.push(d);
  }
  function onKey(e) {
    if (!USED.has(e.code)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keydown') {
      if (!e.repeat) {
        if (e.code in DIRKEY) queueDir(DIRKEY[e.code]);
        if (e.code === 'Space' || e.code === 'Enter') { if (mode === 'title') startGame(); else if (mode === 'over' && overT > 1) startGame(); }
        if (e.code === 'KeyP' && mode === 'play') paused = !paused;
      }
      keys.add(e.code);
    } else keys.delete(e.code);
  }
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  let swipe = null, tapBoost = 0;
  function onDown(e) {
    e.preventDefault();
    if (mode === 'title') { startGame(); return; }
    if (mode === 'over') { if (overT > 1) startGame(); return; }
    const p = toCanvas(e); swipe = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onMove(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const p = toCanvas(e); const dx = p.x - swipe.x, dy = p.y - swipe.y;
    if (Math.hypot(dx, dy) > 22) {
      queueDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      swipe.x = p.x; swipe.y = p.y; swipe.moved = true;
    }
  }
  function onUp(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    if (!swipe.moved && performance.now() - swipe.t < 250) tapBoost = time + 0.7;
    swipe = null;
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  const onBlur = () => { keys.clear(); if (mode === 'play') paused = true; };
  window.addEventListener('blur', onBlur);
  startBtn.addEventListener('click', () => { startBtn.blur(); startGame(); });

  // ---------- loop ----------
  let raf = 0, last = performance.now(), alive = true;
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!(paused && mode === 'play')) update(dt);
    render();
    api.mirror(cv);
  }
  startDemo();
  raf = requestAnimationFrame(frame);

  cv._dbg = () => ({ mode, score: Math.floor(score), round, lives, best, alive: bikes.map((b) => b.alive), wins: bikes.map((b) => b.wins), you: bikes[0] && { x: bikes[0].x, y: bikes[0].y, dir: bikes[0].dir }, boost: +boost.toFixed(2) });

  cv._dbgBlocked = (x, y) => blocked(x, y);
  cv._dbgAuto = () => { if (bikes[0]) bikes[0].ai = true; };

  api.onClose(() => {
    alive = false; cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('blur', onBlur);
    cv.removeEventListener('pointerdown', onDown);
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerup', onUp);
    cv.removeEventListener('pointercancel', onUp);
  });
}
