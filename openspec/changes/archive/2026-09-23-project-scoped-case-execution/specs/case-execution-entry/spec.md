# case-execution-entry Delta Spec

## ADDED Requirements

### Requirement: 交互菜单入口

无参数调用且处于交互终端时，入口 SHALL 显示环境自检结果与「项目 → 大模块 → 特性 → 用例」的编号菜单，支持按编号逐级下钻并执行所选范围；四大模块 SHALL 显示中文对照标签，其余分组显示目录原名。非交互环境（无 TTY）MUST NOT 阻塞等待输入，SHALL 以清单形式列出可执行范围后执行显式给定目标或退出。

#### Scenario: 菜单下钻执行

- **WHEN** 新手使用者在交互终端执行 `pnpm case` 并按编号选择一个大模块
- **THEN** 该大模块的用例被执行，其余项目与模块不被启动

#### Scenario: 非交互环境不阻塞

- **WHEN** 在 CI 等无 TTY 环境执行 `pnpm case`（未给目标）
- **THEN** 入口不等待输入，打印可执行范围清单并以非零码退出或执行显式给定目标，不挂起流水线

### Requirement: 运行前置自检

入口 SHALL 在执行前检查模型配置、设备连接与调试等前置条件并以使用者语言呈现结果；任一前置不满足时 MUST 给出单一修复动作指引并阻止执行，不得带病启动或静默降级。

#### Scenario: 全部就绪

- **WHEN** 模型配置存在、目标设备已连接且调试可用
- **THEN** 自检通过，执行继续

#### Scenario: 前置缺失给动作指引

- **WHEN** 模型配置缺失或目标设备未连接
- **THEN** 入口以使用者语言说明缺什么并给出一个具体修复动作（如打开 `.env` 按模板填写、连接设备后重试），不启动任何执行

### Requirement: 运行进度与结果摘要

执行期 SHALL 输出步骤级人话进度，官方详细日志 MUST 退至显式 `--verbose` 之后；执行结束 SHALL 输出摘要（逐条通过情况、失败步骤与预期 vs 实际）并自动在默认浏览器打开本次报告（`--no-open` 或非交互环境可关闭）。退出码与报告语义 MUST 与官方 CLI 一致。

#### Scenario: 进度与日志分层

- **WHEN** 用例执行中
- **THEN** 默认输出步骤级进度（如「✔ 3/9 打开蓝牙开关」），完整官方日志仅在 `--verbose` 下输出

#### Scenario: 结束摘要与报告

- **WHEN** 执行结束（通过或失败）
- **THEN** 摘要列出逐条结果、失败步骤与预期 vs 实际，报告自动打开或打印路径，退出码与官方 CLI 语义一致

## MODIFIED Requirements

### Requirement: 单文件与文件集执行入口

系统 SHALL 提供按命名空间目标执行用例的入口（`pnpm case <目标>...`，目标形如 `<项目>[/<大模块>[/<特性>[/<用例>]]]`，可省略 `.yaml` 后缀），接受一个或多个目标；执行范围 MUST 限定为给定目标解析出的用例，未给出的用例不得执行。目标层级分别对应项目、大模块、特性、用例粒度。

#### Scenario: 运行单条用例

- **WHEN** 使用方执行 `pnpm case EV760/system/display/adjust-brightness` 且该用例存在
- **THEN** 仅该项目该用例被执行，其他用例、模块与项目不被启动

#### Scenario: 运行一个大模块

- **WHEN** 使用方执行 `pnpm case EV760/system`
- **THEN** 该项目该大模块下全部用例被执行，其他模块与项目不被启动

#### Scenario: 一次运行多个目标

- **WHEN** 使用方一次给出多个存在且合法的目标
- **THEN** 所有目标解析出的用例均被执行；涉及多个执行项目时按项目分组顺序执行，未涉及的项目不被启动

### Requirement: 执行项目推断

入口 SHALL 按项目级声明推断执行项目（`cases/<项目>/project.yaml`）；位于 `examples/` 根的演示文件 SHALL 沿用既有演示约定（文件后缀或演示项目目录）推断执行项目。目标无法解析到项目、项目声明缺失或非法 MUST 报错退出，不得猜测默认项目。

