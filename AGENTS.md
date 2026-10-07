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
`config → render → player → pet → economy → street → npc-data → npc → burger → skills → ui → main`
（新增模块文件沿用这个位置：`economy` 之后、`ui` 之前，并同步改 `index.html`）

| 文件 | 职责 |
|---|---|
| `js/config.js` | 常量与数据：房间等级、家具目录、宠物、时间、需求、外景地图（`G.STREET`，含牌场）、牌场营业时间（`G.CARDROOM`）、汉堡店（`G.BURGER`）、林小满人设（`G.NPCS.lin`）、技能定义（`G.SKILLS`）、电脑菜单（`G.pcMenu`）；模块注册 `G.registerModule`；`G.newState()`、`G.log`。文件顶部注释是各模块的接口契约 |
| `js/render.js` | 所有绘制（像素图全部用代码画）、缩放居中、屏幕坐标转格坐标 |
| `js/player.js` | 玩家移动（A* 寻路）、使用家具、需求衰减 |
| `js/pet.js` | 宠物 AI（`G.petAI`） |
| `js/economy.js` | 时间/季节/天气推进、买卖摆放、房租、随机事件（`G.events`）、存档（`G.saveload`；`mergeState` 按已注册模块补默认值）、家具结算（`applyUse`，电脑工作接入体能/手艺） |
| `js/street.js` | 门口外景（`G.street`）：室内外切换、门的点击（走到门口再进出）；点林小满/汉堡店门时分别交给 `npc.js`/`burger.js`；点牌场门交给 `G.cardroom.enter()` |
| `js/npc-data.js` | 林小满的文案数据（`G.NPC_DATA`）：好感称号与开场白、聊天话题池、故事段落、好感事件、送礼回应 |
| `js/npc.js` | 林小满（`G.npc`）：好感（存于 `G.state.npcs.lin`）、聊天/送礼/故事/事件、每日好感衰减、街上站位 |
| `js/burger.js` | 汉堡店（`G.burger`）：营业时间、买汉堡（经 `G.economy.applyUse`）、打工一班（`G.state.work` 忙碌状态）、班次上限；打工接入体能/手艺 |
| `js/skills.js` | 技能（`G.skills`）：经验与升级、效果系数、技能面板；注册为存档模块 `skills` |
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
1. 院子 + 种菜（按季节生长，可做饭/卖钱）← 下一步
2. 门口出行：小镇场景（便利店、市场、公园；汉堡店已有）
3. 天气/季节对户外真正生效
4. 宠物散步、更多邻居 NPC（林小满已完成，汉堡店打工已完成）
