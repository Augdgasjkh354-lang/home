/* ============================================================
 * 像素小家 Pixel Home —— 共享契约（所有模块必须遵守）
 * 全局命名空间：window.G
 * 每个模块文件只做一件事：往 G 上挂自己的对象，不得修改别人的文件。
 * 脚本加载顺序：config → render → player → pet → economy → street → npc-data → npc → burger → skills → ui → main
 * 画面：俯视角，Canvas 2D，纯代码绘制像素图（不使用任何外部图片）
 *
 * 【模块注册】新模块想要存档字段，不必改 economy.js：
 *   G.registerModule({ id:'stocks', defaults: function(){ return {...}; } })
 *   之后 G.state[id] 由 newState 生成；读档时 economy 的 mergeState 按 defaults 深度补齐缺失字段（旧档兼容）。
 *   若模块对象 G[id] 上有 update(dt)，main.js 每帧（未暂停时）调用它。
 * 【电脑菜单】G.pcMenu = [ {id,label,desc?,when?(ctx)->bool,onClick(ctx)} ]，点电脑桌时渲染；
 *   ctx = { uid } 为电脑桌的家具 uid。其他模块可 G.pcMenu.push(...) 追加。
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
 * shop：汉堡店（点门走到店门前开面板，见 burger.js）；sign 为招牌左上格。
 * cardroom：牌场（右侧，夜里霓虹亮灯）；点门走到门前，由 G.cardroom.enter() 接管（内容在 cardroom.js，未实现时提示「牌场还没开张」）。
 * spawn：从室内出门后玩家出现的格（自家门口）。
 * trees：不可走的装饰树（单格）。
 */
G.STREET = {
  w: 24, h: 10,
  home: { x: 2,  y: 1, w: 4, h: 3, door: { gx: 3,  gy: 3 } },
  hall: { x: 6,  y: 0, w: 5, h: 4, door: { gx: 8,  gy: 3 } },          // 市政厅（石质大楼，白天 9~17 点办公，见 city.js）
  shop: { x: 12, y: 1, w: 4, h: 3, door: { gx: 13, gy: 3 }, sign: { gx: 12, gy: 1 } },
  cardroom: { x: 17, y: 1, w: 4, h: 3, door: { gx: 18, gy: 3 }, sign: { gx: 17, gy: 1 } },
  corner: { x: 21, y: 1, w: 3, h: 3 },                                  // 街角小公园（可走，装饰；科技女生傍晚在旁边的长椅）
  props: [                                                              // 街边道具（不可走）
    { kind: 'bench', gx: 21, gy: 4 },
    { kind: 'lamp',  gx: 23, gy: 4 },
  ],
  spawn: { gx: 3, gy: 4 },
  trees: [
    { gx: 0,  gy: 0 }, { gx: 5,  gy: 0 }, { gx: 11, gy: 0 }, { gx: 16, gy: 0 }, { gx: 23, gy: 1 },
    { gx: 0,  gy: 2 }, { gx: 16, gy: 2 },
    { gx: 5,  gy: 9 }, { gx: 12, gy: 9 }, { gx: 19, gy: 9 },
  ],
};

/* ---------- 城市（文案常量；指数与项目数据在 js/city-data.js，逻辑在 js/city.js） ---------- */
G.CITY = {
  name: '奥特兰迪斯',
  slogan: '这座城市不缺钱，缺的是把钱花在人身上的人。',
  intro: '霓虹与港口之城。商会说了算，帮派管街头，市政厅的灯每晚都亮着，却没人知道灯为谁而亮。你刚搬回来，房租还欠着，朋友却比你想象的多。',
  districts: { port: '东港码头', old: '旧城区', bank: '金融街', south: '城南选区', north: '城北居民区' },
  hall: '奥特兰迪斯市政厅',
  hallHours: '9:00 ~ 17:00 办公',
};

/* ---------- 牌场（外景店门 G.STREET.cardroom.door，见 street.js） ----------
 * 营业：open 到 close 之间，close 可以超过 24 表示次日（14:00 ~ 次日 06:00）。
 * 内容（德州扑克等）由后续模块 js/cardroom.js 提供：G.cardroom.enter()。 */
