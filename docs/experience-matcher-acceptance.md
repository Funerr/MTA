# 验收与核对记录 — add-visual-matcher

核对日期：2026-09-16。环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。无真实设备、无模型密钥、无网络图像服务。

## 1. 前置与依赖（任务 1.1）

[add-experience-model](../openspec/changes/archive/2026-09-16-add-experience-model/tasks.md) 与 [add-experience-promotion](../openspec/changes/archive/2026-09-16-add-experience-promotion/tasks.md) 均已完成并归档。Matcher 消费其资产契约：`environment` 精确相等、`target.image`/`contextImage`/`bbox`、上下文扩边 `padRatio=0.25`。

| 项 | 值 |
| --- | --- |
| 图像解码/裁剪 | `sharp@0.34.5`（`png-sharp@1`，与 Promotion 同一管线） |
| 新增 npm 图像依赖 | 无。pHash / ZNCC / SSIM 为本地实现并锁算法版本 |
| 样本验证 | 示例资产 PNG 1080×2400 解码成功；裁剪非空；纯色 roundtrip MAE=0 |
| 网络 | 匹配路径不调用 `fetch` / VLM / 设备动作 |

## 2. 夹具（任务 1.2）

交付目录：[tests/fixtures/visual-matcher/](../tests/fixtures/visual-matcher/)

- 4 个原始捕获：`cal-row` / `cal-icon`（校准）、`val-row` / `val-icon`（验证）。同一原图的全部变体留在同一组。
- 每组覆盖：原图、±1%/±3% 轴对齐位移、状态栏变化、不同页同图标、目标移除、遮挡、结构变化；row 另有开关反转，icon 另有近距重复目标。
- 位移公式：`delta = round(ratio × 边长)`，历史 bbox 不变。合成位移只验证算法边界。

摘要见 `summary.md`，标注见 `manifest.json`。

## 3. 冻结验证（任务 3.1 / 3.2）

校准接受例最小分：目标 NCC = 1、上下文 SSIM = 1、页面相似度 = 0.9375（Hamming 4/64），均不低于冻结阈值。独立验证集逐例结果见 `validation-results.json`：全部声明正例 `match` 且中心落入标注框，全部负例非 `match` 且无 `targetBox`。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Matcher 测试 | `vitest run tests/unit/experience-matcher.test.ts` | ✅ 通过 |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 通过，无错误 |
| 重复运行 | 同输入两次决策与坐标一致 | ✅ |
| 副作用 | 源码无 `@midscene` / `fetch(`；测试中 `fetch` 调用次数为 0 | ✅ |

本机验证单例耗时约 6–20ms（360×640 合成图），不作为性能 SLA。

尚未实现：Replay 接入、真实设备业务页位移、内置 OCR。上述不阻塞本 Change。
