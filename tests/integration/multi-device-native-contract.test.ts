import { describe, expect, it } from 'vitest';
import {
  CaseRunner,
  NodeInputValidationError,
  StepTimeoutError,
  defineNode,
} from '@midscene/test';
import { aliasNativeNodes, renameNodeDefinition } from '../../src/nodes/alias-nodes';
import {
  DeviceParallelStepError,
  runParallelChildCalls,
  settleParallelResults,
} from '../../src/nodes/device-parallel-run';
import {
  createOfficialAndroidNodes,
  createOfficialHarmonyNodes,
  makeTraceAiActAgent,
  nodeNamed,
} from '../helpers/experience-ai-act-fixtures';
import {
  aliasOfficialAndroidNodes,
  emptyReport,
  nodeExecution,
} from '../helpers/multi-device-fixtures';
import { GENERIC_REPLAY_PROMPT } from '../helpers/experience-runtime-fixtures';

/**
 * 任务 1.1 / 1.2：锁定 @midscene/test@1.12.7 的公开扩展契约。
 * 只使用 defineNode、createMidsceneNodes 与 NodeDefinition.execute，不调用私有 Runner API。
 */

describe('1.1 别名化 createMidsceneNodes 仍保留公开契约', () => {
  it('换名后保留原生 inputSchema、stringInputKey，并拒绝未声明字段', () => {
    const official = nodeNamed(createOfficialAndroidNodes(), 'aiAct');
    const aliased = renameNodeDefinition(official, 'phone1.aiAct');

    expect(aliased.name).toBe('phone1.aiAct');
    expect(aliased.stringInputKey).toBe(official.stringInputKey);
    expect(aliased.inputSchema).toBe(official.inputSchema);
    expect(aliased.execute).toBeTypeOf('function');
    expect(() => aliased.inputSchema!.parse({ prompt: '打开设置' })).not.toThrow();
    expect(() => aliased.inputSchema!.parse({ instruction: '打开设置' })).toThrow();
    expect(() => official.inputSchema!.parse({ prompt: '打开设置' })).not.toThrow();
  });

  it('按别名批量加前缀时跳过 wait，并保留平台特有 Node', () => {
    const android = aliasNativeNodes('phone1', createOfficialAndroidNodes());
    const harmony = aliasNativeNodes('phone2', createOfficialHarmonyNodes());

    expect(android.find((node) => node.name === 'wait')).toBeUndefined();
    expect(harmony.find((node) => node.name === 'wait')).toBeUndefined();
    expect(nodeNamed(android, 'phone1.runAdbShell').stringInputKey).toBe('command');
    expect(harmony.find((node) => node.name === 'phone2.runAdbShell')).toBeUndefined();
    expect(nodeNamed(harmony, 'phone2.runHdcShell').stringInputKey).toBe('command');
    expect(android.find((node) => node.name === 'phone1.runHdcShell')).toBeUndefined();
  });

  it('CaseRunner 接受别名化 Node：字符串简写、输入校验与公开 execute 委托均可用', async () => {
    const { agent, executionId, aiActCalls } = makeTraceAiActAgent({
      aiAct: async () => '已完成',
    });
    const { nodes } = aliasOfficialAndroidNodes('phone1', ({ context }) => {
      return (context as { agent: unknown }).agent;
    });
    const aiAct = nodeNamed(nodes, 'phone1.aiAct');
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: { agent } as never,
    });

    const result = await runner.run({
      name: 'alias-shorthand',
      steps: [{ 'phone1.aiAct': GENERIC_REPLAY_PROMPT }],
    });
    expect(result.status).toBe('success');
    expect(result.steps[0]!.node).toBe('phone1.aiAct');
    expect(result.steps[0]!.output).toEqual({ summary: '已完成' });
    expect(result.steps[0]!.report?.traces).toContainEqual({
      type: 'midscene-execution',
      executionId,
    });
    expect(aiActCalls()).toBe(1);

    await expect(
      runner.run({
        name: 'alias-invalid',
        steps: [{ 'phone1.aiAct': { instruction: GENERIC_REPLAY_PROMPT } }],
      }),
    ).rejects.toBeInstanceOf(NodeInputValidationError);
    expect(aiActCalls()).toBe(1);

    const { traces, report } = emptyReport();
    const delegated = await aiAct.execute(
      nodeExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: { agent },
        report,
      }),
    );
    expect(delegated).toEqual({ summary: '已完成' });
    expect(traces).toContainEqual({ type: 'midscene-execution', executionId });
    expect(aiActCalls()).toBe(2);
  });
});

