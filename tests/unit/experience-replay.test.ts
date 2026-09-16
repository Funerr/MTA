import { describe, expect, it } from 'vitest';
import type { BoundingBox } from '../../src/experience/schema/action';
import {
  buildReplayDispatchParam,
  REPLAY_ACTION_SUPPORT,
} from '../../src/experience/replay/native-actions';
import { replayExperienceChain } from '../../src/experience/replay/replay';
import type { ReplayEvent, ReplayInput } from '../../src/experience/replay/types';
import { makeEnvironment } from '../helpers/experience-fixtures';
import {
  boxCenterOf,
  buildReplayChainFixture,
  frameTable,
  paintReplayFrame,
  REPLAY_THEME_A,
  REPLAY_THEME_B,
  REPLAY_THEME_C,
  ScriptedReplayTarget,
  staticFrame,
  type ReplayChainFixture,
} from '../helpers/visual-replay-fixtures';

const WIDTH = 360;
const HEIGHT = 640;
const ENVIRONMENT = makeEnvironment({ resolution: { width: WIDTH, height: HEIGHT } });

/** 列表页目标原始位置；位移用例在其基础上 +6px（搜索半径 3% ≈ 10px 之内）。 */
const BOX_A: BoundingBox = { x: 80, y: 268, width: 112, height: 52 };
const BOX_A_SHIFTED: BoundingBox = { x: 86, y: 268, width: 112, height: 52 };
const BOX_B: BoundingBox = { x: 96, y: 300, width: 96, height: 48 };

/**
 * Tap → Back 双动作链，三张两两可区分的页面帧（pHash 实测 Hamming 均大于 16）：
 * F0 列表页（目标 BOX_A）→ F1 详情页（动作 0 后置证据）→ F2 暗色变形页
 * （Back 后置证据 = 终态）。同页内目标位移（Hamming≈2）不影响页面级筛选。
 */
async function makeTapBackFixture(): Promise<ReplayChainFixture> {
  return buildReplayChainFixture({
    width: WIDTH,
    height: HEIGHT,
    environment: ENVIRONMENT,
    pages: [
      { theme: REPLAY_THEME_A, targetBox: BOX_A, seed: 0x10 },
      { theme: REPLAY_THEME_B, targetBox: BOX_B, seed: 0x21 },
      { theme: REPLAY_THEME_C, targetBox: BOX_A_SHIFTED, seed: 0x11, altLayout: true },
    ],
    entryFrame: 0,
    terminalFrame: 2,
    actions: [
      {
        type: 'Tap',
        beforeFrame: 0,
        afterFrame: 1,
        targetBox: BOX_A,
        textHint: '设置入口',
      },
      { type: 'Back', beforeFrame: 1, afterFrame: 2 },
    ],
  });
}

/** Tap → Input → Back 三动作链：Input 的目标/上下文裁剪是该动作独有的资产。 */
async function makeThreeActionFixture(): Promise<ReplayChainFixture> {
  return buildReplayChainFixture({
    width: WIDTH,
    height: HEIGHT,
    environment: ENVIRONMENT,
    pages: [
      { theme: REPLAY_THEME_A, targetBox: BOX_A, seed: 0x10 },
      { theme: REPLAY_THEME_B, targetBox: BOX_B, seed: 0x21 },
      { theme: REPLAY_THEME_C, targetBox: BOX_A_SHIFTED, seed: 0x11, altLayout: true },
    ],
    entryFrame: 0,
    terminalFrame: 2,
    actions: [
      {
        type: 'Tap',
        beforeFrame: 0,
        afterFrame: 1,
        targetBox: BOX_A,
        textHint: '设置入口',
      },
      {
        type: 'Input',
        beforeFrame: 1,
        afterFrame: 1,
        targetBox: BOX_B,
        textHint: '搜索框',
        input: { text: '显示', mode: 'replace' },
      },
      { type: 'Back', beforeFrame: 1, afterFrame: 2 },
    ],
  });
}

function replayInput(
  fixture: ReplayChainFixture,
  target: ScriptedReplayTarget,
  overrides: Partial<ReplayInput> = {},
): ReplayInput {
  return {
    chain: fixture.chain,
    environment: ENVIRONMENT,
    target,
    loadImage: fixture.loadImage,
    ...overrides,
  };
}

