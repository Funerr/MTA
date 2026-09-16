import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultImagePipeline } from '../../src/experience/promotion/image';
import { FROZEN_MATCHER_CONFIG } from '../../src/experience/matcher/config';
import { matchScreen, matchTarget } from '../../src/experience/matcher/match';
import {
  cropGray,
  decodePngFrame,
  hamming64,
  perceptualHash,
  prepareTemplate,
  ssimGray,
  znccAt,
} from '../../src/experience/matcher/image-ops';
import { searchTargetPeaks } from '../../src/experience/matcher/target';
import { centerInside } from '../../src/experience/matcher/geometry';
import type { LocalOcrEngine, MatcherConfig, VisualMatchResult } from '../../src/experience/matcher/types';
import { makeSolidPng } from '../helpers/promotion-png';
import {
  FIXTURE_ROOT,
  STATUS_BAR_MASK,
  buildManifest,
  buildVisualMatcherFixtures,
  fixtureKey,
  persistVisualMatcherFixtures,
  toMatchTargetInput,
  type FixtureCase,
} from '../helpers/visual-matcher-fixtures';

function executableBox(result: VisualMatchResult) {
  return result.decision === 'match' ? result.targetBox : undefined;
}

describe('本地图像依赖（任务 1.1）', () => {
  it('sharp 管线可解码、裁剪并做本地比较，且不发起网络请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const png = await makeSolidPng(64, 48, { r: 12, g: 34, b: 56 });
    const decoded = await defaultImagePipeline.decode(png);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(48);
    const cropped = await defaultImagePipeline.crop(png, {
      x: 8,
      y: 8,
      width: 16,
      height: 10,
    });
    const cropDecoded = await defaultImagePipeline.decode(cropped);
    expect(cropDecoded.width).toBe(16);
    expect(cropDecoded.height).toBe(10);
    const frame = await decodePngFrame(png, '样本', {
      maxBytes: 1_000_000,
      maxPixels: 100_000,
    });
    const hash = perceptualHash(frame.gray, 64, 48);
    expect(hamming64(hash, hash)).toBe(0);
    const patch = cropGray(frame.gray, 64, 48, { x: 0, y: 0, width: 8, height: 8 });
    const template = prepareTemplate(patch, 8, 8);
    expect(znccAt(frame.gray, 64, template, 0, 0)).toBe(1);
    expect(ssimGray(frame.gray, frame.gray)).toBeGreaterThan(0.99);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(defaultImagePipeline.version).toBe('png-sharp@1');
    vi.unstubAllGlobals();
  });
});

const fixturesPromise = buildVisualMatcherFixtures();