describe('1.2 defineNode 父步骤超时、取消、失败与轨迹', () => {
  const probe = (name: string, impl: (signal: AbortSignal) => Promise<string>) =>
    defineNode({
      name,
      async execute(execution) {
        const summary = await impl(execution.signal);
        execution.report.addTrace({
          type: 'midscene-execution',
          executionId: `exec-${name}`,
        });
        return { summary };
      },
    });

  const parent = (
    children: ReturnType<typeof probe>[],
    calls?: { cancelled: string[] },
  ) =>
    defineNode({
      name: 'device.parallel',
      async execute(execution) {
        const results = await runParallelChildCalls(
          children.map((child) => ({
            alias: child.name.split('.')[0]!,
            node: child.name.split('.').slice(1).join('.'),
            async execute(signal) {
              const childReport = emptyReport();
              try {
                const output = await child.execute({
                  ...execution,
                  signal,
                  report: {
                    addTrace(trace) {
                      childReport.report.addTrace(trace);
                      execution.report.addTrace(trace);
                    },
                  },
                });
                return {
                  alias: child.name.split('.')[0]!,
                  node: child.name.split('.').slice(1).join('.'),
                  status: 'success' as const,
                  summary: output?.summary,
                  executionIds: childReport.traces.map((trace) => trace.executionId),
                };
              } catch (error) {
                if (signal.aborted) calls?.cancelled.push(child.name);
                throw error;
              }
            },
          })),
          execution.signal,
        );
        settleParallelResults(results);
        return {
          summary: results.map((result) => `${result.alias}.${result.node}:${result.status}`).join('；'),
          data: { results: results.map((result) => ({ ...result })) },
        };
      },
    });

  it('两个子调用均成功：父步骤成功，轨迹与输出可按设备定位', async () => {
    const childA = probe('phone1.home', async () => 'a');
    const childB = probe('phone2.home', async () => 'b');
    const runner = new CaseRunner({
      nodes: [parent([childA, childB]), childA, childB],
    });
    const result = await runner.run({
      name: 'parallel-success',
      steps: [{ 'device.parallel': {} }],
    });
    expect(result.status).toBe('success');
    expect(result.steps[0]!.output?.data).toMatchObject({
      results: [
        { alias: 'phone1', node: 'home', status: 'success' },
        { alias: 'phone2', node: 'home', status: 'success' },
      ],
    });
    expect(result.steps[0]!.report?.traces).toEqual([
      { type: 'midscene-execution', executionId: 'exec-phone1.home' },
      { type: 'midscene-execution', executionId: 'exec-phone2.home' },
    ]);
  });

  it('任一子调用失败：父步骤失败，成功子结果仍可定位且不掩盖失败', async () => {
    const childA = probe('phone1.home', async () => 'a');
    const childB = probe('phone2.home', async () => {
      throw new Error('设备二失败');
    });
    const runner = new CaseRunner({
      nodes: [parent([childA, childB]), childA, childB],
    });
    await expect(
      runner.run({
        name: 'parallel-child-fail',
        steps: [{ 'device.parallel': {} }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DeviceParallelStepError);
      const parallelError = error as DeviceParallelStepError;
      expect(parallelError.message).toContain('phone1.home=success');
      expect(parallelError.message).toContain('phone2.home=failed');
      expect(parallelError.message).toContain('设备二失败');
      expect(parallelError.results).toEqual([
        expect.objectContaining({ alias: 'phone1', status: 'success' }),
        expect.objectContaining({ alias: 'phone2', status: 'failed', error: '设备二失败' }),
      ]);
      return true;
    });
  });

  it('父步骤超时：未完成子调用收到取消，用例不成功', async () => {
    const cancelled: string[] = [];
    const hang = (name: string) =>
      probe(name, (signal) =>
        new Promise<string>((_resolve, reject) => {
          const fail = () => reject(signal.reason ?? new Error('aborted'));
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        }),
      );
    const childA = hang('phone1.home');
    const childB = hang('phone2.home');
    const runner = new CaseRunner({
      nodes: [parent([childA, childB], { cancelled }), childA, childB],
    });
    await expect(
      runner.run({
        name: 'parallel-timeout',
        steps: [{ 'device.parallel': { $: { timeout: 50 } } }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(StepTimeoutError);
      return true;
    });
    expect(cancelled.sort()).toEqual(['phone1.home', 'phone2.home']);
  });
});