#### Scenario: 按项目声明推断

- **WHEN** 使用方给出 `EV760/system/display/adjust-brightness` 且 `cases/EV760/project.yaml` 声明 android
- **THEN** 仅 android 执行项目启动并执行该用例

#### Scenario: 演示文件按既有约定推断

- **WHEN** 使用方提供 `examples/android/<名称>.yaml`
- **THEN** 该文件按 android 项目经演示配置执行，演示语义不变

#### Scenario: 无法解析或声明缺失

- **WHEN** 目标不对应任何项目/用例，或所属项目缺少合法 project.yaml
- **THEN** 入口报错说明原因并以非零码退出，未启动任何执行项目、未建立任何设备会话

### Requirement: 启动前的显式校验与失败报错

入口 MUST 在启动执行前完成校验：目标不存在或无法解析、项目声明缺失或非法、命名不合规范（非英文 kebab-case）、路径不在允许根目录（`cases/` 与 `examples/`）之内等失败均 MUST 报错并以非零码退出，且不执行任何用例、不静默跳过或降级。位于 `examples/` 的文件 MUST 沿用既有演示配置的执行语义。

#### Scenario: 目标不存在

- **WHEN** 使用方给出的目标不对应任何存在的项目、模块、特性或用例
- **THEN** 入口报错指出该目标并以非零码退出，未启动任何执行

#### Scenario: 路径在允许根目录之外

- **WHEN** 使用方提供仓库内 `cases/` 与 `examples/` 之外的 YAML
- **THEN** 入口报错说明允许的根目录并指引既有执行入口，以非零码退出

#### Scenario: 演示文件执行

- **WHEN** 使用方执行 `pnpm case examples/<演示目录>/<名称>.yaml`
- **THEN** 该文件按既有演示配置语义执行，仅启动对应项目

### Requirement: 批量入口兼容

既有批量脚本（`test:cases:*`）SHALL 保留为兼容别名并转发到统一入口；`MTA_SUITE`、`--project`、`--config` MUST NOT 作为用户命令面维度保留，显式给出时 MUST 报错并指引统一入口的写法。批量范围 SHALL 以项目 / 大模块 / 特性粒度表达。

#### Scenario: 旧脚本转发统一入口

- **WHEN** 使用方执行 `pnpm run test:cases`
- **THEN** 行为转发到 `pnpm case` 统一入口，不引入独立的发现或执行语义

#### Scenario: 旧维度报错指引

- **WHEN** 使用方携带 `MTA_SUITE=level2` 或 `--project android` 调用旧批量脚本
- **THEN** 入口报错说明该维度已退役并给出对应的统一入口写法，以非零码退出

### Requirement: Agent 宿主经 Skill 执行

系统 SHALL 以 Skill（`.agents/skills/run-case/`）向 IDE / Agent 宿主提供单点执行能力：宿主内请求运行用例时，Skill SHALL 指导宿主调用同一 `pnpm case` 入口并使用命名空间目标完成执行；Skill MUST NOT 引入独立执行路径、旁路设备会话或额外执行语义，经 Skill 执行的结果 MUST 与命令行直调同构。Skill 内容 SHALL 覆盖：触发时机、命名空间目标映射、显式失败模式与报告位置、环境前置与设备独占提示；批量请求 SHALL 指引同一入口的项目 / 模块粒度目标完成。

#### Scenario: 宿主内执行单条用例

- **WHEN** 使用方在支持 Skill 的宿主中要求运行某个用例（提供名称或路径）
- **THEN** Skill 指导宿主执行 `pnpm case <命名空间目标>`，执行行为与命令行直调一致

#### Scenario: 失败原样回报

- **WHEN** 经 Skill 触发的执行因目标不存在、声明缺失或命名不合规而报错
- **THEN** Skill 指导宿主将错误与修复指引原样回报，不重试、不猜测替代目标、不静默改用批量入口

#### Scenario: 批量请求走统一入口

- **WHEN** 使用方经 Skill 请求项目级或模块级批量执行
- **THEN** Skill 指导以项目 / 模块粒度目标调用同一入口及其设备独占注意事项，不引入新的批量执行语义
