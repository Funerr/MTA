import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import { ModelConfigStore } from '../../src/workbench/server/model-config';
import { TaskRegistry } from '../../src/workbench/server/tasks';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import { VerifyService } from '../../src/workbench/server/verify-service';
import { deriveVerificationGoals } from '../../src/workbench/core/verify/goals';
import { evidenceStatus, evidenceSummary } from '../../src/workbench/core/verify/evidence';
import {
  createEmptyDocument,
  createVariant,
  touchBusiness,
  touchWorkflow,
  type BusinessCase,
} from '../../src/workbench/core/document';
import { compileGenerationIntoVariant } from '../../src/workbench/core/generate/compile';
import type { ModelOutput } from '../../src/workbench/core/generate/schema';

let tempRoot: string;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-verify-'));
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const sampleCase = (): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-V1',
  name: '打开设置',
  goal: '',
  level: 'level1',
  preconditions: [],
  noPreconditionsDeclared: true,
  actions: [
    { id: 'act1', text: '打开设置' },
    { id: 'act2', text: '检查蓝牙开关' },
  ],
  expectations: [
    { id: 'exp1', text: '设置页面显示', actionId: 'act1', evidenceKind: 'visual' },
    { id: 'exp2', text: '蓝牙开关可见', actionId: 'act2', evidenceKind: 'visual' },
  ],
  sourceRefs: [],
  status: 'draft',
});

const generatedOutput = (): ModelOutput => ({
  cases: [
    {
      caseId: 'case1',
      workflowYaml: [
        'cases:',
        '  - name: 打开设置',
        '    steps:',
        '      - aiAct: 打开系统设置',
        '      - aiAssert: 设置页面显示',
        '      - aiAct: 进入蓝牙页面',
        '      - aiAssert: 蓝牙开关可见',
      ].join('\n'),
      actionMapping: [
        { actionId: 'act1', stepIndices: [0] },
        { actionId: 'act2', stepIndices: [2] },
      ],
      coverage: [
        { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 1, node: 'aiAssert' },
        { expectationId: 'exp2', covered: true, caseIndex: 0, stepIndex: 3, node: 'aiAssert' },
      ],
      rewrites: [],
      issues: [],
    },
  ],
});

describe('核查目标推导', () => {
  it('目标带必要前置路径，未映射步骤标记不可执行', () => {
    const document = createEmptyDocument('d-v', '推导演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;
    compileGenerationIntoVariant({ document, variant, output: generatedOutput() });

    const { goals } = deriveVerificationGoals({
      document,
      platform: 'android',
      variant,
      caseId: 'case1',
      actionIds: ['act2'],
    });
    expect(goals).toHaveLength(1);
    expect(goals[0]!.actionId).toBe('act2');
    expect(goals[0]!.preconditionPath.join('')).toContain('打开系统设置');
    expect(goals[0]!.endStepIndex).toBe(3);
    expect(goals[0]!.observations).toEqual(['蓝牙开关可见']);

    // 删除 act1 的映射（重编译一个没有锚点的输出）后，act2 前置路径退化为业务文本
    const document2 = createEmptyDocument('d-v2', '无映射演示');
    document2.cases.push(sampleCase());
    const variant2 = createVariant('android', document2.businessRevision);
    document2.variants.android = variant2;
    const output = generatedOutput();
    output.cases[0]!.actionMapping = [];
    compileGenerationIntoVariant({ document: document2, variant: variant2, output });
    const derived2 = deriveVerificationGoals({
      document: document2,
      platform: 'android',
      variant: variant2,
      caseId: 'case1',
      actionIds: ['act2'],
    });
    expect(derived2.issues.join('')).toContain('尚未映射');
  });
});

describe('证据失效传播', () => {
  const setupEvidence = () => {
    const document = createEmptyDocument('d-e', '证据演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;
    compileGenerationIntoVariant({ document, variant, output: generatedOutput() });
    variant.evidence.push({
      id: 'ev-1',
      goalId: 'g-case1-act1',
      caseId: 'case1',
      actionId: 'act1',
      expectationIds: ['exp1'],
      platform: 'android',
      deviceId: 'emu-1',
      capturedAt: '2026-01-01T00:00:00Z',
      workflowRevision: variant.workflow.revision,
      businessRevision: document.businessRevision,
      actionSnapshot: document.cases[0]!.actions.map((a) => ({ id: a.id, text: a.text })),
      target: '打开设置',
      observation: '✓ 设置页面显示',
      status: 'observed-pass',
      screenshotFile: 'evidence/x.png',
      appContextSnapshot: JSON.stringify({ packageName: '' }),
    });
    // 另一平台变体独立存在
    document.variants.harmony = createVariant('harmony', document.businessRevision);
    return { document, variant };
  };

  it('上游动作变化使证据待复核；另一平台不继承', () => {
    const { document, variant } = setupEvidence();
    expect(evidenceStatus(document, variant, variant.evidence[0]!).status).toBe('valid');

    // 修改上游动作（act1 文本变化）
    document.cases[0]!.actions[0]!.text = '打开系统设置（修改后）';
    touchBusiness(document);
    const status = evidenceStatus(document, variant, variant.evidence[0]!);
    expect(status.status).toBe('pending-recheck');
    expect(status.reasons.some((r) => r.includes('动作'))).toBe(true);

    // 另一平台没有任何证据，不受影响
    const harmony = document.variants.harmony!;
    expect(harmony.evidence).toHaveLength(0);
    expect(evidenceSummary(document, harmony).total).toBe(0);
  });

  it('工作流修订与预期删除都会触发待复核；摘要统计缺口', () => {
    const { document, variant } = setupEvidence();
    touchWorkflow(variant);
    let status = evidenceStatus(document, variant, variant.evidence[0]!);
    expect(status.status).toBe('pending-recheck');
    expect(status.reasons.some((r) => r.includes('工作流已修订'))).toBe(true);

    // 恢复修订号后删除关联预期
    variant.workflow.revision = variant.evidence[0]!.workflowRevision;
    document.cases[0]!.expectations = document.cases[0]!.expectations.filter(
      (e) => e.id !== 'exp1',
    );
    status = evidenceStatus(document, variant, variant.evidence[0]!);
    expect(status.reasons.some((r) => r.includes('关联预期'))).toBe(true);

    const summary = evidenceSummary(document, variant);
    expect(summary.total).toBe(1);
    expect(summary.pendingRecheck).toBe(1);
    // exp1 已删除，不再出现在摘要；exp2 无有效证据 → 缺口
    expect(summary.perExpectation.find((p) => p.expectationId === 'exp1')).toBeUndefined();
    expect(summary.perExpectation.find((p) => p.expectationId === 'exp2')?.covered).toBe(
      false,
    );
  });

  it('设备不一致与应用上下文变化触发待复核', () => {
    const { document, variant } = setupEvidence();
    // 当前查看设备与证据绑定不一致
    let status = evidenceStatus(document, variant, variant.evidence[0]!, 'other-device');
    expect(status.status).toBe('pending-recheck');
    expect(status.reasons.some((r) => r.includes('设备'))).toBe(true);

    // 应用上下文变化（模拟用户改包名）
    variant.appContext = { packageName: 'com.example.changed' };
    status = evidenceStatus(document, variant, variant.evidence[0]!);
    expect(status.reasons.some((r) => r.includes('应用上下文'))).toBe(true);
  });
});

