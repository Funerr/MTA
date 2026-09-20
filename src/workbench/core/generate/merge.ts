import YAML from 'yaml';
import {
  allocateStableId,
  touchWorkflow,
  type AuthoringCaseStatus,
  type AuthoringDocument,
  type CoverageMapping,
  type PlatformWorkflowVariant,
} from '../document';
import { buildCardView, cardViewToYaml } from '../cards/mapping';
import type {
  ModelActionMapping,
  ModelCoverage,
  ModelIssue,
  ModelRewrite,
} from './schema';
import {
  annotateCaseAnchors,
  flagExactExpectationGaps,
  parseWorkflowFragment,
} from './compile';

/**
 * 局部合并：把（重新）生成的个别用例片段合并进当前平台工作流。
 * 只替换目标用例的子树，其他用例（含注释与未知结构）原样保留；
 * 迟到的生成结果经此入口合并，不会整体覆盖人工编辑。
 */

export interface MergeCaseInput {
  caseId: string;
  workflowYaml: string;
  coverage: ModelCoverage[];
  actionMapping?: ModelActionMapping[];
  rewrites?: ModelRewrite[];
  issues?: ModelIssue[];
}

export interface MergeReport {
  replaced: readonly string[];
  appended: readonly string[];
  failed: readonly { caseId: string; reason: string }[];
  caseStatuses: Record<string, AuthoringCaseStatus>;
  flaggedExpectations: readonly string[];
}

