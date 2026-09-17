# 验收与核对记录 — add-experience-fallback

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

核对日期：2026-09-16。环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。无真实设备、无模型密钥、无网络。

## 1. 前置契约核对（任务 1.1）

前序 [add-experience-model](../openspec/changes/archive/2026-09-16-add-experience-model/tasks.md)、[add-experience-promotion](../openspec/changes/archive/2026-09-16-add-experience-promotion/tasks.md)、[add-visual-matcher](../openspec/changes/archive/2026-09-16-add-visual-matcher/tasks.md)、[add-experience-replay](../openspec/changes/archive/2026-09-16-add-experience-replay/tasks.md) 均已完成。对照核对：Store `findCandidates` / `applyVariantEvent`、Promotion `promoteExperience`（`callId` 幂等、dump 隔离）、Matcher `matchScreen`/`matchTarget`、Replay `ReplayResult.effect` 与原生 `Agent.callActionInActionSpace` + `locatedPixelResult`。

资格策略默认空表；测试注入无业务含义的 `generic-replay-target`。未登记或含判断/富媒体请求走原生，不以自然语言猜测幂等性。

## 2. 受控边界与替身覆盖范围（任务 3.1）

| 层 | 真实 | 替身 |
| --- | --- | --- |
| Store / Matcher / Replay / Promoter / Runtime | 实际模块组合 | — |
| Agent / Action Space | `@midscene/core@1.12.7` `Agent` + `createDefaultMobileActions` | — |
| 设备传输 | — | `SteppedDevice` / `ScriptedReplayTarget`：固定截图序列与派发记录 |
| 模型 / 传输 | — | `modelConfig` 指向不可路由地址 + `fetch` 计数；部分路径注入 dump |
| 时间 | — | `deadlineAtMs` / `AbortSignal`；回放等待上界收紧为测试值 |
| 资格策略 | — | 通用测试夹具，不含业务判断 |

未覆盖（不阻塞）：真实硬件行为、真实模型规划、业务 YAML、报告 HTML 渲染落盘。传输层替身计数不表述为真实业务成本。

## 3. 工程验证（任务 3.4）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 0 错误 |
| Node 参考生成 | `pnpm run nodes` | ✅ 两平台参考均含 `experienceAct`，且保留原生 `aiAct`/`aiAssert` |
| Runtime 单元测试（资格/Lookup/回退/生命周期/失败路径） | `vitest run tests/unit/experience-runtime.test.ts` | ✅ 通过 |
| Node 接入 | `vitest run tests/unit/experience-act-node.test.ts` | ✅ 通过 |
| 组合集成（观测、学习—重放、位移/失配/后缀、取消矩阵、真实 Agent） | `vitest run tests/integration/experience-runtime-native.test.ts` | ✅ 通过 |
| 全量回归 | `pnpm exec vitest run` | ✅ 21 个文件 223 项全部通过 |

关键行为核验：

- 空库学习一次原生并发布 candidate；再次相同请求走实际 Matcher/Replay 激活，Locate-VLM 为零。
- 小位移使用当前目标框中心派发，不追加原生。
- 入口失配停止旧链并原生学习；更新后命中新资产；中途失败后新 candidate 入口不是旧前缀。
- unknown / 取消 / 超时不追加 AI；发布失败不改变 UI 成功、不二次原生。
- 未接入模型观测时计数为 `unknown`（null），不能记为零。
- `experienceAct` 两项目共享，不覆盖原生 `aiAct`/`aiAssert`。

## 4. 遗留与边界

- 真实设备业务页面覆盖率未验证（合成场景帧只证明模块协作与原生接入契约）。
- 透明接入原生 YAML `aiAct` 见 [experience-transparent-ai-act.md](experience-transparent-ai-act.md)。
- 完成条件不依赖设备业务执行或业务断言通过。
