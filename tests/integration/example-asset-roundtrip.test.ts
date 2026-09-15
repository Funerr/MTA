import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import { validateExperienceAsset } from '../../src/experience/schema/experience';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'experience-example',
);

/** docs/experience-assets.md 记录的示例取值；测试即文档一致性证明。 */
const documented = {
  requestKey: 'c033e63e04a6fdb5d279136901741e2af50adda310d573fd41de7bfc308961da',
  variantId: '4e0481901b59239858e05c7f05cb76e4269e404611db08efb239bbb435c540e6',
  request: {
    caseIdentity: { casePath: 'cases/settings.yaml', caseName: 'settings-display' },
    stepPath: 'steps[2]',
    node: 'aiAct',
    prompt: '打开显示设置',
    eligibilityPolicyVersion: 'policy@1',
  },
  environment: {
    platform: 'android',
    model: 'Pixel 8',
    systemBuild: 'AP4A.250105.002',
    resolution: { width: 1080, height: 2400 },
    orientation: 'portrait',
    language: 'zh-CN',
    theme: 'light',
    executionCompatVersion: 'midscene@1.12.7+adapter@1',
  } satisfies ExperienceEnvironment,
  callId: 'call-20260915-0001',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('示例资产往返与文档一致性（任务 3.2）', () => {
  it('记录的请求派生出文档中的 requestKey', () => {
    const outcome = deriveRequestKey(documented.request);
    expect(outcome.eligible).toBe(true);
    if (outcome.eligible) {
      expect(outcome.requestKey).toBe(documented.requestKey);
    }
  });

  it('示例 Store 可读取：命中唯一候选且字段与文档一致', async () => {
    const store = openExperienceStore(fixtureRoot);
    const found = await store.findCandidates({
      requestKey: documented.requestKey,
      environment: documented.environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    const chain = found.value[0];

    expect(chain.variantId).toBe(documented.variantId);
    expect(chain.revision).toBe(1);
    expect(chain.status).toBe('candidate');
    expect(chain.eligibilityPolicyVersion).toBe('policy@1');
    expect(chain.nativeResult).toEqual({ category: 'undefined' });
    expect(chain.source).toMatchObject({
      casePath: 'cases/settings.yaml',
      caseName: 'settings-display',
      stepPath: 'steps[2]',
      node: 'aiAct',
      prompt: '打开显示设置',
      callId: documented.callId,
      midsceneVersion: '1.12.7',
    });
    expect(chain.actions.map((action) => action.type)).toEqual([
      'Tap',
      'Input',
      'Scroll',
      'Home',
    ]);
    const input = chain.actions[1];
    if (input.type === 'Input') {
      expect(input.params).toEqual({ text: '显示', mode: 'append' });
    } else {
      throw new Error('动作顺序与文档不符');
    }
    const scroll = chain.actions[2];
    if (scroll.type === 'Scroll') {
      expect(scroll.params).toEqual({
        direction: 'down',
        distancePx: 640,
        anchor: { x: 540, y: 1800 },
      });
    } else {
      throw new Error('动作顺序与文档不符');
    }
  });

  it('索引中的原始 Experience 通过完整校验', async () => {
    const raw = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, 'index.json'), 'utf8'),
    );
    expect(raw.experiences).toHaveLength(1);
    const validation = validateExperienceAsset(raw.experiences[0]);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.value.requestKey).toBe(documented.requestKey);
    }
  });

  it('入口/终态与每个动作的取证图片均可读取、为 PNG 且通过摘要校验', async () => {
    const store = openExperienceStore(fixtureRoot);
    const found = await store.findCandidates({
      requestKey: documented.requestKey,
      environment: documented.environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const chain = found.value[0];

    const expectReadable = async (digest: string, byteSize: number, label: string) => {
      const bytes = await store.readAssetImage({
        digest,
        byteSize,
        mimeType: 'image/png',
      });
      expect(bytes.ok, label).toBe(true);
      if (!bytes.ok) return;
      expect([...bytes.value.slice(0, 8)], label).toEqual(PNG_SIGNATURE);
    };

    await expectReadable(
      chain.entryEvidence.screenshot.asset.digest,
      chain.entryEvidence.screenshot.asset.byteSize,
      'entry',
    );
    await expectReadable(
      chain.terminalEvidence.screenshot.asset.digest,
      chain.terminalEvidence.screenshot.asset.byteSize,
      'terminal',
    );
    for (const [index, action] of chain.actions.entries()) {
      await expectReadable(
        action.before.screenshot.asset.digest,
        action.before.screenshot.asset.byteSize,
        `actions[${index}].before`,
      );
      await expectReadable(
        action.after.screenshot.asset.digest,
        action.after.screenshot.asset.byteSize,
        `actions[${index}].after`,
      );
      if ('target' in action && action.target) {
        await expectReadable(
          action.target.image.asset.digest,
          action.target.image.asset.byteSize,
          `actions[${index}].target`,
        );
        await expectReadable(
          action.target.contextImage.asset.digest,
          action.target.contextImage.asset.byteSize,
          `actions[${index}].contextImage`,
        );
      }
    }
  });

  it('环境变化后示例不可命中（隔离语义对示例同样成立）', async () => {
    const store = openExperienceStore(fixtureRoot);
    const found = await store.findCandidates({
      requestKey: documented.requestKey,
      environment: { ...documented.environment, theme: 'dark' },
    });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toEqual([]);
  });
});
