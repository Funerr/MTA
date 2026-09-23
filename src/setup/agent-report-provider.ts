import { isAbsolute, resolve } from 'node:path';
import type { NodeExecutionContext } from '@midscene/test';
import type {
  AgentProvider,
  AgentReleaseResult,
  MidsceneUIAgent,
} from '@midscene/test/midscene';

/** 可提供报告文件路径的 Agent（AndroidAgent / HarmonyAgent 公开 reportFile）。 */
export interface ReportSourceAgent {
  reportFile?: string | null;
}

/** 可派生同构实例的 Agent 最小面（官方 Agent 公开字段：设备抽象与构造选项）。 */
export interface DerivableAgent {
  /** 底层设备抽象（官方 `Agent.interface`），派生实例共享同一设备。 */
  readonly interface: unknown;
  /** Agent 构造选项（官方 `Agent.opts`），派生实例原样沿用。 */
  readonly opts: unknown;
}

type ScopedAgentBase = MidsceneUIAgent & ReportSourceAgent & DerivableAgent;

/**
 * 官方 getExecutionId 契约（createMidsceneNodes 同构）：case 作用域按
 * `case.runId` 归属，document 生命周期步骤按 `documentRunId` 归属。
 */
export function executionScopeIdOf(
  execution: NodeExecutionContext<unknown, unknown> | undefined,
): string | undefined {
  const scoped = execution as
    | {
        scope?: string;
        case?: { runId?: string };
        document?: { documentRunId?: string };
      }
    | undefined;
  if (scoped?.scope === 'case') return scoped.case?.runId;
  return scoped?.document?.documentRunId;
}

const scopedAgentsByShared = new WeakMap<object, Map<string, unknown>>();

/**
 * 从共享 Agent 派生并缓存作用域实例：共享底层设备（interface）与构造选项（opts），
 * 各自独立持有 dump 与报告写入器（reportFile）。官方 Node（经 agentProvider）
 * 与自定义 Node 的调用都收敛到这里，保证同一作用域内执行与 dump 观测是同一实例。
 * 派生实例不单独 destroy——设备释放仍归会话 teardown（原生 Agent.destroy 会释放设备）。
 * 不具备官方 Agent 公开构造面的受控替身（或无作用域信息的调用）原样返回共享实例。
 */
export function scopedRunAgentFor<TAgent>(
  execution: NodeExecutionContext<unknown, unknown> | undefined,
  shared: TAgent,
): TAgent {
  const scopeId = executionScopeIdOf(execution);
  if (!scopeId || !isDerivableAgent(shared)) {
    return shared;
  }
  let byScope = scopedAgentsByShared.get(shared);
  if (!byScope) {
    byScope = new Map<string, unknown>();
    scopedAgentsByShared.set(shared, byScope);
  }
  const existing = byScope.get(scopeId);
  if (existing !== undefined) return existing as TAgent;
  const derived = deriveRunAgent(shared);
  byScope.set(scopeId, derived);
  return derived;
}

/**
 * 锁定依赖契约：官方 `Agent` 构造签名为 `constructor(interfaceInstance, opts?)`，
 * `interface` 与 `opts` 均为公开字段（见针对锁定依赖的契约测试）。
 * 受控替身（普通对象字面量）不具备该构造面，跳过派生以保持替身语义。
 */
function isDerivableAgent(
  value: unknown,
): value is DerivableAgent & {
  constructor: new (interfaceInstance: unknown, opts?: unknown) => unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'interface' in value &&
    'opts' in value &&
    typeof (value as object).constructor === 'function' &&
    (value as object).constructor !== Object
  );
}

function deriveRunAgent<TAgent>(shared: TAgent): TAgent {
  const source = shared as unknown as DerivableAgent & {
    constructor: new (interfaceInstance: unknown, opts?: unknown) => TAgent;
  };
  return new source.constructor(source.interface, source.opts);
}

/**
 * 官方 agentProvider 契约：getAgent(runId) 返回该作用域执行所用的 Agent，
 * releaseAgent(runId) 上报该作用域的报告来源（AgentReleaseResult.reportPath），
 * 由官方工厂在对应用例作用域 teardown 时登记。报告组装要求「一个 sourcePath
 * 只属于一个 scope」，因此每个作用域派生独立实例（独立 reportFile），
 * 不再让共享 Agent 的单一报告文件跨越多个作用域。
 */
export function createScopedAgentReportProvider<
  TContext,
  TAgent extends ScopedAgentBase,
>(
  resolveSharedAgent: (
    execution: NodeExecutionContext<unknown, TContext>,
  ) => TAgent,
): AgentProvider<TContext> {
  const agentsByRunId = new Map<string, TAgent>();
  return {
    getAgent(runId, execution) {
      const agent = scopedRunAgentFor(execution, resolveSharedAgent(execution));
      agentsByRunId.set(runId, agent);
      return agent;
    },
    async releaseAgent(runId: string): Promise<AgentReleaseResult | undefined> {
      const agent = agentsByRunId.get(runId);
      agentsByRunId.delete(runId);
      const reportFile = agent?.reportFile;
      if (typeof reportFile !== 'string' || reportFile.trim().length === 0) {
        return undefined;
      }
      return {
        reportPath: isAbsolute(reportFile) ? reportFile : resolve(reportFile),
      };
    },
  };
}
