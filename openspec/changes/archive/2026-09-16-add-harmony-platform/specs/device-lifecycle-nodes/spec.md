## MODIFIED Requirements

### Requirement: 准备设备到 Home

`device.prepare` SHALL 接受且仅接受 `{ target: home }`，在当前运行绑定且已解锁的设备（android 或 harmony 项目）上返回该平台主屏。Node MUST 对已有 Home 状态保持幂等，不承担解锁、重置网络、恢复出厂或业务初始状态准备。

#### Scenario: 从其他页面准备

- **WHEN** 设备已解锁且位于设置或其他应用，`beforeEach` 调用 `device.prepare: { target: home }`
- **THEN** 设备返回主屏，节点成功后运行器才继续用例步骤

#### Scenario: 已处于 Home

- **WHEN** 设备已处于主屏并再次调用准备节点
- **THEN** 节点成功，设备仍处于主屏，不修改业务相关系统设置

#### Scenario: 非法输入

- **WHEN** 输入缺少 `target`、`target` 不是 `home`，或含未声明业务字段
- **THEN** 节点输入校验失败且不执行设备动作

### Requirement: 恢复设备到 Home

`device.recover` SHALL 接受空对象 `{}`，在当前绑定设备（android 或 harmony 项目）上返回该平台主屏，且能够在准备或用例步骤仅部分完成时调用。它 MUST 保留当前系统设置，包括使用方业务状态；恢复成功仅表示完成此 Home 基线恢复。

#### Scenario: 用例成功后恢复

- **WHEN** 调用方步骤完成且设备仍在其他页面，`afterEach` 调用 `device.recover: {}`
- **THEN** 设备返回主屏，业务状态保持调用结束时的状态，恢复步骤在结果中可见

#### Scenario: 准备或用例失败后恢复

- **WHEN** 项目 setup 已成功，但 `beforeEach` 或用例步骤失败，且设备仍可用
- **THEN** 原生生命周期继续调用 `afterEach` 中的恢复节点并返回 Home，同时保留原失败结果

#### Scenario: 重复恢复

- **WHEN** 在主屏重复调用 `device.recover: {}`
- **THEN** 节点成功且保持主屏状态

#### Scenario: 恢复输入非法

- **WHEN** 调用恢复节点时传入任意未声明业务字段
- **THEN** 输入校验失败且不执行设备动作
