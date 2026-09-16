import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { openExperienceStore, type ExperienceStore } from '../../src/experience/store/experience-store';
import {
  EMPTY_ACTION_POLICY,
  ExperienceRunError,
  ExperienceRuntime,
  evaluateActionEligibility,
  normalizeActionPolicy,
  type ExperienceRuntimeDeps,
  type NativeActExecute,
  type RuntimeEventType,
} from '../../src/experience/runtime';
import type { ReplayResult } from '../../src/experience/replay/types';
import {
  FixtureImageBag,
  makeEnvironment,
  makeRevision,
  makeSource,
} from '../helpers/experience-fixtures';
import {
  DispatchProbeTarget,
  GENERIC_ONESHOT_PROMPT,
  GENERIC_REPLAY_PROMPT,
  GENERIC_TEST_ACTION_POLICY,
  injectedMatch,
  runtimeIdentity,
  runtimeRequest,
  silentReplayTarget,
} from '../helpers/experience-runtime-fixtures';
import {
  DUMP_HEIGHT,
  DUMP_WIDTH,
  TAP_BOX,
  makeActionTask,
  makeExecution,
  makeLocate,
  makeReportDump,
  makeScreenshot,
} from '../helpers/promotion-dump';
import { makeSolidPng } from '../helpers/promotion-png';

const IDENTITY = runtimeIdentity();
const ENVIRONMENT = makeEnvironment();
const REQUEST = runtimeRequest();

function requestKey(prompt: string = GENERIC_REPLAY_PROMPT) {
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

function replayStub(overrides: Partial<ReplayResult> & Pick<ReplayResult, 'status' | 'effect' | 'reason'>): ReplayResult {
  return {
    completedActions: 0,
    dispatchedActions: 0,
    totalActions: 1,
    failedActionIndex: 0,
    phase: 'before-verify',
    ...overrides,
  };
}

function nativeMock(impl?: NativeActExecute) {
  const calls: Array<{ prompt: string; callId: string }> = [];
  const execute: NativeActExecute = async (input) => {
    calls.push({ prompt: input.prompt, callId: input.callId });
    if (impl) return impl(input);
    return { category: 'undefined', dump: { executions: [] } };
  };
  return { execute, calls };
}

async function publishChain(store: ExperienceStore, options: {
  eventId: string;
  entrySeed: string;
  environment?: ReturnType<typeof makeEnvironment>;
  prompt?: string;
}) {
  const bag = new FixtureImageBag();
  const revision = makeRevision(bag, { entrySeed: options.entrySeed });
  const published = await store.publishCandidate({
    eventId: options.eventId,
    requestKey: requestKey(options.prompt ?? GENERIC_REPLAY_PROMPT),
    source: makeSource({
      casePath: IDENTITY.casePath,
      caseName: IDENTITY.caseName,
      stepPath: IDENTITY.stepPath,
      prompt: options.prompt ?? GENERIC_REPLAY_PROMPT,
    }),
    environment: options.environment ?? ENVIRONMENT,
    variant: {
      entryEvidence: revision.entryEvidence,
      terminalEvidence: revision.terminalEvidence,
      actions: revision.actions,
      eligibilityPolicyVersion: 'policy@1',
    },
    images: bag.images,
  });
  if (!published.ok) throw new Error(published.error.message);
  return published.value.snapshot;
}

function makeRuntime(
  store: ExperienceStore,
  png: Uint8Array,
  overrides: Partial<ExperienceRuntimeDeps> = {},
) {
  const { nativeExecute, ...rest } = overrides;
  const native = nativeMock(nativeExecute);
  const probe = new DispatchProbeTarget(png);
  const runtime = new ExperienceRuntime({
    store,
    environment: ENVIRONMENT,
    policy: GENERIC_TEST_ACTION_POLICY,
    captureScreenshot: async () => png,
    replayTarget: probe,
    matchScreen: async () => injectedMatch('match'),
    replayChain: async () =>
      replayStub({
        status: 'success',
        effect: 'confirmed-partial',
        reason: 'stub-success',
        phase: 'done',
        failedActionIndex: null,
        completedActions: 1,
      }),
    ...rest,
    nativeExecute: native.execute,
  });
  return { runtime, native, probe };
}

describe('资格策略（任务 1.1）', () => {
  it('默认策略为空，未登记目标不能重放', () => {
    expect(EMPTY_ACTION_POLICY.targets).toEqual([]);
    const result = evaluateActionEligibility(runtimeRequest(), EMPTY_ACTION_POLICY);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/默认资格策略为空/);
  });

  it('注入通用测试策略后精确 prompt 命中；含判断或未登记走原生边界', () => {
    expect(evaluateActionEligibility(runtimeRequest(), GENERIC_TEST_ACTION_POLICY).eligible).toBe(true);
    expect(evaluateActionEligibility(runtimeRequest('未登记动作'), GENERIC_TEST_ACTION_POLICY).eligible).toBe(false);
    expect(
      evaluateActionEligibility(runtimeRequest(GENERIC_REPLAY_PROMPT, { options: { deepThink: true } }), GENERIC_TEST_ACTION_POLICY).eligible,
    ).toBe(false);
    expect(
      evaluateActionEligibility(
        runtimeRequest({ prompt: GENERIC_REPLAY_PROMPT, images: [{ name: 'a', url: 'x' }] } as never),
        GENERIC_TEST_ACTION_POLICY,
      ).eligible,
    ).toBe(false);
    expect(
      evaluateActionEligibility(
        runtimeRequest(GENERIC_REPLAY_PROMPT, { context: { assert: { pass: true } } }),
        GENERIC_TEST_ACTION_POLICY,
      ).eligible,
    ).toBe(false);
  });

  it('含判断的登记项被规范化丢弃，不能变成可重放目标', () => {
    const policy = normalizeActionPolicy({
      version: 'policy@1',
      targets: [
        { prompt: GENERIC_REPLAY_PROMPT, repeatableFromCurrentState: true, context: { shot: { png: true } as never } },
      ],
    });
    expect(policy.targets).toEqual([]);
  });
});

