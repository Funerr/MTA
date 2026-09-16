## Why

历史坐标不能证明当前页面和目标仍然相同。需要在本地从当前截图中重新确认页面、目标与上下文，以低成本且保守的方式决定能否重放。

## What Changes

- 实现页面筛选、目标模板搜索、上下文及可选本地 OCR 辅助校验，输出当前目标框、分项评分和拒绝原因。
- 定义阈值、候选歧义、环境不兼容和低置信度的保守拒绝规则；禁止直接使用历史坐标作为命中结果。
- 建立原图、小幅位移、相似目标、目标移除、明显结构变化等标注夹具，固定配置并记录误匹配结果。
- 不调用 VLM、不发送设备动作、不重建通用定位引擎；OCR 和算法仅服务历史资产验证。

## Capabilities

### New Capabilities

- `visual-experience-matching`: 实现页面筛选、目标模板搜索、上下文及可选本地 OCR 辅助校验，输出当前目标框、分项评分和拒绝原因。

### Modified Capabilities

无。本 Change 新增独立能力，消费前序能力而不重写其规格；实施前对照已归档主规格复核边界。

## Impact

新增 src/experience/matcher/ 与本地图像依赖、夹具和校准记录。仅支持相同分辨率/方向的首期资产，小幅位移边界在固定测试集中明确。

实施前置：[add-experience-model](../add-experience-model/proposal.md)、[add-experience-promotion](../add-experience-promotion/proposal.md) 已完成并验证。前序尚在规划时，本 Change 是依赖其契约的后续方案，不表示当前已具备实施环境。版本和接口发生实质变化时先更新受影响规划。

