# 视觉匹配夹具摘要

- 数据版本：`visual-matcher-fixtures@1`
- 图像管线：`png-sharp@1`
- 匹配配置：`visual-matcher@1`
- 画面：360×640，状态栏掩码 360×40
- 生成：synthetic-rgba-blit；delta = round(ratio * dimension) on a single axis; historical bbox unchanged
- 分组：同一原始捕获的全部变体进入同一组（校准/验证不拆散原图）。
- 合成位移用于算法边界，不代表真实设备业务页面覆盖率

## cal-row（calibration / row）

- 历史目标框：(72, 240, 120×56)
- 状态框：(248, 252, 52×32)

| 用例 | 期望 | 位移 | 标注目标框 |
| --- | --- | --- | --- |
| original | accept | (0, 0) | (72, 240, 120×56) |
| shift-x-p1 | accept | (4, 0) | (76, 240, 120×56) |
| shift-x-m1 | accept | (-4, 0) | (68, 240, 120×56) |
| shift-y-p1 | accept | (0, 6) | (72, 246, 120×56) |
| shift-y-m1 | accept | (0, -6) | (72, 234, 120×56) |
| shift-x-p3 | accept | (11, 0) | (83, 240, 120×56) |
| shift-x-m3 | accept | (-11, 0) | (61, 240, 120×56) |
| shift-y-p3 | accept | (0, 19) | (72, 259, 120×56) |
| shift-y-m3 | accept | (0, -19) | (72, 221, 120×56) |
| status-bar-changed | accept | (0, 0) | (72, 240, 120×56) |
| other-page-same-icon | reject / page-mismatch | (0, 0) | (72, 240, 120×56) |
| target-removed | reject / target-missing | (0, 0) | (72, 240, 120×56) |
| occluded | reject / target-missing | (0, 0) | (72, 240, 120×56) |
| structural-change | reject / page-mismatch | (0, 0) | (72, 240, 120×56) |
| state-inverted | reject / state-mismatch | (0, 0) | (72, 240, 120×56) |

## cal-icon（calibration / icon）

- 历史目标框：(168, 300, 8×8)

| 用例 | 期望 | 位移 | 标注目标框 |
| --- | --- | --- | --- |
| original | accept | (0, 0) | (168, 300, 8×8) |
| shift-x-p1 | accept | (4, 0) | (172, 300, 8×8) |
| shift-x-m1 | accept | (-4, 0) | (164, 300, 8×8) |
| shift-y-p1 | accept | (0, 6) | (168, 306, 8×8) |
| shift-y-m1 | accept | (0, -6) | (168, 294, 8×8) |
| shift-x-p3 | accept | (11, 0) | (179, 300, 8×8) |
| shift-x-m3 | accept | (-11, 0) | (157, 300, 8×8) |
| shift-y-p3 | accept | (0, 19) | (168, 319, 8×8) |
| shift-y-m3 | accept | (0, -19) | (168, 281, 8×8) |
| status-bar-changed | accept | (0, 0) | (168, 300, 8×8) |
| other-page-same-icon | reject / page-mismatch | (0, 0) | (168, 300, 8×8) |
| target-removed | reject / target-missing | (0, 0) | (168, 300, 8×8) |
| occluded | reject / target-missing | (0, 0) | (168, 300, 8×8) |
| structural-change | reject / page-mismatch | (0, 0) | (168, 300, 8×8) |
| ambiguous-duplicate | reject / ambiguous | (0, 0) | (168, 300, 8×8) |

## val-row（validation / row）

- 历史目标框：(80, 268, 112×52)
- 状态框：(252, 278, 48×32)

| 用例 | 期望 | 位移 | 标注目标框 |
| --- | --- | --- | --- |
| original | accept | (0, 0) | (80, 268, 112×52) |
| shift-x-p1 | accept | (4, 0) | (84, 268, 112×52) |
| shift-x-m1 | accept | (-4, 0) | (76, 268, 112×52) |
| shift-y-p1 | accept | (0, 6) | (80, 274, 112×52) |
| shift-y-m1 | accept | (0, -6) | (80, 262, 112×52) |
| shift-x-p3 | accept | (11, 0) | (91, 268, 112×52) |
| shift-x-m3 | accept | (-11, 0) | (69, 268, 112×52) |
| shift-y-p3 | accept | (0, 19) | (80, 287, 112×52) |
| shift-y-m3 | accept | (0, -19) | (80, 249, 112×52) |
| status-bar-changed | accept | (0, 0) | (80, 268, 112×52) |
| other-page-same-icon | reject / page-mismatch | (0, 0) | (80, 268, 112×52) |
| target-removed | reject / target-missing | (0, 0) | (80, 268, 112×52) |
| occluded | reject / target-missing | (0, 0) | (80, 268, 112×52) |
| structural-change | reject / page-mismatch | (0, 0) | (80, 268, 112×52) |
| state-inverted | reject / state-mismatch | (0, 0) | (80, 268, 112×52) |

## val-icon（validation / icon）

- 历史目标框：(150, 310, 8×8)

| 用例 | 期望 | 位移 | 标注目标框 |
| --- | --- | --- | --- |
| original | accept | (0, 0) | (150, 310, 8×8) |
| shift-x-p1 | accept | (4, 0) | (154, 310, 8×8) |
| shift-x-m1 | accept | (-4, 0) | (146, 310, 8×8) |
| shift-y-p1 | accept | (0, 6) | (150, 316, 8×8) |
| shift-y-m1 | accept | (0, -6) | (150, 304, 8×8) |
| shift-x-p3 | accept | (11, 0) | (161, 310, 8×8) |
| shift-x-m3 | accept | (-11, 0) | (139, 310, 8×8) |
| shift-y-p3 | accept | (0, 19) | (150, 329, 8×8) |
| shift-y-m3 | accept | (0, -19) | (150, 291, 8×8) |
| status-bar-changed | accept | (0, 0) | (150, 310, 8×8) |
| other-page-same-icon | reject / page-mismatch | (0, 0) | (150, 310, 8×8) |
| target-removed | reject / target-missing | (0, 0) | (150, 310, 8×8) |
| occluded | reject / target-missing | (0, 0) | (150, 310, 8×8) |
| structural-change | reject / page-mismatch | (0, 0) | (150, 310, 8×8) |
| ambiguous-duplicate | reject / ambiguous | (0, 0) | (150, 310, 8×8) |

