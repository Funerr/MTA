# Midscene YAML 工作流编写规范

本文档描述 Midscene Test 的 YAML 工作流格式，适用于本仓库的 android / harmony 单设备项目，以及 `multi-device` 协作项目中带设备前缀的步骤。

协作项目的配置、`<alias>.aiAct` 与自定义 `device.parallel` 见 [multi-device-yaml-workflows.md](multi-device-yaml-workflows.md)。官方多项目并发（`test.maxConcurrency`）不能表达同一用例内的多设备交接。

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

## 3. Step 格式

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

---

## 4. 完整 Node 列表

### 4.1 应用生命周期

| Node | 说明 | 必填参数 | 字符串简写 |
|------|------|----------|-----------|
| `launch` | 启动应用 | `uri: string` — 应用 bundle URI | `- launch: "com.huawei.hmos.xxx"` |
| `terminate` | 终止应用 | `uri: string` — 应用 bundle URI | `- terminate: "com.huawei.hmos.xxx"` |

### 4.2 系统导航

| Node | 说明 | 参数 | 字符串简写 |
|------|------|------|-----------|
| `home` | 按 Home 键 | 无（`{}`） | 不支持 |
| `back` | 按返回键 | 无（`{}`） | 不支持 |
| `recentApps` | 打开最近任务 | 无（`{}`） | 不支持 |

### 4.3 设备管理

| Node | 说明 | 参数 | 字符串简写 |
|------|------|------|-----------|
| `device.prepare` | 准备设备：回到主屏幕 | `target: "home"`（仅接受此值） | 不支持 |
| `device.recover` | 恢复设备：回到主屏幕 | 无（`{}`） | 不支持 |

### 4.4 等待

| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |
|------|------|----------|----------|-----------|
| `wait` | 等待指定时长 | `duration: number`（正数） | `unit: "ms" \| "s" \| "min"`（默认 `"ms"`） | 不支持 |

### 4.5 AI 视觉操作

以下 node 都接受 `prompt` 参数（字符串或富对象），均支持字符串简写。

| Node | 说明 | 字符串简写 |
|------|------|-----------|
| `aiAct` | 用自然语言描述操作，AI 执行 | `- aiAct: "向下滑动一点"` |
| `aiTap` | 点击屏幕上的元素 | `- aiTap: "设置图标"` |
| `aiAssert` | 断言屏幕上有某内容 | `- aiAssert: "页面显示了xxx"` |
| `aiAsk` | 向 AI 提问，存储回答 | `- aiAsk: "当前页面标题是什么"` |
| `aiBoolean` | 是/否问题，存储布尔值 | `- aiBoolean: "按钮是否可见"` |
| `aiNumber` | 读取数字 | `- aiNumber: "列表有多少项"` |
| `aiString` | 读取文本 | `- aiString: "错误信息是什么"` |

### 4.6 Shell 命令

| Node | 说明 | 必填参数 | 字符串简写 |
|------|------|----------|-----------|
| `runHdcShell` | 执行 HDC shell 命令（不要加 `hdc shell` 前缀） | `command: string` | `- runHdcShell: "ls -la"` |

### 4.7 报告记录

| Node | 说明 | 参数 | 字符串简写 |
|------|------|------|-----------|
| `recordToReport` | 记录截图或文字到报告 | `title?: string`, `options?: { content?, screenshotBase64?, screenshots? }` | `- recordToReport: "截图标题"` |

### 4.8 经验动作（实验性）

| Node | 说明 | 必填参数 | 字符串简写 |
|------|------|----------|-----------|
| `experienceAct` | 经验重放动作，未命中时回退到 aiAct | `prompt: string` | `- experienceAct: "点击时钟"` |

---

## 5. prompt 参数详解

AI 相关 node（aiAct/aiAssert/aiTap/aiAsk 等）的 `prompt` 支持两种形式：

### 5.1 字符串形式

```yaml
- aiAssert: "当前打开了设置应用"
```

### 5.2 富对象形式（带参考图片）

```yaml
- aiTap:
    prompt: 点击类似这个图标的按钮
    images:
      - name: target-icon
        url: https://example.com/icon.png
    convertHttpImage2Base64: true  # 可选，将 HTTP 图片转为 base64
```

---

## 6. options 参数详解

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

## 7. 典型用例模式

### 7.1 最小用例

```yaml
cases:
  - name: 打开设置并验证
    steps:
      - device.prepare:
          target: home
      - launch:
          uri: com.huawei.hmos.settings
      - wait:
          duration: 2000
      - aiAssert:
          prompt: 当前打开了设置应用
      - terminate:
          uri: com.huawei.hmos.settings
      - device.recover: {}
```

### 7.2 使用生命周期钩子消除重复

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
      - wait: { duration: 2000 }
      - aiAssert: "当前打开了设置应用"
      - terminate: "com.huawei.hmos.settings"

  - name: 计算器应用
    steps:
      - launch: "com.huawei.hmos.calculator"
      - wait: { duration: 2000 }
      - aiAssert: "当前打开了计算器"
      - terminate: "com.huawei.hmos.calculator"
```

### 7.3 AI 交互操作

```yaml
- name: 计算器加法
  steps:
    - device.prepare:
        target: home
    - launch:
        uri: com.huawei.hmos.calculator
    - wait:
        duration: 2000
    - aiTap: "AC 或清除按钮"
    - wait: { duration: 300 }
    - aiTap: "数字 1"
    - wait: { duration: 300 }
    - aiTap: "加号"
    - wait: { duration: 300 }
    - aiTap: "数字 2"
    - wait: { duration: 300 }
    - aiTap: "等号"
    - wait: { duration: 500 }
    - aiAssert:
        prompt: 计算结果显示为 3
    - terminate:
        uri: com.huawei.hmos.calculator
    - device.recover: {}
```

### 7.4 Shell 命令 + 报告

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

---

## 8. 编写注意事项

1. **wait 是必要的** — UI 操作之间加 `wait` 让界面稳定，典型值 500ms-2000ms
2. **prompt 写具体** — `"屏幕上有时钟"` 比 `"有东西"` 更可靠
3. **device.prepare / device.recover 成对使用** — 保证每个用例的起始和结束状态一致
4. **terminate 不等于 force-stop** — 它是优雅关闭
5. **runHdcShell 不加 hdc 前缀** — 直接写 shell 命令本身
6. **所有 node 的输入都是 strictObject** — 传入未定义的 key 会报错
7. **字符串简写不是所有 node 都支持** — `home`/`back`/`recentApps`/`wait`/`device.prepare`/`device.recover` 必须用对象形式

---

## 9. Node 速查表

```
启动/关闭     launch(uri) / terminate(uri)
系统按键      home / back / recentApps             → 必须 {}
设备管理      device.prepare(target: home) / device.recover  → 必须 {}
等待          wait(duration, unit?)                → 必须 {}
AI 操作       aiAct / aiTap(prompt, options?)      → 支持简写
AI 断言       aiAssert(prompt, message?, options?) → 支持简写
AI 感知       aiString / aiNumber / aiBoolean / aiAsk(prompt) → 支持简写
Shell         runHdcShell(command)                 → 支持简写
报告          recordToReport(title?, options?)     → 支持简写
经验          experienceAct(prompt)                → 支持简写
```