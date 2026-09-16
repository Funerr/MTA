# MTA — Midscene 双平台（Android / HarmonyOS）测试框架接入层

基于 [Midscene Test](https://www.midscenejs.com/midscene-test/use)、[Midscene Android](https://www.midscenejs.com/platforms/android.html) 与 [Midscene HarmonyOS](https://www.midscenejs.com/platforms/harmony.html) 的移动设备测试框架工程。本仓库只交付**框架接入能力**：设备会话、原生 Nodes、通用设备生命周期节点和工程检查。**具体业务用例（YAML）、测试意图和业务结果判断由使用方提供**，框架不内置任何业务流程示例。

## 环境要求

- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` 与 pnpm
- 运行 Android 用例时：本机 ADB、一台已授权 USB 调试的 Android 设备、模型 API 配置
- 运行 HarmonyOS 用例时：本机 HDC（可用 `HDC_HOME` 指定 hdc 所在目录）、一台已连接的鸿蒙设备、模型 API 配置
- 框架自身的安装、类型检查、测试与 Node 参考生成**不需要**任何设备和模型密钥

## 快速开始

```bash
pnpm install --frozen-lockfile   # 安装锁定依赖（postinstall 自动生成两平台 Node 参考）
pnpm run typecheck               # 类型检查
pnpm test                        # 框架自身测试（无需设备/密钥）
pnpm run nodes                   # 重新生成两平台 Node 参考
```

## 运行业务用例（使用方）

1. 复制 `.env.example` 为 `.env`，填写模型四项配置（[模型配置说明](https://midscenejs.com/model-common-config.html)）；多设备时按平台设置 `ANDROID_DEVICE_ID` / `HARMONY_DEVICE_ID`，hdc 不在默认路径时设置 `HDC_HOME`。
2. 将合法的 Midscene YAML 用例放入对应平台目录：`cases/android/` 或 `cases/harmony/`（目录说明见 [cases/README.md](cases/README.md)）。
3. 执行：

```bash
pnpm run test:cases                          # 官方 midscene-test CLI，两项目串行执行
pnpm run test:cases --project android        # 仅运行 android 项目
pnpm run test:cases --project harmony        # 仅运行 harmony 项目
```

运行报告写入 `midscene_run/report/`（不入库）。`cases/android/` 与 `cases/harmony/` 为空时 CLI 会报“未找到 YAML 用例”的收集错误，这是预期行为——业务内容由使用方提供。

## 设备会话与选择规则

`src/setup/android.ts` 与 `src/setup/harmony.ts` 在**执行期**（项目 setup）建立设备会话，模块导入不产生任何设备或模型调用；接管前清理与单次释放的公共语义在 `src/setup/session.ts`（`bindAgentToDevice` / `SessionHandle`），平台各自保留选择逻辑与错误类型。

**android 项目：**

- 设置 `ANDROID_DEVICE_ID` 时必须精确匹配 `adb devices` 中的 udid，且设备状态为 `device`（已授权在线）；否则报错。
- 未设置时，仅当**恰有一台**已授权在线设备时自动选择；零台或多台均报错，不静默选择。
- ADB 不可用、目标离线/未授权等都会在 UI 操作前以可定位的错误失败。

**harmony 项目：**

- 设置 `HARMONY_DEVICE_ID` 时必须精确匹配 `hdc list targets` 中的目标；否则报错（官方 `agentFromHdcDevice` 会静默选第一台，本框架不采用）。
- 未设置时，仅当**恰有一台**在线目标时自动选择；零台或多台均报错，不静默选择。HDC 枚举结果不携带授权状态，目标连接问题在会话建立阶段暴露并清理已取得资源。
- HDC 不可用时报错并提示 `hdc list targets` 与 `HDC_HOME`。

两平台会话建立成功时都会输出所选设备标识（如 `[mta] android 会话已绑定设备：<udid>` / `[mta] harmony 会话已绑定设备：<deviceId>`），便于确认当前绑定目标。会话由原生 Agent（`AndroidAgent` / `HarmonyAgent`）接管，teardown 时经 `agent.destroy()` 统一释放且只释放一次；接管前的部分初始化失败会清理已取得资源并保留原始错误。

双执行项目（`android`、`harmony`）串行执行（`maxConcurrency: 1`），一个项目绑定一台设备。

## 可注册能力

两平台原生 Nodes 存在大量同名节点（`aiAct`、`launch`、`home`…），因此**按项目本地注册**，互不覆盖；全局注册两平台结构兼容的框架生命周期节点与实验 `experienceAct`。可用 Nodes 见按平台生成的参考：

- [midscene-node-reference.android.md](midscene-node-reference.android.md) —— android 项目：原生 AI Nodes（`aiAct`、`aiAssert`、`aiTap`、`aiAsk` 等）、原生设备 Nodes（`launch`、`terminate`、`runAdbShell`、`back`、`home`、`recentApps`）与通用生命周期节点。
- [midscene-node-reference.harmony.md](midscene-node-reference.harmony.md) —— harmony 项目：同名原生 AI/设备 Nodes（鸿蒙侧 shell 节点为 `runHdcShell`）与通用生命周期节点。
- **框架通用节点**（`src/nodes/`，两平台共享）：
  - `device.prepare: { target: home }` —— 严格只接受该输入；返回当前平台主屏。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。
  - `device.recover: {}` —— 严格只接受空对象；返回当前平台主屏，保留系统设置与业务状态。可在准备或用例步骤部分完成后调用。
  - `experienceAct: { prompt }` —— 实验性经验动作。仅对使用方登记的可重复纯动作目标尝试视觉重放；默认资格表为空，未登记或含判断时回退一次原生 `aiAct`。不覆盖原生 `aiAssert`。
- **可选透明接入**：默认关闭。设置 `EXPERIENCE_ENABLED=true` 后，本仓库 YAML 的 `aiAct` 对合格纯动作复用 Experience Runtime；图片、未知 options、未登记目标仍原样走原生。不拦截脚本直接调用 `agent.aiAct`。说明见 [docs/experience-transparent-ai-act.md](docs/experience-transparent-ai-act.md)。

两个节点均直接传播设备操作失败，超时与重试交给原生运行器，不吞异常、不私自重试。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `midscene.config.ts` | 生产配置：android/harmony 双项目、Node 注册（全局生命周期 + 项目本地平台原生）、用例发现范围 |
| `src/setup/session.ts` | 会话公共层：接管前清理（`bindAgentToDevice`）与单次释放句柄（`SessionHandle`） |
| `src/setup/android.ts` / `src/setup/harmony.ts` | 平台各自的设备选择、会话生命周期与项目 setup |
| `src/nodes/` | 框架通用 Nodes（两平台结构兼容） |
| `scripts/generate-node-references.mjs` | 按项目生成两份 Node 参考（官方 CLI 双项目时需 `--project` 选择） |
| `src/experience/`、`experiences/` | Experience 资产、Promotion、Matcher、Replay、Runtime；实验入口 `experienceAct`；可选 YAML `aiAct` 透明接入（默认关闭） |
| `cases/android/`、`cases/harmony/` | 使用方业务用例目录（按平台，仅使用方写入） |
| `experiments/visual-assert/` | 视觉断言离线评估实验（不接入生产 `aiAssert`） |
| `tests/` | 框架自身测试与夹具，不进入任何平台的业务发现范围 |
| `docs/` | 依赖版本核对、框架验收与 Experience 能力说明（含 YAML `aiAct` 透明接入） |

## 框架验证

- `pnpm test`：254 项框架测试（单元 + 原生边界集成，含双平台生命周期、鸿蒙选择/会话与视觉断言离线评估），证据与覆盖分层见 [docs/acceptance.md](docs/acceptance.md)；YAML `aiAct` 透明接入见 [docs/experience-transparent-ai-act-acceptance.md](docs/experience-transparent-ai-act-acceptance.md)。
- 边界集成测试加载**实际锁定的** `@midscene/test`/`@midscene/android`/`@midscene/harmony` 包与真实 `midscene.config.ts`，仅将设备/Agent 边界替换为受控替身；真实硬件与模型调用未在框架验收中覆盖。
- 有真实设备时，可选执行连接/截图/释放单能力检查（见验收记录的“可选设备检查”一节，Android 与 HarmonyOS 分列），该检查不是框架验收的必要条件。