G.CARDROOM = { open: 14, close: 30 };
G.isCardroomOpen = function (t) {
  var C = G.CARDROOM;
  t = ((Number(t) || 0) % 24 + 24) % 24;
  if (C.close > 24) return t >= C.open || t < C.close - 24;
  return t >= C.open && t < C.close;
};

/* ---------- 汉堡店「林记汉堡」（外景店门 G.STREET.shop.door，见 burger.js） ----------
 * 营业：游戏内 open 点到 close 点之间；打烊时只能看菜单，不能买、不能打工。
 * menu.effect：购买后立即结算到需求（经 G.economy.applyUse，夹到 0~100）。
 * shift：兼职「打工一班」——真实时间 duration 秒，结束时结算 cost 与 pay。
 *   pay 会乘上林小满的加成（好感 >= NPCS.lin.limits.shiftBonusAt 时 +shiftBonus）。 */
G.BURGER = {
  name: '林记汉堡',
  open: 8,
  close: 22,
  menu: [
    { id: 'small',  name: '小汉堡',         price: 8,  effect: { hunger: 35 },                        desc: '饱腹+35' },
    { id: 'cheese', name: '芝士汉堡',       price: 14, effect: { hunger: 55, mood: 4 },               desc: '饱腹+55 心情+4' },
    { id: 'set',    name: '套餐（含饮料）', price: 22, effect: { hunger: 70, mood: 8, energy: 5 },    desc: '饱腹+70 心情+8 精力+5' },
  ],
  shift: {
    duration: 12,                                     // 真实秒
    pay: 45,                                          // 工资（元）
    cost: { energy: -20, hunger: -12, mood: -3 },     // 结束时的需求变化
    minEnergy: 25,                                    // 低于此值不能接班
    minHunger: 20,
    maxPerDay: 3,                                     // 每个游戏日最多几班
  },
};

/* ---------- NPC（三位）：林小满 / 市政厅议员 周慕白 / 科技女生 程念 ----------
 * 人设只放这里；对话、故事、事件文案在 js/npc-data.js（林小满）与 js/npc-data2.js（周慕白、程念），交互在 js/npc.js。
 * 通用字段：spot 站位格；hours 街上出现的时段；startAffinity 开局好感；look 像素造型；gifts 送礼清单（林小满用汉堡菜单）。
 * spot：白天营业时站在街上的格子（人行道，紧挨店门口的右侧）；夜里不在街上。
 * limits：每天有效聊天次数、送礼次数、好感几天不见开始衰减、打工加成门槛。 */
