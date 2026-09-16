# cases/

使用方业务用例目录，按平台拆分：

- `cases/android/` —— `android` 执行项目的用例发现范围
- `cases/harmony/` —— `harmony` 执行项目的用例发现范围

本框架不内置业务示例或业务流程；使用方将自己的合法 Midscene YAML 放入对应平台目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 `midscene-node-reference.md`。两项目串行执行（`maxConcurrency: 1`），各自绑定一台设备。

框架自身的测试与夹具位于 `tests/`，不会进入任何平台的业务发现范围。
