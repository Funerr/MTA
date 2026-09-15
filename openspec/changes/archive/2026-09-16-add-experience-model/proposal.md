## Why

视觉经验需要可校验、可追踪且与环境绑定的持久化格式，才能被后续生成和重放模块共同使用。先明确资产契约，避免把经验退化为提示词到坐标的缓存。

## What Changes

- 定义带 schemaVersion 的 Experience、Variant、动作链、视觉证据、来源和统计信息；明确 candidate、active、stale 状态与新候选学习记录。
- 定义精确请求 Key、环境兼容条件和按当前入口画面区分的 Variant；不跨型号、语言或系统版本盲用。
- 提供本地文件 Store、校验、原子发布、修订号和幂等统计更新，运行资产独立放在 experiences/。
- 本次仅交付资产契约和存取能力，不实现视觉匹配、轨迹采集、设备动作、AI 调用或 Runtime。

## Capabilities

### New Capabilities

- `experience-assets`: 定义带 schemaVersion 的 Experience、Variant、动作链、视觉证据、来源和统计信息；明确 candidate、active、stale 状态与新候选学习记录。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

主要影响 src/experience/schema/、src/experience/store/、experiences/ 的格式与夹具。首期单进程单写者，拒绝不兼容 schema，不增加数据库或分布式存储。

实施前置：[bootstrap-midscene-mobile-test](../bootstrap-midscene-mobile-test/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。

