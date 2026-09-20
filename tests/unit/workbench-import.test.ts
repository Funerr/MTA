import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyImport } from '../../src/workbench/core/import/apply';
import { parseMarkdownCases } from '../../src/workbench/core/import/markdown';
import { parseTextCases } from '../../src/workbench/core/import/text';
import type { ImportParseResult } from '../../src/workbench/core/import/types';
import { createEmptyDocument, createVariant } from '../../src/workbench/core/document';

const fixturesDir = fileURLToPath(new URL('../fixtures/workbench', import.meta.url));

const readFixture = (name: string) =>
  readFile(`${fixturesDir}/${name}`, 'utf8');

describe('整段粘贴 / 纯文本导入：跨段用例夹具', () => {
  let result: ImportParseResult;

  it('解析出跨行步骤、重复编号与空预期，并保留原文与来源范围', async () => {
    const text = await readFixture('text-cross-segment.txt');
    result = parseTextCases(text, 'paste');

    // 三条用例：TC-001（重号第一条）、TC-001（重号第二条）、TC-003
    expect(result.cases).toHaveLength(3);

    const first = result.cases[0]!;
    expect(first.sourceId).toBe('TC-001');
    expect(first.name).toBe('打开设置并检查蓝牙开关');
    expect(first.goal).toBe('验证设置入口与蓝牙开关可见');
    expect(first.preconditions).toEqual(['设备已解锁', '已连接一台设备']);
    // 跨行步骤：第 2 步包含续写行
    expect(first.actions).toEqual([
      '打开系统设置',
      '进入蓝牙页面 查看蓝牙开关状态',
    ]);
    // 显式“步骤N：”关联
    expect(first.expectations).toEqual([
      { text: '设置页面显示', actionIndex: 0 },
      { text: '蓝牙开关可见且为关闭状态', actionIndex: 1 },
    ]);
    expect(first.sourceRange).toBe('L1-L11');
    // 原文保留
    expect(first.excerpt).toContain('编号：TC-001');
    expect(first.excerpt).toContain('查看蓝牙开关状态');

    // 重号：两条 TC-001 各自保留原编号
    const duplicated = result.cases.filter((c) => c.sourceId === 'TC-001');
    expect(duplicated).toHaveLength(2);
    expect(
      result.issues.some((issue) => issue.message.includes('TC-001 重复')),
    ).toBe(true);

    // 空预期不自动填充：TC-003 没有预期，也不继承上一条
    const third = result.cases[2]!;
    expect(third.expectations).toEqual([]);
    expect(
      result.issues.some((issue) => issue.message.includes('空的预期段')),
    ).toBe(true);

    // 未转换清单：结尾游离文本
    expect(
      result.unconverted.some(
        (block) =>
          block.excerpt.includes('不属于任何用例') &&
          block.reason.includes('无法识别'),
      ),
    ).toBe(true);
  });

  it('无结构的整段文本全部进入未转换清单', () => {
    const result = parseTextCases('今天天气不错\n明天继续加油', 'text');
    expect(result.cases).toHaveLength(0);
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0]!.reason).toContain('未识别出任何用例结构');
  });
});

describe('Markdown 导入：跨段用例夹具', () => {
  it('表格、标题分节、代码块与空白预期按规则处理', async () => {
    const markdown = await readFixture('markdown-cross-segment.md');
    const result = parseMarkdownCases(markdown);

    // 表格 3 行 + 标题分节 1 条
    expect(result.cases).toHaveLength(4);

    const tableCase = result.cases[0]!;
    expect(tableCase.sourceId).toBe('TC-101');
    expect(tableCase.actions).toEqual(['打开设置', '查看蓝牙开关']);
    // 预期与步骤数量一致 → 按顺序关联
    expect(tableCase.expectations).toEqual([
      { text: '设置页面显示', actionIndex: 0 },
      { text: '蓝牙开关可见', actionIndex: 1 },
    ]);
    expect(tableCase.level).toBe('level1');
    expect(tableCase.sourceRange).toBe('表1/第2行');
    // 原文行保留
    expect(tableCase.excerpt).toContain('TC-101');

    // 重号 TC-102
    expect(result.cases.filter((c) => c.sourceId === 'TC-102')).toHaveLength(2);
    expect(
      result.issues.some((issue) => issue.message.includes('TC-102 重复')),
    ).toBe(true);

    // 空白预期单元格：不向下填充，记录问题
    const blankExpectation = result.cases[2]!;
    expect(blankExpectation.expectations).toEqual([]);
    expect(
      result.issues.some((issue) => issue.message.includes('未从上一行填充')),
    ).toBe(true);

    // 标题分节用例
    const sectionCase = result.cases[3]!;
    expect(sectionCase.sourceId).toBe('TC-103');
    expect(sectionCase.name).toBe('分段用例（标题分节）');
    expect(sectionCase.actions).toEqual(['打开设置', '返回主屏']);

    // 代码块进入未转换清单
    expect(
      result.unconverted.some((block) => block.reason.includes('代码块')),
    ).toBe(true);
    // 游离文本进入未转换清单
    expect(
      result.unconverted.some((block) =>
        block.excerpt.includes('游离文本'),
      ),
    ).toBe(true);
  });
});

describe('applyImport：应用到编写文档', () => {
  it('分配唯一稳定 ID、保留来源引用并推进修订', async () => {
    const text = await readFixture('text-cross-segment.txt');
    const parsed = parseTextCases(text, 'text');

    const document = createEmptyDocument('d-import', '导入演示');
    document.variants.android = createVariant('android', document.businessRevision);
    const beforeRevision = document.businessRevision;

    const source = {
      id: 'src-1',
      kind: 'text' as const,
      name: 'text-cross-segment.txt',
      file: 'uploads/src-1-text-cross-segment.txt',
      importedAt: '2026-01-01T00:00:00Z',
    };
    const report = applyImport(document, parsed, source, '2026-01-02T00:00:00Z');

    expect(report.addedCases).toBe(3);
    expect(document.cases).toHaveLength(3);
    expect(document.businessRevision).toBe(beforeRevision + 1);
    expect(document.variants.android?.needsUpdate).toBe(true);
    expect(document.sources).toContainEqual(source);

    // 稳定 ID 唯一
    const ids = document.cases.flatMap((c) => [
      c.id,
      ...c.actions.map((a) => a.id),
      ...c.expectations.map((e) => e.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);

    // 来源对应：每条用例带 sourceId + 范围 + 原文片段
    for (const caseItem of document.cases) {
      expect(caseItem.sourceRefs).toHaveLength(1);
      expect(caseItem.sourceRefs[0]!.sourceId).toBe('src-1');
      expect(caseItem.sourceRefs[0]!.range).toMatch(/^L\d+-L\d+$/);
      expect(caseItem.sourceRefs[0]!.excerpt!.length).toBeGreaterThan(0);
    }

    // 预期关联映射到真实步骤 ID
    const first = document.cases[0]!;
    expect(first.actions.map((a) => a.id)).toEqual(['act1', 'act2']);
    expect(first.expectations.map((e) => e.actionId)).toEqual(['act1', 'act2']);

    // 解析问题与未转换清单进入 issues
    expect(document.issues.length).toBeGreaterThan(0);
    expect(
      document.issues.some((issue) => issue.message.includes('未转换')),
    ).toBe(true);
  });
});
