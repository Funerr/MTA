# Experience 资产契约（experience-assets v1）

本文是 `add-experience-model` 交付的 v1 资产字段说明。运行期校验的实现位于 `src/experience/schema/`，本文件与实现保持一致；示例资产与读取说明见文末。

- 格式版本：`schemaVersion = 1`。不兼容版本拒绝读取，不做静默迁移。
- 存放位置：工程根下 `experiences/`（索引 `index.json` + 内容寻址图片 `assets/<sha256>.png`），与 `midscene_run/` 运行产物严格分离。
- 首期单进程单写者；不使用数据库或分布式存储。

## 1. Experience（一条聚合请求）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | 是 | 格式版本，当前仅支持 `1` |
| `requestKey` | 64 位十六进制 | 是 | 精确请求 Key（派生规则见 §5） |
| `source` | Source | 是 | 学习来源元数据 |
| `createdAt` / `updatedAt` | ISO 8601 | 是 | 创建/最近更新时间 |
| `variants` | Variant[]（≥1） | 是 | 同一请求在不同环境/入口学到的链 |

## 2. Source（学习来源）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `casePath` | string | 是 | 用例文件的项目相对路径（拒绝绝对路径与 `..` 段） |
| `caseName` | string | 是 | 用例名称 |
| `stepPath` | string | 是 | 步骤位置（含 hook/steps 定位，同样限定项目内相对位置） |
| `node` | `'aiAct'` | 是 | 逻辑节点（`experienceAct` 归一化为 `aiAct` 后登记） |
| `prompt` | string | 是 | 原始请求文本（原样保存，不 trim、不改写） |
| `callId` | string | 是 | 单次调用标识；Promotion 以其作为发布 eventId |
| `midsceneVersion` | string | 是 | 学习时的 Midscene 版本 |
| `adapterVersion` | string | 是 | 轨迹适配层版本 |
| `capturedAt` | ISO 8601 | 是 | 取证时间 |

只持久化协议所需元数据，不复制完整模型请求日志，不写入任何密钥。

## 3. Variant（环境 + 入口区分的链）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `variantId` | 64 位十六进制 | 是 | `sha256("variant:" + environmentFingerprint + ":" + entryFingerprint)`，校验时重算防错绑 |
| `environment` | Environment | 是 | 学习时的执行环境（见 §4） |
| `environmentFingerprint` | 64 位十六进制 | 是 | 环境规范化 JSON 的 sha256；兼容要求完全相等 |
| `entryFingerprint` | 64 位十六进制 | 是 | 入口结构指纹（内容摘要+尺寸）；仅用于修订归组，不作为查找命中依据 |
| `revisions` | Revision[]（≥1） | 是 | 修订历史，修订号从 1 连续递增，仅最大修订参与查询/更新 |

### 3.1 Revision（一次学习的链修订）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revision` | 正整数 | 是 | Variant 内修订号，从 1 连续递增 |
| `status` | `candidate` \| `active` \| `stale` | 是 | 新学习为 candidate；验证成功的首次重放激活为 active；不可靠链标记 stale（须携带 `staleReason`）。仅 candidate/active 可作为重放候选 |
| `entryEvidence` | ScreenEvidence | 是 | 入口画面证据；是否匹配由后序 matcher 按相似性验证，不使用全屏精确哈希查找 |
| `terminalEvidence` | ScreenEvidence | 是 | 终态结构一致性证据；不是语义断言缓存 |
| `actions` | Action[]（≥1） | 是 | 有序动作链（见 §6） |
| `eligibilityPolicyVersion` | string | 是 | 纯动作资格策略版本 |
| `nativeResult` | `{ category: 'undefined' }` | 是 | 原生结果类别；v1 仅允许 `undefined`（纯动作调用），动态输出不复用 |
| `evidenceComplete` | `true` | 是 | 完整取证标记，v1 恒为 `true` |
| `learnedAt` | ISO 8601 | 是 | 本次学习时间 |
| `staleReason` | string | stale 时必填 | 失效原因（历史可追踪） |
| `stats` | Stats | 是 | `{ learned, replaySuccess, replayFailure }`；由 Store 按事件幂等更新 |

## 4. Environment（执行环境）

所有字段必需，任一不一致即不兼容；未知/缺失必需字段不作为通配符。不使用设备序列号（允许同型号复用），也不默认跨系统版本复用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `platform` | `'android'` | v1 仅支持 android |
| `model` | string | 设备型号 |
| `systemBuild` | string | 系统版本号 |
| `resolution` | `{ width, height }` | 物理分辨率（正整数） |
| `orientation` | `portrait` \| `landscape` | 方向 |
| `language` | string | 系统语言 |
| `theme` | string | 系统主题（如 `light`/`dark`，自由字符串） |
| `executionCompatVersion` | string | 执行栈兼容版本（Midscene 版本与适配层版本组合） |

## 5. 请求 Key（requestKey）与节点归一化

