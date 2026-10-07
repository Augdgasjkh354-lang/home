/* ============================================================
 * 像素小家 —— 城市数据（city-data.js）
 * 只往 G.CITY_DATA 上挂数据。城市名与区名等文案在 config.js 的 G.CITY。
 * 逻辑在 js/city.js（G.city）。
 *
 * indexes   四项指数（0~100）：id、name、desc、init 开局值、drift 每天的自然漂移
 * weights   影响力 = 四项加权（合计 1）
 * stages    影响力称号（min 为下限）；最高阶段（新生之城）触发通关结局
 * maxActive 同时推进的项目上限
 * projects  资助/推动项目（由周慕白提供，在市政厅面板里提案）：
 *   id、cat（所属指数）、name、desc、cost（资金，元）、days（需要的游戏日）、
 *   minAff（周慕白好感门槛）、skill {id,lv}（技能门槛，可选）、req {指数:下限}（可选）、
 *   eff {指数:增减}（完成后永久生效）、yield（完成后每天的分成，元，会乘以繁荣系数）、
 *   risk {chance 基础概率, money 被索要的钱, safety 治安影响, text}（完成时可能出事；
 *        概率乘以治安系数，被索要的钱乘以街头智慧系数）、
 *   start 提案时的台词、news 完成时的城市新闻
 * news      平日城市新闻（按条件抽取）
 * ending    通关结局文案
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});

  G.CITY_DATA = {
    indexes: [
      { id: 'safety',     name: '治安', desc: '夜里敢不敢一个人走回家', init: 30, drift: -0.15 },
      { id: 'prosperity', name: '繁荣', desc: '货船、摊位和写字楼的热闹程度', init: 40, drift: 0.1 },
      { id: 'people',     name: '民心', desc: '普通人对这座城的信心', init: 35, drift: -0.05 },
      { id: 'clean',      name: '廉洁', desc: '账本上有没有见不得光的数字', init: 20, drift: -0.2 },
    ],
    weights: { safety: 0.25, prosperity: 0.25, people: 0.3, clean: 0.2 },

    stages: [
      { min: 0,  name: '失序之城', desc: '街头谁说了算，谁就是法。' },
      { min: 25, name: '暗流之城', desc: '表面平静，底下什么都在流动。' },
      { min: 40, name: '摇摆之城', desc: '有人想改，有人更想保住现在的位置。' },
      { min: 55, name: '转型之城', desc: '路灯开始亮了，账本开始有人翻。' },
      { min: 70, name: '改良之城', desc: '不算好，但已经是能住人的地方。' },
      { min: 85, name: '新生之城', desc: '这座城终于有了自己的样子。' },
    ],

    maxActive: 2,

    projects: [
      // ---- 治安 ----
      { id: 'lamp', cat: 'safety', name: '街头路灯整修', cost: 150, days: 2, minAff: 30,
        desc: '把旧城区一半的路灯修好，夜里总算不是黑的。',
        eff: { safety: 8, prosperity: 2 },
        start: '周慕白拿出工程单：“路灯先修，别的慢慢算。”',
        news: '旧城区的路灯陆续亮了。没人说是谁修的，但晚归的人都会多看两眼。' },
      { id: 'patrol', cat: 'safety', name: '夜间联合巡逻', cost: 800, days: 4, minAff: 50, skill: { id: 'street', lv: 2 },
        desc: '警局、居委会和街坊轮班，把几条暗巷照亮。',
        eff: { safety: 12, people: 3 },
        risk: { chance: 0.35, money: 300, safety: -4, text: '巡逻队在东港巷子里被人堵了，对方留下一句话：“巡逻可以，别碍事。”' },
        start: '巡逻表排出来了，周慕白在上面画了三个圈：“这三条巷子先照亮。”',
        news: '第一个月的夜巡报告很短：没有命案。街坊们开始敢在晚饭后散步了。' },
      { id: 'port', cat: 'safety', name: '整治港口走私', cost: 4000, days: 6, minAff: 70, skill: { id: 'street', lv: 5 }, req: { safety: 40 },
        desc: '查货柜、断掉几条暗线。得罪的人不会少。',
        eff: { safety: 15, clean: 6 },
        risk: { chance: 0.5, money: 800, safety: -8, text: '几个货柜“意外”起火，港口联盟派人来谈“补偿”的事。' },
        start: '周慕白把一份名单推到你面前：“这些人，咱们得一个一个请。”',
        news: '东港的走私线被掐断了一半。码头上的人第一次没有低头走路。' },

      // ---- 繁荣 ----
      { id: 'stall', cat: 'prosperity', name: '广场夜市摊位', cost: 200, days: 2, minAff: 30,
        desc: '在广场划出几十个摊位，给小贩留一条活路。',
        eff: { prosperity: 6, people: 2 }, yield: 6,
        start: '“摊位费免两个月，”周慕白说，“剩下的你们自己去抢。”',
        news: '广场的夜市开张了，油烟和笑声一起飘了起来。' },
      { id: 'loan', cat: 'prosperity', name: '小商户低息贷款', cost: 1500, days: 5, minAff: 55, skill: { id: 'invest', lv: 2 },
        desc: '给开了三年以上的小店一笔低息贷款，不用抵押。',
        eff: { prosperity: 10, people: 4 }, yield: 10,
        risk: { chance: 0.25, money: 400, safety: 0, text: '有人拿着假账来借钱，贷款办公室里吵了一下午。' },
        start: '贷款表格印好了。周慕白说：“表格上写的是人名，不是数字。”',
        news: '第一批贷款到账，城东的裁缝铺先挂出了新招牌。' },
      { id: 'tower', cat: 'prosperity', name: '商会合作的写字楼', cost: 8000, days: 8, minAff: 75, skill: { id: 'invest', lv: 5 }, req: { prosperity: 45 },
        desc: '商会愿意出钱盖一座写字楼，条件是地皮要给他们。',
        eff: { prosperity: 15, clean: -3 }, yield: 40,
        start: '商会的人递来合同，周慕白只看了一眼地皮的位置：“这块地，我们得换个说法。”',
        news: '写字楼封顶那天，商会请了全城的记者。没有人问地皮是怎么来的。' },

      // ---- 民心 ----
      { id: 'clinic', cat: 'people', name: '城南社区诊所', cost: 600, days: 4, minAff: 40,
        desc: '在城南开一间不收“挂号费”的诊所，老人和孩子都能看病。',
        eff: { people: 10, safety: 2 },
        start: '“先找医生，再找房子，”周慕白说，“医生最难请。”',
        news: '城南诊所开张第一天，排队的人一直排到了街口。' },
      { id: 'night_school', cat: 'people', name: '市民夜校', cost: 300, days: 3, minAff: 35, skill: { id: 'charm', lv: 3 },
        desc: '白天上班的人晚上也能学认字、算账，还有免费的法律咨询。',
        eff: { people: 6, prosperity: 2 },
        start: '夜校的课程表上，第一节课写的是“怎么看懂工资单”。',
        news: '夜校的第一节课很安静。老师讲完，有人举手问：“那房租的合同呢？”' },
      { id: 'old_city', cat: 'people', name: '旧城改造与公交延伸', cost: 6000, days: 7, minAff: 70, skill: { id: 'charm', lv: 6 }, req: { people: 50 },
        desc: '把断掉的公交线接回旧城区。拆旧也得先安置住户。',
        eff: { people: 14, prosperity: 4 },
        risk: { chance: 0.4, money: 0, safety: -3, text: '拆迁队在旧城遇到闹事的地产商，安置的事被拖慢了一周。' },
        start: '周慕白把住户名单摊开：“拆之前，每一户都要有去处。”',
        news: '第一趟接回旧城的公交车，车上坐满了去看病的老人。' },

      // ---- 廉洁 ----
      { id: 'audit', cat: 'clean', name: '公开审计与举报热线', cost: 1000, days: 4, minAff: 50,
        desc: '请会计师查市政账本，开一条热线，让人敢说话。',
        eff: { clean: 10, people: 3 },
        risk: { chance: 0.4, money: 0, safety: -5, text: '热线接到的第一通电话是一句威胁。周慕白把录音交给了警察。' },
        start: '“账本送去审计，”周慕白说，“你负责把热线电话接通。”',
        news: '审计报告第一次公开，全城的人都在传：原来有人真的算清了自己的账。' },
      { id: 'ledger', cat: 'clean', name: '市政采购透明化', cost: 2500, days: 5, minAff: 60, req: { clean: 25 },
        desc: '每一笔市政采购都要公开招标，供应商的名字全部上墙。',
        eff: { clean: 12, people: 2 },
        start: '招标公告一式三份，周慕白签字签得很用力。',
        news: '市政采购的招标结果贴满了公告栏。一家老供应商连夜搬了家。' },
      { id: 'blacklist', cat: 'clean', name: '采购黑名单', cost: 12000, days: 10, minAff: 85, skill: { id: 'charm', lv: 8 }, req: { clean: 45, safety: 40 },
        desc: '把多年“特别关照”的供应商列进黑名单，连带旧账一起翻出来。',
        eff: { clean: 18, people: 5, safety: 3 },
        risk: { chance: 0.5, money: 3000, safety: -5, text: '一位老供应商找上门，带着一个装满现金的信封，和一句“咱们都是为了城市好”。' },
        start: '黑名单的第一页只有一个名字，周慕白把它划掉又写上，最后还是留着。',
        news: '黑名单公布的那天，全城的报纸印的是同一个名字。' },
    ],

    news: [
      { when: function (c) { return c.prosperity >= 55; }, text: '东港的货轮比昨天多了三艘，码头上的工人笑得很大声。' },
      { when: function (c) { return c.safety < 35; }, text: '城南又有一家店被砸了，街坊们只敢躲在窗后看。' },
      { when: function (c) { return c.clean < 30; }, text: '市政厅门口的公告栏又换了一张“特别通知”，没人看得懂。' },
      { when: function (c) { return c.people >= 50; }, text: '城北的菜市场今天人挤人，卖菜的大婶说这是十年来最热闹的一天。' },
      { when: function () { return true; }, text: '今天天气不错，市报头版是一则婚礼，新娘穿的是港口联盟旗下的纺织厂出的婚纱。' },
    ],

    ending: {
      title: '奥特兰迪斯 · 新生',
      lines: [
        '路灯一盏一盏亮起来，东港的货轮还在进出，只是卸下来的东西终于能写进账本。',
        '城南的诊所门口排着队，队伍里有人在笑。旧城的公交车开通那天，司机按了三声喇叭。',
        '没有人宣布胜利。周慕白说：“这座城不是被救的，是被一群人慢慢算清楚的。”',
        '你回头看那一年的账本，有很多笔已经划掉，也有几笔还留着——那是你选择不划掉的。',
      ],
      egg: '彩蛋：林记汉堡的墙上多了一张速写，画的是一座亮着灯的城。角落里写着一行小字：“行吧，那就这样。”',
      button: '继续经营',
    },
  };
})();
