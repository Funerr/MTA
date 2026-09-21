# MTA — 移动终端 AI 自动化测试框架

MTA 面向 Android / HarmonyOS，提供设备会话、多设备协作、通用 Runtime 节点与实验性 Experience 学习和重放能力。Midscene 是底层执行引擎，负责 Runner、Agent、Planner、原生动作与报告；MTA 负责这些能力的接入、组合和运行边界。

当前 YAML 定位为 **Expert Mode / Execution Workflow**，用于表达可执行工作流。测试意图、业务数据和结果判断由使用方定义。仓库内的综合、相机和经验学习 YAML 是示例/验收用例，不是框架承诺交付的业务用例库。

本文说明当前可用能力与使用方法；架构边界见 [ARCHITECTURE.md](ARCHITECTURE.md)，后续方向见 [Roadmap](openspec/roadmap.md)，阶段证据见 [验收索引](docs/acceptance-index.md)。

## 环境要求

- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` 与 pnpm
- 运行 Android 用例时：本机 ADB、一台已授权 USB 调试的 Android 设备、模型 API 配置
- 运行 HarmonyOS 用例时：本机 HDC（可用 `HDC_HOME` 指定 hdc 所在目录）、一台已连接的鸿蒙设备、模型 API 配置
- 框架自身的安装、类型检查、测试与 Node 参考生成**不需要**任何设备和模型密钥

## 快速开始

一条命令初始化（检测 Node / pnpm 前提 → 安装依赖 → 生成 `.env` 脚手架 → 输出环境预检与下一步指引）：

```bash
node scripts/init.mjs   # 只检测与报告，不替你安装 Node / pnpm、不替你选择设备；可安全重复执行
                        # 依赖安装后亦可用别名：pnpm run mta:init
```

前提检测失败时脚本在任何安装动作之前非零退出并给出升级 / 安装指引；模型配置为空、adb / hdc 缺失或设备零台 / 多台只在预检报告中列出，不判定初始化失败，也不写回任何配置。

手动路径（与 init 等效的分解步骤）：

```bash
pnpm install --frozen-lockfile   # 安装锁定依赖（postinstall 自动生成各项目 Node 参考并刷新 YAML 指南清单）
pnpm run typecheck               # 类型检查
pnpm test                        # 框架自身测试（无需设备/密钥）
pnpm run nodes                   # 重新生成各项目 Node 参考，并刷新 YAML 指南的 Node 清单生成区块
```

## 运行业务用例（使用方）

1. 复制 `.env.example` 为 `.env`（快速开始的 init 已自动生成时可跳过），填写模型四项配置（[模型配置说明](https://midscenejs.com/model-common-config.html)）；单设备多目标时按平台设置 `ANDROID_DEVICE_ID` / `HARMONY_DEVICE_ID`；协作项目设置 `MULTI_DEVICE_BINDINGS` 与各别名的设备 ID 变量。hdc 不在默认路径时设置 `HDC_HOME`。高分辨率设备可设置 `SCREENSHOT_SHRINK_FACTOR`（须为 ≥1 的数字，缺省 `1` 不缩放）：截图按该因子缩小后传给模型以降低 token 消耗，坐标由 Midscene 换算回逻辑分辨率；非法值在会话建立时报错。
2. 将 Expert Mode 的合法 Midscene YAML 工作流按等级与业务模块放入 `cases/level1/`、`cases/level2/` 或 `cases/level3/`，并使用 `.android.yaml`、`.harmony.yaml` 或 `.multi-device.yaml` 后缀选择执行项目（目录说明见 [cases/README.md](cases/README.md)；协作 YAML 见 [docs/multi-device-yaml-workflows.md](docs/multi-device-yaml-workflows.md)）。
3. 执行：

```bash
pnpm run test:cases:smoke --project android  # 冒烟集（level1），安卓环境
pnpm run test:cases:level2 --project harmony # 仅 level2，鸿蒙环境
pnpm run test:cases:full                     # 全量（level1/2/3），项目默认串行
pnpm run test:cases --project android        # 仅运行 android 项目
pnpm run test:cases --project harmony        # 仅运行 harmony 项目
pnpm run test:cases --project multi-device   # 仅运行多设备协作项目
```

运行报告写入 `midscene_run/report/`（不入库）。某项目发现范围内没有 YAML 时，CLI 会报“未找到 YAML 用例”的收集错误。当前业务目录为空；原有演示已迁入 [examples/](examples/README.md)，通过独立配置显式执行。冒烟是 level1，全量包含所有 level，不复制用例。

## 用例转换 Skill

项目提供 [case-to-yaml](.agents/skills/case-to-yaml/SKILL.md)，供支持 Skill 的 GUI/Agent 宿主将 Excel、Markdown 或文本用例转换为现有 Midscene YAML。可在宿主中调用 `$case-to-yaml` 并提供文件、目标项目及测试上下文；附件读取与模型调用由宿主提供。

Skill 保留业务要求，允许非关键控件形态与位置变化，交付工作流、意图草稿和转换记录。证据不足或能力不支持的用例单独列出，不静默降低断言。转换不会执行测试，静态校验成功也不代表业务验收通过。[输入输出约定](.agents/skills/case-to-yaml/references/conversion-contract.md) 可供 GUI 接入参考。

## 用例编写工作台

`pnpm workbench` 启动本地单用户 Web 工作台（默认 `http://127.0.0.1:7788`，`MTA_WORKBENCH_PORT`/`MTA_WORKBENCH_DATA_DIR` 可覆盖；构建入口 `pnpm workbench:build`）。工作台覆盖：结构化表单与整段粘贴/Markdown/文本/Excel 导入（规则识别不出结构时自动改用编写模型整理，结果标注模型识别并要求人工核对）、可配置模型生成双平台工作流（复用当前项目的 Skill 规则与 Node 契约）、分层静态检查（YAML 解析 / Node 输入 / 预期覆盖 / 证据路径）、步骤卡片与保留注释的 YAML 编辑、显式设备绑定后经现有 MTA 执行链路（Midscene Runner）做关键点核查、人工确认与按平台导出。

