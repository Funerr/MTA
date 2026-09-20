# 编写工作台契约适配清单

用例编写工作台（`src/workbench/`，见 [OpenSpec 变更](../openspec/changes/add-case-authoring-workbench/proposal.md)）不引入第二套 Runner 或 Planner；它复用下表列出的既有契约入口。本文是任务 1.1 的核对结果：每一条都对应已存在的代码或已通过的契约测试，新增访问必须先落入本清单并在适配边界验证。

锁定依赖版本：`@midscene/test`、`@midscene/android`、`@midscene/harmony`、`@midscene/core` 均为 `1.12.7`（见 [dependency-versions](dependency-versions.md)）。

## 1. YAML 工作流与 Node 契约（静态，无设备/模型 I/O）

| 工作台需要 | 复用入口 | 已验证行为 |
| --- | --- | --- |
| 加载项目并获得各执行项目合并后的 NodeRegistry | `loadTestProject(configPath)`（`@midscene/test/config`） | 只导入配置模块，不执行项目 setup；`android`/`harmony`/`multi-device` 各自 `nodes` 可解析本地覆盖节点 |
| 解析并收集 YAML 工作流（结构、未知节点、字符串简写、`$` 元数据、变量插值） | `collectWorkflowDocument(source, { resolveNode, variables, env })`（`@midscene/test`） | 同步、仅文件+CPU；未知节点名、缺失变量抛 `WorkflowParseError`；空 `env` 即可运行 |
| Node 输入契约校验（与引擎一致） | `node.inputSchema.safeParseAsync(input)` + `NodeInputValidationError.fromZod` | 引擎在执行期才做输入校验；静态检查必须自行补上这一步，且不触发 `execute` |
| 单步规范化（编辑器缓冲区用） | `normalizeSteps` / `normalizeStep`（`@midscene/test`） | 无副作用的纯函数 |
| Node 输入 Schema 来源 | `createMidsceneNodes`（`@midscene/test/midscene`）+ `src/nodes/*` 的框架节点 | `inputSchema`/`stringInputKey` 在别名改名与 experience 包装下保持不变 |

已知边界：

- `collectWorkflowDocument` 只接受磁盘路径；编辑器缓冲区校验需先写临时文件（或用 `normalizeSteps` 自行接 js-yaml 结果）。
- 收集阶段不校验输入 schema；“收集通过”不等于“Node 输入契约检查通过”，两者必须分层报告。

## 2. 纯校验与 setup 副作用边界

- `loadTestProject` 导入 `midscene.config.ts` 顶层代码（`createMidsceneNodes`、绑定解析、experience 包装均为导入安全），不调用任何 setup；setup 仅在 `createProjectRuntime().start()` 内执行。
- 静态检查管线 = `loadTestProject` → `collectWorkflowDocument` → 逐步 `safeParseAsync`；全程不触碰 adb/hdc、不创建 Agent、不需要 `MIDSCENE_MODEL_*`。
- 若未来需要项目变量，用 `project.variables` 与 `process.env` 显式传入，不因校验读取密钥。

## 3. 设备会话与观测契约（运行期，编写核查用）

| 工作台需要 | 复用入口 | 说明 |
| --- | --- | --- |
| 设备枚举（不连接） | `listAdbDevices`（`src/setup/android.ts`）、`listHdcDevices`（`src/setup/harmony.ts`） | 分别代理官方 `getConnectedDevices()`；Android 条目含 `state`，`device` 为已授权在线 |
| 确定性设备选择（纯函数） | `selectAndroidDevice` / `selectHarmonyDevice` | 不存在、未授权、多台歧义均抛带定位信息的 SetupError，不静默切换 |
| 核查执行会话 | `src/setup/workflow-execution.ts` → `loadTestProject` + `createProjectRuntime` + `runWorkflowDocument` | 工作台只记录显式选择（`device-service` 不建会话）；执行时把设备 ID 经 env 传入既有项目 setup，由框架获取/释放（含 `SessionHandle`/`agent.destroy()` 幂等语义） |
| 截图 | `agent.interface.screenshotBase64()`（封装于 `captureScreenshotFromAgent`，`src/experience/runtime/adapters.ts`） | 返回 PNG 字节 |
| 报告/dump/executionId 关联 | 仅经 `src/experience/runtime/adapters.ts`、`observe.ts`、`identity.ts` 等既有适配入口 | 禁止在工作台内新增散落的 Midscene 内部结构访问 |

## 4. 停止/取消语义（工作台状态机的依据）

1. **步骤超时**：引擎构造步骤级 `AbortController`，超时抛 `StepTimeoutError` 并 abort signal；但底层 `execute` Promise 不会被杀死，可能仍在途（`DeviceInFlightGuard` 存在的原因）。工作台停止后必须呈现“停止中/状态未知”，直到在途调用 settle 或 `destroy()` 完成。
2. **run 级中止**：`AbortSignal` 传入 `runWorkflowDocument` / `createDocumentRuntime`。中止后引擎不会在步骤之间预检查 signal：`onStepStart` 仍可能为下一步触发，但 `executeStep` 在执行前拒绝，Node `execute` 不会被调用。`onStepStart` 不能当作“设备动作已发生”的证据。
3. **模型调用中止**：`Agent.aiAct(prompt, { abortSignal })` 将中止传播进模型调用；硬超时默认 180s（`MIDSCENE_MODEL_TIMEOUT` 可覆盖）。
4. **释放即终结**：`agent.destroy()` 幂等，释放设备并终结 HTML 报告。工作台“人工接管”前置条件 = 会话已释放（或确认取消完成）。
5. **恢复**：任何中断后恢复核查，先重新获取当前画面（截图），不按旧画面继续操作；不自动重放结果未知的动作。

## 5. 契约测试索引

| 锁定行为 | 测试 |
| --- | --- |
| 静态管线无 setup 副作用、收集纯静态、输入校验与引擎一致 | `tests/unit/workbench-static-pipeline-contract.test.ts` |
| 步骤超时/ run 级中止的实际含义（在途调用、派发边界） | `tests/unit/workbench-stop-semantics-contract.test.ts` |
| 工作台 → setup → Midscene Runner → teardown 契约（保留结构、停止、超时、取消） | `tests/unit/workbench-execution-contract.test.ts` |
| 核查服务互斥/停止/unknown/重启中断、无预期不伪造断言 | `tests/unit/workbench-verify-service.test.ts` |

后续任务在这些边界上扩展（文档模型、模型生成、卡片映射、设备核查、确认导出），新增对 Midscene 内部结构的访问必须先补入本清单第 3/4 节并附契约测试。
