## Why

资产生成、匹配与重放需要一个薄的入口组成可验收闭环。通过实验 Node 验证命中、回退、更新和再次命中后，才适合对原生 aiAct 透明接入。

## What Changes

- 增加 ExperienceRuntime 和实验 experienceAct Node，串联 Lookup、Validator、Replay、Midscene AI、Promotion。
- 定义 candidate/active/stale 更新、统计与原生报告事件；资产问题降级原生 AI，取消与未知副作用不触发盲目重试。
- 提供由使用方注入的纯动作资格和可重复执行策略，默认不内置任何业务目标；未登记目标直接走原生 AI。
- 通过框架集成矩阵验证首次学习、无 Locate-VLM 重放、目标位移、视觉失效回退和更新后复用，不交付业务执行流程。
- 保留独立原生 aiAssert；不覆盖原生 aiAct，不实现通用语义分析或 Assert Promotion。

## Capabilities

### New Capabilities

- `experience-runtime`: 增加 ExperienceRuntime 和实验 experienceAct Node，串联 Lookup、Validator、Replay、Midscene AI、Promotion。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

新增 src/experience/runtime.ts、lookup.ts 与 src/nodes/experience-act.ts，接入现有生命周期及原生报告。实验 Node 作为框架接入能力提供；以原生边界契约和完整状态机矩阵作为框架 MVP 完成条件。

实施前置：[add-experience-replay](../add-experience-replay/proposal.md)、[add-experience-promotion](../add-experience-promotion/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。
