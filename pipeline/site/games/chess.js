// Chess vs the computer. Own 0x88 move generator (full rules) + alpha-beta search with piece-square tables.
// Contract: export default function start(api, opts). See README.md in this folder.

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14], B_OFF = [17, 15, -17, -15], R_OFF = [16, -16, 1, -1], K_OFF = [17, 15, -17, -15, 16, -16, 1, -1];
const VAL = [0, 100, 320, 330, 500, 900, 0];
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14; CASTLE_MASK[4] = 12; CASTLE_MASK[112] = 7; CASTLE_MASK[119] = 11; CASTLE_MASK[116] = 3;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const mFrom = (m) => m & 127, mTo = (m) => (m >> 7) & 127, mPromo = (m) => (m >> 14) & 7, mFlags = (m) => m >> 17;
const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);

// Piece-square tables (white's view, index 0 = a8 .. 63 = h1). Simplified evaluation function values.
const PST = {
  [P]: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [N]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [B]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [R]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [Q]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [K]: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const K_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const PHASE_W = [0, 0, 1, 1, 2, 4, 0];

export class Position {
  constructor(fen = START_FEN) { this.b = new Int8Array(128); this.k = [4, 116]; this.stack = []; this.load(fen); }
  load(fen) {
    const [pl, side, cas, ep, half, full] = fen.split(/\s+/);
    this.b.fill(0); this.stack = [];
    let r = 7, f = 0;
    for (const ch of pl) {
      if (ch === '/') { r--; f = 0; continue; }
      if (/\d/.test(ch)) { f += +ch; continue; }
      const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
      const color = ch === ch.toLowerCase() ? 8 : 0;
      const sq = r * 16 + f;
      this.b[sq] = t | color;
      if (t === K) this.k[color >> 3] = sq;
      f++;
    }
    this.side = side === 'b' ? 8 : 0;
    this.castle = (cas.includes('K') ? 1 : 0) | (cas.includes('Q') ? 2 : 0) | (cas.includes('k') ? 4 : 0) | (cas.includes('q') ? 8 : 0);
    this.ep = ep && ep !== '-' ? (ep.charCodeAt(0) - 97) + (+ep[1] - 1) * 16 : -1;
    this.half = +(half || 0); this.full = +(full || 1);
  }
  fen(clocks = true) {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 16 + f];
        if (!p) { e++; continue; }
        if (e) { s += e; e = 0; }
        const ch = ' pnbrqk'[p & 7]; s += p & 8 ? ch : ch.toUpperCase();
      }
      if (e) s += e;
      if (r) s += '/';
    }
    const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    s += ` ${this.side ? 'b' : 'w'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'}`;
    return clocks ? `${s} ${this.half} ${this.full}` : s;
  }
  attacked(sq, by) {
    const b = this.b;
    if (by === 0) {
      if (!((sq - 15) & 0x88) && b[sq - 15] === P) return true;
      if (!((sq - 17) & 0x88) && b[sq - 17] === P) return true;
    } else {
      if (!((sq + 15) & 0x88) && b[sq + 15] === (P | 8)) return true;
      if (!((sq + 17) & 0x88) && b[sq + 17] === (P | 8)) return true;
    }
    for (const o of N_OFF) { const s = sq + o; if (!(s & 0x88) && b[s] === (N | by)) return true; }
    for (const o of K_OFF) { const s = sq + o; if (!(s & 0x88) && b[s] === (K | by)) return true; }
    for (const o of B_OFF) {
      let s = sq + o;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (B | by) || p === (Q | by)) return true; break; } s += o; }
    }
    for (const o of R_OFF) {
      let s = sq + o;
      while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (R | by) || p === (Q | by)) return true; break; } s += o; }
    }
    return false;
  }
  inCheck() { return this.attacked(this.k[this.side >> 3], this.side ^ 8); }
  gen(out, caps = false) {
    const b = this.b, us = this.side, them = us ^ 8;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p || (p & 8) !== us) continue;
      const t = p & 7;
      if (t === P) {
        const d = us ? -16 : 16, r = sq >> 4, start = us ? 6 : 1, last = us ? 1 : 6;
        const to = sq + d;
        if (!(to & 0x88) && !b[to]) {
          if (r === last) { out.push(sq | to << 7 | Q << 14, sq | to << 7 | R << 14, sq | to << 7 | B << 14, sq | to << 7 | N << 14); }
          else if (!caps) { out.push(sq | to << 7); if (r === start && !b[to + d]) out.push(sq | (to + d) << 7 | F_DOUBLE << 17); }
        }
        for (let i = 0; i < 2; i++) {
          const c = sq + d + (i ? 1 : -1);
          if (c & 0x88) continue;
          const q = b[c];
          if (q && (q & 8) === them) {
            if (r === last) { for (const pr of [Q, R, B, N]) out.push(sq | c << 7 | pr << 14 | F_CAP << 17); }
            else out.push(sq | c << 7 | F_CAP << 17);
          } else if (c === this.ep && !q) out.push(sq | c << 7 | (F_CAP | F_EP) << 17);
        }
      } else if (t === N || t === K) {
        const offs = t === N ? N_OFF : K_OFF;
        for (const o of offs) {
          const to = sq + o; if (to & 0x88) continue;
          const q = b[to];
          if (!q) { if (!caps) out.push(sq | to << 7); } else if ((q & 8) === them) out.push(sq | to << 7 | F_CAP << 17);
        }
      } else {
        const offs = t === B ? B_OFF : t === R ? R_OFF : K_OFF;
        for (const o of offs) {
          let to = sq + o;
          while (!(to & 0x88)) {
            const q = b[to];
            if (!q) { if (!caps) out.push(sq | to << 7); } else { if ((q & 8) === them) out.push(sq | to << 7 | F_CAP << 17); break; }
            to += o;
          }
        }
      }
    }
    if (!caps) {
      if (us === 0) {
        if ((this.castle & 1) && !b[5] && !b[6] && b[7] === R && b[4] === K && !this.attacked(4, 8) && !this.attacked(5, 8) && !this.attacked(6, 8)) out.push(4 | 6 << 7 | F_CASTLE << 17);
        if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === R && b[4] === K && !this.attacked(4, 8) && !this.attacked(3, 8) && !this.attacked(2, 8)) out.push(4 | 2 << 7 | F_CASTLE << 17);
      } else {
        if ((this.castle & 4) && !b[117] && !b[118] && b[119] === (R | 8) && b[116] === (K | 8) && !this.attacked(116, 0) && !this.attacked(117, 0) && !this.attacked(118, 0)) out.push(116 | 118 << 7 | F_CASTLE << 17);
        if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (R | 8) && b[116] === (K | 8) && !this.attacked(116, 0) && !this.attacked(115, 0) && !this.attacked(114, 0)) out.push(116 | 114 << 7 | F_CASTLE << 17);
      }
    }
    return out;
  }
  make(m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    const p = b[from]; let cap = b[to];
    if (fl & F_EP) { const cs = to + (this.side ? 16 : -16); cap = b[cs]; b[cs] = 0; }
    this.stack.push([m, cap, this.castle, this.ep, this.half]);
    b[to] = pr ? (pr | this.side) : p; b[from] = 0;
    if (fl & F_CASTLE) {
      if (to === 6) { b[5] = b[7]; b[7] = 0; } else if (to === 2) { b[3] = b[0]; b[0] = 0; } else if (to === 118) { b[117] = b[119]; b[119] = 0; } else { b[115] = b[112]; b[112] = 0; }
    }
    if ((p & 7) === K) this.k[this.side >> 3] = to;
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = fl & F_DOUBLE ? (from + to) >> 1 : -1;
    this.half = ((p & 7) === P || cap) ? 0 : this.half + 1;
    if (this.side) this.full++;
    this.side ^= 8;
  }
  unmake() {
    const [m, cap, castle, ep, half] = this.stack.pop();
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    this.side ^= 8;
    if (this.side) this.full--;
    const p = pr ? (P | this.side) : b[to];
    b[from] = p;
    if (fl & F_EP) { b[to] = 0; b[to + (this.side ? 16 : -16)] = cap; } else b[to] = cap;
    if (fl & F_CASTLE) {
      if (to === 6) { b[7] = b[5]; b[5] = 0; } else if (to === 2) { b[0] = b[3]; b[3] = 0; } else if (to === 118) { b[119] = b[117]; b[117] = 0; } else { b[112] = b[115]; b[115] = 0; }
    }
    if ((p & 7) === K) this.k[this.side >> 3] = from;
    this.castle = castle; this.ep = ep; this.half = half;
  }
  // make + check legality; returns false (and undoes) if the mover is left in check
  tryMake(m) {
    const mover = this.side;
    this.make(m);
    if (this.attacked(this.k[mover >> 3], this.side)) { this.unmake(); return false; }
    return true;
  }
  legal() {
    const out = [];
    for (const m of this.gen([], false)) if (this.tryMake(m)) { this.unmake(); out.push(m); }
    return out;
  }
  perft(d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of this.gen([], false)) { if (this.tryMake(m)) { n += d === 1 ? 1 : this.perft(d - 1); this.unmake(); } }
    return n;
  }
  evaluate() { // centipawns from side-to-move's view
    const b = this.b; let s = 0, phase = 0; let kw = 0, kb = 0; const bish = [0, 0];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq]; if (!p) continue;
      const t = p & 7, black = p & 8, r = sq >> 4, f = sq & 7;
      const idx = black ? r * 8 + f : (7 - r) * 8 + f;
      phase += PHASE_W[t];
      if (t === K) { if (black) kb = idx; else kw = idx; continue; }
      if (t === B) bish[black >> 3]++;
      const v = VAL[t] + PST[t][idx];
      s += black ? -v : v;
    }
    const ph = Math.min(24, phase);
    s += Math.round((PST[K][kw] * ph + K_END[kw] * (24 - ph)) / 24) - Math.round((PST[K][kb] * ph + K_END[kb] * (24 - ph)) / 24);
    if (bish[0] >= 2) s += 30; if (bish[1] >= 2) s -= 30;
    return this.side ? -s : s;
  }
  san(m, legal = this.legal()) {
    const from = mFrom(m), to = mTo(m), pr = mPromo(m), fl = mFlags(m), p = this.b[from], t = p & 7;
    let s;
    if (fl & F_CASTLE) s = (to & 7) === 6 ? 'O-O' : 'O-O-O';
    else {
      const cap = fl & F_CAP;
      if (t === P) s = (cap ? 'abcdefgh'[from & 7] + 'x' : '') + sqName(to) + (pr ? '=' + ' PNBRQK'[pr] : '');
      else {
        const others = legal.filter((o) => o !== m && mTo(o) === to && this.b[mFrom(o)] === p);
        let dis = '';
        if (others.length) {
          if (!others.some((o) => (mFrom(o) & 7) === (from & 7))) dis = 'abcdefgh'[from & 7];
          else if (!others.some((o) => (mFrom(o) >> 4) === (from >> 4))) dis = String((from >> 4) + 1);
          else dis = sqName(from);
        }
        s = ' PNBRQK'[t] + dis + (cap ? 'x' : '') + sqName(to);
      }
    }
    this.make(m);
    if (this.inCheck()) s += this.legal().length ? '+' : '#';
    this.unmake();
    return s;
  }
}

