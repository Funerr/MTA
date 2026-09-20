import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import YAML from 'yaml';
import { createWorkbenchApp } from '../../src/workbench/server/app';
import { loadWorkbenchConfig } from '../../src/workbench/server/config';
import { ModelConfigStore } from '../../src/workbench/server/model-config';
import { createRouteTable, createStreamRoutes } from '../../src/workbench/server/routes';
import { TaskRegistry } from '../../src/workbench/server/tasks';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import { VerifyService } from '../../src/workbench/server/verify-service';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import type { AuthoringDocument } from '../../src/workbench/core/document';

let tempRoot: string;
let server: Server;
let baseUrl: string;
let workspace: Workspace;
let documents: DocumentStore;

const anchoredYaml = [
  'cases:',
  '  - name: 打开设置',
  '    steps:',
  '      # @step act1',
  '      - device.prepare:',
  '          target: home',
  '      - launch: com.android.settings',
  '      # @step act2',
  '      - aiAssert: 蓝牙开关可见',
  '      - device.parallel:',
  '          steps:',
  '            - DUT1.home: {}',
  '            - DUT2.home: {}',
].join('\n');

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-wf-'));
  workspace = new Workspace(join(tempRoot, 'ws'));
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

async function createPreparedDocument(): Promise<{
  id: string;
  saveVersion: number;
}> {
  const created = await documents.create(`工作流路由 ${Date.now()}`);
  const variant = {
    platform: 'android' as const,
    appContext: { packageName: 'com.android.settings' },
    workflow: {
      revision: 1,
      basedOnBusinessRevision: created.businessRevision,
      yaml: anchoredYaml,
    },
    coverage: [],
    evidence: [],
    confirm: { status: 'unconfirmed' as const },
    needsUpdate: false,
  };
  const saved = await documents.save(
    { ...created, variants: { android: variant } },
    created.saveVersion,
  );
  return { id: saved.id, saveVersion: saved.saveVersion };
}

const loadDoc = async (id: string): Promise<AuthoringDocument> =>
  documents.load(id);

