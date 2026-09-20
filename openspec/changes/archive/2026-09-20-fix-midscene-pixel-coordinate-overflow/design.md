## Context

定位链路现状（`@midscene/core@1.12.7`，单一实例，`@midscene/test` 与 `@midscene/android` 均在运行时外部 require，无预打包内嵌）：

- `dist/lib/ai-model/model-adapter/locate.js`：未声明 locate 协议的 family 使用默认 `defaultLocateResultFormatDefinition = { coordinates: { shape: 'bbox', order: 'xy', normalizedBy: 1000 } }`。`xiaomi-mimo` 适配器只定制 chat 参数，未声明 locate 协议（对比：`kimi` 为 `normalizedBy: 1` point，`gpt-5/gpt-6` 为无 `normalizedBy` 的像素 bbox，见 `models/registry.d.ts`）。
- `dist/lib/ai-model/shared/model-locate-result/factory.js`：`createLocateResultCodec(config).toPixelResult(rawResult, ctx)` 的执行顺序为 parse → `assertLocateResultStructure` → `assertLocateResultCoordinateRangeAndOrder` → 像素映射。
- `dist/lib/ai-model/shared/model-locate-result/validation.js`：`normalizedBy` 存在时范围上限恒为 `[0, normalizedBy]`（与图像尺寸无关），越界即 throw；bbox 顺序颠倒同样 throw。
- 重试：`dist/lib/ai-model/workflows/grounding/locate.js` 经 `callAiAndParseWithRetry`（`parseRetryTimes = modelRuntime.config.retryCount`）把校验失败作为解析错误反馈给模型重试，耗尽后失败。
- 扩展点不存在公开入口：`LocateOperationDefinition.resultFormat`（含 `parseRawLocateValue` 自定义解析器）是官方扩展点，但它挂在 `ModelAdapterDefinition.locate` 上，而 `MODEL_ADAPTER_CONFIGS` 是 registry 内部静态表，未从包公开入口导出，也没有注册/覆盖 API；适配器按 family 缓存（`modelAdapterCache`）。

约束：AGENTS.md 禁止散落的 Midscene 内部契约访问，要求"若现有入口不足，先在相应适配边界封装，并以锁定依赖的契约测试验证"；Experience 范围冻结允许缺陷修复与契约收口。

## Goals / Non-Goals

**Goals**

- 在不改 validation 职责（只校验、不修数据）的前提下，修复"声明归一化协议 + 模型返回像素坐标"的显性失败路径，且修复不引入新的静默点错。
- 补丁集中、可审查、随依赖升级显式失效（而非静默失配）。
- 用契约测试把补丁行为与升级风险锁住。

**Non-Goals**

- 不做坐标系 auto 判定的通用承诺：完全落在 `[0, 1000]` 内的像素坐标与归一化坐标在数学上不可判定，本补丁明确不解决该情形，并将其文档化为局限。
- 不在本 change 中实现 `coordinateMode` 显式声明（后续独立 change `support-model-coordinate-mode`）。
- 不改 YAML、Node、Experience、设备层的任何行为面；不向上游提交 PR（可另行推进）。

## Decisions

### D1. 补丁投递机制：pnpm patch，而非运行时改写或深路径导入

- 运行时改写不可行：`MODEL_ADAPTER_CONFIGS` 未从 `@midscene/core` 公开入口导出，改写需深路径导入 `dist/lib/ai-model/models/registry.js`，违反治理约束且随打包方式漂移。
- `pnpm patch`（package.json `pnpm.patchedDependencies` + `patches/`）是包管理器正式机制：集中声明、diff 可审查、锁定版本生效、依赖图内 `@midscene/core` 单实例（`.pnpm` 仅一份）保证全链路生效。
- 代价：上游升级时补丁需重评。缓解：契约测试在补丁失效时失败（见 D5）；补丁文件头注释写明针对的版本与上游对应源码位置，便于日后向上游贡献或废弃。

### D2. 插入点：codec `toPixelResult` 内，parse 之后、两个 assert 之前

`toPixelResult` 是所有 standard locate（element 与 searchArea 共用该工厂）的唯一汇聚点，与设计草图一致：

```
parseRawLocateValue(rawResult)
→ normalizeUnexpectedPixelCoordinates(result, preparedSize.width, preparedSize.height)   ← 仅新增此层
→ assertLocateResultStructure(result)
→ assertLocateResultCoordinateRangeAndOrder(result, width-1, height-1)
→ pixel mapper
```

