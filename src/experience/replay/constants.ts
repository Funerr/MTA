/**
 * 原生直接派发入口：公开路径 Agent.callActionInActionSpace，locate 携带
 * locatedPixelResult 时框架跳过定位模型（1.12.7 实测，见任务 1.1/3.1 测试）。
 */
export const REPLAY_NATIVE_ENTRY = 'Agent.callActionInActionSpace';

/** 预置定位结果字段名；进入 locate 参数以证明"已定位、无需模型"。 */
export const REPLAY_LOCATE_BYPASS_FIELD = 'locatedPixelResult';

/** 未提供截止时间时，单次动作后等待的绝对上界。 */
export const DEFAULT_AFTER_WAIT_MS = 5_000;

/** 动作后等待的轮询间隔默认值。 */
export const DEFAULT_WAIT_POLL_INTERVAL_MS = 100;
