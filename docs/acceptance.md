# 框架验收记录 — 双平台接入（android / harmony）

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

验收日期：2026-09-16（`add-harmony-platform`，在 bootstrap（2026-09-15）单 Android 项目基础上升级为双平台）。验收环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0、pnpm 10.33.2、**无已连接 Android/HarmonyOS 设备（`adb devices` 为空、无 hdc）、无模型密钥（环境无 `MIDSCENE_*` 变量、无 `.env` 文件）**。

依赖版本核对依据见 [dependency-versions.md](dependency-versions.md)（含 2026-09-16 增补的 `@midscene/harmony@1.12.7` 实测条目）。

## 1. 工程检查（无设备 / 无密钥条件下全部通过）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 锁定依赖安装 | `pnpm install --frozen-lockfile`（清除 `MIDSCENE_*`/设备变量后执行） | ✅ 通过（postinstall 自动生成两平台 Node 参考） |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 通过，无错误 |
| Node 参考生成 | `pnpm run nodes` | ✅ 生成 `midscene-node-reference.android.md`（含 `runAdbShell`）与 `midscene-node-reference.harmony.md`（含 `runHdcShell`），均含原生 aiAct/aiAssert 与 `device.prepare`/`device.recover` |
| 框架测试 | `pnpm test`（vitest） | ✅ 15 个文件 157 项全部通过 |
| 空用例行为 | `pnpm run test:cases` | ✅ 预期行为：两项目各报一条收集错误（"No workflow YAML files found"），非零退出，**未调用设备 setup（输出中无 `[mta]` 会话日志）、未产生外部调用** |

配置加载（`loadTestProject`）在无 `.env`、无密钥时正常完成；Node 参考生成同样无设备依赖。官方 `midscene-test nodes` 在双项目 Nodes 不同时要求 `--project` 选择且输出路径固定，故由 `scripts/generate-node-references.mjs` 按项目分别生成两份参考。

## 2. 覆盖分层与测试证据

### 2.1 单元/逻辑测试（替身：纯对象桩）

**Android（既有回归，公开行为不变）：**

- `tests/unit/device-selection.test.ts`（14 项）——确定性设备选择：指定目标命中/不存在/离线/未授权；未指定时唯一设备自动选择、多设备歧义报错、零设备报错、全离线报错；`ANDROID_DEVICE_ID` 空白裁剪；选择失败不创建 Agent；ADB 枚举失败包装为可定位错误并保留 `cause`。
- `tests/unit/session-lifecycle.test.ts`（10 项）——会话生命周期：connect 失败/Agent 构造失败时清理已取得资源且保留原始错误；清理自身失败不覆盖原始错误；`release()` 重复调用只销毁一次；destroy 错误传播；新会话不复用已销毁对象；项目 setup 返回绑定 context、teardown 注册并单次释放；setup 失败不注册 teardown。
- `tests/unit/device-lifecycle-nodes.test.ts`（10 项）——两个节点的 schema 严格校验（缺失/非法/多余字段全部拒绝）与执行行为：合法输入恰调用一次原生 `home`；失败直接传播不重试；context 缺 Agent 时可定位报错（跨平台措辞）。

**HarmonyOS（新增）：**

- `tests/unit/harmony-device-selection.test.ts`（11 项）——确定性选择（无授权状态字段模型）：指定命中/不存在并列出目标/空白裁剪；未指定时唯一在线目标自动选择、多台歧义报错列出目标、零台报错指向 `hdc list targets`；选择失败不创建 Agent；HDC 枚举失败包装为可定位错误并保留 `cause`；连接失败错误原样传播。
- `tests/unit/harmony-session-lifecycle.test.ts`（7 项）——`HarmonySessionHandle` 重复 release 只销毁一次、destroy 错误传播、新会话不复用已销毁对象；项目 setup 返回绑定 context、teardown 单次释放、setup 输出所选 deviceId、枚举/连接失败时不注册 teardown（无资源残留）。

（另有 87 项 Experience 相关测试来自其他 Change，不受本 Change 影响，随全量回归通过。）

### 2.2 原生边界集成测试（加载实际锁定包，仅替换设备/Agent 边界）

`tests/integration/native-boundary.test.ts`（18 项），加载真实 `midscene.config.ts` 与 `@midscene/test@1.12.7`/`@midscene/android@1.12.7`/`@midscene/harmony@1.12.7` 的官方 Node 定义，Agent 以受控替身注入（`projectContext`/`CaseRunner.context`）：