G.NPCS = {
  lin: {
    id: 'lin',
    name: '林小满',
    age: 22,
    job: '林记汉堡店员（店主林国栋的女儿）',
    family: '父亲林国栋开这家店十五年了，汉堡的做法是他一手教的。她小时候每天放学就躲在柜台底下写作业，抬头就能看见爸爸翻肉饼。',
    background: '大学读的是视觉设计，画了三年插画，老师夸过她的线条。毕业后说“先回来帮几个月”，结果一待就是两年，画笔也渐渐收进了抽屉。',
    personality: '嘴硬心软，说话直来直去，被夸了就转移话题。爱用“行吧”“哎呀”，偶尔冒一句冷笑话。对客人凶巴巴的，但会偷偷多给熟客加一片生菜。',
    catchphrase: '行吧，那就这样。',
    hobbies: ['在菜单背面画速写（画客人，从不给人看）', '翻老唱片，店里常放八十年代的爵士', '收集供应商送的贴纸'],
    flaw: '答应别人的事总拖到最后一刻；心情不好时会把抹布摔得很响。',
    secret: '偷偷报了外地的插画研修班，学费是这两年攒下的。录取通知压在抽屉最底下，还没敢告诉爸爸。',
    favorite: 'cheese',                       // 最爱的口味：送这个额外 +3 好感
    spot: { gx: 15, gy: 4 },
    hours: { from: 8, to: 22 },               // 白天营业时在街上（与汉堡店营业时间一致）
    startAffinity: 10,
    look: { hair: '#8c4a3a', top: '#5aa88a', bottom: '#4a4f7a', hairStyle: 'long', legs: 'skirt', acc: 'apron' },
    limits: {
      chatPerDay: 2,                          // 每天有效聊天次数
      giftPerDay: 1,                          // 每天送礼次数
      decayAfterDays: 3,                      // 超过这么多天没去看她，之后每天 -1（不跨阶段）
      shiftBonusAt: 60,                       // 好感达到此值，打工工资 +10%
      shiftBonus: 0.1,
    },
  },

  /* 市政厅议员：玩家的朋友。白天 9~17 点在市政厅门口；面板即「市政厅面板」（指数、项目、对话、礼物）。
   * 文案在 npc-data2.js；提案与项目在 city.js。 */
  mayor: {
    id: 'mayor',
    name: '周慕白',
    title: '市政厅 · 周慕白',
    gender: '男',
    age: 43,
    job: '奥特兰迪斯市议会议员（城南选区）',
    family: '父亲周德海是东港码头的搬运工。十几年前一次吊钩事故后，赔偿拖了三个月，最后只领到一句“以后小心点”。他十二岁就在码头边的木箱上等过父亲下工。',
    background: '靠奖学金读完法学院，回城做了几年律师，专替码头工人和小商户打官司，赢过几次，也输过更多次。三年前被城南的选民推上议会，理由很简单：“他说话像个人。”',
    personality: '说话慢，爱打比方，习惯把一件事拆成三件。有原则，也懂得变通；固执起来像码头的老石头。被人说“理想主义”会沉默一会儿，然后认真反驳。',
    catchphrase: '先别急，咱们先算算账。',
    hobbies: ['收集旧城的老地图，说“旧图纸能看出这座城是怎么烂掉的”', '周末去东港钓鱼，钓不到也坐一下午', '下象棋，常输给林小满的汉堡（他承认是输给了饭）'],
    flaw: '总想“一步一步来”，决定一拖再拖；嘴上不认错，却会悄悄把错改掉。',
    secret: '竞选时收过“港口联盟”的一笔捐款，至今还压在他的账上。他在用基金一点点还，还要装作什么都没发生。父亲事故报告的副本，他一直收在抽屉里，从没给任何人看过。',
    politics: '主张公开审计、社区诊所、码头安全和小商户贷款。他也清楚，要推动任何一件事，都得和商会吃过饭、和帮派谈过条件。他的原则是：能推动的，就是能推动的。',
    favorite: 'atlas',                         // 最爱的礼物：送这个额外 +3 好感
    spot: { gx: 10, gy: 4 },                   // 市政厅门前右侧的人行道
    hours: { from: 9, to: 17 },
    startAffinity: 30,                         // 开局就是「认识」——朋友
    look: { hair: '#5b5552', top: '#2e3a55', bottom: '#24262f', hairStyle: 'short', legs: 'pants', acc: 'tie' },
    limits: {
      chatPerDay: 2,
      giftPerDay: 1,
      decayAfterDays: 4,
    },
    gifts: [
      { id: 'tea',   name: '一罐老茶砖',       price: 40,  effect: { mood: 3 },     desc: '心情+3' },
      { id: 'chess', name: '一副象棋',         price: 90,  effect: { mood: 5 },     desc: '心情+5' },
      { id: 'fish',  name: '码头早市的鲜鱼',   price: 120, effect: { hunger: 40 },  desc: '饱腹+40' },
      { id: 'atlas', name: '复刻版旧城地图',   price: 180, effect: { mood: 8 },     desc: '心情+8（他最爱）' },
    ],
  },

  /* 科技公司女生：星河科技数据组的普通员工。傍晚 18~22 点在街角长椅旁。文案在 npc-data2.js。 */
  tech: {
    id: 'tech',
    name: '程念',
    title: '程念',
    gender: '女',
    age: 25,
    job: '星河科技数据组分析员（星河科技是虚构的互联网公司，总部在金融街）',
    family: '父母在城北开一家小五金店，每次通话都问她是不是又没吃饭。大学读计算机，拿过编程比赛的奖，毕业时以为能做大事。',
    background: '进星河两年。前半年的方案很亮眼，后来组长换了人，她的方案开始被署上别人的名字，她被调去做没人愿意做的报表。',
    personality: '外表冷静，说话快，偶尔冒出一两个技术梗。很会吐槽，对朋友很护短。焦虑时会吃辣条，吃完会很愧疚地把包装折成小方块。',
    catchphrase: '理论上不该这样。',
    hobbies: ['夜跑，固定绕东港的堤坝跑五公里', '拼乐高微缩模型，最近在做一座灯塔', '看黑白老电影，嘴里跟着念台词'],
    flaw: '说话太快，容易把别人绕进去；熬夜成瘾，凌晨三点的她比白天更诚实。',
    secret: '她在备份服务器里看到一组奇怪的港口货运记录，几家空壳公司的名字和“老鹰帮”的老账户对得上。报告被高层压下了，她偷偷存了一份，还没想好该交给谁。',
    favorite: 'coffee',
    spot: { gx: 22, gy: 4 },                   // 街角长椅（21,4）右边
    hours: { from: 18, to: 22 },
    startAffinity: 30,                         // 开局就是「认识」
    look: { hair: '#3a2a4a', top: '#7fb8e0', bottom: '#3b4a6b', hairStyle: 'bob', legs: 'pants', acc: 'bag' },
    limits: {
      chatPerDay: 2,
      giftPerDay: 1,
      decayAfterDays: 3,
    },
    gifts: [
      { id: 'milktea', name: '一杯芋泥奶茶', price: 18,  effect: { hunger: 10, mood: 5 }, desc: '饱腹+10 心情+5' },
      { id: 'coffee',  name: '冰美式',       price: 25,  effect: { energy: 12 },          desc: '精力+12（她最爱）' },
      { id: 'spicy',   name: '一包辣条',     price: 8,   effect: { mood: 6 },             desc: '心情+6' },
      { id: 'lego',    name: '一盒乐高小灯塔', price: 150, effect: { mood: 12 },           desc: '心情+12' },
    ],
  },
};

