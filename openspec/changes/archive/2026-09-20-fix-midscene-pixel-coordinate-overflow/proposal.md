## Why

Midscene 1.12.7 对未声明 locate 协议的模型 family 统一采用 `normalizedBy: 1000` 的归一化 bbox 协议（`@midscene/core` `model-adapter/locate.js` 默认值；`xiaomi-mimo` 仅定制 chat 参数，未声明 locate 协议）。当模型实际返回截图像素坐标时出现两类后果：越界像素坐标（如横屏 2160×1080 上的 `[0, 170, 2170, 1080]`）触发 `validation` 失败并耗尽语义重试，形成显性失败；而落在 `[0, 1000]` 内的像素坐标会通过校验并被静默映射到错误屏幕位置，形成"定位成功但点错"的隐性缺陷。横屏宽高比只是让第一类问题更容易暴露，第二类在任何分辨率下都已存在。

## What Changes

- 以 pnpm patch 对锁定依赖 `@midscene/core@1.12.7` 打补丁：在 locate codec 的解析之后、结构/范围校验之前插入 coordinate normalization compatibility 层。仅当返回坐标在声明的归一化协议下不可能成立（存在值超出归一化范围并超出容差带），且全部值符合模型输入图像的像素坐标范围（含小容差）时，才按轴 clamp 并重缩放为归一化坐标；`validation` 保持只校验、不修数据。
- 补丁同步修改 `dist/lib`（CJS）与 `dist/es`（ESM）双副本；升级依赖导致补丁失效时由契约测试显式暴露。
- 新增针对锁定依赖的单元契约测试，锁定：像素越界归一化、歧义带内不重写（保持显性失败与重试路径）、合法归一化结果零影响、point/bbox 与 xy/yx 通用性。
- 明确本补丁的局限并文档化：完全落在 `[0, 1000]` 内的像素坐标与归一化坐标不可判定，本补丁不做 auto 检测承诺；根治方向（显式声明模型 coordinateMode）作为后续独立 change `support-model-coordinate-mode`，其前置条件是对所用模型实际坐标协议的受控验证。

## Capabilities

### New Capabilities

- `midscene-locate-coordinate-contract`: 锁定依赖 locate codec 的坐标语义兼容契约——像素越界坐标的归一化修复、歧义带内保持显性失败、合法归一化结果零影响，以及契约测试随依赖升级的维护要求。

### Modified Capabilities

无。不改任何 Node、YAML 语法、Experience 或设备层的外部可观测语义；平台项目（android/harmony/multi-device）的规格行为不变。

## Impact

- `package.json`（`pnpm.patchedDependencies`）与 `patches/` 下新增补丁文件；锁定依赖升级时需按契约测试重新评估补丁。
- `tests/unit/` 新增契约测试文件；`vitest` 与 `typecheck` 必须保持通过，且不要求已连接设备或模型密钥。
- 文档：README 补充锁定依赖补丁的登记与升级注意事项；不改能力宣称与验收结论。
- 后续独立 change `support-model-coordinate-mode`（不在本 change 范围）：在适配边界显式声明模型的 coordinateMode（pixel/normalized），替代运行时猜测；其实施依赖对所用模型实际坐标协议的受控验证证据。