- **双项目结构与注册**：android/harmony 双项目、`maxConcurrency: 1`、各自发现范围 `cases/android|harmony/**` 且排除 `tests/**`；两项目均解析 `aiAct`/`aiAssert`/`aiTap`/`launch`/`terminate`/`back`/`home`/`recentApps`/`device.prepare`/`device.recover`；android 含 `runAdbShell` 且无 `runHdcShell`，harmony 含 `runHdcShell` 且无 `runAdbShell`；同名节点（`home`/`aiAct`）为各自平台的独立定义；全局生命周期节点在同一加载实例内两项目共享同一对象，输入契约与框架定义一致。
- **原生参数契约**：两项目的 `aiAct`/`aiAssert` 输入均为严格 `prompt` 契约（`instruction`/`assertion` 等未声明键被拒）。
- **生命周期与失败传播（android 与 harmony 项目各跑一遍，真实 YAML 夹具 `tests/fixtures/lifecycle-boundary.yaml`）**：全部成功时 home 恰调用三次；准备失败时步骤不执行、`afterEach` 恢复仍运行、最终失败可定位；步骤失败时原始失败保留且恢复运行；步骤与恢复同时失败时两种失败都可追踪。
- **取消与超时（两平台各一遍）**：执行前取消 → 用例 `not-run`（`interrupted`）、零设备调用；步骤超时（`$: { timeout: 50 }`）→ 原生 `StepTimeoutError`，后续步骤不再执行。
- **运行器级输入校验**：非法输入在 `NodeInputValidationError` 层失败，零设备动作派发。

### 2.3 覆盖范围声明（替身边界）

以上集成验证覆盖**类型层、注册层与原生运行器行为层**；设备/Agent 边界为受控替身，因此**未测量**：真实硬件连接（ADB/HDC）、真实 Home 导航效果、真实模型调用与真实 HTML 报告内容。框架不宣称已验证真实设备业务效果。

## 3. 交付内容审查

- 生产代码导入仅含 `@midscene/test`（`/config`、`/midscene`）、`@midscene/android`、`@midscene/harmony`、`zod/v4`、`dotenv`、`node:*` 内置模块与工程内模块 —— 仅接入两平台原生 Agent/Runner/Planner/动作/报告，无自研运行器或报告渲染（导入与注册检查完成）。
- 平台接入层（`src/setup/`、`src/nodes/`、`midscene.config.ts`、`scripts/`）无任何 Experience 引用；`src/experience/`、`experiences/` 内容属其他 Change，未接入生产配置。
- 文件清单中唯一 YAML 为 `tests/fixtures/lifecycle-boundary.yaml`（生命周期注册/解析夹具，不表达手机业务流程），且被两项目生产配置排除在业务发现范围之外；`cases/android/`、`cases/harmony/` 仅含 README，无业务 YAML 交付。
- `midscene_run/`、`.midscene/`、`.env`、`node_modules/` 均在忽略规则中；`.env.example` 不含密钥值（`HDC_HOME` 以注释形式说明）。

## 4. 使用方职责

业务用例 YAML、测试意图、步骤编排、业务数据与业务结果判断由使用方提供（按平台放入 `cases/android/` 或 `cases/harmony/`）；框架仅提供原生注册与运行入口（`pnpm run test:cases`）。本 Change 不交付业务用例，也不以执行某个手机业务流程为完成条件。

## 5. 可选设备检查（单列记录，不阻塞本 Change）

有真实设备时可在本地追加以下单能力检查（结果记录于此，未执行不影响本 Change 验收结论）。

**Android（沿 bootstrap 检查单）：**

- [ ] `adb devices` 可见目标设备且状态为 `device`
- [ ] `.env` 配置模型后 `pnpm run test:cases --project android` 可运行最小用例（由使用方提供）
- [ ] 会话 teardown 后 `adb devices` 仍可枚举（连接被正确释放）
- [ ] 原生报告 `midscene_run/report/*.html` 可打开并包含对应步骤

**HarmonyOS（本 Change 新增检查单，单列）：**

- [ ] `hdc list targets` 可见目标设备（必要时设置 `HDC_HOME`）
- [ ] `.env` 配置模型后 `pnpm run test:cases --project harmony` 可运行最小用例（由使用方提供）
- [ ] 多台设备时 `HARMONY_DEVICE_ID` 指定与不指定（歧义报错）行为符合预期
- [ ] 会话 teardown 后 `hdc list targets` 仍可枚举（连接被正确释放）
- [ ] 原生报告 `midscene_run/report/*.html` 可打开并包含对应步骤

**截至验收时点未执行上述检查（本机无已连接设备）；不宣称已验证真实设备效果。**