validation 保持原样；补丁层只负责把"声明协议下不可能成立"的结果重写为协议内表达，几何含义不变。

### D3. 触发条件与容差带（对源草图的收紧）

源草图的触发条件是 `some(v > normalizedBy)`，存在误触发情形：归一化协议下轻微越界的合法倾向值（如 `y=1005`，同时 `1005 ≤ 1080 + 10% 容差`）会被误判为像素坐标并重缩放（`1005 → 约 930`），把本应走重试的显性失败变成静默几何畸变。因此：

1. 触发阈值收紧为 `some(v > normalizedBy * (1 + TOLERANCE))`，`TOLERANCE = 0.02`（2%）。轻微越界（歧义带内）不重写，保持校验失败与语义重试——"明确失败优于静默点错"。
2. 触发后仍需全部值（含 `max(width, height) * 0.01` 容差）落在按 `shape`/`order` 解析的各轴像素范围内，否则原样返回交给 validation 失败。
3. 重缩放前先 clamp 到各轴像素边界（如 `2170 → 2160`），保证结果表示合法像素区域。
4. `normalizedBy` 未声明（像素协议）时直接返回；`shape`（point/bbox）与 `order`（xy/yx）决定像素上限向量。

该层只可能对"在声明协议下已被判定非法"的结果生效，因此对任何 family（含默认 OpenAI 兼容协议）都是语义保守的，无需按 family 收窄。

### D4. 双副本同步与补丁形态

`@midscene/core` 同时携带 `dist/lib`（CJS）与 `dist/es`（ESM），Node 按入口条件解析，两份必须同步修改。补丁仅触碰 `dist/{lib,es}/ai-model/shared/model-locate-result/factory.js(mjs)` 一个模块；兼容函数内联在该模块内，不新增文件，减小补丁 diff 与升级冲突面。

### D5. 契约测试锁定（MTA 侧）

新增 `tests/unit/midscene-locate-coordinate-contract.test.ts`。核实事实：`createLocateResultCodec` 未从 `@midscene/core` 任何公开入口（root、`./ai-model` 子路径）导出，且包的 `exports` 字段不含通配符、禁止深路径 specifier——因此测试以文件路径直接加载补丁后的两份 factory 模块（`dist/lib` 走 `createRequire`，`dist/es` 走动态 import），并对两副本做同构行为断言（双副本同步由此测试锁定）。深路径文件加载仅存在于该锁定依赖契约测试中，属于 AGENTS.md 认可的"针对锁定依赖的契约验证"，不构成业务代码的散落契约访问。按规格场景断言：

- 横屏 2160×1080 bbox `[0, 170, 2170, 1080]` → 归一化重缩放后映射区域约 `[0, 184, 2160, 1080]`（比例断言，不锁定舍入常量）。
- 歧义带内（如 `y=1005`）→ `toPixelResult` throw，不重写。
- 合法归一化 bbox → 中心/矩形与未打补丁语义一致（回归保护）。
- 无 `normalizedBy` 协议 → 原样放行。
- point 形状与 yx order 的逐轴上限正确性。

测试不要求设备与模型密钥，纳入现有 `vitest run`。`.map` 文件与补丁一致性不做断言（source map 不参与运行语义）。

## Risks / Trade-offs

- 歧义带内的像素坐标（如竖屏底部元素 `y≈1005..1019` 像素值）仍会走重试路径 → 接受：显性失败可由重试或上游 coordinateMode 根治，静默点错不可接受。
- 补丁随上游升级失效 → 契约测试显式暴露；升级检查清单加入"若失败，按 D3 重评补丁或转向 `support-model-coordinate-mode`"。
- 2% 容差带是经验值，不是协议承诺 → 在补丁注释与 README 中写明依据（模型轻微越界的常见幅度与误重缩放的几何畸变量级的权衡），后续可依证据调整。

## Migration

无需数据或配置迁移；安装依赖时 pnpm 自动应用补丁。回滚 = 移除 `pnpm.patchedDependencies` 与 `patches/`，行为回到现状（显性失败 + 隐性点错风险）。

## 后续方向（不在本 change 内）

`support-model-coordinate-mode`：在适配边界显式声明所用模型的 coordinateMode（pixel/normalized），消除运行时猜测。前置条件：对所用模型实际坐标协议的受控验证证据（真实运行的 dump/报告坐标样本统计）。本 change 的 tasks 包含收集该证据的步骤，但不阻塞补丁交付。