describe('标注夹具（任务 1.2）', () => {
  let cases: FixtureCase[] = [];

  beforeAll(async () => {
    ({ cases } = await fixturesPromise);
    await persistVisualMatcherFixtures(FIXTURE_ROOT, { cases });
  });

  it('按原始捕获分组，覆盖原图、位移、相似图标、移除、状态、遮挡和结构变化', async () => {
    const manifest = buildManifest(cases);
    expect(manifest.captures.map((item) => item.id).sort()).toEqual([
      'cal-icon',
      'cal-row',
      'val-icon',
      'val-row',
    ]);
    for (const capture of manifest.captures) {
      const ids = capture.cases.map((item) => item.id);
      expect(ids).toEqual(expect.arrayContaining([
        'original',
        'shift-x-p1',
        'shift-x-m1',
        'shift-y-p1',
        'shift-y-m1',
        'shift-x-p3',
        'shift-x-m3',
        'shift-y-p3',
        'shift-y-m3',
        'other-page-same-icon',
        'target-removed',
        'occluded',
        'structural-change',
      ]));
      if (capture.kind === 'row') expect(ids).toContain('state-inverted');
      if (capture.kind === 'icon') expect(ids).toContain('ambiguous-duplicate');
      expect(new Set(capture.cases.map((item) => item.expect)).size).toBeGreaterThan(1);
    }
    const summary = await fs.readFile(path.join(FIXTURE_ROOT, 'summary.md'), 'utf8');
    expect(summary).toContain('同一原始捕获的全部变体进入同一组');
    const original = await fs.readFile(path.join(FIXTURE_ROOT, 'png/cal-row/original.png'));
    expect(original.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});

describe('本地匹配（任务 2.1–2.5）', () => {
  let cases: FixtureCase[] = [];

  beforeAll(async () => {
    ({ cases } = await fixturesPromise);
    await persistVisualMatcherFixtures(FIXTURE_ROOT, { cases });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function find(captureId: string, caseId: string): FixtureCase {
    const found = cases.find((item) => item.captureId === captureId && item.caseId === caseId);
    if (!found) throw new Error(`missing fixture ${captureId}/${caseId}`);
    return found;
  }

  it('环境不兼容、不同页同图标、掩码掩盖目标均拒绝（任务 2.1）', async () => {
    const original = find('cal-row', 'original');
    const otherPage = find('cal-row', 'other-page-same-icon');

    const env = await matchTarget({
      ...toMatchTargetInput(original),
      currentEnvironment: { ...original.environment, theme: 'dark' },
    });
    expect(env.decision).toBe('no-match');
    if (env.decision === 'no-match') expect(env.code).toBe('environment-incompatible');
    expect(executableBox(env)).toBeUndefined();

    const page = await matchTarget(toMatchTargetInput(otherPage));
    expect(page.decision).toBe('no-match');
    if (page.decision === 'no-match') expect(page.code).toBe('page-mismatch');
    expect(executableBox(page)).toBeUndefined();

    const screen = await matchScreen({
      currentScreenshot: otherPage.currentPng,
      currentEnvironment: otherPage.environment,
      historicalScreenshot: otherPage.historicalPng,
      historicalEnvironment: otherPage.environment,
      masks: [STATUS_BAR_MASK],
    });
    expect(screen.decision).toBe('no-match');

    const masked = await matchTarget({
      ...toMatchTargetInput(original),
      masks: [STATUS_BAR_MASK, original.bbox],
    });
    expect(masked.decision).toBe('no-match');
    if (masked.decision === 'no-match') expect(masked.code).toBe('mask-covers-target');
    expect(executableBox(masked)).toBeUndefined();
  });

  it('单项高分不能掩盖页面失败：不同页同图标的模板分仍高（任务 2.1 / 2.3）', async () => {
    const otherPage = find('cal-icon', 'other-page-same-icon');
    const result = await matchTarget(toMatchTargetInput(otherPage));
    expect(result.decision).toBe('no-match');
    if (result.decision !== 'no-match') throw new Error('expected no-match');
    expect(result.code).toBe('page-mismatch');
    expect(executableBox(result)).toBeUndefined();

    const limits = {
      maxBytes: FROZEN_MATCHER_CONFIG.maxImageBytes,
      maxPixels: FROZEN_MATCHER_CONFIG.maxImagePixels,
    };
    const current = await decodePngFrame(otherPage.currentPng, '当前', limits);
    const target = await decodePngFrame(otherPage.targetPng, '模板', limits);
    const { peaks } = searchTargetPeaks(current, target, otherPage.bbox, FROZEN_MATCHER_CONFIG);
    expect(peaks[0]?.score ?? 0).toBeGreaterThanOrEqual(FROZEN_MATCHER_CONFIG.targetNccMin);
  });

  it('位移正例中心落入标注框且不返回历史坐标（任务 2.2）', async () => {
    const shifted = find('val-icon', 'shift-x-p3');
    const result = await matchTarget(toMatchTargetInput(shifted));
    expect(result.decision).toBe('match');
    if (result.decision !== 'match') throw new Error('expected match');
    expect(result.targetBox).not.toEqual(shifted.bbox);
    expect(centerInside( {
      x: result.targetBox.x + result.targetBox.width / 2,
      y: result.targetBox.y + result.targetBox.height / 2,
    }, shifted.expectedBox)).toBe(true);
    expect(result.targetBox).toEqual(shifted.expectedBox);
  });

  it('重复目标、状态反转均拒绝（任务 2.3）', async () => {
    const duplicate = find('cal-icon', 'ambiguous-duplicate');
    const ambiguous = await matchTarget(toMatchTargetInput(duplicate));
    expect(ambiguous.decision).toBe('no-match');
    if (ambiguous.decision === 'no-match') expect(ambiguous.code).toBe('ambiguous');
    expect(executableBox(ambiguous)).toBeUndefined();

    const inverted = find('cal-row', 'state-inverted');
    const state = await matchTarget(toMatchTargetInput(inverted));
    expect(state.decision).toBe('no-match');
    if (state.decision === 'no-match') expect(state.code).toBe('state-mismatch');
    expect(executableBox(state)).toBeUndefined();
  });

  it('OCR 默认关闭；开启后文本不符拒绝且无网络调用（任务 2.4）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const original = find('cal-row', 'original');
    const defaulted = await matchTarget(toMatchTargetInput(original));
    expect(defaulted.decision).toBe('match');
    if (defaulted.decision === 'match') {
      expect(defaulted.scores.text.skipped).toBe(true);
    }

    const enabled: MatcherConfig = { ...FROZEN_MATCHER_CONFIG, ocrEnabled: true };
    const missing = await matchTarget({ ...toMatchTargetInput(original), config: enabled });
    expect(missing.decision).toBe('error');
    if (missing.decision === 'error') expect(missing.code).toBe('ocr-unavailable');

    const engine: LocalOcrEngine = {
      modelVersion: 'fixture-ocr@1',
      languagePackVersion: 'zh-fixture@1',
      async recognize() {
        return { text: '完全不同的文字' };
      },
    };
    const mismatched = await matchTarget({
      ...toMatchTargetInput(original),
      config: enabled,
      ocrEngine: engine,
    });
    expect(mismatched.decision).toBe('no-match');
    if (mismatched.decision === 'no-match') expect(mismatched.code).toBe('text-mismatch');
    expect(executableBox(mismatched)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('坏图、非法配置和搜索上界不产生可执行坐标（任务 2.5）', async () => {
    const original = find('cal-row', 'original');
    const badImage = await matchTarget({
      ...toMatchTargetInput(original),
      currentScreenshot: Uint8Array.of(1, 2, 3, 4, 5),
    });
    expect(badImage.decision).toBe('error');
    if (badImage.decision === 'error') expect(badImage.code).toBe('invalid-image');
    expect(executableBox(badImage)).toBeUndefined();

    const badConfig = await matchTarget({
      ...toMatchTargetInput(original),
      config: { ...FROZEN_MATCHER_CONFIG, targetNccMin: 1.5 },
    });
    expect(badConfig.decision).toBe('error');
    if (badConfig.decision === 'error') expect(badConfig.code).toBe('invalid-config');

    const bounded = await matchTarget({
      ...toMatchTargetInput(original),
      config: { ...FROZEN_MATCHER_CONFIG, maxSearchPositions: 1 },
    });
    expect(bounded.decision).toBe('error');
    if (bounded.decision === 'error') expect(bounded.code).toBe('resource-limit');
    expect(executableBox(bounded)).toBeUndefined();
  });
});

describe('冻结验证（任务 3.1 / 3.2）', () => {
  let cases: FixtureCase[] = [];

  beforeAll(async () => {
    ({ cases } = await fixturesPromise);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('验证集全部声明正例定位正确，全部负例零错误接受', async () => {
    const calibration = cases.filter((item) => item.group === 'calibration');
    const validation = cases.filter((item) => item.group === 'validation');
    const results: Array<{
      key: string;
      expect: string;
      decision: string;
      code?: string;
    }> = [];
    let minTarget = 1;
    let minContext = 1;
    let minScreen = 1;
    for (const fixture of calibration.filter((item) => item.expect === 'accept')) {
      const result = await matchTarget(toMatchTargetInput(fixture));
      expect(result.decision, fixtureKey(fixture)).toBe('match');
      if (result.decision === 'match') {
        minTarget = Math.min(minTarget, result.scores.target.value);
        minContext = Math.min(minContext, result.scores.context.value);
        minScreen = Math.min(minScreen, result.scores.screen.value);
      }
    }
    expect(minTarget).toBeGreaterThanOrEqual(FROZEN_MATCHER_CONFIG.targetNccMin);
    expect(minContext).toBeGreaterThanOrEqual(FROZEN_MATCHER_CONFIG.contextSsimMin);
    expect(minScreen).toBeGreaterThanOrEqual(1 - FROZEN_MATCHER_CONFIG.screenPHashMaxHamming / 64);

    for (const fixture of validation) {
      const result = await matchTarget(toMatchTargetInput(fixture));
      results.push({
        key: fixtureKey(fixture),
        expect: fixture.expect,
        decision: result.decision,
        code: result.decision === 'no-match' || result.decision === 'error' ? result.code : undefined,
      });
      if (fixture.expect === 'accept') {
        expect(result.decision, fixtureKey(fixture)).toBe('match');
        if (result.decision === 'match') {
          expect(
            centerInside(
              {
                x: result.targetBox.x + result.targetBox.width / 2,
                y: result.targetBox.y + result.targetBox.height / 2,
              },
              fixture.expectedBox,
            ),
            fixtureKey(fixture),
          ).toBe(true);
        }
      } else {
        expect(result.decision, fixtureKey(fixture)).not.toBe('match');
        expect(executableBox(result), fixtureKey(fixture)).toBeUndefined();
      }
    }
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.writeFile(
      path.join(FIXTURE_ROOT, 'calibration-lock.json'),
      `${JSON.stringify(
        {
          configVersion: FROZEN_MATCHER_CONFIG.version,
          dataVersion: 'visual-matcher-fixtures@1',
          frozen: {
            searchRadiusRatio: FROZEN_MATCHER_CONFIG.searchRadiusRatio,
            screenPHashMaxHamming: FROZEN_MATCHER_CONFIG.screenPHashMaxHamming,
            targetNccMin: FROZEN_MATCHER_CONFIG.targetNccMin,
            contextSsimMin: FROZEN_MATCHER_CONFIG.contextSsimMin,
            stateSsimMin: FROZEN_MATCHER_CONFIG.stateSsimMin,
            ambiguityGapMin: FROZEN_MATCHER_CONFIG.ambiguityGapMin,
            nmsRadiusPx: FROZEN_MATCHER_CONFIG.nmsRadiusPx,
            ocrEnabled: FROZEN_MATCHER_CONFIG.ocrEnabled,
          },
          calibrationAcceptMins: {
            targetNcc: minTarget,
            contextSsim: minContext,
            screenSimilarity: minScreen,
          },
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(FIXTURE_ROOT, 'validation-results.json'),
      `${JSON.stringify(
        {
          configVersion: FROZEN_MATCHER_CONFIG.version,
          dataVersion: 'visual-matcher-fixtures@1',
          results,
        },
        null,
        2,
      )}\n`,
    );
  });

  it('相同输入重复匹配决策与坐标一致，且无模型/网络/设备动作', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const fixture = cases.find((item) => item.captureId === 'val-row' && item.caseId === 'shift-y-p1');
    if (!fixture) throw new Error('missing val-row/shift-y-p1');
    const first = await matchTarget(toMatchTargetInput(fixture));
    const second = await matchTarget(toMatchTargetInput(fixture));
    expect(first.decision).toBe('match');
    expect(second.decision).toBe('match');
    if (first.decision === 'match' && second.decision === 'match') {
      expect(first.scores).toEqual(second.scores);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.timingMs).toBeGreaterThanOrEqual(0);
    expect(second.timingMs).toBeGreaterThanOrEqual(0);
  });

  it('matcher 实现不导入 Midscene、不使用 fetch、不触发设备动作', async () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/experience/matcher');
    const files = await fs.readdir(dir);
    const sources = await Promise.all(
      files.filter((name) => name.endsWith('.ts')).map((name) => fs.readFile(path.join(dir, name), 'utf8')),
    );
    const joined = sources.join('\n');
    expect(joined).not.toMatch(/@midscene/);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/AndroidDevice|HarmonyDevice|agentFromAdbDevice/);
  });
});
