# midscene-harmony-project Delta Spec

## ADDED Requirements

### Requirement: 项目结构用例的执行环境隔离

harmony 执行项目 SHALL 仅发现项目声明为 harmony 的项目结构内用例（`cases/<项目>/**`），文件名后缀 MUST NOT 参与发现或平台判定；框架测试与夹具 MUST 不进入任何平台的业务发现范围。

#### Scenario: 项目声明发现范围

- **WHEN** 使用方在项目声明为 harmony 的项目结构内（如 `cases/EV760/<大模块>/<特性>/`）放入合法 YAML
- **THEN** harmony 项目发现并运行这些用例；项目声明为其他平台的项目与 `tests/` 下的内容不被 harmony 项目收集

## REMOVED Requirements

### Requirement: 分级用例的执行环境隔离

**Reason**: level 目录分级与平台后缀发现语义退役，用例发现改由项目结构与项目级声明决定（见 ADDED「项目结构用例的执行环境隔离」）。

**Migration**: 将用例放入项目声明为 harmony 的项目结构（`cases/<项目>/<大模块>/<特性>/`），不再依赖 `.harmony` 文件名后缀与 `cases/level{1,2,3}` 目录层级。
