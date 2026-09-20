# YAML 自动化基础能力补齐计划（讨论稿）

日期：2026-09-18。本文是能力盘点与未来实施建议，不代表能力已实现或真实设备验收通过。边界以 [ARCHITECTURE](../ARCHITECTURE.md) 和 [AGENTS](../AGENTS.md) 为准；外部框架来源见 [调研记录](automation-framework-capabilities-research.md)。

## 1. 结论与当前基线

优先补齐“等待条件成立”，随后补确定性观测、明确动作和失败证据。按缺口选择接入方式：已有 Agent API 做薄适配；跨平台运行职责封装 Node；Runner 能力通过配置接入；业务规则留在 Case。避免把能力列表直接变成 Node 列表。

本次检查了锁定的 `@midscene/*@1.12.7` 安装产物，以及 Android/Harmony 的 `getTestRunnerNodeDefinitions()`（未连接设备、未调用模型）：

| 能力 | 当前状态 | 补齐方向 |
| --- | --- | --- |
| 静态等待 | 两平台都有原生 `wait` | 保留明确时长的用途，取消“每步必须固定等待”的编写建议 |
| AI 动态等待 | 两平台 Agent 均有 `aiWaitFor()`；两端原生 Node 列表均未暴露 | 首选接入已有 API，不能直接在现有 YAML 填 `aiWaitFor` |
| 输入、滚动、长按、键盘动作 | Core Agent 类型有对应 API；当前 YAML Node 列表未暴露 | 逐平台验证动作支持，再选择性薄适配；当前仍可由 `aiAct` 描述操作 |
| 单次视觉断言、数据读取 | 已有 `aiAssert`、`aiBoolean`、`aiNumber`、`aiString`、`aiAsk` | 区分一次检查与等待；输出进报告不等于 YAML 可动态引用 |
| 生命周期、步骤超时、失败后继续 | YAML 已有 hooks、`$.timeout`、`$.continue-on-error` | 验证失败/取消/清理契约，不新增平行机制 |
| 重试、静态参数 | Runner 有项目级 `retry`、`variables` 及环境变量插值 | 补使用说明与契约测试；不等于已有任意步骤 retry 或运行时变量系统 |
| 多设备 | 已有显式绑定、别名 Node、`device.parallel` | 当前并行组每台设备一个原生调用，完成后汇合；不支持嵌套和子步骤 `$` |
| 报告、资源释放 | 已有 Midscene 报告、`recordToReport`、setup teardown | 增强诊断信息与释放验证，复用现有报告 |

可复查入口：[配置](../midscene.config.ts)、[生成的 Android Node 清单](../midscene-node-reference.android.md)、[Harmony Node 清单](../midscene-node-reference.harmony.md)、[协作节点](../src/nodes/multi-device.ts)、[在途保护](../src/nodes/device-inflight.ts)。锁定依赖中的 `core/dist/types/agent/agent.d.ts`、`core/dist/lib/agent/tasks.js`、`test/dist/lib/midscene/index.js`、`test/dist/lib/index.js` 分别提供 API、等待循环、Node 注册和 Runner 的依据。

