# case-execution-entry Delta Spec

## Purpose

为使用方提供按 YAML 文件路径的单点用例执行能力：把执行范围收窄到目标文件及其对应的执行项目，降低单文件执行的命令成本与无关项目启动开销；同时以 Skill 形式把同一入口交付给 IDE / Agent 宿主，使宿主内无需阅读工程代码即可运行用例，且官方 Midscene Runner 的运行语义完全不变。

## ADDED Requirements

### Requirement: 单文件与文件集执行入口

系统 SHALL 提供按 YAML 文件路径执行用例的入口（`pnpm case <yaml 路径...>`），接受一个或多个用例文件路径；执行范围 MUST 限定为给定的文件，未给出的文件不得执行。

#### Scenario: 运行单个业务文件

- **WHEN** 使用方执行 `pnpm case cases/level1/<模块>/<名称>.android.yaml` 且该文件存在
- **THEN** 仅 android 执行项目启动，且只执行该文件中的用例；harmony 与 multi-device 项目不被启动（无设备会话 setup，也不产生「未找到 YAML 用例」收集错误）

#### Scenario: 一次运行多个文件

- **WHEN** 使用方一次给出多个存在且合法的文件路径
- **THEN** 所有给定文件中的用例均被执行；不同执行项目的文件按项目分组后各自执行，未涉及的项目不被启动

### Requirement: 执行项目推断

入口 SHALL 按文件后缀推断执行项目：`.android.yaml` → android、`.harmony.yaml` → harmony、`.multi-device.yaml` → multi-device。位于 `examples/` 根且无平台后缀的演示文件，SHALL 按其所在的项目目录（`examples/<执行项目>/`）推断，与演示配置按项目目录发现文件的既有约定一致。既无平台后缀、也无法按演示项目目录确定性推断的文件 MUST 报错退出，不得猜测默认项目。使用方显式指定的项目与推断结果冲突时，入口 MUST 在启动任何执行前报错并以非零码退出。

#### Scenario: 后缀推断成功且未显式指定项目

- **WHEN** 使用方仅提供路径 `cases/level2/<名称>.harmony.yaml`
- **THEN** 仅 harmony 项目被启动并执行该文件

#### Scenario: 演示文件按项目目录推断

- **WHEN** 使用方提供 `examples/android/<名称>.yaml`（无平台后缀，位于 android 演示目录）
- **THEN** 该文件按 android 项目经演示配置执行

#### Scenario: 显式项目与推断一致

- **WHEN** 使用方提供 `--project android` 且文件后缀为 `.android.yaml`
- **THEN** 按显式指定执行 android 项目

#### Scenario: 显式项目与推断冲突

- **WHEN** 使用方提供 `--project harmony` 但文件后缀为 `.android.yaml`
- **THEN** 入口报错说明冲突并以非零码退出，未启动任何执行项目、未建立任何设备会话

#### Scenario: 无法推断

- **WHEN** 使用方提供的文件既不含平台后缀（如 `cases/level1/<名称>.yaml`），也不位于 `examples/<执行项目>/` 目录（如 `examples/harmony-experience/`）
- **THEN** 入口报错列出支持的后缀与目录规则并以非零码退出，不执行该文件

### Requirement: 委托官方 Runner 且运行语义不变

入口 MUST 通过官方 Midscene 测试 CLI 完成实际执行；自身只负责文件选择与项目选择。退出码传递、报告输出位置（`midscene_run/report/`）、重试与并发语义 MUST 与既有批量入口一致；同一文件经本入口与经官方 CLI 直接执行 SHALL 产生同构的执行结果与报告。

#### Scenario: 结果与官方入口同构

- **WHEN** 同一用例文件分别经 `pnpm case` 与既有官方 CLI 入口执行成功
- **THEN** 两者的用例结果结构一致，报告均写入 `midscene_run/report/` 且可正常组装查看

#### Scenario: 用例失败时退出码传递

- **WHEN** 经 `pnpm case` 执行的用例中存在失败
- **THEN** 入口以非零码退出，失败信息可在既有报告中查看

### Requirement: 启动前的显式校验与失败报错

入口 MUST 在启动执行前完成校验：文件不存在、路径不在允许根目录（`cases/` 与 `examples/`）之内、后缀无法推断、显式项目冲突等失败均 MUST 报错并以非零码退出，且不执行任何用例、不静默跳过或降级。位于 `examples/` 的文件 MUST 沿用既有演示配置的执行语义（不套用业务 level 过滤）。

#### Scenario: 文件不存在

- **WHEN** 使用方提供的路径不存在
- **THEN** 入口报错指出该路径并以非零码退出，未启动任何执行

#### Scenario: 路径在允许根目录之外

- **WHEN** 使用方提供仓库内 `cases/` 与 `examples/` 之外的 YAML 路径
- **THEN** 入口报错说明允许的根目录并指引既有执行入口，以非零码退出

#### Scenario: 演示文件执行

- **WHEN** 使用方执行 `pnpm case examples/<演示目录>/<名称>.android.yaml`
- **THEN** 该文件按既有演示配置语义执行（不做业务 level 过滤），仅启动对应项目

### Requirement: 批量入口兼容

单文件入口的引入 MUST NOT 改变既有批量入口（`test:cases:*` 脚本、`MTA_SUITE` 取值、`--project`、`--config`）的文件发现范围与执行语义；不使用单文件入口时，系统行为与引入前一致。

#### Scenario: 批量入口行为不变

- **WHEN** 使用方按既有方式执行 `MTA_SUITE=<取值> pnpm test:cases[--project <项目>]`
- **THEN** 文件发现范围、项目选择、执行与报告行为与引入本入口之前完全一致

### Requirement: Agent 宿主经 Skill 执行

系统 SHALL 以 Skill（`.agents/skills/run-case/`）向 IDE / Agent 宿主提供单点执行能力：宿主内请求运行用例文件时，Skill SHALL 指导宿主调用同一 `pnpm case` 入口完成执行；Skill MUST NOT 引入独立执行路径、旁路设备会话或额外执行语义，经 Skill 执行的结果 MUST 与命令行直调同构。Skill 内容 SHALL 覆盖：触发时机、命令映射（含按后缀推断执行项目）、显式失败模式与报告位置、环境前置（`.env` 模型配置）与设备独占提示；批量/全量执行请求 SHALL 指引既有批量入口完成，不新增批量语义。

#### Scenario: 宿主内执行单个文件

- **WHEN** 使用方在支持 Skill 的宿主中要求运行某个 YAML 用例文件并提供路径
- **THEN** Skill 指导宿主执行 `pnpm case <路径>`，执行行为与命令行直调一致

#### Scenario: 失败原样回报

- **WHEN** 经 Skill 触发的执行因文件不存在、后缀未知或与显式项目冲突而报错
- **THEN** Skill 指导宿主将错误与修复指引原样回报，不重试、不猜测替代文件、不静默改用批量入口

#### Scenario: 批量请求走既有入口

- **WHEN** 使用方经 Skill 请求套件级或全量执行
- **THEN** Skill 指引既有批量入口（`test:cases:*` 组合 `MTA_SUITE` / `--project`）及其设备独占注意事项，不引入新的批量执行语义
