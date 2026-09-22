# 《A+》工程仓 —— 内容 / 数据 / 引擎无关代码 / 工具

这是**关卡内容与数据**的仓库，不是完整 Unity 工程。

> [!important] 它现在还没有 Unity 工程骨架
> 本仓只有 `Assets/`（数据与代码）、`Docs/`（制作规格）、`Tools/`（命令行原型与构建）。
> **`ProjectSettings/` 与 `Packages/` 尚不存在** —— 也就是说「新建 Unity 工程并把本仓的 `Assets/` 放进去」
> 这一步还没做。在那之前，`Assets/Scripts` 下的代码是被**命令行原型**编译与验证的，不是被 Unity。

## 目录

| 路径 | 内容 | 谁改 |
|---|---|---|
| `Assets/Localization/` | **String Table**：9 张 CSV 文本表 + `validate.js` | 文案 |
| `Assets/Data/` | **关卡数据**：`sources.csv`（答案源）· `answer_chain.csv`（答案链）· `occlusion_ids.csv`（遮挡状态枚举桥）· `enum_labels.csv`（中文枚举 → ASCII id 桥）+ `validate_chain.js` | 关卡设计 |
| `Assets/Scripts/APlus/` | **引擎无关的纯 C#**：String Table 加载器 · 硬编码字符串扫描器 · 三态视线状态机 · 4.3 三层随机抽题器 · 轮次模拟器 | 程序 |
| `Assets/Scripts/Editor/` | Unity Editor 菜单（列 `en_status=todo` / 扫描硬编码 / 查数据表）。**未编译验证过**（本机无 Unity） | 程序 |
| `Docs/` | **制作规格**：`遮挡表现规格.md`（18 个遮挡状态的可施工/可验收规格）· `字体决策.md` | 美术 / 制作 |
| `Tools/` | `build-proto.ps1` + `APlusProto/`（命令行原型） | 程序 |

**设计文档的主本不在这里。** 唯一真源是 `D:\Obsidian\Obsidian\游戏\A+\`（工作区 `D:\I\A+\设计文档\` 是它的目录软链接）。本仓的 `Docs/` 放的是**从设计大纲派生出来的制作规格**，不复制大纲正文。

## 怎么跑

```powershell
# 1) 文本表校验（BOM / 表头 / 列数 / key / 枚举 / max_chars）
cd Assets/Localization ; node validate.js

# 2) 关卡数据校验（落位池 2–4 · 跨源 ≥3 · 遮挡合法性 · 双向参照完整性）
cd Assets/Data ; node validate_chain.js

# 3) 编译命令行原型（不需要 .NET SDK：用 .NET Framework 自带的 csc.exe）
powershell -ExecutionPolicy Bypass -File Tools/build-proto.ps1

# 4) 跑原型：数据面 + 24+ 条设计断言 + 硬编码扫描 + 轮次模拟 + 配比标定
Tools/APlusProto/bin/APlusProto.exe all

# 只跑其中一项
Tools/APlusProto/bin/APlusProto.exe data        # 数据面（含 Demo 落位可达性等硬检查）
Tools/APlusProto/bin/APlusProto.exe selftest    # 把 2.1 / 2.2 的设计铁律变成断言
Tools/APlusProto/bin/APlusProto.exe scan        # 中文字面量扫描（5.5.5）
Tools/APlusProto/bin/APlusProto.exe modes       # 三种难度配比分配策略的实测对比
```

可调参数：`--rounds --size --mix 3,3,3 --mode quota|jitter|weighted --jitter N --seed --no-occlusion --json <path> --sample <path> --include-nondemo`

## 四条硬规则（改这个仓之前先读）

1. **CSV 一律 UTF-8 with BOM + CRLF。**
   不是洁癖：**PowerShell 的 `Get-Content` 在没有 BOM 的文件上会按系统 ANSI（中文 Windows 上是 GBK）解码**，
   而 GBK 是双字节编码，会把紧随其后的换行也当尾字节吃掉 —— 本项目已经因此损坏过两个文件（修复记录见 `Docs/遮挡表现规格.md` §7.7）。
   **改 CSV 请用编辑器或 Node，不要用 PowerShell 的 `Get-Content`/`Set-Content` 往返。**
   原型自检里有一条 `every csv carries a utf-8 BOM` 守着。
2. **代码里一个中文字面量都不留**（设计文档 5.5.5）。中文文本只存在于 CSV 与 `Docs/`。
   中文枚举标签通过 `Assets/Data/enum_labels.csv` 映射成 ASCII id，所以 C# 源码可以保持纯 ASCII。
   `Tools/APlusProto/bin/APlusProto.exe scan` 会强制这一条（连 `\uXXXX` 转义都会解出来再判）。
3. **语义文本走 String Table，呈现文本走资产。**
   试卷抬头 / 规则墙 / 记名册笔迹 / 点阵短信的**字本身是美术**，CSV 里只留 `max_chars` / `lines` / `font_variant` 三个参数。
4. **数据与文本分表。** 答案 / 落位池 / 遮挡是**关卡设计**（`Assets/Data`），题干是**文本**（`Assets/Localization`）。
   两者变更频率与责任人不同，混成一张表会让「校训改一个字」牵动整行设计数据。

## 当前状态

| 项 | 状态 |
|---|---|
| String Table | 9 张 CSV · 151 行 · `validate.js` 0 错误 0 警告 |
| 题库 | 35 道 → **扩到 62 道**（见 `Assets/Data/README.md` 的统计） |
| 答案链 | 与题库双向参照完整性通过 |
| 答案源 | 21 个（Demo 16 个） |
| 遮挡状态 | 18 个，已建模 + 已设计表现（`Docs/遮挡表现规格.md`） |
| 难度配比 | 已实测标定：分配策略对比见 `Tools/APlusProto` 的 `modes` 输出 |
| 短信 | 28 行（实质 22 条，含 5 条恐怖短信） |
| 字体 | 四槽位 + 隐性界面槽位已决策（`Docs/字体决策.md`），**授权状态一律需在发布前核实** |
| C# 侧 | 加载器 + 硬编码扫描**已完成并实测**；Unity Editor 菜单未编译验证 |
| Unity 工程 | **未创建**（无 `ProjectSettings/`、`Packages/`） |