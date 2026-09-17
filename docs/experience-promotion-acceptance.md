# 验收与核对记录 — add-experience-promotion

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

核对日期：2026-09-16。环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。无真实 Android 设备、无模型密钥。

## 1. 前置（任务 1.1）

[add-experience-model](../openspec/changes/archive/2026-09-16-add-experience-model/tasks.md) 任务 8/8 已完成并归档；资产契约见 [experience-assets.md](experience-assets.md)，验收见 [experience-assets-acceptance.md](experience-assets-acceptance.md)。

| 项 | 值 |
| --- | --- |
| `@midscene/core` / `@midscene/android` / `@midscene/test` | `1.12.7` |
| 图像管线 | `sharp@0.34.5`（`png-sharp@1`） |
| 适配层 | `trace-adapter@1` |
| 夹具生成来源 | `tests/helpers/midscene-agent-harness.ts`：真实 `Agent` + `createDefaultMobileActions`，设备/模型 I/O 受控替换 |
| 公开采集点 | `Agent.dump.executions`（`callActionInActionSpace` / `runPlans` 返回后即可读）；`execution.id` 作 call 隔离 |
| 业务 YAML | 无 |

### 截图 / 参数 / 目标关联表（1.12.7 实测）

来源：`tests/integration/experience-promotion-native.test.ts`（Locate+Tap 后立刻读 dump，再发第二次 Home）。

| 动作 | 原生 subType | before | after | 目标 / 参数 | 设备实际动作 |
| --- | --- | --- | --- | --- | --- |
| Locate | `Planning/Locate` | `uiContext.screenshot.id` | 无 `after-calling` | prompt | 无设备动作 |
| Tap | `Action Space/Tap` | Locate 同一 `uiContext.screenshot` | 本任务 `recorder.timing=after-calling`，**id 与 before 不同** | `param.locate.rect={left:24,top:40,width:40,height:24}`，`center=[44,52]` | `tap({x:44,y:52})`，与 center 一致（dpr=1） |
| Home（第二次调用） | `Action Space/AndroidHomeButton` | 新 execution 的 `uiContext.screenshot` | 本任务 `after-calling` | 无 locate | `home` |
| Scroll | `Action Space/Scroll` | `uiContext.screenshot` | `after-calling`，id 与 before 不同 | `scrollType=singleAction`，`direction=down`，`distance=40`，`locate.rect={left:8,top:80,width:100,height:40}` | `scroll` |
| LongPress | `Action Space/LongPress` | `uiContext.screenshot` | `after-calling` | `duration=800`，`locate.rect={left:20,top:48,width:48,height:36}` | `longPress` |
| Back | `Action Space/AndroidBackButton` | `uiContext.screenshot` | `after-calling` | 无 locate | `back` |
| call 隔离 | — | — | — | 两次调用产生两个不同的 `execution.id` | — |

批量 `runPlans(Tap→Input→Scroll→LongPress→Back→Home)`：只给最后一个任务打 `after-calling`；中间动作 after = 后续任务中与 before id 不同的 `uiContext.screenshot`。六类动作参数均出现在原生 dump 中。

## 2. 兼容性结论（任务 1.2）

**结论：同次 Step 结束后即可完整取证，允许推进转换任务。**

- `callActionInActionSpace` / `runPlans` 返回后 `agent.dump.executions` 已含本次 tasks（监听器在调用过程中即推送快照）。
- 每次调用一个 `execution.id`；历史 execution 必须按 id / 新增集合隔离，否则视为跨调用污染。
- 批量规划只给**最后一个**任务打 `after-calling` 截图；中间动作的 after = 后续任务中与 before id 不同的 `uiContext.screenshot`。
- 有目标动作的 bbox 来自 `locate.rect`，绑定操作前截图像素。1.12.7 在 dpr=1 时 `center` 即实际 tap 点。
- `persistExecutionDump` 不是同次 Step 取数的前提；本实现消费内存 dump，不解析 HTML。
- 原生 Input `mode=typeOnly`（不清空再输入）映射为经验 `append`；`replace` 为默认写入模式。`clear` 不学习。

无上游缺口需要暂停后续任务。未测量：真实设备物理分辨率映射、报告落盘后截图惰性加载。这两项不阻塞本 Change。

## 3. 工程验证（任务 3.1 / 3.2）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 通过，无错误 |
| Promotion 测试 | `vitest run tests/unit/experience-trace-adapter.test.ts tests/unit/experience-promoter.test.ts tests/integration/experience-promotion-native.test.ts` | ✅ 3 个文件 25 项全部通过 |
| 设备/模型依赖 | — | ✅ 无真实设备、无模型密钥；原生夹具用 `ScriptedAndroidDevice` + `locatedPixelResult` |

原生集成夹具生成 Tap→Input→Scroll→LongPress→Back→Home 轨迹后 `promoteExperience` 发布 candidate，重载动作类型、bbox、参数与来源版本一致；promote 期间设备动作次数不增加（不二次 AI）。`runPlans` 仅用于批量 flush 时序，公开取数路径是 `callActionInActionSpace`。

Replay / Runtime 未实现。设备业务执行不是验收前提。

### 支持矩阵与失败原因

详见 [experience-promotion.md](experience-promotion.md) §2。测试覆盖的跳过/失败原因：

| 情况 | 学习结果 | 原因特征 |
| --- | --- | --- |
| 失败 / 取消任务 | skipped | `failed` / `cancelled` |
| 跨调用混杂 dump | skipped | 未隔离的多 execution |
| 缺 after 且无后续不同截图 | skipped | before/after 证据不足 |
| 未知动作（如 Swipe） | skipped | 整链拒绝，Store 无残链 |
| Scroll `scrollTo*` / 无 distance | skipped | 无法映射固定像素距离 |
| Insight Assert 等 | skipped | 未建模语义检查；原生结果保持有效 |
| `allowSemanticChecks=true` | skipped | v1 策略不允许放开判断学习 |
| 动态返回类别（string 等） | skipped | v1 只学习 `undefined` |
| 空链（仅 Finished） | skipped | 动作链为空 |
| 未登记 options | skipped | 请求不合格 |
| 同一 callId 再学 | promoted + duplicate | 修订与 learned 计数不变 |
| 裁剪失败 / 索引不可写 | failed | 无可查询残链，不重跑 AI |

尚未实现：Replay、Runtime、Matcher、experienceAct 注册、报告 HTML 解析。
