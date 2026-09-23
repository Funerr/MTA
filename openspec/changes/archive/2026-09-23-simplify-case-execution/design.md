# simplify-case-execution Design

## Context

见 [proposal.md](proposal.md) 的动机。当前执行链路的既有事实：

- 官方 CLI `midscene-test` 仅支持：项目根目录（位置参数）、`--config`、`--result-dir`、`--project`（可重复）；无文件级过滤。
- 文件选择集中在 `cases.config.ts` 的 `caseFiles(project, suite)`（`MTA_SUITE` → `cases/level{1,2,3}` 目录 glob），其文件头注释明确「测试集只选择工作流；执行仍由官方 Midscene Runner 负责」——选择层就是该模块的既定职责。
- 演示用例经 `midscene.examples.config.ts`（复用主配置的 projects/setup/nodes，仅覆写各项目 `files.include` 为 `examples/<project>/**`）以 `--config` 显式执行；经验演示另有 `midscene.experience.config.ts`。
- 默认入口同时选中三个执行项目，`maxConcurrency: 1` 串行；零匹配文件的项目产生收集错误。
- 仓库脚本惯例：`scripts/*.mjs` 裸 Node 运行（见 `build-workbench-web.mjs` 及进行中的 `simplify-project-init`）。

治理约束（AGENTS.md）：禁止自研 Runner；禁止把业务语义写入 Node / Runtime；不新增 Midscene 内部契约访问，只使用公开 CLI 参数与公开配置导出。

## Goals / Non-Goals

**Goals:**

- 一条可记忆的命令按文件路径执行用例，自动推断执行项目，只启动相关项目。
- IDE / Agent 宿主经 Skill 零上下文触发同一执行入口（同一命令面，无第二套执行方式）。
- 失败全部在使用前显式报错（路径 / 后缀 / 项目冲突 / 根目录），零静默行为。
- 对官方 CLI 的调用完全透传语义：退出码、报告、重试、并发不变。
- 文件选择逻辑保持在既有选择层（`cases.config.ts` 及演示配置），不新建并行机制。

**Non-Goals:**

- 不改官方 Runner 行为、不加并发（`maxConcurrency: 1` 是既定设备独占策略）。
- 不支持按用例名 / tag 过滤（文件级粒度已满足单点运行诉求；如需再评估）。
- 不接管 `midscene.experience.config.ts` 经验演示入口（维持其文档化显式命令）。
- 不做交互式选择器 / TUI。
- Skill 不生成或转换用例（那是既有 `case-to-yaml` Skill 的职责），两个 Skill 边界互指、互不替代。

## Decisions

### D1：机制——扩展选择层（环境变量文件清单），不生成临时配置

包装脚本解析参数后，以 `MTA_CASE_FILES`（JSON 数组字符串，POSIX 相对路径）传递显式文件清单；`cases.config.ts` 的 `caseFiles()` 与演示配置在清单存在时以其覆盖 `include`（`MTA_SUITE` 此时被忽略）；随后脚本调用官方 CLI：业务根走默认配置发现，`examples/` 根加 `--config midscene.examples.config.ts`。

- 选择理由：与 `cases.config.ts`「只选择工作流」的既有职责一致；零临时文件与清理负担；两个配置根共用同一份契约；演示配置已证明官方 CLI 可加载 TS 配置，但派生配置方案仍需每次生成/清理临时文件并在两处复刻派生逻辑。
- 备选：包装脚本动态生成派生配置文件 + `--config` 传入（即 `midscene.examples.config.ts` 模式的自动化）。放弃原因：临时产物生命周期管理、派生逻辑与两个配置根的组合复杂度更高，且把选择逻辑挪出既定选择层。
- 清单以 JSON 数组编码，避免路径分隔符歧义；`caseFiles()` 对非法 JSON 或空数组 MUST 报错（防御性兜底，主错误提示由包装脚本负责）。
- `MTA_CASE_FILES` 是本入口的选择契约，README 标注为入口内部契约，不建议使用方手工设置。

### D2：包装脚本形态——`scripts/run-case.mjs`，裸 Node、零依赖

- 参数：<yaml 路径...>（位置参数，至少一个）、`--project <name>`（可选，须与全部文件的后缀推断一致）、其余参数（如 `--result-dir`）原样透传给官方 CLI。
- 校验顺序（全部在启动任何执行前完成）：路径存在 → 归一化为仓库根 POSIX 相对路径 → 根目录约束（`cases/` / `examples/`，否则报错并指引既有入口）→ 后缀推断项目（`.android.yaml` / `.harmony.yaml` / `.multi-device.yaml`；缺失或未知后缀报错并列出支持清单）→ 与显式 `--project` 比对（冲突报错，列出冲突文件与两侧项目）。
- 执行分组：按（配置根 × 执行项目）分组，每组一次官方 CLI 调用（`--project <name>` + 对应根的配置），组间顺序执行；每组调用前打印实际命令行保证可复现。任一组失败不中断后续组，最终退出码取首个非零值（全成功为 0）。
- stdio 直接继承（进度、报告地址实时可见）；以 `node_modules/.bin/midscene-test` 为目标进程，退出码透传。
- 备选：tsx 运行的 TS 脚本获得类型检查。放弃原因：参数解析体量小，与 `scripts/*.mjs` 惯例一致更重要；类型约束由 `cases.config.ts` 侧承担。

