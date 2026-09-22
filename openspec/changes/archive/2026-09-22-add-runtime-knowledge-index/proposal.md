# Proposal: add-runtime-knowledge-index

## Why

用例步骤提示词中的设备/产品差异操作（如"打开控制中心"：华为需从屏幕顶部右侧下拉、当前项目在中间下拉、部分产品不可用）目前没有任何落点，执行期 aiAct 只能依赖模型通用知识猜操作方式，导致跨设备用例不稳定；同时这类背景知识不应全量塞进每条 prompt（token 浪费）。需要一个类似 skill 的索引机制：常驻的只有小索引，正文按需懒加载注入。

## What Changes

- 新增项目级知识目录约定 `knowledge/`：`index`（条目 id、触发词、正文文件路径）+ `entries/*.md` 正文，纯数据文件，人工维护。
- 新增默认关闭的 aiAct 知识注入包装层：对 instruction 做程序化触发词匹配，命中时才读取条目正文（进程内缓存）并以固定标记追加进 instruction，再调用官方节点；未命中原样透传，零开销。
- 包装形态复用现有 `wrapMidsceneNodesWithExperience` 的接入模式（替换 aiAct 执行入口、关闭时返回原始定义），与 Experience 集成相互独立、可叠加。
- 本能力是 Experience 冻结范围之外的独立新 Runtime 能力（不做动作回放、不碰 Experience Schema/Store/Promotion），由用户于 2026-09-22 探索会话明确授权立项；业务内容全部留在 `knowledge/` 数据文件，包装层只做通用匹配与注入，不引入业务知识。
- 不访问 Midscene 内部契约（instruction 是官方节点公开声明输入）；不新增业务 Node；不改用例 YAML 语法。

## Capabilities

### New Capabilities

- `runtime-knowledge-index`: 运行时知识索引与懒加载注入——项目级 knowledge 索引的数据契约、aiAct instruction 的程序化匹配与注入行为、默认关闭的开关语义与透传保真。

### Modified Capabilities

（无——`transparent-ai-act-experience` 等既有能力的需求不变；knowledge 包装为独立包装层，不修改经验接入行为。）

## Impact

- **配置组装**：`midscene.config.ts`（android / harmony 项目的 aiAct 包装挂载点；multi-device 经 alias 转发复用底层项目节点）。
- **新增源码**：知识索引加载、触发词匹配、instruction 注入与包装（建议 `src/knowledge/`，具体见 design）。
- **新增项目数据目录**：`knowledge/`（index + entries），随本 change 提供示例条目（演示身份，不宣称业务验收）。
- **文档**：`ARCHITECTURE.md` 契约入口与 Runtime 范围说明、`README.md` 能力入口、`AGENTS.md` 治理约束中的范围决策记录（如需）。
- **测试**：单元测试（索引解析、匹配、注入格式、关闭透传、缓存）+ 框架夹具级验证；不要求真实设备业务报告。
- **依赖**：不新增运行时依赖；锁定 Midscene 依赖的官方节点输入契约不变。
