/* ============================================================
 * 像素小家 —— 经济 / 随机事件 / 存档（economy.js）
 * 只往 G.economy、G.events、G.saveload 上挂对象。
 * ============================================================ */
(function () {
  'use strict';

  window.G = window.G || {};
  var G = window.G;

  var SAVE_KEY = 'pixel-home-save-v1';
  var AUTOSAVE_MS = 20000;
  var RENT_CYCLE = 7;      // 房租周期（天）
  var RENT_LEVEL = 0;      // 只有出租小屋要交房租
  var WEATHER_LABEL = { sunny: '晴', rain: '雨', snow: '雪', cloudy: '阴' };

  // 每季的天气分布（春/夏/秋/冬）
  var SEASON_WEATHER = [
    { sunny: 0.5, rain: 0.35, cloudy: 0.15 },
    { sunny: 0.6, rain: 0.3,  cloudy: 0.1 },
    { sunny: 0.5, cloudy: 0.3, rain: 0.2 },
    { sunny: 0.3, cloudy: 0.3, snow: 0.4 },
  ];

  /* ---------- 工具 ---------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function pickWeighted(map) {
    var r = Math.random(), acc = 0, last = null;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      acc += map[k];
      last = k;
      if (r < acc) return k;
    }
    return last;
  }

  function pickWeather(season) {
    return pickWeighted(SEASON_WEATHER[((season % 4) + 4) % 4]) || 'sunny';
  }

  function addNeed(key, v) {
    var n = G.state && G.state.needs;
    if (!n || typeof n[key] !== 'number') return;
    n[key] = G.clamp(n[key] + v, 0, 100);
  }

  function petName() {
    return (G.state && G.state.pet && G.state.pet.name) || '宠物';
  }

  /* ============================================================
   * G.economy
   * ============================================================ */
  var economy = {};

  economy.auraBonus = function () {
    var sum = 0;
    var list = (G.state && G.state.furniture) || [];
    for (var i = 0; i < list.length; i++) {
      var d = G.FURNITURE[list[i].id];
      if (d && d.mood_aura) sum += d.mood_aura;
    }
    return sum;
  };

  economy.canAfford = function (n) {
    return G.state.money >= (n || 0);
  };

  economy.spend = function (n) {
    G.state.money -= (n || 0);
  };

  economy.earn = function (n) {
    G.state.money += (n || 0);
  };

  // 技能系数（技能模块未加载时为 1，即无加成）
  function skillBonus(id) {
    return G.skills && G.skills.bonus ? G.skills.bonus(id) : 1;
  }

  // 使用家具后的结算：需求变化、花费、收入
  economy.applyUse = function (furn, use) {
    if (!G.state || !use) return;
    var fx = use.effect || {};
    var isPC = !!(furn && furn.id === 'desk_pc');

    // 电脑工作：体能降低精力消耗；手艺提高收入
    if (isPC && fx.energy < 0) {
      fx = Object.assign({}, fx, { energy: Math.round(fx.energy * skillBonus('stamina')) });
      // 手艺 Lv10：连续两单只扣一次精力（见 burger.js 的 G.perks）
      if (G.perks && G.perks.pcEnergy) fx.energy = G.perks.pcEnergy(fx.energy);
    }

    G.NEEDS.forEach(function (k) {
      if (fx[k]) addNeed(k, fx[k]);
    });

    if (use.cost) economy.spend(use.cost);

    if (fx.money) {
      if (isPC) {
        var income = Math.round(
          fx.money * (1 + G.state.roomLevel * 0.25) * (1 + economy.auraBonus() * 0.02) * skillBonus('craft')
        );
        // 手艺暴击（Lv5 起 10%，Lv8 起 25%，收入翻倍）
        var crit = G.perks && G.perks.rollCrit ? G.perks.rollCrit() : 1;
        income = Math.round(income * crit);
        economy.earn(income);
        G.log('工作完成，赚到 ' + income + ' 元' + (crit > 1 ? '（手艺暴击，收入翻倍！）' : ''));
      } else {
        economy.earn(fx.money);
        G.log('到账 ' + fx.money + ' 元');
      }
    }

    if (isPC && G.skills && G.skills.addXp && G.SKILL_XP) {
      G.skills.addXp('stamina', G.SKILL_XP.work);
      G.skills.addXp('craft', G.SKILL_XP.work);
    }
  };

  economy.buy = function (id) {
    var def = G.FURNITURE[id];
    if (!def) return { ok: false, reason: '没有这件家具' };
    if (!economy.canAfford(def.price)) {
      return { ok: false, reason: '钱不够，还差 ' + (def.price - G.state.money) + ' 元' };
    }
    economy.spend(def.price);
    G.log('买下了「' + def.name + '」');
    return { ok: true };
  };

  // place 失败时 ui 调用，把 buy 扣掉的钱退回
  economy.refund = function (id) {
    var def = G.FURNITURE[id];
    if (def && def.price) economy.earn(def.price);
    return { ok: true };
  };

  function rectOf(f) {
    var fp = G.footprint(f);
    return { x: f.x, y: f.y, w: fp.w, h: fp.h };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // 门口通道：门前一格不能被不可走家具压住，且不能切断门口与其它区域的连通（家具可以盖住的格子除外）
  function doorOccupancy(room, extra) {
    var W = room.w, H = room.h, occ = [];
    for (var i = 0; i < W * H; i++) occ.push(false);
    var list = G.state.furniture || [];
    for (var j = 0; j < list.length; j++) {
      var d = G.FURNITURE[list[j].id];
      if (!d || d.walkable) continue;
      var fp = G.footprint(list[j]);
      for (var y = list[j].y; y < list[j].y + fp.h; y++) {
        for (var x = list[j].x; x < list[j].x + fp.w; x++) {
          if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = true;
        }
      }
    }
    if (extra) {
      for (var ey = extra.y; ey < extra.y + extra.h; ey++) {
        for (var ex = extra.x; ex < extra.x + extra.w; ex++) {
          if (ex >= 0 && ey >= 0 && ex < W && ey < H) occ[ey * W + ex] = true;
        }
      }
    }
    return occ;
  }

  // 从门口一格出发的连通区域（返回 mask 数组与格数）
  function doorReach(room, occ, front) {
    var W = room.w, H = room.h, mask = [], count = 0, q = [];
    for (var i = 0; i < W * H; i++) mask.push(false);
    if (front.gx < 0 || front.gy < 0 || front.gx >= W || front.gy >= H) return { mask: mask, count: 0 };
    if (occ[front.gy * W + front.gx]) return { mask: mask, count: 0 };
    mask[front.gy * W + front.gx] = true;
    q.push([front.gx, front.gy]);
    count = 1;
    while (q.length) {
      var c = q.shift();
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var k = 0; k < dirs.length; k++) {
        var nx = c[0] + dirs[k][0], ny = c[1] + dirs[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var idx = ny * W + nx;
        if (mask[idx] || occ[idx]) continue;
        mask[idx] = true;
        count++;
        q.push([nx, ny]);
      }
    }
    return { mask: mask, count: count };
  }

  economy.doorCheck = function (id, gx, gy, rot) {
    var def = G.FURNITURE[id];
    if (!def || def.walkable || !G.state || !G.homeDoorFront) return { ok: true };
    var room = G.ROOMS[G.state.roomLevel] || G.ROOMS[0];
    var front = G.homeDoorFront(room);
    var fp = G.footprint({ id: id, rot: rot ? 1 : 0 });
    var rect = { x: gx, y: gy, w: fp.w, h: fp.h };
    var covers = front.gx >= rect.x && front.gx < rect.x + rect.w && front.gy >= rect.y && front.gy < rect.y + rect.h;
    if (covers) return { ok: false, reason: '门口要留一格通道' };

    var before = doorReach(room, doorOccupancy(room, null), front);
    if (!before.count) return { ok: true };     // 门口本来就被堵住：不因此再拦截
    var after = doorReach(room, doorOccupancy(room, rect), front);
    for (var y = 0; y < room.h; y++) {
      for (var x = 0; x < room.w; x++) {
        var idx = y * room.w + x;
        if (!before.mask[idx]) continue;
        if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) continue;
        if (!after.mask[idx]) return { ok: false, reason: '这里会挡住门口的通道' };
      }
    }
    return { ok: true };
  };

  economy.place = function (id, gx, gy, rot) {
    var def = G.FURNITURE[id];
    if (!def) return { ok: false, reason: '没有这件家具' };
    if (!isFinite(gx) || !isFinite(gy)) return { ok: false, reason: '位置不对' };
    gx = Math.floor(gx);
    gy = Math.floor(gy);
    rot = rot ? 1 : 0;

    var fp = G.footprint({ id: id, rot: rot });
    var room = G.ROOMS[G.state.roomLevel];

    // 越界
    if (gx < 0 || gy < 0 || gx + fp.w > room.w || gy + fp.h > room.h) {
      return { ok: false, reason: '超出房间范围' };
    }

    // 挂画必须贴墙
    if (def.wallItem && gy !== 0) {
      return { ok: false, reason: '挂画要贴着墙摆放' };
    }

    // 与其他家具重叠：地毯(walkable)可以铺在非 walkable 家具下面，其余一律不允许重叠
    var r = { x: gx, y: gy, w: fp.w, h: fp.h };
    var list = G.state.furniture;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var other = G.FURNITURE[f.id];
      if (!other) continue;
      if (!rectsOverlap(r, rectOf(f))) continue;
      if (def.walkable && !other.walkable) continue;
      if (def.walkable && other.walkable) {
        return { ok: false, reason: '地毯不能压在别的地毯上' };
      }
      return { ok: false, reason: '和别的家具重叠了' };
    }

    // 门口通道不能被堵住
    var dc = economy.doorCheck(id, gx, gy, rot);
    if (!dc.ok) return dc;

    // 不能把人压在家具下面
    var p = G.state.player;
    if (p && !def.walkable) {
      var pgx = Math.floor(p.x / G.TILE);
      var pgy = Math.floor(p.y / G.TILE);
      if (pgx >= r.x && pgx < r.x + r.w && pgy >= r.y && pgy < r.y + r.h) {
        return { ok: false, reason: '有人站在那里，先让开' };
      }
    }

    var furn = { uid: G.uid(), id: id, x: gx, y: gy, rot: rot };
    list.push(furn);
    return { ok: true, uid: furn.uid };
  };

  // 回收家具，退还 50% 价格
  economy.remove = function (uid) {
    var list = G.state.furniture;
    for (var i = 0; i < list.length; i++) {
      if (list[i].uid !== uid) continue;
      var def = G.FURNITURE[list[i].id];
      var refund = def ? Math.floor(def.price * 0.5) : 0;
      list.splice(i, 1);
      economy.earn(refund);
      if (G.state.selected === uid) G.state.selected = null;
      G.log('回收了「' + (def ? def.name : '家具') + '」，退还 ' + refund + ' 元');
      return { ok: true, refund: refund };
    }
    return { ok: false, reason: '找不到这件家具' };
  };

  economy.upgradeRoom = function () {
    var lvl = G.state.roomLevel;
    if (lvl >= G.ROOMS.length - 1) return { ok: false, reason: '房间已经是最大的啦' };
    var next = G.ROOMS[lvl + 1];
    if (!economy.canAfford(next.cost)) {
      return { ok: false, reason: '钱不够，升级需要 ' + next.cost + ' 元' };
    }
    economy.spend(next.cost);
    G.state.roomLevel = lvl + 1;
    if (G.render && G.render.resize) G.render.resize();
    G.log('房间升级成「' + next.name + '」！');
    return { ok: true };
  };

  /* ---------- 时间推进 / 每日结算 / 天气 ---------- */
  var weatherTimer = rand(40, 90);

  function onNewDay() {
    var s = G.state;

    // 季节更替：每 SEASON_DAYS 天一季
    if ((s.day - 1) % G.SEASON_DAYS === 0) {
      s.season = (s.season + 1) % 4;
      G.log('季节更替，现在是' + G.SEASONS[s.season] + '天了');
    }

    // 房租（仅出租小屋）
    if (s.roomLevel === RENT_LEVEL && s.day % RENT_CYCLE === 0) {
      var rent = G.ROOMS[RENT_LEVEL].rent;
      economy.spend(rent);
      if (s.money < 0) {
        G.log('欠租啦，快去工作！（房租 ' + rent + ' 元，余额 ' + s.money + ' 元）');
      } else {
        G.log('交了房租 ' + rent + ' 元');
      }
    }

    // 每天重新抽天气
    s.weather = pickWeather(s.season);
    G.log('第 ' + s.day + ' 天，' + G.SEASONS[s.season] + '季，天气' + WEATHER_LABEL[s.weather]);
  }

  economy.onNewDay = onNewDay;

  economy.tick = function (dt) {
    var s = G.state;
    if (!s || s.paused) return;

    if (s.flags && s.flags.blackout > 0) {
      s.flags.blackout = Math.max(0, s.flags.blackout - dt);
    }

    s.time += dt * 24 / G.DAY_SECONDS;
    while (s.time >= 24) {
      s.time -= 24;
      s.day += 1;
      onNewDay();
    }

    // 白天（6:00~18:00）每 40~90 秒判定一次，15% 概率切换天气
    if (s.time >= 6 && s.time < 18) {
      weatherTimer -= dt;
      if (weatherTimer <= 0) {
        weatherTimer = rand(40, 90);
        if (Math.random() < 0.15) {
          var w = pickWeather(s.season);
          if (w !== s.weather) {
            s.weather = w;
            G.log('天气变了：' + WEATHER_LABEL[w]);
          }
        }
      }
    }
  };

  G.economy = economy;

  /* ============================================================
   * G.events —— 随机事件
   * ============================================================ */
  var events = {};

  var EVENTS = [
    {
      w: 3,
      run: function () {
        var n = randInt(5, 25);
        G.economy.earn(n);
        G.log('快递到啦！拆开一看是一张意外的返现券，到账 ' + n + ' 元');
      }
    },
    {
      w: 2,
      run: function () {
        addNeed('mood', 15);
        G.log('朋友突然来串门，聊了一下午，心情好多了（+15）');
      }
    },
    {
      w: 1,
      cond: function () { return G.state.flags && G.state.flags.blackout <= 0; },
      run: function () {
        G.state.flags.blackout = 60;
        G.log('停电啦！屋里一片漆黑，电脑暂时用不了，等一分钟吧');
      }
    },
    {
      w: 3,
      run: function () {
        var n = randInt(3, 15);
        G.economy.earn(n);
        G.log('路上捡到一张皱巴巴的钞票，+' + n + ' 元，今天运气不错');
      }
    },
    {
      w: 2,
      run: function () {
        addNeed('hunger', 20);
        G.log('隔壁邻居端来一碗热乎的饺子，饱腹 +20');
      }
    },
    {
      w: 1,
      run: function () {
        addNeed('mood', -3);
        G.log('门口有人鬼鬼祟祟转了一圈，发现锁得好好的就走了，虚惊一场（心情 -3）');
      }
    },
    {
      w: 2,
      cond: function () { return G.state.weather === 'sunny'; },
      run: function () {
        addNeed('mood', 8);
        G.log('阳光正好，窗台暖洋洋的，心情 +8');
      }
    },
    {
      w: 1,
      cond: function () { return !!G.state.pet; },
      run: function () {
        addNeed('mood', -2);
        G.log(petName() + '不小心把桌上的杯子扒拉到了地上，哗啦一声（心情 -2）');
      }
    },
    {
      w: 1,
      cond: function () { return !!G.state.pet; },
      run: function () {
        G.economy.earn(5);
        G.log(petName() + '叼回来一样亮晶晶的东西，拿去换了 5 元');
      }
    },
  ];

  function pickEvent() {
    var pool = EVENTS.filter(function (e) { return !e.cond || e.cond(); });
    var total = 0;
    pool.forEach(function (e) { total += e.w; });
    if (total <= 0) return null;
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r < 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  var eventTimer = rand(25, 60);

  events.update = function (dt) {
    if (!G.state || G.state.paused) return;
    eventTimer -= dt;
    if (eventTimer > 0) return;
    eventTimer = rand(25, 60);
    var ev = pickEvent();
    if (ev) ev.run();
  };

  G.events = events;

  /* ============================================================
   * G.saveload —— 存档
   * ============================================================ */
  var saveload = {};

  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function pickNum(v, def) { return typeof v === 'number' && isFinite(v) ? v : def; }

  // 深度补默认值：src 缺字段或类型不对时用 def；src 里多出的未知字段保留（新版本存档不丢数据）
  function fillDefaults(src, def) {
    if (Array.isArray(def)) return Array.isArray(src) ? src : def.slice();
    if (!isObj(def)) {
      var ok = typeof src === typeof def && (typeof def !== 'number' || isFinite(src));
      return ok ? src : def;
    }
    var s = isObj(src) ? src : {};
    var out = {};
    Object.keys(s).forEach(function (k) { out[k] = s[k]; });
    Object.keys(def).forEach(function (k) { out[k] = fillDefaults(s[k], def[k]); });
    return out;
  }

  // 把存档数据和默认状态合并，缺字段用默认值补齐
  function mergeState(d) {
    var base = G.newState();
    var out = base;

    out.money = pickNum(d.money, base.money);
    out.day = Math.max(1, Math.floor(pickNum(d.day, base.day)));
    out.time = ((pickNum(d.time, base.time) % 24) + 24) % 24;
    out.season = G.clamp(Math.floor(pickNum(d.season, base.season)), 0, 3);
    out.weather = WEATHER_LABEL[d.weather] ? d.weather : base.weather;
    out.roomLevel = G.clamp(Math.floor(pickNum(d.roomLevel, base.roomLevel)), 0, G.ROOMS.length - 1);

    var defNeeds = base.needs;          // 先存下默认值：out 与 base 是同一对象，下面要重建 out.needs
    out.needs = {};
    G.NEEDS.forEach(function (k) {
      var v = isObj(d.needs) ? d.needs[k] : undefined;
      out.needs[k] = G.clamp(pickNum(v, defNeeds[k]), 0, 100);
    });

    if (Array.isArray(d.furniture)) {
      out.furniture = d.furniture
        .filter(function (f) { return f && G.FURNITURE[f.id]; })
        .map(function (f) {
          return {
            uid: f.uid || G.uid(),
            id: f.id,
            x: Math.floor(pickNum(f.x, 0)),
            y: Math.floor(pickNum(f.y, 0)),
            rot: f.rot ? 1 : 0
          };
        });
    }

    var p = Object.assign({}, base.player, isObj(d.player) ? d.player : {});
    p.x = pickNum(p.x, base.player.x);
    p.y = pickNum(p.y, base.player.y);
    p.path = [];
    p.action = null;
    out.player = p;

    out.pet = isObj(d.pet) ? d.pet : null;
    out.log = Array.isArray(d.log) ? d.log.slice(-30) : [];
    out.paused = false;
    out.buildMode = false;
    out.selected = null;
    out.scene = d.scene === 'street' ? 'street' : 'home';
    out.flags = Object.assign({ blackout: 0 }, isObj(d.flags) ? d.flags : {});
    out.flags.blackout = Math.max(0, pickNum(out.flags.blackout, 0));

    // 汉堡店：当天已打班数（换日后由 burger.js 重置）
    out.burger = isObj(d.burger)
      ? { day: Math.max(1, Math.floor(pickNum(d.burger.day, out.day))), shifts: Math.max(0, Math.floor(pickNum(d.burger.shifts, 0))) }
      : base.burger;

    // 正在打工的进度（读档后继续）
    out.work = isObj(d.work) && pickNum(d.work.total, 0) > 0
      ? { t: Math.max(0, pickNum(d.work.t, 0)), total: pickNum(d.work.total, 12) }
      : null;

    // 林小满等 NPC 的状态（补齐缺失字段）
    out.npcs = G.npc && G.npc.fill ? G.npc.fill(d.npcs, out.day) : base.npcs;

    // 已注册模块（G.registerModule）的字段：旧档缺字段时按 defaults 补齐
    (G.modules || []).forEach(function (m) {
      out[m.id] = fillDefaults(d[m.id], m.defaults());
    });

    return out;
  }

  saveload.save = function () {
    try {
      var ls = storage();
      if (!ls || !G.state) return false;
      ls.setItem(SAVE_KEY, JSON.stringify(G.state));
      return true;
    } catch (e) {
      return false;
    }
  };

  saveload.load = function () {
    var raw = null;
    try {
      var ls = storage();
      raw = ls ? ls.getItem(SAVE_KEY) : null;
    } catch (e) {
      return false;
    }
    if (!raw) return false;

    var data;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!isObj(data)) return false;

    G.state = mergeState(data);
    if (G.render && G.render.resize) G.render.resize();
    return true;
  };

  saveload.reset = function () {
    try {
      var ls = storage();
      if (ls) ls.removeItem(SAVE_KEY);
    } catch (e) { /* 忽略 */ }
    G.state = G.newState();
    if (G.render && G.render.resize) G.render.resize();
    if (G.player && G.player.init) G.player.init();
    return true;
  };

  var autoTimer = null;
  saveload.startAutoSave = function () {
    if (autoTimer) return;
    autoTimer = setInterval(function () { saveload.save(); }, AUTOSAVE_MS);
    window.addEventListener('beforeunload', function () { saveload.save(); });
  };

  G.saveload = saveload;
})();
