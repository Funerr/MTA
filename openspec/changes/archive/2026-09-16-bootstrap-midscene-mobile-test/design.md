## Context

本项目当前只有规划文档。框架目标和范围见 proposal.md；本阶段交付工程与原生接入能力。使用方负责具体测试意图、业务数据、步骤编排和业务结果验收。

之前核对的官方入口保留用于实施时复核：[项目创建](https://www.midscenejs.com/midscene-test/use)、[项目配置](https://www.midscenejs.com/midscene-test/configuration)、[自定义 Nodes](https://www.midscenejs.com/midscene-test/extend)、[Android API](https://www.midscenejs.com/reference/)。以最终锁定版本的模板、包导出和类型为准。

## Goals / Non-Goals

**Goals:**

- 建立薄的 setup、Node 注册与框架接入层，运行控制权由 Midscene 持有。
- 配置加载、安装、类型检查、Node 参考和框架测试无需连接设备或填写实际模型密钥。
- 用接口契约、错误注入和原生集成测试验证框架，而不把业务用例交付混入验收。

**Non-Goals:**

- 不编写或维护具体业务 YAML、设备业务流程与业务通过条件。
- 不实现自研 Agent、Runner、Planner、Report 或新的设备动作体系。
- 本阶段不实现 Experience、跨设备调度、全状态恢复或自动解锁。

## Decisions

### 1. 整合官方脚手架，保留使用方接入位置

在临时目录生成官方 Android 模板，再把必要工程文件整合到项目根目录。保留 openspec/，移除模板中与框架交付无关的应用示例。预留 cases/ 供使用方接入，不将其中必须存在具体 YAML 作为验收项。

src/setup/android.ts 负责原生环境接入；src/nodes/ 包含通用节点与注册；src/experience/ 和 experiences/ 仅以占位文件保留。tests/ 保存框架测试和 fixtures，midscene_run/ 保存原生运行产物。生产配置的文件发现范围不包含 tests/。

pnpm test 用于框架自身的测试；pnpm run typecheck 与 pnpm run nodes 检查工程和生成能力参考。提供直接调用官方 CLI 的 test:cases 脚本供使用方使用，不自行处理 YAML 或调度。无业务用例时不为了脚本“跑通”自动生成业务流程。

### 2. 设备会话只在执行期初始化

setup 使用官方设备枚举能力，优先 ANDROID_DEVICE_ID，否则仅接受唯一已授权在线设备。选择歧义、目标离线/未授权和 ADB 不可用明确报错。设备连接与必要模型配置检查放在执行期，模块导入不产生设备或模型调用。

同一执行项目通过 context 持有一套设备/Agent。Agent 接管设备后由原生 destroy 统一释放；接管之前初始化失败则清理已取得资源，避免泄漏与双重销毁。首期配置一个执行项目、并发为 1；不创建自己的设备池。

### 3. 原生 Nodes 与通用生命周期能力

通过锁定版本官方工厂注册 AndroidAgent 的 Nodes，保留 aiAct、aiAssert 的原生参数与错误契约。两个通用节点使用官方 defineNode 和输入校验：device.prepare 严格接受 { target: home }，device.recover 严格接受 {}，均调用当前 Agent 的原生 Home 能力。

它们只提供可被上层生命周期调用的框架能力，不负责设置任何业务起点、检查业务结果或还原业务状态。原生执行失败直接传播，超时和重试交给 Midscene；Project teardown 与返回 Home 的节点调用各自负责连接清理和 UI 导航。

### 4. 框架验证分层

- 工程检查：锁文件安装、类型检查、无设备/密钥下加载配置及生成 Node 参考。
- 项目新增逻辑测试：设备选择、输入约束、context 使用、初始化失败清理、重复释放保护与异常传播。
- 原生边界集成：加载实际锁定的 Midscene 包及官方 Node 定义，用受控设备/模型边界替身验证参数转发、原生生命周期与报告关联。最小 YAML 如确有需要，只作为 tests/fixtures/ 中的注册/解析夹具，不表达手机业务流程。
- 可选环境检查：有设备时可以验证连接、截图和释放等单能力接入，但不要求提交业务用例或业务执行结果，也不作为后续 Change 的硬前置。

纯 mock 测试不能证明真实设备效果；验证报告准确标明覆盖到类型、原生集成、替身或真实设备的哪一层。框架完成条件是规定的工程、契约和原生边界测试通过。

### 5. 原生报告与使用说明

框架接入现有报告位置和记录接口，不解析或重组 HTML。用框架集成测试验证自定义节点失败、原生异常和清理信息能够保留在原生结果中。

README 描述安装、配置、可注册能力、使用方用例目录和官方运行入口；不内置业务流程。实际 .env、node_modules/ 与运行产物加入忽略规则，.env.example 只包含无密钥的配置说明。

## Risks / Trade-offs

- [官方接口随版本变化] → 锁定依赖，通过实际包契约测试复核注册与资源所有权。
- [替身掩盖集成错误] → 至少一层测试加载真实 Midscene 包，替换边界依赖而不重写其定义；区分已测接口与未测硬件行为。
- [Home 被误解为完整恢复] → Node 参考明确它只是原生导航能力，业务状态恢复由上层另行提供。
- [业务流程侵入框架验收] → tests/ 与使用方 cases/ 分开，验收表只记录框架行为和接口证据。

## Migration Plan

按脚手架、setup、Node 接入、框架测试和文档顺序实施。没有业务用例或数据迁移。完成规定验证后进入 add-experience-model；可选真实设备检查单列记录，不阻塞框架阶段交付。
