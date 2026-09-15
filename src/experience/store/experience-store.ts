import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  assetRefSchema,
  computeAssetDigest,
  type AssetRef,
  type ImageEvidence,
  type ScreenEvidence,
} from '../schema/assets';
import {
  environmentSchema,
  computeEnvironmentFingerprint,
  type ExperienceEnvironment,
} from '../schema/environment';
import type { ExperienceAction } from '../schema/action';
import { SHA256_HEX_PATTERN } from '../schema/patterns';
import {
  validateExperienceAsset,
  type Experience,
  type ExperienceSource,
} from '../schema/experience';
import {
  CANDIDATE_STATUSES,
  computeEntryFingerprint,
  computeVariantId,
  currentRevisionOf,
  type ExperienceVariant,
  type VariantRevision,
  type VariantStatus,
  type VariantStats,
} from '../schema/variant';
import {
  asIoError,
  storeError,
  storeValue,
  type StoreOutcome,
} from './errors';
import {
  ASSETS_DIRNAME,
  emptyStoreIndex,
  loadStoreIndex,
  writeStoreIndexAtomic,
  type StoreEventKind,
  type StoreIndex,
} from './index-file';

/** 查询候选：环境精确匹配且当前修订为 candidate/active 的链。 */
export interface CandidateChain {
  readonly requestKey: string;
  readonly variantId: string;
  readonly revision: number;
  readonly status: 'candidate' | 'active';
  readonly environment: ExperienceEnvironment;
  readonly environmentFingerprint: string;
  readonly entryEvidence: ScreenEvidence;
  readonly terminalEvidence: ScreenEvidence;
  readonly actions: readonly ExperienceAction[];
  readonly eligibilityPolicyVersion: string;
  readonly nativeResult: { readonly category: 'undefined' };
  readonly evidenceComplete: true;
  readonly learnedAt: string;
  readonly stats: VariantStats;
  readonly source: ExperienceSource;
}

export interface VariantSnapshot {
  readonly requestKey: string;
  readonly variantId: string;
  readonly revision: number;
  readonly status: VariantStatus;
  readonly stats: VariantStats;
}

export type PublishOutcome =
  | { readonly result: 'promoted'; readonly snapshot: VariantSnapshot }
  | { readonly result: 'duplicate'; readonly snapshot: VariantSnapshot };

export type VariantEventOutcome =
  | { readonly result: 'applied'; readonly snapshot: VariantSnapshot }
  | { readonly result: 'duplicate'; readonly snapshot: VariantSnapshot };

/** 发布 candidate 的输入：链证据 + 完整图片字节（digest → 内容）。 */
export interface PublishCandidateInput {
  /** 幂等事件标识；Promotion 使用本次调用的 callId。 */
  readonly eventId: string;
  readonly requestKey: string;
  readonly source: ExperienceSource;
  readonly environment: ExperienceEnvironment;
  readonly variant: {
    readonly entryEvidence: ScreenEvidence;
    readonly terminalEvidence: ScreenEvidence;
    readonly actions: readonly ExperienceAction[];
    readonly eligibilityPolicyVersion: string;
  };
  readonly images: ReadonlyMap<string, Uint8Array>;
}

export type VariantEventInput =
  | { readonly type: 'replay-succeeded' }
  | { readonly type: 'replay-failed' }
  | { readonly type: 'marked-stale'; readonly reason: string };

export interface ApplyVariantEventInput {
  /** 幂等事件标识；重复提交同一事件不重复计数、不重复改状态。 */
  readonly eventId: string;
  readonly requestKey: string;
  readonly variantId: string;
  /** 调用方持有的修订号；与当前修订不一致时返回 revision-conflict。 */
  readonly expectedRevision: number;
  readonly event: VariantEventInput;
}

