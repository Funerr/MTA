import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  openExperienceStore,
  type PublishCandidateInput,
} from '../../src/experience/store/experience-store';
import { INDEX_FORMAT } from '../../src/experience/store/index-file';
import {
  FixtureImageBag,
  makeEnvironment,
  makeRevision,
  makeSource,
} from '../helpers/experience-fixtures';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-experience-errors-'));
});

afterEach(async () => {
  await fs.chmod(root, 0o755).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

function publishInput(options: { eventId: string }): PublishCandidateInput {
  const bag = new FixtureImageBag();
  const revision = makeRevision(bag, { entrySeed: 'entry' });
  return {
    eventId: options.eventId,
    requestKey: 'a'.repeat(64),
    source: makeSource(),
    environment: makeEnvironment(),
    variant: {
      entryEvidence: revision.entryEvidence,
      terminalEvidence: revision.terminalEvidence,
      actions: revision.actions,
      eligibilityPolicyVersion: revision.eligibilityPolicyVersion,
    },
    images: bag.images,
  };
}

const query = {
  requestKey: 'a'.repeat(64),
  environment: makeEnvironment(),
};

describe('空 Store、版本不支持与 I/O 错误的可区分结果（任务 2.3）', () => {
  it('根目录不存在代表空 Store：返回无候选且不是错误', async () => {
    const store = openExperienceStore(path.join(root, 'not-created-yet'));
    const found = await store.findCandidates(query);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toEqual([]);
  });

  it('空目录代表空 Store：返回无候选', async () => {
    const emptyRoot = path.join(root, 'empty-store');
    await fs.mkdir(emptyRoot, { recursive: true });
    const store = openExperienceStore(emptyRoot);
    const found = await store.findCandidates(query);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toEqual([]);
  });

  it('索引版本不支持返回 unsupported-version，不返回命中', async () => {
    await fs.writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        format: INDEX_FORMAT,
        schemaVersion: 2,
        generatedAt: '2026-09-15T10:00:00.000Z',
        experiences: [],
        events: {},
      }),
    );
    const store = openExperienceStore(root);
    const found = await store.findCandidates(query);
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.error.kind).toBe('unsupported-version');
      expect(found.error.message).toContain('2');
      expect(found.error.message).toContain('拒绝读取');
    }
  });

  it('索引损坏（非法 JSON / format 不识别 / 结构不符）返回 invalid-asset', async () => {
    const cases: Array<{ name: string; content: string }> = [
      { name: '非法 JSON', content: '{not json' },
      {
        name: 'format 不识别',
        content: JSON.stringify({ format: 'other-index', schemaVersion: 1 }),
      },
      {
        name: '结构不符',
        content: JSON.stringify({
          format: INDEX_FORMAT,
          schemaVersion: 1,
          generatedAt: '2026-09-15T10:00:00.000Z',
          experiences: [{ unexpected: true }],
          events: {},
        }),
      },
    ];
    for (const { name, content } of cases) {
      await fs.writeFile(path.join(root, 'index.json'), content);
      const store = openExperienceStore(root);
      const found = await store.findCandidates(query);
      expect(found.ok, name).toBe(false);
      if (!found.ok) expect(found.error.kind, name).toBe('invalid-asset');
    }
  });

  it('索引内资产被篡改（variantId 与指纹不符）加载时即拒绝', async () => {
    const store = openExperienceStore(root);
    expect((await store.publishCandidate(publishInput({ eventId: 'call-0001' }))).ok).toBe(true);

    const indexPath = path.join(root, 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    index.experiences[0].variants[0].variantId = 'b'.repeat(64);
    await fs.writeFile(indexPath, JSON.stringify(index));

    const reopened = openExperienceStore(root);
    const found = await reopened.findCandidates(query);
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.error.kind).toBe('invalid-asset');
      expect(found.error.message).toContain('variantId');
    }
  });

  it('只读目录发布失败返回 io-error，且不产生半成品命中', async () => {
    await fs.chmod(root, 0o500);
    try {
      const store = openExperienceStore(root);
      const result = await store.publishCandidate(publishInput({ eventId: 'call-0001' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('io-error');
        expect(result.error.cause).toBeDefined();
      }
    } finally {
      await fs.chmod(root, 0o755);
    }

    // 恢复后仍无索引、无候选：失败没有留下半成品
    const store = openExperienceStore(root);
    const found = await store.findCandidates(query);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toEqual([]);
    await expect(fs.access(path.join(root, 'index.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('目录不可读时查询返回 io-error 而不是空命中', async () => {
    const inner = path.join(root, 'locked');
    await fs.mkdir(inner, { recursive: true });
    await fs.writeFile(path.join(inner, 'index.json'), '{}');
    await fs.chmod(inner, 0o000);
    try {
      const store = openExperienceStore(inner);
      const found = await store.findCandidates(query);
      expect(found.ok).toBe(false);
      if (!found.ok) expect(found.error.kind).toBe('io-error');
    } finally {
      await fs.chmod(inner, 0o755);
    }
  });

  it('资产写入阶段故障（注入）返回 io-error，索引保持缺失', async () => {
    const failing = openExperienceStore(root, {
      publishIndex: async () => {
        throw Object.assign(new Error('disk full during index publish'), {
          code: 'ENOSPC',
        });
      },
    });
    const result = await failing.publishCandidate(publishInput({ eventId: 'call-0001' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('io-error');
      expect(result.error.message).toContain('disk full');
    }
    // 未提交索引 → 孤立资产文件不能被查为经验
    const store = openExperienceStore(root);
    const found = await store.findCandidates(query);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toEqual([]);
  });

  it('查询输入非法返回 invalid-asset：requestKey 格式与环境缺失字段', async () => {
    const store = openExperienceStore(root);
    const badKey = await store.findCandidates({
      requestKey: '../escape',
      environment: makeEnvironment(),
    });
    expect(badKey.ok).toBe(false);
    if (!badKey.ok) expect(badKey.error.kind).toBe('invalid-asset');

    const badEnv = await store.findCandidates({
      requestKey: 'a'.repeat(64),
      environment: { platform: 'android' } as never,
    });
    expect(badEnv.ok).toBe(false);
    if (!badEnv.ok) {
      expect(badEnv.error.kind).toBe('invalid-asset');
      expect(badEnv.error.message).toContain('查询环境不合法');
    }
  });
});
