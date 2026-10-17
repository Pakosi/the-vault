// ASTRO RUN: neon synthwave side-scrolling space shooter.
export default function start(api) {
  const W = 800, H = 500, HORIZON = 392;
  const card = api.open(`
    <div class="eyebrow">Arcade · Astro Run</div><h2>Astro <em>Run</em></h2>
    <canvas class="game" width="${W}" height="${H}"></canvas>
    <div class="result" id="arStatus">Arrows / WASD fly · auto-fire (F toggles, Space fires) · P pauses · drag to fly on touch</div>
    <div class="row"><button class="primary" id="arStart">Start</button><button data-close>Leave</button></div>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#arStatus');
  const startBtn = card.querySelector('#arStart');

  const BEST_KEY = 'vault.astrorun.best';
  const loadBest = () => { try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ } };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const TAU = Math.PI * 2;

  // ---------- static background (sky + sun) cached ----------
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  (function paintBg() {
    const b = bg.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, HORIZON);
    g.addColorStop(0, '#04010b'); g.addColorStop(0.55, '#140426'); g.addColorStop(1, '#3a0a4a');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    // nebula blobs
    for (let i = 0; i < 6; i++) {
      const x = rnd(0, W), y = rnd(40, 300), r = rnd(80, 200);
      const ng = b.createRadialGradient(x, y, 0, x, y, r);
      const c = pick(['255,61,127', '61,224,255', '150,80,255']);
      ng.addColorStop(0, `rgba(${c},0.10)`); ng.addColorStop(1, `rgba(${c},0)`);
      b.fillStyle = ng; b.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // sun
    const sx = 560, sy = HORIZON - 30, sr = 120;
    const halo = b.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.2);
    halo.addColorStop(0, 'rgba(255,61,127,0.35)'); halo.addColorStop(1, 'rgba(255,61,127,0)');
    b.fillStyle = halo; b.fillRect(0, 0, W, HORIZON);
    b.save();
    b.beginPath(); b.rect(0, 0, W, HORIZON); b.clip();
    const sg = b.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, '#ffe98a'); sg.addColorStop(0.5, '#ff9a4a'); sg.addColorStop(1, '#ff2d8a');
    b.fillStyle = sg; b.beginPath(); b.arc(sx, sy, sr, 0, TAU); b.fill();
    // stripe cut-outs
    b.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 8; i++) {
      const y = sy - sr * 0.45 + i * 10, h = 1.5 + i * 1.1;
      b.fillRect(sx - sr, y, sr * 2, h);
    }
    b.restore();
    // re-fill cut stripes with sky color
    b.globalCompositeOperation = 'destination-over';
    b.fillStyle = '#2a0838'; b.fillRect(0, 0, W, HORIZON);
    b.globalCompositeOperation = 'source-over';
    // ground
    const gg = b.createLinearGradient(0, HORIZON, 0, H);
    gg.addColorStop(0, '#1d0630'); gg.addColorStop(1, '#05010c');
    b.fillStyle = gg; b.fillRect(0, HORIZON, W, H - HORIZON);
  })();

  // mountain ridges (repeating)
  const ridge = (n, amp, seed) => {
    const pts = [];
    let s = seed;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i <= n; i++) pts.push(r() * amp);
    pts[n] = pts[0];
    return pts;
  };
  const ridgeFar = ridge(16, 60, 7), ridgeNear = ridge(12, 38, 99);

  // stars
  const stars = [];
  for (let l = 0; l < 3; l++) for (let i = 0; i < 60 - l * 15; i++) stars.push({ x: rnd(0, W), y: rnd(0, HORIZON - 10), l, tw: rnd(0, TAU) });

  // ---------- state ----------
  let mode = 'title'; // title | play | over
  let paused = false;
  let best = loadBest();
  let score = 0, lives = 3, wave = 0, waveClock = 0, waveGap = 0, bannerT = 0, bannerText = '';
  let shake = 0, flash = 0, time = 0, scroll = 0, overT = 0, earned = 0, autoFire = true, newBest = false;
  let combo = 0, comboT = 0;
  const P = { x: 120, y: 220, vx: 0, vy: 0, r: 11, inv: 0, shield: 0, spread: 0, cd: 0, alive: true, respawn: 0, tx: null, ty: null };
  let pb = [], eb = [], enemies = [], parts = [], pops = [], pups = [], queue = [], boss = null;

  function reset(demo) {
    score = 0; lives = 3; wave = 0; waveClock = 0; waveGap = 1.2; combo = 0; comboT = 0;
    Object.assign(P, { x: 120, y: 220, vx: 0, vy: 0, inv: demo ? 0 : 2, shield: 0, spread: demo ? 1 : 0, cd: 0, alive: true, respawn: 0, tx: null, ty: null });
    pb = []; eb = []; enemies = []; parts = []; pops = []; pups = []; queue = []; boss = null;
    shake = 0; flash = 0; newBest = false;
  }

  // ---------- spawning ----------
  function addEnemy(type, o = {}) {
    const n = Math.max(1, wave);
    const e = { type, x: o.x ?? W + 40, y: o.y ?? rnd(60, H - 120), t: o.phase || 0, vx: 0, vy: 0, hit: 0, fireT: rnd(1, 3) };
    if (type === 'drone') Object.assign(e, { r: 14, hp: 1 + Math.floor(n / 5), pts: 100, col: '#ff3d7f', baseY: e.y, amp: o.amp ?? 50, freq: o.freq ?? 2.4, spd: 170 + n * 6 });
    if (type === 'diver') Object.assign(e, { r: 13, hp: 2 + Math.floor(n / 6), pts: 150, col: '#ffa53d', spd: 240 + n * 8 });
    if (type === 'gunship') Object.assign(e, { r: 22, hp: 8 + n * 2, pts: 400, col: '#56d68b', spd: 90, stay: 6, fireT: 1.2 });
    if (type === 'rock') {
      const size = o.size || pick([1, 2, 3, 3]);
      const verts = []; const k = 9 + size * 2;
      for (let i = 0; i < k; i++) verts.push(0.72 + Math.random() * 0.35);
      Object.assign(e, { r: [0, 11, 19, 30][size], size, hp: [0, 1, 3, 5][size], pts: 50 * size, col: '#b48cff', spd: o.spd ?? rnd(80, 160), vy: o.vy ?? rnd(-30, 30), rot: rnd(0, TAU), vr: rnd(-1.5, 1.5), verts });
    }
    enemies.push(e);
    return e;
  }

  function buildWave(n) {
    queue = []; waveClock = 0;
    bannerText = n % 4 === 0 ? 'WARNING · MOTHERSHIP' : 'WAVE ' + n; bannerT = 2.2;
    if (n % 4 === 0) { queue.push({ at: 1.5, fn: spawnBoss }); return; }
    const kinds = ['drone', 'drone', 'vee', 'rocks'];
    if (n >= 2) kinds.push('diver', 'diver', 'vee');
    if (n >= 3) kinds.push('gunship', 'gunship');
    const groups = 3 + Math.min(n, 6);
    let at = 1.0;
    for (let g = 0; g < groups; g++) {
      const k = g === 0 ? 'drone' : pick(kinds);
      if (k === 'drone') {
        const y = rnd(80, H - 170), amp = rnd(25, 90), cnt = 5 + Math.min(n, 5);
        for (let i = 0; i < cnt; i++) queue.push({ at: at + i * 0.26, fn: () => addEnemy('drone', { y, amp, phase: i * 0.45 }) });
        at += cnt * 0.26 + 0.9;
      } else if (k === 'vee') {
        const cy = rnd(120, H - 200);
        queue.push({ at, fn: () => { for (let i = 0; i < 7; i++) addEnemy('drone', { x: W + 30 + Math.abs(i - 3) * 38, y: cy + (i - 3) * 30, amp: 0 }); } });
        at += 2.0;
      } else if (k === 'diver') {
        const cnt = 3 + Math.min(3, n >> 1);
        for (let i = 0; i < cnt; i++) queue.push({ at: at + i * 0.5, fn: () => addEnemy('diver', { y: rnd(50, H - 140) }) });
        at += cnt * 0.5 + 1.0;
      } else if (k === 'gunship') {
        const cnt = n >= 6 ? 2 : 1;
        for (let i = 0; i < cnt; i++) queue.push({ at: at + i * 0.8, fn: () => addEnemy('gunship', { y: 110 + i * 170 + rnd(-20, 20) }) });
        at += 3.2;
      } else {
        const cnt = 5 + Math.min(n, 5);
        for (let i = 0; i < cnt; i++) queue.push({ at: at + i * 0.4, fn: () => addEnemy('rock', { y: rnd(40, H - 90) }) });
        at += cnt * 0.4 + 0.8;
      }
    }
  }

  function spawnBoss() {
    const lvl = wave / 4;
    boss = { x: W + 160, y: H / 2 - 40, r: 46, hp: 150 + 110 * (lvl - 1), max: 150 + 110 * (lvl - 1), t: 0, pat: 0, patT: 0, fireT: 1.5, ang: 0, hit: 0, lvl, dying: 0 };
  }

  // ---------- fx ----------
  function burst(x, y, col, n = 18, sp = 220, life = 0.7, size = 2.5) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(sp * 0.2, sp);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life * 0.5, life), max: life, col, size: rnd(size * 0.5, size * 1.4) });
    }
  }
  function ring(x, y, col, r = 40) { parts.push({ ring: true, x, y, r: 4, rr: r, life: 0.45, max: 0.45, col }); }
  function pop(x, y, text, col = '#f1e9db') { pops.push({ x, y, text, col, life: 0.9 }); }
  function addScore(v, x, y) {
    combo = comboT > 0 ? combo + 1 : 1; comboT = 1.2;
    const mult = 1 + Math.min(combo - 1, 9) * 0.1;
    const pts = Math.round(v * mult / 10) * 10;
    if (mode === 'play') score += pts;
    if (x !== undefined) pop(x, y, '+' + pts + (combo > 2 ? ` x${mult.toFixed(1)}` : ''));
  }

  // ---------- combat ----------
  function fire() {
    const lv = P.spread;
    const mk = (a, off = 0) => pb.push({ x: P.x + 18, y: P.y + off, vx: Math.cos(a) * 780, vy: Math.sin(a) * 780, dmg: 1 });
    if (lv === 0) { mk(0, -4); mk(0, 4); }
    else if (lv === 1) { mk(0); mk(-0.12); mk(0.12); }
    else { mk(0, -4); mk(0, 4); mk(-0.14); mk(0.14); mk(-0.28); mk(0.28); }
    P.cd = lv === 2 ? 0.12 : 0.11;
  }
  function enemyShot(x, y, a, sp = 220, col = '#ffd36e') { eb.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, col, r: 4 }); }
  function aimAt(x, y) { return Math.atan2(P.y - y, P.x - x); }

  function killEnemy(e, i) {
    enemies.splice(i, 1);
    burst(e.x, e.y, e.col, e.type === 'gunship' ? 40 : 20, e.type === 'gunship' ? 320 : 220);
    ring(e.x, e.y, e.col, e.r * 2.6);
    shake = Math.max(shake, e.type === 'gunship' ? 8 : 3);
    addScore(e.pts, e.x, e.y - 10);
    if (e.type === 'rock' && e.size > 1) {
      for (let k = 0; k < 2; k++) addEnemy('rock', { x: e.x, y: e.y, size: e.size - 1, spd: e.spd + rnd(20, 60), vy: rnd(-90, 90) });
    }
    const chance = e.type === 'gunship' ? 0.5 : e.type === 'rock' ? 0.04 : 0.07;
    if (Math.random() < chance) dropPowerup(e.x, e.y);
  }
  function dropPowerup(x, y, kind) {
    const k = kind || (Math.random() < 0.12 ? 'L' : Math.random() < 0.55 ? 'S' : 'H');
    pups.push({ x, y, kind: k, t: 0 });
  }

  function hurtPlayer() {
    if (P.inv > 0 || !P.alive) return;
    if (mode !== 'play') { P.inv = 1; return; } // attract mode is invincible
    if (P.shield > 0) {
      P.shield = 0; P.inv = 1.2; shake = 10; flash = 0.25; ring(P.x, P.y, '#3de0ff', 70); burst(P.x, P.y, '#3de0ff', 24, 260);
      return;
    }
    lives--; P.alive = false; P.respawn = 1.6; P.spread = Math.max(0, P.spread - 1);
    burst(P.x, P.y, '#3de0ff', 50, 380, 1.1, 3); burst(P.x, P.y, '#ffffff', 20, 200, 0.6); ring(P.x, P.y, '#ff3d7f', 110);
    shake = 18; flash = 0.5; eb = [];
    if (lives < 0) { lives = 0; gameOver(); }
  }

  function gameOver() {
    mode = 'over'; overT = 0;
    earned = Math.min(1500, Math.floor(score / 40));
    if (score > best) { best = score; saveBest(best); newBest = true; }
    if (earned > 0) { api.addChips(earned); api.toast(`Astro Run: +${earned} chips`); }
    if (score >= 15000) api.broadcast(`scored ${score.toLocaleString()} on Astro Run`);
    statusEl.textContent = `Game over · score ${score.toLocaleString()} · wave ${wave} · +${earned} chips · best ${best.toLocaleString()}`;
    startBtn.textContent = 'Play again';
  }

  function startGame() {
    reset(false); mode = 'play'; paused = false;
    statusEl.textContent = 'Clear the waves. Every 4th wave brings a mothership.';
    startBtn.textContent = 'Restart';
  }

  // ---------- update ----------
  function autopilot(dt) {
    // attract-mode pilot: track the nearest target's lane, dodge close bullets
    let ty = H / 2 - 40;
    let bestD = 1e9;
    for (const e of enemies) { const d = e.x - P.x; if (d > 0 && d < bestD) { bestD = d; ty = e.y; } }
    if (boss) ty = boss.y;
    for (const b of eb) { if (Math.abs(b.x - P.x) < 90 && Math.abs(b.y - P.y) < 26) ty = P.y + (b.y > P.y ? -60 : 60); }
    const tx = 140 + Math.sin(time * 0.5) * 60;
    return { ax: clamp((tx - P.x) / 60, -1, 1), ay: clamp((ty - P.y) / 40, -1, 1) };
  }

  function update(dt) {
    time += dt; scroll += dt;
    for (const s of stars) { s.x -= [18, 55, 140][s.l] * dt; if (s.x < -4) { s.x = W + 4; s.y = rnd(0, HORIZON - 10); } }
    shake = Math.max(0, shake - dt * 40); flash = Math.max(0, flash - dt);
    bannerT = Math.max(0, bannerT - dt);
    comboT -= dt; if (comboT <= 0) combo = 0;

    if (mode === 'over') { overT += dt; updateFx(dt); return; }

    // waves
    waveClock += dt;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= waveClock) { const q = queue[i]; queue.splice(i, 1); q.fn(); }
    if (!queue.length && !enemies.length && !boss) {
      waveGap -= dt;
      if (waveGap <= 0) { wave++; buildWave(wave); waveGap = 1.6; }
    }

    // player
    if (P.alive) {
      let ax = 0, ay = 0;
      if (mode === 'title') ({ ax, ay } = autopilot(dt));
      else {
        if (keys.has('ArrowLeft') || keys.has('KeyA')) ax -= 1;
        if (keys.has('ArrowRight') || keys.has('KeyD')) ax += 1;
        if (keys.has('ArrowUp') || keys.has('KeyW')) ay -= 1;
        if (keys.has('ArrowDown') || keys.has('KeyS')) ay += 1;
      }
      const SPD = 330;
      if (P.tx !== null && mode === 'play') {
        P.vx = clamp((P.tx - P.x) * 12, -520, 520); P.vy = clamp((P.ty - P.y) * 12, -520, 520);
      } else {
        P.vx += (ax * SPD - P.vx) * Math.min(1, dt * 12);
        P.vy += (ay * SPD - P.vy) * Math.min(1, dt * 12);
      }
      P.x = clamp(P.x + P.vx * dt, 24, W - 40);
      P.y = clamp(P.y + P.vy * dt, 24, H - 26);
      P.inv = Math.max(0, P.inv - dt);
      P.cd -= dt;
      const firing = mode === 'title' || autoFire || keys.has('Space') || keys.has('KeyJ');
      if (firing && P.cd <= 0) fire();
      // engine trail
      if (Math.random() < 0.9) parts.push({ x: P.x - 16, y: P.y + rnd(-3, 3), vx: rnd(-260, -160), vy: rnd(-20, 20), life: 0.25, max: 0.25, col: Math.random() < 0.5 ? '#ff3d7f' : '#ffb35c', size: rnd(1.5, 3) });
    } else {
      P.respawn -= dt;
      if (P.respawn <= 0 && mode === 'play') { P.alive = true; P.inv = 2.5; P.x = 100; P.y = H / 2 - 40; P.vx = P.vy = 0; P.tx = null; }
    }

    // player bullets
    for (let i = pb.length - 1; i >= 0; i--) {
      const b = pb[i]; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x > W + 20 || b.y < -20 || b.y > H + 20) { pb.splice(i, 1); continue; }
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < (e.r + 4) * (e.r + 4)) {
          e.hp -= b.dmg; e.hit = 0.08; hit = true;
          parts.push({ x: b.x, y: b.y, vx: rnd(-60, 60), vy: rnd(-60, 60), life: 0.15, max: 0.15, col: '#ffffff', size: 2 });
          if (e.hp <= 0) killEnemy(e, j);
          break;
        }
      }
      if (!hit && boss && !boss.dying) {
        const dx = boss.x - b.x, dy = boss.y - b.y;
        if (dx * dx + dy * dy < (boss.r + 18) * (boss.r + 18) || (Math.abs(dy) < 22 && b.x > boss.x - 90 && b.x < boss.x + 60)) {
          boss.hp -= b.dmg; boss.hit = 0.06; hit = true;
          if (mode === 'play') score += 5;
          parts.push({ x: b.x, y: b.y, vx: rnd(-120, 0), vy: rnd(-80, 80), life: 0.2, max: 0.2, col: '#ffd36e', size: 2 });
          if (boss.hp <= 0) bossDie();
        }
      }
      if (hit) pb.splice(i, 1);
    }

    // enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; e.t += dt; e.hit = Math.max(0, e.hit - dt);
      if (e.type === 'drone') {
        e.x -= e.spd * dt; e.y = e.baseY + Math.sin(e.t * e.freq) * e.amp;
        if (wave >= 3) { e.fireT -= dt; if (e.fireT <= 0 && e.x < W - 40 && e.x > P.x + 120) { e.fireT = rnd(2.5, 5); enemyShot(e.x - 10, e.y, Math.PI, 210, '#ff7ab0'); } }
      } else if (e.type === 'diver') {
        if (e.t < 0.6) e.x -= e.spd * 0.4 * dt;
        else { e.vy += clamp(P.y - e.y, -1, 1) * 600 * dt; e.vy *= 0.97; e.x -= e.spd * dt; e.y += e.vy * dt; }
      } else if (e.type === 'gunship') {
        if (e.t < e.stay) e.x += ((W - 130) - e.x) * Math.min(1, dt * 1.5);
        else e.x -= e.spd * 2 * dt;
        e.y += Math.sin(e.t * 1.3) * 40 * dt;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.t < e.stay + 1) {
          e.fireT = Math.max(0.7, 1.6 - wave * 0.06);
          const a = aimAt(e.x, e.y);
          for (const o of [-0.16, 0, 0.16]) enemyShot(e.x - 20, e.y, a + o, 230, '#9dffbf');
        }
      } else if (e.type === 'rock') {
        e.x -= e.spd * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
        if (e.y < e.r || e.y > H - e.r) e.vy *= -1;
      }
      if (e.x < -80 || e.y < -120 || e.y > H + 120) { enemies.splice(i, 1); continue; }
      if (P.alive) {
        const dx = e.x - P.x, dy = e.y - P.y;
        if (dx * dx + dy * dy < (e.r + P.r - 2) ** 2) {
          if (P.inv <= 0) { hurtPlayer(); if (e.type !== 'gunship') { e.hp = 0; killEnemy(e, i); } }
        }
      }
    }

    // boss
    if (boss) updateBoss(dt);

    // enemy bullets
    for (let i = eb.length - 1; i >= 0; i--) {
      const b = eb[i]; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { eb.splice(i, 1); continue; }
      if (P.alive) {
        const dx = b.x - P.x, dy = b.y - P.y;
        const rr = P.shield > 0 ? 20 : P.r - 3;
        if (dx * dx + dy * dy < (rr + b.r) ** 2) { eb.splice(i, 1); hurtPlayer(); if (i > eb.length) i = eb.length; }
      }
    }

    // power-ups
    for (let i = pups.length - 1; i >= 0; i--) {
      const u = pups[i]; u.t += dt; u.x -= 70 * dt; u.y += Math.sin(u.t * 3) * 30 * dt;
      if (u.x < -30) { pups.splice(i, 1); continue; }
      if (P.alive && Math.hypot(u.x - P.x, u.y - P.y) < 26) {
        pups.splice(i, 1);
        if (u.kind === 'S') { P.spread = Math.min(2, P.spread + 1); pop(u.x, u.y, P.spread === 2 ? 'MAX SPREAD' : 'SPREAD SHOT', '#ff3d7f'); }
        else if (u.kind === 'H') { P.shield = 1; pop(u.x, u.y, 'SHIELD', '#3de0ff'); }
        else { lives = Math.min(5, lives + 1); pop(u.x, u.y, '1UP', '#56d68b'); }
        if (mode === 'play') score += 250;
        ring(u.x, u.y, '#ffffff', 50);
      }
    }
    updateFx(dt);
  }

  function updateBoss(dt) {
    const b = boss; b.t += dt; b.hit = Math.max(0, b.hit - dt);
    if (b.dying > 0) {
      b.dying -= dt; b.x += 20 * dt;
      if (Math.random() < 0.5) { burst(b.x + rnd(-80, 60), b.y + rnd(-50, 50), pick(['#ff3d7f', '#ffd36e', '#ffffff']), 12, 260); shake = Math.max(shake, 6); }
      if (b.dying <= 0) {
        burst(b.x, b.y, '#ffffff', 80, 520, 1.3, 3.5); burst(b.x, b.y, '#ff3d7f', 60, 420, 1.2, 3); ring(b.x, b.y, '#ffd36e', 220);
        shake = 26; flash = 0.6; boss = null;
      }
      return;
    }
    const tx = W - 150;
    b.x += (tx - b.x) * Math.min(1, dt * 0.9);
    b.y = H / 2 - 50 + Math.sin(b.t * 0.7) * 140;
    b.patT += dt;
    if (b.patT > 5) { b.patT = 0; b.pat = (b.pat + 1) % 3; }
    if (b.x > W - 40) return;
    b.fireT -= dt;
    const ox = b.x - 70, oy = b.y;
    const speedUp = 1 + (b.lvl - 1) * 0.15 + (1 - b.hp / b.max) * 0.3;
    if (b.fireT <= 0) {
      if (b.pat === 0) { // fan
        const k = 9 + b.lvl * 2;
        for (let i = 0; i < k; i++) enemyShot(ox, oy, Math.PI + (i / (k - 1) - 0.5) * 1.5, 190 * speedUp, '#ff7ab0');
        b.fireT = 1.0 / speedUp;
      } else if (b.pat === 1) { // aimed burst
        const a = aimAt(ox, oy);
        for (const o of [-0.1, 0, 0.1]) enemyShot(ox, oy, a + o, 270 * speedUp, '#ffd36e');
        b.fireT = (b.patT % 1.2 < 0.6 ? 0.18 : 0.5) / speedUp;
      } else { // spiral
        b.ang += 0.42;
        for (let k = 0; k < 2; k++) enemyShot(b.x - 20, oy, b.ang + k * Math.PI, 170 * speedUp, '#b48cff');
        b.fireT = 0.07 / speedUp;
      }
    }
    if (Math.random() < dt * 0.25) addEnemy('drone', { x: W + 30, y: rnd(60, H - 150), amp: 60 });
  }

  function bossDie() {
    boss.dying = 1.6;
    addScore(5000 * boss.lvl, boss.x, boss.y - 60);
    dropPowerup(boss.x - 40, boss.y - 30, 'S'); dropPowerup(boss.x - 40, boss.y + 30, Math.random() < 0.5 ? 'L' : 'H');
    eb = [];
  }

  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.ring) p.r += (p.rr - p.r) * Math.min(1, dt * 10);
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; }
    }
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.life -= dt; p.y -= 30 * dt; if (p.life <= 0) pops.splice(i, 1); }
  }

  // ---------- render ----------
  function glow(c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
  function noGlow() { ctx.shadowBlur = 0; }

  function drawBackground() {
    ctx.drawImage(bg, 0, 0);
    // stars
    for (const s of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(time * 1.5 + s.tw));
      ctx.fillStyle = s.l === 2 ? `rgba(200,240,255,${0.8 * a})` : `rgba(255,255,255,${(0.25 + s.l * 0.25) * a})`;
      if (s.l === 2) ctx.fillRect(s.x, s.y, 6, 1.4); else ctx.fillRect(s.x, s.y, 1.2 + s.l * 0.6, 1.2 + s.l * 0.6);
    }
    // ridges (parallax)
    drawRidge(ridgeFar, 18, HORIZON, '#1a0530', 'rgba(255,61,127,0.55)', W / 16);
    drawRidge(ridgeNear, 40, HORIZON, '#12031f', 'rgba(61,224,255,0.45)', W / 10);
    // perspective ground grid scrolling sideways
    ctx.save();
    ctx.beginPath(); ctx.rect(0, HORIZON, W, H - HORIZON); ctx.clip();
    const vp = W / 2, cam = scroll * 260;
    ctx.strokeStyle = 'rgba(255,61,127,0.55)'; ctx.lineWidth = 1.2;
    glow('#ff3d7f', 8);
    ctx.beginPath();
    const sp = 70, off = cam % sp;
    for (let X = -W * 4; X <= W * 4; X += sp) {
      const xn = vp + (X - off) * 1.0, xf = vp + (X - off) * 0.03;
      ctx.moveTo(xf, HORIZON); ctx.lineTo(xn, H + 2);
    }
    for (let i = 1; i < 14; i++) { const y = HORIZON + 108 / (i * 0.75) - 4; if (y > HORIZON) { ctx.moveTo(0, y); ctx.lineTo(W, y); } }
    ctx.stroke();
    ctx.restore(); noGlow();
    // horizon glow line
    const hg = ctx.createLinearGradient(0, HORIZON - 6, 0, HORIZON + 6);
    hg.addColorStop(0, 'rgba(255,61,127,0)'); hg.addColorStop(0.5, 'rgba(255,120,190,0.9)'); hg.addColorStop(1, 'rgba(255,61,127,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, HORIZON - 6, W, 12);
  }

  function drawRidge(pts, speed, base, fill, line, step) {
    const n = pts.length - 1, span = n * step;
    const off = (scroll * speed) % span;
    ctx.beginPath(); ctx.moveTo(-10, base);
    for (let rep = 0; rep < 2 + Math.ceil(W / span); rep++) {
      for (let i = 0; i <= n; i++) {
        const x = rep * span + i * step - off;
        ctx.lineTo(x, base - 8 - pts[i]);
      }
    }
    ctx.lineTo(W + 10, base); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.4; glow(line, 10); ctx.stroke(); noGlow();
  }

  function drawShip(x, y, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
    const tilt = clamp(P.vy / 900, -0.25, 0.25); ctx.rotate(tilt);
    // flame
    const fl = 14 + Math.random() * 10;
    const fg = ctx.createLinearGradient(-16 - fl, 0, -12, 0);
    fg.addColorStop(0, 'rgba(255,61,127,0)'); fg.addColorStop(1, 'rgba(255,200,120,0.95)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-16 - fl, 0); ctx.lineTo(-12, 5); ctx.fill();
    // hull
    glow('#3de0ff', 16);
    const hg = ctx.createLinearGradient(0, -12, 0, 12);
    hg.addColorStop(0, '#d9f8ff'); hg.addColorStop(0.5, '#3a8fb8'); hg.addColorStop(1, '#0d2740');
    ctx.fillStyle = hg; ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(4, -5); ctx.lineTo(-6, -14); ctx.lineTo(-14, -13); ctx.lineTo(-10, -4);
    ctx.lineTo(-14, 0); ctx.lineTo(-10, 4); ctx.lineTo(-14, 13); ctx.lineTo(-6, 14); ctx.lineTo(4, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // cockpit
    glow('#ff3d7f', 10); ctx.fillStyle = '#ff6fa3';
    ctx.beginPath(); ctx.ellipse(5, 0, 6, 2.6, 0, 0, TAU); ctx.fill();
    noGlow(); ctx.restore();
    if (P.shield > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const r = 22 + Math.sin(time * 6) * 1.5;
      const sg = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
      sg.addColorStop(0, 'rgba(61,224,255,0)'); sg.addColorStop(0.85, 'rgba(61,224,255,0.18)'); sg.addColorStop(1, 'rgba(61,224,255,0.7)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y);
    const col = e.hit > 0 ? '#ffffff' : e.col;
    glow(e.col, 14); ctx.strokeStyle = col; ctx.lineWidth = 2;
    if (e.type === 'drone') {
      ctx.rotate(Math.sin(e.t * 3) * 0.2);
      ctx.fillStyle = 'rgba(80,0,40,0.85)';
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(0, -11); ctx.lineTo(14, 0); ctx.lineTo(0, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-2, 0, 3.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(18, -12); ctx.moveTo(6, 6); ctx.lineTo(18, 12); ctx.stroke();
    } else if (e.type === 'diver') {
      ctx.rotate(Math.atan2(e.vy, -(e.spd)) + Math.PI);
      ctx.fillStyle = 'rgba(70,30,0,0.85)';
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(10, -12); ctx.lineTo(4, 0); ctx.lineTo(10, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff2c0'; ctx.fillRect(4, -2, 8, 4);
    } else if (e.type === 'gunship') {
      ctx.fillStyle = 'rgba(0,50,25,0.9)';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 18); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(-36, -3, 16, 6);
      ctx.beginPath(); ctx.arc(0, 0, 7 + Math.sin(e.t * 8) * 1.5, 0, TAU); ctx.fill();
      // hp bar
      noGlow(); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(-20, -30, 40, 3);
      ctx.fillStyle = '#56d68b'; ctx.fillRect(-20, -30, 40 * clamp(e.hp / (8 + wave * 2), 0, 1), 3);
    } else if (e.type === 'rock') {
      ctx.rotate(e.rot);
      ctx.fillStyle = 'rgba(40,20,70,0.9)';
      ctx.beginPath();
      e.verts.forEach((v, k) => { const a = k / e.verts.length * TAU; ctx.lineTo(Math.cos(a) * e.r * v, Math.sin(a) * e.r * v); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(e.r * 0.2, -e.r * 0.15, e.r * 0.22, 0, TAU); ctx.stroke();
    }
    noGlow(); ctx.restore();
  }

  function drawBoss() {
    const b = boss;
    ctx.save(); ctx.translate(b.x, b.y);
    const flick = b.hit > 0 ? '#ffffff' : '#ff3d7f';
    glow('#ff3d7f', 24);
    const g = ctx.createLinearGradient(0, -70, 0, 70);
    g.addColorStop(0, '#3a0b3f'); g.addColorStop(0.5, '#6a1450'); g.addColorStop(1, '#1a0420');
    ctx.fillStyle = g; ctx.strokeStyle = flick; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-100, 0); ctx.lineTo(-50, -30); ctx.lineTo(10, -42); ctx.lineTo(40, -78); ctx.lineTo(70, -74); ctx.lineTo(60, -30);
    ctx.lineTo(80, 0); ctx.lineTo(60, 30); ctx.lineTo(70, 74); ctx.lineTo(40, 78); ctx.lineTo(10, 42); ctx.lineTo(-50, 30); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // panel lines
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(61,224,255,0.6)'; glow('#3de0ff', 8);
    ctx.beginPath(); ctx.moveTo(-60, -10); ctx.lineTo(40, -14); ctx.moveTo(-60, 10); ctx.lineTo(40, 14); ctx.moveTo(20, -42); ctx.lineTo(55, -72); ctx.moveTo(20, 42); ctx.lineTo(55, 72); ctx.stroke();
    // core
    const pulse = 0.6 + 0.4 * Math.sin(b.t * 6);
    const cg = ctx.createRadialGradient(-20, 0, 0, -20, 0, 26);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.4, `rgba(255,211,110,${pulse})`); cg.addColorStop(1, 'rgba(255,61,127,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(-20, 0, 26, 0, TAU); ctx.fill();
    // cannon
    glow('#ffd36e', 12); ctx.fillStyle = '#ffd36e'; ctx.fillRect(-112, -4, 18, 8);
    noGlow(); ctx.restore();
    // health bar
    const w = 360, x = (W - w) / 2, y = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, 8);
    const hg = ctx.createLinearGradient(x, 0, x + w, 0); hg.addColorStop(0, '#ff3d7f'); hg.addColorStop(1, '#ffd36e');
    glow('#ff3d7f', 10); ctx.fillStyle = hg; ctx.fillRect(x, y, w * clamp(b.hp / b.max, 0, 1), 8); noGlow();
    ctx.font = '600 10px Manrope, Arial'; ctx.fillStyle = '#f1e9db'; ctx.textAlign = 'center';
    ctx.fillText('MOTHERSHIP MK ' + b.lvl, W / 2, y + 22);
  }

  function drawPowerup(u) {
    const col = u.kind === 'S' ? '#ff3d7f' : u.kind === 'H' ? '#3de0ff' : '#56d68b';
    ctx.save(); ctx.translate(u.x, u.y); ctx.rotate(Math.sin(u.t * 2) * 0.3);
    glow(col, 18); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(10,5,20,0.85)';
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); } ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '800 12px Manrope, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(u.kind === 'L' ? '1UP' : u.kind, 0, 1);
    noGlow(); ctx.restore();
  }

  function neonText(text, x, y, size, col, opts = {}) {
    ctx.save();
    ctx.font = `${opts.weight || 800} ${opts.italic ? 'italic ' : ''}${size}px ${opts.font || 'Manrope, Arial'}`;
    ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'middle';
    glow(col, opts.blur ?? 16); ctx.fillStyle = opts.fill || col; ctx.fillText(text, x, y);
    noGlow(); ctx.restore();
  }

  function chromeTitle(text, x, y, size) {
    ctx.save();
    ctx.font = `900 italic ${size}px Manrope, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#9fe9ff'); g.addColorStop(0.5, '#2a1250'); g.addColorStop(0.62, '#ff3d7f'); g.addColorStop(1, '#ffd36e');
    glow('#ff3d7f', 28); ctx.fillStyle = g; ctx.fillText(text, x, y);
    noGlow(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeText(text, x, y);
    ctx.restore();
  }

  function drawHUD() {
    ctx.textBaseline = 'alphabetic';
    neonText(String(score).padStart(7, '0'), 18, 30, 22, '#3de0ff', { align: 'left', weight: 800, blur: 10 });
    neonText('BEST ' + String(Math.max(best, score)).padStart(7, '0'), 18, 50, 11, '#d6b26e', { align: 'left', weight: 700, blur: 6 });
    neonText('WAVE ' + Math.max(1, wave), W - 18, 30, 16, '#ff3d7f', { align: 'right', weight: 800, blur: 10 });
    // lives
    for (let i = 0; i < lives; i++) {
      ctx.save(); ctx.translate(W - 26 - i * 22, 50); ctx.scale(0.45, 0.45);
      glow('#3de0ff', 8); ctx.fillStyle = '#3de0ff';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-6, -14); ctx.lineTo(-12, 0); ctx.lineTo(-6, 14); ctx.closePath(); ctx.fill();
      noGlow(); ctx.restore();
    }
    // weapon pips
    ctx.font = '700 10px Manrope, Arial'; ctx.textAlign = 'left'; ctx.fillStyle = '#a59d90';
    ctx.fillText('SPREAD', 18, H - 16);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i <= P.spread ? '#ff3d7f' : 'rgba(255,255,255,0.12)'; ctx.fillRect(66 + i * 12, H - 24, 9, 9); }
    if (P.shield > 0) neonText('SHIELD', 118, H - 19, 10, '#3de0ff', { align: 'left', weight: 800, blur: 8 });
    if (!autoFire) neonText('AUTO-FIRE OFF', W - 18, H - 19, 10, '#a59d90', { align: 'right', weight: 700, blur: 0 });
    if (combo > 2) neonText(`COMBO ${combo}`, W / 2, H - 22, 14, '#ffd36e', { weight: 800, blur: 10 });
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
    drawBackground();
    // power-ups
    for (const u of pups) drawPowerup(u);
    for (const e of enemies) drawEnemy(e);
    if (boss) drawBoss();
    // player bullets
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const b of pb) {
      ctx.strokeStyle = 'rgba(61,224,255,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    for (const b of eb) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 9);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, b.col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, TAU); ctx.fill();
    }
    // particles
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.ring) { ctx.strokeStyle = p.col; ctx.globalAlpha = a; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
      else { ctx.globalAlpha = a; ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.restore();
    if (P.alive && (P.inv <= 0 || Math.floor(time * 14) % 2 === 0)) drawShip(P.x, P.y);
    // pops
    for (const p of pops) neonText(p.text, p.x, p.y, 12, p.col, { weight: 800, blur: 8, fill: p.col });
    ctx.restore();

    if (flash > 0) { ctx.fillStyle = `rgba(255,220,240,${flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
    // scanlines + vignette
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    if (mode === 'play') {
      drawHUD();
      if (bannerT > 0) {
        const a = Math.min(1, bannerT * 2, (2.2 - bannerT) * 4);
        ctx.globalAlpha = a; neonText(bannerText, W / 2, H / 2 - 40, 34, bannerText.startsWith('WARN') ? '#ff3d7f' : '#3de0ff', { italic: true, weight: 900 }); ctx.globalAlpha = 1;
      }
      if (paused) { ctx.fillStyle = 'rgba(5,2,12,0.6)'; ctx.fillRect(0, 0, W, H); neonText('PAUSED', W / 2, H / 2, 40, '#3de0ff', { italic: true, weight: 900 }); neonText('Press P to resume', W / 2, H / 2 + 40, 14, '#d6b26e', { weight: 600, blur: 4 }); }
    } else if (mode === 'title') {
      ctx.fillStyle = 'rgba(5,2,12,0.45)'; ctx.fillRect(0, 0, W, H);
      chromeTitle('ASTRO RUN', W / 2, 150, 92);
      neonText('· A NEON VAULT ARCADE ORIGINAL ·', W / 2, 215, 12, '#d6b26e', { weight: 700, blur: 6 });
      if (Math.floor(time * 2) % 2 === 0) neonText('PRESS SPACE  ·  TAP TO START', W / 2, 290, 20, '#3de0ff', { weight: 800 });
      neonText('ARROWS / WASD  FLY      AUTO-FIRE ON (F)      P  PAUSE', W / 2, 340, 11, '#f1e9db', { weight: 600, blur: 0 });
      neonText('S  SPREAD SHOT     H  SHIELD     1UP  EXTRA LIFE     MOTHERSHIP EVERY 4TH WAVE', W / 2, 362, 11, '#a59d90', { weight: 600, blur: 0 });
      neonText('BEST  ' + best.toLocaleString(), W / 2, 420, 16, '#ff3d7f', { weight: 800 });
    } else if (mode === 'over') {
      drawHUD();
      ctx.fillStyle = `rgba(5,2,12,${Math.min(0.7, overT)})`; ctx.fillRect(0, 0, W, H);
      chromeTitle('GAME OVER', W / 2, 150, 72);
      neonText('SCORE  ' + score.toLocaleString(), W / 2, 230, 26, '#3de0ff');
      neonText((newBest ? 'NEW BEST!  ' : 'BEST  ') + best.toLocaleString(), W / 2, 266, 16, newBest ? '#ffd36e' : '#d6b26e', { weight: 800 });
      neonText(`WAVE ${wave}   ·   +${earned} CHIPS`, W / 2, 300, 16, '#56d68b', { weight: 800, blur: 10 });
      if (overT > 1 && Math.floor(time * 2) % 2 === 0) neonText('PRESS SPACE  ·  TAP TO PLAY AGAIN', W / 2, 370, 18, '#ff3d7f', { weight: 800 });
    }
  }

  // ---------- input ----------
  const keys = new Set();
  const USED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyP', 'KeyF', 'KeyJ', 'Enter']);
  function onKey(e) {
    if (!USED.has(e.code)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keydown') {
      if (!e.repeat) pressed(e.code);
      keys.add(e.code);
    } else keys.delete(e.code);
  }
  function pressed(code) {
    if (code === 'Space' || code === 'Enter') {
      if (mode === 'title') startGame();
      else if (mode === 'over' && overT > 1) startGame();
    }
    if (code === 'KeyP' && mode === 'play') paused = !paused;
    if (code === 'KeyF' && mode === 'play') { autoFire = !autoFire; api.toast('Auto-fire ' + (autoFire ? 'on' : 'off')); }
  }
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  let drag = null;
  function onDown(e) {
    e.preventDefault();
    if (mode === 'title') { startGame(); return; }
    if (mode === 'over') { if (overT > 1) startGame(); return; }
    const p = toCanvas(e);
    drag = { id: e.pointerId, px: p.x, py: p.y, sx: P.x, sy: P.y };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toCanvas(e);
    P.tx = clamp(drag.sx + (p.x - drag.px) * 1.3, 24, W - 40);
    P.ty = clamp(drag.sy + (p.y - drag.py) * 1.3, 24, H - 26);
  }
  function onUp(e) { if (drag && e.pointerId === drag.id) { drag = null; P.tx = P.ty = null; } }
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
  reset(true);
  raf = requestAnimationFrame(frame);

  cv._dbg = () => ({ mode, score, wave, lives, enemies: enemies.length, boss: !!boss, spread: P.spread, shield: P.shield, best, x: P.x, y: P.y, paused });
  cv._dbgSkipWave = (n) => { wave = n - 1; queue = []; enemies = []; boss = null; waveGap = 0; };

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
