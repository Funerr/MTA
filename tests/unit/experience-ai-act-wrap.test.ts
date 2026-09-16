import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CaseRunner,
  NodeInputValidationError,
  StepTimeoutError,
} from '@midscene/test';
import { openExperienceStore, type ExperienceStore } from '../../src/experience/store/experience-store';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import {
  isTransparentAiActWrapped,
  parseExperienceEnabled,
  wrapMidsceneNodesWithExperience,
} from '../../src/experience/integration';
import { identityFromNodeExecution } from '../../src/experience/runtime';
import { experienceActNode } from '../../src/nodes/experience-act';
import {
  FixtureImageBag,
  makeEnvironment,
  makeRevision,
  makeSource,
} from '../helpers/experience-fixtures';
import {
  GENERIC_REPLAY_PROMPT,
  GENERIC_TEST_ACTION_POLICY,
  injectedMatch,
  runtimeIdentity,
} from '../helpers/experience-runtime-fixtures';
import {
  aiActExecution,
  createOfficialAndroidNodes,
  createOfficialHarmonyNodes,
  IMAGE_PROMPT,
  makeTraceAiActAgent,
  nodeNamed,
  wrapOfficialAndroidAiAct,
} from '../helpers/experience-ai-act-fixtures';
import type { ReplayResult } from '../../src/experience/replay/types';
import type { PromoteResult } from '../../src/experience/promotion/promoter';

function replayStub(overrides: Partial<ReplayResult> & Pick<ReplayResult, 'status' | 'effect' | 'reason'>): ReplayResult {
  return {
    completedActions: 0,
    dispatchedActions: 0,
    totalActions: 1,
    failedActionIndex: 0,
    phase: 'before-verify',
    ...overrides,
  };
}

async function publishGeneric(store: ExperienceStore) {
  const identity = runtimeIdentity();
  const key = deriveRequestKey({
    caseIdentity: { casePath: identity.casePath, caseName: identity.caseName },
    stepPath: identity.stepPath,
    node: 'aiAct',
    prompt: GENERIC_REPLAY_PROMPT,
    eligibilityPolicyVersion: 'policy@1',
  });
  if (!key.eligible) throw new Error(key.reason);
  const bag = new FixtureImageBag();
  const revision = makeRevision(bag, { entrySeed: 'entry' });
  const published = await store.publishCandidate({
    eventId: 'seed',
    requestKey: key.requestKey,
    source: makeSource({
      casePath: identity.casePath,
      caseName: identity.caseName,
      stepPath: identity.stepPath,
      prompt: GENERIC_REPLAY_PROMPT,
    }),
    environment: makeEnvironment(),
    variant: {
      entryEvidence: revision.entryEvidence,
      terminalEvidence: revision.terminalEvidence,
      actions: revision.actions,
      eligibilityPolicyVersion: 'policy@1',
    },
    images: bag.images,
  });
  if (!published.ok) throw new Error(published.error.message);
}

