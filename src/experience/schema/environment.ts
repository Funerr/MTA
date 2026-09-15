import { z } from 'zod/v4';
import { canonicalJsonStringify, sha256Hex, type JsonValue } from './json';

/**
 * 执行环境契约。所有字段必需且语义相关：任一不一致即不兼容，
 * 不做部分匹配；未知/缺失必需字段不作为通配符。
 * 不使用设备序列号（允许同型号复用），也不默认跨系统版本复用。
 */
export const environmentSchema = z.strictObject({
  platform: z.literal('android'),
  model: z.string().min(1, '设备型号不能为空'),
  systemBuild: z.string().min(1, '系统版本不能为空'),
  resolution: z.strictObject({
    width: z.number().int().positive('分辨率宽度必须是正整数'),
    height: z.number().int().positive('分辨率高度必须是正整数'),
  }),
  orientation: z.enum(['portrait', 'landscape']),
  language: z.string().min(1, '系统语言不能为空'),
  theme: z.string().min(1, '系统主题不能为空'),
  /** 执行栈兼容版本（如 Midscene 版本与适配层版本组合），不一致即不兼容。 */
  executionCompatVersion: z.string().min(1, '执行兼容版本不能为空'),
});
export type ExperienceEnvironment = z.infer<typeof environmentSchema>;

/** 环境指纹：规范化 JSON 的 sha256。兼容判断要求指纹完全相等。 */
export function computeEnvironmentFingerprint(
  environment: ExperienceEnvironment,
): string {
  return sha256Hex(
    canonicalJsonStringify(environment as unknown as JsonValue),
  );
}

/** 精确环境兼容判断：任一必需字段不同（或未通过校验）即不兼容。 */
export function isSameEnvironment(
  a: ExperienceEnvironment,
  b: ExperienceEnvironment,
): boolean {
  return computeEnvironmentFingerprint(a) === computeEnvironmentFingerprint(b);
}
