import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promoteExperience } from '../../src/experience/promotion/promoter';
import { CONTEXT_PAD_RATIO, ELIGIBILITY_POLICY_VERSION } from '../../src/experience/promotion/constants';
import { defaultImagePipeline, expandBox, type ImagePipeline } from '../../src/experience/promotion/image';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { makeEnvironment } from '../helpers/experience-fixtures';
import { makeMarkedPng, makeSolidPng, samplePixel } from '../helpers/promotion-png';
import {
  DUMP_HEIGHT,
  DUMP_WIDTH,
  INPUT_BOX,
  SCROLL_BOX,
  TAP_BOX,
  makeActionTask,
  makeExecution,
  makeLocate,
  makeScreenshot,
  makeSupportedChainExecution,
  promoteRequest,
} from '../helpers/promotion-dump';

const capturedAt = '2026-09-16T00:00:00.000Z';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-promotion-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function source() {
  return {
    casePath: 'cases/settings.yaml',
    caseName: 'settings-display',
    stepPath: 'steps[2]',
    node: 'aiAct',
    prompt: '打开显示设置',
  };
}

describe('六类动作映射与裁剪（任务 2.2）', () => {
  it('发布完整链：顺序、bbox、context 覆盖、目标像素与标记一致', async () => {
    const markRgb = { r: 220, g: 30, b: 30 };
    const marked = await makeMarkedPng(DUMP_WIDTH, DUMP_HEIGHT, {
      x: TAP_BOX.x,
      y: TAP_BOX.y,
      width: TAP_BOX.width,
      height: TAP_BOX.height,
      rgb: markRgb,
    });
    const after = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 10, g: 80, b: 10 });
    const tapBefore = makeScreenshot('marked-before', marked, 1);
    const tapAfter = makeScreenshot('solid-after', after, 2);
    const execution = makeExecution('exec-visual', [
      makeActionTask({
        taskId: 'tap',
        subType: 'Tap',
        param: { locate: makeLocate('红色按钮', TAP_BOX) },
        before: tapBefore,
        after: tapAfter,
      }),
      makeActionTask({
        taskId: 'home',
        subType: 'AndroidHomeButton',
        before: tapAfter,
        after: makeScreenshot(
          'home-after',
          await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 20, g: 20, b: 20 }),
          3,
        ),
      }),
    ]);
    const store = openExperienceStore(root);
    const result = await promoteExperience({
      callId: 'call-visual',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
    });
    expect(result.result).toBe('promoted');
    if (result.result !== 'promoted') return;
    expect(result.contextPadRatio).toBe(CONTEXT_PAD_RATIO);

    const key = deriveRequestKey(promoteRequest());
    expect(key.eligible).toBe(true);
    if (!key.eligible) return;
    const found = await store.findCandidates({
      requestKey: key.requestKey,
      environment: makeEnvironment(),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    const chain = found.value[0]!;
    expect(chain.actions.map((action) => action.type)).toEqual(['Tap', 'Home']);
    const tap = chain.actions[0];
    if (tap.type !== 'Tap') return;
    expect(tap.target.bbox).toEqual(TAP_BOX);
    expect(tap.target.image.width).toBe(TAP_BOX.width);
    expect(tap.target.image.height).toBe(TAP_BOX.height);
    const expectedContext = expandBox(TAP_BOX, { width: DUMP_WIDTH, height: DUMP_HEIGHT });
    expect(tap.target.contextImage.width).toBe(expectedContext.width);
    expect(tap.target.contextImage.height).toBe(expectedContext.height);
    expect(tap.target.contextImage.width).toBeGreaterThanOrEqual(TAP_BOX.width);
    expect(tap.target.contextImage.height).toBeGreaterThanOrEqual(TAP_BOX.height);

    const targetBytes = await store.readAssetImage(tap.target.image.asset);
    expect(targetBytes.ok).toBe(true);
    if (!targetBytes.ok) return;
    const pixel = await samplePixel(
      targetBytes.value,
      Math.floor(TAP_BOX.width / 2),
      Math.floor(TAP_BOX.height / 2),
    );
    expect(pixel).toEqual(markRgb);
    expect(chain.entryEvidence.screenshot.asset.digest).toBe(tap.before.screenshot.asset.digest);
    expect(chain.terminalEvidence.screenshot.asset.digest).toBe(
      chain.actions[1]!.after.screenshot.asset.digest,
    );
    expect(chain.entryEvidence.signature.params.padRatio).toBe(CONTEXT_PAD_RATIO);
    expect(chain.entryEvidence.signature.algorithm).toBe('mean-rgb-grid');
    expect(chain.entryEvidence.signature.value).not.toBe(
      chain.entryEvidence.screenshot.asset.digest,
    );
  });

  it('六类声明动作按序发布，参数、bbox 与 entry/terminal 证据完整', async () => {
    const { execution } = await makeSupportedChainExecution('exec-six');
    const store = openExperienceStore(root);
    const result = await promoteExperience({
      callId: 'call-six',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
    });
    expect(result.result).toBe('promoted');
    if (result.result !== 'promoted') return;
    const key = deriveRequestKey(promoteRequest());
    if (!key.eligible) return;
    const found = await store.findCandidates({
      requestKey: key.requestKey,
      environment: makeEnvironment(),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const chain = found.value[0]!;
    expect(chain.actions.map((action) => action.type)).toEqual([
      'Tap',
      'Input',
      'Scroll',
      'LongPress',
      'Back',
      'Home',
    ]);
    const tap = chain.actions[0];
    const input = chain.actions[1];
    const scroll = chain.actions[2];
    const longPress = chain.actions[3];
    if (
      tap.type !== 'Tap' ||
      input.type !== 'Input' ||
      scroll.type !== 'Scroll' ||
      longPress.type !== 'LongPress'
    ) {
      return;
    }
    expect(tap.target.bbox).toEqual(TAP_BOX);
    expect(tap.target.image.width).toBe(TAP_BOX.width);
    expect(input.params).toEqual({ text: '显示', mode: 'replace' });
    expect(input.target.bbox).toEqual(INPUT_BOX);
    expect(scroll.params).toEqual({
      direction: 'down',
      distancePx: 64,
      anchor: {
        x: SCROLL_BOX.x + Math.floor(SCROLL_BOX.width / 2),
        y: SCROLL_BOX.y + Math.floor(SCROLL_BOX.height / 2),
      },
    });
    expect(longPress.params).toEqual({ durationMs: 800 });
    expect(chain.entryEvidence.screenshot.asset.digest).toBe(
      tap.before.screenshot.asset.digest,
    );
    expect(chain.terminalEvidence.screenshot.asset.digest).toBe(
      chain.actions[5]!.after.screenshot.asset.digest,
    );
  });

  it('Scroll 缺少固定像素距离时整链拒绝', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 1, g: 2, b: 3 });
    const before = makeScreenshot('b', png, 1);
    const after = makeScreenshot('a', png, 2);
    const result = await promoteExperience({
      callId: 'call-scroll-until',
      dump: makeExecution('exec-scroll-until', [
        makeActionTask({
          taskId: 'scroll',
          subType: 'Scroll',
          param: {
            locate: makeLocate('列表', SCROLL_BOX),
            scrollType: 'scrollToBottom',
            direction: 'down',
          },
          before,
          after,
        }),
      ]),
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/scrollType/);
  });

  it('未知动作类型整链拒绝，不丢弃后发布残余链', async () => {
    const { execution } = await makeSupportedChainExecution('exec-swipe');
    const tasks = execution.tasks as Array<Record<string, unknown>>;
    tasks.splice(1, 0, makeActionTask({
      taskId: 'swipe',
      subType: 'Swipe',
      before: makeScreenshot('s', await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 8, g: 8, b: 8 })),
    }));
    const store = openExperienceStore(root);
    const result = await promoteExperience({
      callId: 'call-swipe',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/Swipe/);
    const key = deriveRequestKey(promoteRequest());
    if (!key.eligible) return;
    const found = await store.findCandidates({
      requestKey: key.requestKey,
      environment: makeEnvironment(),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(0);
  });
});

