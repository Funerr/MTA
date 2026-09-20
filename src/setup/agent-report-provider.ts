import { isAbsolute, resolve } from 'node:path';
import type { NodeExecutionContext } from '@midscene/test';
import type {
  AgentProvider,
  AgentReleaseResult,
  MidsceneUIAgent,
} from '@midscene/test/midscene';

/** 可提供报告文件路径的共享 Agent（AndroidAgent / HarmonyAgent 公开 reportFile）。 */
export interface ReportSourceAgent {
  reportFile?: string | null;
}

/**
 * 把执行项目内共享的 Agent 适配为官方 agentProvider 契约：getAgent 委托使用方
 * 按执行上下文解析（行为与原 getAgent 一致）；releaseAgent 仅向运行器上报该
 * Agent 报告文件的绝对路径（AgentReleaseResult.reportPath），由官方工厂在对应
 * 用例作用域 teardown 时登记为报告来源，使报告组装器能解析每条 AI 执行的
 * 详情。不销毁共享会话——Agent 生命周期仍归项目 setup 管理；Agent 尚未产出
 * 报告文件时返回 undefined（官方按无可登记来源处理）。
 */
export function createSharedAgentReportProvider<
  TContext,
  TAgent extends MidsceneUIAgent & ReportSourceAgent,
>(
  resolveAgent: (
    execution: NodeExecutionContext<unknown, TContext>,
  ) => TAgent,
): AgentProvider<TContext> {
  const agentsByRunId = new Map<string, TAgent>();
  return {
    getAgent(runId, execution) {
      const agent = resolveAgent(execution);
      agentsByRunId.set(runId, agent);
      return agent;
    },
    async releaseAgent(runId: string): Promise<AgentReleaseResult | undefined> {
      const agent = agentsByRunId.get(runId);
      agentsByRunId.delete(runId);
      const reportFile = agent?.reportFile;
      if (typeof reportFile !== 'string' || reportFile.trim().length === 0) {
        return undefined;
      }
      return {
        reportPath: isAbsolute(reportFile) ? reportFile : resolve(reportFile),
      };
    },
  };
}
