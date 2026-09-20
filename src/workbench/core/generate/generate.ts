import type { AuthoringModelConfig } from '../../server/model-config';
import {
  chatJson,
  ModelCallError,
  type ChatMessage,
} from '../model/client';
import type {
  AuthoringDocument,
  AuthoringPlatform,
  PlatformWorkflowVariant,
} from '../document';
import { describeCaseGaps } from '../document';
import type { ProjectGenerationContext } from './context';
import { ModelOutput, ModelOutputSchema } from './schema';

/**
 * 平台工作流生成：一次调用覆盖文档内全部业务用例。生成结果先经
 * 结构校验，再由编译阶段（compile.ts）合并进平台变体；模型失败或
 * 取消不会改动任何已保存内容。
 */

export type GenerationOutcome =
  | { ok: true; output: ModelOutput }
  | { ok: false; error: ModelCallError };

export interface GenerateOptions {
  endpoint: AuthoringModelConfig | null;
  context: ProjectGenerationContext;
  document: AuthoringDocument;
  platform: AuthoringPlatform;
  variant: PlatformWorkflowVariant;
  /** 局部重新生成：只包含这些业务用例。 */
  caseIds?: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function generatePlatformWorkflow(
  options: GenerateOptions,
): Promise<GenerationOutcome> {
  const messages = buildMessages(options);
  let raw: unknown;
  try {
    raw = await chatJson<unknown>(options.endpoint, {
      messages,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ModelCallError
          ? error
          : new ModelCallError('http', String(error)),
    };
  }

  const parsed = ModelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: new ModelCallError(
        'invalid-response',
        `模型输出不符合结构契约：${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
          .slice(0, 5)
          .join('；')}`,
      ),
    };
  }
  return { ok: true, output: parsed.data };
}

function buildMessages(options: GenerateOptions): ChatMessage[] {
  const { context, platform, variant } = options;
  const document = options.caseIds
    ? ({
        ...options.document,
        cases: options.document.cases.filter((c) => options.caseIds!.includes(c.id)),
      } as AuthoringDocument)
    : options.document;
  const platformLabel = platform === 'android' ? 'Android（adb / launch uri 为应用包名）' : 'HarmonyOS（hdc / runHdcShell）';

  const system = [
    '你是 MTA 项目的用例转换引擎：把结构化业务用例编译为 Midscene 执行工作流。',
    '严格遵循以下当前项目规则，不得自创 Node、字段或放宽验收要求。',
    '',
    '## 转换 Skill 规则',
    context.skillRules,
    '',
    '## 转换交付契约（节选）',
    context.conversionContract,
    '',
    '## 断言策略',
    context.assertionPolicy,
    '',
    '## 目标项目 YAML 指南',
    context.yamlGuide,
    '',
    '## 目标平台 Node 参考（Node 名与输入 schema 以此为准）',
    context.nodeReference,
    '',
    '## 输出契约',
    '只输出一个 JSON 对象：',
    '{"cases":[{"caseId":"业务用例稳定 ID","workflowYaml":"单条用例的合法 YAML 文本（顶层 cases 数组只含这一条）","actionMapping":[{"actionId":"业务步骤稳定 ID","stepIndices":[0,1]}],"coverage":[{"expectationId":"预期稳定 ID","covered":true,"caseIndex":0,"stepIndex":0,"node":"aiAssert","reason":"未覆盖原因（covered=false 时必填）"}],"rewrites":[{"field":"受影响字段","original":"原文","rewritten":"改写","reason":"理由","basis":"user-request|explicit-goal|pending-suggestion"}],"issues":[{"field":"受影响字段","message":"问题","needed":"所需信息或缺失能力","kind":"blocking|capability|note（缺信息或矛盾=blocking，能力缺口=capability，仅记录=note）"}]}],"notes":["全局说明（可选）"]}',
    '',
    '## 硬性要求',
    '- 预期文本保持业务原文的精确语义，禁止放宽、删减验收条件；断言 prompt 里完整保留预期要点。',
    '- 未知包名、设备、账号或测试数据：不猜，写入该用例 issues（needed 说明缺什么）。',
    '- 每个业务步骤映射到一个或多个 YAML 步骤节点（actionMapping 给出步骤索引）；aiAct 负责动作，aiAssert 负责结果断言。',
    '- 前置条件：external 的保留为 issues 说明；workflow 的编译为准备步骤（如 device.prepare）。回到主屏不是业务环境重置。',
    '- 状态变化类预期（比较前后数值）若无已验证的数据读取/传递能力，covered=false 并在 issues 标注能力缺口。',
    '- workflowYaml 必须是合法 YAML：cases: [{name, steps: [{node: input}]}]，单键步骤，Node 名取自上方参考。',
    '- 每条业务预期都必须出现在 coverage 中；covered=false 必须给 reason。',
    context.missing.length > 0
      ? `- 注意：以下项目引用缺失，涉及相关语法时在 issues 中说明而非猜测：${context.missing.join('、')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const casesPayload = document.cases.map((caseItem) => ({
    id: caseItem.id,
    sourceId: caseItem.sourceId,
    name: caseItem.name,
    goal: caseItem.goal,
    level: caseItem.level,
    preconditions: caseItem.preconditions.map((p) => ({
      text: p.text,
      satisfaction: p.satisfaction,
    })),
    noPreconditionsDeclared: caseItem.noPreconditionsDeclared,
    data: caseItem.data,
    actions: caseItem.actions.map((a) => ({
      id: a.id,
      text: a.text,
      mustPreserve: a.mustPreserve,
      allowedAdaptation: a.allowedAdaptation,
    })),
    expectations: caseItem.expectations.map((e) => ({
      id: e.id,
      text: e.text,
      actionId: e.actionId,
      evidenceKind: e.evidenceKind,
    })),
    knownGaps: describeCaseGaps(caseItem).map((gap) => gap.message),
  }));

  const user = [
    `目标平台：${platformLabel}`,
    `应用上下文：${variant.appContext.packageName ? `包名 ${variant.appContext.packageName}` : '包名未知（如需包名请在 issues 中列出，不要猜测）'}${variant.appContext.entryHint ? `；入口说明：${variant.appContext.entryHint}` : ''}`,
    '',
    '业务用例（稳定 ID 用于关联，不可更改）：',
    JSON.stringify(casesPayload, null, 2),
    '',
    '请为以上每条用例生成平台执行工作流与覆盖映射。',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
