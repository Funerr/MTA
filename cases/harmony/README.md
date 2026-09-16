# cases/harmony/

HarmonyOS（鸿蒙）使用方业务用例目录。`harmony` 执行项目只从这里发现 `**/*.{yaml,yml}` 用例。

本框架不内置业务示例或业务流程；使用方将自己的合法 Midscene YAML 放入本目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 `midscene-node-reference.md`（含 `runHdcShell` 等 HarmonyOS 原生节点与通用生命周期节点）。

运行前提：本机 HDC（可用 `HDC_HOME` 指定 hdc 所在目录）、已连接的鸿蒙设备与模型 API 配置；多台设备时通过 `HARMONY_DEVICE_ID` 指定目标。`cases/android/` 与 `tests/` 下的内容不会被 harmony 项目收集。
