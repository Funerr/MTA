/**
 * Experience v1 公共入口：资产契约、本地文件 Store、Promotion 学习入口与本地视觉 Matcher。
 * Schema/Store 不访问设备或模型；Promotion 只在公开 Agent dump 边界取数；
 * Matcher 只消费当前截图与历史视觉证据，不调用 VLM、不发送设备动作。
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
