## MODIFIED Requirements

### Requirement: 工程与能力发现

项目 SHALL 提供可复现依赖安装、框架测试、类型检查和 Node 参考生成入口，覆盖 android 与 harmony 两个执行项目。安装、配置加载及这些检查 MUST 不要求已连接设备或实际模型密钥；业务执行入口使用原生 CLI 并接受使用方提供的内容，android 项目 SHALL 仅从 `cases/android/` 发现用例。

#### Scenario: 无外部环境的工程检查

- **WHEN** 开发者在支持的主机上安装锁定依赖、执行类型检查、框架测试和 Node 参考生成
- **THEN** 检查可在没有设备/模型密钥的条件下完成，参考中包含两平台原生 aiAct/aiAssert、各自平台 shell 节点（`runAdbShell`/`runHdcShell`）与通用生命周期 Nodes

#### Scenario: 业务内容由使用方提供

- **WHEN** 使用方将自己的合法 YAML 放入 `cases/android/`
- **THEN** android 项目提供原生注册和运行入口，不要求先具备框架内置业务示例或专用用例格式
