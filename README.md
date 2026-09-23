# 《A+》工程仓 —— 内容 / 数据 / 引擎无关代码 / 工具

Unity 6.3 LTS（6000.3.24f1）+ URP 工程。实现计划见 Obsidian `游戏/A+/实现路线图.md`（M0–M5，决策 #37–#40）。

> [!important] 游戏逻辑在 `APlus.Core`，不在 MonoBehaviour 里
> `Assets/Scripts/APlus/` 是**不引用 UnityEngine 的纯 C#**（`noEngineReferences`），Unity 和 dotnet 编译同一份源码。
> 所以**不开 Unity 也能跑全部逻辑测试**（`dotnet test`），Unity 那边只做表现与输入。

## 目录

| 路径 | 内容 | 谁改 |
|---|---|---|
| `Assets/Localization/` | **String Table**：9 张 CSV 文本表 + `validate.js` | 文案 |
| `Assets/Data/` | **关卡数据**：`sources.csv`（答案源）· `answer_chain.csv`（答案链）· `occlusion_ids.csv`（遮挡状态枚举桥）· `enum_labels.csv`（中文枚举 → ASCII id 桥）+ `validate_chain.js` | 关卡设计 |
| `Assets/Scripts/APlus/` | `APlus.Core`（纯 C#）：String Table 加载器 · 硬编码扫描 · 视线状态机（记名 / 召唤 / 异象）· 抽题器 · 四选一构造（`AnswerExpression` + `ChoiceBuilder`）· 考试时钟与广播 · 监考调度 · 死亡曲线 · 跨轮状态 · 单场考试 `ExamSession` | 程序 |
| `Assets/Scripts/Editor/` | `APlus.Editor`：Unity Editor 菜单（列 `en_status=todo` / 扫描硬编码 / 查数据表） | 程序 |
| `Assets/Tests/EditMode/` | NUnit 测试，Unity Test Runner 与 `dotnet test` 共用 | 程序 |
| `Assets/Settings/` · `Assets/Scenes/` · `Assets/Input/` | URP 管线资产 · 灰盒场景 · Input System 动作表（来自 Universal 3D 模板） | 程序 / 美术 |
| `Packages/` · `ProjectSettings/` | Unity 工程设置 | 程序 |
| `Docs/` | **制作规格**：`遮挡表现规格.md`（18 个遮挡状态的可施工/可验收规格）· `字体决策.md` | 美术 / 制作 |
| `Tools/` | `APlus.Core/`、`APlus.Tests/`（dotnet 工程，编译 `Assets/` 下同一份源码）· `APlusProto/`（命令行原型）· `build-proto.ps1`（Windows 无 SDK 时用） | 程序 |

**设计文档的主本不在这里。** 唯一真源是 Obsidian 库的 `游戏/A+/`（Mac：`~/Obsidian/游戏/A+/`）。本仓的 `Docs/` 放的是**从设计大纲派生出来的制作规格**，不复制大纲正文。

## 怎么跑

```bash
# 1) 文本表校验（BOM / 表头 / 列数 / key / 枚举 / max_chars）
cd Assets/Localization && node validate.js

# 2) 关卡数据校验（落位池 2–4 · 跨源 ≥3 · 遮挡合法性 · 四选一干扰项 · 双向参照完整性）
cd Assets/Data && node validate_chain.js

# 3) 逻辑测试（需要 .NET 8 SDK；与 Unity Test Runner 里的 EditMode 测试是同一批）
dotnet test Tools/APlus.Tests/APlus.Tests.csproj

# 4) 命令行原型：数据面 + 设计断言 + 硬编码扫描 + 轮次模拟 + 配比标定
dotnet run --project Tools/APlusProto/APlusProto.csproj -- all
dotnet run --project Tools/APlusProto/APlusProto.csproj -- selftest   # 或 data / scan / modes

# 5) Unity：用 6000.3.24f1 打开仓库根目录；EditMode 测试在 Window > General > Test Runner
```

- Windows 上没有 .NET SDK 时，原型仍可用 `powershell -ExecutionPolicy Bypass -File Tools/build-proto.ps1` 编译成 `Tools/APlusProto/bin/APlusProto.exe`。
- 新增测试文件后 `dotnet test` 没跑到它：删掉 `Tools/APlus.Tests/bin` 与 `obj` 再跑。
- 原型可调参数：`--rounds --size --mix 3,3,3 --mode quota|jitter|weighted --jitter N --seed --no-occlusion --json <path> --sample <path> --include-nondemo`
- macOS 上 `dotnet` 常常不在默认 PATH：本机是 `~/.dotnet/dotnet`（用前先 `export PATH="$HOME/.dotnet:$PATH"`）。

## 四条硬规则（改这个仓之前先读）

1. **CSV 一律 UTF-8 with BOM + CRLF。**
   不是洁癖：**PowerShell 的 `Get-Content` 在没有 BOM 的文件上会按系统 ANSI（中文 Windows 上是 GBK）解码**，
   而 GBK 是双字节编码，会把紧随其后的换行也当尾字节吃掉 —— 本项目已经因此损坏过两个文件（修复记录见 `Docs/遮挡表现规格.md` §7.7）。
   **改 CSV 请用编辑器或 Node，不要用 PowerShell 的 `Get-Content`/`Set-Content` 往返。**
   原型自检里有一条 `every csv carries a utf-8 BOM` 守着。
2. **代码里一个中文字面量都不留**（设计文档 5.5.5）。中文文本只存在于 CSV 与 `Docs/`。
   中文枚举标签通过 `Assets/Data/enum_labels.csv` 映射成 ASCII id，所以 C# 源码可以保持纯 ASCII。
   `dotnet test` 里的扫描测试与原型的 `scan` 都会强制这一条（连 `\uXXXX` 转义都会解出来再判）。
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
| 字体 | 四槽位 + 隐性界面槽位已决策（`Docs/字体决策.md`），**授权状态一律需在发布前核实** |
| 逻辑层（M1 Core） | 视线状态机 · 四选一 · 考试时钟 / 广播 · 监考调度 · 死亡曲线 · 跨轮状态 · 单场考试；`dotnet test` 65/65 |
| Unity 工程 | `Packages/` + `ProjectSettings/` 已建（URP，骨架取自 6000.3.24f1 的 Universal 3D 模板）；**还没在 Unity 里导入验证过**：`unity auth login` 需要浏览器授权、本机暂时登不上，Personal 许可证未激活，batchmode 打不开工程。首次导入后 `Assets/Scripts` 与 `Assets/Tests` 下会生成缺失的 `.meta`，**要单独提交一次** |
| 表现层（`APlus.Runtime`） | 未开始 |
