import { z } from 'zod/v4';
import { defineNode } from '@midscene/test';
import { attachAgentExecutionTraces } from './agent-traces';
import type { DeviceLifecycleProjectContext } from './device-lifecycle';

/**
 * 显式等待依赖的最小 Agent 契约：两平台原生 Agent 的 aiAssert 在
 * keepRawResponse 下返回结构化判定（判定不通过不抛错），基础设施错误仍抛出。
 */
export interface WaitUntilAgent {
  aiAssert(
    assertion: string,
    message?: string,
    options?: { keepRawResponse?: boolean; abortSignal?: AbortSignal },
  ): Promise<{ pass: boolean; thought?: string; message?: string } | undefined>;
}

export interface DeviceWaitUntilProjectContext extends DeviceLifecycleProjectContext {
  agent: DeviceLifecycleProjectContext['agent'] & WaitUntilAgent;
}

/** 严格输入：prompt 必填；timeoutMs/intervalMs 带默认值，且间隔必须小于总预算。 */
export const deviceWaitUntilInputSchema = z
  .strictObject({
    prompt: z
      .string()
      .min(1, 'prompt 必须是非空字符串')
      .describe('等待条件：描述当前界面上可观察的状态，满足即结束等待。'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(10000)
      .describe('等待总预算（毫秒），超时即失败，默认 10000。'),
    intervalMs: z
      .number()
      .int()
      .positive()
      .default(500)
      .describe('两次判定之间的轮询间隔（毫秒），默认 500。'),
  })
  .superRefine((value, ctx) => {
    if (value.intervalMs >= value.timeoutMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['intervalMs'],
        message: 'intervalMs 必须小于 timeoutMs。',
      });
    }
  });

export type DeviceWaitUntilInput = z.infer<typeof deviceWaitUntilInputSchema>;

export interface DeviceWaitUntilOutcome {
  attempts: number;
  elapsedMs: number;
}

function lastReasonOf(
  result: { pass: boolean; thought?: string; message?: string } | undefined,
): string {
  return result?.thought || result?.message || '（模型未给出原因）';
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('device.waitUntil 已取消'));
      return;
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('device.waitUntil 已取消'));
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 轮询执行体：预算内开始下一轮判定，预算耗尽即超时；条件满足返回
 * attempts/elapsedMs，超时抛错并携带最后一次判定原因，取消经 signal 抛出。
 * 由未加前缀的框架 Node 与 multi-device 别名化 Node 共用。
 */
export async function runDeviceWaitUntil(
  agent: WaitUntilAgent,
  input: DeviceWaitUntilInput,
  options: { signal: AbortSignal; deadlineAtMs: number },
): Promise<DeviceWaitUntilOutcome> {
  const startedAtMs = Date.now();
  let attempts = 0;
  let lastReason = '（无判定结果）';
  while (true) {
    options.signal.throwIfAborted();
    if (Date.now() >= options.deadlineAtMs) break;
    attempts += 1;
    const result = await agent.aiAssert(input.prompt, undefined, {
      keepRawResponse: true,
      abortSignal: options.signal,
    });
    if (result?.pass) {
      return { attempts, elapsedMs: Date.now() - startedAtMs };
    }
    lastReason = lastReasonOf(result);
    // 睡眠不超过剩余预算；耗尽后回到循环顶部按超时收尾。
    const remainingMs = options.deadlineAtMs - Date.now();
    await abortableDelay(
      Math.min(input.intervalMs, Math.max(0, remainingMs)),
      options.signal,
    );
  }
  options.signal.throwIfAborted();
  throw new Error(
    `device.waitUntil 在 ${Date.now() - startedAtMs}ms 内未满足条件（共判定 ${attempts} 次）。最后判定：${lastReason}`,
  );
}

export function asWaitUntilAgent(agent: unknown, nodeName: string): WaitUntilAgent {
  if (
    !agent ||
    typeof agent !== 'object' ||
    typeof (agent as WaitUntilAgent).aiAssert !== 'function'
  ) {
    throw new Error(
      `${nodeName} 需要执行项目 setup 提供具备 aiAssert 的 Agent；请确认用例在目标执行项目中运行。`,
    );
  }
  return agent as WaitUntilAgent;
}

/**
 * device.waitUntil：通用显式等待（执行控制 + 通用观测）。轮询判定当前绑定
 * 设备界面上的自然语言条件，满足即继续、超时即失败，替代按最坏情况预估的
 * 固定 wait 以缩短用例耗时。条件语义由使用方 Case 提供，本节点不含业务知识。
 */
export const deviceWaitUntilNode = defineNode<
  typeof deviceWaitUntilInputSchema,
  DeviceWaitUntilOutcome,
  DeviceWaitUntilProjectContext
>({
  name: 'device.waitUntil',
  description:
    '显式等待：轮询判定当前绑定设备界面上的自然语言条件，满足即继续，超时失败。用于等待预期最终出现的界面状态，替代按最坏情况预估的固定 wait，缩短用例耗时。',
  stringInputKey: 'prompt',
  inputSchema: deviceWaitUntilInputSchema,
  async execute(execution) {
    const agent = asWaitUntilAgent(execution.context?.agent, 'device.waitUntil');
    const now = Date.now();
    const deadlineAtMs = Math.min(
      now + execution.input.timeoutMs,
      execution.$.timeoutMs === undefined ? Number.POSITIVE_INFINITY : now + execution.$.timeoutMs,
    );
    const stopTraces = attachAgentExecutionTraces(execution, agent);
    try {
      const outcome = await runDeviceWaitUntil(agent, execution.input, {
        signal: execution.signal,
        deadlineAtMs,
      });
      return {
        summary: `device.waitUntil 条件满足（第 ${outcome.attempts} 次判定，耗时 ${outcome.elapsedMs}ms）`,
        data: outcome,
      };
    } finally {
      stopTraces();
    }
  },
});
