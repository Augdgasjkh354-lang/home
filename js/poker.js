/* ============================================================
 * 像素小家 —— 德州扑克（poker.js）
 * 只往 G.poker 上挂接口。引擎部分不依赖 DOM，可在 node 里直接测试。
 *   G.poker.cardText(c) / isRed(c) / newDeck() / shuffle(arr, rnd)
 *   G.poker.eval7(cards) -> {score, cat, name, best}     5~7 张取最大牌型（score 可直接比较）
 *   G.poker.describe(score) -> '两对 A 和 2'               G.poker.cmp(a, b) -> -1|0|1
 *   G.poker.newHand({stacks, dealer, sb, bb, rnd?, rig?}) -> hand   无限注德州引擎
 *   G.poker.legal(hand, i) -> {ok, canCheck, toCall, callAmt, canRaise, minTo, maxTo, pot, curBet, stack}
 *   G.poker.apply(hand, i, act) -> {ok, error?}           act: {t:'fold'|'check'|'call'|'raise'|'allin', to?}
 *   G.poker.potTotal(hand)                                 当前所有下注（含边池）之和
 *   G.poker.equity(hole, board, nOpp, samples, rnd) -> 0~1 对随机手的胜率
 *   G.poker.preflopTier(hole) -> 'S'|'A'|'B'|'C'|'D'
 *   G.poker.PERSONAS / G.poker.personaById(id) / G.poker.ai.decide(hand, i, persona, rnd)
 *   G.poker.state() -> G.state.poker（存档模块，见下）
 *   G.poker.openStudy()                                    电脑学习：课程、计时、小测验
 *   G.poker.update(dt)                                     每帧：推进学习计时，并调用 G.cardroom.tick(dt)
 *   G.poker.equityAll(holes, board, samples, rnd) -> [胜率…]  多人同时胜率（全知之眼用，holes 为各座位底牌或 null）
 *   G.poker.pickReads(h, n, rnd) -> [座位下标…]            随机挑 n 个对手用于读牌（rnd 应为独立随机源）
 * 存档字段 G.state.poker：scammed / scam / stats / learned / studyDay / study / table（table 由 cardroom.js 维护）
 *   另有 intelDay / intel / intelLog（情报贩子，由 cardroom.js 维护）
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var poker = (G.poker = G.poker || {});

  var SUITS = ['c', 'd', 'h', 's'];
  var SUIT_SYM = { c: '♣', d: '♦', h: '♥', s: '♠' };
  var RANK_TXT = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var CAT_NAME = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

  poker.RANK_TXT = RANK_TXT;
  poker.SUIT_SYM = SUIT_SYM;
  poker.CAT_NAME = CAT_NAME;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function cp(c) { return { r: c.r, s: c.s }; }

  /* ---------- 牌 ---------- */
  poker.cardText = function (c) { return c ? RANK_TXT[c.r] + SUIT_SYM[c.s] : ''; };
  poker.isRed = function (c) { return !!c && (c.s === 'h' || c.s === 'd'); };

  poker.newDeck = function () {
    var d = [];
    SUITS.forEach(function (s) { for (var r = 2; r <= 14; r++) d.push({ r: r, s: s }); });
    return d;
  };

  poker.shuffle = function (arr, rnd) {
    rnd = rnd || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* ---------- 牌型比较 ----------
   * 分数 = cat*100^5 + 五个比较位（主牌、踢脚…），可直接用 > 比较。 */
  function enc(cat, ks) {
    var v = cat * 1e10, mul = 1e8;
    for (var k = 0; k < 5; k++) { v += (ks[k] || 0) * mul; mul /= 100; }
    return v;
  }

  function score5(cs) {
    var cnt = [], i, v;
    for (i = 0; i < 15; i++) cnt.push(0);
    var suit0 = cs[0].s, flush = true;
    for (i = 0; i < 5; i++) {
      cnt[cs[i].r] += 1;
      if (cs[i].s !== suit0) flush = false;
    }
    var uniq = [];
    for (v = 14; v >= 2; v--) if (cnt[v]) uniq.push(v);
    var sh = 0;                                   // 顺子的最高牌（A-2-3-4-5 为 5）
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) sh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5) sh = 5;
    }
    var groups = uniq.map(function (r) { return { r: r, n: cnt[r] }; });
    groups.sort(function (a, b) { return (b.n - a.n) || (b.r - a.r); });
    var n0 = groups[0].n;
    if (sh && flush) return enc(8, [sh]);
    if (n0 === 4) return enc(7, [groups[0].r, groups[1].r]);
    if (n0 === 3 && groups.length === 2) return enc(6, [groups[0].r, groups[1].r]);
    if (flush) return enc(5, uniq);
    if (sh) return enc(4, [sh]);
    if (n0 === 3) return enc(3, [groups[0].r, groups[1].r, groups[2].r]);
    if (n0 === 2 && groups[1].n === 2) return enc(2, [groups[0].r, groups[1].r, groups[2].r]);
    if (n0 === 2) return enc(1, [groups[0].r, groups[1].r, groups[2].r, groups[3].r]);
    return enc(0, uniq);
  }

  var comboCache = {};
  function combos(n) {
    if (comboCache[n]) return comboCache[n];
    var out = [];
    for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) for (var c = b + 1; c < n; c++)
      for (var d = c + 1; d < n; d++) for (var e = d + 1; e < n; e++) out.push([a, b, c, d, e]);
    comboCache[n] = out;
    return out;
  }

  poker.eval7 = function (cards) {
    var list = combos(cards.length), best = -1, bestCards = null;
    for (var k = 0; k < list.length; k++) {
      var ix = list[k];
      var five = [cards[ix[0]], cards[ix[1]], cards[ix[2]], cards[ix[3]], cards[ix[4]]];
      var sc = score5(five);
      if (sc > best) { best = sc; bestCards = five; }
    }
    var cat = Math.floor(best / 1e10);
    return { score: best, cat: cat, name: CAT_NAME[cat], best: bestCards };
  };

  // 快速评分（胜率估算用）：按花色/点数计数直接判定，结果与 eval7 的最大组合一致（测试中交叉验证）
  var SI = { c: 0, d: 1, h: 2, s: 3 };
  function straightHigh(mask) {
    for (var hi = 14; hi >= 5; hi--) {
      var need = 0;
      for (var k = 0; k < 5; k++) need |= 1 << (hi - k);
      if ((mask & need) === need) return hi;
    }
    if ((mask & (1 << 14)) && (mask & 0x3c) === 0x3c) return 5;   // A-2-3-4-5
    return 0;
  }

  poker.score7 = function (cs) {
    var cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sc = [0, 0, 0, 0], mask = 0, i, r;
    for (i = 0; i < cs.length; i++) { cnt[cs[i].r]++; sc[SI[cs[i].s]]++; mask |= 1 << cs[i].r; }
    var fs = -1;
    for (var s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) {
      var sm = 0;
      for (i = 0; i < cs.length; i++) if (SI[cs[i].s] === fs) sm |= 1 << cs[i].r;
      var sh = straightHigh(sm);
      if (sh) return enc(8, [sh]);
      var fk = [];
      for (r = 14; r >= 2 && fk.length < 5; r--) if (sm & (1 << r)) fk.push(r);
      return enc(5, fk);
    }
    var quads = [], trips = [], pairs = [];
    for (r = 14; r >= 2; r--) {
      if (cnt[r] === 4) quads.push(r);
      else if (cnt[r] === 3) trips.push(r);
      else if (cnt[r] === 2) pairs.push(r);
    }
    if (quads.length) {
      var kick = 0;
      for (r = 14; r >= 2; r--) if (cnt[r] && r !== quads[0]) { kick = r; break; }
      return enc(7, [quads[0], kick]);
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      var pr = Math.max(trips.length > 1 ? trips[1] : 0, pairs.length ? pairs[0] : 0);
      return enc(6, [trips[0], pr]);
    }
    var sh2 = straightHigh(mask);
    if (sh2) return enc(4, [sh2]);
    var ks = [];
    if (trips.length) {
      for (r = 14; r >= 2 && ks.length < 2; r--) if (cnt[r] && r !== trips[0]) ks.push(r);
      return enc(3, [trips[0], ks[0], ks[1]]);
    }
    if (pairs.length >= 2) {
      var kk = 0;
      for (r = 14; r >= 2; r--) if (cnt[r] && r !== pairs[0] && r !== pairs[1]) { kk = r; break; }
      return enc(2, [pairs[0], pairs[1], kk]);
    }
    if (pairs.length === 1) {
      for (r = 14; r >= 2 && ks.length < 3; r--) if (cnt[r] && r !== pairs[0]) ks.push(r);
      return enc(1, [pairs[0], ks[0], ks[1], ks[2]]);
    }
    for (r = 14; r >= 2 && ks.length < 5; r--) if (cnt[r]) ks.push(r);
    return enc(0, ks);
  };

  function decode(score) {
    var cat = Math.floor(score / 1e10), rem = score - cat * 1e10, ks = [], mul = 1e8;
    for (var k = 0; k < 5; k++) { ks.push(Math.floor(rem / mul) % 100); mul /= 100; }
    return { cat: cat, ks: ks };
  }

  poker.describe = function (score) {
    var d = decode(score), k = d.ks;
    var R = function (r) { return RANK_TXT[r]; };
    switch (d.cat) {
      case 8: return k[0] === 14 ? '皇家同花顺' : '同花顺（' + R(k[0]) + ' 高）';
      case 7: return '四条 ' + R(k[0]);
      case 6: return '葫芦 ' + R(k[0]) + ' 带 ' + R(k[1]);
      case 5: return '同花（' + R(k[0]) + ' 高）';
      case 4: return '顺子（' + R(k[0]) + ' 高）';
      case 3: return '三条 ' + R(k[0]);
      case 2: return '两对 ' + R(k[0]) + ' 和 ' + R(k[1]);
      case 1: return '一对 ' + R(k[0]);
      default: return '高牌 ' + R(k[0]);
    }
  };

  poker.cmp = function (a, b) { return a > b ? 1 : (a < b ? -1 : 0); };

  /* ---------- 无限注德州引擎 ----------
   * hand = { seats:[{stack,bet,totalIn,hole,folded,allIn,pending,seen}], dealer, street, board, deck,
   *          blind:{sb,bb}, curBet, minRaise, raiseId, toAct, lastActor, sbIdx, bbIdx, log, result }
   * street: pre | flop | turn | river | done。toAct 为当前应行动的座位（-1 表示无人需要行动）。
   * seen：该座位上次行动时看到的 raiseId；只有出现过新的完整加注（raiseId 增加）才允许再加注。 */
  function active(s) { return !s.folded && !s.allIn; }

  function nextIn(h, from) {
    var n = h.seats.length;
    for (var k = 1; k <= n; k++) {
      var j = (from + k) % n;
      if (!h.seats[j].folded) return j;
    }
    return from;
  }

  function firstPendingAfter(h, from) {
    var n = h.seats.length;
    for (var k = 1; k <= n; k++) {
      var j = (from + k) % n;
      var s = h.seats[j];
      if (s.pending && active(s)) return j;
    }
    return -1;
  }

  function anyPending(h) {
    return h.seats.some(function (s) { return s.pending && active(s); });
  }

  function notFolded(h) {
    var c = 0;
    h.seats.forEach(function (s) { if (!s.folded) c++; });
    return c;
  }

  function addLog(h, i, text) {
    h.log.push({ i: i, t: text });
    if (h.log.length > 30) h.log.shift();
  }

  function pay(h, i, amt) {
    var s = h.seats[i];
    amt = Math.max(0, Math.min(amt, s.stack));
    s.stack -= amt;
    s.bet += amt;
    s.totalIn += amt;
    if (s.stack === 0 && !s.folded) s.allIn = true;
    return amt;
  }

  poker.potTotal = function (h) {
    var t = 0;
    h.seats.forEach(function (s) { t += s.totalIn; });
    return t;
  };

  function startStreet(h) {
    var cnt = 0;
    h.seats.forEach(function (s) { s.seen = -1; s.pending = false; if (active(s)) cnt++; });
    if (cnt >= 2) h.seats.forEach(function (s) { if (active(s)) s.pending = true; });
  }

  var NEXT_STREET = { pre: 'flop', flop: 'turn', turn: 'river' };

  function nextStreet(h) {
    h.street = NEXT_STREET[h.street];
    var k = h.street === 'flop' ? 3 : 1;
    for (var j = 0; j < k; j++) h.board.push(h.rigBoard.length ? h.rigBoard.shift() : h.deck.pop());
    h.seats.forEach(function (s) { s.bet = 0; });
    h.curBet = 0;
    h.minRaise = h.blind.bb;
    h.raiseId = 0;
    h.lastActor = h.dealer;
    startStreet(h);
  }

  function finish(h) {
    h.street = 'done';
    h.toAct = -1;
    h.seats.forEach(function (s) { s.pending = false; });
  }

  function awardUncontested(h) {
    var total = poker.potTotal(h), payouts = h.seats.map(function () { return 0; });
    var w = -1;
    h.seats.forEach(function (s, i) { if (!s.folded) w = i; });
    payouts[w] = total;
    h.seats[w].stack += total;
    h.result = { pots: [{ amount: total, winners: [w], eligible: [w] }], payouts: payouts, hands: {}, uncontested: true };
    finish(h);
  }

  // 边池：按每个人投入的档位切分；只有没弃牌且投入够这一档的人有资格赢这一档
  function buildPots(h) {
    var levels = [];
    h.seats.forEach(function (s) { if (s.totalIn > 0 && levels.indexOf(s.totalIn) < 0) levels.push(s.totalIn); });
    levels.sort(function (a, b) { return a - b; });
    var pots = [], prev = 0;
    levels.forEach(function (lv) {
      var amt = 0, elig = [];
      h.seats.forEach(function (s, i) {
        amt += Math.max(0, Math.min(s.totalIn, lv) - Math.min(s.totalIn, prev));
        if (!s.folded && s.totalIn >= lv) elig.push(i);
      });
      prev = lv;
      if (amt <= 0) return;
      if (!elig.length) {                       // 理论上不会出现：并入上一池或没弃牌的人
        if (pots.length) { pots[pots.length - 1].amount += amt; return; }
        h.seats.forEach(function (s, i) { if (!s.folded) elig.push(i); });
      }
      pots.push({ amount: amt, eligible: elig });
    });
    return pots;
  }

  function showdown(h) {
    var pots = buildPots(h), n = h.seats.length, payouts = h.seats.map(function () { return 0; }), hands = {};
    h.seats.forEach(function (s, i) {
      if (!s.folded) {
        var ev = poker.eval7(s.hole.concat(h.board));
        hands[i] = { name: poker.describe(ev.score), score: ev.score, best: ev.best };
      }
    });
    // 平分时的余数：从庄家左手边开始依次分配
    var rel = function (i) { return ((i - h.dealer + n) % n) || n; };
    pots.forEach(function (p) {
      var best = -1, win = [];
      p.eligible.forEach(function (i) {
        var sc = hands[i] ? hands[i].score : -1;
        if (sc > best) { best = sc; win = [i]; } else if (sc === best) win.push(i);
      });
      win.sort(function (a, b) { return rel(a) - rel(b); });
      var share = Math.floor(p.amount / win.length), rem = p.amount - share * win.length;
      win.forEach(function (w, k) { payouts[w] += share + (k < rem ? 1 : 0); });
      p.winners = win;
    });
    h.seats.forEach(function (s, i) { s.stack += payouts[i]; });
    h.result = { pots: pots, payouts: payouts, hands: hands, uncontested: false };
    finish(h);
  }

  function progress(h) {
    for (var guard = 0; guard < 10; guard++) {
      if (h.street === 'done') return;
      if (notFolded(h) <= 1) return awardUncontested(h);
      if (anyPending(h)) { h.toAct = firstPendingAfter(h, h.lastActor); return; }
      if (h.street === 'river') return showdown(h);
      nextStreet(h);
    }
  }

  poker.newHand = function (o) {
    var rnd = o.rnd || Math.random;
    var stacks = o.stacks || [];
    var n = stacks.length;
    var seats = stacks.map(function (st) {
      return { stack: Math.max(0, Math.floor(Number(st) || 0)), bet: 0, totalIn: 0, hole: [], folded: false, allIn: false, pending: false, seen: -1 };
    });
    seats.forEach(function (s) { if (s.stack <= 0) s.folded = true; });   // 没有筹码的座位不参与本手
    var deck = poker.shuffle(poker.newDeck(), rnd);
    var rig = o.rig || null, rigBoard = [];
    if (rig) {                                 // 指定底牌与公共牌（老千局用），其余牌随机
      var taken = [];
      (rig.holes || []).forEach(function (hs) { if (hs) taken = taken.concat(hs); });
      if (rig.board) taken = taken.concat(rig.board);
      deck = deck.filter(function (c) { return !taken.some(function (t) { return t.r === c.r && t.s === c.s; }); });
      (rig.holes || []).forEach(function (hs, i) { if (hs && seats[i] && !seats[i].folded) seats[i].hole = hs.map(cp); });
      rigBoard = (rig.board || []).map(cp);
    }
    var h = {
      seats: seats, dealer: ((Number(o.dealer) || 0) % n + n) % n, street: 'pre', board: [], deck: deck, rigBoard: rigBoard,
      blind: { sb: o.sb, bb: o.bb }, curBet: 0, minRaise: o.bb, raiseId: 0, toAct: -1, lastActor: -1, log: [], result: null,
    };
    seats.forEach(function (s) {
      if (s.folded) return;
      while (s.hole.length < 2) s.hole.push(h.deck.pop());
    });
    var sb = nextIn(h, h.dealer), bbi = nextIn(h, sb);
    h.sbIdx = sb;
    h.bbIdx = bbi;
    pay(h, sb, o.sb);
    pay(h, bbi, o.bb);
    h.curBet = Math.max(seats[sb].bet, seats[bbi].bet);
    h.minRaise = o.bb;
    h.lastActor = bbi;
    startStreet(h);
    progress(h);
    return h;
  };

  poker.legal = function (h, i) {
    var s = h.seats[i];
    var ok = !!s && h.toAct === i && s.pending && active(s) && h.street !== 'done';
    var toCall = Math.max(0, h.curBet - s.bet);
    var maxTo = s.bet + s.stack;
    var minTo = Math.min(h.curBet + h.minRaise, maxTo);
    return {
      ok: ok,
      toCall: toCall,
      canCheck: toCall === 0,
      callAmt: Math.min(toCall, s.stack),
      canRaise: ok && s.seen < h.raiseId && maxTo > h.curBet,
      minTo: minTo,
      maxTo: maxTo,
      curBet: h.curBet,
      pot: poker.potTotal(h),
      stack: s.stack,
    };
  };

  poker.apply = function (h, i, act) {
    var L = poker.legal(h, i);
    if (!L.ok) return { ok: false, error: '还没轮到这个位置行动' };
    var s = h.seats[i];
    var t = act && act.t, to = 0;
    if (t === 'allin') {                       // 全下：能加注就加到全部筹码，否则当作跟注（可能正好全下）
      if (L.canRaise) { t = 'raise'; to = L.maxTo; }
      else t = L.canCheck ? 'check' : 'call';
    }
    if (t === 'fold') {
      s.folded = true; s.pending = false; s.seen = h.raiseId;
      addLog(h, i, '弃牌');
    } else if (t === 'check') {
      if (!L.canCheck) return { ok: false, error: '现在不能过牌' };
      s.pending = false; s.seen = h.raiseId;
      addLog(h, i, '过牌');
    } else if (t === 'call') {
      if (L.canCheck) return { ok: false, error: '不用跟注' };
      var amt = pay(h, i, L.toCall);
      s.pending = false; s.seen = h.raiseId;
      addLog(h, i, (s.allIn ? '全下跟注 ' : '跟注 ') + amt);
    } else if (t === 'raise') {
      if (act.t === 'raise') to = Math.floor(Number(act.to));
      if (!L.canRaise) return { ok: false, error: '现在不能加注' };
      if (!(to > 0)) return { ok: false, error: '加注额不对' };
      if (to > L.maxTo) to = L.maxTo;
      if (to <= h.curBet) return { ok: false, error: '加注要高于当前下注' };
      var full = (to - h.curBet) >= h.minRaise;
      if (!full && to < L.maxTo) return { ok: false, error: '加注不足最小加注额' };
      var inc = to - h.curBet;
      pay(h, i, to - s.bet);
      h.curBet = to;
      if (full) { h.minRaise = inc; h.raiseId += 1; }
      s.pending = false; s.seen = h.raiseId;
      h.seats.forEach(function (o, j) { if (j !== i && active(o)) o.pending = true; });
      addLog(h, i, (s.allIn ? '全下到 ' : '加注到 ') + to);
    } else {
      return { ok: false, error: '未知动作' };
    }
    h.lastActor = i;
    h.toAct = -1;
    progress(h);
    return { ok: true };
  };

  /* ---------- 胜率估算（对随机手，蒙特卡洛） ---------- */
  poker.equity = function (hole, board, nOpp, samples, rnd) {
    rnd = rnd || Math.random;
    nOpp = Math.max(1, nOpp | 0);
    var known = hole.concat(board);
    var pool = poker.newDeck().filter(function (c) {
      return !known.some(function (k) { return k.r === c.r && k.s === c.s; });
    });
    var need = 5 - board.length, m = need + 2 * nOpp, total = 0;
    for (var it = 0; it < samples; it++) {
      for (var k = 0; k < m; k++) {          // 部分洗牌：前 m 张是这次要用的牌
        var j = k + Math.floor(rnd() * (pool.length - k));
        var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
      }
      var b = board.slice();
      for (k = 0; k < need; k++) b.push(pool[k]);
      var my = poker.score7(hole.concat(b));
      var lose = false, ties = 0;
      for (var o = 0; o < nOpp; o++) {
        var sc = poker.score7([pool[need + 2 * o], pool[need + 2 * o + 1]].concat(b));
        if (sc > my) { lose = true; break; }
        if (sc === my) ties++;
      }
      if (!lose) total += 1 / (1 + ties);
    }
    return samples > 0 ? total / samples : 0;
  };

  // 多人同时胜率（牌技 Lv10「全知之眼」用）：holes[i] 为座位 i 的两张底牌，null 表示不参与；
  // 每次模拟补齐公共牌后比大小，平局分摊。返回与 holes 等长的数组（不参与者为 0）。
  poker.equityAll = function (holes, board, samples, rnd) {
    rnd = rnd || Math.random;
    var known = board.slice(), idx = [], i, k;
    for (i = 0; i < holes.length; i++) {
      if (holes[i] && holes[i].length === 2) { idx.push(i); known.push(holes[i][0], holes[i][1]); }
    }
    var out = holes.map(function () { return 0; });
    if (!idx.length) return out;
    var pool = poker.newDeck().filter(function (c) {
      return !known.some(function (x) { return x.r === c.r && x.s === c.s; });
    });
    var need = 5 - board.length, tot = idx.map(function () { return 0; });
    for (var it = 0; it < samples; it++) {
      for (k = 0; k < need; k++) {
        var j = k + Math.floor(rnd() * (pool.length - k));
        var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
      }
      var b = board.concat(pool.slice(0, need)), best = -1, sc = [], cnt = 0;
      for (k = 0; k < idx.length; k++) {
        sc[k] = poker.score7(holes[idx[k]].concat(b));
        if (sc[k] > best) best = sc[k];
      }
      for (k = 0; k < idx.length; k++) if (sc[k] === best) cnt++;
      for (k = 0; k < idx.length; k++) if (sc[k] === best) tot[k] += 1 / cnt;
    }
    for (k = 0; k < idx.length; k++) out[idx[k]] = samples > 0 ? tot[k] / samples : 0;
    return out;
  };

  // 读牌：从对手（座位 1 起）里随机挑 n 个已发到底牌的座位，返回升序下标。
  // rnd 应传独立随机源，不要用发牌用的 Math.random，保证读牌不改变发牌随机性。
  poker.pickReads = function (h, n, rnd) {
    rnd = rnd || Math.random;
    var cand = [], i, k;
    for (i = 1; i < h.seats.length; i++) {
      if (h.seats[i].hole && h.seats[i].hole.length === 2) cand.push(i);
    }
    n = Math.max(0, Math.min(Math.floor(Number(n) || 0), cand.length));
    var out = [];
    for (k = 0; k < n; k++) {
      var j = k + Math.floor(rnd() * (cand.length - k));
      var t = cand[k]; cand[k] = cand[j]; cand[j] = t;
      out.push(cand[k]);
    }
    return out.sort(function (a, b) { return a - b; });
  };

  // 起手牌评级：Chen 公式的简化版
  function chen(hole) {
    var a = hole[0], b = hole[1];
    var hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    var v = hi === 14 ? 10 : hi === 13 ? 8 : hi === 12 ? 7 : hi === 11 ? 6 : hi / 2;
    var sc = v;
    if (a.r === b.r) {
      sc = Math.max(5, v * 2);
    } else {
      if (a.s === b.s) sc += 2;
      var gap = hi - lo - 1;
      sc -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && hi < 12) sc += 1;
    }
    return Math.ceil(sc);
  }

  poker.preflopTier = function (hole) {
    if (!hole || hole.length < 2) return 'D';
    var sc = chen(hole);
    return sc >= 12 ? 'S' : sc >= 9 ? 'A' : sc >= 7 ? 'B' : sc >= 5 ? 'C' : 'D';
  };

  /* ---------- AI 对手 ----------
   * 三种风格。params：samples 蒙特卡洛次数；posW 位置权重；noise 随机扰动；
   * betAt/raiseAt 出手加注的胜率门槛；aggr 愿意加注的概率；bluff 诈唬概率；margin 跟注要求的额外胜率（正数=更挑，负数=爱跟）。 */
  var PERSONAS = [
    {
      id: 'lag', name: '彪哥', nick: '油嘴彪', style: '松凶', face: '(￣▽￣)',
      desc: '牌不好也敢加，输了拍桌子大笑，赢了请全场喝酒。',
      lines: ['这把我闭着眼也敢加！', '在这条街，不敢下注的人早回家喝粥去了。', '来来来，跟不跟？怂了就滚。'],
      params: { samples: 110, posW: 0.12, noise: 0.10, betAt: 0.42, raiseAt: 0.50, aggr: 0.75, bluff: 0.12, margin: -0.03 },
    },
    {
      id: 'tag', name: '慢牌老周', nick: '老周', style: '紧凶', face: '(-_-)',
      desc: '一晚上只出两三手牌，出手就要见血，话少但账记得清。',
      lines: ['不急，牌会告诉你答案。', '这城里的钱，都是先从牌桌上流走的。', '这手，我记账了。'],
      params: { samples: 150, posW: 0.05, noise: 0.03, betAt: 0.52, raiseAt: 0.60, aggr: 0.8, bluff: 0.04, margin: 0.06 },
    },
    {
      id: 'station', name: '跟到底阿强', nick: '阿强', style: '跟注站', face: '(^o^)',
      desc: '谁下注都跟，说是“看看又不吃亏”。输赢都不是他的钱，所以很潇洒。',
      lines: ['看看又不吃亏！', '赢了请客，输了也请客，反正钱不是我的。', '跟了跟了，别催。'],
      params: { samples: 110, posW: 0.03, noise: 0.08, betAt: 0.72, raiseAt: 0.86, aggr: 0.18, bluff: 0, margin: -0.12 },
    },
  ];
  poker.PERSONAS = PERSONAS;
  poker.personaById = function (id) {
    for (var i = 0; i < PERSONAS.length; i++) if (PERSONAS[i].id === id) return PERSONAS[i];
    return PERSONAS[0];
  };

  poker.ai = {};

  // 位置：庄家最好，枪口次之，大小盲最差
  function positionScore(h, i) {
    var n = h.seats.length, d = (i - h.dealer + n) % n;
    if (d === 0) return 1;
    if (d === n - 1) return 0.7;
    if (d === 1) return 0.2;
    return 0.4;
  }

  function raiseAction(L, to) {
    if (!L.canRaise) return L.canCheck ? { t: 'check' } : { t: 'call' };
    to = Math.round(to);
    if (to >= L.maxTo) return { t: 'allin' };
    if (to < L.minTo) to = L.minTo;
    return { t: 'raise', to: to };
  }

  poker.ai.decide = function (h, i, persona, rnd) {
    rnd = rnd || Math.random;
    var P = (persona && persona.params) || PERSONAS[0].params;
    var s = h.seats[i], L = poker.legal(h, i);
    var nOpp = 0;
    h.seats.forEach(function (o, j) { if (j !== i && !o.folded) nOpp++; });
    var pot = L.pot;
    var eq = poker.equity(s.hole, h.board, Math.max(1, nOpp), P.samples, rnd);
    eq += (positionScore(h, i) - 0.5) * P.posW + (rnd() - 0.5) * P.noise;
    eq = clamp(eq, 0, 1);

    if (L.canCheck) {
      if (L.canRaise && eq >= P.betAt && rnd() < P.aggr) {
        return raiseAction(L, L.curBet + Math.max(h.minRaise, pot * (0.5 + rnd() * 0.4)));
      }
      if (L.canRaise && h.street !== 'pre' && rnd() < P.bluff) {
        return raiseAction(L, L.curBet + Math.max(h.minRaise, pot * 0.4));
      }
      return { t: 'check' };
    }
    var need = L.toCall / (pot + L.toCall);
    if (L.canRaise && eq >= P.raiseAt && rnd() < P.aggr) {
      return raiseAction(L, L.curBet + Math.max(h.minRaise, (pot + L.toCall) * (0.6 + rnd() * 0.3)));
    }
    if (eq - P.margin >= need) return { t: 'call' };
    if (L.canRaise && h.street !== 'pre' && rnd() < P.bluff * 0.3) {
      return raiseAction(L, L.curBet + Math.max(h.minRaise, pot * 0.6));
    }
    return { t: 'fold' };
  };

  /* ---------- 存档模块 ---------- */
  poker.defaultState = function () {
    return {
      scammed: false,                                  // 是否已经被老千坑过一次（剧情只触发一次）
      scam: null,                                      // 剧情进行中的状态（cardroom.js）
      stats: { hands: 0, net: 0, biggest: 0 },         // 手数、累计盈亏、单手最多拿回的筹码
      learned: {},                                     // 课程 id -> 学习次数
      studyDay: { day: 0, n: 0 },                      // 当天已学习次数
      study: null,                                     // 学习进行中：{id, t, total, phase, ...}
      table: null,                                     // 牌桌（cardroom.js）
      intelDay: { day: 0, n: 0 },                      // 情报贩子：当天已买次数（cardroom.js）
      intel: null,                                     // 当天买到的那条情报 {day, text, src, rel}
      intelLog: [],                                    // 最近的情报记录（最多 8 条）
    };
  };

  poker.state = function () {
    var s = G.state;
    if (!s) return null;
    if (!s.poker || typeof s.poker !== 'object') s.poker = poker.defaultState();
    return s.poker;
  };

  if (G.registerModule) G.registerModule({ id: 'poker', defaults: poker.defaultState });

  /* ============================================================
   * 电脑学习：课程与小测验
   * ============================================================ */
  var STUDY_TITLE = '德州扑克 · 电脑学习';
  var STUDY_PER_DAY = 3;
  var STUDY_MIN_ENERGY = 15;
  var STUDY_ENERGY = 10;

  var LESSONS = [
    {
      id: 'range', title: '起手牌范围', lv: 0, cost: 0, sec: 8,
      desc: '先决定打不打，再决定怎么打。',
      body: [
        '德扑的第一课：先决定要不要玩这手牌，再决定怎么玩。',
        '强牌可以大方加注：AA、KK、QQ，以及同花的 AK。',
        '能玩的牌：中等对子、同花连张（如 98 同花）、A 高同花。',
        '杂牌（如 72 不同花）大多数时候直接弃掉，省下的筹码就是你的利润。',
        '别因为“我有一对”就舍不得弃。一对小牌遇上别人的大牌，可能就是废纸。',
      ],
      quiz: { q: '翻牌前，下面哪手起手牌最强？', opts: ['K♠ Q♦（不同花）', 'A♣ A♥（口袋 A）', '9♠ 8♠（同花连张）'], a: 1, exp: '口袋 A 是翻牌前赢面最大的起手牌之一。' },
    },
    {
      id: 'position', title: '位置', lv: 1, cost: 0, sec: 9,
      desc: '越晚行动，看到的信息越多。',
      body: [
        '位置就是你行动的先后。越晚行动，越能看清别人怎么打，优势越大。',
        '前位（早行动）要收紧范围：没人替你先看牌，每次出手都要更有把握。',
        '按钮位（最后行动）可以玩得更宽，常用“偷盲”赚钱：大家都过牌时，下注把底池拿走。',
        '同一手牌，在按钮位和枪口位，该打还是该弃，可能完全不一样。',
      ],
      quiz: { q: '你坐在按钮位，前面的人都过牌，你拿着 Q♥ J♥，该怎么办？', opts: ['谨慎弃掉，牌太弱', '可以跟注或加注，利用位置优势偷池', '必须全下'], a: 1, exp: '位置好的时候，适度放宽、偷池是正常打法。' },
    },
    {
      id: 'outs', title: '听牌与补牌', lv: 2, cost: 20, sec: 10,
      desc: '手里还差几张，能凑成更大的牌？',
      body: [
        '听牌：手里的牌再补一两张，就能成更大的牌型。',
        '同花听牌（4 张同花色）：还剩 9 张能补成同花，这 9 张叫 outs。',
        '两头顺（如 8、9 配上 5、6、7 中的两张）：有 8 张可以补成顺子。',
        '估算胜率的经验法则：翻牌后到河牌约 outs × 4%，转牌后到河牌约 outs × 2%。',
      ],
      quiz: { q: '翻牌后你有同花听牌（4 张同花色），牌库里有几张能补成同花？', opts: ['4 张', '9 张', '13 张'], a: 1, exp: '同花色一共 13 张，已见 4 张，还剩 9 张。' },
    },
    {
      id: 'pot_odds', title: '底池赔率', lv: 4, cost: 30, sec: 12,
      desc: '跟注前先算一笔账。',
      body: [
        '跟注前算一笔账：你要花的钱，相对于能赢的钱，划不划算。',
        '需要的胜率 = 跟注额 ÷（底池 + 跟注额）。',
        '例：底池 100，对手下注 50，你要跟 50，需要胜率 = 50 ÷ 150 ≈ 33%。',
        '你估计自己有 40% 的胜率，就该跟；只有 20%，就该弃。',
      ],
      quiz: { q: '底池 100，对手下注 50，你需要的最低胜率约为？', opts: ['25%', '33%', '50%'], a: 1, exp: '50 ÷ (100 + 50) ≈ 33%。' },
    },
    {
      id: 'reading', title: '读牌', lv: 6, cost: 50, sec: 14,
      desc: '读的是行为模式，不是心思。',
      body: [
        '读牌不是读心，是读行为模式。',
        '下注大小很关键：小注常是试探或保护；突然的大注，通常代表真牌（或者他想让你这么以为）。',
        '思考时间也有信息：突然停顿可能在纠结，秒下注往往是有把握，或者在演。',
        '分清对手类型：跟注站很少弃牌，紧手很少下注。对他们的大注，要分别对待。',
      ],
      quiz: { q: '对手一直跟注、很少加注，你通常该怎么看他？', opts: ['他多半只是爱看牌，诈唬少，他大注时才要认真对待', '他一定在诈唬，要多加注', '读不出来，直接弃牌'], a: 0, exp: '跟注型对手诈唬少，大注通常代表真牌，应该尊重。' },
    },
    {
      id: 'bluff', title: '诈唬与反诈唬', lv: 8, cost: 80, sec: 15,
      desc: '诈唬只对会弃牌的人有用。',
      body: [
        '诈唬是用下注让对手弃牌。它只在对手“会弃牌”时才有效。',
        '对跟注站诈唬很傻：他几乎不弃牌，你的钱会打水漂。对紧手诈唬，他一旦大注，你就该服。',
        '诈唬的时机：前几条街的打法要自洽，底牌最好有听牌或阻挡牌（挡住对手的关键牌）。',
        '反诈唬：别被一个大注吓跑，先算赔率。对手可能在诈唬，但你不必每次都上当。',
      ],
      quiz: { q: '对一个跟注站玩诈唬，最主要的问题是？', opts: ['他会弃牌太多，诈唬很赚', '他几乎不弃牌，诈唬很难奏效', '牌局太大，没法下注'], a: 1, exp: '诈唬靠的是让对手弃牌，跟注站几乎不弃牌，诈唬就很难成功。' },
    },
  ];
  poker.LESSONS = LESSONS;

  function lessonById(id) {
    for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i];
    return null;
  }

  function skillLv() { return G.skills && G.skills.level ? G.skills.level('poker') : 0; }
  function pct(x) { return Math.round(clamp(x, 0, 1) * 100) + '%'; }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function btn(text, cls, onClick, disabled) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.disabled = !!disabled;
    b.addEventListener('click', function () { b.blur(); onClick(); });
    return b;
  }
  function rebuildStudy() {
    if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel();
  }
  function toast(msg) { if (G.ui && G.ui.toast) G.ui.toast(msg); }

  var studyCss = [
    '.pk-lesson { padding:8px 0; border-top:1px dashed #7b719c; }',
    '.pk-lesson:first-child { border-top:none; }',
    '.pk-body { font-size:12px; line-height:18px; color:#e6dcc6; margin-top:4px; }',
    '.pk-body p { margin-top:4px; }',
    '.pk-block { font-size:11px; color:#ffb3b3; margin-top:4px; }',
    '.pk-lesson .bigbtn { margin-top:6px; }',
    '.pk-quiz button { display:block; width:100%; min-height:44px; margin-top:6px; text-align:left; font-size:13px; }',
    '.pk-prog { height:12px; }',
  ].join('\n');
  var styled = false;
  function ensureStyle() {
    if (styled) return;
    styled = true;
    try {
      if (document.getElementById('poker-style')) return;
      var st = document.createElement('style');
      st.id = 'poker-style';
      st.textContent = studyCss;
      document.head.appendChild(st);
    } catch (e) { /* 无 DOM 时忽略 */ }
  }

  var studyRefs = null;
  var studySig = '';

  function studySignature() {
    var p = poker.state();
    return p && p.study ? p.study.id + ':' + p.study.phase : 'list';
  }

  function usedToday(p) {
    return p.studyDay && p.studyDay.day === G.state.day ? p.studyDay.n : 0;
  }

  function studyBlockReason(L, p) {
    if (skillLv() < L.lv) return '需要牌技 Lv' + L.lv;
    if (usedToday(p) >= STUDY_PER_DAY) return '今天学够了，明天再来';
    if (G.state.needs.energy < STUDY_MIN_ENERGY) return '太累了，先去休息';
    if (L.cost && !G.economy.canAfford(L.cost)) return '钱不够';
    return '';
  }

  function startLesson(L) {
    var p = poker.state();
    if (!p || p.study) return;
    var why = studyBlockReason(L, p);
    if (why) { toast(why); return rebuildStudy(); }
    if (L.cost) G.economy.spend(L.cost);
    var stamina = G.skills && G.skills.bonus ? G.skills.bonus('stamina') : 1;
    G.economy.applyUse(null, { effect: { energy: -Math.round(STUDY_ENERGY * stamina), hunger: -4 } });
    if (!p.studyDay || p.studyDay.day !== G.state.day) p.studyDay = { day: G.state.day, n: 0 };
    p.studyDay.n += 1;
    p.study = { id: L.id, t: 0, total: L.sec, phase: 'learn' };
    G.log('开始学习「' + L.title + '」，大约 ' + L.sec + ' 秒');
    rebuildStudy();
  }

  function finishStudy(p) {
    var L = lessonById(p.study && p.study.id);
    if (!L) { p.study = null; return; }
    var n = Number(p.learned[L.id]) || 0;
    var xp = n > 0 ? 5 : 30;                  // 首次学习大额经验，重复学习小额
    p.learned[L.id] = n + 1;
    p.study.phase = 'quiz';
    p.study.t = L.sec;
    if (G.skills && G.skills.addXp) G.skills.addXp('poker', xp);
    G.log('学完「' + L.title + '」，牌技经验 +' + xp);
  }

  function answerQuiz(idx) {
    var p = poker.state();
    var L = p && p.study && lessonById(p.study.id);
    if (!L || p.study.phase !== 'quiz') return;
    var ok = idx === L.quiz.a;
    if (ok && G.skills && G.skills.addXp) G.skills.addXp('poker', 12);
    if (ok) G.log('小测验答对了，牌技经验 +12');
    p.study = { id: L.id, phase: 'res', ok: ok, t: L.sec, total: L.sec, exp: L.quiz.exp };
    rebuildStudy();
  }

  function closeStudyResult() {
    var p = poker.state();
    if (p) p.study = null;
    rebuildStudy();
  }

  function skipQuiz() {
    var p = poker.state();
    if (p) p.study = null;
    rebuildStudy();
  }

  function buildStudy(body) {
    var p = poker.state();
    if (!p) return;
    studyRefs = null;
    studySig = studySignature();
    var lv = skillLv();
    var head = el('div', 'sec');
    head.appendChild(el('div', 'shop-name', '牌技 Lv ' + lv + ' / 10'));
    head.appendChild(el('div', 'shop-sub', '今日已学习 ' + usedToday(p) + ' / ' + STUDY_PER_DAY + ' 次 · 学习会消耗精力'));
    body.appendChild(head);

    if (p.study && p.study.phase === 'learn') {
      var L = lessonById(p.study.id);
      if (L) {
        var box = el('div', 'sec');
        box.appendChild(el('div', 'shop-name', '正在学习「' + L.title + '」'));
        var bar = el('div', 'bar pk-prog');
        var fill = el('i', 'fill');
        bar.appendChild(fill);
        box.appendChild(bar);
        var left = el('div', 'shop-sub', '');
        box.appendChild(left);
        var text = el('div', 'pk-body');
        L.body.forEach(function (line) { text.appendChild(el('p', null, line)); });
        box.appendChild(text);
        box.appendChild(el('div', 'shop-sub', '学完会有一个小测验。'));
        body.appendChild(box);
        studyRefs = { fill: fill, left: left, lesson: L };
        updateProgress();
      }
    } else if (p.study && p.study.phase === 'quiz') {
      var Q = lessonById(p.study.id);
      if (Q) {
        var qb = el('div', 'sec');
        qb.appendChild(el('div', 'shop-name', '小测验 · ' + Q.title));
        qb.appendChild(el('div', 'shop-sub', Q.quiz.q));
        var list = el('div', 'pk-quiz');
        Q.quiz.opts.forEach(function (o, idx) {
          list.appendChild(btn(String.fromCharCode(65 + idx) + '. ' + o, 'pbtn', function () { answerQuiz(idx); }));
        });
        qb.appendChild(list);
        qb.appendChild(btn('跳过（不加经验）', 'bigbtn ghost', skipQuiz));
        body.appendChild(qb);
      }
    } else if (p.study && p.study.phase === 'res') {
      var R = lessonById(p.study.id);
      var rb = el('div', 'sec');
      rb.appendChild(el('div', 'shop-name', p.study.ok ? '答对了！' : '答错了。'));
      if (R) rb.appendChild(el('div', 'pk-body', R.quiz.exp));
      if (p.study.ok) rb.appendChild(el('div', 'shop-sub', '牌技经验 +12'));
      rb.appendChild(btn('返回课程表', 'bigbtn', closeStudyResult));
      body.appendChild(rb);
    } else {
      LESSONS.forEach(function (L2) {
        var row = el('div', 'pk-lesson');
        var learned = Number(p.learned[L2.id]) || 0;
        row.appendChild(el('div', 'shop-name', L2.title + (learned ? '　✓ 已学 ×' + learned : '')));
        row.appendChild(el('div', 'shop-sub', '牌技 Lv' + L2.lv + ' · 约 ' + L2.sec + ' 秒 · ' + (L2.cost ? '花费 🪙' + L2.cost : '免费')));
        row.appendChild(el('div', 'pk-body', L2.desc));
        var why = studyBlockReason(L2, p);
        if (why) row.appendChild(el('div', 'pk-block', why));
        row.appendChild(btn(why ? '暂不能学' : (learned ? '复习（小额经验）' : '学习'), 'bigbtn', function () { startLesson(L2); }, !!why));
        body.appendChild(row);
      });
    }
    body.appendChild(btn('关闭', 'bigbtn ghost', function () { if (G.ui && G.ui.closeShop) G.ui.closeShop(); }));
  }

  function updateProgress() {
    var p = poker.state();
    if (!studyRefs || !p || !p.study || p.study.phase !== 'learn') return;
    var total = Math.max(0.1, p.study.total);
    var pctDone = clamp(p.study.t / total, 0, 1);
    studyRefs.fill.style.width = (pctDone * 100) + '%';
    studyRefs.left.textContent = '剩余约 ' + Math.max(0, Math.ceil(total - p.study.t)) + ' 秒';
  }

  function tickStudy() {
    var sig = studySignature();
    if (sig !== studySig) { rebuildStudy(); return; }
    updateProgress();
  }

  poker.openStudy = function () {
    if (!G.ui || !G.ui.openPanel || !G.state) return;
    ensureStyle();
    G.ui.openPanel({ title: STUDY_TITLE, build: buildStudy, tick: tickStudy });
  };

  /* ---------- 每帧 ---------- */
  poker.update = function (dt) {
    var p = poker.state();
    if (!p) return;
    if (p.study && p.study.phase === 'learn') {
      p.study.t += dt;
      if (p.study.t >= p.study.total) finishStudy(p);
    }
    if (G.cardroom && G.cardroom.tick) G.cardroom.tick(dt);
  };

  G.poker = poker;
})();
