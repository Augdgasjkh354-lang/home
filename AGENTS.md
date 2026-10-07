# AGENTS.md

给在本仓库工作的 AI 代理/开发者的说明。用中文交流，回复简洁。

## 项目
像素小家（Pixel Home）：浏览器里的俯视角像素风模拟经营小游戏。纯原生 JS + Canvas 2D，无构建、无依赖、无外部图片/字体，直接打开 `index.html` 即可运行。主要在手机竖屏上玩，改 UI 时优先保证竖屏和触摸可用。

## 运行与验证
- 本地：用任意静态服务器（如 `python3 -m http.server`）打开 `index.html`，或直接双击。
- 没有测试套件。改动后在浏览器里实际玩一遍，并看控制台无报错。
- 存档在 localStorage，键 `pixel-home-save-v1`。改动存档结构时必须兼容旧档（缺字段要补默认值），或升级键名并说明。

## 结构与加载顺序
所有模块挂在全局 `window.G` 上，脚本顺序固定（见 `index.html`）：
`config → render → player → pet → economy → street → npc-data → npc-data2 → npc → burger → skills → stocks-data → stocks → poker → cardroom → city-data → city → ui → main`
（新增模块文件沿用这个位置：`economy` 之后、`ui` 之前，并同步改 `index.html`）

| 文件 | 职责 |
|---|---|
| `js/config.js` | 常量与数据：房间等级、家具目录、宠物、时间、需求、外景地图（`G.STREET`，含市政厅、牌场、街角）、城市文案（`G.CITY`）、牌场营业时间（`G.CARDROOM`）、汉堡店（`G.BURGER`）、三位 NPC 人设（`G.NPCS.lin/mayor/tech`）、技能定义（`G.SKILLS`）、电脑菜单（`G.pcMenu`）；模块注册 `G.registerModule`；`G.newState()`、`G.log`。文件顶部注释是各模块的接口契约 |
| `js/render.js` | 所有绘制（像素图全部用代码画）、缩放居中、屏幕坐标转格坐标 |
| `js/player.js` | 玩家移动（A* 寻路）、使用家具、需求衰减 |
| `js/pet.js` | 宠物 AI（`G.petAI`） |
| `js/economy.js` | 时间/季节/天气推进、买卖摆放、房租、随机事件（`G.events`）、存档（`G.saveload`；`mergeState` 按已注册模块补默认值）、家具结算（`applyUse`，电脑工作接入体能/手艺） |
| `js/street.js` | 门口外景（`G.street`）：室内外切换、门的点击（走到门口再进出）；点 NPC 交给 `npc.js`；点市政厅门交给 `G.city.openHall()`；点汉堡店门交给 `burger.js`；点牌场门交给 `G.cardroom.enter()` |
| `js/npc-data.js` | 林小满的文案（`G.NPC_DATA.lin`）：好感称号与开场白、聊天话题池、故事段落、好感事件、送礼回应 |
| `js/npc-data2.js` | 周慕白、程念的文案（`G.NPC_DATA.mayor/.tech`），结构同林小满；程念另有 `rumor`（内幕）、`charmOpt` 为口才专属选项 |
| `js/npc.js` | 通用 NPC（`G.npc`，按 id 区分）：好感（`G.state.npcs[id]`）、聊天/送礼/故事/事件、每日衰减、街上站位与出现时段、面板；口才加成与事件翻倍在此 |
| `js/burger.js` | 汉堡店（`G.burger`）：营业时间、买汉堡（经 `G.economy.applyUse`）、打工一班（`G.state.work` 忙碌状态）、班次上限；打工接入体能/手艺 |
| `js/skills.js` | 技能（`G.skills`）：经验与升级、效果系数、技能面板；注册为存档模块 `skills` |
| `js/stocks-data.js` | 8 只股票（`G.STOCKS`）与城市事件模板（`G.STOCK_EVENTS`） |
| `js/stocks.js` | 炒股（`G.stocks`）：按游戏小时推进价格（均值回归+行业趋势+事件冲击）、新闻、买卖、分红、面板；`openPanel/priceOf/holding/portfolioValue/buy/sell/feeRate`；存档模块 `stocks` |
| `js/poker.js` | 德扑引擎（`G.poker`，纯逻辑可 node 测试）、3 种 AI、电脑学德扑 `openStudy`；存档模块 `poker` |
| `js/cardroom.js` | 牌场（`G.cardroom.enter()`）：首次老千剧情（扣 20% 现金）、三张牌桌、私局陷阱、打烊结算；牌技/街头智慧在此生效 |
| `js/city-data.js` | 城市数据（`G.CITY_DATA`）：四项指数与权重、影响力称号、12 个市政项目、城市新闻、结局文案 |
| `js/city.js` | 城市系统（`G.city`，存档 `G.state.city`）：指数、影响力、提案与项目推进、每日漂移与分成、结局、市政/城市面板、HUD「城市」按钮（在 `G.ui.init` 之后补入，未改 ui.js） |
| `js/ui.js` | HUD（含「技能」按钮）、商店、电脑菜单（点电脑桌，渲染 `G.pcMenu`）、建造模式、输入处理；`ui.openPanel({title, build, tick})` / `ui.rebuildPanel()` 是其他模块打开面板的通用接口 |
| `js/main.js` | 启动、事件绑定、主循环 |

