import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createWorkbenchApp } from '../../src/workbench/server/app';
import { loadWorkbenchConfig } from '../../src/workbench/server/config';
import { ModelConfigStore } from '../../src/workbench/server/model-config';
import { createRouteTable, createStreamRoutes } from '../../src/workbench/server/routes';
import { TaskRegistry } from '../../src/workbench/server/tasks';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import { VerifyService } from '../../src/workbench/server/verify-service';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import { mergeGeneratedCases } from '../../src/workbench/core/generate/merge';
import {
  createEmptyDocument,
  createVariant,
  type AuthoringDocument,
  type BusinessCase,
} from '../../src/workbench/core/document';
import { compileGenerationIntoVariant } from '../../src/workbench/core/generate/compile';
import type { ModelOutput } from '../../src/workbench/core/generate/schema';

afterEach(() => {
  vi.unstubAllGlobals();
});

const caseA = (): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-A',
  name: '用例A',
  goal: '',
  level: 'level1',
  preconditions: [],
  noPreconditionsDeclared: true,
  actions: [{ id: 'act1', text: '打开设置' }],
  expectations: [
    { id: 'exp1', text: '设置页面显示', actionId: 'act1', evidenceKind: 'visual' },
  ],
  sourceRefs: [],
  status: 'draft',
});

const caseB = (): BusinessCase => ({
  ...caseA(),
  id: 'case2',
  sourceId: 'TC-B',
  name: '用例B',
  expectations: [
    { id: 'exp2', text: '主屏显示', actionId: 'act1', evidenceKind: 'visual' },
  ],
});

const fragment = (name: string, assertText: string) => [
  'cases:',
  `  - name: ${name}`,
  '    steps:',
  `      - aiAssert: ${assertText}`,
].join('\n');

describe('mergeGeneratedCases：局部合并语义', () => {
  it('只替换目标用例，其他用例与注释保留；新用例追加', async () => {
    const document = createEmptyDocument('d-m', '合并演示');
    document.cases.push(caseA(), caseB());
    const variant = createVariant('android', document.businessRevision);

    const initial: ModelOutput = {
      cases: [
        {
          caseId: 'case1',
          workflowYaml: fragment('用例A', '设置页面显示'),
          actionMapping: [{ actionId: 'act1', stepIndices: [0] }],
          coverage: [{ expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 0, node: 'aiAssert' }],
          rewrites: [],
          issues: [],
        },
        {
          caseId: 'case2',
          workflowYaml: fragment('用例B', '主屏显示'),
          actionMapping: [],
          coverage: [{ expectationId: 'exp2', covered: true, caseIndex: 1, stepIndex: 0, node: 'aiAssert' }],
          rewrites: [],
          issues: [],
        },
      ],
    };
    compileGenerationIntoVariant({ document, variant, output: initial });
    expect(variant.workflow.mergedCaseIds).toEqual(['case1', 'case2']);

    // 人工给用例A的 YAML 加注释
    variant.workflow.yaml = variant.workflow.yaml.replace(
      'cases:',
      '# 人工注释：不要丢失\ncases:',
    );

    // 局部合并：仅替换 case2
    const report = mergeGeneratedCases({
      document,
      variant,
      cases: [
        {
          caseId: 'case2',
          workflowYaml: fragment('用例B-新版', '主屏完整显示且时间正确'),
          actionMapping: [],
          coverage: [{ expectationId: 'exp2', covered: true, caseIndex: 1, stepIndex: 0, node: 'aiAssert' }],
        },
      ],
    });

    expect(report.replaced).toEqual(['case2']);
    expect(report.failed).toEqual([]);
    // 人工注释保留；未合并的用例A内容原样
    expect(variant.workflow.yaml).toContain('# 人工注释：不要丢失');
    expect(variant.workflow.yaml).toContain('用例A');
    expect(variant.workflow.yaml).toContain('用例B-新版');
    // 用例B 原文预期被改写 → 防线标记
    expect(report.flaggedExpectations).toContain('exp2');
    expect(document.cases.find((c) => c.id === 'case2')!.status).toBe(
      'needs_clarification',
    );
    // 用例A 状态与覆盖不被局部合并破坏
    expect(variant.coverage.find((c) => c.expectationId === 'exp1')?.covered).toBe(true);
    expect(variant.workflow.revision).toBeGreaterThan(1);
  });
});

