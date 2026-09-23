---
name: run-case
description: 运行 MTA 中的 Midscene YAML 测试用例。当用户提供用例名、命名空间目标（项目/大模块/特性/用例）或 YAML 文件路径（或要求运行/执行/跑某个用例、演示、示例文件），或询问如何执行用例时使用；在 IDE / Agent 宿主中无需阅读工程代码即可经 pnpm case 执行。执行平台由项目声明（project.yaml）决定并只启动该项目；批量请求同样走 pnpm case 的命名空间目标。不生成或转换用例（那是 case-to-yaml 的职责），不改造 Runtime。
---

# 运行 MTA 用例

把「运行哪个用例」翻译为一条 `pnpm case` 命令并执行，向使用方回报结果。执行、重试、报告全部由官方 Midscene CLI 完成，本 Skill 不引入任何其他执行方式。

## 定位契约

1. **定位项目**：以用户指定的 MTA 项目根目录为准；未指定时从工作目录向上定位同时包含 `ARCHITECTURE.md` 和 `midscene.config.ts` 的目录。
2. **确认前置**：入口在执行前会自检模型配置与设备连接；自检失败原样回报其修复动作即可，不要带病启动、不要绕过自检。

## 命令映射

```bash
pnpm case [<目标> ...] [--verbose] [--no-open] [--result-dir <目录>]
```

- 目标是命名空间路径 `<项目>[/<大模块>[/<特性>[/<用例>]]]`（可省略 `.yaml`），如 `pnpm case EV760/system/display/adjust-brightness`；给出的层级分别对应项目、大模块、特性、用例粒度。
- 执行平台由 `cases/<项目>/project.yaml` 的 `platform` 声明决定，无需也不能用 `--project` 指定。
- 演示文件按路径给出：`pnpm case examples/android/camera-gallery.yaml`（自动使用演示配置）。
- 一次可给多个目标（可混合项目与演示），按（配置根 × 执行平台）分组顺序执行。
- 用户不确定跑什么时，指引交互式菜单：`pnpm case`（环境自检 + 编号下钻；非交互环境打印范围清单）。
- 新建项目骨架：`pnpm case --new-project <项目> --platform <android|harmony|multi-device>`。
- 不要手工拼装或建议官方 CLI 长命令（`--config` + `--project` 组合）；`pnpm case` 是唯一执行面。不要设置 `MTA_SUITE` / `MTA_CASE_FILES` 等环境变量（内部契约或已退役）。

## 失败模式与回报

入口在启动执行前完成全部校验与自检，失败以非零码退出。向使用方原样回报错误与修复指引，不重试、不猜测替代目标、不静默改用其他入口：

| 错误信息关键词 | 含义与修复 |
| --- | --- |
| `项目不存在：…` | 项目名写错或未创建；用 `pnpm case --new-project <项目> --platform <平台>` 创建，或核对可用项目列表 |
| `目标不存在：…` | 模块/特性/用例名写错；按报错给出的可用子级核对 |
| `项目声明缺失：…` | 项目目录缺少 `project.yaml`；补声明（platform 必填）或用 --new-project 生成模板 |
| `声明非法（…）` | project.yaml 的 platform / devices 取值不对；按报错提示修正 |
| `路径含非 ASCII 字符` / `命名不合规范` | 文件夹或文件名含中文等字符；改为英文 kebab-case（如 adjust-brightness.yaml） |
| `设备需求未满足：…` | 协作用例 `# devices:` 声明的别名未在项目声明或 `MULTI_DEVICE_BINDINGS` 绑定；补齐声明与绑定 |
| `已退役` | `--project` / `--config` / `MTA_SUITE` / `test:cases:level*` 等旧维度已移除；按报错指引改用命名空间目标 |
| `环境未就绪，已阻止执行` | 自检失败（模型未配置 / 设备未连接等）；按上方每条 ✗ 的单一修复动作处理后重试 |

执行期失败（设备断连、用例断言失败等）以官方 CLI 语义为准：非零退出码，失败明细见摘要与报告。

## 结果与报告

- 运行默认输出步骤级人话进度；完整官方日志在 `--verbose` 下输出。
- 结束输出结果摘要（逐条结果、失败步骤与预期 vs 实际尾部明细），并自动在浏览器打开报告；`--no-open` 或非交互环境只打印报告路径。
- 报告位于项目根 `midscene_run/report/`（HTML，不入库）。向使用方回报报告路径与用例通过情况。
- 退出码：全部用例成功为 0；校验失败、自检失败或任一用例失败为非零。

## 批量与边界

- 项目级 / 模块级批量请求用同一入口的命名空间目标（如 `pnpm case EV760`、`pnpm case --all`），并提示设备独占与耗时；不替使用方自动扩大执行范围。
- 生成、转换、改写用例的请求交给 `case-to-yaml` Skill；本 Skill 只执行，不修改用例文件。
- 经验演示（`examples/harmony-experience/`）走其文档化显式入口（官方 CLI + `midscene.experience.config.ts`），不在本 Skill 范围内。