describe('动作支持矩阵与派发参数映射（任务 1.1）', () => {
  it('六类经验动作与原生 Action Space 子类型一一对应，无目标动作不要求定位', () => {
    expect(REPLAY_ACTION_SUPPORT.Tap).toEqual({ nativeType: 'Tap', requiresTarget: true });
    expect(REPLAY_ACTION_SUPPORT.Input).toEqual({ nativeType: 'Input', requiresTarget: true });
    expect(REPLAY_ACTION_SUPPORT.Scroll).toEqual({ nativeType: 'Scroll', requiresTarget: true });
    expect(REPLAY_ACTION_SUPPORT.LongPress).toEqual({
      nativeType: 'LongPress',
      requiresTarget: true,
    });
    expect(REPLAY_ACTION_SUPPORT.Back).toEqual({
      nativeType: 'AndroidBackButton',
      requiresTarget: false,
    });
    expect(REPLAY_ACTION_SUPPORT.Home).toEqual({
      nativeType: 'AndroidHomeButton',
      requiresTarget: false,
    });
  });

  it('派发参数与 Promotion 采集的参数结构一一对应，locate 携带预置定位结果', () => {
    const bbox: BoundingBox = { x: 24, y: 40, width: 40, height: 24 };
    const center = boxCenterOf(bbox);
    const target = { box: bbox, center };

    const tapAction = { type: 'Tap', target: { bbox, textHint: '设置入口' } } as never;
    expect(buildReplayDispatchParam(tapAction, target)).toEqual({
      locate: {
        prompt: '设置入口',
        locatedPixelResult: {
          center: [center.x, center.y],
          rect: { left: 24, top: 40, width: 40, height: 24 },
        },
      },
    });

    const inputAction = {
      type: 'Input',
      target: { bbox },
      params: { text: '显示', mode: 'append' },
    } as never;
    expect(buildReplayDispatchParam(inputAction, target)).toMatchObject({
      value: '显示',
      mode: 'typeOnly',
    });

    const inputReplace = {
      type: 'Input',
      target: { bbox },
      params: { text: '显示', mode: 'replace' },
    } as never;
    expect(buildReplayDispatchParam(inputReplace, target)).toMatchObject({ mode: 'replace' });

    const scrollAction = {
      type: 'Scroll',
      target: { bbox },
      params: { direction: 'down', distancePx: 40, anchor: { x: 58, y: 100 } },
    } as never;
    const scrollParam = buildReplayDispatchParam(scrollAction, {
      box: bbox,
      center: { x: 58, y: 100 },
    });
    expect(scrollParam).toMatchObject({
      scrollType: 'singleAction',
      direction: 'down',
      distance: 40,
    });
    expect(scrollParam.locate).toMatchObject({
      locatedPixelResult: { center: [58, 100] },
    });

    const longPressAction = {
      type: 'LongPress',
      target: { bbox },
      params: { durationMs: 800 },
    } as never;
    expect(buildReplayDispatchParam(longPressAction, target)).toMatchObject({ duration: 800 });

    expect(buildReplayDispatchParam({ type: 'Back' } as never, null)).toEqual({});
    expect(buildReplayDispatchParam({ type: 'Home' } as never, null)).toEqual({});
  });
});

