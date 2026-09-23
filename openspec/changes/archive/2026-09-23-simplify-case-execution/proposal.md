# simplify-case-execution

## Why

单点执行一个 YAML 目前没有直接入口。官方 `midscene-test` CLI 只接受项目根目录、`--config`、`--result-dir`、`--project` 四类参数，文件选择只能靠 `MTA_SUITE` 缩小到 level 目录；想只跑一个文件，使用方只能临时改 `cases.config.ts` 的 include、挪动文件，或像 `midscene.examples.config.ts` 那样手写派生配置再拼一条长命令（如 `pnpm run test:cases --config midscene.examples.config.ts --project android`）。

同时默认入口总是同时选中 android、harmony、multi-device 三个执行项目：无匹配文件的项目直接产生「未找到 YAML 用例」收集错误（README 已把它作为注意事项记录），有文件的项目也要按 `maxConcurrency: 1` 串行完成各自设备会话 setup——「只想跑一个文件」却付出三个项目的启动与排队成本。执行入口散落在 6 个 npm script × `--project` × `MTA_SUITE` × `--config` 四个维度上，执行框架面貌不清晰，执行效率与入口可发现性都受损。

## What Changes

- 新增单文件/文件集执行入口：`pnpm case <yaml 路径...>`（包装脚本 `scripts/run-case.mjs`，细节由 design 决定）。
  - 按文件后缀自动推断执行项目：`.android.yaml` → android、`.harmony.yaml` → harmony、`.multi-device.yaml` → multi-device，只启动被推断出的项目，不再为无关项目付出串行 setup 成本，也不再产生「某项目无 YAML」收集错误。
  - 支持一次给出多个文件；显式 `--project` 与后缀推断冲突时 MUST 启动前报错退出。
  - 失败模式全部显式报错，不静默降级：文件不存在、后缀无法推断项目、路径不在允许根目录（`cases/` 与 `examples/`，后者沿用既有演示配置语义）之外。
  - 其余 CLI 参数（如 `--result-dir`）原样透传。
- 执行仍完全委托官方 Midscene Runner：包装层只负责「选择哪些文件 + 选哪个项目」，不改运行语义；退出码、报告输出（`midscene_run/report/`）、重试与并发行为保持不变，不自研 Runner。
- 新增用例执行 Skill（`.agents/skills/run-case/`）：在 IDE / Agent 宿主中经 Skill 直接触发单点执行，使用方无需阅读工程代码即可运行用例。Skill 只提供调用约定（触发时机、`pnpm case` 命令映射、后缀推断规则、显式失败模式与报告位置、设备与环境前置提示），MUST NOT 引入独立执行路径或旁路设备会话。
- 现有批量入口与语义不变：`test:cases:*`、`MTA_SUITE`、`--project`、`--config` 照旧保留。README「运行业务用例」把单文件入口列为首选快捷路径，批量入口保持为完整回归入口；Skill 中的批量请求同样指引这些既有入口。
- 收益：单文件场景从「三个项目串行 setup + 无关项目报错」收敛为「一个项目直接跑」，给出一个可记忆的单一执行命令；在 IDE / Agent 宿主中经 Skill 零上下文触发同一入口。

## Capabilities

### New Capabilities

- `case-execution-entry`: 按 YAML 文件路径的单点执行入口——后缀推断执行项目、仅启动相关项目、文件根目录约束（`cases/` / `examples/`）、显式失败报错（文件不存在 / 后缀未知 / 与 `--project` 冲突 / 根目录不允许），执行委托官方 CLI 且运行语义不变；并以 Skill 形式交付给 IDE / Agent 宿主（同一执行入口的宿主侧封装，不另建执行路径）。

### Modified Capabilities

（无——`midscene-android-project` / `midscene-harmony-project` / `multi-device-yaml-workflows` 的批量发现范围（如 `cases/level{1,2,3}/**/*.android.{yaml,yml}`）保持不变；单文件入口是在既有发现范围内的进一步收窄选择，不改变任何现有 requirement。）

## Impact

- 新增 `scripts/run-case.mjs` 与 `package.json` script（`case`）：纯 DX 选择层，不触碰 `src/setup` / `src/nodes` / `src/experience` 的运行时职责，不新增 Midscene 内部契约访问（仅使用官方 CLI 公开参数与公开配置导出/派生方式，机制由 design 确定）。
- 新增 `.agents/skills/run-case/SKILL.md`：纯调用约定文档，跟随既有 `.agents/skills/case-to-yaml/` 惯例；不包含执行逻辑。
- `cases.config.ts`（或其等价选择层）可能增加「显式文件清单」入参；`MTA_SUITE` 语义不变。
- 文档：README「运行业务用例」与能力入口清单（登记 `pnpm case` 与执行 Skill）、`cases/README.md`、`examples/README.md` 的执行入口说明同步更新。
- 无依赖变更、无破坏性变更：现有全部执行入口与结果产物保持兼容。
