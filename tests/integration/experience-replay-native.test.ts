import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultMobileActions,
  type AbstractInterface,
  type MobileInputPrimitives,
} from '@midscene/core/device';
import { Agent } from '@midscene/core/agent';
import { DUMMY_MODEL_CONFIG, createHarnessAgent, HARNESS_HEIGHT, HARNESS_WIDTH } from '../helpers/midscene-agent-harness';
import { makeEnvironment, makeSource } from '../helpers/experience-fixtures';
import { promoteRequest } from '../helpers/promotion-dump';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import {
  boxCenterOf,
  buildReplayChainFixture,
  paintReplayFrame,
  REPLAY_THEME_A,
  REPLAY_THEME_B,
} from '../helpers/visual-replay-fixtures';
import {
  createStoreImageLoader,
  replayExperienceChain,
  replayTargetFromAgent,
} from '../../src/experience/replay/replay';
import type { ReplayEvent } from '../../src/experience/replay/types';

/**
 * 框架集成验证（任务 3.1）：加载实际锁定的 @midscene/core Agent 与
 * createDefaultMobileActions 动作接口，仅把设备传输边界替换为受控替身，
 * 并在边界记录每次派发。覆盖：完整 candidate 发布/查询 → 逐步回放 →
 * 设备原语参数无损、坐标逐步对应、零模型请求、原生 dump 报告关联。
 * 未覆盖：真实硬件行为与真实模型（见 docs/experience-replay-acceptance.md）。
 */

const ENVIRONMENT = makeEnvironment({
  resolution: { width: HARNESS_WIDTH, height: HARNESS_HEIGHT },
});

const TAP_BOX = { x: 30, y: 60, width: 40, height: 24 };
const INPUT_BOX = { x: 30, y: 60, width: 44, height: 24 };
const SCROLL_BOX = { x: 34, y: 60, width: 40, height: 24 };
const LONG_BOX = { x: 30, y: 60, width: 40, height: 24 };

/** 步进设备：截图返回当前步画面，每次原语派发推进一步。 */
class SteppedAndroidDevice {
  readonly interfaceType = 'android';
  readonly actions: Array<Record<string, unknown>> = [];
  step = 0;

  constructor(private readonly stepFrames: Uint8Array[]) {}

  describe(): string {
    return 'stepped-android-harness';
  }

  async screenshotBase64(): Promise<string> {
    const png = this.stepFrames[Math.min(this.step, this.stepFrames.length - 1)]!;
    const base64 = Buffer.from(png).toString('base64');
    return `data:image/png;base64,${base64}`;
  }

  async size(): Promise<{ width: number; height: number }> {
    return { width: HARNESS_WIDTH, height: HARNESS_HEIGHT };
  }

  private advance(): void {
    this.step = Math.min(this.step + 1, this.stepFrames.length - 1);
  }

  actionSpace() {
    return createDefaultMobileActions({
      input: this.inputPrimitives,
      size: () => this.size(),
      sleep: async () => undefined,
      systemActions: {
        backButton: { name: 'AndroidBackButton', description: 'back' },
        homeButton: { name: 'AndroidHomeButton', description: 'home' },
      },
    });
  }

  private readonly inputPrimitives: MobileInputPrimitives = {
    pointer: {
      tap: async (point) => {
        this.actions.push({ kind: 'tap', x: point.x, y: point.y });
        this.advance();
      },
      longPress: async (point, opts) => {
        this.actions.push({ kind: 'longPress', x: point.x, y: point.y, duration: opts?.duration });
        this.advance();
      },
      doubleClick: async () => undefined,
      dragAndDrop: async () => undefined,
    },
    keyboard: {
      keyboardPress: async () => undefined,
      typeText: async (value, opts) => {
        this.actions.push({
          kind: 'typeText',
          value,
          mode: opts?.replace ? 'replace' : undefined,
        });
        this.advance();
      },
      clearInput: async () => undefined,
    },
    touch: {
      swipe: async () => undefined,
    },
    scroll: {
      scroll: async (param) => {
        this.actions.push({ kind: 'scroll', param });
        this.advance();
      },
    },
    system: {
      backButton: async () => {
        this.actions.push({ kind: 'back' });
        this.advance();
      },
      homeButton: async () => {
        this.actions.push({ kind: 'home' });
        this.advance();
      },
    },
  };
}

