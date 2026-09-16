## Why

命中一张截图仍不足以安全完成整条动作链。需要把逐动作观察、重新定位、原生动作与后续画面验证串起来，并为 Runtime 提供明确的停止位置和副作用状态。

## What Changes

- 每个动作前使用新截图验证页面/目标并根据当前匹配位置调用 Midscene 原生设备动作。
- 每个动作后进行画面稳定及预期画面检查，末尾检查终态视觉证据；只有整链满足条件才返回 replay success。
- 输出完成动作数、失败阶段、已知/未知副作用和取消状态；一旦不确定立即停止，保留证据。
- 本次不执行 AI 回退、不自动学习或更新资产状态，不新增设备动作体系或独立 Executor。

## Capabilities

### New Capabilities

- `visual-action-replay`: 每个动作前使用新截图验证页面/目标并根据当前匹配位置调用 Midscene 原生设备动作。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

新增 src/experience/replay.ts、validator.ts 及回放结果契约，复用 matcher 和 Midscene 原生截图/动作。依赖前序模型与 Promotion 资产；控制交还 Runtime。

实施前置：[add-visual-matcher](../add-visual-matcher/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。

