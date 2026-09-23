# project-scoped-case-execution Design

## Context

动机见 [proposal.md](proposal.md) 的 Why。约束现状：

- 官方 CLI `midscene-test` 仅支持项目根目录、`--config`、`--result-dir`、`--project`；文件选择全部在 `cases.config.ts` 选择层（其文件头注释明确「测试集只选择工作流；执行仍由官方 Midscene Runner 负责」）。
- `scripts/run-case.mjs` 已是单文件/文件集入口（`pnpm case <路径...>`，后缀推断 + `MTA_CASE_FILES` 内部契约），零依赖裸 Node，校验前置于启动之前。
- 演示根 `examples/` 经 `midscene.examples.config.ts` 显式执行，`examples/harmony-experience/` 另有经验演示配置；本期不动其结构。
- 目标使用者是第一次接触自动化与命令行的测试人员；`cases/` 现为空（仅 README），结构切换零迁移。
- 治理约束（AGENTS.md）：禁止自研 Runner；Midscene YAML 保持 Expert Mode / Execution Workflow 身份，不把业务语义写入 Node / Runtime；不新增 Midscene 内部契约访问。

需求契约见本变更 `specs/` 下五个能力 delta；本文只定实现路径。

## Goals / Non-Goals

**Goals:**

- 命令面收敛为 `pnpm case` 一条命令（菜单 / 命名空间目标 / 批量别名同一语义内核）。
- 执行归属只看项目结构与项目级声明；文件名后缀与 level 维度彻底退出用户面。
- 全部失败模式前置、显式、说人话；零静默降级。
- 新增代码全部落在选择层与入口层（`cases.config.ts` / `scripts/`），执行语义透传官方 CLI。

**Non-Goals:**

- 不做 GUI / 双击启动器、不做 Node/pnpm 安装器（后续独立工作）。
- 不迁移 `examples/` 目录结构与演示配置语义。
- 不引入 level / tag 替代分级；不做菜单 i18n 机制（仅内置四大模块中文标签表）。
- 不改 Midscene YAML 主体语法与 Node 契约（仅增加执行前置校验用的头部元数据）。
- 不改官方 Runner、报告渲染、并发（`maxConcurrency: 1`）与设备独占语义。

## Decisions

### D1：项目声明文件——`cases/<项目>/project.yaml`

字段：`platform`（android | harmony | multi-device）与 `devices`（项目所需设备别名列表，如 `[DUT1, DUT2]`；实际绑定仍由既有 `MULTI_DEVICE_BINDINGS` 契约提供，本字段只声明需求）。以 zod（既有依赖）校验，缺失/非法在启动前报错。

- 备选：顶层注册总表。放弃原因：项目不能自包含迁移，新增机型要改公共文件，冲突面大。
- 备选：文件夹名后缀（`EV760.android/`）。放弃原因：重蹈「后缀隐性规则」的覆辙，与英文命名约束叠加后可读性更差。

### D2：选择层推导——声明驱动发现

`cases.config.ts` 重构为：扫描 `cases/*/project.yaml` 得到「项目 → 执行项目」映射，官方 CLI 的 projects 仅包含被声明的平台；选择目标（项目/大模块/特性/用例）解析为文件清单后按执行项目收窄。命名规范校验（英文 kebab-case、拒绝非 ASCII）在选择层统一执行。`run-case` 与配置之间沿用内部环境变量传递清单的机制，但收起为实现细节，不进文档与 Skill。

- 备选：入口动态生成派生配置 + `--config`。放弃原因：临时文件生命周期与两配置根的组合复杂度（同 simplify-case-execution design 的既有结论）。

### D3：统一入口形态——扩展 `scripts/run-case.mjs`

零新依赖（`node:readline` 实现菜单）。命令面：

```bash
pnpm case                              # 自检 + 编号菜单（TTY）/ 清单（非 TTY）
pnpm case EV760/system/display/adjust-brightness   # 命名空间目标，可多个
pnpm case --new-project EV760          # 生成 project.yaml 模板 + 四大模块骨架
pnpm case <目标> --verbose|--no-open    # 详细日志 / 关闭报告自动打开
```

