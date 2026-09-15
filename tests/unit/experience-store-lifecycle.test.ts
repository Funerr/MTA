import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  openExperienceStore,
  type PublishCandidateInput,
} from '../../src/experience/store/experience-store';
import {
  FixtureImageBag,
  makeEnvironment,
  makeRevision,
  makeSource,
} from '../helpers/experience-fixtures';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-experience-lifecycle-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function publishInput(options: {
  eventId: string;
  entrySeed?: string;
  requestKey?: string;
}): PublishCandidateInput {
  const bag = new FixtureImageBag();
  const revision = makeRevision(bag, { entrySeed: options.entrySeed });
  return {
    eventId: options.eventId,
    requestKey: options.requestKey ?? 'a'.repeat(64),
    source: makeSource({ callId: options.eventId }),
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

async function publish(
  root: string,
  options: { eventId: string; entrySeed?: string; requestKey?: string },
) {
  const store = openExperienceStore(root);
  const input = publishInput(options);
  const result = await store.publishCandidate(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return { input, outcome: result.value };
}

describe('状态与统计持久化（任务 2.2）', () => {
  it('发布 candidate 后一次成功重放激活；重复提交同一事件不重复计数', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, { eventId: 'call-0001' });
    expect(outcome.result).toBe('promoted');
    expect(outcome.snapshot).toMatchObject({
      revision: 1,
      status: 'candidate',
      stats: { learned: 1, replaySuccess: 0, replayFailure: 0 },
    });

    const applied = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'replay-succeeded' },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.result).toBe('applied');
    expect(applied.value.snapshot).toMatchObject({
      status: 'active',
      stats: { replaySuccess: 1 },
    });

    // 重复提交同一 eventId：幂等，统计不再增加
    const duplicated = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'replay-succeeded' },
    });
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.value.result).toBe('duplicate');
    expect(duplicated.value.snapshot.stats.replaySuccess).toBe(1);

    // 重启后状态与统计持久
    const reopened = openExperienceStore(root);
    const found = await reopened.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    expect(found.value[0].status).toBe('active');
    expect(found.value[0].stats.replaySuccess).toBe(1);

    // 新的成功事件在 active 上只累计计数
    const again = await reopened.applyVariantEvent({
      eventId: 'run-0002',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'replay-succeeded' },
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.snapshot.status).toBe('active');
    expect(again.value.snapshot.stats.replaySuccess).toBe(2);
  });

  it('重放失败只累计失败统计，不改变状态', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, { eventId: 'call-0001' });
    const failed = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'replay-failed' },
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.snapshot).toMatchObject({
      status: 'candidate',
      stats: { replayFailure: 1, replaySuccess: 0 },
    });
  });

  it('标记 stale 后不再作为候选；原因可追踪', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, { eventId: 'call-0001' });
    const stale = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'marked-stale', reason: '入口画面不再匹配' },
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.snapshot.status).toBe('stale');

    const found = await store.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toHaveLength(0);

    // stale 原因写入修订并持久化
    const rawIndex = JSON.parse(
      await fs.readFile(path.join(root, 'index.json'), 'utf8'),
    );
    const revision =
      rawIndex.experiences[0].variants[0].revisions[0];
    expect(revision.status).toBe('stale');
    expect(revision.staleReason).toBe('入口画面不再匹配');
  });

  it('失效后同一入口重学：新 candidate 修订可查，旧 stale 修订保留', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, {
      eventId: 'call-0001',
      entrySeed: 'entry-a',
    });
    expect(
      (
        await store.applyVariantEvent({
          eventId: 'run-0001',
          requestKey: input.requestKey,
          variantId: outcome.snapshot.variantId,
          expectedRevision: 1,
          event: { type: 'marked-stale', reason: '目标位移过大' },
        })
      ).ok,
    ).toBe(true);

    // 同一入口重新学习（同 entry 图 → 同 variantId，不同 callId）
    const relearned = await publish(root, {
      eventId: 'call-0002',
      entrySeed: 'entry-a',
    });
    expect(relearned.outcome.snapshot.variantId).toBe(outcome.snapshot.variantId);
    expect(relearned.outcome.snapshot.revision).toBe(2);
    expect(relearned.outcome.snapshot.status).toBe('candidate');

    // 新 candidate 可查；旧 stale 保留在修订历史
    const found = await store.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    expect(found.value[0].revision).toBe(2);

    const rawIndex = JSON.parse(
      await fs.readFile(path.join(root, 'index.json'), 'utf8'),
    );
    const revisions = rawIndex.experiences[0].variants[0].revisions;
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ revision: 1, status: 'stale', staleReason: '目标位移过大' });
    expect(revisions[1]).toMatchObject({ revision: 2, status: 'candidate' });
  });

  it('重复发布同一 eventId 幂等：不产生重复修订或统计', async () => {
    const store = openExperienceStore(root);
    const first = await store.publishCandidate(
      publishInput({ eventId: 'call-0001' }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.result).toBe('promoted');

    const second = await store.publishCandidate(
      publishInput({ eventId: 'call-0001' }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.result).toBe('duplicate');
    expect(second.value.snapshot.revision).toBe(1);

    const rawIndex = JSON.parse(
      await fs.readFile(path.join(root, 'index.json'), 'utf8'),
    );
    expect(rawIndex.experiences).toHaveLength(1);
    expect(rawIndex.experiences[0].variants).toHaveLength(1);
    expect(rawIndex.experiences[0].variants[0].revisions).toHaveLength(1);
    expect(rawIndex.experiences[0].variants[0].revisions[0].stats.learned).toBe(1);
  });

  it('过期修订提交更新返回冲突，不覆盖较新内容', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, { eventId: 'call-0001' });
    const variantId = outcome.snapshot.variantId;

    // 先正常激活（修订 1 → active，统计成功 1 次）
    expect(
      (
        await store.applyVariantEvent({
          eventId: 'run-0001',
          requestKey: input.requestKey,
          variantId,
          expectedRevision: 1,
          event: { type: 'replay-succeeded' },
        })
      ).ok,
    ).toBe(true);

    // 再学习产生修订 2（candidate）
    const relearned = await publish(root, { eventId: 'call-0002' });
    expect(relearned.outcome.snapshot.revision).toBe(2);

    // 用过期修订 1 提交事件 → revision-conflict，修订 2 内容不被覆盖
    const conflicted = await store.applyVariantEvent({
      eventId: 'run-0002',
      requestKey: input.requestKey,
      variantId,
      expectedRevision: 1,
      event: { type: 'marked-stale', reason: 'stale attempt with old revision' },
    });
    expect(conflicted.ok).toBe(false);
    if (conflicted.ok) return;
    expect(conflicted.error.kind).toBe('revision-conflict');
    expect(conflicted.error.message).toContain('修订冲突');

    const rawIndex = JSON.parse(
      await fs.readFile(path.join(root, 'index.json'), 'utf8'),
    );
    const revisions = rawIndex.experiences[0].variants[0].revisions;
    expect(revisions[0]).toMatchObject({ revision: 1, status: 'active' });
    expect(revisions[1]).toMatchObject({ revision: 2, status: 'candidate' });
    expect(Object.keys(rawIndex.events)).not.toContain('run-0002');

    // 冲突事件未入账；正确修订可继续提交
    const corrected = await store.applyVariantEvent({
      eventId: 'run-0002',
      requestKey: input.requestKey,
      variantId,
      expectedRevision: 2,
      event: { type: 'replay-succeeded' },
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.value.snapshot).toMatchObject({
      revision: 2,
      status: 'active',
    });
  });

  it('不存在的 Variant 返回 not-found 而不是创建', async () => {
    const store = openExperienceStore(root);
    const result = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: 'a'.repeat(64),
      variantId: 'b'.repeat(64),
      expectedRevision: 1,
      event: { type: 'replay-succeeded' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('not-found');
      expect(result.error.message).toContain('未找到');
    }
  });

  it('marked-stale 必须携带非空原因', async () => {
    const store = openExperienceStore(root);
    const { input, outcome } = await publish(root, { eventId: 'call-0001' });
    const result = await store.applyVariantEvent({
      eventId: 'run-0001',
      requestKey: input.requestKey,
      variantId: outcome.snapshot.variantId,
      expectedRevision: 1,
      event: { type: 'marked-stale', reason: '' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-asset');
      expect(result.error.message).toContain('失效原因');
    }
  });
});