/* ---------- 技能（见 js/skills.js） ----------
 * 每项：id、name、icon、desc、maxLv(=10)、need(lv) 从 lv 升到 lv+1 所需经验、
 *       effect(lv) 当前等级的效果系数（永远是乘数，1 为无加成），text(lv) 效果说明（lv>0 时用）、
 *       unlocks 解锁列表 [{lv, text}]。
 * 效果系数的用法：
 *   stamina  打工/电脑工作的精力消耗 × effect      （burger.js / economy.js）
 *   charm    所有 NPC 聊天的正面好感收益 × effect；Lv5 多出一个专属聊天选项，Lv7 每天多聊 1 次，Lv10 好感事件奖励翻倍（npc.js）
 *   invest   炒股手续费 × effect                     （由 js/stocks.js 读取，未实现前仅占位）
 *   poker    牌局读牌/判断 × effect                  （由 js/poker.js 读取，未实现前仅占位）
 *   craft    打工与电脑工作的收入 × effect            （burger.js / economy.js）
 *   street   被骗概率与损失 × effect                  （街头骗局事件未实现前仅占位）
 * 经验来源：打工一班 / 电脑工作完成 → 体能、手艺各 G.SKILL_XP.work；聊天一次 → 口才 G.SKILL_XP.chat。 */
