# 项目域用例执行验收（project-scoped-case-execution）

日期：2026-09-23。环境：macOS（darwin 25.6.0 arm64）、Node v24.20.0、锁定依赖 `@midscene/*` 1.12.7；**无真机连接**（`adb devices` 空、`hdc list targets` 为 `[Empty]`），故真机冒烟保留未完成状态。

交付物：统一执行入口 [scripts/run-case.mjs](../scripts/run-case.mjs)（菜单 / 命名空间目标 / 自检 / 人话进度与摘要 / 骨架生成）、用例结构共享层 [scripts/lib/case-structure.mjs](../scripts/lib/case-structure.mjs)（项目声明 schema、命名规范、设备需求解析）、声明驱动选择层 [cases.config.ts](../cases.config.ts)、`test:cases:*` 兼容别名（退役维度显式报错）、文档与 Skill 改写（[README](../README.md)、[cases/README.md](../cases/README.md)、[examples/README.md](../examples/README.md)、[run-case Skill](../.agents/skills/run-case/SKILL.md)）。执行始终委托官方 Midscene CLI，未新增 Runner、未改动任何 Node / Runtime / Experience 运行职责。

## 工程检查（2026-09-23）

| 检查 | 结果 |
| --- | --- |
| `pnpm run typecheck` | ✅ 无错误 |
| `pnpm test` | ✅ 62 个测试文件 / 560 个测试全部通过（含新增 case-structure / run-case / 选择层单元测试与改写后的两条原生边界集成断言） |
| `openspec validate project-scoped-case-execution --strict` | ✅ valid |

实现期修复并以单测锁定的行为缺口：菜单行队列（readline `question()` 丢行导致脚本化输入挂死）、范围扫描对命名不合规 YAML 的静默跳过（现显式报非 ASCII / 命名错误）、hdc `[Empty]` 输出过滤。

## 无设备失败模式全集（夹具根 + 真实 CLI，2026-09-23）

| 命令 | 结果 |
| --- | --- |
| `pnpm case EV980/system`（项目缺 project.yaml） | ✅ 「项目声明缺失：cases/EV980/project.yaml…」exit 1 |
| `pnpm case EV999` | ✅ 「项目不存在：EV999；可用项目：EV750、EV760、EV770」exit 1 |
| `pnpm case EV760/camera` | ✅ 「目标不存在：…；cases/EV760 下可用：system」exit 1 |
| `pnpm case EV760/system/display/missing` | ✅ 「目标不存在：…下可用：adjust-brightness」exit 1 |
| `pnpm case EV770/system`（内含 `亮度.yaml`） | ✅ 「路径含非 ASCII 字符（中文等）：亮度.yaml；请改为英文 kebab-case…」exit 1 |
| `pnpm case EV750`（`# devices: DUT3` 未声明未绑定） | ✅ 「设备需求未满足：…project.yaml 的 devices 未声明…；…MULTI_DEVICE_BINDINGS 未绑定…」exit 1 |
| `pnpm case … --project android` / `--config x.ts` | ✅ 「维度已退役…改用 pnpm case <项目>[/<大模块>]…」exit 1 |
| `MTA_SUITE=level2 pnpm case EV760` | ✅ 「MTA_SUITE（level/smoke 分级）已退役…」exit 1 |
| `pnpm run test:cases:smoke`（别名） | ✅ 「test:cases:smoke（level/smoke 分级）已退役…」exit 1 |
| `pnpm case <用例>`（模型未配置） | ✅ 「✗ 模型未配置（缺 …）—— 打开 .env…」+「环境未就绪，已阻止执行」exit 1，未启动任何执行 |
| `pnpm case <用例>`（模型已配、无安卓设备） | ✅ 「✗ 没有可用的安卓设备 —— 用数据线连接手机并开启 USB 调试后重试」+「已阻止执行」exit 1 |

菜单与清单（脚本化验证）：Python pty 伪终端下钻「项目 → 大模块 → 特性」后触发执行、被自检拦截（未启动任何执行）并可 `q` 退出；无 TTY 环境打印「可执行范围清单」并以 exit 1 结束，不阻塞。

## 未完成项（保留未完成状态，不以替身测试代替）

- **Android 真机冒烟**（单条 / 大模块 / 菜单下钻三路径）：本次环境无连接设备，未执行。
- **HarmonyOS 真机冒烟**：本次环境无连接设备（`hdc list targets` 为 `[Empty]`），未执行。
- **examples/ 演示冒烟核对人话进度、摘要与报告自动打开**（任务 2.4 验证）：依赖真实执行输出，随真机冒烟一并补做。

