## Context

框架 MVP 集成矩阵和失败分类必须先通过。当前范围是 Midscene Test 项目 YAML 的原 aiAct Node，不是所有 Agent SDK 调用。

实施前置：[add-experience-fallback](../add-experience-fallback/proposal.md)。本次为提前规划，前置完成后先核对实际契约。

[Midscene 项目配置](https://www.midscenejs.com/midscene-test/configuration)（2026-09-15 核对）说明官方 Node 工厂与项目级注册。文档并不等于已验证包装兼容性，本 Change 首项任务须使用锁定包证实。

## Goals / Non-Goals

**Goals:** 让既有 YAML 保持不变地使用经验，尽量复用官方节点定义与执行语义，并可一键关闭。

**Non-Goals:** 不修改全局原型、不 fork Midscene、不扩展声明的支持范围，不自动迁移任意旧坐标缓存，不移除 experienceAct。

## Decisions

### 1. 项目级 Node 接入

从锁定版本官方工厂取得 aiAct 定义，在当前项目注册层保留它的 schema、描述、输入归一化和返回格式，只对执行入口增加薄包装。保存原 execute 回调作为 native 路径；Runtime 回退直接调用该回调并保留所需 this/上下文，不经注册表再次派发 aiAct。若当前版本有合适的公开运行扩展点可用同样契约接入，但不假设存在全局 Hook。

### 2. 先验证兼容性再替换注册

建立最小契约试验验证官方定义可安全复用、报告关联、signal、超时和原生结果可保留。若公开机制不能满足，不改 prototype 或复制 Runner；记录缺口并修订此后续计划。当前官方项目配置允许项目范围 Node 注册；具体定义字段以 bootstrap 锁定包为准。

### 3. 默认关闭和资格透传

使用项目配置 experience.enabled，默认 false。关闭时使用原始定义且不实例化 Runtime/Store。开启时纯文本、受支持 options、登记的纯动作请求和 undefined 结果资格才允许重放；对象图片 prompt、未知字段/context 组合、动态结果或内嵌断言完全透传 native。不是丢弃参数后缓存一个简化版本。

### 4. 身份与资产迁移

内部 logical node=aiAct 延续前序 Key；用例路径、case、step 不变时将 experienceAct 改为 aiAct 可以复用已有合格资产。复制到新用例路径时默认重新学习，避免错误共享。保留实验 Node 原接口，不改变现有用户调用；原生 aiAssert 与其他 Nodes 不经过此包装。

### 5. 报告与结果

仍显示原 aiAct 步骤，经验分支作为原生可附加事件，不制造第二个顶层 Step。原生执行时返回其真实结果，重放只提供纯动作模式对应的 undefined 结果并使用官方 Node 的输出约定。与原生输入验证失败、native throw、signal timeout 的对照必须在当前版本实测。双层 Node 与 Runtime 各自只有一个职责，禁止两处同时 Promotion。

### 6. 对照验证与回滚

在框架测试中对同一 Node 输入或最小 YAML 解析夹具切换开关，核对输入转发、调用次数、结果、取消、清理、Node reference 和报告。复用 Runtime 集成矩阵，并增加图片/未知 options/有效 context 变化/动态返回/含断言请求的旁路验证；不运行或交付设备业务流程。关闭配置是回滚动作，无须删除资产或改用例。

## Risks / Trade-offs

- [官方 Node 定义或执行返回格式变化] → 锁版本、契约试验和运行时资格检查；升级时先跑矩阵。
- [透明接入掩盖语义变化] → 精确请求资格与原生旁路，保留动态返回而不缓存推断文本。
- [错误递归导致重复设备操作] → native 回调独立持有，测试一次命中失败只能触发一次 AI。

## Migration Plan

默认开关关闭完成接入及回归；在明确通过的项目上启用。原 MVP YAML 可逐个改回 aiAct，也可继续保留实验 Node。原生底座规格的“直接使用原生语法”不变，本能力只新增可选接入行为。