约束与边界：

- 生成模型默认复用 `.env` 的 `MIDSCENE_MODEL_*` 多模态模型（与设备核查共用）；如需单独的编写模型，可在 `<数据目录>/model-config.json` 自定义（密钥仅存服务端，不出现在响应、日志或导出文件）。
- 关键点核查须显式绑定设备（不存在/不可用/多台歧义均报错，不静默切换）；设备执行走 `midscene.config.ts` 的项目 setup/teardown，工作台不另建旁路会话。请独占使用设备，外部命令行占用不受工作台锁保护。
- 关键点核查不等于业务验收通过；完整执行仍走既有 `pnpm test:cases:*` 入口，确认导出不写入 `cases/`、不自动运行测试。
- 无就绪内容时不生成空执行文件；导出默认写入 `artifacts/case-to-yaml/<会话>/`（不入库）。生成示例见 [examples/workbench](examples/workbench/README.md)。
- 契约边界与停止语义见 [workbench-contracts](docs/workbench-contracts.md)。

## 设备会话与选择规则

`src/setup/android.ts` 与 `src/setup/harmony.ts` 在**执行期**（项目 setup）建立设备会话，模块导入不产生任何设备或模型调用；接管前清理与单次释放的公共语义在 `src/setup/session.ts`（`bindAgentToDevice` / `SessionHandle`），平台各自保留选择逻辑与错误类型。

**android 项目：**

- 设置 `ANDROID_DEVICE_ID` 时必须精确匹配 `adb devices` 中的 udid，且设备状态为 `device`（已授权在线）；否则报错。
- 未设置时，仅当**恰有一台**已授权在线设备时自动选择；零台或多台均报错，不静默选择。
- ADB 不可用、目标离线/未授权等都会在 UI 操作前以可定位的错误失败。

