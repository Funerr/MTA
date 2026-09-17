/**
 * 并行子调用汇合：公开 Node.execute 委托，不经过私有 Runner API。
 * 父步骤超时/取消通过 AbortSignal 传给仍在途的子调用，并等待它们结束。
 * 失败错误继承官方 WorkflowError，以便 CaseRunner 原样抛出而不再包一层 NodeExecutionError。
 */
import { WorkflowError } from '@midscene/test';

export interface ParallelChildCall {
  readonly alias: string;
  readonly node: string;
  execute(signal: AbortSignal): Promise<ParallelChildResult>;
}

export interface ParallelChildResult {
  readonly alias: string;
  readonly node: string;
  readonly status: 'success' | 'failed' | 'cancelled';
  readonly summary?: string;
  readonly executionIds: readonly string[];
  readonly error?: string;
}

export class DeviceParallelStepError extends WorkflowError {
  readonly results: readonly ParallelChildResult[];

  constructor(results: readonly ParallelChildResult[]) {
    super(formatParallelFailure(results), {
      code: 'DEVICE_PARALLEL_STEP_ERROR',
      details: { results },
    });
    this.name = 'DeviceParallelStepError';
    this.results = results;
  }
}

export function formatParallelFailure(
  results: readonly ParallelChildResult[],
): string {
  const details = results
    .map((result) => {
      const head = `${result.alias}.${result.node}=${result.status}`;
      return result.error ? `${head}（${result.error}）` : head;
    })
    .join('；');
  return `device.parallel 失败：${details}`;
}

export function isFailedParallelResult(
  result: ParallelChildResult,
): boolean {
  return result.status !== 'success';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelError(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  if (error === signal.reason) return true;
  return error instanceof Error && /aborted|abort|cancel|timeout/i.test(error.message);
}

export async function runParallelChildCalls(
  calls: readonly ParallelChildCall[],
  parentSignal: AbortSignal,
): Promise<readonly ParallelChildResult[]> {
  parentSignal.throwIfAborted();
  const controllers = calls.map(() => new AbortController());
  const abortOthers = (reason: unknown) => {
    for (const controller of controllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  };
  const onParentAbort = () => abortOthers(parentSignal.reason);
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener('abort', onParentAbort, { once: true });

  try {
    return await Promise.all(
      calls.map(async (call, index): Promise<ParallelChildResult> => {
        const signal = controllers[index]!.signal;
        try {
          const result = await call.execute(signal);
          if (result.status !== 'success') {
            abortOthers(new Error(result.error ?? `${result.alias}.${result.node} ${result.status}`));
          }
          return result;
        } catch (error) {
          // 状态必须在 abortOthers 之前判定：abortOthers 也会中止本次调用的信号，
          // 之后无法区分“被取消”与“自身失败”。
          const status =
            isCancelError(error, signal) || parentSignal.aborted
              ? 'cancelled'
              : 'failed';
          abortOthers(error);
          return {
            alias: call.alias,
            node: call.node,
            status,
            executionIds: [],
            error: errorMessage(error),
          };
        }
      }),
    );
  } finally {
    parentSignal.removeEventListener('abort', onParentAbort);
  }
}

export function settleParallelResults(
  results: readonly ParallelChildResult[],
): readonly ParallelChildResult[] {
  if (results.some(isFailedParallelResult)) {
    throw new DeviceParallelStepError(results);
  }
  return results;
}
