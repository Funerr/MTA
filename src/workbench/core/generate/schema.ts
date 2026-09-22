import { z } from 'zod/v4';

/**
 * 模型生成的结构化输出契约。字段与编写文档/转换记录一一对应：
 * 每条业务用例一份平台工作流片段、覆盖映射、改写与问题。
 */

export const ModelCoverageSchema = z.object({
  expectationId: z.string(),
  covered: z.boolean(),
  caseIndex: z.number().int().nonnegative().optional().catch(undefined),
  stepIndex: z.number().int().nonnegative().optional().catch(undefined),
  node: z.string().optional().catch(undefined),
  // 模型常在 covered 为 true 时输出 null；视为未提供。
  reason: z.string().optional().catch(undefined),
});
export type ModelCoverage = z.infer<typeof ModelCoverageSchema>;

export const ModelRewriteSchema = z.object({
  field: z.string(),
  original: z.string(),
  rewritten: z.string(),
  reason: z.string(),
  basis: z.enum(['user-request', 'explicit-goal', 'pending-suggestion']),
});
export type ModelRewrite = z.infer<typeof ModelRewriteSchema>;

export const ModelIssueSchema = z.object({
  field: z.string().optional().catch(undefined),
  message: z.string(),
  needed: z.string().optional().catch(undefined),
  /** blocking：缺信息/矛盾；capability：能力缺口；note：仅记录。 */
  kind: z.enum(['blocking', 'capability', 'note']).catch('blocking'),
});
export type ModelIssue = z.infer<typeof ModelIssueSchema>;

export const ModelActionMappingSchema = z.object({
  actionId: z.string(),
  /** 该业务步骤对应的 workflowYaml 步骤索引（零基）。 */
  stepIndices: z.array(z.number().int().nonnegative()),
});
export type ModelActionMapping = z.infer<typeof ModelActionMappingSchema>;

export const ModelCaseOutputSchema = z.object({
  caseId: z.string(),
  workflowYaml: z.string(),
  coverage: z.array(ModelCoverageSchema),
  actionMapping: z.array(ModelActionMappingSchema).catch([]),
  rewrites: z.array(ModelRewriteSchema).catch([]),
  issues: z.array(ModelIssueSchema).catch([]),
});
export type ModelCaseOutput = z.infer<typeof ModelCaseOutputSchema>;

export const ModelOutputSchema = z.object({
  cases: z.array(ModelCaseOutputSchema),
  notes: z.array(z.string()).optional().catch(undefined),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
