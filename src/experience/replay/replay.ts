import type { BoundingBox } from '../schema/action';
import type { AssetRef } from '../schema/assets';
import { matchScreen, matchTarget } from '../matcher/match';
import type { ScreenMatchResult, VisualMatchResult } from '../matcher/types';
import {
  DEFAULT_AFTER_WAIT_MS,
  DEFAULT_WAIT_POLL_INTERVAL_MS,
} from './constants';
import {
  boxCenterPoint,
  buildReplayDispatchParam,
  REPLAY_ACTION_SUPPORT,
  type ReplayDispatchTarget,
} from './native-actions';
import { preflightReplayChain, type ReplayChainImages } from './validator';
import type {
  ReplayActionTarget,
  ReplayEffect,
  ReplayEvent,
  ReplayFailure,
  ReplayInput,
  ReplayPhase,
  ReplayResult,
} from './types';

/**
 * 逐步回放执行器（任务 2.1–2.5）：每个动作都基于新截图重新验证页面/目标/
 * 状态，按当前匹配框派发 Midscene 原生动作，动作后做有界等待与预期画面
 * 检查，最后一动作之后做终态视觉检查。不使用旧坐标盲放、不调用 AI 定位、
 * 不重试整链、不更新资产状态。
 */
export async function replayExperienceChain(input: ReplayInput): Promise<ReplayResult> {
  const emit = (event: ReplayEvent) => {
    input.onEvent?.(event);
  };
  const pollIntervalMs = input.waitPollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS;
  const maxAfterWaitMs = input.maxAfterWaitMs ?? DEFAULT_AFTER_WAIT_MS;
  const actions = input.chain.actions;

  let effect: ReplayEffect = 'none';
  let lastScreenshot: Uint8Array | undefined;
  let completedActions = 0;
  let dispatchedActions = 0;

  /** unknown 一旦成立不回退；confirmed-partial 只在尚无副作用时成立。 */
  const escalateEffect = (next: Exclude<ReplayEffect, 'none'>) => {
    if (next === 'unknown') effect = 'unknown';
    else if (effect === 'none') effect = 'confirmed-partial';
  };

  const signalAborted = () => input.signal?.aborted === true;
  const remainingMs = () =>
    input.deadlineAtMs === undefined ? Number.POSITIVE_INFINITY : input.deadlineAtMs - Date.now();

  const buildResult = (
    base: Pick<ReplayResult, 'status' | 'phase' | 'reason'> &
      Partial<Pick<ReplayResult, 'failedActionIndex' | 'failure'>>,
  ): ReplayResult => {
    const result: ReplayResult = {
      status: base.status,
      phase: base.phase,
      reason: base.reason,
      failure: base.failure,
      failedActionIndex: base.failedActionIndex ?? null,
      effect,
      completedActions,
      dispatchedActions,
      totalActions: actions.length,
    };
    return lastScreenshot === undefined ? result : { ...result, lastScreenshot };
  };

  const finish = (result: ReplayResult): ReplayResult => {
    emit({ type: 'replay-finished', result });
    return result;
  };

  /**
   * 取消/超时检查；返回非空结果表示立即停止。cancelReason 区分两种停止。
   * dispatchedJustNow 表示停止点位于一次派发返回之后：该动作未经验证，
   * 是否生效未知。
   */
  const checkStop = (
    phase: ReplayPhase,
    actionIndex: number | null,
    options: { dispatchedJustNow: boolean },
  ): ReplayResult | undefined => {
    const aborted = signalAborted();
    const expired = remainingMs() <= 0;
    if (!aborted && !expired) return undefined;
    if (options.dispatchedJustNow) escalateEffect('unknown');
    return buildResult({
      status: 'cancelled',
      phase,
      failedActionIndex: actionIndex ?? undefined,
      reason: aborted
        ? '上层取消信号已到达，停止派发后续动作'
        : '回放预算耗尽（剩余时间为 0），停止派发后续动作',
      failure: aborted
        ? { kind: 'cancelled', message: '回放被上层取消' }
        : { kind: 'timeout', message: '回放超出调用方截止时间' },
    });
  };

  emit({ type: 'replay-started', totalActions: actions.length });

  // ---- 整链预检：任一后续动作不支持/证据缺失时，首动作也不派发 ----
  const preflight = await preflightReplayChain({
    chain: input.chain,
    currentEnvironment: input.environment,
    loadImage: input.loadImage,
    matcherConfig: input.matcherConfig,
    signal: input.signal,
  });
  if (!preflight.ok) {
    // 预检前已取消属于取消语义，不改判为整链拒绝。
    return finish(
      buildResult({
        status: preflight.failure.kind === 'cancelled' ? 'cancelled' : 'rejected',
        phase: 'preflight',
        failedActionIndex: preflight.actionIndex,
        reason: preflight.failure.message,
        failure: preflight.failure,
      }),
    );
  }
  const images = preflight.images;

  const capture = async (): Promise<Uint8Array> => {
    const raw = await input.target.screenshotBase64();
    const base64 = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '');
    const decoded = Buffer.from(base64, 'base64');
    if (decoded.byteLength === 0) {
      throw new Error('截图解码结果为空');
    }
    return new Uint8Array(decoded);
  };

  const captureWithEvent = async (
    index: number,
    phase: 'before' | 'after' | 'terminal',
  ): Promise<{ ok: true; png: Uint8Array } | { ok: false; failure: ReplayFailure }> => {
    try {
      const png = await capture();
      lastScreenshot = png;
      emit({ type: 'screenshot', index, phase, png });
      return { ok: true, png };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        failure: {
          kind: 'screenshot-error',
          message: `截图失败（${phase}）：${reason}`,
          raw: reason,
        },
      };
    }
  };

  const contextPadRatio = readPadRatio(input.chain.entryEvidence.signature.params.padRatio);

  /** 无目标动作（Back/Home）的前置页面校验。 */
  const verifyPage = async (
    index: number,
    currentPng: Uint8Array,
    historicalPng: Uint8Array,
  ): Promise<ScreenMatchResult | VisualMatchResult> =>
    matchScreen({
      currentScreenshot: currentPng,
      currentEnvironment: input.environment,
      historicalScreenshot: historicalPng,
      historicalEnvironment: input.chain.environment,
      masks: input.masks,
      config: input.matcherConfig,
    });

  /** 有目标动作的前置验证：环境 + 页面 + 目标 + 上下文（及可选状态）。 */
  const verifyTarget = async (
    index: number,
    currentPng: Uint8Array,
  ): Promise<VisualMatchResult> => {
    const action = actions[index]!;
    const actionImages = images.actions[index]!;
    if (!('target' in action) || !action.target || !actionImages.target) {
      return {
        decision: 'error',
        code: 'invalid-config',
        reason: `actions[${index}]: 有目标动作缺少目标证据`,
        timingMs: 0,
        configVersion: '',
        dataVersion: '',
        algorithm: { pipeline: '', phash: '', ncc: '', ssim: '' },
      };
    }
    return matchTarget({
      currentScreenshot: currentPng,
      currentEnvironment: input.environment,
      historical: {
        environment: input.chain.environment,
        screenshot: actionImages.before,
        targetImage: actionImages.target.image,
        contextImage: actionImages.target.context,
        bbox: action.target.bbox,
        stateBefore: actionImages.target.state,
        textHint: action.target.textHint,
        contextPadRatio,
      },
      masks: input.masks,
      config: input.matcherConfig,
    });
  };

  /**
   * 动作后有界等待：每轮新截图并匹配动作后证据；上限为剩余预算与单次
   * 等待上界的较小值，不重置每步时间。
   */
  const waitAndVerifyAfter = async (
    index: number,
    afterPng: Uint8Array,
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly failure: ReplayFailure }
  > => {
    const waitDeadline = Math.min(
      Number.isFinite(remainingMs()) ? Date.now() + remainingMs() : Number.POSITIVE_INFINITY,
      Date.now() + maxAfterWaitMs,
    );
    let lastCode: string | undefined;
    for (;;) {
      const captureResult = await captureWithEvent(index, 'after');
      if (!captureResult.ok) return { ok: false, failure: captureResult.failure };
      const decision = await matchScreen({
        currentScreenshot: captureResult.png,
        currentEnvironment: input.environment,
        historicalScreenshot: afterPng,
        historicalEnvironment: input.chain.environment,
        masks: input.masks,
        config: input.matcherConfig,
      });
      emit({
        type: 'verification',
        index,
        phase: 'after',
        decision: decision.decision,
        code: decision.decision === 'no-match' ? decision.code : undefined,
        reason: decision.reason,
      });
      if (decision.decision === 'match') return { ok: true };
      if (decision.decision === 'no-match') lastCode = decision.code;
      const now = Date.now();
      if (now >= waitDeadline) {
        // 等待结束若因全局取消/截止时间触发，属取消语义而非视觉 no-match。
        if (signalAborted()) {
          return { ok: false, failure: { kind: 'cancelled', message: '回放被上层取消' } };
        }
        if (remainingMs() <= 0) {
          return {
            ok: false,
            failure: { kind: 'timeout', message: '回放超出调用方截止时间' },
          };
        }
        return {
          ok: false,
          failure: {
            kind: 'no-match',
            message: `动作后画面在等待范围内未出现预期变化${lastCode ? `（最后拒绝码 ${lastCode}）` : ''}`,
          },
        };
      }
      await sleepUntil(Math.min(now + pollIntervalMs, waitDeadline), input.signal);
      const stop = checkStop('after-verify', index, { dispatchedJustNow: true });
      if (stop) return { ok: false, failure: stop.failure! };
    }
  };

  const resolution = input.environment.resolution;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    const support = REPLAY_ACTION_SUPPORT[action.type];
    const boundaryStop = checkStop('before-verify', index, { dispatchedJustNow: false });
    if (boundaryStop) return finish(boundaryStop);

    emit({ type: 'step-started', index, actionType: action.type });

    // ---- 步骤前：新截图 + 页面/目标/状态验证 ----
    const beforeCapture = await captureWithEvent(index, 'before');
    if (!beforeCapture.ok) {
      return finish(
        buildResult({
          status: 'failed',
          phase: 'before-verify',
          failedActionIndex: index,
          reason: beforeCapture.failure.message,
          failure: beforeCapture.failure,
        }),
      );
    }

    const beforeDecision = support.requiresTarget
      ? await verifyTarget(index, beforeCapture.png)
      : await verifyPage(index, beforeCapture.png, images.actions[index]!.before);
    emit({
      type: 'verification',
      index,
      phase: 'before',
      decision: beforeDecision.decision,
      code: beforeDecision.decision === 'no-match' ? beforeDecision.code : undefined,
      reason: beforeDecision.reason,
      targetBox: hitTargetBox(beforeDecision),
    });
    if (beforeDecision.decision !== 'match') {
      // 派发前失败：副作用维持 none/confirmed-partial，不声称执行过该动作。
      return finish(
        buildResult({
          status: 'failed',
          phase: 'before-verify',
          failedActionIndex: index,
          reason:
            beforeDecision.decision === 'no-match'
              ? `actions[${index}] 前置画面验证未通过（${beforeDecision.code}）：${beforeDecision.reason}`
              : `actions[${index}] 前置画面验证出错：${beforeDecision.reason}`,
          failure:
            beforeDecision.decision === 'no-match'
              ? { kind: 'no-match', message: beforeDecision.reason }
              : { kind: 'matcher-error', message: beforeDecision.reason },
        }),
      );
    }

    // ---- 当前坐标：来自本步新截图的匹配框，绝不用历史坐标 ----
    let dispatchTarget: ReplayDispatchTarget | undefined;
    if (support.requiresTarget) {
      const targetBox = hitTargetBox(beforeDecision);
      if (!targetBox) {
        return finish(
          buildResult({
            status: 'failed',
            phase: 'before-verify',
            failedActionIndex: index,
            reason: `actions[${index}]: 目标命中缺少当前帧目标框`,
            failure: { kind: 'matcher-error', message: '目标命中缺少当前帧目标框' },
          }),
        );
      }
      const currentCenter = boxCenterPoint(targetBox);
      let center = currentCenter;
      if (action.type === 'Scroll') {
        // 锚点按目标位移投影到当前帧并夹紧到界内。
        const historicalCenter = boxCenterPoint(action.target.bbox);
        center = {
          x: clamp(
            action.params.anchor.x + (currentCenter.x - historicalCenter.x),
            0,
            resolution.width - 1,
          ),
          y: clamp(
            action.params.anchor.y + (currentCenter.y - historicalCenter.y),
            0,
            resolution.height - 1,
          ),
        };
      }
      dispatchTarget = { box: targetBox, center };
    }

    // ---- 原生派发：已定位像素的直接调用，不经 AI 定位 ----
    const param = buildReplayDispatchParam(action, dispatchTarget ?? null);
    // 原生框架会就地改写 locate 字段，事件携带快照以保证证据不被改写。
    emit({ type: 'dispatch', index, nativeType: support.nativeType, param: structuredClone(param) });
    dispatchedActions += 1;
    try {
      await input.target.callActionInActionSpace(support.nativeType, param);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      escalateEffect('unknown');
      return finish(
        buildResult({
          status: 'failed',
          phase: 'dispatch',
          failedActionIndex: index,
          reason: `actions[${index}] 原生动作派发返回错误，动作是否生效未知：${raw}`,
          failure: { kind: 'device-error', message: '原生动作派发失败，副作用未知', raw },
        }),
      );
    }
    escalateEffect('confirmed-partial');
    emit({ type: 'dispatch-return', index, nativeType: support.nativeType });

    const afterReturnStop = checkStop('after-verify', index, { dispatchedJustNow: true });
    if (afterReturnStop) return finish(afterReturnStop);

    // ---- 动作后：有界等待并匹配动作后证据 ----
    const afterVerify = await waitAndVerifyAfter(index, images.actions[index]!.after);
    if (!afterVerify.ok) {
      const failure = afterVerify.failure;
      if (failure.kind === 'screenshot-error') {
        // 派发已返回但后续截图失败：无法判断动作是否生效。
        escalateEffect('unknown');
        return finish(
          buildResult({
            status: 'failed',
            phase: 'after-verify',
            failedActionIndex: index,
            reason: failure.message,
            failure,
          }),
        );
      }
      if (failure.kind === 'cancelled' || failure.kind === 'timeout') {
        return finish(
          buildResult({
            status: 'cancelled',
            phase: 'after-verify',
            failedActionIndex: index,
            reason: `${failure.message}；已派发动作是否生效未知`,
            failure,
          }),
        );
      }
      // 派发已返回、后图可用但预期画面未出现：确认到派发为止，不误报成功。
      return finish(
        buildResult({
          status: 'failed',
          phase: 'after-verify',
          failedActionIndex: index,
          reason: `actions[${index}] ${failure.message}`,
          failure,
        }),
      );
    }

    completedActions += 1;
    emit({ type: 'step-completed', index });

    // ---- 最后一动作之后：终态视觉检查（动作返回本身不是成功） ----
    if (index === actions.length - 1) {
      const terminalStop = checkStop('terminal-check', null, { dispatchedJustNow: false });
      if (terminalStop) return finish(terminalStop);

      const terminalCapture = await captureWithEvent(index, 'terminal');
      if (!terminalCapture.ok) {
        return finish(
          buildResult({
            status: 'failed',
            phase: 'terminal-check',
            reason: terminalCapture.failure.message,
            failure: terminalCapture.failure,
          }),
        );
      }
      const terminalDecision = await matchScreen({
        currentScreenshot: terminalCapture.png,
        currentEnvironment: input.environment,
        historicalScreenshot: images.terminal,
        historicalEnvironment: input.chain.environment,
        masks: input.masks,
        config: input.matcherConfig,
      });
      emit({
        type: 'verification',
        index,
        phase: 'terminal',
        decision: terminalDecision.decision,
        code: terminalDecision.decision === 'no-match' ? terminalDecision.code : undefined,
        reason: terminalDecision.reason,
      });
      if (terminalDecision.decision !== 'match') {
        return finish(
          buildResult({
            status: 'failed',
            phase: 'terminal-check',
            reason:
              terminalDecision.decision === 'no-match'
                ? `终态画面与历史终态不一致（${terminalDecision.code}）：${terminalDecision.reason}`
                : `终态画面检查出错：${terminalDecision.reason}`,
            failure:
              terminalDecision.decision === 'no-match'
                ? { kind: 'no-match', message: terminalDecision.reason }
                : { kind: 'matcher-error', message: terminalDecision.reason },
          }),
        );
      }
    }
  }

  return finish(
    buildResult({
      status: 'success',
      phase: 'done',
      reason: `整链 ${actions.length} 个动作逐步验证通过，终态画面与历史终态一致`,
    }),
  );
}

