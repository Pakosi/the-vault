// No-limit Texas Hold'em: you vs three computer players, played with your real vault chips.
// Contract: export default function start(api, opts). See README.md in this folder.

const RANK_CH = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_CH = ['♠', '♥', '♦', '♣']; // spade, heart, diamond, club
const RN = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const RNP = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const CAT = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

// ---------- hand evaluation (cards are ints 0..51: rank = c>>2 (0 = deuce .. 12 = ace), suit = c&3) ----------
function findStraight(cards) { // cards sorted by rank desc
  const m = new Map();
  for (const c of cards) if (!m.has(c >> 2)) m.set(c >> 2, c);
  for (let top = 12; top >= 3; top--) {
    const seq = [top, top - 1, top - 2, top - 3, top - 4].map((r) => (r < 0 ? 12 : r));
    if (seq.every((r) => m.has(r))) return { top, cards: seq.map((r) => m.get(r)) };
  }
  return null;
}
function mk(cat, ranks, best) {
  let s = 0;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return { cat, score: cat * 1048576 + s, ranks, best };
}
export function evaluate(cards) {
  const sorted = cards.slice().sort((a, b) => (b >> 2) - (a >> 2));
  const bySuit = [[], [], [], []]; const cnt = new Array(13).fill(0);
  for (const c of sorted) { bySuit[c & 3].push(c); cnt[c >> 2]++; }
  let flush = null;
  for (let s = 0; s < 4; s++) {
    if (bySuit[s].length >= 5) {
      const sf = findStraight(bySuit[s]);
      if (sf) return mk(8, [sf.top], sf.cards);
      flush = bySuit[s];
    }
  }
  let quad = -1; const trips = []; const pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (cnt[r] === 4 && quad < 0) quad = r; else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r);
  }
  const pick = (r, n) => sorted.filter((c) => (c >> 2) === r).slice(0, n);
  const kick = (excl, n) => sorted.filter((c) => !excl.includes(c >> 2)).slice(0, n);
  if (quad >= 0) { const k = kick([quad], 1); return mk(7, [quad, k[0] >> 2], [...pick(quad, 4), ...k]); }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0]; const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return mk(6, [t, p], [...pick(t, 3), ...pick(p, 2)]);
  }
  if (flush) { const f = flush.slice(0, 5); return mk(5, f.map((c) => c >> 2), f); }
  const st = findStraight(sorted);
  if (st) return mk(4, [st.top], st.cards);
  if (trips.length) { const t = trips[0]; const k = kick([t], 2); return mk(3, [t, ...k.map((c) => c >> 2)], [...pick(t, 3), ...k]); }
  if (pairs.length >= 2) { const [a, b] = pairs; const k = kick([a, b], 1); return mk(2, [a, b, k[0] >> 2], [...pick(a, 2), ...pick(b, 2), ...k]); }
  if (pairs.length) { const p = pairs[0]; const k = kick([p], 3); return mk(1, [p, ...k.map((c) => c >> 2)], [...pick(p, 2), ...k]); }
  const top = sorted.slice(0, 5);
  return mk(0, top.map((c) => c >> 2), top);
}
export function handName(ev) {
  const [a, b] = ev.ranks;
  switch (ev.cat) {
    case 0: return `${RN[a]} High`;
    case 1: return `Pair of ${RNP[a]}`;
    case 2: return `Two Pair, ${RNP[a]} & ${RNP[b]}`;
    case 3: return `Three ${RNP[a]}`;
    case 4: return `${RN[a]}-High Straight`;
    case 5: return `${RN[a]}-High Flush`;
    case 6: return `Full House, ${RNP[a]} over ${RNP[b]}`;
    case 7: return `Four ${RNP[a]}`;
    default: return a === 12 ? 'Royal Flush' : `${RN[a]}-High Straight Flush`;
  }
}
// Monte Carlo equity of `hole` against `nOpp` random hands given the board.
function equity(hole, board, nOpp, iters = 260) {
  const known = new Set([...hole, ...board]);
  const deck = []; for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  const need = 5 - board.length + nOpp * 2;
  let win = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) { const j = i + Math.floor(Math.random() * (deck.length - i)); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    const b = board.concat(deck.slice(0, 5 - board.length));
    let k = 5 - board.length;
    const mine = evaluate(hole.concat(b)).score;
    let best = 0; let ties = 0; let lost = false;
    for (let o = 0; o < nOpp; o++) {
      const s = evaluate([deck[k], deck[k + 1]].concat(b)).score; k += 2;
      if (s > mine) { lost = true; break; }
      if (s === mine) ties++;
      if (s > best) best = s;
    }
    if (!lost) win += 1 / (ties + 1);
  }
  return win / iters;
}

