import { describe, expect, it } from 'vitest';
import { deviceWaitUntilNode } from '../../src/nodes/device-wait-until';
import { attachAgentExecutionTraces } from '../../src/nodes/agent-traces';
import { createMultiDeviceNodes } from '../../src/nodes/multi-device';
import {
  TEST_MULTI_DEVICE_BINDINGS,
  emptyReport,
  nodeExecution,
  nodeNamed,
} from '../helpers/multi-device-fixtures';
import type { NodeReportTrace } from '@midscene/test';

type AssertOutcome = { pass: boolean; thought?: string } | Error;

interface AssertCall {
  assertion: string;
  keepRawResponse?: boolean;
  hasAbortSignal: boolean;
}

function makeAgent(outcomes: AssertOutcome[]) {
  const calls: AssertCall[] = [];
  const agent = {
    async aiAssert(
      assertion: string,
      _message?: string,
      options?: { keepRawResponse?: boolean; abortSignal?: AbortSignal },
    ) {
      calls.push({
        assertion,
        keepRawResponse: options?.keepRawResponse,
        hasAbortSignal: options?.abortSignal instanceof AbortSignal,
      });
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? { pass: true };
    },
  };
  return { agent, calls };
}

function runWaitUntil(
  input: { prompt: string; timeoutMs?: number; intervalMs?: number },
  context: unknown,
  extra: { signal?: AbortSignal; timeoutMs?: number; report?: { addTrace(trace: NodeReportTrace): void } } = {},
) {
  return deviceWaitUntilNode.execute(
    nodeExecution({
      input: { timeoutMs: 1000, intervalMs: 5, ...input },
      context,
      signal: extra.signal,
      timeoutMs: extra.timeoutMs,
      report: extra.report,
    }) as never,
  );
}

describe('device.waitUntil 输入契约（schema 层）', () => {
  const schema = deviceWaitUntilNode.inputSchema!;

  it('prompt 必填，超时与间隔带默认值', () => {
    expect(schema.parse({ prompt: '页面出现结果' })).toEqual({
      prompt: '页面出现结果',
      timeoutMs: 10000,
      intervalMs: 500,
    });
  });

  it('未声明字段、空 prompt、非正数均校验失败', () => {
    expect(() => schema.parse({ prompt: 'x', extra: 1 })).toThrow();
    expect(() => schema.parse({ prompt: '' })).toThrow();
    expect(() => schema.parse({ prompt: 'x', timeoutMs: 0 })).toThrow();
    expect(() => schema.parse({ prompt: 'x', intervalMs: -5 })).toThrow();
  });

  it('intervalMs 必须小于 timeoutMs', () => {
    expect(() => schema.parse({ prompt: 'x', timeoutMs: 500, intervalMs: 500 })).toThrow();
    expect(schema.parse({ prompt: 'x', timeoutMs: 500, intervalMs: 499 })).toMatchObject({
      intervalMs: 499,
    });
  });

  it('字符串简写映射到 prompt', () => {
    expect(deviceWaitUntilNode.stringInputKey).toBe('prompt');
  });
});