describe('生成任务与人工编辑冲突（HTTP 层）', () => {
  let tempRoot: string;
  let server: Server;
  let baseUrl: string;
  let documents: DocumentStore;

  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-conflict-'));
    const workspace = new Workspace(join(tempRoot, 'ws'));
    const config = loadWorkbenchConfig(
      {},
      { projectRoot: tempRoot, startDir: tempRoot },
    );
    documents = new DocumentStore(workspace);
    const context = {
      config,
      workspace,
      modelConfig: new ModelConfigStore(workspace),
      documents,
      tasks: new TaskRegistry(),
      devices: new DeviceService({}, workspace),
    verify: new VerifyService({
      devices: new DeviceService({}, workspace),
      tasks: new TaskRegistry(),
      documents,
      workspace,
      modelConfig: new ModelConfigStore(workspace),
    }),
    };
    const app = createWorkbenchApp({
      config: { ...config, port: 0 },
      routes: createRouteTable(context),
      streamRoutes: createStreamRoutes(context),
      webDistDir: join(tempRoot, 'no-dist'),
    });
    server = app.server;
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const waitTaskDone = async (taskId: string) => {
    for (let i = 0; i < 100; i += 1) {
      const res = await fetch(`${baseUrl}/api/tasks/${taskId}`);
      const body = (await res.json()) as { task: { status: string } };
      if (body.task.status !== 'running') return body.task;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('task did not finish');
  };

  it('生成期间的人工编辑不被迟到响应覆盖，用户可选择合并', async () => {
    const created = await documents.create('冲突演示');
    const draft: AuthoringDocument = {
      ...created,
      cases: [caseA()],
      variants: {
        android: {
          platform: 'android',
          appContext: { packageName: 'com.android.settings' },
          workflow: {
            revision: 1,
            basedOnBusinessRevision: created.businessRevision,
            yaml: fragment('用例A', '设置页面显示'),
            mergedCaseIds: ['case1'],
          },
          coverage: [],
          evidence: [],
          confirm: { status: 'unconfirmed' },
          needsUpdate: false,
        },
      },
    };
    const base = await documents.save(draft, created.saveVersion);

    // 配置模型
    await fetch(`${baseUrl}/api/model-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authoring: { baseUrl: 'https://model.example.com/v1', apiKey: 'k', model: 'm' },
      }),
    });

    // 慢模型：延迟后返回重新生成的片段
    let releaseModel: ((value: unknown) => void) | undefined;
    const modelGate = new Promise((resolve) => {
      releaseModel = resolve;
    });
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        // 本地工作台请求直通，只拦截模型服务调用。
        if (String(url).includes('127.0.0.1')) {
          return realFetch(url, init);
        }
        if (!String(url).includes('chat/completions')) {
          return new Response('{}', { status: 200 });
        }
        await modelGate;
        const content = JSON.stringify({
          cases: [
            {
              caseId: 'case1',
              workflowYaml: fragment('用例A', '设置页面显示（模型新版）'),
              actionMapping: [],
              coverage: [{ expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 0, node: 'aiAssert' }],
              rewrites: [],
              issues: [],
            },
          ],
        });
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    // 启动局部生成任务
    const startRes = await fetch(`${baseUrl}/api/documents/${base.id}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: base.saveVersion,
        caseIds: ['case1'],
      }),
    });
    expect(startRes.status).toBe(200);
    const { task } = (await startRes.json()) as { task: { id: string } };

    // 生成在途：人工编辑并保存（直接经 store，模拟另一标签页）
    const manual = structuredClone(base);
    manual.variants.android!.workflow.yaml = manual
      .variants.android!.workflow.yaml
      .replace('设置页面显示', '设置页面显示（人工修改）');
    const manualSaved = await documents.save(manual, base.saveVersion);
    expect(manualSaved.saveVersion).toBeGreaterThan(base.saveVersion);

    // 放行模型 → 任务完成，应报告冲突且不覆盖人工编辑
    releaseModel?.(null);
    const done = (await waitTaskDone(task.id)) as unknown as {
      status: string;
      result?: { conflict?: boolean; outputs?: { caseId: string; workflowYaml: string }[] };
    };
    expect(done.status).toBe('completed');
    expect(done.result?.conflict).toBe(true);
    expect(done.result?.outputs).toHaveLength(1);

    const stored = await documents.load(base.id);
    expect(stored.variants.android!.workflow.yaml).toContain('人工修改');

    // 用户选择合并该用例 → 应用到当前文档
    const mergeRes = await fetch(`${baseUrl}/api/documents/${base.id}/merge-generated`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: manualSaved.saveVersion,
        cases: done.result!.outputs,
      }),
    });
    expect(mergeRes.status).toBe(200);
    const merged = (await mergeRes.json()) as { document: AuthoringDocument };
    expect(merged.document.variants.android!.workflow.yaml).toContain('模型新版');
  });
});
