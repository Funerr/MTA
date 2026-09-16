# Midscene 整机测试实施路线图

截至 2026-09-16，本路线图对应 9 个 Change：其中 1–5 已完成，6–9 仍是待实施规划。Android / HarmonyOS 双平台底座、Experience 资产与 Promotion、以及本地 Visual Matcher 均已有代码和验收证据；下一实施重点是把 Matcher 接入逐步动作重放，再形成 Runtime 闭环。

## 实施顺序

| 顺序 | Change / 提案 | 状态 | 核心交付 | 直接前置 |
| --- | --- | --- | --- | --- |
| 1 | [bootstrap-midscene-mobile-test](changes/archive/2026-09-16-bootstrap-midscene-mobile-test/proposal.md) | ✅ 已完成并归档（2026-09-16） | 框架工程、Android 会话、Node 与报告接入 | 无 |
| 2 | [add-experience-model](changes/archive/2026-09-16-add-experience-model/proposal.md) | ✅ 已完成并归档（2026-09-16） | 视觉资产协议、Key、Variant、文件 Store | 1 |
| 3 | [add-experience-promotion](changes/archive/2026-09-16-add-experience-promotion/proposal.md) | ✅ 已完成并归档（2026-09-16） | 原生轨迹取数契约与 candidate 生成 | 2 |
| 4 | [add-harmony-platform](changes/archive/2026-09-16-add-harmony-platform/proposal.md) | ✅ 已完成并归档（2026-09-16） | HarmonyOS 会话、双执行项目、项目本地原生节点 | 1 |
| 5 | [add-visual-matcher](changes/archive/2026-09-16-add-visual-matcher/proposal.md) | ✅ 实施完成，归档文件已生成（2026-09-16） | 本地页面/目标/状态匹配 | 2、3 |
| 6 | [add-experience-replay](changes/add-experience-replay/proposal.md) | 📋 规划就绪 | 逐动作观察及原生动作重放 | 5 |
| 7 | [add-experience-fallback](changes/add-experience-fallback/proposal.md) | 📋 规划就绪 | experienceAct 与框架闭环集成矩阵 | 3、6 |
| 8 | [integrate-experience-with-ai-act](changes/integrate-experience-with-ai-act/proposal.md) | 📋 规划就绪 | 项目 YAML aiAct 可关闭透明接入 | 7 |
| 9 | [add-visual-assert-experience](changes/add-visual-assert-experience/proposal.md) | 📋 规划就绪 | 离线断言实验与 go/no-go 结论 | 3、5；建议 7 后开展 |

依赖说明：

- 动作 Experience MVP 主链为 1 → 2 → 3 → 5 → 6 → 7；当前已完成到 5，下一步从 6 开始。8 在 MVP 验收后接入原生用例语法；9 是独立研究分支，不要求先完成 8，也不阻塞动作 MVP。
- 4（双平台接入）已完成并归档，只依赖 1；它与 Experience 链（2、3、5–9）不形成前置关系。当前 Android / HarmonyOS 共用生命周期能力，平台特有 Agent 与 shell Node 按项目隔离。
- 顺序 5–9 的编号沿用本路线图的 Change 编号；各提案正文中的“实施前置”仍按 Change 名称互相引用，不受编号影响。

```mermaid
flowchart LR
  A[1 原生底座] --> H[4 双平台接入]
  A --> B[2 资产模型]
  B --> C[3 经验生成]
  C --> D[5 视觉匹配]
  D --> E[6 动作重放]
  E --> F[7 回退闭环 / MVP]
  F --> G[8 aiAct 透明接入]
  C -.-> I[9 断言离线研究]
  D -.-> I
```

图中主链包含传递依赖；上表列出直接依赖。依赖关系写在本路线图和各提案中，未伪造 CLI 不支持的跨 Change 元数据。已完成 Change 的代码、测试和验收证据仍需以对应归档目录与文档为准。

## 当前推进重点

1. **先实施 `add-experience-replay`**：消费已冻结的 `visual-matcher@1` 和 Promotion candidate，完成整链预检、逐步截图验证、当前坐标派发、后置证据、取消/超时和原生报告关联。
2. **Replay 完成后实施 `add-experience-fallback`**：把 Store、Matcher、Replay、Promotion 组合成 `experienceAct` Runtime，优先验证空库学习、命中零模型重放、失配回退和未知副作用停止。
3. **MVP 验收后再做 `integrate-experience-with-ai-act`**：保持原生 `aiAct` schema/结果/报告契约，默认关闭，并明确所有旁路条件。
4. **`add-visual-assert-experience` 保持独立研究节奏**：可以并行准备离线数据，但不应抢在动作 MVP 前改变生产 `aiAssert` 或引入 OCR/VLM 依赖。

当前尚未覆盖真实设备业务页的端到端证据。下一阶段仍以受控截图、设备传输边界和锁定依赖契约完成框架验收；真实 Android / HarmonyOS 业务用例由使用方在 `cases/android/`、`cases/harmony/` 中提供。

## 每个 Change 的完成方式

