## Why

建立基于 Midscene Test 和 Midscene Android 的框架工程基础，为后续 Experience 提供设备会话、原生能力接入、生命周期和报告接口。框架交付应以这些接口与行为的可靠性为标准，业务测试意图、步骤和验收条件由使用方定义。

## What Changes

- 从官方 Android 脚手架建立 TypeScript/pnpm 工程，锁定兼容依赖并保留现有 OpenSpec 规划。
- 建立 src/setup/、src/nodes/，预留 src/experience/、experiences/ 和使用方 cases/ 接入目录。
- 接入 AndroidDevice/AndroidAgent 的初始化、设备选择和资源释放；首期保持单设备串行配置。
- 注册原生 Nodes 和通用 device.prepare / device.recover 节点，准备与恢复的首期能力为返回 Home。
- 提供无设备即可执行的工程检查、框架契约测试、生成的 Node 参考和使用方接入说明。
- 使用原生报告能力，通过隔离的框架集成夹具验证错误、生命周期和报告关联。
- 不交付具体业务 YAML、业务场景库或业务执行结果；不要求执行某个手机业务流程作为本 Change 的完成条件。
- Experience 实现、aiAct 透明接入、断言研究与 HarmonyOS 支持仍归后续 Change。

## Capabilities

### New Capabilities

- `midscene-android-project`: 框架工程、设备会话、原生 Node 与报告接入及使用方接口。
- `device-lifecycle-nodes`: 通用设备准备和恢复节点的输入、调用及失败行为。

### Modified Capabilities

无。当前没有已发布主规格；移除此前尚未实施的业务示例能力规划。

## Impact

新增工程配置、依赖锁文件、Android setup、通用 Node 及框架测试。cases/ 仅预留给使用方，框架测试夹具放在独立测试目录且不进入默认业务发现范围。

实际设备使用仍依赖 ADB、目标设备与所需模型配置；这些是运行条件，不是要求框架开发交付业务用例。框架验收记录明确区分接口验证和可选的真实设备接入检查，不宣称未测量的业务或跨设备效果。

Runner、YAML 解析、调度、超时/重试、Agent、Planning、Locate、原生动作、截图与报告继续使用 Midscene。后续从 add-experience-model 开始实现经验能力。
