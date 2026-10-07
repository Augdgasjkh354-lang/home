(function () {
  'use strict';

  function boot() {
    const canvas = document.getElementById('game');

    // 状态：优先读档
    G.state = G.newState();
    if (G.saveload && G.saveload.load) {
      try { G.saveload.load(); } catch (e) { console.warn('load failed', e); G.state = G.newState(); }
    }

    if (G.render) G.render.init(canvas);
    if (G.player) G.player.init();
    if (G.ui) G.ui.init();
    if (G.saveload && G.saveload.startAutoSave) G.saveload.startAutoSave();

    // 输入：鼠标 / 触摸统一用 pointer 事件
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', function (e) {
      const p = pos(e);
      if (G.ui) G.ui.onCanvasClick(p.x, p.y);
    });
    canvas.addEventListener('pointermove', function (e) {
      const p = pos(e);
      if (G.ui) G.ui.onCanvasMove(p.x, p.y);
    });
    window.addEventListener('resize', function () { if (G.render) G.render.resize(); });

    G.log('欢迎回家！点家具使用，按 B 打开商店');

    let last = performance.now();
    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25; // 切后台回来不要一次跳太多

      if (!G.state.paused) {
        if (G.economy) G.economy.tick(dt);
        if (G.events) G.events.update(dt);
        if (G.player) G.player.update(dt);
        if (G.petAI) G.petAI.update(dt);
        if (G.burger && G.burger.update) G.burger.update(dt);
        if (G.npc && G.npc.update) G.npc.update(dt);
        // 已通过 G.registerModule 注册的模块：G[id].update(dt) 存在则调用
        (G.modules || []).forEach(function (m) {
          var mod = G[m.id];
          if (mod && mod.update) mod.update(dt);
        });
      }
      if (G.ui) G.ui.update(dt);
      if (G.render) G.render.draw(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
