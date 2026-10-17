// 8-ball pool vs the House. Top-down canvas, real 2D ball physics, BCA-style rules (simplified).
export default function start(api) {
  const W = 960, H = 540, L = 100, R = 860, T = 104, B = 484;
  const CX = (L + R) / 2, CY = (T + B) / 2, BR = 10, CG = 28, SG = 22;
  const FOOT_X = L + (R - L) * 0.75, HEAD_X = L + (R - L) * 0.25;
  const MAXV = 1850, DECEL = 140, DAMP = 0.5, E_BALL = 0.95, E_CUSH = 0.76;
  const COL = { 1: '#f0bd1d', 2: '#1d47c8', 3: '#d42a2a', 4: '#5a2b9a', 5: '#f06a14', 6: '#137a45', 7: '#7c1c22', 8: '#141414' };
  const STAKES = [0, 500, 1000, 5000];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const typeOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe');
  const NAMES = [String((api.playerName && api.playerName()) || 'You'), 'The House'];

  const card = api.open(`
    <div class="eyebrow">Billiards Room · 8-Ball</div><h2>Eight <em>Ball</em></h2>
    <canvas class="game" width="${W}" height="${H}" style="cursor:crosshair"></canvas>
    <div class="result" id="poolStatus">&nbsp;</div>
    <div class="row" id="poolStakes"><span style="font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);margin-right:4px">Stake</span>${STAKES.map((s) => `<button data-stake="${s}">${s ? fmt(s) : 'Friendly'}</button>`).join('')}</div>
    <div class="row"><button class="primary" id="poolGo">Rack 'em</button><button data-close>Leave</button></div>
    <p class="note">Move to aim. Press, drag back for power, release to shoot. Ball in hand: click to place the cue ball. A win pays 2x the stake.</p>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#poolStatus');
  const goBtn = card.querySelector('#poolGo');
  const stakeBtns = [...card.querySelectorAll('[data-stake]')];

  // ---------- geometry ----------
  const segs = [];
  const seg = (x1, y1, x2, y2) => segs.push({ x1, y1, x2, y2 });
  seg(L + CG, T, CX - SG, T); seg(CX + SG, T, R - CG, T);
  seg(L + CG, B, CX - SG, B); seg(CX + SG, B, R - CG, B);
  seg(L, T + CG, L, B - CG); seg(R, T + CG, R, B - CG);
  const pockets = [
    { x: L - 6, y: T - 6, r: 21, aims: [{ x: L - 6, y: T - 6 }, { x: L + 5, y: T + 5 }] },
    { x: R + 6, y: T - 6, r: 21, aims: [{ x: R + 6, y: T - 6 }, { x: R - 5, y: T + 5 }] },
    { x: L - 6, y: B + 6, r: 21, aims: [{ x: L - 6, y: B + 6 }, { x: L + 5, y: B - 5 }] },
    { x: R + 6, y: B + 6, r: 21, aims: [{ x: R + 6, y: B + 6 }, { x: R - 5, y: B - 5 }] },
    { x: CX, y: T - 11, r: 19, side: true, aims: [{ x: CX, y: T - 10 }, { x: CX, y: T - 2 }] },
    { x: CX, y: B + 11, r: 19, side: true, aims: [{ x: CX, y: B + 10 }, { x: CX, y: B + 2 }] },
  ];

  function distPtSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const o = (px, py, qx, qy, rx, ry) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 && o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0;
  }
  function segSegDist(ax, ay, bx, by, s) {
    if (segsCross(ax, ay, bx, by, s.x1, s.y1, s.x2, s.y2)) return 0;
    return Math.min(distPtSeg(ax, ay, s.x1, s.y1, s.x2, s.y2), distPtSeg(bx, by, s.x1, s.y1, s.x2, s.y2),
      distPtSeg(s.x1, s.y1, ax, ay, bx, by), distPtSeg(s.x2, s.y2, ax, ay, bx, by));
  }

  // ---------- sound (tiny WebAudio clicks, created on first gesture) ----------
  let actx = null, lastClick = 0;
  function sound(kind, vol) {
    if (!actx) return;
    const now = actx.currentTime;
    if (kind === 'click' && now - lastClick < 0.025) return;
    if (kind === 'click') lastClick = now;
    try {
      const o = actx.createOscillator(), g = actx.createGain();
      const f = { click: 2400, cushion: 300, pocket: 140, cue: 900 }[kind] || 800;
      o.type = kind === 'pocket' ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(f, now);
      o.frequency.exponentialRampToValueAtTime(f * (kind === 'pocket' ? 0.5 : 0.7), now + 0.08);
      g.gain.setValueAtTime(clamp(vol, 0, 1) * 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'pocket' ? 0.25 : 0.07));
      o.connect(g).connect(actx.destination); o.start(now); o.stop(now + 0.3);
    } catch (e) { /* audio is optional */ }
  }
  function ensureAudio() {
    if (actx) return;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } catch (e) { actx = null; }
  }

  // ---------- sprites ----------
  const SS = 2, SPR = (BR + 2) * 2 * SS;
  const sprites = [];
  for (let n = 0; n <= 15; n++) {
    const c = document.createElement('canvas'); c.width = c.height = SPR;
    const g = c.getContext('2d'); g.scale(SS, SS); g.translate(BR + 2, BR + 2);
    const base = n === 0 ? '#f4efe2' : n > 8 ? '#f4efe2' : COL[n];
    g.beginPath(); g.arc(0, 0, BR, 0, Math.PI * 2); g.fillStyle = base; g.fill();
    if (n > 8) { g.save(); g.clip(); g.fillStyle = COL[n - 8]; g.fillRect(-BR, -BR * 0.56, BR * 2, BR * 1.12); g.restore(); }
    if (n > 0) {
      g.beginPath(); g.arc(0, 0, BR * 0.47, 0, Math.PI * 2); g.fillStyle = '#fbf8f0'; g.fill();
      g.fillStyle = '#151515'; g.font = `700 ${n > 9 ? 7.2 : 8}px Manrope, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0.6);
    } else {
      g.beginPath(); g.arc(BR * 0.15, BR * 0.2, 1.1, 0, Math.PI * 2); g.fillStyle = 'rgba(200,40,40,.7)'; g.fill();
    }
    const sh = g.createRadialGradient(-BR * 0.38, -BR * 0.42, 0, 0, 0, BR * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.55)'); sh.addColorStop(0.22, 'rgba(255,255,255,0.10)');
    sh.addColorStop(0.62, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.beginPath(); g.arc(0, 0, BR, 0, Math.PI * 2); g.fillStyle = sh; g.fill();
    g.beginPath(); g.arc(-BR * 0.4, -BR * 0.45, BR * 0.16, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
    g.beginPath(); g.arc(0, 0, BR - 0.25, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.5; g.stroke();
    sprites.push(c);
  }
  // Pack sprites into one atlas and snapshot it as an ImageBitmap so per-frame draws don't replay canvas recordings.
  const atlasC = document.createElement('canvas'); atlasC.width = SPR * 17; atlasC.height = SPR;
  sprites.forEach((c, i) => atlasC.getContext('2d').drawImage(c, i * SPR, 0));
  {
    const g = atlasC.getContext('2d'), cx = 16 * SPR + SPR / 2, cy = SPR / 2;
    const sg = g.createRadialGradient(cx, cy, 0, cx, cy, SPR / 2);
    sg.addColorStop(0, 'rgba(0,0,0,.5)'); sg.addColorStop(0.6, 'rgba(0,0,0,.32)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.fillRect(16 * SPR, 0, SPR, SPR);
  }
  let atlas = atlasC;
  const toBitmap = (c, set) => { if (window.createImageBitmap) createImageBitmap(c).then(set).catch(() => {}); };
  toBitmap(atlasC, (bm) => (atlas = bm));
  const drawBall = (n, x, y, s = 1, a = 1) => {
    const d = (BR + 2) * 2 * s;
    if (a !== 1) ctx.globalAlpha = a;
    ctx.drawImage(atlas, n * SPR, 0, SPR, SPR, x - d / 2, y - d / 2, d, d);
    if (a !== 1) ctx.globalAlpha = 1;
  };

  // ---------- static table (pre-rendered) ----------
  const tableC = document.createElement('canvas'); tableC.width = W; tableC.height = H;
  let table = tableC;
  (function buildTable() {
    const g = tableC.getContext('2d');
    const bg = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 620);
    bg.addColorStop(0, '#16120d'); bg.addColorStop(1, '#050403');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    // drop shadow
    g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
    rr(L - 48, T - 48, R - L + 96, B - T + 96, 22); g.fillStyle = '#2a140a'; g.fill(); g.restore();
    // wood rails
    const wood = g.createLinearGradient(0, T - 48, 0, B + 48);
    wood.addColorStop(0, '#6b3519'); wood.addColorStop(0.08, '#4a220f'); wood.addColorStop(0.5, '#3b1a0b'); wood.addColorStop(0.92, '#4a220f'); wood.addColorStop(1, '#2a1207');
    rr(L - 48, T - 48, R - L + 96, B - T + 96, 22); g.fillStyle = wood; g.fill();
    // wood grain
    g.save(); rr(L - 48, T - 48, R - L + 96, B - T + 96, 22); g.clip();
    for (let i = 0; i < 140; i++) {
      const y = T - 48 + Math.random() * (B - T + 96);
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '20,8,2' : '120,62,30'},${0.05 + Math.random() * 0.08})`;
      g.lineWidth = 0.5 + Math.random() * 1.2; g.beginPath(); g.moveTo(L - 60, y);
      for (let x = L - 60; x < R + 60; x += 40) g.lineTo(x + 40, y + Math.sin(x * 0.01 + i) * 1.5);
      g.stroke();
    }
    g.restore();
    // gold inlays
    rr(L - 44, T - 44, R - L + 88, B - T + 88, 19); g.strokeStyle = 'rgba(214,178,110,.55)'; g.lineWidth = 1; g.stroke();
    rr(L - 17, T - 17, R - L + 34, B - T + 34, 4); g.strokeStyle = 'rgba(214,178,110,.35)'; g.stroke();
    // felt
    const felt = g.createRadialGradient(CX, CY, 40, CX, CY, 470);
    felt.addColorStop(0, '#1f7d50'); felt.addColorStop(0.6, '#176341'); felt.addColorStop(1, '#0e4329');
    g.fillStyle = felt; g.fillRect(L - 15, T - 15, R - L + 30, B - T + 30);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.035)';
      g.fillRect(L - 15 + Math.random() * (R - L + 30), T - 15 + Math.random() * (B - T + 30), 1.5, 1.5);
    }
    // cushions (nose at felt edge, back 15px out)
    const D = 15;
    const cush = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = '#145a37'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke(); };
    cush([[L + CG, T], [CX - SG, T], [CX - SG + 6, T - D], [L + CG - 14, T - D]]);
    cush([[CX + SG, T], [R - CG, T], [R - CG + 14, T - D], [CX + SG - 6, T - D]]);
    cush([[L + CG, B], [CX - SG, B], [CX - SG + 6, B + D], [L + CG - 14, B + D]]);
    cush([[CX + SG, B], [R - CG, B], [R - CG + 14, B + D], [CX + SG - 6, B + D]]);
    cush([[L, T + CG], [L, B - CG], [L - D, B - CG + 14], [L - D, T + CG - 14]]);
    cush([[R, T + CG], [R, B - CG], [R + D, B - CG + 14], [R + D, T + CG - 14]]);
    g.strokeStyle = 'rgba(120,220,160,.18)'; g.lineWidth = 1.2;
    for (const s of segs) { g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke(); }
    // felt shadow along cushion
    g.save(); g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 8; g.strokeRect(L - 2, T - 2, R - L + 4, B - T + 4); g.restore();
    // pockets
    for (const p of pockets) {
      const rim = g.createRadialGradient(p.x, p.y, p.r - 2, p.x, p.y, p.r + 7);
      rim.addColorStop(0, '#1a1410'); rim.addColorStop(0.5, '#2e2418'); rim.addColorStop(1, 'rgba(214,178,110,.0)');
      g.beginPath(); g.arc(p.x, p.y, p.r + 7, 0, Math.PI * 2); g.fillStyle = rim; g.fill();
      const hole = g.createRadialGradient(p.x - 3, p.y - 3, 2, p.x, p.y, p.r);
      hole.addColorStop(0, '#000'); hole.addColorStop(0.8, '#050505'); hole.addColorStop(1, '#1b1b1b');
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fillStyle = hole; g.fill();
    }
    // diamonds
    const dia = (x, y) => { g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3, y); g.lineTo(x, y + 4); g.lineTo(x - 3, y); g.closePath(); g.fillStyle = '#efe6d3'; g.fill(); };
    for (let k = 1; k < 8; k++) { if (k === 4) continue; const x = L + (R - L) * k / 8; dia(x, T - 32); dia(x, B + 32); }
    for (let k = 1; k < 4; k++) { const y = T + (B - T) * k / 4; dia(L - 32, y); dia(R + 32, y); }
    // spots and brand
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath(); g.arc(FOOT_X, CY, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(HEAD_X, CY, 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(214,178,110,.6)'; g.font = 'italic 500 11px "Bodoni Moda", Georgia, serif'; g.textAlign = 'center';
    g.fillText('THE  VAULT', L + (R - L) * 11 / 16, B + 36);
  })();
  toBitmap(tableC, (bm) => (table = bm));

  // ---------- state ----------
  let balls = [];
  const cue = () => balls[0];
  function rack() {
    balls = [];
    for (let n = 0; n <= 15; n++) balls.push({ n, x: 0, y: 0, vx: 0, vy: 0, on: true });
    const solids = [1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
    const stripes = [9, 10, 11, 12, 13, 14, 15].sort(() => Math.random() - 0.5);
    const slots = [];
    for (let i = 0; i < 5; i++) for (let k = 0; k <= i; k++) slots.push({ i, k });
    const assign = new Array(15).fill(0);
    assign[4] = 8; // centre of third row
    const flip = Math.random() < 0.5;
    assign[10] = flip ? solids.pop() : stripes.pop();
    assign[14] = flip ? stripes.pop() : solids.pop();
    const rest = [...solids, ...stripes].sort(() => Math.random() - 0.5);
    for (let s = 0; s < 15; s++) if (!assign[s]) assign[s] = rest.pop();
    const dx = BR * 2 * 0.866 + 0.15, dy = BR * 2 + 0.15;
    slots.forEach((s, idx) => { const b = balls[assign[idx]]; b.x = FOOT_X + s.i * dx; b.y = CY + (s.k - s.i / 2) * dy; });
    balls[0].x = HEAD_X; balls[0].y = CY;
  }

  const S = { phase: 'idle', turn: 0, groups: [null, null], isBreak: true, kitchen: true, note: '', winner: null, result: '' };
  let shot = null, sinking = [], banner = { text: '', t: 0, color: '#f1e9db' };
  let aim = Math.PI, power = 0, drag = null, mouse = { x: HEAD_X, y: CY, inside: false };
  let ai = null, shotTime = 0, activeStake = 0, stake = 0;

  const remaining = (grp) => balls.filter((b) => b.on && b.n !== 0 && typeOf(b.n) === grp).length;
  const onEight = (who) => !!S.groups[who] && remaining(S.groups[who]) === 0;
  function legalTargets(who) {
    const on = balls.filter((b) => b.on && b.n !== 0);
    const g = S.groups[who];
    if (!g) return on.filter((b) => b.n !== 8);
    const mine = on.filter((b) => typeOf(b.n) === g);
    return mine.length ? mine : on.filter((b) => b.n === 8);
  }
  function showBanner(text, color = '#f1e9db', t = 2.2) { banner = { text, t, color }; }

  function selectStake(s) {
    stake = s;
    stakeBtns.forEach((b) => {
      const on = Number(b.dataset.stake) === s;
      b.style.borderColor = on ? 'var(--gold)' : '';
      b.style.color = on ? 'var(--gold)' : '';
    });
  }
  stakeBtns.forEach((b) => (b.onclick = () => { if (S.phase === 'idle' || S.phase === 'over') selectStake(Number(b.dataset.stake)); }));
  selectStake(0);

  goBtn.onclick = () => {
    if (S.phase !== 'idle' && S.phase !== 'over') return;
    ensureAudio();
    if (stake > 0) {
      if (api.chips() < stake) { api.toast(`Not enough chips for a ${fmt(stake)} stake`); return; }
      api.addChips(-stake);
    }
    activeStake = stake;
    rack();
    Object.assign(S, { phase: 'place', turn: 0, groups: [null, null], isBreak: true, kitchen: true, note: '', winner: null, result: '' });
    sinking = []; ai = null; drag = null; power = 0; aim = 0;
    showBanner('Your break: place the cue ball behind the line', '#d6b26e', 2.6);
    goBtn.textContent = 'Rack in play'; goBtn.disabled = true; goBtn.style.opacity = 0.5;
    stakeBtns.forEach((b) => (b.disabled = true));
  };

  function endRack(winner, reason) {
    S.phase = 'over'; S.winner = winner;
    if (winner === 0) {
      const pay = activeStake * 2;
      if (pay) { api.addChips(pay); api.broadcast(`won ${fmt(pay)} chips at 8-ball`); api.toast(`You win ${fmt(pay)} chips`); }
      else api.broadcast('beat the House at 8-ball');
      S.result = `You win: ${reason}.${pay ? ` +${fmt(pay)} chips.` : ''}`;
      showBanner('You win the rack', '#56d68b', 99);
    } else {
      S.result = `The House wins: ${reason}.${activeStake ? ` Stake of ${fmt(activeStake)} lost.` : ''}`;
      showBanner('The House wins the rack', '#ff3d7f', 99);
    }
    goBtn.textContent = 'New rack'; goBtn.disabled = false; goBtn.style.opacity = '';
    stakeBtns.forEach((b) => (b.disabled = false));
  }

  // ---------- physics ----------
  const speedFromPower = (p) => 60 + Math.pow(p, 1.25) * (MAXV - 60);
  const powerFromSpeed = (s) => Math.pow(clamp((s - 60) / (MAXV - 60), 0, 1), 1 / 1.25);

  function shoot(angle, speed) {
    const c = cue();
    c.vx = Math.cos(angle) * speed; c.vy = Math.sin(angle) * speed;
    shot = { shooter: S.turn, firstHit: null, pocketed: [], onEight: onEight(S.turn) };
    S.phase = 'shooting'; shotTime = 0; power = 0; drag = null; ai = null;
    sound('cue', speed / MAXV);
  }

  function sink(b) {
    b.on = false;
    let best = pockets[0], bd = 1e9;
    for (const p of pockets) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = p; } }
    sinking.push({ n: b.n, x: b.x, y: b.y, px: best.x, py: best.y, t: 0 });
    b.vx = b.vy = 0;
    if (shot) shot.pocketed.push(b.n);
    sound('pocket', 0.8);
  }

  function physStep(dt) {
    for (const b of balls) if (b.on) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]; if (!a.on) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]; if (!b.on) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * BR * BR || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = 2 * BR - d;
        a.x -= nx * ov / 2; a.y -= ny * ov / 2; b.x += nx * ov / 2; b.y += ny * ov / 2;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
          const jm = (1 + E_BALL) / 2 * rel;
          a.vx -= jm * nx; a.vy -= jm * ny; b.vx += jm * nx; b.vy += jm * ny;
          if (shot && shot.firstHit === null && (a.n === 0 || b.n === 0)) shot.firstHit = a.n === 0 ? b.n : a.n;
          sound('click', rel / 900);
        }
      }
    }
    for (const b of balls) {
      if (!b.on) continue;
      for (const s of segs) {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy;
        const t = clamp(((b.x - s.x1) * dx + (b.y - s.y1) * dy) / l2, 0, 1);
        const px = s.x1 + t * dx, py = s.y1 + t * dy;
        let nx = b.x - px, ny = b.y - py; const d = Math.hypot(nx, ny);
        if (d >= BR || d === 0) continue;
        nx /= d; ny /= d;
        b.x = px + nx * BR; b.y = py + ny * BR;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= (1 + E_CUSH) * vn * nx; b.vy -= (1 + E_CUSH) * vn * ny;
          const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
          b.vx -= vt * 0.04 * tx; b.vy -= vt * 0.04 * ty;
          sound('cushion', -vn / 1200);
        }
      }
      if (b.x < L - 3 || b.x > R + 3 || b.y < T - 3 || b.y > B + 3) { sink(b); continue; }
      for (const p of pockets) if (Math.hypot(b.x - p.x, b.y - p.y) < p.r - 6) { sink(b); break; }
    }
    for (const b of balls) {
      if (!b.on) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp === 0) continue;
      const ns = Math.max(0, sp - DECEL * dt) * (1 - DAMP * dt);
      const k = ns / sp; b.vx *= k; b.vy *= k;
    }
  }

  function simulate(dt) {
    let maxv = 0;
    for (const b of balls) if (b.on) maxv = Math.max(maxv, Math.abs(b.vx), Math.abs(b.vy));
    const n = clamp(Math.ceil((maxv * dt) / (BR * 0.35)), 1, 60);
    for (let i = 0; i < n; i++) physStep(dt / n);
    shotTime += dt;
    let moving = false;
    for (const b of balls) if (b.on && Math.hypot(b.vx, b.vy) > 4) { moving = true; break; }
    if (!moving || shotTime > 25) { for (const b of balls) b.vx = b.vy = 0; evaluate(); }
  }

  function respotEight() {
    const e = balls[8]; e.on = true; e.vx = e.vy = 0; e.x = FOOT_X; e.y = CY;
    while (balls.some((b) => b !== e && b.on && Math.hypot(b.x - e.x, b.y - e.y) < 2 * BR + 0.5) && e.x < R - BR) e.x += 1;
    sinking = sinking.filter((s) => s.n !== 8);
  }

  function evaluate() {
    const sh = shot.shooter, op = 1 - sh, p = shot.pocketed;
    const cueIn = p.includes(0), eightIn = p.includes(8);
    const who = sh === 0 ? 'You' : 'The House';
    let foul = null;
    const g = S.groups[sh];
    if (shot.firstHit === null) foul = 'no ball struck';
    else if (!S.isBreak) {
      const ft = typeOf(shot.firstHit);
      if (g) { const need = shot.onEight ? 'eight' : g; if (ft !== need) foul = need === 'eight' ? 'had to hit the 8 first' : 'wrong group hit first'; }
      else if (ft === 'eight') foul = 'hit the 8 first on an open table';
    }
    if (cueIn) foul = foul ? `${foul} and scratched` : 'scratch';
    if (eightIn) {
      if (S.isBreak) { respotEight(); showBanner('8 on the break: respotted', '#d6b26e'); }
      else if (shot.onEight && !foul) return endRack(sh, sh === 0 ? 'you sank the 8-ball' : 'the House sank the 8-ball');
      else return endRack(op, `${who === 'You' ? 'you' : 'the House'} ${foul ? `sank the 8 with a foul (${foul})` : 'sank the 8-ball early'}`);
    }
    const objs = p.filter((n) => n !== 0 && n !== 8);
    if (!foul && !S.isBreak && !g && objs.length) {
      const t = typeOf(objs[0]);
      S.groups[sh] = t; S.groups[op] = t === 'solid' ? 'stripe' : 'solid';
      showBanner(`${who === 'You' ? 'You are' : 'The House is'} ${t === 'solid' ? 'solids' : 'stripes'}`, '#d6b26e');
    }
    let cont = false;
    if (!foul) {
      if (S.isBreak) cont = objs.length > 0;
      else { const gg = S.groups[sh]; cont = !!gg && objs.some((n) => typeOf(n) === gg); }
    }
    S.isBreak = false; S.kitchen = false;
    if (foul) {
      S.note = `Foul by ${who === 'You' ? 'you' : 'the House'}: ${foul}. ${op === 0 ? 'Your' : 'House'} ball in hand.`;
      showBanner(`Foul: ${foul}`, '#ff3d7f');
      const c = cue();
      if (!c.on) { c.on = true; sinking = sinking.filter((s) => s.n !== 0); c.x = HEAD_X; c.y = CY; }
      S.turn = op; S.phase = 'place';
    } else {
      S.note = '';
      if (!cont) { S.turn = op; showBanner(op === 0 ? 'Your shot' : "The House's shot", op === 0 ? '#d6b26e' : '#3de0ff', 1.4); }
      S.phase = 'aim';
    }
    if (S.turn === 0 && S.phase === 'aim') aim = Math.atan2(mouse.y - cue().y, mouse.x - cue().x) || 0;
    shot = null;
  }

  // ---------- placement ----------
  function validPlace(x, y, kitchen) {
    if (x < L + BR || x > R - BR || y < T + BR || y > B - BR) return false;
    if (kitchen && x > HEAD_X) return false;
    return !balls.some((b) => b.n !== 0 && b.on && Math.hypot(b.x - x, b.y - y) < 2 * BR + 0.5);
  }

  // ---------- AI ----------
  function clearOfBalls(x1, y1, x2, y2, rad, ignore) {
    for (const b of balls) {
      if (!b.on || ignore.includes(b)) continue;
      if (distPtSeg(b.x, b.y, x1, y1, x2, y2) < rad) return false;
    }
    return true;
  }
  function clearOfCushions(x1, y1, x2, y2, rad) {
    for (const s of segs) if (segSegDist(x1, y1, x2, y2, s) < rad) return false;
    return true;
  }
  function planShot(cx, cy, who) {
    const c = cue(); let best = null;
    for (const t of legalTargets(who)) {
      for (const pk of pockets) {
        for (const ap of pk.aims) {
          let ux = ap.x - t.x, uy = ap.y - t.y; const d2 = Math.hypot(ux, uy); ux /= d2; uy /= d2;
          if (pk.side && Math.abs(uy) < 0.55) continue;
          const gx = t.x - ux * 2 * BR, gy = t.y - uy * 2 * BR;
          if (gx < L + BR - 1 || gx > R - BR + 1 || gy < T + BR - 1 || gy > B - BR + 1) continue;
          let cdx = gx - cx, cdy = gy - cy; const d1 = Math.hypot(cdx, cdy); if (d1 < 2) continue;
          cdx /= d1; cdy /= d1;
          const cos = cdx * ux + cdy * uy; if (cos < 0.3) continue;
          if (!clearOfBalls(t.x, t.y, ap.x, ap.y, 2 * BR - 0.5, [t, c])) continue;
          if (!clearOfCushions(t.x, t.y, ap.x, ap.y, BR - 0.5)) continue;
          if (!clearOfBalls(cx, cy, gx, gy, 2 * BR - 0.5, [t, c])) continue;
          if (!clearOfCushions(cx, cy, gx, gy, BR - 0.5)) continue;
          const score = (cos * cos * 1000) / (d1 * 0.5 + d2 + 120) * (pk.side ? Math.abs(uy) : 1) * (ap === pk.aims[0] ? 1 : 0.9);
          if (!best || score > best.score) {
            const vt = (d2 + 90) * 0.6 + 160, vc = vt / Math.max(cos, 0.35), v0 = (vc + d1 * 0.55 + 120) * 1.2;
            best = { score, angle: Math.atan2(cdy, cdx), speed: clamp(v0, 300, 1650), target: t.n };
          }
        }
      }
    }
    return best;
  }
  function planSafety(cx, cy, who) {
    const c = cue(); let best = null;
    for (const t of legalTargets(who)) {
      const d = Math.hypot(t.x - cx, t.y - cy);
      if (!clearOfBalls(cx, cy, t.x, t.y, 2 * BR - 0.5, [t, c])) continue;
      if (!best || d < best.d) best = { d, angle: Math.atan2(t.y - cy, t.x - cx), speed: clamp(500 + d * 0.8, 500, 1100), score: 0 };
    }
    if (best) return best;
    const ts = legalTargets(who), t = ts[Math.floor(Math.random() * ts.length)] || balls[8];
    return { angle: Math.atan2(t.y - cy, t.x - cx), speed: 900, score: 0 };
  }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; }
  function aiDecide() {
    const c = cue();
    let plan;
    if (S.isBreak) {
      const apex = balls.find((b) => b.on && Math.abs(b.x - FOOT_X) < 1 && Math.abs(b.y - CY) < 1) || { x: FOOT_X, y: CY };
      plan = { angle: Math.atan2(apex.y - c.y, apex.x - c.x) + (Math.random() - 0.5) * 0.01, speed: MAXV };
    } else {
      plan = planShot(c.x, c.y, S.turn) || planSafety(c.x, c.y, S.turn);
      plan.angle += gauss() * (0.0016 + Math.random() * 0.0012);
    }
    plan.power = powerFromSpeed(plan.speed);
    return plan;
  }
  function aiPlace() {
    let best = null;
    const xmax = S.kitchen ? HEAD_X - BR : R - 30;
    for (let x = L + 30; x <= xmax; x += S.kitchen ? 25 : 45) {
      for (let y = T + 25; y <= B - 25; y += 35) {
        if (!validPlace(x, y, S.kitchen)) continue;
        const sc = S.kitchen ? -Math.abs(y - CY) - Math.random() * 30 : (planShot(x, y, S.turn) || { score: -1 }).score + Math.random() * 0.01;
        if (!best || sc > best.sc) best = { x, y, sc };
      }
    }
    if (!best) best = { x: HEAD_X - 20, y: CY };
    const c = cue(); c.x = best.x; c.y = best.y;
    if (!validPlace(c.x, c.y, S.kitchen)) { for (let y = T + BR; y < B; y += 4) if (validPlace(L + 20, y, false)) { c.x = L + 20; c.y = y; break; } }
  }
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

  function updateAI(dt) {
    if (S.turn !== 1) return;
    if (S.phase === 'place') {
      ai = ai || { t: 0 };
      ai.t += dt;
      if (ai.t > 0.8) { aiPlace(); S.phase = 'aim'; ai = null; }
      return;
    }
    if (S.phase !== 'aim') return;
    if (!ai) { ai = { t: 0, plan: null, startAim: aim }; power = 0; }
    ai.t += dt;
    if (!ai.plan && ai.t > 0.45) { ai.plan = aiDecide(); ai.startAim = aim; ai.t0 = ai.t; }
    if (!ai.plan) return;
    const k = (ai.t - ai.t0);
    const turnT = 0.9;
    if (k < turnT) { const e = 1 - Math.pow(1 - k / turnT, 3); aim = ai.startAim + angDiff(ai.startAim, ai.plan.angle) * e; }
    else if (k < turnT + 0.6) { aim = ai.plan.angle; power = ai.plan.power * ((k - turnT) / 0.6); }
    else if (k > turnT + 0.8) shoot(ai.plan.angle, ai.plan.speed);
  }

  // ---------- input ----------
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function onDown(e) {
    ensureAudio();
    const p = toCanvas(e); mouse = { ...p, inside: true };
    if (S.turn !== 0) return;
    if (S.phase === 'place') {
      const x = clamp(p.x, L + BR, R - BR), y = clamp(p.y, T + BR, B - BR);
      if (validPlace(x, y, S.kitchen)) { const c = cue(); c.x = x; c.y = y; S.phase = 'aim'; aim = S.isBreak ? 0 : aim; }
      else showBanner(S.kitchen ? 'Place it behind the head string' : 'Not there: too close to a ball', '#ff3d7f', 1.2);
      e.preventDefault();
      return;
    }
    if (S.phase === 'aim') {
      drag = { sx: p.x, sy: p.y }; power = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    }
  }
  function onMove(e) {
    const p = toCanvas(e); mouse = { ...p, inside: true };
    if (S.turn !== 0) return;
    if (S.phase === 'place') return;
    if (S.phase !== 'aim') return;
    const c = cue();
    if (drag) {
      const pull = -((p.x - drag.sx) * Math.cos(aim) + (p.y - drag.sy) * Math.sin(aim));
      power = clamp(pull / 170, 0, 1);
    } else if (Math.hypot(p.x - c.x, p.y - c.y) > 3) aim = Math.atan2(p.y - c.y, p.x - c.x);
  }
  function onUp(e) {
    if (!drag) return;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (S.phase === 'aim' && S.turn === 0 && power > 0.02) shoot(aim, speedFromPower(power));
    drag = null; power = 0;
  }
  const onLeave = () => { mouse.inside = false; };
  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', onLeave);
  const onKey = (e) => {
    if (S.phase === 'aim' && S.turn === 0 && !drag && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      aim += (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.02 : 0.003);
      e.preventDefault(); e.stopPropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);

  // ---------- rendering ----------
  function castRay(ox, oy, dx, dy) {
    let best = Infinity, hit = null;
    for (const b of balls) {
      if (!b.on || b.n === 0) continue;
      const fx = ox - b.x, fy = oy - b.y, bq = fx * dx + fy * dy, c = fx * fx + fy * fy - 4 * BR * BR, disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; hit = b; }
    }
    const tx = dx > 0 ? (R - BR - ox) / dx : dx < 0 ? (L + BR - ox) / dx : Infinity;
    const ty = dy > 0 ? (B - BR - oy) / dy : dy < 0 ? (T + BR - oy) / dy : Infinity;
    const tw = Math.min(tx, ty);
    if (tw < best) return { t: Math.max(0, tw), ball: null };
    return { t: best, ball: hit };
  }

  function drawGuide() {
    const c = cue(), dx = Math.cos(aim), dy = Math.sin(aim);
    const hit = castRay(c.x, c.y, dx, dy);
    const ex = c.x + dx * hit.t, ey = c.y + dy * hit.t;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let d = BR + 4; d < hit.t - 2; d += 11) ctx.fillRect(c.x + dx * d - 1, c.y + dy * d - 1, 2.2, 2.2);
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(ex, ey, BR, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.stroke();
    if (hit.ball) {
      let nx = hit.ball.x - ex, ny = hit.ball.y - ey; const nd = Math.hypot(nx, ny) || 1; nx /= nd; ny /= nd;
      const cos = dx * nx + dy * ny;
      const legal = legalTargets(0).includes(hit.ball) || S.isBreak;
      ctx.strokeStyle = legal ? 'rgba(214,178,110,.9)' : 'rgba(255,61,127,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hit.ball.x, hit.ball.y); ctx.lineTo(hit.ball.x + nx * (30 + 90 * cos), hit.ball.y + ny * (30 + 90 * cos)); ctx.stroke();
      const tx = dx - cos * nx, ty = dy - cos * ny, tl = Math.hypot(tx, ty);
      if (tl > 0.02) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + (tx / tl) * 60 * tl, ey + (ty / tl) * 60 * tl); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Cue stick pre-rendered horizontally (tip at x=0), drawn rotated as a single textured quad.
  const CUE_LEN = 420, CUE_H = 16;
  const cueC = document.createElement('canvas'); cueC.width = CUE_LEN * 2; cueC.height = CUE_H * 2 * 2;
  {
    const g = cueC.getContext('2d'); g.scale(2, 2);
    // shadow strip (lower half of the sprite sheet)
    g.save(); g.translate(0, CUE_H * 1.5);
    g.beginPath(); g.moveTo(4, -3.2); g.lineTo(CUE_LEN, -6.5); g.lineTo(CUE_LEN, 6.5); g.lineTo(4, 3.2); g.closePath();
    g.filter = 'blur(2px)'; g.fillStyle = 'rgba(0,0,0,.45)'; g.fill(); g.filter = 'none'; g.restore();
    g.translate(0, CUE_H / 2);
    g.beginPath(); g.moveTo(0, -2.6); g.lineTo(CUE_LEN - 2, -6); g.lineTo(CUE_LEN - 2, 6); g.lineTo(0, 2.6); g.closePath();
    const gr = g.createLinearGradient(0, 0, CUE_LEN, 0);
    gr.addColorStop(0, '#e9dcc0'); gr.addColorStop(0.55, '#d8bf8e'); gr.addColorStop(0.58, '#1b0f08');
    gr.addColorStop(0.7, '#5a2a12'); gr.addColorStop(0.72, '#d6b26e'); gr.addColorStop(0.735, '#5a2a12'); gr.addColorStop(0.86, '#2a140a'); gr.addColorStop(1, '#120a05');
    g.fillStyle = gr; g.fill();
    const sheen = g.createLinearGradient(0, -6, 0, 6);
    sheen.addColorStop(0, 'rgba(255,255,255,.0)'); sheen.addColorStop(0.3, 'rgba(255,255,255,.28)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,.25)');
    g.fillStyle = sheen; g.fill();
    g.fillStyle = '#f7f3ea'; g.fillRect(0, -2.6, 8, 5.2);
    g.fillStyle = '#3d6fa8'; g.fillRect(0, -2.4, 1.6, 4.8);
  }
  let cueImg = cueC;
  toBitmap(cueC, (bm) => (cueImg = bm));
  function drawCue() {
    const c = cue();
    const x0 = BR + 8 + power * 70, a = aim + Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.save(); // shadow: same orientation, offset down-right in table space
    ctx.setTransform(ca, sa, -sa, ca, c.x + 4, c.y + 7);
    ctx.drawImage(cueImg, 0, CUE_H * 2, CUE_LEN * 2, CUE_H * 2, x0, -CUE_H / 2, CUE_LEN, CUE_H);
    ctx.setTransform(ca, sa, -sa, ca, c.x, c.y);
    ctx.drawImage(cueImg, 0, 0, CUE_LEN * 2, CUE_H * 2, x0, -CUE_H / 2, CUE_LEN, CUE_H);
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.textBaseline = 'middle';
    const side = (who, x, align) => {
      const active = S.turn === who && S.phase !== 'idle' && S.phase !== 'over';
      ctx.textAlign = align;
      ctx.font = '500 20px "Bodoni Moda", Georgia, serif';
      ctx.fillStyle = active ? '#f1e9db' : 'rgba(241,233,219,.55)';
      const name = who === 0 ? NAMES[0] : NAMES[1];
      ctx.fillText(name, x, 22);
      const nw = ctx.measureText(name).width;
      if (active) {
        ctx.fillStyle = '#d6b26e'; const ux = align === 'left' ? x : x - nw;
        ctx.fillRect(ux, 36, nw, 2);
      }
      const g = S.groups[who];
      ctx.font = '600 10px Manrope, Arial, sans-serif'; ctx.fillStyle = '#a59d90';
      const label = S.phase === 'idle' ? '' : !g ? 'OPEN TABLE' : onEight(who) ? 'ON THE 8' : g === 'solid' ? 'SOLIDS' : 'STRIPES';
      const lx = align === 'left' ? x + nw + 14 : x - nw - 14;
      ctx.fillText(label, lx, 23);
      if (g) {
        const lw = ctx.measureText(label).width;
        const nums = g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
        nums.forEach((n, i) => {
          const bx = align === 'left' ? lx + lw + 16 + i * 19 : lx - lw - 16 - i * 19;
          drawBall(n, bx, 23, 0.82, balls[n] && balls[n].on ? 1 : 0.18);
        });
      }
    };
    side(0, 52, 'left');
    side(1, W - 52, 'right');
    ctx.restore();
  }

  function drawPowerBar() {
    const x = 26, y0 = T + 10, h = B - T - 20;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x - 7, y0, 14, h);
    ctx.strokeStyle = 'rgba(214,178,110,.35)'; ctx.strokeRect(x - 7.5, y0 - 0.5, 15, h + 1);
    if (power > 0) {
      const g = ctx.createLinearGradient(0, y0 + h, 0, y0);
      g.addColorStop(0, '#56d68b'); g.addColorStop(0.55, '#d6b26e'); g.addColorStop(1, '#ff3d7f');
      ctx.fillStyle = g; ctx.fillRect(x - 6, y0 + h * (1 - power), 12, h * power);
    }
    ctx.fillStyle = '#a59d90'; ctx.font = '600 9px Manrope, Arial'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(x, y0 + h + 0); ctx.restore();
    ctx.fillText('POWER', x, y0 - 10);
    ctx.restore();
  }

  function draw() {
    ctx.drawImage(table, 0, 0);
    // kitchen
    if (S.phase === 'place' && S.kitchen) {
      ctx.save(); ctx.fillStyle = 'rgba(214,178,110,.06)'; ctx.fillRect(L, T, HEAD_X - L, B - T);
      ctx.fillStyle = 'rgba(214,178,110,.5)';
      for (let y = T + 4; y < B; y += 10) ctx.fillRect(HEAD_X - 0.75, y, 1.5, 5);
      ctx.restore();
    }
    // legal target hint
    if (S.turn === 0 && (S.phase === 'aim' || S.phase === 'place') && !S.isBreak) {
      ctx.save(); ctx.strokeStyle = 'rgba(214,178,110,.35)'; ctx.lineWidth = 1.2;
      for (const b of legalTargets(0)) { ctx.beginPath(); ctx.arc(b.x, b.y, BR + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    // shadows
    for (const b of balls) if (b.on && !(b.n === 0 && S.phase === 'place')) drawBall(16, b.x + 3, b.y + 4, 1.1);
    for (const s of sinking) { const k = clamp(s.t / 0.28, 0, 1); drawBall(s.n, s.x + (s.px - s.x) * k, s.y + (s.py - s.y) * k, 1 - k * 0.55, 1 - k); }
    for (const b of balls) {
      if (!b.on) continue;
      if (b.n === 0 && S.phase === 'place') continue;
      drawBall(b.n, b.x, b.y);
    }
    if (S.phase === 'place') {
      const c = cue();
      if (S.turn === 0) {
        const x = clamp(mouse.x, L + BR, R - BR), y = clamp(mouse.y, T + BR, B - BR);
        const ok = validPlace(x, y, S.kitchen);
        drawBall(0, x, y, 1, ok ? 0.9 : 0.4);
        ctx.beginPath(); ctx.arc(x, y, BR + 4, 0, Math.PI * 2); ctx.strokeStyle = ok ? 'rgba(86,214,139,.8)' : 'rgba(255,61,127,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else drawBall(0, c.x, c.y, 1, 0.5);
    }
    if (S.phase === 'aim') {
      if (S.turn === 0) drawGuide();
      drawCue();
    }
    drawHUD();
    drawPowerBar();
    // banner
    if (banner.t > 0 && banner.text) {
      ctx.save();
      const a = clamp(banner.t / 0.4, 0, 1);
      ctx.globalAlpha = a;
      const big = banner.t > 90, by = big ? CY : T + 44;
      ctx.font = `500 ${big ? 30 : 21}px "Bodoni Moda", Georgia, serif`;
      const tw = ctx.measureText(banner.text).width, bh = big ? 60 : 42;
      ctx.fillStyle = 'rgba(8,7,5,.8)'; ctx.fillRect(CX - tw / 2 - 24, by - bh / 2, tw + 48, bh);
      ctx.fillStyle = 'rgba(214,178,110,.6)'; ctx.fillRect(CX - tw / 2 - 24, by - bh / 2, tw + 48, 1); ctx.fillRect(CX - tw / 2 - 24, by + bh / 2 - 1, tw + 48, 1);
      ctx.fillStyle = banner.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(banner.text, CX, by + 1);
      ctx.restore();
    }
    if (S.phase === 'idle') {
      ctx.save(); ctx.fillStyle = 'rgba(5,4,3,.55)'; ctx.fillRect(L, T, R - L, B - T);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f1e9db'; ctx.font = '500 34px "Bodoni Moda", Georgia, serif';
      ctx.fillText('Eight Ball', CX, CY - 14);
      ctx.fillStyle = '#a59d90'; ctx.font = '600 13px Manrope, Arial'; ctx.fillText('Pick a stake below and rack \'em. You break.', CX, CY + 20);
      ctx.restore();
    }
  }

  function statusText() {
    if (S.phase === 'idle') return `Chips: ${fmt(api.chips())}. Choose a stake, then rack 'em.`;
    if (S.phase === 'over') return S.result;
    const g = (w) => (!S.groups[w] ? 'open' : onEight(w) ? 'on the 8' : `${S.groups[w] === 'solid' ? 'solids' : 'stripes'} (${remaining(S.groups[w])} left)`);
    const turn = S.turn === 0
      ? (S.phase === 'place' ? 'Ball in hand: click to place the cue ball' : S.phase === 'shooting' ? 'Balls rolling' : S.isBreak ? 'Your break' : 'Your shot')
      : (S.phase === 'shooting' ? 'Balls rolling' : 'The House is lining up');
    return `${turn} · You: ${g(0)} · House: ${g(1)}${activeStake ? ` · Stake ${fmt(activeStake)}` : ''}${S.note ? ` · ${S.note}` : ''}`;
  }

  // ---------- loop ----------
  rack();
  let raf = 0, last = performance.now(), frame = 0, lastStatus = '', timeScale = 1;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000)) * timeScale; last = now;
    if (S.phase === 'shooting') simulate(dt);
    updateAI(dt);
    for (const s of sinking) s.t += dt;
    sinking = sinking.filter((s) => s.t < 0.3);
    if (banner.t > 0 && banner.t < 90) banner.t -= dt;
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
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    cv.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('keydown', onKey, true);
    if (actx) { try { actx.close(); } catch (e) { /* ignore */ } actx = null; }
    if (window.__pool && window.__pool.S === S) delete window.__pool;
  });

  // test hook (harmless in production)
  window.__pool = {
    S, balls: () => balls, cue, shoot: (a, p) => shoot(a, speedFromPower(p)), setTimeScale: (k) => (timeScale = k),
    autoplay: () => { if (S.phase === 'place') { aiPlace(); S.phase = 'aim'; } else if (S.phase === 'aim') { const pl = aiDecide(); shoot(pl.angle, pl.speed); } },
  };
}
