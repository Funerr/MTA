import type {
  AssetRef,
  ImageSignature,
  ScreenEvidence,
} from '../../src/experience/schema/assets';
import { computeAssetDigest } from '../../src/experience/schema/assets';
import type { ExperienceAction } from '../../src/experience/schema/action';
import type { VariantRevision, ExperienceVariant } from '../../src/experience/schema/variant';
import type { Experience, ExperienceSource } from '../../src/experience/schema/experience';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';
import { computeEnvironmentFingerprint } from '../../src/experience/schema/environment';
import {
  computeEntryFingerprint,
  computeVariantId,
} from '../../src/experience/schema/variant';

/** 由种子确定性生成图片字节（含 PNG 魔数头，内容互不相同）。 */
export function makeImageBytes(seed: string, size = 96): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  for (let i = 8; i < size; i += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[i] = (state >>> 16) & 0xff;
  }
  return bytes;
}

/** 收集夹具产生的全部图片字节，供 Store 发布与摘要核对复用。 */
export class FixtureImageBag {
  readonly images = new Map<string, Uint8Array>();

  evidence(seed: string, width: number, height: number): ScreenEvidence {
    const bytes = makeImageBytes(seed);
    const digest = computeAssetDigest(bytes);
    this.images.set(digest, bytes);
    return {
      screenshot: {
        asset: { digest, byteSize: bytes.byteLength, mimeType: 'image/png' },
        width,
        height,
      },
      signature: makeSignature(seed),
    };
  }
}

export function makeSignature(seed: string): ImageSignature {
  return {
    algorithm: 'fixture-signature',
    version: '1',
    params: { seed },
    value: `sig:${seed}`,
  };
}

export function makeEnvironment(
  overrides: Partial<ExperienceEnvironment> = {},
): ExperienceEnvironment {
  return {
    platform: 'android',
    model: 'Pixel 8',
    systemBuild: 'AP4A.250105.002',
    resolution: { width: 1080, height: 2400 },
    orientation: 'portrait',
    language: 'zh-CN',
    theme: 'light',
    executionCompatVersion: 'midscene@1.12.7+adapter@1',
    ...overrides,
  };
}

export function makeSource(
  overrides: Partial<ExperienceSource> = {},
): ExperienceSource {
  return {
    casePath: 'cases/settings.yaml',
    caseName: 'settings-display',
    stepPath: 'steps[2]',
    node: 'aiAct',
    prompt: '打开显示设置',
    callId: 'call-0001',
    midsceneVersion: '1.12.7',
    adapterVersion: 'trace-adapter@1',
    capturedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 2400;

/** 构造一个带目标证据的合法动作公共部分。 */
function baseAction(
  bag: FixtureImageBag,
  seedPrefix: string,
  targetBox: { x: number; y: number; width: number; height: number },
) {
  const before = bag.evidence(`${seedPrefix}:before`, SCREEN_WIDTH, SCREEN_HEIGHT);
  const after = bag.evidence(`${seedPrefix}:after`, SCREEN_WIDTH, SCREEN_HEIGHT);
  const target = {
    image: bag.evidence(
      `${seedPrefix}:target`,
      targetBox.width,
      targetBox.height,
    ).screenshot,
    contextImage: bag.evidence(
      `${seedPrefix}:context`,
      targetBox.width * 2,
      targetBox.height * 2,
    ).screenshot,
    bbox: { ...targetBox },
    textHint: `目标-${seedPrefix}`,
    stateBefore: bag.evidence(
      `${seedPrefix}:state`,
      targetBox.width,
      targetBox.height,
    ).screenshot,
  };
  return { before, after, target };
}

/** 覆盖全部六种动作类型的完整合法动作链。 */
export function makeFullActionChain(bag: FixtureImageBag): ExperienceAction[] {
  const tap = baseAction(bag, 'tap1', { x: 120, y: 400, width: 200, height: 96 });
  const input = baseAction(bag, 'input1', { x: 100, y: 800, width: 880, height: 120 });
  const scroll = baseAction(bag, 'scroll1', { x: 0, y: 1500, width: 1080, height: 600 });
  const longPress = baseAction(bag, 'long1', { x: 400, y: 1000, width: 280, height: 140 });

  return [
    { type: 'Tap', before: tap.before, after: tap.after, target: tap.target },
    {
      type: 'Input',
      before: input.before,
      after: input.after,
      target: input.target,
      params: { text: '亮度 80%', mode: 'replace' },
    },
    {
      type: 'Scroll',
      before: scroll.before,
      after: scroll.after,
      target: scroll.target,
      params: { direction: 'down', distancePx: 640, anchor: { x: 540, y: 1800 } },
    },
    {
      type: 'LongPress',
      before: longPress.before,
      after: longPress.after,
      target: longPress.target,
      params: { durationMs: 800 },
    },
    {
      type: 'Back',
      before: bag.evidence('back:before', SCREEN_WIDTH, SCREEN_HEIGHT),
      after: bag.evidence('back:after', SCREEN_WIDTH, SCREEN_HEIGHT),
    },
    {
      type: 'Home',
      before: bag.evidence('home:before', SCREEN_WIDTH, SCREEN_HEIGHT),
      after: bag.evidence('home:after', SCREEN_WIDTH, SCREEN_HEIGHT),
    },
  ];
}

export function makeRevision(
  bag: FixtureImageBag,
  overrides: Partial<VariantRevision> & { entrySeed?: string } = {},
): VariantRevision {
  const { entrySeed, ...rest } = overrides;
  return {
    revision: 1,
    status: 'candidate',
    entryEvidence: bag.evidence(entrySeed ?? 'entry', SCREEN_WIDTH, SCREEN_HEIGHT),
    terminalEvidence: bag.evidence('terminal', SCREEN_WIDTH, SCREEN_HEIGHT),
    actions: makeFullActionChain(bag),
    eligibilityPolicyVersion: 'policy@1',
    nativeResult: { category: 'undefined' },
    evidenceComplete: true,
    learnedAt: '2026-09-15T10:05:00.000Z',
    stats: { learned: 1, replaySuccess: 0, replayFailure: 0 },
    ...rest,
  };
}

/** 构造合法 Variant：指纹与 variantId 均按真实算法派生。 */
export function makeVariant(
  bag: FixtureImageBag,
  options: {
    environment?: ExperienceEnvironment;
    entrySeed?: string;
    revisions?: VariantRevision[];
  } = {},
): ExperienceVariant {
  const environment = options.environment ?? makeEnvironment();
  const revision =
    options.revisions?.[0] ?? makeRevision(bag, { entrySeed: options.entrySeed });
  const environmentFingerprint = computeEnvironmentFingerprint(environment);
  const entryFingerprint = computeEntryFingerprint(revision.entryEvidence);
  return {
    variantId: computeVariantId(environmentFingerprint, entryFingerprint),
    environment,
    environmentFingerprint,
    entryFingerprint,
    revisions: options.revisions ?? [revision],
  };
}

export function makeExperience(
  bag: FixtureImageBag,
  overrides: Partial<Experience> = {},
): Experience {
  const requestKey = 'a'.repeat(64);
  return {
    schemaVersion: 1,
    requestKey,
    source: makeSource(),
    createdAt: '2026-09-15T10:05:00.000Z',
    updatedAt: '2026-09-15T10:05:00.000Z',
    variants: [makeVariant(bag)],
    ...overrides,
  };
}
