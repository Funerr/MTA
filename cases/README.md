# 业务测试集

用例按「项目 → 大模块 → 特性 → 用例」组织：项目即机型代号（如 `EV760`），执行平台与设备需求在项目级声明一次，用例文件不带平台后缀。

```text
cases/
  EV760/                      # 项目 = 机型代号
    project.yaml              # platform: android | harmony | multi-device（+ 可选 devices 别名需求）
    protocols/                # 大模块：通信协议（新建项目默认骨架，可自由增删）
      bluetooth/              # 特性：按特性自由拆分
        dual-device-pairing.yaml
    system/                   # 整机
      display/
        adjust-brightness.yaml
    core/                     # 三大项
    stability/                # 稳定性
  EV720/                      # 下一个机型，各自独立一套
    ...
```

- **命名**：文件夹与 YAML 文件名全部英文 kebab-case（机型代号允许大写，如 `EV760`）；路径含中文等非 ASCII 字符会在启动前被拒绝。四大模块中文对照（通信协议 / 整机 / 三大项 / 稳定性）只出现在菜单显示层。
- **平台声明**：`cases/<项目>/project.yaml` 的 `platform` 决定执行项目，文件名后缀（`.android.yaml` 等）不再有语义；`devices` 声明项目所需设备别名（协作项目需要至少两台）。
- **退役**：`cases/level{1,2,3}` 分级目录与 smoke / full / level 取值已退役；执行选择的粒度是项目、大模块、特性、用例。
- **层级不限**：大模块、特性之下可继续建目录分组，选择与执行按实际目录组织呈现；新建项目骨架只是模板默认值。
- **协作用例**：文件头部以注释声明设备需求（`# devices: DUT1, DUT2`），执行前与项目 `devices` 及 `.env` 的 `MULTI_DEVICE_BINDINGS` 显式绑定比对，未满足在执行前失败（推荐别名 DUT1/DUT2/DUT3）。
- **新建项目**：`pnpm case --new-project EV760 --platform android`（生成 `project.yaml` 模板 + 四大模块目录）。

```bash
pnpm case                                          # 菜单：环境自检 + 按编号下钻
pnpm case EV760                                    # 跑一个项目的全部用例
pnpm case EV760/system                             # 跑一个大模块
pnpm case EV760/system/display/adjust-brightness   # 跑单条用例
pnpm case --all                                    # 全部项目全部用例
```

执行语义、自检与失败模式见 [README](../README.md#运行业务用例使用方)；YAML 语法见 [YAML 指南](../docs/midscene-yaml-guide.md)，协作配置见 [多设备指南](../docs/multi-device-yaml-workflows.md)。项目默认 `maxConcurrency: 1`；项目并发不表示同一用例内的设备同步。命令使用官方 Midscene CLI，不新增 Runner；执行仍由官方 Midscene Runner 负责，本目录只放业务工作流。

原有演示在 [examples/](../examples/README.md)（`pnpm case examples/<演示目录>/<文件>.yaml`），不被业务测试集收集；框架夹具放 `tests/fixtures/`。演示不代表真实设备业务验收通过。
