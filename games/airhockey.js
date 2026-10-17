// Neon air hockey vs the House. First to 7. Mallet follows mouse/touch inside your half.
export default function start(api) {
  const W = 900, H = 500, L = 34, R = 866, T = 34, B = 466, CX = (L + R) / 2, CY = (T + B) / 2;
  const GOAL = 78, PR = 17, MR = 30, CR = 46; // goal half-width, puck radius, mallet radius, corner radius
  const WIN = 7, PRIZE = 500, MAXP = 1750;
  const CYAN = '#3de0ff', PINK = '#ff3d7f', GOLD = '#d6b26e';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  const card = api.open(`
    <div class="eyebrow">Arcade · Air Hockey</div><h2>Neon <em>Hockey</em></h2>
    <canvas class="game" width="${W}" height="${H}" style="cursor:none"></canvas>
    <div class="result" id="ahStatus">&nbsp;</div>
    <div class="row"><button class="primary" id="ahGo">Face off</button><button data-close>Leave</button></div>
    <p class="note">Move the mouse (or drag a finger) to drive your mallet in the left half. First to ${WIN} wins ${fmt(PRIZE)} chips. The House gets sharper as the game goes on.</p>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#ahStatus');
  const goBtn = card.querySelector('#ahGo');

  // ---------- audio ----------
  let actx = null, lastSnd = 0;
  function ensureAudio() {
    if (actx) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } catch (e) { actx = null; }
  }
  function sound(freq, vol, dur = 0.06, type = 'triangle') {
    if (!actx) return;
    const now = actx.currentTime;
    if (now - lastSnd < 0.03) return; lastSnd = now;
    try {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, now); o.frequency.exponentialRampToValueAtTime(freq * 0.6, now + dur);
      g.gain.setValueAtTime(clamp(vol, 0, 1) * 0.22, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g).connect(actx.destination); o.start(now); o.stop(now + dur + 0.02);
    } catch (e) { /* optional */ }
  }

  // ---------- pre-rendered layers (bitmaps keep per-frame cost to cheap textured quads) ----------
  const toBitmap = (c, set) => { if (window.createImageBitmap) createImageBitmap(c).then(set).catch(() => {}); };
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const tableC = document.createElement('canvas'); tableC.width = W; tableC.height = H;
  let table = tableC;
  (function buildTable() {
    const g = tableC.getContext('2d');
    g.fillStyle = '#030409'; g.fillRect(0, 0, W, H);
    const surf = g.createRadialGradient(CX, CY, 30, CX, CY, 520);
    surf.addColorStop(0, '#0e1430'); surf.addColorStop(0.7, '#090c1d'); surf.addColorStop(1, '#05060f');
    rr(g, L, T, R - L, B - T, CR); g.fillStyle = surf; g.fill();
    // air holes
    g.save(); rr(g, L, T, R - L, B - T, CR); g.clip();
    g.fillStyle = 'rgba(120,160,255,.10)';
    for (let y = T + 14; y < B; y += 22) for (let x = L + 14 + ((y / 22) % 2) * 11; x < R; x += 22) { g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill(); }
    // soft side tints
    const lt = g.createLinearGradient(L, 0, CX, 0); lt.addColorStop(0, 'rgba(61,224,255,.07)'); lt.addColorStop(1, 'rgba(61,224,255,0)');
    g.fillStyle = lt; g.fillRect(L, T, CX - L, B - T);
    const rt = g.createLinearGradient(R, 0, CX, 0); rt.addColorStop(0, 'rgba(255,61,127,.07)'); rt.addColorStop(1, 'rgba(255,61,127,0)');
    g.fillStyle = rt; g.fillRect(CX, T, R - CX, B - T);
    g.restore();
    const neon = (color, width, blur, draw) => {
      g.save(); g.strokeStyle = color; g.shadowColor = color; g.lineWidth = width;
      for (const b of [blur, blur / 2, 0]) { g.shadowBlur = b; draw(); g.stroke(); }
      g.restore();
    };
    // centre line + circle
    neon('rgba(214,178,110,.75)', 2, 14, () => { g.beginPath(); g.moveTo(CX, T + 4); g.lineTo(CX, B - 4); });
    neon('rgba(214,178,110,.7)', 2, 14, () => { g.beginPath(); g.arc(CX, CY, 62, 0, Math.PI * 2); });
    g.fillStyle = GOLD; g.beginPath(); g.arc(CX, CY, 4, 0, Math.PI * 2); g.fill();
    // creases
    neon('rgba(61,224,255,.8)', 2, 16, () => { g.beginPath(); g.arc(L, CY, GOAL + 34, -Math.PI / 2, Math.PI / 2); });
    neon('rgba(255,61,127,.8)', 2, 16, () => { g.beginPath(); g.arc(R, CY, GOAL + 34, Math.PI / 2, Math.PI * 1.5); });
    // border (cyan on the left half, pink on the right)
    g.save(); g.beginPath(); g.rect(0, 0, CX, H); g.clip();
    neon(CYAN, 3, 22, () => rr(g, L, T, R - L, B - T, CR)); g.restore();
    g.save(); g.beginPath(); g.rect(CX, 0, W - CX, H); g.clip();
    neon(PINK, 3, 22, () => rr(g, L, T, R - L, B - T, CR)); g.restore();
    // goal mouths
    for (const [x, col] of [[L, CYAN], [R, PINK]]) {
      g.fillStyle = '#000'; g.fillRect(x - 10, CY - GOAL, 20, GOAL * 2);
      neon(col, 4, 24, () => { g.beginPath(); g.moveTo(x, CY - GOAL); g.lineTo(x, CY + GOAL); });
      g.fillStyle = '#fff'; for (const s of [-1, 1]) { g.beginPath(); g.arc(x, CY + s * GOAL, 4, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = 'rgba(214,178,110,.35)'; g.font = 'italic 500 12px "Bodoni Moda", Georgia, serif'; g.textAlign = 'center';
    g.fillText('THE  VAULT', CX, B + 22);
  })();
  toBitmap(tableC, (bm) => (table = bm));

  // sprites: 0 = player mallet, 1 = AI mallet, 2 = puck, 3 = glow dot
  const SP = 128, sprC = document.createElement('canvas'); sprC.width = SP * 4; sprC.height = SP;
  let spr = sprC;
  (function buildSprites() {
    const g = sprC.getContext('2d');
    const mallet = (i, col, deep) => {
      const cx = i * SP + SP / 2, cy = SP / 2;
      const glow = g.createRadialGradient(cx, cy, MR * 0.6, cx, cy, SP / 2);
      glow.addColorStop(0, col + '88'); glow.addColorStop(0.45, col + '33'); glow.addColorStop(1, col + '00');
      g.fillStyle = glow; g.fillRect(i * SP, 0, SP, SP);
      const body = g.createRadialGradient(cx - 8, cy - 10, 2, cx, cy, MR);
      body.addColorStop(0, '#ffffff'); body.addColorStop(0.18, col); body.addColorStop(1, deep);
      g.beginPath(); g.arc(cx, cy, MR, 0, Math.PI * 2); g.fillStyle = body; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = '#ffffffcc'; g.stroke();
      g.beginPath(); g.arc(cx, cy, MR * 0.55, 0, Math.PI * 2); g.fillStyle = deep; g.fill();
      g.lineWidth = 2; g.strokeStyle = col; g.stroke();
      const knob = g.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, MR * 0.4);
      knob.addColorStop(0, '#fff'); knob.addColorStop(0.35, col); knob.addColorStop(1, deep);
      g.beginPath(); g.arc(cx, cy, MR * 0.38, 0, Math.PI * 2); g.fillStyle = knob; g.fill();
    };
    mallet(0, CYAN, '#06324a');
    mallet(1, PINK, '#4a0820');
    {
      const cx = 2 * SP + SP / 2, cy = SP / 2;
      const glow = g.createRadialGradient(cx, cy, PR * 0.5, cx, cy, SP / 2.2);
      glow.addColorStop(0, 'rgba(255,240,210,.7)'); glow.addColorStop(0.4, 'rgba(214,178,110,.25)'); glow.addColorStop(1, 'rgba(214,178,110,0)');
      g.fillStyle = glow; g.fillRect(2 * SP, 0, SP, SP);
      const body = g.createRadialGradient(cx - 5, cy - 6, 1, cx, cy, PR);
      body.addColorStop(0, '#fffaf0'); body.addColorStop(0.5, '#f0d9a6'); body.addColorStop(1, '#a8823e');
      g.beginPath(); g.arc(cx, cy, PR, 0, Math.PI * 2); g.fillStyle = body; g.fill();
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(cx, cy, PR * 0.55, 0, Math.PI * 2); g.strokeStyle = 'rgba(90,60,20,.6)'; g.lineWidth = 1.5; g.stroke();
    }
    {
      const cx = 3 * SP + SP / 2, cy = SP / 2;
      const d = g.createRadialGradient(cx, cy, 0, cx, cy, SP / 2);
      d.addColorStop(0, 'rgba(255,255,255,1)'); d.addColorStop(0.2, 'rgba(255,255,255,.6)'); d.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = d; g.fillRect(3 * SP, 0, SP, SP);
    }
  })();
  toBitmap(sprC, (bm) => (spr = bm));
  const drawSpr = (i, x, y, size, alpha = 1) => {
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(spr, i * SP, 0, SP, SP, x - size / 2, y - size / 2, size, size);
    if (alpha !== 1) ctx.globalAlpha = 1;
  };

  // ---------- state ----------
  const puck = { x: CX - 160, y: CY, vx: 0, vy: 0 };
  const me = { x: L + 90, y: CY, px: L + 90, py: CY, vx: 0, vy: 0, tx: L + 90, ty: CY };
  const cpu = { x: R - 90, y: CY, px: R - 90, py: CY, vx: 0, vy: 0, tx: R - 90, ty: CY };
  const G = { phase: 'idle', score: [0, 0], pause: 0, flash: null, winner: null, lastHit: 0, servedTo: 0 };
  let trail = [], parts = [], ai = { t: 0, mode: 'home', aimY: CY, attackT: 0 }, shake = 0;
  const level = () => clamp(0.32 + 0.065 * (G.score[0] + G.score[1]) + 0.04 * G.score[0], 0, 1);

  function resetPuck(side) { // side 0: puck in player's half, 1: AI's half
    puck.x = side === 0 ? CX - 170 : CX + 170; puck.y = CY; puck.vx = puck.vy = 0;
    trail = []; ai.attackT = 0;
  }
  function burst(x, y, col, n = 14, sp = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = sp * (0.3 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, t: 0, col });
    }
  }

  goBtn.onclick = () => {
    if (G.phase === 'play') return;
    ensureAudio();
    G.score = [0, 0]; G.winner = null; G.flash = null; G.phase = 'play'; G.pause = 0.9;
    resetPuck(0);
    me.x = me.px = me.tx = L + 90; me.y = me.py = me.ty = CY;
    cpu.x = cpu.px = cpu.tx = R - 90; cpu.y = cpu.py = cpu.ty = CY;
    goBtn.textContent = 'In play'; goBtn.disabled = true; goBtn.style.opacity = 0.5;
  };

  // ---------- input ----------
  function onMove(e) {
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    me.tx = (e.clientX - r.left) * (W / r.width);
    me.ty = (e.clientY - r.top) * (H / r.height);
  }
  function onDown(e) { ensureAudio(); onMove(e); if (e.pointerType !== 'mouse') e.preventDefault(); }
  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  const onKey = (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && G.phase !== 'play' && document.activeElement !== goBtn) { goBtn.click(); e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener('keydown', onKey, true);

  // ---------- AI ----------
  function predictY(x) { // puck y when it reaches x, following straight line with wall reflections
    if (Math.abs(puck.vx) < 1) return puck.y;
    const t = (x - puck.x) / puck.vx;
    if (t < 0) return null;
    const lo = T + PR, hi = B - PR, span = hi - lo;
    let y = puck.y + puck.vy * t - lo;
    y = ((y % (2 * span)) + 2 * span) % (2 * span);
    return lo + (y > span ? 2 * span - y : y);
  }
  function updateAI(dt) {
    const lv = level();
    ai.t -= dt;
    if (ai.t > 0) return;
    ai.t = 0.11 - 0.08 * lv; // reaction interval
    const homeX = R - 70 - 40 * lv;
    let tx, ty;
    const inMyHalf = puck.x > CX - 6;
    const sp = Math.hypot(puck.vx, puck.vy);
    if (G.pause > 0 && G.phase === 'play') { tx = homeX; ty = CY; ai.attackT = 0; }
    else if (!inMyHalf) {
      ai.attackT = 0;
      // defend: sit between puck and goal; anticipate incoming shots
      let py = puck.vx > 60 ? predictY(homeX) : null;
      if (py === null) py = CY + (puck.y - CY) * 0.55;
      tx = homeX - (puck.vx > 60 ? 0 : 30 * lv);
      ty = clamp(py + (Math.random() - 0.5) * 40 * (1 - lv), CY - GOAL - 25, CY + GOAL + 25);
      ai.aimY = CY + (Math.random() - 0.5) * GOAL * 1.6;
      ai.bank = Math.random() < 0.25 * lv ? (Math.random() < 0.5 ? -1 : 1) : 0;
    } else {
      ai.attackT += ai.t;
      // danger: puck heading for my goal and I'm not behind it
      if (puck.vx > 250 && cpu.x < puck.x + 4) {
        const gy = predictY(R - MR - 6);
        tx = R - MR - 8; ty = clamp(gy === null ? puck.y : gy, CY - GOAL - 10, CY + GOAL + 10);
      } else {
        // attack: line up behind the puck towards a point in the player's goal (or a bank off a wall)
        let ax = L - 20, ay = ai.aimY;
        if (ai.bank) ay = ai.bank < 0 ? 2 * (T + PR) - ai.aimY : 2 * (B - PR) - ai.aimY; // mirror the goal across a wall
        let dx = ax - puck.x, dy = ay - puck.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const behindX = puck.x - dx * (PR + MR + 6), behindY = puck.y - dy * (PR + MR + 6);
        const rx = cpu.x - puck.x, ry = cpu.y - puck.y;
        const along = -(rx * dx + ry * dy), perp = Math.abs(rx * dy - ry * dx);
        if (ai.attackT > 2.6 || (along > 0 && perp < 14 + 10 * lv)) {
          tx = puck.x + dx * 70; ty = puck.y + dy * 70; // strike through
          if (ai.attackT > 4) ai.attackT = 0;
        } else if (cpu.x < puck.x - 4) {
          // wrong side: loop around the puck
          tx = puck.x + PR + MR + 26; ty = puck.y + (cpu.y < puck.y ? -1 : 1) * (PR + MR + 18);
        } else { tx = behindX; ty = behindY; }
        if (sp > 500 && puck.vx < 0) { tx = homeX; ty = CY + (puck.y - CY) * 0.4; } // just shot: recover
      }
    }
    cpu.tx = tx; cpu.ty = ty;
  }

  // ---------- physics ----------
  function moveMallet(m, dt, minX, maxX, maxSpeed) {
    const tx = clamp(m.tx, minX, maxX), ty = clamp(m.ty, T + MR, B - MR);
    let dx = tx - m.x, dy = ty - m.y; const d = Math.hypot(dx, dy), step = maxSpeed * dt;
    if (d > step) { dx *= step / d; dy *= step / d; }
    m.px = m.x; m.py = m.y;
    m.x += dx; m.y += dy;
    // keep out of the rounded corners
    for (const [cx, cy] of [[L + CR, T + CR], [R - CR, T + CR], [L + CR, B - CR], [R - CR, B - CR]]) {
      const inX = (cx < CX ? m.x < cx : m.x > cx), inY = (cy < CY ? m.y < cy : m.y > cy);
      if (inX && inY) {
        const ox = m.x - cx, oy = m.y - cy, od = Math.hypot(ox, oy), lim = CR - MR;
        if (od > lim) { m.x = cx + ox / od * Math.max(lim, 0); m.y = cy + oy / od * Math.max(lim, 0); }
      }
    }
    m.vx = dt > 0 ? (m.x - m.px) / dt : 0; m.vy = dt > 0 ? (m.y - m.py) / dt : 0;
  }
  function hitMallet(m, who) {
    const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy), min = PR + MR;
    if (d >= min) return;
    const nx = d ? dx / d : (who ? -1 : 1), ny = d ? dy / d : 0;
    puck.x = m.x + nx * min; puck.y = m.y + ny * min;
    let rvx = puck.vx - m.vx, rvy = puck.vy - m.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      rvx -= 1.85 * vn * nx; rvy -= 1.85 * vn * ny;
      puck.vx = rvx + m.vx; puck.vy = rvy + m.vy;
      const s = Math.hypot(puck.vx, puck.vy);
      if (s > MAXP) { puck.vx *= MAXP / s; puck.vy *= MAXP / s; }
      const imp = Math.min(1, -vn / 1200);
      if (imp > 0.08) { sound(who ? 520 : 660, imp, 0.07); burst(puck.x - nx * PR, puck.y - ny * PR, who ? PINK : CYAN, 6 + Math.floor(imp * 10), 120 + imp * 260); }
      G.lastHit = who;
    }
  }
  function walls() {
    let bounced = 0;
    const inGoalY = Math.abs(puck.y - CY) < GOAL;
    if (puck.y < T + PR) { puck.y = T + PR; if (puck.vy < 0) { bounced = -puck.vy; puck.vy = -puck.vy * 0.9; } }
    if (puck.y > B - PR) { puck.y = B - PR; if (puck.vy > 0) { bounced = puck.vy; puck.vy = -puck.vy * 0.9; } }
    if (!inGoalY) {
      if (puck.x < L + PR) { puck.x = L + PR; if (puck.vx < 0) { bounced = -puck.vx; puck.vx = -puck.vx * 0.9; } }
      if (puck.x > R - PR) { puck.x = R - PR; if (puck.vx > 0) { bounced = puck.vx; puck.vx = -puck.vx * 0.9; } }
    } else {
      // goal posts
      for (const [px, py] of [[L, CY - GOAL], [L, CY + GOAL], [R, CY - GOAL], [R, CY + GOAL]]) {
        const dx = puck.x - px, dy = puck.y - py, d = Math.hypot(dx, dy);
        if (d < PR && d > 0) {
          const nx = dx / d, ny = dy / d; puck.x = px + nx * PR; puck.y = py + ny * PR;
          const vn = puck.vx * nx + puck.vy * ny;
          if (vn < 0) { puck.vx -= 1.85 * vn * nx; puck.vy -= 1.85 * vn * ny; bounced = -vn; }
        }
      }
    }
    // rounded corners
    for (const [cx, cy] of [[L + CR, T + CR], [R - CR, T + CR], [L + CR, B - CR], [R - CR, B - CR]]) {
      const inX = (cx < CX ? puck.x < cx : puck.x > cx), inY = (cy < CY ? puck.y < cy : puck.y > cy);
      if (!inX || !inY) continue;
      const ox = puck.x - cx, oy = puck.y - cy, od = Math.hypot(ox, oy), lim = CR - PR;
      if (od > lim) {
        const nx = ox / od, ny = oy / od; puck.x = cx + nx * lim; puck.y = cy + ny * lim;
        const vn = puck.vx * nx + puck.vy * ny;
        if (vn > 0) { puck.vx -= 1.9 * vn * nx; puck.vy -= 1.9 * vn * ny; bounced = vn; }
      }
    }
    if (bounced > 120) { sound(300, bounced / 1500, 0.05, 'sine'); if (bounced > 500) burst(puck.x, puck.y, GOLD, 5, 120); }
  }

  function goal(scorer) {
    G.score[scorer]++;
    shake = 0.35;
    burst(scorer === 0 ? R : L, puck.y, scorer === 0 ? CYAN : PINK, 40, 420);
    sound(scorer === 0 ? 880 : 220, 0.9, 0.35, 'sawtooth');
    if (G.score[scorer] >= WIN) {
      G.phase = 'over'; G.winner = scorer;
      G.flash = { text: scorer === 0 ? 'YOU WIN' : 'HOUSE WINS', col: scorer === 0 ? CYAN : PINK, t: 99 };
      if (scorer === 0) {
        api.addChips(PRIZE);
        api.broadcast(`beat the House ${G.score[0]}-${G.score[1]} at air hockey`);
        api.toast(`Air hockey win: +${fmt(PRIZE)} chips`);
      }
      goBtn.textContent = 'Rematch'; goBtn.disabled = false; goBtn.style.opacity = '';
      puck.vx = puck.vy = 0; puck.x = CX; puck.y = CY;
      return;
    }
    G.flash = { text: scorer === 0 ? 'GOAL' : 'HOUSE SCORES', col: scorer === 0 ? CYAN : PINK, t: 1.3 };
    G.pause = 1.3;
    resetPuck(scorer === 0 ? 1 : 0); // conceding side serves
  }

  function physics(dt) {
    const lv = level();
    const pmax = 2600, cmax = 650 + 1150 * lv;
    // substeps sized so neither puck nor mallets tunnel
    const fast = Math.max(Math.hypot(puck.vx, puck.vy), pmax, cmax);
    const n = clamp(Math.ceil((fast * dt) / 7), 1, 40), h = dt / n;
    for (let i = 0; i < n; i++) {
      moveMallet(me, h, L + MR, CX - MR * 0.35, pmax);
      moveMallet(cpu, h, CX + MR * 0.35, R - MR, cmax);
      if (G.pause > 0) continue;
      puck.x += puck.vx * h; puck.y += puck.vy * h;
      hitMallet(me, 0); hitMallet(cpu, 1);
      walls();
      // never let a mallet pin the puck inside itself
      for (const [m, who] of [[me, 0], [cpu, 1]]) {
        const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy);
        if (d < PR + MR - 0.5 && d > 0) { m.x = puck.x - dx / d * (PR + MR); m.y = puck.y - dy / d * (PR + MR); if (who === 0) { me.vx = me.vy = 0; } }
      }
      if (puck.x < L - PR * 0.6) { goal(1); return; }
      if (puck.x > R + PR * 0.6) { goal(0); return; }
    }
    const k = Math.exp(-0.32 * dt);
    puck.vx *= k; puck.vy *= k;
    // tiny nudge so a dead puck on the centre line doesn't stall forever
    if (Math.hypot(puck.vx, puck.vy) < 6 && Math.abs(puck.x - CX) < PR) puck.vx += (puck.x < CX ? -1 : 1) * 30 * dt;
  }

  // ---------- rendering ----------
  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
    ctx.drawImage(table, 0, 0);
    // big faint scores
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '500 120px "Bodoni Moda", Georgia, serif';
    ctx.fillStyle = 'rgba(61,224,255,.10)'; ctx.fillText(String(G.score[0]), CX - 150, CY + 6);
    ctx.fillStyle = 'rgba(255,61,127,.10)'; ctx.fillText(String(G.score[1]), CX + 150, CY + 6);
    // trail
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i], a = (i + 1) / trail.length;
      drawSpr(3, p.x, p.y, PR * 2.4 * a + 4, 0.16 * a);
    }
    // particles
    for (const p of parts) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a; ctx.fillStyle = p.col;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    if (G.phase !== 'over') drawSpr(2, puck.x, puck.y, SP * 0.72, G.pause > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 120)) : 1);
    drawSpr(0, me.x, me.y, SP * 1.05);
    drawSpr(1, cpu.x, cpu.y, SP * 1.05);
    ctx.restore();
    // HUD
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px Manrope, Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = CYAN; ctx.fillText(`${String((api.playerName && api.playerName()) || 'YOU').toUpperCase()}  ${G.score[0]}`, L + 14, 17);
    ctx.textAlign = 'right'; ctx.fillStyle = PINK; ctx.fillText(`${G.score[1]}  THE HOUSE`, R - 14, 17);
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(241,233,219,.55)';
    ctx.fillText(G.phase === 'play' ? `FIRST TO ${WIN} · HOUSE LEVEL ${Math.round(level() * 9) + 1}` : `FIRST TO ${WIN}`, CX, 17);
    // flash text (pre-rendered once per message: glow strokes are costly per frame)
    if (G.flash) {
      const f = G.flash, a = f.t > 90 ? 1 : clamp(f.t / 0.35, 0, 1);
      if (!f.img) { f.img = renderFlash(f); toBitmap(f.img, (bm) => (f.img = bm)); }
      ctx.globalAlpha = a; ctx.drawImage(f.img, 0, 0, W, 200, 0, CY - 100, W, 200); ctx.globalAlpha = 1;
    }
    if (G.phase === 'idle') {
      ctx.save(); ctx.fillStyle = 'rgba(3,4,9,.6)'; ctx.fillRect(L, T, R - L, B - T);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f1e9db'; ctx.font = '500 44px "Bodoni Moda", Georgia, serif';
      ctx.fillText('Neon Hockey', CX, CY - 18);
      ctx.font = '600 13px Manrope, Arial, sans-serif'; ctx.fillStyle = 'rgba(241,233,219,.7)';
      ctx.fillText(`First to ${WIN} · win ${fmt(PRIZE)} chips · press Face off`, CX, CY + 22);
      ctx.restore();
    }
  }

  function renderFlash(f) {
    const c = document.createElement('canvas'); c.width = W; c.height = 200;
    const g = c.getContext('2d'), y = 100;
    if (f.t > 90) { const bg = g.createLinearGradient(0, 0, 0, 200); bg.addColorStop(0, 'rgba(3,4,9,0)'); bg.addColorStop(0.5, 'rgba(3,4,9,.7)'); bg.addColorStop(1, 'rgba(3,4,9,0)'); g.fillStyle = bg; g.fillRect(L, 0, R - L, 200); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 64px "Bodoni Moda", Georgia, serif';
    g.strokeStyle = f.col; g.lineWidth = 12; g.globalAlpha = 0.14; g.strokeText(f.text, CX, y);
    g.lineWidth = 6; g.globalAlpha = 0.3; g.strokeText(f.text, CX, y);
    g.lineWidth = 2; g.globalAlpha = 0.9; g.strokeText(f.text, CX, y);
    g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillText(f.text, CX, y);
    if (f.t > 90) {
      g.font = '600 14px Manrope, Arial, sans-serif'; g.fillStyle = 'rgba(241,233,219,.85)';
      g.fillText(G.winner === 0 ? `${G.score[0]} - ${G.score[1]} · +${fmt(PRIZE)} chips` : `${G.score[0]} - ${G.score[1]} · press Rematch`, CX, y + 52);
    }
    return c;
  }

  function statusText() {
    if (G.phase === 'idle') return `Chips: ${fmt(api.chips())}. Beat the House to ${WIN} for ${fmt(PRIZE)} chips.`;
    if (G.phase === 'over') return G.winner === 0 ? `You win ${G.score[0]}-${G.score[1]}. +${fmt(PRIZE)} chips.` : `The House wins ${G.score[1]}-${G.score[0]}. Rematch?`;
    return `You ${G.score[0]} · House ${G.score[1]} · House level ${Math.round(level() * 9) + 1}/10`;
  }

  // ---------- loop ----------
  let raf = 0, last = performance.now(), frame = 0, lastStatus = '', timeScale = 1;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000)) * timeScale; last = now;
    if (G.phase === 'play') {
      updateAI(dt);
      physics(dt);
      if (G.pause > 0) G.pause -= dt;
    } else {
      // idle / over: mallets still glide so the table feels alive
      moveMallet(me, dt, L + MR, CX - MR * 0.35, 2600);
      cpu.tx = R - 90; cpu.ty = CY + Math.sin(now / 700) * 40;
      moveMallet(cpu, dt, CX + MR * 0.35, R - MR, 500);
    }
    if (G.flash && G.flash.t < 90) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
    if (shake > 0) shake = Math.max(0, shake - dt);
    trail.push({ x: puck.x, y: puck.y }); if (trail.length > 14) trail.shift();
    for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    parts = parts.filter((p) => p.t < p.life);
    draw();
    if (++frame % 6 === 0) {
      api.mirror(cv);
      const st = statusText();
      if (st !== lastStatus) { statusEl.textContent = st; lastStatus = st; }
    }
  }
  raf = requestAnimationFrame(loop);
  statusEl.textContent = statusText();

  api.onClose(() => {
    cancelAnimationFrame(raf);
    cv.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('keydown', onKey, true);
    if (actx) { try { actx.close(); } catch (e) { /* ignore */ } actx = null; }
    if (window.__ah && window.__ah.G === G) delete window.__ah;
  });

  // test hook (harmless in production)
  window.__ah = { G, puck, me, cpu, level, setTimeScale: (k) => (timeScale = k) };
}
