# 多设备 YAML 协作工作流

当前 Expert Mode / Execution Workflow 使用 Midscene YAML，在同一个执行项目里绑定多台 Android / HarmonyOS 设备，并交错或同时操作它们。设备连接、Agent 生命周期和清理由项目 setup 管理。

## 与官方多项目并发的区别

| | 官方 Execution Project 并发 | 本项目 `device.parallel` |
| --- | --- | --- |
| 用途 | 不同 YAML 用例在**不同项目**里并行跑 | **同一 YAML 用例内**同时操作已绑定的不同设备 |
| 配置 | `test.maxConcurrency`（本仓库默认 `1`） | YAML 步骤 `device.parallel` |
| 设备 | 每项目一台；只有显式绑定互异设备时才应把 `maxConcurrency` 调到大于 1 | 协作项目在配置里声明至少两台别名 |
| 语法 | 官方能力 | 自定义 Node，不是 Midscene 原生 YAML 语法 |

回滚：从 `midscene.config.ts` 的 `projects` 中移除 `multi-device`，并删除 `cases/multi-device/` 即可；`cases/android/` 与 `cases/harmony/` 不受影响。

## 配置

在 `.env` 中声明别名、平台和设备 ID 所在的环境变量：

```bash
MULTI_DEVICE_BINDINGS=DUT1:android:MULTI_DEVICE_DUT1_ID,DUT2:harmony:MULTI_DEVICE_DUT2_ID
MULTI_DEVICE_DUT1_ID=<adb udid>
MULTI_DEVICE_DUT2_ID=<hdc deviceId>
```

- 至少两台；别名以字母开头，仅含字母、数字、下划线；不能使用 `device` / `wait`。
- 设备 ID 必须显式给出，setup 时精确匹配，不静默改选。
- 同一平台的同一物理 ID 不能绑定两个别名。
- 模块导入和 `pnpm run nodes` **不连接设备**。未设置 `MULTI_DEVICE_BINDINGS` 时兼容默认值仍为 `phone1`（android）+ `phone2`（harmony），便于生成 Node 参考。文档推荐 `DUT1/DUT2/DUT3`，底层允许任意合法 alias；下方 DUT 示例须先设置上方显式绑定。

独立 `android` / `harmony` 项目仍然各绑一台设备。默认 `test.maxConcurrency: 1`，三项目串行。不要靠提高项目并发来代替协作用例内的步骤同步。

## YAML 步骤

协作项目没有“当前设备”。顺序步骤写成 `<alias>.<native-node>`：

```yaml
cases:
  - name: 多设备协作
    steps:
      - DUT1.device.prepare: { target: home }
      - DUT2.device.prepare: { target: home }
      - DUT1.aiAct: 执行第一步
      - DUT2.aiAssert: 已观察到第一步的结果
      - device.parallel:
          steps:
            - DUT1.aiAssert: 设备一处于预期状态
            - DUT2.aiAssert: 设备二处于预期状态
          $:
            timeout: 30000
      - wait: { duration: 500 }
      - DUT1.device.recover: {}
      - DUT2.device.recover: {}
```

规则：

- `wait` 仍是全局 Node，不加设备前缀。
- `device.prepare` / `device.recover` 必须带别名。
- 未声明别名或该平台没有的 Node（例如给 Harmony 别名写 `runAdbShell`）在收集/派发前失败，不会改派到其他设备。
- `device.parallel` 的 `steps` 至少两项，各指向不同已绑定设备上的一个别名化原生 Node；不能嵌套 `device.parallel`，子步骤不能写 `$`。超时由父步骤的 `$` 统一控制。

## 报告边界

并行组在 Midscene 报告里是**一个父步骤**。父步骤输出（或失败错误）包含每台设备的 `alias`、操作名、状态、错误和 `executionIds`；原生轨迹挂在该父步骤上。请按设备别名定位，不要把某个子调用成功当成整个并行步骤成功。

超时后设备 I/O 可能仍在运行。框架会阻止同一设备上的后续步骤重叠派发，并在清理时尝试释放 Agent；报告不会宣称“已取消成功”。

## Node 参考

```bash
pnpm run nodes
```

会生成 `midscene-node-reference.multi-device.md`，其中包含每个已配置别名的可用操作（含平台特有的 `runAdbShell` / `runHdcShell`）以及 `device.parallel`。

## 验证范围

受控边界与真实设备验证范围见[多设备阶段验收记录](multi-device-yaml-workflows-acceptance.md)。
