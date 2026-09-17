# cases/multi-device/

多设备协作执行项目的使用方用例目录。`multi-device` 项目只从这里发现 `**/*.{yaml,yml}`。

本目录与 `cases/android/`、`cases/harmony/` 隔离：单设备用例不会被协作项目收集，协作用例也不会进入单设备项目。

编写约定见 [docs/multi-device-yaml-workflows.md](../../docs/multi-device-yaml-workflows.md) 与生成的 [midscene-node-reference.multi-device.md](../../midscene-node-reference.multi-device.md)。设备别名、平台和设备 ID 环境变量在项目配置中声明（`MULTI_DEVICE_BINDINGS`），YAML 步骤必须显式写成 `<alias>.<native-node>`。

当前 YAML 为 Expert Mode / Execution Workflow。文档推荐 `DUT1/DUT2/DUT3`，使用前须通过 `MULTI_DEVICE_BINDINGS` 显式声明；底层允许任意合法 alias，兼容默认值仍为 `phone1/phone2`。
