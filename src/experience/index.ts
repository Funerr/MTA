/**
 * Experience v1 公共入口：资产契约、本地文件 Store、Promotion 学习入口、
 * 本地视觉 Matcher 与视觉动作回放，以及把查询、重放、原生 AI 与学习
 * 串起来的 Runtime，以及项目 YAML aiAct 的可关闭透明接入。Schema/Store 不访问设备或模型；
 * Promotion 只在公开 Agent dump 边界取数；Matcher 只消费当前截图与历史
 * 视觉证据，不调用 VLM、不发送设备动作；Replay 按当前画面逐步派发原生
 * 已定位动作，不调用 VLM、不更新 Store。Runtime 决定选链、回退与学习，
 * 单次尝试最多一次原生 AI。
 */
export * from './schema/assets';
export * from './schema/environment';
export * from './schema/action';
export * from './schema/variant';
export * from './schema/experience';
export * from './schema/request-key';
export * from './store/errors';
export * from './store/experience-store';
export * from './promotion';
export * from './matcher';
export * from './replay';
export * from './runtime';
export * from './integration';
