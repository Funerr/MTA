import type { NodeDefinition, NodeExecutionContext, NodeReportTrace } from '@midscene/test';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import { aliasNativeNodes, takeUnaliasedWaitNode } from '../../src/nodes/alias-nodes';
import type { MultiDeviceBinding } from '../../src/setup/multi-device-config';

export const TEST_MULTI_DEVICE_BINDINGS = [
  { alias: 'phone1', platform: 'android', idEnv: 'MULTI_DEVICE_PHONE1_ID' },
  { alias: 'phone2', platform: 'harmony', idEnv: 'MULTI_DEVICE_PHONE2_ID' },
] as const satisfies readonly MultiDeviceBinding[];

export const SAME_PLATFORM_BINDINGS = [
  { alias: 'phone1', platform: 'android', idEnv: 'MULTI_DEVICE_PHONE1_ID' },
  { alias: 'phone2', platform: 'android', idEnv: 'MULTI_DEVICE_PHONE2_ID' },
] as const satisfies readonly MultiDeviceBinding[];

export function createOfficialAndroidNodesForContext<TContext>(
  getAgent: (execution: NodeExecutionContext<unknown, TContext>) => unknown,
) {
  return createMidsceneNodes<TContext>({
    agentClass: AndroidAgent,
    getAgent: getAgent as never,
  });
}

export function createOfficialHarmonyNodesForContext<TContext>(
  getAgent: (execution: NodeExecutionContext<unknown, TContext>) => unknown,
) {
  return createMidsceneNodes<TContext>({
    agentClass: HarmonyAgent,
    getAgent: getAgent as never,
  });
}

export function aliasOfficialAndroidNodes<TContext>(
  alias: string,
  getAgent: (execution: NodeExecutionContext<unknown, TContext>) => unknown,
) {
  const native = createOfficialAndroidNodesForContext(getAgent);
  return {
    wait: takeUnaliasedWaitNode(native),
    nodes: aliasNativeNodes(alias, native),
  };
}

export function nodeNamed<TContext>(
  nodes: readonly NodeDefinition<any, any, TContext>[],
  name: string,
): NodeDefinition<any, any, TContext> {
  const node = nodes.find((item) => item.name === name);
  if (!node) throw new Error(`未找到 Node：${name}`);
  return node;
}

export function emptyReport() {
  const traces: NodeReportTrace[] = [];
  return {
    traces,
    report: {
      addTrace(trace: NodeReportTrace) {
        traces.push(trace);
      },
    },
  };
}

export function nodeExecution<TInput, TContext>(options: {
  input: TInput;
  context: TContext;
  signal?: AbortSignal;
  timeoutMs?: number;
  report?: { addTrace(trace: NodeReportTrace): void };
}): NodeExecutionContext<TInput, TContext> {
  return {
    input: options.input,
    $: { continueOnError: false, timeoutMs: options.timeoutMs },
    signal: options.signal ?? new AbortController().signal,
    context: options.context,
    onTeardown() {},
    report: options.report ?? { addTrace() {} },
    scope: 'case',
    case: {
      caseId: 'case-1',
      runId: 'run-1',
      projectName: 'multi-device',
      attemptIndex: 0,
      name: 'contract',
      sourcePath: 'tests/helpers/multi-device-fixtures.ts',
      caseIndex: 0,
      phase: 'steps',
      stepIndex: 0,
    },
  } as NodeExecutionContext<TInput, TContext>;
}
