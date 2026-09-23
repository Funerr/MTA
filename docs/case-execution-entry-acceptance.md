# 用例执行入口验收 — simplify-case-execution（`pnpm case` / run-case Skill）

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

验收日期：2026-09-21（`simplify-case-execution`）。验收环境：macOS（darwin 25.6.0 内核 / 系统版本 26.6.2, arm64）、Node v24.20.0、pnpm 10.33.2、`@midscene/test@1.12.7`；Android 真机一台（`adb devices` 唯一已授权设备 `HC10006129200186`，未设 `ANDROID_DEVICE_ID`，按单台自动选择规则命中）；鸿蒙无在线设备（`hdc list targets` 为空）；`.env` 已配置 `MIDSCENE_MODEL_*` 模型四项。

交付物：`pnpm case` 单文件/文件集执行入口（[scripts/run-case.mjs](../scripts/run-case.mjs)）、选择层显式清单契约（[cases.config.ts](../cases.config.ts) 与 [midscene.examples.config.ts](../midscene.examples.config.ts) 的 `MTA_CASE_FILES`，入口内部契约）、IDE / Agent 宿主执行 Skill（[.agents/skills/run-case/SKILL.md](../.agents/skills/run-case/SKILL.md)）。执行始终委托官方 Midscene CLI，未新增 Runner、未改动任何 Node / Runtime / Experience 运行职责。

## 1. 工程检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 框架测试 | `pnpm test`（vitest） | ✅ 57 个文件 502 项全部通过（含本 Change 新增 24 项：选择层显式清单契约 10 项、入口解析/校验/分组 14 项；存量不回归） |
| 类型检查 | `pnpm run typecheck` | ✅ 通过（含 `scripts/run-case.d.mts` 类型声明） |
| OpenSpec 校验 | `openspec validate simplify-case-execution` | ✅ 通过 |

单元测试覆盖：清单生效 / 非法 JSON / 空数组 / 非字符串元素兜底报错 / 无清单时原目录选择不变；清单按平台后缀与演示项目目录归属、未匹配项目空集合哨兵；入口参数解析（`--project` 值校验、带值官方参数透传、用法输出）；五种前置失败（仓库外 / 文件不存在 / 根目录外 / 无法推断 / glob 元字符）与 `--project` 冲突明细；选择层与入口层推断规则的跨层一致性约束。

实施中确认的两条官方约束及适配（详见 change 的 design 修订）：官方选择校验禁止 include 含反斜杠（glob 转义不可行，元字符路径在入口层显式拒绝）且 include 不允许为空数组（未匹配项目使用保留哨兵模式）。

## 2. 无设备失败模式核查（启动前校验，不产生设备会话与报告）

| 输入 | 行为 |
| --- | --- |
| `pnpm case cases/level1/missing.android.yaml` | ✅ 报「文件不存在」，exit 1 |
| `pnpm case examples/harmony-experience/experience-learn.yaml` | ✅ 报「无法推断执行项目」并列出后缀/目录规则，exit 1 |
| `pnpm case examples/android/camera-gallery.yaml --project harmony` | ✅ 报「与文件推断结果冲突…（推断为 android）」，exit 1 |
| `pnpm case tests/fixtures/experience-ai-act.yaml` | ✅ 报「路径必须在允许的根目录（cases/ 或 examples/）之内」并指引批量入口，exit 1 |

四类失败均未产生任何报告目录变更（`midscene_run/report` 前后一致）与设备会话。

## 3. 真机冒烟（Android 单台）

**单文件成功路径**：`pnpm case examples/workbench/settings-bluetooth.android.yaml` → 按后缀推断 android、仅启动 android 项目（preflight 1 项目 / 1 文档 / 1 用例 / 0 收集错误），真机执行 7/7 步，**1/1 用例通过（约 20.0s）**，exit 0，报告写入 `midscene_run/report/test-run-20260921212058-93b7dd7f.html`。

**单文件执行链路（演示内容对设备敏感）**：`pnpm case examples/android/camera-gallery.yaml`（无平台后缀，按演示项目目录推断）→ 仅启动 android 项目，真机执行至第 14/20 步 `aiAssert` 失败（该设备图库停留在相册分类页而非照片列表，模型判定页面状态与断言不符）。入口的项目推断、单项目启动、报告产出（`test-run-20260921211946-c98b6b3b.html`）与退出码透传（exit 1）全部正常；失败属于演示用例对设备 UI 版本的既有敏感性（[examples/README.md](../examples/README.md) 已声明运行前核对），不构成入口缺陷。

**混合文件分组执行**：`pnpm case examples/workbench/settings-bluetooth.android.yaml examples/harmony/e2e-comprehensive.yaml` → 按配置根 × 执行项目分为两组顺序执行，组间零串扰：android 组仅收 workbench 文件（1/1 通过）；harmony 组仅收 harmony 文件（11 用例，无在线鸿蒙设备 → 会话不可建立，全部 not run）；最终退出码取首个非零值（exit 1），符合设计聚合语义。

**批量入口回归**：`MTA_SUITE=smoke pnpm test:cases --project android` → `cases/level1` 为空，报 1 条收集错误（"No workflow YAML files found"）、0 用例、exit 1，与引入 `pnpm case` 之前的既有行为及 README 记载一致；`MTA_CASE_FILES` 未设置时目录选择不变的断言另由单元测试约束。

## 4. 未验证项（不宣称）

- 鸿蒙真机单文件执行与鸿蒙侧混合全通过场景（验收时点无在线鸿蒙设备）。
- multi-device 项目单文件执行（无第二台设备与 `MULTI_DEVICE_BINDINGS` 目标环境）。
- 相机/图库演示在当前设备 UI 版本上的断言通过（演示内容敏感，属使用方核对范围）。
