# 依赖版本核对记录

核对日期：2026-09-15。本记录对应任务 1.1（核对官方 Android 模板、Midscene 包导出和资源接口，锁定兼容版本）。

## 锁定版本

| 依赖 | 锁定版本 | 用途 |
| --- | --- | --- |
| `@midscene/test` | `1.12.7` | 官方测试 CLI（`midscene-test`）、`defineNode`、`defineTestProject` / `defineProjectSetup`、`createMidsceneNodes` |
| `@midscene/android` | `1.12.7` | `AndroidDevice` / `AndroidAgent` / `getConnectedDevices` / `agentFromAdbDevice` |
| `zod` | `^3.25.76` | Node `inputSchema`（必须从 `zod/v4` 子路径导入，与 `@midscene/test` 内部一致） |
| `@midscene/core` | `1.12.7` | Experience Promotion 直接消费 `Agent.dump`、`callActionInActionSpace`、`TaskExecutor.runPlans`、`createDefaultMobileActions` |
| `sharp` | `0.34.5` | Experience Promotion / Matcher 图像管线 `png-sharp@1`（解码/裁剪/重编码） |
| `dotenv` | `^16.4.5` | 官方模板同款 `.env` 加载 |
| `typescript` | `^5.8.3` | 类型检查（`tsc --noEmit`） |
| `@types/node` | `^20.0.0` | 官方模板同款 |
| `vitest` | `^5.0.1` | 框架自身测试运行器（Node `^22.12.0 || ^24.0.0 || >=26.0.0`，与本工程 engines 兼容） |

Node engines 采用官方模板要求：`^20.19.0 || ^22.12.0 || >=24.0.0`。

## 官方来源

- 项目创建（`pnpm dlx @midscene/test create --platform android --package-manager pnpm`）：https://www.midscenejs.com/midscene-test/use
- 项目配置（`defineTestProject` / `projects` / `files.include` / `test.maxConcurrency` / `output.reportDir`）：https://www.midscenejs.com/midscene-test/configuration
- 自定义 Nodes（`defineNode` / `inputSchema` / `onTeardown` / `Node 参考生成`）：https://www.midscenejs.com/midscene-test/extend
- Android 集成（`AndroidDevice` / `AndroidAgent` / `getConnectedDevices` / ANDROID_DEVICE_ID）：https://www.midscenejs.com/platforms/android.html

版本核对方式：在临时目录生成官方 Android 模板（`@midscene/test@1.12.7`），直接读取安装产物中的 `package.json` 与 `dist/types/*.d.ts`，比文档描述优先。

## 已核对的导出与类型契约（1.12.7 实测）

- `@midscene/test` 根入口：`defineNode`、`NodeExecutionContext`（`input` / `$` / `signal` / `context` / `onTeardown` / `report`）、`NodeInputValidationError`。`inputSchema` 类型为 `zod/v4` 的 `z.ZodObject`。
- `@midscene/test/config`：`defineTestProject`（`projects[].{name,setup,files,nodes}`、`test.{maxConcurrency,bail,testTimeout}`、`output.reportDir`）、`defineProjectSetup`（`setup({ env, signal, project, onTeardown })`）。
- `@midscene/test/midscene`：`createMidsceneNodes({ agentClass, getAgent })` —— 传入 `AndroidAgent` 后注册 `aiAct` / `aiAssert` / `launch` / `terminate` / `runAdbShell` / `back` / `home` / `recentApps` 等原生 Nodes。
- `@midscene/android`：`getConnectedDevices(): Promise<{ udid, state, port? }[]>`（`state` 与 `adb devices` 输出一致，授权在线为 `device`）；`AndroidDevice#destroy()` 与 `Agent#destroy()` 均幂等（内部 `destroyed` 标记），`Agent#destroy()` 会级联销毁底层设备并落盘报告。
- `AndroidAgent#home` / `#back` / `#recentApps` 为 `WrappedAction`，可直接 `await agent.home()` 调用。

## 与规格相关的重要发现

官方模板的 `agentFromAdbDevice(deviceId?)` 在未指定 deviceId 且存在多台设备时**静默选择第一台**，不满足本工程规格“未指定时只在恰有一台授权在线设备时自动选择”的要求。因此 `src/setup/android.ts` 不使用该捷径，而是基于 `getConnectedDevices` 自行实现确定性设备选择，再以 `new AndroidDevice(udid) → connect() → new AndroidAgent(device)` 组装会话（与 `agentFromAdbDevice` 内部实现路径一致）。

## Matcher 图像依赖（add-visual-matcher，2026-09-16）

在 darwin arm64 / Node v24.20.0 上复核：`sharp@0.34.5` 可解码 Promotion 示例 PNG、裁剪非空、纯色 roundtrip MAE=0。Matcher 不新增图像 npm 包；pHash（`dct-32-8@1`）、ZNCC（`zncc-gray@1`）、SSIM（`ssim-global-gray@1`）为本地实现。OCR 默认关闭，不内置模型。
