import { z } from 'zod/v4';
import { defineNode, type NodeExecutionContext } from '@midscene/test';
import { scopedRunAgentFor } from '../setup/agent-report-provider';
import { openExperienceStore } from '../experience/store/experience-store';
import type { ExperienceEnvironment } from '../experience/schema/environment';
import {
  DEFAULT_EXPERIENCE_STORE_ROOT,
  ExperienceRuntime,
  captureScreenshotFromAgent,
  identityFromNodeExecution,
  nativeExecuteFromAgent,
  observerFromAgent,
  reporterFromAgent,
  replayTargetFromExperienceAgent,
  type ExperienceActAgent,
  type ExperienceActionPolicy,
  type ExperienceRuntimeResult,
} from '../experience/runtime';
import type { DeviceLifecycleProjectContext } from './device-lifecycle';

/** 实验入口：严格 prompt 文本契约，不接受 instruction/images 等未声明字段。 */
export const experienceActInputSchema = z.strictObject({
  prompt: z.string().min(1, 'prompt 必须是非空字符串').describe('可重复执行的纯动作目标描述。'),
});

export type ExperienceActInput = z.infer<typeof experienceActInputSchema>;

export interface ExperienceActProjectContext extends DeviceLifecycleProjectContext {
  agent: DeviceLifecycleProjectContext['agent'] & Partial<ExperienceActAgent>;
  experienceRuntime?: ExperienceRuntime;
  experienceEnvironment?: ExperienceEnvironment;
  experienceActionPolicy?: ExperienceActionPolicy;
  experienceStoreRoot?: string;
}

function asExperienceAgent(agent: ExperienceActProjectContext['agent']): ExperienceActAgent {
  if (typeof agent.aiAct !== 'function' || !agent.interface || typeof agent.callActionInActionSpace !== 'function') {
    throw new Error(
      'experienceAct 需要执行项目 setup 提供具备 aiAct / 截图 / callActionInActionSpace 的 Agent。',
    );
  }
  return agent as ExperienceActAgent;
}

function resolveRuntime(
  execution: NodeExecutionContext<ExperienceActInput, ExperienceActProjectContext>,
): ExperienceRuntime {
  const context = execution.context;
  if (context.experienceRuntime) return context.experienceRuntime;
  const agent = asExperienceAgent(scopedRunAgentFor(execution, context.agent));
    return new ExperienceRuntime({
    store: openExperienceStore(context.experienceStoreRoot ?? DEFAULT_EXPERIENCE_STORE_ROOT),
    policy: context.experienceActionPolicy,
    environment: context.experienceEnvironment,
    nativeExecute: nativeExecuteFromAgent(agent),
    captureScreenshot: captureScreenshotFromAgent(agent),
    replayTarget: replayTargetFromExperienceAgent(agent),
    reporter: reporterFromAgent(agent),
    modelObserver: observerFromAgent(agent),
    getDump: () => agent.dump,
  });
}

function attachDumpTraces(
  execution: NodeExecutionContext<ExperienceActInput, ExperienceActProjectContext>,
  result: ExperienceRuntimeResult,
): void {
  const scopedAgent = scopedRunAgentFor(execution, execution.context.agent);
  const dump = scopedAgent && 'dump' in scopedAgent
    ? (scopedAgent as ExperienceActAgent).dump
    : undefined;
  const executions = dump?.executions ?? [];
  for (const item of executions) {
    if (item && typeof item.id === 'string') {
      execution.report.addTrace({ type: 'midscene-execution', executionId: item.id });
    }
  }
  void result;
}

/**
 * experienceAct：实验性经验闭环入口。保留原生 aiAct / aiAssert 不变。
 * 默认资格策略为空，未登记目标原样走原生 AI。
 */
export const experienceActNode = defineNode<
  typeof experienceActInputSchema,
  ExperienceRuntimeResult,
  ExperienceActProjectContext
>({
  name: 'experienceAct',
  description:
    '实验性经验动作：仅对使用方登记的可重复纯动作目标尝试视觉重放；未登记、含判断或资产不可用时回退一次原生 aiAct。不覆盖原生 aiAct/aiAssert。',
  stringInputKey: 'prompt',
  inputSchema: experienceActInputSchema,
  async execute(execution) {
    const runtime = resolveRuntime(execution);
    const deadlineAtMs =
      execution.$.timeoutMs === undefined ? undefined : Date.now() + execution.$.timeoutMs;
    const result = await runtime.run({
      request: { prompt: execution.input.prompt, node: 'experienceAct' },
      identity: identityFromNodeExecution(execution),
      signal: execution.signal,
      deadlineAtMs,
    });
    attachDumpTraces(execution, result);
    return {
      summary:
        result.outcome === 'replay'
          ? 'experienceAct 视觉重放成功'
          : result.outcome === 'native'
            ? 'experienceAct 原生执行成功'
            : `experienceAct ${result.outcome}`,
      data: result,
    };
  },
});
