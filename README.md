# MTA — Midscene Android 测试框架接入层

基于 [Midscene Test](https://www.midscenejs.com/midscene-test/use) 与 [Midscene Android](https://www.midscenejs.com/platforms/android.html) 的 Android 设备测试框架工程。本仓库只交付**框架接入能力**：设备会话、原生 Nodes、通用设备生命周期节点和工程检查。**具体业务用例（YAML）、测试意图和业务结果判断由使用方提供**，框架不内置任何业务流程示例。

## 环境要求

- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` 与 pnpm
- 运行业务用例时：本机 ADB、一台已授权 USB 调试的 Android 设备、模型 API 配置
- 框架自身的安装、类型检查、测试与 Node 参考生成**不需要**设备和模型密钥

## 快速开始

```bash
pnpm install --frozen-lockfile   # 安装锁定依赖（postinstall 自动生成 Node 参考）
pnpm run typecheck               # 类型检查
pnpm test                        # 框架自身测试（无需设备/密钥）
pnpm run nodes                   # 重新生成 midscene-node-reference.md
```

## 运行业务用例（使用方）

1. 复制 `.env.example` 为 `.env`，填写模型四项配置（[模型配置说明](https://midscenejs.com/model-common-config.html)）；多设备时设置 `ANDROID_DEVICE_ID`。
2. 将合法的 Midscene YAML 用例放入 `cases/`（目录说明见 [cases/README.md](cases/README.md)）。
3. 执行：

```bash
pnpm run test:cases              # 官方 midscene-test CLI，业务发现范围：cases/**/*.{yaml,yml}
pnpm run test:cases -- ./cases/your-file.yaml   # 运行指定文件
```

运行报告写入 `midscene_run/report/`（不入库）。`cases/` 为空时 CLI 会报“未找到 YAML 用例”的收集错误，这是预期行为——业务内容由使用方提供。

## 设备会话与选择规则

`src/setup/android.ts` 在**执行期**（项目 setup）建立设备会话，模块导入不产生任何设备或模型调用：

- 设置 `ANDROID_DEVICE_ID` 时必须精确匹配 `adb devices` 中的 udid，且设备状态为 `device`（已授权在线）；否则报错。
- 未设置时，仅当**恰有一台**已授权在线设备时自动选择；零台或多台均报错，不静默选择。
- ADB 不可用、目标离线/未授权等都会在 UI 操作前以可定位的错误失败。
- 会话建立成功时会输出所选设备标识（`[mta] android 会话已绑定设备：<udid>`），便于确认当前绑定目标。
- 会话由原生 `AndroidAgent` 接管，teardown 时经 `agent.destroy()` 统一释放且只释放一次；接管前的部分初始化失败会清理已取得资源并保留原始错误。
- 首期单执行项目（`android`）串行执行（`maxConcurrency: 1`），一个项目绑定一台设备。

## 可注册能力

全部可用 Nodes 见生成的 [midscene-node-reference.md](midscene-node-reference.md)：

- **原生 AI Nodes**（`aiAct`、`aiAssert`、`aiTap`、`aiAsk` 等）与**原生设备 Nodes**（`launch`、`terminate`、`runAdbShell`、`back`、`home`、`recentApps`）——直接来自官方 `createMidsceneNodes({ agentClass: AndroidAgent })`，参数与错误契约保持原生。
- **框架通用生命周期 Nodes**（`src/nodes/device-lifecycle.ts`）：
  - `device.prepare: { target: home }` —— 严格只接受该输入；返回 Android 主屏。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。
  - `device.recover: {}` —— 严格只接受空对象；返回主屏，保留系统设置与业务状态。可在准备或用例步骤部分完成后调用。

两个节点均直接传播设备操作失败，超时与重试交给原生运行器，不吞异常、不私自重试。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `midscene.config.ts` | 生产配置：单 android 项目、Node 注册、用例发现范围 |
| `src/setup/` | 设备选择、会话生命周期、项目 setup |
| `src/nodes/` | 框架通用 Nodes |
| `src/experience/`、`experiences/` | Experience 预留占位（后续 Change 实现，当前为空） |
| `cases/` | 使用方业务用例目录（仅使用方写入） |
| `tests/` | 框架自身测试与夹具，不进入业务发现范围 |
| `docs/` | 依赖版本核对记录、验收记录 |

## 框架验证

- `pnpm test`：44 项框架测试（单元 + 原生边界集成），证据与覆盖分层见 [docs/acceptance.md](docs/acceptance.md)。
- 边界集成测试加载**实际锁定的** `@midscene/test`/`@midscene/android` 包与真实 `midscene.config.ts`，仅将设备/Agent 边界替换为受控替身；真实硬件与模型调用未在框架验收中覆盖。
- 有真实设备时，可选执行连接/截图/释放单能力检查（见验收记录的“可选设备检查”一节），该检查不是框架验收的必要条件。
