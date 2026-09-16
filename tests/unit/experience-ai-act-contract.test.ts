import { describe, expect, it } from 'vitest';
import { wrapMidsceneNodesWithExperience } from '../../src/experience/integration';
import {
  aiActExecution,
  createOfficialAndroidNodes,
  makeTraceAiActAgent,
  nodeNamed,
  wrapOfficialAndroidAiAct,
} from '../helpers/experience-ai-act-fixtures';
import { GENERIC_REPLAY_PROMPT } from '../helpers/experience-runtime-fixtures';

describe('官方 aiAct 最小契约试验（任务 1.1）', () => {
  it('项目范围包装保留官方 schema / 名称 / 字符串简写键', () => {
    const official = nodeNamed(createOfficialAndroidNodes(), 'aiAct');
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    expect(wrapped.name).toBe('aiAct');
    expect(wrapped.stringInputKey).toBe(official.stringInputKey);
    expect(wrapped.description).toBe(official.description);
    expect(wrapped.inputSchema).toBe(official.inputSchema);
    expect(() => wrapped.inputSchema!.parse({ prompt: GENERIC_REPLAY_PROMPT })).not.toThrow();
    expect(() => wrapped.inputSchema!.parse({ instruction: GENERIC_REPLAY_PROMPT })).toThrow();
  });

  it('关闭时返回原始定义；开启且默认空策略时结果仍遵循官方 toResult', async () => {
    const officialNodes = createOfficialAndroidNodes();
    const official = nodeNamed(officialNodes, 'aiAct');
    const disabled = wrapMidsceneNodesWithExperience(officialNodes, { enabled: false });
    expect(nodeNamed(disabled, 'aiAct')).toBe(official);

    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const silent = makeTraceAiActAgent({ aiAct: async () => undefined });
    expect(
      await wrapped.execute(
        aiActExecution({
          input: { prompt: GENERIC_REPLAY_PROMPT },
          context: { agent: silent.agent },
        }),
      ),
    ).toBeUndefined();

    const spoken = makeTraceAiActAgent({ aiAct: async () => '已完成' });
    expect(
      await wrapped.execute(
        aiActExecution({
          input: { prompt: GENERIC_REPLAY_PROMPT },
          context: { agent: spoken.agent },
        }),
      ),
    ).toEqual({ summary: '已完成' });
  });

  it('包装后仍通过官方 dump 监听写入 midscene-execution 报告关联', async () => {
    const traces: Array<{ type: string; executionId: string }> = [];
    const { agent, executionId } = makeTraceAiActAgent({ aiAct: async () => undefined });
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    await wrapped.execute({
      ...aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: { agent },
      }),
      report: {
        addTrace(trace: { type: string; executionId: string }) {
          traces.push(trace);
        },
      },
    } as never);
    expect(traces).toContainEqual({ type: 'midscene-execution', executionId });
  });

  it('包装后取消信号仍在原生执行前失败，不调用 Agent', async () => {
    const { agent, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const controller = new AbortController();
    controller.abort(new Error('cancelled-by-test'));
    await expect(
      wrapped.execute(
        aiActExecution({
          input: { prompt: GENERIC_REPLAY_PROMPT },
          context: { agent },
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow(/cancelled-by-test|aborted/i);
    expect(aiActCalls()).toBe(0);
  });
});
