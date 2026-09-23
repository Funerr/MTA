# midscene-android-project Delta Spec

## MODIFIED Requirements

### Requirement: 工程与能力发现

项目 SHALL 提供可复现依赖安装、框架测试、类型检查和 Node 参考生成入口，覆盖 android 与 harmony 两个执行项目。安装、配置加载及这些检查 MUST 不要求已连接设备或实际模型密钥；业务执行入口使用原生 CLI 并接受使用方提供的内容，android 项目 SHALL 仅发现项目声明为 android 的项目结构内用例（`cases/<项目>/**`），文件名后缀 MUST NOT 参与发现或平台判定。

#### Scenario: 无外部环境的工程检查

- **WHEN** 开发者在支持的主机上安装锁定依赖、执行类型检查、框架测试和 Node 参考生成
- **THEN** 检查可在没有设备/模型密钥的条件下完成，参考中包含两平台原生 aiAct/aiAssert、各自平台 shell 节点（`runAdbShell`/`runHdcShell`）与通用生命周期 Nodes

#### Scenario: 业务内容由使用方提供

- **WHEN** 使用方将自己的合法 YAML 放入项目声明为 android 的项目结构（如 `cases/EV760/<大模块>/<特性>/`）
- **THEN** android 项目提供原生注册和运行入口，不要求先具备框架内置业务示例、专用用例格式或文件名平台后缀