export function mergeGeneratedCases(input: {
  document: AuthoringDocument;
  variant: PlatformWorkflowVariant;
  cases: readonly MergeCaseInput[];
  now?: string;
}): MergeReport {
  const { document, variant } = input;
  const now = input.now ?? new Date().toISOString();

  const report: {
    replaced: string[];
    appended: string[];
    failed: { caseId: string; reason: string }[];
    caseStatuses: Record<string, AuthoringCaseStatus>;
    flaggedExpectations: string[];
  } = { replaced: [], appended: [], failed: [], caseStatuses: {}, flaggedExpectations: [] };

  if (!variant.workflow.yaml.trim()) {
    report.failed.push({ caseId: '*', reason: '当前工作流为空，无法局部合并；请先整体生成' });
    variant.caseStatuses = { ...variant.caseStatuses, ...report.caseStatuses };
  return report;
  }
  const view = buildCardView(variant.workflow.yaml);
  if (!view.ok) {
    report.failed.push({ caseId: '*', reason: `当前工作流无法解析：${view.error}` });
    variant.caseStatuses = { ...variant.caseStatuses, ...report.caseStatuses };
  return report;
  }
  const yamlDocument = view.view.document;
  const root = yamlDocument.contents;
  const casesPair = root
    ? YAML.isMap(root)
      ? root.items.find((pair) => String(pair.key) === 'cases')
      : undefined
    : undefined;
  if (!casesPair?.value || !YAML.isSeq(casesPair.value)) {
    report.failed.push({ caseId: '*', reason: '当前工作流缺少 cases 数组' });
    variant.caseStatuses = { ...variant.caseStatuses, ...report.caseStatuses };
  return report;
  }
  const casesSeq = casesPair.value;
  const mergedCaseIds = [...(variant.workflow.mergedCaseIds ?? [])];

  const takenIds = new Set<string>([
    ...document.rewrites.map((r) => r.id),
    ...document.issues.map((i) => i.id),
  ]);

  for (const incoming of input.cases) {
    const businessCase = document.cases.find((c) => c.id === incoming.caseId);
    if (!businessCase) {
      report.failed.push({
        caseId: incoming.caseId,
        reason: '业务用例不存在（可能已被删除）',
      });
      continue;
    }
    const parsed = parseWorkflowFragment(incoming.workflowYaml);
    if (!parsed.ok) {
      report.failed.push({
        caseId: incoming.caseId,
        reason: `片段无法解析：${parsed.error}`,
      });
      continue;
    }

    // 定位：优先 mergedCaseIds；找不到则追加。
    let targetIndex = mergedCaseIds.indexOf(incoming.caseId);
    if (targetIndex < 0 || targetIndex >= casesSeq.items.length) {
      targetIndex = casesSeq.items.length;
      casesSeq.items.push(yamlDocument.createNode(parsed.cases[0]) as never);
      mergedCaseIds.push(incoming.caseId);
      report.appended.push(incoming.caseId);
    } else {
      casesSeq.items[targetIndex] = yamlDocument.createNode(parsed.cases[0]) as never;
      report.replaced.push(incoming.caseId);
    }

    document.rewrites.push({ id: allocateStableId('rw', takenIds), caseId: incoming.caseId,
      field: `variants/${variant.platform}/workflow`, original: variant.workflow.yaml, rewritten: incoming.workflowYaml,
      reason: '用户审阅差异后选择合并该用例', basis: 'user-request', at: now });
    takenIds.add(document.rewrites.at(-1)!.id);
    // 锚点与防线
    annotateCaseAnchors(casesSeq, [
      ...(incoming.actionMapping ?? []).map((mapping) => ({
        mergedCaseIndex: targetIndex,
        actionId: mapping.actionId,
        stepIndices: mapping.stepIndices,
      })),
    ]);

    const coveredIds = new Set(
      incoming.coverage.filter((c) => c.covered).map((c) => c.expectationId),
    );
    for (const flagged of flagExactExpectationGaps(
      businessCase.expectations,
      incoming.workflowYaml,
      coveredIds,
      (issue) => {
        const issueId = allocateStableId('issue', takenIds);
        takenIds.add(issueId);
        document.issues.push({ id: issueId, caseId: businessCase.id, ...issue });
      },
    )) {
      report.flaggedExpectations.push(flagged);
    }

    // 状态判定（与 compile 同规则）
    const blocking = (incoming.issues ?? []).filter((i) => i.kind === 'blocking');
    const capability = (incoming.issues ?? []).filter((i) => i.kind === 'capability');
    const uncovered = incoming.coverage.filter((c) => !c.covered);
    const expectationsMissing = businessCase.expectations.filter(
      (e) => !incoming.coverage.some((c) => c.expectationId === e.id),
    );
    const caseFlagged = businessCase.expectations.some((e) =>
      report.flaggedExpectations.includes(e.id),
    );

    if (capability.length > 0) {
      report.caseStatuses[businessCase.id] = 'unsupported';
    } else if (
      blocking.length > 0 ||
      uncovered.length > 0 ||
      expectationsMissing.length > 0 ||
      caseFlagged
    ) {
      report.caseStatuses[businessCase.id] = 'needs_clarification';
    } else {
      report.caseStatuses[businessCase.id] = 'unvalidated';
    }
    businessCase.status = report.caseStatuses[businessCase.id]!;

    for (const issue of incoming.issues ?? []) {
      const issueId = allocateStableId('issue', takenIds);
      takenIds.add(issueId);
      document.issues.push({
        id: issueId,
        caseId: businessCase.id,
        field: issue.field,
        message: issue.message,
        needed: issue.needed,
      });
    }
    for (const rewrite of incoming.rewrites ?? []) {
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

    // 覆盖映射：仅替换该用例的预期项
    const others = variant.coverage.filter(
      (entry) => !businessCase.expectations.some((e) => e.id === entry.expectationId),
    );
    const mine: CoverageMapping[] = businessCase.expectations.map((expectation) => {
      const entry = incoming.coverage.find((c) => c.expectationId === expectation.id);
      return {
        expectationId: expectation.id,
        covered: entry ? entry.covered : false,
        caseIndex: entry?.covered ? targetIndex : undefined,
        stepIndex: entry?.stepIndex,
        node: entry?.node,
        reason: entry?.covered
          ? undefined
          : entry?.reason ?? '模型未提供覆盖映射',
      };
    });
    variant.coverage = [...others, ...mine];
  }

  variant.workflow.yaml = cardViewToYaml(yamlDocument);
  variant.workflow.mergedCaseIds = mergedCaseIds;
  variant.workflow.invalidYamlBuffer = undefined;
  // 局部合并同样对齐业务修订：合并完成后工作流不再是“待更新”。
  variant.workflow.basedOnBusinessRevision = document.businessRevision;
  touchWorkflow(variant, now);
  document.updatedAt = now;

  variant.caseStatuses = { ...variant.caseStatuses, ...report.caseStatuses };
  return report;
}
