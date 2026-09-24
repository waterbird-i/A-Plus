# 《A+》工程仓 —— 内容 / 数据 / 游戏代码 / 工具

**Babylon.js 9 + TypeScript + Vite** 的网页游戏（WebGPU 优先，自动回落 WebGL2）。实现计划见 Obsidian `游戏/A+/实现路线图.md`（M0–M5，决策 #37–#41；#41 = 引擎由 Unity 改为 Babylon.js）；当前玩法以 `游戏/A+/v4 修订：手机解题 × 巡逻监考.md` 为准（决策 #42–#54）。

**玩法一句话**：卷子上的题不用真答——每道题旁印着 4 位题码，掏出翻盖机**搜题**（准、贵、要一直掏着）或**问学霸**（便宜、慢、会错）拿答案；监考在过道里巡逻，被她看见作弊，她会**闪现到你身旁**记名，同场记满 3 次即死。


## 直接玩

**https://waterbird-i.github.io/A-Plus/** —— 每次 push 到 `main` 由 `.github/workflows/pages.yml` 重建。
真人测试就用这个链接（`?seed=4242` 固定种子复现同一张卷子，`?debug` 出调试面板）。
> [!important] 游戏逻辑在 `src/core/`，不在呈现层里
> `src/core/` 是**不引用 Babylon、不做 IO 的纯 TypeScript**，由原 C# `APlus.Core` 逐文件移植，同种子下输出与 C# 版逐字节一致。
> 所以**不开浏览器也能跑全部逻辑测试**（`npm test`），`src/game/` 只做表现与输入。

## 目录

| 路径 | 内容 | 谁改 |
|---|---|---|
| `Assets/Localization/` | **String Table**：9 张 CSV 文本表 + `validate.js` | 文案 |
| `Assets/Data/` | **关卡数据**：`sources.csv`（答案源）· `answer_chain.csv`（答案链）· `occlusion_ids.csv`（遮挡状态枚举桥）· `enum_labels.csv`（中文枚举 → ASCII id 桥）+ `validate_chain.js` | 关卡设计 |
| `src/core/` | 纯逻辑：CSV 解析 · String Table · 视线状态机（记名 / 召唤 / 异象）· 抽题器 · 四选一构造（`answerExpression` + `choiceBuilder`）· 考试时钟与广播 · 监考调度 · **巡逻监考** `invigilatorPatrol`（视锥 / 起疑 / 听觉 / 抓现行）· **翻盖机** `flipPhone`（搜题 / 问学霸 / 收件箱 / 计算器 / 情景模式 · 话费 · 电量）· 教室布局 `classroomLayout` · 死亡曲线 · 跨轮状态 · 单场考试 `ExamSession` · 轮次模拟器 | 程序 |
| `src/data/` | 浏览器端数据入口：构建时把两个 CSV 目录打进包里 | 程序 |
| `src/game/` | Babylon 呈现层：低多边形教室与坐着的同学（`lowpoly` · `characters` · `classroom`）· 老师常态 / 暴怒两种形态 · 3D 翻盖机与点阵屏（`phoneView`）· 程序合成音效（`audio`，Web Audio）· 镜头与管道视野 · 试卷贴图 · 异象 · `ExamController` · 调试面板 | 程序 |
| `tests/` | Vitest 测试（含硬编码扫描、core 纯度检查） | 程序 |
| `scripts/` | Node 工具：`hardcodedStringScanner.ts` | 程序 |
| `Docs/` | **制作规格**：`遮挡表现规格.md`（18 个遮挡状态的可施工/可验收规格）· `字体决策.md` · `难度配比标定.md` | 美术 / 制作 |

> [!note] 旧 Unity / C# 骨架已删除（决策 #41）
> 删除范围：`Assets/Scripts/` · `Assets/Tests/` · `Assets/Settings/` · `Assets/Scenes/` · `Assets/Input/` · `Packages/` · `ProjectSettings/` · `Tools/`。
> 删除前在 `cc8dd68` 打了 tag **`unity-skeleton-final`**（那个提交里的完整 Unity 工程共 **130** 个文件；上面这些范围合计删除 **72** 个）。要翻旧实现：`git show unity-skeleton-final:<路径>`，或 `git worktree add /tmp/aplus-unity unity-skeleton-final`。

**设计文档的主本不在这里。** 唯一真源是 Obsidian 库的 `游戏/A+/`（Mac：`~/Obsidian/游戏/A+/`）。本仓的 `Docs/` 放的是**从设计大纲派生出来的制作规格**，不复制大纲正文。

## 怎么跑

需要 Node 20+（本机 24）。

```bash
npm install

npm run dev        # 开发服务器，浏览器打开终端里给的地址；开发版自带调试面板（默认关着，按 \` 开）
npm test           # Vitest：逻辑测试 + 硬编码扫描（106 条）
npm run validate   # 两个 CSV 校验器（文本表 + 答案链）
npm run build      # 类型检查 + 生产构建到 dist/（npm run preview 本地预览）
npm run smoke      # 无头浏览器全流程冒烟：构建产物 + 本机 Chrome，13 项断言
```

**CI**（`.github/workflows/ci.yml`）在每次 push / PR 上跑校验、类型检查、测试、构建四道门。
`npm run smoke` **不在 CI 里** —— 它要真的 Chrome，Linux runner 上还没验过。
它的定位是「**把构建产物交给真人之前跑一遍**」：它会拦住那些 Vitest 看不见的东西
（Babylon 静默退回 NullEngine、资源 404、呈现层抛错），而且它跑的是**构建产物**而不是 dev server。
排查时用 `SMOKE_HEADED=1 npm run smoke` 看得到画面。
想验**已经发出去的**那个链接（不构建、不起本地服务，直接把它当被测对象）：
`SMOKE_URL=https://waterbird-i.github.io/A-Plus npm run smoke`。
「上传成功」和「能玩」是两件事，这一条量的就是后者 —— 线上版本已实测 13/13 通过。

