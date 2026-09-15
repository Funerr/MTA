# cases/

使用方业务用例目录。`android` 执行项目只从这里发现 `**/*.{yaml,yml}` 用例。

本框架不内置业务示例或业务流程；使用方将自己的合法 Midscene YAML 放入本目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。可用能力参考生成的 `midscene-node-reference.md`。

框架自身的测试与夹具位于 `tests/`，不会进入本目录的业务发现范围。