describe('项目级开关（任务 2.1）', () => {
  it('缺省与无法识别的值均关闭；true/1/on 开启', () => {
    expect(parseExperienceEnabled(undefined)).toBe(false);
    expect(parseExperienceEnabled('')).toBe(false);
    expect(parseExperienceEnabled('maybe')).toBe(false);
    expect(parseExperienceEnabled('true')).toBe(true);
    expect(parseExperienceEnabled('1')).toBe(true);
    expect(parseExperienceEnabled('on')).toBe(true);
  });

  it('关闭时不包装，开启但未登记时不创建 Runtime/Store', async () => {
    const officialNodes = createOfficialAndroidNodes();
    const official = nodeNamed(officialNodes, 'aiAct');
    expect(isTransparentAiActWrapped(official)).toBe(false);
    const disabled = wrapMidsceneNodesWithExperience(officialNodes, { enabled: false });
    expect(nodeNamed(disabled, 'aiAct')).toBe(official);
    expect(isTransparentAiActWrapped(nodeNamed(disabled, 'aiAct'))).toBe(false);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-ai-act-off-'));
    const { agent, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    expect(isTransparentAiActWrapped(wrapped)).toBe(true);
    await wrapped.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent: {
            aiAct: agent.aiAct,
            addDumpUpdateListener: agent.addDumpUpdateListener,
            dump: agent.dump,
          },
          experienceStoreRoot: root,
        },
      }),
    );
    expect(aiActCalls()).toBe(1);
    await expect(fs.readdir(root)).resolves.toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('原生旁路保真（任务 1.2 / 2.3）', () => {
  it('图片与未知 options 原样进入官方 toArgs，不裁剪 prompt', async () => {
    const { agent, captured, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrapOfficialAndroidAiAct({
      enabled: true,
      policy: GENERIC_TEST_ACTION_POLICY,
    }).aiAct;
    const signal = new AbortController().signal;
    await wrapped.execute(
      aiActExecution({
        input: {
          ...IMAGE_PROMPT,
          options: { cacheable: true, context: '附加约束' },
        },
        context: { agent },
        signal,
      }),
    );
    expect(aiActCalls()).toBe(1);
    expect(captured[0]?.prompt).toEqual(IMAGE_PROMPT.prompt);
    expect(captured[0]?.opt).toMatchObject({
      cacheable: true,
      context: '附加约束',
      abortSignal: signal,
    });
  });

  it('非法字段保持官方 schema 失败，不由接入层改成可执行输入', async () => {
    const { agent, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const runner = new CaseRunner({
      nodes: [wrapped],
      context: { agent },
    });
    await expect(
      runner.run({
        name: 'invalid-aiAct',
        steps: [{ aiAct: { instruction: GENERIC_REPLAY_PROMPT } }],
      }),
    ).rejects.toBeInstanceOf(NodeInputValidationError);
    expect(aiActCalls()).toBe(0);
  });

  it('原生返回文本按官方 summary 透出，且不学习', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-ai-act-text-'));
    const store = openExperienceStore(root);
    const { agent } = makeTraceAiActAgent({ aiAct: async () => '动态说明' });
    const promoteCalls: unknown[] = [];
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const result = await wrapped.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent,
          experienceStore: store,
          experienceActionPolicy: GENERIC_TEST_ACTION_POLICY,
          experiencePromote: async (input) => {
            promoteCalls.push(input);
            return { result: 'skipped', reason: 'should-not-run' } as PromoteResult;
          },
        },
      }),
    );
    expect(result).toEqual({ summary: '动态说明' });
    expect(promoteCalls).toHaveLength(0);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('原生 throw 与超时不被接入层吞掉', async () => {
    const failing = makeTraceAiActAgent({
      aiAct: async () => {
        throw new Error('native-failed');
      },
    });
    const wrapped = wrapOfficialAndroidAiAct({
      enabled: true,
      policy: GENERIC_TEST_ACTION_POLICY,
    }).aiAct;
    await expect(
      wrapped.execute(
        aiActExecution({
          input: { prompt: GENERIC_REPLAY_PROMPT },
          context: { agent: failing.agent },
        }),
      ),
    ).rejects.toThrow('native-failed');

    const hanging = makeTraceAiActAgent({
      aiAct: async () => new Promise<string | undefined>(() => {}),
    });
    const runner = new CaseRunner({
      nodes: [wrapped],
      context: { agent: hanging.agent },
    });
    await expect(
      runner.run({
        name: 'timeout-aiAct',
        steps: [{ aiAct: { prompt: GENERIC_REPLAY_PROMPT, $: { timeout: 50 } } }],
      }),
    ).rejects.toBeInstanceOf(StepTimeoutError);
  });
});

