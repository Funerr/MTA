# 视觉断言离线评估（隔离实验）

独立研究入口，评估有限视觉断言（二态控件 / 明确文本）能否用历史截图证据得到 `supported` / `contradicted` / `unknown`。**不注册生产 Node、不修改原生 `aiAssert`、不写入动作经验 Store。**

## 目录

- `fixtures/`：冻结样本、协议、PNG 证据
- `outputs/`：校准结果、两次验证结果、go/no-go 报告
- 评估代码只读取声明的 PNG，不驱动设备、不调用 VLM

## 复现

```bash
pnpm exec vitest run tests/unit/experience-visual-assert.test.ts
```

预设 go 条件见 `fixtures/protocol.json`：冻结验证集误通过 = 0、每类覆盖率 ≥ 80%、开放语义全部 unknown、无数据/执行错误。不满足则为 no-go；no-go 也是完整研究结论。