- 固定种子：地址后加 `?seed=4242`；生产版要看调试面板加 `?debug`。
- 操作：点「开始考试」锁定鼠标（ESC 暂停）· **鼠标就是视线**：抬头环视、低头看卷子，游戏按俯仰角自动判定（没有抬头/低头键）· 翻题：滚轮或 W/S，或把准星对准卷子上的「上一题 / 下一题」按钮点左键 · 1–4 选 · **按住 Enter 1.1 秒交卷** · **H 看「怎么玩」**（单独一屏，开着时等于暂停，绝不盖在考试上）· \` 调试面板（默认关着，只在开发版 / `?debug` 下按得出来）。
- 手机：**空格**掏出 / 收回。掏着时鼠标变成光标，点手机上的键；也可以用键盘：数字键 · Enter 确定 · Backspace 返回 · W/S（或方向键）上下 · Q = \* · E = #。主菜单：1 搜题（输卷面上的 4 位题码）· 2 问学霸（输题号）· 3 收件箱 · 4 计算器 · 5 情景模式（响铃 / 静音）。
- 只跑某个测试文件：`npx vitest run tests/session.test.ts`；监听模式：`npx vitest`。

## 四条硬规则（改这个仓之前先读）

1. **CSV 一律 UTF-8 with BOM + CRLF。**
   不是洁癖：**PowerShell 的 `Get-Content` 在没有 BOM 的文件上会按系统 ANSI（中文 Windows 上是 GBK）解码**，
   而 GBK 是双字节编码，会把紧随其后的换行也当尾字节吃掉 —— 本项目已经因此损坏过两个文件（修复记录见 `Docs/遮挡表现规格.md` §7.7）。
   **改 CSV 请用编辑器或 Node，不要用 PowerShell 的 `Get-Content`/`Set-Content` 往返。**
2. **代码里一个中文字面量都不留**（设计文档 5.5.5）。中文文本只存在于 CSV 与 `Docs/`；注释不受限。
   中文枚举标签通过 `Assets/Data/enum_labels.csv` 映射成 ASCII id，所以源码可以保持纯 ASCII 字面量。
   `npm test` 里的扫描测试会强制这一条（连 `\uXXXX` 转义都会解出来再判）。
3. **语义文本走 String Table，呈现文本走资产。**
   试卷抬头 / 规则墙 / 记名册笔迹 / 点阵短信的**字本身是美术**，CSV 里只留 `max_chars` / `lines` / `font_variant` 三个参数。
4. **数据与文本分表。** 答案 / 落位池 / 遮挡是**关卡设计**（`Assets/Data`），题干是**文本**（`Assets/Localization`）。
   两者变更频率与责任人不同，混成一张表会让「校训改一个字」牵动整行设计数据。

## 当前状态

| 项 | 状态 |
|---|---|
| String Table | 9 张 CSV · 221 行 · `validate.js` 0 错误 0 警告 |
| 题库 / 答案链 | 62 道（Demo 60），**全部四选一**（决策 #38），双向参照完整性通过 |
| 答案源 / 遮挡状态 | 21 个源（Demo 16）/ 18 个遮挡状态（`Docs/遮挡表现规格.md`） |
| 答案长度档（#34） | 每题声明答案字符数范围（`answer_chars`）：实测 **档 A 31 · 档 B 18 · 档 C 13**。遮挡规格 §2.1 的可读性下限按它分档，固定题静态强制、动态题按真实求值验证 |
| 难度配比 | 已实测标定（`Docs/难度配比标定.md`） |
| 字体 | 四槽位 + 隐性界面槽位已决策（`Docs/字体决策.md`），**授权状态一律需在发布前核实**；灰盒暂用系统字体 |
| 逻辑层（`src/core`） | 全部移植完成（M0 时与 C# 版同种子对拍一致），另加 v4 的翻盖机、巡逻监考、教室布局；Vitest 106/106，含两个机器人整场对局：一直掏手机的会死于记名；小心的作弊者 6 个种子全部活着交卷，平均 8.3/9 |
| 呈现层（`src/game`） | 可玩：*How to Fish* 式低多边形教室 · 18 名坐着的同学 · 巡逻老师（常态 / 暴怒两种形态，被抓时闪现到你身旁）· 可按键的 3D 翻盖机（点阵屏 11 字 / 行，掏出时视野收窄）· **鼠标自由视角**（按俯仰角自动判定「卷子 / 环视」，迟滞带 30° 进 / 22° 出）· 试卷（题码 + 翻题按钮 + 准星）· 异象驱散 · 死亡 · 复读 / 留级循环 · 「怎么玩」教学**单独一屏**（开始按钮旁边那颗 / H 键，游玩过程中不弹）· 程序合成的全部音效（占位，M2 换录音）。环境答案源挂点、记名册、正脸终稿尚未做 |
| 包体 | 主 chunk 约 6.6 MB（gzip 约 1.5 MB），来自 Babylon 总入口导入 · dist 约 7 MB（生产构建已关 sourcemap，之前是 31 MB）。**深导入的尝试失败并已回退**：按符号深导入能把主 chunk 压到 1.59 MB（gzip 401 KB），但 Babylon 9 的引擎能力是在总入口里**注册到引擎原型**上的，深导入不带这些副作用 —— 真引擎会在建阴影贴图时炸（`createRenderTargetTexture is not a function`），而且这件事只有跑构建产物才看得见。详见 `scripts/smoke.mjs` 的存在理由 |
