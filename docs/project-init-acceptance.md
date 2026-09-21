# 一键初始化入口验收

## 2026-09-21：init 脚本全路径验证（simplify-project-init）

- **环境**：macOS（arm64，darwin 25.6.0）、Node 24.20.0（满足 `>=24.0.0` 分支）、pnpm 10.33.2、adb（Homebrew android-commandlinetools）、hdc（`/opt/homebrew/bin/hdc`）；验收时点无在线设备（adb 0 台已授权、hdc 0 目标）；仓库 `.env` 模型四项已配置。
- **覆盖**：
  - **单元测试**：`scripts/lib/engines-range.mjs` 受限 semver 子集解析器 27 用例（仓库约束合法版本、各分支上下界、caret 0.x 语义、不可解析输入返回 null、空白容忍）通过；全量 `pnpm test` 55 文件 478 用例通过，`pnpm run typecheck` 通过。
  - **前提失败路径（沙箱）**：Node 版本不符（临时副本 `engines.node` 篡改为 `^18.0.0`）→ exit=1，输出当前版本、约束与升级指引，未执行任何安装动作；pnpm 缺失（PATH 剔除 pnpm）→ exit=1，给出 corepack / 全局安装指引，未替装。
  - **安装失败透传（桩 pnpm 以 42 退出）**：脚本退出码透传 42，原始错误信息可见，不静默重试。
  - **空配置 + 无工具环境**：模型四项全空且 PATH 无 adb / hdc 时 exit=0，预检逐项标注"未填写 / 不可用"，正常输出三步下一步指引。
  - **`.env` 脚手架**：无 `.env` 时生成与 `.env.example` 逐字节一致；已有自定义 `.env` 时跳过且内容零改动（diff 验证）。
  - **真实环境端到端**：`node scripts/init.mjs` 与别名 `pnpm run mta:init` 连续运行均 exit=0，两次 `[mta]` 输出行一致；依赖增量安装（3.3s）；运行前后 `.env` diff 无差异；预检正确识别模型四项已填写、adb / hdc 可用且 0 台设备并输出对应说明。
  - **裸环境**：`git clone --depth 1` 临时克隆（无 `node_modules`）上完整流程 exit=0，`.env` 正常生成——前提检测与脚手架不依赖任何已安装依赖。
- **未验证**：
  - 真机在线场景（1 台 / 多台设备的枚举展示与"需显式指定"提示）：验收时点无在线设备，仅覆盖 0 台与工具缺失分支；非零分支为纯展示逻辑，留待有设备环境复跑确认。
  - Windows `shell` 分支与 Node 20 / 22 实机：本机仅 Node 24（macOS arm64）；解析器对 20.19 / 22.12 边界的判定由单元测试覆盖。
