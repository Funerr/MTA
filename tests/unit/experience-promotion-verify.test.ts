import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExperienceRuntime } from '../../src/experience/runtime/runtime';
import type {
  ExperienceRuntimeDeps,
  ExperienceRuntimeInput,
  NativeActResult,
} from '../../src/experience/runtime/types';
import type {
  CandidateChain,
  ExperienceStore,
} from '../../src/experience/store/experience-store';
import type { ReplayResult } from '../../src/experience/replay/types';

describe('经验学习验证', () => {
  const createMockStore = () => ({
    findCandidates: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    publishCandidate: vi.fn(),
    applyVariantEvent: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        result: 'applied',
        snapshot: {
          requestKey: 'a'.repeat(64),
          variantId: 'b'.repeat(64),
          revision: 1,
          status: 'active',
          stats: { learned: 1, replaySuccess: 1, replayFailure: 0 },
        },
      },
    }),
  }) as unknown as ExperienceStore;

  const createMockDeps = (
    overrides: Partial<ExperienceRuntimeDeps> = {},
  ): ExperienceRuntimeDeps => ({
    store: createMockStore(),
    nativeExecute: vi.fn().mockResolvedValue({
      category: 'undefined',
      dump: {},
      value: undefined,
    } as NativeActResult),
    captureScreenshot: vi.fn().mockResolvedValue(new Uint8Array()),
    replayTarget: {
      screenshotBase64: vi.fn().mockResolvedValue('data:image/png;base64,'),
      callActionInActionSpace: vi.fn().mockResolvedValue(undefined),
    },
    environment: {
      platform: 'android',
      model: 'TestDevice',
      systemBuild: '1.0.0',
      resolution: { width: 1920, height: 1080 },
      orientation: 'portrait',
      language: 'zh',
      theme: 'light',
      executionCompatVersion: '1.0.0',
    },
    ...overrides,
  });

  const createInput = (): ExperienceRuntimeInput => ({
    request: { prompt: '点击按钮' },
    identity: {
      casePath: 'test.yaml',
      caseName: '测试用例',
      stepPath: 'steps[0]',
    },
  });

  it('纯动作（undefined 类型）应该触发经验学习', async () => {
    const mockPromote = vi.fn().mockResolvedValue({
      result: 'promoted',
      snapshot: {
        revision: 1,
        variantId: 'variant-1',
        learnedAt: new Date().toISOString(),
      },
      duplicate: false,
    });

    const deps = createMockDeps({
      promote: mockPromote,
      policy: {
        version: '1.0.0',
        targets: [
          {
            prompt: '点击按钮',
            repeatableFromCurrentState: true,
          },
        ],
      },
    });

    const runtime = new ExperienceRuntime(deps);
    const result = await runtime.run(createInput());

    // 验证结果
    expect(result.outcome).toBe('native');
    expect(result.nativeCalled).toBe(true);

    // 验证调用了 promote
    expect(mockPromote).toHaveBeenCalled();

    // 验证事件序列
    const eventTypes = result.events.map((e) => e.type);
    expect(eventTypes).toContain('MISS'); // 首次查找失败
    expect(eventTypes).toContain('FALLBACK'); // 回退到原生
    expect(eventTypes).toContain('PROMOTE'); // 尝试学习经验

    // 验证 PROMOTE 事件状态
    const promoteEvent = result.events.find((e) => e.type === 'PROMOTE');
    expect(promoteEvent?.status).toBe('promoted');
  });

  it('动态返回值（string 类型）应该跳过学习', async () => {
    const mockPromote = vi.fn();

    const deps = createMockDeps({
      nativeExecute: vi.fn().mockResolvedValue({
        category: 'string', // string 类型
        dump: {},
        value: '操作成功',
      } as NativeActResult),
      promote: mockPromote,
      policy: {
        version: '1.0.0',
        targets: [
          {
            prompt: '点击按钮',
            repeatableFromCurrentState: true,
          },
        ],
      },
    });

    const runtime = new ExperienceRuntime(deps);
    const result = await runtime.run(createInput());

    // 验证结果
    expect(result.outcome).toBe('native');

    // 验证没有调用 promote
    expect(mockPromote).not.toHaveBeenCalled();

    // 验证 PROMOTE 事件状态为 skipped
    const promoteEvent = result.events.find((e) => e.type === 'PROMOTE');
    expect(promoteEvent?.status).toBe('skipped');
    expect(promoteEvent?.reason).toContain('v1 只学习纯动作');
  });

  it('第二次运行应该命中经验并重放', async () => {
    // 模拟 Store 中有已学习的经验
    const mockStore = createMockStore();
    const asset = {
      digest: 'a'.repeat(64),
      byteSize: 1,
      mimeType: 'image/png' as const,
    };
    const evidence = {
      screenshot: { asset, width: 1, height: 1 },
      signature: {
        algorithm: 'test',
        version: '1',
        params: {},
        value: 'fixture',
      },
    };
    const mockCandidate: CandidateChain = {
      requestKey: 'c'.repeat(64),
      variantId: 'b'.repeat(64),
      revision: 1,
      status: 'active' as const,
      learnedAt: new Date().toISOString(),
      environment: {
        platform: 'android' as const,
        model: 'TestDevice',
        systemBuild: '1.0.0',
        resolution: { width: 1920, height: 1080 },
        orientation: 'portrait' as const,
        language: 'zh',
        theme: 'light',
        executionCompatVersion: '1.0.0',
      },
      environmentFingerprint: 'd'.repeat(64),
      entryEvidence: evidence,
      terminalEvidence: evidence,
      actions: [],
      eligibilityPolicyVersion: '1.0.0',
      nativeResult: { category: 'undefined' },
      evidenceComplete: true,
      stats: { learned: 1, replaySuccess: 0, replayFailure: 0 },
      source: {
        casePath: 'test.yaml',
        caseName: '测试用例',
        stepPath: 'steps[0]',
        node: 'aiAct',
        prompt: '点击按钮',
        callId: 'call-1',
        midsceneVersion: '1.12.7',
        adapterVersion: 'test',
        capturedAt: new Date().toISOString(),
      },
    };
    (mockStore.findCandidates as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: [mockCandidate],
    });

    const mockReplay = vi.fn().mockResolvedValue({
      status: 'success',
      effect: 'confirmed-partial',
      completedActions: 1,
      dispatchedActions: 1,
      totalActions: 1,
      failedActionIndex: null,
      phase: 'done',
      reason: '测试回放成功',
    } satisfies ReplayResult);

    const deps = createMockDeps({
      store: mockStore,
      replayChain: mockReplay,
      loadImage: async () => new Uint8Array([1]),
      matchScreen: async () => ({
        decision: 'match',
        reason: '测试入口匹配',
        timingMs: 0,
        configVersion: 'test',
        dataVersion: 'test',
        algorithm: {
          pipeline: 'test',
          phash: 'test',
          ncc: 'test',
          ssim: 'test',
        },
        scores: {
          environment: { value: 1, threshold: 1, passed: true },
          screen: { value: 1, threshold: 1, passed: true },
        },
      }),
      policy: {
        version: '1.0.0',
        targets: [
          {
            prompt: '点击按钮',
            repeatableFromCurrentState: true,
          },
        ],
      },
    });

    const runtime = new ExperienceRuntime(deps);
    const result = await runtime.run(createInput());

    // 验证结果
    expect(result.outcome).toBe('replay');
    expect(result.nativeCalled).toBe(false);

    // 验证事件序列
    const eventTypes = result.events.map((e) => e.type);
    expect(eventTypes).toContain('LOOKUP'); // 查找经验
    expect(eventTypes).toContain('HIT'); // 命中经验
    expect(eventTypes).toContain('REPLAY'); // 重放经验

    // 验证没有回退到原生 AI
    expect(eventTypes).not.toContain('FALLBACK');
  });
});
