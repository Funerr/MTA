import { describe, expect, it } from 'vitest';
import { AndroidAgent } from '@midscene/android';
import type { NodeExecutionContext } from '@midscene/test';
import {
  createScopedAgentReportProvider,
  executionScopeIdOf,
  scopedRunAgentFor,
} from '../../src/setup/agent-report-provider';

/** 受控替身：具备官方 Agent 的公开构造面（interface / opts / reportFile / dump）。 */
class FakeAgent {
  readonly interface: unknown;
  readonly opts: unknown;
  reportFile: string | null;
  readonly dump: { executions: unknown[] } = { executions: [] };

  constructor(interfaceInstance: unknown, opts?: unknown) {
    this.interface = interfaceInstance;
    this.opts = opts;
    this.reportFile = null;
  }
}

function caseExecutionOf(context: unknown, runId: string): NodeExecutionContext<unknown, never> {
  return { scope: 'case', case: { runId }, context } as never;
}

describe('作用域 Agent 派生（每 run 独立实例、共享设备）', () => {
  it('同作用域同一实例，跨作用域派生独立实例并共享 interface', () => {
    const shared = new FakeAgent({ device: 'd-1' }, { opt: true });
    const first = scopedRunAgentFor(caseExecutionOf({}, 'run-1'), shared);
    const again = scopedRunAgentFor(caseExecutionOf({}, 'run-1'), shared);
    const second = scopedRunAgentFor(caseExecutionOf({}, 'run-2'), shared);
    expect(again).toBe(first);
    expect(second).not.toBe(first);
    expect(first.interface).toBe(shared.interface);
    expect(second.interface).toBe(shared.interface);
    expect(first.opts).toEqual({ opt: true });
    expect(first.dump).not.toBe(second.dump);
  });

  it('官方 getExecutionId 契约：case 按 case.runId，document 按 documentRunId', () => {
    expect(executionScopeIdOf(caseExecutionOf({}, 'run-1'))).toBe('run-1');
    expect(
      executionScopeIdOf({
        scope: 'document',
        document: { documentRunId: 'doc-1' },
        context: {},
      } as never),
    ).toBe('doc-1');
  });

  it('无作用域信息（受控替身）时原样返回共享实例', () => {
    const shared = new FakeAgent({});
    const execution = { context: {} } as never;
    expect(scopedRunAgentFor(execution, shared)).toBe(shared);
    expect(scopedRunAgentFor(undefined, shared)).toBe(shared);
  });
});

describe('createScopedAgentReportProvider（按作用域登记报告来源）', () => {
  it('getAgent 返回作用域实例；releaseAgent 各自上报独立 reportFile（回归：共享 sourcePath 会让报告组装抛错）', async () => {
    const shared = new FakeAgent({});
    const provider = createScopedAgentReportProvider(() => shared as never);
    const run1 = caseExecutionOf({ key: 'ctx' }, 'run-1');
    const run2 = caseExecutionOf({ key: 'ctx' }, 'run-2');
    const agent1 = provider.getAgent('run-1', run1) as unknown as FakeAgent;
    const agent2 = provider.getAgent('run-2', run2) as unknown as FakeAgent;
    expect(agent1).not.toBe(agent2);
    expect(provider.getAgent('run-1', run1)).toBe(agent1);

    agent1.reportFile = '/tmp/report-run-1.html';
    agent2.reportFile = '/tmp/report-run-2.html';
    await expect(provider.releaseAgent!('run-1')).resolves.toEqual({
      reportPath: '/tmp/report-run-1.html',
    });
    await expect(provider.releaseAgent!('run-2')).resolves.toEqual({
      reportPath: '/tmp/report-run-2.html',
    });
  });

  it('自定义 Node 经 scopedRunAgentFor 命中 getAgent 的同一实例', async () => {
    const shared = new FakeAgent({});
    const provider = createScopedAgentReportProvider(() => shared as never);
    const execution = caseExecutionOf({}, 'run-1');
    const fromProvider = provider.getAgent('run-1', execution);
    expect(scopedRunAgentFor(execution, shared)).toBe(fromProvider);
  });

  it('相对路径解析为绝对路径（官方契约要求绝对路径）', async () => {
    const shared = new FakeAgent({});
    const provider = createScopedAgentReportProvider(() => shared as never);
    const agent = provider.getAgent('run-1', caseExecutionOf({}, 'run-1')) as unknown as FakeAgent;
    agent.reportFile = 'midscene_run/report/report-x.html';
    const released = await provider.releaseAgent!('run-1');
    expect(released?.reportPath).toMatch(/^\//);
    expect(released?.reportPath?.endsWith('report-x.html')).toBe(true);
  });

  it('Agent 未产出报告文件时返回 undefined，不登记来源', async () => {
    for (const reportFile of [undefined, null, '']) {
      const shared = new FakeAgent({});
      shared.reportFile = reportFile as string | null;
      const provider = createScopedAgentReportProvider(() => shared as never);
      provider.getAgent('run-1', caseExecutionOf({}, 'run-1'));
      await expect(provider.releaseAgent!('run-1')).resolves.toBeUndefined();
    }
  });

  it('releaseAgent 按 runId 一次性清理，重复释放返回 undefined', async () => {
    const shared = new FakeAgent({});
    const provider = createScopedAgentReportProvider(() => shared as never);
    const agent = provider.getAgent('run-1', caseExecutionOf({}, 'run-1')) as unknown as FakeAgent;
    agent.reportFile = '/tmp/report.json';
    await expect(provider.releaseAgent!('run-1')).resolves.toEqual({
      reportPath: '/tmp/report.json',
    });
    await expect(provider.releaseAgent!('run-1')).resolves.toBeUndefined();
  });
});

describe('锁定依赖契约：官方 Agent 构造面（@midscene/android 1.12.7）', () => {
  it('派生调用形状 constructor(interface, opts) 产生独立实例与独立 dump，共享同一设备', () => {
    const interfaceInstance = {
      actionSpace: () => [],
      setAppNameMapping: () => undefined,
      screenshotBase64: async () => '',
    } as never;
    const shared = new AndroidAgent(interfaceInstance);
    const runAgent1 = scopedRunAgentFor(caseExecutionOf({}, 'run-1'), shared);
    const runAgent2 = scopedRunAgentFor(caseExecutionOf({}, 'run-2'), shared);

    expect(runAgent1).toBeInstanceOf(AndroidAgent);
    expect(runAgent2).toBeInstanceOf(AndroidAgent);
    expect(runAgent1).not.toBe(runAgent2);
    expect(runAgent1.interface).toBe(interfaceInstance);
    expect(runAgent2.interface).toBe(interfaceInstance);
    expect(runAgent1.dump).not.toBe(runAgent2.dump);
  });
});
