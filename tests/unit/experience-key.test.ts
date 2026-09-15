import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_PARAM_REGISTRY,
  deriveRequestKey,
  normalizeLogicalNode,
  type RequestKeySource,
} from '../../src/experience/schema/request-key';
import {
  computeEnvironmentFingerprint,
  environmentSchema,
  isSameEnvironment,
} from '../../src/experience/schema/environment';
import { makeEnvironment } from '../helpers/experience-fixtures';
import { FixtureImageBag, makeExperience, makeVariant } from '../helpers/experience-fixtures';
import { validateExperienceAsset } from '../../src/experience/schema/experience';

const registry = { optionKeys: ['speed'], contextKeys: ['app', 'locale'] };

function makeSource(overrides: Partial<RequestKeySource> = {}): RequestKeySource {
  return {
    caseIdentity: { casePath: 'cases/settings.yaml', caseName: 'settings-display' },
    stepPath: 'steps[2]',
    node: 'aiAct',
    prompt: '打开显示设置',
    options: {},
    context: { app: 'com.android.settings', locale: 'zh-CN' },
    eligibilityPolicyVersion: 'policy@1',
    ...overrides,
  };
}

describe('请求 Key（任务 1.3）', () => {
  it('相同请求稳定派生相同 Key', () => {
    const first = deriveRequestKey(makeSource(), registry);
    const second = deriveRequestKey(makeSource(), registry);
    expect(first).toEqual(second);
    expect(first.eligible).toBe(true);
    if (first.eligible) expect(first.requestKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('字符串内容不 trim、不改写：尾部空格产生不同 Key', () => {
    const a = deriveRequestKey(makeSource({ prompt: '打开显示设置' }), registry);
    const b = deriveRequestKey(makeSource({ prompt: '打开显示设置 ' }), registry);
    expect(a.eligible).toBe(true);
    expect(b.eligible).toBe(true);
    if (a.eligible && b.eligible) expect(a.requestKey).not.toBe(b.requestKey);
  });

  it('提示词、上下文值、参数值、用例、步骤或策略版本变化均隔离', () => {
    const base = deriveRequestKey(makeSource(), registry);
    expect(base.eligible).toBe(true);
    const variants = [
      makeSource({ prompt: '打开声音设置' }),
      makeSource({ context: { app: 'com.other.app', locale: 'zh-CN' } }),
      makeSource({ context: { app: 'com.android.settings', locale: 'en-US' } }),
      makeSource({ options: { speed: 'fast' } }),
      makeSource({
        caseIdentity: { casePath: 'cases/other.yaml', caseName: 'settings-display' },
      }),
      makeSource({
        caseIdentity: { casePath: 'cases/settings.yaml', caseName: 'settings-other' },
      }),
      makeSource({ stepPath: 'steps[3]' }),
      makeSource({ eligibilityPolicyVersion: 'policy@2' }),
    ];
    for (const variant of variants) {
      const result = deriveRequestKey(variant, registry);
      expect(result.eligible).toBe(true);
      if (base.eligible && result.eligible) {
        expect(result.requestKey).not.toBe(base.requestKey);
      }
    }
  });

  it('experienceAct 与 aiAct 归一化为同一逻辑节点，Key 相同', () => {
    expect(normalizeLogicalNode('experienceAct')).toBe('aiAct');
    expect(normalizeLogicalNode('aiAct')).toBe('aiAct');
    expect(normalizeLogicalNode('aiAssert')).toBeUndefined();

    const a = deriveRequestKey(makeSource({ node: 'aiAct' }), registry);
    const b = deriveRequestKey(makeSource({ node: 'experienceAct' }), registry);
    expect(a.eligible).toBe(true);
    expect(b.eligible).toBe(true);
    if (a.eligible && b.eligible) expect(a.requestKey).toBe(b.requestKey);
  });

  it('未登记逻辑节点使请求不合格', () => {
    const result = deriveRequestKey(makeSource({ node: 'customAct' }), registry);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain('customAct');
  });

  it('未登记 options/context 键不通配：请求不合格并给出具体键名', () => {
    const option = deriveRequestKey(
      makeSource({ options: { screenshotHint: 'x' } }),
      registry,
    );
    expect(option.eligible).toBe(false);
    if (!option.eligible) expect(option.reason).toContain('screenshotHint');

    const context = deriveRequestKey(
      makeSource({ context: { app: 'com.android.settings', unknownKey: 1 } }),
      registry,
    );
    expect(context.eligible).toBe(false);
    if (!context.eligible) expect(context.reason).toContain('unknownKey');
  });

  it('默认登记集合为空：任何 options/context 键都不合格', () => {
    const result = deriveRequestKey(
      makeSource({ context: { app: 'com.android.settings' } }),
      DEFAULT_REQUEST_PARAM_REGISTRY,
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toContain('app');
  });

  it('非纯 JSON 标量值（对象、数组、NaN、图片字节）使请求不合格', () => {
    const cases: Array<RequestKeySource> = [
      makeSource({ options: { speed: { nested: true } } }),
      makeSource({ options: { speed: ['fast'] } }),
      makeSource({ options: { speed: Number.NaN } }),
      makeSource({ options: { speed: new Uint8Array([1, 2, 3]) } }),
    ];
    for (const source of cases) {
      const result = deriveRequestKey(source, registry);
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.reason).toContain('纯 JSON 标量');
    }
  });

  it('空 prompt 或缺失身份字段使请求不合格', () => {
    expect(deriveRequestKey(makeSource({ prompt: '' }), registry).eligible).toBe(false);
    expect(
      deriveRequestKey(
        makeSource({ caseIdentity: { casePath: '', caseName: 'x' } }),
        registry,
      ).eligible,
    ).toBe(false);
    expect(
      deriveRequestKey(makeSource({ eligibilityPolicyVersion: '' }), registry).eligible,
    ).toBe(false);
  });
});

describe('环境指纹（任务 1.3）', () => {
  it('相同环境指纹稳定且判定兼容', () => {
    const a = computeEnvironmentFingerprint(makeEnvironment());
    const b = computeEnvironmentFingerprint(makeEnvironment());
    expect(a).toBe(b);
    expect(isSameEnvironment(makeEnvironment(), makeEnvironment())).toBe(true);
  });

  it('任一必需环境字段变化即不兼容', () => {
    const base = makeEnvironment();
    const variants = [
      makeEnvironment({ model: 'Pixel 8 Pro' }),
      makeEnvironment({ systemBuild: 'AP4A.250105.003' }),
      makeEnvironment({ resolution: { width: 1440, height: 3120 } }),
      makeEnvironment({ orientation: 'landscape' }),
      makeEnvironment({ language: 'en-US' }),
      makeEnvironment({ theme: 'dark' }),
      makeEnvironment({ executionCompatVersion: 'midscene@1.13.0+adapter@1' }),
    ];
    for (const variant of variants) {
      expect(computeEnvironmentFingerprint(variant)).not.toBe(
        computeEnvironmentFingerprint(base),
      );
      expect(isSameEnvironment(base, variant)).toBe(false);
    }
  });

  it('缺失必需字段或携带未知字段均被严格拒绝（不通配）', () => {
    const base = makeEnvironment() as unknown as Record<string, unknown>;
    const missing = { ...base };
    delete missing.theme;
    expect(environmentSchema.safeParse(missing).success).toBe(false);

    const unknown = { ...base, serialNumber: 'ABCD1234' };
    expect(environmentSchema.safeParse(unknown).success).toBe(false);
  });

  it('同一请求的两个入口 Variant 可共存且互不混同', () => {
    const bag = new FixtureImageBag();
    const entryA = makeVariant(bag, { entrySeed: 'entry-a' });
    const entryB = makeVariant(bag, { entrySeed: 'entry-b' });
    expect(entryA.variantId).not.toBe(entryB.variantId);
    expect(entryA.entryFingerprint).not.toBe(entryB.entryFingerprint);

    const experience = makeExperience(bag, { variants: [entryA, entryB] });
    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.variants).toHaveLength(2);
  });
});
