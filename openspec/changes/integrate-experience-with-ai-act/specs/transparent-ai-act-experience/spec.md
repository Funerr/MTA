## Purpose

为现有项目 YAML 用例提供可关闭的 aiAct 经验接入，在保持原生输入、失败和生命周期契约的同时复用已验证的动作经验，让用例作者无需知道内部查询、匹配或回退机制也能使用合格的视觉重放。

## ADDED Requirements

### Requirement: 项目内透明与可关闭

启用项目级开关后，合格 YAML aiAct 调用 SHALL 使用 Experience Runtime，用户无需改 Node 名称或增加经验字段；默认关闭时 MUST 完全走原生路径且不读写经验。影响范围限定当前项目。

#### Scenario: 同一 YAML 切换模式

- **WHEN** 对同一合法 Node 输入或最小 YAML 框架夹具分别关闭和开启经验开关
- **THEN** 关闭时执行原生 AI；开启且命中时重放，用例 prompt 和步骤格式相同

#### Scenario: 其他 Agent 或项目

- **WHEN** 当前项目启用透明接入，其他项目或直接调用 Agent 的脚本运行
- **THEN** 不因全局原型修改而被拦截

### Requirement: 原生输入和不支持行为保真

接入 SHALL 保留官方输入校验、options、context、取消、返回值和错误语义。不支持的富媒体输入、参数组合、包含判断或需动态输出的目标 MUST 原样透传原生路径；不能仅因有旧资产而忽略输入。

#### Scenario: 富媒体或未支持 options

- **WHEN** aiAct 接收图片 prompt 或不在声明支持集中的 options
- **THEN** 调用原生执行并保留所有参数，不查询或重放简化后的请求

#### Scenario: 运行产生输出文本

- **WHEN** 原生学习调用返回了非空文本而首期重放无法等价提供输出
- **THEN** 返回原生文本且该调用不获得重放资格，不把缓存文本当作新的语义结果

#### Scenario: 非法参数

- **WHEN** YAML 输入违反当前官方 schema
- **THEN** 保持官方校验失败，不由经验接入转为可执行输入

### Requirement: 一次执行链与失败语义

透明接入 SHALL 保证回退调用原生实现不会再次经过自身，超时和取消预算由原生生命周期共享；经验异常可按 Runtime 策略降级，原生失败 MUST 保持失败。

#### Scenario: 命中后回退

- **WHEN** 重放失配导致一次 AI 回退
- **THEN** 原生 AI 只调用一次，没有递归、双重注册或重复 Promotion

#### Scenario: 原生失败与取消

- **WHEN** 原生执行失败或收到取消信号
- **THEN** 报告相应失败/取消并继续原生清理，不能被接入层吞掉或重置超时

### Requirement: 兼容与回归证据

交付 SHALL 保留 experienceAct 实验入口及独立原生 aiAssert，报告中透明调用仍可识别为原 aiAct 步骤并包含经验分支信息；启用默认路径前 MUST 验证原生契约及框架闭环矩阵。

#### Scenario: 关闭后恢复基线

- **WHEN** 透明接入发生问题后关闭配置并运行原有 YAML
- **THEN** 无需修改资产或用例即可回到原生执行，原生参考生成和报告仍正常

#### Scenario: 回归矩阵

- **WHEN** 执行相同输入的原生/透明对照及实验 Node 框架夹具
- **THEN** 记录参数、返回值、错误、取消和报告结构的兼容结果，框架闭环矩阵通过且不影响 aiAssert，不要求业务用例或设备业务报告
