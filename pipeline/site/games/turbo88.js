// TURBO 88: pseudo-3D synthwave highway racer (Outrun feel).
export default function start(api) {
  const W = 800, H = 500;
  const card = api.open(`
    <div class="eyebrow">Arcade · Turbo 88</div><h2>Turbo <em>88</em></h2>
    <canvas class="game" width="${W}" height="${H}"></canvas>
    <div class="result" id="t88Status">↑ / W gas · ↓ / S brake · ← → steer · Shift or Space nitro · P pause · touch: hold & steer</div>
    <div class="row"><button class="primary" id="t88Start">Start</button><button data-close>Leave</button></div>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#t88Status');
  const startBtn = card.querySelector('#t88Start');

  const BEST_KEY = 'vault.turbo88.best';
  const loadBest = () => { try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ignore */ } };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const TAU = Math.PI * 2;

  // ---------- road constants ----------
  const SEG = 200, RUMBLE = 3, ROADW = 1600, LANES = 4, CAMH = 1500;
  const CAMD = 1 / Math.tan((100 / 2) * Math.PI / 180);
  const DRAW = 190, PLAYERZ = CAMH * CAMD;
  const MAXSPD = SEG * 60, NITROSPD = MAXSPD * 1.42;
  const ACCEL = MAXSPD / 4.5, BRAKE = -MAXSPD * 1.1, DECEL = -MAXSPD / 6;
  const OFFROAD_DECEL = -MAXSPD / 1.6, OFFROAD_LIMIT = MAXSPD / 3.5;
  const CENTRIFUGAL = 0.3, CAR_HALF = 0.15, CAR_LEN = 360;
  const LANE_X = [-0.75, -0.25, 0.25, 0.75];

  // ---------- track ----------
  let segs = [];
  const lastY = () => (segs.length ? segs[segs.length - 1].y2 : 0);
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
  function addSeg(curve, y) { const n = segs.length; segs.push({ curve, y1: lastY(), y2: y, sprites: [], dark: Math.floor(n / RUMBLE) % 2 === 1, grid: n % 10 === 0 }); }
  function addRoad(enter, hold, leave, curve, hill) {
    const sy = lastY(), ey = sy + hill * SEG, tot = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSeg(easeIn(0, curve, n / enter), easeInOut(sy, ey, n / tot));
    for (let n = 0; n < hold; n++) addSeg(curve, easeInOut(sy, ey, (enter + n) / tot));
    for (let n = 0; n < leave; n++) addSeg(easeInOut(curve, 0, n / leave), easeInOut(sy, ey, (enter + hold + n) / tot));
  }
  function buildTrack() {
    segs = [];
    addRoad(60, 80, 60, 0, 0);
    for (let i = 0; i < 36; i++) {
      const len = pick([25, 40, 60]);
      const curve = Math.random() < 0.25 ? 0 : pick([-6, -4, -3, -2, 2, 3, 4, 6]);
      let hill = pick([0, 0, 15, -15, 30, -30, 45, -45]);
      const ly = lastY() / SEG; if (Math.abs(ly + hill) > 90) hill = -hill;
      addRoad(len, len, len, curve, hill);
    }
    addRoad(80, 80, 80, 0, -lastY() / SEG);
    segs[segs.length - 1].y2 = 0;
    // roadside dressing
    for (let i = 8; i < segs.length; i++) {
      const s = segs[i];
      if (i % 6 === 0 && Math.random() < 0.85) s.sprites.push({ k: 'palm', x: -rnd(1.35, 2.0), h: rnd(0.9, 1.25) });
      if (i % 6 === 3 && Math.random() < 0.85) s.sprites.push({ k: 'palm', x: rnd(1.35, 2.0), h: rnd(0.9, 1.25) });
      if (i % 9 === 0 && Math.random() < 0.6) s.sprites.push({ k: 'palm', x: pick([-1, 1]) * rnd(2.4, 3.6), h: rnd(1, 1.4) });
      if (i % 24 === 12) { s.sprites.push({ k: 'lamp', x: -1.18 }); s.sprites.push({ k: 'lamp', x: 1.18 }); }
      if (i % 150 === 75) s.sprites.push({ k: 'sign', x: pick([-1.9, 1.9]), text: pick(['TURBO 88', 'THE VAULT', 'NEON NIGHTS', 'MIAMI 1988', 'DRIVE']) });
    }
  }
  const seg = (i) => segs[((i % segs.length) + segs.length) % segs.length];

  // ---------- background layers ----------
  const sky = document.createElement('canvas'); sky.width = W; sky.height = H;
  (function paintSky() {
    const b = sky.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, H * 0.56);
    g.addColorStop(0, '#05010d'); g.addColorStop(0.45, '#1b0533'); g.addColorStop(0.8, '#4a0d55'); g.addColorStop(1, '#8a1a6a');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const y = Math.pow(Math.random(), 1.6) * H * 0.45;
      b.fillStyle = `rgba(255,255,255,${rnd(0.2, 0.9) * (1 - y / (H * 0.5))})`;
      const s = Math.random() < 0.1 ? 1.8 : 1; b.fillRect(rnd(0, W), y, s, s);
    }
  })();
  const mtnFar = makeRange(2400, 70, 120, '#2a0b46', 'rgba(255,61,127,0.55)', 3);
  const mtnNear = makeRange(2000, 55, 90, '#16052a', 'rgba(61,224,255,0.5)', 11);
  const city = makeCity(2000);
  function makeRange(w, minH, maxH, fill, line, seed) {
    const c = document.createElement('canvas'); c.width = w; c.height = 160; const b = c.getContext('2d');
    let s = seed; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const pts = []; const n = 22;
    for (let i = 0; i <= n; i++) pts.push([i * w / n, 160 - (minH + r() * (maxH - minH))]);
    pts[n][1] = pts[0][1];
    b.beginPath(); b.moveTo(0, 160); pts.forEach((p) => b.lineTo(p[0], p[1])); b.lineTo(w, 160); b.closePath();
    const g = b.createLinearGradient(0, 30, 0, 160); g.addColorStop(0, fill); g.addColorStop(1, '#07020f');
    b.fillStyle = g; b.fill();
    b.beginPath(); pts.forEach((p, i) => (i ? b.lineTo(p[0], p[1]) : b.moveTo(p[0], p[1])));
    b.strokeStyle = line; b.lineWidth = 2; b.shadowColor = line; b.shadowBlur = 10; b.stroke();
    // wire lines down the slopes
    b.shadowBlur = 0; b.globalAlpha = 0.25; b.lineWidth = 1;
    pts.forEach((p) => { b.beginPath(); b.moveTo(p[0], p[1]); b.lineTo(p[0] + rnd(-30, 30), 160); b.stroke(); });
    return c;
  }
  function makeCity(w) {
    const c = document.createElement('canvas'); c.width = w; c.height = 120; const b = c.getContext('2d');
    let x = 0;
    while (x < w) {
      const bw = rnd(18, 46), bh = rnd(20, 100);
      b.fillStyle = '#0c0318'; b.fillRect(x, 120 - bh, bw, bh);
      b.fillStyle = 'rgba(255,200,120,0.5)';
      for (let yy = 120 - bh + 5; yy < 116; yy += 6) for (let xx = x + 3; xx < x + bw - 3; xx += 5) if (Math.random() < 0.18) b.fillRect(xx, yy, 2, 2);
      if (Math.random() < 0.2) { b.fillStyle = pick(['#ff3d7f', '#3de0ff']); b.fillRect(x + bw / 2 - 1, 120 - bh - 8, 2, 8); }
      x += bw + rnd(0, 8);
    }
    return c;
  }

  // ---------- state ----------
  let mode = 'title'; // title | play | crash | over
  let paused = false, best = loadBest();
  let position = 0, speed = 0, playerX = 0, playerY = 0, steerVis = 0;
  let score = 0, distance = 0, nitro = 0.5, nitroOn = false, level = 1, nearCombo = 0, nearT = 0;
  let cars = [], pickups = [], parts = [], pops = [];
  let shake = 0, flash = 0, time = 0, skyOff = 0, crashT = 0, overT = 0, earned = 0, newBest = false, spin = 0;
  let banner = '', bannerT = 0;

  function reset(demo) {
    buildTrack();
    position = 0; speed = demo ? MAXSPD * 0.8 : 0; playerX = 0; playerY = 0; steerVis = 0;
    score = 0; distance = 0; nitro = 0.5; nitroOn = false; level = 1; nearCombo = 0; nearT = 0;
    cars = []; pickups = []; parts = []; pops = [];
    shake = 0; flash = 0; crashT = 0; spin = 0; newBest = false;
    for (let i = 0; i < 6; i++) spawnCar(PLAYERZ + 3000 + i * 3500);
  }

  function spawnCar(zAhead) {
    const z = position + zAhead;
    const lanesBusy = new Set(cars.filter((c) => Math.abs(c.z - z) < 1400).map((c) => c.lane));
    if (lanesBusy.size >= LANES - 1) return;
    const free = [0, 1, 2, 3].filter((l) => !lanesBusy.has(l));
    const lane = pick(free);
    const lv = Math.min(level, 8);
    cars.push({
      z, lane, x: LANE_X[lane], tx: LANE_X[lane],
      speed: MAXSPD * rnd(0.32 + lv * 0.02, 0.55 + lv * 0.03),
      col: pick(['#3de0ff', '#ffd36e', '#56d68b', '#b48cff', '#ff9a4a', '#f1e9db', '#ff5e9a']),
      changeT: rnd(2, 6), passed: false, prevDz: z - (position + PLAYERZ), kind: Math.random() < 0.15 + lv * 0.02 ? 'van' : 'car',
    });
  }

  // ---------- fx ----------
  function spark(x, y, col, n, sp, life = 0.6) {
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(sp * 0.2, sp); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rnd(life * 0.4, life), max: life, col, size: rnd(1.5, 3.5) }); }
  }
  function pop(text, col = '#ffd36e') { pops.push({ text, col, life: 1.2, y: H * 0.42 }); }

  function startGame() {
    reset(false); mode = 'play'; paused = false;
    banner = 'GO!'; bannerT = 1.4;
    statusEl.textContent = 'Weave through traffic. Near misses pay. Grab nitro canisters.';
    startBtn.textContent = 'Restart';
  }
  function crash() {
    mode = 'crash'; crashT = 0; shake = 22; flash = 0.7;
    spark(W / 2, H - 60, '#ffd36e', 50, 420, 1.0); spark(W / 2, H - 60, '#ff3d7f', 40, 360, 1.2); spark(W / 2, H - 60, '#ffffff', 20, 260, 0.6);
  }
  function gameOver() {
    mode = 'over'; overT = 0;
    score = Math.floor(score);
    earned = Math.min(1500, Math.floor(score / 50));
    if (score > best) { best = score; saveBest(best); newBest = true; }
    if (earned > 0) { api.addChips(earned); api.toast(`Turbo 88: +${earned} chips`); }
    if (score >= 20000) api.broadcast(`drove ${(distance / 154000).toFixed(1)} km and scored ${score.toLocaleString()} in Turbo 88`);
    statusEl.textContent = `Wrecked · score ${score.toLocaleString()} · ${(distance / 154000).toFixed(2)} km · +${earned} chips · best ${best.toLocaleString()}`;
    startBtn.textContent = 'Drive again';
  }

  // ---------- update ----------
  function input() {
    if (mode === 'title') {
      // attract-mode autopilot: aim for the lane with the most room ahead
      let bestLane = 0, bestGap = -1;
      for (let l = 0; l < LANES; l++) {
        let gap = 1e9;
        for (const c of cars) { const dz = c.z - (position + PLAYERZ); if (dz > -200 && Math.abs(c.x - LANE_X[l]) < 0.3) gap = Math.min(gap, dz); }
        gap -= Math.abs(LANE_X[l] - playerX) * 3000;
        if (gap > bestGap) { bestGap = gap; bestLane = l; }
      }
      const d = LANE_X[bestLane] - playerX;
      return { gas: speed < MAXSPD * 0.85, brake: false, steer: Math.abs(d) > 0.05 ? Math.sign(d) : 0, nitro: false };
    }
    let steer = 0, gas = false, brake = false, nit = false;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steer -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steer += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) gas = true;
    if (keys.has('ArrowDown') || keys.has('KeyS')) brake = true;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Space')) nit = true;
    for (const t of touches.values()) {
      if (t.role === 'nitro') nit = true;
      else if (t.role === 'brake') brake = true;
      else { gas = true; const d = (t.x - W / 2) / 140; if (Math.abs(d) > 0.15) steer += clamp(d, -1, 1); }
    }
    return { gas, brake, steer: clamp(steer, -1, 1), nitro: nit };
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 30); flash = Math.max(0, flash - dt * 1.5);
    bannerT = Math.max(0, bannerT - dt); nearT -= dt; if (nearT <= 0) nearCombo = 0;
    updateFx(dt);
    if (mode === 'over') { overT += dt; speed = Math.max(0, speed - MAXSPD * dt); position += speed * dt; moveCars(dt); return; }

    const pAbs = position + PLAYERZ;
    const pSeg = seg(Math.floor(pAbs / SEG));
    const sp = speed / MAXSPD;

    if (mode === 'crash') {
      crashT += dt; spin += dt * 9 * Math.max(0, 1 - crashT / 1.2);
      speed = Math.max(0, speed + BRAKE * 1.4 * dt);
      position += speed * dt;
      if (Math.random() < 0.5) spark(W / 2 + rnd(-40, 40), H - 50, pick(['#ffd36e', '#ff3d7f']), 2, 200);
      moveCars(dt);
      if (crashT > 1.6) gameOver();
      return;
    }

    const c = input();
    const dx = dt * 2.2 * Math.min(1, sp + 0.15);
    playerX += dx * c.steer;
    steerVis += (c.steer - steerVis) * Math.min(1, dt * 8);
    playerX -= dx * sp * pSeg.curve * CENTRIFUGAL;

    nitroOn = c.nitro && nitro > 0 && sp > 0.3;
    if (nitroOn) { speed += ACCEL * 1.8 * dt; nitro = Math.max(0, nitro - dt * 0.28); }
    else if (c.gas) speed += ACCEL * dt * (1.15 - sp * 0.4);
    else if (c.brake) speed += BRAKE * dt;
    else speed += DECEL * dt;
    const cap = nitroOn ? NITROSPD : MAXSPD;
    if (speed > cap) speed = Math.max(cap, speed - MAXSPD * 0.6 * dt);
    if (Math.abs(playerX) > 1.05) {
      if (speed > OFFROAD_LIMIT) speed += OFFROAD_DECEL * dt;
      if (speed > 1000) { shake = Math.max(shake, 2.5); if (Math.random() < 0.4) spark(W / 2 + rnd(-60, 60), H - 20, '#b48cff', 1, 120, 0.4); }
    }
    playerX = clamp(playerX, -2.2, 2.2);
    speed = clamp(speed, 0, NITROSPD);
    position += speed * dt;
    skyOff += pSeg.curve * sp * dt * 0.012;

    if (mode === 'play') {
      distance += speed * dt;
      score += speed * dt / 40 * (nitroOn ? 1.5 : 1);
      const newLevel = 1 + Math.floor(distance / 240000);
      if (newLevel > level) { level = newLevel; banner = 'ZONE ' + level; bannerT = 1.8; }
    }

    // nitro flames
    if (nitroOn) {
      for (let k = 0; k < 3; k++) parts.push({ x: W / 2 + pick([-38, 38]) + rnd(-3, 3), y: H - 34, vx: rnd(-30, 30), vy: rnd(60, 160), life: 0.25, max: 0.25, col: pick(['#3de0ff', '#9feaff', '#ffffff']), size: rnd(2, 5) });
      if (Math.random() < 0.7) parts.push({ streak: true, x: rnd(0, W), y: rnd(0, H), life: 0.25, max: 0.25 });
    }

    moveCars(dt);

    // traffic management
    const target = Math.min(26, 8 + level * 2);
    if (cars.length < target && Math.random() < dt * 3) spawnCar(rnd(DRAW * SEG * 0.55, DRAW * SEG * 0.9));
    if (pickups.length < 2 && Math.random() < dt * 0.12) pickups.push({ z: position + DRAW * SEG * 0.8, x: pick(LANE_X), t: 0 });

    // collisions & near misses
    for (const car of cars) {
      const dz = car.z - (position + PLAYERZ);
      const dxp = Math.abs(car.x - playerX);
      const crossed = car.prevDz > 0 && dz <= 0;
      if (mode === 'play' && (Math.abs(dz) < CAR_LEN || crossed) && dxp < CAR_HALF * 2 * (car.kind === 'van' ? 1.12 : 1)) { crash(); car.speed *= 0.4; return; }
      if (crossed && !car.passed) {
        car.passed = true;
        if (mode === 'play' && dxp < 0.44 && sp > 0.45) {
          nearCombo++; nearT = 3;
          const bonus = 150 * nearCombo;
          score += bonus; nitro = Math.min(1, nitro + 0.05);
          pop(nearCombo > 1 ? `NEAR MISS x${nearCombo}  +${bonus}` : `NEAR MISS  +${bonus}`, nearCombo > 2 ? '#ff3d7f' : '#ffd36e');
          shake = Math.max(shake, 3);
        }
      }
      car.prevDz = dz;
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pu = pickups[i]; pu.t += dt;
      const dz = pu.z - (position + PLAYERZ);
      if (dz < -400) { pickups.splice(i, 1); continue; }
      if (Math.abs(dz) < 300 && Math.abs(pu.x - playerX) < 0.3) {
        pickups.splice(i, 1); nitro = Math.min(1, nitro + 0.4);
        if (mode === 'play') score += 250;
        pop('NITRO +40%', '#3de0ff'); flash = 0.15;
        spark(W / 2, H - 80, '#3de0ff', 24, 300);
      }
    }
  }

  function moveCars(dt) {
    const pAbs = position + PLAYERZ;
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      const dz = car.z - pAbs;
      // cars approaching from behind politely slow down
      if (dz < 0 && dz > -2500 && car.speed > speed && Math.abs(car.x - playerX) < 0.4) car.speed = Math.max(speed * 0.92, 0);
      car.z += car.speed * dt;
      car.changeT -= dt;
      if (car.changeT <= 0 && level >= 2 && dz > 1500) {
        car.changeT = rnd(4 - Math.min(level, 6) * 0.4, 8);
        const nl = clamp(car.lane + pick([-1, 1]), 0, LANES - 1);
        const blocked = cars.some((o) => o !== car && o.lane === nl && Math.abs(o.z - car.z) < 1200);
        if (!blocked) { car.lane = nl; car.tx = LANE_X[nl]; }
      }
      car.x += clamp(car.tx - car.x, -dt * 0.6, dt * 0.6);
      if (dz < -3000 || dz > DRAW * SEG * 1.2) cars.splice(i, 1);
    }
  }

  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (!p.streak) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; }
    }
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.life -= dt; p.y -= 26 * dt; if (p.life <= 0) pops.splice(i, 1); }
  }

  // ---------- render helpers ----------
  const glow = (c, b) => { ctx.shadowColor = c; ctx.shadowBlur = b; };
  const noGlow = () => { ctx.shadowBlur = 0; };
  const FOG = [58, 14, 72];
  const mix = (c, f) => `rgb(${(c[0] + (FOG[0] - c[0]) * f) | 0},${(c[1] + (FOG[1] - c[1]) * f) | 0},${(c[2] + (FOG[2] - c[2]) * f) | 0})`;
  const COL = {
    groundL: [20, 8, 36], groundD: [14, 5, 27], gridLine: [150, 30, 150],
    roadL: [30, 24, 48], roadD: [25, 20, 41],
    rumbleL: [255, 61, 127], rumbleD: [70, 14, 80], edge: [255, 140, 200], lane: [61, 224, 255],
  };
  function poly(x1, y1, x2, y2, x3, y3, x4, y4, c) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
  }

  function drawBackground() {
    ctx.drawImage(sky, 0, 0);
    const hy = H / 2 + 6;
    // sun
    const sx = W / 2 - skyOff * 60 % W, sy = hy - 60, sr = 112;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 2.6);
    halo.addColorStop(0, 'rgba(255,90,140,0.45)'); halo.addColorStop(1, 'rgba(255,61,127,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, hy);
    ctx.save();
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.clip();
    const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, '#fff2a0'); sg.addColorStop(0.45, '#ffa64d'); sg.addColorStop(0.8, '#ff3d7f'); sg.addColorStop(1, '#c0157a');
    ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    ctx.fillStyle = '#5a1260';
    for (let i = 0; i < 8; i++) { const y = sy + 4 + i * 12 + ((time * 8) % 12); ctx.fillRect(sx - sr, y, sr * 2, 1 + i * 0.9); }
    ctx.restore();
    // ranges with parallax (wrap)
    const layer = (img, off, y, scale = 1) => {
      const w = img.width * scale, h = img.height * scale;
      let x = -(((off % w) + w) % w);
      for (; x < W; x += w) ctx.drawImage(img, x, y - h, w, h);
    };
    layer(mtnFar, skyOff * 300, hy + 2);
    layer(city, skyOff * 500, hy + 2);
    layer(mtnNear, skyOff * 700, hy + 4);
    // far plain below horizon
    const pg = ctx.createLinearGradient(0, hy, 0, H);
    pg.addColorStop(0, 'rgb(58,14,72)'); pg.addColorStop(1, '#0a0314');
    ctx.fillStyle = pg; ctx.fillRect(0, hy + 3, W, H - hy);
  }

  const proj = [];
  for (let i = 0; i < DRAW; i++) proj.push({});

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
    drawBackground();

    const base = Math.floor(position / SEG);
    const basePct = (position % SEG) / SEG;
    const pAbs = position + PLAYERZ;
    const pSeg = seg(Math.floor(pAbs / SEG));
    const pPct = (pAbs % SEG) / SEG;
    playerY = lerp(pSeg.y1, pSeg.y2, pPct);
    const camY = playerY + CAMH, camX = playerX * ROADW;
    let x = 0, dx = -(seg(base).curve * basePct), maxy = H;

    for (let n = 0; n < DRAW; n++) {
      const i = base + n, s = seg(i), P = proj[n];
      const z1 = i * SEG - position, z2 = (i + 1) * SEG - position;
      const s1 = CAMD / Math.max(z1, 1), s2 = CAMD / Math.max(z2, 1);
      P.x1 = W / 2 + s1 * (x - camX) * W / 2; P.y1 = H / 2 - s1 * (s.y1 - camY) * H / 2; P.w1 = s1 * ROADW * W / 2; P.s1 = s1;
      P.x2 = W / 2 + s2 * (x + dx - camX) * W / 2; P.y2 = H / 2 - s2 * (s.y2 - camY) * H / 2; P.w2 = s2 * ROADW * W / 2; P.s2 = s2;
      P.clip = maxy; P.vis = !(z1 <= CAMD);
      x += dx; dx += s.curve;
      if (z1 <= CAMD || P.y2 >= P.y1 || P.y2 >= maxy) continue;
      const f = 1 - Math.exp(-Math.pow(n / DRAW, 2) * 4);
      drawSegment(P, s, f);
      maxy = P.y2;
    }

    // sprites, cars, pickups back to front
    const carsBy = new Map();
    for (const c of cars) { const n = Math.floor(c.z / SEG) - base; if (n > 0 && n < DRAW) { if (!carsBy.has(n)) carsBy.set(n, []); carsBy.get(n).push(c); } }
    const pupBy = new Map();
    for (const u of pickups) { const n = Math.floor(u.z / SEG) - base; if (n > 0 && n < DRAW) { if (!pupBy.has(n)) pupBy.set(n, []); pupBy.get(n).push(u); } }
    for (let n = DRAW - 1; n > 0; n--) {
      const P = proj[n]; if (!P.vis) continue;
      const s = seg(base + n);
      const clipY = P.clip;
      const hasStuff = s.sprites.length || carsBy.has(n) || pupBy.has(n);
      if (!hasStuff) continue;
      const fog = Math.min(1, Math.pow(n / DRAW, 2) * 2.2);
      ctx.save(); ctx.beginPath(); ctx.rect(-50, -50, W + 100, clipY + 50); ctx.clip();
      ctx.globalAlpha = 1 - fog * 0.85;
      for (const sp of s.sprites) {
        const sx = P.x1 + P.s1 * sp.x * ROADW * W / 2, sy = P.y1, sc = P.s1 * W / 2;
        if (sx < -400 || sx > W + 400) continue;
        if (sp.k === 'palm') drawPalm(sx, sy, 2600 * sp.h * sc, sp.x < 0);
        else if (sp.k === 'lamp') drawLamp(sx, sy, 2200 * sc, sp.x < 0);
        else drawSign(sx, sy, 2600 * sc, sp.text);
      }
      const list = (pupBy.get(n) || []);
      for (const u of list) {
        const pct = (u.z % SEG) / SEG;
        const sc = lerp(P.s1, P.s2, pct) * W / 2;
        const sx = lerp(P.x1, P.x2, pct) + sc * u.x * ROADW, sy = lerp(P.y1, P.y2, pct);
        drawPickup(sx, sy, 300 * sc, u.t);
      }
      const cl = (carsBy.get(n) || []).sort((a, b) => b.z - a.z);
      for (const c of cl) {
        const pct = (c.z % SEG) / SEG;
        const sc = lerp(P.s1, P.s2, pct) * W / 2;
        const sx = lerp(P.x1, P.x2, pct) + sc * c.x * ROADW, sy = lerp(P.y1, P.y2, pct);
        drawCar(sx, sy, 2 * CAR_HALF * ROADW * sc * (c.kind === 'van' ? 1.12 : 1), c.col, { van: c.kind === 'van', lean: (c.tx - c.x) * 0.5 });
      }
      ctx.restore();
    }

    // player car
    const bounce = mode === 'play' || mode === 'title' ? Math.sin(time * 30) * (speed / MAXSPD) * 1.2 + (Math.abs(playerX) > 1.05 ? rnd(-2, 2) : 0) : 0;
    ctx.save();
    ctx.translate(W / 2, H - 14 + bounce);
    if (mode === 'crash' || mode === 'over') ctx.rotate(Math.sin(spin) * 0.35);
    ctx.globalAlpha = 1;
    drawCar(0, 0, 2 * CAR_HALF * ROADW * (CAMD / PLAYERZ) * W / 2 * 1.08, '#ff3d7f', { player: true, brake: keys.has('ArrowDown') || keys.has('KeyS'), lean: steerVis, nitro: nitroOn });
    ctx.restore();

    // particles
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1); ctx.globalAlpha = a;
      if (p.streak) { ctx.strokeStyle = 'rgba(160,240,255,0.7)'; ctx.lineWidth = 1.5; const ang = Math.atan2(p.y - H / 2, p.x - W / 2); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(ang) * 60, p.y + Math.sin(ang) * 60); ctx.stroke(); }
      else { ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.restore();
    ctx.restore();

    if (flash > 0) { ctx.fillStyle = `rgba(255,230,240,${flash * 0.45})`; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    if (mode === 'title') drawTitle();
    else { drawHUD(); if (mode === 'over') drawOver(); }
    if (paused && mode === 'play') { ctx.fillStyle = 'rgba(5,2,12,0.6)'; ctx.fillRect(0, 0, W, H); neon('PAUSED', W / 2, H / 2, 42, '#3de0ff', { italic: true, weight: 900 }); }
  }

  function drawSegment(P, s, f) {
    const { x1, y1, w1, x2, y2, w2 } = P;
    ctx.fillStyle = mix(s.grid ? COL.gridLine : s.dark ? COL.groundD : COL.groundL, s.grid ? Math.max(f, 0.2) : f);
    ctx.fillRect(0, y2, W, y1 - y2 + 1);
    const r1 = w1 / 7, r2 = w2 / 7;
    poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, mix(s.dark ? COL.rumbleD : COL.rumbleL, f));
    poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, mix(s.dark ? COL.rumbleD : COL.rumbleL, f));
    poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, mix(s.dark ? COL.roadD : COL.roadL, f));
    const e1 = w1 / 50, e2 = w2 / 50, ec = mix(COL.edge, f);
    poly(x1 - w1, y1, x1 - w1 + e1, y1, x2 - w2 + e2, y2, x2 - w2, y2, ec);
    poly(x1 + w1, y1, x1 + w1 - e1, y1, x2 + w2 - e2, y2, x2 + w2, y2, ec);
    if (!s.dark) {
      const l1 = w1 / 40, l2 = w2 / 40, lc = mix(COL.lane, f);
      for (let k = 1; k < LANES; k++) {
        const lx1 = x1 - w1 + (2 * w1 * k) / LANES, lx2 = x2 - w2 + (2 * w2 * k) / LANES;
        poly(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, lc);
      }
    }
  }

  function drawCar(x, y, w, col, o = {}) {
    if (w < 2) return;
    const L = x - w / 2, R = x + w / 2;
    const hb = o.van ? 0.5 : 0.36; // body top
    ctx.save();
    if (o.lean) { ctx.translate(x, y); ctx.rotate(o.lean * 0.04); ctx.translate(-x, -y); }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(x, y - w * 0.01, w * 0.56, w * 0.07, 0, 0, TAU); ctx.fill();
    // tyres
    ctx.fillStyle = '#07050a';
    ctx.fillRect(L + w * 0.03, y - w * 0.15, w * 0.17, w * 0.15); ctx.fillRect(R - w * 0.20, y - w * 0.15, w * 0.17, w * 0.15);
    // body
    const bg = ctx.createLinearGradient(0, y - w * hb, 0, y - w * 0.06);
    bg.addColorStop(0, shade(col, 0.95)); bg.addColorStop(0.35, shade(col, 0.6)); bg.addColorStop(1, shade(col, 0.22));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(L, y - w * 0.07); ctx.lineTo(L, y - w * (hb - 0.06));
    ctx.quadraticCurveTo(L + w * 0.01, y - w * hb, L + w * 0.08, y - w * hb);
    ctx.lineTo(R - w * 0.08, y - w * hb); ctx.quadraticCurveTo(R - w * 0.01, y - w * hb, R, y - w * (hb - 0.06));
    ctx.lineTo(R, y - w * 0.07); ctx.closePath(); ctx.fill();
    if (w > 30) { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w / 90); if (o.player) glow(col, 12); ctx.stroke(); noGlow(); }
    // cabin / glass
    const ct = o.van ? 0.66 : 0.56;
    const gg = ctx.createLinearGradient(0, y - w * ct, 0, y - w * hb);
    gg.addColorStop(0, '#2a3f66'); gg.addColorStop(0.5, '#0b1020'); gg.addColorStop(1, '#05070e');
    ctx.fillStyle = gg;
    ctx.beginPath();
    const cbw = o.van ? 0.44 : 0.36, ctw = o.van ? 0.4 : 0.25;
    ctx.moveTo(x - w * cbw, y - w * hb); ctx.lineTo(x - w * ctw, y - w * ct); ctx.lineTo(x + w * ctw, y - w * ct); ctx.lineTo(x + w * cbw, y - w * hb); ctx.closePath(); ctx.fill();
    if (w > 30) { ctx.strokeStyle = shade(col, 0.8); ctx.lineWidth = Math.max(1, w / 120); ctx.stroke(); }
    // glass reflection
    ctx.fillStyle = 'rgba(160,220,255,0.18)';
    ctx.beginPath(); ctx.moveTo(x - w * ctw * 0.7, y - w * (ct - 0.02)); ctx.lineTo(x - w * ctw * 0.2, y - w * (ct - 0.02)); ctx.lineTo(x - w * cbw * 0.5, y - w * (hb + 0.01)); ctx.lineTo(x - w * cbw * 0.85, y - w * (hb + 0.01)); ctx.closePath(); ctx.fill();
    // rear panel with louvres + tail light bar
    const ty = y - w * (hb - 0.07), th = w * 0.1;
    ctx.fillStyle = '#0a0610'; ctx.fillRect(L + w * 0.05, ty, w * 0.9, th);
    const bright = o.brake ? 1 : 0.75;
    ctx.fillStyle = `rgba(255,${o.brake ? 60 : 30},${o.brake ? 90 : 70},${bright})`;
    ctx.fillRect(L + w * 0.06, ty + th * 0.15, w * 0.88, th * 0.7);
    ctx.fillStyle = 'rgba(10,6,16,0.85)';
    for (let k = 1; k < 6; k++) ctx.fillRect(L + w * 0.06, ty + th * 0.15 + (th * 0.7 * k) / 6, w * 0.88, Math.max(0.6, th * 0.05));
    // bumper + plate
    ctx.fillStyle = shade(col, 0.15); ctx.fillRect(L + w * 0.02, y - w * 0.13, w * 0.96, w * 0.05);
    if (w > 20) { ctx.fillStyle = '#efe6d2'; ctx.fillRect(x - w * 0.09, y - w * 0.155, w * 0.18, w * 0.05); }
    if (o.player && w > 60) { ctx.fillStyle = '#17120a'; ctx.font = `800 ${Math.round(w * 0.035)}px Manrope, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VAULT 88', x, y - w * 0.13); }
    // light glow
    if (w > 12) {
      ctx.globalCompositeOperation = 'lighter';
      for (const lx of [L + w * 0.14, R - w * 0.14]) {
        const r = w * (o.brake ? 0.32 : 0.22);
        const lg = ctx.createRadialGradient(lx, ty + th / 2, 0, lx, ty + th / 2, r);
        lg.addColorStop(0, `rgba(255,60,90,${o.brake ? 0.75 : 0.45})`); lg.addColorStop(1, 'rgba(255,0,60,0)');
        ctx.fillStyle = lg; ctx.fillRect(lx - r, ty + th / 2 - r, r * 2, r * 2);
      }
      if (o.nitro) {
        for (const ex of [x - w * 0.25, x + w * 0.25]) {
          const fl = w * rnd(0.18, 0.3);
          const ng = ctx.createRadialGradient(ex, y - w * 0.08, 0, ex, y - w * 0.08, fl);
          ng.addColorStop(0, 'rgba(255,255,255,0.95)'); ng.addColorStop(0.3, 'rgba(61,224,255,0.8)'); ng.addColorStop(1, 'rgba(61,100,255,0)');
          ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(ex, y - w * 0.08, fl, 0, TAU); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`;
  }

  function drawPalm(x, y, h, left) {
    if (h < 3) return;
    const lean = (left ? -1 : 1) * h * 0.12;
    const tx = x + lean, ty = y - h;
    ctx.strokeStyle = '#140620'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, h * 0.035);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.1, y - h * 0.5, tx, ty); ctx.stroke();
    if (h > 40) { ctx.strokeStyle = 'rgba(255,61,127,0.45)'; ctx.lineWidth = Math.max(1, h * 0.008); ctx.beginPath(); ctx.moveTo(x + h * 0.012, y); ctx.quadraticCurveTo(x + lean * 0.1 + h * 0.012, y - h * 0.5, tx + h * 0.01, ty); ctx.stroke(); }
    ctx.fillStyle = '#12041c';
    const fr = h * 0.42;
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 + (k - 3.5) * 0.42 + (k % 2 ? 0.1 : -0.1);
      const ex = tx + Math.cos(a) * fr * 1.1, ey = ty + Math.sin(a) * fr * 0.55 + fr * 0.55;
      const cx = tx + Math.cos(a) * fr * 0.6, cy = ty + Math.sin(a) * fr * 0.9 - fr * 0.1;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(cx, cy - fr * 0.12, ex, ey);
      ctx.quadraticCurveTo(cx, cy + fr * 0.08, tx, ty);
      ctx.fill();
      if (h > 60) { ctx.strokeStyle = 'rgba(255,61,127,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  function drawLamp(x, y, h, left) {
    if (h < 3) return;
    const dir = left ? 1 : -1;
    ctx.strokeStyle = '#2a1640'; ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.lineTo(x + dir * h * 0.18, y - h * 1.02); ctx.stroke();
    const lx = x + dir * h * 0.18, ly = y - h;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const r = Math.min(h * 0.16, 46);
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(61,224,255,0.6)'); g.addColorStop(1, 'rgba(61,224,255,0)');
    ctx.fillStyle = g; ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    ctx.restore();
  }
  function drawSign(x, y, w, text) {
    if (w < 6) return;
    const h = w * 0.42, top = y - w * 0.9;
    ctx.fillStyle = '#1a0b26'; ctx.fillRect(x - w * 0.02, top + h, w * 0.04, y - top - h);
    ctx.fillStyle = 'rgba(12,4,22,0.92)'; ctx.fillRect(x - w / 2, top, w, h);
    ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = Math.max(1, w / 80); if (w > 60) glow('#3de0ff', 12); ctx.strokeRect(x - w / 2, top, w, h); noGlow();
    if (w > 30) {
      ctx.font = `900 italic ${Math.round(h * 0.42)}px Manrope, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (w > 60) glow('#ff3d7f', 14); ctx.fillStyle = '#ff7ab0'; ctx.fillText(text, x, top + h / 2); noGlow();
    }
  }
  function drawPickup(x, y, s, t) {
    if (s < 2) return;
    const cy = y - s * 0.9 - Math.sin(t * 5) * s * 0.15;
    ctx.save(); ctx.translate(x, cy); ctx.rotate(t * 2);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.4);
    g.addColorStop(0, 'rgba(61,224,255,0.7)'); g.addColorStop(1, 'rgba(61,224,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 1.4, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0a1c2a'; ctx.strokeStyle = '#9feaff'; ctx.lineWidth = Math.max(1, s / 12);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 0.7); ctx.lineTo(-s * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.rotate(-t * 2);
    if (s > 10) { ctx.fillStyle = '#ffffff'; ctx.font = `900 ${Math.round(s * 0.6)}px Manrope, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, 1); }
    ctx.restore();
  }

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
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#9fe9ff'); g.addColorStop(0.5, '#2a1250'); g.addColorStop(0.62, '#ff3d7f'); g.addColorStop(1, '#ffd36e');
    glow('#ff3d7f', 26); ctx.fillStyle = g; ctx.fillText(text, x, y); noGlow();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.strokeText(text, x, y);
    ctx.restore();
  }

  function drawHUD() {
    const kmh = Math.round(speed / MAXSPD * 280);
    // speedometer arc
    const cx = W - 92, cy = H - 64, r = 52;
    ctx.save();
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
    const frac = clamp(speed / NITROSPD, 0, 1);
    const sg = ctx.createLinearGradient(cx - r, 0, cx + r, 0); sg.addColorStop(0, '#3de0ff'); sg.addColorStop(0.7, '#ff3d7f'); sg.addColorStop(1, '#ffd36e');
    glow('#ff3d7f', 12); ctx.strokeStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * frac)); ctx.stroke(); noGlow();
    ctx.restore();
    neon(String(kmh), cx, cy - 4, 28, '#f1e9db', { weight: 900, blur: 8 });
    neon('KM/H', cx, cy + 18, 9, '#a59d90', { weight: 700, blur: 0 });
    // nitro bar
    const nx = W - 196, ny = H - 26;
    neon('NITRO', nx - 6, ny + 4, 9, '#3de0ff', { align: 'right', weight: 800, blur: 4 });
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(nx, ny, 80, 8);
    glow('#3de0ff', nitroOn ? 16 : 8); ctx.fillStyle = nitroOn ? '#ffffff' : '#3de0ff'; ctx.fillRect(nx, ny, 80 * nitro, 8); noGlow();
    // score
    neon(String(Math.floor(score)).padStart(7, '0'), 18, 28, 24, '#3de0ff', { align: 'left', weight: 900, blur: 10 });
    neon('BEST ' + String(Math.max(best, Math.floor(score))).padStart(7, '0'), 18, 50, 11, '#d6b26e', { align: 'left', weight: 700, blur: 4 });
    neon(`ZONE ${level}`, W - 18, 28, 16, '#ff3d7f', { align: 'right', weight: 900, blur: 10 });
    neon(`${(distance / 154000).toFixed(2)} KM`, W - 18, 48, 11, '#f1e9db', { align: 'right', weight: 700, blur: 0 });
    for (const p of pops) { ctx.globalAlpha = clamp(p.life, 0, 1); neon(p.text, W / 2, p.y, 22, p.col, { italic: true, weight: 900 }); ctx.globalAlpha = 1; }
    if (bannerT > 0 && mode === 'play') { ctx.globalAlpha = Math.min(1, bannerT * 2); chrome(banner, W / 2, H * 0.3, 54); ctx.globalAlpha = 1; }
    if (touchUsed && mode === 'play') {
      ctx.save(); ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#3de0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(70, H - 140, 36, 0, TAU); ctx.stroke();
      neon('NITRO', 70, H - 140, 11, '#3de0ff', { weight: 800 });
      ctx.strokeStyle = '#ff3d7f'; ctx.beginPath(); ctx.arc(70, H - 60, 36, 0, TAU); ctx.stroke();
      neon('BRAKE', 70, H - 60, 11, '#ff3d7f', { weight: 800 });
      ctx.restore();
    }
  }
  function drawTitle() {
    ctx.fillStyle = 'rgba(5,2,12,0.35)'; ctx.fillRect(0, 0, W, H);
    chrome('TURBO 88', W / 2, 120, 96);
    neon('· MIDNIGHT HIGHWAY ·', W / 2, 182, 13, '#d6b26e', { weight: 700, blur: 6 });
    if (Math.floor(time * 2) % 2 === 0) neon('PRESS SPACE  ·  TAP TO DRIVE', W / 2, 250, 20, '#3de0ff', { weight: 900 });
    neon('↑ GAS   ↓ BRAKE   ← → STEER   SHIFT NITRO', W / 2, 290, 12, '#f1e9db', { weight: 700, blur: 0 });
    neon('NEAR MISSES STACK BONUSES  ·  ONE CRASH ENDS THE RUN', W / 2, 312, 11, '#a59d90', { weight: 700, blur: 0 });
    neon('BEST  ' + best.toLocaleString(), W / 2, 346, 16, '#ff3d7f', { weight: 900 });
  }
  function drawOver() {
    ctx.fillStyle = `rgba(5,2,12,${Math.min(0.65, overT)})`; ctx.fillRect(0, 0, W, H);
    chrome('WRECKED', W / 2, 130, 76);
    neon('SCORE  ' + Math.floor(score).toLocaleString(), W / 2, 210, 28, '#3de0ff', { weight: 900 });
    neon((newBest ? 'NEW BEST!  ' : 'BEST  ') + best.toLocaleString(), W / 2, 246, 16, newBest ? '#ffd36e' : '#d6b26e', { weight: 800 });
    neon(`${(distance / 154000).toFixed(2)} KM   ·   ZONE ${level}   ·   +${earned} CHIPS`, W / 2, 280, 15, '#56d68b', { weight: 800, blur: 8 });
    if (overT > 1 && Math.floor(time * 2) % 2 === 0) neon('PRESS SPACE  ·  TAP TO DRIVE AGAIN', W / 2, 340, 18, '#ff3d7f', { weight: 900 });
  }

  // ---------- input ----------
  const keys = new Set();
  const USED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyP', 'Enter']);
  function onKey(e) {
    if (!USED.has(e.code)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keydown') { if (!e.repeat) pressed(e.code); keys.add(e.code); } else keys.delete(e.code);
  }
  function pressed(code) {
    if (code === 'Space' || code === 'Enter') {
      if (mode === 'title') startGame();
      else if (mode === 'over' && overT > 1) startGame();
    }
    if (code === 'KeyP' && mode === 'play') paused = !paused;
  }
  const touches = new Map();
  let touchUsed = false;
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function roleAt(p) {
    if (Math.hypot(p.x - 70, p.y - (H - 140)) < 44) return 'nitro';
    if (Math.hypot(p.x - 70, p.y - (H - 60)) < 44) return 'brake';
    return 'steer';
  }
  function onDown(e) {
    e.preventDefault();
    if (e.pointerType === 'touch') touchUsed = true;
    if (mode === 'title') { startGame(); return; }
    if (mode === 'over') { if (overT > 1) startGame(); return; }
    const p = toCanvas(e);
    touches.set(e.pointerId, { x: p.x, y: p.y, role: touchUsed ? roleAt(p) : 'steer' });
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onMove(e) { const t = touches.get(e.pointerId); if (!t) return; const p = toCanvas(e); t.x = p.x; t.y = p.y; }
  function onUp(e) { touches.delete(e.pointerId); }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  const onBlur = () => { keys.clear(); touches.clear(); if (mode === 'play') paused = true; };
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

  cv._dbg = () => ({ mode, score: Math.floor(score), speed: Math.round(speed), playerX: +playerX.toFixed(2), cars: cars.length, nitro: +nitro.toFixed(2), level, distance: Math.round(distance), nearCombo, best });

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
