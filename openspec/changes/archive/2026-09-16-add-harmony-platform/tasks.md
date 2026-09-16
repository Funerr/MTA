## 1. 依赖与公共会话层

- [x] 1.1 增补 `@midscene/harmony@1.12.7` 锁定依赖并在 docs/dependency-versions.md 记录实测导出（HarmonyAgent/HarmonyDevice/getConnectedDevices、无状态字段、agentFromHdcDevice 静默选首台、HarmonyAgent#home/destroy 语义）；验证 pnpm install --frozen-lockfile 与 typecheck 通过。
- [x] 1.2 提取 `src/setup/session.ts`（`DeviceLike`、`bindAgentToDevice`、`SessionHandle<A>` 单次释放句柄），android.ts 改为复用且公开行为不变；验证既有 Android 单测全部回归通过。

## 2. HarmonyOS 会话与双项目接入

- [x] 2.1 实现 `src/setup/harmony.ts`：`selectHarmonyDevice`（指定精确匹配/唯一在线目标/零台与多台报错并列出目标）、`createHarmonySession`（HDC 枚举失败包装为可定位错误并保留 cause、连接失败清理）、`createHarmonyProjectSetup`（setup 输出所选 deviceId，teardown 单次释放）；用枚举/连接替身验证指定、唯一、多台、零台、HDC 失败与部分初始化清理行为。
- [x] 2.2 `midscene.config.ts` 改为双执行项目：android/harmony 各自项目本地注册 `createMidsceneNodes` 节点集，全局仅保留 `frameworkNodes`，两项目分别发现 `cases/android/`、`cases/harmony/` 并排除 `tests/**`；`device.prepare`/`device.recover` 的 context 改为结构化 `{ agent: { home() } }` 以兼容两平台。
- [x] 2.3 拆分 `cases/android/` 与 `cases/harmony/` 目录（各含使用方 README），更新 cases/ 根 README；检查无业务 YAML 交付且 `tests/` 不进入任何平台发现范围。
- [x] 2.4 `.env.example` 增补 `HARMONY_DEVICE_ID` 与 `HDC_HOME`/模型说明；验证配置加载与 Node 参考生成仍不需要设备或真实密钥。

## 3. 验证与文档

- [x] 3.1 边界集成测试升级：加载真实配置断言双项目结构（android 含 `runAdbShell`、harmony 含 `runHdcShell`、同名节点各自解析、全局 lifecycle 节点共享）、aiAct/aiAssert 契约不变，并用 Harmony Agent 替身跑通生命周期夹具（准备/步骤/恢复、失败与超时传播）。
- [x] 3.2 无设备/密钥条件下全量运行 pnpm install --frozen-lockfile、pnpm run typecheck、pnpm run nodes、pnpm test；记录结果并确认没有业务用例执行前提。
- [x] 3.3 审查代码仅接入两平台原生 Agent/Runner/动作/报告且无 Experience 实现；以导入与注册检查为完成依据。
- [x] 3.4 更新 README（双平台安装/配置/用例目录/运行入口）与 docs/acceptance.md（覆盖分层与可选鸿蒙设备检查单列）；不以真实设备流程阻塞本 Change。
