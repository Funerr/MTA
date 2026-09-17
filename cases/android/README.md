# cases/android/

Android 使用方业务用例目录。`android` 执行项目只从这里发现 `**/*.{yaml,yml}` 用例。

本目录既有 YAML 为明确标识的示例/验收用例，清单见 [cases/README.md](../README.md)，运行本项目时会一并收集。业务用例由使用方维护；使用方将自己的合法 Midscene YAML 放入本目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 [midscene-node-reference.android.md](../../midscene-node-reference.android.md)（含 `runAdbShell` 等 Android 原生节点与通用生命周期节点）。

`cases/harmony/` 与 `tests/` 下的内容不会被 android 项目收集。