- 输入：case 身份（`casePath`+`caseName`）、`stepPath`、逻辑节点、原始 `prompt`、有效 `options`/`context`、`eligibilityPolicyVersion`、Key 算法标识。
- 计算：严格规范化 JSON（对象键排序、无空白）后 sha256；字符串内容不 trim、不改写；运行 ID、取消信号不进入 Key。
- 节点归一化：外部调用名 `experienceAct`/`aiAct` 归一化为逻辑节点 `aiAct`，两者 Key 相同，便于阶段 7 迁移。
- 资格：v1 只缓存已登记纯文本请求。`options`/`context` 的键必须已登记（默认登记集合为空），值必须是纯 JSON 标量；图片或未知语义参数使请求不合格（直接走原生路径），未知字段不通配。

## 6. 动作链（Action）

动作类型只映射原生动作：`Tap`、`Input`、`Scroll`、`LongPress`、`Back`、`Home`。不新增 `VisualTap` 等类型；出现未支持类型时整链拒绝，禁止静默丢弃该动作后接受残余链。

公共字段（所有动作必填）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | 动作类型 | 判别字段 |
| `before` / `after` | ScreenEvidence | 动作前/后屏幕取证（不能缺失） |

有目标动作（`Tap`/`Input`/`Scroll`/`LongPress`）额外必填 `target`（TargetEvidence，不能仅保存坐标）；`Back`/`Home` 为系统导航，不强造目标图。

### 6.1 TargetEvidence

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | ImageEvidence | 是 | 目标图裁剪；尺寸必须与 `bbox` 一致 |
| `contextImage` | ImageEvidence | 是 | 上下文裁剪（含扩边）；尺寸必须覆盖 `bbox`（扩边比例由 Promotion 记录在其元数据） |
| `bbox` | BoundingBox | 是 | 原始目标框，坐标绑定操作前截图像素空间，不得越界 |
| `textHint` | string | 否 | 目标文本提示（非空） |
| `stateBefore` | ImageEvidence | 否 | 局部操作前状态证据 |

有向坐标参数（bbox、滚动锚点）绑定截图像素空间，必须能由当前定位重新投影；越界即拒绝该动作版本。

### 6.2 各类型参数

| 类型 | 参数 | 说明 |
| --- | --- | --- |
| `Tap` | — | 目标由 `target.bbox` 表达 |
| `Input` | `params.text`（非空）、`params.mode`（`append` \| `replace`） | 完整输入内容与写入模式 |
| `Scroll` | `params.direction`（`up`/`down`/`left`/`right`）、`params.distancePx`（正整数像素）、`params.anchor`（`{x,y}` 界内锚点） | 方向、距离与投影锚点 |
| `LongPress` | `params.durationMs`（正整数毫秒） | 按压时长 |
| `Back` / `Home` | — | 仅前后证据 |

## 7. 图片与签名

| 结构 | 字段 | 说明 |
| --- | --- | --- |
| AssetRef | `digest`（64 位小写十六进制 sha256）、`byteSize`（正整数）、`mimeType`（v1 仅 `image/png`） | 内容寻址引用；文件路径由摘要推导为 `assets/<digest>.png`，引用不携带路径 |
| ImageEvidence | AssetRef + `width`/`height`（正整数） | 图片及其原始像素尺寸；bbox/锚点均绑定该空间 |
| ImageSignature | `algorithm`、`version`、`params`（纯 JSON 标量映射）、`value` | 视觉内容签名（供 matcher 相似性使用），与完整性摘要职责不同，不得混淆 |
| ScreenEvidence | `screenshot: ImageEvidence` + `signature: ImageSignature` | 屏幕级证据；动作前后、入口与终态共用 |

## 8. 校验与错误语义（摘要）

- 校验分两层：严格 schema（未声明字段一律拒绝）+ 语义校验（动作链非空、bbox/锚点界内、目标图与 bbox 一致、修订号连续、stale 必有原因、指纹可重算一致、variantId 唯一）。失败返回具体原因清单，资产整体不成为可查询候选。
- Store 错误分类：`not-found`、`invalid-asset`（含路径越界、摘要不匹配、损坏）、`unsupported-version`、`io-error`、`revision-conflict`。降级决策由 Runtime 负责，Store 不调用 AI。
- 完整需求以 [spec.md](../openspec/changes/add-experience-model/specs/experience-assets/spec.md) 为准。

## 9. 读取与写入说明

公共入口为 `src/experience/index.ts`（`openExperienceStore`、`deriveRequestKey`、schema 与校验函数）。

