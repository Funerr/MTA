import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@midscene/core/agent';
import { loadTestProject } from '@midscene/test/config';
import { collectWorkflowDocument } from '@midscene/test';
import { createDefaultMobileActions, type AbstractInterface, type MobileInputPrimitives } from '@midscene/core/device';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import { computeEntryFingerprint } from '../../src/experience/schema/variant';
import {
  ExperienceRunError,
  ExperienceRuntime,
  createDumpModelObserver,
  unknownModelCounts,
} from '../../src/experience/runtime';
import { DUMMY_MODEL_CONFIG, HARNESS_HEIGHT, HARNESS_WIDTH } from '../helpers/midscene-agent-harness';
import { makeEnvironment, makeSource } from '../helpers/experience-fixtures';
import {
  GENERIC_REPLAY_PROMPT,
  GENERIC_TEST_ACTION_POLICY,
  runtimeIdentity,
  runtimeRequest,
} from '../helpers/experience-runtime-fixtures';
import {
  boxCenterOf,
  buildReplayChainFixture,
  paintReplayFrame,
  REPLAY_THEME_A,
  REPLAY_THEME_B,
  REPLAY_THEME_C,
  ScriptedReplayTarget,
  frameTable,
} from '../helpers/visual-replay-fixtures';
import {
  makeActionTask,
  makeExecution,
  makeLocate,
  makeReportDump,
  makeScreenshot,
} from '../helpers/promotion-dump';
import { replayTargetFromAgent } from '../../src/experience/replay/replay';
import { pngDataUrl } from '../helpers/promotion-png';

const WIDTH = 360;
const HEIGHT = 640;
const ENVIRONMENT = makeEnvironment({ resolution: { width: WIDTH, height: HEIGHT } });
const BOX = { x: 80, y: 268, width: 112, height: 52 };
const BOX_SHIFTED = { x: 86, y: 268, width: 112, height: 52 };
const IDENTITY = runtimeIdentity();
const REQUEST = runtimeRequest();

const configPath = fileURLToPath(new URL('../../midscene.config.ts', import.meta.url));
const fixturePath = fileURLToPath(new URL('../fixtures/experience-runtime.yaml', import.meta.url));

function keyOf(prompt = GENERIC_REPLAY_PROMPT) {
  const key = deriveRequestKey({
    caseIdentity: { casePath: IDENTITY.casePath, caseName: IDENTITY.caseName },
    stepPath: IDENTITY.stepPath,
    node: 'experienceAct',
    prompt,
    eligibilityPolicyVersion: 'policy@1',
  });
  if (!key.eligible) throw new Error(key.reason);
  return key.requestKey;
}

function dumpForTap(id: string, before: Uint8Array, after: Uint8Array, box = BOX) {
  return makeReportDump([
    makeExecution(id, [
      makeActionTask({
        taskId: `${id}-tap`,
        subType: 'Tap',
        param: { locate: makeLocate('generic-replay-target', box) },
        before: makeScreenshot(`${id}-before`, before),
        after: makeScreenshot(`${id}-after`, after),
      }),
    ]),
  ]);
}

class SteppedDevice {
  readonly interfaceType = 'android';
  readonly actions: Array<Record<string, unknown>> = [];
  step = 0;
  constructor(
    private readonly frames: Uint8Array[],
    private readonly width = WIDTH,
    private readonly height = HEIGHT,
  ) {}
  describe() {
    return 'runtime-stepped-device';
  }
  async screenshotBase64() {
    const png = this.frames[Math.min(this.step, this.frames.length - 1)]!;
    return pngDataUrl(png);
  }
  async size() {
    return { width: this.width, height: this.height };
  }
  private advance() {
    this.step = Math.min(this.step + 1, this.frames.length - 1);
  }
  actionSpace() {
    return createDefaultMobileActions({
      input: this.input,
      size: () => this.size(),
      sleep: async () => undefined,
      systemActions: {
        backButton: { name: 'AndroidBackButton', description: 'back' },
        homeButton: { name: 'AndroidHomeButton', description: 'home' },
      },
    });
  }
  private readonly input: MobileInputPrimitives = {
    pointer: {
      tap: async (point) => {
        this.actions.push({ kind: 'tap', x: point.x, y: point.y });
        this.advance();
      },
      longPress: async () => undefined,
      doubleClick: async () => undefined,
      dragAndDrop: async () => undefined,
    },
    keyboard: {
      keyboardPress: async () => undefined,
      typeText: async () => undefined,
      clearInput: async () => undefined,
    },
    touch: { swipe: async () => undefined },
    scroll: { scroll: async () => undefined },
    system: {
      backButton: async () => this.advance(),
      homeButton: async () => this.advance(),
    },
  };
}

