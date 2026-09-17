# 多设备协作阶段验收记录

验收时点：2026-09-17。以下从多设备使用指南迁入，保留当时验证结果，本轮文档治理未重新执行这些测试。

已通过的是**受控边界验证**：使用锁定的 `@midscene/test@1.12.7` 公开扩展点（`defineNode`、`createMidsceneNodes`、`NodeDefinition.execute`、`CaseRunner`、`collectWorkflowDocument` / `runWorkflowDocument`、`createProjectRuntime`）配合桩 Agent，覆盖别名化 Node 契约、配置与会话生命周期、交错步骤、输入校验、并行并发与取消、在途防重叠和逐设备报告关联。

验证命令：`pnpm run typecheck`、`pnpm test`、`pnpm run nodes`。当前工作区已通过类型检查、31 个测试文件共 292 项测试及三项目 Node 参考生成；`tests/integration/experience-ai-act-native.test.ts` 在用例内显式关闭 `EXPERIENCE_ENABLED`，因此不会受本机 `.env` 影响。

**尚未执行真实设备验证**：所有多设备测试都用桩 Agent，没有连接过真实 Android / HarmonyOS 设备，因此以下内容仍待现场确认——`adb` / `hdc` 精确选择与连接失败的实际错误文本、原生 AI 操作在取消信号后是否真正停止设备 I/O、两台真机并行时的模型调用与报告落盘、以及 `agent.destroy()` 的真实释放时序。首次真机运行请按单台 → 交错 → 并行的顺序逐步放开。

当前能力见 [README](../README.md)，其他证据见 [验收索引](acceptance-index.md)。
