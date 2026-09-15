## Context

这是独立研究 Change，依赖前序 Promotion 的证据和 Matcher 能力，建议在动作 MVP 后执行。它不以“上线替代 aiAssert”为成功标准，no-go 也是有价值的完整结果。

实施前置：[add-experience-promotion](../add-experience-promotion/proposal.md)、[add-visual-matcher](../add-visual-matcher/proposal.md)。本次为提前规划，前置完成后先核对实际契约。

## Goals / Non-Goals

**Goals:** 让少量有清晰人工标签的视觉状态判断具备可复现评估，量化本地方法的误通过风险和覆盖范围。

**Non-Goals:** 不修改原生断言、不注册运行期 experienceAssert、不自动决定语义标签、不将研究结果解释为跨环境可靠性保证。

## Decisions

### 1. 离线边界与数据位置

实验代码放 experiments/visual-assert/，输入与候选证据放该实验的 fixtures/，结果写独立输出目录并记录可复现命令。复用 matcher 的本地计算，不复用生产动作 Store 的 active 状态。只读取明确定义的图片文件，不驱动设备、不调用 VLM 做在线判断。原生 AI 可以在单独采样时作对照，人工标签是参考真值。

### 2. 有限支持类型

v1 评估显式二态控件状态与明确文本存在两类；每类都要求声明的语义类型、目标/上下文、正反状态参考和环境。unknown 与 false 分开：没找到或歧义不代表断言反对，只有完整反例状态证据才能 contradicted。“页面正常”“无明显异常”等开放断言直接 unknown。文本类如启用 OCR，必须使用固定本地模型并记录版本。

### 3. 分组和冻结

至少准备两种支持类型各 20 个正例和 20 个反例，另含至少 10 个不支持/歧义例；按原始捕获 session/image 分组，变体不跨校准/验证组。先分组再校准，验证集中每类至少 10 个正例/10 个反例，并包含 unknown 例；标签和分组固定后记录数据摘要。模型判断不能作为唯一标注来源。

### 4. 指标与 go/no-go

逐样本记录 expected、decision、reason、scores、latency。误通过=人工 false 且 decision=supported；误拒绝=人工 true 且 decision=contradicted；两类比例分别以人工 false/true 样本数为分母，unknown 单列。覆盖率=(supported+contradicted)/合法支持类型样本数。v1 研究 go 条件预先固定为冻结验证集误通过=0、各支持类型覆盖率≥80%、不支持请求均 unknown，且无数据/执行错误；否则 no-go。误拒绝与全部失败样本必须公布，不通过线上改阈值抹去。

### 5. 结论产物

输出评估摘要、逐例结果、数据/配置版本、复现命令、错误截图引用和 go/no-go 报告。go 仅允许建议另开生产化设计，不给出原生断言替代承诺；no-go 要说明是证据不足、类型边界或方法失效，以及可验证的后续问题。任何情况 aiAssert 仍是原用例的判断入口。

## Risks / Trade-offs

- [少量样本零误通过被过度解读] → 同时公开样本量、环境和 unknown，明确不代表统计保证。
- [数据泄漏] → 按原始捕获分组并校验内容摘要，验证集冻结。
- [全 unknown 伪装为保守成功] → 预设每类覆盖率阈值，未达到必须 no-go。

## Migration Plan

新增隔离实验，不迁移任何生产资产或用例；移除实验目录即可回滚。只有未来独立 Change 才决定断言资格、学习和原生集成。

