# 定位坐标样本证据（为 support-model-coordinate-mode 提供前置输入）

收集日期：2026-09-20。范围：`midscene_run/report/` 全部 23 份报告（2026-09-16，android 6 份 / harmony 8 份 / test-run 9 份），解析其中 `<script type="midscene_web_dump">` 内嵌 dump。本笔记不是验收记录，仅为后续 change 的输入。

## 提取方法

dump 中 locate 轨迹位于 `executions[].tasks[]` 树内 `type:"locate"` 节点：`taskInfo.rawResponse` 是模型原始输出，`taskInfo.formatResponse.element` 是映射后结果。批量提取脚本按该路径匹配 `"rawResponse"` 中的首个数组字面量。

## 统计结果

- 可解析 locate 样本：42（全部来自 calculator 类流程，设备竖屏 1080×2440，`MIDSCENE_MODEL_FAMILY=xiaomi-mimo`）。
- **raw 坐标含 >1000 值的样本：0**。每样本最大值分布：501–800 共 7，801–950 共 21，951–1000 共 14。
- 映射值与"按 `normalizedBy:1000` 解释、映射到 1080×2440"的公式逐点吻合。例：raw `[70, 470, 253, 551]` → `center [174, 1246]`、`rect.left 76`（= round(70/1000×1080)）。
- 按钮网格（AC / 数字 1 / 2 / 加号 / 等号）在 raw 坐标系内列距、行距一致，映射后中心点同样成整齐网格，且各任务状态均为 finished，无 `exceed` 校验失败痕迹。

## 解读与局限

1. 这批竖屏样本中，xiaomi-mimo 的 `bbox` 输出全部落在 [0,1000]，无法区分"归一化协议遵从"与"模型输入图像恰 ≤1000px 时的像素输出"——即 design.md 所述的不可判定区间。
2. 归一化解释下映射位置构成合理网格且流程执行完成，尚无反证；但**用户报告的越界案例发生在横屏 2160×1080（如 `[0, 170, 2170, 1080]`），不在这批报告内**，横屏场景下模型的坐标行为仍无本地证据。
3. 因此本补丁（越界归一化兼容）与本批样本不冲突：样本全部走原路径，补丁对它们零影响；补丁针对的是尚未有本地样本的越界路径。

## support-model-coordinate-mode 的下一步

- 在横屏设备（2160×1080）上运行含 `aiTap`/`aiAct` 定位的用例，收集 locate dump 中 `rawResponse` 坐标分布：是否出现 >1000 值、越界时语义重试是否收敛。
- 同时记录 `preparedSize`（模型实际输入尺寸），用于判断 raw 值是否等于模型输入图像的像素坐标。
- 若证实模型在两类方向上都稳定输出输入图像像素坐标，则在该 change 中于适配边界显式声明 `coordinates: { normalizedBy 未定义 }` 的像素协议（registry 中 gpt-5/gpt-6 为先例），并可向上游贡献 `xiaomi-mimo` 的 locate 声明；届时移除或保留本补丁由契约测试裁决。
