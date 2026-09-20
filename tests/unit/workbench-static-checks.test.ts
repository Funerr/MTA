import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runStaticChecks } from '../../src/workbench/core/validation/static';
import {
  createEmptyDocument,
  createVariant,
  type AuthoringDocument,
  type BusinessCase,
  type PlatformWorkflowVariant,
} from '../../src/workbench/core/document';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const configPath = join(repoRoot, 'midscene.config.ts');

const sampleCase = (overrides: Partial<BusinessCase> = {}): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-V',
  name: '打开设置',
  goal: '验证设置入口可用',
  level: 'level1',
  preconditions: [],
  noPreconditionsDeclared: true,
  actions: [{ id: 'act1', text: '打开系统设置' }],
  expectations: [
    { id: 'exp1', text: '设置页面显示', actionId: 'act1', evidenceKind: 'visual' },
  ],
  sourceRefs: [],
  status: 'unvalidated',
  ...overrides,
});

const setup = (
  yaml: string,
  caseItem: BusinessCase = sampleCase(),
  coverageOverrides: PlatformWorkflowVariant['coverage'] = [
    { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 1, node: 'aiAssert' },
  ],
): { document: AuthoringDocument; variant: PlatformWorkflowVariant } => {
  const document = createEmptyDocument('d-v', '校验演示');
  document.cases.push(caseItem);
  const variant = createVariant('android', document.businessRevision, yaml);
  variant.coverage = coverageOverrides;
  variant.needsUpdate = false;
  document.variants.android = variant;
  return { document, variant };
};

const validYaml = [
  'cases:',
  '  - name: 打开设置',
  '    steps:',
  '      - device.prepare:',
  '          target: home',
  '      - aiAssert: 设置页面显示',
].join('\n');

describe('分层静态检查（无设备/模型 I/O）', () => {
  it('合法工作流四层全部通过', async () => {
    const { document, variant } = setup(validYaml);
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.yaml.status).toBe('passed');
    expect(validation.nodeInputs.status).toBe('passed');
    expect(validation.coverage.status).toBe('passed');
    expect(validation.evidencePaths.status).toBe('passed');
    expect(validation.allPassed).toBe(true);
  });

  it('空工作流与未同步缓冲区返回 not_run', async () => {
    const empty = setup('');
    expect((await runStaticChecks({ configPath, ...empty, platform: 'android' })).yaml.status).toBe('not_run');

    const buffered = setup(validYaml);
    buffered.variant.workflow.invalidYamlBuffer = 'cases: [';
    expect((await runStaticChecks({ configPath, ...buffered, platform: 'android' })).yaml.status).toBe('not_run');
  });

  it('未知节点在 YAML 层被拒绝', async () => {
    const { document, variant } = setup(
      ['cases:', '  - name: x', '    steps:', '      - notANode: {}'].join('\n'),
    );
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.yaml.status).toBe('failed');
    expect(validation.yaml.issues[0]!.message).toContain('notANode');
    expect(validation.nodeInputs.status).toBe('not_run');
  });

  it('Node 输入契约独立报告（非法 wait 时长）', async () => {
    const { document, variant } = setup(
      ['cases:', '  - name: x', '    steps:', '      - wait:', '          duration: -5'].join('\n'),
    );
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.yaml.status).toBe('passed');
    expect(validation.nodeInputs.status).toBe('failed');
    expect(validation.nodeInputs.issues[0]!.node).toBe('wait');
  });

  it('覆盖缺失在覆盖层报告', async () => {
    const { document, variant } = setup(validYaml, sampleCase(), []);
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.coverage.status).toBe('failed');
    expect(validation.coverage.issues[0]!.expectationId).toBe('exp1');
    expect(validation.allPassed).toBe(false);
  });

  it('状态变化证据缺少已验证路径时保留缺口，不进入就绪', async () => {
    const caseItem = sampleCase({
      expectations: [
        { id: 'exp1', text: '音量值增加 1 格', actionId: 'act1', evidenceKind: 'state-change' },
      ],
    });
    const { document, variant } = setup(validYaml, caseItem, [
      { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 0, node: 'aiAssert' },
    ]);
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.evidencePaths.status).toBe('failed');
    expect(validation.evidencePaths.issues[0]!.message).toContain('数据读取/传递/比较');
    expect(validation.allPassed).toBe(false);
  });

  it('视觉证据映射到非断言节点时报告缺口', async () => {
    const { document, variant } = setup(validYaml, sampleCase(), [
      { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 0, node: 'aiAct' },
    ]);
    const validation = await runStaticChecks({ configPath, document, platform: 'android', variant });
    expect(validation.evidencePaths.status).toBe('failed');
    expect(validation.evidencePaths.issues[0]!.message).toContain('aiAssert');
  });
});
