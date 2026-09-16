# 视觉断言实验夹具摘要

- 数据版本：`visual-assert-fixtures@1`
- 图像管线：`png-sharp@1`
- 匹配配置：`visual-matcher@1`
- 样本总数：106（校准 53 / 验证 53）
- 分组：同一原始捕获的全部变体进入同一组，不跨校准/验证拆散原图。
- 布局：控件与文本目标需为 context 扩边留出边距，避免位移后框被夹紧导致尺寸不一致。
- 标注：由绘制参数决定正反状态，不是模型标签；`annotation.modelJudgement` 恒为 null。
- 合成位移用于算法边界，不代表真实设备业务页面覆盖率。

- `binary-control`：正例 20，反例 20，unknown 8
- `open-semantic`：正例 0，反例 0，unknown 10
- `explicit-text`：正例 20，反例 20，unknown 8

## 捕获清单

### cal-wifi（calibration）

- 原图 id：`cal-wifi`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic、open-semantic-extra

### cal-bluetooth（calibration）

- 原图 id：`cal-bluetooth`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

### val-wifi（validation）

- 原图 id：`val-wifi`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic、open-semantic-extra

### val-bluetooth（validation）

- 原图 id：`val-bluetooth`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

### cal-settings-title（calibration）

- 原图 id：`cal-settings-title`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

### cal-airplane-label（calibration）

- 原图 id：`cal-airplane-label`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

### val-settings-title（validation）

- 原图 id：`val-settings-title`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

### val-airplane-label（validation）

- 原图 id：`val-airplane-label`
- 变体：on-original、off-original、on-shift-x-p1、off-shift-x-p1、on-shift-x-m1、off-shift-x-m1、on-shift-y-p1、off-shift-y-p1、on-shift-y-m1、off-shift-y-m1、removed、other-page、open-semantic

