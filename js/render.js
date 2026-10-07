/* ============================================================
 * render.js —— 像素小家：绘制模块（Canvas 2D，纯代码绘制像素图）
 * 只往 G.render 上挂接口（契约见 config.js）。
 *
 * 坐标约定（世界坐标，逻辑像素，1 格 = G.TILE）：
 *   室内左上角格 (0,0) 的左上角 = 世界 (0,0)；
 *   上墙厚 2 格（窗户位于其中），左/右/下墙各 1 格。
 *   外景（G.state.scene==="street"）：世界 (0,0) = G.STREET 地图左上角，无外圈墙，地图整体居中。
 * G.view = { ox, oy, w, h, scale }
 *   ox,oy = 室内 (0,0) 点在画布 CSS 像素中的位置；w,h = 室内宽高（CSS 像素）；scale = 整数缩放。
 *   即：屏幕 x = ox + gx * TILE * scale。
 * drawPlayer / drawPet 的 ctx 需处于上述世界坐标变换下（draw 内部即如此）。
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});
  G.render = G.render || {};

  var TILE = G.TILE || 16;
  var OUT = '#2a1f2b';                       // 深色描边
  var BG = '#2e2736';                        // 房间外背景
  var WALL_TOP = '#efe3c8';
  var WALL_STRIPE = '#e2d0ab';
  var WALL_SIDE = '#d4bc94';
  var WOOD = '#8a5a3b';
  var SKIN = '#f5d0a9';
  var HAIR = '#4a3322';
  var SHIRT = '#e0664f';
  var PANTS = '#3b4a6b';
  var SEASON_SKY = ['#f7c4d8', '#7fd3ff', '#f6a04a', '#dfe9f2'];      // 春粉 夏蓝 秋橙 冬白
  var SEASON_GROUND = ['#a8e0a0', '#4fae5a', '#c9803a', '#ffffff'];   // 春绿 夏绿 秋褐 冬雪

  var canvas = null, ctx = null;
  var dpr = 1, scale = 3, K = 3;
  var viewKey = '';
  var staticCv = null, staticKey = '';
  var tick = 0;
  var parts = [];
  var spriteCache = {};
  var motion = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var resizeHooked = false;

  /* ---------- 基础绘制工具（参数 g 为 2D 上下文） ---------- */
  function R(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
  function B(g, x, y, w, h, fill, line) {
    R(g, x, y, w, h, line || OUT);
    R(g, x + 1, y + 1, w - 2, h - 2, fill);
  }

  /* ---------- 颜色工具 ---------- */
  function hex(c) {
    var s = String(c).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(c, to, amt) {
    if (typeof c !== 'string' || c.charAt(0) !== '#') return c;
    var a = hex(c);
    return 'rgb(' + [0, 1, 2].map(function (i) {
      return Math.round(a[i] + (to[i] - a[i]) * amt);
    }).join(',') + ')';
  }
  function dk(c) { return mix(c, [0, 0, 0], 0.25); }
  function lt(c) { return mix(c, [255, 255, 255], 0.35); }

  function hash(n) {
    var s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return Math.floor((s - Math.floor(s)) * 1000);
  }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function clampDt(dt) {
    dt = +dt;
    if (!isFinite(dt) || dt < 0) return 0;
    return Math.min(dt, 0.1);
  }

  /* ---------- 状态读取（全部先判空） ---------- */
  function roomDef() {
    var lv = (G.state && G.state.roomLevel) | 0;
    var rooms = G.ROOMS || [];
    return rooms[lv] || rooms[0] || { id: 0, w: 6, h: 5 };
  }
  function roomKey(r) { return r.id + ':' + r.w + 'x' + r.h; }
  function fpOf(f) {
    var d = G.FURNITURE && G.FURNITURE[f.id];
    if (!d) return { w: 1, h: 1 };
    return f.rot ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }
  // 昼夜强度：0 = 白天，1 = 深夜
  function nightness(h) {
    h = ((h % 24) + 24) % 24;
    if (h >= 7 && h < 17) return 0;
    if (h >= 17 && h < 19) return (h - 17) / 2;
    if (h >= 19 || h < 5) return 1;
    return 1 - (h - 5) / 2;               // 5 ~ 7 点渐亮
  }

  /* ============================================================
   * 家具像素造型（W,H 为未旋转时的像素尺寸；s 为 style{c1,c2,c3}）
   * ============================================================ */
  var SPR = {
    bed_single: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c3);
      R(g, 2, 2, W - 4, 5, dk(s.c3));                 // 床头板
      B(g, 5, 3, W - 10, 8, s.c2);                    // 枕头
      R(g, 3, 12, W - 6, H - 16, s.c2);               // 床单
      B(g, 3, 14, W - 6, H - 19, s.c1);               // 被子
      R(g, 4, 17, W - 8, 1, lt(s.c1));                // 折边
      R(g, 8, 25, W - 16, 1, dk(s.c1));               // 花纹
      R(g, 2, H - 4, W - 4, 2, dk(s.c3));             // 床尾
    },
    bed_double: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c3);
      R(g, 2, 2, W - 4, 5, dk(s.c3));
      var pw = Math.floor((W - 12) / 2);
      B(g, 4, 3, pw, 8, s.c2);                        // 两个枕头
      B(g, W - 4 - pw, 3, pw, 8, s.c2);
      R(g, 3, 12, W - 6, H - 16, s.c2);
      B(g, 3, 14, W - 6, H - 19, s.c1);
      R(g, 4, 17, W - 8, 1, lt(s.c1));
      R(g, Math.floor(W / 2) - 3, 26, 6, 2, dk(s.c1));
      R(g, 2, H - 4, W - 4, 2, dk(s.c3));
    },
    table: function (g, W, H, s) {
      R(g, 3, 20, 3, H - 22, s.c3);                   // 桌腿
      R(g, W - 6, 20, 3, H - 22, s.c3);
      B(g, 0, 2, W, H - 10, s.c1);                    // 桌边
      R(g, 2, 4, W - 4, H - 14, s.c2);                // 桌面
      B(g, 6, 8, 8, 5, '#fbfbf5');                    // 餐盘
      B(g, W - 14, 8, 8, 5, '#fbfbf5');
      R(g, 9, 10, 2, 2, s.c3);                        // 食物
      R(g, W - 11, 10, 2, 2, s.c3);
    },
    fridge: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c1);
      R(g, 1, 12, W - 2, 1, s.c2);                    // 门缝
      R(g, 1, H - 3, W - 2, 2, s.c2);                 // 底部阴影
      R(g, 2, 2, W - 4, 1, '#ffffff');                // 高光
      R(g, W - 4, 4, 2, 6, s.c3);                     // 把手
      R(g, W - 4, 15, 2, 5, s.c3);
    },
    stove: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c2);
      R(g, 2, 2, W - 4, H - 6, s.c1);                 // 台面
      R(g, 6, 5, 6, 5, s.c2);                         // 灶眼 1
      R(g, 8, 7, 2, 1, s.c3);
      R(g, W - 12, 5, 6, 5, s.c2);                    // 灶眼 2
      R(g, W - 10, 7, 2, 1, s.c3);
      R(g, 4, 11, 2, 2, s.c3);                        // 旋钮
      R(g, W - 6, 11, 2, 2, s.c3);
    },
    desk_pc: function (g, W, H, s) {
      B(g, 0, 14, W, H - 14, s.c1);                   // 桌子
      R(g, 2, 16, W - 4, 2, lt(s.c1));
      R(g, 14, 13, 4, 2, s.c2);                       // 显示器支架
      B(g, 6, 1, 20, 13, s.c2);                       // 显示器外壳
      R(g, 9, 4, 14, 8, dk(s.c3));                    // 屏幕（动态内容见 DYN）
      B(g, 8, 22, 16, 5, '#e8e2d0');                  // 键盘
      R(g, 10, 24, 12, 1, '#9aa0a6');
      R(g, 27, 22, 2, 3, '#dddddd');                  // 鼠标
    },
    sofa: function (g, W, H, s) {
      B(g, 0, 0, W, 9, s.c2);                         // 靠背
      B(g, 0, 4, 6, H - 4, s.c1);                     // 扶手
      B(g, W - 6, 4, 6, H - 4, s.c1);
      B(g, 5, 7, W - 10, H - 8, s.c1);                // 坐垫
      R(g, 16, 8, 1, H - 10, s.c2);                   // 坐垫缝
      R(g, 31, 8, 1, H - 10, s.c2);
      R(g, 7, 9, W - 14, 1, lt(s.c1));                // 高光
      R(g, 20, 10, 6, 3, s.c3);                       // 抱枕
    },
    tv: function (g, W, H, s) {
      B(g, 0, 0, W, 11, s.c1);                        // 黑色外框
      R(g, 2, 2, W - 4, 7, s.c2);                     // 画面（动态内容见 DYN）
      R(g, 12, 11, 8, 2, s.c3);                       // 支架
      B(g, 2, 13, W - 4, 3, s.c3);                    // 机柜
      R(g, W - 8, 14, 2, 1, lt(s.c3));
    },
    bookshelf: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c1);
      var pal = [s.c2, s.c3, '#e8c872', '#7fb069', s.c2, lt(s.c3)];
      var x = 2, i = 0;
      while (x < W - 3) {
        var bw = (i % 3 === 1) ? 2 : 3;
        if (x + bw > W - 2) break;
        var bh = 9 + ((i * 5) % 4);
        var col = pal[i % pal.length];
        R(g, x, H - 2 - bh, bw, bh, col);
        R(g, x, H - 2 - bh, bw, 1, lt(col));
        x += bw;
        i++;
      }
      R(g, 1, H - 2, W - 2, 1, dk(s.c1));
    },
    shower: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c1);
      R(g, 1, 8, W - 2, 1, s.c2);                     // 瓷砖缝
      R(g, 1, 16, W - 2, 1, s.c2);
      R(g, 1, 24, W - 2, 1, s.c2);
      B(g, 3, 5, W - 6, H - 10, '#d8f0f8');           // 玻璃门
      R(g, 4, 7, 2, 8, s.c3);                         // 反光
      R(g, 6, 1, 6, 2, '#9aa9b0');                    // 花洒
      R(g, 9, 3, 1, 2, s.c2);
      R(g, 5, H - 4, 6, 2, s.c2);                     // 排水口
    },
    toilet: function (g, W, H, s) {
      B(g, 4, 0, 8, 6, s.c1);                         // 水箱
      R(g, 5, 1, 6, 1, s.c2);
      R(g, 12, 2, 2, 1, s.c3);                        // 冲水把手
      B(g, 2, 5, 12, 11, s.c1);                       // 马桶圈
      R(g, 4, 7, 8, 6, '#bfe3ee');                    // 水面
      R(g, 3, 6, 10, 1, s.c2);
    },
    plant: function (g, W, H, s) {
      B(g, 5, 0, 6, 8, s.c2);                         // 中叶
      B(g, 1, 3, 6, 6, s.c1);                         // 左叶
      B(g, 9, 2, 6, 7, s.c1);                         // 右叶
      R(g, 7, 2, 2, 2, lt(s.c1));
      B(g, 2, 8, 12, 3, s.c3);                        // 盆沿
      B(g, 3, 11, 10, 4, s.c3);                       // 盆身
    },
    rug: function (g, W, H, s) {
      R(g, 0, 0, W, H, dk(s.c2));
      R(g, 1, 1, W - 2, H - 2, s.c2);
      R(g, 3, 3, W - 6, H - 6, s.c1);
      for (var y = 6; y < H - 6; y += 6) {
        for (var x = 6 + ((y / 6) % 2) * 4; x < W - 6; x += 8) R(g, x, y, 2, 2, s.c3);
      }
    },
    lamp: function (g, W, H, s) {
      B(g, 4, 13, 8, 3, s.c2);                        // 底座
      R(g, 7, 6, 2, 8, s.c2);                         // 灯杆
      B(g, 3, 1, 10, 6, s.c1);                        // 灯罩
      R(g, 5, 2, 6, 1, lt(s.c1));
      R(g, 6, 4, 4, 2, s.c3);                         // 灯泡
    },
    painting: function (g, W, H, s) {
      B(g, 0, 0, W, H, s.c3);
      R(g, 3, 3, W - 6, H - 6, s.c1);                 // 天空
      R(g, W - 10, 4, 4, 4, s.c2);                    // 太阳
      R(g, 3, H - 7, W - 6, 4, '#5aa06a');            // 草地
      R(g, 8, H - 9, 6, 2, '#5aa06a');                // 小山
    },
    pet_bed: function (g, W, H, s) {
      B(g, 1, 4, 14, 11, s.c1);
      R(g, 3, 6, 10, 7, s.c2);                        // 垫子
      R(g, 3, 11, 10, 1, dk(s.c2));
      R(g, 2, 13, 12, 2, s.c3);
    },
    pet_bowl: function (g, W, H, s) {
      B(g, 1, 6, 14, 7, s.c1);
      R(g, 3, 7, 10, 2, s.c2);                        // 食物
      R(g, 4, 13, 8, 2, s.c3);                        // 底座
    }
  };
  SPR._default = function (g, W, H, s) { B(g, 0, 0, W, H, s.c1 || '#999'); };

  /* 需要随时间变化的家具画面（只在未旋转时绘制；x,y 为世界坐标左上角） */
  var DYN = {
    desk_pc: function (g, x, y, t) {
      var sx = x + 9, sy = y + 4;
      for (var k = 0; k < 4; k++) {
        var len = 3 + Math.floor(((t * 2.2 + k * 0.37) % 1) * 9);
        R(g, sx + 2, sy + 1 + k * 2, len, 1, 'rgba(225,246,255,0.9)');
      }
    },
    tv: function (g, x, y, t) {
      var bx = 2 + Math.floor((t * 14) % 20);
      R(g, x + bx, y + 2, 5, 7, 'rgba(255,255,255,0.22)');
    }
  };

  /* ---------- 精灵缓存：按 id + rot 生成离屏 canvas ---------- */
  function getSprite(id, rot) {
    var d = G.FURNITURE && G.FURNITURE[id];
    if (!d) return null;
    var key = id + '|' + (rot ? 1 : 0);
    if (spriteCache[key]) return spriteCache[key];
    var W = d.w * TILE, H = d.h * TILE;
    var base = mk(W, H);
    var bg = base.getContext('2d');
    bg.imageSmoothingEnabled = false;
    (SPR[id] || SPR._default)(bg, W, H, d.style || { c1: '#999', c2: '#bbb', c3: '#666' });
    var out = base;
    if (rot) {
      // 把未旋转造型顺时针转 90 度，占格变为 h×w
      out = mk(H, W);
      var og = out.getContext('2d');
      og.imageSmoothingEnabled = false;
      og.translate(H, 0);
      og.rotate(Math.PI / 2);
      og.drawImage(base, 0, 0);
    }
    spriteCache[key] = out;
    return out;
  }

  /* ---------- 房间静态层（地板 + 墙），按房间等级缓存 ---------- */
  function hashFloorSeam() { return '#a8703f'; }
  function drawFloor(g, W, H) {
    var A = '#dcae72', A2 = '#d19f62', SEAM = hashFloorSeam(), KNOT = '#b9824d';
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    var rows = Math.ceil(H / 8);
    for (var r = 0; r < rows; r++) {
      var y = r * 8;
      var x = -(hash(r) % 24);
      var k = 0;
      while (x < W) {
        var len = 24 + (hash(r * 17 + k) % 17);
        var col = (hash(r * 29 + k * 7) % 3 === 0) ? A2 : A;
        R(g, x, y, len, 8, col);
        R(g, x + len - 1, y, 1, 8, SEAM);                              // 木板接缝
        if (hash(r * 11 + k * 5) % 4 === 0) {
          R(g, x + 4 + (hash(k + r) % (len - 8)), y + 3 + (hash(r + k * 3) % 3), 2, 1, KNOT);
        }
        x += len;
        k++;
      }
      R(g, 0, y + 7, W, 1, SEAM);                                      // 行缝
    }
    g.restore();
  }

  function buildStatic(room) {
    var w = room.w, h = room.h, W = w * TILE, H = h * TILE;
    var cv = mk((w + 2) * TILE, (h + 3) * TILE);
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(TILE, 2 * TILE);                                       // 世界(-T,-2T) 映射到画布(0,0)

    drawFloor(g, W, H);
    R(g, 0, 0, W, 3, 'rgba(60,40,20,0.18)');                           // 上墙投影
    // 内侧踢脚线
    R(g, 0, 0, 2, H, WOOD);
    R(g, W - 2, 0, 2, H, WOOD);
    R(g, 0, H - 2, W, 2, WOOD);
    R(g, 0, -2, W, 2, WOOD);

    // 墙体：上墙（厚 2 格，带竖条墙纸）、左右下墙（厚 1 格）
    R(g, -TILE, -2 * TILE, W + 2 * TILE, 2 * TILE, WALL_TOP);
    for (var x = -TILE + 6; x < W + TILE; x += 10) R(g, x, -2 * TILE + 2, 1, 2 * TILE - 4, WALL_STRIPE);
    R(g, -TILE, 0, TILE, H, WALL_SIDE);
    R(g, W, 0, TILE, H, WALL_SIDE);
    R(g, -TILE, H, W + 2 * TILE, TILE, WALL_SIDE);
    drawHomeDoor(g, G.homeDoor(room).gx * TILE, H);                    // 底墙上的门
    // 外轮廓
    R(g, -TILE, -2 * TILE, W + 2 * TILE, 1, OUT);
    R(g, -TILE, -2 * TILE, 1, H + 3 * TILE, OUT);
    R(g, W + TILE - 1, -2 * TILE, 1, H + 3 * TILE, OUT);
    R(g, -TILE, H + TILE - 1, W + 2 * TILE, 1, OUT);
    return cv;
  }

  function ensureStatic(room) {
    var key = roomKey(room);
    if (staticCv && staticKey === key) return;
    staticCv = buildStatic(room);
    staticKey = key;
  }

  /* ============================================================
   * 门口外景（街道）：地图静态层按季节/雪天缓存；夜灯每帧叠加。
   * 地图数据见 config.js 的 G.STREET，本段只负责画。
   * ============================================================ */
  var ROAD = '#5d5a68', ROAD_DASH = '#f3ead8', CURB = '#e9dcc0';
  var PAVE = '#d8ccb4', PAVE_SEAM = '#bfb296';
  var H_WALL = '#f2e6cf', H_PLANK = '#e2d0ab', H_ROOF = '#c4574a';
  var S_RED = '#d9483b', S_WHITE = '#fff5e1', S_YEL = '#ffd23f';
  var GLASS = '#9fd8ef', GLASS_WARM = '#ffe9a8';
  var LEAF = '#3d8a4f', LEAF_LT = '#5fae68', TRUNK = '#7a4e2c';
  var streetCv = null, streetKey = '';

  function isStreet() { return !!(G.state && G.state.scene === 'street' && G.STREET); }
  function sceneDims() { return isStreet() ? G.STREET : roomDef(); }
  function sceneKey() {
    var d = sceneDims();
    return isStreet() ? 'street:' + d.w + 'x' + d.h : roomKey(d);
  }
  function seasonOf(st) { return (((st.season | 0) % 4) + 4) % 4; }

  // 窗框（WOOD 框 + 十字窗格）
  function winBox(g, x, y, w, h, glass) {
    B(g, x - 1, y - 1, w + 2, h + 2, WOOD);
    R(g, x, y, w, h, glass);
    R(g, x + Math.floor(w / 2) - 1, y, 2, h, WOOD);
    R(g, x, y + Math.floor(h / 2) - 1, w, 2, WOOD);
    R(g, x + 1, y + 1, 2, 2, '#ffffff');
  }

  // 室内底墙上的门（格外一行，嵌在墙里）
  function drawHomeDoor(g, x, y) {
    B(g, x + 2, y + 1, 12, 15, WOOD);
    R(g, x + 4, y + 3, 8, 5, dk(WOOD));
    R(g, x + 4, y + 9, 8, 5, dk(WOOD));
    R(g, x + 10, y + 8, 2, 2, '#f3d46b');
  }

  function drawTree(g, gx, gy) {
    var x = gx * TILE, y = gy * TILE;
    R(g, x + 3, y + 13, 10, 2, 'rgba(0,0,0,0.18)');     // 树影
    R(g, x + 7, y + 9, 2, 5, TRUNK);
    B(g, x + 2, y + 1, 12, 10, LEAF);
    R(g, x + 4, y + 3, 3, 2, LEAF_LT);
    R(g, x + 9, y + 6, 2, 1, LEAF_LT);
  }

  // 自家小屋：红瓦屋顶、木墙带窗，门在底排（朝向门前人行道）。以建筑左上角为局部原点
  function drawHouse(g, r) {
    var fw = r.w * TILE, fh = r.h * TILE, dx = (r.door.gx - r.x) * TILE;
    g.save();
    g.translate(r.x * TILE, r.y * TILE);
    B(g, 0, 0, fw, 16, H_ROOF);                          // 屋顶
    for (var i = 0; i < fw; i += 8) R(g, i + 4, 0, 1, 8, dk(H_ROOF));
    R(g, 0, 14, fw, 2, dk(H_ROOF));                      // 屋檐
    B(g, 0, 16, fw, fh - 16, H_WALL);                    // 墙
    for (var x = 3; x < fw - 2; x += 6) R(g, x, 18, 1, fh - 20, H_PLANK);
    winBox(g, 4, 21, 10, 10, GLASS);
    winBox(g, fw - 14, 21, 10, 10, GLASS);
    B(g, dx + 2, fh - 14, 12, 14, WOOD);                 // 门
    R(g, dx + 4, fh - 12, 8, 4, dk(WOOD));
    R(g, dx + 4, fh - 7, 8, 4, dk(WOOD));
    R(g, dx + 10, fh - 6, 2, 2, '#f3d46b');
    g.restore();
  }

  // 汉堡店：顶部黄色招牌（汉堡图样）、红白条纹雨棚、红墙、玻璃门
  function drawShop(g, r) {
    var fw = r.w * TILE, fh = r.h * TILE, dx = (r.door.gx - r.x) * TILE;
    var bx = (r.sign.gx - r.x) * TILE + 6, by = (r.sign.gy - r.y) * TILE + 1;
    var bw = fw - bx - 6, bh = 14;
    g.save();
    g.translate(r.x * TILE, r.y * TILE);
    B(g, bx, by, bw, bh, WOOD);                          // 招牌板
    R(g, bx + 2, by + 2, bw - 4, bh - 4, S_YEL);
    var ix = bx + Math.floor(bw / 2) - 10, iy = by + 3;   // 汉堡：上包 / 生菜 / 肉饼 / 下包
    R(g, ix + 1, iy, 18, 2, '#d98a3a');
    R(g, ix + 4, iy, 1, 1, S_WHITE);
    R(g, ix + 10, iy, 1, 1, S_WHITE);
    R(g, ix, iy + 2, 20, 1, '#5aa05a');
    R(g, ix, iy + 3, 20, 2, '#6b3e22');
    R(g, ix, iy + 5, 20, 2, '#d98a3a');
    for (var i = 0; i < fw; i += 8) R(g, i, 16, 8, 8, (i / 8) % 2 ? S_WHITE : S_RED);   // 雨棚
    R(g, 0, 24, fw, 1, OUT);
    R(g, 0, 25, fw, fh - 25, S_RED);                     // 墙
    R(g, 0, 25, fw, 1, dk(S_RED));
    winBox(g, 4, 30, 10, 9, GLASS_WARM);
    winBox(g, fw - 14, 30, 10, 9, GLASS_WARM);
    B(g, dx + 2, fh - 14, 12, 14, S_WHITE);              // 门（玻璃门）
    R(g, dx + 4, fh - 12, 8, 6, GLASS);
    R(g, dx + 4, fh - 5, 8, 3, S_RED);
    R(g, 0, fh - 1, fw, 1, OUT);
    R(g, 0, 16, 1, fh - 16, OUT);
    R(g, fw - 1, 16, 1, fh - 16, OUT);
    g.restore();
  }

  // 牌场：墨绿屋顶、暗紫墙、屋顶中央的霓虹「牌」字招牌，门口一盏红灯（城市暗面）
  var CR_ROOF = '#1e3d33', CR_WALL = '#2d2140', CR_TRIM = '#4a2f63', CR_NEON = '#ff5ad6';
  function drawCardroom(g, r) {
    var fw = r.w * TILE, fh = r.h * TILE, dx = (r.door.gx - r.x) * TILE;
    g.save();
    g.translate(r.x * TILE, r.y * TILE);
    B(g, 0, 0, fw, 16, CR_ROOF);                         // 屋顶
    for (var i = 0; i < fw; i += 8) R(g, i + 4, 0, 1, 8, dk(CR_ROOF));
    R(g, 0, 14, fw, 2, '#0f1f19');                       // 屋檐
    B(g, 0, 16, fw, fh - 16, CR_WALL);                   // 墙
    for (var x = 3; x < fw - 2; x += 6) R(g, x, 18, 1, fh - 20, dk(CR_WALL));
    B(g, 18, 1, 28, 13, '#140a1c', CR_NEON);             // 霓虹招牌
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffe6f8';
    g.fillText('牌', fw / 2, 8);
    [[5, 22], [fw - 15, 22]].forEach(function (p) {     // 暗色小窗，窗内一点冷光
      B(g, p[0], p[1], 10, 8, '#0c0814', CR_TRIM);
      R(g, p[0] + 2, p[1] + 2, 3, 2, '#7fe0b8');
    });
    B(g, dx + 2, fh - 14, 12, 14, CR_TRIM);              // 门
    R(g, dx + 4, fh - 12, 8, 6, '#0c0814');
    R(g, dx + 4, fh - 5, 8, 3, CR_WALL);
    R(g, dx + 6, fh - 19, 4, 3, '#ff3b3b');              // 门口红灯
    R(g, 0, fh - 1, fw, 1, OUT);
    R(g, 0, 16, 1, fh - 16, OUT);
    R(g, fw - 1, 16, 1, fh - 16, OUT);
    g.restore();
  }

  // 市政厅：石质大楼，屋顶旗杆与山花，中间一排窗，正门两侧有柱（夜里窗口有灯，见 drawStreetLights）
  function drawHall(g, r) {
    var fw = r.w * TILE, fh = r.h * TILE, dx = (r.door.gx - r.x) * TILE;
    var STONE = '#cfc8b8', STONE_LT = '#ece6d6', STONE_DK = '#a59d8c', COL = '#e6dfcf';
    var FLAG = '#b33a3a', GOLD = '#e0b04a', POLE = '#6b6258';
    var cx = Math.floor(fw / 2);
    g.save();
    g.translate(r.x * TILE, r.y * TILE);
    R(g, cx - 1, 0, 2, 16, POLE);                        // 旗杆
    R(g, cx + 1, 1, 9, 6, FLAG);                         // 旗帜
    R(g, cx + 1, 4, 9, 1, GOLD);
    R(g, cx + 4, 2, 2, 2, GOLD);
    [[6, 6], [7, 15], [8, 24], [9, 32], [10, 38]].forEach(function (rw) {   // 山花（三角屋顶）
      R(g, cx - rw[1], rw[0], rw[1] * 2, 1, STONE_LT);
      R(g, cx - rw[1], rw[0] + 1, rw[1] * 2, 0, STONE_LT);
    });
    R(g, 2, 11, fw - 4, 2, STONE_DK);                    // 檐口
    B(g, 1, 13, fw - 2, 5, STONE);                       // 檐板，上面写「市政厅」
    g.font = 'bold 7px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#4a3c2a';
    g.fillText('市政厅', cx, 16);
    R(g, 0, 18, fw, fh - 18, STONE_LT);                  // 立面
    [6, 18, 56, 68].forEach(function (x) {               // 柱子
      R(g, x, 18, 4, fh - 18, COL);
      R(g, x + 3, 18, 1, fh - 18, STONE_DK);
    });
    [11, 61].forEach(function (x) {                      // 窗（两侧）
      B(g, x, 21, 7, 10, '#5d6b7a', STONE_DK);
      R(g, x + 2, 22, 3, 8, GLASS);
      R(g, x + 3, 22, 1, 8, '#5d6b7a');
    });
    B(g, dx + 3, fh - 15, 10, 15, '#6b4a33', STONE_DK);  // 正门（双扇）
    R(g, dx + 8, fh - 14, 1, 13, '#4a3322');
    R(g, dx + 10, fh - 8, 2, 2, '#f3d46b');
    R(g, dx, fh - 2, 16, 2, STONE_DK);                   // 台阶
    R(g, 0, fh - 1, fw, 1, OUT);
    R(g, 0, 18, 1, fh - 18, OUT);
    R(g, fw - 1, 18, 1, fh - 18, OUT);
    g.restore();
  }

  // 街角小公园：草地、花坛（长椅与路灯是道具，见 drawProps）
  function drawCorner(g, c) {
    var x0 = c.x * TILE, y0 = c.y * TILE, w = c.w * TILE, h = c.h * TILE;
    R(g, x0, y0, w, h, '#7cc47a');
    for (var k = 0; k < w; k += 5) R(g, x0 + k, y0 + 2, 2, 1, '#5aa05a');
    R(g, x0 + 2, y0 + h - 6, w - 4, 4, '#8a5a3b');       // 花坛
    R(g, x0 + 3, y0 + h - 8, 2, 2, '#f7c4d8');
    R(g, x0 + 9, y0 + h - 8, 2, 2, '#ffe08a');
    R(g, x0 + 15, y0 + h - 8, 2, 2, '#f7c4d8');
    R(g, x0 + 1, y0 + 1, 2, 2, OUT);                     // 一小株树苗（不挡路）
  }

  function drawBench(g, gx, gy) {
    var x = gx * TILE, y = gy * TILE;
    R(g, x + 1, y + 13, 14, 2, 'rgba(0,0,0,0.18)');
    B(g, x + 1, y + 3, 14, 3, '#8a5a3b');               // 靠背
    B(g, x + 1, y + 7, 14, 4, '#b98a56');               // 座面
    R(g, x + 2, y + 11, 2, 3, OUT);
    R(g, x + 12, y + 11, 2, 3, OUT);
  }

  function drawLamp(g, gx, gy) {
    var x = gx * TILE, y = gy * TILE;
    R(g, x + 1, y + 13, 14, 2, 'rgba(0,0,0,0.18)');
    R(g, x + 7, y + 4, 2, 11, '#3a3440');               // 灯杆
    B(g, x + 4, y + 1, 8, 4, '#3a3440');                // 灯头
    R(g, x + 6, y + 3, 4, 2, '#ffe08a');                // 灯泡（夜里发光，见 drawStreetLights）
  }

  function drawProps(g, S) {
    (S.props || []).forEach(function (p) {
      if (p.kind === 'bench') drawBench(g, p.gx, p.gy);
      else if (p.kind === 'lamp') drawLamp(g, p.gx, p.gy);
    });
  }

  function buildStreetStatic(season, snow) {
    var S = G.STREET, W = S.w * TILE, H = S.h * TILE;
    var cv = mk(W, H);
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var grass = snow ? '#ffffff' : SEASON_GROUND[season];   // 与室内窗外草地同一套四季配色
    R(g, 0, 0, W, H, grass);
    for (var ty = 0; ty < S.h; ty++) {                       // 草地杂点
      for (var tx = 0; tx < S.w; tx++) {
        var hv = hash(ty * 31 + tx * 7);
        if (hv % 3 === 0) R(g, tx * TILE + (hv % 11) + 2, ty * TILE + (Math.floor(hv / 11) % 11) + 2, 2, 1, dk(grass));
      }
    }
    [4, 8].forEach(function (row) {                          // 人行道
      R(g, 0, row * TILE, W, TILE, PAVE);
      for (var x = 0; x < W; x += 16) R(g, x, row * TILE, 1, TILE, PAVE_SEAM);
      R(g, 0, row * TILE + 7, W, 1, PAVE_SEAM);
    });
    R(g, 0, 5 * TILE, W, 3 * TILE, ROAD);                    // 马路
    R(g, 0, 5 * TILE, W, 2, CURB);
    R(g, 0, 8 * TILE - 2, W, 2, CURB);
    for (var dx = 2; dx < W; dx += 16) R(g, dx, 6 * TILE + 7, 9, 2, ROAD_DASH);
    drawHouse(g, S.home);
    drawShop(g, S.shop);
    if (S.cardroom) drawCardroom(g, S.cardroom);
    if (S.hall) drawHall(g, S.hall);
    if (S.corner) drawCorner(g, S.corner);
    drawProps(g, S);
    for (var k = 0; k < S.trees.length; k++) drawTree(g, S.trees[k].gx, S.trees[k].gy);
    return cv;
  }

  function ensureStreetStatic(season, snow) {
    var key = season + '|' + (snow ? 1 : 0) + '|' + G.STREET.w + 'x' + G.STREET.h;
    if (streetCv && streetKey === key) return;
    streetCv = buildStreetStatic(season, snow);
    streetKey = key;
  }

  // 外景夜灯：两栋楼的窗户与汉堡店招牌发暖光
  function drawStreetLights(g, n) {
    var S = G.STREET, T = TILE;
    var sbx = (S.shop.sign.gx - S.shop.x) * T + 6;
    var sbw = S.shop.w * T - sbx - 6;
    var pts = [
      [S.home.x * T + 9, S.home.y * T + 26],
      [S.home.x * T + S.home.w * T - 9, S.home.y * T + 26],
      [S.shop.x * T + 9, S.shop.y * T + 34],
      [S.shop.x * T + S.shop.w * T - 9, S.shop.y * T + 34],
      [S.shop.x * T + sbx + sbw / 2, S.shop.y * T + (S.shop.sign.gy - S.shop.y) * T + 8]
    ];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < pts.length; i++) glow(g, pts[i][0], pts[i][1], 26, '255,200,120', 0.45 * n);
    if (S.hall) {                                       // 市政厅：夜里窗口有灯，门口一盏灯
      var H = S.hall;
      glow(g, H.x * T + 14, H.y * T + 26, 18, '255,220,150', 0.55 * n);
      glow(g, H.x * T + 64, H.y * T + 26, 18, '255,220,150', 0.55 * n);
      glow(g, H.door.gx * T + 8, H.y * T + H.h * T - 8, 16, '255,230,170', 0.5 * n);
    }
    if (S.props) {                                      // 街角路灯
      S.props.forEach(function (p) {
        if (p.kind === 'lamp') glow(g, p.gx * T + 8, p.gy * T + 5, 16, '255,220,140', 0.6 * n);
      });
    }
    if (S.cardroom) {                                   // 牌场：粉色霓虹招牌 + 门口红灯
      var C = S.cardroom;
      glow(g, C.x * T + 32, C.y * T + 8, 22, '255,90,214', 0.55 * n);
      glow(g, C.door.gx * T + 8, C.y * T + 30, 12, '255,59,59', 0.6 * n);
    }
    g.restore();
  }

  /* ---------- 窗户（随季节、天气、昼夜变化） ---------- */
  function drawWindow(g, room, st, n) {
    var W = room.w * TILE;
    var ww = 36, wh = 20;
    var wx = Math.round(W / 2 - ww / 2), wy = -27;
    var season = (((st.season | 0) % 4) + 4) % 4;
    var weather = st.weather || 'sunny';
    var night = n > 0.5;

    var sky = night ? '#1d2750' : SEASON_SKY[season];
    var ground = night ? '#2a3560' : SEASON_GROUND[season];
    if (weather === 'snow') ground = '#ffffff';

    B(g, wx - 3, wy - 3, ww + 6, wh + 6, WOOD);                        // 窗框
    R(g, wx, wy, ww, 13, sky);                                         // 天空
    R(g, wx, wy + 13, ww, wh - 13, ground);                            // 地面

    if (night) {
      var stars = [[3, 2], [14, 5], [24, 3], [8, 9], [20, 10]];
      for (var i = 0; i < stars.length; i++) R(g, wx + stars[i][0], wy + stars[i][1], 1, 1, '#ffffff');
      R(g, wx + ww - 9, wy + 2, 4, 4, '#fff8d6');                      // 月亮
    } else if (weather === 'sunny') {
      R(g, wx + ww - 9, wy + 2, 5, 5, '#ffe27a');                      // 太阳
    }
    if (weather === 'cloudy') {
      R(g, wx + 3, wy + 3, 11, 4, '#f4f6fa');
      R(g, wx + 6, wy + 1, 6, 3, '#f4f6fa');
      R(g, wx + 20, wy + 6, 9, 3, '#e6ebf2');
    }
    if (weather === 'rain') R(g, wx, wy, ww, wh, 'rgba(60,72,96,0.35)');
    if (weather === 'snow') R(g, wx, wy, ww, wh, 'rgba(255,255,255,0.18)');

    R(g, wx + Math.floor(ww / 2) - 1, wy, 2, wh, WOOD);                // 窗格
    R(g, wx, wy + 9, ww, 2, WOOD);

    R(g, wx - 5, wy + wh + 4, ww + 10, 2, lt('#e6d3a8'));              // 窗台
    R(g, wx - 7, wy - 2, 3, wh + 8, '#d98a9a');                         // 窗帘
    R(g, wx + ww + 4, wy - 2, 3, wh + 8, '#d98a9a');
  }

  /* ---------- 灯光（夜晚暖色光圈） ---------- */
  function glow(g, cx, cy, r, rgb, a) {
    if (a <= 0.005) return;
    var gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  function drawLights(g, furn, n) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < furn.length; i++) {
      var f = furn[i];
      if (!f) continue;
      if (f.id === 'lamp') {
        glow(g, f.x * TILE + 8, f.y * TILE + 8, 44, '255,200,120', 0.55 * n);
      } else if (f.id === 'tv') {
        glow(g, f.x * TILE + 16, f.y * TILE + 8, 36, '255,170,90', 0.35 * n);
      } else if (f.id === 'desk_pc') {
        glow(g, f.x * TILE + 16, f.y * TILE + 16, 30, '110,190,255', 0.25 * n);
      }
    }
    g.restore();
  }

  /* ---------- 雨雪粒子（上限 56 个） ---------- */
  function stepParticles(g, room, weather, dt) {
    var rain = weather === 'rain', snow = weather === 'snow';
    if (!rain && !snow) {
      if (parts.length) parts.length = 0;
      return;
    }
    var W = room.w * TILE, H = room.h * TILE;
    var x0 = -TILE, x1 = W + TILE, y0 = -2 * TILE, y1 = H + TILE;
    var kind = rain ? 'rain' : 'snow';
    while (parts.length < 56) parts.push({ kind: '', x: 0, y: 0, bx: 0, sp: 0, ph: Math.random() * 6.28 });

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.kind !== kind) {
        p.kind = kind;
        p.bx = x0 + Math.random() * (x1 - x0);
        p.x = p.bx;
        p.y = y0 + Math.random() * (y1 - y0);
        p.sp = rain ? 150 + Math.random() * 70 : 12 + Math.random() * 12;
      }
      p.y += p.sp * dt;
      if (rain) p.x -= 30 * dt;
      if (p.y > y1 || p.x < x0 - 8) {
        p.y = y0 - Math.random() * 8;
        p.bx = x0 + Math.random() * (x1 - x0);
        p.x = p.bx;
      }
      if (snow) p.x = p.bx + Math.sin(tick * 1.4 + p.ph) * 3;
    }

    for (var j = 0; j < parts.length; j++) {
      var q = parts[j];
      var px = Math.round(q.x), py = Math.round(q.y);
      if (rain) {
        g.fillStyle = 'rgba(180,205,255,0.7)';
        g.fillRect(px, py, 1, 1);
        g.fillRect(px - 1, py + 1, 1, 1);
        g.fillRect(px - 2, py + 2, 1, 1);
      } else {
        g.fillStyle = 'rgba(255,255,255,0.92)';
        var sz = q.ph > 3 ? 2 : 1;
        g.fillRect(px, py, sz, sz);
      }
    }
  }

  /* ---------- 建造模式网格 / 幽灵 / 选中框 ---------- */
  function drawGrid(g, room) {
    var W = room.w * TILE, H = room.h * TILE;
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (var x = 0; x <= room.w; x++) g.fillRect(x * TILE, 0, 1, H);
    for (var y = 0; y <= room.h; y++) g.fillRect(0, y * TILE, W, 1);
  }
  function drawGhost(g, gh) {
    if (!isFinite(gh.gx) || !isFinite(gh.gy)) return;
    var sp = getSprite(gh.id, gh.rot ? 1 : 0);
    if (!sp) return;
    var fp = fpOf({ id: gh.id, rot: gh.rot });
    var x = gh.gx * TILE, y = gh.gy * TILE, w = fp.w * TILE, h = fp.h * TILE;
    g.save();
    g.globalAlpha = 0.55;
    g.drawImage(sp, x, y);
    g.restore();
    if (gh.valid === false) {
      g.fillStyle = 'rgba(255,40,40,0.45)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#ff3b3b';
    } else {
      g.strokeStyle = '#9ff0a8';
    }
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /* ---------- 家具绘制 ---------- */
  function drawFurn(g, f, bo, t) {
    var sp = getSprite(f.id, f.rot ? 1 : 0);
    if (!sp) return;
    var x = f.x * TILE, y = f.y * TILE;
    g.drawImage(sp, x, y);
    if (!f.rot && !bo && DYN[f.id]) DYN[f.id](g, x, y, t);
  }

  /* ============================================================
   * 玩家 / 宠物 精灵（ctx 为世界坐标变换下的上下文；x,y 为精灵左上角逻辑像素）
   * ============================================================ */
  // 判断是否在移动：位置变化或有路径
  function isMoving(obj, t) {
    if (!motion) return !!(obj.path && obj.path.length);
    var m = motion.get(obj);
    if (!m) {
      m = { x: obj.x, y: obj.y, last: -99 };
      motion.set(obj, m);
    }
    if (obj.x !== m.x || obj.y !== m.y) {
      m.last = t;
      m.x = obj.x;
      m.y = obj.y;
    }
    return (t - m.last) < 0.2 || !!(obj.path && obj.path.length);
  }

  function drawPlayerSprite(g, p, t) {
    // p.x/p.y 是格中心；精灵以左上角绘制，需减去半格，人物才站在格子里（原先偏右下半格）
    var x = Math.round(p.x) - TILE / 2, y = Math.round(p.y) - TILE / 2;
    var dir = p.dir || 'down';
    var walk = isMoving(p, t);
    var f = walk ? Math.floor(t * 7) % 2 : 0;

    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,0.22)';                                  // 影子
    g.fillRect(x + 4, y + 15, 8, 1);

    // 腿（走路 2 帧交替）
    if (f === 0) {
      B(g, x + 5, y + 13, 3, 3, PANTS);
      B(g, x + 8, y + 13, 3, 3, PANTS);
    } else {
      B(g, x + 5, y + 12, 3, 3, PANTS);
      B(g, x + 8, y + 13, 3, 3, PANTS);
    }
    // 手臂（与腿反向摆动）
    var ayL = (walk && f === 1) ? 9 : 8;
    var ayR = (walk && f === 1) ? 8 : 9;
    B(g, x + 2, y + ayL, 2, 4, SHIRT);
    B(g, x + 12, y + ayR, 2, 4, SHIRT);
    // 身体
    B(g, x + 4, y + 8, 8, 5, SHIRT);
    // 头
    B(g, x + 4, y + 1, 8, 7, SKIN);
    if (dir === 'up') {
      R(g, x + 4, y + 2, 8, 5, HAIR);                                  // 背面：全是头发
    } else {
      R(g, x + 4, y + 2, 8, 2, HAIR);
      if (dir === 'left') {
        R(g, x + 4, y + 3, 3, 2, HAIR);
        R(g, x + 5, y + 5, 1, 2, OUT);
      } else if (dir === 'right') {
        R(g, x + 9, y + 3, 3, 2, HAIR);
        R(g, x + 10, y + 5, 1, 2, OUT);
      } else {
        R(g, x + 4, y + 3, 2, 1, HAIR);
        R(g, x + 10, y + 3, 2, 1, HAIR);
        R(g, x + 6, y + 5, 1, 2, OUT);
        R(g, x + 9, y + 5, 1, 2, OUT);
      }
    }

    // 使用中 / 打工中：头顶冒气泡（三点轮流闪）
    if (p.action || (G.state && G.state.work)) {
      var bx = x + 9, by = y - 8;
      B(g, bx, by, 9, 6, '#ffffff');
      var k = Math.floor(t * 3) % 3 + 1;
      for (var i = 0; i < k; i++) R(g, bx + 2 + i * 2, by + 2, 1, 2, '#5a6a80');
    }
    g.restore();
  }

  function drawZ(g, x, y, col) {
    var pat = [[1, 1, 1], [0, 1, 0], [1, 1, 1]];
    g.fillStyle = col;
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        if (pat[r][c]) g.fillRect(x + c, y + r, 1, 1);
      }
    }
  }

  function drawPetSprite(g, pet, t) {
    var cat = pet.type !== 'dog';
    var state = pet.state || 'idle';
    var col = cat ? '#c9b8a0' : '#c58a52';
    var dark = dk(col);
    var belly = cat ? '#f3ead8' : '#f3e2c4';
    var earC = cat ? '#e7a0a8' : '#7a4e2c';
    var nose = cat ? '#f08a9a' : OUT;
    // pet.x/pet.y 是格中心；精灵以左上角绘制，减去半格（与玩家一致）
    var x = Math.round(pet.x) - TILE / 2, y = Math.round(pet.y) - TILE / 2;
    var flip = pet.dir === 'left';
    var lying = state === 'sleep';
    var lift = state === 'play' ? Math.round(Math.abs(Math.sin(t * 6)) * 3) : 0;
    var headDy = state === 'eat' ? 2 + (Math.floor(t * 5) % 2) : 0;
    var walkF = state === 'walk' ? Math.floor(t * 8) % 2 : 0;
    var wag = state === 'play' ? 14 : 3;
    var tail = Math.round(Math.sin(t * wag) * 1);

    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,0.2)';                                   // 影子
    g.fillRect(x + 2, y + 15, 12, 1);
    g.translate(flip ? x + 16 : x, y - lift);
    if (flip) g.scale(-1, 1);

    if (lying) {
      R(g, 3, 14, 4, 1, dark);                                         // 爪子
      B(g, 2, 11, 12, 4, col);                                         // 身体
      R(g, 1, 12, 2, 1, col);                                          // 收起的尾巴
      B(g, 10, 8, 5, 5, col);                                          // 头
      R(g, 12, 10, 2, 1, OUT);                                         // 闭眼
      R(g, 14, 11, 1, 1, nose);
      if (!cat) R(g, 10, 7, 2, 2, earC);
    } else {
      // 腿（先画，身体盖住上端）
      if (walkF === 0) {
        R(g, 3, 12, 2, 4, dark);
        R(g, 9, 12, 2, 4, dark);
      } else {
        R(g, 4, 12, 2, 4, dark);
        R(g, 8, 12, 2, 4, dark);
      }
      // 尾巴：猫轻摆，狗快摆
      R(g, 2, 9, 1, 2, col);
      R(g, 1 + tail, 6, 1, 3, col);
      R(g, 1 + tail, 5, 1, 1, dark);
      // 身体
      B(g, 3, 8, 9, 5, col);
      R(g, 5, 11, 4, 1, belly);
      if (cat) {
        R(g, 5, 8, 1, 4, dark);                                        // 虎纹
        R(g, 8, 8, 1, 4, dark);
      } else {
        R(g, 4, 9, 2, 2, dark);                                        // 花斑
      }
      // 头
      var hy = 3 + headDy;
      B(g, 9, hy, 6, 6, col);
      if (cat) {
        R(g, 9, hy - 2, 2, 3, col);                                    // 尖耳
        R(g, 13, hy - 2, 2, 3, col);
        R(g, 10, hy - 1, 1, 1, earC);
      } else {
        R(g, 8, hy + 1, 2, 4, earC);                                   // 垂耳
        R(g, 13, hy + 1, 2, 4, earC);
      }
      R(g, 12, hy + 2, 1, 1, OUT);                                     // 眼
      R(g, 14, hy + 3, 1, 1, nose);                                    // 鼻
    }
    g.restore();

    // 睡觉：头顶飘 Z（不随翻转）
    if (lying) {
      var ph = (t * 0.8) % 1;
      var zx = flip ? x + 2 : x + 11;
      var zy = y - 2 - Math.floor(ph * 5);
      drawZ(g, zx, zy, 'rgba(120,140,200,' + (1 - ph * 0.6).toFixed(2) + ')');
      drawZ(g, zx - 3, zy - 4, 'rgba(120,140,200,' + (0.6 - ph * 0.3).toFixed(2) + ')');
    }
  }

  // 林小满：棕红长发（右侧发夹）、绿色店服上衣、奶白围裙、深蓝长裙；站街上待机（轻微起伏、偶尔眨眼）
  // x,y 为所在格的左上角（世界坐标）
  // 街上的人物（林小满 / 周慕白 / 程念）：look 决定发色、衣服、头发样式、腿部与配饰（见 config.js 的 G.NPCS.*.look）
  var LOOK_DEFAULT = { hair: '#8c4a3a', top: '#5aa88a', bottom: '#4a4f7a', hairStyle: 'long', legs: 'skirt', acc: 'apron' };
  function drawNpcSprite(g, x, y, t, bubble, look) {
    var L = look || LOOK_DEFAULT;
    var HAIR_N = L.hair, TOP_N = L.top, BOT_N = L.bottom;
    var APRON_N = '#f3e9d2', SHOE_N = '#3a2f2a', CLIP_N = '#f3d46b';
    var br = Math.floor((Math.sin(t * 2) + 1) / 2 * 1.99);     // 0/1 呼吸起伏
    var blink = (t % 3.4) < 0.12;
    var oy = y + br;
    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,0.22)';                           // 影子
    g.fillRect(x + 4, y + 15, 8, 1);
    R(g, x + 5, oy + 14, 2, 2, SHOE_N);                          // 鞋
    R(g, x + 9, oy + 14, 2, 2, SHOE_N);
    if (L.legs === 'skirt') {
      B(g, x + 4, oy + 10, 8, 5, BOT_N);                         // 长裙
    } else {
      R(g, x + 5, oy + 10, 3, 5, BOT_N);                         // 长裤
      R(g, x + 8, oy + 10, 3, 5, BOT_N);
    }
    if (L.acc === 'bag') B(g, x + 1, oy + 7, 3, 6, '#e0664f');   // 背包（背在身后）
    B(g, x + 2, oy + 8, 2, 4, TOP_N);                            // 手臂
    B(g, x + 12, oy + 8, 2, 4, TOP_N);
    B(g, x + 4, oy + 7, 8, 4, TOP_N);                            // 上衣
    if (L.acc === 'apron') {
      R(g, x + 5, oy + 9, 6, 4, APRON_N);                        // 围裙
      R(g, x + 5, oy + 9, 6, 1, dk(APRON_N));
    } else if (L.acc === 'tie') {
      R(g, x + 6, oy + 7, 4, 2, '#f5f5f5');                      // 白衬衫领口 + 红领带
      R(g, x + 7, oy + 8, 2, 4, '#b33a3a');
    }
    B(g, x + 4, oy + 1, 8, 7, SKIN);                             // 脸
    if (L.hairStyle === 'short') {
      R(g, x + 3, oy, 10, 3, HAIR_N);
      R(g, x + 3, oy + 2, 1, 2, HAIR_N);
      R(g, x + 12, oy + 2, 1, 2, HAIR_N);
    } else if (L.hairStyle === 'bob') {
      R(g, x + 3, oy, 10, 4, HAIR_N);                            // 齐肩短发
      R(g, x + 3, oy + 3, 2, 5, HAIR_N);
      R(g, x + 11, oy + 3, 2, 5, HAIR_N);
    } else {
      R(g, x + 3, oy, 10, 3, HAIR_N);                            // 刘海与头顶
      R(g, x + 5, oy + 3, 6, 1, HAIR_N);
      R(g, x + 3, oy + 3, 2, 7, HAIR_N);                         // 长发垂肩
      R(g, x + 11, oy + 3, 2, 7, HAIR_N);
      R(g, x + 10, oy + 1, 2, 1, CLIP_N);                        // 发夹
    }
    if (blink) {
      R(g, x + 6, oy + 6, 1, 1, OUT);
      R(g, x + 9, oy + 6, 1, 1, OUT);
    } else {
      R(g, x + 6, oy + 5, 1, 2, OUT);
      R(g, x + 9, oy + 5, 1, 2, OUT);
    }
    R(g, x + 7, oy + 7, 2, 1, '#e08a7a');                        // 小嘴
    if (bubble) {                                                // 有未读事件：头顶「!」
      var bx = x + 9, by = y - 8;
      B(g, bx, by, 5, 7, '#ffffff');
      R(g, bx + 2, by + 1, 1, 3, '#e0664f');
      R(g, bx + 2, by + 5, 1, 1, '#e0664f');
    }
    g.restore();
  }

  /* ============================================================
   * 对外接口
   * ============================================================ */
  G.render.drawNpcSprite = drawNpcSprite;      // 给面板头像用（ctx、x、y、t、bubble、look）
  G.render.ghost = G.render.ghost || null;

  G.render.init = function (cv) {
    canvas = cv;
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    G.render.resize();
    if (!resizeHooked) {
      resizeHooked = true;
      window.addEventListener('resize', function () { G.render.resize(); });
    }
  };

  G.render.resize = function () {
    if (!canvas) return;
    var street = isStreet();
    var dims = sceneDims();
    var cw = Math.max(1, window.innerWidth || canvas.clientWidth || 800);
    var ch = Math.max(1, window.innerHeight || canvas.clientHeight || 600);
    dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));

    // 整数缩放：能放下的最大倍数，不超过 G.SCALE（可被外部覆盖）。室内带外圈墙，外景只有地图本身
    var outW = street ? dims.w * TILE : (dims.w + 2) * TILE;
    var outH = street ? dims.h * TILE : (dims.h + 3) * TILE;
    var fit = Math.floor(Math.min((cw - 24) / outW, (ch - 24) / outH));
    var cap = Math.max(1, Math.floor(G.SCALE || 3));
    scale = Math.max(1, Math.min(fit, cap));
    K = scale * dpr;

    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    var ox, oy;
    if (street) {
      // 外景地图整体居中
      ox = Math.round(cw / 2 - (outW / 2) * scale);
      oy = Math.round(ch / 2 - (outH / 2) * scale);
    } else {
      // 让「外圈墙 + 室内」整体居中
      ox = Math.round(cw / 2 - (dims.w * TILE / 2) * scale);
      oy = Math.round(ch / 2 - ((dims.h - 1) * TILE / 2) * scale);
    }
    G.view = {
      cx: ox,
      ox: ox,
      oy: oy,
      w: dims.w * TILE * scale,
      h: dims.h * TILE * scale,
      scale: scale
    };
    viewKey = sceneKey();
  };

  // 外景地图比屏幕宽（手机竖屏）时横向跟随玩家；放得下时保持居中（cx 为居中时的 ox）
  function updateCamera(v, dims, st) {
    var cssW = canvas.width / dpr;
    var mapW = dims.w * TILE * v.scale;
    if (mapW <= cssW || !st.player) { v.ox = v.cx; return; }
    var px = Number(st.player.x) || 0;
    v.ox = Math.round(G.clamp(cssW / 2 - px * v.scale, cssW - mapW, 0));
  }

  G.render.draw = function (dt) {
    if (!canvas || !ctx) return;
    dt = clampDt(dt);
    tick += dt;

    var street = isStreet();
    var room = roomDef();
    if (sceneKey() !== viewKey || !G.view) G.render.resize();

    var g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = BG;
    g.fillRect(0, 0, canvas.width, canvas.height);

    var st = G.state;
    if (!st || !G.view) return;

    var dims = street ? G.STREET : room;
    if (!street) ensureStatic(room);
    var v = G.view;
    if (street) updateCamera(v, dims, st);
    g.setTransform(K, 0, 0, K, Math.round(v.ox * dpr), Math.round(v.oy * dpr));

    var W = dims.w * TILE, H = dims.h * TILE;
    var n = nightness(Number(st.time) || 0);
    var bo = !street && !!(st.flags && st.flags.blackout > 0);
    var furn = !street && Array.isArray(st.furniture) ? st.furniture : [];

    // 1. 墙 + 地板（外景：草地/人行道/马路/建筑/树）
    if (street) {
      ensureStreetStatic(seasonOf(st), st.weather === 'snow');
      g.drawImage(streetCv, 0, 0);
    } else {
      g.drawImage(staticCv, -TILE, -2 * TILE);
      // 2. 窗户
      drawWindow(g, room, st, n);
    }

    // 3. 地毯（可走，最底层）
    var list = [];
    for (var i = 0; i < furn.length; i++) {
      var f = furn[i];
      var d = f && G.FURNITURE && G.FURNITURE[f.id];
      if (!d) continue;
      if (d.walkable) {
        drawFurn(g, f, bo, tick);
        continue;
      }
      list.push({ y: (f.y + fpOf(f).h) * TILE, f: f });
    }
    // 4. 建造网格
    if (st.buildMode && !street) drawGrid(g, room);

    // 5. 家具 + 玩家 + 宠物 按底边 y 排序（外景不显示宠物，宠物留在家里）
    var pl = st.player;
    if (pl && typeof pl.x === 'number') list.push({ y: pl.y + TILE, p: pl });
    var pet = street ? null : st.pet;
    if (pet && typeof pet.x === 'number') list.push({ y: pet.y + TILE, pet: pet });
    if (street && G.npc && G.npc.visibleIds) {                   // 街上的 NPC（各自的出现时段内）
      G.npc.visibleIds().forEach(function (id) {
        var ns = G.npc.spot(id);
        var look = G.NPCS && G.NPCS[id] ? G.NPCS[id].look : null;
        list.push({ y: (ns.gy + 1) * TILE, npc: { x: ns.gx * TILE, y: ns.gy * TILE, bubble: G.npc.hasPending(id), look: look } });
      });
    }
    list.sort(function (a, b) { return a.y - b.y; });
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      if (e.f) drawFurn(g, e.f, bo, tick);
      else if (e.p) drawPlayerSprite(g, e.p, tick);
      else if (e.pet) drawPetSprite(g, e.pet, tick);
      else if (e.npc) drawNpcSprite(g, e.npc.x, e.npc.y, tick, e.npc.bubble, e.npc.look);
    }

    // 6. 天气粒子
    stepParticles(g, dims, st.weather, dt);

    // 7. 昼夜暗色滤镜（室内停电时额外变暗）
    var a = Math.min(0.85, 0.55 * n + (bo ? 0.3 : 0));
    if (a > 0.01) {
      g.fillStyle = 'rgba(12,18,52,' + a.toFixed(3) + ')';
      if (street) g.fillRect(0, 0, W, H);
      else g.fillRect(-TILE, -2 * TILE, W + 2 * TILE, H + 3 * TILE);
    }
    // 8. 灯光（停电时无光）
    if (!bo && n > 0.05) {
      if (street) drawStreetLights(g, n);
      else drawLights(g, furn, n);
    }

    // 9. 建造预览与选中框（不被夜色压暗；外景没有建造）
    var gh = G.render.ghost;
    if (!street && gh && G.FURNITURE && G.FURNITURE[gh.id]) drawGhost(g, gh);
    if (st.selected) {
      for (var s = 0; s < furn.length; s++) {
        var sf = furn[s];
        if (!sf || sf.uid !== st.selected) continue;
        var sfp = fpOf(sf);
        var pulse = 0.55 + 0.45 * Math.sin(tick * 6);
        g.strokeStyle = 'rgba(255,209,102,' + pulse.toFixed(2) + ')';
        g.lineWidth = 1;
        g.strokeRect(sf.x * TILE + 0.5, sf.y * TILE + 0.5, sfp.w * TILE - 1, sfp.h * TILE - 1);
        break;
      }
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
  };

  G.render.screenToTile = function (sx, sy) {
    var v = G.view;
    if (!v || !v.scale) return null;
    var d = sceneDims();
    var gx = Math.floor((sx - v.ox) / (TILE * v.scale));
    var gy = Math.floor((sy - v.oy) / (TILE * v.scale));
    if (!(gx >= 0 && gy >= 0 && gx < d.w && gy < d.h)) return null;
    return { gx: gx, gy: gy };
  };

  // 不做越界判断的格坐标（室内的门开在墙上，需要能点到格外一行）
  G.render.screenToCell = function (sx, sy) {
    var v = G.view;
    if (!v || !v.scale) return null;
    return {
      gx: Math.floor((sx - v.ox) / (TILE * v.scale)),
      gy: Math.floor((sy - v.oy) / (TILE * v.scale))
    };
  };

  G.render.drawFurnitureIcon = function (g, id, x, y, size) {
    if (!g || !G.FURNITURE || !G.FURNITURE[id]) return;
    var sp = getSprite(id, 0);
    if (!sp) return;
    var sw = sp.width, sh = sp.height;
    var s = Math.min(size / sw, size / sh);
    if (s >= 1) s = Math.floor(s);
    var dw = Math.round(sw * s), dh = Math.round(sh * s);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(sp, Math.round(x + (size - dw) / 2), Math.round(y + (size - dh) / 2), dw, dh);
    g.restore();
  };

  G.render.drawPlayer = function (g, p, t) {
    if (!g || !p || typeof p.x !== 'number') return;
    drawPlayerSprite(g, p, typeof t === 'number' ? t : tick);
  };

  G.render.drawPet = function (g, pet, t) {
    if (!g || !pet || typeof pet.x !== 'number') return;
    drawPetSprite(g, pet, typeof t === 'number' ? t : tick);
  };
})();
