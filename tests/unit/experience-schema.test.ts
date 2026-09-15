import { describe, expect, it } from 'vitest';
import {
  checkSchemaVersionSupport,
  validateExperienceAsset,
} from '../../src/experience/schema/experience';
import { validateActionChain } from '../../src/experience/schema/action';
import {
  FixtureImageBag,
  makeExperience,
  makeRevision,
  makeVariant,
} from '../helpers/experience-fixtures';

describe('完整视觉资产（任务 1.2）', () => {
  it('覆盖全部六种动作类型的完整链通过校验，且 JSON 往返保持一致', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 序列化往返：字段与动作顺序保持一致
    const roundTripped = JSON.parse(JSON.stringify(result.value));
    const secondPass = validateExperienceAsset(roundTripped);
    expect(secondPass.ok).toBe(true);
    if (secondPass.ok) {
      expect(secondPass.value.variants[0].revisions[0].actions.map((a) => a.type)).toEqual([
        'Tap',
        'Input',
        'Scroll',
        'LongPress',
        'Back',
        'Home',
      ]);
      expect(secondPass.value).toEqual(result.value);
    }
  });

  it('有目标动作缺失目标图被拒绝并给出具体原因', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const action = experience.variants[0].revisions[0].actions[0];
    expect(action.type).toBe('Tap');
    delete (action as { target?: unknown }).target;

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toMatch(/target/i);
  });

  it('动作缺少操作前/后截图被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const action = experience.variants[0].revisions[0].actions[0] as {
      before?: unknown;
      after?: unknown;
    };
    delete action.before;

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toMatch(/before/);
  });

  it('Input 缺少必要参数（text）被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const inputAction = experience.variants[0].revisions[0].actions[1];
    expect(inputAction.type).toBe('Input');
    delete (inputAction as { params?: unknown }).params;

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toMatch(/params/);
  });

  it('目标 bbox 越出操作前截图范围被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const tap = experience.variants[0].revisions[0].actions[0];
    if (tap.type !== 'Tap') throw new Error('夹具动作顺序不符');
    // 前截图为 1080x2400，把 bbox 推出右边界
    tap.target.bbox = { x: 1000, y: 100, width: 200, height: 96 };

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('越出操作前截图范围');
  });

  it('目标图尺寸与原始目标框不一致被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const tap = experience.variants[0].revisions[0].actions[0];
    if (tap.type !== 'Tap') throw new Error('夹具动作顺序不符');
    tap.target.image = {
      ...tap.target.image,
      width: tap.target.bbox.width + 10,
    };

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('与原始目标框');
  });

  it('滚动锚点越界被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const scroll = experience.variants[0].revisions[0].actions[2];
    if (scroll.type !== 'Scroll') throw new Error('夹具动作顺序不符');
    scroll.params.anchor = { x: 5000, y: 1800 };

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('滚动锚点');
  });

  it('未知动作类型（VisualTap）被拒绝，不静默丢弃后接受残余链', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const chain = experience.variants[0].revisions[0].actions;
    chain.splice(2, 1, {
      type: 'VisualTap',
      x: 1,
      y: 2,
    } as unknown as (typeof chain)[number]);

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    // 其余五个动作依然存在，但整链被拒绝而不是部分接受
    if (result.ok) return;
    expect(chain.length).toBe(6);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('动作携带未声明字段被严格拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    const tap = experience.variants[0].revisions[0].actions[0] as Record<string, unknown>;
    tap.extraField = 'not allowed';

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toMatch(/extraField|Unrecognized/i);
  });

  it('空动作链被拒绝', () => {
    const bag = new FixtureImageBag();
    const reasons = validateActionChain([]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('动作链为空');

    const experience = makeExperience(bag, {
      variants: [
        makeVariant(bag, { revisions: [makeRevision(bag, { actions: [] })] }),
      ],
    });
    expect(validateExperienceAsset(experience).ok).toBe(false);
  });

  it('不支持的 schemaVersion 被识别为版本问题而不是资产损坏', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);

    const future = { ...experience, schemaVersion: 2 };
    expect(checkSchemaVersionSupport(future)).toEqual({
      supported: false,
      foundVersion: '2',
    });
    expect(validateExperienceAsset(future).ok).toBe(false);

    const missing = { ...experience } as { schemaVersion?: unknown };
    delete missing.schemaVersion;
    expect(checkSchemaVersionSupport(missing).supported).toBe(false);
  });

  it('variantId 与派生指纹不匹配（篡改/错绑）被语义校验拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag);
    experience.variants[0].variantId = 'b'.repeat(64);

    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('variantId');
  });

  it('stale 修订缺少失效原因被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag, {
      variants: [
        makeVariant(bag, {
          revisions: [makeRevision(bag, { status: 'stale' })],
        }),
      ],
    });
    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('失效原因');
  });

  it('修订号不连续被拒绝', () => {
    const bag = new FixtureImageBag();
    const experience = makeExperience(bag, {
      variants: [
        makeVariant(bag, {
          revisions: [makeRevision(bag, { revision: 2 })],
        }),
      ],
    });
    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('连续递增');
  });

  it('同一 Experience 内 variantId 重复被拒绝', () => {
    const bag = new FixtureImageBag();
    const variant = makeVariant(bag);
    const experience = makeExperience(bag, {
      variants: [variant, structuredClone(variant)],
    });
    const result = validateExperienceAsset(experience);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join('\n')).toContain('重复');
  });
});