export default function start(api) {
  const W = 960, H = 560;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const card = api.open(`
<style>
.pk-act{justify-content:center}
.pk-act button{min-width:96px}
.pk-act button:disabled,.pk-bar button:disabled{opacity:.35;cursor:default}
.pk-raise{display:flex;align-items:center;gap:8px;flex:1;min-width:240px}
.pk-raise input[type=range]{flex:1;accent-color:#d6b26e}
.pk-amt{font-family:"JetBrains Mono",ui-monospace,monospace;color:#d6b26e;min-width:74px;text-align:right;font-size:13px}
.pk-pre button{padding:6px 9px;font-size:11px;letter-spacing:.06em}
.pk-bar{justify-content:space-between}
.pk-buy button{min-width:120px}
.pk-hide{display:none!important}
.pk-note{font-size:11px;color:#a59d90;letter-spacing:.04em}
</style>
<div class="eyebrow">Card Room · No-Limit Hold'em</div><h2>Texas <em>Hold'em</em></h2>
<canvas class="game" width="${W}" height="${H}"></canvas>
<div class="result" id="pkStatus">Choose a buy-in to take your seat.</div>
<div class="row pk-act pk-hide" id="pkAct">
  <button id="pkFold">Fold</button>
  <button id="pkCall">Check</button>
  <div class="pk-raise"><input type="range" id="pkSlider" min="0" max="100" step="1" value="0"><span class="pk-amt" id="pkAmt">0</span></div>
  <button class="primary" id="pkRaise">Raise</button>
</div>
<div class="row pk-act pk-pre pk-hide" id="pkPre">
  <button data-p="min">Min</button><button data-p="half">½ Pot</button><button data-p="3q">¾ Pot</button><button data-p="pot">Pot</button><button data-p="all">All-in</button>
  <span class="pk-note">Keys: F fold · C check/call · R bet/raise</span>
</div>
<div class="row pk-buy" id="pkBuy">
  <button class="primary" data-b="1000">Buy in 1,000</button><button class="primary" data-b="5000">Buy in 5,000</button><button class="primary" data-b="10000">Buy in 10,000</button>
</div>
<div class="row pk-bar">
  <span class="pk-note" id="pkInfo"></span>
  <span><button id="pkCash" disabled>Cash out</button> <button data-close>Leave table</button></span>
</div>`, { wide: true });

  const cv = card.querySelector('canvas.game');
  const ctx = cv.getContext('2d');
  const $ = (id) => card.querySelector('#' + id);
  const elStatus = $('pkStatus'), elAct = $('pkAct'), elPre = $('pkPre'), elBuy = $('pkBuy'), elInfo = $('pkInfo');
  const bFold = $('pkFold'), bCall = $('pkCall'), bRaise = $('pkRaise'), slider = $('pkSlider'), elAmt = $('pkAmt'), bCash = $('pkCash');

  let closed = false; let raf = 0; let lastMirror = 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  const BOTS = [
    { name: 'Vera', color: '#3de0ff', style: { tight: 0.03, aggr: 0.55, bluff: 0.09 } },
    { name: 'Marcus', color: '#ff3d7f', style: { tight: -0.02, aggr: 0.85, bluff: 0.16 } },
    { name: 'Ines', color: '#56d68b', style: { tight: 0.07, aggr: 0.3, bluff: 0.05 } },
  ];
  const me = { seat: 0, human: true, name: api.playerName() || 'You', color: api.playerColor() || '#d6b26e', stack: 0 };
  const players = [me, ...BOTS.map((b, i) => ({ seat: i + 1, human: false, name: b.name, color: b.color, style: b.style, stack: 0 }))];
  for (const p of players) Object.assign(p, { hole: [], bet: 0, total: 0, folded: true, allIn: false, acted: false, noReraise: false, lastAct: '', actAt: 0 });

  const S = {
    phase: 'buyin', seated: false, buyin: 0, sb: 5, bb: 10, dealer: Math.floor(Math.random() * 4), deck: [], board: [], street: 0,
    curBet: 0, minRaise: 0, toAct: -1, waiting: false, hand: 0, reveal: false, result: null, log: [], banner: null, dealt: new Map(), net: 0, reloads: 0,
  };
  cv.__pk = { S, players }; // debug/test hook
  const log = (text, color = '#f1e9db') => { S.log.push({ text, color }); if (S.log.length > 40) S.log.shift(); };
  const next = (i) => (i + 1) % 4;
  const live = () => players.filter((p) => !p.folded);
  const potTotal = () => players.reduce((s, p) => s + p.total, 0);
  const potCollected = () => players.reduce((s, p) => s + p.total - p.bet, 0);
  const setStatus = (t) => { elStatus.textContent = t; };

  // ---------- seating & cash ----------
  function buyIn(x) {
    if (S.seated) return;
    if (api.chips() < x) { api.toast(`You need ${fmt(x)} chips to sit at this table.`); setStatus(`Not enough chips for a ${fmt(x)} buy-in.`); return; }
    api.addChips(-x);
    S.seated = true; S.buyin = x; S.sb = x / 200; S.bb = x / 100; S.net = 0; S.reloads = 0;
    me.stack = x;
    for (const p of players) { if (!p.human) p.stack = x; p.folded = true; p.hole = []; p.bet = 0; p.total = 0; p.lastAct = ''; }
    S.board = []; S.result = null; S.banner = null; S.log = [];
    log(`${me.name} sits down with ${fmt(x)}. Blinds ${fmt(S.sb)}/${fmt(S.bb)}.`, '#d6b26e');
    S.phase = 'hand';
    updateControls();
    later(startHand, 500);
  }
  function cashOut(closing = false) {
    if (!S.seated) return;
    const amt = me.stack;
    S.seated = false; me.stack = 0;
    if (amt > 0) api.addChips(amt);
    if (closing) return;
    clearTimers();
    for (const p of players) { p.folded = true; p.bet = 0; p.total = 0; }
    const diff = amt - S.buyin;
    log(`${me.name} cashes out ${fmt(amt)}.`, '#d6b26e');
    api.toast(`Cashed out ${fmt(amt)} chips from Hold'em (${diff >= 0 ? '+' : ''}${fmt(diff)}).`);
    if (diff >= S.buyin) api.broadcast(`cashed out ${fmt(amt)} chips from the Hold'em table, up ${fmt(diff)}`);
    S.phase = 'buyin'; S.waiting = false; S.toAct = -1; S.board = []; S.result = null;
    S.banner = { text: `Cashed out ${fmt(amt)}`, sub: diff >= 0 ? `Up ${fmt(diff)} this session` : `Down ${fmt(-diff)} this session`, t: performance.now() };
    setStatus('Choose a buy-in to sit back down.');
    updateControls();
  }

  // ---------- hand flow ----------
  function shuffle() {
    const d = []; for (let c = 0; c < 52; c++) d.push(c);
    for (let i = 51; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function dealCard(delay) { const c = S.deck.pop(); S.dealt.set(c, performance.now() + delay); return c; }
  function put(p, amt) {
    amt = Math.max(0, Math.min(amt, p.stack));
    p.stack -= amt; p.bet += amt; p.total += amt;
    if (p.stack === 0) p.allIn = true;
    return amt;
  }
  function startHand() {
    if (!S.seated) return;
    for (const p of players) {
      if (!p.human && p.stack < S.bb) { p.stack += S.buyin; S.reloads++; log(`${p.name} reloads ${fmt(S.buyin)}.`, '#a59d90'); }
    }
    if (me.stack <= 0) {
      S.phase = 'busted'; S.seated = false; S.waiting = false;
      setStatus('You are out of chips at this table. Buy in again or leave.');
      S.banner = { text: 'Busted', sub: 'Buy in again to keep playing', t: performance.now() };
      S.phase = 'buyin'; updateControls(); return;
    }
    S.hand++; S.phase = 'hand'; S.result = null; S.banner = null; S.reveal = false; S.board = []; S.street = 0; S.dealt.clear();
    S.deck = shuffle();
    for (const p of players) Object.assign(p, { hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, noReraise: false, lastAct: '' });
    S.dealer = next(S.dealer);
    let k = 0;
    for (let r = 0; r < 2; r++) for (let i = 1; i <= 4; i++) { const p = players[(S.dealer + i) % 4]; p.hole.push(dealCard(k++ * 90)); }
    const sbP = players[next(S.dealer)], bbP = players[next(next(S.dealer))];
    put(sbP, S.sb); sbP.lastAct = `SB ${fmt(sbP.bet)}`;
    put(bbP, S.bb); bbP.lastAct = `BB ${fmt(bbP.bet)}`;
    S.curBet = S.bb; S.minRaise = S.bb;
    log(`Hand #${S.hand} · ${players[S.dealer].name} has the button.`, '#a59d90');
    S.toAct = next(bbP.seat);
    updateControls();
    later(proceed, 900);
  }
  function roundComplete() {
    const act = live().filter((p) => !p.allIn);
    if (act.length === 0) return true;
    if (act.length === 1 && act[0].bet >= S.curBet) return true;
    return act.every((p) => p.acted && p.bet === S.curBet);
  }
  function proceed() {
    if (!S.seated || S.phase !== 'hand') return;
    const lv = live();
    if (lv.length === 1) return finishUncontested(lv[0]);
    if (roundComplete()) { S.waiting = false; updateControls(); return later(endStreet, 650); }
    for (let i = 0; i < 4; i++) {
      const p = players[(S.toAct + i) % 4];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < S.curBet)) { S.toAct = p.seat; break; }
    }
    const p = players[S.toAct];
    if (p.human) {
      S.waiting = true; updateControls();
    } else {
      S.waiting = false; updateControls();
      setStatus(`${p.name} is thinking…`);
      later(() => botAct(p), 550 + Math.random() * 950);
    }
  }
  function act(p, type, raiseTo = 0) {
    const toCall = S.curBet - p.bet;
    if (type === 'fold') {
      p.folded = true; p.lastAct = 'Fold'; log(`${p.name} folds.`, '#a59d90');
    } else if (type === 'check' || (type === 'call' && toCall <= 0)) {
      p.lastAct = 'Check'; log(`${p.name} checks.`);
    } else if (type === 'call') {
      const amt = put(p, toCall);
      p.lastAct = p.allIn ? 'All-in' : `Call ${fmt(amt)}`;
      log(`${p.name} calls ${fmt(amt)}${p.allIn ? ' and is all-in' : ''}.`);
    } else { // raise / bet to `raiseTo` total for this street
      const maxTo = p.stack + p.bet;
      let to = Math.min(Math.max(raiseTo, S.curBet + S.minRaise), maxTo);
      if (to <= S.curBet) return act(p, 'call');
      const wasBet = S.curBet === 0;
      put(p, to - p.bet);
      const size = to - S.curBet;
      const full = size >= S.minRaise;
      if (full) S.minRaise = size;
      S.curBet = to;
      for (const q of players) {
        if (q === p || q.folded || q.allIn) continue;
        if (!full && q.acted) q.noReraise = true; // short all-in does not reopen the betting
        else if (full) q.noReraise = false;
        q.acted = false;
      }
      p.lastAct = p.allIn ? `All-in ${fmt(to)}` : `${wasBet ? 'Bet' : 'Raise'} ${fmt(to)}`;
      log(`${p.name} ${p.allIn ? 'goes all-in for' : wasBet ? 'bets' : 'raises to'} ${fmt(to)}.`, p.allIn ? '#ff3d7f' : '#f1e9db');
    }
    p.acted = true; p.noReraise = false; p.actAt = performance.now();
    S.toAct = next(p.seat); S.waiting = false;
    updateControls();
    later(proceed, 260);
  }
  function endStreet() {
    for (const p of players) { p.bet = 0; p.acted = false; p.noReraise = false; if (!p.folded && !p.allIn) p.lastAct = ''; }
    S.curBet = 0; S.minRaise = S.bb;
    const actable = live().filter((p) => !p.allIn).length;
    if (actable <= 1) S.reveal = true;
    if (S.street === 3) return showdown();
    S.street++;
    const n = S.street === 1 ? 3 : 1;
    for (let i = 0; i < n; i++) S.board.push(dealCard(i * 140));
    log(`${['', 'Flop', 'Turn', 'River'][S.street]}: ${S.board.map(cardText).join(' ')}`, '#d6b26e');
    S.toAct = next(S.dealer);
    updateControls();
    later(proceed, actable <= 1 ? 1300 : 500);
  }
  function refundUncalled() {
    const byTotal = players.slice().sort((a, b) => b.total - a.total);
    const [top, second] = byTotal;
    if (top.total > second.total) {
      const d = top.total - second.total;
      top.total -= d; top.stack += d; if (top.stack > 0) top.allIn = false;
      if (d > 0 && live().length > 1) log(`${fmt(d)} uncalled returned to ${top.name}.`, '#a59d90');
    }
  }
  function settle(winTotals, mainWinners, best, name) {
    for (const p of players) { p.bet = 0; }
    const mine = winTotals.get(me) || 0;
    const net = mine - me.total;
    S.net += net;
    if (mine > 0) {
      api.toast(`You won ${fmt(mine)} chips at Hold'em${name ? ' with ' + name : ''}.`);
      if (net >= Math.max(S.bb * 25, S.buyin * 0.4)) api.broadcast(`won a ${fmt(mine)} chip pot at Hold'em${name ? ' with ' + name : ''}`);
    }
    S.result = { winners: new Set(mainWinners), best: new Set(best), name, t: performance.now() };
    for (const p of players) p.total = 0;
    S.phase = 'over'; S.waiting = false; S.toAct = -1;
    updateControls();
    later(startHand, S.reveal || name ? 4200 : 2400);
  }
  function finishUncontested(w) {
    refundUncalled();
    const amt = potTotal();
    w.stack += amt;
    log(`${w.name} wins ${fmt(amt)} uncontested.`, '#56d68b');
    S.banner = { text: `${w.human ? 'You win' : w.name + ' wins'} ${fmt(amt)}`, sub: 'Everyone else folded', t: performance.now() };
    setStatus(w.human ? `You take down ${fmt(amt)}.` : `${w.name} takes it down.`);
    settle(new Map([[w, amt]]), [w.seat], [], '');
  }
  function buildPots() {
    const levels = [...new Set(live().map((p) => p.total))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
    for (const L of levels) {
      let amt = 0;
      for (const p of players) amt += Math.max(0, Math.min(p.total, L) - prev);
      const elig = players.filter((p) => !p.folded && p.total >= L);
      if (amt > 0) pots.push({ amt, elig });
      prev = L;
    }
    let extra = 0; for (const p of players) extra += Math.max(0, p.total - prev);
    if (extra && pots.length) pots[pots.length - 1].amt += extra;
    return pots;
  }
  function showdown() {
    S.reveal = true;
    refundUncalled();
    const evs = new Map();
    for (const p of live()) evs.set(p, evaluate(p.hole.concat(S.board)));
    const pots = buildPots();
    const won = new Map();
    let mainWinners = [], mainBest = [], mainName = '';
    pots.forEach((pot, idx) => {
      let bestScore = -1; let ws = [];
      for (const p of pot.elig) { const s = evs.get(p).score; if (s > bestScore) { bestScore = s; ws = [p]; } else if (s === bestScore) ws.push(p); }
      // odd chips go to the first winner left of the button
      ws.sort((a, b) => ((a.seat - S.dealer + 3) % 4) - ((b.seat - S.dealer + 3) % 4));
      const share = Math.floor(pot.amt / ws.length); let rem = pot.amt - share * ws.length;
      for (const w of ws) { const a = share + (rem > 0 ? 1 : 0); rem--; w.stack += a; won.set(w, (won.get(w) || 0) + a); }
      const label = pots.length === 1 ? 'the pot' : idx === 0 ? 'the main pot' : `side pot ${idx}`;
      const nm = handName(evs.get(ws[0]));
      if (pot.elig.length === 1) log(`${ws[0].name} takes back ${fmt(pot.amt)} (${label}).`, '#a59d90');
      else log(`${ws.map((w) => w.name).join(' & ')} ${ws.length > 1 ? 'split' : 'wins'} ${label} (${fmt(pot.amt)}) with ${nm}.`, '#56d68b');
      if (idx === 0) { mainWinners = ws.map((w) => w.seat); mainBest = ws.flatMap((w) => evs.get(w).best); mainName = nm; }
    });
    for (const [p, ev] of evs) p.lastAct = handName(ev);
    const ws = mainWinners.map((s) => players[s]);
    const amt = won.get(ws[0]) || 0;
    S.banner = {
      text: ws.length > 1 ? `Split pot · ${ws.map((w) => (w.human ? 'You' : w.name)).join(' & ')}` : `${ws[0].human ? 'You win' : ws[0].name + ' wins'} ${fmt(amt)}`,
      sub: mainName, t: performance.now(),
    };
    setStatus(won.get(me) ? `You win ${fmt(won.get(me))} with ${handName(evs.get(me))}.` : me.folded ? `${S.banner.text} with ${mainName}.` : `You lose with ${handName(evs.get(me))}.`);
    settle(won, mainWinners, mainBest, mainName);
  }

  // ---------- bots ----------
  function botAct(p) {
    if (!S.seated || S.phase !== 'hand' || players[S.toAct] !== p) return;
    const opp = live().length - 1;
    const eq = equity(p.hole, S.board, Math.max(1, opp), S.board.length ? 300 : 200);
    const toCall = Math.min(S.curBet - p.bet, p.stack);
    const pot = potTotal();
    const odds = toCall / (pot + toCall);
    const st = p.style; const r = Math.random();
    const rel = eq * (opp + 1); // 1.0 = fair share of the pot
    const canRaise = !p.noReraise && p.stack > toCall && live().some((q) => q !== p && !q.allIn);
    const sizeTo = (f) => S.curBet + Math.max(S.minRaise, Math.round((pot + toCall) * f / S.sb) * S.sb);
    const monster = eq > 0.8 || (opp >= 2 && rel > 2.4);
    if (toCall <= 0) {
      if (canRaise && (rel > 1.55 - st.aggr * 0.35 || monster) && r < 0.55 + st.aggr * 0.4) {
        const f = monster && r < 0.3 ? 1 : 0.45 + Math.random() * 0.5;
        return act(p, 'raise', sizeTo(f));
      }
      if (canRaise && r < st.bluff && S.street > 0) return act(p, 'raise', sizeTo(0.5 + Math.random() * 0.3));
      return act(p, 'check');
    }
    const commit = toCall / (p.stack + p.bet);
    const need = odds + st.tight + (commit > 0.5 ? 0.08 : 0) + (S.street === 0 ? 0.02 : 0);
    if (canRaise && (monster || rel > 2.0 - st.aggr * 0.4) && r < 0.45 + st.aggr * 0.45) {
      const f = monster && r < 0.25 ? 3 : 0.6 + Math.random() * 0.6;
      return act(p, 'raise', sizeTo(f));
    }
    if (eq >= need || (toCall <= S.bb && S.street === 0 && eq > 0.18 && r < 0.6)) return act(p, 'call');
    if (canRaise && r < st.bluff * 0.6 && commit < 0.25) return act(p, 'raise', sizeTo(0.8 + Math.random() * 0.5));
    if (r < 0.04 && commit < 0.08) return act(p, 'call'); // the occasional loose call
    return act(p, 'fold');
  }

  // ---------- human controls ----------
  function raiseBounds() {
    const toCall = S.curBet - me.bet;
    const max = me.stack + me.bet;
    const min = Math.min(S.curBet + S.minRaise, max);
    const can = S.waiting && !me.noReraise && me.stack > toCall && players.some((q) => q !== me && !q.folded && !q.allIn);
    return { toCall, min, max, can };
  }
  function sliderValue() { return Math.round(+slider.value); }
  function setSlider(v) { const { min, max } = raiseBounds(); v = Math.max(min, Math.min(max, v)); if (v < max) v = Math.max(min, Math.round(v / S.sb) * S.sb); slider.value = String(v); updateAmt(); }
  function updateAmt() {
    const v = sliderValue(); const { max } = raiseBounds();
    elAmt.textContent = fmt(v);
    bRaise.textContent = v >= max ? `All-in ${fmt(v)}` : `${S.curBet === 0 ? 'Bet' : 'Raise to'} ${fmt(v)}`;
  }
  function updateControls() {
    const seated = S.seated;
    elBuy.classList.toggle('pk-hide', seated);
    elAct.classList.toggle('pk-hide', !seated);
    elPre.classList.toggle('pk-hide', !seated);
    bCash.disabled = !seated;
    elInfo.textContent = seated ? `Blinds ${fmt(S.sb)}/${fmt(S.bb)} · Buy-in ${fmt(S.buyin)} · Session ${S.net >= 0 ? '+' : ''}${fmt(S.net)}` : `Your chips: ${fmt(api.chips())}`;
    const my = S.waiting && players[S.toAct] === me;
    const { toCall, min, max, can } = raiseBounds();
    bFold.disabled = !my || toCall <= 0;
    bCall.disabled = !my;
    bCall.textContent = !my ? 'Check' : toCall <= 0 ? 'Check' : toCall >= me.stack ? `Call all-in ${fmt(me.stack)}` : `Call ${fmt(toCall)}`;
    bRaise.disabled = !(my && can);
    slider.disabled = !(my && can);
    elPre.querySelectorAll('button').forEach((b) => { b.disabled = !(my && can); });
    if (my && can) {
      slider.min = String(min); slider.max = String(max); slider.step = '1';
      if (sliderValue() < min || sliderValue() > max) slider.value = String(min);
      updateAmt();
    } else { elAmt.textContent = ''; bRaise.textContent = S.curBet > 0 ? 'Raise' : 'Bet'; }
    if (my) setStatus(toCall > 0 ? `Your turn: ${fmt(Math.min(toCall, me.stack))} to call, pot ${fmt(potTotal())}.` : `Your turn: check or bet. Pot ${fmt(potTotal())}.`);
    else if (seated && S.phase === 'hand' && me.folded) setStatus('You folded. Watching the hand play out…');
  }
  const humanTurn = () => S.waiting && players[S.toAct] === me;
  bFold.onclick = () => { if (humanTurn() && S.curBet > me.bet) act(me, 'fold'); };
  bCall.onclick = () => { if (humanTurn()) act(me, S.curBet > me.bet ? 'call' : 'check'); };
  bRaise.onclick = () => { if (humanTurn() && raiseBounds().can) act(me, 'raise', sliderValue()); };
  slider.oninput = () => setSlider(+slider.value);
  elPre.querySelectorAll('button[data-p]').forEach((b) => {
    b.onclick = () => {
      const { toCall, min, max } = raiseBounds(); const pot = potTotal() + toCall;
      const v = { min, half: S.curBet + pot / 2, '3q': S.curBet + pot * 0.75, pot: S.curBet + pot, all: max }[b.dataset.p];
      setSlider(v);
    };
  });
  elBuy.querySelectorAll('button[data-b]').forEach((b) => { b.onclick = () => buyIn(+b.dataset.b); });
  bCash.onclick = () => {
    if (!S.seated) return;
    if (S.phase === 'hand' && !me.folded) { me.folded = true; log(`${me.name} folds and stands up.`, '#a59d90'); }
    cashOut(false);
  };
  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (!['f', 'c', 'r'].includes(k) || e.target?.tagName === 'INPUT' && e.target.type === 'text') return;
    e.preventDefault(); e.stopPropagation();
    if (!humanTurn()) return;
    if (k === 'f') bFold.click(); else if (k === 'c') bCall.click(); else bRaise.click();
  };
  window.addEventListener('keydown', onKey, true);

  // ---------- drawing ----------
  const SEATS = [
    { x: 480, y: 514, cx: 480, cy: 424, big: true, bx: 480, by: 336 },
    { x: 100, y: 262, cx: 100, cy: 182, bx: 232, by: 262 },
    { x: 480, y: 34, cx: 480, cy: 106, bx: 480, by: 160 },
    { x: 860, y: 262, cx: 860, cy: 182, bx: 728, by: 262 },
  ];
  const DECK_X = 480, DECK_Y = 262;
  function cardText(c) { return RANK_CH[c >> 2] + SUIT_CH[c & 3]; }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function drawCard(c, x, y, w, h, o = {}) {
    const now = performance.now();
    const t0 = S.dealt.get(c);
    if (t0 !== undefined) {
      if (now < t0) return; // not dealt yet
      const t = Math.min(1, (now - t0) / 320);
      if (t < 1) { const e = ease(t); x = DECK_X + (x - DECK_X) * e; y = DECK_Y + (y - DECK_Y) * e; ctx.globalAlpha *= 0.4 + 0.6 * e; }
    }
    if (o.lift) y -= 8;
    ctx.save();
    ctx.translate(x - w / 2, y - h / 2);
    ctx.shadowColor = o.glow ? 'rgba(214,178,110,.95)' : 'rgba(0,0,0,.5)'; ctx.shadowBlur = o.glow ? 18 : 8; ctx.shadowOffsetY = o.glow ? 0 : 3;
    rr(0, 0, w, h, w * 0.1);
    if (o.back) {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6a1426'); g.addColorStop(1, '#2c0711');
      ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 1.2; rr(w * 0.08, w * 0.08, w * 0.84, h - w * 0.16, w * 0.06); ctx.stroke();
      ctx.save(); rr(w * 0.08, w * 0.08, w * 0.84, h - w * 0.16, w * 0.06); ctx.clip();
      ctx.strokeStyle = 'rgba(214,178,110,.28)'; ctx.lineWidth = 1;
      for (let i = -h; i < w + h; i += 7) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.moveTo(i + h, 0); ctx.lineTo(i, h); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#d6b26e'; ctx.font = `600 ${w * 0.32}px "Bodoni Moda", Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('V', w / 2, h / 2 + 1);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fffdf7'); g.addColorStop(1, '#ece4d3');
      ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.strokeStyle = o.glow ? '#d6b26e' : 'rgba(0,0,0,.25)'; ctx.lineWidth = o.glow ? 2.5 : 1; ctx.stroke();
      const red = (c & 3) === 1 || (c & 3) === 2;
      ctx.fillStyle = red ? '#c0263a' : '#16161a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const rk = RANK_CH[c >> 2]; const su = SUIT_CH[c & 3];
      ctx.font = `700 ${h * (rk === '10' ? 0.22 : 0.25)}px Georgia, "Times New Roman", serif`;
      ctx.fillText(rk, w * 0.2 + (rk === '10' ? 2 : 0), h * 0.27);
      ctx.font = `${h * 0.2}px "DejaVu Sans", "Segoe UI Symbol", Arial, sans-serif`;
      ctx.fillText(su, w * 0.2, h * 0.47);
      ctx.font = `${h * 0.46}px "DejaVu Sans", "Segoe UI Symbol", Arial, sans-serif`;
      ctx.fillText(su, w * 0.6, h * 0.86);
      if (o.dim) { ctx.fillStyle = 'rgba(5,6,10,.5)'; rr(0, 0, w, h, w * 0.1); ctx.fill(); }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  function chipStack(x, y, amt) {
    if (amt <= 0) return;
    const cols = ['#d6b26e', '#c0263a', '#1d4fa8', '#2c2c30'];
    const n = Math.min(6, 1 + Math.floor(Math.log10(Math.max(1, amt / S.sb)) * 2));
    for (let i = 0; i < n; i++) {
      const yy = y - i * 3.2; ctx.beginPath(); ctx.ellipse(x - 22, yy, 11, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = cols[i % 4]; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = '600 13px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const t = fmt(amt); const tw = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(5,6,10,.7)'; rr(x - 6, y - 10, tw + 12, 20, 10); ctx.fill();
    ctx.fillStyle = '#f1e9db'; ctx.fillText(t, x, y + 1);
  }
  function drawTable() {
    const bg = ctx.createRadialGradient(480, 280, 100, 480, 280, 640);
    bg.addColorStop(0, '#16120d'); bg.addColorStop(1, '#040405');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // rail
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.beginPath(); ctx.ellipse(480, 262, 392, 222, 0, 0, Math.PI * 2);
    const rail = ctx.createLinearGradient(0, 40, 0, 490); rail.addColorStop(0, '#3a2414'); rail.addColorStop(0.5, '#1d110a'); rail.addColorStop(1, '#2e1c10');
    ctx.fillStyle = rail; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.ellipse(480, 262, 392, 222, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(214,178,110,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    // felt
    ctx.beginPath(); ctx.ellipse(480, 262, 362, 194, 0, 0, Math.PI * 2);
    const felt = ctx.createRadialGradient(480, 240, 30, 480, 262, 380); felt.addColorStop(0, '#1f7a52'); felt.addColorStop(0.65, '#125238'); felt.addColorStop(1, '#0a3122');
    ctx.fillStyle = felt; ctx.fill();
    ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(480, 262, 330, 166, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(214,178,110,.22)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(214,178,110,.16)'; ctx.font = 'italic 500 30px "Bodoni Moda", Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('The Vault', 480, 346);
  }
  function drawSeat(p, now) {
    const s = SEATS[p.seat];
    const turn = S.waiting ? players[S.toAct] === p : (S.phase === 'hand' && S.toAct === p.seat && !p.human && !p.folded);
    const winner = S.result && S.result.winners.has(p.seat);
    const active = S.phase !== 'buyin' && S.hand > 0;
    // hole cards
    if (active && p.hole.length) {
      const w = s.big ? 70 : 50, h = s.big ? 98 : 70, gap = s.big ? 40 : 28;
      const show = p.human || (S.reveal && !p.folded);
      ctx.globalAlpha = p.folded ? 0.35 : 1;
      p.hole.forEach((c, i) => {
        const hl = S.result && S.result.best.has(c) && winner;
        drawCard(c, s.cx + (i - 0.5) * gap, s.cy, w, h, { back: !show, glow: hl, lift: hl });
        ctx.globalAlpha = p.folded ? 0.35 : 1;
      });
      ctx.globalAlpha = 1;
    }
    // plate
    const pw = 190, ph = 50, x = s.x - pw / 2, y = s.y - ph / 2;
    ctx.save();
    ctx.globalAlpha = active && p.folded ? 0.55 : 1;
    if (turn || winner) { ctx.shadowColor = winner ? 'rgba(86,214,139,.9)' : `rgba(214,178,110,${0.55 + 0.35 * Math.sin(now / 220)})`; ctx.shadowBlur = 22; }
    rr(x, y, pw, ph, 8); ctx.fillStyle = 'rgba(12,11,10,.92)'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = winner ? '#56d68b' : turn ? '#d6b26e' : 'rgba(214,178,110,.3)'; ctx.lineWidth = turn || winner ? 2 : 1; ctx.stroke();
    // avatar
    ctx.beginPath(); ctx.arc(x + 25, s.y, 16, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
    ctx.fillStyle = '#0b0a09'; ctx.font = '700 15px Manrope, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((p.name[0] || '?').toUpperCase(), x + 25, s.y + 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f1e9db'; ctx.font = '600 14px Manrope, Arial, sans-serif';
    ctx.fillText(p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name, x + 50, s.y - 9);
    ctx.fillStyle = '#d6b26e'; ctx.font = '500 14px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(!S.seated && S.hand === 0 ? '—' : p.human && !S.seated ? '—' : fmt(p.stack), x + 50, s.y + 11);
    if (p.lastAct && active) {
      ctx.textAlign = 'right'; ctx.font = '600 10px Manrope, Arial, sans-serif';
      ctx.fillStyle = /All-in/.test(p.lastAct) ? '#ff3d7f' : p.lastAct === 'Fold' ? '#a59d90' : winner ? '#56d68b' : '#3de0ff';
      ctx.font = '600 14px Manrope, Arial, sans-serif';
      const nameW = ctx.measureText(p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name).width;
      ctx.font = '600 10px Manrope, Arial, sans-serif';
      const room = pw - 8 - 50 - nameW - 8;
      let t = p.lastAct.toUpperCase();
      if (ctx.measureText(t).width > room) { t = t.replace(/^(.*?),.*$/, '$1'); }
      while (t.length > 3 && ctx.measureText(t).width > room) t = t.slice(0, -2) + '…';
      ctx.fillText(t, x + pw - 8, s.y - 9);
    }
    ctx.restore();
    // dealer button
    if (active && S.dealer === p.seat) {
      const dx = p.seat === 0 ? s.x + 118 : p.seat === 2 ? s.x - 118 : s.x + (p.seat === 1 ? 62 : -62), dy = p.seat % 2 ? s.y + 40 : s.y;
      ctx.beginPath(); ctx.arc(dx, dy, 12, 0, Math.PI * 2); ctx.fillStyle = '#f1e9db'; ctx.fill(); ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#17120a'; ctx.font = '800 12px Manrope, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('D', dx, dy + 1);
    }
    if (active && p.bet > 0) chipStack(s.bx, s.by, p.bet);
  }
  function draw() {
    const now = performance.now();
    drawTable();
    // community
    const cw = 62, chh = 87;
    for (let i = 0; i < 5; i++) {
      const x = 480 + (i - 2) * 70, y = 262;
      const c = S.board[i];
      if (c === undefined || (S.dealt.get(c) ?? 0) > now) { rr(x - cw / 2, y - chh / 2, cw, chh, 6); ctx.strokeStyle = 'rgba(214,178,110,.18)'; ctx.lineWidth = 1; ctx.stroke(); continue; }
      const hl = S.result && S.result.best.has(c);
      drawCard(c, x, y, cw, chh, { glow: hl, lift: hl, dim: S.result && S.result.best.size > 0 && !hl });
    }
    // pot
    const pc = S.phase === 'over' ? 0 : potCollected();
    if (pc > 0) {
      ctx.font = '600 10px Manrope, Arial, sans-serif'; ctx.fillStyle = '#a59d90'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('P O T', 480, 196);
      ctx.font = '500 18px "JetBrains Mono", ui-monospace, monospace'; ctx.fillStyle = '#d6b26e'; ctx.fillText(fmt(pc), 480, 213);
    }
    for (const p of players) drawSeat(p, now);
    // banner
    if (S.banner) {
      const a = Math.min(1, (now - S.banner.t) / 300);
      ctx.save(); ctx.globalAlpha = a;
      ctx.font = '500 26px "Bodoni Moda", Georgia, serif';
      const tw = Math.max(ctx.measureText(S.banner.text).width, 200) + 60;
      rr(480 - tw / 2, 312, tw, 52, 10); ctx.fillStyle = 'rgba(8,7,6,.86)'; ctx.fill(); ctx.strokeStyle = '#d6b26e'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#f1e9db'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(S.banner.text, 480, 332);
      ctx.font = '600 12px Manrope, Arial, sans-serif'; ctx.fillStyle = '#d6b26e'; ctx.fillText(S.banner.sub || '', 480, 353);
      ctx.restore();
    }
    // action log (bottom-left)
    const lines = S.log.slice(-6);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '500 11px Manrope, Arial, sans-serif';
    ctx.fillStyle = 'rgba(214,178,110,.7)'; ctx.font = '700 9px Manrope, Arial, sans-serif'; ctx.fillText('A C T I O N', 14, 452);
    ctx.font = '500 11px Manrope, Arial, sans-serif';
    lines.forEach((l, i) => { ctx.globalAlpha = 0.45 + 0.55 * ((i + 1) / lines.length); ctx.fillStyle = l.color; ctx.fillText(l.text.length > 46 ? l.text.slice(0, 45) + '…' : l.text, 14, 468 + i * 15); });
    ctx.globalAlpha = 1;
    // hand info (bottom-right)
    ctx.textAlign = 'right';
    if (S.hand > 0 && S.seated) {
      ctx.fillStyle = 'rgba(214,178,110,.7)'; ctx.font = '700 9px Manrope, Arial, sans-serif'; ctx.fillText(`H A N D  # ${S.hand}`, W - 14, 482);
      ctx.fillStyle = '#a59d90'; ctx.font = '500 11px Manrope, Arial, sans-serif'; ctx.fillText(`Blinds ${fmt(S.sb)} / ${fmt(S.bb)}`, W - 14, 498);
      if (me.hole.length === 2 && !me.folded && S.phase !== 'buyin') {
        const ev = S.board.length >= 3 ? handName(evaluate(me.hole.concat(S.board))) : (me.hole[0] >> 2) === (me.hole[1] >> 2) ? `Pocket ${RNP[me.hole[0] >> 2]}` : `${RN[Math.max(me.hole[0] >> 2, me.hole[1] >> 2)]}-${RN[Math.min(me.hole[0] >> 2, me.hole[1] >> 2)]}${(me.hole[0] & 3) === (me.hole[1] & 3) ? ' suited' : ''}`;
        ctx.fillStyle = '#f1e9db'; ctx.font = '600 13px Manrope, Arial, sans-serif'; ctx.fillText(ev, W - 14, 518);
      }
    }
    if (!S.seated) {
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(241,233,219,.85)'; ctx.font = '600 13px Manrope, Arial, sans-serif';
      if (!S.banner) ctx.fillText('Pick a buy-in below. Blinds are 1/200 and 1/100 of the buy-in.', 480, 190);
    }
    if (now - lastMirror > 100) { lastMirror = now; try { api.mirror && api.mirror(cv); } catch (e) { /* cabinet optional */ } }
    raf = requestAnimationFrame(draw);
  }

  api.onClose(() => {
    closed = true;
    cashOut(true);
    clearTimers();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
  });
  updateControls();
  raf = requestAnimationFrame(draw);
}
