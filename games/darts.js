// DARTS: an elegant bar darts game. 501 double-out vs The House, or Around the Clock practice.
export default function start(api) {
  const W = 800, H = 540;
  const sel = 'background:#100e0b;color:#f1e9db;border:1px solid #2a251d;padding:8px 10px;font:600 13px Manrope,Arial,sans-serif';
  const card = api.open(`
    <div class="eyebrow">Bar · Darts</div><h2>The <em>Oche</em></h2>
    <canvas class="game" width="${W}" height="${H}"></canvas>
    <div class="result" id="dtStatus">Move to aim · press &amp; hold to draw back · release in the gold band. Arrows + Space also work.</div>
    <div class="row">
      <button class="primary" id="dt501">Play 501</button>
      <button id="dtAtc">Around the Clock</button>
      <select id="dtLevel" style="${sel}" title="Opponent">
        <option value="16">House: Pub regular</option><option value="10" selected>House: League player</option><option value="6.5">House: Pro</option>
      </select>
      <select id="dtStake" style="${sel}" title="Stake">
        <option value="0">No stake</option><option value="100">Stake 100</option><option value="250">Stake 250</option><option value="500">Stake 500</option><option value="1000">Stake 1,000</option>
      </select>
      <button data-close>Leave</button>
    </div>`, { wide: true });
  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const statusEl = card.querySelector('#dtStatus');
  const levelSel = card.querySelector('#dtLevel');
  const stakeSel = card.querySelector('#dtStake');

  const store = {
    get(k) { try { return +localStorage.getItem('vault.darts.' + k) || 0; } catch (e) { return 0; } },
    set(k, v) { try { localStorage.setItem('vault.darts.' + k, String(v)); } catch (e) { /* ignore */ } },
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const TAU = Math.PI * 2;
  const SERIF = '"Bodoni Moda", Georgia, serif', SANS = 'Manrope, Arial, sans-serif';

  // ---------- board geometry (mm) ----------
  const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const R = { bull: 6.35, outer: 15.9, tIn: 99, tOut: 107, dIn: 162, dOut: 170, num: 194, edge: 222 };
  const BX = 262, BY = 270, S = 1.0; // px per mm
  const toPx = (mx, my) => [BX + mx * S, BY + my * S];
  const toMm = (px, py) => [(px - BX) / S, (py - BY) / S];

  function scoreAt(x, y) {
    const r = Math.hypot(x, y);
    if (r <= R.bull) return { v: 50, num: 25, mult: 2, dbl: true, label: 'BULL' };
    if (r <= R.outer) return { v: 25, num: 25, mult: 1, dbl: false, label: '25' };
    if (r > R.dOut) return { v: 0, num: 0, mult: 0, dbl: false, label: 'MISS' };
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360 + 9) % 360;
    const num = ORDER[Math.floor(deg / 18) % 20];
    if (r >= R.tIn && r <= R.tOut) return { v: num * 3, num, mult: 3, dbl: false, label: 'T' + num };
    if (r >= R.dIn) return { v: num * 2, num, mult: 2, dbl: true, label: 'D' + num };
    return { v: num, num, mult: 1, dbl: false, label: String(num) };
  }
  function targetPoint(label) {
    if (label === 'BULL') return [0, 0];
    if (label === '25') return [0, -11];
    const m = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
    const n = m === 1 ? +label : +label.slice(1);
    const a = ORDER.indexOf(n) * 18 * Math.PI / 180;
    const r = m === 3 ? (R.tIn + R.tOut) / 2 : m === 2 ? (R.dIn + R.dOut) / 2 : 135;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  }

  // ---------- checkout routes ----------
  const THROWS = [];
  for (let n = 20; n >= 1; n--) THROWS.push({ l: 'T' + n, v: 3 * n, c: 2 + (20 - n) * 0.01 });
  for (let n = 20; n >= 1; n--) THROWS.push({ l: String(n), v: n, c: 1 });
  THROWS.push({ l: '25', v: 25, c: 2.5 }, { l: 'BULL', v: 50, c: 3 });
  for (let n = 20; n >= 1; n--) THROWS.push({ l: 'D' + n, v: 2 * n, c: 2.2 });
  const DPREF = { 20: 0, 16: 0, 8: 0.3, 10: 0.3, 18: 0.4, 12: 0.4, 4: 0.6, 6: 0.6, 14: 0.6, 2: 0.8, 1: 1.2 };
  const FINISH = {};
  for (let n = 1; n <= 20; n++) FINISH[2 * n] = { l: 'D' + n, c: DPREF[n] ?? 0.8 };
  const memo = new Map();
  function route(score, darts) {
    const key = score * 4 + darts;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    if (score === 50) best = { path: ['BULL'], cost: 6.5 + 5 };
    if (FINISH[score]) { const f = FINISH[score]; const c = f.c + 5; if (!best || c < best.cost) best = { path: [f.l], cost: c }; }
    if (darts > 1) {
      for (const t of THROWS) {
        const rem = score - t.v;
        if (rem < 2) continue;
        const sub = route(rem, darts - 1);
        if (!sub) continue;
        const c = t.c + 5 + sub.cost;
        if (!best || c < best.cost - 1e-9) best = { path: [t.l, ...sub.path], cost: c };
      }
    }
    memo.set(key, best);
    return best;
  }

  // ---------- static art ----------
  const room = document.createElement('canvas'); room.width = W; room.height = H;
  (function paintRoom() {
    const b = room.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1b120b'); g.addColorStop(1, '#0b0705');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    // wood panelling
    for (let x = 0; x < W; x += 58) {
      b.fillStyle = `rgba(${60 + Math.random() * 20},${36 + Math.random() * 12},${20},0.18)`; b.fillRect(x, 0, 56, H);
      b.fillStyle = 'rgba(0,0,0,0.45)'; b.fillRect(x + 56, 0, 2, H);
      for (let k = 0; k < 18; k++) { b.strokeStyle = `rgba(120,80,40,${rnd(0.02, 0.06)})`; b.beginPath(); const xx = x + rnd(2, 54); b.moveTo(xx, 0); b.bezierCurveTo(xx + rnd(-6, 6), H / 3, xx + rnd(-6, 6), H * 2 / 3, xx + rnd(-4, 4), H); b.stroke(); }
    }
    // warm spotlight
    const sp = b.createRadialGradient(BX, BY - 40, 30, BX, BY, 380);
    sp.addColorStop(0, 'rgba(255,214,150,0.22)'); sp.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = sp; b.fillRect(0, 0, W, H);
    // cabinet surround shadow
    b.fillStyle = 'rgba(0,0,0,0.55)'; b.beginPath(); b.arc(BX + 6, BY + 10, R.edge * S + 18, 0, TAU); b.fill();
    // cabinet ring (polished wood)
    const ring = b.createRadialGradient(BX - 60, BY - 80, 40, BX, BY, R.edge * S + 16);
    ring.addColorStop(0, '#3a2414'); ring.addColorStop(0.9, '#1f130a'); ring.addColorStop(1, '#5a3a1e');
    b.fillStyle = ring; b.beginPath(); b.arc(BX, BY, R.edge * S + 14, 0, TAU); b.fill();
    b.strokeStyle = 'rgba(214,178,110,0.55)'; b.lineWidth = 1.5; b.beginPath(); b.arc(BX, BY, R.edge * S + 14, 0, TAU); b.stroke();
  })();
  const board = document.createElement('canvas'); board.width = W; board.height = H;
  (function paintBoard() {
    const b = board.getContext('2d');
    b.translate(BX, BY);
    // black surround with number ring
    b.fillStyle = '#0d0c0b'; b.beginPath(); b.arc(0, 0, R.edge * S, 0, TAU); b.fill();
    const wedge = (r0, r1, a0, a1, col) => { b.fillStyle = col; b.beginPath(); b.arc(0, 0, r1 * S, a0, a1); b.arc(0, 0, r0 * S, a1, a0, true); b.closePath(); b.fill(); };
    const BLACK = '#171513', CREAM = '#e6d8b8', RED = '#b8262f', GREEN = '#1d7148';
    for (let i = 0; i < 20; i++) {
      const a0 = (i * 18 - 9 - 90) * Math.PI / 180, a1 = a0 + 18 * Math.PI / 180;
      const dark = i % 2 === 0;
      wedge(R.outer, R.tIn, a0, a1, dark ? BLACK : CREAM);
      wedge(R.tIn, R.tOut, a0, a1, dark ? RED : GREEN);
      wedge(R.tOut, R.dIn, a0, a1, dark ? BLACK : CREAM);
      wedge(R.dIn, R.dOut, a0, a1, dark ? RED : GREEN);
    }
    b.fillStyle = GREEN; b.beginPath(); b.arc(0, 0, R.outer * S, 0, TAU); b.fill();
    b.fillStyle = RED; b.beginPath(); b.arc(0, 0, R.bull * S, 0, TAU); b.fill();
    // sisal texture
    for (let i = 0; i < 5000; i++) {
      const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R.dOut * S;
      b.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      b.fillRect(Math.cos(a) * r, Math.sin(a) * r, 1, 1);
    }
    // wires
    b.strokeStyle = 'rgba(210,210,215,0.75)'; b.lineWidth = 0.9;
    for (const r of [R.bull, R.outer, R.tIn, R.tOut, R.dIn, R.dOut]) { b.beginPath(); b.arc(0, 0, r * S, 0, TAU); b.stroke(); }
    for (let i = 0; i < 20; i++) {
      const a = (i * 18 - 9 - 90) * Math.PI / 180;
      b.beginPath(); b.moveTo(Math.cos(a) * R.outer * S, Math.sin(a) * R.outer * S); b.lineTo(Math.cos(a) * R.dOut * S, Math.sin(a) * R.dOut * S); b.stroke();
    }
    // numbers
    b.font = `600 ${Math.round(17 * S)}px ${SERIF}`; b.textAlign = 'center'; b.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
      const a = (i * 18 - 90) * Math.PI / 180;
      b.save(); b.translate(Math.cos(a) * R.num * S, Math.sin(a) * R.num * S);
      b.fillStyle = '#e9dcc0'; b.fillText(String(ORDER[i]), 0, 1);
      b.restore();
    }
    b.strokeStyle = 'rgba(214,178,110,0.35)'; b.lineWidth = 1; b.beginPath(); b.arc(0, 0, R.edge * S - 3, 0, TAU); b.stroke();
    // soft top-left sheen
    const sh = b.createRadialGradient(-80, -100, 10, 0, 0, R.edge * S);
    sh.addColorStop(0, 'rgba(255,240,210,0.10)'); sh.addColorStop(1, 'rgba(0,0,0,0.18)');
    b.fillStyle = sh; b.beginPath(); b.arc(0, 0, R.edge * S, 0, TAU); b.fill();
  })();

  // ---------- game state ----------
  const youName = (api.playerName && api.playerName()) || 'You';
  const youCol = (api.playerColor && api.playerColor()) || '#d6b26e';
  let game = 'menu'; // menu | 501 | atc | over
  let phase = 'idle'; // aim | charge | fly | wait | cpu
  let players = [], turn = 0, visit = [], turnStart = 0, stuck = [], stake = 0, sigma = 10;
  let atcTarget = 1, atcDarts = 0;
  let aim = [0, -103], reticle = [0, -103], charge = 0, chargeT = 0, flying = null, cpuPlan = null;
  let banner = null, time = 0, later = [], lastVisit = ['', ''], legDarts = 0, result = '', shake = 0;
  const best501 = () => store.get('best501');

  function swayAmp() { return 6.5 + (phase === 'charge' ? Math.min(chargeT, 3) * 1.6 : 0); }
  function sway(t) {
    const a = swayAmp();
    return [(Math.sin(t * 1.7) * 0.6 + Math.sin(t * 2.9 + 1.3) * 0.4) * a, (Math.sin(t * 2.3 + 2.1) * 0.6 + Math.sin(t * 1.25) * 0.4) * a];
  }
  const after = (t, fn) => later.push({ t, fn });
  const say = (text, sub = '', col = '#d6b26e', dur = 1.6) => { banner = { text, sub, col, t: dur, max: dur }; };

  function start501() {
    stake = +stakeSel.value;
    if (stake > api.chips()) { api.toast('Not enough chips for that stake'); stake = 0; stakeSel.value = '0'; }
    if (stake > 0) api.addChips(-stake);
    sigma = +levelSel.value;
    players = [
      { name: youName, score: 501, darts: 0, pts: 0, col: youCol },
      { name: 'The House', score: 501, darts: 0, pts: 0, col: '#9fb8c8' },
    ];
    game = '501'; turn = 0; legDarts = 0; lastVisit = ['', ''];
    later = []; beginTurn();
    statusEl.textContent = stake ? `501 double-out · ${stake.toLocaleString()} chips on the leg (pays 2×)` : '501 double-out vs The House · finish on a double or the bull';
    say('GAME ON', '501 · double out', '#d6b26e', 1.4);
  }
  function startAtc() {
    if (game === '501' && stake > 0) api.toast('Abandoned leg: stake forfeited');
    game = 'atc'; stake = 0; atcTarget = 1; atcDarts = 0; players = [{ name: youName, score: 0, darts: 0, pts: 0, col: youCol }]; turn = 0; later = [];
    beginTurn();
    statusEl.textContent = 'Around the Clock: hit 1 through 20 in order (any bed counts), then the bull.';
    say('AROUND THE CLOCK', 'start on 1', '#d6b26e', 1.4);
  }
  function beginTurn() {
    visit = []; stuck = []; turnStart = players[turn].score;
    if (game === '501' && turn === 1) { phase = 'cpu'; after(0.7, cpuThrow); }
    else phase = 'aim';
  }
  function endTurn() {
    if (game !== '501') { beginTurn(); return; }
    lastVisit[turn] = visit.length ? `${visit.map((v) => v.label).join(' · ')}` : '';
    turn = 1 - turn; beginTurn();
  }

  // ---------- CPU ----------
  function cpuChoice(score, left) {
    const r = route(score, left);
    if (r) return r.path[0];
    if (score > 60) return score - 60 === 1 ? 'T19' : 'T20';
    // set up a preferred double
    for (const d of [32, 40, 16, 24, 20, 36, 8]) { const s = score - d; if (s >= 1 && s <= 20) return String(s); }
    if (score > 40) return '20';
    return score % 2 === 1 ? '1' : 'D' + score / 2;
  }
  function cpuThrow() {
    if (game !== '501' || turn !== 1) return;
    const p = players[1];
    const target = cpuChoice(p.score, 3 - visit.length);
    const tp = targetPoint(target);
    cpuPlan = { from: [...reticle], to: tp, t: 0, target };
    phase = 'cpu';
  }

  // ---------- throwing ----------
  function release() {
    if (phase !== 'charge') return;
    const v = charge;
    const sw = sway(time);
    const err = (v - 0.72) * -44; // strong throws fly high, weak ones drop
    const land = [aim[0] + sw[0] + gauss() * 1.6, aim[1] + sw[1] + err + gauss() * 1.6];
    launch(land);
  }
  function launch(land) {
    const [px, py] = toPx(land[0], land[1]);
    flying = { land, px, py, t: 0, dur: 0.24, sx: px + rnd(-30, 30), sy: H + 60 };
    phase = 'fly';
  }
  function landDart() {
    const hit = scoreAt(flying.land[0], flying.land[1]);
    const p = players[turn];
    stuck.push({ x: flying.px, y: flying.py, col: p.col, wob: 0.25, ang: rnd(-0.12, 0.12) });
    shake = 2;
    flying = null; phase = 'wait';
    p.darts++; legDarts++;
    if (game === 'atc') return atcHit(hit);
    visit.push(hit);
    const rem = p.score - hit.v;
    if (rem < 0 || rem === 1 || (rem === 0 && !hit.dbl)) {
      p.score = turnStart;
      say('BUST', `${p.name} stays on ${turnStart}`, '#ff6b6b', 1.4);
      after(1.5, endTurn);
      return;
    }
    p.score = rem; p.pts += hit.v;
    if (rem === 0) return legWon(turn, hit);
    if (visit.length === 3) {
      const tot = visit.reduce((a, h) => a + h.v, 0);
      if (tot === 180) { say('ONE HUNDRED AND EIGHTY!', p.name, '#ffd36e', 2.2); shake = 8; }
      else if (tot >= 100) say(`TON${tot >= 140 ? ' FORTY' : ''}${tot > 100 && tot < 140 ? '+' : ''}`, `${tot} scored`, '#d6b26e', 1.4);
      else say(String(tot), p.name, '#f1e9db', 1.0);
      after(tot === 180 ? 2.2 : 1.3, endTurn);
    } else after(turn === 1 ? 0.55 : 0.25, () => { if (turn === 1) cpuThrow(); else phase = 'aim'; });
  }
  function legWon(who, hit) {
    game = 'over'; phase = 'idle';
    const p = players[who];
    if (who === 0) {
      const darts = p.darts;
      const bestD = best501();
      if (!bestD || darts < bestD) store.set('best501', darts);
      const pay = stake * 2;
      if (pay) { api.addChips(pay); api.broadcast(`won ${pay.toLocaleString()} chips on a 501 leg of darts`); }
      else if (darts <= 15) api.broadcast(`checked out a ${darts}-dart leg of 501`);
      result = `Game shot! ${hit.label} finish in ${darts} darts${pay ? ` · +${pay.toLocaleString()} chips` : ''}`;
      say('GAME SHOT', `${youName} checks out on ${hit.label}`, '#56d68b', 3);
    } else {
      result = `The House checks out on ${hit.label}${stake ? ` · stake of ${stake.toLocaleString()} lost` : ''}`;
      say('THE HOUSE WINS', `checkout on ${hit.label}`, '#ff6b6b', 3);
    }
    statusEl.textContent = result + ' · Play 501 for another leg';
    stake = 0;
  }
  function atcHit(hit) {
    atcDarts++;
    visit.push(hit);
    const want = atcTarget;
    const ok = want === 21 ? hit.num === 25 : hit.num === want;
    if (ok) {
      if (want === 21) {
        game = 'over'; phase = 'idle';
        const bestA = store.get('atc');
        const nb = !bestA || atcDarts < bestA;
        if (nb) store.set('atc', atcDarts);
        result = `Around the Clock complete in ${atcDarts} darts${nb ? ' · new best' : ''}`;
        say('ROUND THE BOARD', `${atcDarts} darts${nb ? ' · new best' : ''}`, '#56d68b', 3);
        statusEl.textContent = result;
        if (atcDarts <= 30) api.broadcast(`went around the clock in ${atcDarts} darts`);
        return;
      }
      atcTarget++;
    }
    if (visit.length === 3) after(1.0, endTurn); else after(0.25, () => { phase = 'aim'; });
  }

  // ---------- update ----------
  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 20);
    for (let i = later.length - 1; i >= 0; i--) { later[i].t -= dt; if (later[i].t <= 0) { const f = later[i].fn; later.splice(i, 1); f(); } }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    for (const d of stuck) d.wob = Math.max(0, d.wob - dt);
    // keyboard aiming
    if (phase === 'aim' || phase === 'charge') {
      const sp = 70 * dt;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) aim[0] -= sp;
      if (keys.has('ArrowRight') || keys.has('KeyD')) aim[0] += sp;
      if (keys.has('ArrowUp') || keys.has('KeyW')) aim[1] -= sp;
      if (keys.has('ArrowDown') || keys.has('KeyS')) aim[1] += sp;
      aim[0] = clamp(aim[0], -R.edge, R.edge); aim[1] = clamp(aim[1], -R.edge, R.edge);
      const sw = sway(time); reticle = [aim[0] + sw[0], aim[1] + sw[1]];
    }
    if (phase === 'charge') {
      chargeT += dt;
      const ph = (chargeT / 1.25) % 2; charge = ph < 1 ? ph : 2 - ph;
    }
    if (phase === 'cpu' && cpuPlan) {
      cpuPlan.t += dt;
      const k = clamp(cpuPlan.t / 0.75, 0, 1), e = k * k * (3 - 2 * k);
      const sw = sway(time * 0.8);
      reticle = [cpuPlan.from[0] + (cpuPlan.to[0] - cpuPlan.from[0]) * e + sw[0] * 0.6, cpuPlan.from[1] + (cpuPlan.to[1] - cpuPlan.from[1]) * e + sw[1] * 0.6];
      if (cpuPlan.t > 0.95) {
        const land = [cpuPlan.to[0] + gauss() * sigma, cpuPlan.to[1] + gauss() * sigma];
        cpuPlan = null; launch(land);
      }
    }
    if (phase === 'fly' && flying) { flying.t += dt; if (flying.t >= flying.dur) landDart(); }
  }

  // ---------- render ----------
  function drawDart(x, y, col, ang = 0, scale = 1, wob = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.55 + ang + Math.sin(wob * 60) * wob * 0.5); ctx.scale(scale, scale);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(4, -2, 40, 3);
    // tip, barrel, shaft, flight
    ctx.strokeStyle = '#cfd3d6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(7, 0); ctx.stroke();
    const bg = ctx.createLinearGradient(0, -3, 0, 3); bg.addColorStop(0, '#f2f2f2'); bg.addColorStop(0.5, '#8b9096'); bg.addColorStop(1, '#3a3d42');
    ctx.fillStyle = bg; ctx.fillRect(7, -2.6, 16, 5.2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 9; k < 22; k += 2.5) ctx.fillRect(k, -2.6, 0.8, 5.2);
    ctx.fillStyle = '#1b1b1f'; ctx.fillRect(23, -1.4, 12, 2.8);
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(44, -9); ctx.lineTo(48, -9); ctx.lineTo(46, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(44, 9); ctx.lineTo(48, 9); ctx.lineTo(46, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function text(t, x, y, font, col, align = 'left') { ctx.font = font; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y); }

  function highlightNumber(n) {
    if (!n) return;
    ctx.save(); ctx.translate(BX, BY);
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.18 + Math.sin(time * 4) * 0.06;
    ctx.fillStyle = `rgba(214,178,110,${pulse})`;
    if (n === 25) { ctx.beginPath(); ctx.arc(0, 0, R.outer * S, 0, TAU); ctx.fill(); }
    else {
      const i = ORDER.indexOf(n);
      const a0 = (i * 18 - 9 - 90) * Math.PI / 180, a1 = a0 + 18 * Math.PI / 180;
      ctx.beginPath(); ctx.arc(0, 0, R.dOut * S, a0, a1); ctx.arc(0, 0, R.outer * S, a1, a0, true); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawPanel() {
    const x0 = 548, w = 236;
    ctx.fillStyle = 'rgba(12,9,6,0.82)'; ctx.fillRect(x0, 22, w, H - 44);
    ctx.strokeStyle = 'rgba(214,178,110,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, 22.5, w - 1, H - 45);
    ctx.strokeStyle = 'rgba(214,178,110,0.18)'; ctx.strokeRect(x0 + 5.5, 27.5, w - 11, H - 55);
    const cx = x0 + 22;
    if (game === 'menu') {
      text('THE OCHE', cx, 62, `600 11px ${SANS}`, '#d6b26e');
      text('Darts', cx, 104, `500 38px ${SERIF}`, '#f1e9db');
      text('at the Vault', cx, 130, `italic 400 18px ${SERIF}`, '#d6b26e');
      const lines = ['501 · double out, versus', 'The House. Stake chips on', 'the leg to win double.', '', 'Around the Clock · solo', 'practice, 1 to 20 then bull.'];
      lines.forEach((l, i) => text(l, cx, 176 + i * 20, `400 13px ${SANS}`, '#a59d90'));
      text('HOW TO THROW', cx, 320, `600 10px ${SANS}`, '#d6b26e');
      ['Hover to aim. Your hand sways.', 'Press and hold to draw back,', 'release in the gold band.', 'Early = low · late = high.'].forEach((l, i) => text(l, cx, 342 + i * 19, `400 13px ${SANS}`, '#cfc5b4'));
      const b5 = best501(), ba = store.get('atc');
      text('PERSONAL BESTS', cx, 440, `600 10px ${SANS}`, '#d6b26e');
      text(`501 leg   ${b5 ? b5 + ' darts' : '—'}`, cx, 462, `400 13px ${SANS}`, '#f1e9db');
      text(`Clock       ${ba ? ba + ' darts' : '—'}`, cx, 482, `400 13px ${SANS}`, '#f1e9db');
      return;
    }
    if (game === 'atc' || (game === 'over' && players.length === 1)) {
      text('AROUND THE CLOCK', cx, 58, `600 10px ${SANS}`, '#d6b26e');
      text('Target', cx, 96, `italic 400 16px ${SERIF}`, '#a59d90');
      text(atcTarget > 20 ? 'Bull' : String(atcTarget), cx, 156, `500 64px ${SERIF}`, '#f1e9db');
      // progress pips
      for (let i = 1; i <= 21; i++) {
        const px = cx + ((i - 1) % 7) * 27, py = 186 + Math.floor((i - 1) / 7) * 26;
        const done = i < atcTarget;
        ctx.strokeStyle = 'rgba(214,178,110,0.5)'; ctx.fillStyle = done ? '#d6b26e' : i === atcTarget ? 'rgba(214,178,110,0.18)' : 'transparent';
        ctx.beginPath(); ctx.arc(px + 9, py, 10, 0, TAU); ctx.fill(); ctx.stroke();
        text(i === 21 ? 'B' : String(i), px + 9, py + 4, `600 10px ${SANS}`, done ? '#17120a' : '#cfc5b4', 'center');
      }
      text('Darts thrown', cx, 290, `400 13px ${SANS}`, '#a59d90');
      text(String(atcDarts), cx + w - 44, 290, `500 22px ${SERIF}`, '#f1e9db', 'right');
      const ba = store.get('atc');
      text('Personal best', cx, 318, `400 13px ${SANS}`, '#a59d90');
      text(ba ? String(ba) : '—', cx + w - 44, 318, `500 22px ${SERIF}`, '#d6b26e', 'right');
      drawVisit(cx, 360);
      return;
    }
    // 501 scoreboard
    text('501 · DOUBLE OUT', cx, 58, `600 10px ${SANS}`, '#d6b26e');
    if (stake) text(`STAKE ${stake.toLocaleString()}`, cx + w - 44, 58, `600 10px ${SANS}`, '#56d68b', 'right');
    players.forEach((p, i) => {
      const y = 82 + i * 104;
      const active = i === turn && game === '501';
      if (active) { ctx.fillStyle = 'rgba(214,178,110,0.10)'; ctx.fillRect(x0 + 10, y, w - 20, 94); ctx.fillStyle = '#d6b26e'; ctx.fillRect(x0 + 10, y, 3, 94); }
      text(p.name, cx, y + 24, `600 13px ${SANS}`, active ? '#f1e9db' : '#a59d90');
      text(String(p.score), cx, y + 76, `500 52px ${SERIF}`, active ? '#f1e9db' : '#8d857a');
      const avg = p.darts ? (p.pts / p.darts * 3).toFixed(1) : '—';
      text(`avg ${avg}`, cx + w - 44, y + 24, `400 11px ${SANS}`, '#a59d90', 'right');
      if (lastVisit[i]) text(lastVisit[i], cx + w - 44, y + 76, `400 11px ${SANS}`, '#8d857a', 'right');
    });
    // checkout hint
    const p = players[turn];
    const left = 3 - visit.length;
    if (game === '501' && p.score <= 170 && left > 0) {
      const r = route(p.score, left);
      text('CHECKOUT', cx, 310, `600 10px ${SANS}`, '#d6b26e');
      text(r ? r.path.join('  ·  ') : 'no out in ' + left, cx, 336, `italic 500 19px ${SERIF}`, r ? '#f1e9db' : '#8d857a');
    }
    drawVisit(cx, 372);
  }
  function drawVisit(cx, y) {
    text('THIS VISIT', cx, y, `600 10px ${SANS}`, '#d6b26e');
    for (let k = 0; k < 3; k++) {
      const v = visit[k];
      const bx = cx + k * 64;
      ctx.strokeStyle = 'rgba(214,178,110,0.35)'; ctx.strokeRect(bx + 0.5, y + 10.5, 56, 40);
      text(v ? v.label : '', bx + 28, y + 37, `500 17px ${SERIF}`, v && v.v === 0 ? '#8d857a' : '#f1e9db', 'center');
    }
    const tot = visit.reduce((a, h) => a + h.v, 0);
    text(`Total ${tot}`, cx, y + 76, `400 13px ${SANS}`, '#a59d90');
    if (game === '501') text(turn === 0 ? 'Your throw' : 'The House is throwing…', cx, y + 104, `italic 400 15px ${SERIF}`, turn === 0 ? '#d6b26e' : '#9fb8c8');
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake) * 0.4, rnd(-shake, shake) * 0.4);
    ctx.drawImage(room, 0, 0);
    ctx.drawImage(board, 0, 0);
    if (game === 'atc') highlightNumber(atcTarget > 20 ? 25 : atcTarget);
    for (const d of stuck) drawDart(d.x, d.y, d.col, d.ang, 1, d.wob);
    // reticle
    if (phase === 'aim' || phase === 'charge' || phase === 'cpu') {
      const [rx, ry] = toPx(reticle[0], reticle[1]);
      const col = phase === 'cpu' ? '#9fb8c8' : '#ffd98a';
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(rx, ry, 9, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx - 15, ry); ctx.lineTo(rx - 5, ry); ctx.moveTo(rx + 5, ry); ctx.lineTo(rx + 15, ry); ctx.moveTo(rx, ry - 15); ctx.lineTo(rx, ry - 5); ctx.moveTo(rx, ry + 5); ctx.lineTo(rx, ry + 15); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col; ctx.fillRect(rx - 1, ry - 1, 2, 2);
      if (phase !== 'cpu') { const [ax, ay] = toPx(aim[0], aim[1]); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(ax, ay, 2, 0, TAU); ctx.fill(); }
    }
    // power meter
    if (game === '501' || game === 'atc') {
      const mx = 524, my = 120, mh = 300;
      ctx.fillStyle = 'rgba(10,8,6,0.85)'; ctx.fillRect(mx - 9, my - 4, 18, mh + 8);
      ctx.strokeStyle = 'rgba(214,178,110,0.5)'; ctx.strokeRect(mx - 9.5, my - 4.5, 19, mh + 9);
      const band = (lo, hi, c) => { ctx.fillStyle = c; ctx.fillRect(mx - 6, my + mh * (1 - hi), 12, mh * (hi - lo)); };
      band(0.62, 0.82, 'rgba(214,178,110,0.25)'); band(0.67, 0.77, 'rgba(214,178,110,0.6)');
      if (phase === 'charge') {
        const y = my + mh * (1 - charge);
        const g = ctx.createLinearGradient(0, my + mh, 0, my); g.addColorStop(0, '#5d3a1e'); g.addColorStop(0.72, '#ffd98a'); g.addColorStop(1, '#ff6b6b');
        ctx.fillStyle = g; ctx.fillRect(mx - 4, y, 8, my + mh - y);
        ctx.fillStyle = '#fff'; ctx.fillRect(mx - 11, y - 1, 22, 2);
      }
      text('POWER', mx, my + mh + 24, `600 9px ${SANS}`, '#a59d90', 'center');
    }
    if (flying) {
      const k = clamp(flying.t / flying.dur, 0, 1), e = 1 - (1 - k) * (1 - k);
      const x = flying.sx + (flying.px - flying.sx) * e, y = flying.sy + (flying.py - flying.sy) * e - Math.sin(k * Math.PI) * 40;
      drawDart(x, y, players[turn].col, 0, 2.6 - 1.6 * e, 0);
    }
    drawPanel();
    if (banner) {
      const a = clamp(Math.min(banner.t * 3, (banner.max - banner.t) * 5), 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(8,6,4,0.78)'; ctx.fillRect(BX - 230, BY - 52, 460, 96);
      ctx.strokeStyle = 'rgba(214,178,110,0.6)'; ctx.strokeRect(BX - 229.5, BY - 51.5, 459, 95);
      const size = banner.text.length > 16 ? 26 : 38;
      text(banner.text, BX, BY + 2, `500 ${size}px ${SERIF}`, banner.col, 'center');
      if (banner.sub) text(banner.sub, BX, BY + 30, `400 13px ${SANS}`, '#cfc5b4', 'center');
      ctx.globalAlpha = 1;
    }
    if (game === 'menu') {
      ctx.fillStyle = 'rgba(8,6,4,0.82)'; ctx.fillRect(BX - 150, BY - 44, 300, 88);
      ctx.strokeStyle = 'rgba(214,178,110,0.6)'; ctx.strokeRect(BX - 149.5, BY - 43.5, 299, 87);
      text('Step up to the oche', BX, BY - 2, `italic 500 24px ${SERIF}`, '#f1e9db', 'center');
      text('PLAY 501  ·  AROUND THE CLOCK', BX, BY + 24, `600 10px ${SANS}`, '#d6b26e', 'center');
    }
    ctx.restore();
  }

  // ---------- input ----------
  const keys = new Set();
  const USED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']);
  function beginCharge() { if (phase === 'aim') { phase = 'charge'; chargeT = 0; charge = 0; } }
  function onKey(e) {
    if (!USED.has(e.code)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keydown') { if (!e.repeat && e.code === 'Space') beginCharge(); keys.add(e.code); }
    else { keys.delete(e.code); if (e.code === 'Space') release(); }
  }
  const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  function setAim(e) { const [x, y] = toCanvas(e); const [mx, my] = toMm(x, y); aim = [clamp(mx, -R.edge, R.edge), clamp(my, -R.edge, R.edge)]; }
  let ptrId = null;
  function onDown(e) {
    e.preventDefault();
    if (phase !== 'aim') return;
    setAim(e); ptrId = e.pointerId; beginCharge();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onMove(e) { if (phase === 'aim' || (phase === 'charge' && e.pointerId === ptrId)) setAim(e); }
  function onUp(e) { if (e.pointerId === ptrId) { ptrId = null; release(); } }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  const b501 = card.querySelector('#dt501'), bAtc = card.querySelector('#dtAtc');
  b501.addEventListener('click', () => {
    b501.blur();
    if (game === '501' && stake > 0) api.toast('New leg: previous stake forfeited');
    start501();
  });
  bAtc.addEventListener('click', () => { bAtc.blur(); startAtc(); });

  // ---------- loop ----------
  let raf = 0, last = performance.now(), alive = true;
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    update(dt);
    render();
    api.mirror(cv);
  }
  raf = requestAnimationFrame(frame);

  cv._dbg = () => ({ game, phase, turn, scores: players.map((p) => p.score), visit: visit.map((v) => v.label), atcTarget, atcDarts, stake, legDarts, charge: +charge.toFixed(2) });
  cv._dbgRoute = (s, d) => { const r = route(s, d); return r && r.path; };
  cv._dbgScore = (x, y) => scoreAt(x, y);
  cv._dbgBoardPx = (label) => toPx(...targetPoint(label));
  cv._dbgSet = (s) => { if (players[0]) players[0].score = s; turnStart = s; };

  api.onClose(() => {
    alive = false; cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    cv.removeEventListener('pointerdown', onDown);
    cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerup', onUp);
    cv.removeEventListener('pointercancel', onUp);
  });
}
