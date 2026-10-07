/* ============================================================
 * 像素小家 —— 城市系统（city.js）
 * 只往 G.city 上挂接口。数据在 city-data.js（G.CITY_DATA），城市名等文案在 config.js（G.CITY）。
 * 存档字段 G.state.city，通过 G.registerModule 注册：
 *   { idx:{safety,prosperity,people,clean}, active:[{id,left,total,paid}], done:{[id]:day},
 *     recover（治安短期损失的逐日恢复）, lastDay, started, ending, endingShown }
 *
 * 接口：
 *   G.city.index(name) -> 0~100               某项指数（safety|prosperity|people|clean）
 *   G.city.indexes() -> {safety,...}          四项指数的副本
 *   G.city.influence() -> {score, stage, next, index}   城市影响力（加权）、当前称号、下一阶段
 *   G.city.modifier(name) -> number           【给其他模块用的系数，永远是乘数，1 为无影响】
 *       'prosperity'  收入系数 0.75~1.25（繁荣高则高）   ← 项目分成已接入；汉堡店工资 / 股市大盘可接入
 *       'safety'      风险系数 0.75~1.25（治安高则低）   ← 项目出事概率已接入；街头骗局可接入
 *       'clean'       成本系数 0.875~1.125（廉洁高则低） ← 项目资金已接入
 *       'people'      民心系数 0.875~1.125（预留）
 *   G.city.projects() -> [{...project, status:'done'|'active'|'open', reason, price(含廉洁系数的实际资金)}]
 *   G.city.propose(id) -> {ok, reason}        提案（扣钱，开始推进）；只能在市政厅（周慕白办公时间）调用
 *   G.city.mayorAvailable() -> bool           周慕白是否在办公（9:00~17:00）
 *   G.city.openHall()                         市政厅门口：开市政厅面板（即周慕白的面板）
 *   G.city.openPanel()                        城市面板（只读，HUD「城市」按钮；不能提案）
 *   G.city.buildIndexes(body) / buildProjects(body)   面板片段（npc.js 的市政面板使用）
 *   G.city.sig() -> string                    状态签名（面板变化时重绘用）
 *   G.city.update(dt)                         每帧：跨日时推进项目、漂移指数、城市新闻、结局
 * 结局：影响力达到最高阶段（新生之城）时弹出一次结局文案。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var city = (G.city = G.city || {});

  function DATA() {
    return G.CITY_DATA || { indexes: [], weights: {}, stages: [], projects: [], news: [], maxActive: 2, ending: {} };
  }
  function cityDefaults() {
    var idx = {};
    DATA().indexes.forEach(function (d) { idx[d.id] = d.init; });
    return { idx: idx, active: [], done: {}, recover: [], lastDay: 1, started: false, ending: false, endingShown: false };
  }

  G.registerModule({ id: 'city', defaults: cityDefaults });

  function st() {
    var s = G.state;
    if (!s) return null;
    if (!s.city || typeof s.city !== 'object') s.city = cityDefaults();
    return s.city;
  }

  function clamp(v) { return G.clamp(Math.round(v * 10) / 10, 0, 100); }
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
  function meter(label, v, color) {
    var wrap = el('div', 'meter');
    wrap.style.setProperty('--c', color);
    var bar = el('div', 'bar');
    var fill = el('i', 'fill');
    fill.style.width = G.clamp(v, 0, 100) + '%';
    bar.appendChild(fill);
    wrap.appendChild(el('span', 'lbl', label));
    wrap.appendChild(bar);
    wrap.appendChild(el('span', 'num', String(Math.round(v))));
    return wrap;
  }
  function rebuildUi() { if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel(); }

  /* ---------- 查询 ---------- */
  city.index = function (name) {
    var c = st();
    var v = c ? Number(c.idx[name]) : NaN;
    return isFinite(v) ? G.clamp(v, 0, 100) : 0;
  };
  city.indexes = function () {
    var out = {};
    DATA().indexes.forEach(function (d) { out[d.id] = city.index(d.id); });
    return out;
  };
  function indexName(id) {
    var d = DATA().indexes.filter(function (x) { return x.id === id; })[0];
    return d ? d.name : id;
  }

  city.influence = function () {
    var w = DATA().weights || {};
    var score = 0;
    DATA().indexes.forEach(function (d) { score += (w[d.id] || 0) * city.index(d.id); });
    score = Math.round(score);
    var stages = DATA().stages || [];
    var k = 0;
    for (var i = 0; i < stages.length; i++) if (score >= stages[i].min) k = i;
    return {
      score: score,
      stage: stages[k] || { name: '', desc: '', min: 0 },
      next: stages[k + 1] || null,
      index: k,
    };
  };

  // 其他模块读取城市指数的系数（乘数；未加载或无存档时为 1）
  city.modifier = function (name) {
    var v = city.index(name);
    switch (name) {
      case 'prosperity': return G.clamp(1 + (v - 50) / 200, 0.75, 1.25);
      case 'safety':     return G.clamp(1 - (v - 50) / 200, 0.75, 1.25);
      case 'clean':      return G.clamp(1 + (50 - v) / 400, 0.875, 1.125);
      case 'people':     return G.clamp(1 + (v - 50) / 400, 0.875, 1.125);
    }
    return 1;
  };

  city.mayorAvailable = function () {
    return G.npc && G.npc.inHours ? G.npc.inHours('mayor') : true;
  };

  function findProject(id) {
    var list = DATA().projects || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function activeOf(id) {
    var c = st();
    if (!c) return null;
    for (var i = 0; i < c.active.length; i++) if (c.active[i].id === id) return c.active[i];
    return null;
  }
  function maxActive() { return DATA().maxActive || 2; }
  function costOf(p) { return Math.round(p.cost * city.modifier('clean')); }
  function skillName(id) {
    var d = (G.SKILLS || []).filter(function (x) { return x.id === id; })[0];
    return d ? d.name : id;
  }
  // 提案条件：返回 null 表示满足，否则返回原因
  function reasonOf(p) {
    var aff = G.npc && G.npc.affinity ? G.npc.affinity('mayor') : 0;
    if (aff < p.minAff) return '周慕白的好感还不够（需要 ' + p.minAff + '，现在 ' + aff + '）';
    if (p.skill && G.skills && G.skills.level(p.skill.id) < p.skill.lv) {
      return '需要「' + skillName(p.skill.id) + '」Lv' + p.skill.lv;
    }
    if (p.req) {
      var keys = Object.keys(p.req);
      for (var i = 0; i < keys.length; i++) {
        if (city.index(keys[i]) < p.req[keys[i]]) return '需要' + indexName(keys[i]) + '不低于 ' + p.req[keys[i]];
      }
    }
    return null;
  }

  city.projects = function () {
    var c = st();
    return (DATA().projects || []).map(function (p) {
      var st0 = c && c.done[p.id] ? 'done' : (activeOf(p.id) ? 'active' : 'open');
      return Object.assign({}, p, { status: st0, reason: st0 === 'open' ? reasonOf(p) : null, price: costOf(p) });
    });
  };

  /* ---------- 提案 ---------- */
  city.propose = function (id) {
    var c = st();
    var p = findProject(id);
    if (!c || !p) return { ok: false, reason: '没有这个项目' };
    if (c.done[id]) return { ok: false, reason: '这个项目已经完成了' };
    if (activeOf(id)) return { ok: false, reason: '这个项目正在推进中' };
    if (c.active.length >= maxActive()) return { ok: false, reason: '同时推进的项目已满（' + maxActive() + ' 个）' };
    if (!city.mayorAvailable()) return { ok: false, reason: '周慕白下班了（9:00 ~ 17:00 办公），明天再来' };
    var r = reasonOf(p);
    if (r) return { ok: false, reason: r };
    var cost = costOf(p);
    if (!G.economy || !G.economy.canAfford(cost)) return { ok: false, reason: '钱不够，「' + p.name + '」需要 🪙' + cost };
    G.economy.spend(cost);
    c.active.push({ id: id, left: p.days, total: p.days, paid: cost });
    G.log('【市政】' + p.start + '（花费 ' + cost + ' 元，' + p.days + ' 天后完成）');
    return { ok: true };
  };

  /* ---------- 每日推进 ---------- */
  function streetMul() { return G.skills && G.skills.bonus ? G.skills.bonus('street') : 1; }

  function completeProject(c, a, day) {
    var p = findProject(a.id);
    if (!p) return;
    Object.keys(p.eff || {}).forEach(function (k) { c.idx[k] = clamp((c.idx[k] || 0) + p.eff[k]); });
    c.done[p.id] = day;
    if (p.risk && Math.random() < p.risk.chance * city.modifier('safety') * streetMul()) {
      // 治安的短期损失：当天生效，之后 3 天每天回一些（见 dayTick）
      var hit = p.risk.safety || 0;
      c.idx.safety = clamp((c.idx.safety || 0) + hit);
      if (hit) c.recover.push({ idx: 'safety', per: -hit / 3, left: 3 });
      var loss = Math.round((p.risk.money || 0) * streetMul());
      if (loss > 0 && G.economy && G.economy.spend) G.economy.spend(loss);
      G.log('【市政】出事了：' + p.risk.text + (loss ? '（破财 ' + loss + ' 元）' : ''));
    }
    if (G.npc && G.npc.addAffinity) G.npc.addAffinity('mayor', 3);
    G.log('【城市】「' + p.name + '」完成：' + p.news);
  }

  function dayTick(c, day) {
    // 自然漂移（每天一点点，带一点随机）
    DATA().indexes.forEach(function (d) {
      var v = Number(c.idx[d.id]);
      if (!isFinite(v)) v = d.init;
      c.idx[d.id] = clamp(v + d.drift + (Math.random() - 0.5) * 0.8);
    });
    // 短期损失慢慢恢复
    c.recover = (c.recover || []).filter(function (r) {
      c.idx[r.idx] = clamp((c.idx[r.idx] || 0) + r.per);
      r.left -= 1;
      return r.left > 0;
    });
    // 项目推进
    var finished = [];
    c.active.forEach(function (a) { a.left -= 1; if (a.left <= 0) finished.push(a); });
    c.active = c.active.filter(function (a) { return a.left > 0; });
    finished.forEach(function (a) { completeProject(c, a, day); });
    // 完成项目的分成（繁荣系数）
    var income = 0;
    Object.keys(c.done).forEach(function (id) {
      var p = findProject(id);
      if (p && p.yield) income += p.yield;
    });
    if (income > 0 && G.economy && G.economy.earn) {
      var got = Math.round(income * city.modifier('prosperity'));
      G.economy.earn(got);
      G.log('【城市】项目分成到账 ' + got + ' 元');
    }
    // 平日城市新闻
    if (Math.random() < 0.5) {
      var list = (DATA().news || []).filter(function (n) { return n.when(c); });
      if (list.length) G.log('【城市】' + list[Math.floor(Math.random() * list.length)].text);
    }
  }

  city.update = function () {
    var s = G.state, c = st();
    if (!s || !c) return;
    if (!c.started) { c.started = true; c.lastDay = s.day; }
    if (s.day > c.lastDay) {
      var gap = Math.min(s.day - c.lastDay, 60);      // 离线/跳日：逐日补算，上限 60 天
      for (var i = 1; i <= gap; i++) dayTick(c, c.lastDay + i);
      c.lastDay = s.day;
    }
    var stages = DATA().stages || [];
    var top = stages.length ? stages[stages.length - 1].min : 100;
    if (!c.ending && city.influence().score >= top) c.ending = true;
    if (c.ending && !c.endingShown && !s.paused) {
      c.endingShown = true;
      showEnding();
    }
  };

  /* ---------- 结局 ---------- */
  function showEnding() {
    var E = DATA().ending || {};
    if (!G.ui || !G.ui.openPanel) return;
    G.ui.openPanel({
      title: E.title || '结局',
      build: function (body) {
        var box = sec();
        (E.lines || []).forEach(function (t) { box.appendChild(el('div', 'story-text', t)); });
        body.appendChild(box);
        if (E.egg) body.appendChild(el('div', 'npc-say', E.egg));
        body.appendChild(bigBtn(E.button || '继续经营', function () { if (G.ui.closeShop) G.ui.closeShop(); }, 'ghost'));
      },
    });
  }

  /* ---------- 面板片段 ---------- */
  // 四项指数条 + 影响力称号（市政面板顶部，也用于城市面板）
  city.buildIndexes = function (body) {
    var box = sec();
    box.appendChild(el('div', 'shop-name', '城市指数'));
    var colors = { safety: '#7fd3ff', prosperity: '#ffd84a', people: '#ff9ec7', clean: '#9ff0a8' };
    DATA().indexes.forEach(function (d) {
      box.appendChild(meter(d.name, city.index(d.id), colors[d.id] || '#ffffff'));
    });
    var inf = city.influence();
    box.appendChild(el('div', 'shop-price', '影响力「' + inf.stage.name + '」 ' + inf.score + ' / 100'));
    box.appendChild(el('div', 'shop-sub', inf.stage.desc));
    box.appendChild(el('div', 'shop-sub', inf.next ? '距离「' + inf.next.name + '」还差 ' + (inf.next.min - inf.score) : '已经是最高阶段'));
    body.appendChild(box);
  };

  function projectRow(p, body, opts) {
    var row = sec();
    row.appendChild(el('div', 'shop-name', p.name + '　' + (indexName(p.cat))));
    row.appendChild(el('div', 'shop-sub', p.desc));
    var eff = Object.keys(p.eff || {}).map(function (k) {
      var v = p.eff[k];
      return indexName(k) + (v > 0 ? '+' : '') + v;
    }).join(' ');
    var info = '资金 🪙' + p.price + ' · ' + p.days + ' 天 · 效果 ' + eff;
    if (p.yield) info += ' · 每天分成 ' + p.yield;
    row.appendChild(el('div', 'shop-sub', info));
    if (p.risk) row.appendChild(el('div', 'shop-sub', '风险：完成时可能出事（' + Math.round(p.risk.chance * 100) + '% 左右）'));
    if (opts && opts.reason) row.appendChild(el('div', 'shop-sub', '条件：' + opts.reason));
    if (opts && opts.button) row.appendChild(opts.button);
    body.appendChild(row);
  }

  // 市政面板的项目区：进行中 / 可提案 / 已完成
  city.buildProjects = function (body) {
    var c = st();
    if (!c) return;
    if (!city.mayorAvailable()) {
      body.appendChild(el('div', 'sec', '周慕白下班了（9:00 ~ 17:00 办公）。提案明天再来，进行中的项目照常推进。'));
    }
    var active = el('div', 'sec');
    active.appendChild(el('div', 'shop-name', '进行中（' + c.active.length + '/' + maxActive() + '）'));
    if (!c.active.length) active.appendChild(el('div', 'shop-sub', '暂时没有在推进的项目。'));
    c.active.forEach(function (a) {
      var p = findProject(a.id);
      if (!p) return;
      active.appendChild(el('div', 'shop-sub', p.name + '：还要 ' + a.left + ' 天'));
      var pct = a.total ? (1 - a.left / a.total) * 100 : 0;
      active.appendChild(meter('进度', pct, '#7fd3ff'));
    });
    body.appendChild(active);

    var open = el('div', 'sec');
    open.appendChild(el('div', 'shop-name', '可以推动的项目'));
    var list = city.projects().filter(function (p) { return p.status === 'open'; });
    if (!list.length) open.appendChild(el('div', 'shop-sub', '能推的都推完了。'));
    body.appendChild(open);
    list.forEach(function (p) {
      var reason = p.reason;
      if (!reason && !city.mayorAvailable()) reason = '周慕白下班了';
      if (!reason && c.active.length >= maxActive()) reason = '同时推进的项目已满';
      var btn = bigBtn('拜托他推动（🪙' + p.price + '）', function () {
        var r = city.propose(p.id);
        if (!r.ok && G.ui && G.ui.toast) G.ui.toast(r.reason);
        rebuildUi();
      }, 'small', !!reason);
      projectRow(p, body, { reason: reason, button: btn });
    });

    var done = sec();
    done.appendChild(el('div', 'shop-name', '已完成'));
    var ids = Object.keys(c.done);
    if (!ids.length) done.appendChild(el('div', 'shop-sub', '还没有完成的项目。'));
    ids.forEach(function (id) {
      var p = findProject(id);
      if (p) done.appendChild(el('div', 'shop-sub', '✓ ' + p.name + '（第 ' + c.done[id] + ' 天）'));
    });
    body.appendChild(done);
  };

  city.sig = function () {
    var c = st();
    if (!c) return '';
    var parts = DATA().indexes.map(function (d) { return Math.round(city.index(d.id) * 10); });
    parts.push(c.active.map(function (a) { return a.id + ':' + a.left; }).join(','));
    parts.push(Object.keys(c.done).join(','));
    parts.push(city.mayorAvailable() ? 1 : 0, c.ending ? 1 : 0);
    return parts.join('|');
  };

  /* ---------- 入口 ---------- */
  city.openHall = function () {
    if (!city.mayorAvailable()) { G.log('市政厅已经下班了（9:00 ~ 17:00 办公）'); return; }
    if (G.npc && G.npc.open) G.npc.open('mayor');
  };

  var cityLastSig = '';
  city.openPanel = function () {
    if (!G.ui || !G.ui.openPanel) return;
    G.ui.openPanel({
      title: '城市 · ' + ((G.CITY && G.CITY.name) || ''),
      build: function (body) {
        cityLastSig = city.sig();
        var intro = sec();
        if (G.CITY) {
          intro.appendChild(el('div', 'shop-sub', G.CITY.intro));
          intro.appendChild(el('div', 'npc-say', G.CITY.slogan));
        }
        body.appendChild(intro);
        city.buildIndexes(body);
        city.buildProjects(body);
        body.appendChild(el('div', 'sec', '想提案？白天去市政厅找周慕白（' + ((G.CITY && G.CITY.hallHours) || '9:00 ~ 17:00') + '）。'));
      },
      tick: function () {
        if (city.sig() !== cityLastSig) rebuildUi();
      },
    });
  };

  /* ---------- HUD「城市」按钮 ----------
   * ui.js 的 init 会重建 #hud，所以在 G.ui.init 之后补一个按钮（不改 ui.js）。 */
  function addHudButton() {
    var right = document.querySelector('#hud .hud-right');
    if (!right || right.querySelector('[data-city-btn]')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-btn';
    b.textContent = '城市';
    b.setAttribute('data-city-btn', '1');
    b.addEventListener('click', function () { b.blur(); city.openPanel(); });
    right.insertBefore(b, right.firstChild);
  }
  function hookUi() {
    if (!G.ui || !G.ui.init || G.ui.__cityHooked) return;
    var orig = G.ui.init;
    G.ui.init = function () {
      var r = orig.apply(this, arguments);
      try { addHudButton(); } catch (e) { /* HUD 失败不影响游戏 */ }
      return r;
    };
    G.ui.__cityHooked = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookUi);
  else hookUi();

  G.city = city;
})();