describe('工作流卡片与 YAML 编辑路由', () => {
  it('卡片视图按锚点分组，device.parallel 进入原始块且不丢失', async () => {
    const { id } = await createPreparedDocument();
    const res = await fetch(`${baseUrl}/api/documents/${id}/workflow-cards/android`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cards: { actionId?: string; nodes: { node: string }[] }[];
      rawBlocks: { reason: string; text: string }[];
    };
    expect(body.cards.map((c) => c.actionId)).toEqual(['act1', 'act2']);
    const parallel = body.rawBlocks.find((b) => b.reason.includes('device.parallel'));
    expect(parallel).toBeTruthy();
    expect(parallel!.text).toContain('DUT1.home');
  });

  it('卡片编辑更新输入并推进工作流修订', async () => {
    const { id, saveVersion } = await createPreparedDocument();
    const res = await fetch(`${baseUrl}/api/documents/${id}/workflow-card-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: saveVersion,
        edit: {
          kind: 'updateInput',
          caseIndex: 0,
          stepIndex: 2,
          input: '设置页面显示且蓝牙开关可见',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: AuthoringDocument };
    const variant = body.document.variants.android!;
    expect(variant.workflow.revision).toBe(2);
    expect(variant.workflow.yaml).toContain('设置页面显示且蓝牙开关可见');
    // 锚点注释保留
    expect(variant.workflow.yaml).toContain('@step act1');
    // 未知结构（device.parallel）没有被卡片编辑破坏
    expect(variant.workflow.yaml).toContain('device.parallel');
  });

  it('卡片插入步骤（带锚点）后投影为新卡片成员', async () => {
    const { id, saveVersion } = await createPreparedDocument();
    const res = await fetch(`${baseUrl}/api/documents/${id}/workflow-card-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: saveVersion,
        edit: {
          kind: 'insert',
          caseIndex: 0,
          afterStepIndex: 1,
          node: 'wait',
          input: { duration: 1500 },
          actionId: 'act1',
        },
      }),
    });
    expect(res.status).toBe(200);
    const cardsRes = await fetch(`${baseUrl}/api/documents/${id}/workflow-cards/android`);
    const cards = (await cardsRes.json()) as {
      cards: { actionId?: string; nodes: { node: string }[] }[];
    };
    const act1 = cards.cards.find((c) => c.actionId === 'act1')!;
    expect(act1.nodes.map((n) => n.node)).toContain('wait');
  });

  it('语法错误的 YAML 进入未同步缓冲区，不替换当前工作流', async () => {
    const { id, saveVersion } = await createPreparedDocument();
    const before = (await loadDoc(id)).variants.android!.workflow.yaml;

    const res = await fetch(`${baseUrl}/api/documents/${id}/workflow-yaml`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: saveVersion,
        yaml: 'cases: [ 这不是合法 YAML',
      }),
    });
    const body = (await res.json()) as {
      accepted: boolean;
      error: { message: string; line?: number; column?: number };
      document: AuthoringDocument;
    };
    expect(body.accepted).toBe(false);
    expect(body.error.message).toBeTruthy();
    expect(body.document.variants.android!.workflow.yaml).toBe(before);
    expect(body.document.variants.android!.workflow.invalidYamlBuffer).toContain(
      '这不是合法',
    );

    // 修正后保存：替换工作流并清除缓冲区
    const fixRes = await fetch(`${baseUrl}/api/documents/${id}/workflow-yaml`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: body.document.saveVersion,
        yaml: 'cases:\n  - name: 修正\n    steps:\n      - aiAssert: 页面显示\n',
      }),
    });
    const fixed = (await fixRes.json()) as {
      accepted: boolean;
      document: AuthoringDocument;
    };
    expect(fixed.accepted).toBe(true);
    expect(fixed.document.variants.android!.workflow.invalidYamlBuffer).toBeUndefined();
    expect(fixed.document.variants.android!.workflow.yaml).toContain('修正');
  });

  it('合法 YAML 保留注释与未知结构；过期版本被拒绝', async () => {
    const { id, saveVersion } = await createPreparedDocument();

    const res = await fetch(`${baseUrl}/api/documents/${id}/workflow-yaml`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: saveVersion,
        yaml: anchoredYaml.replace('com.android.settings', 'com.example.app'),
      }),
    });
    const body = (await res.json()) as { accepted: boolean; document: AuthoringDocument };
    expect(body.accepted).toBe(true);
    expect(body.document.variants.android!.workflow.yaml).toContain('@step act1');
    expect(body.document.variants.android!.workflow.yaml).toContain('com.example.app');
    expect(body.document.variants.android!.workflow.yaml).toContain('device.parallel');

    // 两个会话都基于旧版本：第二个必须 409
    const staleRes = await fetch(`${baseUrl}/api/documents/${id}/workflow-yaml`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'android',
        baseSaveVersion: saveVersion,
        yaml: anchoredYaml,
      }),
    });
    expect(staleRes.status).toBe(409);
  });

  it('卡片视图解析失败返回 500 且说明原因', async () => {
    const created = await documents.create(`损坏 ${Date.now()}`);
    const brokenYaml = 'cases: [';
    const variant = {
      platform: 'android' as const,
      appContext: { packageName: '' },
      workflow: {
        revision: 1,
        basedOnBusinessRevision: created.businessRevision,
        yaml: brokenYaml,
      },
      coverage: [],
      evidence: [],
      confirm: { status: 'unconfirmed' as const },
      needsUpdate: false,
    };
    await documents.save(
      { ...created, variants: { android: variant } },
      created.saveVersion,
    );
    const res = await fetch(
      `${baseUrl}/api/documents/${created.id}/workflow-cards/android`,
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('无法投影');
    // YAML 内容本身没有半成品替换
    const parsed = YAML.parseDocument(brokenYaml);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});
