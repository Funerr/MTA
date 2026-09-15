import { z } from 'zod/v4';
import { screenEvidenceSchema, type ScreenEvidence } from './assets';
import { experienceActionSchema, validateActionChain } from './action';
import {
  environmentSchema,
  computeEnvironmentFingerprint,
  type ExperienceEnvironment,
} from './environment';
import { ISO_DATETIME_PATTERN, SHA256_HEX_PATTERN } from './patterns';
import { canonicalJsonStringify, sha256Hex, type JsonValue } from './json';

/** 经验链状态：candidate（新学习）→ active（首次验证成功重放）→ stale（不可靠）。 */
export const VARIANT_STATUSES = ['candidate', 'active', 'stale'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

/** 可作为重放候选的状态；stale 保留可追踪但不参与重放。 */
export const CANDIDATE_STATUSES: readonly VariantStatus[] = [
  'candidate',
  'active',
];

/** 统计区分学习、重放成功与失败；计数由 Store 按事件幂等更新。 */
export const variantStatsSchema = z.strictObject({
  learned: z.number().int().positive('学习计数必须是正整数'),
  replaySuccess: z.number().int().min(0, '重放成功计数必须是非负整数'),
  replayFailure: z.number().int().min(0, '重放失败计数必须是非负整数'),
});
export type VariantStats = z.infer<typeof variantStatsSchema>;

const isoDatetime = z
  .string()
  .regex(ISO_DATETIME_PATTERN, '时间必须是 ISO 8601 日期时间');

/**
 * 一次学习形成的链修订。entry/terminal 是结构一致性证据（非语义断言缓存）；
 * 首期只允许结果为 undefined 的纯动作调用（动态输出不复用）。
 */
export const variantRevisionSchema = z.strictObject({
  revision: z.number().int().positive('修订号必须是正整数'),
  status: z.enum(VARIANT_STATUSES),
  entryEvidence: screenEvidenceSchema,
  terminalEvidence: screenEvidenceSchema,
  actions: z.array(experienceActionSchema),
  eligibilityPolicyVersion: z.string().min(1, '资格策略版本不能为空'),
  nativeResult: z.strictObject({
    category: z.literal('undefined'),
  }),
  evidenceComplete: z.literal(true),
  learnedAt: isoDatetime,
  staleReason: z.string().min(1, '失效原因不能为空').optional(),
  stats: variantStatsSchema,
});
export type VariantRevision = z.infer<typeof variantRevisionSchema>;

/**
 * Variant 按环境指纹 + 入口指纹区分：同一请求从不同入口画面学习得到
 * 不同 Variant；同一入口重新学习产生新修订（revision 递增）。
 */
export const variantSchema = z.strictObject({
  variantId: z
    .string()
    .regex(SHA256_HEX_PATTERN, 'variantId 必须是 64 位小写十六进制指纹'),
  environment: environmentSchema,
  environmentFingerprint: z
    .string()
    .regex(SHA256_HEX_PATTERN, '环境指纹格式不正确'),
  entryFingerprint: z
    .string()
    .regex(SHA256_HEX_PATTERN, '入口指纹格式不正确'),
  revisions: z.array(variantRevisionSchema).min(1, 'Variant 必须至少有一个修订'),
});
export type ExperienceVariant = z.infer<typeof variantSchema>;

/**
 * 入口指纹用于修订归组（结构性哈希，不做查找命中依据）；
 * 入口是否匹配由后序 matcher 按入口图片相似性验证。
 */
export function computeEntryFingerprint(entry: ScreenEvidence): string {
  return sha256Hex(
    canonicalJsonStringify({
      kind: 'entry',
      digest: entry.screenshot.asset.digest,
      width: entry.screenshot.width,
      height: entry.screenshot.height,
    } satisfies JsonValue),
  );
}

/** variantId 由环境指纹与入口指纹共同派生，重算不一致即拒绝（防错绑/篡改）。 */
export function computeVariantId(
  environmentFingerprint: string,
  entryFingerprint: string,
): string {
  return sha256Hex(`variant:${environmentFingerprint}:${entryFingerprint}`);
}

/** 当前修订 = 修订号最大的修订；只有它参与候选查询与状态更新。 */
export function currentRevisionOf(variant: ExperienceVariant): VariantRevision {
  return variant.revisions.reduce((latest, revision) =>
    revision.revision > latest.revision ? revision : latest,
  );
}

/** Variant 语义校验：修订号从 1 连续递增、stale 必有原因、指纹可重算一致。 */
export function validateVariantSemantics(
  variant: ExperienceVariant,
): string[] {
  const reasons: string[] = [];
  const where = `variant(${variant.variantId.slice(0, 12)}…)`;

  variant.revisions.forEach((revision, index) => {
    if (revision.revision !== index + 1) {
      reasons.push(
        `${where}: 修订号必须从 1 开始连续递增，实际第 ${index + 1} 项为 ${revision.revision}`,
      );
    }
    if (revision.status === 'stale' && !revision.staleReason) {
      reasons.push(`${where}: 修订 ${revision.revision} 状态为 stale 但缺少失效原因`);
    }
    reasons.push(...validateActionChain(revision.actions));
  });

  const expectedEnvFp = computeEnvironmentFingerprint(variant.environment);
  if (variant.environmentFingerprint !== expectedEnvFp) {
    reasons.push(`${where}: environmentFingerprint 与 environment 内容不匹配`);
  }
  const expectedEntryFp = computeEntryFingerprint(
    currentRevisionOf(variant).entryEvidence,
  );
  if (variant.entryFingerprint !== expectedEntryFp) {
    reasons.push(`${where}: entryFingerprint 与当前修订入口证据不匹配`);
  }
  const expectedVariantId = computeVariantId(
    variant.environmentFingerprint,
    variant.entryFingerprint,
  );
  if (variant.variantId !== expectedVariantId) {
    reasons.push(
      `${where}: variantId 与环境指纹/入口指纹派生结果不匹配（可能错绑或被篡改）`,
    );
  }
  return reasons;
}
