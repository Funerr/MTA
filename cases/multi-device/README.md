# cases/multi-device/

多设备协作执行项目的使用方用例目录。`multi-device` 项目只从这里发现 `**/*.{yaml,yml}`。

本目录与 `cases/android/`、`cases/harmony/` 隔离：单设备用例不会被协作项目收集，协作用例也不会进入单设备项目。

编写约定见 [docs/multi-device-yaml-workflows.md](../../docs/multi-device-yaml-workflows.md) 与生成的 `midscene-node-reference.multi-device.md`。设备别名、平台和设备 ID 环境变量在项目配置中声明（`MULTI_DEVICE_BINDINGS`），YAML 步骤必须显式写成 `<alias>.<native-node>`。
