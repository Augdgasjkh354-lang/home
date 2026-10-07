/* ============================================================
 * ui.js —— HUD / 商店面板 / 建造模式 / 键盘 / 选中浮层
 * 只往 G.ui 上挂接口，所有对其他模块的访问都先判空。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var ui = (G.ui = G.ui || {});

  var TOAST_MAX = 4;
  var TOAST_MS = 2500;
  var LOW_PCT = 25;
  var REFRESH_MS = 200;
  var RESET_ARM_MS = 3000;
  var ICON = 40;
  var FEED_COST = 3;
  var NEED_ORDER = ['energy', 'hunger', 'mood', 'hygiene'];
  var NEED_COLOR = { energy: '#ffd84a', hunger: '#ff9a3c', mood: '#ff7eb6', hygiene: '#5ac8fa' };
  var WEATHER_ICON = { sunny: '☀', rain: '🌧', snow: '❄', cloudy: '☁' };
  var PET_ICON = { cat: '🐱', dog: '🐶' };
  var TABS = [
    { key: 'furniture', label: '家具' },
    { key: 'pets', label: '宠物' },
    { key: 'room', label: '房间' }
  ];

  var CSS = `
#hud { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:6px; }
#hud .hud-left { display:flex; flex-direction:column; gap:4px; flex:1 1 auto; min-width:0; }
#hud .hud-row { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
#hud .hud-box { background:#2a2636ee; border:2px solid #f3ead8; box-shadow:0 0 0 2px #1c1a24; padding:3px 8px; font-size:13px; line-height:16px; white-space:nowrap; }
#hud .hud-warn { background:#ffd84a; color:#1c1a24; border-color:#1c1a24; }
#hud .need { display:flex; align-items:center; gap:4px; background:#2a2636ee; border:2px solid #f3ead8; box-shadow:0 0 0 2px #1c1a24; padding:2px 6px; font-size:12px; }
#hud .need.low { border-color:#ff3b3b; }
#hud .need-label { min-width:2.8em; }
#hud .need-val { min-width:2em; text-align:right; }
#hud .bar { width:72px; }
#hud .need.low .fill { background:#ff3b3b; animation:pxblink .5s steps(2,start) infinite; }
#hud .hud-right { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; }
#hud .hud-right button { font-size:12px; padding:3px 8px; }
.bar { position:relative; height:10px; border:2px solid #f3ead8; background:#1c1a24; overflow:hidden; }
.bar .fill { display:block; height:100%; width:0; background:var(--c, #aaa); transition:width .2s linear; }
@keyframes pxblink { 50% { opacity:.15; } }
.danger { background:#8a2a3a !important; border-color:#ffb3b3 !important; }

.panel-head { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #f3ead8; padding-bottom:6px; margin-bottom:8px; }
.panel-title { font-size:16px; letter-spacing:2px; }
.tabs { display:flex; gap:4px; margin-bottom:8px; }
.tab { flex:1; font-size:13px; padding:4px 0; background:#2a2636; }
.tab.on { background:#f3ead8; color:#2a2636; }
.shop-list { display:flex; flex-direction:column; gap:6px; }
.shop-item { display:flex; align-items:center; gap:8px; background:#3a3350; border:2px solid #f3ead8; padding:4px 6px; }
.shop-item.poor { opacity:.55; }
.shop-icon, .shop-emoji { width:40px; height:40px; flex:none; background:#4a4260; border:2px solid #1c1a24; image-rendering:pixelated; }
.shop-emoji { display:flex; align-items:center; justify-content:center; font-size:22px; }
.shop-info { flex:1; min-width:0; line-height:16px; }
.shop-name { font-size:13px; }
.shop-sub, .shop-price { font-size:11px; color:#cfc4a8; }
.pbtn { font-size:12px; padding:3px 8px; }
.sec { border:2px dashed #7b719c; padding:6px 8px; margin-top:8px; font-size:12px; line-height:17px; }
.pet-actions, .room-actions { display:flex; gap:6px; margin-top:6px; }
.meter { display:flex; align-items:center; gap:6px; font-size:12px; margin-top:4px; }
.meter .lbl { min-width:3em; }
.meter .bar { width:120px; }
.bigbtn { display:block; width:100%; min-height:44px; font-size:14px; margin-top:6px; text-align:center; }
.bigbtn.small { width:auto; min-height:40px; font-size:13px; margin-top:0; flex:none; }
.bigbtn.ghost { background:#2a2636; }
.npc-say { margin-top:8px; padding:6px 8px; background:#3a3350; border-left:4px solid #ff7eb6; font-size:13px; line-height:18px; }
.npc-event { border-color:#ffd84a; }
.story-text { font-size:12px; line-height:18px; color:#e6dcc6; margin-top:4px; }
.menu-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-top:1px dashed #7b719c; }
.menu-row:first-of-type { border-top:none; }
.menu-row .shop-info { flex:1; min-width:0; }
.menu-buy { flex:none; min-height:40px; font-size:13px; }
.menu-buy.poor { opacity:.55; }
.shift-meter { margin-top:6px; }
.shift-meter .bar { width:100%; flex:1; }

#sel-bar { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); display:none; align-items:center; justify-content:center; flex-wrap:wrap; gap:6px; background:#2a2636f0; border:2px solid #f3ead8; box-shadow:0 0 0 2px #1c1a24; padding:6px 8px; font-size:12px; z-index:7; max-width:94vw; }
#sel-bar .sel-name { font-size:13px; }
#build-bar { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); display:none; align-items:center; justify-content:center; gap:10px; background:#2a2636f0; border:2px solid #f3ead8; box-shadow:0 0 0 2px #1c1a24; padding:6px; z-index:7; }
#build-bar button { min-width:96px; min-height:44px; font-size:15px; }

@media (max-width:600px) {
  #hud { font-size:11px; }
  #hud .hud-box { font-size:11px; padding:2px 5px; }
  #hud .need { font-size:11px; padding:2px 4px; }
  #hud .bar { width:44px; }
  #hud .hud-right button { font-size:11px; padding:2px 6px; }
  #panel { width:min(340px, 94vw); }
  .meter .bar { width:80px; }
}
`;

  var els = { needs: {}, inited: false };
  var shopOpen = false;
  var custom = null;    // 其他模块打开的面板：{title, build(body), tick()}，如汉堡店 / 林小满
  var shopTab = 'furniture';
  var refreshers = [];
  var renderedSig = '';
  var lastRefresh = 0;
  var build = null;     // { id, rot, isNew, moveFrom }  建造中的家具
  var lastGrid = null;  // { gx, gy } 鼠标所在格（建造预览用）
  var resetArmedAt = 0;
  var resetTimer = null;

  /* ---------------- 小工具 ---------------- */
  function byId(id) { return document.getElementById(id); }

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

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function pct(v) {
    v = Number(v) || 0;
    return Math.max(0, Math.min(100, v));
  }

  function money() { return G.state ? G.state.money : 0; }

  function canAfford(n) {
    if (G.economy && G.economy.canAfford) return !!G.economy.canAfford(n);
    return money() >= n;
  }

  function spend(n) {
    if (G.economy && G.economy.spend) return G.economy.spend(n);
    G.state.money -= n;
  }

  function earn(n) {
    if (G.economy && G.economy.earn) return G.economy.earn(n);
    G.state.money += n;
  }

  function fpOf(id, rot) {
    var d = G.FURNITURE[id];
    return rot ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }

  function nameOf(id) {
    var d = G.FURNITURE[id];
    return d ? d.name : id;
  }

  function findFurn(uid) {
    var list = (G.state && G.state.furniture) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].uid === uid) return list[i];
    }
    return null;
  }

  function currentRoom() {
    return G.ROOMS[G.state.roomLevel] || G.ROOMS[0];
  }

  /* ---------------- toast ---------------- */
  ui.toast = function (msg) {
    var box = byId('toast');
    if (!box) return;
    var item = el('div', 'toast-item', String(msg));
    box.appendChild(item);
    while (box.children.length > TOAST_MAX) box.removeChild(box.firstElementChild);
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, TOAST_MS);
  };

  /* ---------------- 布局 ---------------- */
  function layout() {
    var hud = byId('hud');
    if (!hud) return;
    var h = hud.offsetHeight || 0;
    if (els.panel) els.panel.style.top = (h + 6) + 'px';
    var toastBox = byId('toast');
    if (toastBox) toastBox.style.top = (h + 4) + 'px';
  }

  /* ---------------- HUD ---------------- */
  function buildHud() {
    var hud = byId('hud');
    hud.innerHTML = '';

    var left = el('div', 'hud-left');
    var row1 = el('div', 'hud-row');
    els.money = el('span', 'hud-box');
    els.date = el('span', 'hud-box');
    els.weather = el('span', 'hud-box');
    els.blackout = el('span', 'hud-box hud-warn', '⚡停电');
    els.blackout.style.display = 'none';
    row1.appendChild(els.money);
    row1.appendChild(els.date);
    row1.appendChild(els.weather);
    row1.appendChild(els.blackout);

    var row2 = el('div', 'hud-row');
    NEED_ORDER.forEach(function (k) {
      var wrap = el('div', 'need');
      wrap.style.setProperty('--c', NEED_COLOR[k]);
      wrap.appendChild(el('span', 'need-label', G.NEED_LABEL ? G.NEED_LABEL[k] : k));
      var bar = el('div', 'bar');
      var fill = el('i', 'fill');
      bar.appendChild(fill);
      var val = el('span', 'need-val', '');
      wrap.appendChild(bar);
      wrap.appendChild(val);
      row2.appendChild(wrap);
      els.needs[k] = { wrap: wrap, fill: fill, val: val };
    });

    left.appendChild(row1);
    left.appendChild(row2);

    var right = el('div', 'hud-right');
    els.shopBtn = btn('商店 B', 'hud-btn', toggleShop);
    els.pauseBtn = btn('暂停', 'hud-btn', togglePause);
    els.resetBtn = btn('重置存档', 'hud-btn', onResetClick);
    right.appendChild(els.shopBtn);
    right.appendChild(els.pauseBtn);
    right.appendChild(els.resetBtn);

    hud.appendChild(left);
    hud.appendChild(right);
  }

  function refreshHud() {
    var s = G.state;
    if (!s || !els.money) return;
    els.money.textContent = '🪙 ' + Math.floor(s.money);

    var t = ((s.time % 24) + 24) % 24;
    var hh = Math.floor(t);
    var mm = Math.floor((t - hh) * 60);
    var season = (G.SEASONS && G.SEASONS[s.season]) || '';
    els.date.textContent = '第' + s.day + '天 ' + season + ' ' + pad2(hh) + ':' + pad2(mm);

    els.weather.textContent = WEATHER_ICON[s.weather] || '☁';
    els.blackout.style.display = (s.flags && s.flags.blackout > 0) ? '' : 'none';

    NEED_ORDER.forEach(function (k) {
      var m = els.needs[k];
      if (!m) return;
      var v = pct(s.needs[k]);
      m.fill.style.width = v + '%';
      m.val.textContent = String(Math.round(v));
      m.wrap.classList.toggle('low', v < LOW_PCT);
    });

    els.pauseBtn.textContent = s.paused ? '继续' : '暂停';
    // 外景时商店/建造不可用（点击提示「回家再整理」）
    var outside = !!(G.street && G.street.isStreet && G.street.isStreet());
    els.shopBtn.style.opacity = outside ? '.5' : '';
  }

  function onResetClick() {
    var now = Date.now();
    if (resetArmedAt && now - resetArmedAt < RESET_ARM_MS) {
      disarmReset();
      if (!G.saveload || !G.saveload.reset) {
        ui.toast('无法重置存档');
        return;
      }
      try {
        G.saveload.reset();
      } catch (err) {
        ui.toast('重置失败');
        return;
      }
      location.reload();
      return;
    }
    resetArmedAt = now;
    els.resetBtn.textContent = '确认重置?';
    els.resetBtn.classList.add('danger');
    clearTimeout(resetTimer);
    resetTimer = setTimeout(disarmReset, RESET_ARM_MS);
  }

  function disarmReset() {
    resetArmedAt = 0;
    clearTimeout(resetTimer);
    if (els.resetBtn) {
      els.resetBtn.textContent = '重置存档';
      els.resetBtn.classList.remove('danger');
    }
  }

  function togglePause() {
    var s = G.state;
    if (!s) return;
    s.paused = !s.paused;
    ui.toast(s.paused ? '已暂停' : '已继续');
    refreshHud();
  }

  function toggleShop() {
    if (shopOpen) ui.closeShop();
    else ui.openShop();
  }

  /* ---------------- 选中浮层 ---------------- */
  function buildSelBar() {
    var host = byId('app') || document.body;
    var bar = el('div');
    bar.id = 'sel-bar';
    els.selName = el('span', 'sel-name', '');
    var moveB = btn('移动', 'pbtn', onSelMove);
    var sellB = btn('回收(退50%)', 'pbtn', onSelRecycle);
    var closeB = btn('×', 'pbtn', function () {
      G.state.selected = null;
      refreshSelBar();
    });
    bar.appendChild(els.selName);
    bar.appendChild(moveB);
    bar.appendChild(sellB);
    bar.appendChild(closeB);
    host.appendChild(bar);
    els.selBar = bar;
  }

  // 建造模式下的触摸按钮条：与键盘 R / ESC 调用同一套函数
  function buildBuildBar() {
    var host = byId('app') || document.body;
    var bar = el('div');
    bar.id = 'build-bar';
    bar.appendChild(btn('旋转', '', rotateBuild));
    bar.appendChild(btn('取消', '', onEsc));
    host.appendChild(bar);
    els.buildBar = bar;
  }

  function refreshSelBar() {
    if (!els.selBar || !G.state) return;
    var uid = G.state.selected;
    var f = uid ? findFurn(uid) : null;
    if (!f) {
      if (uid) G.state.selected = null;
      els.selBar.style.display = 'none';
      return;
    }
    els.selName.textContent = nameOf(f.id);
    els.selBar.style.display = 'flex';
  }

  function onSelMove() {
    var f = G.state.selected ? findFurn(G.state.selected) : null;
    if (f) startMove(f);
  }

  function onSelRecycle() {
    var f = G.state.selected ? findFurn(G.state.selected) : null;
    if (!f) return;
    if (!G.economy || !G.economy.remove) {
      ui.toast('无法回收');
      return;
    }
    var name = nameOf(f.id);
    var before = G.state.money;
    G.economy.remove(f.uid);
    var got = Math.max(0, G.state.money - before);
    G.state.selected = null;
    ui.toast('回收了「' + name + '」，退还 🪙' + got);
    refreshSelBar();
  }

  /* ---------------- 商店面板 ---------------- */
  function tabSig() {
    if (shopTab === 'pets') return 'pets:' + (G.state.pet ? 'y' : 'n');
    if (shopTab === 'room') return 'room:' + G.state.roomLevel;
    return 'furn';
  }

  function drawIcon(canvas, id) {
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON, ICON);
    var drawn = false;
    if (G.render && G.render.drawFurnitureIcon) {
      try {
        G.render.drawFurnitureIcon(ctx, id, 0, 0, ICON);
        drawn = true;
      } catch (err) {
        ctx.clearRect(0, 0, ICON, ICON);
      }
    }
    if (!drawn) {
      var d = G.FURNITURE[id] || {};
      var c = (d.style && d.style.c1) || '#888';
      ctx.fillStyle = c;
      ctx.fillRect(6, 6, ICON - 12, ICON - 12);
      ctx.strokeStyle = '#1c1a24';
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, ICON - 12, ICON - 12);
    }
  }

  function makeMeter(label, color) {
    var wrap = el('div', 'meter');
    wrap.style.setProperty('--c', color);
    var bar = el('div', 'bar');
    var fill = el('i', 'fill');
    bar.appendChild(fill);
    var val = el('span', 'num', '');
    wrap.appendChild(el('span', 'lbl', label));
    wrap.appendChild(bar);
    wrap.appendChild(val);
    return { wrap: wrap, fill: fill, val: val };
  }

  function setMeter(m, v, max) {
    var n = Number(v) || 0;
    m.fill.style.width = Math.max(0, Math.min(100, (n / max) * 100)) + '%';
    m.val.textContent = String(Math.round(n));
  }

  function renderFurniture(body) {
    var list = el('div', 'shop-list');
    Object.keys(G.FURNITURE).forEach(function (id) {
      var d = G.FURNITURE[id];
      if (!(d.price > 0)) return;
      var row = el('div', 'shop-item');
      var cv = document.createElement('canvas');
      cv.width = ICON;
      cv.height = ICON;
      cv.className = 'shop-icon';
      drawIcon(cv, id);
      var info = el('div', 'shop-info');
      info.appendChild(el('div', 'shop-name', d.name));
      info.appendChild(el('div', 'shop-sub', d.w + '×' + d.h + ' 格'));
      info.appendChild(el('div', 'shop-price', '🪙 ' + d.price));
      var b = btn('购买', 'pbtn', function () { buyFurniture(id); });
      row.appendChild(cv);
      row.appendChild(info);
      row.appendChild(b);
      list.appendChild(row);
      refreshers.push(function () {
        var poor = !canAfford(d.price);
        b.disabled = poor;
        row.classList.toggle('poor', poor);
      });
    });
    body.appendChild(list);
  }

  function buyFurniture(id) {
    var r = G.economy && G.economy.buy
      ? G.economy.buy(id)
      : { ok: false, reason: '经济模块未就绪' };
    if (!r || !r.ok) {
      ui.toast((r && r.reason) || '购买失败');
      return;
    }
    ui.closeShop();
    startPlace(id);
  }

  function renderPets(body) {
    var s = G.state;
    if (!s.pet) {
      var list = el('div', 'shop-list');
      Object.keys(G.PETS).forEach(function (type) {
        var p = G.PETS[type];
        var row = el('div', 'shop-item');
        row.appendChild(el('div', 'shop-emoji', PET_ICON[type] || '🐾'));
        var info = el('div', 'shop-info');
        info.appendChild(el('div', 'shop-name', p.name));
        info.appendChild(el('div', 'shop-price', '🪙 ' + p.price));
        var b = btn('领养', 'pbtn', function () { adoptPet(type); });
        row.appendChild(info);
        row.appendChild(b);
        list.appendChild(row);
        refreshers.push(function () {
          var poor = !canAfford(p.price);
          b.disabled = !!G.state.pet || poor;
          row.classList.toggle('poor', poor);
        });
      });
      body.appendChild(list);
      body.appendChild(el('div', 'sec', '领养后宠物会在屋里自己走动、睡觉，记得喂食和抚摸它。'));
      return;
    }

    var pet = s.pet;
    var typeName = (G.PETS[pet.type] && G.PETS[pet.type].name) || pet.type;
    var card = el('div', 'sec');
    card.appendChild(el('div', 'shop-name', (PET_ICON[pet.type] || '🐾') + ' ' + pet.name + '（' + typeName + '）'));
    var hungerM = makeMeter('饥饿', '#ff9a3c');
    var bondM = makeMeter('亲密', '#ff7eb6');
    card.appendChild(hungerM.wrap);
    card.appendChild(bondM.wrap);
    var actions = el('div', 'pet-actions');
    var feedB = btn('喂食 ' + FEED_COST + '元', 'pbtn', feedPet);
    var patB = btn('抚摸', 'pbtn', patPet);
    actions.appendChild(feedB);
    actions.appendChild(patB);
    card.appendChild(actions);
    body.appendChild(card);

    refreshers.push(function () {
      var p = G.state.pet;
      if (!p) return;
      setMeter(hungerM, p.hunger, 100);
      setMeter(bondM, p.bond, 100);
      feedB.disabled = !canAfford(FEED_COST);
    });
  }

  function adoptPet(type) {
    var p = G.PETS[type];
    var s = G.state;
    if (!p || !s) return;
    if (s.pet) {
      ui.toast('已经有宠物了');
      return;
    }
    if (!canAfford(p.price)) {
      ui.toast('钱不够，领养需要 🪙' + p.price);
      return;
    }
    if (!G.petAI || !G.petAI.adopt) {
      ui.toast('宠物模块未就绪');
      return;
    }
    spend(p.price);
    G.petAI.adopt(type);
    if (!G.state.pet) {
      earn(p.price);
      ui.toast('领养失败');
    } else {
      ui.toast('领养了' + p.name + '，名字叫「' + G.state.pet.name + '」');
    }
    renderShop();
  }

  function feedPet() {
    if (!G.state.pet) return;
    if (!canAfford(FEED_COST)) {
      ui.toast('钱不够');
      return;
    }
    if (G.petAI && G.petAI.feed) G.petAI.feed();
    refreshShopNow();
  }

  function patPet() {
    if (!G.state.pet) return;
    if (G.petAI && G.petAI.pat) G.petAI.pat();
    refreshShopNow();
  }

  function renderRoom(body) {
    var s = G.state;
    var cur = G.ROOMS[s.roomLevel] || G.ROOMS[0];
    var nxt = G.ROOMS[s.roomLevel + 1];

    var card = el('div', 'sec');
    card.appendChild(el('div', 'shop-name', '当前房间：' + cur.name));
    card.appendChild(el('div', 'shop-sub', '室内 ' + cur.w + '×' + cur.h + ' 格'));
    if (cur.rent > 0) {
      card.appendChild(el('div', 'shop-sub', '每 7 天需交房租 🪙' + cur.rent + '，升级后免租'));
    }
    body.appendChild(card);

    if (!nxt) {
      body.appendChild(el('div', 'sec', '已经是最高等级了。'));
      return;
    }

    var nextCard = el('div', 'sec');
    nextCard.appendChild(el('div', 'shop-name', '下一级：' + nxt.name));
    nextCard.appendChild(el('div', 'shop-sub', '室内 ' + nxt.w + '×' + nxt.h + ' 格'));
    nextCard.appendChild(el('div', 'shop-price', '升级费用 🪙' + nxt.cost));
    var actions = el('div', 'room-actions');
    var b = btn('升级', 'pbtn', upgradeRoom);
    actions.appendChild(b);
    nextCard.appendChild(actions);
    body.appendChild(nextCard);

    refreshers.push(function () {
      b.disabled = !canAfford(nxt.cost);
    });
  }

  function upgradeRoom() {
    var r = G.economy && G.economy.upgradeRoom
      ? G.economy.upgradeRoom()
      : { ok: false, reason: '经济模块未就绪' };
    if (r && r.ok) ui.toast('房间升级为「' + currentRoom().name + '」！');
    else ui.toast((r && r.reason) || '升级失败');
    renderShop();
  }

  function renderShop() {
    if (!els.panel || !G.state) return;
    refreshers = [];
    renderedSig = tabSig();

    var panel = els.panel;
    panel.innerHTML = '';

    var head = el('div', 'panel-head');
    head.appendChild(el('span', 'panel-title', '商店'));
    head.appendChild(btn('关闭 ×', 'pbtn', function () { ui.closeShop(); }));
    panel.appendChild(head);

    var tabs = el('div', 'tabs');
    TABS.forEach(function (t) {
      tabs.appendChild(btn(t.label, 'tab' + (t.key === shopTab ? ' on' : ''), function () {
        shopTab = t.key;
        renderShop();
      }));
    });
    panel.appendChild(tabs);

    var body = el('div', 'panel-body');
    panel.appendChild(body);
    if (shopTab === 'pets') renderPets(body);
    else if (shopTab === 'room') renderRoom(body);
    else renderFurniture(body);

    refreshShopNow();
  }

  function refreshShopNow() {
    refreshers.forEach(function (f) { f(); });
  }

  ui.openShop = function (tab) {
    if (!els.panel) return;
    if (G.street && G.street.isStreet && G.street.isStreet()) {
      ui.toast('回家再整理');
      return;
    }
    if (typeof tab === 'string') shopTab = tab;
    custom = null;
    shopOpen = true;
    els.panel.classList.remove('hidden');
    layout();
    renderShop();
  };

  ui.closeShop = function () {
    shopOpen = false;
    custom = null;
    refreshers = [];
    if (els.panel) els.panel.classList.add('hidden');
  };

  /* ---------------- 通用面板（汉堡店、林小满等） ---------------- */
  // opts = {title, build(body), tick?()}；build 负责填充内容，tick 每 0.2 秒调用一次做原地刷新
  function paintCustom() {
    if (!els.panel || !custom) return;
    var panel = els.panel;
    panel.innerHTML = '';
    var head = el('div', 'panel-head');
    head.appendChild(el('span', 'panel-title', String(custom.title || '')));
    head.appendChild(btn('关闭 ×', 'pbtn', function () { ui.closeShop(); }));
    panel.appendChild(head);
    var body = el('div', 'panel-body');
    panel.appendChild(body);
    custom.build(body);
    if (custom.tick) custom.tick();
  }

  ui.openPanel = function (opts) {
    if (!els.panel || !opts || typeof opts.build !== 'function') return;
    shopOpen = false;
    refreshers = [];
    custom = opts;
    els.panel.classList.remove('hidden');
    layout();
    paintCustom();
  };

  // 内容有变化时（如点了按钮）整体重建面板内容
  ui.rebuildPanel = function () { if (custom) paintCustom(); };

  /* ---------------- 建造 / 移动 ---------------- */
  // 本地合法性校验：越界、wallItem 必须 y==0、与任何已有家具重叠（含 walkable）均不允许
  function canPlace(id, gx, gy, rot) {
    var s = G.state;
    var d = G.FURNITURE[id];
    if (!s || !d) return { ok: false, reason: '无效家具' };
    var room = currentRoom();
    var f = fpOf(id, rot);
    if (gx < 0 || gy < 0 || gx + f.w > room.w || gy + f.h > room.h) {
      return { ok: false, reason: '超出房间范围' };
    }
    if (d.wallItem && gy !== 0) {
      return { ok: false, reason: '挂件必须贴墙' };
    }
    var list = s.furniture || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var of = fpOf(o.id, o.rot);
      if (gx < o.x + of.w && o.x < gx + f.w && gy < o.y + of.h && o.y < gy + f.h) {
        return { ok: false, reason: '与「' + nameOf(o.id) + '」重叠' };
      }
    }
    // 门口通道（判断逻辑在 economy 里，放置时也会再校验一次）
    if (G.economy && G.economy.doorCheck) {
      var dc = G.economy.doorCheck(id, gx, gy, rot);
      if (!dc.ok) return dc;
    }
    return { ok: true };
  }

  function refundNew(id) {
    if (G.economy && G.economy.refund) G.economy.refund(id);
    else earn(G.FURNITURE[id].price);
  }

  function endBuild() {
    build = null;
    lastGrid = null;
    if (els.buildBar) els.buildBar.style.display = 'none';
    if (G.state) {
      G.state.buildMode = false;
      G.state.placing = null;
    }
    if (G.render) G.render.ghost = null;
  }

  function beginBuild(b) {
    build = b;
    lastGrid = null;
    if (G.state) {
      G.state.buildMode = true;
      G.state.placing = { id: b.id, rot: b.rot };
      G.state.selected = null;
    }
    if (G.render) G.render.ghost = null;
    if (els.buildBar) els.buildBar.style.display = 'flex';
    refreshSelBar();
  }

  // 取消当前建造：新买的退款；移动中的家具放回原位
  function cancelBuild() {
    if (!build) return false;
    if (build.moveFrom) G.state.furniture.push(build.moveFrom);
    else if (build.isNew) refundNew(build.id);
    endBuild();
    return true;
  }

  function refreshGhost() {
    if (!G.render) return;
    if (!build || !lastGrid) {
      G.render.ghost = null;
      return;
    }
    var r = canPlace(build.id, lastGrid.gx, lastGrid.gy, build.rot);
    G.render.ghost = { id: build.id, gx: lastGrid.gx, gy: lastGrid.gy, rot: build.rot, valid: r.ok };
  }

  function startPlace(id) {
    if (!G.state || !G.FURNITURE[id]) return;
    if (G.street && G.street.isStreet && G.street.isStreet()) {
      ui.toast('回家再整理');
      return;
    }
    cancelBuild();
    beginBuild({ id: id, rot: 0, isNew: true, moveFrom: null });
    ui.toast('点击地面放置「' + nameOf(id) + '」，R 旋转，ESC 取消');
  }

  function startMove(furn) {
    var idx = G.state.furniture.indexOf(furn);
    if (idx < 0) return;
    cancelBuild();
    G.state.furniture.splice(idx, 1);
    beginBuild({ id: furn.id, rot: furn.rot, isNew: false, moveFrom: furn });
    ui.toast('移动「' + nameOf(furn.id) + '」：点击新位置放置，ESC 取消');
  }

  function tryPlaceAt(gx, gy) {
    if (!build) return;
    var r = canPlace(build.id, gx, gy, build.rot);
    if (!r.ok) {
      ui.toast(r.reason);
      return;
    }
    var res = G.economy && G.economy.place
      ? G.economy.place(build.id, gx, gy, build.rot)
      : { ok: false, reason: '经济模块未就绪' };
    if (res && res.ok) {
      ui.toast((build.isNew ? '放置了「' : '移动了「') + nameOf(build.id) + '」');
      endBuild();
    } else {
      ui.toast((res && res.reason) || '放置失败');
      cancelBuild();
    }
  }

  function rotateBuild() {
    if (!build) return;
    build.rot ^= 1;
    if (G.state && G.state.placing) G.state.placing.rot = build.rot;
    refreshGhost();
  }

  /* ---------------- 画布交互 ---------------- */
  ui.startPlace = startPlace;

  ui.onCanvasMove = function (sx, sy) {
    if (!build || !G.render || !G.render.screenToTile) return;
    var t = G.render.screenToTile(sx, sy);
    lastGrid = t ? { gx: t.gx, gy: t.gy } : null;
    refreshGhost();
  };

  ui.onCanvasClick = function (sx, sy) {
    var s = G.state;
    if (!s || !G.render || !G.render.screenToTile) return;
    var t = G.render.screenToTile(sx, sy);

    if (build) {
      if (!t) return;
      lastGrid = { gx: t.gx, gy: t.gy };
      tryPlaceAt(t.gx, t.gy);
      return;
    }

    // 门（室内的门开在墙上，格坐标在可用范围之外，所以用不做越界判断的换算）
    var raw = G.render.screenToCell ? G.render.screenToCell(sx, sy) : null;
    if (raw && G.street && G.street.handleClick && G.street.handleClick(raw.gx, raw.gy)) return;
    if (!t) return;

    var outside = !!(G.street && G.street.isStreet && G.street.isStreet());
    if (!outside && s.pet && G.petAI && G.petAI.petAt && G.petAI.petAt(t.gx, t.gy)) {
      if (G.petAI.pat) G.petAI.pat();
      return;
    }

    var f = !outside && G.player && G.player.furnitureAt ? G.player.furnitureAt(t.gx, t.gy) : null;
    if (f) {
      var d = G.FURNITURE[f.id];
      if (d && d.use) {
        if (G.player.useFurniture) G.player.useFurniture(f.uid);
        return;
      }
      s.selected = f.uid;
      refreshSelBar();
      return;
    }

    s.selected = null;
    refreshSelBar();
    if (G.player && G.player.moveTo) G.player.moveTo(t.gx, t.gy);
  };

  /* ---------------- 键盘 ---------------- */
  function onEsc() {
    if (build) {
      var wasMove = !!build.moveFrom;
      cancelBuild();
      ui.toast(wasMove ? '已取消移动' : '已取消放置');
      return;
    }
    if (shopOpen || custom) {
      ui.closeShop();
      return;
    }
    if (G.state && G.state.selected) {
      G.state.selected = null;
      refreshSelBar();
    }
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key || '';

    if (k === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (!e.repeat) togglePause();
      return;
    }
    if (e.repeat) return;

    var lk = k.toLowerCase();
    if (lk === 'b') toggleShop();
    else if (lk === 'r') rotateBuild();
    else if (k === 'Escape' || k === 'Esc') onEsc();
  }

  /* ---------------- 每帧刷新（节流到约 0.2 秒） ---------------- */
  ui.update = function () {
    if (!els.inited || !G.state) return;
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (now - lastRefresh < REFRESH_MS) return;
    lastRefresh = now;

    layout();
    refreshHud();
    refreshSelBar();

    if (shopOpen) {
      if (tabSig() !== renderedSig) renderShop();
      else refreshShopNow();
    } else if (custom && custom.tick) {
      custom.tick();
    }
  };

  /* ---------------- 初始化 ---------------- */
  ui.init = function () {
    if (els.inited) return;
    var hud = byId('hud');
    var panel = byId('panel');
    if (!hud || !panel) return;

    if (!byId('ui-style')) {
      var style = el('style');
      style.id = 'ui-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    els.panel = panel;
    buildHud();
    buildSelBar();
    buildBuildBar();

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', layout);

    els.inited = true;
    layout();
    refreshHud();
  };
})();
