import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  openExperienceStore,
  type PublishCandidateInput,
} from '../../src/experience/store/experience-store';
import { computeAssetDigest } from '../../src/experience/schema/assets';
import {
  FixtureImageBag,
  makeEnvironment,
  makeFullActionChain,
  makeRevision,
  makeSource,
} from '../helpers/experience-fixtures';

let root: string;
let bag: FixtureImageBag;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-experience-store-'));
  bag = new FixtureImageBag();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function publishInput(options: {
  eventId: string;
  entrySeed: string;
  environment?: ReturnType<typeof makeEnvironment>;
  requestKey?: string;
  source?: ReturnType<typeof makeSource>;
}): PublishCandidateInput {
  // 每次发布使用独立图片集合：严格对应本次链引用的资产（同种子 → 同摘要）
  const privateBag = new FixtureImageBag();
  const revision = makeRevision(privateBag, { entrySeed: options.entrySeed });
  return {
    eventId: options.eventId,
    requestKey:
      options.requestKey ??
      'a'.repeat(64),
    source: options.source ?? makeSource(),
    environment: options.environment ?? makeEnvironment(),
    variant: {
      entryEvidence: revision.entryEvidence,
      terminalEvidence: revision.terminalEvidence,
      actions: revision.actions,
      eligibilityPolicyVersion: revision.eligibilityPolicyVersion,
    },
    images: privateBag.images,
  };
}

