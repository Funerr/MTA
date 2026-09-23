# simplify-case-execution Tasks

## 1. 选择层契约：显式文件清单

- [x] 1.1 `cases.config.ts` 的 `caseFiles()` 支持 `MTA_CASE_FILES`（JSON 数组字符串，POSIX 相对路径）：清单存在时以其覆盖 `include` 并忽略 `MTA_SUITE`，非法 JSON / 空数组 / 非字符串元素报错；以 vitest 单元测试覆盖清单生效、兜底报错与无清单时原行为不变
- [x] 1.2 `midscene.examples.config.ts` 接入同一清单契约：清单存在时覆盖各项目 `examples/<project>/**` 的 include；以单元测试（直接断言生成的 files 选择或经 `discoverTestFiles` 验证）确认演示文件按清单收窄
- [x] 1.3 验证官方 `discoverTestFiles` 对字面路径 include 的匹配行为（含文件名含 glob 元字符的场景）；若按 glob 解析则在构造 include 前转义元字符，并把该场景纳入 1.1 的单元测试（实施结论：官方校验禁止 include 含反斜杠，转义不可行；元字符路径改为在入口层显式拒绝并提示重命名，见 design 修订）

## 2. 包装脚本：`scripts/run-case.mjs`

- [x] 2.1 实现参数解析与前置校验（路径存在 → 根目录约束 `cases/`/`examples/` → 后缀推断 → 与显式 `--project` 比对），校验逻辑以可被 vitest 导入的纯函数实现；任一失败均以非零码退出并给出明确错误（冲突/未知后缀需列出支持清单或冲突明细），单测覆盖每种失败模式（实施补充：examples/ 根下无后缀文件按演示项目目录确定性推断；glob 元字符路径因官方校验禁止反斜杠转义而显式拒绝并提示重命名；选择层与入口层推断一致性有跨层单测约束，见 design/spec 修订）
- [x] 2.2 实现（配置根 × 执行项目）分组与顺序执行：每组调用官方 CLI（`examples/` 根加 `--config midscene.examples.config.ts`），调用前打印实际命令行，stdio 继承，透传其余参数，任一组失败不中断后续组、退出码取首个非零值；`MTA_CASE_FILES` 仅由脚本自身显式传入（清除继承值）
- [x] 2.3 `package.json` 增加 `"case": "node scripts/run-case.mjs"`；验证 `pnpm case` 无参数时打印用法并以非零码退出

## 3. 验证与回归

- [x] 3.1 运行 `pnpm test`（新增单测全部通过且存量不回归）与 `pnpm typecheck`
- [x] 3.2 无设备失败模式核查：对 `pnpm case` 分别给出不存在路径、无平台后缀文件、`--project` 冲突、允许根之外的路径，确认均启动前报错非零退出、未产生设备会话与报告目录
- [x] 3.3 带设备冒烟（记录日期/环境/覆盖范围，追加独立验收记录，不改写历史）：单文件执行 `examples/` 现有演示用例成功且报告写入 `midscene_run/report/`；一次混合两平台文件验证分组执行；回归一条批量入口（如 `MTA_SUITE=smoke pnpm test:cases --project android`）确认行为不变（2026-09-21 完成：Android 真机单台在线，单文件 workbench 演示 1/1 通过且报告落盘、混合两平台文件分组执行组间零串扰、批量入口 smoke 回归行为不变；相机演示入口链路正常但用例断言对设备 UI 敏感；鸿蒙真机与 multi-device 因无设备未验证。验收记录见 docs/case-execution-entry-acceptance.md，待设备接入后执行；已先完成无设备委托链路核查：`pnpm case examples/android/camera-gallery.yaml` 仅启动 android 项目，preflight 1 项目/1 文档/1 用例/0 收集错误，按官方语义在设备会话处 not-run、报告正常产出，退出码非零）

## 4. 用例执行 Skill（IDE / Agent 宿主交付面）

- [x] 4.1 创建 `.agents/skills/run-case/SKILL.md`：frontmatter（`name` + 带触发条件的 `description`）与正文调用约定——`pnpm case` 命令映射（含 `--project` 与透传参数）、后缀→项目推断、允许根目录、显式失败模式与修复指引、报告位置、`.env` 前置与设备独占提示、批量请求指引既有 `test:cases:*` 入口；验证 Skill 中每个失败模式/命令示例与 3.2、3.3 的实际核查/冒烟结果一致，不出现官方 CLI 长命令拼装（失败模式表逐条对照 3.2 真实输出核验；报告位置与退出码说明经无设备委托链路核查确认；带设备成功路径随 3.3 一并复核）
- [x] 4.2 README 能力入口登记 `pnpm case` 与执行 Skill（含两个 Skill 的边界互指：`case-to-yaml` 不执行测试、`run-case` 不生成用例）；验证 README / Skill / 实际命令三者描述一致

## 5. 文档同步

- [x] 5.1 README「运行业务用例」把 `pnpm case` 列为单文件首选入口（命令示例、后缀推断规则、显式失败模式、`MTA_CASE_FILES` 为入口内部契约），批量入口说明保持完整；`cases/README.md` 与 `examples/README.md` 各自补充单文件执行示例；核对全部相对链接与能力声明一致
