import { randomUUID } from 'node:crypto';
import { promoteExperience } from '../promotion/promoter';
import { createStoreImageLoader, replayExperienceChain } from '../replay/replay';
import type { ReplayFailureKind, ReplayResult } from '../replay/types';
import type { CandidateChain } from '../store/experience-store';
import { executionIdsOf } from '../promotion/trace-adapter';
import { ACTION_POLICY_VERSION } from './constants';
import {
  deriveEligibleRequestKey,
  evaluateActionEligibility,
  normalizeActionPolicy,
  requestKeySourceOf,
} from './eligibility';
import { lookupExperienceCandidate } from './lookup';
import { unknownModelCounts } from './observe';
import type {
  ExperienceRuntimeDeps,
  ExperienceRuntimeInput,
  ExperienceRuntimeResult,
  ExperienceRunErrorKind,
  ModelCallCounts,
  NativeActResult,
  RepeatableActionTarget,
  RuntimeEvent,
  SelectedCandidate,
} from './types';

const VISUAL_FAILURE_KINDS: ReadonlySet<ReplayFailureKind> = new Set([
  'no-match',
  'matcher-error',
]);

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

export class ExperienceRunError extends Error {
  readonly kind: ExperienceRunErrorKind;
  readonly result: ExperienceRuntimeResult;

  constructor(kind: ExperienceRunErrorKind, result: ExperienceRuntimeResult, cause?: unknown) {
    super(result.reason, cause === undefined ? undefined : { cause });
    this.name = 'ExperienceRunError';
    this.kind = kind;
    this.result = result;
  }
}

function selectedOf(chain: CandidateChain): SelectedCandidate {
  return {
    requestKey: chain.requestKey,
    variantId: chain.variantId,
    revision: chain.revision,
    status: chain.status,
    learnedAt: chain.learnedAt,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError')
  );
}

/**
 * 经验运行时：Lookup → Replay → 至多一次原生 AI → Promotion。
 * 不覆盖原生 aiAct，不猜测未登记目标的幂等性，不把断言请求当动作链。
 */
export class ExperienceRuntime {
  private readonly policy;
  private nativeInvocations = 0;

  constructor(private readonly deps: ExperienceRuntimeDeps) {
    this.policy = normalizeActionPolicy(deps.policy);
  }

