# 用例编写工作台验收

## 2026-09-18：工作台闭环（无设备部分）

- **环境**：macOS（arm64）、Node 24.20.0、`@midscene/*` 1.12.7（锁定）；编写模型为 OpenAI 兼容端点（mimo-v2.5，`MIDSCENE_MODEL_NAME` 本地配置，密钥不入库）；无真实设备连接（7.2/7.3 另行记录为未完成）。
- **覆盖**：
  - 单元/契约测试 339 项、集成测试 61 项全部通过（`vitest run`）；`tsc --noEmit` 与 `pnpm workbench:build` 通过；既有 CLI 入口（`midscene-test nodes --project android`）工作正常。
  - 浏览器端到端（Chrome，`pnpm workbench` 本地服务）：新建文档 → 整段粘贴导入（来源/原文/未转换清单保留）→ 配置模型与包名 → 真实模型生成 Android 工作流（含 `device.prepare`/`launch`/`aiAssert`/`terminate`/`device.recover` 与 `@step` 锚点）→ 精确预期防线标记改写 → 用户逐条解决待澄清问题 → 分层静态检查四层通过 → 确认（不可变快照）→ 导出（`workflow.android.yaml` + `draft.json` + `conversion-report.json`，ready 1 / excluded 0，`full_execution: not_run`，未写入 `cases/`）。
  - 设备面板：静态检查 / 关键点核查 / 完整执行三状态独立显示；显式绑定不存在的设备返回定位错误（`ANDROID_DEVICE_ID 指定的设备 … 不存在`），不静默替换；证据缺口逐条列出。
  - 生成冲突保护：生成期间文档被修改时返回待合并差异，不覆盖人工编辑；用户选择合并后 `basedOnBusinessRevision` 对齐。
  - 框架执行链路契约（`tests/unit/workbench-execution-contract.test.ts`，真实 Midscene Runner + 可控 Node）：生命周期/变量/结构化参数保留、动作先于断言且只执行一次、停止后无新派发且在途调用结束后才 teardown、步骤超时不提前释放设备、启动前取消不建立会话、执行前先获取当前画面。
- **未验证 / 未完成**：
  - 真实 Android 设备核查（任务 7.2）：本机 `adb devices` 无设备，保留未完成状态。
  - 真实 HarmonyOS 设备核查（任务 7.3）：本机无 hdc 环境，保留未完成状态。
  - 工作台与既有 CLI 对同一工作流的真实设备执行一致性（依赖 7.2 环境）。