function agentFor(device: SteppedAndroidDevice): Agent {
  return new Agent(device as unknown as AbstractInterface, {
    generateReport: false,
    persistExecutionDump: false,
    autoPrintReportMsg: false,
    waitAfterAction: 0,
    groupName: 'experience-replay-harness',
    modelConfig: { ...DUMMY_MODEL_CONFIG },
  });
}

/** 六类动作的完整 candidate：Tap → Input → Scroll → LongPress → Back → Home。 */
async function makeSixActionChain() {
  const pages = [0, 1, 2, 3, 4, 5, 6].map((index) => ({
    theme: REPLAY_THEME_A,
    targetBox: {
      x: [TAP_BOX, INPUT_BOX, SCROLL_BOX, LONG_BOX][index % 4]!.x + (index % 2) * 2,
      y: 60,
      width: 40,
      height: 24,
    },
    seed: 0x51,
  }));
  return buildReplayChainFixture({
    width: HARNESS_WIDTH,
    height: HARNESS_HEIGHT,
    environment: ENVIRONMENT,
    pages,
    entryFrame: 0,
    terminalFrame: 6,
    actions: [
      { type: 'Tap', beforeFrame: 0, afterFrame: 1, targetBox: pages[0]!.targetBox, textHint: '设置入口' },
      {
        type: 'Input',
        beforeFrame: 1,
        afterFrame: 2,
        targetBox: pages[1]!.targetBox,
        textHint: '搜索框',
        input: { text: '显示', mode: 'replace' },
      },
      {
        type: 'Scroll',
        beforeFrame: 2,
        afterFrame: 3,
        targetBox: pages[2]!.targetBox,
        textHint: '列表',
        scroll: { direction: 'down', distancePx: 40 },
      },
      {
        type: 'LongPress',
        beforeFrame: 3,
        afterFrame: 4,
        targetBox: pages[3]!.targetBox,
        textHint: '图标',
        longPress: { durationMs: 800 },
      },
      { type: 'Back', beforeFrame: 4, afterFrame: 5 },
      { type: 'Home', beforeFrame: 5, afterFrame: 6 },
    ],
  });
}

async function publishCandidate(fixture: Awaited<ReturnType<typeof makeSixActionChain>>, eventId: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-replay-native-'));
  const store = openExperienceStore(root);
  const request = promoteRequest();
  const key = deriveRequestKey(request);
  if (!key.eligible) throw new Error('夹具请求不合格');
  const published = await store.publishCandidate({
    eventId,
    requestKey: key.requestKey,
    source: makeSource(),
    environment: ENVIRONMENT,
    variant: {
      entryEvidence: fixture.chain.entryEvidence,
      terminalEvidence: fixture.chain.terminalEvidence,
      actions: [...fixture.chain.actions],
      eligibilityPolicyVersion: 'policy@1',
    },
    images: fixture.imageBytes,
  });
  if (!published.ok) throw new Error(`发布失败：${published.error.message}`);
  const found = await store.findCandidates({ requestKey: key.requestKey, environment: ENVIRONMENT });
  if (!found.ok || found.value.length !== 1) throw new Error('候选查询失败');
  return { root, store, candidate: found.value[0]! };
}

