# 《A+》工程仓 —— 内容 / 数据 / 游戏代码 / 工具

**Babylon.js 9 + TypeScript + Vite** 的网页游戏（WebGPU 优先，自动回落 WebGL2）。实现计划见 Obsidian `游戏/A+/实现路线图.md`（M0–M5，决策 #37–#41；#41 = 引擎由 Unity 改为 Babylon.js）。

> [!important] 游戏逻辑在 `src/core/`，不在呈现层里
> `src/core/` 是**不引用 Babylon、不做 IO 的纯 TypeScript**，由原 C# `APlus.Core` 逐文件移植，同种子下输出与 C# 版逐字节一致。
> 所以**不开浏览器也能跑全部逻辑测试**（`npm test`），`src/game/` 只做表现与输入。

## 目录

| 路径 | 内容 | 谁改 |
|---|---|---|
| `Assets/Localization/` | **String Table**：9 张 CSV 文本表 + `validate.js` | 文案 |
| `Assets/Data/` | **关卡数据**：`sources.csv`（答案源）· `answer_chain.csv`（答案链）· `occlusion_ids.csv`（遮挡状态枚举桥）· `enum_labels.csv`（中文枚举 → ASCII id 桥）+ `validate_chain.js` | 关卡设计 |
| `src/core/` | 纯逻辑：CSV 解析 · String Table · 视线状态机（记名 / 召唤 / 异象）· 抽题器 · 四选一构造（`answerExpression` + `choiceBuilder`）· 考试时钟与广播 · 监考调度 · 死亡曲线 · 跨轮状态 · 单场考试 `ExamSession` · 轮次模拟器 | 程序 |
| `src/data/` | 浏览器端数据入口：构建时把两个 CSV 目录打进包里 | 程序 |
| `src/game/` | Babylon 呈现层：灰盒教室 · 三态镜头与管道视野 · 试卷贴图 · 异象 · `ExamController` · 调试面板 | 程序 |
| `tests/` | Vitest 测试（含硬编码扫描、core 纯度检查） | 程序 |
| `scripts/` | Node 工具：`hardcodedStringScanner.ts` | 程序 |
| `Docs/` | **制作规格**：`遮挡表现规格.md`（18 个遮挡状态的可施工/可验收规格）· `字体决策.md` · `难度配比标定.md` | 美术 / 制作 |
| `Assets/Scripts/` · `Assets/Tests/` · `Assets/Settings/` · `Assets/Scenes/` · `Assets/Input/` · `Packages/` · `ProjectSettings/` · `Tools/` | **旧 Unity / C# 骨架，已停用**（决策 #41）。确认后打 tag 再删 | — |

**设计文档的主本不在这里。** 唯一真源是 Obsidian 库的 `游戏/A+/`（Mac：`~/Obsidian/游戏/A+/`）。本仓的 `Docs/` 放的是**从设计大纲派生出来的制作规格**，不复制大纲正文。

## 怎么跑

需要 Node 20+（本机 24）。

```bash
npm install

npm run dev        # 开发服务器，浏览器打开终端里给的地址；开发版自带调试面板
npm test           # Vitest：逻辑测试 + 硬编码扫描
npm run validate   # 两个 CSV 校验器（文本表 + 答案链）
npm run build      # 类型检查 + 生产构建到 dist/（npm run preview 本地预览）
```

- 固定种子：地址后加 `?seed=4242`；生产版要看调试面板加 `?debug`。
- 操作：点「开始考试」锁定鼠标 · 右键 抬头/低头 · 鼠标 看 · 滚轮或 W/S 翻题 · 1–4 选 · Enter 交卷 · 空格 手机 · \` 调试面板 · ESC 暂停。
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
| String Table | 9 张 CSV · 182 行 · `validate.js` 0 错误 0 警告 |
| 题库 / 答案链 | 62 道（Demo 60），**全部四选一**（决策 #38），双向参照完整性通过 |
| 答案源 / 遮挡状态 | 21 个源（Demo 16）/ 18 个遮挡状态（`Docs/遮挡表现规格.md`） |
| 难度配比 | 已实测标定（`Docs/难度配比标定.md`） |
| 字体 | 四槽位 + 隐性界面槽位已决策（`Docs/字体决策.md`），**授权状态一律需在发布前核实**；灰盒暂用系统字体 |
| 逻辑层（`src/core`） | 全部移植完成；Vitest 66/66；与 C# 版同种子对拍一致 |
| 呈现层（`src/game`） | 灰盒可玩：方块教室 · 三态镜头 · 试卷 · 异象驱散 · 占位死亡 · 复读 / 留级循环。声音、手机、广播、记名册尚未做 |
| 包体 | 约 6.8 MB（gzip 1.5 MB），来自 Babylon 总入口导入；M1 末改深导入 + 拆包 |
