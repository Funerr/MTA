import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  buildCardView,
  cardViewToYaml,
  deleteStep,
  insertStep,
  CardEditError,
  updateCardNodeInput,
} from '../../src/workbench/core/cards/mapping';
import { compileGenerationIntoVariant } from '../../src/workbench/core/generate/compile';
import { createEmptyDocument, createVariant } from '../../src/workbench/core/document';
import type { ModelOutput } from '../../src/workbench/core/generate/schema';

const anchoredYaml = [
  '# 由工作台生成',
  'cases:',
  '  - name: 打开设置',
  '    steps:',
  '      # @step act1',
  '      - device.prepare:',
  '          target: home',
  '      - launch: com.android.settings',
  '      # @step act2',
  '      - aiAct: 查看蓝牙开关状态',
  '      - aiAssert: 蓝牙开关可见',
  '      - terminate: com.android.settings',
].join('\n');

describe('卡片投影：锚点分组与原始块', () => {
  it('按 @step 锚点分组，一对多映射；未锚点步骤为独立卡片', () => {
    const result = buildCardView(anchoredYaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { cards } = result.view;

    // 规则：锚点开启分组；其后未锚点步骤归入当前分组直到下一个锚点。
    expect(cards.map((card) => card.actionId ?? '(free)')).toEqual([
      'act1',
      'act2',
    ]);
    // act1 → 两个节点（prepare + launch）
    expect(cards[0]!.nodes.map((n) => n.node)).toEqual(['device.prepare', 'launch']);
    // act2 → 动作 + 断言 + 收尾（未锚点步骤延续当前分组）
    expect(cards[1]!.nodes.map((n) => n.node)).toEqual([
      'aiAct',
      'aiAssert',
      'terminate',
    ]);
  });

  it('device.parallel 与生命周期段进入原始块，原文保留', () => {
    const yaml = [
      'beforeAll:',
      '  - device.prepare:',
      '      target: home',
      'cases:',
      '  - name: 并行场景',
      '    steps:',
      '      - device.parallel:',
      '          steps:',
      '            - DUT1.home: {}',
      '            - DUT2.home: {}',
      '      - aiAssert: 主屏显示',
    ].join('\n');
    const result = buildCardView(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { cards, rawBlocks, lifecycleSections } = result.view;

    expect(lifecycleSections).toEqual(['beforeAll']);
    expect(rawBlocks.some((b) => b.reason.includes('生命周期段 beforeAll'))).toBe(true);
    expect(rawBlocks.some((b) => b.reason.includes('device.parallel'))).toBe(true);
    expect(rawBlocks.find((b) => b.reason.includes('device.parallel'))!.text).toContain(
      'DUT1.home',
    );
    // 可编辑卡片仍包含 aiAssert
    expect(cards.flatMap((c) => c.nodes.map((n) => n.node))).toContain('aiAssert');
  });

  it('非法 YAML 返回错误', () => {
    expect(buildCardView('cases: [').ok).toBe(false);
    expect(buildCardView('plain string').ok).toBe(false);
    expect(buildCardView('cases: {}').ok).toBe(false);
  });
});

describe('卡片编辑与双向往返', () => {
  it('更新输入后重投影语义一致，注释锚点保留', () => {
    const result = buildCardView(anchoredYaml);
    if (!result.ok) throw new Error('build failed');
    const { view } = result;
    const before = JSON.parse(JSON.stringify(view.cards));

    // 写回相同值 + 修改一个输入
    updateCardNodeInput(view.document, 0, 2, '打开系统设置并进入蓝牙');
    const updatedText = cardViewToYaml(view.document);

    const rebuilt = buildCardView(updatedText);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const after = JSON.parse(JSON.stringify(rebuilt.view.cards));

    // 修改生效
    const aiActCard = rebuilt.view.cards.find((c) => c.actionId === 'act2')!;
    expect(aiActCard.nodes[0]!.input).toBe('打开系统设置并进入蓝牙');
    // 其余卡片与锚点结构一致（除被修改的字段）
    expect(after).toHaveLength(before.length);
    expect(after.map((c: { actionId?: string }) => c.actionId)).toEqual(
      before.map((c: { actionId?: string }) => c.actionId),
    );
    // 头注释保留
    expect(updatedText).toContain('# 由工作台生成');
    expect(updatedText).toContain('@step act1');
  });

  it('$ 元数据在输入更新时保留', () => {
    const yaml = [
      'cases:',
      '  - name: 带超时',
      '    steps:',
      '      - aiAssert:',
      '          prompt: 页面显示',
      '          $:',
      '            timeout: 3000',
    ].join('\n');
    const result = buildCardView(yaml);
    if (!result.ok) throw new Error('build failed');
    const { view } = result;
    expect(view.cards[0]!.nodes[0]!.meta).toEqual({ timeout: 3000 });

    updateCardNodeInput(view.document, 0, 0, { prompt: '页面完整显示' });
    const text = cardViewToYaml(view.document);
    const parsed = YAML.parse(text) as {
      cases: { steps: { aiAssert: Record<string, unknown> }[] }[];
    };
    expect(parsed.cases[0]!.steps[0]!.aiAssert.prompt).toBe('页面完整显示');
    expect(parsed.cases[0]!.steps[0]!.aiAssert.$).toEqual({ timeout: 3000 });
  });

  it('插入与删除步骤往返一致', () => {
    const result = buildCardView(anchoredYaml);
    if (!result.ok) throw new Error('build failed');
    const { view } = result;

    insertStep(view.document, 0, 2, 'wait', { duration: 1000 }, 'act2');
    let rebuilt = buildCardView(cardViewToYaml(view.document));
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    let act2 = rebuilt.view.cards.find((c) => c.actionId === 'act2')!;
    expect(act2.nodes.map((n) => n.node)).toContain('wait');

    // 删除 wait 节点（按节点名定位其步骤索引）
    const waitIndex = act2.nodes.find((n) => n.node === 'wait')!.stepIndex;
    expect(deleteStep(view.document, 0, waitIndex)).toBe(true);
    rebuilt = buildCardView(cardViewToYaml(view.document));
    if (!rebuilt.ok) return;
    act2 = rebuilt.view.cards.find((c) => c.actionId === 'act2')!;
    expect(act2.nodes.map((n) => n.node)).not.toContain('wait');
  });

  it('非法编辑目标抛出明确错误', () => {
    const result = buildCardView(anchoredYaml);
    if (!result.ok) throw new Error('build failed');
    expect(() => updateCardNodeInput(result.view.document, 9, 0, 'x')).toThrow(
      CardEditError,
    );
    expect(() => updateCardNodeInput(result.view.document, 0, 99, 'x')).toThrow(
      CardEditError,
    );
  });
});

describe('编译输出与卡片视图衔接', () => {
  it('compile 写入 @step 锚点，卡片视图按业务步骤分组', () => {
    const document = createEmptyDocument('d-card', '卡片演示');
    document.cases.push({
      id: 'case1',
      sourceId: 'TC-C',
      name: '打开设置',
      goal: '',
      level: 'level1',
      preconditions: [],
      noPreconditionsDeclared: true,
      actions: [
        { id: 'act1', text: '打开设置' },
        { id: 'act2', text: '检查蓝牙' },
      ],
      expectations: [
        { id: 'exp1', text: '蓝牙开关可见', actionId: 'act2', evidenceKind: 'visual' },
      ],
      sourceRefs: [],
      status: 'draft',
    });
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;

    const output: ModelOutput = {
      cases: [
        {
          caseId: 'case1',
          workflowYaml: [
            'cases:',
            '  - name: 打开设置',
            '    steps:',
            '      - device.prepare:',
            '          target: home',
            '      - launch: com.android.settings',
            '      - aiAssert: 蓝牙开关可见',
          ].join('\n'),
          actionMapping: [
            { actionId: 'act1', stepIndices: [0, 1] },
            { actionId: 'act2', stepIndices: [2] },
          ],
          coverage: [
            { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 2, node: 'aiAssert' },
          ],
          rewrites: [],
          issues: [],
        },
      ],
    };

    compileGenerationIntoVariant({ document, variant, output });
    expect(variant.workflow.yaml).toContain('@step act1');

    const result = buildCardView(variant.workflow.yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { cards } = result.view;
    expect(cards).toHaveLength(2);
    expect(cards[0]!.actionId).toBe('act1');
    expect(cards[0]!.nodes).toHaveLength(2);
    expect(cards[1]!.actionId).toBe('act2');
  });
});