// ---------- search ----------
const MATE = 100000, INF = 1e9;
export function makeSearcher(pos) {
  let nodes = 0, deadline = 0, abort = false, rootBest = 0;
  const killers = []; const hist = new Int32Array(128 * 128);
  const now = () => performance.now();
  function score(m, k0, k1, first) {
    if (m === first) return 1e7;
    const fl = mFlags(m);
    if (fl & F_CAP) { const v = fl & F_EP ? P : pos.b[mTo(m)] & 7; return 1e6 + VAL[v] * 10 - VAL[pos.b[mFrom(m)] & 7] / 10 + (mPromo(m) ? 9000 : 0); }
    if (mPromo(m)) return 9e5 + VAL[mPromo(m)];
    if (m === k0) return 8e5; if (m === k1) return 7e5;
    return hist[mFrom(m) * 128 + mTo(m)];
  }
  function order(moves, ply, first) {
    const k = killers[ply] || [0, 0];
    const sc = moves.map((m) => score(m, k[0], k[1], first));
    const idx = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
    return idx.map((i) => moves[i]);
  }
  function qs(alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && now() > deadline) abort = true;
    if (abort) return 0;
    const stand = pos.evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 40) return stand;
    const moves = order(pos.gen([], true), ply, 0);
    for (const m of moves) {
      if (!pos.tryMake(m)) continue;
      const s = -qs(-beta, -alpha, ply + 1);
      pos.unmake();
      if (abort) return 0;
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
  function negamax(depth, alpha, beta, ply, first = 0) {
    if ((++nodes & 1023) === 0 && now() > deadline) abort = true;
    if (abort) return 0;
    const chk = pos.inCheck();
    if (chk && ply < 16) depth++;
    if (depth <= 0) return qs(alpha, beta, ply);
    if (ply > 0 && pos.half >= 100) return 0;
    const moves = order(pos.gen([], false), ply, first);
    let legal = 0, best = -INF;
    for (const m of moves) {
      if (!pos.tryMake(m)) continue;
      legal++;
      const s = -negamax(depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      if (abort) return 0;
      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s; if (ply === 0) rootBest = m;
          if (s >= beta) {
            if (!(mFlags(m) & F_CAP)) { const k = killers[ply] || (killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } hist[mFrom(m) * 128 + mTo(m)] += depth * depth; }
            break;
          }
        }
      }
    }
    if (!legal) return chk ? -MATE + ply : 0;
    return best;
  }
  // Iterative deepening, one depth per macrotask so the page can repaint between iterations.
  return function think({ maxDepth, timeMs, noise = 0 }, done) {
    deadline = now() + timeMs; abort = false; nodes = 0;
    let best = 0, bestScore = 0, reached = 0, depth = 1;
    const legal = pos.legal();
    if (!legal.length) return done({ move: 0 });
    if (noise > 0) { // weak play: shallow full-window score per move plus noise
      const sc = legal.map((m) => { pos.make(m); const s = -negamax(maxDepth - 1, -INF, INF, 1); pos.unmake(); return s + (Math.random() * 2 - 1) * noise; });
      let bi = 0; sc.forEach((s, i) => { if (s > sc[bi]) bi = i; });
      return setTimeout(() => done({ move: legal[bi], score: Math.round(sc[bi]), depth: maxDepth, nodes }), 0);
    }
    for (let i = legal.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [legal[i], legal[j]] = [legal[j], legal[i]]; }
    best = legal[0];
    const step = () => {
      rootBest = 0;
      const s = negamax(depth, -INF, INF, 0, best);
      if (!abort && rootBest) { best = rootBest; bestScore = s; reached = depth; }
      if (abort || depth >= maxDepth || Math.abs(s) > MATE - 200 || now() > deadline - timeMs * 0.45) {
        return done({ move: best, score: bestScore, depth: reached, nodes });
      }
      depth++;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };
}

