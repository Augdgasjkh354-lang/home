/* ============================================================
 * 像素小家 —— 炒股（stocks.js）
 * 只往 G.stocks 上挂接口。静态数据在 stocks-data.js（G.STOCKS、G.STOCK_EVENTS）。
 * 存档字段 G.state.stocks，通过 G.registerModule 注册（见下方 defaults）。
 *
 * 接口：
 *   G.stocks.openPanel()                   打开炒股面板（电脑菜单「炒股」调用）
 *   G.stocks.update(dt)                    每帧调用；按游戏时间（每游戏小时）推进价格，离线/暂停不推进
 *   G.stocks.priceOf(code) -> number       现价（元）
 *   G.stocks.holding(code) -> {n, cost, avg} | null
 *   G.stocks.portfolioValue() -> number    持仓市值
 *   G.stocks.quote(code, side, q) -> {price, amt, fee, rate, total}   side: 'buy'|'sell'
 *   G.stocks.buy(code, q) / G.stocks.sell(code, q) -> {ok, reason?}
 *   G.stocks.feeRate() -> number           当前手续费率（基础费率 × 投资系数）
 *   G.stocks.news() -> [{...}]             当前可见的新闻（按发布时间倒序）
 *   G.stocks.forecast() -> {[code]: {day, p0, p1, pct}}   明日（day 为天序号，从 0 起）精确涨跌，见下
 *   G.stocks.oracle(code) -> {ok, reason?}  观星（投资 Lv7 起，次数见 G.stocks.oracleLeft()）
 *   G.stocks.oracleLeft() -> number        本周期（Lv7/8 每周，Lv9 每天）剩余观星次数
 *   G.stocks.revealed(code) -> bool        今天是否已观星该股票
 *
 * 价格模型（对数价格偏离 x，每游戏小时）：
 *   x' = x + κ(0 - x) + 行业日内趋势 + 事件冲击流 + σ·ε - σ²/2
 *   价格 = 基准价 · e^x，且不低于 1 元。日内趋势每天求和为 0，不产生长期漂移。
 * 精确预知：每个游戏日开始时预抽当日与次日的 ε（存 s.nz）与次日事件（s.evDay 记录已生成到哪天）。
 *   价格路径完全由「当前状态 + 预抽 ε + 事件」决定，所以用同一公式向前模拟得到的明日涨跌，
 *   与之后实际发生的涨跌完全一致（同一套浮点运算，误差为 0）。
 * 事件：城市事件有「预告」（先发新闻，生效前若干小时市场开始反应）、「突发」（发布与生效几乎同时）、
 *   「追踪」（生效后才发新闻）三种。新闻到达玩家有延迟：投资 Lv3 前 3 小时，Lv3 起 1 小时。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var stocks = (G.stocks = G.stocks || {});

  var FEE_BASE = 0.012;          // 基础手续费率（1.2%），实际 × G.skills.bonus('invest')
  var HIST_MAX = 720;            // 保留最近 30 个游戏日的逐小时价格
  var WEEK_H = 168;
  var PRE_SHARE = 0.25;          // 预告事件中，在公告到生效之间提前反应的比例
  var RECENT_N = 6;              // 最近 N 个事件模板不重复抽取
  var KEEP_H = 24 * 21;          // 新闻保留 21 天
  var INTRADAY_LV = 6;           // 情绪指数解锁等级
  var TENDENCY_LV = 6;           // 明日倾向（模糊版，只看均值路径）解锁等级
  var EXACT_LV = 9;              // 明日倾向由精确预知取代（观星每天 1 次）
  var ORACLE_LV = 7;             // 观星解锁等级
  var ORACLE_ALL_LV = 10;        // 行情列表直接显示全部股票的明日精确涨跌
  var WEEK_DAYS = 7;             // 观星次数的刷新周期（天）
  var NEWS_LV = 3;               // 新闻延迟降低的等级
  var BACKFILL_H = 168;   // 开局前补算 7 天价格（无事件、无分红），让走势图开局即有内容

  var VIEW_LIST = 'list', VIEW_DETAIL = 'detail', VIEW_HOLD = 'hold', VIEW_NEWS = 'news';

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function round6(v) { return Math.round(v * 1000000) / 1000000; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function gauss() {
    var u = 0, v = 0;
    while (!u) u = Math.random();
    v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
  function fmtTime(h) { return '第 ' + (Math.floor(h / 24) + 1) + ' 天 ' + pad2(h % 24) + ':00'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }

  function allCfg() { return G.STOCKS || []; }
  function cfgOf(code) {
    var list = allCfg();
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }
  function sigmaOf(cfg) { return cfg.dailyVol / Math.sqrt(24); }        // 每小时标准差
  function xMin(cfg) { return Math.max(-3, Math.log(1 / cfg.base)); }   // 价格不低于 1 元
  function priceFromX(cfg, x) { return Math.max(1, round2(cfg.base * Math.exp(x))); }

  function skillLevel(id) { return G.skills && G.skills.level ? G.skills.level(id) : 0; }
  function skillBonus(id) { return G.skills && G.skills.bonus ? G.skills.bonus(id) : 1; }

  function cash() { return G.state ? Number(G.state.money) || 0 : 0; }
  function earn(n) {
    if (G.economy && G.economy.earn) G.economy.earn(n);
    else G.state.money += n;
  }
  function spend(n) {
    if (G.economy && G.economy.spend) G.economy.spend(n);
    else G.state.money -= n;
  }
  function canAfford(n) {
    if (G.economy && G.economy.canAfford) return !!G.economy.canAfford(n);
    return cash() >= n;
  }

  function nowHours() {
    var g = G.state;
    return (Number(g.day) - 1) * 24 + Number(g.time);
  }

  /* ---------- 存档模块 ---------- */
  function defaults() {
    var px = {}, hist = { h: [], p: {} };
    allCfg().forEach(function (c) {
      px[c.code] = { x: 0, p: c.base };
      hist.p[c.code] = [];
    });
    return {
      lastH: -1,          // 已推进到的整点（绝对游戏小时）；-1 表示尚未初始化
      px: px,             // 每只股票：x 对数偏离，p 当前价
      hist: hist,         // 逐小时价格：h 为整点数组，p[code] 为对应价格数组
      hold: {},           // 持仓：{ [code]: {n 股数, cost 总成本（含手续费）} }
      events: [],         // 城市事件（含未来的）
      recent: [],         // 最近抽过的事件模板 id
      realized: 0,        // 已实现盈亏
      divIncome: 0,       // 累计分红
      feesPaid: 0,        // 累计手续费
      nz: {},             // 预抽噪声：{ [天序号]: { [code]: [24 个标准正态 ε] } }，只保留当天及次日
      evDay: -1,          // 事件已生成到的天序号（-1 表示未知，旧档迁移时置为当天）
      oc: {               // 观星次数：wk/wu 为周计数（Lv7/8），dy/du 为日计数（Lv9），rev 为今天已观星的股票 {code: 天序号}
        wk: -1, wu: 0, dy: -1, du: 0, rev: {},
      },
    };
  }

  if (G.registerModule) G.registerModule({ id: 'stocks', defaults: defaults });

  function S() {
    var g = G.state;
    if (!g) return null;
    if (!g.stocks || typeof g.stocks !== 'object') g.stocks = defaults();
    return g.stocks;
  }

  /* ---------- 事件与新闻 ---------- */
  function pickTpl(s) {
    var all = G.STOCK_EVENTS || [];
    var pool = all.filter(function (t) { return s.recent.indexOf(t.id) < 0; });
    if (!pool.length) pool = all;
    var total = 0;
    pool.forEach(function (t) { total += t.w || 1; });
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= pool[i].w || 1;
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1] || null;
  }

  // 生成一个事件：公告时刻 announce，生效时刻 start，冲击在 ramp 小时内完成，hold 小时后开始回落
  function makeEvent(tpl, dayStart) {
    var kind = tpl.kind, announce, start, ramp, pre;
    if (kind === 'pre') {
      announce = dayStart + randInt(0, 12);
      start = announce + randInt(8, 28);
      ramp = 6;
      pre = PRE_SHARE;
    } else if (kind === 'late') {
      start = dayStart + randInt(4, 18);
      announce = start + randInt(3, 7);
      ramp = randInt(3, 6);
      pre = 0;
    } else {
      announce = dayStart + randInt(6, 20);
      start = announce + 1;
      ramp = randInt(2, 4);
      pre = 0;
    }
    var hold = randInt(12, 36), fade = randInt(36, 96);
    var text = tpl.text;
    if (kind === 'pre') text += '（约 ' + (start - announce) + ' 小时后生效）';
    var imp = {};
    Object.keys(tpl.imp || {}).forEach(function (code) {
      imp[code] = round4(tpl.imp[code] * (0.8 + Math.random() * 0.35));
    });
    return {
      id: tpl.id, kind: kind, title: tpl.title, text: text, imp: imp,
      announce: announce, start: start, ramp: ramp, hold: hold, fade: fade,
      end: start + ramp + hold, pre: pre, keep: round4(0.2 + Math.random() * 0.3),
    };
  }

  // 每个游戏日开始时随机生成 0~2 个事件（只保留公告时刻不早于 minH 的）
  function genDay(s, dayStart, minH) {
    var r = Math.random(), n = r < 0.5 ? 0 : r < 0.9 ? 1 : 2;
    for (var k = 0; k < n; k++) {
      var tpl = pickTpl(s);
      if (!tpl) break;
      s.recent.push(tpl.id);
      if (s.recent.length > RECENT_N) s.recent.splice(0, s.recent.length - RECENT_N);
      var ev = makeEvent(tpl, dayStart);
      if (ev.announce >= minH) s.events.push(ev);
    }
    s.events = s.events.filter(function (e) {
      return e.announce > dayStart - KEEP_H || e.end + e.fade > dayStart;
    });
  }

  // 某只股票在整点 H 的事件冲击流（对数收益率增量）
  function flowOf(events, code, H) {
    var f = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i], m = e.imp[code];
      if (!m) continue;
      if (e.pre > 0 && H >= e.announce && H < e.start) f += m * e.pre / Math.max(1, e.start - e.announce);
      if (H >= e.start && H < e.start + e.ramp) f += m * (1 - e.pre) / e.ramp;
      if (H >= e.end && H < e.end + e.fade) f -= m * (1 - e.keep) / e.fade;
    }
    return f;
  }

  function newsLag() { return skillLevel('invest') >= NEWS_LV ? 1 : 3; }

  function visibleNews(s, nowH) {
    var lag = newsLag();
    return s.events
      .filter(function (e) { return nowH >= e.announce + lag; })
      .sort(function (a, b) { return b.announce - a.announce; });
  }

  /* ---------- 价格推进 ---------- */
  function pushHist(s, h) {
    var hi = s.hist;
    hi.h.push(h);
    allCfg().forEach(function (c) {
      var arr = hi.p[c.code] || (hi.p[c.code] = []);
      arr.push(s.px[c.code].p);
    });
    if (hi.h.length > HIST_MAX) {
      var cut = hi.h.length - HIST_MAX;
      hi.h.splice(0, cut);
      Object.keys(hi.p).forEach(function (k) { hi.p[k].splice(0, cut); });
    }
  }

  function payDividends(s) {
    var total = 0, names = [];
    allCfg().forEach(function (c) {
      var hd = s.hold[c.code];
      if (!hd || !(hd.n > 0) || !(c.yield > 0)) return;
      var amt = Math.round(hd.n * s.px[c.code].p * c.yield / 4);
      if (amt > 0) { total += amt; names.push(c.name); }
    });
    if (total > 0) {
      earn(total);
      s.divIncome = round2(s.divIncome + total);
      G.log('分红到账 ' + total + ' 元（' + names.join('、') + '）');
    }
  }

  /* ---------- 每日预抽：噪声与事件提前一天生成，使「明日涨跌」可以精确预知 ---------- */
  function ensureNoise(s, d) {
    var key = String(d);
    if (s.nz[key] && typeof s.nz[key] === 'object') return;
    var ent = {};
    allCfg().forEach(function (c) {
      var arr = [];
      for (var i = 0; i < 24; i++) arr.push(round6(gauss()));
      ent[c.code] = arr;
    });
    s.nz[key] = ent;
  }

  // 第 H 小时某只股票的 ε：已预抽则用预抽值（价格路径的唯一随机来源），否则现抽（仅开局前补算）
  function epsOf(s, H, code) {
    var d = Math.floor(H / 24), ent = s.nz[String(d)];
    var arr = ent && ent[code];
    var v = arr ? arr[H - d * 24] : undefined;
    return typeof v === 'number' && isFinite(v) ? v : gauss();
  }

  // 保证第 k 天、第 k+1 天的噪声已预抽，且事件已生成到第 k+1 天；丢弃更早的噪声。
  // 第 k+1 天的事件只影响第 k+1 天及以后的价格（flowOf 的各阶段都不早于公告/生效时刻），
  // 所以提前生成不会改变第 k 天已经发生的走势。initH：开局当天的事件只保留公告不早于 initH 的。
  function ensureDays(s, k, initH) {
    ensureNoise(s, k);
    ensureNoise(s, k + 1);
    while (s.evDay < k + 1) {
      s.evDay += 1;
      var ds = s.evDay * 24;
      genDay(s, ds, s.evDay === k && initH !== undefined ? initH : ds);
    }
    Object.keys(s.nz).forEach(function (key) { if (Number(key) < k) delete s.nz[key]; });
  }

  // 推进一个整小时：从 H 到 H+1；quiet 为补算模式（不派息）
  function stepHour(s, H, quiet) {
    var hod = H % 24;
    allCfg().forEach(function (c) {
      var p = s.px[c.code] || (s.px[c.code] = { x: 0, p: c.base });
      var sg = sigmaOf(c);
      var mu = c.amp * Math.cos(2 * Math.PI * (hod - c.peak) / 24);   // 行业日内趋势，一天求和为 0
      var flow = flowOf(s.events, c.code, H);
      var x = p.x + c.kappa * (0 - p.x) + mu + flow + sg * epsOf(s, H, c.code) - 0.5 * sg * sg;
      p.x = clamp(x, xMin(c), 2.5);
      p.p = priceFromX(c, p.x);
    });
    pushHist(s, H + 1);
    var nd = (H + 1) / 24;                       // 新的一天序号（从 0 起）
    if (!quiet && (H + 1) % 24 === 0 && nd % G.SEASON_DAYS === 0) payDividends(s);   // 每季度（7 天）派息
  }

  stocks.update = function () {
    var g = G.state;
    if (!g || g.paused) return;
    var s = S();
    if (!s) return;
    var nowH = nowHours();
    if (!(s.lastH >= 0)) {                       // 首次初始化：先补算开局前 7 天的走势，再预抽当天与次日
      var H0 = Math.floor(nowH);
      for (var hb = H0 - BACKFILL_H; hb < H0; hb++) stepHour(s, hb, true);
      s.lastH = H0;
      if (!s.hist.h.length) pushHist(s, H0);
      s.evDay = Math.floor(H0 / 24) - 1;
      ensureDays(s, Math.floor(H0 / 24), H0);
      return;
    }
    if (s.lastH > nowH + 1) s.lastH = Math.floor(nowH);   // 时间回退（异常存档）
    if (!(s.evDay >= 0)) s.evDay = Math.floor(s.lastH / 24);   // 旧档迁移：当天事件已由旧逻辑生成
    ensureDays(s, Math.floor(s.lastH / 24));
    var guard = 0;
    while (s.lastH + 1 <= nowH && guard++ < 200000) {     // 跨多天也一次补算
      stepHour(s, s.lastH);
      s.lastH += 1;
      if (s.lastH % 24 === 0) ensureDays(s, s.lastH / 24);
    }
  };

  /* ---------- 行情查询 ---------- */
  function priceOf(code) {
    var s = S();
    return s && s.px[code] ? s.px[code].p : 0;
  }

  // n 小时前的价格（没有则返回 0）
  function priceBack(s, code, hours) {
    var arr = s.hist.p[code] || [];
    var idx = arr.length - 1 - hours;
    return idx >= 0 ? arr[idx] : 0;
  }

  function changeOf(s, code, hours) {
    var prev = priceBack(s, code, hours);
    return prev > 0 ? priceOf(code) / prev - 1 : 0;
  }

  function holding(code) {
    var s = S();
    var hd = s && s.hold[code];
    if (!hd || !(hd.n > 0)) return null;
    return { n: hd.n, cost: hd.cost, avg: hd.cost / hd.n };
  }

  function portfolioValue() {
    var s = S(), total = 0;
    if (!s) return 0;
    Object.keys(s.hold).forEach(function (code) {
      if (s.hold[code] && s.hold[code].n > 0) total += s.hold[code].n * priceOf(code);
    });
    return round2(total);
  }

  function feeRate() { return FEE_BASE * skillBonus('invest'); }

  function xpFor(amt) { return amt < 200 ? 3 : amt < 1000 ? 5 : 8; }

  function quote(code, side, q) {
    var p = priceOf(code), rate = feeRate();
    var amt = Math.round(p * q);
    var fee = Math.max(1, Math.round(amt * rate));
    var total = side === 'buy' ? amt + fee : amt - fee;
    return { price: p, qty: q, amt: amt, fee: fee, rate: rate, total: total };
  }

  function maxBuy(code) {
    var money = Math.floor(cash());
    var p = priceOf(code);
    if (!(p > 0)) return 0;
    var q = Math.max(0, Math.floor(money / (p * (1 + feeRate()))));
    while (q > 0 && quote(code, 'buy', q).total > money) q--;
    while (quote(code, 'buy', q + 1).total <= money) q++;
    return q;
  }

  /* ---------- 交易 ---------- */
  function buy(code, q) {
    var s = S(), cfg = cfgOf(code);
    q = Math.floor(Number(q));
    if (!s || !cfg) return { ok: false, reason: '没有这只股票' };
    if (!(q > 0)) return { ok: false, reason: '买入数量不对' };
    var qt = quote(code, 'buy', q);
    if (!canAfford(qt.total)) {
      return { ok: false, reason: '钱不够：买 ' + q + ' 股需 ' + qt.total + ' 元，现金 ' + Math.floor(cash()) + ' 元' };
    }
    spend(qt.total);
    var hd = s.hold[code] || (s.hold[code] = { n: 0, cost: 0 });
    hd.n += q;
    hd.cost = round2(hd.cost + qt.total);
    s.feesPaid = round2(s.feesPaid + qt.fee);
    if (G.skills && G.skills.addXp) G.skills.addXp('invest', xpFor(qt.amt));
    G.log('买入 ' + cfg.name + ' ' + q + ' 股，成交 ' + qt.amt + ' 元，手续费 ' + qt.fee + ' 元');
    return { ok: true, amt: qt.amt, fee: qt.fee, total: qt.total };
  }

  function sell(code, q) {
    var s = S(), cfg = cfgOf(code);
    q = Math.floor(Number(q));
    if (!s || !cfg) return { ok: false, reason: '没有这只股票' };
    var hd = s.hold[code];
    if (!hd || !(hd.n > 0)) return { ok: false, reason: '没有「' + cfg.name + '」的持仓' };
    if (!(q > 0)) return { ok: false, reason: '卖出数量不对' };
    if (q > hd.n) return { ok: false, reason: '持仓不足：「' + cfg.name + '」只有 ' + hd.n + ' 股' };
    var qt = quote(code, 'sell', q);
    var costSold = (hd.cost / hd.n) * q;
    earn(qt.total);
    s.realized = round2(s.realized + qt.total - costSold);
    s.feesPaid = round2(s.feesPaid + qt.fee);
    hd.cost = round2(hd.cost - costSold);
    hd.n -= q;
    if (hd.n <= 0) delete s.hold[code];
    if (G.skills && G.skills.addXp) G.skills.addXp('invest', xpFor(qt.amt));
    G.log('卖出 ' + cfg.name + ' ' + q + ' 股，成交 ' + qt.amt + ' 元，手续费 ' + qt.fee + ' 元，到账 ' + qt.total + ' 元');
    return { ok: true, amt: qt.amt, fee: qt.fee, total: qt.total };
  }

  /* ---------- 情绪与明日倾向（投资 Lv6 / Lv9 解锁，仅作提示） ---------- */
  function sentimentOf(s, code) {
    var now = nowHours(), pressure = 0;
    s.events.forEach(function (e) {
      var m = e.imp[code];
      if (m && now >= e.announce && now < e.end) pressure += m;
    });
    var mom = 0, prev = priceBack(s, code, 24);
    if (prev > 0) mom = Math.log(priceOf(code) / prev);
    var score = clamp(Math.round(pressure * 400 + mom * 300), -100, 100);
    var label = score >= 60 ? '狂热' : score >= 20 ? '乐观' : score > -20 ? '平静' : score > -60 ? '悲观' : '恐慌';
    return { score: score, label: label };
  }

  // 按无噪声的期望路径推算未来 24 小时，给出倾向（不保证）
  function tomorrowOf(s, code) {
    var cfg = cfgOf(code), p = s.px[code];
    if (!cfg || !p) return null;
    var x = p.x, x0 = p.x, H = s.lastH;
    for (var i = 0; i < 24; i++) {
      var hh = H + i;
      var mu = cfg.amp * Math.cos(2 * Math.PI * ((hh % 24) - cfg.peak) / 24);
      x = x + cfg.kappa * (0 - x) + mu + flowOf(s.events, code, hh);
    }
    var pct = Math.exp(x - x0) - 1;
    var label = pct > 0.012 ? '看涨' : pct < -0.012 ? '看跌' : '震荡';
    return { label: label, pct: pct };
  }

  /* ---------- 精确预知：明日涨跌 ---------- */
  // 从当前整点起，用与 stepHour 完全相同的公式（同一批预抽 ε、同一批事件）向前模拟到次日结束
  function forecastAll(s) {
    var out = {};
    if (!(s.lastH >= 0)) return out;
    var k = Math.floor(s.lastH / 24), t = k + 1;
    if (!s.nz[String(k)] || !s.nz[String(t)]) return out;
    allCfg().forEach(function (c) {
      var p = s.px[c.code];
      if (!p) return;
      var sg = sigmaOf(c), x = p.x, xA = null, H, end = 24 * (t + 1);
      for (H = s.lastH; H < end; H++) {
        if (H === 24 * t) xA = x;                              // 次日开盘（24 点）时的状态
        var mu = c.amp * Math.cos(2 * Math.PI * ((H % 24) - c.peak) / 24);
        var flow = flowOf(s.events, c.code, H);
        x = clamp(x + c.kappa * (0 - x) + mu + flow + sg * epsOf(s, H, c.code) - 0.5 * sg * sg, xMin(c), 2.5);
      }
      var p0 = priceFromX(c, xA), p1 = priceFromX(c, x);
      out[c.code] = { day: t, p0: p0, p1: p1, pct: p1 / p0 - 1 };
    });
    return out;
  }

  // 观星：Lv7/8 每周 1/3 次，Lv9 每天 1 次；Lv10 不需要次数（全部可见）
  function curDay() { return Math.floor(nowHours() / 24); }
  function oracleQuota(lv) {
    if (lv >= EXACT_LV) return { per: 'day', n: 1 };
    if (lv >= 8) return { per: 'week', n: 3 };
    if (lv >= ORACLE_LV) return { per: 'week', n: 1 };
    return null;
  }
  function oracleLeft(s, lv) {
    var q = oracleQuota(lv), oc = s.oc;
    if (!q) return 0;
    var d = curDay();
    if (q.per === 'day') return Math.max(0, q.n - (oc.dy === d ? oc.du : 0));
    return Math.max(0, q.n - (oc.wk === Math.floor(d / WEEK_DAYS) ? oc.wu : 0));
  }
  // 下次刷新的显示天数（从 1 起）
  function oracleRefresh(lv) {
    var q = oracleQuota(lv), d = curDay();
    if (q && q.per === 'day') return d + 2;
    return (Math.floor(d / WEEK_DAYS) + 1) * WEEK_DAYS + 1;
  }
  function revealedToday(s, code) { return s.oc.rev[code] === curDay(); }

  function oracle(code) {
    var s = S(), cfg = cfgOf(code), lv = skillLevel('invest');
    if (!s || !cfg) return { ok: false, reason: '没有这只股票' };
    if (lv < ORACLE_LV) return { ok: false, reason: '投资 Lv' + ORACLE_LV + ' 才能观星' };
    if (lv >= ORACLE_ALL_LV) return { ok: true };
    if (revealedToday(s, code)) return { ok: true };
    if (oracleLeft(s, lv) <= 0) return { ok: false, reason: '观星次数用完了，第 ' + oracleRefresh(lv) + ' 天刷新' };
    var d = curDay(), oc = s.oc, q = oracleQuota(lv);
    if (q.per === 'day') {
      if (oc.dy !== d) { oc.dy = d; oc.du = 0; }
      oc.du += 1;
    } else {
      var w = Math.floor(d / WEEK_DAYS);
      if (oc.wk !== w) { oc.wk = w; oc.wu = 0; }
      oc.wu += 1;
    }
    Object.keys(oc.rev).forEach(function (k) { if (oc.rev[k] !== d) delete oc.rev[k]; });
    oc.rev[code] = d;
    G.log('观星：「' + cfg.name + '」明天的涨跌看清楚了');
    return { ok: true };
  }

  // 列表/详情里该显示的明日精确涨跌：Lv10 全部显示，否则只显示今天观星过的
  function fcShown(s, fc, code) {
    if (!fc[code]) return null;
    return skillLevel('invest') >= ORACLE_ALL_LV || revealedToday(s, code) ? fc[code] : null;
  }

  function fcText(f) {
    var arrow = f.pct > 0 ? '▲' : f.pct < 0 ? '▼' : '—';
    return arrow + ' ' + fmtPct(f.pct);
  }

  /* ---------- 对外接口（查询） ---------- */
  stocks.forecast = function () {
    var s = S();
    return s ? forecastAll(s) : {};
  };
  stocks.oracle = oracle;
  stocks.oracleLeft = function () {
    var s = S();
    return s ? oracleLeft(s, skillLevel('invest')) : 0;
  };
  stocks.revealed = function (code) {
    var s = S();
    return !!(s && revealedToday(s, code));
  };
  stocks.priceOf = priceOf;
  stocks.holding = holding;
  stocks.portfolioValue = portfolioValue;
  stocks.quote = quote;
  stocks.feeRate = feeRate;
  stocks.buy = buy;
  stocks.sell = sell;
  stocks.maxBuy = maxBuy;
  stocks.news = function () {
    var s = S();
    return s ? visibleNews(s, nowHours()) : [];
  };

  /* ============================================================
   *  面板
   * ============================================================ */
  var CSS = [
    '.stk-row { display:block; width:100%; text-align:left; margin-top:6px; padding:6px 8px; background:#3a3350; border:2px solid #f3ead8; min-height:44px; }',
    '.stk-line { display:flex; justify-content:space-between; align-items:baseline; gap:6px; }',
    '.stk-name { font-size:14px; }',
    '.stk-sub { font-size:11px; color:#cfc4a8; line-height:15px; }',
    '.stk-num { font-size:14px; text-align:right; white-space:nowrap; }',
    '.stk-big { font-size:22px; line-height:28px; }',
    '.up { color:#ff8a80; }',
    '.down { color:#7fe39a; }',
    '.flat { color:#cfc4a8; }',
    '.stk-tabs .tab { min-height:44px; font-size:13px; }',
    '.stk-canvas { display:block; width:100%; height:auto; image-rendering:pixelated; border:2px solid #1c1a24; background:#1c1a24; margin-top:6px; }',
    '.stk-chips { display:flex; gap:4px; margin-top:6px; }',
    '.stk-chips button { flex:1; min-height:44px; font-size:13px; padding:0 4px; }',
    '.stk-chips button.on { background:#f3ead8; color:#2a2636; }',
    '.stk-qty { display:flex; gap:6px; align-items:center; margin-top:8px; }',
    '.stk-qty button { min-width:52px; min-height:44px; font-size:18px; padding:0; }',
    '.stk-qty .val { flex:1; text-align:center; min-height:44px; line-height:40px; border:2px solid #f3ead8; background:#1c1a24; font-size:15px; }',
    '.stk-sides { display:flex; gap:6px; margin-top:8px; }',
    '.stk-sides button { flex:1; min-height:48px; font-size:15px; }',
    '.stk-buy { background:#a8453f; }',
    '.stk-sell { background:#2f7d5a; }',
    '.stk-kv { display:grid; grid-template-columns:auto 1fr; gap:2px 8px; font-size:12px; line-height:17px; margin-top:6px; }',
    '.stk-kv span:nth-child(odd) { color:#cfc4a8; }',
    '.stk-hint { font-size:11px; color:#8f87a8; line-height:15px; margin-top:4px; }',
    '.stk-tag { display:inline-block; padding:0 4px; border:1px solid #f3ead8; font-size:11px; margin-right:4px; }',
    '.stk-news-title { font-size:13px; margin-top:4px; }',
    '.stk-news-text { font-size:12px; line-height:17px; color:#e6dcc6; margin-top:2px; }',
  ].join('\n');

  var styled = false;
  var view = VIEW_LIST;
  var curCode = null;
  var range = '7d';
  var qtyMode = 1;            // 数字，或 'all'
  var lastSig = '';

  function ensureStyle() {
    if (styled) return;
    styled = true;
    try {
      if (document.getElementById('stocks-style')) return;
      var st = document.createElement('style');
      st.id = 'stocks-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    } catch (e) { /* 无 DOM 时忽略样式 */ }
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function btn(text, cls, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', function (e) { b.blur(); onClick(e); });
    return b;
  }

  function toast(msg) { if (G.ui && G.ui.toast) G.ui.toast(msg); }

  function rebuild() { if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel(); }

  function sig() {
    var s = S();
    if (!s) return '';
    var px = allCfg().map(function (c) { return priceOf(c.code); }).join(',');
    return [view, curCode, range, qtyMode, Math.floor(cash()), skillLevel('invest'), s.lastH,
      px, JSON.stringify(s.hold), visibleNews(s, nowHours()).length, JSON.stringify(s.oc)].join('|');
  }

  function tick() {
    if (sig() !== lastSig) rebuild();
  }

  // 数量：按钮中的「全部」在买入时表示最多能买的股数，卖出时表示全部持仓
  function resolveQty(side, code) {
    if (qtyMode !== 'all') return qtyMode;
    if (side === 'buy') return maxBuy(code);
    var hd = holding(code);
    return hd ? hd.n : 0;
  }

  function summaryBox(s) {
    var mv = portfolioValue();
    var box = el('div', 'sec');
    box.appendChild(el('div', null, '现金 ' + Math.floor(cash()) + ' 元 · 持仓 ' + Math.round(mv) + ' 元'));
    box.appendChild(el('div', null, '总资产 ' + Math.round(cash() + mv) + ' 元'));
    box.appendChild(el('div', 'stk-hint', '投资 Lv' + skillLevel('invest') + ' · 手续费 ' + (feeRate() * 100).toFixed(2) + '%（最低 1 元）'));
    var lv = skillLevel('invest');
    if (lv >= ORACLE_ALL_LV) {
      box.appendChild(el('div', 'stk-hint', '观星：全部股票的明日涨跌已精确可见（见行情）'));
    } else if (lv >= ORACLE_LV) {
      var left = oracleLeft(s, lv);
      box.appendChild(el('div', 'stk-hint', '观星剩余 ' + left + ' 次' + quotaWhen(lv) + ' · 下次刷新：第 ' + oracleRefresh(lv) + ' 天'));
    }
    return box;
  }

  function quotaWhen(lv) {
    return oracleQuota(lv) && oracleQuota(lv).per === 'day' ? '（每天 1 次）' : '（本周 ' + oracleQuota(lv).n + ' 次）';
  }

  function tabsRow() {
    var row = el('div', 'tabs stk-tabs');
    var list = [
      { key: VIEW_LIST, label: '行情' },
      { key: VIEW_HOLD, label: '持仓' },
      { key: VIEW_NEWS, label: '新闻' },
    ];
    list.forEach(function (t) {
      var on = view === t.key || (view === VIEW_DETAIL && t.key === VIEW_LIST);
      row.appendChild(btn(t.label, 'tab' + (on ? ' on' : ''), function () {
        view = t.key;
        curCode = null;
        rebuild();
      }));
    });
    return row;
  }

  function buildList(body, s) {
    body.appendChild(el('div', 'sec', '行情每游戏小时更新一次。点股票看走势、买卖；留意「新闻」，有些消息会提前放出。'));
    var fc = forecastAll(s);
    allCfg().forEach(function (c) {
      var p = priceOf(c.code);
      var ch = changeOf(s, c.code, 24);
      var row = btn('', 'stk-row', function () { openDetail(c.code); });
      var top = el('div', 'stk-line');
      var left = el('div', null);
      left.appendChild(el('div', 'stk-name', c.name + '　' + c.code));
      left.appendChild(el('div', 'stk-sub', c.sector + ' · 风险 ' + riskText(c.risk)));
      top.appendChild(left);
      var right = el('div', 'stk-num');
      right.appendChild(el('div', null, p.toFixed(2) + ' 元'));
      right.appendChild(el('div', cls(ch), fmtPct(ch) + '（24h）'));
      top.appendChild(right);
      row.appendChild(top);
      var hd = holding(c.code);
      var info = hd
        ? '持 ' + hd.n + ' 股 · 盈亏 ' + pnlText(hd.n * p - hd.cost)
        : '未持仓';
      row.appendChild(el('div', 'stk-sub', info));
      var f = fcShown(s, fc, c.code);
      if (f) {
        var fl = el('div', 'stk-sub ' + cls(f.pct), '明日精确预知 ' + fcText(f));
        row.appendChild(fl);
      }
      body.appendChild(row);
    });
  }

  function riskText(r) {
    return ['', '低', '低中', '中', '中高', '高'][r] || '中';
  }

  function pnlText(v) {
    var r = Math.round(v);
    return (r >= 0 ? '+' : '') + r + ' 元';
  }

  function openDetail(code) {
    view = VIEW_DETAIL;
    curCode = code;
    qtyMode = 1;
    rebuild();
  }

  // 走势折线：逐列取最高最低，像素风
  function drawChart(cv, ys) {
    var c = cv.getContext && cv.getContext('2d');
    if (!c) return;
    var W = cv.width, H = cv.height, pad = 4;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#1c1a24';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#332c46';
    for (var g = 1; g < 4; g++) c.fillRect(0, Math.round(g * H / 4), W, 1);
    if (!ys || ys.length < 2) return;
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < ys.length; i++) { if (ys[i] < min) min = ys[i]; if (ys[i] > max) max = ys[i]; }
    if (max - min < 1e-9) { max = min + 1; }
    var n = ys.length;
    function yOf(v) { return Math.round(pad + (1 - (v - min) / (max - min)) * (H - 1 - 2 * pad)); }
    c.fillStyle = ys[n - 1] >= ys[0] ? '#ff8a80' : '#7fe39a';
    for (var x = 0; x < W; x++) {
      var a = Math.floor(x * (n - 1) / (W - 1));
      var b = Math.floor((x + 1) * (n - 1) / (W - 1));
      var lo = Infinity, hi = -Infinity;
      for (var k = a; k <= b && k < n; k++) { if (ys[k] < lo) lo = ys[k]; if (ys[k] > hi) hi = ys[k]; }
      if (lo === Infinity) { lo = hi = ys[a]; }
      var y1 = yOf(hi), y2 = yOf(lo);
      c.fillRect(x, y1, 1, Math.max(1, y2 - y1 + 1));
    }
    var ly = yOf(ys[n - 1]);
    c.fillStyle = '#f3ead8';
    c.fillRect(W - 3, clamp(ly - 1, 0, H - 3), 3, 3);
  }

  function buildDetail(body, s) {
    var cfg = cfgOf(curCode);
    if (!cfg) { view = VIEW_LIST; curCode = null; buildList(body, s); return; }
    var p = priceOf(cfg.code);
    var ch = changeOf(s, cfg.code, 24);

    var back = btn('‹ 返回行情', 'bigbtn small ghost', function () { view = VIEW_LIST; curCode = null; rebuild(); });
    body.appendChild(back);

    var head = el('div', 'stk-line');
    head.appendChild(el('div', 'stk-name', cfg.name + '　' + cfg.code));
    head.appendChild(el('div', 'stk-sub', cfg.sector));
    body.appendChild(head);

    var pr = el('div', 'stk-line');
    pr.appendChild(el('div', 'stk-big', p.toFixed(2) + ' 元'));
    pr.appendChild(el('div', cls(ch), fmtPct(ch) + '（24h）'));
    body.appendChild(pr);

    // 走势图
    var hArr = s.hist.h || [];
    var pArr = s.hist.p[cfg.code] || [];
    var len = Math.min(hArr.length, pArr.length);
    var start = range === '7d' ? Math.max(0, len - WEEK_H) : 0;
    var ys = pArr.slice(start, len);
    var chartSec = el('div', 'sec');
    var chips = el('div', 'stk-chips');
    [['7d', '近 7 天'], ['all', '全部（30 天）']].forEach(function (r) {
      chips.appendChild(btn(r[1], range === r[0] ? 'on' : '', function () { range = r[0]; rebuild(); }));
    });
    chartSec.appendChild(chips);
    var cv = el('canvas', 'stk-canvas');
    cv.width = 160;
    cv.height = 64;
    chartSec.appendChild(cv);
    if (ys.length >= 2) {
      var mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys);
      chartSec.appendChild(el('div', 'stk-hint', '最高 ' + mx.toFixed(2) + ' · 最低 ' + mn.toFixed(2) + ' · 区间 ' + ys.length + ' 小时'));
    } else {
      chartSec.appendChild(el('div', 'stk-hint', '数据还不够，过一会儿再看。'));
    }
    body.appendChild(chartSec);
    drawChart(cv, ys);

    body.appendChild(el('div', 'sec', cfg.desc));

    // 基本面
    var kv = el('div', 'stk-kv');
    [
      ['风险', riskText(cfg.risk)],
      ['分红', cfg.yield > 0 ? (cfg.yield * 100).toFixed(1) + '% / 年（每季度派息）' : '不分红'],
      ['7 天涨跌', fmtPct(changeOf(s, cfg.code, WEEK_H))],
    ].forEach(function (r) {
      kv.appendChild(el('span', null, r[0]));
      kv.appendChild(el('span', null, r[1]));
    });
    body.appendChild(kv);

    // 投资技能解锁的提示
    var lv = skillLevel('invest');
    var sentBox = el('div', 'sec');
    if (lv >= INTRADAY_LV) {
      var se = sentimentOf(s, cfg.code);
      sentBox.appendChild(el('div', null, '情绪指数 ' + (se.score >= 0 ? '+' : '') + se.score + '（' + se.label + '）'));
      sentBox.appendChild(el('div', 'stk-hint', '由近期新闻与 24 小时走势估计，仅供参考。'));
    } else {
      sentBox.appendChild(el('div', 'stk-hint', '投资 Lv' + INTRADAY_LV + ' 解锁：情绪指数'));
    }
    body.appendChild(sentBox);

    // 明日倾向（模糊版）：Lv9 前保留，Lv9 起由精确预知取代
    if (lv < EXACT_LV) {
      var tmBox = el('div', 'sec');
      if (lv >= TENDENCY_LV) {
        var tm = tomorrowOf(s, cfg.code);
        if (tm) {
          tmBox.appendChild(el('div', null, '明日倾向（模糊）：' + tm.label + '（约 ' + fmtPct(tm.pct) + '）'));
          tmBox.appendChild(el('div', 'stk-hint', '只看均值路径，不含随机波动，仅供参考。'));
        }
      } else {
        tmBox.appendChild(el('div', 'stk-hint', '投资 Lv' + TENDENCY_LV + ' 解锁：明日倾向（模糊版）'));
      }
      body.appendChild(tmBox);
    }

    body.appendChild(oracleBox(s, cfg));

    // 相关新闻
    var newsSec = el('div', 'sec');
    newsSec.appendChild(el('div', null, '相关新闻'));
    var rel = visibleNews(s, nowHours()).filter(function (e) { return e.imp[cfg.code] !== undefined; }).slice(0, 3);
    if (!rel.length) newsSec.appendChild(el('div', 'stk-hint', '暂时没有相关新闻。'));
    rel.forEach(function (e) { newsSec.appendChild(newsItem(e)); });
    body.appendChild(newsSec);

    // 持仓
    var hd = holding(cfg.code);
    var holdSec = el('div', 'sec');
    if (hd) {
      holdSec.appendChild(el('div', null, '持有 ' + hd.n + ' 股 · 均价 ' + hd.avg.toFixed(2) + ' 元'));
      holdSec.appendChild(el('div', null, '市值 ' + Math.round(hd.n * p) + ' 元 · 盈亏 ' + pnlText(hd.n * p - hd.cost)));
    } else {
      holdSec.appendChild(el('div', null, '当前未持仓'));
    }
    body.appendChild(holdSec);

    // 交易
    var tradeSec = el('div', 'sec');
    var qRow = el('div', 'stk-qty');
    qRow.appendChild(btn('−', null, function () {
      var cur = qtyMode === 'all' ? 1 : qtyMode;
      qtyMode = Math.max(1, cur - 1);
      rebuild();
    }));
    qRow.appendChild(el('div', 'val', qtyMode === 'all' ? '全部' : qtyMode + ' 股'));
    qRow.appendChild(btn('+', null, function () {
      var cur = qtyMode === 'all' ? 1 : qtyMode;
      qtyMode = Math.min(99999, cur + 1);
      rebuild();
    }));
    tradeSec.appendChild(qRow);

    var chipRow = el('div', 'stk-chips');
    [[1, '1'], [10, '10'], [100, '100'], ['all', '全部']].forEach(function (c) {
      chipRow.appendChild(btn(c[1], qtyMode === c[0] ? 'on' : '', function () { qtyMode = c[0]; rebuild(); }));
    });
    tradeSec.appendChild(chipRow);

    // 摘要：按当前数量估算（「全部」买入为最多能买的股数，卖出为全部持仓）
    var nb = resolveQty('buy', cfg.code), ns = resolveQty('sell', cfg.code);
    tradeSec.appendChild(el('div', 'stk-hint', '现金 ' + Math.floor(cash()) + ' 元，最多可买 ' + nb + ' 股 · 持有 ' + (hd ? hd.n : 0) + ' 股'));
    var sum = el('div', 'stk-kv');
    if (nb > 0) {
      var bq = quote(cfg.code, 'buy', nb);
      sum.appendChild(el('span', null, '买入 ' + nb + ' 股'));
      sum.appendChild(el('span', null, bq.amt + ' + 手续费 ' + bq.fee + ' = ' + bq.total + ' 元'));
    }
    if (ns > 0) {
      var sq = quote(cfg.code, 'sell', ns);
      sum.appendChild(el('span', null, '卖出 ' + ns + ' 股'));
      sum.appendChild(el('span', null, sq.amt + ' − 手续费 ' + sq.fee + ' = 到手 ' + sq.total + ' 元'));
    }
    if (nb > 0 || ns > 0) tradeSec.appendChild(sum);
    tradeSec.appendChild(el('div', 'stk-hint', '手续费率 ' + (feeRate() * 100).toFixed(2) + '%，投资技能越高越省。'));

    var sides = el('div', 'stk-sides');
    sides.appendChild(btn('买入', 'stk-buy', function () {
      var n = resolveQty('buy', cfg.code);
      if (!(n > 0)) { toast('钱不够买 1 股「' + cfg.name + '」（现价 ' + p.toFixed(2) + ' 元）'); return; }
      var r = buy(cfg.code, n);
      if (!r.ok) toast(r.reason);
      rebuild();
    }));
    sides.appendChild(btn('卖出', 'stk-sell', function () {
      var n = resolveQty('sell', cfg.code);
      if (!(n > 0)) { toast('没有「' + cfg.name + '」的持仓可卖'); return; }
      var r = sell(cfg.code, n);
      if (!r.ok) toast(r.reason);
      rebuild();
    }));
    tradeSec.appendChild(sides);
    body.appendChild(tradeSec);
  }

  // 明日精确预知 / 观星按钮
  function oracleBox(s, cfg) {
    var lv = skillLevel('invest');
    var box = el('div', 'sec');
    box.appendChild(el('div', null, '明日涨跌（精确预知）'));
    if (lv < ORACLE_LV) {
      box.appendChild(el('div', 'stk-hint', '投资 Lv' + ORACLE_LV + ' 解锁：观星，精确得知一只股票明天的涨跌'));
      return box;
    }
    var f = fcShown(s, forecastAll(s), cfg.code);
    if (f) {
      box.appendChild(el('div', 'stk-big ' + cls(f.pct), '第 ' + (f.day + 1) + ' 天 ' + fcText(f)));
      box.appendChild(el('div', 'stk-hint', '精确预知：下面的数字就是明天实际收盘的涨跌（显示精确到 0.01%）。今天有效，明天刷新。'));
    }
    if (lv >= ORACLE_ALL_LV) return box;
    if (!f) {
      var left = oracleLeft(s, lv);
      var b = btn(left > 0 ? '观星（剩 ' + left + ' 次）' : '观星次数已用完', 'bigbtn small', function () {
        var r = oracle(cfg.code);
        if (!r.ok) toast(r.reason);
        rebuild();
      });
      b.disabled = left <= 0;
      box.appendChild(b);
      box.appendChild(el('div', 'stk-hint', quotaWhen(lv) + ' · 下次刷新：第 ' + oracleRefresh(lv) + ' 天'));
    }
    return box;
  }

  function newsItem(e) {
    var box = el('div', 'stk-news');
    var tagText = e.kind === 'pre' ? '预告' : e.kind === 'late' ? '追踪' : '突发';
    var head = el('div', 'stk-sub');
    head.appendChild(el('span', 'stk-tag', tagText));
    head.appendChild(document.createTextNode(fmtTime(e.announce)));
    box.appendChild(head);
    box.appendChild(el('div', 'stk-news-title', e.title));
    box.appendChild(el('div', 'stk-news-text', e.text));
    var names = allCfg().filter(function (c) { return e.imp[c.code] !== undefined; }).map(function (c) { return c.name; });
    if (names.length) box.appendChild(el('div', 'stk-hint', '相关：' + names.join('、')));
    return box;
  }

  function buildHold(body, s) {
    var codes = Object.keys(s.hold).filter(function (c) { return s.hold[c] && s.hold[c].n > 0 && cfgOf(c); });
    var mv = 0, pnl = 0;
    if (!codes.length) {
      body.appendChild(el('div', 'sec', '还没有持仓。去「行情」里挑一只看看。'));
    }
    codes.forEach(function (code) {
      var c = cfgOf(code), hd = s.hold[code], p = priceOf(code);
      var v = hd.n * p, gain = v - hd.cost;
      mv += v; pnl += gain;
      var row = btn('', 'stk-row', function () { openDetail(code); });
      var top = el('div', 'stk-line');
      top.appendChild(el('div', 'stk-name', c.name + '　' + hd.n + ' 股'));
      top.appendChild(el('div', 'stk-num ' + cls(gain), pnlText(gain)));
      row.appendChild(top);
      row.appendChild(el('div', 'stk-sub', '均价 ' + (hd.cost / hd.n).toFixed(2) + ' 元 · 现价 ' + p.toFixed(2) + ' 元 · 市值 ' + Math.round(v) + ' 元'));
      body.appendChild(row);
    });
    var sum = el('div', 'sec');
    sum.appendChild(el('div', null, '持仓市值 ' + Math.round(mv) + ' 元 · 浮动盈亏 ' + pnlText(pnl)));
    sum.appendChild(el('div', null, '已实现盈亏 ' + pnlText(s.realized) + ' · 累计分红 ' + Math.round(s.divIncome) + ' 元'));
    sum.appendChild(el('div', 'stk-hint', '累计手续费 ' + Math.round(s.feesPaid) + ' 元'));
    body.appendChild(sum);
  }

  function buildNews(body, s) {
    var lag = newsLag();
    body.appendChild(el('div', 'sec', '情报到达有延迟（约 ' + lag + ' 小时）' + (lag > 1 ? '。投资 Lv' + NEWS_LV + ' 起延迟降低到 1 小时。' : '。')));
    var list = visibleNews(s, nowHours());
    if (!list.length) body.appendChild(el('div', 'sec', '暂时没有新闻。'));
    list.slice(0, 30).forEach(function (e) {
      var box = el('div', 'sec');
      box.appendChild(newsItem(e));
      body.appendChild(box);
    });
  }

  function build(body) {
    var s = S();
    lastSig = sig();
    if (!s) { body.appendChild(el('div', 'sec', '股市还没开盘。')); return; }
    body.appendChild(summaryBox(s));
    body.appendChild(tabsRow());
    if (view === VIEW_DETAIL && curCode) buildDetail(body, s);
    else if (view === VIEW_HOLD) buildHold(body, s);
    else if (view === VIEW_NEWS) buildNews(body, s);
    else buildList(body, s);
  }

  stocks.openPanel = function () {
    if (!G.ui || !G.ui.openPanel || !G.state) return;
    ensureStyle();
    S();
    view = VIEW_LIST;
    curCode = null;
    qtyMode = 1;
    G.ui.openPanel({ title: '炒股', build: build, tick: tick });
  };

  G.stocks = stocks;
})();
