import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import type { NodeDefinition, NodeExecutionContext } from '@midscene/test';
import { createMidsceneNodes, type MidsceneUIAgent } from '@midscene/test/midscene';
import type { AiActNodeInput } from '@midscene/test/midscene';
import {
  wrapMidsceneNodesWithExperience,
  type ExperienceIntegrationOptions,
  type TransparentAiActContext,
} from '../../src/experience/integration';
import { pngDataUrl } from './promotion-png';
import { GENERIC_REPLAY_PROMPT, runtimeIdentity } from './experience-runtime-fixtures';

/** 1x1 PNG，供经验路径截图解码，不表示业务画面。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function createOfficialAndroidNodes() {
  return createMidsceneNodes({
    agentClass: AndroidAgent,
    getAgent: ({ context }) => (context as { agent: MidsceneUIAgent }).agent,
  });
}

export function createOfficialHarmonyNodes() {
  return createMidsceneNodes({
    agentClass: HarmonyAgent,
    getAgent: ({ context }) => (context as { agent: MidsceneUIAgent }).agent,
  });
}

export function nodeNamed<TContext>(
  nodes: readonly NodeDefinition<any, any, TContext>[],
  name: string,
): NodeDefinition<any, any, TContext> {
  const node = nodes.find((item) => item.name === name);
  if (!node) throw new Error(`未找到 Node：${name}`);
  return node;
}

export function wrapOfficialAndroidAiAct(options: ExperienceIntegrationOptions) {
  const nodes = wrapMidsceneNodesWithExperience(createOfficialAndroidNodes(), options);
  return {
    nodes,
    aiAct: nodeNamed(nodes, 'aiAct'),
    aiAssert: nodeNamed(nodes, 'aiAssert'),
  };
}

export function makeTraceAiActAgent(options: {
  aiAct?: (prompt: unknown, opt?: unknown) => Promise<string | undefined>;
  executionId?: string;
  recordToReport?: (title?: string, opt?: { content?: string }) => Promise<void>;
} = {}) {
  const executionId = options.executionId ?? 'exec-ai-act-1';
  const listeners: Array<(dump: string, ref?: { id?: string }) => void> = [];
  const captured: Array<{ prompt: unknown; opt: unknown }> = [];
  let aiActCalls = 0;
  const agent = {
    aiAct: async (prompt: unknown, opt?: unknown) => {
      aiActCalls += 1;
      captured.push({ prompt, opt });
      const result = options.aiAct ? await options.aiAct(prompt, opt) : undefined;
      for (const listener of listeners) listener('{}', { id: executionId });
      return result;
    },
    addDumpUpdateListener: (listener: (dump: string, ref?: { id?: string }) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    recordToReport: options.recordToReport,
    dump: { executions: [{ id: executionId }] },
    interface: { screenshotBase64: async () => pngDataUrl(TINY_PNG) },
    callActionInActionSpace: async () => undefined,
  };
  return {
    agent,
    executionId,
    captured,
    aiActCalls: () => aiActCalls,
  };
}

export function aiActExecution(options: {
  input: AiActNodeInput;
  context?: TransparentAiActContext & { agent?: unknown };
  signal?: AbortSignal;
  timeoutMs?: number;
}): NodeExecutionContext<AiActNodeInput, TransparentAiActContext> {
  const identity = runtimeIdentity();
  return {
    input: options.input,
    $: { continueOnError: false, timeoutMs: options.timeoutMs },
    signal: options.signal ?? new AbortController().signal,
    context: options.context ?? {},
    onTeardown() {},
    report: { addTrace() {} },
    scope: 'case',
    case: {
      caseId: identity.caseId ?? 'case-1',
      runId: identity.runId ?? 'run-1',
      projectName: identity.projectName ?? 'android',
      attemptIndex: identity.attempt ?? 0,
      name: identity.caseName,
      sourcePath: identity.casePath,
      caseIndex: 0,
      phase: 'steps',
      stepIndex: 0,
    },
  } as NodeExecutionContext<AiActNodeInput, TransparentAiActContext>;
}

export const IMAGE_PROMPT: AiActNodeInput = {
  prompt: {
    prompt: GENERIC_REPLAY_PROMPT,
    images: [{ name: 'ref', url: 'data:image/png;base64,aaa' }],
  },
};
