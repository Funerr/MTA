# Experience Runtime（experience-runtime v1）

把 Lookup、视觉 Replay、原生 AI 与 Promotion 串成实验闭环：命中则一次重放且本步骤不调用 AI；未登记、无候选、入口失配或允许回退的部分失败则**至多一次**原生 `aiAct`；成功后尝试学习。本文件对应 Change `add-experience-fallback`。Replay 见 [experience-replay.md](experience-replay.md)，Promotion 见 [experience-promotion.md](experience-promotion.md)。

锁定：`@midscene/core` / `@midscene/android` / `@midscene/test` **1.12.7**。OCR 默认关闭。资格策略默认空表，框架不内置业务目标。

## 1. 调用契约

```ts
import { ExperienceRuntime, EMPTY_ACTION_POLICY } from './src/experience';

const result = await runtime.run({
  request: { prompt, node: 'experienceAct' },
  identity: { casePath, caseName, stepPath, runId, attempt },
  signal,
  deadlineAtMs,
});
```

YAML 实验入口：

```yaml
- experienceAct: generic-replay-target
```

输入严格为 `{ prompt: string }`。原生 `aiAct` / `aiAssert` 保持独立，不被覆盖。资格策略由使用方注入；默认 `EMPTY_ACTION_POLICY.targets = []`，未登记或含判断/富媒体的请求原样走原生。

## 2. 一次尝试内的分支

1. **资格**：精确 prompt（+ 已登记纯标量 context）且 `deriveRequestKey` 合格才可重放。
2. **Lookup**：`requestKey + environment` 取 candidate/active，排除 stale/坏资产/环境不符；入口 `matchScreen` 验证。新修订优先；同等候选歧义则 MISS。**不向设备试点选链**。报告区分 lookup-found 与 validated-hit。
3. **Replay**：只对选定链尝试一次。成功 → `replay-succeeded` 激活并幂等计数，不调用 AI。
4. **回退**：无候选/坏资产/动作前失败且设备可用 → 原生一次。已确认部分完成仅当 `repeatableFromCurrentState` 时从**当前画面**把完整目标交给原生。`unknown` / 取消 / 超时 → 失败或取消，不追加 AI。
5. **Promotion**：仅原生成功且返回 `undefined` 时学习。写盘失败不改变 UI 成功、不二次执行。后缀链独立取证，不把旧前缀与新后缀合并冒充完整入口链。

## 3. 生命周期

| 事件 | 视觉状态 | 统计 |
| --- | --- | --- |
| 完整重放成功 | candidate → active | `replaySuccess` +1（按 callId 幂等） |
| 明确视觉失效（no-match / matcher-error） | 标 stale | `replayFailure` +1 |
| 设备错误 / 取消 | 不改视觉有效状态 | 不计学习/重放成败 |
| 原生成功 + 发布失败 | 不改已有资产 | UI 仍成功 |

## 4. 观测

Runtime 发出带 run/case/step/attempt/callId 的 `LOOKUP` / `HIT` / `MISS` / `REPLAY` / `FALLBACK` / `PROMOTE` 事件，经 `Agent.recordToReport` 写入原生报告。模型计数区分 Locate-VLM、其他模型、独立 Insight 断言；观测未覆盖时 `status=unknown` 且计数字段为 `null`，**不能把缺失记录写成 0**。原生 `aiAct` 使用 `cacheable: false`，避免把 Planning Cache 命中算成经验行为。

## 5. 已知限制

- 环境契约仍为 android 资产模型；缺少 `experienceEnvironment` 时跳过查询并原生执行。
- 设备/模型传输与时间在测试中可替换；不宣称真实业务页面效果。
- 实验入口 `experienceAct` 仍保留；项目 YAML `aiAct` 的可选透明接入默认关闭，见 [experience-transparent-ai-act.md](experience-transparent-ai-act.md)。不重放内嵌断言、不实现 Assert Promotion。
