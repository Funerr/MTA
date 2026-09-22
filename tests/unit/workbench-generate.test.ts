import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import YAML from 'yaml';
import { chatJson, ModelCallError, parseJsonContent } from '../../src/workbench/core/model/client';
import { generatePlatformWorkflow } from '../../src/workbench/core/generate/generate';
import { loadProjectGenerationContext, nodeNamesFromReference } from '../../src/workbench/core/generate/context';
import { compileGenerationIntoVariant } from '../../src/workbench/core/generate/compile';
import type { ModelOutput } from '../../src/workbench/core/generate/schema';
import {
  createEmptyDocument,
  createVariant,
  type AuthoringDocument,
  type BusinessCase,
} from '../../src/workbench/core/document';
import { TaskRegistry } from '../../src/workbench/server/tasks';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const endpoint = {
  baseUrl: 'https://model.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (content: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('模型调用边界', () => {
  it('解析普通与围栏 JSON 响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('{"ok":true,"value":42}')),
    );
    const plain = await chatJson<{ ok: boolean }>(endpoint, { messages: [] });
    expect(plain).toEqual({ ok: true, value: 42 });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          jsonResponse('前置说明\n```json\n{"cases":[]}\n```\n后置'),
      ),
    );
    const fenced = await chatJson<{ cases: unknown[] }>(endpoint, { messages: [] });
    expect(fenced).toEqual({ cases: [] });
  });

  it('HTTP 错误、中止、非法响应与未配置分别报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );
    await expect(chatJson(endpoint, { messages: [] })).rejects.toMatchObject({
      kind: 'http',
      status: 503,
    });

    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        return fetch('https://model.example.com/v1/chat/completions', init);
      }),
    );
    await expect(
      chatJson(endpoint, { messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('完全不是 JSON')));
    await expect(chatJson(endpoint, { messages: [] })).rejects.toMatchObject({
      kind: 'invalid-response',
    });

    await expect(chatJson(null, { messages: [] })).rejects.toMatchObject({
      kind: 'not-configured',
    });
  });

  it('parseJsonContent 直接可用', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonContent('```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(() => parseJsonContent('nope')).toThrow(ModelCallError);
  });

  it('parseJsonContent 容忍说明文字、数组根与多个围栏片段', () => {
    // 前后夹杂说明文字（GLM 等不带 response_format 的模型常见输出）
    expect(parseJsonContent('好的，以下是识别结果：{"cases":[]} 请核对。')).toEqual({
      cases: [],
    });
    // 字符串内包含 } 不影响平衡提取
    expect(parseJsonContent('前言 {"a":{"b":"含}括号"}} 结尾')).toEqual({
      a: { b: '含}括号' },
    });
    // 数组根
    expect(parseJsonContent('前缀 [{"x":1}] 后缀')).toEqual([{ x: 1 }]);
    // 多个围栏片段：取第一个
    expect(
      parseJsonContent('```json\n{"first":1}\n```\n说明\n```json\n{"second":2}\n```'),
    ).toEqual({ first: 1 });
  });

  it('parseJsonContent 修复字符串值内未转义的换行与引号', () => {
    // 真实模型缺陷：整段 YAML 塞进 JSON 字符串，换行未转义、
    // YAML 自身的双引号也未转义。
    const broken = [
      '```json',
      '{"cases":[{"workflowYaml":"cases:',
      '  - name: "打开设置"',
      '    steps:',
      '      - launch: x","coverage":[{"expectationId":"exp1","covered":true,"reason":null}]}]}',
      '```',
    ].join('\n');
    const parsed = parseJsonContent<{ cases: { workflowYaml: string }[] }>(broken);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0]!.workflowYaml).toContain('- name: "打开设置"');
    expect(parsed.cases[0]!.workflowYaml).toContain('- launch: x');
  });
});

