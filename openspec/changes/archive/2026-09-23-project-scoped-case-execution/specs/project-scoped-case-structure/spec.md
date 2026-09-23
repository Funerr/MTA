# project-scoped-case-structure Delta Spec

## Purpose

为使用方提供按「项目 → 大模块 → 特性 → 用例」组织业务用例集的目录模型与命名规范：项目即机型代号，执行平台与设备需求在项目级一次声明，使执行入口的组织方式与使用者的业务分类一一对应，且不再依赖文件名后缀与 level 目录表达执行归属。

## ADDED Requirements

### Requirement: 项目域用例组织

业务用例 SHALL 按 `cases/<项目>/<大模块>/<特性>/…` 组织，`<项目>` MUST 为机型代号（如 `EV760`）。目录层级深度不限，目录仅承担分组职责；一个用例文件 MUST 归属于恰好一个项目。

#### Scenario: 归属可确定

- **WHEN** 使用方将合法 YAML 放入 `cases/EV760/system/display/adjust-brightness.yaml`
- **THEN** 该用例归属项目 EV760，并可按项目、大模块、特性、用例各粒度被选择执行

#### Scenario: 更深层目录仍是分组

- **WHEN** 特性目录下存在子目录（如 `cases/EV760/system/display/sub/…`）
- **THEN** 子目录内用例仍归属该特性与项目，不产生新的语义层级

### Requirement: 项目级平台与设备需求声明

每个项目 SHALL 以项目级声明文件（`cases/<项目>/project.yaml`）声明执行平台（android / harmony / multi-device）与设备需求；执行项目归属 MUST 仅由该声明决定，用例文件名 MUST NOT 参与平台判定。声明缺失或取值非法 MUST 在任何执行前报错，MUST NOT 猜测默认平台。

#### Scenario: 平台由项目声明推导

- **WHEN** `cases/EV760/project.yaml` 声明 android 平台且项目内放置若干用例
- **THEN** 全部用例归属 android 执行项目运行，与文件名无关

#### Scenario: 声明缺失或非法

- **WHEN** 项目目录缺少 project.yaml，或平台取值不在 android / harmony / multi-device 之内
- **THEN** 入口在启动任何执行前报错并指引补齐声明，不执行任何用例

### Requirement: 英文命名规范

项目、大模块、特性目录名与 YAML 文件名 SHALL 使用英文 kebab-case；路径中 MUST NOT 出现中文或其他非 ASCII 字符。中文 SHALL 仅作为执行入口的显示标签（如四大模块的内置对照），MUST NOT 进入路径。

#### Scenario: 合法命名被接受

- **WHEN** 使用方按 `cases/EV760/stability/soak/repeat-screen-on-off.yaml` 命名组织用例
- **THEN** 结构被正常识别，用例按声明执行

#### Scenario: 非英文路径被拒绝

- **WHEN** 任一级路径包含非 ASCII 字符
- **THEN** 入口在启动前报错并提示改为英文 kebab-case，不执行任何用例

### Requirement: 新建项目骨架

系统 SHALL 提供新建项目入口，生成项目声明文件模板与四大模块目录骨架（`protocols`、`system`、`core`、`stability`）。骨架是默认模板而非硬编码约束：项目 MUST 可自由增删大模块与特性目录，选择与执行行为 MUST 随实际目录组织呈现。

#### Scenario: 生成骨架

- **WHEN** 使用方新建项目 EV760
- **THEN** 得到 project.yaml 模板与四个大模块目录，可直接开始放置用例

#### Scenario: 自定义大模块被接受

- **WHEN** 项目增加 `camera/` 大模块或删除 `core/` 目录
- **THEN** 选择与执行按实际目录组织正常工作，不要求恢复模板目录

### Requirement: 平台后缀与 level 分级语义退役

业务用例（`cases/` 根）的执行归属判定 MUST NOT 使用文件名平台后缀（`.android.yaml` / `.harmony.yaml` / `.multi-device.yaml`）；`cases/level{1,2,3}` MUST NOT 作为分级或发现结构，smoke / full / level 取值 MUST NOT 作为用户命令面的选择维度。

#### Scenario: 后缀不参与判定

- **WHEN** 文件名为 `foo.android.yaml` 但所属项目声明为 harmony
- **THEN** 该用例按 harmony 归属执行，文件名后缀不改变归属

#### Scenario: 不存在 level 选择维度

- **WHEN** 使用方选择执行范围
- **THEN** 可用粒度为项目、大模块、特性、用例，不存在 level / smoke / full 维度
