# project-scoped-case-execution

## Why

面向第一次接触自动化与命令行的测试人员，当前用例执行的认知负担全部落在实现维度上：6 个 npm script × `--project` × `MTA_SUITE` × `--config` 的命令矩阵、用例文件靠 `.android.yaml` 后缀自证平台、level1/2/3 目录不累计语义反直觉，同一套入口还在 README 与 cases/README 多处重复。测试团队实际按「机型项目 → 大模块（通信协议 / 整机 / 三大项 / 稳定性）→ 特性」组织用例，与现有目录模型完全错位；`cases/` 当前为空，正是把结构一次改对的零迁移窗口。

## What Changes

- **BREAKING** 用例目录模型改为项目域组织 `cases/<项目>/<大模块>/<特性>/**`（项目 = 机型代号，如 `EV760`）；平台与设备需求在项目级 `project.yaml` 声明一次。`.android.yaml` / `.harmony.yaml` / `.multi-device.yaml` 平台后缀与 `cases/level{1,2,3}` 目录分级语义退役。
- 命名规范：文件夹与 YAML 全部英文 kebab-case；新建项目生成四大模块骨架（`protocols` / `system` / `core` / `stability`，模板默认值可调整）；中文仅作为菜单显示标签，不进路径。
- 统一执行入口 `pnpm case`：无参数为人话环境自检 + 「项目 → 大模块 → 特性 → 用例」编号下钻菜单（新手主线）；给出命名空间路径直接执行（如 `pnpm case EV760/system/display/adjust-brightness`）；6 个 `test:cases:*` 收编为兼容别名。批量改按项目 / 模块粒度表达，`--project` / `--config` / `MTA_SUITE` 退出用户命令面。
- 运行体验：跑前自检（模型配置、设备连接、调试开启）失败 MUST 给出单一修复动作而非变量名；跑中输出人话步骤进度（官方详细日志退至 `--verbose`）；跑完输出摘要（通过情况、失败步骤、预期 vs 实际）并自动打开报告。
- 双机协作等多设备用例在用例头部声明设备需求（如 DUT1 / DUT2 显式绑定），平台归属仍在项目级声明。
- 文档与 Skill 同步改写：README、`cases/README.md`、`examples/README.md`、`run-case` 与 `case-to-yaml` Skill 指引按新结构重写，清除 level / 后缀旧说法（含 AGENTS.md 相关表述）。
- 兼容保留：`examples/` 演示根经 `pnpm case examples/...` 继续可执行（演示目录迁移不在本期）；执行仍完全委托官方 Midscene Runner，退出码与报告语义不变，不自研 Runner。

## Capabilities

### New Capabilities

- `project-scoped-case-structure`: 用例按「项目（机型代号）→ 大模块 → 特性 → 用例」的目录组织与英文命名规范；项目级平台与设备需求声明；新建项目四大模块骨架；平台后缀与 level 分级语义的退役规则。

### Modified Capabilities

- `midscene-android-project`: 用例发现范围从 `cases/level{1,2,3}/**/*.android.{yaml,yml}` 改为按项目结构与项目级平台声明发现 android 用例；单点执行与批量入口的发现语义随之改变。
- `midscene-harmony-project`: 同上，HarmonyOS 用例发现范围改为项目结构与项目级声明（原 `cases/level{1,2,3}/**/*.harmony.{yaml,yml}`）。
- `multi-device-yaml-workflows`: `.multi-device.yaml` 后缀选择退役，协作归属改由项目级平台声明与用例级设备需求表达；「单设备项目用例发现范围保持兼容」的约束更新为新发现范围。
- `case-execution-entry`: 入口从「按文件路径 + 后缀推断」扩展为统一入口（编号菜单、命名空间路径、批量收编）；执行项目推断改由项目结构承担，`MTA_CASE_FILES` 内部契约收起。（基线来自未归档的 `simplify-case-execution`，归档顺序见 Impact。）

## Impact

- 代码：`cases.config.ts`（发现与执行项目推导改为项目结构 + 项目级声明）、`scripts/run-case.mjs`（扩为统一入口：菜单 / 自检 / 摘要 / 自动开报告，零新依赖）、`package.json`（`test:cases:*` 转别名）、新建项目骨架生成入口（落点由 design 决定）。
- 不触碰：`src/setup` / `src/nodes` / `src/experience` 的运行时职责、官方 Midscene Runner 与报告语义、`examples/` 既有目录结构、Experience 冻结范围。
- 文档：README「运行业务用例」、`cases/README.md`、`examples/README.md`、`.agents/skills/run-case/SKILL.md`、`.agents/skills/case-to-yaml/SKILL.md` 指引，以及 AGENTS.md 中 level / 后缀相关表述同步更新；完成后核对相对链接、示例身份与能力声明一致。
- 顺序依赖：`case-execution-entry` 的基线在未归档的 `simplify-case-execution` 中；建议先归档该变更，或把其入口需求并入本变更 delta 后再归档，避免基线缺失。
- 迁移成本：`cases/` 现为空目录（仅 README），结构切换零迁移；存量演示 `examples/` 兼容保留。无依赖变更。