**harmony 项目：**

- 设置 `HARMONY_DEVICE_ID` 时必须精确匹配 `hdc list targets` 中的目标；否则报错（官方 `agentFromHdcDevice` 会静默选第一台，本框架不采用）。
- 未设置时，仅当**恰有一台**在线目标时自动选择；零台或多台均报错，不静默选择。HDC 枚举结果不携带授权状态，目标连接问题在会话建立阶段暴露并清理已取得资源。
- HDC 不可用时报错并提示 `hdc list targets` 与 `HDC_HOME`。

两平台会话建立成功时都会输出所选设备标识（如 `[mta] android 会话已绑定设备：<udid>` / `[mta] harmony 会话已绑定设备：<deviceId>`），便于确认当前绑定目标。会话由原生 Agent（`AndroidAgent` / `HarmonyAgent`）接管，teardown 时经 `agent.destroy()` 统一释放且只释放一次；接管前的部分初始化失败会清理已取得资源并保留原始错误。

双执行项目（`android`、`harmony`）与协作项目（`multi-device`）默认串行执行（`maxConcurrency: 1`）。前两者各绑定一台设备；同一 YAML 内操作多台设备请使用协作项目，而不是把 `maxConcurrency` 调高。

## 可注册能力

两平台原生 Nodes 存在大量同名节点（`aiAct`、`launch`、`home`…），因此**按项目本地注册**，互不覆盖；全局注册两平台结构兼容的框架生命周期节点、显式等待 `device.waitUntil` 与实验 `experienceAct`。YAML 参数语法糖、自定义 Node 能力与按执行项目的 Node 清单统一整理在 [docs/midscene-yaml-guide.md](docs/midscene-yaml-guide.md)（Node 清单区块由 `pnpm run nodes` 生成并随 Node 变更刷新，是 case-to-yaml Skill 与工作台生成 YAML 的能力输入）。逐 Node 完整 JSON Schema 见按平台生成的参考：

- [midscene-node-reference.android.md](midscene-node-reference.android.md) —— android 项目：原生 AI Nodes（`aiAct`、`aiAssert`、`aiTap`、`aiAsk` 等）、原生设备 Nodes（`launch`、`terminate`、`runAdbShell`、`back`、`home`、`recentApps`）与通用生命周期节点。
- [midscene-node-reference.harmony.md](midscene-node-reference.harmony.md) —— harmony 项目：同名原生 AI/设备 Nodes（鸿蒙侧 shell 节点为 `runHdcShell`）与通用生命周期节点。
- [midscene-node-reference.multi-device.md](midscene-node-reference.multi-device.md) —— 协作项目：`<alias>.<native-node>`（如配置后的 `DUT1.aiAct`）、`<alias>.device.prepare` / `recover`、`device.parallel` 与全局 `wait`。说明见 [docs/multi-device-yaml-workflows.md](docs/multi-device-yaml-workflows.md)。
- **框架通用节点**（`src/nodes/`，两平台共享）：
  - `device.prepare: { target: home }` —— 严格只接受该输入；返回当前平台主屏。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。
  - `device.recover: {}` —— 严格只接受空对象；返回当前平台主屏，保留系统设置与业务状态。可在准备或用例步骤部分完成后调用。
  - `device.waitUntil: { prompt, timeoutMs?, intervalMs? }` —— 显式等待。轮询判定当前绑定设备界面上的自然语言条件，满足即继续、超时即失败；替代按最坏情况预估的固定 `wait`，缩短用例耗时。协作项目写 `<alias>.device.waitUntil`（顺序步骤，不能进入 `device.parallel`）。
  - `experienceAct: { prompt }` —— 实验性经验动作。仅对使用方登记的可重复纯动作目标尝试视觉重放；默认资格表为空，未登记或含判断时回退一次原生 `aiAct`。不覆盖原生 `aiAssert`。