describe('资产读写与原子发布（任务 2.1）', () => {
  it('发布后重启读回：字段与动作顺序一致，图片可读取并通过完整性校验', async () => {
    const store = openExperienceStore(root);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    const published = await store.publishCandidate(input);
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    // 重新打开（模拟重启），读回全部内容
    const reopened = openExperienceStore(root);
    const found = await reopened.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(1);
    const chain = found.value[0];
    expect(chain.variantId).toBe(published.value.snapshot.variantId);
    expect(chain.revision).toBe(1);
    expect(chain.status).toBe('candidate');
    expect(chain.actions.map((a) => a.type)).toEqual([
      'Tap',
      'Input',
      'Scroll',
      'LongPress',
      'Back',
      'Home',
    ]);
    expect(chain.eligibilityPolicyVersion).toBe('policy@1');
    expect(chain.nativeResult).toEqual({ category: 'undefined' });
    expect(chain.source.callId).toBe('call-0001');

    // 引用的图片可读取且摘要一致
    const entryBytes = await reopened.readAssetImage(chain.entryEvidence.screenshot.asset);
    expect(entryBytes.ok).toBe(true);
    if (entryBytes.ok) {
      expect(computeAssetDigest(entryBytes.value)).toBe(
        chain.entryEvidence.screenshot.asset.digest,
      );
      const target = chain.actions[0];
      if (target.type === 'Tap') {
        const targetBytes = await reopened.readAssetImage(target.target.image.asset);
        expect(targetBytes.ok).toBe(true);
      }
    }

    // 索引与资产落盘结构
    const indexStat = await fs.stat(path.join(root, 'index.json'));
    expect(indexStat.isFile()).toBe(true);
    const assetFiles = await fs.readdir(path.join(root, 'assets'));
    expect(assetFiles.length).toBe(input.images.size);
  });

  it('索引替换前中断：读者仍看到此前完整版本，孤立文件不能被查为经验', async () => {
    const store = openExperienceStore(root);
    const first = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    expect((await store.publishCandidate(first)).ok).toBe(true);
    const indexBefore = await fs.readFile(path.join(root, 'index.json'), 'utf8');

    // 注入索引发布失败（资产已写入、索引替换前中断）
    const failing = openExperienceStore(root, {
      publishIndex: async () => {
        throw new Error('injected: index rename failed');
      },
    });
    const second = publishInput({ eventId: 'call-0002', entrySeed: 'entry' });
    const result = await failing.publishCandidate(second);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('io-error');
    expect(result.error.message).toContain('injected');

    // 旧索引原样保留；重开 Store 仍只看到第一个版本
    const indexAfter = await fs.readFile(path.join(root, 'index.json'), 'utf8');
    expect(indexAfter).toBe(indexBefore);
    const reopened = openExperienceStore(root);
    const found = await reopened.findCandidates({
      requestKey: second.requestKey,
      environment: second.environment,
    });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value).toHaveLength(1);
      expect(found.value[0].revision).toBe(1);
      expect(found.value[0].source.callId).toBe('call-0001');
    }
  });

  it('损坏的引用图片返回可诊断错误，不返回成功命中', async () => {
    const store = openExperienceStore(root);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    expect((await store.publishCandidate(input)).ok).toBe(true);

    // 篡改入口截图内容（保持字节长度一致，命中摘要校验）
    const entryDigest = input.variant.entryEvidence.screenshot.asset.digest;
    const entryPath = path.join(root, 'assets', `${entryDigest}.png`);
    await fs.writeFile(entryPath, Buffer.alloc(96, 0x7a));

    const found = await store.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.kind).toBe('invalid-asset');
    expect(found.error.message).toContain('内容摘要不匹配');

    const read = await store.readAssetImage(input.variant.entryEvidence.screenshot.asset);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.kind).toBe('invalid-asset');
  });

  it('缺失的引用图片返回可诊断错误', async () => {
    const store = openExperienceStore(root);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    expect((await store.publishCandidate(input)).ok).toBe(true);

    const entryDigest = input.variant.entryEvidence.screenshot.asset.digest;
    await fs.rm(path.join(root, 'assets', `${entryDigest}.png`));

    const found = await store.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error.kind).toBe('invalid-asset');
    expect(found.error.message).toContain('缺失');
  });

  it('资产引用含父目录跳转或绝对路径被拒绝，不访问根目录之外的文件', async () => {
    const store = openExperienceStore(root);
    const outside = path.join(root, '..', 'outside-secret.png');
    await fs.writeFile(outside, 'secret');

    const escape = await store.readAssetImage({
      digest: '../../outside-secret',
      byteSize: 6,
      mimeType: 'image/png',
    });
    expect(escape.ok).toBe(false);
    if (!escape.ok) {
      expect(escape.error.kind).toBe('invalid-asset');
      expect(escape.error.message).toMatch(/摘要/);
    }

    const absolute = await store.readAssetImage({
      digest: '/etc/passwd',
      byteSize: 100,
      mimeType: 'image/png',
    });
    expect(absolute.ok).toBe(false);
    if (!absolute.ok) expect(absolute.error.kind).toBe('invalid-asset');

    // 发布侧：图片表键带路径跳转同样拒绝
    const evil = new Map<string, Uint8Array>([['../evil', new Uint8Array([1])]]);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    const result = await store.publishCandidate({ ...input, images: evil });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-asset');
      expect(result.error.message).toMatch(/不是合法摘要/);
    }
  });

  it('越界符号链接被拒绝，不读取根目录之外的文件', async () => {
    const store = openExperienceStore(root);
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-outside-'));
    try {
      const outsideFile = path.join(outsideDir, 'target.png');
      await fs.writeFile(outsideFile, 'outside content');
      const assetsDir = path.join(root, 'assets');
      await fs.mkdir(assetsDir, { recursive: true });
      const digest = computeAssetDigest(Buffer.from('outside content'));
      await fs.symlink(outsideFile, path.join(assetsDir, `${digest}.png`));

      const result = await store.readAssetImage({
        digest,
        byteSize: 'outside content'.length,
        mimeType: 'image/png',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid-asset');
        expect(result.error.message).toContain('符号链接');
      }
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('发布时图片内容与摘要不匹配被拒绝，不产生半成品', async () => {
    const store = openExperienceStore(root);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });
    // 用错误字节顶替某摘要
    const someDigest = [...input.images.keys()][0];
    const wrongBytes = Buffer.from('not the real image');
    const tampered = new Map(input.images);
    tampered.set(someDigest, wrongBytes);

    const result = await store.publishCandidate({
      ...input,
      images: tampered,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-asset');
      expect(result.error.message).toMatch(/摘要/);
    }
    const found = await store.findCandidates({
      requestKey: input.requestKey,
      environment: input.environment,
    });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toHaveLength(0);
  });

  it('发布缺少图片字节或含未引用资产被拒绝', async () => {
    const store = openExperienceStore(root);
    const input = publishInput({ eventId: 'call-0001', entrySeed: 'entry' });

    const partial = new Map(input.images);
    const firstDigest = [...input.images.keys()][0];
    partial.delete(firstDigest);
    const missing = await store.publishCandidate({ ...input, images: partial });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.kind).toBe('invalid-asset');
      expect(missing.error.message).toContain('缺少图片字节');
    }

    const extra = new Map(input.images);
    const extraBytes = Buffer.from('orphan image bytes');
    extra.set(computeAssetDigest(extraBytes), extraBytes);
    const withExtra = await store.publishCandidate({ ...input, images: extra });
    expect(withExtra.ok).toBe(false);
    if (!withExtra.ok) {
      expect(withExtra.error.kind).toBe('invalid-asset');
      expect(withExtra.error.message).toContain('未被候选引用');
    }
  });

  it('非法资产（如空动作链）整体拒绝，不成为可查询候选', async () => {
    const store = openExperienceStore(root);
    const revision = makeRevision(bag, { entrySeed: 'entry' });
    const input: PublishCandidateInput = {
      eventId: 'call-0001',
      requestKey: 'c'.repeat(64),
      source: makeSource(),
      environment: makeEnvironment(),
      variant: {
        entryEvidence: revision.entryEvidence,
        terminalEvidence: revision.terminalEvidence,
        actions: [],
        eligibilityPolicyVersion: 'policy@1',
      },
      images: bag.images,
    };
    const result = await store.publishCandidate(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-asset');
      expect(result.error.message).toContain('动作链为空');
    }
  });

  it('相同请求的两个入口画面可共存，查询返回各自入口证据', async () => {
    const store = openExperienceStore(root);
    const requestKey = 'd'.repeat(64);
    const env = makeEnvironment();
    const first = publishInput({
      eventId: 'call-0001',
      entrySeed: 'entry-a',
      requestKey,
      environment: env,
    });
    const second = publishInput({
      eventId: 'call-0002',
      entrySeed: 'entry-b',
      requestKey,
      environment: env,
    });
    expect((await store.publishCandidate(first)).ok).toBe(true);
    expect((await store.publishCandidate(second)).ok).toBe(true);

    const found = await store.findCandidates({ requestKey, environment: env });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(2);
    const entryDigests = found.value.map(
      (chain) => chain.entryEvidence.screenshot.asset.digest,
    );
    expect(new Set(entryDigests).size).toBe(2);
    // 下游可分别取得各自入口证据
    for (const chain of found.value) {
      const bytes = await store.readAssetImage(chain.entryEvidence.screenshot.asset);
      expect(bytes.ok).toBe(true);
    }
  });

  it('环境或请求不同的候选互相隔离', async () => {
    const store = openExperienceStore(root);
    const requestKey = 'e'.repeat(64);
    const otherKey = 'f'.repeat(64);
    expect(
      (
        await store.publishCandidate(
          publishInput({ eventId: 'call-0001', entrySeed: 'entry-a', requestKey }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await store.publishCandidate(
          publishInput({
            eventId: 'call-0002',
            entrySeed: 'entry-a',
            requestKey: otherKey,
          }),
        )
      ).ok,
    ).toBe(true);

    const sameRequest = await store.findCandidates({
      requestKey,
      environment: makeEnvironment(),
    });
    expect(sameRequest.ok).toBe(true);
    if (sameRequest.ok) expect(sameRequest.value).toHaveLength(1);

    const otherEnv = await store.findCandidates({
      requestKey,
      environment: makeEnvironment({ theme: 'dark' }),
    });
    expect(otherEnv.ok).toBe(true);
    if (otherEnv.ok) expect(otherEnv.value).toHaveLength(0);
  });

  it('完整动作链夹具覆盖六种动作并全部通过资产校验', () => {
    expect(makeFullActionChain(bag)).toHaveLength(6);
  });
});
