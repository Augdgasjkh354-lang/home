/* ============================================================
 * 像素小家 —— 技能系统（skills.js）
 * 只往 G.skills 上挂接口。技能定义在 config.js 的 G.SKILLS（效果系数含义见那里的注释），
 * 存档字段 G.state.skills = { [id]: { xp, lv } }，通过 G.registerModule 注册。
 * 接口：
 *   G.skills.level(id) -> number          当前等级 0~maxLv
 *   G.skills.bonus(id) -> number          当前等级的效果系数（乘数，1 为无加成）
 *   G.skills.addXp(id, n) -> number       加经验；升级时 G.log（顶部提示）「技能升级！…」，返回升了几级
 *   G.skills.info(id) -> {...} | null     名称、等级、经验、当前/下一级效果文字（给其他面板展示用）
 *   G.skills.openPanel()                  打开技能面板（走 G.ui.openPanel）
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var skills = (G.skills = G.skills || {});

  var CSS = [
    '.sk-card { border:2px dashed #7b719c; padding:6px 8px; margin-top:8px; }',
    '.sk-card.open { border-style:solid; border-color:#f3ead8; background:#332c46; }',
    '.sk-head { display:flex; gap:8px; align-items:center; cursor:pointer; }',
    '.sk-head .shop-info { flex:1; min-width:0; line-height:16px; }',
    '.sk-arrow { flex:none; font-size:12px; color:#cfc4a8; }',
    '.sk-bar { height:8px; margin:4px 0 2px; border:2px solid #f3ead8; background:#1c1a24; overflow:hidden; }',
    '.sk-bar i { display:block; height:100%; width:0; background:#7fd3ff; transition:width .2s linear; }',
    '.sk-detail { margin-top:6px; padding-top:6px; border-top:1px dashed #7b719c; font-size:12px; line-height:17px; color:#e6dcc6; }',
    '.sk-unlock { color:#8f87a8; }',
    '.sk-unlock.on { color:#9ff0a8; }',
  ].join('\n');

  var openId = null;     // 面板里展开说明的技能 id
  var lastSig = '';      // 面板上次绘制时的数值签名，变化时才重绘
  var styled = false;

  function defs() { return G.SKILLS || []; }

  function def(id) {
    var list = defs();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // 取存档里的 {xp,lv}；状态未就绪或 id 不存在时返回 null
  function slot(id) {
    var st = G.state && G.state.skills;
    if (!st || !def(id)) return null;
    if (!st[id] || typeof st[id] !== 'object') st[id] = { xp: 0, lv: 0 };
    return st[id];
  }

  function textOf(d, lv) {
    return lv > 0 && d.text ? d.text(lv) : '暂无加成';
  }

  /* ---------- 对外接口 ---------- */
  skills.level = function (id) {
    var d = def(id), s = slot(id);
    if (!d || !s) return 0;
    return G.clamp(Math.floor(Number(s.lv) || 0), 0, d.maxLv);
  };

  skills.bonus = function (id) {
    var d = def(id);
    if (!d || !d.effect) return 1;
    return d.effect(skills.level(id));
  };

  skills.addXp = function (id, n) {
    var d = def(id), s = slot(id);
    n = Number(n);
    if (!d || !s || !(n > 0)) return 0;
    var lv = skills.level(id);
    var xp = (Number(s.xp) || 0) + n;
    var ups = 0;
    while (lv < d.maxLv && xp >= d.need(lv)) {
      xp -= d.need(lv);
      lv += 1;
      ups += 1;
    }
    if (lv >= d.maxLv) xp = 0;          // 满级后经验不再累积
    s.lv = lv;
    s.xp = xp;
    if (ups) G.log('技能升级！「' + d.name + '」到 Lv' + lv + '：' + textOf(d, lv));
    return ups;
  };

  skills.info = function (id) {
    var d = def(id), s = slot(id);
    if (!d || !s) return null;
    var lv = skills.level(id);
    var maxed = lv >= d.maxLv;
    return {
      id: d.id,
      name: d.name,
      icon: d.icon,
      desc: d.desc,
      unlocks: d.unlocks || [],
      lv: lv,
      maxLv: d.maxLv,
      xp: Math.floor(Number(s.xp) || 0),
      need: maxed ? 0 : d.need(lv),
      maxed: maxed,
      bonus: skills.bonus(id),
      text: textOf(d, lv),
      nextText: maxed ? '已满级' : textOf(d, lv + 1),
    };
  };

  /* ---------- 模块注册（存档字段） ---------- */
  G.registerModule({
    id: 'skills',
    defaults: function () {
      var o = {};
      defs().forEach(function (d) { o[d.id] = { xp: 0, lv: 0 }; });
      return o;
    },
  });

  /* ---------- 面板 ---------- */
  function ensureStyle() {
    if (styled) return;
    styled = true;
    try {
      if (document.getElementById('skills-style')) return;
      var st = document.createElement('style');
      st.id = 'skills-style';
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

  // 面板数值签名：等级、经验、展开项变化时才重绘
  function sigNow() {
    var st = (G.state && G.state.skills) || {};
    return defs().map(function (d) {
      var s = st[d.id] || {};
      return d.id + ':' + skills.level(d.id) + ':' + (Math.floor(Number(s.xp) || 0));
    }).join('|') + '#' + (openId || '');
  }

  function card(d) {
    var info = skills.info(d.id);
    var open = openId === d.id;
    var box = el('div', 'sk-card' + (open ? ' open' : ''));

    var head = el('div', 'sk-head');
    head.appendChild(el('span', 'shop-emoji', info.icon || '✦'));
    var mid = el('div', 'shop-info');
    mid.appendChild(el('div', 'shop-name', info.name + '　Lv ' + info.lv + ' / ' + info.maxLv));
    var bar = el('div', 'sk-bar');
    var fill = el('i');
    fill.style.width = (info.maxed ? 100 : Math.min(100, (info.xp / info.need) * 100)) + '%';
    bar.appendChild(fill);
    mid.appendChild(bar);
    mid.appendChild(el('div', 'shop-sub', info.maxed ? '经验已满' : '经验 ' + info.xp + ' / ' + info.need));
    mid.appendChild(el('div', 'shop-sub', '当前：' + info.text));
    mid.appendChild(el('div', 'shop-sub', '下一级：' + info.nextText));
    head.appendChild(mid);
    head.appendChild(el('span', 'sk-arrow', open ? '▾' : '▸'));
    head.addEventListener('click', function () {
      openId = open ? null : d.id;
      if (G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel();
    });
    box.appendChild(head);

    if (open) {
      var det = el('div', 'sk-detail', info.desc || '');
      info.unlocks.forEach(function (u) {
        var got = info.lv >= u.lv;
        det.appendChild(el('div', 'sk-unlock' + (got ? ' on' : ''),
          (got ? '✓ ' : '· ') + 'Lv' + u.lv + ' 解锁：' + u.text));
      });
      box.appendChild(det);
    }
    return box;
  }

  function build(body) {
    lastSig = sigNow();
    defs().forEach(function (d) { body.appendChild(card(d)); });
    body.appendChild(el('div', 'sec', '技能靠日常积累：打工、电脑工作、和林小满聊天都会攒经验。点技能可以看说明。'));
  }

  function tick() {
    if (sigNow() !== lastSig && G.ui && G.ui.rebuildPanel) G.ui.rebuildPanel();
  }

  skills.openPanel = function () {
    if (!G.ui || !G.ui.openPanel) return;
    ensureStyle();
    openId = null;
    G.ui.openPanel({ title: '技能', build: build, tick: tick });
  };

  G.skills = skills;
})();
