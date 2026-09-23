# multi-device-yaml-workflows Delta Spec

## ADDED Requirements

### Requirement: 用例级设备需求声明

协作用例 SHALL 可在 YAML 用例头部声明所需设备别名（如 DUT1 / DUT2）；系统 SHALL 在任何设备操作前校验声明的别名均由项目绑定显式可用，未绑定、重复绑定或设备不可用 MUST 在执行设备操作前失败。设备需求声明 MUST NOT 替代项目级平台声明，也 MUST NOT 隐式创建、改选或复用设备绑定。

#### Scenario: 需求与绑定一致

- **WHEN** 用例头部声明 DUT1 与 DUT2，且项目绑定显式提供这两个别名的设备标识并可用
- **THEN** 用例可按声明使用两台设备执行

#### Scenario: 需求未被绑定满足

- **WHEN** 用例头部声明 DUT3，但项目绑定未提供该别名或该设备不可用
- **THEN** 用例在首个设备操作前失败并指明缺失的别名，不静默改用其他设备

## MODIFIED Requirements

### Requirement: YAML 顺序步骤的目标设备明确

协作项目 SHALL 为每个设备别名提供目标明确的 YAML Node 调用方式，使一个用例可按声明顺序交错调用不同设备的原生操作与断言。未声明的设备别名或该平台不支持的操作 MUST 在执行设备操作前失败。单设备项目现有 YAML Node 名称与输入 MUST 保持兼容；用例发现范围 MUST 与项目结构发现语义一致，MUST NOT 依赖文件名平台后缀。

#### Scenario: 交错执行

- **WHEN** 一个 YAML 用例依次声明设备甲动作、设备乙动作、设备甲断言
- **THEN** 三个步骤按声明顺序分别交给目标设备执行，并在结果中标识各步骤的设备别名

#### Scenario: 错误的目标或操作

- **WHEN** 用例调用未声明别名或目标平台没有的 Node
- **THEN** 用例在该操作派发前失败，不把操作路由到其他设备