describe('资格策略（任务 2.3）', () => {
  it('动态原生返回类别不发布，原生结果由调用方原样保留', async () => {
    const { execution } = await makeSupportedChainExecution();
    const nativeResult = { category: 'string' as const, value: '当前亮度 80%' };
    const result = await promoteExperience({
      callId: 'call-dynamic',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      nativeResult,
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/string/);
    expect(nativeResult.value).toBe('当前亮度 80%');
  });

  it('轨迹含 Insight 判断时不发布，原生结果保持有效', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 9, g: 9, b: 9 });
    const shot = makeScreenshot('assert', png, 1);
    const nativeResult = { category: 'undefined' as const };
    const result = await promoteExperience({
      callId: 'call-assert',
      dump: makeExecution('exec-assert', [
        makeActionTask({
          taskId: 'home',
          subType: 'AndroidHomeButton',
          before: shot,
          after: shot,
        }),
        {
          taskId: 'insight-Assert',
          type: 'Insight',
          subType: 'Assert',
          status: 'finished',
          param: { assertion: '屏幕显示主屏' },
          uiContext: { screenshot: shot },
          recorder: [],
        },
      ]),
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      nativeResult,
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/未建模/);
    expect(nativeResult.category).toBe('undefined');
  });

  it('空动作链不发布', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 3, g: 3, b: 3 });
    const shot = makeScreenshot('only-finished', png, 1);
    const result = await promoteExperience({
      callId: 'call-empty',
      dump: makeExecution('exec-empty', [
        {
          taskId: 'done',
          type: 'Action Space',
          subType: 'Finished',
          status: 'finished',
          param: null,
          uiContext: { screenshot: shot },
          recorder: [],
        },
      ]),
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/空/);
  });

  it('未登记 options 使请求不合格，不发布', async () => {
    const { execution } = await makeSupportedChainExecution();
    const result = await promoteExperience({
      callId: 'call-ineligible',
      dump: execution,
      request: promoteRequest({
        options: { deepThink: true },
      }),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/未登记/);
  });

  it('allowSemanticChecks=true 的 v1 策略不发布，避免误放开判断学习', async () => {
    const { execution } = await makeSupportedChainExecution();
    const result = await promoteExperience({
      callId: 'call-policy-semantic',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store: openExperienceStore(root),
      policy: {
        version: ELIGIBILITY_POLICY_VERSION,
        allowSemanticChecks: true,
        allowDynamicOutput: false,
      },
      capturedAt,
    });
    expect(result.result).toBe('skipped');
    if (result.result !== 'skipped') return;
    expect(result.reason).toMatch(/allowSemanticChecks/);
  });
});

