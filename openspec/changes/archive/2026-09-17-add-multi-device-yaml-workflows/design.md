## Context

见 [proposal.md](proposal.md)。当前 `midscene.config.ts` 的 `android`、`harmony` 项目各在 setup 中返回一个 `agent`，各自只收集平台目录；`test.maxConcurrency: 1` 使项目串行。锁定的 Midscene Test 1.12.7 支持多个 Execution Project、项目本地 Node、`defineNode` 和 `createMidsceneNodes({ agentClass, getAgent })`；它按顺序执行单个 YAML 用例的步骤。现有 `src/setup/session.ts` 已提供接管前清理及单次释放语义，Android/Harmony 各自的设备枚举与精确选择规则应继续复用。

## Goals / Non-Goals

**Goals:**

- 让业务用例作者继续只编写 YAML；设备清单由项目配置维护，测试步骤始终显式指向设备。
- 复用 Midscene Test 的项目、Node 注册、原生 Agent、步骤失败与报告机制；自定义能力限于官方扩展点。
- 使同一协作用例能够顺序交错或并行调用不同设备，且失败与清理可验证。

**Non-Goals:**

- 改动 Midscene 包、YAML 顶层文档格式或 Runner；不把新的 `devices`、`parallel` 声称为官方原生语法。
- 让同一设备在一个并行组内执行重叠调用，或提供任意嵌套/后台任务编排语言。
- 在首期把实验性的 `experienceAct` 透明接入、Experience 资产跨设备共享或业务拨号流程封装进框架。

## Decisions

### 1. 保留单设备项目，新增独立的协作项目

现有 `android`/`harmony` 的 Node、setup 和发现范围保持原状。新增 `multi-device` Execution Project，仅收集 `cases/multi-device/**/*.{yaml,yml}`；它的配置声明任意数量（至少两台）的别名、平台与从环境取得的精确设备 ID。别名在加载配置时确定，用安全字符集约束，设备 ID 在 setup 期间解析和验证；模块导入不连接设备。相同平台与物理 ID 的重复声明拒绝。独立用例的多项目并发仍使用官方 `test.maxConcurrency`；只在设备明确互异时启用大于 1 的项目并发，不以它代替协作用例的步骤同步。

相比让两个独立 Execution Project 共享 YAML，此方案使一次协作用例拥有完整的设备集合和顺序关系；官方文档中同一 YAML 被多个 Project 选中会各执行一次，不能表达同一用例内的交接。

### 2. setup 为每个别名建立原生 Agent，取得即登记清理

按平台复用 `selectAndroidDevice` / `selectHarmonyDevice`、`bindAgentToDevice` 与 `SessionHandle`。先完成声明格式、重复绑定与平台枚举检查，再逐台连接；每取得一台会话，立即向项目 setup 注册其 `release()`。后续设备失败时，Midscene setup 的清理栈负责释放已经取得的会话；部分连接由现有 `bindAgentToDevice` 清理。上下文是只读映射 `alias → { platform, id, agent }`，不设置可变的“当前设备”。每台 Agent 的报告文件名包含别名和运行标识，防止并行落盘冲突。

相比在步骤运行时临时创建/切换 Agent，项目级会话提供确定性预检和生命周期，也避免步骤之间共享可变指针。

### 3. 别名化官方 Node 保留顺序步骤体验

对每个别名调用相应平台的 `createMidsceneNodes`，由 `getAgent` 从上下文读取固定别名对应的 Agent；注册时将 Node 名称限定为 `<alias>.<native-node>`，保留原输入 schema、字符串简写、execute 实现与执行轨迹。例如 `phone1.aiAct`、`phone2.aiAssert`。通用 `wait` 仍是全局 Node，不生成设备前缀；现有 `device.prepare`/`device.recover` 可提供同样带别名的薄适配。由于设备别名在配置阶段已知，未知别名及平台不具备的 Node 会在 Midscene 收集/解析阶段失败。

相比给官方 `aiAct` 输入直接加 `device` 字段，这种注册不改变官方严格输入 schema，并让原生步骤报告保留各自记录。Node 参考生成应包含每个已配置别名的可用操作及其平台。

### 4. 并行仅作为一个受限的自定义 Node

使用官方 `defineNode` 注册 `device.parallel`。它的输入为 `steps`，包含至少两个单键的 `<alias>.<native-node>` 步骤；首期每个子步骤是一个操作，别名不能重复，不能嵌套 `device.parallel`，也不能调用无设备目标的 Node。示意：

```yaml
cases:
  - name: 多设备协作
    steps:
      - phone1.aiAct: 执行第一步
      - phone2.aiAssert: 已观察到第一步的结果
      - device.parallel:
          steps:
            - phone1.aiAssert: 设备一处于预期状态
            - phone2.aiAssert: 设备二处于预期状态
          $:
            timeout: 30000
```

并行 Node 使用已注册的官方 Node 定义验证每个子输入，再以不同 Agent 并发执行并 `allSettled` 汇合；复用各子 Node 的 `execute`，不另外实现 AI 操作。父步骤取消信号与组内取消控制器联动；任一子调用失败即向仍在途的子调用发送取消，再等待它们结束或父步骤超时。将父步骤的 `onTeardown` 和报告收集能力传给子调用；每个子调用单独收集执行 ID，再并入父步骤轨迹。全部成功时将 `{alias, node, status, summary, executionIds}` 写入父步骤输出；任一失败时抛出包含各子调用结果的结构化错误，确保 Midscene 标记父步骤失败，且错误信息仍能定位其他子调用。并行子步骤不接受独立 `$` 元数据，超时由父步骤统一控制。

Midscene 的普通步骤超时可能先于设备 I/O 真正停止。因此所有设备目标 Node 共用按 Agent 的在途操作标记：信号中止后直到底层调用实际结束才清除；后续针对该设备的步骤在标记存在时明确失败，不重叠派发。项目清理需要尝试终止仍在途的 Agent，并保留原错误与清理错误。集成测试应验证锁定版本 Node 直接委托的输入、取消及轨迹契约；若公开接口无法满足这些契约，实施时应先停在兼容性验证任务，不以私有 Runner API 绕过。

相比自建 YAML 解释器，此设计只扩展单个可验证的并行步骤；顺序步骤仍由 Midscene Test 运行。

## Risks / Trade-offs

- [官方 Node 的 `execute` 直接委托可能在版本升级时改变行为] → 锁定版本原生边界集成验证 schema、错误、取消和轨迹；升级依赖前重跑该契约测试。
- [某些设备动作收到取消信号后仍继续执行] → 保持在途标记并禁止同设备后续调用，项目清理尝试释放 Agent；报告标明未确认停止的动作，不能宣称已取消成功。
- [并行组在 Midscene 报告中是一个父步骤] → 父步骤输出逐设备子结果与执行 ID，原生轨迹仍附在父步骤；文档明确这个展示边界。
- [多项目并发可能竞争同一物理设备] → 独立项目只有在显式绑定互异设备时才提高 `maxConcurrency`；文档和配置校验阻止已知重复绑定，不把进程外设备抢占视为可自动解决的问题。
- [平台 Node 集不同] → 按别名的平台生成可用 Node，配置与 YAML 收集阶段尽早暴露不支持的调用。

## Migration Plan

新增项目和用例目录，不迁移现有文件。默认单设备项目行为及串行并发设置保持不变；需要独立项目并发的环境显式提高 `maxConcurrency` 并指定互异设备。回滚时移除 `multi-device` 项目注册及其目录即可，原有 YAML 不受影响。
