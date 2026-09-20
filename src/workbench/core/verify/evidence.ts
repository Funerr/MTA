import type {
  AuthoringDocument,
  EvidenceRecord,
  PlatformWorkflowVariant,
} from '../document';

/**
 * 证据失效判定：业务要求、动作、前置路径、平台或设备上下文变化时，
 * 相关证据标记待复核；历史记录保留可查。失效状态按当前内容动态
 * 计算，不改动证据本身。
 *
 * 证据保存在平台变体内，另一平台天然不会继承核查状态。
 */

export interface EvidenceStatus {
  status: 'valid' | 'pending-recheck';
  reasons: string[];
}

export function evidenceStatus(
  document: AuthoringDocument,
  variant: PlatformWorkflowVariant,
  evidence: EvidenceRecord,
  deviceId?: string,
): EvidenceStatus {
  const reasons: string[] = [];
  if (deviceId && evidence.deviceId !== deviceId) reasons.push('当前设备与证据绑定不一致');
  if (evidence.appContextSnapshot && evidence.appContextSnapshot !== JSON.stringify(variant.appContext)) reasons.push('应用上下文已变化');

  if (evidence.platform !== variant.platform) {
    reasons.push('证据与变体平台不一致');
  }
  if (evidence.workflowRevision !== variant.workflow.revision) {
    reasons.push(
      `工作流已修订（证据采集于 r${evidence.workflowRevision}，当前 r${variant.workflow.revision}）`,
    );
  }
  if (evidence.businessRevision !== document.businessRevision) {
    reasons.push(
      `业务内容已修订（证据采集于 r${evidence.businessRevision}，当前 r${document.businessRevision}）`,
    );
  }

  const businessCase = document.cases.find((c) => c.id === evidence.caseId);
  if (!businessCase) {
    reasons.push('关联用例已被删除');
  } else {
    // 前置路径与目标步骤的动作快照比对：任一变化即待复核
    const current = businessCase.actions.map((a) => `${a.id}:${a.text}`);
    const snapshot = evidence.actionSnapshot.map((a) => `${a.id}:${a.text}`);
    if (current.join('\n') !== snapshot.join('\n')) {
      reasons.push('用例动作（含前置路径）已变化');
    }
    const expectationNow = businessCase.expectations.filter(
      (e) => evidence.expectationIds.includes(e.id),
    );
    if (expectationNow.length !== evidence.expectationIds.length) {
      reasons.push('关联预期已被删除或调整');
    }
  }

  return {
    status: reasons.length > 0 ? 'pending-recheck' : 'valid',
    reasons,
  };
}

/** 变体内全部证据的当前状态摘要（含证据缺口，供 UI 呈现）。 */
export function evidenceSummary(
  document: AuthoringDocument,
  variant: PlatformWorkflowVariant,
  deviceId?: string,
): {
  total: number;
  valid: number;
  pendingRecheck: number;
  perExpectation: {
    expectationId: string;
    covered: boolean;
    latest?: { status: EvidenceStatus; evidence: EvidenceRecord };
  }[];
} {
  let valid = 0;
  let pendingRecheck = 0;
  for (const evidence of variant.evidence) {
    if (evidenceStatus(document, variant, evidence, deviceId).status === 'valid') valid += 1;
    else pendingRecheck += 1;
  }

  const perExpectation = document.cases
    .flatMap((caseItem) => caseItem.expectations)
    .map((expectation) => {
      const related = variant.evidence
        .filter((e) => e.expectationIds.includes(expectation.id))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      const latest = related[0];
      return {
        expectationId: expectation.id,
        covered: Boolean(
          latest &&
            latest.status === 'observed-pass' &&
            evidenceStatus(document, variant, latest, deviceId).status === 'valid',
        ),
        latest: latest
          ? { status: evidenceStatus(document, variant, latest, deviceId), evidence: latest }
          : undefined,
      };
    });

  return {
    total: variant.evidence.length,
    valid,
    pendingRecheck,
    perExpectation,
  };
}
