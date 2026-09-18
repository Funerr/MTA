# 演示工作流

以下文件由旧 cases 平台目录迁入，均为框架能力示例，不代表已通过真实设备业务验收。运行前核对设备、模型配置、应用包名与步骤。

| 文件 | 身份 |
| --- | --- |
| [android/e2e-comprehensive.yaml](android/e2e-comprehensive.yaml) | Android 综合能力演示 |
| [android/camera-gallery.yaml](android/camera-gallery.yaml) | Android 相机/图库演示 |
| [harmony/e2e-comprehensive.yaml](harmony/e2e-comprehensive.yaml) | HarmonyOS 综合能力演示 |
| [harmony-experience/experience-learn.yaml](harmony-experience/experience-learn.yaml) | 经验学习/重放演示 |

```bash
pnpm run test:cases --config midscene.examples.config.ts --project android
pnpm run test:cases --config midscene.examples.config.ts --project harmony
pnpm run test:cases --config midscene.experience.config.ts --project harmony-experience
```

演示配置不使用业务 level 过滤。经验演示须核对配置中的设备环境与纯动作资格策略；是否命中重放应检查 Runtime 事件和模型请求记录，不能仅凭连续执行两次判断。