```ts
import { openExperienceStore, deriveRequestKey } from './src/experience/index';

// 1) 由请求派生精确 Key（未登记参数会使请求不合格，直接走原生路径）
const key = deriveRequestKey({
  caseIdentity: { casePath: 'cases/settings.yaml', caseName: 'settings-display' },
  stepPath: 'steps[2]',
  node: 'aiAct',                 // experienceAct 会归一化为 aiAct
  prompt: '打开显示设置',
  eligibilityPolicyVersion: 'policy@1',
});
if (!key.eligible) { /* 走原生路径，不建经验 */ }

// 2) 查询当前环境下的可重放候选（入口是否匹配由后序 matcher 验证）
const store = openExperienceStore('experiences');
const found = await store.findCandidates({
  requestKey: key.requestKey,
  environment: {
    platform: 'android', model: 'Pixel 8', systemBuild: 'AP4A.250105.002',
    resolution: { width: 1080, height: 2400 }, orientation: 'portrait',
    language: 'zh-CN', theme: 'light',
    executionCompatVersion: 'midscene@1.12.7+adapter@1',
  },
});
if (found.ok) {
  for (const chain of found.value) {
    const entry = await store.readAssetImage(chain.entryEvidence.screenshot.asset);
    // entry.ok 且摘要校验通过后，交由 matcher 与当前画面比对
  }
}

// 3) 学习成功后发布 candidate（Promotion 以 callId 作为 eventId）
const published = await store.publishCandidate({
  eventId: callId,
  requestKey: key.requestKey,
  source: { /* casePath/caseName/stepPath/node/prompt/callId/版本/时间 */ },
  environment,
  variant: { entryEvidence, terminalEvidence, actions, eligibilityPolicyVersion },
  images, // Map<digest, Uint8Array>：本次链引用的全部图片字节
});

// 4) 重放结果按 expectedRevision + eventId 幂等更新
await store.applyVariantEvent({
  eventId: runEventId,
  requestKey: key.requestKey,
  variantId: published.ok ? published.value.snapshot.variantId : '',
  expectedRevision: 1,
  event: { type: 'replay-succeeded' }, // 或 replay-failed / marked-stale（须 reason）
});
```

## 10. 完整示例资产

受控示例位于 [tests/fixtures/experience-example/](../tests/fixtures/experience-example/)：由上述发布接口真实写入（`index.json` + 19 张 PNG），记录一次 `aiAct("打开显示设置")` 学习：

| 项 | 值 |
| --- | --- |
| requestKey | `c033e63e04a6fdb5d279136901741e2af50adda310d573fd41de7bfc308961da` |
| variantId | `4e0481901b59239858e05c7f05cb76e4269e404611db08efb239bbb435c540e6` |
| 来源 | `cases/settings.yaml` / `settings-display` / `steps[2]` / callId `call-20260915-0001` |
| 动作链 | `Tap`（bbox 120,400,200x96）→ `Input`（text `显示`，mode `append`）→ `Scroll`（down，640px，锚点 540,1800）→ `Home` |
| 状态 | revision 1 / candidate / stats `{learned:1, replaySuccess:0, replayFailure:0}` |

该示例由 `tests/integration/example-asset-roundtrip.test.ts` 验证可往返：读取唯一候选、字段与本文档一致、索引通过完整校验、全部取证图片为合法 PNG 且摘要一致、环境变化后不可命中。

## 11. 与 Promotion 规划的契约核对（任务 3.2）

对照 [add-experience-promotion 设计](../openspec/changes/add-experience-promotion/design.md) 与规格逐项核对，结论如下：

| Promotion 期望 | v1 契约 | 结论 |
| --- | --- | --- |
| Tap/Input/Scroll/LongPress/Back/Home 逐类型映射，未知类型整链跳过 | 动作判别联合恰好这六类，未支持类型整体拒绝 | 一致 |
| 每动作保存 before/after、target/context 裁剪与签名；候选保留真实 entry/terminal | `before`/`after`/`target.image`/`target.contextImage`/`signature` 必填，Variant 修订保存 `entryEvidence`/`terminalEvidence` | 一致 |
| bbox 绑定物理截图像素，越界/裁剪为空/缺失帧报错 | bbox 与锚点绑定 before 截图像素空间并做界内校验；目标图尺寸须与 bbox 一致 | 一致 |
| Store eventId 使用 callId，重复学习幂等；promoted/skipped/failed 由学习入口分类 | `publishCandidate` 以 `eventId` 幂等并返回 `promoted`/`duplicate`；skipped/failed 在 Promotion 层判定，不进入 Store | 一致 |
| 纯动作资格由登记策略表达 | 修订必填 `eligibilityPolicyVersion`，`nativeResult.category` 仅 `undefined` | 一致 |
| 中途回退后缀绑定真实入口，入口 A 查询不能绕过入口验证 | `variantId` 由环境指纹 + 入口指纹派生；查询返回 `entryEvidence` 供 matcher 验证，不做全屏精确哈希命中 | 一致 |

需要注意的两点（非冲突，实施 Promotion 时按设计的风险条款处理，必要时先更新本规格）：

1. `Scroll.distancePx` 为必填正整数像素。若锁定版本的原生滚动无法提供固定距离，属于协议变更，须先更新本规格与后续规划，不能静默省略。
2. context 裁剪的扩边比例由 Promotion 记录在其自身元数据；v1 资产契约只校验 `contextImage` 尺寸覆盖 bbox。若扩边比例须进入资产字段，同样走规格更新。
