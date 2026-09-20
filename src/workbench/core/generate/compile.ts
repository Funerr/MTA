import YAML from 'yaml';
import { stepAnchorComment } from '../cards/mapping';
import {
  allocateStableId,
  touchWorkflow,
  type AuthoringCaseStatus,
  type AuthoringDocument,
  type CoverageMapping,
  type PlatformWorkflowVariant,
} from '../document';
import type { ModelOutput } from './schema';

/**
 * 编译：把模型生成的用例片段合并进平台工作流变体。
 * - 片段非法（YAML/结构）时该用例保持草稿并记录问题，不合并半成品。
 * - 覆盖映射换算为合并后文档的全局索引。
 * - 精确预期防线：每条 covered 预期的原文（归一化后）必须能在该用例
 *   工作流中找到；找不到即标记待澄清，防止静默放宽。
 */

export interface CompileReport {
  readonly caseStatuses: Record<string, AuthoringCaseStatus>;
  readonly mergedCaseCount: number;
  readonly flaggedExpectations: readonly string[];
}

export function compileGenerationIntoVariant(input: {
  document: AuthoringDocument;
  variant: PlatformWorkflowVariant;
  output: ModelOutput;
  now?: string;
}): CompileReport {
  const { document, variant, output } = input;
  const now = input.now ?? new Date().toISOString();

  const takenIds = new Set<string>([
    ...document.rewrites.map((r) => r.id),
    ...document.issues.map((i) => i.id),
  ]);
  const caseStatuses: Record<string, AuthoringCaseStatus> = {};
  const flaggedExpectations: string[] = [];

  const outputByCaseId = new Map(output.cases.map((c) => [c.caseId, c]));
  const mergedCases: unknown[] = [];
  const coverage: CoverageMapping[] = [];
  const anchors: { mergedCaseIndex: number; actionId: string; stepIndices: number[] }[] = [];
  const mergedCaseIds: string[] = [];
  let caseIndex = 0;

  for (const businessCase of document.cases) {
    const generated = outputByCaseId.get(businessCase.id);
    if (!generated) {
      caseStatuses[businessCase.id] = 'needs_clarification';
      document.issues.push({
        id: allocateStableId('issue', takenIds),
        caseId: businessCase.id,
        field: `cases/${businessCase.id}`,
        message: '模型未生成该用例的平台工作流；保留业务草稿',
        needed: '请重试生成或补充该用例信息',
      });
      takenIds.add(document.issues[document.issues.length - 1]!.id);
      continue;
    }

    const parsed = parseWorkflowFragment(generated.workflowYaml);
    if (!parsed.ok) {
      caseStatuses[businessCase.id] = 'unvalidated';
      document.issues.push({
        id: allocateStableId('issue', takenIds),
        caseId: businessCase.id,
        field: `cases/${businessCase.id}/workflowYaml`,
        message: `生成的工作流片段无法解析：${parsed.error}；该用例保持草稿`,
      });
      takenIds.add(document.issues[document.issues.length - 1]!.id);
      continue;
    }

    // 精确预期防线
    const coveredIds = new Set(
      generated.coverage.filter((c) => c.covered).map((c) => c.expectationId),
    );
    for (const id of flagExactExpectationGaps(
      businessCase.expectations,
      generated.workflowYaml,
      coveredIds,
      (issue) => {
        const issueId = allocateStableId('issue', takenIds);
        takenIds.add(issueId);
        document.issues.push({ id: issueId, caseId: businessCase.id, ...issue });
      },
    )) {
      flaggedExpectations.push(id);
    }

    // 状态判定：能力缺口 > 缺信息 > 全覆盖待校验
    const blocking = generated.issues.filter((i) => i.kind === 'blocking');
    const capability = generated.issues.filter((i) => i.kind === 'capability');
    const uncovered = generated.coverage.filter((c) => !c.covered);
    const expectationsMissing = businessCase.expectations.filter(
      (e) => !generated.coverage.some((c) => c.expectationId === e.id),
    );

    if (capability.length > 0) {
      caseStatuses[businessCase.id] = 'unsupported';
    } else if (
      blocking.length > 0 ||
      uncovered.length > 0 ||
      expectationsMissing.length > 0 ||
      flaggedExpectations.some((id) =>
        businessCase.expectations.some((e) => e.id === id),
      )
    ) {
      caseStatuses[businessCase.id] = 'needs_clarification';
    } else {
      caseStatuses[businessCase.id] = 'unvalidated';
    }

    // 模型 issues 与改写记录登记（附业务用例关联）
    for (const issue of generated.issues) {
      const id = allocateStableId('issue', takenIds);
      takenIds.add(id);
      document.issues.push({
        id,
        caseId: businessCase.id,
        field: issue.field,
        message: issue.message,
        needed: issue.needed,
      });
    }
    for (const rewrite of generated.rewrites) {
      const id = allocateStableId('rw', takenIds);
      takenIds.add(id);
      document.rewrites.push({
        id,
        caseId: businessCase.id,
        field: rewrite.field,
        original: rewrite.original,
        rewritten: rewrite.rewritten,
        reason: rewrite.reason,
        basis: rewrite.basis,
        at: now,
      });
    }

    // 覆盖映射换算为全局 case 索引
    for (const expectation of businessCase.expectations) {
      const entry = generated.coverage.find(
        (c) => c.expectationId === expectation.id,
      );
      coverage.push({
        expectationId: expectation.id,
        covered: entry ? entry.covered : false,
        caseIndex: entry?.covered ? caseIndex : undefined,
        stepIndex: entry?.stepIndex,
        node: entry?.node,
        reason: entry?.covered ? undefined : entry?.reason ?? '模型未提供覆盖映射',
      });
    }

    mergedCaseIds.push(businessCase.id);
    for (const mapping of generated.actionMapping) {
      if (
        businessCase.actions.some((a) => a.id === mapping.actionId) &&
        mapping.stepIndices.length > 0
      ) {
        anchors.push({
          mergedCaseIndex: caseIndex,
          actionId: mapping.actionId,
          stepIndices: mapping.stepIndices,
        });
      }
    }
    for (const fragmentCase of parsed.cases) {
      mergedCases.push(fragmentCase);
    }
    caseIndex += 1;
  }

  if (mergedCases.length > 0) {
    const doc = new YAML.Document();
    doc.comment =
      `由 MTA 编写工作台生成（业务修订 r${document.businessRevision}，平台 ${variant.platform}）；` +
      '人工可编辑，注释与未知结构会被保留';
    doc.set('cases', doc.createNode(mergedCases));

    annotateCaseAnchors(doc.get('cases'), anchors);

    variant.workflow.yaml = doc.toString({ indent: 2, lineWidth: 0 });
    variant.workflow.basedOnBusinessRevision = document.businessRevision;
    variant.workflow.invalidYamlBuffer = undefined;
    variant.workflow.mergedCaseIds = mergedCaseIds;
    variant.coverage = coverage;
    touchWorkflow(variant, now);
  }

  // 同步用例状态。编译不是业务内容变更：不推进业务修订，
  // 也不把其他平台标记为待更新。
  for (const businessCase of document.cases) {
    const status = caseStatuses[businessCase.id];
    if (status) businessCase.status = status;
  }
  variant.caseStatuses = caseStatuses;
  document.updatedAt = now;

  return {
    caseStatuses,
    mergedCaseCount: mergedCases.length,
    flaggedExpectations,
  };
}