function readPadRatio(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1
    ? raw
    : undefined;
}

/** 命中时输出当前帧目标框；页面级命中（Back/Home）与拒绝均无框。 */
function hitTargetBox(
  result: ScreenMatchResult | VisualMatchResult,
): BoundingBox | undefined {
  if (result.decision === 'match' && 'targetBox' in result) {
    return result.targetBox;
  }
  return undefined;
}

function sleepUntil(deadline: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const remain = Math.max(0, deadline - Date.now());
    const timer = setTimeout(finish, remain);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    if (signal) {
      if (signal.aborted) return finish();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 把真实 Midscene Agent 适配为回放动作目标：截图走设备公开面
 * `agent.interface.screenshotBase64()`，派发走公开路径
 * `agent.callActionInActionSpace()`。
 */
export function replayTargetFromAgent(agent: {
  readonly interface: { screenshotBase64(): Promise<string> };
  callActionInActionSpace(type: string, param?: unknown): Promise<unknown>;
}): ReplayActionTarget {
  return {
    screenshotBase64: () => agent.interface.screenshotBase64(),
    callActionInActionSpace: (type, param) => agent.callActionInActionSpace(type, param),
  };
}

/** 用 ExperienceStore 读取资产图片的加载器（含摘要与大小校验）。 */
export function createStoreImageLoader(store: {
  readAssetImage(ref: AssetRef): Promise<
    { ok: true; value: Uint8Array } | { ok: false; error: { kind: string; message: string } }
  >;
}): (ref: AssetRef) => Promise<Uint8Array> {
  return async (ref) => {
    const outcome = await store.readAssetImage(ref);
    if (!outcome.ok) {
      throw new Error(`资产读取失败（${outcome.error.kind}）：${outcome.error.message}`);
    }
    return outcome.value;
  };
}
