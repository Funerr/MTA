import { describe, expect, it } from 'vitest';
import { EMPTY_ACTION_POLICY } from '../../src/experience/runtime';
import {
  evaluateTransparentAiActAccess,
  SUPPORTED_AI_ACT_OPTION_KEYS,
  TRANSPARENT_REPLAY_RESULT_CATEGORY,
} from '../../src/experience/integration';
import { IMAGE_PROMPT } from '../helpers/experience-ai-act-fixtures';
import {
  GENERIC_REPLAY_PROMPT,
  GENERIC_TEST_ACTION_POLICY,
  runtimeIdentity,
} from '../helpers/experience-runtime-fixtures';

const identity = runtimeIdentity();

describe('透明 aiAct 资格矩阵（任务 1.2）', () => {
  it('声明支持集为空：纯文本已登记目标才是重放候选，结果资格仅 undefined', () => {
    expect(SUPPORTED_AI_ACT_OPTION_KEYS).toEqual([]);
    expect(TRANSPARENT_REPLAY_RESULT_CATEGORY).toBe('undefined');
    const hit = evaluateTransparentAiActAccess(
      { prompt: GENERIC_REPLAY_PROMPT },
      GENERIC_TEST_ACTION_POLICY,
      identity,
    );
    expect(hit.kind).toBe('replay-candidate');
    if (hit.kind === 'replay-candidate') expect(hit.prompt).toBe(GENERIC_REPLAY_PROMPT);
  });

  it('图片 prompt 旁路，不把内部文本裁成可缓存请求', () => {
    const result = evaluateTransparentAiActAccess(
      IMAGE_PROMPT,
      GENERIC_TEST_ACTION_POLICY,
      identity,
    );
    expect(result).toMatchObject({ kind: 'bypass', code: 'rich-media-prompt' });
  });

  it('未知 options / context 组合旁路，保留全部键', () => {
    const withOptions = evaluateTransparentAiActAccess(
      { prompt: GENERIC_REPLAY_PROMPT, options: { cacheable: true, deepThink: true } },
      GENERIC_TEST_ACTION_POLICY,
      identity,
    );
    expect(withOptions).toMatchObject({ kind: 'bypass', code: 'unsupported-options' });
    if (withOptions.kind === 'bypass') {
      expect(withOptions.reason).toMatch(/cacheable/);
      expect(withOptions.reason).toMatch(/deepThink/);
    }

    const withContext = evaluateTransparentAiActAccess(
      { prompt: GENERIC_REPLAY_PROMPT, options: { context: '请判断当前页' } },
      GENERIC_TEST_ACTION_POLICY,
      identity,
    );
    expect(withContext.kind).toBe('bypass');
    expect(withContext.kind === 'bypass' && withContext.code).toBe('unsupported-options');
  });

  it('未登记目标和含判断请求旁路；默认空策略全部原生', () => {
    const unregistered = evaluateTransparentAiActAccess(
      { prompt: '断言屏幕显示主屏' },
      GENERIC_TEST_ACTION_POLICY,
      identity,
    );
    expect(unregistered.kind).toBe('bypass');

    const empty = evaluateTransparentAiActAccess(
      { prompt: GENERIC_REPLAY_PROMPT },
      EMPTY_ACTION_POLICY,
      identity,
    );
    expect(empty).toMatchObject({ kind: 'bypass', code: 'unregistered-target' });
  });
});