### D3：项目推断与分组语义

- 后缀映射固定为三平台官方后缀；`.yaml` / `.yml` 无平台后缀时，`cases/` 根视为错误；`examples/` 根允许按项目目录（`examples/<执行项目>/`）确定性推断——存量演示文件大多无平台后缀（如 `examples/android/camera-gallery.yaml`），且演示配置自身的发现就是按项目目录（`examples/<project>/**`），目录推断与既有演示约定一致；`examples/harmony-experience/` 等非执行项目命名目录仍报错并指引经验演示显式入口。
- 一次调用允许混合平台文件：按项目分组、各组独立执行；与显式 `--project` 组合时要求全部文件推断一致，否则报错（避免「部分执行」的隐性歧义）。
- `examples/` 与 `cases/` 混合时按配置根分组分别调用，行为等价于分别执行两条既有命令。

### D4：文档与入口收敛

- `package.json` 新增 `"case": "node scripts/run-case.mjs"`（`pnpm case <路径...>`）。
- README「运行业务用例」：单文件入口列为首选快捷路径（一条命令示例 + 后缀推断说明 + 显式失败模式），批量入口保持完整回归说明；`cases/README.md`、`examples/README.md` 同步各自入口段落。既有 `test:cases:*` 脚本全部保留。

### D5：IDE / Agent 宿主交付面——执行 Skill（`.agents/skills/run-case/SKILL.md`）

- 形态：跟随既有 `.agents/skills/case-to-yaml/` 惯例——frontmatter（`name` + 带触发条件的 `description`：用户要求运行/执行 MTA、Midscene 用例或 YAML 文件时触发）+ 正文调用约定；纯文档、无执行代码。
- 内容范围：触发时机、命令映射（`pnpm case <路径...>`，含 `--project` 与透传参数约定）、后缀→项目推断规则、允许根目录（`cases/` / `examples/`）、显式失败模式与修复指引、报告位置（`midscene_run/report/`）、环境前置（`.env` 模型四项）与设备独占提示、批量请求指引既有 `test:cases:*` 入口。
- 关键约束：Skill 的唯一下游命令面是 `pnpm case`（批量指引除外），不出现官方 CLI 长命令拼装——避免第二命令面导致的行为漂移；执行语义、失败模式与命令行完全同构（对应 spec「Agent 宿主经 Skill 执行」）。
- 备选：Skill 直接教宿主拼装官方 CLI（`--config` + `--project` 组合）。放弃原因：绕过包装层的校验与项目推断，命令面复杂易错，且形成与 `pnpm case` 并行的第二套入口，语义随官方 CLI 变化更难同步。
- 备选：把执行说明并入既有 `case-to-yaml` Skill。放弃原因：转换与执行职责不同（前者明确「不执行测试」），合并会模糊触发条件与边界；以边界互指代替合并（转换完成后指向 `run-case`，执行请求不触发生成）。

## Risks / Trade-offs

- [文件名含 glob 元字符（`[`、`*` 等）时官方 include 匹配可能失真] → 实施验证结论：官方选择校验禁止 include 含反斜杠（POSIX 分隔符规则）且 include 不允许为空数组，glob 转义不可行；入口层对含元字符路径显式报错并提示重命名，未匹配项目在配置层使用保留的空集合哨兵模式（`__mta_no_matched_files__/*.yaml`）。
- [`MTA_CASE_FILES` 被使用方导出后污染批量入口] → 该变量在两个配置的选择函数中生效即覆盖 `MTA_SUITE`；README 明确其为单文件入口的内部契约；包装脚本自身总是显式传入或清除该变量，避免继承污染。
- [Skill 文档与 CLI 实际行为漂移] → Skill 只引用 `pnpm case` 一个命令面且保持简短（失败模式表与 design/spec 对齐）；实施任务中以真实失败模式核查（无设备）与冒烟结果校对 Skill 内容；后续 CLI 行为变更须同步核对 Skill。
- [宿主内误触发批量/全量执行导致设备长时间占用] → Skill 边界声明单文件/文件集为主，批量请求指引既有入口并附设备独占提示，不替使用方自动扩大执行范围。
- [官方 CLI 参数面未来变化（如新增文件过滤）] → 包装层仅依赖 `--config` / `--project` / `--result-dir` 三个已文档化参数；若官方提供原生文件过滤，可在包装层内替换实现而不改对外命令与规格。
- [多组顺序执行总时长随组数增长] → 单次调用通常单组；混合多平台本就要求各设备独占，顺序执行与 `maxConcurrency: 1` 语义一致，不引入并发。

## Migration Plan

纯增量：新增脚本与 npm script、两个配置的选择函数增加显式清单入参、新增执行 Skill 文件、文档更新。现有入口零改动；回滚即删除脚本、入参分支与 Skill 文件。实施后以 `examples/` 现有演示文件做一次真机/模拟冒烟（单文件、跨项目混合、失败模式三类）验证，证据按仓库惯例追加到验收文档，不改写历史记录。
