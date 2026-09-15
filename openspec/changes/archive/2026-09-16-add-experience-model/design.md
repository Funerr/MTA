## Context

当前尚未实施框架。此模型是后续 Change 共用的 v1 契约，实施前需先完成底座。它表达已发生的视觉动作，不承担业务规划；动机见 proposal.md。

实施前置：[bootstrap-midscene-mobile-test](../bootstrap-midscene-mobile-test/proposal.md)。本次为提前规划，前置完成后先核对实际契约。

## Goals / Non-Goals

**Goals:** 统一来源、环境、入口、动作及状态契约，让坏资产明确失败，避免后序模块各自解释缓存。

**Non-Goals:** 不做数据库、跨进程锁、模糊语义 Key、跨分辨率迁移和 Runtime。

## Decisions

### 1. 资产结构与职责

在 schema/experience.ts、action.ts、variant.ts 定义格式并做运行期校验。Experience 使用 requestKey 聚合请求；Variant 按环境指纹和 entryEvidence 区分入口，revision 保存学习修订。source 记录 casePath（项目相对路径）、caseName、stepPath（包含 hook/steps 位置）、逻辑 node=aiAct、原始请求、callId、Midscene/适配版本和时间。外部调用名 experienceAct/aiAct 不进入逻辑 Key，便于阶段 7 迁移。

### 2. Key 和环境

将严格规范化 JSON 的 case 身份、stepPath、原始 prompt、有效 options/context、策略版本做哈希；字符串内容不 trim、不改写，不把运行 ID/取消信号放入 Key。首期只缓存已登记纯文本请求，图片或未知语义参数直接不合格。environment 至少含 platform=android、model、systemBuild、resolution、orientation、language、theme 及执行兼容版本。必需字段未知即不兼容；不用设备序列号禁止同型号复用，也不默认跨系统版本复用。

### 3. 动作链证据

每动作记录 before/after 屏幕图引用及 signature（algorithm/version/params/value）、type、完整参数、原始截图尺寸和可选 target。target 含图、context 图、bbox、可选文本 hint 与局部操作前状态证据；Tap/Input/Scroll/LongPress 按实际动作契约要求目标，Back/Home 不强造目标图。有向坐标参数必须能由当前定位重新投影，否则拒绝该动作版本。Input 保存 text 与 mode，Scroll 保存方向/距离/锚点，LongPress 保存 duration。动作类型只映射原生动作，不新增 VisualTap 等类型。

### 4. 入口和完成语义

Variant 保存 entryEvidence、terminalEvidence 和动作数组，至少有一个动作。入口不是仅用全屏精确哈希去查找：Key/环境先取候选，入口图片由后序 matcher 验证，以容忍轻微位移。terminalEvidence 是结构一致性证据，不是语义断言缓存。保存 eligibilityPolicyVersion、完整取证标记和原生结果类别；首期只允许结果为 undefined 的纯动作调用重放，动态输出不复用。

### 5. 状态事件与文件发布

Store 提供查询候选、发布 candidate 和按 expectedRevision+eventId 更新状态/统计的窄接口。同一次调用只学习一次；candidate/active 可作为候选，stale 保留但不选。relearn 是新发布事件，不是额外存储状态。用不可变的 assets/<content-hash> 文件和 index.json 快照：先写/校验资产，再同目录临时索引写入并原子替换。写失败保留旧索引，后续垃圾回收另做。进程内串行更新，不宣称跨进程事务或掉电持久性。

### 6. 边界与错误

区分 empty/not-found、invalid-asset、unsupported-version、io-error、revision-conflict；由 Runtime 决定降级，不在 Store 调 AI。检查根目录归一化路径、realpath 与资产内容摘要，拒绝越界/篡改。受测试环境保护的实际输入和截图按原样取证，不把密钥写入配置；敏感输入/页面首期不登记为可学习目标。仅持久化协议所需元数据，不复制完整模型请求日志。

## Risks / Trade-offs

- [Key 过细降低命中率] → 首期优先隔离错误复用，后续用证据逐项放宽。
- [未来轨迹字段与 v1 不符] → Promotion 先验证，若须改变协议更新本规格及后续契约，不能静默补默认值。
- [文件存储并发限制] → 沿用单写者运行约定，冲突显式报错；多进程支持单独规划。

## Migration Plan

从空 experiences/ 初始化，不导入坐标缓存。交付夹具、读写测试及字段说明后供 Promotion 使用；不兼容版本拒绝读取，回滚代码时保留旧资产，禁止自动覆盖迁移。
