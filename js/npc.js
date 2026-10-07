/* ============================================================
 * 像素小家 —— NPC 林小满（npc.js）
 * 只往 G.npc 上挂接口。人设在 config.js（G.NPCS.lin），文案在 npc-data.js。
 * 接口：
 *   G.npc.fill(savedNpcs, day) -> npcs     补齐存档字段（economy 读档时调用）
 *   G.npc.visible() -> bool                外景 + 营业时间内她在街上
 *   G.npc.spot() -> {gx,gy}                她站的格子
 *   G.npc.blocks(gx,gy) -> bool            该格是否被她占用（玩家寻路用）
 *   G.npc.handleClick(gx,gy) -> bool       点到她：走到身边后打开对话面板
 *   G.npc.open()                           直接打开对话面板
 *   G.npc.affinity() / stage() / hasPending()
 *   G.npc.shiftMultiplier() -> number      好感够高时打工工资加成
 *   G.npc.update(dt)                       每天检查一次：久不见则好感慢慢降（不跨阶段）
 * 好感：0~100，阶段 陌生/认识/熟人/朋友/好友/特别的人。
 * 面板通过 G.ui.openPanel / rebuildPanel 打开。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var npc = (G.npc = G.npc || {});

  var view = 'home';        // home | chat | gift | story
  var topic = null;         // 当前聊天话题
  var lastTopicId = '';
  var lastLine = '';        // 她刚说的一句（操作后的回应）
  var greet = '';           // 本次打开面板时的开场白

  function D() { return G.NPC_DATA || {}; }
  function P() { return (G.NPCS && G.NPCS.lin) || {}; }
  function L() {
    return P().limits || { chatPerDay: 2, giftPerDay: 1, decayAfterDays: 3, shiftBonusAt: 60, shiftBonus: 0.1 };
  }
  function lin() { return (G.state && G.state.npcs && G.state.npcs.lin) || null; }
  function today() { return G.state ? G.state.day : 1; }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function stageIndex(a) {
    var st = D().stages || [];
    var idx = 0;
    for (var i = 0; i < st.length; i++) if (a >= st[i].min) idx = i;
    return idx;
  }
  function stageOf(a) {
    var st = D().stages || [];
    return st[stageIndex(a)] || { name: '', min: 0, greet: ['……'] };
  }
  function isOpenHour(t) {
    var B = G.BURGER || { open: 8, close: 22 };
    return t >= B.open && t < B.close;
  }

  function talksLeft() {
    var n = lin();
    if (!n) return 0;
    var used = n.lastTalkDay === today() ? n.talksToday : 0;
    return Math.max(0, L().chatPerDay - used);
  }
  function giftsLeft() {
    var n = lin();
    if (!n) return 0;
    var used = n.giftDay === today() ? n.giftToday : 0;
    return Math.max(0, L().giftPerDay - used);
  }

  /* ---------- DOM 小工具（与 ui.js 的样式类保持一致） ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function sec() { return el('div', 'sec'); }
  function bigBtn(text, onClick, cls) {
    var b = el('button', 'bigbtn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
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
  function say(text) {
    return el('div', 'npc-say', text);
  }
  function rebuild() {
    if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel();
  }

  /* ---------- 状态补齐（读档） ---------- */
  npc.fill = function (saved, todayNum) {
    var t = typeof todayNum === 'number' ? todayNum : 1;
    var out = {
      affinity: 10, lastSeenDay: t, lastTalkDay: 0, talksToday: 0,
      giftDay: 0, giftToday: 0, checkDay: t,
      flags: { story: 0, events: {}, sketch: false }, pending: [],
    };
    var src = saved && typeof saved === 'object' && saved.lin && typeof saved.lin === 'object' ? saved.lin : null;
    if (!src) return { lin: out };

    ['affinity', 'lastSeenDay', 'lastTalkDay', 'talksToday', 'giftDay', 'giftToday', 'checkDay'].forEach(function (k) {
      if (typeof src[k] === 'number' && isFinite(src[k])) out[k] = src[k];
    });
    out.affinity = G.clamp(Math.round(out.affinity), 0, 100);

    var f = src.flags && typeof src.flags === 'object' ? src.flags : {};
    out.flags = {
      story: G.clamp(Math.floor(typeof f.story === 'number' ? f.story : 0), 0, (D().stories || []).length),
      events: f.events && typeof f.events === 'object' ? f.events : {},
      sketch: !!f.sketch,
    };
    out.pending = Array.isArray(src.pending)
      ? src.pending.filter(function (k) { return typeof k === 'string' && out.flags.events[k]; }).slice(0, 5)
      : [];
    return { lin: out };
  };

  /* ---------- 查询 ---------- */
  npc.spot = function () {
    var s = P().spot || { gx: 13, gy: 4 };
    return { gx: s.gx, gy: s.gy };
  };
  npc.visible = function () {
    var s = G.state;
    return !!(s && s.scene === 'street' && G.STREET && isOpenHour(Number(s.time) || 0));
  };
  npc.blocks = function (gx, gy) {
    if (!npc.visible()) return false;
    var sp = npc.spot();
    return gx === sp.gx && gy === sp.gy;
  };
  npc.affinity = function () { var n = lin(); return n ? n.affinity : 0; };
  npc.stage = function () { return stageOf(npc.affinity()); };
  npc.hasPending = function () { var n = lin(); return !!(n && n.pending && n.pending.length); };
  npc.shiftMultiplier = function () {
    var n = lin();
    var l = L();
    return n && n.affinity >= l.shiftBonusAt ? 1 + l.shiftBonus : 1;
  };

  /* ---------- 好感与奖励 ---------- */
  function giveReward(rw) {
    if (!rw || !G.economy) return;
    if (rw.money) G.economy.earn(rw.money);
    var fx = {};
    var any = false;
    (G.NEEDS || []).forEach(function (k) {
      if (rw[k]) { fx[k] = rw[k]; any = true; }
    });
    if (any && G.economy.applyUse) G.economy.applyUse(null, { effect: fx });
  }

  function addAffinity(d) {
    var n = lin();
    if (!n || !d) return;
    var before = n.affinity;
    n.affinity = G.clamp(Math.round(before + d), 0, 100);
    var evs = D().events || {};
    Object.keys(evs).forEach(function (k) {
      var thr = Number(k);
      if (before < thr && n.affinity >= thr && !n.flags.events[k]) {
        n.flags.events[k] = true;      // 一次性
        n.pending.push(k);
        giveReward(evs[k].reward);
        G.log(evs[k].log || '和林小满的关系又近了一步');
      }
    });
  }

  // 每天检查一次：超过 decayAfterDays 没去看她，每天 -1，最低降到当前阶段下限
  npc.update = function () {
    var s = G.state, n = lin();
    if (!s || !n || n.checkDay === s.day) return;
    n.checkDay = s.day;
    var gap = s.day - (n.lastSeenDay || 0);
    if (gap > L().decayAfterDays && n.affinity > stageOf(n.affinity).min) {
      n.affinity = Math.max(stageOf(n.affinity).min, n.affinity - 1);
    }
  };

  /* ---------- 面板操作 ---------- */
  function enterView(v) {
    view = v;
    lastLine = '';
    if (v !== 'chat') topic = null;
  }

  function pickTopic() {
    var list = D().topics || [];
    if (!list.length) return null;
    var pool = list.filter(function (t) { return t.id !== lastTopicId; });
    if (!pool.length) pool = list;
    var t = pick(pool);
    lastTopicId = t.id;
    return t;
  }

  function startChat() {
    if (talksLeft() <= 0) {
      enterView('home');
      lastLine = D().lines.tooMuchChat;
      return rebuild();
    }
    topic = pickTopic();
    if (!topic) { enterView('home'); return rebuild(); }
    view = 'chat';
    lastLine = '';
    rebuild();
  }

  // 口才：只放大正面的好感收益（系数见 config.js 的 G.SKILLS）
  function charmGain(d) {
    if (d > 0 && G.skills && G.skills.bonus) return Math.round(d * G.skills.bonus('charm'));
    return d;
  }

  // 口才达到 extraOpt.lv 级时，聊天多出的一个选项（没有则 null）
  function charmExtra() {
    var list = G.SKILLS || [];
    var c = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === 'charm') c = list[i];
    if (!c || !c.extraOpt || !G.skills || !G.skills.level) return null;
    return G.skills.level('charm') >= c.extraOpt.lv ? c.extraOpt : null;
  }

  function chooseOpt(opt) {
    var n = lin();
    if (!n || !topic || !opt) return;
    if (talksLeft() <= 0) { enterView('home'); lastLine = D().lines.tooMuchChat; return rebuild(); }
    var t = today();
    if (n.lastTalkDay !== t) { n.lastTalkDay = t; n.talksToday = 0; }
    n.talksToday += 1;
    n.lastSeenDay = t;
    var d = charmGain(opt.d);
    addAffinity(d);
    G.log('和林小满聊了聊，好感 ' + signed(d));
    if (G.skills && G.skills.addXp && G.SKILL_XP) G.skills.addXp('charm', G.SKILL_XP.chat);
    enterView('home');
    lastLine = opt.r;
    rebuild();
  }

  function cancelChat() {
    enterView('home');
    lastLine = D().lines.chatCancel;
    rebuild();
  }

  function giveBurger(m) {
    var n = lin();
    if (!n || !m) return;
    if (giftsLeft() <= 0) { enterView('home'); lastLine = D().lines.giftLimit; return rebuild(); }
    if (!G.economy || !G.economy.canAfford(m.price)) {
      if (G.ui && G.ui.toast) G.ui.toast('钱不够，送「' + m.name + '」需要 🪙' + m.price);
      return;
    }
    G.economy.spend(m.price);
    var t = today();
    if (n.giftDay !== t) { n.giftDay = t; n.giftToday = 0; }
    n.giftToday += 1;
    n.lastSeenDay = t;
    var bonus = P().favorite === m.id ? 3 : 0;
    addAffinity(4 + bonus);
    G.log('送给林小满一个「' + m.name + '」，好感 ' + signed(4 + bonus));
    enterView('home');
    lastLine = (D().gift && D().gift.react && D().gift.react[m.id]) || '谢谢。';
    rebuild();
  }

  function askStory() {
    var n = lin();
    if (!n) return;
    n.lastSeenDay = today();
    var list = D().stories || [];
    var seg = list[n.flags.story];
    view = 'story';
    topic = null;
    if (!seg) {
      lastLine = D().lines.storyDone;
    } else if (n.affinity >= seg.at) {
      n.flags.story += 1;            // 递进解锁，解锁后可重读
      lastLine = seg.ask;
    } else {
      lastLine = fmt(D().lines.storyLocked, { at: seg.at });
    }
    rebuild();
  }

  function dismiss(k) {
    var n = lin();
    if (!n) return;
    n.pending = n.pending.filter(function (x) { return x !== k; });
    rebuild();
  }

  /* ---------- 面板内容 ---------- */
  function buildCard(body, n) {
    var p = P();
    var st = stageOf(n.affinity);
    var stages = D().stages || [];
    var next = stages[stageIndex(n.affinity) + 1];
    var card = sec();
    card.appendChild(el('div', 'shop-name', p.name + '（' + p.age + '岁）'));
    card.appendChild(el('div', 'shop-sub', p.job));
    card.appendChild(el('div', 'shop-price', '称号：「' + st.name + '」'));
    card.appendChild(meter('好感', n.affinity, 100, '#ff7eb6'));
    card.appendChild(el('div', 'shop-sub', next ? '距离「' + next.name + '」还差 ' + (next.min - n.affinity) : '已经是最亲近的阶段了'));
    var chatUsed = L().chatPerDay - talksLeft();
    var giftUsed = L().giftPerDay - giftsLeft();
    card.appendChild(el('div', 'shop-sub', '今天：聊天 ' + chatUsed + '/' + L().chatPerDay + '　送礼 ' + giftUsed + '/' + L().giftPerDay));
    body.appendChild(card);
  }

  function buildPending(body, n) {
    (n.pending || []).forEach(function (k) {
      var ev = (D().events || {})[k];
      if (!ev) return;
      var box = sec();
      box.classList.add('npc-event');
      box.appendChild(el('div', 'shop-name', '✦ ' + ev.title));
      box.appendChild(say(ev.text));
      box.appendChild(bigBtn(D().lines.eventDismiss, function () { dismiss(k); }));
      body.appendChild(box);
    });
  }

  function buildHome(body) {
    body.appendChild(bigBtn('聊聊天（今天还能聊 ' + talksLeft() + ' 次）', startChat));
    body.appendChild(bigBtn('送她一个汉堡（今天' + (giftsLeft() > 0 ? '还没送' : '已经送过') + '）', function () {
      enterView('gift');
      lastLine = '想请她吃哪一个？';
      rebuild();
    }));
    body.appendChild(bigBtn('问问她的事', askStory));
  }

  function buildChat(body) {
    if (!topic) return;
    topic.opts.forEach(function (opt) {
      body.appendChild(bigBtn(opt.t, function () { chooseOpt(opt); }));
    });
    var extra = charmExtra();
    if (extra) body.appendChild(bigBtn(extra.t, function () { chooseOpt(extra); }));
    body.appendChild(bigBtn('算了，不聊了', cancelChat, 'ghost'));
  }

  function buildGift(body) {
    var list = el('div', 'shop-list');
    var menu = (G.BURGER && G.BURGER.menu) || [];
    menu.forEach(function (m) {
      var row = el('div', 'shop-item');
      var info = el('div', 'shop-info');
      info.appendChild(el('div', 'shop-name', m.name));
      info.appendChild(el('div', 'shop-sub', m.desc));
      info.appendChild(el('div', 'shop-price', '🪙 ' + m.price + (P().favorite === m.id ? '  ♥她最爱' : '')));
      row.appendChild(info);
      row.appendChild(bigBtn('送 🪙' + m.price, function () { giveBurger(m); }, 'small'));
      list.appendChild(row);
    });
    body.appendChild(list);
    body.appendChild(bigBtn('返回', function () { enterView('home'); rebuild(); }, 'ghost'));
  }

  function buildStory(body, n) {
    var list = D().stories || [];
    for (var i = 0; i < n.flags.story && i < list.length; i++) {
      var box = sec();
      box.appendChild(el('div', 'shop-name', '· ' + list[i].title));
      box.appendChild(el('div', 'story-text', list[i].text));
      body.appendChild(box);
    }
    if (!n.flags.story) body.appendChild(el('div', 'sec', '还没有听过她的故事。'));
    body.appendChild(bigBtn('返回', function () { enterView('home'); rebuild(); }, 'ghost'));
  }

  function build(body) {
    var n = lin();
    if (!n) return;
    buildCard(body, n);
    buildPending(body, n);

    var speech = lastLine;
    if (view === 'chat' && topic) speech = topic.prompt;
    if (!speech && view === 'home') speech = greet;
    if (speech) body.appendChild(say(speech));

    if (view === 'chat') buildChat(body);
    else if (view === 'gift') buildGift(body);
    else if (view === 'story') buildStory(body, n);
    else buildHome(body);
  }

  function openDialog() {
    var n = lin();
    if (!n || !G.ui || !G.ui.openPanel) return;
    var s = G.state;
    var longAway = s.day - n.lastSeenDay > L().decayAfterDays;
    n.lastSeenDay = s.day;
    enterView('home');
    lastLine = longAway ? D().lines.longAway : '';
    greet = pick(stageOf(n.affinity).greet || ['……']);
    G.ui.openPanel({ title: P().name, build: build });
  }

  npc.open = openDialog;

  // 点到她：先走到她身边（她站的格子本身不可走），到了再打开面板
  npc.handleClick = function (gx, gy) {
    if (!npc.blocks(gx, gy)) return false;
    var s = G.state;
    if (!s || !G.player) return true;
    var p = s.player;
    var c = { gx: Math.floor(p.x / G.TILE), gy: Math.floor(p.y / G.TILE) };
    var sp = npc.spot();
    var adjacent = Math.abs(c.gx - sp.gx) + Math.abs(c.gy - sp.gy) === 1;
    if (adjacent && !(p.path && p.path.length)) { openDialog(); return true; }
    if (s.work) { G.log('打工中，等这一班结束再去找她'); return true; }

    var cands = [
      { gx: sp.gx - 1, gy: sp.gy },
      { gx: sp.gx, gy: sp.gy + 1 },
      { gx: sp.gx + 1, gy: sp.gy },
      { gx: sp.gx, gy: sp.gy - 1 },
    ];
    for (var i = 0; i < cands.length; i++) {
      var cd = cands[i];
      if (G.player.isBlocked && G.player.isBlocked(cd.gx, cd.gy)) continue;
      if (G.player.walkTo && G.player.walkTo(cd.gx, cd.gy, openDialog)) return true;
    }
    G.log('走不到她身边');
    return true;
  };

  G.npc = npc;
})();
