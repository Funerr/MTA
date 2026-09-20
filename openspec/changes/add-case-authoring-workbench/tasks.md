## 1. 契约与基础入口

- [x] 1.1 核对现有 YAML/Node、纯校验、设备观测及停止契约，形成适配清单；以锁定 Midscene 依赖契约测试验证静态检查无 setup 副作用及停止状态的实际含义。（适配清单：docs/workbench-contracts.md；契约测试：tests/unit/workbench-static-pipeline-contract.test.ts、tests/unit/workbench-stop-semantics-contract.test.ts）
- [x] 1.2 选定轻量前端、YAML 文档编辑和文件解析依赖，新增独立本地启动入口；验证安装、构建及浏览器访问，不改变已有 CLI 命令行为。（前端 preact+htm、构建 esbuild、YAML `yaml`、Excel `exceljs`、Markdown `marked`；入口 `pnpm workbench`，脚本 `workbench:build`；已验证 curl 与浏览器访问，未改动既有命令）
- [x] 1.3 实现本地服务配置、工作区文件访问边界及模型密钥管理；验证跨工作区访问被拒绝且响应与普通日志不含密钥。（src/workbench/server/{config,workspace,model-config,log,routes}.ts；tests/unit/workbench-server.test.ts）

## 2. 编写文档与用例录入

- [x] 2.1 建立兼容现有转换交付约定的编写文档，包含稳定 ID、来源、平台变体、修订及确认记录；验证保存恢复及两个平台互不覆盖。（src/workbench/core/document.ts + document-store.ts + API 路由；tests/unit/workbench-document.test.ts）
- [x] 2.2 实现编号、名称、前置条件、步骤关联预期、等级和平台应用上下文表单；在浏览器验证无文件录入、增删步骤及缺失提示。（src/workbench/web/src/views/editor.ts + ui.ts；浏览器已验证：手工录入、步骤增删/排序、逐字段缺失提示、声明无前置条件、保存恢复往返）
- [x] 2.3 实现整段粘贴和 Markdown/文本导入；以跨段用例夹具验证来源对应、原文保留和未转换清单。（src/workbench/core/import/{text,markdown,apply}.ts + 导入 API/UI；夹具 tests/fixtures/workbench/{text-cross-segment.txt,markdown-cross-segment.md}；tests/unit/workbench-import.test.ts）
- [x] 2.4 实现 Excel 导入；以合并单元格、跨行、空白预期、重号和公式缓存缺失夹具验证无静默填充或用例丢失。（src/workbench/core/import/excel.ts；夹具由 tests/unit/workbench-excel-import.test.ts 用 ExcelJS 生成；跨行按编号列合并块组装，公式缓存缺失标记待澄清）

## 3. 模型生成与静态检查

- [x] 3.1 实现可配置模型调用和当前项目规则/Node 契约加载；验证真实模型生成结构化草稿，模型失败或取消保留已有文档。（src/workbench/core/model/client.ts + generate/{context,generate}.ts + server/tasks.ts；tests/unit/workbench-generate.test.ts；真实模型冒烟：mimo-v2.5 生成含 device.prepare/launch/aiAssert/terminate 的合法工作流并经结构契约校验，失败/取消路径单测覆盖且不改已存内容）
- [x] 3.2 实现平台 YAML 编译、来源覆盖及改写记录；验证精确预期不被放宽，未知包名和缺失业务数据明确列为问题。（src/workbench/core/generate/compile.ts：片段合并/全局覆盖索引/改写登记/精确预期防线；tests/unit/workbench-generate.test.ts 覆盖放宽拦截、blocking/能力缺口分类、非法片段与漏生成保留草稿）
- [x] 3.3 实现 YAML 解析、Node 输入、覆盖和证据路径分层检查；验证错误输入、未校验状态及不支持的前后比较不会进入就绪执行导出，且检查无设备/模型 I/O。（src/workbench/core/validation/static.ts 复用 collectWorkflowDocument + safeParseAsync；状态推进仅 unvalidated<->ready；tests/unit/workbench-static-checks.test.ts 七个场景）

## 4. 步骤视图与 YAML 编辑

- [x] 4.1 实现默认步骤卡片及原文/YAML 切换，支持业务步骤到多个节点的映射；通过支持子集的双向往返测试验证编辑和导出语义一致。（src/workbench/core/cards/mapping.ts：@step 锚点确定性投影、一对多分组、原始块；tests/unit/workbench-cards.test.ts 八个往返场景；UI 工作流编辑页签含卡片/YAML/原文三视图）
- [x] 4.2 实现保留注释和不支持结构的原始块编辑，以及无效 YAML 缓冲区；验证未知结构不丢失、语法错误提示未同步并阻止确认。（yaml Document 保注释回写；invalidYamlBuffer 不替换当前工作流并阻断检查/确认/导出；tests/unit/workbench-workflow-routes.test.ts）
- [x] 4.3 实现 AI 局部修改差异和基础版本冲突检测；验证迟到 AI 响应不覆盖人工编辑，用户可选择合并内容。

## 5. 双平台设备核查

