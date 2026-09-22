# runtime-knowledge-index Specification

## Purpose

为项目用例步骤提示词提供可关闭的运行时背景知识注入：常驻一个轻量索引，按触发词程序化匹配，命中时才懒加载条目正文追加进 aiAct instruction，让设备/产品差异操作知识（如各厂商控制中心手势）无需全量进入 prompt 即可生效。

## ADDED Requirements

### Requirement: 项目级知识索引数据契约

项目 SHALL 以 `knowledge/` 目录提供知识数据：索引文件声明条目 id、触发词与正文文件相对路径，正文为独立文件。启用注入时，索引不可解析、引用的正文文件缺失或路径越出 `knowledge/` 目录 MUST 使步骤显式失败并报告具体条目与原因，不得静默跳过或降级为无知识执行；`knowledge/` 目录整体不存在时视为未配置知识，按无命中透传。

#### Scenario: 合法索引与条目

- **WHEN** 索引声明条目（触发词、正文路径）且正文文件存在
- **THEN** 条目可被加载，其触发词可用于匹配

#### Scenario: 索引或正文非法

- **WHEN** 开启注入且索引不可解析、条目正文缺失或正文路径越出 knowledge 目录
- **THEN** 相关用例步骤显式失败，错误信息包含条目标识与原因

#### Scenario: 目录不存在

- **WHEN** 项目无 knowledge 目录而注入开关开启
- **THEN** 不报错，全部步骤按无命中透传执行

### Requirement: 触发词匹配与懒加载注入

启用时，aiAct 的 instruction SHALL 与索引触发词做程序化匹配（不调用模型）；命中条目正文仅在首次命中时读取并按进程缓存，以固定标记追加到 instruction 末尾后交给官方节点。同一 instruction 命中多条时 MUST 按索引声明顺序全部注入且同一正文不重复；未命中的 instruction MUST 原样透传且不读取任何正文文件。

#### Scenario: 命中注入

- **WHEN** instruction 文本包含某条目触发词
- **THEN** 官方节点收到原 instruction 加固定注入标记与该条目正文

#### Scenario: 多条命中

- **WHEN** 同一 instruction 命中多个条目
- **THEN** 按索引顺序注入全部命中正文，各正文仅出现一次

#### Scenario: 未命中透传

- **WHEN** instruction 不含任何触发词
- **THEN** 官方节点收到原文，过程中未读取任何条目正文文件

#### Scenario: 重复命中走缓存

- **WHEN** 同一条目在同一进程内再次命中
- **THEN** 使用缓存正文，不再读盘

### Requirement: 默认关闭与原生契约保真

知识注入 SHALL 提供项目级开关，默认关闭；关闭时 MUST 返回官方原始节点定义，不读取 knowledge 目录、不实例化加载逻辑。开启时 MUST 保留官方输入校验、options、context、取消、返回值与错误语义：违反官方 schema 的输入保持官方校验失败，官方失败与取消不被注入层吞掉或改变。

#### Scenario: 关闭即基线

- **WHEN** 开关关闭时运行既有 YAML
- **THEN** 执行行为与无本能力一致，knowledge 目录不被读取

#### Scenario: 非法输入

- **WHEN** YAML 输入违反官方 aiAct 输入 schema
- **THEN** 保持官方校验失败，不因注入转为可执行输入

#### Scenario: 失败与取消

- **WHEN** 注入后官方执行失败或收到取消信号
- **THEN** 失败/取消如实传播并保留官方清理行为

### Requirement: 注入可追溯

注入 SHALL 可在执行报告中识别：交付给官方节点的增强 instruction（含注入标记与正文）在报告与步骤详情中可见，并能区分命中了哪些条目；用例 YAML 文件内容 MUST NOT 因注入被修改。

#### Scenario: 报告可见

- **WHEN** 某步骤发生知识注入
- **THEN** 报告中该步骤的 prompt 呈现原 instruction、注入标记与注入正文，命中条目可识别

#### Scenario: 用例文件不变

- **WHEN** 注入发生
- **THEN** 用例 YAML 文件与步骤定义保持原样

### Requirement: 与既有能力的边界和叠加

知识注入 SHALL 作为独立包装层与 Experience 透明接入可叠加：任一开关组合下另一能力的需求行为保持不变。multi-device 项目经 alias 转发调用 aiAct 时 MUST 获得与单设备项目同等的注入行为。注入机制 MUST NOT 访问 Midscene 内部契约（dump 结构、报告结构、executionId 关联），MUST NOT 新增业务 Node 或把业务知识写入包装层代码。

#### Scenario: 与经验叠加

- **WHEN** 知识注入与 Experience 透明接入同时开启
- **THEN** 两个能力各自的需求行为不变，aiAct 均可正常走经验/原生路径

#### Scenario: alias 转发同等生效

- **WHEN** multi-device 用例经 DUT alias 调用 aiAct 且 instruction 命中触发词
- **THEN** 注入行为与单设备项目一致