describe('Store 发布与幂等（任务 2.4）', () => {
  it('同一 callId 重复学习只产生一次 candidate 修订', async () => {
    const { execution } = await makeSupportedChainExecution();
    const store = openExperienceStore(root);
    const input = {
      callId: 'call-once',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
    };
    const first = await promoteExperience(input);
    const second = await promoteExperience(input);
    expect(first.result).toBe('promoted');
    expect(second.result).toBe('promoted');
    if (first.result !== 'promoted' || second.result !== 'promoted') return;
    expect(second.duplicate).toBe(true);
    expect(second.snapshot.revision).toBe(1);
    expect(second.snapshot.stats.learned).toBe(1);
    expect(first.snapshot.variantId).toBe(second.snapshot.variantId);
  });

  it('裁剪失败返回 failed，Store 中无可查残链', async () => {
    const { execution } = await makeSupportedChainExecution();
    const pipeline: ImagePipeline = {
      version: 'fail-crop',
      decode: (bytes) => defaultImagePipeline.decode(bytes),
      crop: async () => {
        throw new Error('裁剪失败注入');
      },
    };
    const store = openExperienceStore(root);
    const result = await promoteExperience({
      callId: 'call-crop-fail',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
      imagePipeline: pipeline,
    });
    expect(result.result).toBe('failed');
    if (result.result !== 'failed') return;
    expect(result.reason).toMatch(/裁剪失败注入/);
    const key = deriveRequestKey(promoteRequest());
    if (!key.eligible) return;
    const found = await store.findCandidates({
      requestKey: key.requestKey,
      environment: makeEnvironment(),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(0);
  });

  it('索引写盘失败不留下可查询 candidate', async () => {
    const { execution } = await makeSupportedChainExecution();
    const store = openExperienceStore(root, {
      publishIndex: async () => {
        throw new Error('磁盘不可写');
      },
    });
    const result = await promoteExperience({
      callId: 'call-io-fail',
      dump: execution,
      request: promoteRequest(),
      environment: makeEnvironment(),
      source: source(),
      store,
      capturedAt,
    });
    expect(result.result).toBe('failed');
    const readable = openExperienceStore(root);
    const key = deriveRequestKey(promoteRequest());
    if (!key.eligible) return;
    const found = await readable.findCandidates({
      requestKey: key.requestKey,
      environment: makeEnvironment(),
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(0);
  });
});

describe('中途回退入口绑定（任务 2.5）', () => {
  it('入口 A 与中途入口 B 形成不同 Variant，后缀不冒充 A 的完整链', async () => {
    const store = openExperienceStore(root);
    const request = promoteRequest();
    const environment = makeEnvironment();
    const key = deriveRequestKey(request);
    expect(key.eligible).toBe(true);
    if (!key.eligible) return;

    const entryA = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 255, g: 0, b: 0 });
    const entryB = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 0, g: 0, b: 255 });
    const terminal = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 0, g: 255, b: 0 });

    const dumpFor = (executionId: string, entry: Uint8Array) =>
      makeExecution(executionId, [
        makeActionTask({
          taskId: 'home',
          subType: 'AndroidHomeButton',
          before: makeScreenshot(`entry-${executionId}`, entry, 1),
          after: makeScreenshot(`term-${executionId}`, terminal, 2),
        }),
      ]);

    const fromA = await promoteExperience({
      callId: 'call-entry-a',
      dump: dumpFor('exec-a', entryA),
      request,
      environment,
      source: source(),
      store,
      capturedAt,
    });
    const fromB = await promoteExperience({
      callId: 'call-entry-b',
      dump: dumpFor('exec-b', entryB),
      request,
      environment,
      source: { ...source(), stepPath: 'steps[2]' },
      store,
      capturedAt,
    });
    expect(fromA.result).toBe('promoted');
    expect(fromB.result).toBe('promoted');
    if (fromA.result !== 'promoted' || fromB.result !== 'promoted') return;
    expect(fromA.snapshot.variantId).not.toBe(fromB.snapshot.variantId);

    const found = await store.findCandidates({
      requestKey: key.requestKey,
      environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(2);
    const digestA = found.value.find((chain) => chain.variantId === fromA.snapshot.variantId)
      ?.entryEvidence.screenshot.asset.digest;
    const digestB = found.value.find((chain) => chain.variantId === fromB.snapshot.variantId)
      ?.entryEvidence.screenshot.asset.digest;
    expect(digestA).toBeTruthy();
    expect(digestB).toBeTruthy();
    expect(digestA).not.toBe(digestB);
    expect(found.value.every((chain) => chain.actions[0]?.type === 'Home')).toBe(true);
  });
});