Midscene 另有 `tasks/flow` YAML 和 `agent.runYaml()`，不能把其中的能力当作当前 `cases/steps` Node 工作流已支持，也不建议通过嵌套另一个工作流引擎绕过注册缺口。[官方 API](https://www.midscenejs.com/reference/)

## 2. 候选能力与优先级

以下名称均为设计候选，尚未注册。P0/P1 是本能力补齐方向内的顺序，不修改现有 Experience 验证优先级。

| 优先级 | 能力 | 拟采用的入口 | 可复用的运行职责与边界 |
| --- | --- | --- | --- |
| P0 | 自然语言条件等待：出现、消失、状态就绪 | `aiWaitFor` 薄适配 | 委托 Midscene 感知与轮询；prompt 由 Case 提供 |
| P0 | 等待的超时、取消、错误分类、诊断 | 等待 Node + Adapter + 现有 Runner | 统一观测期限、停止新调用、维护设备在途状态和报告关联 |
| P1 | 应用前台、设备在线等确定性等待 | `app.waitForState`、`device.waitForState` | 只读平台状态，减少截图和模型调用；平台不支持时明确报错 |
| P1 | 明确输入、滚动、长按、按键 | `aiInput`、`aiScroll` 等 API 薄适配 | 参数化单个原生动作，保留 Midscene 定位；不复制 Planner |
| P1 | 失败证据 | 自动失败附件；必要时 `device.captureDiagnostics` | 截图、平台状态、日志时间窗、设备身份；复用报告、字段脱敏 |
| P1 | 清理与隔离可靠性 | hooks / setup teardown | 明确失败后的资源释放、清理失败呈现；业务数据复位由 Case 决定 |
| P1 | 参数化与重跑接入 | 项目配置和 Case Authoring | 静态参数优先复用 Runner；整用例重试默认维持关闭，按隔离条件启用 |
| P2 | 元素可见、消失、可交互的确定性等待 | `ui.waitFor`，先做平台探针 | 依赖平台可提供的元素树/定位契约；看见元素不能等同于可以点击 |
| P2 | 界面稳定检测 | `ui.waitForStable` | 连续采样与阈值用于同步；只表明画面变化小，不代表业务成功 |
| P2 | 文件生成、下载完成 | `device.waitForFile` | 文件存在、大小稳定或平台完成事件；设备路径与权限由 Adapter 隔离 |
| P2 | 通用设备环境控制 | 权限、方向、剪贴板、网络开关等有限 Node | 按 Android/Harmony 支持矩阵逐项选择，包含状态快照与恢复契约 |
| P2 | 跨设备事件等待和屏障 | 候选 `device.barrier` / `device.waitForEvent` | 先有真实交接用例，再定义参与者、作用域、超时、取消与事件订阅时机 |
| P2 | 通用观测值传递与比较 | 优先调研 Runner 扩展点 | 需要定义类型、作用域、重试隔离、并行写入、报告脱敏；不先造 `set/get/eval` |
| 后续研究 | 网络请求/响应、Mock、录屏、性能采样 | 平台 Adapter / runner 集成 | Web 浏览器接口不能直接移植到原生移动端；先确认采集路径和适用平台 |
| 暂不纳入 | 任意步骤循环、条件分支、子流程引擎、万能 retry | 优先上游 Runner 或编写层 | 避免演变为自研 Runner；不使用任意 JS eval 构建另一套工作流语言 |
| 暂不纳入 | 自动登录恢复、支付重试、通用弹窗处理、Memory/Skill 扩展 | 业务 Case / 冻结范围 | 本计划不解除 Experience 冻结；生产断言增强另行讨论 |

## 3. 动态等待首批设计

建议先只有一种入口 `aiWaitFor`，出现、消失等都用 Case 条件表达，不拆成大量同义 Node。可复用职责是“在期限内观察指定设备条件”，不能在 Node 内写应用名、业务页面或恢复步骤。

设计示意，**当前不可执行**：

```yaml
# 前提：multi-device 项目已将 DUT1 显式绑定到目标设备。
cases:
  - name: 等待界面就绪
    steps:
      - DUT1.aiWaitFor:
          prompt: 加载指示已消失，搜索输入框已经显示
          timeoutMs: 15000
          checkIntervalMs: 3000
          $:
            timeout: 25000
      - DUT1.aiTap: 搜索输入框
```

这些输入字段是候选契约，最终需经过 schema 和依赖契约验证。顺序步骤优先；当前 `device.parallel` 只从原生 Node registry 解析子调用，新自定义等待节点不会自动获得并行支持。若需要接入，必须明确扩展 registry 的允许范围和对应契约测试。

必须在实施前确定的行为：

1. **复用顺序**：先评估 `createAgentTestRunnerNodes` 等公开适配入口，再补最小 Adapter；不在新节点复制 dump/report/executionId 解析。
2. **两层期限**：`timeoutMs` 是等待机制的预算，`$.timeout` 是 Runner 步骤期限。锁定版本的等待循环会等待模型结果，循环边界也需测试，不能承诺 `timeoutMs` 是严格墙钟上限。上例预留余量只是示意，仍需实测最慢调用。
3. **取消可验证**：不能把 `Promise.race` 返回等同于底层调用停止。检查 SDK 是否支持实际中断；若不能阻止后续轮询，优先推动上游取消支持，或采用经论证的只读感知轮询适配，不直接宣称取消完成。
4. **在途保护**：覆盖单设备与别名设备；底层调用未结束不得发起同设备下一次操作或提前销毁会话。复用现有 `DeviceInFlightGuard` 职责，验证其在单设备接入的缺口。
5. **失败语义**：条件未成立可继续观察；模型鉴权、设备断开、schema 错误不能统一吞成“继续等待”；超时默认失败且停止正常后续步骤。
6. **成本**：AI 轮询会增加截图与模型请求。先测成本再定默认间隔；对设备状态优先使用确定性探针。固定节流、明确持续时长和对照测试仍可以使用静态 `wait`。
7. **诊断**：至少记录条件、设备、耗时、成功/超时/取消/观测错误和最终可获得的截图。轮次和模型调用次数只在 Adapter 可可靠获得时输出，未知值不能记为零。
8. **等待不重做动作**：观察条件时不点击、刷新或重新提交；不使用“重做前一步直到成功”替代等待。

“最终成立一次”“连续稳定一段时间”“全程保持成立”“动作前满足可交互条件”是不同契约。首批只解决第一种；持续行为与业务断言增强不随本次顺带上线。

## 4. 分批实施与验收

| 阶段 | 交付内容 | 完成条件 |
| --- | --- | --- |
| A：契约盘点 | Agent API / YAML Node / 平台支持三列矩阵；核对已有配置能力 | 明确哪些是薄适配、哪些需要新增 Runtime、哪些仅需文档；锁定取消与报告接入路线 |
| B：最小动态等待 | `aiWaitFor` schema、适配与注册，单设备与设备别名；错误和诊断 | 验证初始成立、延迟成立、永不成立、模型超时/错误、取消、设备断开；取消后无新轮询，同设备无重叠 I/O |
| C：低成本补齐 | 优先应用/设备状态探针，再补选定的明确动作和失败证据 | 两平台支持矩阵；未支持能力明确失败；资源和附件清理可验证 |
| D：场景驱动扩展 | 从实际用例选文件、稳定检测或事件协作中的必要项 | 每个新增 Node 有独立可复用职责和真实使用场景；无业务策略、无新 Runner |

阶段 B 验证分三层：受控测试验证状态机与异常路径；锁定依赖契约测试验证 Node 注册、报告关联、取消和在途行为；Android/Harmony 真实设备 + 真实模型记录等待耗时、请求数、失败原因与样本范围。对照静态等待时覆盖快就绪、慢就绪和永不就绪，统计实际耗时与结果，不能预先承诺 AI 等待更快或更便宜。

涉及执行行为时运行类型检查与相关测试；阶段结束再做必要工程回归。新增可运行演示放 `examples/`，夹具放 `tests/fixtures/`；现有配置只发现 `cases/`，因此必须给演示提供明确运行入口，不能声称默认会收集。文档推荐 DUT1/DUT2/DUT3 并显式绑定，不改变兼容默认 alias。

落地时更新 YAML 指南、Node 参考生成结果及 README 当前能力；未来工作链接进入 Roadmap。真实验证后再向 Acceptance 追加带日期、环境、覆盖范围的独立记录。本讨论稿没有修改执行代码、当前能力声明或历史验收统计。
