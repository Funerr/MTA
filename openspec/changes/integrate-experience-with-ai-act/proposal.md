## Why

MVP 完成后，用例作者仍需显式使用实验 Node。需要让项目中的原生 aiAct 调用透明接入经验，同时保留原始输入、错误、取消、报告和不支持场景的原生行为。

## What Changes

- 为项目 YAML 的 aiAct 增加可关闭的透明接入，在无需改写 prompt 或增加经验字段的情况下使用已验证 Runtime。
- 保持官方输入校验和参数语义；未登记目标、富媒体输入、语义检查、未支持参数或有输出文本的调用直接使用原生执行。
- 通过项目级开关一键回到原生行为；保留实验 experienceAct 以兼容已有 MVP 用例。
- 验证原生与透明模式的输入、结果、错误、超时、取消、报告和框架闭环矩阵，禁止重复拦截或回退递归。

## Capabilities

### New Capabilities

- `transparent-ai-act-experience`: 为项目 YAML 的 aiAct 增加可关闭的透明接入，在无需改写 prompt 或增加经验字段的情况下使用已验证 Runtime。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

修改 midscene.config.ts 与项目范围的接入模块，消费前序 Runtime。默认关闭，验收后可配置启用；不全局修改 AndroidAgent 原型，不承诺脚本直接调用 agent.aiAct 的透明接入。

实施前置：[add-experience-fallback](../add-experience-fallback/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。
