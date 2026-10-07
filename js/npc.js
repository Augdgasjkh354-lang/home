/* ============================================================
 * 像素小家 —— NPC 通用模块（npc.js）
 * 只往 G.npc 上挂接口。三位 NPC：lin（林小满，汉堡店）、mayor（周慕白，市政厅议员）、tech（程念，星河科技）。
 * 人设在 config.js（G.NPCS），文案在 npc-data.js / npc-data2.js（G.NPC_DATA[id]），状态在 G.state.npcs[id]。
 * 接口（id 缺省为 'lin'，保持旧调用可用）：
 *   G.npc.ids                                 ['lin','mayor','tech']
 *   G.npc.fill(savedNpcs, day) -> npcs        补齐存档字段（economy 读档 / newState 调用）
 *   G.npc.visible(id) -> bool                 外景 + 该 NPC 的营业时段内她/他在街上
 *   G.npc.visibleIds() -> [id]                当前在街上的 NPC
 *   G.npc.inHours(id) -> bool                 当前时间是否在该 NPC 的出现时段（不管是否在外景）
 *   G.npc.spot(id) -> {gx,gy}                 站位格
 *   G.npc.at(gx,gy) -> id | null              该格是否是某位在街上的 NPC 的站位
 *   G.npc.blocks(gx,gy) -> bool               该格是否被 NPC 占用（玩家寻路用）
 *   G.npc.handleClick(gx,gy) -> bool          点到 NPC：走到身边后打开对话面板
 *   G.npc.open(id)                            打开该 NPC 的面板（周慕白的面板即「市政厅面板」，见 city.js）
 *   G.npc.affinity(id) / stage(id) / hasPending(id)
 *   G.npc.addAffinity(id, d)                  直接加减好感（其他模块用，如城市项目完成）
 *   G.npc.shiftMultiplier() -> number         林小满好感够高时打工工资加成（burger.js 读取）
 *   G.npc.update(dt)                          每帧：好感事件检查；每天检查一次久不见的衰减
 * 口才（G.skills.bonus('charm')）：所有 NPC 的正面好感收益 ×；Lv5 多一个专属选项；
 *   Lv7 起每天每位 NPC 多聊 1 次；Lv10 起好感事件奖励翻倍。
 * 好感：0~100，阶段 陌生/认识/熟人/朋友/好友/特别的人（阶段文案在 G.NPC_DATA[id].stages）。
 * 面板通过 G.ui.openPanel / rebuildPanel 打开。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var npc = (G.npc = G.npc || {});

  var IDS = ['lin', 'mayor', 'tech'];
  var CHARM_OPT_LV = 5, CHARM_CHAT_LV = 7, CHARM_DOUBLE_LV = 10;
  var GIFT_LABEL = { lin: '送她一个汉堡', mayor: '送他一份礼', tech: '送她点东西' };
  var STORY_LABEL = { lin: '问问她的事', mayor: '问问他的事', tech: '问问她的事' };

  var cur = null;            // 当前面板：{id, view, topic, lastLine, greet}
  var lastTopicId = '';
  var lastSig = '';

  /* ---------- 数据读取（全部判空） ---------- */
  function D(id) { return (G.NPC_DATA && G.NPC_DATA[id]) || {}; }
  function P(id) { return (G.NPCS && G.NPCS[id]) || {}; }
  function LIM(id) { return P(id).limits || { chatPerDay: 2, giftPerDay: 1, decayAfterDays: 3 }; }
  function rec(id) { return (G.state && G.state.npcs && G.state.npcs[id]) || null; }
  function today() { return G.state ? G.state.day : 1; }
  function nowT() { return Number(G.state && G.state.time) || 0; }
  function stages(id) { return D(id).stages || (D('lin').stages) || []; }
  function line(id, k) {
    var v = (D(id).lines || {})[k];
    if (v) return v;
    return (D('lin').lines || {})[k] || '';
  }
  function hours(id) {
    if (P(id).hours) return P(id).hours;
    var B = G.BURGER || { open: 8, close: 22 };
    return { from: B.open, to: B.close };
  }
  function charmLv() { return G.skills && G.skills.level ? G.skills.level('charm') : 0; }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function stageIndex(id, a) {
    var st = stages(id);
    var idx = 0;
    for (var i = 0; i < st.length; i++) if (a >= st[i].min) idx = i;
    return idx;
  }
  function stageOf(id, a) {
    var st = stages(id);
    return st[stageIndex(id, a)] || { name: '', min: 0, greet: ['……'] };
  }

  function chatLimit(id) { return LIM(id).chatPerDay + (charmLv() >= CHARM_CHAT_LV ? 1 : 0); }
  function talksLeft(id) {
    var n = rec(id);
    if (!n) return 0;
    var used = n.lastTalkDay === today() ? n.talksToday : 0;
    return Math.max(0, chatLimit(id) - used);
  }
  function giftsLeft(id) {
    var n = rec(id);
    if (!n) return 0;
    var used = n.giftDay === today() ? n.giftToday : 0;
    return Math.max(0, LIM(id).giftPerDay - used);
  }

  // 送礼清单：林小满用汉堡店菜单（送礼不结算效果，保持原有行为）；其他人在 config.js 的 gifts
  function giftItems(id) {
    if (id === 'lin') {
      return ((G.BURGER && G.BURGER.menu) || []).map(function (m) {
        return { id: m.id, name: m.name, price: m.price, desc: m.desc, noEffect: true };
      });
    }
    return P(id).gifts || [];
  }

  /* ---------- DOM 小工具（与 ui.js 的样式类保持一致） ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function sec() { return el('div', 'sec'); }
  function bigBtn(text, onClick, cls, disabled) {
    var b = el('button', 'bigbtn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (disabled) b.disabled = true;
    b.addEventListener('click', function () { b.blur(); onClick(); });
    return b;
  }
  function meter(label, v, max, color) {
    var wrap = el('div', 'meter');
    wrap.style.setProperty('--c', color);
    var bar = el('div', 'bar');
    var fill = el('i', 'fill');
    fill.style.width = Math.max(0, Math.min(100, (v / max) * 100)) + '%';
    bar.appendChild(fill);
    wrap.appendChild(el('span', 'lbl', label));
    wrap.appendChild(bar);
    wrap.appendChild(el('span', 'num', String(Math.round(v))));
    return wrap;
  }
  function say(text) { return el('div', 'npc-say', text); }
  function rebuild() { if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel(); }

  /* ---------- 状态补齐（读档） ---------- */
  function fillOne(id, src, t, start) {
    var out = {
      affinity: start, lastSeenDay: t, lastTalkDay: 0, talksToday: 0,
      giftDay: 0, giftToday: 0, checkDay: t, rumorDay: 0,
      flags: { story: 0, events: {}, sketch: false }, pending: [],
    };
    if (!src) return out;

    ['affinity', 'lastSeenDay', 'lastTalkDay', 'talksToday', 'giftDay', 'giftToday', 'checkDay', 'rumorDay'].forEach(function (k) {
      if (typeof src[k] === 'number' && isFinite(src[k])) out[k] = src[k];
    });
    out.affinity = G.clamp(Math.round(out.affinity), 0, 100);

    var f = src.flags && typeof src.flags === 'object' ? src.flags : {};
    out.flags = {
      story: G.clamp(Math.floor(typeof f.story === 'number' ? f.story : 0), 0, (D(id).stories || []).length),
      events: f.events && typeof f.events === 'object' ? f.events : {},
      sketch: !!f.sketch,
    };
    out.pending = Array.isArray(src.pending)
      ? src.pending.filter(function (k) { return typeof k === 'string' && out.flags.events[k]; }).slice(0, 8)
      : [];
    return out;
  }

  npc.fill = function (saved, todayNum) {
    var t = typeof todayNum === 'number' ? todayNum : 1;
    var out = {};
    IDS.forEach(function (id) {
      var src = saved && typeof saved === 'object' && saved[id] && typeof saved[id] === 'object' ? saved[id] : null;
      var start = typeof P(id).startAffinity === 'number' ? P(id).startAffinity : 10;
      out[id] = fillOne(id, src, t, start);
    });
    return out;
  };

  /* ---------- 查询 ---------- */
  npc.ids = IDS.slice();

  npc.inHours = function (id) {
    var h = hours(id || 'lin');
    var t = nowT();
    return t >= h.from && t < h.to;
  };
  npc.visible = function (id) {
    id = id || 'lin';
    var s = G.state;
    return !!(s && s.scene === 'street' && G.STREET && P(id).spot && npc.inHours(id));
  };
  npc.visibleIds = function () {
    return IDS.filter(function (id) { return npc.visible(id); });
  };
  npc.spot = function (id) {
    var s = P(id || 'lin').spot || { gx: 0, gy: 0 };
    return { gx: s.gx, gy: s.gy };
  };
  npc.at = function (gx, gy) {
    for (var i = 0; i < IDS.length; i++) {
      var id = IDS[i];
      if (!npc.visible(id)) continue;
      var sp = npc.spot(id);
      if (sp.gx === gx && sp.gy === gy) return id;
    }
    return null;
  };
  npc.blocks = function (gx, gy) { return npc.at(gx, gy) !== null; };
  npc.affinity = function (id) { var n = rec(id || 'lin'); return n ? n.affinity : 0; };
  npc.stage = function (id) { id = id || 'lin'; return stageOf(id, npc.affinity(id)); };
  npc.hasPending = function (id) { var n = rec(id || 'lin'); return !!(n && n.pending && n.pending.length); };
  npc.shiftMultiplier = function () {
    var n = rec('lin');
    var cfg = P('lin').limits || {};
    return n && n.affinity >= cfg.shiftBonusAt ? 1 + (cfg.shiftBonus || 0) : 1;
  };

  /* ---------- 好感与事件 ---------- */
  function rewardText(rw, m) {
    var parts = [];
    if (rw.money) parts.push('到账 ' + rw.money * m + ' 元');
    (G.NEEDS || []).forEach(function (k) {
      if (rw[k]) parts.push((G.NEED_LABEL ? G.NEED_LABEL[k] : k) + ' +' + rw[k] * m);
    });
    if (rw.xp) Object.keys(rw.xp).forEach(function (k) {
      var d = (G.SKILLS || []).filter(function (x) { return x.id === k; })[0];
      parts.push((d ? d.name : k) + '经验 +' + rw.xp[k] * m);
    });
    return parts.join('，');
  }

  function giveReward(id, rw) {
    if (!rw) return '';
    var m = charmLv() >= CHARM_DOUBLE_LV ? 2 : 1;      // 口才 Lv10：事件奖励翻倍
    if (rw.money && G.economy && G.economy.earn) G.economy.earn(rw.money * m);
    var fx = {}, any = false;
    (G.NEEDS || []).forEach(function (k) {
      if (rw[k]) { fx[k] = rw[k] * m; any = true; }
    });
    if (any && G.economy && G.economy.applyUse) G.economy.applyUse(null, { effect: fx });
    if (rw.xp && G.skills && G.skills.addXp) {
      Object.keys(rw.xp).forEach(function (k) { G.skills.addXp(k, rw.xp[k] * m); });
    }
    return rewardText(rw, m);
  }

  // 好感跨过阈值（或开局已达到）的事件：只触发一次，写入 pending 待玩家在面板里确认
  function checkEvents(id) {
    var n = rec(id);
    var evs = D(id).events || {};
    if (!n) return;
    Object.keys(evs).forEach(function (k) {
      var thr = Number(k);
      if (n.affinity < thr || n.flags.events[k]) return;
      n.flags.events[k] = true;
      n.pending.push(k);
      if (n.pending.length > 8) n.pending.shift();
      var summary = giveReward(id, evs[k].reward);
      G.log(P(id).name + '「' + evs[k].title + '」' + (summary ? '：' + summary : ''));
    });
  }

  function addAffinity(id, d) {
    var n = rec(id);
    if (!n || !d) return;
    n.affinity = G.clamp(Math.round(n.affinity + d), 0, 100);
    checkEvents(id);
  }
  npc.addAffinity = function (id, d) { addAffinity(id || 'lin', d); };

  // 口才：只放大正面的好感收益（系数见 config.js 的 G.SKILLS）
  function charmGain(d) {
    if (d > 0 && G.skills && G.skills.bonus) return Math.round(d * G.skills.bonus('charm'));
    return d;
  }

  // 口才 Lv5 的专属选项：林小满用 config 里的 extraOpt，其他人用 npc-data 的 charmOpt
  function charmOpt(id) {
    if (charmLv() < CHARM_OPT_LV) return null;
    if (id === 'lin') {
      var c = null;
      (G.SKILLS || []).forEach(function (x) { if (x.id === 'charm') c = x; });
      return c && c.extraOpt ? c.extraOpt : null;
    }
    return D(id).charmOpt || null;
  }

  npc.update = function () {
    var s = G.state;
    if (!s || !s.npcs) return;
    IDS.forEach(function (id) {
      var n = rec(id);
      if (!n) return;
      checkEvents(id);                                  // 开局已达阈值的事件（如周慕白 30）在这里触发
      if (n.checkDay === s.day) return;
      n.checkDay = s.day;
      // 超过 decayAfterDays 没去看，之后每天 -1，最低降到当前阶段下限
      var gap = s.day - (n.lastSeenDay || 0);
      var floor = stageOf(id, n.affinity).min;
      if (gap > LIM(id).decayAfterDays && n.affinity > floor) n.affinity = Math.max(floor, n.affinity - 1);
    });
  };

  /* ---------- 面板内的操作 ---------- */
  function enterView(v) {
    cur.view = v;
    cur.lastLine = '';
    if (v !== 'chat') cur.topic = null;
  }

  function pickTopic(id) {
    var list = D(id).topics || [];
    if (!list.length) return null;
    var pool = list.filter(function (t) { return t.id !== lastTopicId; });
    if (!pool.length) pool = list;
    var t = pick(pool);
    lastTopicId = t.id;
    return t;
  }

  function startChat() {
    var id = cur.id;
    if (talksLeft(id) <= 0) {
      enterView('home');
      cur.lastLine = line(id, 'tooMuchChat');
      return rebuild();
    }
    cur.topic = pickTopic(id);
    if (!cur.topic) { enterView('home'); return rebuild(); }
    cur.view = 'chat';
    cur.lastLine = '';
    rebuild();
  }

  function chooseOpt(opt) {
    var id = cur.id, n = rec(id);
    if (!n || !cur.topic || !opt) return;
    if (talksLeft(id) <= 0) { enterView('home'); cur.lastLine = line(id, 'tooMuchChat'); return rebuild(); }
    var t = today();
    if (n.lastTalkDay !== t) { n.lastTalkDay = t; n.talksToday = 0; }
    n.talksToday += 1;
    n.lastSeenDay = t;
    var d = charmGain(opt.d);
    addAffinity(id, d);
    G.log('和' + P(id).name + '聊了聊，好感 ' + signed(d));
    if (G.skills && G.skills.addXp && G.SKILL_XP) G.skills.addXp('charm', G.SKILL_XP.chat);
    if (opt.xp && G.skills && G.skills.addXp) Object.keys(opt.xp).forEach(function (k) { G.skills.addXp(k, opt.xp[k]); });
    enterView('home');
    cur.lastLine = opt.r;
    rebuild();
  }

  function cancelChat() {
    enterView('home');
    cur.lastLine = line(cur.id, 'chatCancel');
    rebuild();
  }

  function giveGift(item) {
    var id = cur.id, n = rec(id);
    if (!n || !item) return;
    if (giftsLeft(id) <= 0) { enterView('home'); cur.lastLine = line(id, 'giftLimit'); return rebuild(); }
    if (!G.economy || !G.economy.canAfford(item.price)) {
      if (G.ui && G.ui.toast) G.ui.toast('钱不够，送「' + item.name + '」需要 🪙' + item.price);
      return;
    }
    G.economy.spend(item.price);
    var t = today();
    if (n.giftDay !== t) { n.giftDay = t; n.giftToday = 0; }
    n.giftToday += 1;
    n.lastSeenDay = t;
    var fav = P(id).favorite === item.id;
    var d = 4 + (fav ? 3 : 0);
    if (!item.noEffect && item.effect && G.economy.applyUse) G.economy.applyUse(null, { effect: item.effect });
    addAffinity(id, d);
    G.log('送给' + P(id).name + '一个「' + item.name + '」，好感 ' + signed(d));
    enterView('home');
    cur.lastLine = (D(id).gift && D(id).gift.react && D(id).gift.react[item.id]) || '谢谢。';
    rebuild();
  }

  function askStory() {
    var id = cur.id, n = rec(id);
    if (!n) return;
    n.lastSeenDay = today();
    var list = D(id).stories || [];
    var seg = list[n.flags.story];
    cur.view = 'story';
    cur.topic = null;
    if (!seg) {
      cur.lastLine = line(id, 'storyDone');
    } else if (n.affinity >= seg.at) {
      n.flags.story += 1;            // 递进解锁，解锁后可重读
      cur.lastLine = seg.ask;
    } else {
      cur.lastLine = fmt(line(id, 'storyLocked'), { at: seg.at });
    }
    rebuild();
  }

  // 程念的「内幕」：好感 >= 40 时每天一次，随机一只股票的风声（不保证准确）
  function askRumor() {
    var id = cur.id, n = rec(id);
    if (!n) return;
    var r = D(id).rumor || {};
    n.lastSeenDay = today();
    enterView('home');
    if (n.rumorDay === today()) { cur.lastLine = r.done || ''; return rebuild(); }
    n.rumorDay = today();
    var list = G.STOCKS || [];
    if (!list.length) cur.lastLine = r.none || '';
    else {
      var st = pick(list);
      cur.lastLine = fmt(Math.random() < 0.5 ? r.up : r.down, { name: st.name });
    }
    if (G.skills && G.skills.addXp) G.skills.addXp('invest', 6);
    rebuild();
  }

  function dismiss(k) {
    var n = rec(cur.id);
    if (!n) return;
    n.pending = n.pending.filter(function (x) { return x !== k; });
    rebuild();
  }

  /* ---------- 面板内容 ---------- */
  // 面板头像：用 render.js 的人物像素画 16x16 放大 3 倍
  function portrait(id) {
    var look = P(id).look;
    if (!look || !G.render || !G.render.drawNpcSprite) return null;
    var cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 16;
    cv.style.width = '48px';
    cv.style.height = '48px';
    cv.style.imageRendering = 'pixelated';
    cv.style.border = '2px solid #f3ead8';
    cv.style.background = '#3a3350';
    cv.style.float = 'right';
    cv.style.marginLeft = '8px';
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    G.render.drawNpcSprite(g, 0, 0, 0, false, look);
    return cv;
  }

  function buildCard(body, id, n) {
    var p = P(id);
    var st = stageOf(id, n.affinity);
    var all = stages(id);
    var next = all[stageIndex(id, n.affinity) + 1];
    var card = sec();
    var pic = portrait(id);
    if (pic) card.appendChild(pic);
    card.appendChild(el('div', 'shop-name', p.name + '（' + p.age + '岁）'));
    card.appendChild(el('div', 'shop-sub', p.job));
    card.appendChild(el('div', 'shop-price', '称号：「' + st.name + '」'));
    card.appendChild(meter('好感', n.affinity, 100, '#ff7eb6'));
    card.appendChild(el('div', 'shop-sub', next ? '距离「' + next.name + '」还差 ' + (next.min - n.affinity) : '已经是最亲近的阶段了'));
    var chatUsed = chatLimit(id) - talksLeft(id);
    var giftUsed = LIM(id).giftPerDay - giftsLeft(id);
    card.appendChild(el('div', 'shop-sub', '今天：聊天 ' + chatUsed + '/' + chatLimit(id) + '　送礼 ' + giftUsed + '/' + LIM(id).giftPerDay));
    body.appendChild(card);
  }

  function buildPending(body, id, n) {
    (n.pending || []).forEach(function (k) {
      var ev = (D(id).events || {})[k];
      if (!ev) return;
      var box = sec();
      box.classList.add('npc-event');
      box.appendChild(el('div', 'shop-name', '✦ ' + ev.title));
      box.appendChild(say(ev.text));
      box.appendChild(bigBtn(line(id, 'eventDismiss') || '知道了', function () { dismiss(k); }));
      body.appendChild(box);
    });
  }

  function buildHome(body, id, n) {
    body.appendChild(bigBtn('聊聊天（今天还能聊 ' + talksLeft(id) + ' 次）', startChat));
    body.appendChild(bigBtn((GIFT_LABEL[id] || '送礼') + '（今天' + (giftsLeft(id) > 0 ? '还没送' : '已经送过') + '）', function () {
      enterView('gift');
      cur.lastLine = '想送哪一样？';
      rebuild();
    }));
    body.appendChild(bigBtn(STORY_LABEL[id] || '问问他的事', askStory));
    if (id === 'tech' && n.affinity >= 40) {
      var done = n.rumorDay === today();
      body.appendChild(bigBtn((D(id).rumor && D(id).rumor.ask) + (done ? '（今天已问过）' : ''), askRumor, '', done));
    }
    if (id === 'mayor') {
      body.appendChild(bigBtn('市政事务 · 项目与提案', function () { enterView('proj'); rebuild(); }));
    }
  }

  function buildChat(body, id) {
    if (!cur.topic) return;
    cur.topic.opts.forEach(function (opt) {
      body.appendChild(bigBtn(opt.t, function () { chooseOpt(opt); }));
    });
    var extra = charmOpt(id);
    if (extra) body.appendChild(bigBtn(extra.t, function () { chooseOpt(extra); }));
    body.appendChild(bigBtn('算了，不聊了', cancelChat, 'ghost'));
  }

  function buildGift(body, id) {
    var list = el('div', 'shop-list');
    giftItems(id).forEach(function (m) {
      var row = el('div', 'shop-item');
      var info = el('div', 'shop-info');
      info.appendChild(el('div', 'shop-name', m.name));
      info.appendChild(el('div', 'shop-sub', m.desc || ''));
      info.appendChild(el('div', 'shop-price', '🪙 ' + m.price + (P(id).favorite === m.id ? '  ♥最爱' : '')));
      row.appendChild(info);
      row.appendChild(bigBtn('送 🪙' + m.price, function () { giveGift(m); }, 'small'));
      list.appendChild(row);
    });
    body.appendChild(list);
    body.appendChild(bigBtn('返回', function () { enterView('home'); rebuild(); }, 'ghost'));
  }

  function buildStory(body, id, n) {
    var list = D(id).stories || [];
    for (var i = 0; i < n.flags.story && i < list.length; i++) {
      var box = sec();
      box.appendChild(el('div', 'shop-name', '· ' + list[i].title));
      box.appendChild(el('div', 'story-text', list[i].text));
      body.appendChild(box);
    }
    if (!n.flags.story) body.appendChild(el('div', 'sec', '还没有听过的故事。'));
    body.appendChild(bigBtn('返回', function () { enterView('home'); rebuild(); }, 'ghost'));
  }

  function buildProj(body) {
    if (G.city && G.city.buildProjects) G.city.buildProjects(body);
    body.appendChild(bigBtn('返回', function () { enterView('home'); rebuild(); }, 'ghost'));
  }

  // 面板签名：数值或状态变化时才整体重建（不打断点击）
  function sig() {
    if (!cur) return '';
    var id = cur.id, n = rec(id) || {};
    return [
      id, cur.view, n.affinity, (n.pending || []).length, talksLeft(id), giftsLeft(id),
      npc.inHours(id) ? 1 : 0, cur.lastLine, cur.topic ? cur.topic.id : '',
      n.rumorDay, n.flags ? n.flags.story : 0,
      G.city && G.city.sig ? G.city.sig() : '',
    ].join('|');
  }

  function build(body) {
    var id = cur.id, n = rec(id);
    if (!n) return;
    lastSig = sig();
    buildCard(body, id, n);
    if (id === 'mayor' && G.city && G.city.buildIndexes) G.city.buildIndexes(body);
    buildPending(body, id, n);

    var speech = cur.lastLine;
    if (cur.view === 'chat' && cur.topic) speech = cur.topic.prompt;
    if (!speech && cur.view === 'home') speech = cur.greet;
    if (speech) body.appendChild(say(speech));

    if (cur.view === 'chat') buildChat(body, id);
    else if (cur.view === 'gift') buildGift(body, id);
    else if (cur.view === 'story') buildStory(body, id, n);
    else if (cur.view === 'proj') buildProj(body, id);
    else buildHome(body, id, n);
  }

  function tick() {
    if (!cur || !G.ui || !G.ui.rebuildPanel) return;
    if (sig() !== lastSig) G.ui.rebuildPanel();
  }

  npc.open = function (id) {
    id = id || 'lin';
    var n = rec(id);
    if (!n || !G.ui || !G.ui.openPanel) return;
    var s = G.state;
    var longAway = s.day - n.lastSeenDay > LIM(id).decayAfterDays;
    n.lastSeenDay = s.day;
    cur = {
      id: id, view: 'home', topic: null,
      lastLine: longAway ? line(id, 'longAway') : '',
      greet: pick(stageOf(id, n.affinity).greet || ['……']),
    };
    lastSig = sig();
    G.ui.openPanel({ title: P(id).title || P(id).name, build: build, tick: tick });
  };

  // 点到 NPC：先走到她/他身边（站位格本身不可走），到了再打开面板
  npc.handleClick = function (gx, gy) {
    var id = npc.at(gx, gy);
    if (!id) return false;
    var s = G.state;
    if (!s || !G.player) return true;
    var p = s.player;
    var c = { gx: Math.floor(p.x / G.TILE), gy: Math.floor(p.y / G.TILE) };
    var sp = npc.spot(id);
    var adjacent = Math.abs(c.gx - sp.gx) + Math.abs(c.gy - sp.gy) === 1;
    if (adjacent && !(p.path && p.path.length)) { npc.open(id); return true; }
    if (s.work) { G.log('打工中，等这一班结束再去找人'); return true; }

    var cands = [
      { gx: sp.gx - 1, gy: sp.gy },
      { gx: sp.gx, gy: sp.gy + 1 },
      { gx: sp.gx + 1, gy: sp.gy },
      { gx: sp.gx, gy: sp.gy - 1 },
    ];
    for (var i = 0; i < cands.length; i++) {
      var cd = cands[i];
      if (G.player.isBlocked && G.player.isBlocked(cd.gx, cd.gy)) continue;
      if (G.player.walkTo && G.player.walkTo(cd.gx, cd.gy, function () { npc.open(id); })) return true;
    }
    G.log('走不到' + P(id).name + '身边');
    return true;
  };

  G.npc = npc;
})();
