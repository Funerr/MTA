import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineNode, NodeRegistry } from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';
import { createAndroidProjectSetup } from '../../src/setup/android';
import { executeProjectWorkflow } from '../../src/setup/workflow-execution';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

function fixture(execute?: () => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'mta-execution-contract-')); directories.push(root);
  const workflowPath = join(root, 'workflow.android.yaml');
  const calls: string[] = [];
  const agent = { destroy: async () => { calls.push('destroy'); }, interface: { screenshotBase64: async () => { calls.push('screenshot'); return 'data:image/png;base64,aGVsbG8='; } } };
  const nodes = new NodeRegistry(['prepare', 'launch', 'aiTap', 'aiAssert', 'cleanup'].map((name) => defineNode({ name, execute: async ({ input }) => {
    calls.push(`${name}:${JSON.stringify(input)}`);
    if (name === 'aiTap') await execute?.();
    return { data: {} };
  } })));
  const setup = createAndroidProjectSetup({
    listDevices: async () => [{ udid: 'DUT1', state: 'device' }, { udid: 'other', state: 'device' }],
    createAgent: async (id) => { calls.push(`setup:${id}`); return agent as never; },
  });
  const project = { projectId: 'android', name: 'android', setup, nodes, tags: { include: [], exclude: [] }, retry: 0, variables: { package: 'com.example' } };
  const loadProject = (async () => ({ projects: [project], nodes, resolveNode: (name: string) => nodes.get(name), hasExplicitProjects: true, test: { maxConcurrency: 1, bail: 0, testTimeout: 5000 }, output: { reportDir: root } })) as unknown as typeof loadTestProject;
  writeFileSync(workflowPath, `beforeAll:\n  - prepare: {}\nafterAll:\n  - cleanup: {}\ncases:\n  - name: 核查\n    steps:\n      - launch: { package: '\${package}' }\n      - aiTap: { locate: 开关, exact: true }\n      - aiAssert: { assertion: 开关开启 }\n`);
  const controller = new AbortController();
  return { calls, controller, workflowPath, run: () => executeProjectWorkflow({ configPath: '', workflowPath, platform: 'android', deviceId: 'DUT1', signal: controller.signal, report: () => undefined, loadProject }) };
}

describe('工作台 → MTA setup → Midscene Runner → teardown 契约', () => {
  it('保留生命周期、变量、节点类型和结构化参数；动作先于断言且只执行一次', async () => {
    const test = fixture();
    const result = await test.run();
    expect(result.cases[0]?.status).toBe('success');
    expect(test.calls).toEqual(['setup:DUT1', 'screenshot', 'prepare:{}', 'launch:{"package":"com.example"}', 'screenshot', 'aiTap:{"locate":"开关","exact":true}', 'screenshot', 'aiAssert:{"assertion":"开关开启"}', 'screenshot', 'cleanup:{}', 'destroy']);
  });
  it('停止期间保留在途状态；不派发后续动作，结束后才 teardown', async () => {
    const gate = deferred(); const started = deferred();
    const test = fixture(async () => { started.resolve(); await gate.promise; });
    let settled = false;
    const running = test.run().finally(() => { settled = true; });
    await started.promise;
    test.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(test.calls).not.toContain('destroy');
    gate.resolve(); await running;
    expect(test.calls.some((call) => call.startsWith('aiAssert:'))).toBe(false);
    expect(test.calls.at(-1)).toBe('destroy');
  });
  it('步骤超时后仍等待底层调用，不提前释放设备', async () => {
    const gate = deferred(); const started = deferred();
    const test = fixture(async () => { started.resolve(); await gate.promise; });
    writeFileSync(test.workflowPath, 'cases:\n  - name: 超时\n    steps:\n      - aiTap:\n          $: { timeout: 10 }\n      - aiAssert: {}\n');
    let settled = false;
    const running = test.run().finally(() => { settled = true; });
    await started.promise;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false); expect(test.calls).not.toContain('destroy');
    gate.resolve(); await running;
    expect(test.calls.filter((call) => call.startsWith('aiAssert:'))).toEqual([]);
    expect(test.calls.at(-1)).toBe('destroy');
  });
  it('启动前取消不建立会话', async () => {
    const test = fixture(); test.controller.abort();
    await expect(test.run()).rejects.toThrow(); expect(test.calls).toEqual([]);
  });
});
