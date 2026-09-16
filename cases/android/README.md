# cases/android/

Android 使用方业务用例目录。`android` 执行项目只从这里发现 `**/*.{yaml,yml}` 用例。

本框架不内置业务示例或业务流程；使用方将自己的合法 Midscene YAML 放入本目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 `midscene-node-reference.md`（含 `runAdbShell` 等 Android 原生节点与通用生命周期节点）。

`cases/harmony/` 与 `tests/` 下的内容不会被 android 项目收集。