describe('整链预检（任务 1.2）', () => {
  it('任一后续动作类型不支持时整链拒绝，首动作不派发', async () => {
    const fixture = await makeTapBackFixture();
    const swipeAction = {
      type: 'Swipe',
      before: fixture.chain.actions[0]!.before,
      after: fixture.chain.actions[0]!.after,
    } as unknown as (typeof fixture.chain.actions)[number];
    const tampered = {
      ...fixture.chain,
      actions: [...fixture.chain.actions, swipeAction],
    };
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput({ ...fixture, chain: tampered }, target),
    );
    expect(result.status).toBe('rejected');
    expect(result.phase).toBe('preflight');
    expect(result.effect).toBe('none');
    expect(result.dispatchedActions).toBe(0);
    expect(result.failedActionIndex).toBe(2);
    expect(result.failure?.kind).toBe('action-unsupported');
    expect(target.dispatches).toHaveLength(0);
  });

  it('任一后续动作缺图时整链拒绝，不做部分派发', async () => {
    const fixture = await makeThreeActionFixture();
    const input = fixture.chain.actions[1]!;
    if (input.type !== 'Input') throw new Error('夹具第二步应为 Input');
    // 删除第二步独有的上下文图：预检必须在首动作派发前发现证据缺失。
    const imageBytes = new Map(fixture.imageBytes);
    imageBytes.delete(input.target.contextImage.asset.digest);
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput(fixture, target, {
        loadImage: async (ref) => {
          const png = imageBytes.get(ref.digest);
          if (!png) throw new Error(`缺少资产 ${ref.digest.slice(0, 12)}…`);
          return png;
        },
      }),
    );
    expect(result.status).toBe('rejected');
    expect(result.failure?.kind).toBe('asset-unavailable');
    expect(result.failure?.message).toContain('contextImage');
    expect(result.dispatchedActions).toBe(0);
    expect(target.dispatches).toHaveLength(0);
  });

  it('参数越界（bbox 超出操作前截图）在派发前整链拒绝', async () => {
    const fixture = await makeTapBackFixture();
    const tap = fixture.chain.actions[0]!;
    if (tap.type !== 'Tap') throw new Error('夹具第一步应为 Tap');
    const tampered = {
      ...fixture.chain,
      actions: [
        {
          ...tap,
          target: { ...tap.target, bbox: { x: 340, y: 620, width: 40, height: 30 } },
        },
        ...fixture.chain.actions.slice(1),
      ],
    };
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput({ ...fixture, chain: tampered }, target),
    );
    expect(result.status).toBe('rejected');
    expect(result.failure?.kind).toBe('invalid-chain');
    expect(result.failure?.message).toContain('越出');
    expect(target.dispatches).toHaveLength(0);
  });

  it('当前环境与链环境不一致时整链拒绝（不截屏）', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput(fixture, target, {
        environment: makeEnvironment({
          resolution: { width: WIDTH, height: HEIGHT },
          model: 'Other Device',
        }),
      }),
    );
    expect(result.status).toBe('rejected');
    expect(result.failure?.kind).toBe('environment-incompatible');
    expect(target.captureCount).toBe(0);
    expect(target.dispatches).toHaveLength(0);
  });

  it('证据签名版本不兼容或匹配配置非法时整链拒绝', async () => {
    const fixture = await makeTapBackFixture();
    const tamperedSignature = {
      ...fixture.chain,
      entryEvidence: {
        ...fixture.chain.entryEvidence,
        signature: { ...fixture.chain.entryEvidence.signature, algorithm: 'other-algo' },
      },
    };
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput({ ...fixture, chain: tamperedSignature }, target),
    );
    expect(result.status).toBe('rejected');
    expect(result.failure?.kind).toBe('version-incompatible');

    const badConfigTarget = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const badConfig = await replayExperienceChain(
      replayInput(fixture, badConfigTarget, { matcherConfig: { ocrEnabled: 'yes' } }),
    );
    expect(badConfig.status).toBe('rejected');
    expect(badConfig.failure?.kind).toBe('version-incompatible');
    expect(badConfigTarget.dispatches).toHaveLength(0);
  });

  it('空链拒绝', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput({ ...fixture, chain: { ...fixture.chain, actions: [] } }, target),
    );
    expect(result.status).toBe('rejected');
    expect(result.failure?.kind).toBe('invalid-chain');
  });
});

