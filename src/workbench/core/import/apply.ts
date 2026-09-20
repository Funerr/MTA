import {
  allocateStableId,
  touchBusiness,
  type AuthoringDocument,
  type BusinessCase,
  type SourceDocument,
} from '../document';
import type { ImportParseResult } from './types';

/**
 * 把解析结果应用到编写文档：为每条草稿分配文档内唯一的稳定 ID，
 * 保留来源范围与原文片段；解析问题与未转换清单进入文档 issues，
 * 可在界面上逐条核对。
 */

export interface ApplyImportReport {
  readonly addedCases: number;
  readonly addedIssues: number;
  readonly unconverted: number;
}

export function applyImport(
  document: AuthoringDocument,
  result: ImportParseResult,
  source: SourceDocument,
  now = new Date().toISOString(),
): ApplyImportReport {
  const taken = new Set<string>(collectTakenIds(document));
  let addedIssues = 0;

  for (const draft of result.cases) {
    const caseId = allocateStableId('case', taken);
    taken.add(caseId);

    const preconditions = draft.preconditions.map((text) => {
      const id = allocateStableId('pre', taken);
      taken.add(id);
      return { id, text, satisfaction: 'external' as const };
    });

    const actionIds = draft.actions.map((text) => {
      const id = allocateStableId('act', taken);
      taken.add(id);
      return { id, text };
    });

    const expectations = draft.expectations.map((item) => {
      const id = allocateStableId('exp', taken);
      taken.add(id);
      return {
        id,
        text: item.text,
        actionId: item.actionIndex !== undefined
          ? actionIds[item.actionIndex]?.id
          : undefined,
        evidenceKind: 'unverified' as const,
      };
    });

    const caseItem: BusinessCase = {
      id: caseId,
      sourceId: draft.sourceId,
      name: draft.name,
      goal: draft.goal,
      level: draft.level,
      preconditions,
      noPreconditionsDeclared: preconditions.length === 0,
      data: draft.data,
      actions: actionIds,
      expectations,
      sourceRefs: [
        {
          sourceId: source.id,
          range: draft.sourceRange,
          excerpt: draft.excerpt,
        },
      ],
      status: 'draft',
    };
    document.cases.push(caseItem);
  }

  for (const issue of result.issues) {
    const id = allocateStableId('issue', taken);
    taken.add(id);
    document.issues.push({
      id,
      message: issue.message,
      field: issue.range,
    });
    addedIssues += 1;
  }

  for (const block of result.unconverted) {
    const id = allocateStableId('issue', taken);
    taken.add(id);
    document.issues.push({
      id,
      message: `未转换：${block.reason}`,
      field: block.range,
      needed: block.excerpt,
    });
    addedIssues += 1;
  }

  document.sources.push(source);
  touchBusiness(document, now);

  return {
    addedCases: result.cases.length,
    addedIssues,
    unconverted: result.unconverted.length,
  };
}

function collectTakenIds(document: AuthoringDocument): string[] {
  const ids: string[] = [];
  for (const caseItem of document.cases) {
    ids.push(
      caseItem.id,
      ...caseItem.preconditions.map((p) => p.id),
      ...caseItem.actions.map((a) => a.id),
      ...caseItem.expectations.map((e) => e.id),
    );
  }
  for (const issue of document.issues) ids.push(issue.id);
  return ids;
}
