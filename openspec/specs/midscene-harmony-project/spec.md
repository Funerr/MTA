# midscene-harmony-project Specification

## Purpose

为框架使用方提供 HarmonyOS（鸿蒙）设备的会话建立、确定性设备选择、执行项目接入与原生测试能力注册，与 Android 项目并行串行运行，且同样不依赖框架交付具体业务用例。

## Requirements

### Requirement: 确定性的 HarmonyOS 设备选择

项目 SHALL 支持 `HARMONY_DEVICE_ID` 精确匹配 HDC 目标列表中的设备；未指定时仅当恰有一台在线目标时自动选择。目标不存在、选择歧义或 HDC 环境不可用 MUST 在 UI 操作前失败并返回能够定位原因的错误，不能静默切换设备。HDC 枚举结果不携带授权状态；目标连接问题 SHALL 在会话建立阶段暴露，已取得资源 MUST 被清理。

#### Scenario: 目标明确

- **WHEN** 指定的 `HARMONY_DEVICE_ID` 在 HDC 目标列表中存在，或未指定且只有一台在线目标
- **THEN** 会话绑定该设备并输出所选标识

#### Scenario: 选择或环境失败

- **WHEN** 指定目标不存在、未指定且多台在线目标，或 HDC 环境不可用
- **THEN** 返回能够定位原因的错误，不派发 UI 操作或报告成功

### Requirement: HarmonyOS 会话资源生命周期

框架 SHALL 在执行期创建 HarmonyOS 会话并通过原生 context 供 Nodes 使用；正常结束、执行失败及部分初始化失败后 MUST 释放已取得资源，保留原始错误和清理错误，且不双重释放。

#### Scenario: 正常释放

- **WHEN** 受控边界集成测试完成一次 HarmonyOS 会话并再次创建
- **THEN** 前次资源只释放一次，新会话不复用已销毁对象

#### Scenario: 初始化失败

- **WHEN** 设备连接或 Agent 接管阶段发生错误
- **THEN** 已取得资源被清理，未创建对象不被销毁，错误保持可见

### Requirement: HarmonyOS 原生节点注册

harmony 执行项目 SHALL 通过项目本地注册提供 `HarmonyAgent` 的原生 Nodes（`aiAct`、`aiAssert` 等能力节点与 `launch`、`terminate`、`runHdcShell`、`back`、`home`、`recentApps`），保留原生输入、返回、失败及报告契约，MUST 不与 android 项目的同名节点互相覆盖，不重建 Runner 或报告渲染。

#### Scenario: 项目本地注册

- **WHEN** 配置加载完成且未连接任何设备
- **THEN** harmony 项目可解析到上述原生 Nodes，android 项目仍解析到 AndroidAgent 对应的原生 Nodes（含 `runAdbShell`），双方同名节点各自生效

#### Scenario: 失败结果接入

- **WHEN** 原生边界集成夹具在 harmony 项目中注入节点失败
- **THEN** 原生结果可追踪相关错误和步骤关联，框架不将失败改为成功

### Requirement: 分级用例的执行环境隔离

harmony 执行项目 SHALL 仅从按 level 与业务模块组织且后缀匹配 HarmonyOS 的用例（`cases/level{1,2,3}/**/*.harmony.{yaml,yml}`）发现用例；框架测试与夹具 MUST 不进入任何平台的业务发现范围。

#### Scenario: 目录发现范围

- **WHEN** 使用方在 `cases/level{1,2,3}/**/*.harmony.{yaml,yml}` 放入合法 YAML
- **THEN** harmony 项目发现并运行这些用例；Android 后缀工作流与 `tests/` 下的内容不被 harmony 项目收集
