import { EXPERIENCE_ENABLED_ENV } from './constants';
import type { ExperienceIntegrationConfig } from './types';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

/** 解析 experience.enabled：缺省、空值或无法识别的值均为关闭。 */
export function parseExperienceEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return ENABLED_VALUES.has(normalized);
}

/** 从环境读取项目级开关；不实例化 Runtime / Store。 */
export function loadExperienceIntegrationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ExperienceIntegrationConfig {
  return {
    enabled: parseExperienceEnabled(env[EXPERIENCE_ENABLED_ENV]),
  };
}
