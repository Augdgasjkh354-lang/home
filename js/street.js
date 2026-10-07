/* ============================================================
 * 像素小家 —— 门口外景（street.js）
 * 只往 G.street 上挂接口。地图数据在 config.js（G.STREET），绘制在 render.js。
 * 接口：
 *   G.street.isStreet() -> bool                 当前是否在外景
 *   G.street.enter()                            室内门口 → 外景（玩家出现在自家门口）
 *   G.street.leave()                            外景 → 室内（玩家出现在室内门口）
 *   G.street.handleClick(gx,gy) -> bool         点到门/店时的处理；返回是否已处理
 *       室内：点底墙上的门 → 走到门口再出门
 *       外景：点林小满 → 走到她身边聊天（npc.js）；点自家小屋 → 走到门口再回家；
 *             点汉堡店 → 走到店门前开店面板（burger.js）
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  var street = (G.street = G.street || {});

  function roomDef() {
    return G.ROOMS[(G.state && G.state.roomLevel) || 0] || G.ROOMS[0];
  }

  function inRect(r, gx, gy) {
    return gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h;
  }

  function isStreet() {
    return !!(G.state && G.state.scene === 'street');
  }

  function closeShopIfOpen() {
    if (G.ui && G.ui.closeShop) G.ui.closeShop();
  }

  // 走到 front 后执行 fn；走不到就提示
  function walkThen(front, fn) {
    if (!G.player || !G.player.walkTo) return;
    if (!G.player.walkTo(front.gx, front.gy, fn)) G.log('走不到门口');
  }

  street.isStreet = isStreet;

  street.enter = function () {
    var s = G.state;
    if (!s || !G.STREET || s.scene === 'street') return false;
    s.scene = 'street';
    s.selected = null;
    closeShopIfOpen();
    var sp = G.STREET.spawn;
    if (G.player && G.player.placeAt) G.player.placeAt(sp.gx, sp.gy, 'down');
    G.log('出门啦，来到了门口的街道');
    return true;
  };

  street.leave = function () {
    var s = G.state;
    if (!s || s.scene !== 'street') return false;
    s.scene = 'home';
    s.selected = null;
    var f = G.homeDoorFront(roomDef());
    if (G.player && G.player.placeAt) G.player.placeAt(f.gx, f.gy, 'up');
    G.log('回到了家');
    return true;
  };

  street.handleClick = function (gx, gy) {
    var s = G.state;
    if (!s || !G.player || !G.STREET) return false;

    if (!isStreet()) {
      var d = G.homeDoor(roomDef());
      if (gx !== d.gx || gy !== d.gy) return false;
      walkThen(G.homeDoorFront(roomDef()), function () { street.enter(); });
      return true;
    }

    if (G.npc && G.npc.handleClick && G.npc.handleClick(gx, gy)) return true;

    var S = G.STREET;
    if (inRect(S.home, gx, gy)) {
      var hf = { gx: S.home.door.gx, gy: S.home.door.gy + 1 };
      walkThen(hf, function () { street.leave(); });
      return true;
    }
    if (inRect(S.shop, gx, gy)) {
      if (G.burger && G.burger.onDoorClick) G.burger.onDoorClick();
      else G.log('汉堡店还在装修');
      return true;
    }
    return false;
  };

  G.street = street;
})();
