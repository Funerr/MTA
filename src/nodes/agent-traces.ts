import type { NodeExecutionContext } from '@midscene/test';

/**
 * 自定义 Node 的 Agent 执行轨迹上报适配：复用官方 createMidsceneNodes 对原生
 * Node 的同一公开契约——Agent.addDumpUpdateListener 提供 executionRef，经
 * report.addTrace({ type: 'midscene-execution' }) 关联 Midscene 报告，使报告
 * 能下钻每轮 AI 判定。Agent 不支持该监听时静默降级（与官方工厂一致）。
 */
interface TraceableAgent {
  addDumpUpdateListener?(
    listener: (dump: string, executionDump?: { id?: unknown }) => void,
  ): () => void;
}

export function attachAgentExecutionTraces(
  execution: Pick<NodeExecutionContext<unknown, unknown>, 'report' | 'signal'>,
  agent: unknown,
): () => void {
  const traceable = agent as TraceableAgent;
  if (typeof traceable.addDumpUpdateListener !== 'function') return () => undefined;
  let stopped = false;
  const stopListening = traceable.addDumpUpdateListener((_dump, executionDump) => {
    if (stopped || !executionDump) return;
    if (typeof executionDump.id !== 'string') return;
    execution.report.addTrace({
      type: 'midscene-execution',
      executionId: executionDump.id,
    });
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopListening();
  };
  execution.signal.addEventListener('abort', stop, { once: true });
  return () => {
    execution.signal.removeEventListener('abort', stop);
    stop();
  };
}