describe('逐步观察与原生派发（任务 2.1）', () => {
  it('完整链逐步派发：Back/Home 同样校验前置页面，结果 success', async () => {
    const fixture = await makeTapBackFixture();
    // 截图序：F0（Tap 前）→ F1（Tap 后 / Back 前）→ F2（Back 后 = 终态）。
    const target = new ScriptedReplayTarget(
      frameTable([fixture.frames[0]!, fixture.frames[1]!, fixture.frames[1]!, fixture.frames[2]!, fixture.frames[2]!]),
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('success');
    expect(result.phase).toBe('done');
    expect(result.completedActions).toBe(2);
    expect(result.dispatchedActions).toBe(2);
    expect(result.effect).toBe('confirmed-partial');
    expect(target.dispatches.map((item) => item.nativeType)).toEqual([
      'Tap',
      'AndroidBackButton',
    ]);
    const tapParam = target.dispatches[0]!.param as {
      locate: { locatedPixelResult: { center: [number, number]; rect: Record<string, number> } };
    };
    const expectedCenter = boxCenterOf(BOX_A);
    expect(tapParam.locate.locatedPixelResult.center).toEqual([expectedCenter.x, expectedCenter.y]);
    expect(tapParam.locate.locatedPixelResult.rect).toEqual({
      left: BOX_A.x,
      top: BOX_A.y,
      width: BOX_A.width,
      height: BOX_A.height,
    });
    expect(target.dispatches[1]!.param).toEqual({});
  });

  it('坐标来自对应当前帧：历史框与当前帧目标位置不同时，派发当前匹配位置', async () => {
    const fixture = await makeTapBackFixture();
    // 当前帧是与 F0 同页但目标位移 6px 的画面；历史框仍指向 BOX_A。
    const shiftedFrame = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: REPLAY_THEME_A,
      targetBox: BOX_A_SHIFTED,
      seed: 0x10,
    });
    const target = new ScriptedReplayTarget((captureIndex) =>
      captureIndex === 0
        ? shiftedFrame
        : frameTable([
            fixture.frames[1]!,
            fixture.frames[1]!,
            fixture.frames[2]!,
            fixture.frames[2]!,
          ])(captureIndex - 1),
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('success');
    const tapParam = target.dispatches[0]!.param as {
      locate: { locatedPixelResult: { center: [number, number] } };
    };
    const expected = boxCenterOf(BOX_A_SHIFTED);
    expect(tapParam.locate.locatedPixelResult.center).toEqual([expected.x, expected.y]);
    const historical = boxCenterOf(BOX_A);
    expect(tapParam.locate.locatedPixelResult.center).not.toEqual([historical.x, historical.y]);
  });

  it('第二步画面变化：第二步及后续动作不执行，结果标明已完成第一步', async () => {
    const fixture = await makeTapBackFixture();
    // Back 的前置画面应为详情页 F1，但设备给出列表页变形 F2。
    const target = new ScriptedReplayTarget(
      frameTable([fixture.frames[0]!, fixture.frames[1]!, fixture.frames[2]!]),
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('before-verify');
    expect(result.failedActionIndex).toBe(1);
    expect(result.completedActions).toBe(1);
    expect(result.dispatchedActions).toBe(1);
    expect(result.effect).toBe('confirmed-partial');
    expect(result.failure?.kind).toBe('no-match');
    expect(target.dispatches.map((item) => item.nativeType)).toEqual(['Tap']);
  });
});

describe('动作后与终态检查（任务 2.2）', () => {
  it('动作返回但预期后置画面未出现：返回动作后验证失败而不是成功', async () => {
    const fixture = await makeTapBackFixture();
    // 派发后画面停留在列表页 F0，后置证据（详情页 F1）始终未出现。
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput(fixture, target, { waitPollIntervalMs: 10, maxAfterWaitMs: 150 }),
    );
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('after-verify');
    expect(result.failedActionIndex).toBe(0);
    expect(result.failure?.kind).toBe('no-match');
    expect(target.dispatches).toHaveLength(1);
  });

  it('全部动作验证通过但终态画面不符：不误报整链成功', async () => {
    const fixture = await makeTapBackFixture();
    // 最后一张终态截图被换成列表页 F0（终态证据是变形布局 F2）。
    const target = new ScriptedReplayTarget(
      frameTable([
        fixture.frames[0]!,
        fixture.frames[1]!,
        fixture.frames[1]!,
        fixture.frames[2]!,
        fixture.frames[0]!,
      ]),
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('terminal-check');
    expect(result.completedActions).toBe(2);
    expect(result.dispatchedActions).toBe(2);
    expect(result.effect).toBe('confirmed-partial');
    expect(result.failure?.kind).toBe('no-match');
  });
});

describe('副作用分类（任务 2.3）', () => {
  it('派发前失败（第 0 步页面不符）：effect=none，无任何派发', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[1]!));
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('before-verify');
    expect(result.effect).toBe('none');
    expect(result.completedActions).toBe(0);
    expect(result.dispatchedActions).toBe(0);
  });

  it('派发返回错误：effect=unknown，不继续下一动作，保留原始异常', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(
      frameTable([fixture.frames[0]!, fixture.frames[1]!]),
      () => {
        throw new Error('设备断连');
      },
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('dispatch');
    expect(result.failedActionIndex).toBe(0);
    expect(result.effect).toBe('unknown');
    expect(result.dispatchedActions).toBe(1);
    expect(result.failure?.kind).toBe('device-error');
    expect(result.failure?.raw).toContain('设备断连');
    expect(target.dispatches).toHaveLength(1);
  });

  it('派发后截图失败：effect=unknown，不声称未执行', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget((captureIndex) =>
      captureIndex === 0 ? fixture.frames[0]! : undefined,
    );
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('after-verify');
    expect(result.effect).toBe('unknown');
    expect(result.failure?.kind).toBe('screenshot-error');
    expect(result.dispatchedActions).toBe(1);
    expect(result.lastScreenshot).toBeDefined();
  });

  it('派发前截图失败：effect=none，原因可定位到截图阶段', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(() => undefined);
    const result = await replayExperienceChain(replayInput(fixture, target));
    expect(result.status).toBe('failed');
    expect(result.phase).toBe('before-verify');
    expect(result.effect).toBe('none');
    expect(result.failure?.kind).toBe('screenshot-error');
    expect(result.dispatchedActions).toBe(0);
    expect(result.lastScreenshot).toBeUndefined();
  });
});