describe('experienceAct 注册与参考夹具（任务 1.5 / 3.1）', () => {
  it('真实配置中两项目共享 experienceAct，且不覆盖原生 aiAct/aiAssert', async () => {
    const loaded = await loadTestProject(configPath);
    const android = loaded.projects[0]!;
    const harmony = loaded.projects[1]!;
    expect(android.nodes.get('experienceAct')).toBe(harmony.nodes.get('experienceAct'));
    expect(android.nodes.get('aiAct')).not.toBe(harmony.nodes.get('aiAct'));
    expect(android.nodes.get('aiAssert')).toBeDefined();
    const node = android.nodes.get('experienceAct')!;
    expect(() => node.inputSchema!.parse({ prompt: GENERIC_REPLAY_PROMPT })).not.toThrow();
    expect(() => node.inputSchema!.parse({ instruction: GENERIC_REPLAY_PROMPT })).toThrow();
  });

  it('YAML 夹具按 stringInputKey 解析 experienceAct prompt，不含业务判断', async () => {
    const loaded = await loadTestProject(configPath);
    const android = loaded.projects[0]!;
    const document = collectWorkflowDocument(
      {
        projectId: 'android',
        projectName: 'android',
        sourcePath: 'tests/fixtures/experience-runtime.yaml',
        absolutePath: fixturePath,
      },
      { resolveNode: (name) => android.nodes.get(name) },
    );
    expect(document.cases[0]?.definition.steps[0]).toMatchObject({
      node: 'experienceAct',
      input: { prompt: GENERIC_REPLAY_PROMPT },
    });
  });
});