describe('项目规则与 Node 契约加载', () => {
  it('从当前项目加载 Skill 规则与平台 Node 参考', async () => {
    const context = await loadProjectGenerationContext(repoRoot, 'android');
    expect(context.missing).toEqual([]);
    expect(context.skillRules).toContain('用例转换为 MTA YAML');
    expect(context.conversionContract).toContain('转换交付');
    expect(context.yamlGuide).toContain('cases');
    expect(context.nodeReference).toContain('aiAct');
    const nodes = nodeNamesFromReference(context.nodeReference);
    expect(nodes).toContain('aiAct');
    expect(nodes).toContain('aiAssert');
    expect(nodes).toContain('runAdbShell');
    expect(nodes).not.toContain('runHdcShell');

    const harmony = await loadProjectGenerationContext(repoRoot, 'harmony');
    expect(nodeNamesFromReference(harmony.nodeReference)).toContain('runHdcShell');
  });
});

const sampleCase = (): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-001',
  name: '打开设置',
  goal: '验证设置入口可用',
  level: 'level1',
  preconditions: [],
  noPreconditionsDeclared: true,
  actions: [{ id: 'act1', text: '打开系统设置' }],
  expectations: [
    { id: 'exp1', text: '设置页面显示且蓝牙开关可见', actionId: 'act1', evidenceKind: 'visual' },
  ],
  sourceRefs: [],
  status: 'draft',
});

const validOutput = (): ModelOutput => ({
  cases: [
    {
      caseId: 'case1',
      workflowYaml: [
        'cases:',
        '  - name: 打开设置',
        '    steps:',
        '      - aiAct: 打开系统设置',
        '      - aiAssert: 设置页面显示且蓝牙开关可见',
      ].join('\n'),
      coverage: [
        {
          expectationId: 'exp1',
          covered: true,
          caseIndex: 0,
          stepIndex: 1,
          node: 'aiAssert',
        },
      ],
      actionMapping: [{ actionId: 'act1', stepIndices: [0] }],
      rewrites: [],
      issues: [],
    },
  ],
});

