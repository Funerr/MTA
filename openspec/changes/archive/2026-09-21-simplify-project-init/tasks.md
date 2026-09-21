# simplify-project-init — Tasks

## 1. 前提检测

- [x] 1.1 实现受限 semver 子集解析器与 Node 版本检测：解析 `engines.node` 的 `^x.y.z` / `>=x.y.z` / `||` 分支，不满足时非零退出并输出当前版本、约束与升级指引；解析不了的格式降级为警告并继续。为解析器补 vitest 单测（合法版本、各分支边界、不可解析格式三类用例），验证 `pnpm test` 通过（27 用例通过；沙箱内以 `^18.0.0` 篡改约束实测非零退出且无安装动作）
- [x] 1.2 实现 pnpm 可用性检测：缺失时非零退出并输出安装指引（corepack / 全局安装），不执行任何替装命令。验证：在 PATH 剔除 pnpm 的子 shell 中运行脚本，得到非零退出与指引输出（已实测 exit=1）

## 2. 安装与脚手架

- [x] 2.1 执行 `pnpm install` 并透传输出与退出码，失败时保留原始错误、非零退出。验证：以桩命令模拟安装失败时脚本非零退出且错误信息可见（桩 pnpm 以 42 退出，实测透传 exit=42 且原始错误可见）
- [x] 2.2 实现 `.env` 脚手架：不存在时复制 `.env.example` 并提示填写模型四项；已存在时输出跳过说明且不修改内容。验证：临时目录下分别以"无 `.env`"与"已有自定义 `.env`"两种状态运行，diff 确认已存在文件未被改动（成功桩沙箱实测两条路径）
- [x] 2.3 实现环境预检报告：`.env` 模型四项非空检查、`adb` / `hdc` 可用性与设备枚举（0 / 1 / N 台均列出标识，多台说明需显式指定）。验证：模型配置全空且无设备的环境正常结束、报告标注空缺项；有在线设备的环境正确列出标识（空配置沙箱实测；真实 adb / hdc 见任务 4.2 端到端验收）
- [x] 2.4 实现成功结束时的下一步指引输出（填写 `.env` → 用例放入 `cases/level*/` → `pnpm run test:cases:smoke --project <platform>`）。验证：完整运行输出包含三类指引（沙箱实测输出三步指引）

## 3. 入口与幂等

- [x] 3.1 在 `package.json` 增加 `mta:init` 别名。验证：`pnpm run mta:init` 与 `node scripts/init.mjs` 行为一致（两次运行 `[mta]` 输出行 diff 无差异）
- [x] 3.2 幂等验证：连续两次完整运行，第二次 `.env` 内容不变、脚本正常退出、依赖走增量。验证：运行前后 `diff .env` 无差异（真实仓库两次 `pnpm run mta:init` 均 exit=0，第二次增量安装、`.env` 零改动）
- [x] 3.3 裸环境验证：在删除 `node_modules` 的临时克隆上以 `node scripts/init.mjs` 运行，前提检测与 `.env` 脚手架步骤不依赖任何已安装依赖。验证：全新克隆可运行至 install 步骤（`git clone --depth 1` 临时克隆实测：无 node_modules、完整流程 exit=0、`.env` 已生成）

## 4. 文档与验收

- [x] 4.1 README「快速开始」以 `node scripts/init.mjs` 为首选入口并保留手动路径，按治理约束核对相对链接与能力声明一致性（仅文档改动，检查差异即可）（已更新快速开始、用例步骤 1 与目录结构表；`pnpm run typecheck` 与 `pnpm test`（55 文件 478 用例）全过）
- [x] 4.2 端到端验收：在真实环境（Node 22 + pnpm + adb，hdc 与设备可选）完整运行 init 一遍，确认预检报告与实际环境一致；按 AGENTS.md 验收约定追加带日期、环境与覆盖范围的独立验收记录（实际环境为 Node 24.20.0，如实记录于 [docs/project-init-acceptance.md](../../../docs/project-init-acceptance.md)，并已登记验收索引）