describe('原生动作接口集成（任务 3.1 / 1.1 最小调用）', () => {
  let agent: Agent | undefined;
  let root: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn> | undefined;

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
      root = undefined;
    }
    vi.unstubAllGlobals();
    fetchMock = undefined;
  });

  function stubFetchCounter(): ReturnType<typeof vi.fn> {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('任务 1.1：锁定 1.12.7 最小 Tap 调用参数无损且不触发定位模型', async () => {
    const fixture = await buildReplayChainFixture({
      width: HARNESS_WIDTH,
      height: HARNESS_HEIGHT,
      environment: ENVIRONMENT,
      pages: [
        { theme: REPLAY_THEME_A, targetBox: TAP_BOX, seed: 0x61 },
        { theme: REPLAY_THEME_A, targetBox: { x: TAP_BOX.x + 2, y: 60, width: 40, height: 24 }, seed: 0x61 },
      ],
      entryFrame: 0,
      terminalFrame: 1,
      actions: [
        { type: 'Tap', beforeFrame: 0, afterFrame: 1, targetBox: TAP_BOX, textHint: '设置入口' },
      ],
    });
    const published = await publishCandidate(fixture, 'replay-minimal-tap');
    root = published.root;

    const device = new SteppedAndroidDevice(fixture.frames);
    agent = agentFor(device);
    const fetchCalls = stubFetchCounter();

    const result = await replayExperienceChain({
      chain: published.candidate,
      environment: ENVIRONMENT,
      target: replayTargetFromAgent(agent),
      loadImage: createStoreImageLoader(published.store),
    });

    expect(result.status).toBe('success');
    expect(device.actions).toEqual([
      {
        kind: 'tap',
        x: boxCenterOf(TAP_BOX).x,
        y: boxCenterOf(TAP_BOX).y,
      },
    ]);
    expect(fetchCalls).toHaveBeenCalledTimes(0);

    // 原生 dump 中 Locate 任务直接命中预置像素：finished 且无模型 usage/log。
    const execution = agent!.dump.executions[0] as unknown as Record<string, unknown>;
    const tasks = execution.tasks as Array<Record<string, unknown>>;
    const locate = tasks.find((task) => task.type === 'Planning' && task.subType === 'Locate');
    expect(locate).toBeDefined();
    expect(locate!.status).toBe('finished');
    expect(locate!.usage).toBeUndefined();
    expect(locate!.log).toBeUndefined();
  });

  it('六类动作完整回放：逐步坐标、参数无损、零模型请求、dump 证据可查看', async () => {
    const fixture = await makeSixActionChain();
    const published = await publishCandidate(fixture, 'replay-native-3-1');
    root = published.root;

    const device = new SteppedAndroidDevice(fixture.frames);
    agent = agentFor(device);
    const fetchCalls = stubFetchCounter();
    const events: ReplayEvent[] = [];

    const result = await replayExperienceChain({
      chain: published.candidate,
      environment: ENVIRONMENT,
      target: replayTargetFromAgent(agent),
      loadImage: createStoreImageLoader(published.store),
      onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe('success');
    expect(result.completedActions).toBe(6);
    expect(result.dispatchedActions).toBe(6);
    expect(result.effect).toBe('confirmed-partial');
    expect(result.phase).toBe('done');

    // 设备传输边界：六类原语按序派发，参数与资产一致（无损映射）。
    expect(device.actions.map((item) => item.kind)).toEqual([
      'tap',
      'typeText',
      'scroll',
      'longPress',
      'back',
      'home',
    ]);
    expect(device.actions[0]).toMatchObject({
      kind: 'tap',
      x: boxCenterOf(pagesBox(fixture, 0)).x,
      y: boxCenterOf(pagesBox(fixture, 0)).y,
    });
    expect(device.actions[1]).toMatchObject({ kind: 'typeText', value: '显示', mode: 'replace' });
    expect((device.actions[2]!.param as Record<string, unknown>).direction).toBe('down');
    expect((device.actions[2]!.param as Record<string, unknown>).distance).toBe(40);
    expect(device.actions[3]).toMatchObject({ kind: 'longPress', duration: 800 });

    // 模型请求为零。
    expect(fetchCalls).toHaveBeenCalledTimes(0);

    // 原生报告关联：每次派发一个 execution，含 before/after 截图证据。
    const executions = agent!.dump.executions as unknown as Array<Record<string, unknown>>;
    expect(executions).toHaveLength(6);
    const subTypes = executions.map((execution) => {
      const tasks = execution.tasks as Array<Record<string, unknown>>;
      const actionTask = tasks.find((task) => task.type === 'Action Space')!;
      const uiContext = taskUiContext(actionTask);
      const recorder = (actionTask.recorder ?? []) as Array<Record<string, unknown>>;
      const after = recorder.find((item) => item.timing === 'after-calling');
      return {
        subType: actionTask.subType,
        hasBefore: Boolean(uiContext?.screenshot),
        hasAfter: Boolean(after?.screenshot),
      };
    });
    expect(subTypes.map((item) => item.subType)).toEqual([
      'Tap',
      'Input',
      'Scroll',
      'LongPress',
      'AndroidBackButton',
      'AndroidHomeButton',
    ]);
    for (const item of subTypes) {
      expect(item.hasBefore).toBe(true);
      expect(item.hasAfter).toBe(true);
    }

    // 回放事件流：逐步截图与验证证据完整。
    const dispatchEvents = events.filter((event) => event.type === 'dispatch');
    expect(dispatchEvents).toHaveLength(6);
    for (const event of dispatchEvents) {
      if (event.type !== 'dispatch') continue;
      if (['Tap', 'Input', 'Scroll', 'LongPress'].includes(event.nativeType)) {
        const param = event.param as { locate?: { locatedPixelResult?: unknown } };
        expect(param.locate?.locatedPixelResult).toBeDefined();
      }
    }
    const screenshotEvents = events.filter((event) => event.type === 'screenshot');
    expect(screenshotEvents).toHaveLength(6 * 2 + 1);
    const finished = events.at(-1);
    expect(finished?.type).toBe('replay-finished');
  });

  it('首帧即不符：整链拒绝派发，原生 dump 无新增执行', async () => {
    const fixture = await makeSixActionChain();
    const published = await publishCandidate(fixture, 'replay-native-negative');
    root = published.root;

    const wrongFrames = [await paintReplayFrame({
      width: HARNESS_WIDTH,
      height: HARNESS_HEIGHT,
      theme: REPLAY_THEME_B,
      targetBox: { x: 30, y: 60, width: 40, height: 24 },
      seed: 0x77,
      altLayout: true,
    })];
    const device = new SteppedAndroidDevice([...wrongFrames, ...fixture.frames.slice(1)]);
    agent = agentFor(device);
    stubFetchCounter();

    const result = await replayExperienceChain({
      chain: published.candidate,
      environment: ENVIRONMENT,
      target: replayTargetFromAgent(agent),
      loadImage: createStoreImageLoader(published.store),
    });

    expect(result.status).toBe('failed');
    expect(result.phase).toBe('before-verify');
    expect(result.failedActionIndex).toBe(0);
    expect(result.dispatchedActions).toBe(0);
    expect(result.effect).toBe('none');
    expect(device.actions).toHaveLength(0);
    expect(agent!.dump.executions).toHaveLength(0);
  });

  it('中途画面被换：停止派发后续动作，副作用保留已确认部分', async () => {
    const fixture = await makeSixActionChain();
    const published = await publishCandidate(fixture, 'replay-native-midstop');
    root = published.root;

    // 第 2 步画面换成其他页：Input 的后置证据永不出现，Scroll 及之后不再派发。
    const intruder = await paintReplayFrame({
      width: HARNESS_WIDTH,
      height: HARNESS_HEIGHT,
      theme: REPLAY_THEME_B,
      targetBox: { x: 30, y: 60, width: 40, height: 24 },
      seed: 0x78,
      altLayout: true,
    });
    const frames = [...fixture.frames];
    frames[2] = intruder;
    const device = new SteppedAndroidDevice(frames);
    agent = agentFor(device);
    stubFetchCounter();

    const result = await replayExperienceChain({
      chain: published.candidate,
      environment: ENVIRONMENT,
      target: replayTargetFromAgent(agent),
      loadImage: createStoreImageLoader(published.store),
      waitPollIntervalMs: 20,
      maxAfterWaitMs: 300,
    });

    expect(result.status).toBe('failed');
    expect(result.phase).toBe('after-verify');
    expect(result.failedActionIndex).toBe(1);
    expect(result.completedActions).toBe(1);
    expect(result.dispatchedActions).toBe(2);
    expect(result.effect).toBe('confirmed-partial');
    expect(device.actions.map((item) => item.kind)).toEqual(['tap', 'typeText']);
    expect(agent!.dump.executions).toHaveLength(2);
  });
});

function pagesBox(
  fixture: Awaited<ReturnType<typeof makeSixActionChain>>,
  index: number,
): { x: number; y: number; width: number; height: number } {
  const action = fixture.chain.actions[index]!;
  if (!('target' in action)) throw new Error(`actions[${index}] 无目标`);
  return action.target.bbox;
}

function taskUiContext(task: Record<string, unknown>): Record<string, unknown> | undefined {
  const uiContext = task.uiContext;
  return typeof uiContext === 'object' && uiContext !== null
    ? (uiContext as Record<string, unknown>)
    : undefined;
}
