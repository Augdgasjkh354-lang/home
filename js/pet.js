/* ============================================================
 * pet.js —— 宠物 AI（只往 G.petAI 上挂接口，契约见 config.js）
 * 格子寻路用 BFS（只走 4 邻接格），不依赖 G.player 的存在。
 * ============================================================ */
(function () {
  'use strict';

  const SPEED = 28;                                   // 像素/秒
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const MILESTONES = [
    { at: 20,  msg: n => n + '开始会主动跑来找你玩了 ♥' },
    { at: 50,  msg: n => n + '已经把这里当成了家，总守在你身边 ♥' },
    { at: 100, msg: n => n + '和你成了最要好的伙伴，永远的家人 ♥' },
  ];

  let lastPat = 0;     // 抚摸冷却时间戳（真实毫秒）
  let hungryCd = 0;    // 没碗时“饿了”提示的冷却（秒）

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const key = (x, y) => x + ',' + y;
  const unkey = k => k.split(',').map(Number);

  /* ---------- 基础工具 ---------- */

  // 补齐存档里可能缺失的字段
  function ensure(pet) {
    if (typeof pet.hunger !== 'number') pet.hunger = 70;
    if (typeof pet.bond !== 'number') pet.bond = 0;
    if (typeof pet.timer !== 'number') pet.timer = 0;
    if (!Array.isArray(pet.milestones)) pet.milestones = [];
    if (!Array.isArray(pet.path)) pet.path = [];
    if (typeof pet.goal !== 'string') pet.goal = '';
    if (!pet.dir) pet.dir = 'down';
    if (!pet.name) pet.name = (G.PETS[pet.type] || { name: '宠物' }).name;
    return pet;
  }

  function night(s) {
    return s.time > 22 || s.time < 6;
  }

  function roomSize() {
    const r = G.ROOMS[(G.state && G.state.roomLevel) || 0] || G.ROOMS[0];
    return { w: r.w, h: r.h };
  }

  function findFurn(id) {
    const list = (G.state && G.state.furniture) || [];
    for (const f of list) if (f.id === id) return f;
    return null;
  }

  // 该格是否不可走（越界 / 不可走家具占用）
  function blocked(gx, gy) {
    const { w, h } = roomSize();
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return true;
    if (G.player && typeof G.player.isBlocked === 'function') {
      return !!G.player.isBlocked(gx, gy);
    }
    const list = (G.state && G.state.furniture) || [];
    for (const f of list) {
      const d = G.FURNITURE[f.id];
      if (!d || d.walkable) continue;
      const fp = G.footprint(f);
      if (gx >= f.x && gx < f.x + fp.w && gy >= f.y && gy < f.y + fp.h) return true;
    }
    return false;
  }

  function cellOf(pet) {
    return { gx: Math.floor(pet.x / G.TILE), gy: Math.floor(pet.y / G.TILE) };
  }

  function isCenter(pet) {
    const c = cellOf(pet);
    return Math.abs(pet.x - (c.gx * G.TILE + G.TILE / 2)) < 1e-6 &&
           Math.abs(pet.y - (c.gy * G.TILE + G.TILE / 2)) < 1e-6;
  }

  // 家具四周的 4 邻接格（不含家具本身占用的格）
  function adjacentTo(furn) {
    const fp = G.footprint(furn);
    const fx = furn.x, fy = furn.y, w = fp.w, h = fp.h;
    return (x, y) => {
      const inX = x >= fx && x < fx + w;
      const inY = y >= fy && y < fy + h;
      if (inX && inY) return false;
      return (inY && (x === fx - 1 || x === fx + w)) ||
             (inX && (y === fy - 1 || y === fy + h));
    };
  }

  // 从 (sx,sy) 出发的 BFS，返回可达格的父指针、深度与访问顺序（近的在前）
  function bfs(sx, sy, maxDepth) {
    const prev = new Map(), depth = new Map(), order = [];
    const sk = key(sx, sy);
    prev.set(sk, null);
    depth.set(sk, 0);
    const q = [sk];
    for (let i = 0; i < q.length; i++) {
      const k = q[i];
      order.push(k);
      const d = depth.get(k);
      if (d >= maxDepth) continue;
      const [x, y] = unkey(k);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (prev.has(nk) || blocked(nx, ny)) continue;
        prev.set(nk, k);
        depth.set(nk, d + 1);
        q.push(nk);
      }
    }
    return { prev, depth, order };
  }

  // 回溯路径（不含起点）
  function buildPath(prev, k) {
    const out = [];
    let cur = k;
    while (cur != null && prev.get(cur) != null) {
      const [gx, gy] = unkey(cur);
      out.push({ gx, gy });
      cur = prev.get(cur);
    }
    return out.reverse();
  }

  // 在 BFS 可达格中挑一个满足 pred 的格子去走；pickRandom=false 时取最近的
  function goTo(pet, pred, goal, maxDepth, pickRandom) {
    const c = cellOf(pet);
    const r = bfs(c.gx, c.gy, maxDepth);
    const cands = r.order.filter(k => {
      const [x, y] = unkey(k);
      return pred(x, y, r.depth.get(k));
    });
    if (!cands.length) return false;
    const k = pickRandom ? cands[Math.floor(Math.random() * cands.length)] : cands[0];
    pet.path = buildPath(r.prev, k);
    pet.goal = goal;
    if (pet.path.length) {
      pet.state = 'walk';
    } else {
      arrive(pet);
    }
    return true;
  }

  // 到达目的地后切换状态
  function arrive(pet) {
    const goal = pet.goal;
    pet.goal = '';
    pet.path = [];
    if (goal === 'eat' && findFurn('pet_bowl')) {
      pet.state = 'eat';
      pet.timer = 3;
    } else if (goal === 'sleep') {
      pet.state = 'sleep';
      pet.timer = night(G.state) ? 12 : 8;
    } else if (goal === 'play') {
      pet.state = 'play';
      pet.timer = rnd(2, 4);
    } else {
      pet.state = 'idle';
      pet.timer = rnd(1, 4);
    }
  }

  // 沿 path 前进一帧
  function walkStep(pet, dt) {
    const next = pet.path[0];
    // 停在格子中心时若下一格已被占用（如玩家刚摆了家具），放弃路径
    if (isCenter(pet) && blocked(next.gx, next.gy)) {
      pet.path = [];
      pet.goal = '';
      pet.state = 'idle';
      pet.timer = 1;
      return;
    }
    pet.state = 'walk';
    const tx = next.gx * G.TILE + G.TILE / 2;
    const ty = next.gy * G.TILE + G.TILE / 2;
    const dx = tx - pet.x, dy = ty - pet.y;
    const dist = Math.hypot(dx, dy);
    const step = SPEED * dt;
    if (Math.abs(dx) > Math.abs(dy)) pet.dir = dx > 0 ? 'right' : 'left';
    else if (Math.abs(dy) > 1e-6) pet.dir = dy > 0 ? 'down' : 'up';
    if (dist <= step) {
      pet.x = tx;
      pet.y = ty;
      pet.path.shift();
      if (!pet.path.length) arrive(pet);
    } else {
      pet.x += dx / dist * step;
      pet.y += dy / dist * step;
    }
  }

  // 空闲结束后决定下一步行为
  function chooseNext(pet) {
    const s = G.state;

    // 饿了且有碗：走到碗旁边吃（免费）
    if (pet.hunger < 35) {
      const bowl = findFurn('pet_bowl');
      if (bowl && goTo(pet, adjacentTo(bowl), 'eat', 60, false)) return;
    }

    // 困了：夜里概率高，白天偶尔；没窝就原地睡
    if (Math.random() < (night(s) ? 0.6 : 0.08)) {
      const bed = findFurn('pet_bed');
      if (!bed || !goTo(pet, adjacentTo(bed), 'sleep', 60, false)) {
        pet.goal = 'sleep';
        arrive(pet);
      }
      return;
    }

    // 20% 概率靠近玩家（2 格内）玩一会儿
    if (s.player && Math.random() < 0.2) {
      const pc = { gx: Math.floor(s.player.x / G.TILE), gy: Math.floor(s.player.y / G.TILE) };
      const near = (x, y) => {
        const d = Math.abs(x - pc.gx) + Math.abs(y - pc.gy);
        return d >= 1 && d <= 2;
      };
      if (goTo(pet, near, 'play', 8, true)) return;
    }

    // 随机在附近 1~3 格内溜达
    if (!goTo(pet, (x, y, d) => d >= 1 && d <= 3, 'wander', 3, true)) {
      pet.state = 'idle';
      pet.timer = rnd(1, 2);
    }
  }

  // 领养时找一个空闲格（避开家具和玩家所在格）
  function pickFreeSpot() {
    const { w, h } = roomSize();
    const pl = G.state.player;
    const pcx = pl ? Math.floor(pl.x / G.TILE) : -1;
    const pcy = pl ? Math.floor(pl.y / G.TILE) : -1;
    const cands = [];
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        if (blocked(gx, gy)) continue;
        if (gx === pcx && gy === pcy) continue;
        cands.push({ gx, gy });
      }
    }
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  function checkMilestones(pet) {
    for (const m of MILESTONES) {
      if (pet.bond >= m.at && !pet.milestones.includes(m.at)) {
        pet.milestones.push(m.at);
        G.log(m.msg(pet.name));
        const needs = G.state && G.state.needs;
        if (needs) needs.mood = clamp(needs.mood + 10, 0, 100);
      }
    }
  }

  /* ---------- 每帧更新 ---------- */

  function update(dt) {
    const s = G.state;
    if (!s || s.paused || !s.pet) return;
    const pet = ensure(s.pet);
    dt = clamp(dt || 0, 0, 0.25);

    pet.hunger = clamp(pet.hunger - 0.4 * dt, 0, 100);

    // 没碗且很饿时偶尔叫一声
    if (pet.hunger < 20 && !findFurn('pet_bowl')) {
      hungryCd -= dt;
      if (hungryCd <= 0) {
        G.log(pet.name + '饿了，' + (pet.type === 'dog' ? '汪~' : '喵~'));
        hungryCd = rnd(30, 60);
      }
    }

    if (pet.path.length) {
      walkStep(pet, dt);
      return;
    }

    switch (pet.state) {
      case 'eat':
        pet.timer -= dt;
        if (pet.timer <= 0) {
          pet.hunger = 100;
          G.log(pet.name + '吃饱啦');
          pet.state = 'idle';
          pet.timer = rnd(1, 3);
        }
        break;
      case 'sleep':
      case 'play':
        pet.timer -= dt;
        if (pet.timer <= 0) {
          pet.state = 'idle';
          pet.timer = rnd(1, 3);
        }
        break;
      case 'idle':
        pet.timer -= dt;
        if (pet.timer <= 0) chooseNext(pet);
        break;
      default:
        // 未知状态或存档里的残留 walk（无路径）统一回到 idle
        pet.state = 'idle';
        pet.timer = rnd(1, 3);
    }
  }

  /* ---------- 玩家交互 ---------- */

  function adopt(type) {
    const s = G.state;
    if (!s) return;
    if (type !== 'cat' && type !== 'dog') return;
    if (s.pet) {
      G.log('已经有一只啦');
      return;
    }
    const spot = pickFreeSpot();
    if (!spot) {
      G.log('房间里没有空位给宠物住…');
      return;
    }
    s.pet = {
      type: type,
      name: G.PETS[type].name,
      x: spot.gx * G.TILE + G.TILE / 2,
      y: spot.gy * G.TILE + G.TILE / 2,
      dir: 'down',
      state: 'idle',
      timer: 0,
      hunger: 70,
      bond: 0,
      milestones: [],
      path: [],
      goal: '',
    };
    G.log('领养了一只' + s.pet.name + '，欢迎回家 ♥');
  }

  function pat() {
    const s = G.state;
    if (!s || !s.pet) return;
    const now = Date.now();
    if (now - lastPat < 1500) return;
    lastPat = now;
    const pet = ensure(s.pet);
    if (s.needs) s.needs.mood = clamp(s.needs.mood + 4, 0, 100);
    pet.bond += 2;
    G.log('你摸了摸' + pet.name + '，它很开心 ♥');
    checkMilestones(pet);
  }

  function feed() {
    const s = G.state;
    if (!s || !s.pet) return;
    const eco = G.economy;
    if (!eco || typeof eco.canAfford !== 'function' || typeof eco.spend !== 'function') return;
    const pet = ensure(s.pet);
    const food = pet.type === 'dog' ? '狗粮' : '猫粮';
    if (!eco.canAfford(3)) {
      G.log('钱不够买' + food + '…');
      return;
    }
    eco.spend(3);
    pet.hunger = 100;
    pet.bond += 1;
    G.log('给' + pet.name + '买了' + food + '，吃得饱饱的 (-3 元)');
    checkMilestones(pet);
  }

  function petAt(gx, gy) {
    const s = G.state;
    if (!s || !s.pet) return false;
    const c = cellOf(s.pet);
    return Math.abs(c.gx - gx) <= 1 && Math.abs(c.gy - gy) <= 1;
  }

  G.petAI = G.petAI || {};
  G.petAI.adopt = adopt;
  G.petAI.update = update;
  G.petAI.pat = pat;
  G.petAI.feed = feed;
  G.petAI.petAt = petAt;
})();
