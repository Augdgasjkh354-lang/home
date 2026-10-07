/* ============================================================
 * 像素小家 Pixel Home —— 共享契约（所有模块必须遵守）
 * 全局命名空间：window.G
 * 每个模块文件只做一件事：往 G 上挂自己的对象，不得修改别人的文件。
 * 脚本加载顺序：config → render → player → pet → economy → street → ui → main
 * 画面：俯视角，Canvas 2D，纯代码绘制像素图（不使用任何外部图片）
 * ============================================================ */
window.G = window.G || {};

G.TILE = 16;            // 一个格子 16 像素（逻辑像素）
G.SCALE = 3;            // 屏幕放大倍数（整数缩放，关闭抗锯齿）
G.MAX_W = 14;           // 房间最大宽(格)
G.MAX_H = 10;           // 房间最大高(格)

/* ---------- 房间等级（房间升级） ---------- */
// w,h = 室内可用格子数；墙在格子外圈由 render 绘制
G.ROOMS = [
  { id: 0, name: '出租小屋', w: 6,  h: 5,  cost: 0,    rent: 20 },
  { id: 1, name: '温馨一居', w: 8,  h: 6,  cost: 600,  rent: 0 },
  { id: 2, name: '宽敞两居', w: 11, h: 8,  cost: 2000, rent: 0 },
  { id: 3, name: '小别墅',   w: 14, h: 10, cost: 6000, rent: 0 },
];

/* ---------- 家具目录 ----------
 * w,h: 占格(格)；price: 价格；
 * kind: 'bed'|'food'|'fun'|'work'|'wash'|'deco'|'pet'|'storage'
 * use: 玩家使用后的效果（每秒或一次性），见 player.js
 *   effect = { energy, hunger, mood, hygiene, money }  数值为"每次使用的总变化"
 *   duration: 使用耗时(游戏内秒，真实秒=duration/ G.TIME_SCALE 不用管，直接用真实秒)
 * style: 给 render 用的绘制提示 {c1,c2,c3} 三个主色，render 自行绘制像素造型
 */
G.FURNITURE = {
  bed_single: { name:'单人床',   w:2,h:3, price:0,   kind:'bed',  style:{c1:'#6b8cc7',c2:'#e8e2d0',c3:'#8a5a3b'}, use:{duration:8, effect:{energy:+70, mood:+5}} },
  bed_double: { name:'双人床',   w:3,h:3, price:500, kind:'bed',  style:{c1:'#d77a8c',c2:'#f5ecdc',c3:'#6a4630'}, use:{duration:6, effect:{energy:+90, mood:+12}} },
  table:      { name:'餐桌',     w:2,h:2, price:0,   kind:'food', style:{c1:'#b98a56',c2:'#e6d3a8',c3:'#7a5530'}, use:{duration:5, effect:{hunger:+45, mood:+3}, cost:8} },
  fridge:     { name:'冰箱',     w:1,h:2, price:150, kind:'food', style:{c1:'#dfe7ec',c2:'#9fb2bf',c3:'#5d6e7a'}, use:{duration:3, effect:{hunger:+25}, cost:4} },
  stove:      { name:'灶台',     w:2,h:1, price:260, kind:'food', style:{c1:'#a8a8a8',c2:'#4a4a4a',c3:'#e0662a'}, use:{duration:6, effect:{hunger:+65, mood:+8}, cost:10} },
  desk_pc:    { name:'电脑桌',   w:2,h:2, price:0,   kind:'work', style:{c1:'#8a6a45',c2:'#2c3e50',c3:'#5ac8fa'}, use:{duration:10, effect:{energy:-18, hunger:-12, mood:-4, money:+35}} },
  sofa:       { name:'沙发',     w:3,h:1, price:220, kind:'fun',  style:{c1:'#5aa088',c2:'#3b7a63',c3:'#d9c9a3'}, use:{duration:6, effect:{mood:+18, energy:+8}} },
  tv:         { name:'电视',     w:2,h:1, price:320, kind:'fun',  style:{c1:'#222',c2:'#5f8fd0',c3:'#444'},       use:{duration:7, effect:{mood:+30, energy:-3}} },
  bookshelf:  { name:'书架',     w:2,h:1, price:120, kind:'fun',  style:{c1:'#9c6b3f',c2:'#d65f5f',c3:'#4f8fd6'}, use:{duration:6, effect:{mood:+14}} },
  shower:     { name:'淋浴间',   w:1,h:2, price:180, kind:'wash', style:{c1:'#bfe3ee',c2:'#7fb8cc',c3:'#ffffff'}, use:{duration:4, effect:{hygiene:+80, mood:+4}} },
  toilet:     { name:'马桶',     w:1,h:1, price:90,  kind:'wash', style:{c1:'#f0f0f0',c2:'#c8c8c8',c3:'#999'},    use:{duration:2, effect:{hygiene:+10}} },
  plant:      { name:'绿植',     w:1,h:1, price:40,  kind:'deco', style:{c1:'#4fae5a',c2:'#2f7d3a',c3:'#b5683a'}, mood_aura:2 },
  rug:        { name:'小地毯',   w:3,h:2, price:70,  kind:'deco', style:{c1:'#e0a458',c2:'#c9803a',c3:'#f3d9a8'}, mood_aura:2, walkable:true },
  lamp:       { name:'落地灯',   w:1,h:1, price:60,  kind:'deco', style:{c1:'#ffd98a',c2:'#8a6a45',c3:'#fff3c4'}, mood_aura:1, light:true },
  painting:   { name:'挂画',     w:2,h:1, price:80,  kind:'deco', style:{c1:'#6f8fd0',c2:'#e8c872',c3:'#8a5a3b'}, mood_aura:3, wallItem:true },
  pet_bed:    { name:'宠物窝',   w:1,h:1, price:50,  kind:'pet',  style:{c1:'#c9803a',c2:'#e8c8a0',c3:'#7a5530'} },
  pet_bowl:   { name:'宠物碗',   w:1,h:1, price:20,  kind:'pet',  style:{c1:'#d65f5f',c2:'#e8e2d0',c3:'#a8a8a8'} },
};
G.STARTER_FURNITURE = [ // 开局赠送并已摆好的家具 {id,x,y,rot}
  { id:'bed_single', x:0, y:0 },
  { id:'table',      x:3, y:0 },
  { id:'desk_pc',    x:4, y:3 },
];

