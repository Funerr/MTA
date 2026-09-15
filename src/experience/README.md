# src/experience/

Experience 能力：视觉经验资产契约、本地文件 Store，以及 Promotion（把单次原生执行轨迹转为 candidate）。

## 目录

- `schema/` — 资产格式定义与运行期校验
  - `experience.ts` / `variant.ts` / `action.ts` — Experience、Variant/修订/状态与动作链契约（zod 严格 schema + 语义校验）
  - `request-key.ts` — 精确请求 Key、逻辑节点别名归一化（experienceAct → aiAct）
  - `environment.ts` — 执行环境契约与指纹
  - `assets.ts` / `json.ts` / `patterns.ts` — 内容寻址资产引用、规范化 JSON 与摘要
- `store/` — 本地文件 Store
  - `experience-store.ts` — 查询候选、发布 candidate、按 expectedRevision+eventId 更新状态/统计、读取校验资产图
  - `index-file.ts` — `index.json` 快照读取与同目录临时文件 + rename 原子发布
  - `errors.ts` — `not-found` / `invalid-asset` / `unsupported-version` / `io-error` / `revision-conflict` 分类
- `promotion/` — 轨迹适配与学习入口（锁定 Midscene 1.12.7 dump）
  - `trace-adapter.ts` — 按 execution/call 隔离，映射六类动作，缺证整链拒绝
  - `promoter.ts` — 资格检查、裁剪签名、Store 原子发布（`callId` 幂等）
  - `image.ts` — `png-sharp@1` 解码/裁剪与 `mean-rgb-grid` 签名
- `index.ts` — 公共导出

字段说明见 [docs/experience-assets.md](../../docs/experience-assets.md)；Promotion 支持矩阵与取数契约见 [docs/experience-promotion.md](../../docs/experience-promotion.md)。

Schema/Store 不访问设备或模型。Promotion 只在公开 Agent dump 边界取数。Matcher / Replay / Runtime 尚未实现。
