# Design: add-runtime-knowledge-index

## Context

现状与约束（动机见 proposal.md）：

- 官方节点由 `createMidsceneNodes` 生成，MTA 已有只替换 `aiAct` 执行入口、默认关闭、关闭时零实例化的包装模式：`wrapMidsceneNodesWithExperience`（[wrap.ts](../../../src/experience/integration/wrap.ts)）。开关走环境变量严格解析（[config.ts](../../../src/experience/integration/config.ts)：缺省/空/无法识别均为关闭）。
- 锁定的 `@midscene/*` 依赖没有官方"给 Agent 附加上下文"钩子（内部 system prompt 均为私有组装）；`aiAct` 的 `instruction` 是节点公开声明输入，改写它不构成内部契约访问。
- **multi-device 项目不复用 android/harmony 项目节点**：`src/nodes/multi-device.ts:140` 内部另行调用 `createMidsceneNodes` 生成原生节点，再经 `aliasNativeNodes` 换名（`renameNodeDefinition` 保留原 `execute` 委托）。
- 工程已有直接依赖 `yaml`（package.json）；`experiences/` 目录是运行时数据资产的既有先例。

## Goals / Non-Goals

**Goals:**

- 通用、可关闭、零模型调用的运行时知识注入：索引常驻、正文懒加载。
- 覆盖全部三个执行项目（android / harmony / multi-device alias 转发）。
- 不访问 Midscene 内部契约、不新增业务 Node；业务内容全部在 `knowledge/` 数据文件。

**Non-Goals:**

- 适用范围/设备维度筛选（华为 vs 本项目等厂商差异）：本期索引结构不含筛选字段，注入对所有设备一致；后续如需按 alias/platform 选条目再独立扩展。
- `aiAssert` 注入、执行期"能不能做"类能力判定、与 Experience Promotion 联动、编写期（case-to-yaml / Workbench）消费同一索引——均为后续独立话题。

## Decisions

### D1：包装挂载点有两处，不只是一处

`midscene.config.ts` 只覆盖 android/harmony 项目；multi-device 内部自建原生节点（见 Context）。因此：

- android / harmony：在 `midscene.config.ts` 对 `createMidsceneNodes(...)` 结果再包一层。
- multi-device：在 `src/nodes/multi-device.ts` 内部对 `createMidsceneNodes` 结果包装后再 `aliasNativeNodes` 换名——换名保留 `execute` 委托，先包后换名即可让 `DUT1.aiAct` 等别名节点获得注入。

备选：把 multi-device 改为复用 android/harmony 已包装节点——改动面大且触碰协作项目装配契约，不做。

### D2：与 Experience 叠加时，knowledge 在内层、experience 在外层

组装形态：`wrapMidsceneNodesWithExperience(wrapNodesWithKnowledge(createMidsceneNodes(...)))`。experience 包装接收的"官方节点"即 knowledge 包装后的节点，于是：

- 经验匹配/学习键基于原始 instruction（experience 外层先看到原输入），**不随索引编辑漂移**——改触发词或正文不会让既有经验资产集体失配。
- 重放路径（已定位动作）天然不经过知识注入，行为不变。
- 原生 AI 回退与策略 bypass 路径都经 knowledge `execute`，**凡走原生规划必得注入**。

备选：knowledge 在最外层（experience 看到增强后 instruction）——经验键会随索引内容变化，且重放命中判定被无关文本干扰，弃。

### D3：配置镜像 experience 集成模式

环境变量 `KNOWLEDGE_INDEX_ENABLED`（框架级约定，官方依赖不读取）：解析语义与 experience 完全一致（缺省/空/无法识别 → 关闭；关闭时返回原始节点定义、不读 `knowledge/`、不实例化加载器）。知识根目录默认项目根下 `knowledge/`，可用 `KNOWLEDGE_INDEX_ROOT` 覆盖（解析方式对齐 Experience store root 的既有做法）。

### D4：索引为 `knowledge/index.yaml`，正文为独立 Markdown

```yaml
# knowledge/index.yaml
entries:
  - id: control-center-gesture        # 稳定标识，进入注入标记
    triggers: [控制中心, 下拉控制中心]   # 子串匹配，人工维护
    file: entries/control-center.md   # 相对 knowledge 根，禁止越界
```

选 YAML：条目给人维护、工程已有 `yaml` 依赖。加载器职责：解析校验（id 唯一、triggers 非空、file 存在）、路径包含校验（resolve 后必须仍在 knowledge 根内）、正文按条目懒读取 + 进程内缓存、索引本身首次包装执行时加载一次并缓存。加载/校验失败按 spec 显式失败并报条目 id 与原因；`knowledge/` 目录不存在视为未配置，透传。

### D5：匹配是纯子串、注入是固定标记后缀

- 匹配：`instruction.includes(trigger)`（不做分词、不调模型、不区分大小写仅对 ASCII 归一化）。误命中由触发词质量约束，注入标记使误命中在报告中可定位。
- 注入：命中条目按索引声明顺序追加到 instruction 末尾，每条一段：

```
<原 instruction>

[knowledge:control-center-gesture]
<正文内容>
```

- 可追溯性免费获得：增强后的 instruction 就是官方节点收到的输入，报告 prompt 天然呈现原文本、标记与正文；**不触碰报告/dump/executionId 内部结构**。
- 用例 YAML 文件不被修改。

### D6：源码布局 `src/knowledge/`，镜像 experience/integration 结构

`config.ts`（开关与根目录解析）、`types.ts`（条目/配置类型）、`loader.ts`（索引与正文加载、缓存、路径校验）、`wrap.ts`（`wrapNodesWithKnowledge`，仅替换 `aiAct` 执行入口，形态对齐 experience 包装）。不带业务内容，不进 `src/nodes/`（它不是 Node 定义，是节点包装层）。

## Risks / Trade-offs

- [触发词子串误命中（如过短触发词命中大量步骤）] → 索引文档给出触发词长度/特异性指导；注入标记使每次注入在报告中可追溯；机制默认关闭，逐项目启用。
- [命中步骤 prompt 变长，token 换准确性] → 有意取舍；正文建议保持短小（条目是"知识片段"不是文档）；仅命中步骤付费，未命中零成本。
- [索引错误在首次命中时才暴露（懒加载）] → spec 要求显式失败带条目 id；单测覆盖加载器全错误分支；可选的静态校验入口列为 open question。
- [与 Experience 叠加行为漂移] → D2 固定层次；测试覆盖"双开"组合下两能力各自既有行为不变。

## Migration Plan

默认关闭合入，无任何行为变化。项目启用 = 设 `KNOWLEDGE_INDEX_ENABLED` + 维护 `knowledge/`；回滚 = 关开关，YAML 与经验资产无需改动即回基线。

## Open Questions

- 是否补一个索引静态校验命令（如 `pnpm run knowledge:check`，离线校验索引与正文引用完整性）——不改变规格与结构，可在实现后按维护痛点决定。
- 条目正文长度/格式规范（文档层面）随首个真实条目沉淀后再写。