export interface ExperienceStoreOptions {
  /**
   * 原子索引发布边界；默认同目录临时文件 + rename 原子替换。
   * 测试可注入失败以验证“索引替换前中断”语义。
   */
  readonly publishIndex?: (root: string, index: StoreIndex) => Promise<void>;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function isWithinDir(dir: string, candidate: string): boolean {
  const relative = path.relative(dir, candidate);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

/** 收集一条修订引用的全部资产（入口/终态/各动作前后/目标/上下文/局部状态）。 */
function revisionAssetRefs(revision: VariantRevision): AssetRef[] {
  const refs: AssetRef[] = [];
  const pushImage = (image?: ImageEvidence): void => {
    if (image) refs.push(image.asset);
  };
  const pushScreen = (screen?: ScreenEvidence): void => {
    if (screen) pushImage(screen.screenshot);
  };
  pushScreen(revision.entryEvidence);
  pushScreen(revision.terminalEvidence);
  for (const action of revision.actions) {
    pushScreen(action.before);
    pushScreen(action.after);
    if ('target' in action && action.target) {
      pushImage(action.target.image);
      pushImage(action.target.contextImage);
      pushImage(action.target.stateBefore);
    }
  }
  return refs;
}

/**
 * 本地文件 Experience Store。
 *
 * - 只暴露完整发布的经验：查询前校验候选引用的全部资产摘要；
 * - 写入失败保留旧索引（原子替换）；
 * - 进程内串行更新（单写者），不宣称跨进程事务或掉电持久性。
 */
export class ExperienceStore {
  readonly root: string;
  private readonly publishIndex: (root: string, index: StoreIndex) => Promise<void>;
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(root: string, options: ExperienceStoreOptions = {}) {
    this.root = path.resolve(root);
    this.publishIndex = options.publishIndex ?? writeStoreIndexAtomic;
  }

  /**
   * 查询可重放候选：requestKey 精确匹配 + 环境指纹完全相等 + 当前修订
   * 为 candidate/active。返回前逐一校验资产存在且摘要一致；损坏资产
   * 返回 invalid-asset，不返回成功命中。空 Store 返回空数组。
   */
  async findCandidates(query: {
    readonly requestKey: string;
    readonly environment: ExperienceEnvironment;
  }): Promise<StoreOutcome<readonly CandidateChain[]>> {
    if (!SHA256_HEX_PATTERN.test(query.requestKey ?? '')) {
      return storeError('invalid-asset', '查询 requestKey 必须是 64 位十六进制摘要');
    }
    const env = environmentSchema.safeParse(query.environment);
    if (!env.success) {
      return storeError(
        'invalid-asset',
        `查询环境不合法：${env.error.issues.map((i) => i.message).join('；')}`,
      );
    }
    const envFingerprint = computeEnvironmentFingerprint(env.data);

    const index = await loadStoreIndex(this.root);
    if (!index.ok) return index;

    const chains: CandidateChain[] = [];
    for (const experience of index.value.experiences) {
      if (experience.requestKey !== query.requestKey) continue;
      for (const variant of experience.variants) {
        if (variant.environmentFingerprint !== envFingerprint) continue;
        const current = currentRevisionOf(variant);
        if (!CANDIDATE_STATUSES.includes(current.status)) continue;
        for (const ref of revisionAssetRefs(current)) {
          const verified = await this.verifyAsset(ref);
          if (!verified.ok) return verified;
        }
        chains.push({
          requestKey: experience.requestKey,
          variantId: variant.variantId,
          revision: current.revision,
          status: current.status as 'candidate' | 'active',
          environment: variant.environment,
          environmentFingerprint: variant.environmentFingerprint,
          entryEvidence: current.entryEvidence,
          terminalEvidence: current.terminalEvidence,
          actions: current.actions,
          eligibilityPolicyVersion: current.eligibilityPolicyVersion,
          nativeResult: current.nativeResult,
          evidenceComplete: current.evidenceComplete,
          learnedAt: current.learnedAt,
          stats: current.stats,
          source: experience.source,
        });
      }
    }
    return storeValue(chains);
  }

  /**
   * 发布 candidate。同一 eventId 重复发布幂等（不产生新修订、不重复计数）。
   * 新入口/环境创建新 Variant；同一 Variant 再次学习追加新修订。
   * 失败时整体拒绝，不产生半成品。
   */
  async publishCandidate(
    input: PublishCandidateInput,
  ): Promise<StoreOutcome<PublishOutcome>> {
    return this.runExclusive(() => this.publishCandidateInternal(input));
  }

  /**
   * 按 expectedRevision + eventId 更新状态/统计：
   * replay-succeeded 首次验证成功将 candidate 激活为 active；
   * replay-failed 只计失败；marked-stale 标记 stale 并记录原因。
   * 重复 eventId 幂等；过期修订返回 revision-conflict，不覆盖新内容。
   */
  async applyVariantEvent(
    input: ApplyVariantEventInput,
  ): Promise<StoreOutcome<VariantEventOutcome>> {
    return this.runExclusive(() => this.applyVariantEventInternal(input));
  }

  /**
   * 读取并校验一张资产图：拒绝摘要格式非法（含父目录跳转/绝对路径）、
   * 越界符号链接、缺失、字节大小或内容摘要不一致。
   */
  async readAssetImage(ref: unknown): Promise<StoreOutcome<Uint8Array>> {
    const parsed = assetRefSchema.safeParse(ref);
    if (!parsed.success) {
      return storeError(
        'invalid-asset',
        `资产引用不合法：${parsed.error.issues.map((i) => i.message).join('；')}`,
      );
    }
    return this.verifyAsset(parsed.data);
  }

  /** 进程内串行化全部变更操作（单写者约定）。 */
  private runExclusive<T>(
    operation: () => Promise<StoreOutcome<T>>,
  ): Promise<StoreOutcome<T>> {
    const run = this.queueTail.then(operation, operation);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async publishCandidateInternal(
    input: PublishCandidateInput,
  ): Promise<StoreOutcome<PublishOutcome>> {
    if (typeof input.eventId !== 'string' || input.eventId.length === 0) {
      return storeError('invalid-asset', 'eventId 必须是非空字符串');
    }
    if (!SHA256_HEX_PATTERN.test(input.requestKey ?? '')) {
      return storeError(
        'invalid-asset',
        '发布 requestKey 必须是 64 位十六进制摘要（由请求 Key 派生模块产出）',
      );
    }

    let index: StoreIndex;
    try {
      const loaded = await loadStoreIndex(this.root);
      if (!loaded.ok) return loaded;
      index = loaded.value;

      // 幂等：同一事件已处理时直接返回既有结果，不再写入或计数
      const existing = index.events[input.eventId];
      if (existing) {
        const snapshot = this.snapshotOf(index, existing.requestKey, existing.variantId);
        if (!snapshot.ok) return snapshot;
        return storeValue({ result: 'duplicate', snapshot: snapshot.value });
      }

      const prepared = await this.preparePublish(index, input);
      if (!prepared.ok) return prepared;
      const { experience, variant, revision } = prepared.value;

      // 先写/校验资产，再原子提交索引；索引提交失败时读者仍见旧完整版本
      const written = await this.writeAssets(revision, input.images);
      if (!written.ok) return written;

      index.generatedAt = new Date().toISOString();
      index.experiences = upsertExperience(index.experiences, experience);
      index.events = {
        ...index.events,
        [input.eventId]: {
          requestKey: experience.requestKey,
          variantId: variant.variantId,
          revision: revision.revision,
          kind: 'publish',
          at: new Date().toISOString(),
        },
      };
      await this.publishIndex(this.root, index);
      return storeValue({
        result: 'promoted',
        snapshot: {
          requestKey: experience.requestKey,
          variantId: variant.variantId,
          revision: revision.revision,
          status: revision.status,
          stats: revision.stats,
        },
      });
    } catch (error) {
      return asIoError('发布 candidate', error);
    }
  }

  /** 构造并整体校验发布后的 Experience/Variant/Revision（失败即整体拒绝）。 */
  private async preparePublish(
    index: StoreIndex,
    input: PublishCandidateInput,
  ): Promise<
    StoreOutcome<{ experience: Experience; variant: ExperienceVariant; revision: VariantRevision }>
  > {
    const now = new Date().toISOString();
    const envFingerprint = computeEnvironmentFingerprint(input.environment);
    const entryFingerprint = computeEntryFingerprint(input.variant.entryEvidence);
    const variantId = computeVariantId(envFingerprint, entryFingerprint);

    const existingExperience = index.experiences.find(
      (experience) => experience.requestKey === input.requestKey,
    );
    const existingVariant = existingExperience?.variants.find(
      (variant) => variant.variantId === variantId,
    );
    const nextRevisionNumber = existingVariant
      ? currentRevisionOf(existingVariant).revision + 1
      : 1;

    const revision: VariantRevision = {
      revision: nextRevisionNumber,
      status: 'candidate',
      entryEvidence: input.variant.entryEvidence,
      terminalEvidence: input.variant.terminalEvidence,
      actions: [...input.variant.actions],
      eligibilityPolicyVersion: input.variant.eligibilityPolicyVersion,
      nativeResult: { category: 'undefined' },
      evidenceComplete: true,
      learnedAt: now,
      stats: { learned: 1, replaySuccess: 0, replayFailure: 0 },
    };

    let variant: ExperienceVariant;
    let experience: Experience;
    if (existingExperience && existingVariant) {
      variant = {
        ...existingVariant,
        revisions: [...existingVariant.revisions, revision],
      };
      experience = {
        ...existingExperience,
        // source 反映最近一次学习（请求身份不变，事件账本保留全部历史）
        source: input.source,
        updatedAt: now,
        variants: existingExperience.variants.map((v) =>
          v.variantId === variant.variantId ? variant : v,
        ),
      };
    } else if (existingExperience) {
      variant = {
        variantId,
        environment: input.environment,
        environmentFingerprint: envFingerprint,
        entryFingerprint,
        revisions: [revision],
      };
      experience = {
        ...existingExperience,
        source: input.source,
        updatedAt: now,
        variants: [...existingExperience.variants, variant],
      };
    } else {
      variant = {
        variantId,
        environment: input.environment,
        environmentFingerprint: envFingerprint,
        entryFingerprint,
        revisions: [revision],
      };
      experience = {
        schemaVersion: 1,
        requestKey: input.requestKey,
        source: input.source,
        createdAt: now,
        updatedAt: now,
        variants: [variant],
      };
    }

    const validation = validateExperienceAsset(experience);
    if (!validation.ok) {
      return storeError(
        'invalid-asset',
        `候选资产校验失败（整链拒绝，不产生半成品）：${validation.reasons.join('；')}`,
      );
    }
    return storeValue({ experience, variant, revision });
  }

  /** 校验图片字节与引用一致并写入内容寻址文件；已存在且完好的文件跳过。 */
  private async writeAssets(
    revision: VariantRevision,
    images: ReadonlyMap<string, Uint8Array>,
  ): Promise<StoreOutcome<true>> {
    const referenced = new Set(
      revisionAssetRefs(revision).map((ref) => ref.digest),
    );
    for (const [digest, bytes] of images) {
      if (!SHA256_HEX_PATTERN.test(digest)) {
        return storeError(
          'invalid-asset',
          `图片表键 "${digest}" 不是合法摘要（拒绝父目录跳转或绝对路径形式的引用）`,
        );
      }
      if (computeAssetDigest(bytes) !== digest) {
        return storeError(
          'invalid-asset',
          `图片内容与摘要 ${digest} 不匹配（篡改或错误绑定）`,
        );
      }
    }
    for (const digest of referenced) {
      if (!images.has(digest)) {
        return storeError(
          'invalid-asset',
          `候选引用的资产 ${digest} 缺少图片字节；发布必须携带完整视觉证据`,
        );
      }
      const bytes = images.get(digest)!;
      const ref = revisionAssetRefs(revision).find((r) => r.digest === digest);
      if (ref && ref.byteSize !== bytes.byteLength) {
        return storeError(
          'invalid-asset',
          `资产 ${digest} 的 byteSize (${ref.byteSize}) 与实际字节数 (${bytes.byteLength}) 不一致`,
        );
      }
    }
    const extras = [...images.keys()].filter((digest) => !referenced.has(digest));
    if (extras.length > 0) {
      return storeError(
        'invalid-asset',
        `图片表包含未被候选引用的资产：${extras.join('、')}`,
      );
    }

    const assetsDir = path.join(this.root, ASSETS_DIRNAME);
    try {
      await fs.mkdir(assetsDir, { recursive: true });
      for (const [digest, bytes] of images) {
        const filePath = path.join(assetsDir, `${digest}.png`);
        if (!isWithinDir(this.root, filePath)) {
          return storeError(
            'invalid-asset',
            `资产路径 ${filePath} 越出 Store 根目录，拒绝写入`,
          );
        }
        try {
          const existing = await fs.readFile(filePath);
          if (computeAssetDigest(existing) === digest) continue;
        } catch (error) {
          if (!isNodeError(error, 'ENOENT')) throw error;
        }
        await fs.writeFile(filePath, bytes);
      }
      return storeValue(true);
    } catch (error) {
      return asIoError('写入资产图', error);
    }
  }

  private async applyVariantEventInternal(
    input: ApplyVariantEventInput,
  ): Promise<StoreOutcome<VariantEventOutcome>> {
    if (typeof input.eventId !== 'string' || input.eventId.length === 0) {
      return storeError('invalid-asset', 'eventId 必须是非空字符串');
    }
    if (input.event.type === 'marked-stale' && input.event.reason.length === 0) {
      return storeError('invalid-asset', 'marked-stale 事件必须携带非空失效原因');
    }

    let index: StoreIndex;
    try {
      const loaded = await loadStoreIndex(this.root);
      if (!loaded.ok) return loaded;
      index = loaded.value;

      const existing = index.events[input.eventId];
      if (existing) {
        const snapshot = this.snapshotOf(index, input.requestKey, input.variantId);
        if (!snapshot.ok) return snapshot;
        return storeValue({ result: 'duplicate', snapshot: snapshot.value });
      }

      const located = this.locateVariant(index, input.requestKey, input.variantId);
      if (!located.ok) return located;
      const { experienceIndex, variantIndex } = located.value;
      const experience = index.experiences[experienceIndex];
      const variant = experience.variants[variantIndex];
      const current = currentRevisionOf(variant);
      if (input.expectedRevision !== current.revision) {
        return storeError(
          'revision-conflict',
          `修订冲突：调用方持有修订 ${input.expectedRevision}，当前修订为 ${current.revision}；拒绝以过期修订覆盖较新内容`,
        );
      }

      const updated: VariantRevision = { ...current, stats: { ...current.stats } };
      if (input.event.type === 'replay-succeeded') {
        updated.stats.replaySuccess += 1;
        if (updated.status === 'candidate') updated.status = 'active';
      } else if (input.event.type === 'replay-failed') {
        updated.stats.replayFailure += 1;
      } else {
        updated.status = 'stale';
        updated.staleReason = input.event.reason;
      }

      index.experiences = index.experiences.map((exp, ei) =>
        ei !== experienceIndex
          ? exp
          : {
              ...exp,
              updatedAt: new Date().toISOString(),
              variants: exp.variants.map((v, vi) =>
                vi !== variantIndex
                  ? v
                  : {
                      ...v,
                      revisions: v.revisions.map((r) =>
                        r.revision === updated.revision ? updated : r,
                      ),
                    },
              ),
            },
      );
      index.generatedAt = new Date().toISOString();
      index.events = {
        ...index.events,
        [input.eventId]: {
          requestKey: input.requestKey,
          variantId: input.variantId,
          revision: updated.revision,
          kind: input.event.type as StoreEventKind,
          at: new Date().toISOString(),
        },
      };
      await this.publishIndex(this.root, index);
      return storeValue({
        result: 'applied',
        snapshot: {
          requestKey: input.requestKey,
          variantId: input.variantId,
          revision: updated.revision,
          status: updated.status,
          stats: updated.stats,
        },
      });
    } catch (error) {
      return asIoError('更新 Variant 状态', error);
    }
  }

  private locateVariant(
    index: StoreIndex,
    requestKey: string,
    variantId: string,
  ): StoreOutcome<{ experienceIndex: number; variantIndex: number }> {
    for (const [experienceIndex, experience] of index.experiences.entries()) {
      if (experience.requestKey !== requestKey) continue;
      for (const [variantIndex, variant] of experience.variants.entries()) {
        if (variant.variantId === variantId) {
          return storeValue({ experienceIndex, variantIndex });
        }
      }
    }
    return storeError(
      'not-found',
      `未找到 requestKey=${requestKey.slice(0, 12)}…/variantId=${variantId.slice(0, 12)}… 的 Variant`,
    );
  }

  private snapshotOf(
    index: StoreIndex,
    requestKey: string,
    variantId: string,
  ): StoreOutcome<VariantSnapshot> {
    const located = this.locateVariant(index, requestKey, variantId);
    if (!located.ok) return located;
    const { experienceIndex, variantIndex } = located.value;
    const variant = index.experiences[experienceIndex].variants[variantIndex];
    const current = currentRevisionOf(variant);
    return storeValue({
      requestKey,
      variantId,
      revision: current.revision,
      status: current.status,
      stats: current.stats,
    });
  }

  /** 读取并完整校验一张资产图（存在性、realpath 界内、大小与内容摘要）。 */
  private async verifyAsset(ref: AssetRef): Promise<StoreOutcome<Uint8Array>> {
    const assetPath = path.join(this.root, ASSETS_DIRNAME, `${ref.digest}.png`);
    if (!isWithinDir(this.root, assetPath)) {
      return storeError(
        'invalid-asset',
        `资产路径 ${assetPath} 越出 Store 根目录，拒绝访问`,
      );
    }
    try {
      const realRoot = await fs.realpath(this.root);
      let resolved: string;
      try {
        resolved = await fs.realpath(assetPath);
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) {
          return storeError(
            'invalid-asset',
            `引用的资产图缺失：${assetPath}`,
          );
        }
        throw error;
      }
      if (!isWithinDir(realRoot, resolved)) {
        return storeError(
          'invalid-asset',
          `资产 ${ref.digest} 经符号链接解析到 ${resolved}，越出 Store 根目录，拒绝访问`,
        );
      }
      const bytes = await fs.readFile(assetPath);
      if (bytes.byteLength !== ref.byteSize) {
        return storeError(
          'invalid-asset',
          `资产 ${ref.digest} 大小不匹配（期望 ${ref.byteSize}，实际 ${bytes.byteLength}）`,
        );
      }
      if (computeAssetDigest(bytes) !== ref.digest) {
        return storeError(
          'invalid-asset',
          `资产 ${ref.digest} 内容摘要不匹配（损坏或篡改），拒绝作为命中`,
        );
      }
      return storeValue(bytes);
    } catch (error) {
      return asIoError(`校验资产 ${ref.digest}`, error);
    }
  }
}

function upsertExperience(
  experiences: readonly Experience[],
  updated: Experience,
): Experience[] {
  const index = experiences.findIndex(
    (experience) => experience.requestKey === updated.requestKey,
  );
  if (index < 0) return [...experiences, updated];
  return experiences.map((experience, i) => (i === index ? updated : experience));
}

/** 打开一个本地文件 Experience Store；空目录即空 Store。 */
export function openExperienceStore(
  root: string,
  options?: ExperienceStoreOptions,
): ExperienceStore {
  return new ExperienceStore(root, options);
}
