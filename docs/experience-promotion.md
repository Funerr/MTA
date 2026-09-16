# Experience Promotion（experience-promotion v1）

本文件对应 Change `add-experience-promotion`：把单次成功 AI 调用的**实际执行证据**转为 candidate 资产。Matcher 见 [experience-matcher.md](experience-matcher.md)。Replay 见 [experience-replay.md](experience-replay.md)；Runtime 见 [experience-runtime.md](experience-runtime.md)。

锁定版本：`@midscene/core` / `@midscene/android` / `@midscene/test` **1.12.7**；适配层 `trace-adapter@1`；图像管线 `png-sharp@1`。

## 1. 取数边界（已用真实包验证）

验证入口：`tests/helpers/midscene-agent-harness.ts`。加载实际 Agent，设备用 `ScriptedAndroidDevice` 替换，定位用 `locatedPixelResult` 跳过模型，不编写业务 YAML。公开取数路径是 `Agent.callActionInActionSpace`；`TaskExecutor.runPlans` 只用于证明批量 flush 时序，不是公开稳定面。

公开采集点：

| 来源 | 时机 | 内容 |
| --- | --- | --- |
| `Agent.addDumpUpdateListener` | 任务快照变化时（同次 Step 进行中） | 当前 `ExecutionDump` |
| `Agent.dump.executions` | `callActionInActionSpace` / `runPlans` **返回后**即可读 | 完整 tasks，不必等进程结束 |
| `execution.id` | 每次调用一个新 runner | call 隔离键（学习入口另赋 `callId`） |

截图与目标关联（1.12.7 实测）：

| 字段 | 位置 | 用途 |
| --- | --- | --- |
| 动作前画面 | `Action Space` 任务 `uiContext.screenshot` | before / 有目标动作的裁剪源 |
| 动作后画面 | 本任务 `recorder[].timing === 'after-calling'`；批量 flush 时仅最后任务有此项，中间动作用**后续任务**中 id 不同的 `uiContext.screenshot` | after，禁止用调用结束总图填所有 after |
| 目标框 | `param.locate.rect`（`left/top/width/height`）+ `center` | 截图像素空间；缺 rect 不造 8×8 近似框 |
| 实际点击 | 设备 `tap({x,y})` 使用 locate `center` | 与 bbox 中心一致（dpr=1 时） |

`Finished` 不是设备动作。`Sleep` / `Swipe` / `PullGesture` 等未映射类型整链跳过。

## 2. 支持矩阵

| 原生 subType | 经验类型 | 必填原生参数 | 不支持时 |
| --- | --- | --- | --- |
| `Tap` | Tap | locate.rect + center | 缺框/越界 → 整链 skipped |
| `Input` | Input | `value` 非空；`mode`：`replace`（默认）或 `typeOnly`（映射为经验 `append`） | `clear`（只清空无输入文本）→ skipped |
| `Scroll` | Scroll | `scrollType=singleAction`，`distance` 为正数像素，locate | `scrollTo*` 或 distance 空 → skipped |
| `LongPress` | LongPress | locate，`duration` 正毫秒 | 缺 duration → skipped |
| `AndroidBackButton` | Back | 前后截图 | — |
| `AndroidHomeButton` | Home | 前后截图 | — |
| 其他 | — | — | 整链 skipped，不删问题动作后发布残余链 |

资格：

- 请求须通过 `deriveRequestKey`（未登记 options/context 不合格）。
- `nativeResult.category` 仅 `undefined`（动态文本/判断不学习）。
- 轨迹含 Insight `Assert/Query/WaitFor/Boolean/Number/String` → skipped。
- v1 策略 `allowSemanticChecks` / `allowDynamicOutput` 必须为 false，传入 true 整链 skipped。
- 失败、取消、空链、缺帧、跨调用混杂 → skipped。

学习结果：`promoted` / `skipped` / `failed`。Store `eventId = callId`，重复学习幂等。裁剪或写盘失败为 `failed`，不留下可查询残链，也不再次调用模型。

context 单侧扩边比例 `0.25`，写入入口 `signature.params.padRatio`，并出现在 `PromoteResult.contextPadRatio`。

## 3. 使用方式

```ts
import { promoteExperience, openExperienceStore } from './src/experience';

const knownIds = new Set(executionIdsOf(agent.dump));
await agent.aiAct('打开显示设置'); // 由 Runtime 后续接入；本 Change 不接管 aiAct
const result = await promoteExperience({
  callId,
  dump: agent.dump,
  knownExecutionIds: knownIds,
  request: { caseIdentity, stepPath, node: 'aiAct', prompt, eligibilityPolicyVersion: 'policy@1' },
  environment,
  source: { casePath, caseName, stepPath, node: 'aiAct', prompt },
  store: openExperienceStore('experiences'),
  nativeResult: { category: 'undefined' },
});
```

本 Change **不**注册覆盖原生 aiAct 的透明接入、**不**解析报告 HTML。Runtime 见 [experience-runtime.md](experience-runtime.md)。

## 4. 受控边界与未覆盖

已覆盖：锁定包的 dump 结构、同次 Step 结束后内存轨迹、六类动作转换、Store 发布。

未覆盖（单列，不阻塞本 Change）：真实设备截图、真实模型规划、HTML 报告落盘后 ScreenshotItem 内存释放路径、业务 YAML 执行。
