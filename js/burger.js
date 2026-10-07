/* ============================================================
 * 像素小家 —— 汉堡店「林记汉堡」（burger.js）
 * 只往 G.burger 上挂接口。店名/菜单/工资/班次在 config.js 的 G.BURGER。
 * 接口：
 *   G.burger.isOpen() -> bool                 游戏内营业时间（open ~ close）
 *   G.burger.onDoorClick()                    点店门：走到店门前，再打开店面板（忙碌时直接打开）
 *   G.burger.buy(id) -> {ok, reason}          买汉堡：扣钱，经 G.economy.applyUse 改需求
 *   G.burger.startShift() -> {ok, reason}     打工一班：进入忙碌（G.state.work）
 *   G.burger.update(dt)                       推进打工进度，结束时结算工资与消耗
 * 面板通过 G.ui.openPanel 打开，tick 每 0.2 秒刷新进度与按钮状态。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var burger = (G.burger = G.burger || {});

  var refs = null;           // 当前面板里需要实时刷新的元素

  function cfg() { return G.BURGER || { name: '汉堡店', open: 8, close: 22, menu: [], shift: {} }; }
  function shiftCfg() { return cfg().shift || {}; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function isOpenNow() {
    var t = Number(G.state && G.state.time) || 0;
    return t >= cfg().open && t < cfg().close;
  }

  function clockText() {
    var t = ((Number(G.state.time) || 0) % 24 + 24) % 24;
    return pad2(Math.floor(t)) + ':' + pad2(Math.floor((t % 1) * 60));
  }

  function shiftsLeft() {
    var s = G.state;
    var b = s.burger;
    var used = b && b.day === s.day ? b.shifts : 0;
    return Math.max(0, (shiftCfg().maxPerDay || 0) - used);
  }

  function findMenu(id) {
    var list = cfg().menu || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function effectText(effect) {
    var names = { energy: '精力', hunger: '饱腹', mood: '心情', hygiene: '清洁' };
    return Object.keys(effect || {}).map(function (k) {
      var v = effect[k];
      return (names[k] || k) + (v > 0 ? '+' : '') + v;
    }).join(' ');
  }

  /* ---------- 对外：营业 / 购买 / 打工 ---------- */
  burger.isOpen = isOpenNow;

  burger.buy = function (id) {
    var m = findMenu(id);
    var s = G.state;
    if (!m || !s) return { ok: false, reason: '没有这道菜' };
    if (!isOpenNow()) return { ok: false, reason: '已经打烊了，' + cfg().open + ':00 再来' };
    if (!G.economy.canAfford(m.price)) {
      return { ok: false, reason: '钱不够，「' + m.name + '」还差 ' + (m.price - s.money) + ' 元' };
    }
    G.economy.spend(m.price);
    G.economy.applyUse(null, { effect: m.effect });
    G.log('买了一个「' + m.name + '」，' + effectText(m.effect));
    return { ok: true };
  };

  burger.startShift = function () {
    var s = G.state;
    var sh = shiftCfg();
    if (!s) return { ok: false, reason: '无法开始' };
    if (s.work) return { ok: false, reason: '正在打工，等这一班结束' };
    if (!isOpenNow()) return { ok: false, reason: '现在打烊了，' + cfg().open + ':00 再来吧' };
    if (shiftsLeft() <= 0) return { ok: false, reason: '今天的班已经排满（' + sh.maxPerDay + ' 班）' };
    if (s.needs.energy < sh.minEnergy) {
      return { ok: false, reason: '精力不够（需要 ' + sh.minEnergy + '），先睡一会儿' };
    }
    if (s.needs.hunger < sh.minHunger) {
      return { ok: false, reason: '太饿了（需要饱腹 ' + sh.minHunger + '），先吃点东西' };
    }
    if (!s.burger || s.burger.day !== s.day) s.burger = { day: s.day, shifts: 0 };
    s.burger.shifts += 1;
    s.work = { t: 0, total: sh.duration || 12 };
    G.log('开始打工，这一班大约 ' + s.work.total + ' 秒');
    return { ok: true };
  };

  function finishShift() {
    var s = G.state;
    var sh = shiftCfg();
    s.work = null;
    G.economy.applyUse(null, { effect: sh.cost || {} });
    var mult = G.npc && G.npc.shiftMultiplier ? G.npc.shiftMultiplier() : 1;
    var pay = Math.round((sh.pay || 0) * mult);
    G.economy.earn(pay);
    G.log('打工结束，到账 ' + pay + ' 元' + (mult > 1 ? '（林小满加成 +10%）' : ''));
  }

  burger.update = function (dt) {
    var s = G.state;
    if (!s || !s.work) return;
    s.work.t += dt;
    if (s.work.t >= s.work.total) finishShift();
  };

  /* ---------- 店门 ---------- */
  burger.onDoorClick = function () {
    var s = G.state;
    var S = G.STREET;
    if (!s || !S || !G.player) return;
    if (s.work) { openPanel(); return; }            // 忙碌中不能走动，直接看面板
    var door = S.shop.door;
    var front = { gx: door.gx, gy: door.gy + 1 };
    var p = s.player;
    var c = { gx: Math.floor(p.x / G.TILE), gy: Math.floor(p.y / G.TILE) };
    if (c.gx === front.gx && c.gy === front.gy && !(p.path && p.path.length)) { openPanel(); return; }
    if (!G.player.walkTo || !G.player.walkTo(front.gx, front.gy, openPanel)) G.log('走不到店门口');
  };

  /* ---------- 面板 ---------- */
  function openPanel() {
    if (!G.ui || !G.ui.openPanel) return;
    G.ui.openPanel({ title: cfg().name, build: build, tick: tick });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function sec() { return el('div', 'sec'); }

  function build(body) {
    var sh = shiftCfg();
    refs = {};

    // 营业状态
    var st = sec();
    refs.status = el('div', 'shop-name', '');
    refs.clock = el('div', 'shop-sub', '');
    refs.money = el('div', 'shop-sub', '');
    st.appendChild(refs.status);
    st.appendChild(refs.clock);
    st.appendChild(refs.money);
    st.appendChild(el('div', 'shop-sub', '营业时间 ' + pad2(cfg().open) + ':00 ~ ' + pad2(cfg().close) + ':00'));
    body.appendChild(st);

    // 菜单
    var menuSec = sec();
    menuSec.appendChild(el('div', 'shop-name', '菜单'));
    refs.menu = [];
    (cfg().menu || []).forEach(function (m) {
      var row = el('div', 'menu-row');
      var info = el('div', 'shop-info');
      info.appendChild(el('div', 'shop-name', m.name));
      info.appendChild(el('div', 'shop-sub', m.desc));
      row.appendChild(info);
      var b = el('button', 'pbtn menu-buy', '买 🪙' + m.price);
      b.type = 'button';
      b.addEventListener('click', function () {
        b.blur();
        var r = burger.buy(m.id);
        if (!r.ok && G.ui && G.ui.toast) G.ui.toast(r.reason);
        tick();
      });
      row.appendChild(b);
      menuSec.appendChild(row);
      refs.menu.push({ btn: b });
    });
    body.appendChild(menuSec);

    // 兼职
    var jobSec = sec();
    jobSec.appendChild(el('div', 'shop-name', '兼职 · 打工一班'));
    jobSec.appendChild(el('div', 'shop-sub', '约 ' + (sh.duration || 12) + ' 秒，工资 🪙' + sh.pay + '（林小满好感够高时 +10%）'));
    jobSec.appendChild(el('div', 'shop-sub', '消耗：精力' + sh.cost.energy + ' 饱腹' + sh.cost.hunger + ' 心情' + sh.cost.mood));
    jobSec.appendChild(el('div', 'shop-sub', '需要：精力 ≥' + sh.minEnergy + '、饱腹 ≥' + sh.minHunger));
    refs.shiftLeft = el('div', 'shop-sub', '');
    jobSec.appendChild(refs.shiftLeft);
    refs.barWrap = el('div', 'meter shift-meter');
    var bar = el('div', 'bar');
    refs.fill = el('i', 'fill');
    refs.fill.style.setProperty('--c', '#ffd84a');
    bar.appendChild(refs.fill);
    refs.barWrap.appendChild(el('span', 'lbl', '进度'));
    refs.barWrap.appendChild(bar);
    refs.barNum = el('span', 'num', '');
    refs.barWrap.appendChild(refs.barNum);
    jobSec.appendChild(refs.barWrap);
    refs.shiftBtn = el('button', 'bigbtn', '打工一班');
    refs.shiftBtn.type = 'button';
    refs.shiftBtn.addEventListener('click', function () {
      refs.shiftBtn.blur();
      var r = burger.startShift();
      if (!r.ok && G.ui && G.ui.toast) G.ui.toast(r.reason);
      tick();
    });
    jobSec.appendChild(refs.shiftBtn);
    body.appendChild(jobSec);

    tick();
  }

  // 每 0.2 秒刷新：营业状态、钱、按钮可用性、打工进度（不重建 DOM，点击不会丢）
  function tick() {
    if (!refs || !G.state) return;
    var s = G.state;
    var open = isOpenNow();
    refs.status.textContent = open ? '● 营业中' : '● 已打烊';
    refs.status.style.color = open ? '#9ff0a8' : '#ffb3b3';
    refs.clock.textContent = '现在 ' + clockText() + (open ? '' : '（' + pad2(cfg().open) + ':00 开门）');
    refs.money.textContent = '你的钱 🪙 ' + Math.floor(s.money);

    refs.menu.forEach(function (r, i) {
      var m = cfg().menu[i];
      r.btn.disabled = !open;
      r.btn.classList.toggle('poor', !!m && s.money < m.price);
    });

    refs.shiftLeft.textContent = '今天还能打 ' + shiftsLeft() + ' / ' + (shiftCfg().maxPerDay || 0) + ' 班';
    if (s.work) {
      var pct = Math.max(0, Math.min(100, (s.work.t / s.work.total) * 100));
      refs.fill.style.width = pct + '%';
      refs.barNum.textContent = Math.max(0, Math.ceil(s.work.total - s.work.t)) + 's';
      refs.barWrap.style.display = '';
      refs.shiftBtn.textContent = '打工中…（忙碌，不能走动）';
      refs.shiftBtn.disabled = true;
    } else {
      refs.barWrap.style.display = 'none';
      refs.shiftBtn.textContent = '打工一班';
      refs.shiftBtn.disabled = !open;
    }
  }

  G.burger = burger;
})();
