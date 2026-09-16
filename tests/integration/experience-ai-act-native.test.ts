import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CaseRunner, collectWorkflowDocument } from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';
import {
  isTransparentAiActWrapped,
  wrapMidsceneNodesWithExperience,
} from '../../src/experience/integration';
import {
  createOfficialAndroidNodes,
  makeTraceAiActAgent,
  nodeNamed,
  wrapOfficialAndroidAiAct,
} from '../helpers/experience-ai-act-fixtures';
import { GENERIC_REPLAY_PROMPT, GENERIC_TEST_ACTION_POLICY } from '../helpers/experience-runtime-fixtures';

const configPath = fileURLToPath(new URL('../../midscene.config.ts', import.meta.url));
const fixturePath = fileURLToPath(new URL('../fixtures/experience-ai-act.yaml', import.meta.url));
const bypassFixturePath = fileURLToPath(
  new URL('../fixtures/experience-ai-act-bypass.yaml', import.meta.url),
);

describe('真实配置关闭模式（任务 2.1 / 2.4 / 3.1）', () => {
  it('加载 midscene.config.ts 时默认不包装 aiAct，并保留 experienceAct / aiAssert', async () => {
    const loaded = await loadTestProject(configPath);
    const android = loaded.projects[0]!;
    const harmony = loaded.projects[1]!;
    expect(isTransparentAiActWrapped(android.nodes.get('aiAct'))).toBe(false);
    expect(isTransparentAiActWrapped(harmony.nodes.get('aiAct'))).toBe(false);
    expect(android.nodes.get('experienceAct')).toBe(harmony.nodes.get('experienceAct'));
    expect(android.nodes.get('aiAssert')).toBeDefined();
    expect(android.nodes.get('aiAct')).not.toBe(harmony.nodes.get('aiAct'));
  });

  it('最小 YAML 夹具按 stringInputKey 解析 aiAct，步骤名仍是 aiAct', async () => {
    const loaded = await loadTestProject(configPath);
    const android = loaded.projects[0]!;
    const document = collectWorkflowDocument(
      {
        projectId: 'android',
        projectName: 'android',
        sourcePath: 'tests/fixtures/experience-ai-act.yaml',
        absolutePath: fixturePath,
      },
      { resolveNode: (name) => android.nodes.get(name) },
    );
    expect(document.cases[0]?.definition.steps[0]).toMatchObject({
      node: 'aiAct',
      input: { prompt: GENERIC_REPLAY_PROMPT },
    });
  });

  it('旁路 YAML 保留图片、未知 options 与含判断 prompt，不改写成纯文本缓存键', async () => {
    const loaded = await loadTestProject(configPath);
    const android = loaded.projects[0]!;
    const document = collectWorkflowDocument(
      {
        projectId: 'android',
        projectName: 'android',
        sourcePath: 'tests/fixtures/experience-ai-act-bypass.yaml',
        absolutePath: bypassFixturePath,
      },
      { resolveNode: (name) => android.nodes.get(name) },
    );
    const steps = document.cases[0]?.definition.steps ?? [];
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({
      node: 'aiAct',
      input: {
        prompt: {
          prompt: GENERIC_REPLAY_PROMPT,
          images: [{ name: 'ref', url: 'data:image/png;base64,aaa' }],
        },
      },
    });
    expect(steps[1]).toMatchObject({
      node: 'aiAct',
      input: {
        prompt: GENERIC_REPLAY_PROMPT,
        options: { cacheable: true, context: '请确认屏幕文案' },
      },
    });
    expect(steps[2]).toMatchObject({
      node: 'aiAct',
      input: { prompt: '断言屏幕显示主屏' },
    });
  });
});

describe('同一 YAML 开关对照（任务 3.1）', () => {
  it('关闭走原生 AI，开启命中时不调用 AI，步骤仍识别为 aiAct', async () => {
    const official = createOfficialAndroidNodes();
    const off = wrapMidsceneNodesWithExperience(official, { enabled: false });
    const on = wrapMidsceneNodesWithExperience(official, {
      enabled: true,
      policy: GENERIC_TEST_ACTION_POLICY,
    });
    expect(isTransparentAiActWrapped(nodeNamed(off, 'aiAct'))).toBe(false);
    expect(isTransparentAiActWrapped(nodeNamed(on, 'aiAct'))).toBe(true);

    const parsedOff = collectWorkflowDocument(
      {
        projectId: 'android',
        projectName: 'android',
        sourcePath: 'tests/fixtures/experience-ai-act.yaml',
        absolutePath: fixturePath,
      },
      { resolveNode: (name) => nodeNamed(off, name) },
    );
    const parsedOn = collectWorkflowDocument(
      {
        projectId: 'android',
        projectName: 'android',
        sourcePath: 'tests/fixtures/experience-ai-act.yaml',
        absolutePath: fixturePath,
      },
      { resolveNode: (name) => nodeNamed(on, name) },
    );
    expect(parsedOff.cases[0]?.definition.steps[0]).toEqual(parsedOn.cases[0]?.definition.steps[0]);
    expect(parsedOn.cases[0]?.definition.steps[0]?.node).toBe('aiAct');

    const offAgent = makeTraceAiActAgent();
    const offRunner = new CaseRunner({
      nodes: [nodeNamed(off, 'aiAct')],
      context: { agent: offAgent.agent },
    });
    const offResult = await offRunner.run({
      name: 'aiAct 透明接入检查',
      steps: [{ aiAct: GENERIC_REPLAY_PROMPT }],
    });
    expect(offResult.status).toBe('success');
    expect(offResult.steps[0]?.node).toBe('aiAct');
    expect(offAgent.aiActCalls()).toBe(1);

    const onBypassAgent = makeTraceAiActAgent();
    const onRunner = new CaseRunner({
      nodes: [wrapOfficialAndroidAiAct({ enabled: true }).aiAct],
      context: { agent: onBypassAgent.agent },
    });
    const onResult = await onRunner.run({
      name: 'aiAct 透明接入检查',
      steps: [{ aiAct: GENERIC_REPLAY_PROMPT }],
    });
    expect(onResult.status).toBe('success');
    expect(onResult.steps[0]?.node).toBe('aiAct');
    expect(onBypassAgent.aiActCalls()).toBe(1);
  });

  it('aiAssert 不被透明接入拦截', async () => {
    const official = createOfficialAndroidNodes();
    const wrapped = wrapMidsceneNodesWithExperience(official, { enabled: true });
    expect(nodeNamed(wrapped, 'aiAssert')).toBe(nodeNamed(official, 'aiAssert'));
    let asserted = 0;
    const agent = {
      ...makeTraceAiActAgent().agent,
      aiAssert: async () => {
        asserted += 1;
        return { pass: true };
      },
    };
    const runner = new CaseRunner({
      nodes: [nodeNamed(wrapped, 'aiAssert')],
      context: { agent },
    });
    const result = await runner.run({
      name: 'assert-check',
      steps: [{ aiAssert: '屏幕显示主屏' }],
    });
    expect(result.status).toBe('success');
    expect(asserted).toBe(1);
  });
});