export function parseWorkflowFragment(
  text: string,
): { ok: true; cases: unknown[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '片段不是对象' };
  }
  const cases = (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases) || cases.length !== 1) {
    return { ok: false, error: '片段必须只含一条用例（cases 数组长度为 1）' };
  }
  for (const caseItem of cases) {
    if (!caseItem || typeof caseItem !== 'object') {
      return { ok: false, error: 'cases 中存在非对象条目' };
    }
    const record = caseItem as { name?: unknown; steps?: unknown };
    if (typeof record.name !== 'string' || !record.name.trim()) {
      return { ok: false, error: '用例缺少 name' };
    }
    if (!Array.isArray(record.steps) || record.steps.length === 0) {
      return { ok: false, error: `用例 ${record.name} 缺少 steps` };
    }
  }
  return { ok: true, cases };
}

/** 归一化：去除空白与常见标点差异，用于“原文保留”比对。 */
export function normalizeForExactness(text: string): string {
  return text
    .replace(/[\s，。；、：""''（）()\[\]【】,.;;:?'"]/g, '')
    .toLowerCase();
}


/** 在合并文档的指定用例上写 @step 锚点（compile 与局部合并共用）。 */
export function annotateCaseAnchors(
  casesNode: unknown,
  anchors: readonly { mergedCaseIndex: number; actionId: string; stepIndices: number[] }[],
): void {
  const casesSeq = casesNode as { items?: unknown[] } | null | undefined;
  for (const anchor of anchors) {
    const caseItem = casesSeq?.items?.[anchor.mergedCaseIndex];
    if (!caseItem || typeof caseItem !== 'object') continue;
    const stepsSeq = (caseItem as { get?: (key: string) => unknown }).get?.('steps') as
      | { items: unknown[] }
      | undefined;
    for (const stepIndex of anchor.stepIndices) {
      const stepItem = stepsSeq?.items?.[stepIndex];
      if (stepItem && typeof stepItem !== 'object') continue;
      (stepItem as { commentBefore?: string }).commentBefore = stepAnchorComment(
        anchor.actionId,
      );
    }
  }
}

/** 精确预期防线（compile 与局部合并共用）：返回被标记的预期 ID。 */
export function flagExactExpectationGaps(
  businessCaseExpectations: readonly { id: string; text: string }[],
  workflowText: string,
  coveredExpectationIds: ReadonlySet<string>,
  pushIssue: (issue: {
    field: string;
    message: string;
    needed: string;
  }) => void,
): string[] {
  const flagged: string[] = [];
  const normalized = normalizeForExactness(workflowText);
  for (const expectation of businessCaseExpectations) {
    if (!coveredExpectationIds.has(expectation.id)) continue;
    if (normalized.includes(normalizeForExactness(expectation.text))) continue;
    flagged.push(expectation.id);
    pushIssue({
      field: `expectations/${expectation.id}`,
      message: `预期“${expectation.text.slice(0, 60)}”未逐字体现在生成的工作流断言中，需人工核对是否被改写`,
      needed: '核对断言是否保留了原预期的精确要求',
    });
  }
  return flagged;
}
