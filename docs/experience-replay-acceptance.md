# 验收与核对记录 — add-experience-replay

核对日期：2026-09-16。环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。无真实设备、无模型密钥、无网络。

## 1. 前置与原生动作映射（任务 1.1）

前序 [add-experience-model](../openspec/changes/archive/2026-09-16-add-experience-model/tasks.md)、[add-experience-promotion](../openspec/changes/archive/2026-09-16-add-experience-promotion/tasks.md)、[add-visual-matcher](../openspec/changes/archive/2026-09-16-add-visual-matcher/tasks.md) 均已完成并归档。对照核对：Promotion 支持矩阵（docs/experience-promotion.md §2）、锁定 `@midscene/core@1.12.7` 的 Action Space 参数 schema（`dist/lib/device/index.js`）与 `ifLocateParamHasLocatedPixelResult` 直达路径（`dist/lib/agent/task-builder.js`：预置像素命中时跳过 `service.locate`）。

对应表见 [experience-replay.md](experience-replay.md) §2。锁定版本最小调用验证：`tests/integration/experience-replay-native.test.ts`「任务 1.1」用例——真实 Agent + 受控设备重放单 Tap 链：

| 检查 | 结果 |
| --- | --- |
| 设备实际收到 `tap({x,y})` = 当前帧匹配框中心（无bbox 偏移/缩放） | ✅ |
| 全局 `fetch` 调用次数 | ✅ 0（无模型请求） |
| dump 中 `Planning/Locate` 任务 | ✅ `finished` 且无 `usage` / `log`（未调用定位模型） |
| Input `append`→`typeOnly`、Scroll `distance`/`direction`、LongPress `duration` 无损 | ✅（六类动作用例逐项断言） |

## 2. 受控边界与替身覆盖范围（任务 3.1）

| 层 | 真实 | 替身 |
| --- | --- | --- |
| Agent / Action Space | `@midscene/core@1.12.7` `Agent` + `createDefaultMobileActions` | — |
| 派发路径 | 公开 `Agent.callActionInActionSpace`（locate 携带 `locatedPixelResult`） | — |
| 设备传输 | — | `SteppedAndroidDevice`：截图返回当前步画面，原语派发记录并推进一步 |
| 截图内容 | — | `paintReplayFrame` 合成场景帧（页面间 pHash Hamming >16，同页位移 ≈2） |
| 资产 | 真实 `ExperienceStore` 发布/查询完整 candidate + `readAssetImage` 摘要校验 | — |
| 模型 | — | `modelConfig` 指向不可路由地址 + `fetch` 计数器（全程 0 次调用） |

未覆盖（不阻塞）：真实硬件行为、真实模型规划、报告 HTML 渲染落盘。

## 3. 工程验证（任务 3.1 / 3.2）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 0 错误 |
| 回放单元测试（预检/状态机/分类/取消/事件，21 项） | `vitest run tests/unit/experience-replay.test.ts` | ✅ 通过 |
| 回放集成测试（真实 Agent + 传输边界，4 项） | `vitest run tests/integration/experience-replay-native.test.ts` | ✅ 通过 |
| 全量回归 | `pnpm vitest run` | ✅ 18 个文件 193 项全部通过 |

交付物：`ReplayResult` 契约与逐步事件（[experience-replay.md](experience-replay.md) §4–5）、动作支持矩阵（§2）、`src/experience/replay/`（`native-actions.ts` 对应表、`validator.ts` 预检、`replay.ts` 执行器）。

关键行为核验（逐项对应规格场景）：

- 第二步画面变化 → 第二步及后续不执行，结果标明已完成第一步（单测/集成各有覆盖）。
- 动作返回但预期画面未出现 → 动作后验证失败，不重发动作，不误报成功。
- 终态不符 → `terminal-check` 失败，`completedActions` 保留，`effect=confirmed-partial`。
- 派发后异常 / 派发后截图失败 → `unknown`，不继续派发；原始异常保留在 `failure.raw`。
- 取消（动作前 / 等待中）→ `cancelled`，不重置预算、不继续派发、不自动重试、零模型调用；等待超时返回 `timeout` 而非 no-match。
- 未知动作 / 缺图 / 参数越界 / 版本不兼容 → 预检整链拒绝，首动作不派发。
- 逐步事件携带截图与验证证据；原生 dump 每次派发一个 execution 且含 before/after 截图（报告可查看）；模块不渲染报告、不改 Store。

## 4. 遗留与边界

- 真实设备业务页面覆盖率未验证（合成场景帧只证明协议与状态机）。
- Variant 统计/状态联动（replay-succeeded → active）属 Store 事件提交方职责，本 Change 未接入 Runtime。
- 页面间可区分性依赖冻结阈值（`screenPHashMaxHamming=16`）；测试页面按实测 Hamming 选型，不代表任意业务页面分布。
