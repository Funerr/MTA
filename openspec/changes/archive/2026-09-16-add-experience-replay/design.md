## Context

前序已提供合法候选与 matcher。本 Change 只负责一条链的执行，不决定选哪条链、是否回退或是否学习。

实施前置：[add-visual-matcher](../add-visual-matcher/proposal.md)。本次为提前规划，前置完成后先核对实际契约。

## Goals / Non-Goals

**Goals:** 按当前画面执行原生动作，提供明确的动作完成边界与可用于回退决策的结果。

**Non-Goals:** 不新建 executor/、action-service/ 或设备 Action 类型，不调用任何 AI 定位方法，不更新生命周期统计。

## Decisions

### 1. 单入口与预检

replay.ts 接收合法 chain、当前 Agent/device、matcher、原生取消信号/剩余截止时间和记录回调。先验证整链动作映射、参数、图片存在与版本，再执行首动作；不等走到未知动作才停止。validator.ts 组织格式/入口/当前画面检查，视觉算法仍在 matcher 中。

### 2. 逐步动作协议

每步均 fresh screenshot → before screen/target/state → 当前 bbox 中心或投影锚点 → 同一 Midscene 原生 action → after screenshot。使用官方已定位动作入口/设备 action space，明确避免 aiTap、aiInput 等可能调用定位模型的方法。原生动作方法和参数与 Promotion 映射表成对核对；无法证明直接执行不触发 VLM 的动作不支持。Back/Home 也要校验页面。

### 3. 等待与结果确认

动作后有限轮截图等待 UI 稳定并匹配 afterEvidence；wait 上限来自调用剩余超时，不能重置 Step 时间。最终截图匹配 terminalEvidence 后才报告 success；它只是观察到与历史终态一致，调用方可以继续使用原生 aiAssert，框架不定义业务判断。等待失败不自动重发 Tap/输入。

### 4. 副作用分类

结果包括 status=success/rejected/failed/cancelled、completedActions、failedActionIndex、phase、effect=none/confirmed-partial/unknown、lastScreenshot、reason。派发前失败可判 none 或 confirmed-partial；派发后异常或无法判断动作是否生效标 unknown；已返回且后图可用但终态不符可以记录 confirmed-partial。必须保留原始异常供原生报告使用，不把设备断连混为视觉 no-match。

### 5. 取消与日志

动作前后及每次等待检查取消；已派发的设备动作可能无法撤销，记录副作用未知而非承诺回滚。不得在超时之后继续派发后续动作。逐步截图和匹配信息经回调写入现有 Midscene 报告能力，回放模块只产生事件，不实现报告渲染。

## Risks / Trade-offs

- [原生动作取消并不意味着设备已停止] → 停止新增派发，保留未知状态，交 Runtime 禁止盲目 AI 接续。
- [终态相似却业务不同] → 限定纯动作资格并保留独立原生断言，不缓存语义 verdict。
- [动作参数无法无损映射] → 整链预检拒绝，不能临时退化为坐标或 AI 定位。

## Migration Plan

先用可控设备替身验证状态机，再以通用轨迹/截图夹具验证完整重放与实际原生动作入口的参数契约，并观测模型调用边界；无需交付手机业务流程。失败时可直接关闭调用入口，资产不被本模块修改。
