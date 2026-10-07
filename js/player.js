/* ============================================================
 * 像素小家 —— 玩家模块 G.player
 * 负责：网格 A* 寻路、平滑移动、使用家具(倒计时+结算)、需求衰减与零值负面效果。
 * 只往 G.player 上挂接口，其余模块通过 G.economy / G.log 等交互。
 * ============================================================ */
(function () {
  'use strict';

  const T = G.TILE;                 // 16 像素一格
  const SPEED = 56;                 // 移动速度：像素/秒
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const WARN_EVERY = 15;            // 某需求为 0 时，每 15 秒提示一次
  const MOOD_DRAIN = 0.25;          // 每个为 0 的需求，每秒额外扣心情
  const BED_RETRY = 3;              // 自动去床上失败后，多少秒后重试

  const ZERO_MSG = {
    energy: '好困…精力耗尽了，眼皮直打架',
    hunger: '肚子咕咕叫了…得赶紧吃点东西',
    mood:   '心情跌到谷底了，什么都提不起劲',
    hygiene:'浑身黏糊糊的，该去洗个澡了',
  };

  let intent = null;                // {uid, gx, gy}：正在走向的使用地点
  let autoBedArmed = false;         // energy 刚降到 0 时置 true，自动去床上躺一次
  let energyWasZero = false;
  let clock = 0;                    // 累计游戏时间(秒)，用于重试计时
  let retryAt = 0;
  const zeroAcc = {};               // 各需求为 0 的累计时间，控制提示频率

  /* ---------- 基础工具 ---------- */

  function room() {
    return G.ROOMS[G.state.roomLevel] || G.ROOMS[0];
  }

  // 当前场景：室内 'home' 或门口外景 'street'（外景地图见 config.js 的 G.STREET）
  function isStreet() {
    return !!(G.state && G.state.scene === 'street' && G.STREET);
  }

  function dims() {
    return isStreet() ? G.STREET : room();
  }

  function inBounds(gx, gy) {
    const r = dims();
    return gx >= 0 && gy >= 0 && gx < r.w && gy < r.h;
  }

  // 外景障碍：自家/汉堡店建筑占格、装饰树
  function streetSolid(gx, gy) {
    const S = G.STREET;
    const rects = [S.home, S.shop];
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h) return true;
    }
    const trees = S.trees || [];
    for (let i = 0; i < trees.length; i++) {
      if (trees[i].gx === gx && trees[i].gy === gy) return true;
    }
    return false;
  }

  function cellOf(p) {
    return { gx: Math.floor(p.x / T), gy: Math.floor(p.y / T) };
  }

  function furnDef(f) {
    return G.FURNITURE[f.id];
  }

  function isWalkableDef(d) {
    return !!(d && d.walkable);
  }

  // 覆盖某格的所有家具（包括 walkable 的）
  function coveringAt(gx, gy) {
    const list = [];
    if (isStreet()) return list;      // 外景没有家具
    const fs = (G.state && G.state.furniture) || [];
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!furnDef(f)) continue;
      const fp = G.footprint(f);
      if (gx >= f.x && gx < f.x + fp.w && gy >= f.y && gy < f.y + fp.h) list.push(f);
    }
    return list;
  }

  function isBlocked(gx, gy) {
    if (!G.state || !inBounds(gx, gy)) return true;
    if (isStreet()) return streetSolid(gx, gy);
    const list = coveringAt(gx, gy);
    for (let i = 0; i < list.length; i++) {
      if (!isWalkableDef(furnDef(list[i]))) return true;
    }
    return false;
  }

  function furnitureAt(gx, gy) {
    const list = coveringAt(gx, gy);
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      if (!isWalkableDef(furnDef(list[i]))) return list[i];
    }
    return list[0];
  }

  function findFurn(uid) {
    const fs = (G.state && G.state.furniture) || [];
    for (let i = 0; i < fs.length; i++) {
      if (fs[i].uid === uid) return fs[i];
    }
    return null;
  }

  function afford(n) {
    if (G.economy && typeof G.economy.canAfford === 'function') return !!G.economy.canAfford(n);
    return G.state.money >= n;
  }

  // 使用前的前置检查；不通过时给出提示
  function canUse(f) {
    const d = furnDef(f);
    if (!d) return false;
    if (!d.use) { G.log('这个只能看看~'); return false; }
    if (f.id === 'desk_pc' && G.state.flags && G.state.flags.blackout > 0) {
      G.log('停电了，电脑用不了');
      return false;
    }
    if (d.use.cost && !afford(d.use.cost)) {
      G.log('钱不够了，先攒攒吧');
      return false;
    }
    return true;
  }

  /* ---------- A* 寻路（4 邻接） ---------- */

  // 返回不含起点的路径数组 [{gx,gy}, ...]；不可达返回 null
  function aStar(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    if (isBlocked(tx, ty)) return null;

    const key = (x, y) => x + ',' + y;
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const g = new Map();
    const from = new Map();
    const closed = new Set();
    const open = [{ x: sx, y: sy, f: h(sx, sy) }];
    g.set(key(sx, sy), 0);

    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bi].f) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      const ck = key(cur.x, cur.y);
      if (closed.has(ck)) continue;

      if (cur.x === tx && cur.y === ty) {
        const path = [];
        let k = ck;
        const sk = key(sx, sy);
        while (k !== sk) {
          const parts = k.split(',');
          path.unshift({ gx: Number(parts[0]), gy: Number(parts[1]) });
          k = from.get(k);
        }
        return path;
      }

      closed.add(ck);
      for (let i = 0; i < DIRS.length; i++) {
        const nx = cur.x + DIRS[i][0];
        const ny = cur.y + DIRS[i][1];
        const nk = key(nx, ny);
        if (closed.has(nk) || isBlocked(nx, ny)) continue;
        const ng = g.get(ck) + 1;
        if (!g.has(nk) || ng < g.get(nk)) {
          g.set(nk, ng);
          from.set(nk, ck);
          open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
        }
      }
    }
    return null;
  }

  // 从玩家当前位置规划到 (tx,ty) 的新路径。若玩家正在走路，保留"正在前往的下一格"作为路径头，避免折返跳动。
  function plan(tx, ty) {
    if (isBlocked(tx, ty)) return null;
    const p = G.state.player;
    const hasHead = p.path.length > 0;
    const base = hasHead ? p.path[0] : cellOf(p);
    const route = aStar(base.gx, base.gy, tx, ty);
    if (!route) return null;
    return hasHead ? [{ gx: base.gx, gy: base.gy }].concat(route) : route;
  }

  // 家具四周（上下左右）可站立的格子
  function adjacentCells(f) {
    const fp = G.footprint(f);
    const out = [];
    const seen = new Set();
    for (let x = f.x; x < f.x + fp.w; x++) {
      for (let y = f.y; y < f.y + fp.h; y++) {
        for (let i = 0; i < DIRS.length; i++) {
          const nx = x + DIRS[i][0];
          const ny = y + DIRS[i][1];
          if (nx >= f.x && nx < f.x + fp.w && ny >= f.y && ny < f.y + fp.h) continue;
          const k = nx + ',' + ny;
          if (seen.has(k) || isBlocked(nx, ny)) continue;
          seen.add(k);
          out.push({ gx: nx, gy: ny });
        }
      }
    }
    return out;
  }

  /* ---------- 移动 ---------- */

  function setDirTo(dx, dy) {
    const p = G.state.player;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) p.dir = dx > 0 ? 'right' : 'left';
    } else {
      p.dir = dy > 0 ? 'down' : 'up';
    }
  }

  function moveAlong(dt) {
    const p = G.state.player;
    let remaining = SPEED * dt;
    while (p.path.length && remaining > 0) {
      const n = p.path[0];
      const tx = n.gx * T + T / 2;
      const ty = n.gy * T + T / 2;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) setDirTo(dx, dy);
      if (d <= remaining) {
        p.x = tx;
        p.y = ty;
        remaining -= d;
        p.path.shift();
      } else {
        p.x += dx / d * remaining;
        p.y += dy / d * remaining;
        remaining = 0;
      }
    }
  }

  /* ---------- 使用家具 ---------- */

  function startAction(f) {
    if (!canUse(f)) return false;
    const p = G.state.player;
    const dur = furnDef(f).use.duration;
    p.action = { uid: f.uid, id: f.id, remaining: dur, total: dur };
    const fp = G.footprint(f);
    setDirTo((f.x + fp.w / 2) * T - p.x, (f.y + fp.h / 2) * T - p.y);
    return true;
  }

  function fallbackApply(use) {
    const needs = G.state.needs;
    const e = use.effect || {};
    G.NEEDS.forEach(function (k) {
      if (e[k]) needs[k] = G.clamp(needs[k] + e[k], 0, 100);
    });
    G.state.money += (e.money || 0) - (use.cost || 0);
  }

  function finishAction() {
    const p = G.state.player;
    const a = p.action;
    p.action = null;
    if (!a) return;
    const f = findFurn(a.uid);
    const d = G.FURNITURE[a.id];
    if (!f || !d || !d.use) return;   // 家具已被回收：不结算
    if (G.economy && typeof G.economy.applyUse === 'function') {
      G.economy.applyUse(f, d.use);
    } else {
      fallbackApply(d.use);
    }
  }

  // 玩家走到了目的地：有 arrive 回调则执行（如出门/进门），否则开始使用家具
  function resolveIntent() {
    if (!intent) return;
    const it = intent;
    intent = null;
    const c = cellOf(G.state.player);
    if (c.gx !== it.gx || c.gy !== it.gy) return;
    if (it.arrive) { it.arrive(); return; }
    const f = findFurn(it.uid);
    if (f) startAction(f);
  }

  // 内部使用请求（不清除 autoBedArmed）
  function requestUse(uid, quiet) {
    const f = findFurn(uid);
    if (!f || !canUse(f)) return false;
    const p = G.state.player;
    if (p.action && p.action.uid === uid) return true;

    let best = null;
    const cands = adjacentCells(f);
    for (let i = 0; i < cands.length; i++) {
      const route = plan(cands[i].gx, cands[i].gy);
      if (route && (!best || route.length < best.route.length)) {
        best = { c: cands[i], route: route };
      }
    }
    if (!best) {
      if (!quiet) G.log('走不到那里去');
      return false;
    }

    p.action = null;                  // 切换使用目标：取消旧动作，不结算
    if (best.route.length === 0) {
      p.path = [];
      intent = null;
      return startAction(f);
    }
    p.path = best.route;
    intent = { uid: uid, gx: best.c.gx, gy: best.c.gy };
    return true;
  }

  function tryAutoBed() {
    if (isStreet()) return false;     // 床在家里：外景时等回家再躺
    const fs = (G.state.furniture || []).filter(function (f) {
      const d = furnDef(f);
      return d && d.kind === 'bed';
    });
    for (let i = 0; i < fs.length; i++) {
      if (requestUse(fs[i].uid, true)) return true;
    }
    return false;
  }

  /* ---------- 对外接口 ---------- */

  function init() {
    if (!G.state || !G.state.player) return;
    const p = G.state.player;
    let spot = null;
    const r = dims();
    if (isStreet() && !isBlocked(G.STREET.spawn.gx, G.STREET.spawn.gy)) {
      spot = { gx: G.STREET.spawn.gx, gy: G.STREET.spawn.gy };
    }
    // 第一轮：没有任何家具的空格；第二轮：仅要求可走
    for (let pass = 0; pass < 2 && !spot; pass++) {
      for (let gy = 0; gy < r.h && !spot; gy++) {
        for (let gx = 0; gx < r.w && !spot; gx++) {
          if (isBlocked(gx, gy)) continue;
          if (pass === 0 && furnitureAt(gx, gy)) continue;
          spot = { gx: gx, gy: gy };
        }
      }
    }
    if (!spot) spot = { gx: 0, gy: 0 };
    p.x = spot.gx * T + T / 2;
    p.y = spot.gy * T + T / 2;
    p.path = [];
    p.action = null;
    p.dir = 'down';
    p.busy = 0;
    intent = null;
    autoBedArmed = false;
  }

  function moveTo(gx, gy) {
    if (!G.state || !G.state.player) return false;
    gx = Math.floor(gx);
    gy = Math.floor(gy);
    const route = plan(gx, gy);
    if (!route) return false;
    const p = G.state.player;
    p.path = route;
    p.action = null;                  // 玩家主动移动：取消使用，不结算
    intent = null;
    autoBedArmed = false;
    return true;
  }

  function useFurniture(uid) {
    autoBedArmed = false;             // 玩家主动操作，关闭自动睡觉
    return requestUse(uid, false);
  }

  // 走到 (gx,gy) 后执行 onArrive（用于点门：走到门口再进出）；走不到返回 false
  function walkTo(gx, gy, onArrive) {
    if (!G.state || !G.state.player) return false;
    gx = Math.floor(gx);
    gy = Math.floor(gy);
    const route = plan(gx, gy);
    if (!route) return false;
    const p = G.state.player;
    p.path = route;
    p.action = null;
    autoBedArmed = false;
    intent = { uid: null, gx: gx, gy: gy, arrive: onArrive || null };
    return true;
  }

  // 直接放到某格（切换场景时用），清空路径与动作
  function placeAt(gx, gy, dir) {
    if (!G.state || !G.state.player) return;
    const p = G.state.player;
    p.x = gx * T + T / 2;
    p.y = gy * T + T / 2;
    p.path = [];
    p.action = null;
    p.dir = dir || 'down';
    intent = null;
  }

  function update(dt) {
    if (!G.state || G.state.paused || !G.state.player) return;
    dt = G.clamp(dt || 0, 0, 0.25);   // 防止切换标签页后的大步长
    clock += dt;

    const p = G.state.player;
    if (!p.path) p.path = [];
    const needs = G.state.needs;

    // 0. 房间变小或被家具压住时，把玩家挪回空位
    if (!p.path.length && !p.action && isBlocked(cellOf(p).gx, cellOf(p).gy)) {
      init();
    }

    // 1. 沿路径移动
    if (p.path.length) moveAlong(dt);

    // 2. 走到使用地点 -> 开始使用
    if (!p.path.length && intent) resolveIntent();

    // 3. 使用倒计时（不减半）
    if (p.action) {
      p.action.remaining -= dt;
      if (p.action.remaining <= 0) finishAction();
    }

    // 4. 需求衰减（使用中减半）
    const mult = p.action ? 0.5 : 1;
    G.NEEDS.forEach(function (k) {
      needs[k] = G.clamp(needs[k] - G.NEED_DECAY[k] * mult * dt, 0, 100);
    });
    if (G.economy && typeof G.economy.auraBonus === 'function') {
      needs.mood = G.clamp(needs.mood + G.economy.auraBonus() * 0.02 * dt, 0, 100);
    }

    // 5. 需求为 0 的负面效果
    let zeroCount = 0;
    G.NEEDS.forEach(function (k) {
      if (needs[k] <= 0) zeroCount++;
    });
    if (zeroCount > 0) {
      needs.mood = G.clamp(needs.mood - MOOD_DRAIN * zeroCount * dt, 0, 100);
    }
    G.NEEDS.forEach(function (k) {
      if (needs[k] <= 0) {
        if (zeroAcc[k] == null || zeroAcc[k] >= WARN_EVERY) {
          G.log(ZERO_MSG[k]);
          zeroAcc[k] = 0;
        }
        zeroAcc[k] += dt;
      } else {
        zeroAcc[k] = null;
      }
    });

    // 6. 精力为 0：自动去床上睡觉（每次降到 0 只触发一次，被玩家打断后不再强制）
    const energyZero = needs.energy <= 0;
    if (energyZero && !energyWasZero) autoBedArmed = true;
    if (!energyZero) autoBedArmed = false;
    energyWasZero = energyZero;

    if (autoBedArmed && energyZero && !p.action && !intent && !p.path.length && clock >= retryAt) {
      if (tryAutoBed()) {
        autoBedArmed = false;
        G.log('实在撑不住了，去床上躺一会儿');
      } else {
        retryAt = clock + BED_RETRY;
      }
    }
  }

  G.player = G.player || {};
  Object.assign(G.player, {
    init: init,
    update: update,
    moveTo: moveTo,
    walkTo: walkTo,
    placeAt: placeAt,
    useFurniture: useFurniture,
    isBlocked: isBlocked,
    furnitureAt: furnitureAt,
  });
})();
