import { matchScreen as defaultMatchScreen } from '../matcher/match';
import { createStoreImageLoader } from '../replay/replay';
import type { CandidateChain, ExperienceStore } from '../store/experience-store';
import type { ExperienceEnvironment } from '../schema/environment';
import type { LookupDecision, MatchScreenFn } from './types';

export interface LookupInput {
  readonly store: ExperienceStore;
  readonly requestKey: string;
  readonly environment: ExperienceEnvironment;
  readonly currentScreenshot: Uint8Array;
  readonly matchScreen?: MatchScreenFn;
  readonly loadImage?: ReturnType<typeof createStoreImageLoader>;
}

function recencyKey(chain: CandidateChain): string {
  return `${chain.learnedAt}|${String(chain.revision).padStart(16, '0')}`;
}

/**
 * 按 requestKey+environment 取 candidate/active，排除 Store 已过滤的
 * stale/版本不符/坏链，再用入口画面验证。兼容新修订优先；同等候选仍
 * 歧义则 MISS。只消费当前截图，不向设备派发动作试点。
 */
export async function lookupExperienceCandidate(input: LookupInput): Promise<LookupDecision> {
  const found = await input.store.findCandidates({
    requestKey: input.requestKey,
    environment: input.environment,
  });
  if (!found.ok) {
    if (found.error.kind === 'invalid-asset') {
      return {
        kind: 'miss',
        reason: 'invalid-asset',
        found: 0,
        detail: found.error.message,
      };
    }
    return {
      kind: 'miss',
      reason: 'store-unavailable',
      found: 0,
      detail: found.error.message,
    };
  }
  if (found.value.length === 0) {
    return { kind: 'miss', reason: 'empty', found: 0, detail: 'Store 中无 candidate/active 候选' };
  }

  const matchScreen = input.matchScreen ?? defaultMatchScreen;
  const loadImage = input.loadImage ?? createStoreImageLoader(input.store);
  const validated: CandidateChain[] = [];
  for (const chain of found.value) {
    const historical = await loadImage(chain.entryEvidence.screenshot.asset);
    const screen = await matchScreen({
      currentScreenshot: input.currentScreenshot,
      currentEnvironment: input.environment,
      historicalScreenshot: historical,
      historicalEnvironment: chain.environment,
    });
    if (screen.decision === 'match') validated.push(chain);
  }

  if (validated.length === 0) {
    return {
      kind: 'miss',
      reason: 'no-validated',
      found: found.value.length,
      detail: `索引命中 ${found.value.length} 条，入口画面验证均未通过`,
    };
  }

  const ranked = [...validated].sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
  const newest = ranked[0]!;
  const tied = ranked.filter((chain) => recencyKey(chain) === recencyKey(newest));
  if (tied.length > 1) {
    return {
      kind: 'miss',
      reason: 'ambiguous',
      found: found.value.length,
      detail: `入口验证通过 ${validated.length} 条且最新修订同等，拒绝以设备试点选链`,
    };
  }
  return { kind: 'hit', selected: newest, found: found.value.length };
}
