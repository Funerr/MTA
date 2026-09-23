# YAML aiAct 透明接入（transparent-ai-act-experience v1）

为当前仓库 Midscene Test 项目 YAML 的官方 `aiAct` 增加可关闭的经验接入：合格纯动作走已验证 Runtime，其余调用原样透传原生执行。用户无需改 Node 名或增加经验字段。本文件对应 Change `integrate-experience-with-ai-act`。Runtime 见 [experience-runtime.md](experience-runtime.md)。

锁定：`@midscene/core` / `@midscene/android` / `@midscene/harmony` / `@midscene/test` **1.12.7**。默认关闭。

## 1. 启用范围

- **范围内**：本仓库 `midscene.config.ts` 中 android / harmony 项目本地注册的 YAML `aiAct` Node。
- **范围外**：脚本直接调用 `agent.aiAct`、其他仓库/项目、`aiAssert` 及其他 Nodes、实验入口 `experienceAct`（仍保留）。
- **开关**：项目配置 `experience.enabled`，由环境变量 `EXPERIENCE_ENABLED` 读取（`true` / `1` / `yes` / `on`）。缺省、空值或无法识别的值均为关闭。
- **关闭时**：包装返回官方原始定义对象，不实例化 Runtime / Store，不读写经验。关闭开关即可回滚，不必改用例或删除资产。
- **与知识注入叠加**：可选运行时知识注入（`KNOWLEDGE_INDEX_ENABLED`，说明见 [../knowledge/README.md](../knowledge/README.md)）可与本接入同时开启。组装上知识注入位于内层：经验匹配/学习键基于原始 instruction，不随知识索引编辑漂移；重放路径不注入，MISS 回退原生时仍获得注入。

```bash
EXPERIENCE_ENABLED=true pnpm run test:cases --project android
```

未登记任何可重放目标时，开启开关仍全部走原生（默认 `EMPTY_ACTION_POLICY`）。要让合格请求重放，需在项目 context 注入 `experienceActionPolicy` 与 `experienceEnvironment`。

## 2. 接入方式

从锁定版本 `createMidsceneNodes` 取得官方定义，保留 `name` / `description` / `stringInputKey` / `inputSchema` / 官方 `toResult` 约定，只替换 `execute`。原始 `execute` 作为 native 回调；Runtime 回退直接调用该回调，不经注册表再次派发 `aiAct`，避免递归。

报告顶层步骤仍是 `aiAct`。经验分支经 `Agent.recordToReport('experience-runtime')` 附加，不新增第二个顶层 Step。重放成功返回官方纯动作结果（`undefined`）；原生成功返回官方结果（字符串则 `{ summary }`）。

## 3. 资格与旁路

仅同时满足以下条件才进入 Runtime（否则原样透传，不裁剪输入再查询）：

| 条件 | 支持集（v1） |
| --- | --- |
| prompt | 非空纯文本字符串；对象 / 参考图片一律旁路 |
| options | 已登记键为空集；任何 `cacheable` / `deepThink` / `context` 等官方 options 旁路 |
| context | 已登记键为空集 |
| 目标 | 使用方资格表精确命中的可重复纯动作 |
| 结果 | 仅原生返回 `undefined` 的纯动作可学习；动态文本透出且不学习 |

必须旁路的样本：

- 图片或多模态 `prompt`
- 未知 / 未声明 `options`（含 `options.context`）
- 未登记目标、含判断的请求
- 官方 schema 拒绝的非法字段（接入层不会改成可执行输入）
- `aiAssert` 与其他 Nodes（根本不包装）

## 4. 一次执行链

- HIT：一次视觉重放，本步骤不调用 AI；Promotion 只在 Runtime。
- MISS / 允许回退的重放失败：原生 AI 恰好一次，不递归包装。
- 原生失败、取消、超时：保持官方错误与清理，接入层不吞掉。
- 同一用例路径 / 名称 / 步骤位置把 `experienceAct` 换成 `aiAct` 时，逻辑节点归一化为 `aiAct`，可复用合格资产；复制到新用例路径则重新学习。

## 5. 升级与回滚

- 升级锁定 Midscene 版本前，先跑 `pnpm test` 中的 aiAct 契约 / 旁路 / 开关对照矩阵。
- 回滚：去掉 `EXPERIENCE_ENABLED` 或设为非真值，原 YAML 立即走原生路径。
