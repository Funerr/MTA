import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { wrapMidsceneNodesWithExperience } from '../../src/experience/integration';
import { wrapNodesWithKnowledge } from '../../src/knowledge/wrap';
import {
  aiActExecution,
  createOfficialAndroidNodes,
  makeTraceAiActAgent,
  nodeNamed,
} from '../helpers/experience-ai-act-fixtures';
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
import type { ReplayResult } from '../../src/experience/replay/types';
import type { PromoteResult } from '../../src/experience/promotion/promoter';
import type { ExperienceStore } from '../../src/experience/store/experience-store';

/**
 * 知识注入与 Experience 透明接入的叠加组合（任务 3.3）。
 * 知识触发词命中 GENERIC_REPLAY_PROMPT 本身：凡是走向原生规划的路径都必须注入，
 * 而经验匹配/重放路径不得受注入影响。
 */

function replayStub(
  overrides: Partial<ReplayResult> & Pick<ReplayResult, 'status' | 'effect' | 'reason'>,
): ReplayResult {
  return {
    completedActions: 0,
    dispatchedActions: 0,
    totalActions: 1,
    failedActionIndex: 0,
    phase: 'before-verify',
    ...overrides,
  };
}

async function publishGeneric(store: ExperienceStore, prompt = GENERIC_REPLAY_PROMPT) {
  const identity = runtimeIdentity();
  const key = deriveRequestKey({
    caseIdentity: { casePath: identity.casePath, caseName: identity.caseName },
    stepPath: identity.stepPath,
    node: 'aiAct',
    prompt,
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
      prompt,
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

describe('knowledge × experience 四组合（任务 3.3）', () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  async function knowledgeRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-knowledge-stack-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'entries'), { recursive: true });
    await fs.writeFile(path.join(root, 'entries', 'generic.md'), '知识正文', 'utf8');
    await fs.writeFile(
      path.join(root, 'index.yaml'),
      [
        'entries:',
        '  - id: generic',
        `    triggers: [${GENERIC_REPLAY_PROMPT}]`,
        '    file: entries/generic.md',
      ].join('\n'),
      'utf8',
    );
    return root;
  }

  const compose = (knowledge: { enabled: boolean; root: string }) =>
    wrapMidsceneNodesWithExperience(
      wrapNodesWithKnowledge(createOfficialAndroidNodes(), knowledge),
      { enabled: true },
    );

  it('双关：经验 HIT 使用原始 instruction 匹配，重放路径不注入', async () => {
    const root = await knowledgeRoot();
    const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-stack-store-'));
    roots.push(storeRoot);
    const store = openExperienceStore(storeRoot);
    await publishGeneric(store);

    const aiAct = nodeNamed(compose({ enabled: true, root }), 'aiAct');
    const hitAgent = makeTraceAiActAgent({
      aiAct: async () => {
        throw new Error('HIT 不应调用原生');
      },
    });
    await expect(
      aiAct.execute(
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
      ),
    ).resolves.toBeUndefined();
    expect(hitAgent.aiActCalls()).toBe(0);
  });

  it('双关：MISS 回退原生时必得注入（原生收到增强 prompt），不递归', async () => {
    const root = await knowledgeRoot();
    const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-stack-miss-'));
    roots.push(storeRoot);
    const store = openExperienceStore(storeRoot);
    await publishGeneric(store);

    const aiAct = nodeNamed(compose({ enabled: true, root }), 'aiAct');
    let wrapEntries = 0;
    const originalExecute = aiAct.execute.bind(aiAct);
    aiAct.execute = async (execution) => {
      wrapEntries += 1;
      return originalExecute(execution);
    };
    const fallbackAgent = makeTraceAiActAgent();
    await aiAct.execute(
      aiActExecution({
        input: { prompt: GENERIC_REPLAY_PROMPT },
        context: {
          agent: fallbackAgent.agent,
          experienceStore: store,
          experienceActionPolicy: GENERIC_TEST_ACTION_POLICY,
          experienceMatchScreen: async () => injectedMatch('match'),
          experienceReplayChain: async () =>
            replayStub({
              status: 'failed',
              effect: 'none',
              reason: '前置画面不符',
              failure: { kind: 'no-match', message: '前置画面不符' },
            }),
          experiencePromote: async () =>
            ({ result: 'skipped', reason: 'no-dump' }) as PromoteResult,
        },
      }),
    );
    expect(fallbackAgent.aiActCalls()).toBe(1);
    expect(wrapEntries).toBe(1);
    expect(fallbackAgent.captured[0]?.prompt).toBe(
      `${GENERIC_REPLAY_PROMPT}\n\n[knowledge:generic]\n知识正文`,
    );
  });

  it('仅 experience：无知识时旁路原生收到原始 prompt', async () => {
    const root = await knowledgeRoot();
    const aiAct = nodeNamed(compose({ enabled: false, root }), 'aiAct');
    const { agent, captured } = makeTraceAiActAgent();
    await aiAct.execute(
      aiActExecution({ input: { prompt: GENERIC_REPLAY_PROMPT }, context: { agent } }),
    );
    expect(captured[0]?.prompt).toBe(GENERIC_REPLAY_PROMPT);
  });

  it('仅 knowledge：无经验包装时注入照常生效', async () => {
    const root = await knowledgeRoot();
    const aiAct = nodeNamed(
      wrapNodesWithKnowledge(createOfficialAndroidNodes(), { enabled: true, root }),
      'aiAct',
    );
    const { agent, captured } = makeTraceAiActAgent();
    await aiAct.execute(
      aiActExecution({ input: { prompt: GENERIC_REPLAY_PROMPT }, context: { agent } }),
    );
    expect(captured[0]?.prompt).toBe(`${GENERIC_REPLAY_PROMPT}\n\n[knowledge:generic]\n知识正文`);
  });
});
