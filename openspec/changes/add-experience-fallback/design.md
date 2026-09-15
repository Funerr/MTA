## Context

依赖前序模型、Promotion、Matcher 和 Replay 的验收结果。此 Change 是框架 MVP 交付点，experienceAct 是供上层使用的实验接入能力；框架不内置业务目标或业务 YAML。

实施前置：[add-experience-replay](../add-experience-replay/proposal.md)、[add-experience-promotion](../add-experience-promotion/proposal.md)。本次为提前规划，前置完成后先核对实际契约。

## Goals / Non-Goals

**Goals:** 串起一次 AI 学习和后续视觉复用，明确回退预算、入口分支、生命周期与模型归因。

**Non-Goals:** 不覆盖原生 aiAct，不自动识别任意业务幂等性，不重放内嵌断言，不引入分布式并发或全状态恢复。

## Decisions

### 1. 入口和资格策略

Node 接受 prompt: string，使用 context 中的 Agent 与 ExperienceRuntime；Runtime 接收原始执行回调、case/step 身份、有效请求、环境、取消/截止时间和项目策略。使用方通过项目配置登记精确 prompt+有效 context 的纯动作目标及 repeatableFromCurrentState；默认策略集合为空。框架测试注入无业务含义的目标/状态夹具，真实业务断言由调用方独立定义。未登记直接执行原生，不尝试从自然语言推断可安全重试。禁止配置让含判断的请求成为可重放目标。

### 2. Lookup 与候选选择

按 requestKey+environment 获取 candidate/active，排除 stale/版本不符/资产坏链，再用入口画面验证。兼容新修订优先，同等候选仍歧义则 MISS，不逐条试点设备。候选只有索引匹配不是最终 HIT，报告可分 lookup-found 与 validated-hit。入口或动作前置不符立即终止此链；例如测试控件状态已改变时不能执行历史切换动作。是否允许回退依据调用方策略，由原生 AI 处理原目标。

### 3. 一次尝试内的分支

无候选/坏资产/动作前不匹配且设备可用 → 原生 AI。已确认部分完成且策略允许从当前态重复达成 → 当前画面原生 AI。unknown effect、取消、deadline exhausted → 保留失败，不追加 AI。原生执行回调在同一 Node 尝试最多调用一次；Midscene 内部规划循环与 Runner 的用例重试由原生处理，Runtime 不叠加重试。Store 错误降级，设备与模型不可用则自然失败。

### 4. 失败与生命周期

选中链的明确视觉失败记录一次 replayFailure 并标 stale；设备错误只记录运行失败，不修改其视觉有效状态；取消不计学习/重放成败。完整 replay success 将 candidate 置 active 并幂等累加一次。AI 成功后 Promoter 生成 candidate；若失败或不合格只记 PROMOTE skipped/failed，UI 成功仍返回成功。UI 失败永不学习。首期只重放 undefined 返回值的纯动作调用，其他原生返回值直接透传。

### 5. 入口分支和新的候选

fallback 的 AI 后缀独立取证，不把旧前缀与新后缀强行合并。保存真实 entry variant，旧入口完整链可以保持 stale。从原入口再次调用时如果没有有效完整链，需要重新学习。集成测试分别覆盖首动作前失配和中途失配，检查完整新链与后缀链各自绑定正确入口。

### 6. 观测和原生报告

Runtime 发出带 run/case/step/attempt/callId 的 HIT、MISS、REPLAY、FALLBACK、PROMOTE 事件，附状态、reason、revision、时长与计数；通过原生 Node 输出/recordToReport 接入，不建设 report-engine。根据锁定版本可用模型观测入口记录所有相关调用，角色不可分时标未知。用实际原生调用路径和受控模型传输层验证计数覆盖，再以拦截断言验证重放不会请求模型。Planning Cache 保留原生能力，集成测试隔离其状态，避免把原生缓存命中误算为经验行为。记录传输层替身来源，不把替身计数表述为真实业务成本。

### 7. 框架集成矩阵

使用临时 Store、固定截图序列、通用动作链、使用方策略替身和受控原生边界测试 Runtime。至少覆盖空库学习、有效候选重放、目标位移、入口失配后更新、更新后命中、中途失败、未知副作用、取消、超时和发布失败。可以用同一临时 Store 连续验证学习—复用—失效—再学习，也可以拆成独立回归测试；不要求连续执行某个设备业务流程。

组合测试使用实际 Store、Matcher、Replay、Promoter 及 Runtime 实现；设备/模型传输与时间是可控边界，不能将全部模块都 mock 后宣称闭环通过。轨迹夹具与前序原生取数契约保持一致，观察原生调用次数、派发参数、状态转换、入口和报告事件。无需业务 YAML 或真实设备页面变更。

## Risks / Trade-offs

- [幂等意图不保证每个动作幂等] → 每动作检查前置状态，部分回退仅对已登记目标且副作用明确生效。
- [入口相似无法证明后续动作前置成立] → 每步重新验证局部状态；业务判断交给调用方，不能用入口匹配代替。
- [全部依赖被 mock 使测试失去集成价值] → 组合实际经验模块，仅控制设备/模型 I/O 和时间，保留单独原生接口契约测试。

## Migration Plan

新增实验 Node 与可注入策略，使用方业务内容不迁移。框架集成矩阵、原生边界契约和失败路径测试通过后交给透明接入 Change；关闭实验入口即可回归原生路径。
