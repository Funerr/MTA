# src/experience/

Experience 能力：视觉经验资产契约、本地文件 Store、Promotion（把单次原生执行轨迹转为 candidate）、Matcher（本地验证历史画面/目标）与 Replay（按当前画面逐步重放动作链）。

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
- `matcher/` — 本地视觉匹配（不调用 VLM / 网络 OCR / 设备动作）
  - `match.ts` — `matchScreen` / `matchTarget`
  - `screen.ts` / `target.ts` / `text.ts` / `confidence.ts` — 页面筛选、模板搜索、可选 OCR、分项硬判定
- `replay/` — 视觉动作回放（每步新截图验证后派发原生已定位动作，不调用 VLM）
  - `validator.ts` — 整链预检：动作支持集、参数语义、环境/版本兼容、全部证据图片可用
  - `replay.ts` — 逐步执行器：验证 → 坐标 → 派发 → 有界等待 → 终态检查，输出 ReplayResult 与事件流
  - `native-actions.ts` — 经验动作 ↔ 原生直接调用入口对应表与参数构造
- `runtime/` — 实验闭环（Lookup → Replay → 至多一次原生 AI → Promotion）
  - `eligibility.ts` — 使用方注入的纯动作资格策略（默认空表）
  - `lookup.ts` — candidate/active 查询与入口验证，歧义不试点设备
  - `runtime.ts` — 回退预算、生命周期事件、学习错误隔离
  - `observe.ts` — 原生报告事件与调用级模型归因
  - `identity.ts` — 从官方 Node 执行上下文提取请求身份（experienceAct 与透明 aiAct 共用）
- `integration/` — YAML aiAct 可关闭透明接入（默认关闭，只包装执行入口）
  - `config.ts` / `eligibility.ts` / `wrap.ts` — 开关、旁路矩阵、官方 Node 薄包装
- `index.ts` — 公共导出

字段说明见 [docs/experience-assets.md](../../docs/experience-assets.md)；Promotion 支持矩阵与取数契约见 [docs/experience-promotion.md](../../docs/experience-promotion.md)；Matcher 调用契约见 [docs/experience-matcher.md](../../docs/experience-matcher.md)；回放协议、ReplayResult 与支持矩阵见 [docs/experience-replay.md](../../docs/experience-replay.md)；Runtime 与 experienceAct 见 [docs/experience-runtime.md](../../docs/experience-runtime.md)；YAML aiAct 透明接入见 [docs/experience-transparent-ai-act.md](../../docs/experience-transparent-ai-act.md)。

Schema/Store 不访问设备或模型。Promotion 只在公开 Agent dump 边界取数。Matcher 只使用调用方提供的截图字节。Replay 只派发已定位像素的原生动作（`callActionInActionSpace` + `locatedPixelResult`），不调用 AI 定位、不重试、不更新资产状态。Runtime 决定选链、回退与学习，单次尝试最多一次原生 AI。
