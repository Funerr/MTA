import { describe, expect, it } from 'vitest';
import { createSharedAgentReportProvider } from '../../src/setup/agent-report-provider';
import type { NodeExecutionContext } from '@midscene/test';

function executionOf(context: unknown): NodeExecutionContext<unknown, never> {
  return { context } as never;
}

function agentOf(reportFile?: string | null) {
  return { reportFile } as never;
}

describe('createSharedAgentReportProvider（共享 Agent 的报告来源登记）', () => {
  it('getAgent 委托使用方解析，行为与原 getAgent 一致', async () => {
    const agent = agentOf('/tmp/report.json');
    const provider = createSharedAgentReportProvider((execution) => {
      expect(execution.context).toEqual({ key: 'ctx' });
      return agent;
    });
    expect(await provider.getAgent('run-1', executionOf({ key: 'ctx' }))).toBe(agent);
  });

  it('releaseAgent 上报报告文件绝对路径，且不触碰 Agent 本身', async () => {
    const agent = agentOf('/tmp/midscene_run/report/report-x.json');
    const provider = createSharedAgentReportProvider(() => agent);
    await provider.getAgent('run-1', executionOf({}));
    await expect(provider.releaseAgent!('run-1')).resolves.toEqual({
      reportPath: '/tmp/midscene_run/report/report-x.json',
    });
  });

  it('相对路径解析为绝对路径（官方契约要求绝对路径）', async () => {
    const agent = agentOf('midscene_run/report/report-x.json');
    const provider = createSharedAgentReportProvider(() => agent);
    await provider.getAgent('run-1', executionOf({}));
    const released = await provider.releaseAgent!('run-1');
    expect(released?.reportPath).toMatch(/^\//);
    expect(released?.reportPath?.endsWith('report-x.json')).toBe(true);
  });

  it('Agent 未产出报告文件时返回 undefined，不登记来源', async () => {
    for (const reportFile of [undefined, null, '']) {
      const agent = agentOf(reportFile);
      const provider = createSharedAgentReportProvider(() => agent);
      await provider.getAgent('run-1', executionOf({}));
      await expect(provider.releaseAgent!('run-1')).resolves.toBeUndefined();
    }
  });

  it('releaseAgent 按 runId 一次性清理，重复释放返回 undefined', async () => {
    const agent = agentOf('/tmp/report.json');
    const provider = createSharedAgentReportProvider(() => agent);
    await provider.getAgent('run-1', executionOf({}));
    await expect(provider.releaseAgent!('run-1')).resolves.toEqual({
      reportPath: '/tmp/report.json',
    });
    await expect(provider.releaseAgent!('run-1')).resolves.toBeUndefined();
  });

  it('多个 runId 共享同一 Agent 实例时各自登记来源', async () => {
    const agent = agentOf('/tmp/report.json');
    const provider = createSharedAgentReportProvider(() => agent);
    await provider.getAgent('run-1', executionOf({}));
    await provider.getAgent('run-2', executionOf({}));
    await expect(provider.releaseAgent!('run-1')).resolves.toEqual({
      reportPath: '/tmp/report.json',
    });
    await expect(provider.releaseAgent!('run-2')).resolves.toEqual({
      reportPath: '/tmp/report.json',
    });
  });
});
