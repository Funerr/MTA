# simplify-project-init

## Why

从 `git clone` 到跑通第一条用例，当前需要一条 5 步手工链路：自行核对 Node 版本约束（`^20.19.0 || ^22.12.0 || >=24.0.0`）、手动安装 pnpm、`pnpm install`（约 568MB，主要由 `@midscene/core` 引擎本体构成）、复制 `.env.example` 并去 Midscene 官网查模型四项配置、再学习 `cases/level*` 目录 / 平台后缀 / `test:cases:*` 脚本约定。每一步都可能让新使用方在中途卡住，且失败只在后续执行时逐个暴露，缺少一个把"环境是否就绪"一次性呈现的入口。

## What Changes

- 新增初始化脚本 `scripts/init.mjs`，裸 Node 即可运行（不依赖 `node_modules`），把上述链路收敛为一条命令：
  - 检测 Node 版本是否满足 `engines.node`；不满足时非零退出并给出升级指引，不替用户安装。
  - 检测 pnpm 是否可用；缺失时非零退出并给出安装指引（如 corepack），不替用户安装。
  - 执行 `pnpm install`（沿用现有 postinstall 的 Node 参考生成）。
  - `.env` 脚手架：不存在时从 `.env.example` 复制；已存在时保持不动、不覆盖。
  - 环境预检报告：以一张表报告 `.env` 模型四项是否非空、`adb` / `hdc` 是否可用及各自枚举到的设备（0 / 1 / N 台均列出标识）；只报告、不替用户选择设备。
  - 结束时打印下一步指引（填写 `.env` → 用例放入 `cases/level*/` → `pnpm run test:cases:smoke --project <platform>`）。
- README「快速开始」以 `node scripts/init.mjs` 为首选入口，保留现有手动步骤作为备选路径。
- 脚本可安全重复执行（幂等）：`.env` 不覆盖、`pnpm install` 天然增量。
- 明确不做：替装 Node / pnpm、模型厂商预设表、演示用例、模型连通性调用（init 保持离线、无需 API key）。

## Capabilities

### New Capabilities

- `project-init`: 一键初始化入口——环境检测（Node / pnpm）、依赖安装、`.env` 脚手架与环境预检报告（模型配置完整性、adb / hdc 设备枚举）及下一步指引；检测失败显式报错并给出指令，不静默安装、不静默选择。

### Modified Capabilities

（无——本变更不改变任何现有运行时能力的规格行为。）

## Impact

- 新增 `scripts/init.mjs`：纯 DX 工具层，不触碰 `src/setup` / `src/nodes` / `src/experience` 的运行时职责，不新增 Midscene 内部契约访问。
- `package.json`：新增可选的 npm script 别名便于重复执行（如 `mta:init`）。
- `README.md`：「快速开始」与「运行业务用例（使用方）」段落的入口描述更新。
- 无依赖变更、无执行行为变更：现有 `pnpm install` / `test:cases:*` 入口及其语义保持不变。
