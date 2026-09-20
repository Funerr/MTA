## 1. 补丁实施

- [x] 1.1 初始化 pnpm patch：`pnpm patch @midscene/core@1.12.7`，登记 `patchedDependencies`（pnpm 10 自动登记在 `pnpm-workspace.yaml`，非 `package.json`），确认补丁作用于 `.pnpm` 单实例
- [x] 1.2 在 `dist/lib/ai-model/shared/model-locate-result/factory.js` 的 `toPixelResult` 内、parse 之后与两个 assert 之前插入 `normalizeUnexpectedPixelCoordinates`（按 design.md D3：触发阈值 `normalizedBy * 1.02`、全部值含 1% 像素容差才触发、clamp 后按轴重缩放、`normalizedBy` 未声明直接返回、支持 point/bbox 与 xy/yx）
- [x] 1.3 在 `dist/es/ai-model/shared/model-locate-result/factory.mjs` 同步相同逻辑，补丁文件头注释写明针对版本、上游源码位置与容差带依据
- [x] 1.4 `pnpm patch-commit` 落盘 `patches/`，重装依赖确认补丁自动应用且 `@midscene/core` 其余文件无差异

## 2. 契约测试

- [x] 2.1 新增 `tests/unit/midscene-locate-coordinate-contract.test.ts`，覆盖规格全部场景：横屏越界 bbox 归一化与映射、歧义带内 throw 不重写、合法归一化零影响（回归保护）、像素协议原样放行、point/yx 逐轴上限；`createLocateResultCodec` 未公开导出，按 design.md D5 以文件路径加载 dist/lib 与 dist/es 双副本并做同构断言
- [x] 2.2 测试不依赖设备与模型密钥，纳入默认 `vitest run`；断言采用锁定依赖确定性映射的精确值（rect 为闭区间 `right-left+1` 语义），确保升级漂移即失败

## 3. 工程检查与文档

- [x] 3.1 `pnpm typecheck` 与 `pnpm test` 全绿
- [x] 3.2 README 登记锁定依赖补丁：位置、针对版本、升级时按契约测试重评的注意事项；不改能力宣称与验收结论
- [x] 3.3 核对治理一致性：补丁不新增散落契约访问（仅 codec 单模块）、不改 YAML/Node/Experience 行为面、文档相对链接有效

## 4. 后续 change 输入（不阻塞交付）

- [x] 4.1 收集既有 `midscene_run` 报告/dump 中的定位坐标样本并统计坐标协议证据，产出 [evidence-coordinate-samples.md](evidence-coordinate-samples.md)（42 样本全部 ≤1000、无越界先例；横屏场景的后续真实运行收集移交 `support-model-coordinate-mode`，方法与判定标准已在笔记中写明）