菜单按「项目 → 大模块 → 特性 → 用例」编号下钻（`1.3` 形式进入下一级），四大模块内置中文标签（protocols=通信协议、system=整机、core=三大项、stability=稳定性），其余分组显示目录原名。

### D4：用例级设备需求——YAML 注释头部元数据

协作用例文件头部以注释元数据 `# devices: DUT1, DUT2` 声明所需别名；入口在执行前解析并与项目声明、`MULTI_DEVICE_BINDINGS` 绑定比对，未满足即失败。该元数据只做执行前置校验，不参与断言与业务语义，不新增 Node。（实施核对结论：官方 Workflow 解析器对顶层 key 白名单校验，仅接受 `beforeAll` / `beforeEach` / `cases` / `afterEach` / `afterAll`，顶层 `devices:` 字段会被拒绝，故采用注释形式。）

- 备选：顶层 YAML 字段 `devices:`。放弃原因：官方解析器 `rejectUnknownKeys` 白名单会拒绝未知顶层 key，扩展执行 YAML 字段也违背既有工作台契约。
- 备选：从 Node 调用自动推导设备别名。放弃原因：需要完整解析 YAML、无法表达「预留但未调用」的需求，错误在执行中才暴露。
- 备选：sidecar 文件声明。放弃原因：与用例文件易失配，文件碎片增加管理成本。

### D5：批量别名收编——显式报错，不做静默翻译

`test:cases:*` 转发到统一入口（`test:cases` → 全部项目目标）；`MTA_SUITE`、`--project`、`--config` 出现在用户命令面时显式报错并给出迁移写法（README 附对照表）。理由：旧维度与新结构不是一一映射（level 语义已退役），静默翻译会产生语义漂移。

### D6：报告呈现——摘要 + 自动打开

结束摘要来自结果明细（逐条通过情况、失败步骤、预期 vs 实际）；默认以系统默认浏览器打开本次报告（`open` / `xdg-open` / Windows `start`），`--no-open` 或非 TTY 关闭，打开失败降级为打印路径，不影响退出码。

### D7：`examples/` 根兼容

演示根保留既有推断（文件后缀或 `examples/<项目>/` 目录）与演示配置执行语义；命名规范校验不作用于 `examples/`（存量演示文件名不变）。业务根与演示根混用时按根分组顺序执行，与现状一致。

## Risks / Trade-offs

- [旧 CI / 脚本使用 `MTA_SUITE` / `--project` 组合] → 显式报错 + README 迁移对照表；收编前核对仓库内引用。
- [readline 菜单的跨终端兼容（含 Windows）] → 只用 Node 内置 readline；非 TTY 降级路径保证 CI 不受菜单实现影响。
- [自动打开报告在无头 / 远程环境不可用] → 打开失败降级为打印路径；`--no-open` 显式关闭。
- [「项目」与官方「执行项目」概念混淆] → 文档与错误信息统一用「项目（机型）」「执行平台」两套词，业务语言优先。
- [设备需求头部元数据被误当业务字段] → 明确其执行前置校验身份，不进断言语义；文档单列说明。
- [与 `simplify-case-execution` 的 `case-execution-entry` 基线衔接] → 归档顺序见 Migration；`openspec validate --strict` 兜底。

## Migration Plan

1. 前置：先归档 `simplify-case-execution`（或将 `case-execution-entry` delta 并入本变更后归档），保证 MODIFIED 基线存在。
2. 实施顺序：结构与选择层（声明 schema、发现推导、命名校验）→ 统一入口（目标解析、菜单、自检、摘要）→ 批量别名收编 → 文档与 Skill → 验证。
3. 回滚：还原 `cases.config.ts` 与入口脚本、恢复旧别名直连官方 CLI；无数据迁移（`cases/` 为空）。
4. 验证：`pnpm typecheck`、`pnpm test`、无设备失败模式全集核对、Android 真机冒烟（单条 / 大模块 / 菜单三路径），证据按仓库惯例追加验收文档，不改写历史记录。

## Open Questions

- 四大模块英文名定稿：默认 `protocols` / `system` / `core` / `stability`，其中「三大项」对应 `core` 的最终拼写可随时调整，仅影响骨架模板默认值，不改变机制。
- HarmonyOS 真机验收窗口：与工作台 7.3 同类环境依赖，不阻塞 Android 交付与其余实施任务。
