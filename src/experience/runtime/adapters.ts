import { replayTargetFromAgent } from '../replay/replay';
import type { ReplayActionTarget } from '../replay/types';
import { capturePngFromDataUrl, createDumpModelObserver, createRecordToReportReporter } from './observe';
import type { ModelCallObserver, NativeActExecute, RuntimeReporter } from './types';

/** experienceAct 需要的最小 Agent 面：原生 AI、截图、已定位派发、dump 与报告。 */
export interface ExperienceActAgent {
  aiAct(prompt: string, opt?: { abortSignal?: AbortSignal; cacheable?: boolean }): Promise<string | undefined>;
  recordToReport?(title?: string, opt?: { content?: string }): Promise<void>;
  dump?: { executions?: ReadonlyArray<{ id?: string; tasks?: readonly unknown[] }> };
  metrics?: { calls: number };
  interface: { screenshotBase64(): Promise<string> };
  callActionInActionSpace(type: string, param?: unknown): Promise<unknown>;
}

export function nativeExecuteFromAgent(agent: ExperienceActAgent): NativeActExecute {
  return async ({ prompt, signal }) => {
    const value = await agent.aiAct(prompt, { abortSignal: signal, cacheable: false });
    const category = value === undefined ? 'undefined' : 'string';
    return { category, dump: agent.dump, value };
  };
}

export function captureScreenshotFromAgent(agent: ExperienceActAgent): () => Promise<Uint8Array> {
  return async () => capturePngFromDataUrl(await agent.interface.screenshotBase64());
}

export function replayTargetFromExperienceAgent(agent: ExperienceActAgent): ReplayActionTarget {
  return replayTargetFromAgent(agent);
}

export function reporterFromAgent(agent: ExperienceActAgent): RuntimeReporter | undefined {
  if (!agent.recordToReport) return undefined;
  const record = agent.recordToReport.bind(agent);
  return createRecordToReportReporter(record);
}

export function observerFromAgent(
  agent: ExperienceActAgent,
  getTransportCalls?: () => number,
): ModelCallObserver {
  return createDumpModelObserver({
    getDump: () => agent.dump,
    getMetricsCalls: () => agent.metrics?.calls ?? 0,
    getTransportCalls,
  });
}