1. 先阅读该 Change 的 proposal、specs、design、tasks，核对直接前置的实际交付与验收证据。
2. 明确选择名称后执行 apply，例如：`$openspec-apply-change add-harmony-platform`。也可以直接告诉助手“实施 add-harmony-platform”。
3. 按任务完成框架检查与集成验证，只有有证据的任务才勾选。设备/模型边界可受控替换，实际原生依赖契约仍须验证；具体业务执行不作为这些 Change 的前提。
4. 验证实现与规格一致，再使用 OpenSpec verify/archive 流程收敛当前 Change 和主规格，随后进入下一个。
5. 若前序发现接口或协议变化，先修订受影响的后续规划再实施；不要仅因后续文档已经生成就沿用过时假设。

当前未归档的规划目录为 `add-experience-replay`、`add-experience-fallback`、`integrate-experience-with-ai-act` 和 `add-visual-assert-experience`，均包含 `proposal.md`、`design.md`、`tasks.md` 与对应规格。已完成的 `add-harmony-platform` 与 `add-visual-matcher` 已移入 `openspec/changes/archive/`，主规格已同步到 `openspec/specs/`。

## 框架与使用方边界

| 框架交付 | 使用方负责 |
| --- | --- |
| 工程配置、Android/HarmonyOS 设备会话和原生能力接入 | 选择测试设备与运行环境（adb/hdc） |
| 通用 prepare/recover 能力 | 定义业务起点与业务状态恢复 |
| Experience Schema、Store、Promotion、Matcher、Replay、Runtime | 提供测试意图及经验资格策略 |
| aiAct 接入、失败传播、原生报告关联 | 编写 YAML、组织业务流程并判断业务结果 |
| 单元、原生契约与模块组合测试 | 按自身需求开展真实业务验收 |

业务用例不属于当前 9 个 Change 的交付物。`cases/android/` 与 `cases/harmony/`（双平台接入落地后）作为使用方接入位置；tests/fixtures/ 中最小的 YAML、截图和轨迹仅用于验证框架。框架测试不建立业务场景库，也不要求某个手机业务流程通过。

## 三个阶段检查点

### 原生底座完成：Change 1（已达成）

安装、类型、参考生成和框架测试通过，设备选择、资源清理、Node 输入、原生生命周期及报告接入有契约证据（见 docs/acceptance.md）。真实设备连接/截图等单能力检查可选，未执行的硬件行为未写成已通过。

### 核心可行性确认：Change 3（已达成）

已验证实际锁定 Midscene 包的公开取数边界、完整轨迹关联和自动 candidate 发布，并已归档。可使用受控设备/模型传输与原生集成生成的轨迹夹具；纯手写轨迹只能测试解析器，不能证明官方接口可取数。无需指定业务 YAML 或业务结果。

### 本地视觉匹配完成：Change 5（已达成）

已交付 `visual-matcher@1`：环境/页面筛选、动态区掩码、有限范围目标搜索、上下文/状态判定、歧义拒绝、结构化 no-match/error，以及独立校准/验证夹具。匹配路径不调用模型、网络或设备动作；已通过 Matcher 测试、类型检查和确定性重复运行。当前边界是相同尺寸/方向的本地截图，不包含 Replay / Runtime 接入、真实设备业务页位移和内置 OCR，证据见 [docs/experience-matcher-acceptance.md](../docs/experience-matcher-acceptance.md)。

### 框架 MVP 完成：Change 7

组合实际 Store、Promoter、Matcher、Replay 和 Runtime，以可控边界完成矩阵：

| 输入/条件 | 预期框架行为 |
| --- | --- |
| 空 Store、合格调用成功 | 原生回调一次，生成 candidate |
| 有效候选与匹配截图 | 重放、激活、模型请求为零 |
| 支持范围内目标位移 | 派发位置来自当前匹配框 |
| 入口失配或可恢复中途失败 | 停止旧链，依策略回退，正确记录真实入口 |
| 学习更新后的相同入口 | 复用新候选，统计和修订正确 |
| 未知副作用、取消、超时 | 停止，不追加盲目执行 |
| Store/Promotion 失败 | 保留原生调用结果，错误可见且不重复操作 |

同时验证原生报告关联和模型观测边界。可以用临时 Store 连续测试学习、复用、失效和更新，但不要求连续执行业务流程。框架验证结果与真实设备、真实模型效果分开记录。

## 跨 Change 共用边界

- 项目继续使用 Midscene 的 Runner、Agent、规划、原生动作、截图、生命周期和报告；Change 4 之后底座同时覆盖 Android 与 HarmonyOS 双执行项目，生命周期 Nodes 跨平台共用。
- 同一请求可有不同环境与入口 Variant；有候选不等于能点击，必须先检查当前画面。
- 框架提供由使用方注入的纯动作资格策略，默认集合为空。内嵌语义断言、动态输出和未支持参数走原生路径。
- 中途回退从当前 UI 执行完整目标；只有副作用明确且策略允许时才能继续。取消、超时和未知执行结果不能追加盲目重试。
- AI 后缀经验保存其真实入口，不冒充原始入口的完整链。末尾画面检查不替代原生语义断言。
- 透明接入默认关闭，限定当前项目 YAML；直接 SDK aiAct 调用与其他项目不受影响。
- 断言研究保持独立资产、人工真值和冻结验证集；go 只代表建议另开生产化 Change，no-go 也可完成研究。

## 规划校验

各 Change 使用默认 `spec-driven` schema。可运行 `openspec validate <change-name> --strict` 检查规划格式与结构；任务清单中的框架测试是未来实施要求，不能与本轮 OpenSpec 校验混为一谈。
