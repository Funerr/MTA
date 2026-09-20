# 自动化框架能力借鉴调研

访问日期：2026-09-18。本文仅使用官方文档与官方仓库；外部框架的能力不表示 MTA 已支持。落点建议是结合 [MTA 架构](../ARCHITECTURE.md) 的设计推断，尚未实现或完成设备验收。各框架文档使用 latest 等滚动入口，落地时仍须验证 MTA 锁定版本与平台实际契约。

## 结论

优先借鉴“条件满足即继续、超时明确失败”的等待语义，再补齐取消、超时预算、清理和失败证据。能力的名称不应决定它一定是 Node：定位、视觉判断和动作执行优先复用 Midscene；会话和通用观测适合 Runtime；参数化、用例重跑、业务流程属于 Case 或现有 Runner 接入层。

“动态等待”“动作自动就绪”“断言重试”“整段动作重试”是不同能力，必须分开设计。读取状态的重试不会天然授权重复点击、提交或发送消息。画面静止、元素可见、设备在线、业务成功也不是同一条件。

## 官方能力及适用边界

| 能力组 | 外部框架已提供的能力与官方来源（均访问于 2026-09-18） | MTA 可借鉴的方向及边界 |
| --- | --- | --- |
| 条件等待 | Selenium 的显式等待按条件轮询，条件满足立即返回，超时失败；隐式等待作用于元素查找，官方不建议混用隐式和显式等待。[Waiting Strategies](https://www.selenium.dev/documentation/webdriver/waits/)；Maestro `extendedWaitUntil` 等待 visible/notVisible，支持最大超时。[extendedWaitUntil](https://docs.maestro.dev/api-reference/commands/extendedwaituntil) | 首先核实 Midscene 原生等待能否直接注册、转发或在编写入口暴露。只有原生能力不足时，才封装通用观察条件的 Runtime Node。默认有限超时，禁止隐含叠加多层无限等待。 |
| 动作就绪与稳定 | Playwright 在动作前检查相应 actionability，例如 click 所需的可见、稳定、接收事件、启用状态。[Auto-waiting](https://playwright.dev/docs/actionability)；Maestro 提供 `waitForAnimationToEnd`，其文档规定到达超时后仍继续执行。[waitForAnimationToEnd](https://docs.maestro.dev/reference/commands-available/waitforanimationtoend) | 借鉴动作前验证，不能把浏览器 DOM 条件直接照搬到原生移动端。视觉稳定检测至多证明画面变化收敛；不证明业务完成。严格条件等待超时应失败，若另设 best-effort 稳定等待须清晰区分，不能静默混用。 |
| 轮询断言 | Playwright 有自动重试的异步断言、`expect.poll` 和 `expect.toPass`；普通同步断言不会自动重试。[Assertions](https://playwright.dev/docs/test-assertions)；Robot Framework BuiltIn 提供 `Wait Until Keyword Succeeds`。[BuiltIn](https://robotframework.org/robotframework/latest/libraries/BuiltIn.html#Wait%20Until%20Keyword%20Succeeds) | 通用机制只重复观察，业务期待由 Case 提供。视觉、设备状态等条件共用预算、取消和报告，不给每个业务结果新增 Node。AI 观察需要计入单次调用时长与调用成本。 |
| 失败重试 | Playwright Test 支持测试重跑，失败后丢弃 worker 进程，重试在新的 worker 中执行，并区分 flaky。[Retries](https://playwright.dev/docs/test-retries)；Maestro `retry` 可重试命令块。[retry](https://docs.maestro.dev/reference/commands-available/retry) | 区分查询重试、动作重试、整例重跑。整例重跑交给现有 Runner 配置或接入，不能写一个 Node 内循环执行任意 YAML 来重建 Runner。副作用动作需要 Case 明确的幂等前提和状态校验；取消或结果未知不能触发自动补做。 |
| 初始化、隔离与清理 | Playwright Test fixture 封装测试所需资源与 setup/teardown，并支持测试或 worker 作用域。[Fixtures](https://playwright.dev/docs/test-fixtures)；Maestro `onFlowComplete` 在 Flow 成功或失败后运行。[Hooks](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/hooks)；Robot Framework 提供 suite/test/keyword setup 与 teardown。[User Guide](https://robotframework.org/robotframework/latest/RobotFrameworkUserGuide#test-setup-and-teardown) | 设备占用、Agent 释放、监听器注销属于 setup/Runtime。登录、业务造数、订单清理属于 Case。需要验证失败和取消路径下的释放，不把流程末尾普通 cleanup 步骤等同于可靠 teardown。 |
| 参数化与复用 | Playwright 支持测试与项目参数化。[Parameterize tests](https://playwright.dev/docs/test-parameterize)；Maestro 支持命令行参数、env 常量及对子流程传参。[Parameters and constants](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants)；Robot Framework 提供 test templates。[User Guide](https://robotframework.org/robotframework/latest/RobotFrameworkUserGuide#test-templates) | 数据表、模板、子流程优先属于 Case Authoring，设备矩阵属于现有项目配置。不要为了复用“登录”“购买”等流程把业务步骤固化为 Node。 |
| 并行与多设备 | Playwright Test 提供独立 worker 并行。[Parallelism](https://playwright.dev/docs/test-parallel)；Appium 支持多个服务进程或单服务中的多个 driver session，具体并发能力依赖 driver。[Appium 官方仓库](https://github.com/appium/appium)；Maestro 提供设备选择与 shard 分配。[Specify and start devices](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/specify-and-start-devices) | 套件分片与一次用例中的跨设备协作应分开。沿用 MTA 现有协作机制；通用资源互斥、限时会合可以评估为 Runtime 增强。外部框架支持并行不证明其提供跨设备业务屏障。 |
| 生态扩展与原生边界 | Robot Framework 官方并行指南使用 Pabot；它是独立并行 runner，不能表述为 Robot 核心原生并行调度。[Running tests in parallel](https://docs.robotframework.org/docs/parallel)；Appium 的扩展能力由会话 capabilities 与具体 driver 共同决定。[Session Capabilities](https://appium.io/docs/en/latest/guides/caps/) | 不把生态插件和 driver 特有能力统称“框架普遍原生支持”。在 MTA 中也应区分 Midscene 原生、MTA 封装、平台限定、编写入口未暴露。 |
| 事件与网络观察 | Playwright 支持事件监听和等待，可先订阅再触发动作；网络 API 提供 request/response 观察及路由拦截。[Events](https://playwright.dev/docs/events)、[Network](https://playwright.dev/docs/network)；Selenium WebDriver BiDi 支持浏览器事件流。[WebDriver](https://www.selenium.dev/documentation/webdriver/) | 可借鉴通用订阅、过滤、超时、注销模型。先确认移动平台可观测源，不能默认所有 App 流量都能观察或 mock。等待短暂事件必须避免动作完成后才订阅；需要接入契约支持，不另建调度器。 |
| 证据与运行诊断 | Playwright Trace Viewer 可查看动作、快照和网络等轨迹。[Trace viewer](https://playwright.dev/docs/trace-viewer)；Appium Event Timings 记录会话及命令耗时，是可查询的时序信息，并非通用网络事件订阅。[Retrieving Event Timings](https://appium.io/docs/en/latest/guides/event-timing/) | 复用 Midscene 报告，在现有适配边界增加等待耗时、尝试次数、最后观测和超时证据。事件时序不能冒充业务断言；不得在新 Node 散落 dump/report/executionId 解析。 |
| 超时与中止 | Playwright 区分测试、断言及 fixture 等超时。[Timeouts](https://playwright.dev/docs/test-timeouts)；Robot Framework 支持测试和 keyword 超时。[User Guide](https://robotframework.org/robotframework/latest/RobotFrameworkUserGuide#timeouts) | 等待与观察继承现有 Runner 的取消及剩余预算。超时返回与底层执行实际终止是两个问题；必须验证取消后不追加动作、事件监听释放和设备占用恢复，不能只用 Promise.race 宣称已经取消。 |

## 推荐进入能力规划的项目

下列名称均为能力候选描述，不是当前 MTA YAML 语法。优先级按依赖排序，不是工期承诺。

| 顺序 | 能力候选 | 建议落点 | 进入实施的前提与验收重点 |
| --- | --- | --- | --- |
| P0 | 原生条件等待入口补齐 | Midscene 原生 Node 注册、alias 适配、文档与编写入口 | 核查锁定版本；区分真正缺失与已有但未暴露。成功提前结束，超时明确失败，多设备 alias 正确。 |
| P0 | 有界等待、取消传播、失败证据 | 现有 Runtime 与 Adapter | 复用 Runner 信号；一次观察不重叠；取消后停止后续观察/动作；报告保留最后观测。 |
| P1 | 设备/会话状态等待 | 通用 Runtime Node 候选 | 有稳定平台查询接口；条件不包含业务含义；Android/HarmonyOS 分别验证支持范围。 |
| P2 / 后续研究 | 界面稳定同步、持续条件与轮询断言 | 原生等待增强或观察适配 | 稳定同步可评估为通用观测；持续行为和生产断言增强不纳入首批，需另行确认范围。明确“一次满足”与“连续满足”，不把视觉观察升级为规划器。 |
| P1 | 失败及取消清理收口 | setup 与现有执行生命周期 | 生命周期有对应扩展点；保留原始失败，另记清理失败；反复释放无害。 |
| P2 | 设备互斥、限时屏障、协作诊断 | 现有多设备 Runtime | 已有并行节点不足且场景明确；同设备竞争、参与者失败、超时和取消均能退出。 |
| P2 | 通用事件等待 | 平台 Adapter + Runtime Node 候选 | 先有真实事件源、先订阅语义与取消契约；不默认平台网络抓包能力。 |
| P2 | 参数化、可复用流程、测试矩阵 | Case Authoring 与现有 Runner 配置 | 不自研 Runner；生成的执行工作流仍由 Midscene 运行。 |
| 后续评估 | 重试策略、网络 mock、性能及截图基线 | 现有 Runner/平台工具接入及 Case | 先有隔离、证据、明确的副作用与支持矩阵。不能作为本轮通用 Node 大包交付。 |

本轮不建议扩展 Experience Memory、Skill 或通用 Recovery，也不引入业务登录、业务成功判断、自动恢复购买流程等 Node。以上限制来自当前项目架构，不是外部框架功能缺失。

结合本地锁定依赖后的具体取舍、候选 YAML 与分阶段验收见 [能力补齐计划](automation-capability-plan.md)。
