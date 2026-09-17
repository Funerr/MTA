# 验收与核对记录 — integrate-experience-with-ai-act

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

核对日期：2026-09-16。环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。无真实设备、无模型密钥、无网络。

## 1. 前置与官方契约（任务 1.1）

前序 [add-experience-fallback](../openspec/changes/archive/2026-09-16-add-experience-fallback/tasks.md) 验收见 [experience-runtime-acceptance.md](experience-runtime-acceptance.md)。本次复核：`pnpm exec vitest run tests/integration/experience-runtime-native.test.ts tests/unit/experience-runtime.test.ts tests/unit/experience-act-node.test.ts tests/integration/native-boundary.test.ts` → 4 文件 48 项通过。

锁定 `@midscene/test@1.12.7` / `@midscene/core@1.12.7` 官方 `aiAct`：`aiActInputSchema` 为严格 `{ prompt: string | { prompt, images?, convertHttpImage2Base64? }, options?: { cacheable, fileChooserAccept, fileChooserAllowedDir, deepThink, deepLocate, context } }`；`toArgs` 传入 `(prompt, { ...options, abortSignal })`；`toResult` 在返回 `undefined` 时为 `void`，否则 `{ summary: output }`；`createAgentTestRunnerNodes` 在 `execute` 期间用 `addDumpUpdateListener` 写入 `midscene-execution` 报告关联，并在 `signal.throwIfAborted()` 处尊重取消。项目范围包装保留上述 schema / 结果 / 报告 / 取消（见 `tests/unit/experience-ai-act-contract.test.ts`）。

## 2. 资格矩阵与旁路（任务 1.2）

| 输入 | 行为 |
| --- | --- |
| 纯文本 + 已登记目标 | 重放候选 |
| `{ prompt, images }` | 旁路；官方 `toArgs` 收到完整对象，不裁剪内部文本 |
| `options.cacheable` / `deepThink` / `context` | 旁路；全部 options 原样进入原生 |
| 未登记 / 「断言屏幕显示主屏」 | 旁路 |
| `instruction` 等非法键 | 官方 `NodeInputValidationError`，零 Agent 调用 |
| 原生返回非空文本 | `{ summary }` 透出，不 Promotion |

## 3. 工程验证（任务 3.2）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 0 错误 |
| Node 参考生成 | `pnpm run nodes` | ✅ 两平台参考均含官方 `aiAct`/`aiAssert` 与 `experienceAct`（默认关闭故 aiAct 描述仍为官方原文） |
| 契约 / 资格 / 包装 | `vitest run tests/unit/experience-ai-act-*.test.ts` | ✅ 通过 |
| 配置与 YAML 对照 | `vitest run tests/integration/experience-ai-act-native.test.ts` | ✅ 通过 |
| 全量回归 | `pnpm exec vitest run` | ✅ 26 个文件 254 项全部通过 |

关键行为核验：

- 默认配置加载不包装 `aiAct`，两项目仍共享 `experienceAct`，`aiAssert` 不被拦截。
- 关闭 / 开启解析同一 `tests/fixtures/experience-ai-act.yaml`，步骤名均为 `aiAct`。
- HIT 无 `agent.aiAct`，报告中 Locate-VLM 为 verified 0；MISS / 回退各一次原生，Promotion 一次。
- 直接 `agent.aiAct` 不被包装；Harmony 官方工厂产物在未调用 wrap 时保持未包装。

## 4. 遗留与边界

- 真实设备业务 YAML 未交付、未执行。
- 环境契约仍为 android 资产模型；harmony 项目可包装 `aiAct`，缺 `experienceEnvironment` 时回退原生。
- 开启开关但未注入资格策略时全部原生，这是默认空表行为，不是故障。