## 真机端到端补验（2026-09-23 追加记录）

环境：Android 真机 `HC10006129200186`、模型四项已配置（mimo 系）、macOS darwin 25.6.0；用例为 `cases/EV760/system/`（`project.yaml` 声明 android；文件头标明冒烟用途、非业务验收）。**用户裁决（同日）**：平台差异在执行层（会话 / Agent，另有框架级测试覆盖），入口层平台无关，不重复 HarmonyOS 真机冒烟（任务 5.4 按此关闭）。

| 路径 | 结果 |
| --- | --- |
| 单条：`pnpm case EV760/system/settings/open-settings` | ✅ 1 document / 1 用例通过（约 19s），exit 0，摘要「✔ 全部通过」+ 报告路径 |
| 菜单下钻：`pnpm case` 三级下钻至叶子执行 | ✅ `cases / EV760 / system / bluetooth` 下钻后执行通过（约 27s），exit 0；TTY 下「已在浏览器打开报告」（自动打开证据） |
| examples/ 演示（2.4 核对）：`pnpm case examples/workbench/settings-bluetooth.android.yaml` | ✅ 演示配置自动选择、步骤级进度（7/7 逐条）、报告路径打印、`--no-open` 生效，exit 0；`--verbose` 全量日志分层确认（过滤 20 行 vs 全量 58 行） |
| 大模块：`pnpm case EV760/system`（2 用例文件） | ❌ 两条用例的全部步骤与断言真机通过（23s / 18s），但 run 以 exit 1 结束——**框架层缺陷**（见下），非入口层问题 |

**e2e 发现并已修复的入口缺陷（均有回归测试）**：① `caseFiles` 改造时丢失显式清单短路，`MTA_CASE_FILES` 被无视导致单条目标退化为整项目执行（`tests/unit/case-files-explicit.test.ts` 回归）；② `runGroup` 参数解构不匹配导致 `--verbose` 从未生效。

**遗留框架缺陷（阻塞「大模块」多用例聚合，未修）**：共享 Agent 的单个 `reportFile` 在每个 case run 的 teardown 都被登记为报告来源，报告组装的 `uniqueTestRunReportSources`（`@midscene/core` report 组装契约）要求「一个 sourcePath 只属于一个 scope」，直接 throw → 用例全过但 run 判失败。任何「一次运行 ≥2 个用例」都会触发（单文件多用例同样如此，scopeId 粒度为 case run）。合规修法是在适配边界 `src/setup/agent-report-provider.ts` 改为每 run 独立 Agent 实例（官方 `agentProvider.getAgent(runId)` 即为此设计），android / harmony / multi-device 同型，需补锁定依赖契约测试；属新范围，待裁决。

## 框架缺陷修复与复验（2026-09-23 追加记录）

**修复**（适配边界 `src/setup/agent-report-provider.ts`，官方 `agentProvider.getAgent(runId)` 契约本就要求每作用域独立 Agent）：`scopedRunAgentFor` 以共享 Agent 为键、按作用域（case 级 `runId` / document 级 `documentRunId`，与官方 `getExecutionId` 同构）派生独立实例——共享底层设备（`Agent.interface`）与构造选项（`Agent.opts`），各自独立 `dump` 与 `reportFile`；官方 Node 与自定义 AI Node（`device.waitUntil`、`experienceAct`、透明 `aiAct` 包装、multi-device 别名节点）的取 Agent 点全部收敛到同一派生实例，dump 观测与执行实例一致。派生实例不单独 destroy（设备释放仍归会话 teardown）；受控替身（普通对象）不具备官方构造面时原样返回共享实例，既有替身测试语义不变。

**验证**：`pnpm test` 62 文件 / 564 测试全绿（含新增契约测试：锁定依赖 `AndroidAgent` 构造面 `constructor(interface, opts)`、构造期触碰的 `actionSpace` / `setAppNameMapping` 方法面、派生实例独立性与共享 interface）；`pnpm run typecheck` 无错误。真机复验「大模块」路径：`pnpm case EV760/system`（2 用例）→ 两条用例全部步骤与断言通过（37.7s / 16.4s），**exit 0**，组装报告 `midscene_run/report/test-run-20260923231810-9d441b7d.html` 正常生成且含两条用例的执行详情（此前必现的 `Agent report source is shared by multiple test scopes` 组装抛错消失）。scopeId 粒度为 case run，单文件多用例与此同机制，不再单独复验。

至此任务 5.3 三路径（单条 / 大模块 / 菜单下钻）真机全部跑通；5.4 按用户裁决关闭（平台差异在执行层，入口层与本次报告归属修复均平台无关）。
