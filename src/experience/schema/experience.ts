import { z } from 'zod/v4';
import { ISO_DATETIME_PATTERN, SHA256_HEX_PATTERN, isSafeRelativeLocator } from './patterns';
import { variantSchema, validateVariantSemantics, type ExperienceVariant } from './variant';

/** 资产格式版本。不兼容版本拒绝读取，不做静默迁移。 */
export const EXPERIENCE_SCHEMA_VERSION = 1;

const isoDatetime = z
  .string()
  .regex(ISO_DATETIME_PATTERN, '时间必须是 ISO 8601 日期时间');

const relativeLocator = (field: string) =>
  z
    .string()
    .min(1, `${field} 不能为空`)
    .refine(isSafeRelativeLocator, `${field} 必须是项目内相对位置，不能是绝对路径或含 ".." 段`);

/**
 * 学习来源：用例身份（项目相对路径）、步骤位置（含 hook/steps）、
 * 逻辑节点（归一化后）、原始请求、调用标识与版本/时间。
 * 仅持久化协议所需元数据，不复制完整模型请求日志。
 */
export const experienceSourceSchema = z.strictObject({
  casePath: relativeLocator('casePath'),
  caseName: z.string().min(1, 'caseName 不能为空'),
  stepPath: relativeLocator('stepPath'),
  node: z.enum(['aiAct']),
  prompt: z.string().min(1, '原始请求 prompt 不能为空'),
  callId: z.string().min(1, 'callId 不能为空'),
  midsceneVersion: z.string().min(1, 'Midscene 版本不能为空'),
  adapterVersion: z.string().min(1, '适配层版本不能为空'),
  capturedAt: isoDatetime,
});
export type ExperienceSource = z.infer<typeof experienceSourceSchema>;

/**
 * Experience 以 requestKey 聚合一次请求；variants 保存该请求在不同
 * 环境与入口画面下学习到的链。修订与状态定义见 variant.ts。
 */
export const experienceSchema = z.strictObject({
  schemaVersion: z.literal(EXPERIENCE_SCHEMA_VERSION),
  requestKey: z
    .string()
    .regex(SHA256_HEX_PATTERN, 'requestKey 必须是 64 位小写十六进制摘要'),
  source: experienceSourceSchema,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  variants: z.array(variantSchema).min(1, 'Experience 必须至少有一个 Variant'),
});
export type Experience = z.infer<typeof experienceSchema>;

/** 校验结果：失败时给出具体原因清单，不静默丢弃或部分接受。 */
export type ExperienceValidationResult =
  | { ok: true; value: Experience }
  | { ok: false; reasons: string[] };

/** 将 zod 失败整理为带路径的中文原因列表。 */
export function describeZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path
      .map((segment) => String(segment))
      .filter((segment) => segment.length > 0)
      .join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** 顶层版本检查：先于 schema 判定 unsupported-version，避免误报为资产损坏。 */
export function checkSchemaVersionSupport(
  raw: unknown,
): { supported: true } | { supported: false; foundVersion: string } {
  const version = (raw as { schemaVersion?: unknown } | null | undefined)
    ?.schemaVersion;
  if (version === EXPERIENCE_SCHEMA_VERSION) return { supported: true };
  return {
    supported: false,
    foundVersion:
      typeof version === 'number' || typeof version === 'string'
        ? String(version)
        : '缺失或非数值',
  };
}

/** 运行期完整校验：schema（严格字段）+ 语义（链、指纹、修订一致性）。 */
export function validateExperienceAsset(
  value: unknown,
): ExperienceValidationResult {
  const parsed = experienceSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reasons: describeZodIssues(parsed.error) };
  }
  const reasons: string[] = [];
  const variantIds = new Set<string>();
  parsed.data.variants.forEach((variant: ExperienceVariant) => {
    if (variantIds.has(variant.variantId)) {
      reasons.push(
        `variants: variantId ${variant.variantId} 重复；同一 Experience 内必须唯一`,
      );
    }
    variantIds.add(variant.variantId);
    reasons.push(...validateVariantSemantics(variant));
  });
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, value: parsed.data };
}
