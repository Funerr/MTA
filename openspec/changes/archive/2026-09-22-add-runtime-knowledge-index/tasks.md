# Tasks: add-runtime-knowledge-index

## 1. 知识加载与配置基础件

- [x] 1.1 新建 `src/knowledge/config.ts`：`KNOWLEDGE_INDEX_ENABLED` 开关解析（缺省/空/无法识别均为关闭，语义对齐 experience 的 `parseExperienceEnabled`）与 `KNOWLEDGE_INDEX_ROOT` 根目录解析（缺省项目根 `knowledge/`）；单测覆盖各取值分支，通过 `pnpm test`
- [x] 1.2 新建 `src/knowledge/types.ts` 与 `src/knowledge/loader.ts`：`index.yaml` 解析与校验（id 唯一、triggers 非空、file 存在、resolve 后路径仍在 knowledge 根内）、正文按条目懒读取 + 进程内缓存、索引首次加载后缓存；错误信息含条目 id 与原因；`knowledge/` 目录不存在视为未配置；单测覆盖合法索引、索引不可解析、正文缺失、路径越界、目录缺失全部分支，通过 `pnpm test`

## 2. aiAct 注入包装层

- [x] 2.1 新建 `src/knowledge/wrap.ts`：`wrapNodesWithKnowledge` 仅替换 `aiAct` 执行入口，关闭时返回原始节点定义（不读 knowledge 目录、不实例化加载器）；执行时对 instruction 做触发词子串匹配，命中按索引顺序以 `[knowledge:<id>]` 标记追加正文后委托原 execute，未命中原样透传；官方校验失败、执行失败与取消如实传播；用 stub 节点定义的单测覆盖透传、单命中、多命中顺序与去重、重复命中走缓存、错误传播，通过 `pnpm test`

## 3. 挂载与能力叠加

- [x] 3.1 `midscene.config.ts`：android / harmony 项目按 `wrapMidsceneNodesWithExperience(wrapNodesWithKnowledge(createMidsceneNodes(...)))` 组装（knowledge 内层、experience 外层，见 design D2）；单测断言关闭时节点定义与官方完全一致、开启时 aiAct 为包装后定义，通过 `pnpm test`
- [x] 3.2 `src/nodes/multi-device.ts`：对内部 `createMidsceneNodes` 结果先知识包装再 `aliasNativeNodes` 换名；单测验证 `DUT1.aiAct` 等别名节点命中触发词时注入生效，与单设备项目行为一致，通过 `pnpm test`
- [x] 3.3 叠加组合测试：knowledge 与 experience 开关四种组合下，用框架夹具/stub 验证两能力各自既有行为不变（经验匹配键基于原始 instruction、重放路径不注入、原生回退必得注入），通过 `pnpm test`

## 4. 示例知识与文档

- [x] 4.1 新建 `knowledge/index.yaml` 与 `knowledge/entries/` 演示条目（含"控制中心下拉手势"示例，正文标注演示身份、不宣称业务验收；README 说明目录约定与触发词维护指引）
- [x] 4.2 更新 `ARCHITECTURE.md`（Runtime 范围补知识注入能力说明）、`README.md`（能力与使用入口、默认关闭）、`AGENTS.md`（记录范围决策：knowledge 注入为 Experience 冻结范围之外的独立 Runtime 能力，2026-09-22 用户授权）；核对文档相对链接与能力声明一致，仅文档改动时检查差异即可

## 5. 整体验证

- [x] 5.1 运行 `pnpm typecheck` 与全量 `pnpm test` 通过；确认默认关闭状态下既有测试零行为变化（无新增失败）；在验收记录中追加带日期、环境与覆盖范围的条目（框架夹具级，不要求真实设备业务报告）
