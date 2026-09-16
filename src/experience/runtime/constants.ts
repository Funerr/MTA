import { ELIGIBILITY_POLICY_VERSION } from '../promotion/constants';
import type { ExperienceActionPolicy } from './types';

/** 与 Promotion 资格策略版本对齐，参与请求 Key。 */
export const ACTION_POLICY_VERSION = ELIGIBILITY_POLICY_VERSION;

/** 默认策略不登记任何业务目标；未注入策略时全部走原生。 */
export const EMPTY_ACTION_POLICY: ExperienceActionPolicy = {
  version: ACTION_POLICY_VERSION,
  targets: [],
};

export const DEFAULT_EXPERIENCE_STORE_ROOT = 'experiences';

export const UNKNOWN_MODEL_COUNTS_SOURCE = 'unobserved';
export const VERIFIED_DUMP_SOURCE = 'dump';
export const VERIFIED_DUMP_TRANSPORT_SOURCE = 'dump+transport';