## 约定
- 单一状态源是 `G.state`，字段说明见 `config.js` 顶部注释。不要在别处另存一份。
- **新模块的存档字段不要改 `economy.js`**：在自己的文件里调用 `G.registerModule({ id, defaults() })`，之后 `G.state[id]` 由新档生成、读档时按 `defaults` 深度补齐（旧档兼容，未知字段保留）。`main.js` 每帧（未暂停时）会调用已注册模块的 `G[id].update(dt)`（若存在）。
- 接口速查（其他模块可直接使用，都要先判空）：
  - `G.registerModule({id, defaults})`：注册存档模块（`config.js`）。
  - `G.skills.level(id)` / `G.skills.bonus(id)` / `G.skills.addXp(id, n)` / `G.skills.info(id)` / `G.skills.openPanel()`：技能（`skills.js`）。`bonus` 永远是乘数，1 为无加成；各技能系数含义见 `config.js` 的 `G.SKILLS` 注释。
  - `G.pcMenu`：电脑菜单数组 `[{id, label, desc?, when?(ctx), onClick(ctx)}]`，`ctx = {uid}`。其他模块可 `G.pcMenu.push(...)` 追加。
  - `G.stocks.openPanel()`：炒股（点「炒股」时调用，未实现则提示「股市模块还没装好」）。
  - `G.poker.openStudy()`：学习德州扑克（点「学习德州扑克」时调用，未实现则提示「德州扑克模块还没装好」）。
  - `G.cardroom.enter()`：牌场内容入口（玩家营业时间内走到牌场门口后调用，未实现则提示「牌场还没开张」）。营业时间判断见 `G.isCardroomOpen(time)`。
  - `G.npc`：通用 NPC（`npc.js`，id 为 `lin` / `mayor` / `tech`）。`G.npc.open(id)` 打开面板；`visibleIds()` / `spot(id)` / `at(gx,gy)` 查街上的人；`addAffinity(id, d)` 加好感（会触发好感事件）；`shiftMultiplier()` 林小满的打工加成（`burger.js` 读取）。
  - `G.city`：城市系统（`city.js`，存档 `G.state.city`）。`index(name)` / `indexes()` / `influence()` 查指数与影响力；**`modifier(name)` 给其他模块用的系数（乘数，1 为无影响）**：
    - `'prosperity'` 收入系数 0.75~1.25（繁荣高则高）：项目分成已接入；汉堡店工资、股市大盘可接入。
    - `'safety'` 风险系数 0.75~1.25（治安高则低）：项目出事概率已接入；街头骗局可接入。
    - `'clean'` 成本系数 0.875~1.125（廉洁高则低）：项目资金已接入。
    - `'people'` 民心系数 0.875~1.125（预留，暂无调用）。
    - `openHall()` 市政厅门口（办公 9:00~17:00）；`openPanel()` 城市只读面板；`propose(id)` 提案（只能在市政厅调用，见 `city-data.js` 的项目定义）。
- 每个文件用 IIFE 包裹，只往 `G` 上挂东西，不污染全局。
- 访问其他模块前先判断存在（如 `G.petAI && G.petAI.update`）。
- 新增家具：在 `G.FURNITURE` 加数据，并在 `render.js` 对应绘制表里补像素造型。
- 格子 16 逻辑像素（`G.TILE`），整数缩放，关闭抗锯齿；坐标约定：格坐标左上角为 (0,0)。
- 配色柔和温暖，深色描边，字体 monospace，界面全中文。
- 不引入外部库、图片、CDN 字体。
- 保持改动小而聚焦；不要顺手重构无关代码。

## 提交
- 提交信息简短，说明做了什么。
- 直接推 `main` 即可（个人项目），较大改动先开分支。

## 路线图
0. 已完成：技能、炒股、牌场与德扑
1. 改变城市：城市指数、市政厅项目与结局已完成；主线剧情与 `G.city.modifier` 的更多接入（汉堡店工资、股市、骗局）待做（院子种菜已搁置）
2. 门口出行：小镇场景（便利店、市场、公园；汉堡店已有）
3. 天气/季节对户外真正生效
4. 宠物散步、更多邻居 NPC（林小满、周慕白、程念已完成，汉堡店打工已完成）