const GLYPH = { [K]: '♚', [Q]: '♛', [R]: '♜', [B]: '♝', [N]: '♞', [P]: '♟' };
const LEVELS = {
  easy: { label: 'Easy', maxDepth: 1, timeMs: 600, noise: 130, prize: 200 },
  medium: { label: 'Medium', maxDepth: 3, timeMs: 1000, noise: 0, prize: 500 },
  hard: { label: 'Hard', maxDepth: 12, timeMs: 1250, noise: 0, prize: 1000 },
};

export default function start(api) {
  const W = 900, H = 600, BX = 20, BY = 20, SQ = 70;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const card = api.open(`
<style>
.ch-sel{background:#0b0a09;color:#f1e9db;border:1px solid rgba(214,178,110,.35);padding:8px 10px;font:600 13px Manrope,Arial,sans-serif}
.ch-bar{justify-content:space-between}
.ch-note{font-size:11px;color:#a59d90;letter-spacing:.04em}
</style>
<div class="eyebrow">Card Room · Chess</div><h2>The <em>Grandmaster</em></h2>
<canvas class="game" width="${W}" height="${H}"></canvas>
<div class="result" id="chStatus">Choose a side and difficulty, then start.</div>
<div class="row">
  <select class="ch-sel" id="chColor"><option value="w">Play White</option><option value="b">Play Black</option><option value="r">Random side</option></select>
  <select class="ch-sel" id="chLevel"><option value="easy">Easy · wins 200</option><option value="medium" selected>Medium · wins 500</option><option value="hard">Hard · wins 1,000</option></select>
  <button class="primary" id="chNew">New game</button>
  <button id="chFlip">Flip board</button>
  <button id="chResign">Resign</button>
</div>
<div class="row ch-bar"><span class="ch-note">Click or drag to move · F flips the board</span><button data-close>Leave</button></div>`, { wide: true });

  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const $ = (id) => card.querySelector('#' + id);
  const elStatus = $('chStatus');
  let closed = false, raf = 0, lastMirror = 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms); timers.add(id); };

  const G = {
    pos: new Position(), searcher: null, human: 0, flipped: false, level: 'medium', started: false, over: null, thinking: false, gameId: 0,
    sel: -1, legal: [], drag: null, last: null, sans: [], keys: [], promo: null, anim: null, info: '', awarded: false,
  };
  G.searcher = makeSearcher(G.pos);
  cv.__chess = G; // debug/test hook
  const setStatus = (t) => { elStatus.textContent = t; };
  const posKey = () => G.pos.fen(false);

  function newGame() {
    G.gameId++; G.thinking = false;
    const c = $('chColor').value; G.level = $('chLevel').value;
    G.human = c === 'r' ? (Math.random() < 0.5 ? 0 : 8) : c === 'b' ? 8 : 0;
    G.flipped = G.human === 8;
    G.pos.load(START_FEN);
    G.legal = G.pos.legal(); G.sel = -1; G.drag = null; G.last = null; G.sans = []; G.keys = [posKey()]; G.promo = null; G.anim = null; G.over = null; G.info = ''; G.awarded = false;
    G.started = true;
    $('chResign').disabled = false;
    if (G.pos.side !== G.human) aiMove(); else setStatus(`You play ${G.human ? 'Black' : 'White'} against the ${LEVELS[G.level].label} computer. Your move.`);
  }
  function material(color) { let s = 0; for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) continue; const p = G.pos.b[sq]; if (p && (p & 8) === color) s += VAL[p & 7]; } return s; }
  function checkEnd() {
    const pos = G.pos;
    if (!G.legal.length) {
      if (pos.inCheck()) G.over = { winner: pos.side ^ 8, reason: 'checkmate' };
      else G.over = { winner: -1, reason: 'stalemate' };
    } else if (pos.half >= 100) G.over = { winner: -1, reason: 'the 50-move rule' };
    else if (G.keys.filter((k) => k === G.keys[G.keys.length - 1]).length >= 3) G.over = { winner: -1, reason: 'threefold repetition' };
    else {
      const minors = []; let other = false;
      for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) continue; const t = pos.b[sq] & 7; if (!t || t === K) continue; if (t === N || t === B) minors.push(t); else other = true; }
      if (!other && minors.length <= 1) G.over = { winner: -1, reason: 'insufficient material' };
    }
    if (G.over) finish();
    return !!G.over;
  }
  function finish() {
    const o = G.over; const lv = LEVELS[G.level];
    $('chResign').disabled = true;
    if (o.winner === G.human) {
      setStatus(`Checkmate! You beat the ${lv.label} computer and win ${fmt(lv.prize)} chips.`);
      if (!G.awarded) {
        G.awarded = true;
        api.addChips(lv.prize);
        api.toast(`Chess: you won ${fmt(lv.prize)} chips.`);
        api.broadcast(`checkmated the ${lv.label} chess computer and won ${fmt(lv.prize)} chips`);
      }
    } else if (o.winner === -1) setStatus(`Draw by ${o.reason}.`);
    else setStatus(o.reason === 'resignation' ? 'You resigned. The computer takes this one.' : 'Checkmate. The computer wins this one.');
  }
  function doMove(m) {
    const pos = G.pos; const from = mFrom(m), to = mTo(m);
    const san = pos.san(m, G.legal);
    G.anim = { piece: mPromo(m) ? (P | pos.side) : pos.b[from], from, to, t0: performance.now(), rook: mFlags(m) & F_CASTLE ? castleRook(to) : null };
    pos.make(m);
    G.sans.push(san); G.keys.push(posKey()); G.last = { from, to };
    G.legal = pos.legal(); G.sel = -1; G.promo = null;
    if (checkEnd()) return;
    if (pos.side !== G.human) aiMove();
    else setStatus(pos.inCheck() ? 'Check! Your move.' : 'Your move.');
  }
  function castleRook(to) { return to === 6 ? [7, 5] : to === 2 ? [0, 3] : to === 118 ? [119, 117] : [112, 115]; }
  function aiMove() {
    const id = G.gameId; G.thinking = true;
    setStatus('The computer is thinking…');
    const lv = LEVELS[G.level];
    later(() => {
      if (id !== G.gameId) return;
      const t0 = performance.now();
      G.searcher({ maxDepth: lv.maxDepth, timeMs: lv.timeMs, noise: lv.noise }, (res) => {
        if (closed || id !== G.gameId) return;
        const wait = Math.max(0, 350 - (performance.now() - t0)); // never reply instantly
        later(() => {
          if (id !== G.gameId) return;
          G.thinking = false;
          const sc = res.score || 0;
          G.info = res.depth ? `depth ${res.depth} · ${fmt(res.nodes || 0)} nodes · eval ${Math.abs(sc) > MATE - 200 ? (sc > 0 ? 'mate' : '-mate') : (sc > 0 ? '+' : '') + (sc / 100).toFixed(2)}` : '';
          if (res.move) doMove(res.move);
        }, wait);
      });
    }, 120);
  }

  // ---------- input ----------
  const sqToXY = (sq) => { const f = sq & 7, r = sq >> 4; const c = G.flipped ? 7 - f : f, row = G.flipped ? r : 7 - r; return [BX + c * SQ, BY + row * SQ]; };
  const xyToSq = (x, y) => { const c = Math.floor((x - BX) / SQ), row = Math.floor((y - BY) / SQ); if (c < 0 || c > 7 || row < 0 || row > 7) return -1; const f = G.flipped ? 7 - c : c, r = G.flipped ? row : 7 - row; return r * 16 + f; };
  const canvasXY = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  const myTurn = () => G.started && !G.over && !G.thinking && G.pos.side === G.human;
  const movesFrom = (sq) => G.legal.filter((m) => mFrom(m) === sq);
  function promoSquares() { // the picker column on the target file, running toward the board centre
    const [x, y] = sqToXY(G.promo.to); const down = y === BY;
    return [Q, R, B, N].map((t, i) => ({ t, x, y: down ? y + i * SQ : y - i * SQ }));
  }
  function tryMove(from, to) {
    const ms = G.legal.filter((m) => mFrom(m) === from && mTo(m) === to);
    if (!ms.length) return false;
    if (ms.length > 1) { G.promo = { from, to, moves: ms }; G.sel = from; return true; }
    doMove(ms[0]); return true;
  }
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = canvasXY(e);
    if (G.promo) {
      const hit = promoSquares().find((s) => x >= s.x && x < s.x + SQ && y >= s.y && y < s.y + SQ);
      if (hit) doMove(G.promo.moves.find((m) => mPromo(m) === hit.t)); else { G.promo = null; G.sel = -1; }
      e.preventDefault(); return;
    }
    if (!myTurn()) return;
    const sq = xyToSq(x, y); if (sq < 0) return;
    const p = G.pos.b[sq];
    if (G.sel >= 0 && sq !== G.sel && tryMove(G.sel, sq)) { e.preventDefault(); return; }
    if (p && (p & 8) === G.human) {
      G.sel = sq; G.drag = { sq, x, y, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
    } else G.sel = -1;
    e.preventDefault();
  }
  function onMove(e) {
    if (!G.drag) { const [x, y] = canvasXY(e); const sq = xyToSq(x, y); cv.style.cursor = myTurn() && sq >= 0 && G.pos.b[sq] && (G.pos.b[sq] & 8) === G.human ? 'grab' : 'default'; return; }
    const [x, y] = canvasXY(e);
    if (Math.hypot(x - G.drag.x, y - G.drag.y) > 4) G.drag.moved = true;
    G.drag.x = x; G.drag.y = y; cv.style.cursor = 'grabbing';
  }
  function onUp(e) {
    if (!G.drag) return;
    const d = G.drag; G.drag = null;
    const [x, y] = canvasXY(e);
    const sq = xyToSq(x, y);
    if (d.moved && sq >= 0 && sq !== d.sq) { if (!tryMove(d.sq, sq)) G.sel = -1; }
  }
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', () => { G.drag = null; });
  const onKey = (e) => {
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); G.flipped = !G.flipped; }
    else if (e.key === 'Escape' && (G.promo || G.sel >= 0)) { e.preventDefault(); e.stopPropagation(); G.promo = null; G.sel = -1; }
  };
  window.addEventListener('keydown', onKey, true);
  $('chNew').onclick = newGame;
  $('chFlip').onclick = () => { G.flipped = !G.flipped; };
  $('chResign').onclick = () => {
    if (!G.started || G.over) return;
    G.gameId++; G.thinking = false; G.over = { winner: G.human ^ 8, reason: 'resignation' }; finish();
  };
  $('chResign').disabled = true;

  // ---------- drawing ----------
  const PIECE_FONT = '"DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", "Arial Unicode MS", serif';
  function drawPiece(p, cx, cy, size, alpha = 1) {
    const t = p & 7, black = p & 8;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.font = `${size}px ${PIECE_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = GLYPH[t] + '︎';
    const yy = cy + size * 0.04;
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = size * 0.08; ctx.shadowOffsetY = size * 0.04;
    ctx.lineJoin = 'round';
    if (black) {
      ctx.lineWidth = size * 0.07; ctx.strokeStyle = '#d6b26e'; ctx.strokeText(g, cx, yy); ctx.shadowColor = 'transparent';
      const gr = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2); gr.addColorStop(0, '#3a332c'); gr.addColorStop(1, '#0d0b09');
      ctx.fillStyle = gr; ctx.fillText(g, cx, yy);
    } else {
      ctx.lineWidth = size * 0.08; ctx.strokeStyle = '#1b140c'; ctx.strokeText(g, cx, yy); ctx.shadowColor = 'transparent';
      const gr = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e6d8bb');
      ctx.fillStyle = gr; ctx.fillText(g, cx, yy);
    }
    ctx.restore();
  }
  function draw() {
    const now = performance.now();
    const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#120f0b'); bg.addColorStop(1, '#050506');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // board frame
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 24; ctx.fillStyle = '#2a1a0f'; ctx.fillRect(BX - 10, BY - 10, SQ * 8 + 20, SQ * 8 + 20); ctx.restore();
    ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 1.5; ctx.strokeRect(BX - 6, BY - 6, SQ * 8 + 12, SQ * 8 + 12);
    const pos = G.pos;
    const anim = G.anim && now - G.anim.t0 < 180 ? G.anim : null;
    const chkSq = G.started && pos.inCheck() ? pos.k[pos.side >> 3] : -1;
    const selMoves = G.sel >= 0 ? movesFrom(G.sel) : [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f; const [x, y] = sqToXY(sq);
      const light = (r + f) % 2 === 1;
      ctx.fillStyle = light ? '#ead9b8' : '#8b6744'; ctx.fillRect(x, y, SQ, SQ);
      if (G.last && (sq === G.last.from || sq === G.last.to)) { ctx.fillStyle = 'rgba(214,178,110,.55)'; ctx.fillRect(x, y, SQ, SQ); }
      if (sq === G.sel) { ctx.fillStyle = 'rgba(61,224,255,.35)'; ctx.fillRect(x, y, SQ, SQ); }
      if (sq === chkSq) {
        const g = ctx.createRadialGradient(x + SQ / 2, y + SQ / 2, 4, x + SQ / 2, y + SQ / 2, SQ * 0.62);
        g.addColorStop(0, 'rgba(255,40,70,.95)'); g.addColorStop(1, 'rgba(255,40,70,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, SQ, SQ);
      }
      // coordinates
      ctx.font = '700 11px Manrope, Arial, sans-serif'; ctx.fillStyle = light ? '#8b6744' : '#ead9b8';
      const c = G.flipped ? 7 - f : f, row = G.flipped ? r : 7 - r;
      if (row === 7) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('abcdefgh'[f], x + SQ - 4, y + SQ - 2); }
      if (c === 0) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(String(r + 1), x + 4, y + 3); }
    }
    // legal targets
    for (const m of selMoves) {
      const [x, y] = sqToXY(mTo(m));
      if (mFlags(m) & F_CAP) { ctx.beginPath(); ctx.arc(x + SQ / 2, y + SQ / 2, SQ * 0.45, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(20,14,8,.45)'; ctx.lineWidth = 6; ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(x + SQ / 2, y + SQ / 2, SQ * 0.14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,14,8,.35)'; ctx.fill(); }
    }
    // pieces
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f; const p = pos.b[sq]; if (!p) continue;
      if (G.drag && G.drag.moved && sq === G.drag.sq) continue;
      if (anim && (sq === anim.to || (anim.rook && sq === anim.rook[1]))) continue;
      const [x, y] = sqToXY(sq);
      drawPiece(p, x + SQ / 2, y + SQ / 2, SQ * 0.82);
    }
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / 180), e = 1 - Math.pow(1 - t, 3);
      const [x0, y0] = sqToXY(anim.from), [x1, y1] = sqToXY(anim.to);
      drawPiece(t > 0.5 ? pos.b[anim.to] : anim.piece, x0 + (x1 - x0) * e + SQ / 2, y0 + (y1 - y0) * e + SQ / 2, SQ * 0.82);
      if (anim.rook) { const [a, b] = anim.rook; const [rx0, ry0] = sqToXY(a), [rx1, ry1] = sqToXY(b); drawPiece(pos.b[b], rx0 + (rx1 - rx0) * e + SQ / 2, ry0 + (ry1 - ry0) * e + SQ / 2, SQ * 0.82); }
    }
    if (G.drag && G.drag.moved) drawPiece(pos.b[G.drag.sq], G.drag.x, G.drag.y, SQ * 0.95);
    // promotion picker
    if (G.promo) {
      ctx.fillStyle = 'rgba(5,6,10,.55)'; ctx.fillRect(BX, BY, SQ * 8, SQ * 8);
      for (const s of promoSquares()) {
        ctx.fillStyle = '#f1e9db'; ctx.fillRect(s.x + 2, s.y + 2, SQ - 4, SQ - 4);
        ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 2; ctx.strokeRect(s.x + 2, s.y + 2, SQ - 4, SQ - 4);
        drawPiece(s.t | G.human, s.x + SQ / 2, s.y + SQ / 2, SQ * 0.78);
      }
    }
    drawSide(now);
    if (!G.started) {
      ctx.fillStyle = 'rgba(5,6,10,.6)'; ctx.fillRect(BX, BY + SQ * 3, SQ * 8, SQ * 2);
      ctx.fillStyle = '#f1e9db'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'italic 500 32px "Bodoni Moda", Georgia, serif'; ctx.fillText('Your move, sir.', BX + SQ * 4, BY + SQ * 4 - 12);
      ctx.font = '600 12px Manrope, Arial, sans-serif'; ctx.fillStyle = '#d6b26e'; ctx.fillText('Pick a side and difficulty below, then press New game', BX + SQ * 4, BY + SQ * 4 + 22);
    }
    if (now - lastMirror > 100) { lastMirror = now; try { api.mirror && api.mirror(cv); } catch (_) { /* cabinet optional */ } }
    raf = requestAnimationFrame(draw);
  }
  function capturedBy(color) { // pieces of the other colour no longer on the board
    const start = { [P]: 8, [N]: 2, [B]: 2, [R]: 2, [Q]: 1 }; const have = { [P]: 0, [N]: 0, [B]: 0, [R]: 0, [Q]: 0 };
    const them = color ^ 8;
    for (let sq = 0; sq < 128; sq++) { if (sq & 0x88) continue; const p = G.pos.b[sq]; if (p && (p & 8) === them && (p & 7) !== K) have[p & 7]++; }
    const out = []; for (const t of [Q, R, B, N, P]) for (let i = have[t]; i < start[t]; i++) out.push(t | them);
    return out;
  }
  function drawSide(now) {
    const x0 = 612, w = W - x0 - 16;
    const lv = LEVELS[G.level];
    const rows = [
      { label: 'Computer', sub: `${lv.label} · ${G.human === 8 ? 'White' : 'Black'}`, color: G.human ^ 8, y: 24 },
      { label: api.playerName() || 'You', sub: `You · ${G.human === 8 ? 'Black' : 'White'}`, color: G.human, y: 506 },
    ];
    const adv = material(G.human) - material(G.human ^ 8);
    for (const rw of rows) {
      const toMove = G.started && !G.over && G.pos.side === rw.color;
      ctx.save();
      if (toMove) { ctx.shadowColor = `rgba(214,178,110,${0.5 + 0.3 * Math.sin(now / 240)})`; ctx.shadowBlur = 16; }
      ctx.fillStyle = 'rgba(16,14,12,.95)'; ctx.fillRect(x0, rw.y, w, 70); ctx.restore();
      ctx.strokeStyle = toMove ? '#d6b26e' : 'rgba(214,178,110,.3)'; ctx.lineWidth = toMove ? 1.6 : 1; ctx.strokeRect(x0 + 0.5, rw.y + 0.5, w - 1, 69);
      drawPiece(K | rw.color, x0 + 28, rw.y + 35, 38);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f1e9db'; ctx.font = '600 15px Manrope, Arial, sans-serif'; ctx.fillText(rw.label.slice(0, 18), x0 + 56, rw.y + 26);
      ctx.fillStyle = '#a59d90'; ctx.font = '600 11px Manrope, Arial, sans-serif'; ctx.fillText(rw.sub.toUpperCase(), x0 + 56, rw.y + 42);
      const caps = capturedBy(rw.color);
      caps.forEach((p, i) => drawPiece(p, x0 + 62 + i * 13, rw.y + 57, 16));
      const a = rw.color === G.human ? adv : -adv;
      if (a > 0) { ctx.fillStyle = '#56d68b'; ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.fillText(`+${Math.round(a / 100)}`, x0 + w - 10, rw.y + 26); }
      if (rw.color !== G.human && G.thinking) {
        ctx.fillStyle = '#3de0ff'; ctx.font = '600 11px Manrope, Arial, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('thinking' + '.'.repeat(1 + Math.floor(now / 300) % 3), x0 + w - 10, rw.y + 42);
      }
    }
    // move list
    const ly = 110, lh = 380;
    ctx.fillStyle = 'rgba(10,9,8,.8)'; ctx.fillRect(x0, ly, w, lh);
    ctx.strokeStyle = 'rgba(214,178,110,.2)'; ctx.strokeRect(x0 + 0.5, ly + 0.5, w - 1, lh - 1);
    ctx.fillStyle = '#d6b26e'; ctx.font = '700 9px Manrope, Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('M O V E S', x0 + 12, ly + 18);
    const pairs = []; for (let i = 0; i < G.sans.length; i += 2) pairs.push([G.sans[i], G.sans[i + 1] || '']);
    const maxRows = 15; const startRow = Math.max(0, pairs.length - maxRows);
    ctx.font = '500 13px "JetBrains Mono", ui-monospace, monospace';
    pairs.slice(startRow).forEach((pr, i) => {
      const n = startRow + i + 1, y = ly + 42 + i * 21;
      ctx.fillStyle = '#6f685d'; ctx.fillText(`${n}.`, x0 + 12, y);
      const lastIdx = G.sans.length - 1;
      ctx.fillStyle = (n - 1) * 2 === lastIdx ? '#d6b26e' : '#f1e9db'; ctx.fillText(pr[0], x0 + 52, y);
      ctx.fillStyle = (n - 1) * 2 + 1 === lastIdx ? '#d6b26e' : '#f1e9db'; ctx.fillText(pr[1], x0 + 152, y);
    });
    if (G.over) {
      const t = G.over.winner === -1 ? 'Draw' : G.over.winner === G.human ? 'You win' : 'Computer wins';
      ctx.fillStyle = 'rgba(8,7,6,.92)'; ctx.fillRect(x0 + 10, ly + lh - 84, w - 20, 72);
      ctx.strokeStyle = G.over.winner === G.human ? '#56d68b' : '#d6b26e'; ctx.strokeRect(x0 + 10.5, ly + lh - 83.5, w - 21, 71);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f1e9db'; ctx.font = '500 24px "Bodoni Moda", Georgia, serif'; ctx.fillText(t, x0 + w / 2, ly + lh - 50);
      ctx.fillStyle = '#d6b26e'; ctx.font = '600 11px Manrope, Arial, sans-serif';
      ctx.fillText(G.over.winner === G.human ? `by ${G.over.reason} · +${fmt(LEVELS[G.level].prize)} chips` : `by ${G.over.reason}`, x0 + w / 2, ly + lh - 28);
    } else if (G.info) {
      ctx.textAlign = 'left'; ctx.fillStyle = '#6f685d'; ctx.font = '500 10px "JetBrains Mono", monospace'; ctx.fillText(G.info, x0 + 12, ly + lh - 12);
    }
  }

  api.onClose(() => {
    closed = true; G.gameId++;
    timers.forEach(clearTimeout); timers.clear();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp);
  });
  raf = requestAnimationFrame(draw);
}
