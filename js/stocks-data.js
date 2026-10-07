/* ============================================================
 * 像素小家 —— 炒股：静态数据（stocks-data.js）
 * 只往 G 上挂数据：G.STOCKS（8 家公司）、G.STOCK_EVENTS（城市事件模板）。
 * 价格模型与交易逻辑在 js/stocks.js。
 *
 * 公司字段：
 *   code 代码；name 名称；sector 行业；base 基准价（元，开局价格）
 *   dailyVol 日波动率（一个游戏日的随机波动，约等于日涨跌幅标准差）
 *   kappa 向基准价回归的速度（每游戏小时）；amp 行业日内趋势幅度；peak 行业日内最强的时刻（0~23 点）
 *   yield 年化分红率（每个游戏季度（7 天）按此比例的 1/4 派息）
 *   risk 风险等级 1~5；desc 简介
 *
 * 事件模板字段：
 *   id 标识；kind 'pre' 预告（生效前若干小时发布新闻）| 'flash' 突发（发布与生效几乎同时）
 *            | 'late' 追踪（生效后才发布新闻）
 *   w 抽中权重；title 新闻标题；text 新闻正文；
 *   imp 对各股票的冲击（对数收益率，+0.1 约涨 10%）
 * ============================================================ */
(function () {
  'use strict';

  var G = (window.G = window.G || {});

  G.STOCKS = [
    {
      code: 'DGHY', name: '东港货运', sector: '港口物流', base: 38,
      dailyVol: 0.016, kappa: 0.0015, amp: 0.0008, peak: 9, yield: 0.0125, risk: 3,
      desc: '经营东港三个码头的集装箱与散货运输。工会势力大，罢工一响股价就抖。',
    },
    {
      code: 'NHDL', name: '霓虹电力', sector: '公用事业', base: 62,
      dailyVol: 0.011, kappa: 0.0015, amp: 0.0008, peak: 19, yield: 0.02, risk: 1,
      desc: '给全城供电的老牌公司。夏天空调一开，利润就水涨船高，检修停电时则反过来。',
    },
    {
      code: 'ANDC', name: '暗巷赌场集团', sector: '博彩娱乐', base: 18,
      dailyVol: 0.026, kappa: 0.0015, amp: 0.0010, peak: 22, yield: 0.005, risk: 5,
      desc: '地下赌场连锁，明面上挂着娱乐公司的牌子。场子被查，股价一夜回到解放前。',
    },
    {
      code: 'SKCH', name: '私货咖啡进口', sector: '进口贸易', base: 9,
      dailyVol: 0.030, kappa: 0.0015, amp: 0.0008, peak: 8, yield: 0.0, risk: 5,
      desc: '从海外把咖啡豆偷偷运进城，利润惊人，风险也一样惊人。账目从不对外公开。',
    },
    {
      code: 'HAND', name: '海岸地产', sector: '房地产', base: 120,
      dailyVol: 0.016, kappa: 0.0015, amp: 0.0008, peak: 14, yield: 0.0075, risk: 3,
      desc: '海岸线上的楼盘与填海项目。规划批文一下来就涨停，限购政策一出又跌回去。',
    },
    {
      code: 'JYZB', name: '警用装备', sector: '制造', base: 26,
      dailyVol: 0.013, kappa: 0.0015, amp: 0.0008, peak: 16, yield: 0.015, risk: 2,
      desc: '给警局供应防弹衣、通讯器和巡逻车。扫黑风声越紧，订单越多。',
    },
    {
      code: 'WYDT', name: '午夜电台传媒', sector: '传媒', base: 14,
      dailyVol: 0.019, kappa: 0.0015, amp: 0.0008, peak: 21, yield: 0.01, risk: 3,
      desc: '深夜电台与本地小报。收听率和口碑都靠主持人撑着，一句话就能让广告商跑光。',
    },
    {
      code: 'NHYD', name: '霓虹夜店连锁', sector: '娱乐餐饮', base: 6,
      dailyVol: 0.022, kappa: 0.0015, amp: 0.0010, peak: 23, yield: 0.0025, risk: 4,
      desc: '城里最热的几家夜店。明星驻唱一来人就满，风声一紧就空。',
    },
  ];

  G.STOCK_EVENTS = [
    {
      id: 'raid', kind: 'pre', w: 1,
      title: '市局扫黑行动',
      text: '市局宣布下周起开展扫黑除恶专项行动，据悉将整顿地下赌场与夜场。',
      imp: { JYZB: 0.10, ANDC: -0.14, NHYD: -0.06, SKCH: -0.05, WYDT: 0.02 },
    },
    {
      id: 'strike', kind: 'flash', w: 1,
      title: '东港码头罢工',
      text: '东港码头工会宣布罢工，三号泊位停工，集装箱在港口堆积。',
      imp: { DGHY: -0.12, HAND: -0.02, SKCH: -0.05 },
    },
    {
      id: 'strike_end', kind: 'flash', w: 1,
      title: '码头罢工结束',
      text: '码头与工会达成协议，罢工结束，积压的货物将陆续卸港。',
      imp: { DGHY: 0.08, SKCH: 0.03 },
    },
    {
      id: 'casino_raid', kind: 'flash', w: 1,
      title: '赌场被查封',
      text: '警方突击检查，暗巷赌场一处据点被查封，几名经理被带走。',
      imp: { ANDC: -0.20, NHYD: -0.03, JYZB: 0.03 },
    },
    {
      id: 'heat', kind: 'flash', w: 1,
      title: '高温用电创新高',
      text: '连日高温，全城空调负荷创下新高，霓虹电力有望超额完成季度指标。',
      imp: { NHDL: 0.06 },
    },
    {
      id: 'grid', kind: 'pre', w: 1,
      title: '电网夜间检修',
      text: '霓虹电力计划下周夜间检修电网，部分街区将短暂停电。',
      imp: { NHDL: -0.05, NHYD: -0.04, ANDC: -0.02 },
    },
    {
      id: 'coffee_seize', kind: 'flash', w: 1,
      title: '海关截获咖啡豆',
      text: '海关截获一批伪装成木材的咖啡豆，私货咖啡进口业务受到牵连。',
      imp: { SKCH: -0.15, DGHY: -0.03 },
    },
    {
      id: 'new_route', kind: 'pre', w: 1,
      title: '私运新海路',
      text: '有消息称私货咖啡打通了一条新海路，下个月起货源将明显增加。',
      imp: { SKCH: 0.12, DGHY: 0.02 },
    },
    {
      id: 'estate_plan', kind: 'pre', w: 1,
      title: '海岸填海规划',
      text: '市规划局拟近期批准海岸填海扩建方案，地产商已经开始排队拿地。',
      imp: { HAND: 0.14 },
    },
    {
      id: 'estate_cut', kind: 'flash', w: 1,
      title: '住房限购新规',
      text: '住房限购新规公布，海岸地产的几个楼盘销售明显放缓。',
      imp: { HAND: -0.09 },
    },
    {
      id: 'police_budget', kind: 'pre', w: 1,
      title: '警务装备预算',
      text: '市议会讨论追加警务装备预算，警用装备供应商有望受益。',
      imp: { JYZB: 0.07 },
    },
    {
      id: 'vest_scandal', kind: 'flash', w: 1,
      title: '防弹衣质检不合格',
      text: '抽检发现一批警用防弹衣不合格，供应商被约谈，订单可能暂停。',
      imp: { JYZB: -0.12 },
    },
    {
      id: 'radio_scandal', kind: 'late', w: 1,
      title: '主持人收受赞助',
      text: '午夜电台知名主持人被曝私下收受赞助，多家广告商已暂停合作。',
      imp: { WYDT: -0.10 },
    },
    {
      id: 'radio_hit', kind: 'late', w: 1,
      title: '夜谈节目爆红',
      text: '午夜电台新推的夜谈节目口碑爆棚，广告报价连续上调。',
      imp: { WYDT: 0.09 },
    },
    {
      id: 'club_star', kind: 'pre', w: 1,
      title: '明星驻唱',
      text: '当红歌手将在霓虹夜店连驻三周，门票一票难求。',
      imp: { NHYD: 0.12, ANDC: -0.02 },
    },
    {
      id: 'club_fire', kind: 'flash', w: 1,
      title: '夜店消防检查',
      text: '消防突击检查，霓虹夜店旗下三家分店营业受限。',
      imp: { NHYD: -0.10 },
    },
    {
      id: 'casino_branch', kind: 'late', w: 1,
      title: '赌场新分场营收大涨',
      text: '暗巷赌场在码头区新开的分场营收据悉大涨，业内人士普遍感到意外。',
      imp: { ANDC: 0.08 },
    },
    {
      id: 'port_fee', kind: 'pre', w: 1,
      title: '港务费减免',
      text: '港务局宣布对进口货物减收港务费，货运与进口公司普遍受益。',
      imp: { DGHY: 0.07, SKCH: 0.04 },
    },
    {
      id: 'casino_bet', kind: 'flash', w: 1,
      title: '地下赌王大赛开赛',
      text: '暗巷赌场主办的地下赌王大赛开赛，各路高手云集，场子人流暴涨。',
      imp: { ANDC: 0.10 },
    },
    {
      id: 'club_fest', kind: 'flash', w: 1,
      title: '夜店夏日音乐节',
      text: '霓虹夜店联办夏日音乐节，连续几个周末场场爆满。',
      imp: { NHYD: 0.09 },
    },
  ];
})();
