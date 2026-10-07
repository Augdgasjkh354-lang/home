/* ============================================================
 * 像素小家 —— 牌场（cardroom.js）
 * 只往 G.cardroom 上挂接口：
 *   G.cardroom.enter()    走到牌场门口（营业时间内）时调用，见 street.js：
 *                         首次进入 → 老千剧情；有牌桌 → 回到牌桌；偶尔 → 私局邀请；否则 → 大厅
 *   G.cardroom.tick(dt)   每帧，由 poker.js 的 G.poker.update 调用：牌桌推进、打烊结算、掉线结算
 *   G.cardroom.scamResist() 非剧情骗局（私局陷阱、勒索等）损失的系数：街头智慧 Lv8+ 为 0.5，否则 1。
 *                         外部骗局的实际损失 = 基础损失 × G.skills.bonus('street') × G.cardroom.scamResist()
 * 牌局引擎 / AI / 胜率在 poker.js（G.poker）；存档在 G.state.poker（scammed / scam / table / stats / intel*）。
 * 读牌与显示用的随机数走本模块自己的 rng，不碰发牌与 AI 用的 Math.random。
 * 资金规则：入场买入时从现金扣，离桌时剩余筹码加回现金；打烊或刷新页面时未结束的牌局按当前筹码结算。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var cardroom = (G.cardroom = G.cardroom || {});
  var TITLE = '牌场';

  var TIERS = [
    { id: 0, name: '街角小桌', buyin: 50, sb: 1, bb: 2, desc: '几块钱的快乐，外加一点不值钱的吵闹。' },
    { id: 1, name: '夜场中桌', buyin: 200, sb: 5, bb: 10, desc: '烟雾缭绕，每个人都在算你的底。' },
    { id: 2, name: '金碧大厅', buyin: 1000, sb: 25, bb: 50, desc: '侍者送来的酒是免费的，赌注可不是。' },
  ];
  var PRIVATE = { id: 3, name: '金链子的私局', buyin: 300, sb: 10, bb: 20, desc: '只请“有潜力”的人，输赢照算。', priv: true };
  var AI_IDS = ['lag', 'tag', 'station'];      // 座位 1~3 的 AI 人设，座位 0 是玩家
  var PRIVATE_CHANCE = 0.35;                   // 每次进门遇到私局邀请的概率（首次剧情之后）
  var TRAP_BASE = 0.8;                         // 私局是个局的基础概率（× 街头智慧系数）
  var SCAM_RATE = 0.2;                         // 老千坑走的比例（入场现金的 20%）
  var HUMAN_FACE = '(・ω・)';
  var TIER_TXT = { S: '顶级', A: '强牌', B: '可以玩', C: '边缘', D: '大多弃掉' };
  var INTEL_COST = 60;                         // 情报贩子一条情报的价格（街头智慧 Lv10，每天一条）

  // 情报贩子的小道消息：真假难辨，只是传闻；和帮派、议会、九爷有关的碎片
  var INTEL_RUMORS = [
    '议会的周先生这两天总往「白鲸」酒吧跑。有人看见他的公文包里露出一张地图，城东几条街被红笔圈了起来。',
    '「铁锤帮」的人在码头清点新货，嘴里念叨的不是钱，而是几个街区的名字。据说他们在等一位议员点头。',
    '九爷昨晚在后厅见了一个不常露面的人。桌上放着一枚金币，花纹和你那晚见过的那枚一模一样。',
    '「银弦会」在找会算牌的人，开价很高。传闻他们替议会做事：先让人坐进私局，再让人欠下债。',
    '市议会下月要表决“夜间治安条例”。有人说表决通过那天，牌场的保护费会翻一倍。',
    '东区汉堡店的老板，每周三都替某个帮派“存钱”。这笔钱最后去了哪里，没人敢问。',
    '有人在收集旧的选举传单，一张都不肯卖。不知道他想让谁落选，还是想让谁上台。',
    '码头仓库的灯最近总是夜里亮着，守门的人换了三拨。有人说那里根本不是仓库，是议会的档案室。',
    '「白鲸」的女侍者说，她在二楼包厢听见过半句话：“城市的账，迟早要有人来还。”',
    '牌场后门昨天有个穿灰外套的人，一句话没说，只把一张写着陌生名字的纸条塞进了门缝。（可能是恶作剧）',
  ];
  var INTEL_SRC = ['一个喝多了的侍者', '码头的搬运工', '议会的旧信封', '牌场后巷抽烟的人', '不肯透露姓名的老记者'];
  var INTEL_REL = ['据说', '传闻', '有人确认过（也可能是他自己编的）', '半真半假', '连他自己也不确定'];

  // 私局邀请：街头智慧 Lv6 起有机会看出门道（几率随等级提高），看出后可以「反将一军」
  function spotChance(lv) { return lv >= 10 ? 1 : lv >= 6 ? 0.4 + 0.1 * (lv - 6) : 0; }
  // 反将一军成功率：Lv10 必定成功（免疫私局陷阱）
  function strikeChance(lv) { return lv >= 10 ? 1 : 0.5 + 0.05 * (lv - 6); }

  // 本模块的随机源（mulberry32）：读牌、显示胜率、情报、邀请识破都用它，不占用 Math.random
  var rs = (Date.now() ^ 0x5bd1e995) >>> 0;
  function rng() {
    rs = (rs + 0x6d2b79f5) >>> 0;
    var t = rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pickOne(arr) { return arr[Math.floor(rng() * arr.length)]; }

  // 老千局的人（陈叔、小杰、墨镜哥）与后厅的九爷；座位 0 是玩家
  var SCAM_SEATS = [
    { name: '你', face: HUMAN_FACE, sub: '' },
    { name: '陈叔', face: '(´∀`)', sub: '热心肠' },
    { name: '小杰', face: '(•̀ᴗ•́)', sub: '嘴碎' },
    { name: '墨镜哥', face: '(■_■)', sub: '不说话' },
  ];
  var BOSS_NAME = '九爷';

  var live = false;           // 本次页面会话里是否在牌桌上（刷新后为 false：未结束的牌局按当前筹码结算）
  var view = 'lobby';         // lobby | table | scam | invite
  var lastSig = '';
  var inviteMsg = '';         // 私局邀请的结果文字（仅本次会话）
  var inviteSpotted = false;  // 本次邀请是否看出了门道（街头智慧 Lv6+ 有概率）
  var eqCache = { key: '', val: 0 };
  var jointCache = { key: '', val: null };

  /* ---------- 小工具 ---------- */
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
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pct(x) { return Math.round(clamp(x, 0, 1) * 100) + '%'; }
  function ps() { return G.poker && G.poker.state ? G.poker.state() : null; }
  function P() { return G.poker; }
  function money() { return G.state ? G.state.money : 0; }
  function canAfford(n) { return G.economy && G.economy.canAfford ? G.economy.canAfford(n) : money() >= n; }
  function spend(n) { if (G.economy && G.economy.spend) G.economy.spend(n); }
  function earn(n) { if (G.economy && G.economy.earn) G.economy.earn(n); }
  function toast(msg) { if (G.ui && G.ui.toast) G.ui.toast(msg); }
  function skillBonus(id) { return G.skills && G.skills.bonus ? G.skills.bonus(id) : 1; }
  function skillLevel(id) { return G.skills && G.skills.level ? G.skills.level(id) : 0; }
  function streetBonus() { return skillBonus('street'); }

  // 面板是否正打开着“牌场”（别的面板打开时不要去改它）
  function panelIs(title) {
    var box = document.getElementById('panel');
    if (!box || box.classList.contains('hidden')) return false;
    var t = box.querySelector('.panel-title');
    return !!t && t.textContent === title;
  }
  function rebuild() {
    if (panelIs(TITLE) && G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel();
  }
  function cardKey(c) { return c.r + c.s; }

  function personaOf(i) { return P().personaById(AI_IDS[i - 1]); }
  function seatInfo(i) {
    if (i === 0) return { name: '你', face: HUMAN_FACE, sub: '' };
    var p = personaOf(i);
    return { name: p.name, face: p.face, sub: p.style };
  }
  function nameOf(T, i) { return seatInfo(i).name; }

  /* ---------- 样式 ---------- */
  var CR_CSS = [
    '.pk-felt { position:relative; height:240px; margin:6px 0 4px; background:radial-gradient(ellipse at center,#3f8a66 0%,#2f6b4f 70%,#24543d 100%); border:3px solid #1c1a24; box-shadow:inset 0 0 0 3px #3f8a66, 0 0 0 2px #f3ead8; border-radius:16px; overflow:hidden; }',
    '.pk-seat { position:absolute; width:84px; text-align:center; font-size:11px; line-height:14px; }',
    '.pk-seat.pk-top { left:50%; top:6px; margin-left:-42px; }',
    '.pk-seat.pk-left { left:4px; top:74px; }',
    '.pk-seat.pk-right { right:4px; top:74px; }',
    '.pk-seat .pk-row { display:flex; align-items:center; justify-content:center; gap:3px; }',
    '.pk-face { width:30px; height:30px; flex:none; background:#4a4260; border:2px solid #1c1a24; line-height:26px; font-size:10px; color:#f3ead8; overflow:hidden; white-space:nowrap; }',
    '.pk-seat.act .pk-face { border-color:#ffd84a; box-shadow:0 0 0 2px #ffd84a; }',
    '.pk-seat.out { opacity:.45; }',
    '.pk-name { margin-top:2px; color:#f3ead8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.pk-stack { color:#ffe9a8; white-space:nowrap; }',
    '.pk-tag { min-height:13px; color:#9ff0a8; white-space:nowrap; }',
    '.pk-board { position:absolute; left:50%; top:64%; transform:translate(-50%,-50%); width:136px; text-align:center; }',
    '.pk-read { min-height:13px; font-size:10px; line-height:13px; color:#d9b8ff; white-space:nowrap; }',
    '.pk-eq { font-size:10px; line-height:13px; color:#ffe9a8; white-space:nowrap; }',
    '.pk-seat.revealed .pk-face { border-color:#d9b8ff; box-shadow:0 0 0 2px #d9b8ff; }',
    '.pk-seat.out.revealed { opacity:.85; }',
    '.pk-intel-src { font-size:11px; line-height:16px; color:#cfc4a8; margin-top:4px; }',
    '.pk-pot { font-size:12px; color:#ffe9a8; margin-bottom:4px; }',
    '.pk-street { font-size:11px; color:#cfe8d8; margin-top:4px; }',
    '.pk-cards { display:flex; gap:2px; justify-content:center; }',
    '.pk-card { flex:none; width:24px; height:34px; background:#fbf6ea; color:#2a2636; border:2px solid #1c1a24; box-shadow:2px 2px 0 #1c1a24; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:11px; line-height:12px; font-weight:bold; }',
    '.pk-card.red { color:#c0392b; }',
    '.pk-card.back { background:repeating-linear-gradient(45deg,#7b4bb5 0 3px,#5e3a8f 3px 6px); }',
    '.pk-card.empty { background:transparent; border:2px dashed #7b719c; box-shadow:none; }',
    '.pk-card.xs { width:18px; height:26px; font-size:9px; line-height:10px; box-shadow:1px 1px 0 #1c1a24; }',
    '.pk-card.lg { width:42px; height:58px; font-size:15px; line-height:17px; }',
    '.pk-card .su { font-size:12px; }',
    '.pk-card.xs .su { font-size:9px; }',
    '.pk-card.lg .su { font-size:18px; }',
    '.pk-hole { display:flex; gap:3px; justify-content:center; margin-top:3px; min-height:26px; }',
    '.pk-me { margin-top:4px; }',
    '.pk-me-name { font-size:12px; color:#ffe9a8; text-align:center; }',
    '.pk-me-stat { font-size:11px; color:#cfc4a8; text-align:center; min-height:14px; }',
    '.pk-say { font-size:13px; line-height:19px; background:#3a3350; border-left:4px solid #ff7eb6; padding:6px 8px; margin-top:6px; }',
    '.pk-warn { font-size:12px; line-height:17px; color:#ffe9a8; border:2px dashed #ffd84a; padding:6px; margin-top:6px; }',
    '.pk-hint { font-size:12px; line-height:17px; color:#9fe0ff; margin-top:6px; }',
    '.pk-acts { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px; }',
    '.pk-acts button { min-height:44px; font-size:13px; padding:4px 6px; }',
    '.pk-acts .pk-wide { grid-column:1 / -1; }',
    '.pk-feed { font-size:11px; line-height:16px; color:#cfc4a8; margin-top:6px; }',
    '.pk-disabled-note { font-size:11px; color:#ffb3b3; margin-top:4px; }',
    '.pk-fold { background:#2a2636; }',
  ].join('\n');
  var styled = false;
  function ensureStyle() {
    if (styled) return;
    styled = true;
    try {
      if (document.getElementById('cardroom-style')) return;
      var st = document.createElement('style');
      st.id = 'cardroom-style';
      st.textContent = CR_CSS;
      document.head.appendChild(st);
    } catch (e) { /* 无 DOM 时忽略 */ }
  }

  /* ---------- 牌面 ---------- */
  // size: xs | sm（默认）| lg；hidden 为背面；c 为 null 时画空位
  function cardEl(c, size, hidden) {
    var d = el('div', 'pk-card' + (size && size !== 'sm' ? ' ' + size : ''));
    if (!c) { d.classList.add('empty'); return d; }
    if (hidden) { d.classList.add('back'); return d; }
    if (P().isRed(c)) d.classList.add('red');
    d.appendChild(el('span', null, P().RANK_TXT[c.r]));
    d.appendChild(el('span', 'su', P().SUIT_SYM[c.s]));
    return d;
  }

  function streetText(h) {
    return { pre: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', done: '本手结束' }[h.street] || '';
  }

  /* ---------- 牌桌绘制 ---------- */
  // ex（可选）：{ show: {座位: true} 读牌/全知翻开的座位, label: '读牌'|'全知', eq: {座位: 胜率} }
  function seatBox(i, info, h, stacks, reveal, cls, ex) {
    var box = el('div', 'pk-seat ' + cls);
    var s = h ? h.seats[i] : null;
    var shown = !!(ex && ex.show && ex.show[i] && s && s.hole && s.hole.length);
    if (h && h.street !== 'done' && h.toAct === i) box.classList.add('act');
    if (s && s.folded) box.classList.add('out');
    if (shown) box.classList.add('revealed');
    var row = el('div', 'pk-row');
    row.appendChild(el('div', 'pk-face', info.face));
    if (s && s.hole && s.hole.length && (shown || !s.folded)) {
      s.hole.forEach(function (c) { row.appendChild(cardEl(c, 'xs', !(reveal || shown))); });
    }
    box.appendChild(row);
    box.appendChild(el('div', 'pk-name', info.name));
    box.appendChild(el('div', 'pk-stack', '🪙 ' + (s ? s.stack : stacks[i])));
    var tag = '';
    if (s) {
      if (s.folded) tag = '弃牌';
      else if (s.allIn) tag = '全下';
      else if (s.bet > 0) tag = '下注 ' + s.bet;
    }
    box.appendChild(el('div', 'pk-tag', tag));
    if (shown) {
      box.appendChild(el('div', 'pk-read', ex.label));
      if (ex.eq && ex.eq[i] !== undefined && s && !s.folded) box.appendChild(el('div', 'pk-eq', '胜率 ' + pct(ex.eq[i])));
    }
    return box;
  }

  function renderFelt(parent, seats, h, stacks, reveal, ex) {
    var felt = el('div', 'pk-felt');
    var pos = ['', 'pk-left', 'pk-top', 'pk-right'];
    for (var i = 1; i <= 3; i++) felt.appendChild(seatBox(i, seats[i], h, stacks, reveal, pos[i], ex));
    var center = el('div', 'pk-board');
    center.appendChild(el('div', 'pk-pot', h ? '底池 🪙' + P().potTotal(h) : '等待发牌'));
    var row = el('div', 'pk-cards');
    for (var k = 0; k < 5; k++) row.appendChild(cardEl(h && h.board[k] ? h.board[k] : null, 'sm'));
    center.appendChild(row);
    center.appendChild(el('div', 'pk-street', h ? streetText(h) : ''));
    felt.appendChild(center);
    parent.appendChild(felt);

    var me = el('div', 'pk-me');
    var s0 = h ? h.seats[0] : null;
    var stack0 = s0 ? s0.stack : stacks[0];
    var nameLine = '你  🪙 ' + stack0;
    if (s0 && s0.bet > 0) nameLine += '（本轮下注 ' + s0.bet + '）';
    me.appendChild(el('div', 'pk-me-name', nameLine));
    var hole = el('div', 'pk-hole');
    if (s0 && s0.hole && s0.hole.length) s0.hole.forEach(function (c) { hole.appendChild(cardEl(c, 'lg')); });
    me.appendChild(hole);
    var st = '';
    if (h && h.street !== 'done' && h.toAct === 0) st = '轮到你了';
    else if (s0 && s0.folded && h && h.street !== 'done') st = '你已弃牌';
    me.appendChild(el('div', 'pk-me-stat', st));
    parent.appendChild(me);
  }

  // 玩家的行动按钮（都经过 G.poker.legal 计算，保证合法）
  function renderActions(parent, h) {
    var L = P().legal(h, 0);
    var wrap = el('div', 'pk-acts');
    if (L.canCheck) wrap.appendChild(btn('过牌', '', function () { humanAct({ t: 'check' }); }));
    else wrap.appendChild(btn('弃牌', 'pk-fold', function () { humanAct({ t: 'fold' }); }));
    if (!L.canCheck) {
      var allIn = L.callAmt >= L.stack;
      wrap.appendChild(btn((allIn ? '全下跟注 ' : '跟注 ') + L.callAmt, '', function () { humanAct({ t: 'call' }); }));
    }
    if (L.canRaise) {
      var potAfterCall = L.pot + L.toCall;
      var cands = [L.minTo, L.curBet + Math.max(h.minRaise, potAfterCall), L.maxTo];
      var seen = {};
      cands.forEach(function (raw) {
        var to = Math.round(clamp(raw, L.minTo, L.maxTo));
        if (seen[to]) return;
        seen[to] = true;
        if (to >= L.maxTo) {
          wrap.appendChild(btn('全下 ' + L.stack, 'pk-wide', function () { humanAct({ t: 'allin' }); }));
        } else {
          wrap.appendChild(btn((L.curBet > 0 ? '加注到 ' : '下注 ') + to, '', function () { humanAct({ t: 'raise', to: to }); }));
        }
      });
    }
    parent.appendChild(wrap);
  }

  // 等级辅助信息（牌技 Lv2/4/6/8 解锁，见 config.js 的 G.SKILLS.poker）
  // 对随机手的胜率（Lv7+）；400 次模拟，结果按底牌/公共牌/人数缓存
  function equityFor(h) {
    var s = h.seats[0];
    var nOpp = 0;
    h.seats.forEach(function (o, j) { if (j !== 0 && !o.folded) nOpp++; });
    var key = s.hole.map(cardKey).join('') + '|' + h.board.map(cardKey).join('') + '|' + nOpp;
    if (key !== eqCache.key) {
      eqCache = { key: key, val: P().equity(s.hole, h.board, Math.max(1, nOpp), 400, rng) };
    }
    return eqCache.val;
  }

  // 全知之眼（Lv10）：所有未弃牌座位按已知底牌互相比较，得到每人的实时胜率；300 次模拟，缓存
  function jointEquityFor(h) {
    var key = h.seats.map(function (s) {
      return s.folded || !s.hole.length ? 'x' : s.hole.map(cardKey).join('');
    }).join(',') + '|' + h.board.map(cardKey).join('');
    if (key !== jointCache.key) {
      var holes = h.seats.map(function (s) { return !s.folded && s.hole.length === 2 ? s.hole : null; });
      jointCache = { key: key, val: P().equityAll(holes, h.board, 300, rng) };
    }
    return jointCache.val;
  }

  // 本手牌桌上的读牌信息：Lv8/9 为 T.reads（开局随机挑出的对手），Lv10 为全部对手
  function tableExtras(T, h) {
    var lv = skillLevel('poker');
    var ex = { show: {}, eq: null, label: lv >= 10 ? '全知' : '读牌', names: [] };
    if (!h) return ex;
    if (lv >= 10) {
      for (var i = 1; i <= 3; i++) ex.show[i] = true;
      if (h.street !== 'done') ex.eq = jointEquityFor(h);
    } else if (lv >= 8) {
      (T.reads || []).forEach(function (j) { ex.show[j] = true; });
    }
    Object.keys(ex.show).forEach(function (k) { ex.names.push(nameOf(T, +k)); });
    return ex;
  }

  function renderHints(parent, h) {
    var lv = skillLevel('poker');
    if (!h || h.street === 'done' || lv < 2) return;
    var s = h.seats[0];
    var box = el('div', 'pk-hint');
    var lines = [];
    if (!s.folded) {
      lines.push(h.board.length >= 3
        ? '当前牌型：' + P().describe(P().score7(s.hole.concat(h.board)))
        : '当前牌型：翻牌前，还没成牌');
    }
    if (lv >= 4) lines.push('起手牌强度：' + P().preflopTier(s.hole) + ' 级（' + TIER_TXT[P().preflopTier(s.hole)] + '）');
    if (lv >= 6 && !s.folded) {
      var toCall = Math.max(0, h.curBet - s.bet);
      var pot = P().potTotal(h);
      lines.push(toCall > 0
        ? '底池赔率：要跟 ' + toCall + '，需要胜率 ' + pct(toCall / (pot + toCall))
        : '底池赔率：无需跟注，过牌即可');
    }
    if (lv >= 7 && !s.folded) {
      lines.push('胜率估算：约 ' + pct(equityFor(h)) + '（对随机手）');
    }
    lines.forEach(function (t) { box.appendChild(el('div', null, t)); });
    if (box.childNodes.length) parent.appendChild(box);
  }

  /* ---------- 牌局流程 ---------- */
  function actionText(a, L) {
    if (a.t === 'fold') return '弃牌';
    if (a.t === 'check') return '过牌';
    if (a.t === 'call') return (L.callAmt >= L.stack ? '全下跟注 ' : '跟注 ') + L.callAmt;
    if (a.t === 'allin') return '全下 ' + L.stack;
    return (L.curBet > 0 ? '加注到 ' : '下注 ') + a.to;
  }

  function pushFeed(T, text) {
    T.feed.push(text);
    while (T.feed.length > 8) T.feed.shift();
  }

  function fastForward(T) {
    var guard = 0;
    while (T.hand && T.hand.street !== 'done' && guard++ < 400) {
      var h = T.hand, i = h.toAct;
      if (i < 0) break;
      var a = i === 0
        ? (P().legal(h, 0).canCheck ? { t: 'check' } : { t: 'fold' })    // 离桌：玩家自动过牌或弃牌
        : P().ai.decide(h, i, personaOf(i), Math.random);
      var r = P().apply(h, i, a);
      if (!r.ok) P().apply(h, i, P().legal(h, i).canCheck ? { t: 'check' } : { t: 'fold' });
      if (h.street === 'done') onHandEnd(T);
    }
    if (T.hand && T.hand.street !== 'done') {          // 理论上不会走到这里：保底同步筹码
      T.stacks = T.hand.seats.map(function (s) { return s.stack; });
    }
    T.hand = null;
    T.delay = 0;
  }

  function onHandEnd(T) {
    var p = ps(), h = T.hand, r = h.result;
    var before = T.startStacks || T.stacks.slice();
    T.stacks = h.seats.map(function (s) { return s.stack; });
    if (before[0] > 0) {
      var net0 = T.stacks[0] - before[0];
      var won = r.payouts[0];
      p.stats.hands += 1;
      p.stats.net += net0;
      if (won > p.stats.biggest) p.stats.biggest = won;
      if (G.skills && G.skills.addXp) G.skills.addXp('poker', 2 + (net0 > 0 && won >= T.bb * 8 ? 4 : 0));
    }
    var parts = [];
    if (r.uncontested) {
      var w = r.pots[0].winners[0];
      parts.push(nameOf(T, w) + ' 收下底池 🪙' + r.payouts[w] + '（其他人都弃牌）');
    } else {
      Object.keys(r.hands).forEach(function (k) {
        parts.push(nameOf(T, +k) + '：' + r.hands[k].name);
      });
      var wins = [];
      r.pots.forEach(function (pot) { pot.winners.forEach(function (w) { if (wins.indexOf(w) < 0) wins.push(w); }); });
      parts.push('赢家：' + wins.map(function (w) { return nameOf(T, w); }).join('、'));
    }
    T.last = parts.join('；');
    pushFeed(T, '本手：' + T.last);
    T.delay = 2.6;
  }

  function applyAct(T, i, a, fromAI) {
    var h = T.hand;
    var L = P().legal(h, i);
    var r = P().apply(h, i, a);
    if (!r.ok) return r;
    pushFeed(T, nameOf(T, i) + '：' + actionText(a, L));
    if (fromAI && (a.t === 'raise' || a.t === 'allin') && Math.random() < 0.3) {
      pushFeed(T, '“' + personaOf(i).lines[Math.floor(Math.random() * personaOf(i).lines.length)] + '”');
    }
    if (h.street === 'done') onHandEnd(T);
    return r;
  }

  function startHand(T) {
    if (T.stacks[0] <= 0) return false;              // 玩家输光了：等待再买或离桌
    for (var i = 1; i <= 3; i++) {
      if (T.stacks[i] < T.bb) {
        T.stacks[i] = T.buyin;
        pushFeed(T, nameOf(T, i) + ' 又掏出一叠钞票坐回来了');
      }
    }
    var nd = (T.dealer + 1) % 4;
    while (T.stacks[nd] <= 0) nd = (nd + 1) % 4;
    T.dealer = nd;
    T.startStacks = T.stacks.slice();
    T.handNo += 1;
    T.hand = P().newHand({ stacks: T.stacks.slice(), dealer: T.dealer, sb: T.sb, bb: T.bb, rnd: Math.random });
    // 读牌在发牌之后挑人：只决定看谁，不改变发牌，也不碰 Math.random
    var lv = skillLevel('poker');
    var nRead = lv >= 9 ? (lv >= 10 ? 3 : 2) : lv >= 8 ? 1 : 0;
    T.reads = nRead ? P().pickReads(T.hand, nRead, rng) : [];
    pushFeed(T, '—— 第 ' + T.handNo + ' 手 ——');
    if (T.hand.street === 'done') onHandEnd(T);
    T.delay = 0.6;
    return true;
  }

  // 每帧推进：没有牌局就发下一手；轮到 AI 就让它行动（带一点停顿）；轮到玩家就等待输入
  function step(T) {
    if (!T.hand) { startHand(T); return; }
    var h = T.hand;
    if (h.street === 'done') { T.hand = null; T.delay = 0.5; return; }
    var i = h.toAct;
    if (i <= 0) return;
    var a = P().ai.decide(h, i, personaOf(i), Math.random);
    var r = applyAct(T, i, a, true);
    if (!r.ok) applyAct(T, i, P().legal(h, i).canCheck ? { t: 'check' } : { t: 'fold' }, true);
    if (T.hand && T.hand.street !== 'done') T.delay = 0.7 + Math.random() * 0.6;
  }

  function humanAct(a) {
    var p = ps(), T = p && p.table;
    if (!T || !T.hand || T.hand.toAct !== 0) return;
    var r = applyAct(T, 0, a, false);
    if (!r.ok) { toast(r.error || '现在不能这样做'); return rebuild(); }
    if (T.hand.street !== 'done') T.delay = 0.5 + Math.random() * 0.4;
    rebuild();
  }

  function sit(tier) {
    var p = ps();
    if (!p || p.table) return;
    if (!canAfford(tier.buyin)) { toast('钱不够，入场要 🪙' + tier.buyin); return rebuild(); }
    spend(tier.buyin);
    p.table = {
      tier: tier.id, priv: !!tier.priv, name: tier.name, sb: tier.sb, bb: tier.bb,
      buyin: tier.buyin, bought: tier.buyin,
      stacks: [tier.buyin, tier.buyin, tier.buyin, tier.buyin],
      dealer: 3, handNo: 0, hand: null, startStacks: null, delay: 0.8, feed: [], last: '', reads: [],
    };
    live = true;
    view = 'table';
    G.log('坐下「' + tier.name + '」，入场 🪙' + tier.buyin);
    rebuild();
  }

  function rebuy() {
    var p = ps(), T = p && p.table;
    if (!T) return;
    if (!canAfford(T.buyin)) { toast('钱不够再买一手'); return rebuild(); }
    spend(T.buyin);
    T.stacks[0] = T.buyin;
    T.bought += T.buyin;
    pushFeed(T, '你又买了一手筹码（🪙' + T.buyin + '）');
    rebuild();
  }

  // 离桌：把本手打完（玩家自动过牌或弃牌），剩余筹码加回现金
  function cashOut() {
    var p = ps(), T = p && p.table;
    if (!T) return 0;
    fastForward(T);
    var amt = T.stacks[0];
    earn(amt);
    var net = amt - T.bought;
    G.log('离开「' + T.name + '」，带走 🪙' + amt + '（' + (net >= 0 ? '赚了 ' : '亏了 ') + Math.abs(net) + '）');
    p.table = null;
    view = 'lobby';
    rebuild();
    return amt;
  }

  /* ---------- 牌桌界面 ---------- */
  function buildTable(body, p, T) {
    var h = T.hand;
    var head = el('div', 'sec');
    head.appendChild(el('div', 'shop-name', T.name + '　盲注 ' + T.sb + '/' + T.bb + (T.priv ? '　私局' : '')));
    head.appendChild(el('div', 'shop-sub', '第 ' + T.handNo + ' 手 · 你的筹码 🪙' + T.stacks[0] + ' · 累计买入 🪙' + T.bought));
    body.appendChild(head);

    if (!h && T.stacks[0] <= 0) {
      var bust = el('div', 'sec');
      bust.appendChild(el('div', 'pk-say', '你的筹码输光了。桌上还有人等着，要不要再买一手？'));
      bust.appendChild(btn('再买一手 🪙' + T.buyin, 'bigbtn', rebuy, !canAfford(T.buyin)));
      bust.appendChild(btn('离开牌桌', 'bigbtn ghost', cashOut));
      body.appendChild(bust);
      return;
    }

    var seats = [0, 1, 2, 3].map(seatInfo);
    var stacks = T.stacks;
    var ex = tableExtras(T, h);
    renderFelt(body, seats, h, stacks, !!h && h.street === 'done', ex);
    if (T.last) body.appendChild(el('div', 'pk-say', '上一手：' + T.last));
    if (h && ex.names.length && ex.label === '读牌') {
      body.appendChild(el('div', 'pk-hint', '读牌：' + ex.names.join('、') + '的底牌已翻开，本手有效。'));
    } else if (h && ex.label === '全知' && h.street !== 'done') {
      body.appendChild(el('div', 'pk-hint', '全知之眼：所有对手的底牌都看得见，胜率按当前底牌实时估算。'));
    }

    if (h && h.street !== 'done') {
      renderHints(body, h);
      if (h.toAct === 0) renderActions(body, h);
      else body.appendChild(el('div', 'shop-sub', h.toAct > 0 ? nameOf(T, h.toAct) + ' 在想……' : '发牌中……'));
    }

    if (T.feed.length) {
      var feed = el('div', 'pk-feed');
      T.feed.slice(-5).forEach(function (t) { feed.appendChild(el('div', null, t)); });
      body.appendChild(feed);
    }

    var inHand = h && h.street !== 'done' && h.seats[0].totalIn > 0 && !h.seats[0].folded;
    var leaveText = inHand
      ? '离桌（本手自动弃牌，已投入的会留在池里）'
      : '离桌，带走 🪙' + T.stacks[0];
    body.appendChild(btn(leaveText, 'bigbtn ghost', cashOut));
  }

  function buildLobby(body, p) {
    var stat = el('div', 'sec');
    stat.appendChild(el('div', 'shop-name', '● 营业中　· 次日 06:00 打烊'));
    var net = p.stats.net;
    stat.appendChild(el('div', 'shop-sub', '累计 ' + p.stats.hands + ' 手 · 盈亏 ' + (net >= 0 ? '+' : '') + net + ' · 单手最多拿回 🪙' + p.stats.biggest));
    body.appendChild(stat);

    if (p.table) {
      var live2 = el('div', 'sec');
      live2.appendChild(el('div', 'shop-name', '你正坐在「' + p.table.name + '」'));
      live2.appendChild(el('div', 'shop-sub', '筹码 🪙' + p.table.stacks[0]));
      live2.appendChild(btn('回到牌桌', 'bigbtn', function () { view = 'table'; rebuild(); }));
      body.appendChild(live2);
    }

    if (skillLevel('street') >= 10) {
      var intelBox = el('div', 'sec');
      intelBox.appendChild(el('div', 'shop-name', '后门的情报贩子'));
      intelBox.appendChild(el('div', 'shop-sub', '烟雾里有人卖城里的小道消息。真假自己判断，每天只卖一条。'));
      intelBox.appendChild(btn('去找他', 'bigbtn', function () { view = 'intel'; rebuild(); }));
      body.appendChild(intelBox);
    }

    TIERS.forEach(function (t) {
      var box = el('div', 'sec');
      box.appendChild(el('div', 'shop-name', t.name + '　盲注 ' + t.sb + '/' + t.bb));
      box.appendChild(el('div', 'shop-sub', t.desc));
      box.appendChild(el('div', 'shop-price', '入场 🪙' + t.buyin));
      var can = !p.table && canAfford(t.buyin);
      var label = p.table ? '已在牌桌上' : (can ? '坐下' : '钱不够');
      box.appendChild(btn(label, 'bigbtn', function () { sit(t); }, !can));
      body.appendChild(box);
    });

    body.appendChild(btn('离开牌场', 'bigbtn ghost', function () { if (G.ui && G.ui.closeShop) G.ui.closeShop(); }));
  }

  /* ---------- 私局邀请 ---------- */
  function buildInvite(body) {
    var sec = el('div', 'sec');
    sec.appendChild(el('div', 'shop-name', '私局邀请'));
    if (inviteMsg) {
      sec.appendChild(el('div', 'pk-say', inviteMsg));
      sec.appendChild(btn('离开', 'bigbtn ghost', function () { inviteMsg = ''; view = 'lobby'; rebuild(); }));
      body.appendChild(sec);
      return;
    }
    var lv = skillLevel('street');
    sec.appendChild(el('div', 'pk-say', '门口的金链子男人拦住你，压低声音：“这桌是私局，只请有潜力的人。入场 🪙' + PRIVATE.buyin + '，输赢照算。”'));
    if (lv >= 4) {
      sec.appendChild(el('div', 'pk-warn', '你闻到了不对劲：他的袖口干净得过分，手指却一直在桌边轻敲，像在数牌。'));
      if (lv >= 6) {
        var amt = trapLoss(), win = Math.floor(amt * 0.6);
        if (inviteSpotted) {
          sec.appendChild(el('div', 'pk-hint', lv >= 10
            ? '这种小局对你已经没用了：你一眼看穿了整张桌子，反将一军必定成功。'
            : '你看出了门道：他的牌是从袖口滑出来的，桌上那叠“入场筹码”也是他的。'));
          sec.appendChild(btn('反将一军：假装上钩，等他出手时把局翻过来（成功赢回 🪙' + win + '，失手照常被借走 🪙' + amt + '）', 'bigbtn', strikeInvite, amt <= 0));
        } else {
          sec.appendChild(el('div', 'pk-hint', '你没看出什么破绽，但直觉告诉你别坐下。'));
        }
      }
      sec.appendChild(btn('拒绝，转身就走', 'bigbtn ghost', declineInvite));
    } else {
      sec.appendChild(btn('坐下玩（入场 🪙' + PRIVATE.buyin + '）', 'bigbtn', acceptInvite, !canAfford(PRIVATE.buyin)));
      sec.appendChild(btn('不了，谢谢', 'bigbtn ghost', declineInvite));
    }
    body.appendChild(sec);
  }

  // 私局陷阱的损失：基础 25% × 街头智慧系数，再乘非剧情骗局的减半系数（Lv8+）
  function trapLoss() {
    var b = streetBonus(), m = money();
    var base = Math.min(m, Math.max(1, Math.ceil(m * 0.25 * b)));
    return Math.min(m, Math.max(1, Math.ceil(base * cardroom.scamResist())));
  }

  function declineInvite() {
    var lv = skillLevel('street');
    G.log(lv >= 4 ? '你闻到了不对劲，转身走了。' : '你没有上那张私局的桌子。');
    view = 'lobby';
    rebuild();
  }

  function acceptInvite() {
    var b = streetBonus();
    if (rng() < TRAP_BASE * b) {
      var loss = trapLoss();
      spend(loss);
      inviteMsg = '牌还没发，你的钱包已经被“借”走了 🪙' + loss + '。金链子男人笑眯眯地拍拍你的肩：“下次来，记得带脑子。”';
      G.log('私局是个局，你被借走了 🪙' + loss);
      return rebuild();
    }
    inviteMsg = '';
    sit(PRIVATE);
  }

  // 反将一军：成功则不上当，并从对方手里赢回设套的钱的一部分；失手则照常被借走
  function strikeInvite() {
    var lv = skillLevel('street');
    var amt = trapLoss();
    if (rng() < strikeChance(lv)) {
      var win = Math.floor(amt * 0.6);
      earn(win);
      inviteMsg = '你假装上钩，在对方出手前把牌翻了过来。金链子男人脸色一变，悻悻地吐出 🪙' + win + '，头也不回地钻进了人群。';
      G.log('识破私局，反将一军成功，赢回 🪙' + win);
    } else {
      spend(amt);
      inviteMsg = '你的反击慢了半拍，钱包还是被“借”走了 🪙' + amt + '。金链子男人叹了口气：“可惜，可惜。”';
      G.log('反将一军失手，被借走 🪙' + amt);
    }
    rebuild();
  }

  // 非剧情骗局的损失系数（街头智慧 Lv8 起减半）。外部骗局可乘以它，见文件头注释
  cardroom.scamResist = function () {
    return skillLevel('street') >= 8 ? 0.5 : 1;
  };

  /* ---------- 老千剧情（首次进入，只触发一次） ---------- */
  function scamLossFor(m, entry) {
    if (m <= 0) return 0;
    return Math.min(m, Math.max(1, Math.ceil(entry * SCAM_RATE * streetBonus())));
  }

  // 陈叔一伙设的局：固定底牌与公共牌，小杰全下，玩家无论怎么选都会被套进去
  function runScamHand(loss) {
    var c = function (s) {
      var r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[s[0]] || parseInt(s[0], 10);
      return { r: r, s: s[1] };
    };
    var rig = {
      holes: [[c('Ah'), c('Ad')], [c('Kc'), c('3c')], [c('9s'), c('8s')], [c('Qh'), c('Jh')]],
      board: [c('7s'), c('6s'), c('2d'), c('2h'), c('5s')],
    };
    var h = P().newHand({ stacks: [loss, 200, 150, 200], dealer: 3, sb: 1, bb: 2, rig: rig, rnd: Math.random });
    scamRun(h);
    return h;
  }

  // 脚本行动：座位 2（小杰）全下，其余人弃牌；轮到玩家时停下
  function scamRun(h) {
    var guard = 0;
    while (h.street !== 'done' && h.toAct > 0 && guard++ < 20) {
      P().apply(h, h.toAct, h.toAct === 2 ? { t: 'allin' } : { t: 'fold' });
    }
  }

  function scamAct() {
    var p = ps(), sc = p && p.scam;
    if (!sc || !sc.hand || sc.hand.toAct !== 0) return;
    P().apply(sc.hand, 0, { t: 'allin' });
    scamRun(sc.hand);
    sc.stage = 'result';
    rebuild();
  }

  function goStage(stage, look) {
    return function () {
      var p = ps(), sc = p && p.scam;
      if (!sc) return;
      sc.stage = stage;
      if (look) sc.look = true;
      rebuild();
    };
  }

  function sitScam() {
    var p = ps(), sc = p && p.scam;
    if (!sc) return;
    var loss = scamLossFor(money(), sc.entry);
    if (loss <= 0) { sc.stage = 'laugh'; return rebuild(); }
    spend(loss);
    sc.loss = loss;
    sc.hand = runScamHand(loss);
    sc.stage = sc.hand.toAct === 0 ? 'choice' : 'result';
    rebuild();
  }

  function finishScam() {
    var p = ps(), sc = p && p.scam;
    var loss = sc ? (sc.loss || 0) : 0;
    p.scammed = true;
    p.scam = null;
    if (loss > 0) {
      G.log('被「和气牌馆」的老千坑走了 🪙' + loss + '（入场现金的两成）');
    } else {
      G.log('在「和气牌馆」被笑话了一通，倒是没花钱');
    }
    G.log('九爷临走的那句话：有些桌子，会找上“有潜力”的人。');
    view = 'lobby';
    rebuild();
  }

  function buildScam(body, p) {
    var sc = p.scam;
    var stage = sc.stage;
    var sec = el('div', 'sec');
    var lines = [];
    var buttons = [];
    var showHand = null;

    if (stage === 'door') {
      lines = [
        '傍晚的霓虹刚亮，「和气牌馆」四个字闪了两下，像是在冲你眨眼。',
        '一个穿花衬衫的大叔冲你招手，笑得很热情：“新面孔啊？我姓陈，大家都叫我陈叔。进来玩两把，输赢都是交个朋友。”',
      ];
      buttons = [
        { t: '跟他进去', fn: goStage('table') },
        { t: '我只是看看', fn: goStage('table', true) },
      ];
    } else if (stage === 'table') {
      lines = sc.look
        ? ['你说只是看看，陈叔也不恼：“看看又不要钱。来，坐这儿，离牌近。”']
        : ['你还没开口，陈叔已经拉开了椅子。'];
      lines.push('桌边坐着两个人：一个叼着牙签、嘴不停的年轻人小杰，一个戴墨镜、一句话都不说的墨镜哥。陈叔把一杯免费的茶推到你面前：“新客规矩，先买个入场筹码，就当交个朋友。”');
      buttons = [
        { t: '好，买一手', fn: goStage('sit') },
        { t: '我再想想', fn: goStage('sit') },
      ];
    } else if (stage === 'sit') {
      var loss = scamLossFor(money(), sc.entry);
      lines = ['墨镜哥把一叠钞票推到你面前，又把“入场筹码”在桌上码得整整齐齐。'];
      if (loss > 0) {
        lines.push('入场筹码：🪙' + loss + '（约为你入场时现金的两成）。');
        buttons = [{ t: '推上牌桌', fn: sitScam }];
      } else {
        buttons = [{ t: '……', fn: goStage('laugh') }];
      }
    } else if (stage === 'laugh') {
      lines = ['陈叔看了看你的口袋，摆摆手：“算了算了，穷人不玩。”'];
      buttons = [{ t: '走吧', fn: goStage('boss') }];
    } else if (stage === 'choice' && sc.hand) {
      showHand = sc.hand;
      var mine = sc.hand.seats[0].hole;
      lines = [
        '小杰把自己的筹码全推了出来，嘴角咧到耳根：“敢不敢跟？”',
        '你的底牌是 ' + mine.map(P().cardText).join(' ') + '。陈叔在旁边轻声说：“这么好的牌，不跟可惜了。”',
      ];
      buttons = [
        { t: '全下，跟！', fn: scamAct },
        { t: '想想……', fn: scamAct },
        { t: '弃牌', disabled: true, note: '门口两个壮汉把你堵住：牌还没打完呢，老弟。' },
      ];
    } else if (stage === 'result' && sc.hand) {
      showHand = sc.hand;
      var hd = sc.hand, b = hd.board;
      var hands = hd.result.hands;
      lines = [
        '翻牌：' + b.slice(0, 3).map(P().cardText).join(' ') + '，小杰的眼睛亮了一下。',
        '转牌：' + P().cardText(b[3]) + '，陈叔叹了口气。',
        '河牌：' + P().cardText(b[4]) + '……小杰把底牌翻开，' + (hands[2] ? hands[2].name : '') + '！',
        '你的牌是' + (hands[0] ? '「' + hands[0].name + '」' : '一手废牌') + '，被摁在了桌上。筹码哗啦啦被收走。',
      ];
      buttons = [{ t: '听听九爷怎么说', fn: goStage('boss') }];
    } else if (stage === 'boss') {
      var lost = sc.loss || 0;
      lines = [
        '后厅的门帘掀开，一个面无表情的男人慢慢踱出来，手上转着一枚金币。城东的牌局圈子里，没人敢大声叫这个人的名字：' + BOSS_NAME + '。',
        BOSS_NAME + '：“新人嘛，学费总要交的。' + (lost > 0 ? '这一手，你交了 🪙' + lost + '。' : '你今天连学费都没有，算你走运。') + '”',
        BOSS_NAME + '：“城里的牌局没有免费的午餐。想再玩，就带够本钱来。有些桌子，会找上‘有潜力’的人。”',
      ];
      buttons = [{ t: '走出后厅，回到大厅', fn: finishScam }];
    } else {
      // 状态异常：直接回大厅
      view = 'lobby';
      return buildLobby(body, p);
    }

    if (showHand) {
      renderFelt(body, SCAM_SEATS, showHand, showHand.seats.map(function (s) { return s.stack; }), stage === 'result');
    }
    lines.forEach(function (t) { sec.appendChild(el('div', 'pk-say', t)); });
    buttons.forEach(function (b2) {
      if (b2.note) sec.appendChild(el('div', 'pk-disabled-note', b2.note));
      sec.appendChild(btn(b2.t, 'bigbtn', b2.fn || function () {}, !!b2.disabled));
    });
    body.appendChild(sec);
  }

  /* ---------- 情报贩子（街头智慧 Lv10，每天一条） ---------- */
  function intelUsedToday(p) {
    return p.intelDay && p.intelDay.day === G.state.day ? p.intelDay.n : 0;
  }

  function buyIntel() {
    var p = ps();
    if (!p) return;
    if (intelUsedToday(p) >= 1) { toast('今天的情报已经买过了'); return rebuild(); }
    if (!canAfford(INTEL_COST)) { toast('钱不够，情报要 🪙' + INTEL_COST); return rebuild(); }
    spend(INTEL_COST);
    var log = Array.isArray(p.intelLog) ? p.intelLog : [];
    var recent = log.slice(-5).map(function (x) { return x.text; });
    var pool = INTEL_RUMORS.filter(function (t) { return recent.indexOf(t) < 0; });
    var item = {
      day: G.state.day,
      text: pickOne(pool.length ? pool : INTEL_RUMORS),
      src: pickOne(INTEL_SRC),
      rel: pickOne(INTEL_REL),
    };
    p.intel = item;
    p.intelDay = { day: G.state.day, n: intelUsedToday(p) + 1 };
    p.intelLog = log.concat([item]).slice(-8);
    G.log('花 🪙' + INTEL_COST + ' 从后门的情报贩子那里买了一条小道消息');
    rebuild();
  }

  function buildIntel(body, p) {
    var sec = el('div', 'sec');
    sec.appendChild(el('div', 'shop-name', '后门的情报贩子'));
    sec.appendChild(el('div', 'shop-sub', '他从不保证真假，只负责卖。今天买过就只能明天再来。'));
    var today = p.intel && p.intel.day === G.state.day && intelUsedToday(p) > 0 ? p.intel : null;
    if (today) {
      sec.appendChild(el('div', 'pk-say', '情报贩子压低声音：「' + today.text + '」'));
      sec.appendChild(el('div', 'pk-intel-src', '来源：' + today.src + '　可信度：' + today.rel));
      sec.appendChild(el('div', 'shop-sub', '今天的情报已经买过了。'));
    } else {
      sec.appendChild(el('div', 'pk-body', '今天还没买。价格 🪙' + INTEL_COST + '，买到的内容随机，真假你自己掂量。'));
      sec.appendChild(btn('买一条情报（🪙' + INTEL_COST + '）', 'bigbtn', buyIntel, !canAfford(INTEL_COST)));
    }
    body.appendChild(sec);

    var log = Array.isArray(p.intelLog) ? p.intelLog.slice().reverse().slice(0, 5) : [];
    if (log.length) {
      var hist = el('div', 'sec');
      hist.appendChild(el('div', 'shop-name', '以前听过的传闻'));
      log.forEach(function (x) {
        hist.appendChild(el('div', 'pk-feed', '第 ' + x.day + ' 天 · ' + x.text + '（' + x.src + '）'));
      });
      body.appendChild(hist);
    }
    body.appendChild(btn('回到大厅', 'bigbtn ghost', function () { view = 'lobby'; rebuild(); }));
  }

  /* ---------- 面板总入口 ---------- */
  function sig() {
    var p = ps();
    if (!p) return 'none';
    if (view === 'table' && p.table) {
      var T = p.table, h = T.hand;
      var hs = h ? [h.street, h.toAct, P().potTotal(h), h.seats.map(function (s) {
        return s.stack + ':' + s.bet + ':' + (s.folded ? 1 : 0) + (s.allIn ? 1 : 0);
      }).join(',')].join('/') : '-';
      return ['t', T.handNo, T.stacks.join(','), hs, T.feed.length, T.last].join('|');
    }
    return [view, p.scam ? p.scam.stage : '', money(), p.scammed ? 1 : 0, p.table ? 1 : 0, inviteMsg,
      (p.intelLog || []).length, intelUsedToday(p), G.state.day].join('|');
  }

  function buildView(body) {
    lastSig = sig();
    var p = ps();
    if (!p) return;
    if (!p.scammed && !p.scam) p.scam = { stage: 'door', entry: money(), loss: 0, hand: null, look: false };
    if (!p.scammed) { view = 'scam'; return buildScam(body, p); }
    if (view === 'table' && p.table) return buildTable(body, p, p.table);
    if (view === 'invite') return buildInvite(body);
    if (view === 'intel' && skillLevel('street') >= 10) return buildIntel(body, p);
    view = 'lobby';
    buildLobby(body, p);
  }

  function tickView() {
    if (sig() !== lastSig) rebuild();
  }

  function openPanel() {
    if (!G.ui || !G.ui.openPanel) { toast('牌场还没开张'); return; }
    ensureStyle();
    G.ui.openPanel({ title: TITLE, build: buildView, tick: tickView });
  }

  /* ---------- 对外接口 ---------- */
  cardroom.enter = function () {
    var p = ps();
    if (!G.state || !p) return;
    if (!p.scammed) {
      view = 'scam';
      if (!p.scam) p.scam = { stage: 'door', entry: money(), loss: 0, hand: null, look: false };
      return openPanel();
    }
    if (p.table) { view = 'table'; return openPanel(); }
    if (money() >= PRIVATE.buyin && Math.random() < PRIVATE_CHANCE) {
      view = 'invite';
      inviteMsg = '';
      inviteSpotted = rng() < spotChance(skillLevel('street'));
      return openPanel();
    }
    view = 'lobby';
    openPanel();
  };

  // 每帧：由 G.poker.update 调用（游戏未暂停时）
  cardroom.tick = function (dt) {
    var s = G.state, p = ps();
    if (!s || !p) return;
    var open = G.isCardroomOpen ? G.isCardroomOpen(s.time) : true;
    if (!open) {                                     // 次日 06:00 打烊：结算离桌，关掉面板
      if (p.table) { cashOut(); G.log('牌场打烊了（次日 06:00），牌桌上的筹码已结算'); }
      if (panelIs(TITLE)) { if (G.ui && G.ui.closeShop) G.ui.closeShop(); }
      return;
    }
    if (!p.table) return;
    if (!live) {                                     // 刷新页面后：上次的牌局按当前筹码结算
      var amt = cashOut();
      G.log('上次的牌局没正常结束，已按当前筹码结算 🪙' + amt);
      return;
    }
    if (view !== 'table' || !panelIs(TITLE)) return;   // 面板关着时牌局暂停
    var T = p.table;
    T.delay = (T.delay || 0) - dt;
    if (T.delay > 0) return;
    step(T);
  };

  G.cardroom = cardroom;
})();
