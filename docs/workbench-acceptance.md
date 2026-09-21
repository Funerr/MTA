# 用例编写工作台验收

## 2026-09-21：真实 Android 设备核查（任务 7.2）

- **环境**：Android 真机 HC100（udid `HC10006129200186`，USB 连接，状态 device）；编写/设备模型 mimo-v2.5（OpenAI 兼容端点，复用 `MIDSCENE_MODEL_*`）；应用 `com.android.settings`；Node 24、`@midscene/*` 1.12.7。
- **覆盖**（用例「打开设置并检查蓝牙开关」，工作流 r6，含 `launch` / `device.waitUntil` / `aiAct` / `aiAssert` / `home` 节点）：
  - **关键页面核查**：三个目标（设置主界面、蓝牙开关可见、返回主屏后设置图标可见）全部 `observed-pass`，断言原文与预期一致；框架报告 `document/case status: success`，9 个步骤全部成功。
  - **停止与接管**：在 `aiAct` 在途时点击停止，界面显示「停止中：等待底层在途调用结束后释放会话」，停止后无新动作派发；已完成目标（act1）保留 `observed-pass` 证据，未执行目标记 `unknown`，不伪造通过。「释放 / 人工接管」释放绑定后重新绑定并复跑，恢复先重新获取当前画面，未自动重放未知结果动作。
  - **证据关联**：6 条证据（停止运行 3 条 + 完整运行 3 条）绑定用例步骤、平台、设备 `HC10006129200186`、时间与工作流修订 r6；三张真机截图（54KB–1.2MB PNG）与逐次框架结果 JSON 均落盘 `artifacts/workbench/`；证据摘要 3/3 预期覆盖、无待复核。
- **执行链路**：统一经 `src/setup/workflow-execution.ts`（loadTestProject → createProjectRuntime → runWorkflowDocument，即 Midscene Runner），设备会话由框架 setup/teardown 持有（执行前重新获取当前画面，结束后 destroy）；工作台不建旁路会话。
- **未验证**：HarmonyOS 真机核查（任务 7.3，本机无 hdc 环境）；关键点核查通过不代表完整业务验收，完整执行状态保持未运行。

## 2026-09-18：工作台闭环（无设备部分）

- **环境**：macOS（arm64）、Node 24.20.0、`@midscene/*` 1.12.7（锁定）；编写模型为 OpenAI 兼容端点（mimo-v2.5，`MIDSCENE_MODEL_NAME` 本地配置，密钥不入库）；无真实设备连接（7.2/7.3 另行记录为未完成）。
- **覆盖**：
  - 单元/契约测试 339 项、集成测试 61 项全部通过（`vitest run`）；`tsc --noEmit` 与 `pnpm workbench:build` 通过；既有 CLI 入口（`midscene-test nodes --project android`）工作正常。
  - 浏览器端到端（Chrome，`pnpm workbench` 本地服务）：新建文档 → 整段粘贴导入（来源/原文/未转换清单保留）→ 配置模型与包名 → 真实模型生成 Android 工作流（含 `device.prepare`/`launch`/`aiAssert`/`terminate`/`device.recover` 与 `@step` 锚点）→ 精确预期防线标记改写 → 用户逐条解决待澄清问题 → 分层静态检查四层通过 → 确认（不可变快照）→ 导出（`workflow.android.yaml` + `draft.json` + `conversion-report.json`，ready 1 / excluded 0，`full_execution: not_run`，未写入 `cases/`）。
  - 设备面板：静态检查 / 关键点核查 / 完整执行三状态独立显示；显式绑定不存在的设备返回定位错误（`ANDROID_DEVICE_ID 指定的设备 … 不存在`），不静默替换；证据缺口逐条列出。
  - 生成冲突保护：生成期间文档被修改时返回待合并差异，不覆盖人工编辑；用户选择合并后 `basedOnBusinessRevision` 对齐。
  - 框架执行链路契约（`tests/unit/workbench-execution-contract.test.ts`，真实 Midscene Runner + 可控 Node）：生命周期/变量/结构化参数保留、动作先于断言且只执行一次、停止后无新派发且在途调用结束后才 teardown、步骤超时不提前释放设备、启动前取消不建立会话、执行前先获取当前画面。
- **未验证 / 未完成**：
  - 真实 HarmonyOS 设备核查（任务 7.3）：本机无 hdc 环境，保留未完成状态（Android 部分已于 2026-09-21 补充验收，见上）。
  - 工作台与既有 CLI 对同一工作流的真实设备执行一致性（依赖 7.2 环境）。
