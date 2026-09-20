import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistImportResult,
  extractCasesWithModel,
  needsModelAssist,
} from '../../src/workbench/core/import/assist';
import { emptyResult, type ImportParseResult } from '../../src/workbench/core/import/types';
import { parseTextCases } from '../../src/workbench/core/import/text';

const endpoint = {
  baseUrl: 'https://model.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const modelResponse = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('模型识别兜底判定', () => {
  it('没有用例或所有用例都没有步骤时需要兜底', () => {
    const noCases = parseTextCases('打开设置检查蓝牙开关，一切正常。', 'paste');
    expect(noCases.cases).toHaveLength(0);
    expect(needsModelAssist(noCases)).toBe(true);

    // 规则解析把编号步骤错切为"只有名称没有步骤"的用例 → 仍需兜底
    const misparsed = parseTextCases('1. 打开系统设置\n2. 进入蓝牙页面', 'paste');
    expect(misparsed.cases).toHaveLength(1);
    expect(needsModelAssist(misparsed)).toBe(true);

    const healthy = parseTextCases(
      '编号：TC-001\n步骤：打开系统设置\n预期：设置页面显示',
      'paste',
    );
    expect(healthy.cases).toHaveLength(1);
    expect(healthy.cases[0]!.actions.length).toBeGreaterThan(0);
    expect(needsModelAssist(healthy)).toBe(false);
  });
});

describe('extractCasesWithModel：模型输出归一化', () => {
  it('补齐缺失编号、字符串预期、越界关联与默认等级', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        modelResponse({
          cases: [
            {
              sourceId: '',
              name: '打开设置检查蓝牙开关',
              goal: '验证蓝牙开关可用',
              actions: ['打开系统设置', '进入蓝牙页面并打开开关'],
              expectations: ['蓝牙开关为开启状态', { text: '设置页面显示', actionIndex: 0 }, { text: '越界关联', actionIndex: 9 }],
              level: 'level9',
            },
            { name: '', goal: '', actions: [] },
          ],
          notes: ['原文未给编号'],
        }),
      ),
    );

    const result = await extractCasesWithModel(endpoint, '原始粘贴内容', 'paste');

    expect(result.viaModel).toBe(true);
    expect(result.unconverted).toHaveLength(0);
    expect(result.modelNotes).toEqual(['原文未给编号']);
    // 全空条目被丢弃；识别说明提示人工核对
    expect(result.cases).toHaveLength(1);
    expect(result.issues.some((issue) => issue.message.includes('人工核对'))).toBe(true);

    const draft = result.cases[0]!;
    expect(draft.sourceId).toBe('AI-01');
    expect(draft.level).toBe('level2');
    expect(draft.actions).toEqual(['打开系统设置', '进入蓝牙页面并打开开关']);
    expect(draft.expectations).toEqual([
      { text: '蓝牙开关为开启状态', actionIndex: undefined },
      { text: '设置页面显示', actionIndex: 0 },
      // 越界 actionIndex 归一化为整条用例
      { text: '越界关联', actionIndex: undefined },
    ]);
    expect(draft.sourceRange).toBe('模型识别');
    expect(draft.excerpt).toBe('原始粘贴内容');
  });

  it('文本不是用例时保留 0 条结果与模型说明，不报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        modelResponse({ cases: [], notes: ['文本不是测试用例'] }),
      ),
    );
    const result = await extractCasesWithModel(endpoint, '今天天气不错', 'paste');
    expect(result.cases).toHaveLength(0);
    expect(result.viaModel).toBe(true);
    expect(result.modelNotes).toEqual(['文本不是测试用例']);
  });

  it('非法模型输出报结构契约错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => modelResponse({ cases: '不是一个数组' })),
    );
    await expect(extractCasesWithModel(endpoint, '内容', 'paste')).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
});

describe('assistImportResult：兜底编排', () => {
  it('规则结果健康时原样返回且不调用模型', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const healthy = parseTextCases(
      '编号：TC-001\n步骤：打开系统设置\n预期：设置页面显示',
      'paste',
    );
    const result = await assistImportResult('paste', '内容', healthy, endpoint);
    expect(result).toBe(healthy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Excel 不走模型兜底', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const excelResult = emptyResult('excel');
    const result = await assistImportResult('excel', '', excelResult, endpoint);
    expect(result).toBe(excelResult);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('模型未配置时保留规则结果并追加可操作提示', async () => {
    const misparsed = parseTextCases('1. 打开系统设置\n2. 进入蓝牙页面', 'paste');
    const result = await assistImportResult('paste', '内容', misparsed, null);
    expect(result.cases).toHaveLength(1);
    expect(
      result.issues.some((issue) => issue.message.includes('模型配置')),
    ).toBe(true);
  });

  it('模型失败时回退规则结果并记录原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const misparsed = parseTextCases('1. 打开系统设置\n2. 进入蓝牙页面', 'paste');
    const result = await assistImportResult('paste', '内容', misparsed, endpoint);
    expect(result).toBe(misparsed);
    expect(
      result.issues.some((issue) => issue.message.includes('模型识别失败')),
    ).toBe(true);
  });

  it('识别不出结构时返回模型识别结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        modelResponse({
          cases: [
            {
              sourceId: 'TC-201',
              name: '打开设置并检查蓝牙开关',
              actions: ['打开系统设置', '进入蓝牙页面', '打开蓝牙开关'],
              expectations: [{ text: '蓝牙开关变为开启状态', actionIndex: 2 }],
            },
          ],
        }),
      ),
    );
    const unrecognized = parseTextCases(
      '打开设置检查蓝牙开关：先进入系统设置，再进入蓝牙页面，打开开关。',
      'paste',
    );
    const result = await assistImportResult('paste', '原文', unrecognized, endpoint);
    expect(result.viaModel).toBe(true);
    expect(result.cases).toEqual([
      expect.objectContaining({
        sourceId: 'TC-201',
        actions: ['打开系统设置', '进入蓝牙页面', '打开蓝牙开关'],
      }),
    ]);
  });
});
