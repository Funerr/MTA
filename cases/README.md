# cases/

使用方业务用例目录，按平台拆分：

- `cases/android/` —— `android` 执行项目的用例发现范围
- `cases/harmony/` —— `harmony` 执行项目的用例发现范围
- `cases/multi-device/` —— `multi-device` 协作项目的用例发现范围（同一 YAML 内操作多台设备）

此目录接收使用方的 Expert Mode / Execution Workflow。仓库保留的示例/验收用例见下表，不构成业务用例库或业务效果承诺；使用方将自己的合法 Midscene YAML 放入对应目录后，通过 `pnpm run test:cases`（官方 `midscene-test` CLI）执行。单设备能力参考 `midscene-node-reference.android.md` / `midscene-node-reference.harmony.md`；协作项目参考 `midscene-node-reference.multi-device.md` 与 [docs/multi-device-yaml-workflows.md](../docs/multi-device-yaml-workflows.md)。

默认三项目串行执行（`maxConcurrency: 1`）。`android` / `harmony` 各绑定一台设备；协作用例在 `multi-device` 项目内声明多台设备，不要把官方多项目并发当成同一用例内的步骤同步。

框架自身的测试与夹具位于 `tests/`，不会进入任何平台的业务发现范围。

## 既有示例/验收用例

为保留现有路径和发现配置，以下文件暂留原位，并在文件头明确标识。运行默认单设备项目会收集对应示例，执行前须核对应用包名、设备环境和步骤。

| 文件 | 身份与运行入口 |
| --- | --- |
| [android/e2e-comprehensive.yaml](android/e2e-comprehensive.yaml) | Android 综合能力示例/验收工作流；默认 `android` 项目 |
| [android/camera-gallery.yaml](android/camera-gallery.yaml) | 相机/图库示例；包名与界面需按设备调整；默认 `android` 项目 |
| [harmony/e2e-comprehensive.yaml](harmony/e2e-comprehensive.yaml) | HarmonyOS 综合能力示例/验收工作流；默认 `harmony` 项目 |
| [harmony-experience/experience-learn.yaml](harmony-experience/experience-learn.yaml) | 经验学习/重放示例；由独立的 `midscene.experience.config.ts` 收集，默认三项目不收集 |

经验示例配置含设备环境和纯动作资格策略，运行前必须按实际环境核对；仅连续执行两次并不能证明命中重放，应检查 Runtime 事件和模型请求记录。

新增演示统一放 `examples/`，默认生产发现范围不包含该目录；需要执行时显式配置示例入口。业务用例由使用方维护，框架夹具放 `tests/fixtures/`。