describe('取消与预算（任务 2.4）', () => {
  it('回放开始前已取消：不截屏、不派发、返回 cancelled', async () => {
    const fixture = await makeTapBackFixture();
    const controller = new AbortController();
    controller.abort();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const result = await replayExperienceChain(
      replayInput(fixture, target, { signal: controller.signal }),
    );
    expect(result.status).toBe('cancelled');
    expect(result.phase).toBe('preflight');
    expect(result.effect).toBe('none');
    expect(result.failure?.kind).toBe('cancelled');
    expect(target.captureCount).toBe(0);
    expect(target.dispatches).toHaveLength(0);
  });

  it('动作后等待期间取消：停止等待、不再派发、副作用未知、不改判为 no-match', async () => {
    const fixture = await makeTapBackFixture();
    const controller = new AbortController();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!), () => {
      controller.abort();
    });
    const result = await replayExperienceChain(
      replayInput(fixture, target, {
        signal: controller.signal,
        waitPollIntervalMs: 5,
        maxAfterWaitMs: 2_000,
      }),
    );
    expect(result.status).toBe('cancelled');
    expect(result.phase).toBe('after-verify');
    expect(result.effect).toBe('unknown');
    expect(result.failure?.kind).toBe('cancelled');
    expect(target.dispatches).toHaveLength(1);
  });

  it('等待上界取自剩余预算且不重置：截止时间到达即停止，而非重新计时', async () => {
    const fixture = await makeTapBackFixture();
    const target = new ScriptedReplayTarget(staticFrame(fixture.frames[0]!));
    const startedAt = Date.now();
    const result = await replayExperienceChain(
      replayInput(fixture, target, {
        deadlineAtMs: startedAt + 250,
        waitPollIntervalMs: 25,
      }),
    );
    const elapsed = Date.now() - startedAt;
    expect(result.status).toBe('cancelled');
    expect(result.failure?.kind).toBe('timeout');
    expect(result.phase).toBe('after-verify');
    // 默认单次等待上界为 5000ms；若每步重置预算，耗时将远超 250ms 预算。
    expect(elapsed).toBeLessThan(1_500);
    expect(target.dispatches).toHaveLength(1);
  });
});

describe('逐步事件与证据回调（任务 2.5）', () => {
  it('产出逐步截图与验证事件，终局事件携带最终结果', async () => {
    const fixture = await makeTapBackFixture();
    const events: ReplayEvent[] = [];
    const target = new ScriptedReplayTarget(
      frameTable([
        fixture.frames[0]!,
        fixture.frames[1]!,
        fixture.frames[1]!,
        fixture.frames[2]!,
        fixture.frames[2]!,
      ]),
    );
    const result = await replayExperienceChain(
      replayInput(fixture, target, { onEvent: (event) => events.push(event) }),
    );

    expect(result.status).toBe('success');
    expect(events[0]).toEqual({ type: 'replay-started', totalActions: 2 });
    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('replay-finished');
    if (lastEvent?.type !== 'replay-finished') return;
    expect(lastEvent.result.status).toBe('success');

    const screenshots = events.filter((event) => event.type === 'screenshot');
    // 每步 before+after（2×2）+ 终态 1 张。
    expect(screenshots).toHaveLength(5);
    expect(screenshots.map((event) => event.phase)).toEqual([
      'before',
      'after',
      'before',
      'after',
      'terminal',
    ]);
    for (const event of screenshots) {
      if (event.type !== 'screenshot') continue;
      expect(event.png[0]).toBe(0x89);
      expect(event.png.byteLength).toBeGreaterThan(0);
    }

    const verifications = events.filter((event) => event.type === 'verification');
    expect(verifications).toHaveLength(5);
    const beforeTap = verifications.find(
      (event) => event.type === 'verification' && event.phase === 'before' && event.index === 0,
    );
    if (beforeTap?.type !== 'verification') return;
    expect(beforeTap.decision).toBe('match');
    expect(beforeTap.targetBox).toEqual(BOX_A);

    const dispatches = events.filter((event) => event.type === 'dispatch');
    expect(dispatches).toHaveLength(2);
    expect(
      events
        .filter((event) => event.type === 'step-completed')
        .map((event) => (event.type === 'step-completed' ? event.index : -1)),
    ).toEqual([0, 1]);
  });
});
