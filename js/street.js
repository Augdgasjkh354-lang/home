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
 *             点牌场 → 营业时间内走到门前，调用 G.cardroom.enter()（未实现则提示「牌场还没开张」）
 *             点市政厅 → 办公时间内走到门前，调用 G.city.openHall()（周慕白的面板）；下班则提示
 *             点街上的 NPC（林小满 / 周慕白 / 程念）→ 走到身边开对话面板（npc.js）
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
    if (inRect(S.hall, gx, gy)) {
      hallDoor();
      return true;
    }
    if (inRect(S.shop, gx, gy)) {
      if (G.burger && G.burger.onDoorClick) G.burger.onDoorClick();
      else G.log('汉堡店还在装修');
      return true;
    }
    if (inRect(S.cardroom, gx, gy)) {
      cardroomDoor();
      return true;
    }
    return false;
  };

  // 市政厅门：办公时间（9:00~17:00）内走到门前，打开市政厅面板；下班只提示
  function hallDoor() {
    if (!(G.city && G.city.mayorAvailable && G.city.mayorAvailable())) {
      G.log('市政厅已经下班了（9:00 ~ 17:00 办公）');
      return;
    }
    var door = G.STREET.hall.door;
    walkThen({ gx: door.gx, gy: door.gy + 1 }, function () {
      if (G.city && G.city.openHall) G.city.openHall();
    });
  }

  // 牌场门：营业时间外只提示；营业时走到门前，再交给 G.cardroom.enter()（内容见 cardroom.js）
  function cardroomDoor() {
    if (!isCardroomOpenNow()) { G.log('牌场还没开门（14:00 开门，次日 06:00 打烊）'); return; }
    var door = G.STREET.cardroom.door;
    walkThen({ gx: door.gx, gy: door.gy + 1 }, function () {
      if (!isCardroomOpenNow()) { G.log('牌场还没开门（14:00 开门，次日 06:00 打烊）'); return; }
      if (G.cardroom && G.cardroom.enter) G.cardroom.enter();
      else G.log('牌场还没开张');
    });
  }

  function isCardroomOpenNow() {
    return !!(G.isCardroomOpen && G.state && G.isCardroomOpen(G.state.time));
  }

  G.street = street;
})();
