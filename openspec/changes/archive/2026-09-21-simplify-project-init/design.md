# simplify-project-init — Design

## Context

当前上手链路是 5 步手工流程（核对 Node 版本、装 pnpm、`pnpm install`、复制 `.env` 并查文档填模型四项、学目录/后缀/脚本约定），且"环境是否就绪"没有任何一次性呈现的入口。本设计只解决"收敛为一条命令 + 显式报告"，不解决依赖体积（约 568MB，`@midscene/core` 引擎本体占 219MB，见 proposal）。治理约束：不触碰 `src/setup` / `src/nodes` / `src/experience` 运行时职责，不新增 Midscene 内部契约访问。

## Goals / Non-Goals

**Goals:**

- 一条 `node scripts/init.mjs` 完成：前提检测 → 依赖安装 → `.env` 脚手架 → 预检报告 → 下一步指引。
- 脚本在无 `node_modules` 的克隆上可直接运行（仅依赖 Node 标准库）。
- 可重复执行；检测失败给出精确指令而非猜测。

**Non-Goals:**

- 不替用户安装或切换 Node / pnpm（用户已决策）。
- 不内置模型厂商预设表、不提供演示用例、不发起模型连通性调用（用户已决策；init 保持离线）。模型连通性可作为将来的独立 `doctor` 命令扩展。
- 不削减依赖体积、不改依赖结构。
- 不改变现有 `pnpm install` / `test:cases:*` 入口的任何语义。

## Decisions

### D1: 入口是裸 Node 脚本，不是 npm script 或外部包

`node scripts/init.mjs` 在依赖安装前就必须可用，因此不能依赖 `node_modules`，也不能走 `pnpm run`（那要求 pnpm 已就绪且语义绕圈）。`package.json` 增加别名 `"mta:init": "node scripts/init.mjs"` 仅作重复执行便利（`pnpm init` 是保留命令，不可占用）。

考虑过的替代：发布 `npx` 安装器（仓库 private，涉及发布决策，远期再说）；Docker / Dev Container（设备 USB 直通在 macOS 上脆弱，与设备绑定框架错配）。均否决。

### D2: engines 约束校验用最小 semver 子集解析，解析失败降级为警告

脚本无法 import `node_modules` 里的 semver。`engines.node` 当前为 `^20.19.0 || ^22.12.0 || >=24.0.0`，实现一个仅支持 `^x.y.z` 与 `>=x.y.z` 两种前缀、`||` 分支的受限解析器即可覆盖。**解析不了的未来格式降级为警告并继续**，由 `pnpm install` 阶段的 engines 提示兜底——不为 init 引入依赖或硬编码版本清单（硬编码会随 `package.json` 漂移）。

### D3: 设备枚举是只读平行实现，不 import `src/setup`

`src/setup/android.ts` 是执行期 TS，依赖 `node_modules`（tsx 运行），init 不能复用。init 自行调用 `adb devices` / `hdc list targets` 并只做**列出**：0 / 1 / N 台都展示标识，不选择、不写回环境变量。这与执行期 setup 的"不静默选择"语义一致，但职责面窄得多（无会话、无错误类型），平行实现的漂移风险可接受。

### D4: 步骤顺序与失败语义固定

检测顺序固定为：Node 版本 → pnpm → `pnpm install` → `.env` 脚手架 → 预检报告 → 指引。前提检测失败在**任何安装动作之前**退出（非零），避免在错误环境里留下半成品。预检阶段（模型配置空、工具缺失、设备 0/N 台）一律只报告不失败——这些是"使用方待办"，不是"初始化失败"。

### D5: `.env` 脚手架只做复制

不存在则从 `.env.example` 复制；存在则不动。不解析、不写入任何值（无预设表）。模型四项的指导留在 `.env.example` 文件头注释里，init 预检只报告空缺项并指回该文件，不复制文档内容到脚本里。

## Risks / Trade-offs

- [受限 semver 解析器覆盖不了未来的 engines 格式] → 降级为警告不阻塞，`pnpm install` 的 engines 提示兜底；约束格式变更时验收清单核对。
- [设备枚举与 `src/setup` 平行实现，未来可能漂移] → init 只列不选，不承载选择/错误语义；`src/setup` 枚举行为变化时需同步核对 init 的展示逻辑（记入 tasks 的验证项）。
- [`pnpm install` 体量大、耗时长，用户感知"init 很慢"] → init 输出中预告耗时与体积量级；体积治理明确不在本变更范围。
- [postinstall 生成 Node 参考依赖仓库脚本自身] → 这是既有现状，init 直接继承，不新增耦合。

## Migration Plan

纯新增变更，无迁移。回滚 = 删除 `scripts/init.mjs`、移除 `mta:init` 别名、还原 README 段落。
