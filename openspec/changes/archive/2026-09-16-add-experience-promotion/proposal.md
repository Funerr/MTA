## Why

一次 AI 成功执行能否提供完整且准确的截图、目标和动作关联，是 Experience 最早需要验证的技术风险。先证明真实轨迹能够生成可用资产，再建设匹配与重放。

## What Changes

- 建立锁定 Midscene 版本的轨迹取数验证，获得每个实际动作的前后截图、参数、目标位置和同一次调用的来源。
- 将成功且完整的受支持动作链自动转换为目标图、上下文图、页面签名和 candidate 资产。
- 拒绝不完整、失败、取消、混入其他调用、含不支持操作或未建模语义检查的轨迹；明确跳过原因。
- 复用 Store 发布完整资产；本次通过验证入口触发学习，不注册 experienceAct、不接管原生 aiAct、不解析 HTML 重建报告。

## Capabilities

### New Capabilities

- `experience-promotion`: 建立锁定 Midscene 版本的轨迹取数验证，获得每个实际动作的前后截图、参数、目标位置和同一次调用的来源。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

新增 src/experience/promoter.ts、轨迹适配与证据夹具，复用 schema/store。读取原生结构化执行数据；通过实际锁定 Midscene 包的最小边界集成验证及其生成的轨迹夹具证明取数能力，不指定业务流程，也不假定已有完整公开 Hook。

实施前置：[add-experience-model](../add-experience-model/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。