describe('生成编排与编译', () => {
  it('结构化输出通过校验后编译进平台变体', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(JSON.stringify(validOutput()))),
    );
    const document = createEmptyDocument('d-gen', '生成演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;
    const context = await loadProjectGenerationContext(repoRoot, 'android');

    const outcome = await generatePlatformWorkflow({
      endpoint,
      context,
      document,
      platform: 'android',
      variant,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const report = compileGenerationIntoVariant({ document, variant, output: outcome.output });

    expect(report.caseStatuses['case1']).toBe('unvalidated');
    expect(report.mergedCaseCount).toBe(1);
    expect(document.cases[0]!.status).toBe('unvalidated');
    expect(variant.needsUpdate).toBe(false);
    expect(variant.workflow.basedOnBusinessRevision).toBe(document.businessRevision);

    const merged = YAML.parse(variant.workflow.yaml) as {
      cases: { name: string; steps: unknown[] }[];
    };
    expect(merged.cases).toHaveLength(1);
    expect(merged.cases[0]!.name).toBe('打开设置');
    // 覆盖映射换算为全局索引
    expect(variant.coverage).toEqual([
      {
        expectationId: 'exp1',
        covered: true,
        caseIndex: 0,
        stepIndex: 1,
        node: 'aiAssert',
        reason: undefined,
      },
    ]);
    // 生成头注释保留
    expect(variant.workflow.yaml).toContain('由 MTA 编写工作台生成');
  });

  it('模型输出不符合结构契约时报 invalid-response，文档保持原样', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('{"cases":[{"caseId":"case1"}]}')),
    );
    const document = createEmptyDocument('d-gen', '生成演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;
    const context = await loadProjectGenerationContext(repoRoot, 'android');

    const outcome = await generatePlatformWorkflow({
      endpoint,
      context,
      document,
      platform: 'android',
      variant,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('invalid-response');
    // 未编译：变体 YAML 仍为空
    expect(variant.workflow.yaml).toBe('');
    expect(variant.workflow.revision).toBe(1);
  });

  it('精确预期未被逐字保留时标记待澄清，不静默放宽', () => {
    const document = createEmptyDocument('d-gen', '放宽演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);
    document.variants.android = variant;

    const output = validOutput();
    output.cases[0]!.workflowYaml = output.cases[0]!.workflowYaml.replace(
      '设置页面显示且蓝牙开关可见',
      '设置页面显示',
    );
    output.cases[0]!.coverage[0]!.covered = true;

    const report = compileGenerationIntoVariant({ document, variant, output });
    expect(report.flaggedExpectations).toContain('exp1');
    expect(report.caseStatuses['case1']).toBe('needs_clarification');
    expect(
      document.issues.some((issue) => issue.message.includes('未逐字体现')),
    ).toBe(true);
    // 状态不进入 ready
    expect(document.cases[0]!.status).not.toBe('ready');
  });

  it('缺包名/缺数据列为 blocking 问题；能力缺口列为 unsupported', () => {
    const document = createEmptyDocument('d-gen', '问题演示');
    document.cases.push(sampleCase());
    const variant = createVariant('android', document.businessRevision);

    const blockingOutput = validOutput();
    blockingOutput.cases[0]!.issues = [
      { field: 'appContext.packageName', message: '应用包名未知，无法生成 launch 步骤', needed: '提供 Android 包名', kind: 'blocking' },
    ];
    const reportA = compileGenerationIntoVariant({
      document,
      variant,
      output: blockingOutput,
    });
    expect(reportA.caseStatuses['case1']).toBe('needs_clarification');
    expect(
      document.issues.some((issue) => issue.needed === '提供 Android 包名'),
    ).toBe(true);

    const capabilityOutput = validOutput();
    capabilityOutput.cases[0]!.issues = [
      { field: 'expectations/exp1', message: '需要比较操作前后数值，当前契约未验证数据传递能力', kind: 'capability' },
    ];
    const documentB = createEmptyDocument('d-gen2', '能力演示');
    documentB.cases.push(sampleCase());
    const variantB = createVariant('android', documentB.businessRevision);
    const reportB = compileGenerationIntoVariant({
      document: documentB,
      variant: variantB,
      output: capabilityOutput,
    });
    expect(reportB.caseStatuses['case1']).toBe('unsupported');
  });

  it('非法片段保持草稿；模型漏掉的用例标记待澄清', () => {
    const document = createEmptyDocument('d-gen', '缺漏演示');
    document.cases.push(sampleCase());
    const second = { ...sampleCase(), id: 'case2', name: '第二条' };
    document.cases.push(second);
    const variant = createVariant('android', document.businessRevision);

    const output = validOutput();
    output.cases[0]!.workflowYaml = 'cases: [ 这不是合法结构';
    // case2 模型没有返回
    const report = compileGenerationIntoVariant({ document, variant, output });

    expect(report.caseStatuses['case1']).toBe('unvalidated');
    expect(report.caseStatuses['case2']).toBe('needs_clarification');
    expect(report.mergedCaseCount).toBe(0);
    expect(
      document.issues.some((issue) => issue.message.includes('模型未生成该用例')),
    ).toBe(true);
    expect(
      document.issues.some((issue) => issue.message.includes('无法解析')),
    ).toBe(true);
  });
});

describe('任务注册表', () => {
  it('完成、失败与取消的生命周期', async () => {
    const registry = new TaskRegistry();

    const done = registry.start('test', async ({ report }) => {
      report('第一步');
      return { value: 1 };
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ value: 1 });
    expect(done.progress.map((p) => p.message)).toContain('第一步');

    const failed = registry.start('test', async () => {
      throw new Error('任务失败原因');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('任务失败原因');

    let release: ((value: unknown) => void) | undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const cancellable = registry.start('test', async ({ signal }) => {
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        void gate.then(resolve);
      });
      return { late: true };
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    registry.cancel(cancellable.id);
    release?.(undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancellable.status).toBe('cancelled');
  });

  it('订阅者在状态变化时收到通知', async () => {
    const registry = new TaskRegistry();
    const events: string[] = [];
    const task = registry.start('test', async ({ report }) => {
      report('进展');
      return null;
    });
    registry.subscribe(task.id, (t) => events.push(t.status));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toContain('completed');
  });
});