describe('ExperienceRuntime 单元边界', () => {
  let root: string;
  let store: ExperienceStore;
  let png: Uint8Array;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-'));
    store = openExperienceStore(root);
    png = await makeSolidPng(8, 8, { r: 12, g: 24, b: 36 });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function eventTypes(result: { events: readonly { type: RuntimeEventType }[] }) {
    return result.events.map((event) => event.type);
  }

  describe('未登记/含判断走原生（任务 1.1）', () => {
    it('默认空策略：不查询 Store，原生恰好一次', async () => {
      const { runtime, native, probe } = makeRuntime(store, png, {
        policy: EMPTY_ACTION_POLICY,
      });
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-empty' });
      expect(result.outcome).toBe('native');
      expect(result.nativeCalled).toBe(true);
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);
      expect(eventTypes(result)).toContain('MISS');
      expect(eventTypes(result)).toContain('FALLBACK');
    });

    it('含判断请求即使 prompt 相同也走原生，不使用已有资产', async () => {
      await publishChain(store, { eventId: 'seed', entrySeed: 'entry' });
      const { runtime, native, probe } = makeRuntime(store, png);
      const result = await runtime.run({
        request: runtimeRequest(GENERIC_REPLAY_PROMPT, { options: { context: '判断' } }),
        identity: IDENTITY,
        callId: 'c-judge',
      });
      expect(result.nativeCalled).toBe(true);
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);
      expect(result.selected).toBeUndefined();
    });
  });

  describe('Lookup 候选选择（任务 1.2）', () => {
    it('空 Store → MISS，不向设备试点', async () => {
      const { runtime, native, probe } = makeRuntime(store, png);
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-empty-store' });
      expect(result.outcome).toBe('native');
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);
      expect(result.events.some((event) => event.type === 'MISS' && event.status === 'empty')).toBe(true);
    });

    it('candidate 与 active 可被选中；stale 不参与；不以设备试点', async () => {
      const snapshot = await publishChain(store, { eventId: 'cand', entrySeed: 'entry-a' });
      const { runtime, probe } = makeRuntime(store, png, {
        replayChain: async () =>
          replayStub({ status: 'success', effect: 'confirmed-partial', reason: 'ok', phase: 'done', failedActionIndex: null, completedActions: 1 }),
        nativeExecute: async () => {
          throw new Error('命中后不应调用原生');
        },
      });
      const hit = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-cand' });
      expect(hit.outcome).toBe('replay');
      expect(hit.selected?.status).toBe('candidate');
      expect(probe.dispatches).toBe(0);

      const activated = await store.findCandidates({ requestKey: requestKey(), environment: ENVIRONMENT });
      expect(activated.ok).toBe(true);
      if (activated.ok) expect(activated.value[0]?.status).toBe('active');

      await store.applyVariantEvent({
        eventId: 'stale-1',
        requestKey: requestKey(),
        variantId: snapshot.variantId,
        expectedRevision: 1,
        event: { type: 'marked-stale', reason: 'test' },
      });
      const { runtime: staleRuntime, native } = makeRuntime(store, png);
      const miss = await staleRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-stale' });
      expect(miss.outcome).toBe('native');
      expect(native.calls).toHaveLength(1);
    });

    it('环境不兼容与坏资产降级 MISS，不试点设备', async () => {
      await publishChain(store, { eventId: 'env', entrySeed: 'entry-env' });
      const { runtime, native, probe } = makeRuntime(store, png, {
        environment: makeEnvironment({ model: 'Pixel 9' }),
      });
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-env' });
      expect(result.outcome).toBe('native');
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);

      const bagRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-bad-'));
      const badStore = openExperienceStore(bagRoot);
      await publishChain(badStore, { eventId: 'bad', entrySeed: 'entry-bad' });
      const assetsDir = path.join(bagRoot, 'assets');
      const files = await fs.readdir(assetsDir);
      await fs.writeFile(path.join(assetsDir, files[0]!), Buffer.from('not-a-png'));
      const { runtime: badRuntime, probe: badProbe } = makeRuntime(badStore, png);
      const bad = await badRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-bad' });
      expect(bad.outcome).toBe('native');
      expect(badProbe.dispatches).toBe(0);
      await fs.rm(bagRoot, { recursive: true, force: true });
    });

    it('入口验证通过的同等候选歧义则 MISS，不试点', async () => {
      vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-16T10:00:00.000Z');
      await publishChain(store, { eventId: 'a', entrySeed: 'entry-1' });
      await publishChain(store, { eventId: 'b', entrySeed: 'entry-2' });
      const { runtime, native, probe } = makeRuntime(store, png);
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-amb' });
      expect(result.events.some((event) => event.status === 'ambiguous')).toBe(true);
      expect(result.nativeCalled).toBe(true);
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);
      vi.restoreAllMocks();
    });
  });

  describe('回退预算（任务 1.3）', () => {
    it('动作前拒绝且副作用 none → 恰好一次原生', async () => {
      await publishChain(store, { eventId: 'pre', entrySeed: 'e' });
      const { runtime, native } = makeRuntime(store, png, {
        replayChain: async () =>
          replayStub({
            status: 'failed',
            effect: 'none',
            reason: '前置画面不符',
            failure: { kind: 'no-match', message: '前置画面不符' },
          }),
      });
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-pre' });
      expect(result.outcome).toBe('native');
      expect(native.calls).toHaveLength(1);
    });

    it('已确认部分失败：可重复目标回退一次；一次性目标停止', async () => {
      await publishChain(store, { eventId: 'part', entrySeed: 'e' });
      const partial = replayStub({
        status: 'failed',
        effect: 'confirmed-partial',
        completedActions: 1,
        dispatchedActions: 1,
        reason: '中途目标不符',
        failure: { kind: 'no-match', message: '中途目标不符' },
      });
      const { runtime, native } = makeRuntime(store, png, { replayChain: async () => partial });
      await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-part' });
      expect(native.calls).toHaveLength(1);

      const { runtime: oneShot, native: oneShotNative } = makeRuntime(store, png, {
        replayChain: async () => partial,
      });
      await publishChain(store, {
        eventId: 'oneshot-seed',
        entrySeed: 'e-oneshot',
        prompt: GENERIC_ONESHOT_PROMPT,
      });
      await expect(
        oneShot.run({
          request: runtimeRequest(GENERIC_ONESHOT_PROMPT),
          identity: IDENTITY,
          callId: 'c-oneshot',
        }),
      ).rejects.toBeInstanceOf(ExperienceRunError);
      expect(oneShotNative.calls).toHaveLength(0);
    });

    it('unknown / 取消 / timeout 不追加原生', async () => {
      await publishChain(store, { eventId: 'u', entrySeed: 'e' });
      for (const replay of [
        replayStub({
          status: 'failed',
          effect: 'unknown',
          dispatchedActions: 1,
          reason: '副作用未知',
          failure: { kind: 'device-error', message: 'dispatch throw' },
        }),
        replayStub({
          status: 'cancelled',
          effect: 'none',
          reason: '取消',
          failure: { kind: 'cancelled', message: '取消' },
        }),
        replayStub({
          status: 'cancelled',
          effect: 'none',
          reason: '超时',
          failure: { kind: 'timeout', message: '超时' },
        }),
      ]) {
        const { runtime, native } = makeRuntime(store, png, { replayChain: async () => replay });
        await expect(runtime.run({ request: REQUEST, identity: IDENTITY, callId: `c-${replay.reason}` })).rejects.toBeInstanceOf(
          ExperienceRunError,
        );
        expect(native.calls).toHaveLength(0);
      }
    });

    it('调用开始即取消或截止：零原生', async () => {
      const { runtime, native } = makeRuntime(store, png);
      const controller = new AbortController();
      controller.abort();
      await expect(
        runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-aborted', signal: controller.signal }),
      ).rejects.toMatchObject({ kind: 'cancelled' });
      expect(native.calls).toHaveLength(0);

      await expect(
        runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-dead', deadlineAtMs: Date.now() - 1 }),
      ).rejects.toMatchObject({ kind: 'timeout' });
      expect(native.calls).toHaveLength(0);
    });
  });

  describe('生命周期与 Promotion 隔离（任务 1.4）', () => {
    it('完整重放成功激活 candidate 且统计幂等', async () => {
      await publishChain(store, { eventId: 'act', entrySeed: 'e' });
      const { runtime } = makeRuntime(store, png, {
        replayChain: async () =>
          replayStub({ status: 'success', effect: 'confirmed-partial', reason: 'ok', phase: 'done', failedActionIndex: null, completedActions: 1 }),
        nativeExecute: async () => {
          throw new Error('不应原生');
        },
      });
      await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-act' });
      await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-act' });
      const found = await store.findCandidates({ requestKey: requestKey(), environment: ENVIRONMENT });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value[0]?.status).toBe('active');
      expect(found.value[0]?.stats.replaySuccess).toBe(1);
    });

    it('明确视觉失效标 stale；设备错误不污染视觉状态', async () => {
      await publishChain(store, { eventId: 'vis', entrySeed: 'e1' });
      const { runtime } = makeRuntime(store, png, {
        replayChain: async () =>
          replayStub({
            status: 'failed',
            effect: 'none',
            reason: '视觉失效',
            failure: { kind: 'no-match', message: '视觉失效' },
          }),
      });
      await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-vis' });
      const found = await store.findCandidates({ requestKey: requestKey(), environment: ENVIRONMENT });
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.value).toHaveLength(0);

      const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-runtime-dev-'));
      const otherStore = openExperienceStore(otherRoot);
      const deviceSnap = await publishChain(otherStore, { eventId: 'dev', entrySeed: 'e2' });
      const { runtime: deviceRuntime, native } = makeRuntime(otherStore, png, {
        replayChain: async () =>
          replayStub({
            status: 'failed',
            effect: 'none',
            reason: '设备断开',
            failure: { kind: 'device-error', message: '设备断开' },
          }),
      });
      await expect(
        deviceRuntime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-dev' }),
      ).rejects.toMatchObject({ kind: 'device' });
      expect(native.calls).toHaveLength(0);
      const still = await otherStore.findCandidates({ requestKey: requestKey(), environment: ENVIRONMENT });
      expect(still.ok).toBe(true);
      if (still.ok) {
        expect(still.value[0]?.variantId).toBe(deviceSnap.variantId);
        expect(still.value[0]?.status).toBe('candidate');
      }
      await fs.rm(otherRoot, { recursive: true, force: true });
    });

    it('写盘失败不改 UI 成功，不二次原生', async () => {
      const failing = openExperienceStore(root, {
        publishIndex: async () => {
          throw new Error('index 不可写');
        },
      });
      const nativeCalls: string[] = [];
      const before = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 200, g: 10, b: 10 });
      const after = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 10, g: 200, b: 10 });
      const dump = makeReportDump([
        makeExecution('exec-learn', [
          makeActionTask({
            taskId: 'tap',
            subType: 'Tap',
            param: { locate: makeLocate('generic', TAP_BOX) },
            before: makeScreenshot('b', before),
            after: makeScreenshot('a', after),
          }),
        ]),
      ]);
      const runtime = new ExperienceRuntime({
        store: failing,
        environment: makeEnvironment({ resolution: { width: DUMP_WIDTH, height: DUMP_HEIGHT } }),
        policy: GENERIC_TEST_ACTION_POLICY,
        nativeExecute: async () => {
          nativeCalls.push('native');
          return { category: 'undefined', dump };
        },
        captureScreenshot: async () => before,
        replayTarget: silentReplayTarget(before),
        matchScreen: async () => injectedMatch('no-match'),
      });
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-write' });
      expect(result.outcome).toBe('native');
      expect(result.promote?.result).toBe('failed');
      expect(nativeCalls).toEqual(['native']);
    });
  });

  describe('失败路径（任务 2.2）', () => {
    it('Store 不可用仍原生一次，不派发回放动作', async () => {
      const missing = openExperienceStore(path.join(root, 'missing-as-file'));
      await fs.writeFile(path.join(root, 'missing-as-file'), 'not-a-dir');
      const { runtime, native, probe } = makeRuntime(missing, png);
      const result = await runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-io' });
      expect(result.nativeCalled).toBe(true);
      expect(native.calls).toHaveLength(1);
      expect(probe.dispatches).toBe(0);
    });

    it('原生失败不学习、不追加第二次原生', async () => {
      const { runtime, native } = makeRuntime(store, png, {
        nativeExecute: async () => {
          throw new Error('model down');
        },
      });
      await expect(runtime.run({ request: REQUEST, identity: IDENTITY, callId: 'c-nf' })).rejects.toMatchObject({
        kind: 'native',
      });
      expect(native.calls).toHaveLength(1);
      const found = await store.findCandidates({ requestKey: requestKey(), environment: ENVIRONMENT });
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.value).toHaveLength(0);
    });
  });
});