G.SKILL_XP = { work: 10, chat: 8 };
G.xpNeed = function (lv) { return 20 + lv * 15; };   // 升级经验公式：Lv0→1 需 20，之后每级 +15
G.SKILLS = [
  {
    id: 'stamina', name: '体能', icon: '💪', maxLv: 10, need: G.xpNeed,
    desc: '跑腿、扛盘子练出来的耐力。打工和电脑工作更不容易累。',
    effect: function (lv) { return 1 - 0.03 * lv; },
    text: function (lv) { return '精力消耗 -' + (lv * 3) + '%'; },
    // 高阶常量（js/burger.js、js/economy.js 读取）：crit 暴击（Lv5 起 10%，Lv8 起 25%，收入 ×mult）；
    // pair 电脑接单两单扣一次精力（Lv10，两单间隔不超过 gap 游戏小时）
    crit: { lv: 5, chance: 0.10, upLv: 8, upChance: 0.25, mult: 2 },
    pair: { lv: 10, gap: 2 },
    unlocks: [
      { lv: 5, text: '接单工作与打工收入有 10% 概率暴击，收入翻倍' },
      { lv: 8, text: '暴击率提高到 25%' },
      { lv: 10, text: '电脑接单：连续做两单只扣一次精力（两单间隔不超过 2 小时）' },
    ],
  },
  {
    id: 'charm', name: '口才', icon: '💬', maxLv: 10, need: G.xpNeed,
    desc: '会说话，知道什么时候接话、什么时候闭嘴。',
    effect: function (lv) { return 1 + 0.04 * lv; },
    text: function (lv) { return '聊天好感收益 +' + (lv * 4) + '%'; },
    extraOpt: { lv: 5, t: '顺口夸她一句手艺好', r: '行吧，算你有眼光。', d: 3 },
    unlocks: [
      { lv: 5, text: '聊天多一个专属选项（林小满：「顺口夸她一句手艺好」；周慕白、程念也各有一个）' },
      { lv: 7, text: '每天可对每位 NPC 多聊 1 次' },
      { lv: 10, text: 'NPC 的好感事件奖励翻倍（金钱、需求、技能经验）' },
    ],
  },
  {
    id: 'invest', name: '投资', icon: '📈', maxLv: 10, need: G.xpNeed,
    desc: '看得懂 K 线，也知道什么时候该收手。',
    effect: function (lv) { return 1 - 0.04 * lv; },
    text: function (lv) { return '炒股手续费 -' + (lv * 4) + '%'; },
    unlocks: [
      { lv: 3, text: '炒股新闻延迟降低，更早看到预告（延迟约 1 小时，原为 3 小时）' },
      { lv: 6, text: '炒股详情显示每只股票的「情绪指数」，以及模糊的「明日倾向」（只看均值路径）' },
      { lv: 7, text: '「观星」：每周 1 次，选一只股票，精确得知它明天的涨跌（当天一直可见）' },
      { lv: 8, text: '「观星」改为每周 3 次' },
      { lv: 9, text: '「观星」改为每天 1 次；「明日倾向」由精确预知取代' },
      { lv: 10, text: '行情列表直接显示全部 8 只股票的明日涨跌（▲/▼ 与精确百分比），不再消耗观星次数' },
    ],
  },
  {
    id: 'poker', name: '牌技', icon: '🃏', maxLv: 10, need: G.xpNeed,
    desc: '在牌桌上看人、算牌，输赢之外也学会了不动声色。',
    effect: function (lv) { return 1 + 0.02 * lv; },
    text: function (lv) { return '读牌判断 +' + (lv * 2) + '%'; },
    unlocks: [
      { lv: 2, text: '德州扑克：牌桌显示当前牌型' },
      { lv: 4, text: '德州扑克：显示起手牌强度评级' },
      { lv: 6, text: '德州扑克：显示底池赔率与所需胜率' },
      { lv: 7, text: '德州扑克：显示胜率估算（对随机手）' },
      { lv: 8, text: '德州扑克：每手开局随机「读牌」一名对手的底牌，直到本手结束都翻开显示' },
      { lv: 9, text: '德州扑克：每手随机读出两名对手的底牌' },
      { lv: 10, text: '德州扑克「全知之眼」：所有对手的底牌常显，并实时显示每名对手的胜率' },
    ],
  },
  {
    id: 'craft', name: '手艺', icon: '🔧', maxLv: 10, need: G.xpNeed,
    desc: '翻肉饼、修电脑、接单子，手上的活越做越利索。',
    effect: function (lv) { return 1 + 0.03 * lv; },
    text: function (lv) { return '打工/电脑收入 +' + (lv * 3) + '%'; },
    // 高阶常量（js/burger.js 读取）：adrenal 肾上腺素（Lv5）；noHungerLv 打工不扣饱腹（Lv8）；allNight 通宵咖啡（Lv10，每天一次）
    adrenal: { lv: 5, below: 20, gain: 30 },
    noHungerLv: 8,
    allNight: { lv: 10, energy: 40, mood: -10 },
    unlocks: [
      { lv: 5, text: '每天第一次精力低于 20 时，肾上腺素上涌，自动回复 30 精力' },
      { lv: 8, text: '打工一班不再消耗饱腹' },
      { lv: 10, text: '电脑菜单多一项「通宵咖啡」：每天一次，不睡觉回复 40 精力（心情 -10）' },
    ],
  },
  {
    id: 'street', name: '街头智慧', icon: '🧭', maxLv: 10, need: G.xpNeed,
    desc: '这座城市的暗面见得多了，一眼就能看出谁在演戏、谁在下套。',
    effect: function (lv) { return 1 - 0.04 * lv; },
    text: function (lv) { return '被骗概率与损失 -' + (lv * 4) + '%'; },
    unlocks: [
      { lv: 4, text: '牌场私局邀请一眼识破，只能拒绝' },
      { lv: 6, text: '私局邀请有机会看出门道（几率随等级提高）；看出后可「反将一军」：成功赢回对方设套的钱的一部分，失手照常被借走' },
      { lv: 8, text: '被坑剧情之外的骗局、勒索类事件损失再减半（G.cardroom.scamResist()）' },
      { lv: 10, text: '免疫牌场私局陷阱（反将一军必定成功）；每天可在牌场后门向情报贩子买一条真假难辨的城市小道消息' },
    ],
  },
];

