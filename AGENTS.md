# 工程治理约束

修改 Runtime、Node、平台接入或 Experience 前，先阅读 [ARCHITECTURE.md](ARCHITECTURE.md) 的职责划分与现有契约入口。

- 复用 Midscene Runner、Agent、Planner 和报告；禁止自研 Runner，禁止复制 Midscene Planner。已有 Replay 仅重放经当前画面验证的已定位动作，不扩展为规划器。
- 新 Node 只允许 Runtime 基础能力（会话、设备协作、执行控制、通用观测等）。必须说明可复用的运行职责；禁止把业务知识、应用流程、领域断言或业务恢复策略写入 Node。业务语义放在使用方 Case 中。
- 当前 Midscene YAML 是 Expert Mode / Execution Workflow；禁止把它当最终用户模型或以扩展 Node 的方式替代高层 Case Authoring。
- Experience 范围冻结在已有 Schema/Store/Promotion/Matcher/Replay/Runtime/Integration。先验证现有闭环；允许缺陷修复、契约收口和验证，暂停新增 Memory、Skill、通用 Recovery 等大能力。解除冻结须由用户明确调整范围。
- 运行时知识注入（`src/knowledge/`，默认关闭）是经用户 2026-09-22 授权的独立 Runtime 能力，不属于 Experience 冻结范围；包装层只做通用索引匹配与 instruction 注入，业务知识只存在于项目 `knowledge/` 数据文件，不得写入 Node、包装层或 Experience。
- 禁止新增散落的 Midscene 内部契约访问，包括 dump 结构、报告结构和 executionId 关联。复用架构文档列出的适配入口；新增契约先在适配边界封装并补充针对锁定依赖的契约验证，不复制到调用点。
- `src/setup/ + src/nodes/ + src/experience/` 共同承担 Runtime capabilities；本轮治理不移动源码目录。
- 新增演示 YAML 放 `examples/`，框架夹具放 `tests/fixtures/`；保留在 `cases/` 的既有示例必须有文件头标识并登记在 `cases/README.md`，不得宣称为已通过的业务验收。
- 新文档和示例推荐 `DUT1/DUT2/DUT3`，配套声明显式设备绑定；底层 alias 保持任意合法名称，不因文档命名约定修改兼容默认值。
- README 维护当前能力与使用入口；Roadmap 只维护未来工作；Acceptance 只保存带日期、环境和覆盖范围的阶段证据。不要把历史测试数改成当前统计；新验证追加独立记录。

完成治理类修改前，核对文档相对链接、示例身份及能力声明与当前配置一致。仅修改文档和注释时检查差异即可；涉及执行行为时运行相应工程检查与测试。
