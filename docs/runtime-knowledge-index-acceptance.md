# 验收与核对记录 — add-runtime-knowledge-index

> 阶段证据：本文的能力状态、测试数量和环境仅对应下述验收时点，不代表当前工作区；当前能力见 [README](../README.md)，记录导航见 [验收索引](acceptance-index.md)。

核对日期：2026-09-22。环境：macOS（darwin 25.6.0, arm64；macOS 26.6.2）、Node v24.20.0。无真实设备、无模型密钥、无网络；全部为框架夹具/stub 级验证，不包含业务用例或设备业务报告。

## 1. 能力范围（对应 spec：runtime-knowledge-index）

运行时知识注入：`aiAct` instruction 命中项目 `knowledge/index.yaml` 触发词（子串匹配，ASCII 不区分大小写）时，条目正文按需懒加载并以 `[knowledge:<id>]` 标记追加进 instruction 后走官方节点；未命中零开销透传；`KNOWLEDGE_INDEX_ENABLED` 默认关闭，关闭时不读 `knowledge/` 目录。业务知识只存在于 `knowledge/` 数据文件；包装层（`src/knowledge/`）不含业务内容、不访问 Midscene 内部契约（仅改写官方节点公开输入 `prompt`）。范围为用户 2026-09-22 授权的独立 Runtime 能力，不属于 Experience 冻结范围。

## 2. 行为核对（框架夹具/stub）

| 行为 | 证据 |
| --- | --- |
| 开关解析：缺省/空/无法识别关闭；true/1/on 开启 | `tests/unit/knowledge-loader.test.ts`（配置组） |
| 索引契约：目录缺失透传；索引/正文缺失、YAML 非法、id 重复、triggers 空、file 绝对路径/越界/不存在均显式失败并含条目 id | `tests/unit/knowledge-loader.test.ts`（加载组） |
| 懒加载与缓存：索引进程缓存、失败不缓存可恢复、正文仅命中时读取且进程缓存 | `tests/unit/knowledge-loader.test.ts` + `knowledge-wrap.test.ts` |
| 注入：单命中格式、多命中按索引顺序去重、options 原样、富媒体 prompt 透传、重复命中走缓存 | `tests/unit/knowledge-wrap.test.ts` |
| 原生保真：官方 `NodeInputValidationError` 保持（零 Agent 调用）、执行失败如实传播、关闭返回原节点定义 | `tests/unit/knowledge-wrap.test.ts` |
| 配置组装：android/harmony 均 experience(knowledge(official)) 层次；experience 旁路下注入仍生效 | `tests/unit/knowledge-mount.test.ts` |
| 协作项目：`phone1.aiAct` 与单设备同等注入；未配置时行为不变 | `tests/unit/knowledge-mount.test.ts` |
| 叠加：双关 HIT 经验匹配键基于原始 instruction 且重放不注入；MISS 回退原生必得注入且不递归；仅单一开关时各自行为不变 | `tests/unit/knowledge-experience-stack.test.ts` |

## 3. 工程验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 0 错误 |
| 全量单测（含既有回归） | `pnpm test` | ✅ 61 文件 / 538 项通过，其中本能力新增 4 文件 / 31 项 |
| 默认关闭零行为变化 | 全量回归无新增失败（默认关闭时包装原样返回官方节点定义，配置源断言见 mount 测试） | ✅ |

## 4. 未验证项

- 真实设备上注入对现场 Agent 规划质量的影响（需设备与模型密钥，属使用方启用后的业务验证）。
- 触发词误命中率与条目正文长度对 token 的实际影响（依赖真实知识条目沉淀）。
- 按设备/平台区分条目的适用范围筛选（本期索引结构未包含，属后续扩展）。
- 示例条目 `control-center-gesture` 为演示身份，未在任何真实设备验证。