/* ---------- 电脑菜单（点电脑桌时弹出，见 ui.js） ----------
 * 其他模块可 G.pcMenu.push({id, label, desc?, when?(ctx), onClick(ctx)}) 追加菜单项。
 * ctx = { uid }：电脑桌家具的 uid。onClick 执行前面板会先关闭。 */
G.pcMenu = [
  {
    id: 'work', label: '接单工作', desc: '走到电脑前干活，耗时约 10 秒，消耗精力与饱腹',
    onClick: function (ctx) {
      if (G.player && G.player.useFurniture) G.player.useFurniture(ctx.uid);
    },
  },
  {
    id: 'stocks', label: '炒股', desc: '看看行情，买卖几只股票',
    onClick: function () {
      if (G.stocks && G.stocks.openPanel) G.stocks.openPanel();
      else G.log('股市模块还没装好');
    },
  },
  {
    id: 'poker', label: '学习德州扑克', desc: '在电脑上研究牌局与牌型',
    onClick: function () {
      if (G.poker && G.poker.openStudy) G.poker.openStudy();
      else G.log('德州扑克模块还没装好');
    },
  },
];

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
 *   burger: { day, shifts }, // 汉堡店：当天（day）已打班数，换日自动重置
 *   work: null | { t, total }, // 正在打工：t 已过秒数，total 总秒数；非空时玩家不能移动/使用
 *   npcs: { lin|mayor|tech: { affinity, lastSeenDay, lastTalkDay, talksToday, giftDay, giftToday, checkDay,
 *                  flags: { story, events, sketch }, pending, rumorDay } },   // 三位 NPC，字段见 npc.js
 *   city: { idx: {safety,prosperity,people,clean}, active: [], done: {}, lastDay, ending, endingShown },   // 城市，见 city.js
 *   skills: { [id]: { xp, lv } },   // 技能（js/skills.js 通过 G.registerModule 注册）
 *   // 其他已注册模块的字段同样挂在这里（G.registerModule 的 id）
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

/* ---------- 模块注册（存档字段） ----------
 * G.registerModule({ id, defaults() })：id 即 G.state 的键，defaults 返回该模块的默认状态。
 * 新档由 newState 生成；读档由 economy.js 的 mergeState 深度补齐。模块 id 不要与已有字段重名。 */
G.modules = G.modules || [];
G.registerModule = function (m) {
  if (!m || typeof m.id !== 'string' || !m.id) return;
  for (var i = 0; i < G.modules.length; i++) if (G.modules[i].id === m.id) return;
  G.modules.push({ id: m.id, defaults: typeof m.defaults === 'function' ? m.defaults : function () { return {}; } });
};

G.newState = function () {
  var s = {
    money: 300, day: 1, time: 8.0, season: 0, weather: 'sunny', roomLevel: 0,
    furniture: G.STARTER_FURNITURE.map(f => ({ uid: G.uid(), id: f.id, x: f.x, y: f.y, rot: 0 })),
    needs: { energy: 80, hunger: 70, mood: 70, hygiene: 80 },
    player: { x: 2 * G.TILE, y: 4 * G.TILE, dir: 'down', action: null, path: [], busy: 0 },
    pet: null, log: [], paused: false, buildMode: false, selected: null,
    flags: { blackout: 0 },
    scene: 'home',
    burger: { day: 1, shifts: 0 },
    work: null,
    npcs: G.npc && G.npc.fill ? G.npc.fill(null, 1) : {},   // 各 NPC 的默认状态由 npc.js 生成
  };
  G.modules.forEach(function (m) { s[m.id] = m.defaults(); });   // 已注册模块的存档字段
  return s;
};