describe('device.waitUntil 执行语义', () => {
  it('首次判定满足即返回，并经 aiAssert 结构化判定', async () => {
    const { agent, calls } = makeAgent([{ pass: true }]);
    const result = (await runWaitUntil({ prompt: '设置已打开' }, { agent })) as {
      summary: string;
      data: { attempts: number };
    };
    expect(result.data.attempts).toBe(1);
    expect(result.summary).toContain('第 1 次判定');
    expect(calls).toEqual([
      { assertion: '设置已打开', keepRawResponse: true, hasAbortSignal: true },
    ]);
  });

  it('条件未满足时按 intervalMs 轮询，满足后立即继续', async () => {
    const { agent, calls } = makeAgent([
      { pass: false, thought: '页面仍在加载' },
      { pass: false, thought: '页面仍在加载' },
      { pass: true },
    ]);
    const result = (await runWaitUntil(
      { prompt: '列表加载完成', timeoutMs: 2000, intervalMs: 5 },
      { agent },
    )) as { data: { attempts: number } };
    expect(result.data.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('超时失败并携带最后一次判定原因', async () => {
    const endless = {
      aiAssert: async () => ({ pass: false, thought: '目标元素仍未出现' }),
    };
    await expect(
      runWaitUntil({ prompt: '弹窗出现', timeoutMs: 40, intervalMs: 10 }, { agent: endless }),
    ).rejects.toThrow(/未满足条件.*目标元素仍未出现/s);
  });

  it('Agent 调用同步抛错直接传播，不当作未满足', async () => {
    const { agent } = makeAgent([new Error('模型服务不可用')]);
    await expect(
      runWaitUntil({ prompt: '任意条件', timeoutMs: 200, intervalMs: 10 }, { agent }),
    ).rejects.toThrow('模型服务不可用');
  });

  it('模型服务错误经结构化结果按未满足轮询，超时错误携带真实原因', async () => {
    const errorAgent = {
      aiAssert: async () => ({
        pass: false,
        message: 'Assertion failed: 条件\nReason: AI model request failed: 429 余额不足',
      }),
    };
    await expect(
      runWaitUntil({ prompt: '任意条件', timeoutMs: 30, intervalMs: 5 }, { agent: errorAgent }),
    ).rejects.toThrow(/429 余额不足/);
  });

  it('取消信号中断等待', async () => {
    const controller = new AbortController();
    const endless = { aiAssert: async () => ({ pass: false }) };
    setTimeout(() => controller.abort(), 15);
    await expect(
      runWaitUntil(
        { prompt: '任意条件', timeoutMs: 5000, intervalMs: 50 },
        { agent: endless },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it('步骤级 $ 超时与节点 timeoutMs 取更小者', async () => {
    const endless = { aiAssert: async () => ({ pass: false }) };
    await expect(
      runWaitUntil(
        { prompt: '任意条件', timeoutMs: 10000, intervalMs: 5 },
        { agent: endless },
        { timeoutMs: 40 },
      ),
    ).rejects.toThrow(/未满足条件/);
  });

  it('单一慢判定耗尽预算：不开始下一轮，超时耗时约等于预算', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const slowAgent = {
      aiAssert: async () => {
        await delay(30); // 单次判定 30ms，接近 50ms 预算
        return { pass: false, thought: '仍在加载' };
      },
    };
    const startedAt = Date.now();
    await expect(
      runWaitUntil(
        { prompt: '任意条件', timeoutMs: 50, intervalMs: 500 },
        { agent: slowAgent },
      ),
    ).rejects.toThrow(/未满足条件.*仍在加载/s);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it('缺少具备 aiAssert 的 Agent 时报可定位错误', async () => {
    await expect(runWaitUntil({ prompt: 'x' }, {})).rejects.toThrow(
      /需要执行项目 setup 提供具备 aiAssert 的 Agent/,
    );
  });
});

describe('Agent 执行轨迹上报适配（agent-traces）', () => {
  type DumpListener = (dump: string, executionDump?: { id?: unknown }) => void;

  function makeTraceableAgent(outcomes: Array<{ pass: boolean }>) {
    let listener: DumpListener | undefined;
    const removed: number[] = [];
    const agent = {
      async aiAssert() {
        listener?.('{}', { id: `exec-${outcomes.length}` });
        const next = outcomes.shift() ?? { pass: true };
        return next;
      },
      addDumpUpdateListener(fn: DumpListener) {
        listener = fn;
        return () => {
          listener = undefined;
          removed.push(1);
        };
      },
    };
    return { agent, removed, get attached() { return listener !== undefined; } };
  }

  it('每轮判定经 addDumpUpdateListener 关联报告 executionId', async () => {
    const { agent } = makeTraceableAgent([{ pass: true }]);
    const { traces, report } = emptyReport();
    await runWaitUntil({ prompt: 'x' }, { agent }, { report });
    expect(traces).toEqual([{ type: 'midscene-execution', executionId: 'exec-1' }]);
  });

  it('结束时移除监听，后续 Agent 事件不再进入本步骤', async () => {
    const { agent, removed, attached } = makeTraceableAgent([{ pass: true }]);
    const { traces, report } = emptyReport();
    await runWaitUntil({ prompt: 'x' }, { agent }, { report });
    expect(attached).toBe(false);
    expect(removed).toHaveLength(1);
    expect(traces).toHaveLength(1);
  });

  it('Agent 不支持监听时静默降级，不影响等待语义', async () => {
    const agent = { aiAssert: async () => ({ pass: true }) };
    const { traces, report } = emptyReport();
    const result = (await runWaitUntil({ prompt: 'x' }, { agent }, { report })) as {
      data: { attempts: number };
    };
    expect(result.data.attempts).toBe(1);
    expect(traces).toEqual([]);
  });
});

describe('device.waitUntil 在 multi-device 项目', () => {
  const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);

  it('为每个别名注册 <alias>.device.waitUntil，未加前缀的调用直接报错', async () => {
    expect(nodes.some((node) => node.name === 'phone1.device.waitUntil')).toBe(true);
    expect(nodes.some((node) => node.name === 'phone2.device.waitUntil')).toBe(true);

    const redirect = nodeNamed(nodes, 'device.waitUntil');
    // redirect 的 execute 同步抛错（无异步执行体），用函数形式断言。
    expect(() =>
      redirect.execute(nodeExecution({ input: { prompt: 'x' }, context: {} }) as never),
    ).toThrow(/<alias>\.device\.waitUntil/);
  });

  it('别名化节点轮询目标绑定设备', async () => {
    const { agent, calls } = makeAgent([{ pass: false }, { pass: true }]);
    const waitUntil = nodeNamed(nodes, 'phone1.device.waitUntil');
    const result = (await waitUntil.execute(
      nodeExecution({
        input: { prompt: '设备一出现结果', timeoutMs: 2000, intervalMs: 5 },
        context: { devices: { phone1: { agent } } },
      }) as never,
    )) as { summary: string; data: { attempts: number } };
    expect(result.summary).toContain('phone1.device.waitUntil 条件满足');
    expect(result.data.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('别名未绑定时报可定位错误', async () => {
    const waitUntil = nodeNamed(nodes, 'phone2.device.waitUntil');
    await expect(
      waitUntil.execute(
        nodeExecution({
          input: { prompt: 'x', timeoutMs: 100, intervalMs: 5 },
          context: { devices: {} },
        }) as never,
      ),
    ).rejects.toThrow(/需要协作项目已绑定的设备别名 phone2/);
  });
});
