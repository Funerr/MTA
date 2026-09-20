# 工作台导出示例

- `settings-bluetooth.android.yaml`：由用例编写工作台从粘贴文本用例生成、经人工确认后导出的 Android 执行工作流（2026-09-18，业务用例 TC-201「打开设置并检查蓝牙开关」）。

## 身份声明

- 这是**工作台生成的示例**，展示导出形态（锚点注释、结构化输入、`$` 元数据保留）；它**未在真实设备上执行**，不代表业务验收通过。
- 执行需显式绑定设备（`ANDROID_DEVICE_ID`），并通过独立配置运行：

```bash
MTA_SUITE=full ANDROID_DEVICE_ID=<udid> \
  npx midscene-test --config midscene.examples.config.ts
```

- 生成过程（导入 → 模型生成 → 静态检查 → 确认 → 导出）的验收记录见 [docs/workbench-acceptance.md](../../docs/workbench-acceptance.md)。
