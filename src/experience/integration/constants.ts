import { DEFAULT_REQUEST_PARAM_REGISTRY } from '../schema/request-key';

/** 标记已包装的官方 aiAct Node，避免重复拦截。 */
export const TRANSPARENT_AI_ACT_WRAP = Symbol.for('mta.experience.transparentAiAct');

/** 读取项目开关的环境变量名，对应配置项 experience.enabled。 */
export const EXPERIENCE_ENABLED_ENV = 'EXPERIENCE_ENABLED';

/**
 * 透明接入声明的可重放 options 键。与请求 Key 登记表对齐：
 * 首期为空，任何官方 options 字段都使请求旁路原生，不裁剪后查询。
 */
export const SUPPORTED_AI_ACT_OPTION_KEYS: readonly string[] =
  DEFAULT_REQUEST_PARAM_REGISTRY.optionKeys;

/** 透明接入声明的可重放 context 键。首期为空。 */
export const SUPPORTED_AI_ACT_CONTEXT_KEYS: readonly string[] =
  DEFAULT_REQUEST_PARAM_REGISTRY.contextKeys;

/** 透明接入只对纯动作（原生返回 undefined）授予重放资格。 */
export const TRANSPARENT_REPLAY_RESULT_CATEGORY = 'undefined';
