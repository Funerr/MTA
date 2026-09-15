## Why

动作重放成功不代表语义断言可以本地复用。需要独立研究哪些有限的可见状态判断可由历史视觉证据支持，并量化误通过风险，再决定是否引入运行期断言经验。

## What Changes

- 建立独立离线评估入口，针对已标注的控件状态/明确文本判断输出支持、反对或无法判断；任意布局质量等开放语义记为不支持。
- 保存正反例、环境、人工标签和数据集版本，隔离校准集与验证集，输出误通过、误拒绝、无法判断率与耗时。
- 产出可复现实验结果与 go/no-go 结论；negative/no-go 也可作为有效研究结论。
- 不替换 aiAssert、不修改用例通过状态、不将实验资产混入动作 Store；生产集成需另行建立 Change。

## Capabilities

### New Capabilities

- `visual-assert-evaluation`: 建立独立离线评估入口，针对已标注的控件状态/明确文本判断输出支持、反对或无法判断；任意布局质量等开放语义记为不支持。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

新增实验评估代码、标注夹具与研究记录，复用本地 matcher。与阶段 7 无强制依赖，建议 MVP 后开展；不阻塞动作链交付。

实施前置：[add-experience-promotion](../add-experience-promotion/proposal.md)、[add-visual-matcher](../add-visual-matcher/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。

