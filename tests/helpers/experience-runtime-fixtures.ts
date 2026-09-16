import type { ScreenMatchResult } from '../../src/experience/matcher/types';
import {
  MATCHER_CONFIG_VERSION,
  MATCHER_DATA_VERSION,
} from '../../src/experience/matcher/constants';
import type { ExperienceActionPolicy, RuntimeIdentity, RuntimeRequest } from '../../src/experience/runtime';
import type { ReplayActionTarget } from '../../src/experience/replay/types';
import { pngDataUrl } from './promotion-png';

export const GENERIC_REPLAY_PROMPT = 'generic-replay-target';
export const GENERIC_ONESHOT_PROMPT = 'generic-one-shot-target';

/** 框架测试注入的无业务含义资格表；默认生产策略仍为空。 */
export const GENERIC_TEST_ACTION_POLICY: ExperienceActionPolicy = {
  version: 'policy@1',
  targets: [
    { prompt: GENERIC_REPLAY_PROMPT, repeatableFromCurrentState: true },
    { prompt: GENERIC_ONESHOT_PROMPT, repeatableFromCurrentState: false },
  ],
};

export function runtimeIdentity(
  overrides: Partial<RuntimeIdentity> = {},
): RuntimeIdentity {
  return {
    runId: 'run-framework',
    caseId: 'case-framework',
    casePath: 'tests/fixtures/experience-runtime.yaml',
    caseName: 'runtime-framework',
    stepPath: 'steps[0]',
    attempt: 0,
    projectName: 'android',
    ...overrides,
  };
}

export function runtimeRequest(
  prompt: string = GENERIC_REPLAY_PROMPT,
  extra: Partial<RuntimeRequest> = {},
): RuntimeRequest {
  return { prompt, node: 'experienceAct', ...extra };
}

export function injectedMatch(decision: 'match' | 'no-match'): ScreenMatchResult {
  const scores = {
    environment: { value: 1, threshold: 1, passed: true },
    screen: { value: decision === 'match' ? 1 : 0, threshold: 1, passed: decision === 'match' },
  };
  if (decision === 'match') {
    return {
      decision: 'match',
      reason: 'test-injected-match',
      timingMs: 0,
      configVersion: MATCHER_CONFIG_VERSION,
      dataVersion: MATCHER_DATA_VERSION,
      algorithm: { pipeline: 'png-sharp@1', phash: 'n/a', ncc: 'n/a', ssim: 'n/a' },
      scores,
    };
  }
  return {
    decision: 'no-match',
    code: 'page-mismatch',
    reason: 'test-injected-no-match',
    timingMs: 0,
    configVersion: MATCHER_CONFIG_VERSION,
    dataVersion: MATCHER_DATA_VERSION,
    algorithm: { pipeline: 'png-sharp@1', phash: 'n/a', ncc: 'n/a', ssim: 'n/a' },
    scores,
  };
}

/** 记录派发次数；lookup 阶段不应触达。 */
export class DispatchProbeTarget implements ReplayActionTarget {
  dispatches = 0;
  constructor(private readonly png: Uint8Array) {}
  async screenshotBase64(): Promise<string> {
    return pngDataUrl(this.png);
  }
  async callActionInActionSpace(): Promise<unknown> {
    this.dispatches += 1;
    throw new Error('lookup 不得向设备试点派发');
  }
}

export function silentReplayTarget(png: Uint8Array): ReplayActionTarget {
  return {
    screenshotBase64: async () => pngDataUrl(png),
    callActionInActionSpace: async () => undefined,
  };
}
