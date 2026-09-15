## Context

bootstrap 阶段已建立单 Android 项目的会话与 Node 接入层（`src/setup/android.ts`、`src/nodes/`、`midscene.config.ts`），主规格已同步。本变更加入 HarmonyOS 双平台支持。

已核对的官方事实（`@midscene/harmony@1.12.7` 安装产物实测，见 docs/dependency-versions.md 的增补）：

- 导出 `HarmonyAgent`、`HarmonyDevice`、`getConnectedDevices`、`agentFromHdcDevice`；`HarmonyAgent extends Agent<HarmonyDevice>`，与 `AndroidAgent` 共享同一幂等 `Agent#destroy()`（级联销毁设备并落盘报告）。
- `getConnectedDevices(hdcPath?)` 返回 `Promise<{ deviceId: string }[]>`——**无授权状态字段**；内部 `hdc list targets` 已过滤空行与 `[...]` 特殊条目。
- `HarmonyAgent` 具备 `home`/`back`/`recentApps` 包装动作与 `launch`/`terminate`/`runHdcShell`；无 `runAdbShell`。
- `agentFromHdcDevice(deviceId?)` 与 Android 版一样在未指定且多台时**静默选第一台**，不满足确定性选择要求。
- `HDC_HOME` 环境变量由包自身读取用于定位 hdc 二进制（另有 `hdcPath` 构造选项）；无官方 `HARMONY_DEVICE_ID` 约定。
- `createMidsceneNodes({ agentClass: HarmonyAgent })` 可注册鸿蒙原生节点集；`ExecutionProjectDefinition.nodes` 支持项目本地节点按同名覆盖全局节点。

## Goals / Non-Goals

**Goals:**

- 双执行项目（android/harmony）串行接入，同名原生节点按平台互不覆盖。
- HarmonyOS 会话与 Android 同等语义：确定性选择、执行期初始化、单次释放、部分失败清理、错误可定位。
- 工程检查、框架测试与 Node 参考生成仍不需要设备/密钥。
- Android 既有公开行为与规格语义不变（仅用例发现目录随目录拆分调整）。

**Non-Goals:**

- 不实现跨平台并行调度、设备池或多设备会话。
- 不自研 Agent/Runner/Planner/报告；不引入 Experience 实现。
- 不交付业务 YAML；不验证真实硬件效果。

## Decisions

### 1. 会话公共层提取，平台各自保留选择语义

把 `bindAgentToDevice`（接管前清理）与释放句柄提取到 `src/setup/session.ts`（`DeviceLike`、`bindAgentToDevice`、`SessionHandle<A>` 泛型，按会话对象持有 id 与 agent，release 至多一次）。`android.ts` 保持现有公开 API（`AndroidSessionHandle` 变为 `SessionHandle<AndroidSession>` 的薄子类），选择逻辑（`state` 过滤、授权判断）留在 android.ts。

新增 `src/setup/harmony.ts`：`HarmonySessionSetupError`、`selectHarmonyDevice`（指定 → 精确匹配，否则唯一在线目标；零/多台报错并列出目标）、`createHarmonySession`（枚举失败包装为可定位错误并保留 cause）、`createHarmonyProjectSetup`（复用 `defineProjectSetup`，setup 成功输出所选 deviceId）。不抽取跨平台“通用选择器”——Android 的状态过滤与鸿蒙的无状态模型语义不同，强行统一会造出错误的抽象。

### 2. 双执行项目 + 项目本地节点，规避同名冲突

两平台原生节点集存在大量同名节点（`launch`/`home`/`aiAct`…），不能同时进全局 `nodes`（会 `DuplicateNodeError` 或语义冲突）。采用官方项目本地覆盖机制：

- 全局 `nodes`：仅 `frameworkNodes`（`device.prepare`/`device.recover`，context 为结构化 `{ agent: { home() } }`，两平台上下文均结构兼容）。
- `projects[android].nodes`：`createMidsceneNodes({ agentClass: AndroidAgent, getAgent })`。
- `projects[harmony].nodes`：`createMidsceneNodes({ agentClass: HarmonyAgent, getAgent })`。
- `test.maxConcurrency: 1` 维持全局串行；两项目各自 `cases/android|harmony/**/*.{yaml,yml}` 发现范围，显式排除 `tests/**`。

### 3. 环境变量与目录约定

- `HARMONY_DEVICE_ID` 镜像 `ANDROID_DEVICE_ID` 的框架级约定（官方无此变量，语义由框架 setup 实现）。
- `HDC_HOME`、`MIDSCENE_ADB_PATH` 等定位变量由原生包自身读取，`.env.example` 只做说明。
- `cases/` 拆分为 `cases/android/`、`cases/harmony/`（各自 README 说明）；当前无使用方用例，无迁移负担。

### 4. 验证分层沿用 bootstrap 方案

工程检查（无设备/密钥）→ 平台逻辑单测（枚举/连接替身）→ 原生边界集成（加载真实配置与两平台实际节点定义，Agent 边界替身注入，验证各项目节点解析、同名不覆盖、生命周期与失败传播）→ 验收记录区分替身与真实设备证据。真实 HDC/鸿蒙设备检查单列，不阻塞。

## Risks / Trade-offs

- [鸿蒙枚举无授权状态] → 连接问题推迟到 `connect()` 暴露；会话建立整体失败并清理，错误信息包含 deviceId 与 HDC 上下文，可定位。
- [项目本地节点被全局同名遮蔽的反向担忧] → 集成测试断言两项目各自解析到对应平台的 `runAdbShell`/`runHdcShell`，同名节点在双方项目均可用。
- [公共层重构波及 Android 已验证行为] → Android 公开 API 与既有单测保持不变，`bindAgentToDevice` 语义原样迁移，回归由既有测试保障。
- [官方包演进] → 依赖锁定 1.12.7，版本核对记录增补鸿蒙条目。

## Migration Plan

1. 提取 `src/setup/session.ts` 公共层，android.ts 改为复用（行为不变，既有测试回归）。
2. 新增 harmony.ts 与双项目配置，拆分 cases 目录。
3. 补鸿蒙单测与双项目边界集成测试，更新 android 集成断言与工程脚本检查。
4. 更新 `.env.example`、README、验收与版本记录；全量无设备验证后交付。