- [x] 5.1 复用会话边界接入 Android/HarmonyOS 枚举、显式绑定与释放；验证不存在、多设备歧义、不可用设备均不静默切换。（src/workbench/core/devices/device-service.ts 复用 listAdbDevices/listHdcDevices/createXxxSession；绑定必须显式 ID；tests/unit/workbench-devices.test.ts 七场景）
- [x] 5.2 替换 `core/verify/runner.ts` 的自建派发、`goals.ts` 的字符串动作提取及 `server/verify-service.ts` 的直接 Agent 执行路径；将含明确目标、必要前置路径、目标动作和观测点的工作流提交 MTA 项目配置与 Runtime，由 Midscene Runner 执行。验证原节点/结构化输入/生命周期保留、目标动作先于断言、共享前置路径不重复执行；无法确定依赖时显示缺口，无预期时不伪造断言。（goals.ts 结构化切片保留原节点/生命周期，原始块/覆盖失效/待澄清一律返回缺口；src/setup/workflow-execution.ts 装配 createProjectRuntime + runWorkflowDocument；tests/unit/workbench-execution-contract.test.ts + workbench-verify-service.test.ts）
- [x] 5.3 将显式设备绑定接入 MTA 执行会话，避免工作台会话与框架会话重复占用设备；通过框架取消及释放契约实现任务互斥、停止中、人工接管、断连与重启中断状态。使用真实 Midscene Runner 与可控 Node 的契约测试验证停止后无新动作执行、在途结束前不宣称已释放，恢复先获取新画面，不自动重放未知结果动作。（device-service bind 仅选择校验不建会话，执行会话由框架 setup/teardown 持有，env 显式注入设备 ID；执行前先截取当前画面；停止经 AbortSignal 传播，在途调用结束后才 teardown；teardown 失败标记 unknown 不宣称可接管；tests/unit/workbench-execution-contract.test.ts 四场景 + workbench-verify-service.test.ts 互斥/停止/unknown/重启中断）
- [x] 5.4 实现证据与步骤、平台、设备、时间和版本的关联及失效传播；验证修改上游动作会使相关下游证据待复核，另一平台不会继承按状态。（evidence.ts 按动作快照/工作流修订/业务修订/预期存在性计算待复核；证据绑定平台+设备+时间+框架报告引用；tests/unit/workbench-verify.test.ts 证据失效两场景）
- [x] 5.5 实现设备截图、当前目标、进度及证据侧栏；浏览器验证不足证据明确显示缺口，关键点完成不会改变完整执行未运行状态。（verification-panel.ts：三状态独立显示（静态检查/关键点核查/完整执行：未运行）、当前目标与截图、逐条证据及缺口、绑定/接管提示；浏览器验证含显式绑定不存在的设备的定位错误展示）

## 6. 确认与导出

- [x] 6.1 实现当前修订确认、不可变快照及修改后重新待确认；验证并发编辑不能使用旧确认导出新内容。
- [x] 6.2 实现平台区分的 YAML、草稿和转换记录交付；验证部分导出明确排除项，无就绪内容不生成空执行文件，默认不写入 cases 或自动运行测试。

## 7. 集成验证与文档

- [x] 7.1 完成从手工录入/文件导入到生成、卡片编辑、YAML 修改、确认导出的浏览器集成验证；核对每个源预期的覆盖及人工修改保留。（浏览器端到端：粘贴导入→真实模型生成→精确预期防线→解决待澄清→四层检查→确认快照→导出 ready 1/excluded 0；生成冲突经待合并差异合并，人工修改保留；记录见 docs/workbench-acceptance.md）
- [ ] 7.2 在真实 Android 设备和真实模型上验证关键页面核查、停止接管与证据关联；记录日期、设备、应用、模型和实际覆盖，缺少环境时保留未完成状态。
- [ ] 7.3 在真实 HarmonyOS 设备和真实模型上完成同等验证；单独记录证据，不以 Android 结果或替身测试代替。
- [x] 7.4 运行项目类型检查、相关单元/契约测试及 Web 构建，修复失败并保存结果；增加工作台提交 → MTA 项目 setup/Node 注册 → Midscene Runner → teardown/报告的集成契约验证，核对同一工作流在工作台与既有 CLI 入口下的执行语义一致。直接 Agent 替身测试不得替代此项验证。（tsc 无错误；单元 339 + 集成 61 全部通过；workbench:build 通过；midscene-test nodes CLI 正常；集成契约为 tests/unit/workbench-execution-contract.test.ts（真实 Runner + 可控 Node + 注入 loadProject），同一 NodeRegistry/resolveNode 语义与 CLI collect 一致；真实设备执行一致性依赖 7.2 环境，已记录未完成）
- [x] 7.5 更新 README 使用入口、架构能力说明和路线图，追加带日期的验收记录及标明身份的 examples；核对相对链接、显式设备绑定和能力声明与已实现配置一致。（README 新增「用例编写工作台」段；ARCHITECTURE 与 roadmap 更新 Case Authoring 现状；docs/workbench-acceptance.md（2026-09-18，含未完成项）并登记 acceptance-index；examples/workbench/ 标明“生成示例、未真实执行”；contracts 文档同步新执行边界）