- **可选透明接入**：默认关闭。设置 `EXPERIENCE_ENABLED=true` 后，本仓库 YAML 的 `aiAct` 对合格纯动作复用 Experience Runtime；图片、未知 options、未登记目标仍原样走原生。不拦截脚本直接调用 `agent.aiAct`。说明见 [docs/experience-transparent-ai-act.md](docs/experience-transparent-ai-act.md)。

两个设备生命周期节点均直接传播设备操作失败，超时与重试交给原生运行器，不吞异常、不私自重试。

`src/setup/ + src/nodes/ + src/experience/` 共同承担 Runtime capabilities；当前按职责解释边界，不迁移源码目录。Node 扩展与 Experience 范围约束见 [AGENTS.md](AGENTS.md)。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `midscene.config.ts` | 生产配置：android / harmony / multi-device 项目、Node 注册与用例发现范围 |
| `src/setup/session.ts` | 会话公共层：接管前清理（`bindAgentToDevice`）与单次释放句柄（`SessionHandle`） |
| `src/setup/android.ts` / `src/setup/harmony.ts` | 平台各自的设备选择、会话生命周期与项目 setup |
| `src/setup/multi-device.ts` | 协作项目：多别名绑定、精确选择与分别清理 |
| `src/nodes/` | 框架通用 Nodes；协作项目别名 Node 与 `device.parallel` |
| `scripts/init.mjs` | 一键初始化入口：Node / pnpm 前提检测（不替装）、`pnpm install`、`.env` 脚手架（不覆盖）与环境预检报告（别名 `pnpm run mta:init`） |
| `scripts/generate-node-references.mjs` | 按项目生成 Node 参考（官方 CLI 多项目时需 `--project` 选择），并刷新 YAML 指南的 Node 清单生成区块（区块构建在 `scripts/lib/yaml-guide-regions.mjs`） |
| `src/experience/`、`experiences/` | Experience 资产、Promotion、Matcher、Replay、Runtime；实验入口 `experienceAct`；可选 YAML `aiAct` 透明接入（默认关闭） |
| `cases/level1/`、`cases/level2/`、`cases/level3/` | 按等级与业务模块组织的业务用例；文件后缀选择执行项目 |
| `cases.config.ts` | 冒烟、全量和单级测试集的发现规则 |
| `examples/`、`midscene.examples.config.ts` | 演示工作流及显式运行入口 |
| `experiments/visual-assert/` | 视觉断言离线评估实验（不接入生产 `aiAssert`） |
| `patches/`、`pnpm-workspace.yaml` | 锁定依赖补丁及登记；当前仅 `@midscene/core` 的 locate 坐标归一化兼容（见下"框架验证"） |
| `tests/` | 框架自身测试与夹具，不进入任何平台的业务发现范围 |
| `docs/` | 依赖版本核对、框架验收与 Experience 能力说明（含 YAML `aiAct` 透明接入） |

## 框架验证

- `pnpm test`：运行框架单元与原生边界集成测试。测试数量、环境和结果只在对应日期的[阶段验收记录](docs/acceptance-index.md)中保存，不作为本文的实时统计。
- 锁定依赖补丁：`patches/@midscene__core@1.12.7.patch` 在 locate codec 解析后、校验前兼容"模型返回截图像素坐标而协议声明归一化"的越界结果（不触碰校验与其他模块）。升级 `@midscene/core` 前必须重跑 `tests/unit/midscene-locate-coordinate-contract.test.ts`：补丁失效或上游已原生兼容时按该契约测试与 `patches/` 内说明重新评估，不得静默移除或保留失配补丁。
- 边界集成测试加载**实际锁定的** `@midscene/test`/`@midscene/android`/`@midscene/harmony` 包与真实 `midscene.config.ts`，仅将设备/Agent 边界替换为受控替身；真实硬件与模型调用未在框架验收中覆盖。
- 有真实设备时，可选执行连接/截图/释放单能力检查（见[双平台阶段记录](docs/acceptance.md)的“可选设备检查”一节），该检查不是框架验收的必要条件。
