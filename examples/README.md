# 演示工作流

以下文件多数由旧 cases 平台目录迁入，均为框架能力示例，不代表已通过真实设备业务验收。运行前核对设备、模型配置、应用包名与步骤。

| 文件 | 身份 |
| --- | --- |
| [android/e2e-comprehensive.yaml](android/e2e-comprehensive.yaml) | Android 综合能力演示 |
| [android/camera-gallery.yaml](android/camera-gallery.yaml) | Android 相机/图库演示 |
| [harmony/e2e-comprehensive.yaml](harmony/e2e-comprehensive.yaml) | HarmonyOS 综合能力演示 |
| [harmony-experience/experience-learn.yaml](harmony-experience/experience-learn.yaml) | 经验学习/重放演示 |
| [multi-device/bluetooth-pair.multi-device.yaml](multi-device/bluetooth-pair.multi-device.yaml) | 多设备协作演示（双真机并行操控蓝牙设置、并行断言与逐设备显式等待；需 `.env` 显式绑定两台设备） |
| [workbench/settings-bluetooth.android.yaml](workbench/settings-bluetooth.android.yaml) | 编写工作台生成示例（见 [workbench/README.md](workbench/README.md)） |

```bash
pnpm case examples/android/camera-gallery.yaml              # 统一入口：演示根自动使用演示配置，只启动该项目
pnpm case examples/multi-device/bluetooth-pair.multi-device.yaml
pnpm exec midscene-test --config midscene.experience.config.ts --project harmony-experience   # 经验演示显式入口
```

演示文件按后缀或演示项目目录（`examples/<项目>/`）推断执行项目；`harmony-experience/` 不是执行项目命名目录，经验演示走上方官方 CLI 显式命令（不经 `pnpm case`）。演示配置不使用业务结构过滤。经验演示须核对配置中的设备环境与纯动作资格策略；是否命中重放应检查 Runtime 事件和模型请求记录，不能仅凭连续执行两次判断。
