## Why

框架使用方需要覆盖 HarmonyOS（鸿蒙）设备，而当前工程只接入 Android。bootstrap 阶段已把 HarmonyOS 明确留给后续 Change；官方 `@midscene/harmony` 与既有锁定版本同列发布（1.12.7），`HarmonyAgent`/`HarmonyDevice` 与 Android 侧同构（同一幂等 `Agent#destroy` 基类、同样的 `home`/`back` 能力），扩展条件已经成熟。

## What Changes

- 新增锁定依赖 `@midscene/harmony@1.12.7`，新增 `src/setup/harmony.ts`：基于官方 `getConnectedDevices()`（仅返回 `{ deviceId }`，无授权状态字段）实现确定性选择——`HARMONY_DEVICE_ID` 精确匹配，未指定时仅接受唯一在线目标；枚举失败（HDC 不可用）与连接失败均给出可定位错误并清理已取得资源。官方 `agentFromHdcDevice` 会静默选第一台，不予采用。
- 会话机制抽公共层（接管前清理、单次释放、执行期初始化），Android 与 HarmonyOS 各自保留平台特定选择逻辑与错误类型。
- `midscene.config.ts` 改为双执行项目：`android` 与 `harmony` 串行执行；两平台同名原生 Nodes（`launch`/`terminate`/`back`/`home`/`recentApps`/`aiAct` 等）通过项目本地 nodes 按平台注册，避免全局同名冲突；鸿蒙侧原生 shell 节点为 `runHdcShell`。
- 业务用例目录按平台拆分：`cases/android/`、`cases/harmony/`，各项目只发现自己的目录。
- `device.prepare` / `device.recover` 输入契约与 Home 基线语义不变，由两平台共用（context 中的 Agent 都具备原生 `home`）。
- `.env.example` 增加 `HARMONY_DEVICE_ID` 与 `HDC_HOME` 说明；README、验收记录、依赖版本记录同步更新。
- 不含 Experience 实现、跨平台并行调度或设备池；无业务 YAML 交付。

## Capabilities

### New Capabilities

- `midscene-harmony-project`：HarmonyOS 设备会话、确定性选择、项目接入与原生节点注册。

### Modified Capabilities

- `midscene-android-project`：工程与能力发现升级为双项目/双用例目录，Node 参考同时包含两平台原生节点；Android 侧设备选择、会话生命周期与报告契约不变。
- `device-lifecycle-nodes`：两个生命周期节点的需求表述改为跨平台（当前绑定设备为 Android 或 HarmonyOS），输入契约与失败行为不变。

## Impact

- 工程：新增一条锁定依赖与 `src/setup/harmony.ts`，会话公共层小规模重构（`bindAgentToDevice`/释放句柄提取到共享模块，Android 公开行为不变）；配置改为双项目，`cases/` 目录按平台拆分（当前无使用方用例，无迁移负担）。
- 测试：Android 既有测试断言随用例发现范围更新；新增 HarmonyOS 选择/会话单测与双项目边界集成测试。
- 运行条件：鸿蒙用例执行依赖本机 HDC（可用 `HDC_HOME` 指定）与已连接鸿蒙设备；安装、类型检查、框架测试与 Node 参考生成仍不需要任何设备或密钥。
- 不重建 Runner/报告；Experience 相关 Change 不受影响。