  async run(input: ExperienceRuntimeInput): Promise<ExperienceRuntimeResult> {
    this.nativeInvocations = 0;
    const callId = input.callId ?? randomUUID();
    const now = this.deps.now ?? Date.now;
    const events: RuntimeEvent[] = [];
    const observer = this.deps.modelObserver;
    observer?.begin(callId);

    const emit = (
      event: Omit<RuntimeEvent, 'at' | 'callId' | 'caseName' | 'stepPath' | 'runId' | 'caseId' | 'attempt'> &
        Partial<Pick<RuntimeEvent, 'runId' | 'caseId' | 'attempt'>>,
    ): RuntimeEvent => {
      const { type, reason, ...optionalEvent } = event;
      const full: RuntimeEvent = {
        at: new Date(now()).toISOString(),
        callId,
        caseName: input.identity.caseName,
        stepPath: input.identity.stepPath,
        type,
        reason,
        ...(input.identity.runId === undefined ? {} : { runId: input.identity.runId }),
        ...(input.identity.caseId === undefined ? {} : { caseId: input.identity.caseId }),
        ...(input.identity.attempt === undefined ? {} : { attempt: input.identity.attempt }),
        ...withoutUndefined(optionalEvent),
      };
      events.push(full);
      return full;
    };

    const finishCounts = (): ModelCallCounts =>
      observer?.end(callId) ?? unknownModelCounts('未接入模型观测，不能以无日志证明零调用');

    const finalize = async (
      partial: Omit<ExperienceRuntimeResult, 'callId' | 'events' | 'modelCalls'> & {
        readonly modelCalls?: ModelCallCounts;
      },
    ): Promise<ExperienceRuntimeResult> => {
      const { outcome, nativeCalled, reason, modelCalls, ...optionalResult } = partial;
      const result: ExperienceRuntimeResult = {
        outcome,
        nativeCalled,
        callId,
        events,
        modelCalls: modelCalls ?? finishCounts(),
        reason,
        ...withoutUndefined(optionalResult),
      };
      if (this.deps.reporter) {
        try {
          await this.deps.reporter.record(result);
        } catch {
          // 报告失败不影响 UI 结果，也不触发再次执行。
        }
      }
      return result;
    };

    const throwRun = async (
      kind: ExperienceRunErrorKind,
      partial: Omit<ExperienceRuntimeResult, 'callId' | 'events' | 'modelCalls'>,
      cause?: unknown,
    ): Promise<never> => {
      const result = await finalize(partial);
      throw new ExperienceRunError(kind, result, cause);
    };

    const budgetKind = (): ExperienceRunErrorKind | undefined => {
      if (input.signal?.aborted) return 'cancelled';
      if (input.deadlineAtMs !== undefined && now() >= input.deadlineAtMs) return 'timeout';
      return undefined;
    };

    const blocked = budgetKind();
      if (blocked) {
        emit({ type: 'MISS', status: blocked, reason: '调用已取消或截止时间耗尽，不启动经验或原生 AI' });
        return await throwRun(blocked, {
          outcome: 'cancelled',
          nativeCalled: false,
          reason: blocked === 'cancelled' ? '调用已取消' : '调用截止时间已耗尽',
        });
      }

      const eligibility = evaluateActionEligibility(input.request, this.policy);
      const key = deriveEligibleRequestKey(input.request, input.identity, this.policy.version);
      if (!eligibility.eligible || !key.eligible) {
        const reason = !eligibility.eligible
          ? eligibility.reason
          : `请求 Key 不合格：${!key.eligible ? key.reason : '未知原因'}`;
        emit({ type: 'MISS', status: 'ineligible', reason });
        return await this.nativeOnce({
          input,
          callId,
          now,
          emit,
          finalize,
          throwRun,
          budgetKind,
          reason,
          requestKey: key.eligible ? key.requestKey : undefined,
        });
      }

      if (!this.deps.environment) {
        emit({
          type: 'MISS',
          status: 'environment-unavailable',
          reason: '缺少执行环境，无法查询经验，回退原生 AI',
        });
        return await this.nativeOnce({
          input,
          callId,
          now,
          emit,
          finalize,
          throwRun,
          budgetKind,
          reason: '缺少执行环境，无法查询或发布经验',
        });
      }

      let screenshot: Uint8Array;
      try {
        screenshot = await this.deps.captureScreenshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'MISS', status: 'device', reason: `入口截图失败：${message}` });
        return await throwRun(
          'device',
          {
            outcome: 'failed',
            nativeCalled: false,
            reason: `设备截图失败，不追加原生 AI：${message}`,
          },
          error,
        );
      }

      const lookup = await lookupExperienceCandidate({
        store: this.deps.store,
        requestKey: key.requestKey,
        environment: this.deps.environment,
        currentScreenshot: screenshot,
        matchScreen: this.deps.matchScreen,
        loadImage: this.deps.loadImage ?? createStoreImageLoader(this.deps.store),
      });

      if (lookup.kind === 'miss') {
        emit({
          type: 'LOOKUP',
          status: lookup.reason,
          reason: lookup.found > 0 ? `lookup-found:${lookup.detail}` : lookup.detail,
        });
        emit({ type: 'MISS', status: lookup.reason, reason: lookup.detail });
        return await this.nativeOnce({
          input,
          callId,
          now,
          emit,
          finalize,
          throwRun,
          budgetKind,
          reason: lookup.detail,
          requestKey: key.requestKey,
        });
      }

      emit({
        type: 'LOOKUP',
        status: 'validated-hit',
        reason: `lookup-found ${lookup.found} → validated-hit`,
        revision: lookup.selected.revision,
        variantId: lookup.selected.variantId,
      });
      emit({
        type: 'HIT',
        status: lookup.selected.status,
        reason: '入口验证通过，尝试一次选定链重放',
        revision: lookup.selected.revision,
        variantId: lookup.selected.variantId,
      });

      const replayStarted = now();
      const replay = await (this.deps.replayChain ?? replayExperienceChain)({
        chain: lookup.selected,
        environment: this.deps.environment,
        target: this.deps.replayTarget,
        loadImage: this.deps.loadImage ?? createStoreImageLoader(this.deps.store),
        signal: input.signal,
        deadlineAtMs: input.deadlineAtMs,
        waitPollIntervalMs: this.deps.replayOptions?.waitPollIntervalMs,
        maxAfterWaitMs: this.deps.replayOptions?.maxAfterWaitMs,
      });
      emit({
        type: 'REPLAY',
        status: replay.status,
        reason: replay.reason,
        revision: lookup.selected.revision,
        variantId: lookup.selected.variantId,
        durationMs: Math.max(0, now() - replayStarted),
      });

      if (replay.status === 'success') {
        const snapshot = await this.applyReplaySuccess(lookup.selected, callId);
        const result = await finalize({
          outcome: 'replay',
          nativeCalled: false,
          selected: selectedOf(lookup.selected),
          replay,
          snapshot: snapshot,
          reason: '视觉重放完整成功，本步骤不调用 AI',
        });
        return result;
      }

      const failureKind = replay.failure?.kind;
      if (replay.status === 'cancelled' || failureKind === 'cancelled' || failureKind === 'timeout') {
        const kind: ExperienceRunErrorKind = failureKind === 'timeout' ? 'timeout' : 'cancelled';
        return await throwRun(kind, {
          outcome: 'cancelled',
          nativeCalled: false,
          selected: selectedOf(lookup.selected),
          replay,
          reason: replay.reason,
        });
      }

      if (replay.effect === 'unknown') {
        return await throwRun('unknown-effect', {
          outcome: 'failed',
          nativeCalled: false,
          selected: selectedOf(lookup.selected),
          replay,
          reason: '设备动作副作用未知，不追加 AI 或切换候选',
        });
      }

      if (failureKind === 'device-error' || failureKind === 'screenshot-error') {
        return await throwRun('device', {
          outcome: 'failed',
          nativeCalled: false,
          selected: selectedOf(lookup.selected),
          replay,
          reason: `设备不可用（${failureKind}），不修改视觉状态、不追加 AI`,
        });
      }

      if (failureKind && VISUAL_FAILURE_KINDS.has(failureKind)) {
        await this.applyVisualFailure(lookup.selected, callId, replay.reason);
      }

      const target = eligibility.target;
      const canFallback = this.canFallback(replay, target, budgetKind());
      if (!canFallback) {
        return await throwRun('budget', {
          outcome: 'failed',
          nativeCalled: false,
          selected: selectedOf(lookup.selected),
          replay,
          reason: this.fallbackDeniedReason(replay, target, budgetKind()),
        });
      }

      return await this.nativeOnce({
        input,
        callId,
        now,
        emit,
        finalize,
        throwRun,
        budgetKind,
        reason: `重放停止后回退原生：${replay.reason}`,
        requestKey: key.requestKey,
        selected: selectedOf(lookup.selected),
        replay,
      });
  }

  private canFallback(
    replay: ReplayResult,
    target: RepeatableActionTarget,
    budget?: ExperienceRunErrorKind,
  ): boolean {
    if (budget) return false;
    if (replay.effect === 'unknown') return false;
    if (replay.effect === 'none') return true;
    return target.repeatableFromCurrentState;
  }

  private fallbackDeniedReason(
    replay: ReplayResult,
    target: RepeatableActionTarget,
    budget?: ExperienceRunErrorKind,
  ): string {
    if (budget === 'cancelled') return '调用已取消，不追加 AI';
    if (budget === 'timeout') return '截止时间耗尽，不追加 AI';
    if (replay.effect === 'unknown') return '未知副作用，不追加 AI';
    if (replay.effect === 'confirmed-partial' && !target.repeatableFromCurrentState) {
      return '已确认部分完成，但目标不允许从当前状态重复达成，不追加 AI';
    }
    return `重放失败且不允许回退：${replay.reason}`;
  }

  private async applyReplaySuccess(chain: CandidateChain, callId: string) {
    const applied = await this.deps.store.applyVariantEvent({
      eventId: `${callId}:replay-succeeded`,
      requestKey: chain.requestKey,
      variantId: chain.variantId,
      expectedRevision: chain.revision,
      event: { type: 'replay-succeeded' },
    });
    return applied.ok ? applied.value.snapshot : undefined;
  }

  private async applyVisualFailure(chain: CandidateChain, callId: string, reason: string): Promise<void> {
    await this.deps.store.applyVariantEvent({
      eventId: `${callId}:replay-failed`,
      requestKey: chain.requestKey,
      variantId: chain.variantId,
      expectedRevision: chain.revision,
      event: { type: 'replay-failed' },
    });
    await this.deps.store.applyVariantEvent({
      eventId: `${callId}:marked-stale`,
      requestKey: chain.requestKey,
      variantId: chain.variantId,
      expectedRevision: chain.revision,
      event: { type: 'marked-stale', reason },
    });
  }

  private async nativeOnce(args: {
    readonly input: ExperienceRuntimeInput;
    readonly callId: string;
    readonly now: () => number;
    readonly emit: (
      event: Omit<RuntimeEvent, 'at' | 'callId' | 'caseName' | 'stepPath' | 'runId' | 'caseId' | 'attempt'>,
    ) => RuntimeEvent;
    readonly finalize: (
      partial: Omit<ExperienceRuntimeResult, 'callId' | 'events' | 'modelCalls'> & {
        readonly modelCalls?: ModelCallCounts;
      },
    ) => Promise<ExperienceRuntimeResult>;
    readonly throwRun: (
      kind: ExperienceRunErrorKind,
      partial: Omit<ExperienceRuntimeResult, 'callId' | 'events' | 'modelCalls'>,
      cause?: unknown,
    ) => Promise<never>;
    readonly budgetKind: () => ExperienceRunErrorKind | undefined;
    readonly reason: string;
    readonly requestKey?: string;
    readonly selected?: SelectedCandidate;
    readonly replay?: ReplayResult;
  }): Promise<ExperienceRuntimeResult> {
    const blocked = args.budgetKind();
    if (blocked) {
      args.emit({ type: 'FALLBACK', status: blocked, reason: '回退前预算已耗尽，不调用原生 AI' });
      return await args.throwRun(blocked, {
        outcome: 'cancelled',
        nativeCalled: false,
        selected: args.selected,
        replay: args.replay,
        reason: blocked === 'cancelled' ? '调用已取消，不追加 AI' : '截止时间耗尽，不追加 AI',
      });
    }
    if (this.nativeInvocations >= 1) {
      return await args.throwRun('native', {
        outcome: 'failed',
        nativeCalled: true,
        selected: args.selected,
        replay: args.replay,
        reason: '单次尝试已调用过原生 AI，拒绝形成回退循环',
      });
    }

    this.nativeInvocations += 1;
    const prompt = typeof args.input.request.prompt === 'string' ? args.input.request.prompt : '';
    const knownExecutionIds = this.deps.getDump
      ? new Set(executionIdsOf(this.deps.getDump()))
      : undefined;
    args.emit({
      type: 'FALLBACK',
      status: 'native',
      reason: args.reason,
      revision: args.selected?.revision,
      variantId: args.selected?.variantId,
    });

    const nativeStarted = args.now();
    let native: NativeActResult;
    try {
      native = await this.deps.nativeExecute({
        prompt,
        signal: args.input.signal,
        deadlineAtMs: args.input.deadlineAtMs,
        callId: args.callId,
      });
    } catch (error) {
      if (isAbortError(error) || args.input.signal?.aborted) {
        args.emit({
          type: 'FALLBACK',
          status: 'cancelled',
          reason: '原生执行被取消',
          durationMs: Math.max(0, args.now() - nativeStarted),
        });
        return await args.throwRun(
          'cancelled',
          {
            outcome: 'cancelled',
            nativeCalled: true,
            selected: args.selected,
            replay: args.replay,
            reason: '原生执行已取消，不学习',
          },
          error,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      args.emit({
        type: 'FALLBACK',
        status: 'failed',
        reason: `原生 AI 失败：${message}`,
        durationMs: Math.max(0, args.now() - nativeStarted),
      });
      return await args.throwRun(
        'native',
        {
          outcome: 'failed',
          nativeCalled: true,
          selected: args.selected,
          replay: args.replay,
          reason: `原生 AI 失败，不学习：${message}`,
        },
        error,
      );
    }

    args.emit({
      type: 'FALLBACK',
      status: 'success',
      reason: '原生 AI 成功',
      durationMs: Math.max(0, args.now() - nativeStarted),
    });

    if (native.category !== 'undefined') {
      args.emit({
        type: 'PROMOTE',
        status: 'skipped',
        reason: `原生返回类别为 ${native.category}，v1 只学习纯动作（undefined）`,
      });
      return args.finalize({
        outcome: 'native',
        nativeCalled: true,
        selected: args.selected,
        replay: args.replay,
        value: native.value,
        reason: '原生成功（动态返回值透传，不学习）',
      });
    }

    if (!args.requestKey || !this.deps.environment) {
      args.emit({
        type: 'PROMOTE',
        status: 'skipped',
        reason: !args.requestKey ? '请求 Key 不合格，不发布经验' : '缺少执行环境，不发布经验',
      });
      return args.finalize({
        outcome: 'native',
        nativeCalled: true,
        selected: args.selected,
        replay: args.replay,
        value: native.value,
        reason: '原生成功（请求不合格，不学习）',
      });
    }

    const promoteFn = this.deps.promote ?? promoteExperience;
    let promote: Awaited<ReturnType<typeof promoteExperience>>;
    try {
      promote = await promoteFn({
        callId: args.callId,
        dump: native.dump,
        request: requestKeySourceOf(args.input.request, args.input.identity, this.policy.version),
        environment: this.deps.environment,
        source: {
          casePath: args.input.identity.casePath,
          caseName: args.input.identity.caseName,
          stepPath: args.input.identity.stepPath,
          node: 'aiAct',
          prompt,
        },
        store: this.deps.store,
        nativeResult: { category: 'undefined' },
        knownExecutionIds,
        policy: {
          version: this.policy.version || ACTION_POLICY_VERSION,
          allowSemanticChecks: false,
          allowDynamicOutput: false,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      args.emit({ type: 'PROMOTE', status: 'failed', reason: `Promotion 抛出异常：${message}` });
      return args.finalize({
        outcome: 'native',
        nativeCalled: true,
        selected: args.selected,
        replay: args.replay,
        value: native.value,
        reason: '原生成功（学习过程异常，不改变 UI 成功）',
      });
    }

    args.emit({
      type: 'PROMOTE',
      status: promote.result,
      reason:
        promote.result === 'promoted'
          ? promote.duplicate
            ? '发布幂等命中已有 candidate'
            : '已发布新 candidate'
          : promote.reason,
      revision: promote.result === 'promoted' ? promote.snapshot.revision : undefined,
      variantId: promote.result === 'promoted' ? promote.snapshot.variantId : undefined,
    });
    return args.finalize({
      outcome: 'native',
      nativeCalled: true,
      selected: args.selected,
      replay: args.replay,
      promote,
      snapshot: promote.result === 'promoted' ? promote.snapshot : undefined,
      value: native.value,
      reason:
        promote.result === 'promoted'
          ? '原生成功并尝试发布经验'
          : `原生成功（学习${promote.result}：${promote.reason}）`,
    });
  }
}