/* ---------- 宠物 ---------- */
G.PETS = {
  cat: { name:'小猫', price:150 },
  dog: { name:'小狗', price:200 },
};

/* ---------- 时间 ---------- */
// 游戏内 1 天 = 真实 240 秒；24 小时制；一年 4 季，每季 7 天
G.DAY_SECONDS = 240;
G.SEASON_DAYS = 7;
G.SEASONS = ['春','夏','秋','冬'];

/* ---------- 需求（0~100） ---------- */
G.NEEDS = ['energy','hunger','mood','hygiene'];
G.NEED_LABEL = { energy:'精力', hunger:'饱腹', mood:'心情', hygiene:'清洁' };
G.NEED_DECAY = { energy:0.25, hunger:0.30, mood:0.12, hygiene:0.18 }; // 每真实秒下降

/* ---------- 门口外景（街道） ----------
 * 格坐标同室内（左上角 (0,0)）。建筑、树占格不可走；人行道、马路、草地可走。
 * 行划分：0 草地 | 1~3 建筑 | 4 人行道 | 5~7 马路 | 8 人行道 | 9 草地
 * home：自家小屋（点它回室内）；door 在建筑底排，门口一格 (door.gx, door.gy+1) 可走。
 * shop：汉堡店占位（预留空地，本步只画外观；点击只提示「还在装修」）；sign 为招牌左上格。
 * spawn：从室内出门后玩家出现的格（自家门口）。
 * trees：不可走的装饰树（单格）。
 */
G.STREET = {
  w: 16, h: 10,
  home: { x: 2,  y: 1, w: 4, h: 3, door: { gx: 3,  gy: 3 } },
  shop: { x: 10, y: 1, w: 4, h: 3, door: { gx: 11, gy: 3 }, sign: { gx: 10, gy: 1 } },
  spawn: { gx: 3, gy: 4 },
  trees: [
    { gx: 0,  gy: 0 }, { gx: 6,  gy: 0 }, { gx: 15, gy: 0 },
    { gx: 0,  gy: 2 }, { gx: 8,  gy: 2 }, { gx: 15, gy: 2 },
    { gx: 5,  gy: 9 }, { gx: 12, gy: 9 },
  ],
};

// 室内门：开在底墙（格外一行），x 取房间宽的一半；门口一格是室内可走格
G.homeDoor = function (room) { return { gx: Math.floor(room.w / 2), gy: room.h }; };
G.homeDoorFront = function (room) { var d = G.homeDoor(room); return { gx: d.gx, gy: d.gy - 1 }; };

