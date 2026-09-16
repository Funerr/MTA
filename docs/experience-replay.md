# Experience Replay（visual-action-replay v1）

视觉动作回放：在不调用 AI 定位的前提下逐步重放一条历史视觉动作链。每个动作前取**新截图**验证页面/目标/状态，按当前匹配位置派发 Midscene **原生已定位动作**；动作后做有界等待与预期画面检查；最后一动作之后做终态视觉检查。无法确认页面、目标、结果或取消状态时明确停止，为上层回退提供边界和执行证据。本文件对应 Change `add-experience-replay`。Matcher 见 [experience-matcher.md](experience-matcher.md)，Promotion 见 [experience-promotion.md](experience-promotion.md)。

锁定：`@midscene/core` / `@midscene/android` **1.12.7**（公开派发路径 `Agent.callActionInActionSpace`）；图像管线 `png-sharp@1`；匹配配置 `visual-matcher@1`。OCR 默认关闭。

## 1. 调用契约

```ts
import {
  replayExperienceChain,
  replayTargetFromAgent,
  createStoreImageLoader,
} from './src/experience';

const result = await replayExperienceChain({
  chain: candidate,            // Store 查询出的 CandidateChain（或等价 Variant 修订）
  environment: currentEnv,     // 当前执行环境；与链环境指纹不一致时整链拒绝
  target: replayTargetFromAgent(agent), // 截图走 agent.interface，派发走 callActionInActionSpace
  loadImage: createStoreImageLoader(store), // AssetRef → PNG 字节
  signal,                      // 原生取消信号（可选）
  deadlineAtMs,                // 绝对截止时间（可选；等待上界取剩余时间，不重置每步预算）
  masks,                       // 传给 matcher 的固定动态区掩码（可选）
  onEvent,                     // 逐步事件回调（可选）
});
```

模块不决定选哪条链、是否回退、是否学习；不渲染报告、不更新 Store。`onEvent` 回调异常会直接向上抛出。原生框架会就地改写派发参数中的 `locate` 字段，`dispatch` 事件携带的是参数快照。

## 2. 支持矩阵（任务 1.1）

| 经验动作 | 原生 subType | 派发参数（与 Promotion 采集一一对应） | 设备原语 |
| --- | --- | --- | --- |
| Tap | `Tap` | `locate{prompt, locatedPixelResult{center,rect}}` | `tap({x,y})` = 当前框中心 |
| Input | `Input` | `locate` + `value` + `mode`（`replace`→`replace`，`append`→`typeOnly`） | `typeText(value,{replace})` |
| Scroll | `Scroll` | `locate`（center=投影锚点）+ `scrollType:'singleAction'` + `direction` + `distance` | `scroll(param)` |
| LongPress | `LongPress` | `locate` + `duration` | `longPress(point,{duration})` |
| Back | `AndroidBackButton` | `{}`（仍校验前置页面） | `backButton()` |
| Home | `AndroidHomeButton` | `{}`（仍校验前置页面） | `homeButton()` |

其他动作类型在预检整链拒绝（`action-unsupported`），不删除问题动作后执行残余链。`locate.locatedPixelResult` 携带当前帧像素框与中心点，框架据此跳过定位模型；`aiTap` / `aiInput` 等可能调用 VLM 的入口不在本模块使用范围。锁定版本的最小调用验证（零模型请求、参数无损、Locate 任务无 usage）见 `tests/integration/experience-replay-native.test.ts`。

## 3. 执行协议

1. **整链预检**（`preflightReplayChain`）：动作类型支持集、结构 schema、链语义（bbox/锚点/裁剪尺寸）、环境指纹一致、证据签名版本（`mean-rgb-grid` + `png-sharp@1`）、匹配配置，以及**全部**历史证据图片（入口/终态/每步前后/目标/上下文/状态）可加载且为 PNG。任一后续动作不支持或证据缺失 → 整链拒绝，首动作不派发。
2. **逐步执行**：每步新截图 → 有目标动作 `matchTarget`（环境+页面+目标+上下文+可选状态），Back/Home `matchScreen` 校验页面 → 命中输出**当前帧**目标框（Scroll 锚点按目标位移投影并夹紧到界内）→ 派发原生动作。
3. **动作后检查**：有界轮询新截图并 `matchScreen` 匹配动作后证据；上界 = `min(剩余预算, maxAfterWaitMs，默认 5000ms)`，不重置每步时间；预期画面未出现 → 动作后验证失败，不重发动作。
4. **终态检查**：最后一动作之后另取一张新截图匹配 `terminalEvidence`；动作调用返回本身不构成整链成功。终态确认只是"观察到与历史终态一致"，调用方仍可用原生 `aiAssert` 做业务判断。
5. **取消/超时**：动作前、动作返回后、每次等待轮询均检查 `signal` 与剩余预算。触发后停止派发新动作；已派发但未验证的动作副作用记为 `unknown`；不重试整链、不调用 AI、不把取消改判为普通 no-match。

## 4. ReplayResult

| 字段 | 含义 |
| --- | --- |
| `status` | `success`（全链+终态确认）/ `rejected`（预检整链拒绝）/ `failed`（执行中断言失败）/ `cancelled`（取消或预算耗尽） |
| `effect` | `none`（未派发任何动作）/ `confirmed-partial`（至少一个动作已确认完成，含全部完成）/ `unknown`（某次派发后无法判断是否生效；一旦成立不回退） |
| `completedActions` | 后置证据校验通过的动作数；success 时等于 `totalActions` |
| `dispatchedActions` | 已向设备派发（含返回异常）的动作次数 |
| `totalActions` / `failedActionIndex` / `phase` | 链长 / 停止时动作下标（预检结构问题或终态检查失败为 null）/ 停止阶段 |
| `reason` / `failure` | 中文原因与结构化失败（`kind` + `message` + 原始异常 `raw`） |
| `lastScreenshot` | 停止前最后一张成功取得的截图（PNG 字节） |

副作用分类示例：派发前失败 → `none` 或 `confirmed-partial`；派发返回错误、派发后截图失败、派发后取消 → `unknown`；后图可用但预期画面未出现或终态不符 → `confirmed-partial`。设备断连不会与视觉 no-match 混淆（`device-error` vs `no-match`）。

## 5. 事件流（供报告接入）

`replay-started` → 每步 `step-started` / `screenshot(before)` / `verification(before, targetBox?)` / `dispatch(nativeType, param 快照)` / `dispatch-return` / `screenshot(after)` / `verification(after)` / `step-completed` → `screenshot(terminal)` / `verification(terminal)` → `replay-finished(result)`。模块只产出事件；把事件写入 Midscene 报告（如 `recordToReport`）或渲染 HTML 属调用方职责。

## 6. 已知限制

- 依赖 Matcher 首期边界：不支持缩放/旋转/跨分辨率/跨主题；环境变化直接整链拒绝。
- `waitPollIntervalMs`（默认 100ms）与 `maxAfterWaitMs`（默认 5000ms）为模块参数；无截止时间时等待仍有界，但预算不重置语义只在提供 `deadlineAtMs` 时可验证。
- 终态匹配是页面级视觉一致性（pHash），不是业务断言；语义校验保持独立。
- 本模块不更新 Variant 状态与统计（`replay-succeeded` / `replay-failed` 事件由 Runtime 提交 Store）。Runtime 见 [experience-runtime.md](experience-runtime.md)。