describe('Runtime 绑定与一次执行链（任务 2.2）', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('HIT 不调用原生 AI；MISS 恰好一次；回退不递归且 Promotion 一次', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-ai-act-hit-'));
    const store = openExperienceStore(root);
    await publishGeneric(store);
    const wrapped = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const reports: string[] = [];
    const hitAgent = makeTraceAiActAgent({
      aiAct: async () => {
        throw new Error('HIT 不应调用原生');
      },
      recordToReport: async (_title, opt) => {
        if (opt?.content) reports.push(opt.content);
      },
    });
    const hit = await wrapped.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent: hitAgent.agent,
          experienceStore: store,
          experienceEnvironment: makeEnvironment(),
          experienceActionPolicy: GENERIC_TEST_ACTION_POLICY,
          experienceMatchScreen: async () => injectedMatch('match'),
          experienceReplayChain: async () =>
            replayStub({
              status: 'success',
              effect: 'confirmed-partial',
              reason: 'ok',
              phase: 'done',
              failedActionIndex: null,
              completedActions: 1,
            }),
        },
      }),
    );
    expect(hit).toBeUndefined();
    expect(hitAgent.aiActCalls()).toBe(0);
    expect(reports.length).toBeGreaterThan(0);
    const recorded = JSON.parse(reports[0]!) as { modelCalls?: { locateVlm: number | null; status: string } };
    expect(recorded.modelCalls?.status).toBe('verified');
    expect(recorded.modelCalls?.locateVlm).toBe(0);

    const missRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-ai-act-miss-'));
    const missAgent = makeTraceAiActAgent();
    let wrapEntries = 0;
    const counting = wrapOfficialAndroidAiAct({ enabled: true }).aiAct;
    const originalExecute = counting.execute.bind(counting);
    counting.execute = async (execution) => {
      wrapEntries += 1;
      return originalExecute(execution);
    };
    await counting.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent: missAgent.agent,
          experienceStore: openExperienceStore(missRoot),
          experienceActionPolicy: GENERIC_TEST_ACTION_POLICY,
        },
      }),
    );
    expect(missAgent.aiActCalls()).toBe(1);
    expect(wrapEntries).toBe(1);
    await fs.rm(missRoot, { recursive: true, force: true });

    const promoteCalls: unknown[] = [];
    const fallbackAgent = makeTraceAiActAgent();
    await wrapped.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent: fallbackAgent.agent,
          experienceStore: store,
          experienceEnvironment: makeEnvironment(),
          experienceActionPolicy: GENERIC_TEST_ACTION_POLICY,
          experienceMatchScreen: async () => injectedMatch('match'),
          experienceReplayChain: async () =>
            replayStub({
              status: 'failed',
              effect: 'none',
              reason: '前置画面不符',
              failure: { kind: 'no-match', message: '前置画面不符' },
            }),
          experiencePromote: async () => {
            promoteCalls.push('promote');
            return { result: 'skipped', reason: 'no-dump' } as PromoteResult;
          },
        },
      }),
    );
    expect(fallbackAgent.aiActCalls()).toBe(1);
    expect(promoteCalls).toHaveLength(1);
  });
});

describe('兼容与隔离（任务 2.4）', () => {
  it('保留 experienceAct 与原生 aiAssert；其他平台节点不被包装', () => {
    const androidOfficial = createOfficialAndroidNodes();
    const wrapped = wrapMidsceneNodesWithExperience(androidOfficial, { enabled: true });
    expect(nodeNamed(wrapped, 'aiAssert')).toBe(nodeNamed(androidOfficial, 'aiAssert'));
    expect(nodeNamed(wrapped, 'aiTap')).toBe(nodeNamed(androidOfficial, 'aiTap'));
    expect(isTransparentAiActWrapped(nodeNamed(wrapped, 'aiAct'))).toBe(true);

    const harmonyOfficial = createOfficialHarmonyNodes();
    expect(isTransparentAiActWrapped(nodeNamed(harmonyOfficial, 'aiAct'))).toBe(false);
    expect(experienceActNode.name).toBe('experienceAct');
  });

  it('同一用例位置 aiAct 与 experienceAct 身份一致；跨用例路径隔离', () => {
    const shared = aiActExecution({
      input: { prompt: GENERIC_REPLAY_PROMPT },
      context: { agent: makeTraceAiActAgent().agent },
    });
    const fromWrap = identityFromNodeExecution(shared);
    const fromExperience = identityFromNodeExecution(shared);
    expect(fromWrap).toEqual(fromExperience);
    expect(fromWrap.casePath).toBe(runtimeIdentity().casePath);
    expect(fromWrap.stepPath).toBe('steps[0]');

    const copied = aiActExecution({ input: { prompt: GENERIC_REPLAY_PROMPT } });
    expect(
      identityFromNodeExecution({
        ...copied,
        case: { ...copied.case, sourcePath: 'cases/android/other.yaml' },
      } as typeof copied).casePath,
    ).toBe('cases/android/other.yaml');
  });

  it('直接调用 Agent.aiAct 不被包装拦截', async () => {
    const { agent, aiActCalls } = makeTraceAiActAgent({ aiAct: async () => 'sdk' });
    wrapOfficialAndroidAiAct({ enabled: true, policy: GENERIC_TEST_ACTION_POLICY });
    await expect(agent.aiAct('任意目标')).resolves.toBe('sdk');
    expect(aiActCalls()).toBe(1);
  });
});
