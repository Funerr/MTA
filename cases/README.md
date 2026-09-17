# cases/

使用方业务用例目录，按平台拆分：

- `cases/android/` —— `android` 执行项目的用例发现范围
- `cases/harmony/` —— `harmony` 执行项目的用例发现范围
- `cases/multi-device/` —— `multi-device` 协作项目的用例发现范围（同一 YAML 内操作多台设备）

本框架不内置业务示例或业务流程；使用方将自己的合法 Midscene YAML 放入对应目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。单设备能力参考 `midscene-node-reference.android.md` / `midscene-node-reference.harmony.md`；协作项目参考 `midscene-node-reference.multi-device.md` 与 [docs/multi-device-yaml-workflows.md](../docs/multi-device-yaml-workflows.md)。

默认三项目串行执行（`maxConcurrency: 1`）。`android` / `harmony` 各绑定一台设备；协作用例在 `multi-device` 项目内声明多台设备，不要把官方多项目并发当成同一用例内的步骤同步。

框架自身的测试与夹具位于 `tests/`，不会进入任何平台的业务发现范围。
