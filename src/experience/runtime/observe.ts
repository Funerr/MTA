import type { ModelCallCounts, ModelCallObserver, RuntimeReporter } from './types';
import {
  UNKNOWN_MODEL_COUNTS_SOURCE,
  VERIFIED_DUMP_SOURCE,
  VERIFIED_DUMP_TRANSPORT_SOURCE,
} from './constants';

export function unknownModelCounts(reason: string, source = UNKNOWN_MODEL_COUNTS_SOURCE): ModelCallCounts {
  return {
    status: 'unknown',
    locateVlm: null,
    otherModel: null,
    assertModel: null,
    source,
    reason,
  };
}

export function verifiedZeroModelCounts(source: string, reason: string): ModelCallCounts {
  return {
    status: 'verified',
    locateVlm: 0,
    otherModel: 0,
    assertModel: 0,
    source,
    reason,
  };
}

interface DumpTask {
  readonly type?: unknown;
  readonly subType?: unknown;
  readonly usage?: unknown;
}

interface DumpExecution {
  readonly id?: unknown;
  readonly tasks?: unknown;
}

function asExecutions(dump: unknown): DumpExecution[] {
  if (!dump || typeof dump !== 'object') return [];
  const executions = (dump as { executions?: unknown }).executions;
  if (!Array.isArray(executions)) return [];
  return executions as DumpExecution[];
}

function taskHasUsage(task: DumpTask): boolean {
  return task.usage !== undefined && task.usage !== null;
}

function classifyTask(task: DumpTask): 'locate' | 'assert' | 'other' | undefined {
  if (!taskHasUsage(task)) return undefined;
  const type = typeof task.type === 'string' ? task.type : '';
  const subType = typeof task.subType === 'string' ? task.subType : '';
  if (type === 'Planning' && subType === 'Locate') return 'locate';
  if (type === 'Insight') return 'assert';
  return 'other';
}

export function classifyDumpModelCalls(dump: unknown, previousIds: ReadonlySet<string>): {
  readonly locateVlm: number;
  readonly otherModel: number;
  readonly assertModel: number;
  readonly newExecutionIds: readonly string[];
} {
  let locateVlm = 0;
  let otherModel = 0;
  let assertModel = 0;
  const newExecutionIds: string[] = [];
  for (const execution of asExecutions(dump)) {
    const id = typeof execution.id === 'string' ? execution.id : undefined;
    if (id && previousIds.has(id)) continue;
    if (id) newExecutionIds.push(id);
    const tasks = Array.isArray(execution.tasks) ? (execution.tasks as DumpTask[]) : [];
    for (const task of tasks) {
      const role = classifyTask(task);
      if (role === 'locate') locateVlm += 1;
      else if (role === 'assert') assertModel += 1;
      else if (role === 'other') otherModel += 1;
    }
  }
  return { locateVlm, otherModel, assertModel, newExecutionIds };
}

export interface DumpObserverOptions {
  readonly getDump: () => unknown;
  readonly getMetricsCalls?: () => number;
  readonly getTransportCalls?: () => number;
}

/**
 * 锁定版本可用的调用级观测：对比 dump 新增 execution 的 usage，
 * 并以 metrics/传输层交叉验证。遗漏路径标 unknown，不以无日志当零。
 */
export function createDumpModelObserver(options: DumpObserverOptions): ModelCallObserver {
  let started: {
    callId: string;
    ids: Set<string>;
    metrics: number;
    transport: number | undefined;
  } | undefined;

  return {
    begin(callId) {
      const ids = new Set<string>();
      for (const execution of asExecutions(options.getDump())) {
        if (typeof execution.id === 'string') ids.add(execution.id);
      }
      started = {
        callId,
        ids,
        metrics: options.getMetricsCalls?.() ?? 0,
        transport: options.getTransportCalls?.(),
      };
    },
    end(callId) {
      if (!started || started.callId !== callId) {
        return unknownModelCounts('模型观测未覆盖本次调用路径');
      }
      let dump: unknown;
      try {
        dump = options.getDump();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return unknownModelCounts(`读取 dump 失败，计数不可验证：${reason}`);
      }
      const classified = classifyDumpModelCalls(dump, started.ids);
      const classifiedTotal = classified.locateVlm + classified.otherModel + classified.assertModel;
      const metricsDelta = Math.max(0, (options.getMetricsCalls?.() ?? started.metrics) - started.metrics);
      const transportDelta =
        started.transport === undefined || options.getTransportCalls === undefined
          ? undefined
          : Math.max(0, options.getTransportCalls() - started.transport);

      if (transportDelta !== undefined && transportDelta > classifiedTotal) {
        return unknownModelCounts(
          `传输层记录 ${transportDelta} 次模型请求，dump usage 仅覆盖 ${classifiedTotal} 次，不能记为零`,
          VERIFIED_DUMP_TRANSPORT_SOURCE,
        );
      }
      if (metricsDelta > classifiedTotal) {
        return unknownModelCounts(
          `Agent metrics 记录 ${metricsDelta} 次调用，dump usage 仅覆盖 ${classifiedTotal} 次，不能记为零`,
        );
      }
      const source = transportDelta === undefined ? VERIFIED_DUMP_SOURCE : VERIFIED_DUMP_TRANSPORT_SOURCE;
      return {
        status: 'verified',
        locateVlm: classified.locateVlm,
        otherModel: classified.otherModel,
        assertModel: classified.assertModel,
        source,
        reason: '已按新增 dump 任务 usage 归因；未覆盖路径不会记为零',
      };
    },
  };
}

export function createRecordToReportReporter(
  recordToReport: (title: string, opt: { content: string }) => Promise<void>,
): RuntimeReporter {
  return {
    async record(result) {
      await recordToReport('experience-runtime', {
        content: JSON.stringify({
          callId: result.callId,
          outcome: result.outcome,
          nativeCalled: result.nativeCalled,
          reason: result.reason,
          selected: result.selected,
          modelCalls: result.modelCalls,
          events: result.events,
          replay: result.replay
            ? {
                status: result.replay.status,
                effect: result.replay.effect,
                completedActions: result.replay.completedActions,
                dispatchedActions: result.replay.dispatchedActions,
                phase: result.replay.phase,
                reason: result.replay.reason,
              }
            : undefined,
          promote: result.promote,
        }),
      });
    },
  };
}

export function capturePngFromDataUrl(raw: string): Uint8Array {
  const base64 = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '');
  const decoded = Buffer.from(base64, 'base64');
  if (decoded.byteLength === 0) {
    throw new Error('截图解码结果为空');
  }
  return new Uint8Array(decoded);
}
