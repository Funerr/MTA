# 业务测试集

用例按 level 分级，再按业务模块组织；Android、HarmonyOS 和多设备协作是执行环境，不作为一级目录。

```text
cases/
  level1/                 # 冒烟：核心链路
    settings/
      open.android.yaml
      open.harmony.yaml
  level2/                 # 常规回归
  level3/                 # 扩展、边界场景
```

上面的 YAML 路径仅为命名示意；当前业务目录为空，业务验收要求由使用方提供。

- `smoke` = `level1`，`full` = `level1 + level2 + level3`，不复制文件到 smoke/full 目录。
- `level1`、`level2`、`level3` 各自只运行该级，不是累计级别。一个工作流归属一个 level；不同等级的 case 应拆分到不同文件。
- 文件后缀 `.android.yaml`、`.harmony.yaml`、`.multi-device.yaml` 选择执行项目，也支持 `.yml`。文件名其余部分和业务模块目录由使用方决定。
- 平台版本的 YAML 仍须遵守各自 Node 契约；相同业务目标可分别维护平台版本。协作用例使用 `.multi-device.yaml`，并显式绑定 DUT1/DUT2/DUT3 等设备别名。
- 普通 `.yaml` 文件不会被自动收集，避免把平台专用步骤交给错误的 Agent。

```bash
pnpm run test:cases:smoke --project android
pnpm run test:cases:full --project harmony
pnpm run test:cases:level2 --project multi-device
pnpm run test:cases                           # 默认 full，三个执行项目串行
MTA_SUITE=level3 pnpm run test:cases --project android
```

`MTA_SUITE` 支持 `smoke/full/level1/level2/level3`；非法值在配置加载时失败。全量表示所选执行项目的全部 level，用 `--project` 独立选择平台。命令继续使用官方 Midscene CLI，不新增 Runner。选择范围为空时 CLI 会报告未找到用例；请先加入业务工作流。

当前 YAML 是 Expert Mode / Execution Workflow。语法见 [YAML 指南](../docs/midscene-yaml-guide.md)，协作配置见 [多设备指南](../docs/multi-device-yaml-workflows.md)。项目默认 `maxConcurrency: 1`；项目并发不表示同一用例内的设备同步。

原有综合、相机与经验演示已迁入 [examples/](../examples/README.md)，不会被业务测试集收集；框架夹具放在 `tests/fixtures/`。这些演示不代表真实设备业务验收通过。