describe('框架组合闭环（任务 2.1 / 3.1–3.4）', () => {
  let root: string | undefined;
  let agent: Agent | undefined;

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
  });

  async function pages(themeA = REPLAY_THEME_A, themeAfter = REPLAY_THEME_A) {
    const entry = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: themeA,
      targetBox: BOX,
      seed: 0x10,
    });
    const after = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: themeAfter,
      targetBox: BOX,
      seed: themeAfter === themeA ? 0x10 : 0x21,
      altLayout: themeAfter !== themeA,
    });
    return { entry, after };
  }

  it('空库学习 → 真实 Matcher/Replay 命中激活，重放模型请求为零（任务 3.2 / 2.1）', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-loop-'));
    const store = openExperienceStore(root);
    const { entry, after } = await pages();
    const dumpHolder: { executions: unknown[] } = { executions: [] };
    let transport = 0;
    const observer = createDumpModelObserver({
      getDump: () => ({ executions: dumpHolder.executions }),
      getTransportCalls: () => transport,
    });
    let nativeCalls = 0;

    const runtime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => entry,
      replayTarget: new ScriptedReplayTarget(frameTable([entry, after])),
      nativeExecute: async ({ callId }) => {
        nativeCalls += 1;
        dumpHolder.executions.push(
          makeExecution(`learn-${callId}`, [
            makeActionTask({
              taskId: 'tap',
              subType: 'Tap',
              param: { locate: makeLocate('generic-replay-target', BOX) },
              before: makeScreenshot('b', entry),
              after: makeScreenshot('a', after),
            }),
          ]),
        );
        return { category: 'undefined', dump: { executions: dumpHolder.executions } };
      },
      modelObserver: observer,
      getDump: () => ({ executions: dumpHolder.executions }),
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });

    const learned = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'learn-1' });
    expect(learned.outcome).toBe('native');
    expect(learned.promote?.result).toBe('promoted');
    expect(nativeCalls).toBe(1);
    expect(learned.modelCalls.status).toBe('verified');

    const replayed = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'replay-1' });
    expect(replayed.outcome).toBe('replay');
    expect(replayed.nativeCalled).toBe(false);
    expect(nativeCalls).toBe(1);
    expect(replayed.modelCalls).toMatchObject({
      status: 'verified',
      locateVlm: 0,
      otherModel: 0,
      assertModel: 0,
    });
    const found = await store.findCandidates({ requestKey: keyOf(), environment: ENVIRONMENT });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value[0]?.status).toBe('active');
      expect(found.value[0]?.stats.replaySuccess).toBe(1);
    }
  });

  it('未接入观测时计数为 unknown，不能记为零（任务 2.1）', () => {
    const counts = unknownModelCounts('未接入');
    expect(counts.status).toBe('unknown');
    expect(counts.locateVlm).toBeNull();
    expect(counts.otherModel).toBeNull();
    expect(counts.assertModel).toBeNull();
  });

  it('小位移使用当前目标框；入口失配回退学习后可再命中；中途后缀入口隔离（任务 3.3）', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-shift-'));
    const store = openExperienceStore(root);
    const { entry, after } = await pages();
    const shifted = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: REPLAY_THEME_A,
      targetBox: BOX_SHIFTED,
      seed: 0x10,
    });
    const otherEntry = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: REPLAY_THEME_B,
      targetBox: BOX,
      seed: 0x21,
      altLayout: true,
    });
    const otherAfter = await paintReplayFrame({
      width: WIDTH,
      height: HEIGHT,
      theme: REPLAY_THEME_B,
      targetBox: BOX,
      seed: 0x22,
      altLayout: true,
    });

    let nativeCalls = 0;
    let currentLookup = entry;
    let replayFrames = [entry, after];
    let learnDump = dumpForTap('entry-a', entry, after);

    const runtime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => currentLookup,
      replayTarget: {
        screenshotBase64: async () => {
          const target = new ScriptedReplayTarget(frameTable(replayFrames));
          return target.screenshotBase64();
        },
        callActionInActionSpace: async (type, param) => {
          const target = new ScriptedReplayTarget(frameTable(replayFrames));
          return target.callActionInActionSpace(type, param);
        },
      },
      nativeExecute: async () => {
        nativeCalls += 1;
        return { category: 'undefined', dump: learnDump };
      },
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });

    await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'learn-a' });
    expect(nativeCalls).toBe(1);

    const shiftTarget = new ScriptedReplayTarget(frameTable([shifted, after]));
    const shiftRuntime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => shifted,
      replayTarget: shiftTarget,
      nativeExecute: async () => {
        nativeCalls += 1;
        return { category: 'undefined', dump: learnDump };
      },
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });
    const shiftedHit = await shiftRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'shift-1' });
    expect(shiftedHit.outcome).toBe('replay');
    expect(shiftTarget.dispatches[0]?.nativeType).toBe('Tap');
    const locate = (shiftTarget.dispatches[0]?.param as { locate?: { locatedPixelResult?: { center?: number[] } } })
      .locate?.locatedPixelResult?.center;
    expect(locate).toEqual([boxCenterOf(BOX_SHIFTED).x, boxCenterOf(BOX_SHIFTED).y]);
    expect(nativeCalls).toBe(1);

    currentLookup = otherEntry;
    replayFrames = [otherEntry, otherAfter];
    learnDump = dumpForTap('entry-b', otherEntry, otherAfter, BOX);
    const missRuntime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => otherEntry,
      replayTarget: new ScriptedReplayTarget(frameTable([otherEntry, otherAfter])),
      nativeExecute: async () => {
        nativeCalls += 1;
        return { category: 'undefined', dump: learnDump };
      },
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });
    const missed = await missRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'learn-b' });
    expect(missed.outcome).toBe('native');
    expect(nativeCalls).toBe(2);
    expect(missed.promote?.result).toBe('promoted');

    const newHit = await missRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'hit-b' });
    expect(newHit.outcome).toBe('replay');
    expect(nativeCalls).toBe(2);

    const found = await store.findCandidates({ requestKey: keyOf(), environment: ENVIRONMENT });
    expect(found.ok).toBe(true);
    if (found.ok) {
      const entries = found.value.map((chain) => computeEntryFingerprint(chain.entryEvidence));
      expect(new Set(entries).size).toBe(2);
    }
  });

  it('中途失败后新 candidate 使用当前画面入口，不冒充旧前缀链（任务 3.3）', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-suffix-'));
    const store = openExperienceStore(root);
    const fixture = await buildReplayChainFixture({
      width: WIDTH,
      height: HEIGHT,
      environment: ENVIRONMENT,
      pages: [
        { theme: REPLAY_THEME_A, targetBox: BOX, seed: 0x10 },
        { theme: REPLAY_THEME_B, targetBox: BOX, seed: 0x21 },
        { theme: REPLAY_THEME_C, targetBox: BOX, seed: 0x11, altLayout: true },
      ],
      entryFrame: 0,
      terminalFrame: 2,
      actions: [
        { type: 'Tap', beforeFrame: 0, afterFrame: 1, targetBox: BOX, textHint: 'generic' },
        { type: 'Back', beforeFrame: 1, afterFrame: 2 },
      ],
    });
    const published = await store.publishCandidate({
      eventId: 'suffix-seed',
      requestKey: keyOf(),
      source: makeSource({
        casePath: IDENTITY.casePath,
        caseName: IDENTITY.caseName,
        stepPath: IDENTITY.stepPath,
        prompt: GENERIC_REPLAY_PROMPT,
      }),
      environment: ENVIRONMENT,
      variant: {
        entryEvidence: fixture.chain.entryEvidence,
        terminalEvidence: fixture.chain.terminalEvidence,
        actions: [...fixture.chain.actions],
        eligibilityPolicyVersion: 'policy@1',
      },
      images: fixture.imageBytes,
    });
    expect(published.ok).toBe(true);
    const oldEntry = computeEntryFingerprint(fixture.chain.entryEvidence);
    const currentEntryPng = fixture.frames[1]!;
    const suffixAfter = fixture.frames[1]!;
    let nativeCalls = 0;
    const runtime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => fixture.frames[0]!,
      replayTarget: new ScriptedReplayTarget(frameTable([fixture.frames[0]!, fixture.frames[1]!])),
      nativeExecute: async () => {
        nativeCalls += 1;
        return { category: 'undefined', dump: dumpForTap('suffix', currentEntryPng, suffixAfter, BOX) };
      },
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });
    const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'suffix-1' });
    expect(result.replay?.effect).toBe('confirmed-partial');
    expect(result.outcome).toBe('native');
    expect(nativeCalls).toBe(1);
    expect(result.promote?.result).toBe('promoted');
    const promote = result.promote;
    if (promote?.result === 'promoted') {
      const found = await store.findCandidates({ requestKey: keyOf(), environment: ENVIRONMENT });
      expect(found.ok).toBe(true);
      if (found.ok) {
        const fresh = found.value.find((chain) => chain.variantId === promote.snapshot.variantId);
        expect(fresh).toBeDefined();
        expect(computeEntryFingerprint(fresh!.entryEvidence)).not.toBe(oldEntry);
      }
    }
  });

  it('取消 / 超时 / 未知副作用 / 发布失败矩阵（任务 3.4 / 2.2）', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-matrix-'));
    const store = openExperienceStore(root);
    const { entry, after } = await pages();
    await new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => entry,
      replayTarget: new ScriptedReplayTarget(frameTable([entry, after])),
      nativeExecute: async () => ({ category: 'undefined', dump: dumpForTap('seed', entry, after) }),
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    }).run({ request: REQUEST, identity: IDENTITY, callId: 'seed' });

    const cancelled = new AbortController();
    cancelled.abort();
    const cancelRuntime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => entry,
      replayTarget: new ScriptedReplayTarget(frameTable([entry, after])),
      nativeExecute: async () => {
        throw new Error('取消后不应原生');
      },
    });
    await expect(
      cancelRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'cancel', signal: cancelled.signal }),
    ).rejects.toBeInstanceOf(ExperienceRunError);

    const timeoutRuntime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => entry,
      replayTarget: new ScriptedReplayTarget(frameTable([entry, after])),
      nativeExecute: async () => {
        throw new Error('超时后不应原生');
      },
    });
    await expect(
      timeoutRuntime.run({
        request: REQUEST,
        identity: IDENTITY,
        callId: 'timeout',
        deadlineAtMs: Date.now() - 5,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });

    const unknownTarget = new ScriptedReplayTarget(frameTable([entry, after]), async () => {
      throw new Error('dispatch boom');
    });
    const unknownRuntime = new ExperienceRuntime({
      store,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => entry,
      replayTarget: unknownTarget,
      nativeExecute: async () => {
        throw new Error('unknown 后不应原生');
      },
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });
    await expect(
      unknownRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'unknown' }),
    ).rejects.toMatchObject({ kind: 'unknown-effect' });

    const failRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-failpub-'));
    const failingStore = openExperienceStore(failRoot, {
      publishIndex: async () => {
        throw new Error('发布失败');
      },
    });
    let natives = 0;
    const failPublish = new ExperienceRuntime({
      store: failingStore,
      environment: ENVIRONMENT,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => after,
      replayTarget: new ScriptedReplayTarget(frameTable([after])),
      nativeExecute: async () => {
        natives += 1;
        return { category: 'undefined', dump: dumpForTap('fail-pub', after, after) };
      },
    });
    const published = await failPublish.run({ request: REQUEST, identity: IDENTITY, callId: 'fail-pub' });
    expect(published.outcome).toBe('native');
    expect(published.promote?.result).toBe('failed');
    expect(natives).toBe(1);
    await fs.rm(failRoot, { recursive: true, force: true });
  });

  it('真实 Agent 回放路径：零 fetch，Locate 无 usage（任务 2.1 / 3.1）', async () => {
    const fixture = await buildReplayChainFixture({
      width: HARNESS_WIDTH,
      height: HARNESS_HEIGHT,
      environment: makeEnvironment({ resolution: { width: HARNESS_WIDTH, height: HARNESS_HEIGHT } }),
      pages: [
        { theme: REPLAY_THEME_A, targetBox: { x: 30, y: 60, width: 40, height: 24 }, seed: 0x61 },
        { theme: REPLAY_THEME_A, targetBox: { x: 32, y: 60, width: 40, height: 24 }, seed: 0x61 },
      ],
      entryFrame: 0,
      terminalFrame: 1,
      actions: [
        {
          type: 'Tap',
          beforeFrame: 0,
          afterFrame: 1,
          targetBox: { x: 30, y: 60, width: 40, height: 24 },
          textHint: 'generic',
        },
      ],
    });
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-agent-'));
    const store = openExperienceStore(root);
    const env = makeEnvironment({ resolution: { width: HARNESS_WIDTH, height: HARNESS_HEIGHT } });
    const published = await store.publishCandidate({
      eventId: 'agent-seed',
      requestKey: keyOf(),
      source: makeSource({
        casePath: IDENTITY.casePath,
        caseName: IDENTITY.caseName,
        stepPath: IDENTITY.stepPath,
        prompt: GENERIC_REPLAY_PROMPT,
      }),
      environment: env,
      variant: {
        entryEvidence: fixture.chain.entryEvidence,
        terminalEvidence: fixture.chain.terminalEvidence,
        actions: [...fixture.chain.actions],
        eligibilityPolicyVersion: 'policy@1',
      },
      images: fixture.imageBytes,
    });
    expect(published.ok).toBe(true);

    const device = new SteppedDevice(fixture.frames, HARNESS_WIDTH, HARNESS_HEIGHT);
    agent = new Agent(device as unknown as AbstractInterface, {
      generateReport: false,
      persistExecutionDump: false,
      autoPrintReportMsg: false,
      waitAfterAction: 0,
      groupName: 'experience-runtime-harness',
      modelConfig: { ...DUMMY_MODEL_CONFIG },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const observer = createDumpModelObserver({
      getDump: () => agent!.dump,
      getTransportCalls: () => fetchMock.mock.calls.length,
    });
    const runtime = new ExperienceRuntime({
      store,
      environment: env,
      policy: GENERIC_TEST_ACTION_POLICY,
      captureScreenshot: async () => fixture.frames[0]!,
      replayTarget: replayTargetFromAgent(agent),
      nativeExecute: async () => {
        throw new Error('命中后不应原生');
      },
      modelObserver: observer,
      getDump: () => agent!.dump,
      replayOptions: { waitPollIntervalMs: 5, maxAfterWaitMs: 80 },
    });
    const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'agent-replay' });
    expect(result.outcome).toBe('replay');
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.modelCalls.status).toBe('verified');
    expect(result.modelCalls.locateVlm).toBe(0);
    expect(device.actions).toEqual([
      { kind: 'tap', x: boxCenterOf({ x: 30, y: 60, width: 40, height: 24 }).x, y: boxCenterOf({ x: 30, y: 60, width: 40, height: 24 }).y },
    ]);
  });
});