/* ============================================================
 *  全局状态（唯一真相源）  —— main.js 初始化，所有模块读写
 * ============================================================
 * G.state = {
 *   money: 300,
 *   day: 1,                // 第几天
 *   time: 8.0,             // 0~24 小时（浮点）
 *   season: 0,             // 0~3
 *   weather: 'sunny',      // 'sunny'|'rain'|'snow'|'cloudy'
 *   roomLevel: 0,
 *   furniture: [ {uid, id, x, y, rot:0|1} ... ],   // x,y 为左上角格坐标；rot=1 表示 w/h 互换
 *   needs: { energy:80, hunger:70, mood:70, hygiene:80 },
 *   player: { x, y, dir:'down', action:null, path:[], busy:0 },   // x,y 为像素浮点坐标(逻辑像素,非屏幕像素)
 *   pet: null | { type:'cat'|'dog', name, x, y, dir, state:'idle'|'walk'|'sleep'|'eat'|'play', timer:0, hunger:70, bond:0 },
 *   log: [],               // 最近消息字符串
 *   paused: false,
 *   buildMode: false,
 *   selected: null,        // 选中的家具 uid
 *   scene: 'home',         // 'home'|'street'：室内 / 门口外景（外景时家具与宠物不参与）
 * }
 * 坐标约定：格坐标 (gx,gy) 对应室内左上角为(0,0)。
 * 像素坐标 = 格坐标*G.TILE。render 画室内时整体加上 (G.view.ox, G.view.oy) 偏移（外圈墙厚度1格）。
 *
 * ============================================================
 *  各模块必须实现的接口（挂在 G 上）
 * ============================================================
 * 【render.js】 G.render
 *   G.render.init(canvas)                     创建 ctx、关闭抗锯齿、设置 G.view={ox,oy,w,h}
 *   G.render.resize()                         按窗口重算缩放并居中，更新 G.view
 *   G.render.draw(dt)                         画一整帧：地板/墙/窗(随季节天气昼夜)/家具(按y排序)/宠物/玩家/
 *                                              天气粒子(雨雪)/昼夜暗色滤镜+灯光/建造模式网格与幽灵家具
 *   G.render.screenToTile(sx,sy) -> {gx,gy} | null   屏幕坐标转室内格坐标
 *   G.render.drawFurnitureIcon(ctx, id, x, y, size)  在任意 ctx 画家具缩略图（给商店UI用）
 *   G.render.ghost = { id, gx, gy, rot, valid }|null  建造模式预览（ui.js 设置，render 绘制，valid=false 画红色）
 *   render 负责 player/pet 的像素精灵绘制：函数 G.render.drawPlayer(ctx,p,t)、G.render.drawPet(ctx,pet,t)
 *
 * 【player.js】 G.player
 *   G.player.init()                           初始化 G.state.player 位置到室内空位
 *   G.player.update(dt)                       需求衰减、移动沿 path 前进、到达后执行使用家具(倒计时 duration，结算 effect)
 *   G.player.moveTo(gx,gy)                    A* 寻路到某格（家具占用格不可走，rug 等 walkable 可走）
 *   G.player.useFurniture(uid)                走到家具旁边可交互的格子，然后使用；成功使用后调用 G.economy.applyUse(furn,use)
 *   G.player.isBlocked(gx,gy) -> bool         该格是否被不可走家具占用或越界
 *   G.player.furnitureAt(gx,gy) -> furn|null  取该格上的家具
 *   needs 任一为0时：对应负面效果（mood 额外下降等），并写 G.log('...')
 *
 * 【pet.js】 G.petAI
 *   G.petAI.adopt(type)                       领养，放在室内空格
 *   G.petAI.update(dt)                        随机游走、饿了去 pet_bowl(若有)、困了去 pet_bed 睡觉、偶尔靠近玩家；
 *                                              pet.hunger 衰减；bond 随玩家抚摸/喂食增加
 *   G.petAI.pat()                             抚摸宠物：mood+，bond+，写 G.log
 *   G.petAI.feed()                            喂食（花 3 元）：hunger 回满
 *   G.petAI.petAt(gx,gy) -> bool              该格是否点到了宠物（点击检测）
 *
 * 【economy.js】 G.economy 与 G.events 与 G.saveload
 *   G.economy.applyUse(furn, use)             结算使用效果：改 needs(夹到0~100)，money 加减(use.effect.money/use.cost)，
 *                                              desk_pc 收入随 roomLevel 与家具 mood_aura 加成
 *   G.economy.canAfford(n) / G.economy.spend(n) / G.economy.earn(n)
 *   G.economy.buy(id) -> {ok, reason}         买家具：扣钱，并返回 ok；放置由 ui 建造模式完成
 *   G.economy.place(id,gx,gy,rot) -> {ok,reason}   合法性检查(越界/重叠/墙饰品必须贴上墙行y=0) 并加入 state.furniture
 *   G.economy.remove(uid)                     回收家具，退还 50% 价格
 *   G.economy.upgradeRoom() -> {ok,reason}    升级房间（花费 G.ROOMS[level+1].cost），已有家具保持原格坐标
 *   G.economy.auraBonus() -> number           所有 deco 的 mood_aura 之和（给 mood 缓慢回升用）
 *   G.economy.tick(dt)                        每帧：时间推进(time/day/season)、每日结算(第1天起每7天交房租，仅 level0)、天气随机切换(随季节)
 *   G.events.update(dt)                       随机事件：快递(得小钱)、朋友来访(mood+)、停电(夜晚变暗且电脑不可用60秒)、
 *                                              捡到钱、小偷未遂 等；每个事件写 G.log 并可弹 G.ui.toast
 *   G.saveload.save() / load() -> bool / reset()   localStorage 键 'pixel-home-save-v1'，每 20 秒自动保存
 *
 * 【ui.js】 G.ui
 *   G.ui.init()                               创建 DOM HUD（不要改 index.html 已有结构，往 #hud #panel #toast 里插内容）
 *   G.ui.update(dt)                           刷新数值条、日期时间、金钱、季节天气图标
 *   G.ui.toast(msg)                           顶部浮动提示（2.5 秒消失，可叠加）
 *   G.ui.openShop()/closeShop()               商店面板：家具列表带缩略图(用G.render.drawFurnitureIcon)、价格、宠物领养、房间升级按钮
 *   G.ui.startPlace(id)                       进入建造模式，选好位置点击放置；R 键旋转；ESC 取消；再次点击已摆家具可选中→回收/移动
 *   G.ui.onCanvasClick(sx,sy)                 点击：建造模式则放置；否则点家具=使用；点宠物=抚摸；点空地=移动
 *   G.ui.onCanvasMove(sx,sy)                  悬停：建造模式更新 G.render.ghost
 *   键盘：B 商店，R 旋转，ESC 取消，空格暂停
 *
 * 【main.js】（由主 agent 编写，不要写）
 *   画布事件绑定、主循环 requestAnimationFrame、调用各模块 update/draw、启动存档加载。
 *
 * 通用要求：
 *  - 纯原生 JS（ES2018），不用任何外部库/图片/字体 CDN；中文界面。
 *  - 每个文件顶部用 IIFE 包裹，只暴露在 G 上；不要污染其他全局变量。
 *  - 访问别的模块的函数前先判断存在（例如 G.petAI && G.petAI.update），避免加载顺序问题。
 *  - 日志函数：G.log(msg) 由 config.js 提供（见下）。
 *  - 像素风：配色柔和温暖、深色描边、2~3 级阴影；字体用 'monospace'。
 */

G.log = function (msg) {
  if (!G.state) return;
  G.state.log.push(msg);
  if (G.state.log.length > 30) G.state.log.shift();
  if (G.ui && G.ui.toast) G.ui.toast(msg);
};

G.uid = (function () { let n = 1; return function () { return 'f' + (n++) + '_' + Math.floor(Math.random()*1e6); }; })();

G.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

G.footprint = function (f) { // 家具实际占格宽高（考虑旋转）
  const d = G.FURNITURE[f.id];
  return f.rot ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
};

G.newState = function () {
  return {
    money: 300, day: 1, time: 8.0, season: 0, weather: 'sunny', roomLevel: 0,
    furniture: G.STARTER_FURNITURE.map(f => ({ uid: G.uid(), id: f.id, x: f.x, y: f.y, rot: 0 })),
    needs: { energy: 80, hunger: 70, mood: 70, hygiene: 80 },
    player: { x: 2 * G.TILE, y: 4 * G.TILE, dir: 'down', action: null, path: [], busy: 0 },
    pet: null, log: [], paused: false, buildMode: false, selected: null,
    flags: { blackout: 0 },
    scene: 'home',
  };
};
