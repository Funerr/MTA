## Why

现有 Android 与 HarmonyOS 执行项目各绑定一台设备，适合独立用例，但使用方以 YAML 为主要用例载体，无法在同一用例中明确交错或同时操作多台设备。改用 TypeScript Agent API 会把设备连接、异步编排和清理负担转给用例作者，因此需要在 Midscene Test 的官方项目与自定义 Node 扩展机制内提供可复用的多设备 YAML 能力。

## What Changes

- 保留现有单设备 YAML 项目，按官方 Execution Project 机制支持不同设备运行独立用例；设备必须显式绑定，避免并发项目抢占同一设备。
- 新增多设备协作执行项目：在项目配置中声明任意设备别名、平台和设备标识，执行期建立各自的官方 Agent，并将用例发现范围与现有项目隔离。
- 在协作项目中，为设备别名提供可在 YAML 中调用的目标设备 Node；顺序步骤可交错操作不同设备，原生 Node 的输入和执行行为尽量复用。
- 使用官方 `defineNode` 扩展一个边界明确的并行步骤，使同一 YAML 用例能同时发起不同设备上的操作并等待全部完成；将设备、子操作和失败信息纳入用例结果。
- 明确初始化失败、超时、取消、清理、报告关联和与现有单设备用例的兼容要求。此变更不修改 Midscene 依赖源码或其 YAML 解析器。

## Capabilities

### New Capabilities

- `multi-device-yaml-workflows`: 多设备绑定、YAML 目标路由、交错与并行执行、失败清理和报告可追踪性。

### Modified Capabilities

无。现有单设备项目的设备选择、原生 Node 契约和用例发现要求保持不变。

## Impact

- 主要涉及 `midscene.config.ts`、`src/setup/`、`src/nodes/`、Node 参考生成、用例目录说明与框架验收测试。
- 复用锁定版本的 `@midscene/test`、`@midscene/android`、`@midscene/harmony`；不新增运行器依赖。
- 新的 YAML 约定仅在多设备协作项目生效；现有 `cases/android/`、`cases/harmony/` 用例无需迁移。
