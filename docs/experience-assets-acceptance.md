# 验收与核对记录 — add-experience-model（experience-assets）

本文件记录 `add-experience-model` 实施过程中的核对与验证证据，按任务组补充。语言为 zh-CN。

## 1. 前置核对（任务 1.1）

核对日期：2026-09-15。核对环境：macOS（darwin 25.6.0, arm64）、Node v24.20.0。

### 前置证据

前置 Change [bootstrap-midscene-mobile-test](../openspec/changes/bootstrap-midscene-mobile-test/proposal.md) 已完成实施与验收：

- 任务清单 12/12 全部勾选（`openspec list --json` 状态 `complete`），见 [tasks.md](../openspec/changes/bootstrap-midscene-mobile-test/tasks.md)。
- 框架验收记录：[acceptance.md](acceptance.md)（无设备/无密钥条件下安装、类型检查、Node 参考生成、44 项框架测试全部通过）。
- 依赖版本核对：[dependency-versions.md](dependency-versions.md)。
- 工程提交：`be5c68f Bootstrap Midscene Android test framework (bootstrap-midscene-mobile-test)`。

### 采用的版本与目录

| 项 | 值 |
| --- | --- |
| `@midscene/test` / `@midscene/android` | `1.12.7`（锁定） |
| Node engines | `^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0`（本机核对使用 v24.20.0） |
| `zod` | `^3.25.76`，schema 一律从 `zod/v4` 子路径导入（与 bootstrap 约定一致） |
| 工程根目录 | `/Users/funer/code/MTA` |
| 经验资产根目录 | 工程根下 `experiences/`（索引 `index.json` 与内容寻址图片 `assets/`；与 `midscene_run/` 运行产物严格分离） |

### 归档状态说明

bootstrap 尚未执行 OpenSpec archive 流程：`openspec/specs/` 主规格目录与 `openspec/changes/archive/` 当前为空，其两份规格以 Change 内 delta 形式存在于
[specs/midscene-android-project/spec.md](../openspec/changes/bootstrap-midscene-mobile-test/specs/midscene-android-project/spec.md) 与
[specs/device-lifecycle-nodes/spec.md](../openspec/changes/bootstrap-midscene-mobile-test/specs/device-lifecycle-nodes/spec.md)。
本次核对以上述 delta 规格为准；archive 只是收敛位置操作，不改变契约内容，不阻塞本 Change 实施。

### 契约差异清单

**为空。** bootstrap 规格仅定义工程安装、确定性设备选择、会话生命周期、`device.prepare`/`device.recover` 与原生报告边界，并明确“运行产物与框架实现、经验资产分离”（`experiences/` 在 bootstrap 中即为预留空目录）。两份规格均未定义任何 Experience 资产、Key、Store 或状态契约，本 Change 的 schema/Store 假设与其无冲突。

## 2. 工程验证（任务 3.1）

验证日期：2026-09-15，与前置核对同一环境（无设备、无模型密钥）。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck`（tsc --noEmit, strict） | ✅ 通过，无错误 |
| 框架测试 | `pnpm test`（vitest） | ✅ 10 个文件 107 项全部通过（新增 experience 相关 62 项：schema 15、请求 Key/环境 13、资产读写与原子发布 12、状态与统计 8、错误分类 9、示例往返 5） |
| 锁定依赖安装 | `pnpm install --frozen-lockfile` | ✅ 通过 |
| 设备/模型依赖 | — | ✅ `src/experience/` 生产代码仅导入 `node:crypto`、`node:fs/promises`、`node:path` 与 `zod/v4`，无 Midscene、设备、网络或环境变量访问；全部测试在无设备/无密钥环境通过 |

新增测试文件：`tests/unit/experience-schema.test.ts`、`tests/unit/experience-key.test.ts`、`tests/unit/experience-store.test.ts`、`tests/unit/experience-store-lifecycle.test.ts`、`tests/unit/experience-store-errors.test.ts`、`tests/integration/example-asset-roundtrip.test.ts`（公共夹具 `tests/helpers/experience-fixtures.ts`）。

## 3. 交付物（任务 3.2）

| 交付物 | 位置 |
| --- | --- |
| 字段文档与读取说明 | [experience-assets.md](experience-assets.md)（§1–§9：字段参考、Key/环境、错误语义、读写示例） |
| 完整示例资产 | [tests/fixtures/experience-example/](../tests/fixtures/experience-example/)（`index.json` + 19 张真实 PNG，由 Store 发布接口产出） |
| 示例往返与文档一致性测试 | `tests/integration/example-asset-roundtrip.test.ts`（5 项：Key 重算一致、唯一候选且字段与文档一致、索引完整校验、全部取证图为合法 PNG 且摘要一致、环境隔离对示例成立） |
| Promotion 契约核对 | [experience-assets.md §11](experience-assets.md)：六类动作映射、前后截图/target/context 取证、bbox 像素空间、eventId=callId 幂等、资格策略版本、入口绑定逐项一致；两项注意事项（Scroll 距离必填、context 扩边比例归属）已按风险条款登记 |

示例资产的关键取值（requestKey/variantId/来源/动作链）记录于字段文档 §10，与往返测试断言一一对应；完成依据“示例可往返、文档字段一致”成立。

运维说明：`experiences/` 下运行动态数据不入库（根 `.gitignore` 已更新，保留 README）；受控示例固定在 `tests/fixtures/`。
