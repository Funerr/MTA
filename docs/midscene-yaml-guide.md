# Midscene YAML 编写规范与能力参考

当前 YAML 是 Expert Mode / Execution Workflow，不是最终用户模型。未来更高层 Case Authoring 的方向见 [Roadmap](../openspec/roadmap.md)，架构边界见 [ARCHITECTURE](../ARCHITECTURE.md)。

本文档整理编写 YAML 所需的全部能力输入：

1. **参数语法糖** — 工作流结构、步骤写法、字符串简写、`$` 元数据、`prompt` 富对象与 `options`；
2. **自定义 Node 能力** — MTA Runtime 提供的生命周期、经验动作、多设备协作等 Node 的语义与边界；
3. **Node 清单** — 按执行项目（android / harmony / multi-device）列出全部可用 Node 及其参数。

[case-to-yaml Skill](../.agents/skills/case-to-yaml/SKILL.md) 与[用例编写工作台](../README.md#用例编写工作台)在生成 YAML 时以本文档为语法与能力依据；逐 Node 的完整 JSON Schema 以 `midscene-node-reference.<project>.md` 为准。

**刷新机制**：「Node 清单」章节各表位于 `generated:node-inventory` 标记之间，由 `pnpm run nodes`（依赖安装后自动执行）依据真实注册表生成的参考文档重建，**勿手改**。修改 `src/nodes/`、`midscene.config.ts` 或升级 `@midscene/*` 依赖后，必须重跑 `pnpm run nodes` 刷新清单；该命令不连接设备。手写章节（语法糖与自定义 Node 语义）随 Node 行为变更同步修改，单元测试会校验生成区块与参考文档一致、自定义 Node 均被清单覆盖。

本文档适用于本仓库的 android / harmony 单设备项目，以及 `multi-device` 协作项目中带设备前缀的步骤。协作项目的配置与验收见 [multi-device-yaml-workflows.md](multi-device-yaml-workflows.md)。官方多项目并发（`test.maxConcurrency`）不能表达同一用例内的多设备交接。

---

## 1. 文档结构

一个 YAML 工作流文件的顶层结构如下：

```yaml
beforeAll:    # 可选 — 所有用例执行前运行一次
  - <step>
beforeEach:   # 可选 — 每个用例执行前运行
  - <step>
cases:        # 必填 — 测试用例列表
  - name: "用例名称"
    steps:
      - <step>
afterEach:    # 可选 — 每个用例执行后运行
  - <step>
afterAll:     # 可选 — 所有用例执行后运行一次
  - <step>
```

唯一必填的顶层 key 是 `cases`。生命周期钩子（`beforeAll`/`beforeEach`/`afterEach`/`afterAll`）使用与 case steps 相同的格式。

**交付约定**：`case-to-yaml` Skill 与工作台导出的**可执行工作流必须提供 `beforeEach` 与 `afterEach`**——单设备项目为 `device.prepare: { target: home }` 与 `device.recover: {}`，协作项目对每个已绑定别名逐台写 `<alias>.device.prepare` / `<alias>.device.recover`；用例 `steps` 内不再重复成对的准备/恢复步骤。YAML 格式本身不强制钩子（引擎按可选处理），该约定约束的是本仓库交付与导出的工作流。

---

## 2. Case 定义

```yaml
cases:
  - name: 用例名称          # 必填，非空字符串
    tags: [smoke, settings] # 可选，字符串数组，用于过滤
    steps:                  # 必填，非空数组
      - <step>
```

---

## 3. Step 语法糖

每个 step 是一个**单 key 的映射**，key 是 node 名称，value 是 node 的输入。

### 3.1 对象形式（完整写法）

```yaml
- aiAssert:
    prompt: 当前在主屏幕
```

### 3.2 字符串简写

支持简写的 node 可以直接写字符串，等价于把字符串映射到该 node 的 `stringInputKey` 字段：

```yaml
# 以下两种写法等价：
- aiAssert: "当前在主屏幕"
- aiAssert:
    prompt: 当前在主屏幕
```

每个 Node 是否支持简写、简写映射到哪个字段，见「Node 清单」各表的「字符串简写」列。

### 3.3 无参数 node

没有输入的 node 使用空对象：

```yaml
- home: {}
- back: {}
- device.recover: {}
```

### 3.4 步骤级元数据（`$` key）

在 step 输入对象内部，`$` 是保留 key，用于引擎级配置，不会传给 node：

```yaml
- aiAct:
    prompt: 可能超时的操作
    $:
      timeout: 30000           # 覆盖默认超时（毫秒），正数
      continue-on-error: true  # 失败不中断流程，默认 false
```

`device.parallel` 的子步骤不允许写 `$`（见 6.2）；其余 Node 的超时与取消均通过父步骤的 `$` 控制。

---

## 4. prompt 参数详解

AI 相关 node（aiAct/aiAssert/aiTap/aiAsk 等）的 `prompt` 支持两种形式：

### 4.1 字符串形式

```yaml
- aiAssert: "当前打开了设置应用"
```

### 4.2 富对象形式（带参考图片）

```yaml
- aiTap:
    prompt: 点击类似这个图标的按钮
    images:
      - name: target-icon
        url: https://example.com/icon.png
    convertHttpImage2Base64: true  # 可选，将 HTTP 图片转为 base64
```

---

## 5. options 参数详解

AI 相关 node 的 `options` 是可选的通用配置：

| 参数 | 类型 | 说明 |
|------|------|------|
| `context` | string | 附加上下文信息，帮助 AI 理解场景 |
| `domIncluded` | boolean \| `"visible-only"` | 是否将 DOM 树传给 AI |
| `screenshotIncluded` | boolean | 是否将截图传给 AI |

特定 node 的额外 options：

**aiAct / aiTap**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `cacheable` | boolean | 缓存相同 prompt 的 AI 响应 |
| `deepThink` | boolean \| `"unset"` | 深度思考模式（复杂任务） |
| `deepLocate` | boolean | 深度定位（更精确的元素查找） |
| `fileChooserAccept` | string \| string[] | 文件选择器的类型过滤 |
| `fileChooserAllowedDir` | string | 文件选择器的允许目录 |

**aiTap 额外**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `xpath` | string | XPath 提示，辅助元素定位 |

**aiAssert 额外**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `message` | string | 断言失败时的自定义错误信息 |
| `keepRawResponse` | boolean | 保留 AI 原始响应 |

---

## 6. 多设备协作语法糖

`multi-device` 执行项目在同一个用例内绑定多台 Android / HarmonyOS 设备。完整配置、报告边界与验收见 [multi-device-yaml-workflows.md](multi-device-yaml-workflows.md)。

### 6.1 别名前缀

协作项目没有"当前设备"。顺序步骤写成 `<alias>.<native-node>`，`<alias>` 来自 `.env` 中 `MULTI_DEVICE_BINDINGS` 声明的绑定（文档推荐 `DUT1/DUT2/DUT3`）：

```yaml
- DUT1.device.prepare: { target: home }
- DUT1.aiAct: 在设备一上执行操作
- DUT2.aiAssert: 设备二显示了预期结果
```

- `wait` 仍是全局 Node，**不加**设备前缀。
- `device.prepare` / `device.recover` 必须带别名。
- 未声明别名、或该别名平台没有的 Node（例如给 Harmony 别名写 `runAdbShell`）在收集/派发前失败，不会改派到其他设备。

### 6.2 device.parallel（并行步骤）

```yaml
- device.parallel:
    steps:
      - DUT1.aiAssert: 设备一处于预期状态
      - DUT2.aiAssert: 设备二处于预期状态
    $:
      timeout: 30000
```

- `steps` 至少两项，各指向**不同**已绑定设备上的一个别名化原生 Node。
- 不能嵌套 `device.parallel`；子步骤不能写 `$`，超时由父步骤的 `$` 统一控制。
- 并行组在报告中是一个父步骤，子调用结果（状态、错误、executionIds）汇合在父步骤输出；某个子调用成功不代表整组成功。

---

## 7. 自定义 Node 能力（MTA Runtime）

以下 Node 由 MTA Runtime（`src/nodes/`）提供，是对 Midscene 原生 Node 的补充；业务语义仍留在 Case 中。可用项目与参数见「Node 清单」生成区块。

### 7.1 `device.prepare` / `device.recover`（设备生命周期）

- `device.prepare`：准备当前绑定设备，唯一目标是返回该平台主屏（`target: home`）。仅是原生导航基线：不解锁设备、不重置网络、不准备业务初始状态。
- `device.recover`：恢复当前绑定设备回到主屏，保留系统设置与业务状态；可在准备或用例步骤部分完成后调用。
- 两者在协作项目中必须带别名（`<alias>.device.prepare` / `<alias>.device.recover`）；不带别名直接调用会报错提示改用别名形式。
- 严格输入：`device.prepare` 仅接受 `{ target: home }`，`device.recover` 仅接受 `{}`。

### 7.2 `device.waitUntil`（显式等待）

常见自动化测试中的显式等待：**轮询判定**当前绑定设备界面上的自然语言条件，满足即继续、超时即失败。用于等待预期最终出现的界面状态（页面跳转、异步加载、弹窗出现），替代按最坏情况预估的固定 `wait`，缩短用例耗时。

```yaml
- device.waitUntil: 设置应用已打开                    # 字符串简写
- device.waitUntil:
    prompt: 搜索结果列表加载完成
    timeoutMs: 8000     # 可选，等待总预算（毫秒），默认 10000；超时即失败
    intervalMs: 300     # 可选，轮询间隔（毫秒），默认 500；必须小于 timeoutMs
```

- 判定与 `aiAssert` 同源（结构化视觉判定，判定不通过不报错、继续轮询）。模型/网络等临时错误同样在预算内随轮询重试；持续失败时最终在超时错误中携带最后一次的真实原因（含模型错误信息），不会被吞掉。
- 超时失败传播，错误携带最后一次判定原因；不能用显式等待把本应失败的断言无限拖成通过。
- 步骤级 `$` 的 `timeout` 与节点 `timeoutMs` 同时设置时取更小者作为截止时间。
- 条件应是**预期会满足**的界面状态；最终业务结果一般仍用 `aiAssert` 单断言表达——条件本身就是验收点时，可用一条 `device.waitUntil` 兼作等待与判定。
- 协作项目写 `<alias>.device.waitUntil`（不加前缀直接调用会报错）；不能进入 `device.parallel` 并行组，只能作为顺序步骤。

### 7.3 `experienceAct`（实验性经验动作）

- 对使用方登记的可重复纯动作目标尝试视觉重放；未登记、含判断或经验资产不可用时，回退**一次**原生 `aiAct`。
- 不覆盖原生 `aiAct` / `aiAssert`；超时与取消通过步骤 `$` 控制。
- 严格输入：仅接受非空 `prompt`，不接受 `instruction` / `images` 等未声明字段。
- multi-device 协作项目首期不接入，直接调用会报错；请对目标设备使用 `<alias>.aiAct`。

### 7.4 `device.parallel`（跨设备并行）

语义与语法糖见 6.2。它只委托别名化**原生** Node；生命周期与显式等待 Node（`<alias>.device.prepare` / `recover` / `waitUntil`）与 `wait` 只能作为顺序步骤，不能进入并行组。

### 7.5 别名化原生 Node（multi-device）

协作项目为每个已绑定别名注册一套带前缀的原生 Node（`<alias>.aiAct`、`<alias>.launch`、`<alias>.runAdbShell` / `<alias>.runHdcShell` 等）。参数、字符串简写与错误契约和对应平台的原生 Node 完全一致，仅目标设备不同；同一设备上的步骤派发互不重叠。

### 7.6 透明 `aiAct` 经验包装（默认关闭）

`experience.enabled` 开启时，单设备项目的 `aiAct` 执行入口被经验 Runtime 包装：登记过的纯动作目标优先视觉重放，未登记或不可用时走原生 `aiAct`。**YAML 语法与参数完全不变**；默认关闭时行为与原生一致。配置与验收见 [experience-transparent-ai-act.md](experience-transparent-ai-act.md)。

---

## 8. Node 清单（按执行项目）

下列各表由 `pnpm run nodes` 依据真实注册表生成的 `midscene-node-reference.<project>.md` 自动重建，标记之间勿手改；逐 Node 完整 JSON Schema 见对应参考文档。所有 Node 输入均为**严格对象**：传入未声明字段会校验失败。

### 8.1 android 执行项目

<!-- generated:node-inventory:android:start -->

| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |
| --- | --- | --- | --- | --- |
| `aiAct` | Perform a natural-language task with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiAssert` | Assert a natural-language condition with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | message: string；options: object（字段见 options 详解） | `prompt` |
| `aiAsk` | Run aiAsk with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiBoolean` | Run aiBoolean with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiNumber` | Run aiNumber with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiString` | Run aiString with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiTap` | Locate and tap an element with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `back` | Trigger the Android system back operation. | 无（写 `{}`） | — | 不支持 |
| `device.prepare` | 准备当前绑定设备：返回当前平台主屏（Home）。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。 | target: "home" | — | 不支持 |
| `device.recover` | 恢复当前绑定设备：返回当前平台主屏（Home）。保留系统设置与业务状态；可在准备或用例步骤部分完成后调用。 | 无（写 `{}`） | — | 不支持 |
| `device.waitUntil` | 显式等待：轮询判定当前绑定设备界面上的自然语言条件，满足即继续，超时失败。用于等待预期最终出现的界面状态，替代按最坏情况预估的固定 wait，缩短用例耗时。 | prompt: string | intervalMs: integer，默认 500；timeoutMs: integer，默认 10000 | `prompt` |
| `experienceAct` | 实验性经验动作：仅对使用方登记的可重复纯动作目标尝试视觉重放；未登记、含判断或资产不可用时回退一次原生 aiAct。不覆盖原生 aiAct/aiAssert。 | prompt: string | — | `prompt` |
| `home` | Trigger the Android system home operation. | 无（写 `{}`） | — | 不支持 |
| `launch` | Launch an application through the current Android Agent. | uri: string | — | `uri` |
| `recentApps` | Trigger the Android system recent apps operation. | 无（写 `{}`） | — | 不支持 |
| `recordToReport` | Add text or screenshots to the current Midscene report. | — | options: object（字段见 options 详解）；title: string | `title` |
| `runAdbShell` | Execute a shell command through the current Android Agent. Pass only the shell command, without the adb shell prefix. | command: string | options: object（字段见 options 详解） | `command` |
| `terminate` | Terminate an application through the current Android Agent. | uri: string | — | `uri` |
| `wait` | Wait for a fixed duration while honoring cancellation. | duration: number | unit: "ms"\|"s"\|"min"，默认 "ms" | 不支持 |

<!-- generated:node-inventory:android:end -->

### 8.2 harmony 执行项目

<!-- generated:node-inventory:harmony:start -->

| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |
| --- | --- | --- | --- | --- |
| `aiAct` | Perform a natural-language task with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiAssert` | Assert a natural-language condition with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | message: string；options: object（字段见 options 详解） | `prompt` |
| `aiAsk` | Run aiAsk with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiBoolean` | Run aiBoolean with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiNumber` | Run aiNumber with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiString` | Run aiString with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `aiTap` | Locate and tap an element with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `back` | Trigger the Harmony system back operation. | 无（写 `{}`） | — | 不支持 |
| `device.prepare` | 准备当前绑定设备：返回当前平台主屏（Home）。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。 | target: "home" | — | 不支持 |
| `device.recover` | 恢复当前绑定设备：返回当前平台主屏（Home）。保留系统设置与业务状态；可在准备或用例步骤部分完成后调用。 | 无（写 `{}`） | — | 不支持 |
| `device.waitUntil` | 显式等待：轮询判定当前绑定设备界面上的自然语言条件，满足即继续，超时失败。用于等待预期最终出现的界面状态，替代按最坏情况预估的固定 wait，缩短用例耗时。 | prompt: string | intervalMs: integer，默认 500；timeoutMs: integer，默认 10000 | `prompt` |
| `experienceAct` | 实验性经验动作：仅对使用方登记的可重复纯动作目标尝试视觉重放；未登记、含判断或资产不可用时回退一次原生 aiAct。不覆盖原生 aiAct/aiAssert。 | prompt: string | — | `prompt` |
| `home` | Trigger the Harmony system home operation. | 无（写 `{}`） | — | 不支持 |
| `launch` | Launch an application through the current Harmony Agent. | uri: string | — | `uri` |
| `recentApps` | Trigger the Harmony system recent apps operation. | 无（写 `{}`） | — | 不支持 |
| `recordToReport` | Add text or screenshots to the current Midscene report. | — | options: object（字段见 options 详解）；title: string | `title` |
| `runHdcShell` | Execute a shell command through the current Harmony Agent. Pass only the shell command, without the hdc shell prefix. | command: string | — | `command` |
| `terminate` | Terminate an application through the current Harmony Agent. | uri: string | — | `uri` |
| `wait` | Wait for a fixed duration while honoring cancellation. | duration: number | unit: "ms"\|"s"\|"min"，默认 "ms" | 不支持 |

<!-- generated:node-inventory:harmony:end -->

### 8.3 multi-device 协作项目

<!-- generated:node-inventory:multi-device:start -->

「适用别名」列出本次参考生成时已绑定的别名（由 `.env` 的 `MULTI_DEVICE_BINDINGS` 决定；未设置时兼容默认 `phone1`/`phone2`）。实际别名以配置为准，`<alias>.<Node>` 语法不变。

### 全局 Node（不加别名前缀）

| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |
| --- | --- | --- | --- | --- |
| `device.parallel` | 同时在不同已绑定设备上执行各一个别名化原生操作，等待全部完成后汇合。不允许嵌套或子步骤级 $。 | steps: array | — | 不支持 |
| `device.prepare` | multi-device 项目请使用 \<alias\>.device.prepare。 | target: "home" | — | 不支持 |
| `device.recover` | multi-device 项目请使用 \<alias\>.device.recover。 | 无（写 `{}`） | — | 不支持 |
| `device.waitUntil` | multi-device 项目请使用 \<alias\>.device.waitUntil。 | prompt: string | intervalMs: integer，默认 500；timeoutMs: integer，默认 10000 | 不支持 |
| `experienceAct` | 多设备协作项目首期不接入 experienceAct。 | prompt: string | — | 不支持 |
| `wait` | Wait for a fixed duration while honoring cancellation. | duration: number | unit: "ms"\|"s"\|"min"，默认 "ms" | 不支持 |

### 别名化 Node（每个已绑定别名一组，写 `<alias>.<Node>`）

| Node | 适用别名 | 说明 | 必填参数 | 可选参数 | 字符串简写 |
| --- | --- | --- | --- | --- | --- |
| `<alias>.aiAct` | phone1、phone2 | Perform a natural-language task with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiAsk` | phone1、phone2 | Run aiAsk with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiAssert` | phone1、phone2 | Assert a natural-language condition with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | message: string；options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiBoolean` | phone1、phone2 | Run aiBoolean with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiNumber` | phone1、phone2 | Run aiNumber with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiString` | phone1、phone2 | Run aiString with a Midscene UI Agent and store its value. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `<alias>.aiTap` | phone1、phone2 | Locate and tap an element with a Midscene UI Agent. | prompt: string 或富对象（见 prompt 详解） | options: object（字段见 options 详解） | `prompt` |
| `phone1.back` | phone1 | Trigger the Android system back operation. | 无（写 `{}`） | — | 不支持 |
| `phone1.device.prepare` | phone1 | 准备设备 phone1：返回当前平台主屏（Home）。仅是原生导航基线。 | target: "home" | — | 不支持 |
| `phone1.device.recover` | phone1 | 恢复设备 phone1：返回当前平台主屏（Home）。保留系统设置与业务状态。 | 无（写 `{}`） | — | 不支持 |
| `phone1.device.waitUntil` | phone1 | 显式等待设备 phone1：轮询判定界面上的自然语言条件，满足即继续，超时失败。 | prompt: string | intervalMs: integer，默认 500；timeoutMs: integer，默认 10000 | `prompt` |
| `phone1.home` | phone1 | Trigger the Android system home operation. | 无（写 `{}`） | — | 不支持 |
| `phone1.launch` | phone1 | Launch an application through the current Android Agent. | uri: string | — | `uri` |
| `phone1.recentApps` | phone1 | Trigger the Android system recent apps operation. | 无（写 `{}`） | — | 不支持 |
| `<alias>.recordToReport` | phone1、phone2 | Add text or screenshots to the current Midscene report. | — | options: object（字段见 options 详解）；title: string | `title` |
| `<alias>.runAdbShell` | phone1 | Execute a shell command through the current Android Agent. Pass only the shell command, without the adb shell prefix. | command: string | options: object（字段见 options 详解） | `command` |
| `phone1.terminate` | phone1 | Terminate an application through the current Android Agent. | uri: string | — | `uri` |
| `phone2.back` | phone2 | Trigger the Harmony system back operation. | 无（写 `{}`） | — | 不支持 |
| `phone2.device.prepare` | phone2 | 准备设备 phone2：返回当前平台主屏（Home）。仅是原生导航基线。 | target: "home" | — | 不支持 |
| `phone2.device.recover` | phone2 | 恢复设备 phone2：返回当前平台主屏（Home）。保留系统设置与业务状态。 | 无（写 `{}`） | — | 不支持 |
| `phone2.device.waitUntil` | phone2 | 显式等待设备 phone2：轮询判定界面上的自然语言条件，满足即继续，超时失败。 | prompt: string | intervalMs: integer，默认 500；timeoutMs: integer，默认 10000 | `prompt` |
| `phone2.home` | phone2 | Trigger the Harmony system home operation. | 无（写 `{}`） | — | 不支持 |
| `phone2.launch` | phone2 | Launch an application through the current Harmony Agent. | uri: string | — | `uri` |
| `phone2.recentApps` | phone2 | Trigger the Harmony system recent apps operation. | 无（写 `{}`） | — | 不支持 |
| `<alias>.runHdcShell` | phone2 | Execute a shell command through the current Harmony Agent. Pass only the shell command, without the hdc shell prefix. | command: string | — | `command` |
| `phone2.terminate` | phone2 | Terminate an application through the current Harmony Agent. | uri: string | — | `uri` |

<!-- generated:node-inventory:multi-device:end -->

---

## 9. 典型用例模式

### 9.1 最小用例

```yaml
cases:
  - name: 打开设置并验证
    steps:
      - device.prepare:
          target: home
      - launch:
          uri: com.huawei.hmos.settings
      - device.waitUntil: 设置应用已打开   # 显式等待：就绪即继续，替代固定 wait
      - aiAssert:
          prompt: 当前打开了设置应用
      - terminate:
          uri: com.huawei.hmos.settings
      - device.recover: {}
```

### 9.2 使用生命周期钩子消除重复

```yaml
beforeEach:
  - device.prepare:
      target: home
afterEach:
  - device.recover: {}

cases:
  - name: 设置应用
    steps:
      - launch: "com.huawei.hmos.settings"
      - device.waitUntil: 设置应用已打开
      - aiAssert: "当前打开了设置应用"
      - terminate: "com.huawei.hmos.settings"

  - name: 计算器应用
    steps:
      - launch: "com.huawei.hmos.calculator"
      - device.waitUntil: 计算器应用已打开
      - aiAssert: "当前打开了计算器"
      - terminate: "com.huawei.hmos.calculator"
```

### 9.3 AI 交互操作

```yaml
- name: 计算器加法
  steps:
    - device.prepare:
        target: home
    - launch:
        uri: com.huawei.hmos.calculator
    - device.waitUntil: 计算器应用已打开
    - aiTap: "AC 或清除按钮"
    - aiTap: "数字 1"
    - aiTap: "加号"
    - aiTap: "数字 2"
    - aiTap: "等号"
    - device.waitUntil:                 # 条件即验收点：显式等待兼作结果判定
        prompt: 计算结果显示为 3
        timeoutMs: 5000
    - terminate:
        uri: com.huawei.hmos.calculator
    - device.recover: {}
```

### 9.4 Shell 命令 + 报告

```yaml
- name: 系统信息采集
  steps:
    - device.prepare:
        target: home
    - runHdcShell: "uname -a"
    - runHdcShell: "free -h"
    - recordToReport:
        title: 系统信息
        options:
          content: 已采集设备系统信息
    - device.recover: {}
```

Android 项目把 shell 节点换为 `runAdbShell`，同样不加 `adb shell` 前缀。

### 9.5 多设备协作

```yaml
- name: 多设备协作
  steps:
    - DUT1.device.prepare: { target: home }
    - DUT2.device.prepare: { target: home }
    - DUT1.aiAct: 执行第一步
    - DUT2.aiAssert: 已观察到第一步的结果
    - device.parallel:
        steps:
          - DUT1.aiAssert: 设备一处于预期状态
          - DUT2.aiAssert: 设备二处于预期状态
        $:
          timeout: 30000
    - wait: { duration: 500 }
    - DUT1.device.recover: {}
    - DUT2.device.recover: {}
```

（须先在 `.env` 中显式绑定 `DUT1` / `DUT2`，见 [multi-device-yaml-workflows.md](multi-device-yaml-workflows.md)。）

---

## 10. 编写注意事项

1. **优先显式等待** — 等待预期最终出现的界面状态用 `device.waitUntil`（条件满足即继续、超时即失败）；固定 `wait` 只用于无判定条件的短暂界面稳定（典型 300–500ms），不要按最坏情况预估长固定等待
2. **prompt 写具体** — `"屏幕上有时钟"` 比 `"有东西"` 更可靠
3. **device.prepare / device.recover 成对使用** — 交付的工作流通过 `beforeEach` / `afterEach` 钩子提供（见 §1 交付约定），保证每个用例的起始和结束状态一致
4. **terminate 不等于 force-stop** — 它是优雅关闭
5. **runAdbShell / runHdcShell 不加前缀** — 直接写 shell 命令本身
6. **所有 node 的输入都是严格对象** — 传入未定义的 key 会报错
7. **字符串简写不是所有 node 都支持** — 以「Node 清单」各表的「字符串简写」列为准；`home`/`back`/`recentApps`/`wait`/`device.prepare`/`device.recover`/`device.parallel` 必须用对象形式
8. **Node 清单以生成区块为准** — 不凭记忆或旧文档添加 Node、参数或 alias；自定义 Node 变更后先 `pnpm run nodes` 刷新本文档
