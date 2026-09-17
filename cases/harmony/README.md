# cases/harmony/

HarmonyOS（鸿蒙）使用方业务用例目录。`harmony` 执行项目只从这里发现 `**/*.{yaml,yml}` 用例。

本目录既有 YAML 为明确标识的示例/验收用例，清单见 [cases/README.md](../README.md)，运行本项目时会一并收集。业务用例由使用方维护；使用方将自己的合法 Midscene YAML 放入本目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 [midscene-node-reference.harmony.md](../../midscene-node-reference.harmony.md)（含 `runHdcShell` 等 HarmonyOS 原生节点与通用生命周期节点）。

运行前提：本机 HDC（可用 `HDC_HOME` 指定 hdc 所在目录）、已连接的鸿蒙设备与模型 API 配置；多台设备时通过 `HARMONY_DEVICE_ID` 指定目标。`cases/android/` 与 `tests/` 下的内容不会被 harmony 项目收集。
