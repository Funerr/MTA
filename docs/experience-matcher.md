# Experience Matcher（visual-experience-matching v1）

本地视觉匹配：用当前截图验证历史页面、目标和上下文是否仍可信。命中时给出**当前截图中的目标框**；拒绝时不输出可执行坐标。不调用 VLM、网络 OCR 或设备动作，也不更新 Store。

锁定：图像管线 `png-sharp@1`（`sharp@0.34.5`）；算法 `dct-32-8@1` / `zncc-gray@1` / `ssim-global-gray@1`；配置 `visual-matcher@1`。OCR 默认关闭，不内置模型。

## 1. 调用契约

```ts
import { matchScreen, matchTarget, FROZEN_MATCHER_CONFIG } from './src/experience';

const screen = await matchScreen({
  currentScreenshot,          // PNG 字节
  currentEnvironment,         // 与资产 environment 同结构，须完全相等
  historicalScreenshot,       // 入口或动作前截图
  historicalEnvironment,
  masks: [{ x: 0, y: 0, width, height: statusBarHeight }], // 可选固定动态区
});

const target = await matchTarget({
  currentScreenshot,
  currentEnvironment,
  historical: {
    environment,
    screenshot,               // 动作前整屏
    targetImage,              // 与 bbox 等大的目标裁剪
    contextImage,             // expandBox(bbox, padRatio) 上下文裁剪
    bbox,                     // 历史框，只限定搜索范围，不是命中结果
    stateBefore,              // 可选局部操作前状态图
    stateBox,                 // 状态图在历史截图中的框
    textHint,                 // 有值但默认不作为硬条件（OCR 关闭）
    contextPadRatio: 0.25,
  },
  masks,
});
```

`decision`：

| 值 | 坐标 | 含义 |
| --- | --- | --- |
| `match` | 必有 `targetBox`（`matchScreen` 无框） | 环境、页面、目标、上下文（及未跳过的状态/文本）均过硬阈值 |
| `no-match` | 无 `targetBox` | 保守拒绝，见 `code` |
| `error` | 无 `targetBox` | 坏图、非法配置、资源上界或 OCR 不可用 |

`candidates` 仅为诊断，**不得**当作可执行坐标。分项评分含 value / threshold / passed，不是概率。

### no-match `code`

`environment-incompatible` · `page-mismatch` · `target-missing` · `context-mismatch` · `state-mismatch` · `text-mismatch` · `ambiguous` · `mask-covers-target`

### error `code`

`invalid-image` · `invalid-config` · `resource-limit` · `ocr-unavailable`

## 2. 流水线

1. 校验 PNG、尺寸与环境分辨率一致、资源上界。
2. 环境指纹必须完全相等（分辨率/方向/型号/语言/主题/执行栈版本等）。
3. 固定掩码清零动态区后再做 pHash 页面筛选；掩码不得覆盖目标、上下文或状态框。
4. 在历史 bbox 按截图宽高 **3%** 扩边的窗口内做灰度 ZNCC 搜索；NMS 半径 2px 合并旁瓣。
5. 对候选做上下文 SSIM、可选局部状态 SSIM；多项通过且 top1/top2 差距过小则歧义拒绝。
6. 输出搜索到的当前框，绝不把历史坐标当作命中结果。

首期只支持**相同宽高与方向**的图像；目标尺寸不变且不被截断。

## 3. 冻结阈值（`visual-matcher@1`）

| 项 | 值 |
| --- | --- |
| `searchRadiusRatio` | `0.03` |
| `screenPHashMaxHamming` | `16` / 64 |
| `targetNccMin` | `0.92` |
| `contextSsimMin` | `0.80` |
| `stateSsimMin` | `0.88` |
| `ambiguityGapMin` | `0.05` |
| `nmsRadiusPx` | `2` |
| `ocrEnabled` | `false` |
| `maxImagePixels` | `8_294_400` |
| `maxImageBytes` | 20 MiB |
| `maxSearchPositions` | `250_000` |
| `maxCandidates` | `8` |

阈值只在校准集上确定并写入版本配置。变更配置版本须重新验收，禁止对验证集逐例特调。证据见 [tests/fixtures/visual-matcher/calibration-lock.json](../tests/fixtures/visual-matcher/calibration-lock.json)。

## 4. OCR 支持边界

v1 **默认关闭**。`textHint` 在关闭时跳过，不构成接受条件。若把 `ocrEnabled` 设为 true，必须注入带固定 `modelVersion` / `languagePackVersion` 的本地引擎；未提供引擎返回 `ocr-unavailable`。本仓库不内置 OCR 模型或语言包，也不调用网络 OCR。

## 5. 已知限制

- 不支持任意缩放、旋转、跨分辨率或跨主题匹配；环境变化直接拒绝。
- 位移支持边界是合成夹具上的 ±1% / ±3% 平移，不是真实设备业务覆盖率。
- 模板对主题/系统绘制差异敏感；变化应走后续 AI 回退，而不是放宽本版本阈值。
- 耗时是测量结果（本机验证集约数毫秒到数十毫秒），不承诺绝对性能倍数。
- Promotion 当前不写入 `stateBefore`；调用方若要校验开关前置状态，需自行提供状态图与 `stateBox`。
- Matcher 不读 Store、不截屏、不发设备指令。Replay / Runtime 尚未接入。
