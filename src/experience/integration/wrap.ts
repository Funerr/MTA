import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeResult } from '@midscene/test';
import type { AiActNodeInput } from '@midscene/test/midscene';
import { scopedRunAgentFor } from '../../setup/agent-report-provider';
import { openExperienceStore } from '../store/experience-store';
import {
  captureScreenshotFromAgent,
  DEFAULT_EXPERIENCE_STORE_ROOT,
  EMPTY_ACTION_POLICY,
  ExperienceRunError,
  ExperienceRuntime,
  observerFromAgent,
  reporterFromAgent,
  replayTargetFromExperienceAgent,
  type ExperienceActAgent,
  type NativeActExecute,
  type NativeActResult,
} from '../runtime';
import { identityFromNodeExecution } from '../runtime/identity';
import { loadExperienceIntegrationConfig } from './config';
import { TRANSPARENT_AI_ACT_WRAP } from './constants';
import { evaluateTransparentAiActAccess, transparentRuntimeRequestOf } from './eligibility';
import type {
  ExperienceIntegrationOptions,
  TransparentAiActContext,
} from './types';

function isWrappedAiAct(node: NodeDefinition<any, any, any>): boolean {
  return TRANSPARENT_AI_ACT_WRAP in node;
}

export function isTransparentAiActWrapped(node: NodeDefinition<any, any, any> | undefined): boolean {
  return Boolean(node && isWrappedAiAct(node));
}

function contextOf(value: unknown): TransparentAiActContext {
  if (!value || typeof value !== 'object') return {};
  return value as TransparentAiActContext;
}

function dumpOfAgent(agent: unknown): unknown {
  if (!agent || typeof agent !== 'object' || !('dump' in agent)) return undefined;
  return (agent as { dump?: unknown }).dump;
}

function executionIdsOf(dump: unknown): string[] {
  if (!dump || typeof dump !== 'object') return [];
  const executions = (dump as { executions?: unknown }).executions;
  if (!Array.isArray(executions)) return [];
  const ids: string[] = [];
  for (const item of executions) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      ids.push((item as { id: string }).id);
    }
  }
  return ids;
}

function attachNewDumpTraces(
  execution: NodeExecutionContext<AiActNodeInput, unknown>,
  beforeIds: ReadonlySet<string>,
): void {
  for (const id of executionIdsOf(dumpOfAgent(scopedRunAgentFor(execution, contextOf(execution.context).agent)))) {
    if (!beforeIds.has(id)) {
      execution.report.addTrace({ type: 'midscene-execution', executionId: id });
    }
  }
}

function asExperienceAgent(agent: unknown): ExperienceActAgent {
  if (
    !agent ||
    typeof agent !== 'object' ||
    typeof (agent as ExperienceActAgent).aiAct !== 'function' ||
    !(agent as ExperienceActAgent).interface ||
    typeof (agent as ExperienceActAgent).callActionInActionSpace !== 'function'
  ) {
    throw new Error(
      '透明 aiAct 经验路径需要执行项目 setup 提供具备 aiAct / 截图 / callActionInActionSpace 的 Agent。',
    );
  }
  return agent as ExperienceActAgent;
}

function nativeResultFromNode(result: NodeResult | void | undefined, dump: unknown): NativeActResult {
  const value = result?.summary;
  return {
    category: value === undefined ? 'undefined' : 'string',
    dump,
    value,
  };
}

function resolveRuntime(
  context: TransparentAiActContext,
  options: ExperienceIntegrationOptions,
  nativeExecute: NativeActExecute,
  scopedAgent: unknown,
): ExperienceRuntime {
  const agent = asExperienceAgent(scopedAgent);
  return new ExperienceRuntime({
    store: context.experienceStore ?? openExperienceStore(
      context.experienceStoreRoot ?? options.storeRoot ?? DEFAULT_EXPERIENCE_STORE_ROOT,
    ),
    policy: context.experienceActionPolicy ?? options.policy ?? EMPTY_ACTION_POLICY,
    environment: context.experienceEnvironment,
    nativeExecute,
    captureScreenshot: captureScreenshotFromAgent(agent),
    replayTarget: replayTargetFromExperienceAgent(agent),
    reporter: reporterFromAgent(agent),
    modelObserver: observerFromAgent(agent),
    getDump: () => agent.dump,
    replayChain: context.experienceReplayChain,
    matchScreen: context.experienceMatchScreen,
    promote: context.experiencePromote,
  });
}

function wrapAiActNode<TContext>(
  official: NodeDefinition<any, any, TContext>,
  options: ExperienceIntegrationOptions,
): NodeDefinition<any, any, TContext> {
  if (isWrappedAiAct(official)) return official;
  const officialExecute = official.execute.bind(official);
  const wrapped = defineNode({
    name: official.name,
    ...(official.title === undefined ? {} : { title: official.title }),
    ...(official.description === undefined ? {} : { description: official.description }),
    ...(official.stringInputKey === undefined ? {} : { stringInputKey: official.stringInputKey }),
    inputSchema: official.inputSchema,
    async execute(execution: NodeExecutionContext<AiActNodeInput, TContext>) {
      const context = contextOf(execution.context);
      const policy = context.experienceActionPolicy ?? options.policy ?? EMPTY_ACTION_POLICY;
      const identity = identityFromNodeExecution(execution);
      const access = evaluateTransparentAiActAccess(execution.input, policy, identity);
      if (access.kind === 'bypass') {
        return officialExecute(execution);
      }

      const agent = scopedRunAgentFor(execution, context.agent);
      let captured: NodeResult | void | undefined;
      const nativeExecute: NativeActExecute = async () => {
        captured = await officialExecute(execution);
        return nativeResultFromNode(captured, dumpOfAgent(agent));
      };

      const beforeIds = new Set(executionIdsOf(dumpOfAgent(agent)));
      try {
        const runtime = resolveRuntime(context, options, nativeExecute, agent);
        const result = await runtime.run({
          request: transparentRuntimeRequestOf(execution.input),
          identity,
          signal: execution.signal,
          deadlineAtMs:
            execution.$.timeoutMs === undefined ? undefined : Date.now() + execution.$.timeoutMs,
        });
        if (result.outcome === 'replay') {
          attachNewDumpTraces(execution, beforeIds);
          return undefined;
        }
        return captured;
      } catch (error) {
        if (execution.signal.aborted) {
          execution.signal.throwIfAborted();
        }
        if (error instanceof ExperienceRunError && error.cause !== undefined) {
          throw error.cause;
        }
        throw error;
      }
    },
  });
  Object.defineProperty(wrapped, TRANSPARENT_AI_ACT_WRAP, {
    value: true,
    enumerable: false,
  });
  return wrapped as NodeDefinition<any, any, TContext>;
}

/**
 * 项目范围包装官方 Nodes：仅替换 aiAct 执行入口。
 * 关闭时返回原始定义对象，不实例化 Runtime/Store。
 */
export function wrapMidsceneNodesWithExperience<TContext>(
  nodes: readonly NodeDefinition<any, any, TContext>[],
  options: ExperienceIntegrationOptions = loadExperienceIntegrationConfig(),
): readonly NodeDefinition<any, any, TContext>[] {
  if (!options.enabled) return nodes;
  return nodes.map((node) => (node.name === 'aiAct' ? wrapAiActNode(node, options) : node));
}
