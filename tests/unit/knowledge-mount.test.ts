import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { wrapNodesWithKnowledge } from '../../src/knowledge/wrap';
import {
  wrapMidsceneNodesWithExperience,
  isTransparentAiActWrapped,
} from '../../src/experience/integration';
import {
  aiActExecution,
  createOfficialAndroidNodes,
  makeTraceAiActAgent,
  nodeNamed,
} from '../helpers/experience-ai-act-fixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('配置组装：knowledge 内层、experience 外层（任务 3.1）', () => {
  it('midscene.config.ts 两个单设备项目均按 experience(knowledge(official)) 组装', async () => {
    const source = await fs.readFile(path.join(repoRoot, 'midscene.config.ts'), 'utf8');
    const composed = source.match(/wrapMidsceneNodesWithExperience\(\s*wrapNodesWithKnowledge\(/g);
    expect(composed?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('const knowledgeInjection = loadKnowledgeInjectionConfig()');
    expect(source).toContain('knowledge: knowledgeInjection');
  });

  it('knowledge 关闭时组合退化为仅 experience 包装，节点与官方一致', () => {
    const official = createOfficialAndroidNodes();
    expect(wrapNodesWithKnowledge(official, { enabled: false, root: 'knowledge' })).toBe(
      official,
    );
  });

  it('knowledge 开启时组合后 aiAct 为 experience 包装，且注入在 experience 旁路下生效', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-knowledge-cfg-'));
    await fs.mkdir(path.join(root, 'entries'), { recursive: true });
    await fs.writeFile(path.join(root, 'entries', 'cc.md'), '右侧下拉', 'utf8');
    await fs.writeFile(
      path.join(root, 'index.yaml'),
      ['entries:', '  - id: cc', '    triggers: [控制中心]', '    file: entries/cc.md'].join('\n'),
      'utf8',
    );
    try {
      const composed = wrapMidsceneNodesWithExperience(
        wrapNodesWithKnowledge(createOfficialAndroidNodes(), {
          enabled: true,
          root,
        }),
        { enabled: true },
      );
      const aiAct = nodeNamed(composed, 'aiAct');
      expect(isTransparentAiActWrapped(aiAct)).toBe(true);

      // experience 默认空策略 → 旁路原生：注入必须仍在原生路径生效。
      const { agent, captured } = makeTraceAiActAgent();
      await aiAct.execute(
        aiActExecution({ input: { prompt: '打开控制中心' }, context: { agent } }),
      );
      expect(captured[0]?.prompt).toBe('打开控制中心\n\n[knowledge:cc]\n右侧下拉');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('multi-device：先知识包装再别名化（任务 3.2）', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-knowledge-md-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const setupIndex = async () => {
    await fs.mkdir(path.join(root, 'entries'), { recursive: true });
    await fs.writeFile(path.join(root, 'entries', 'cc.md'), '本别名设备同样右侧下拉', 'utf8');
    await fs.writeFile(
      path.join(root, 'index.yaml'),
      ['entries:', '  - id: cc', '    triggers: [控制中心]', '    file: entries/cc.md'].join('\n'),
      'utf8',
    );
  };

  const executionFor = (input: { prompt: string }, agent: unknown) =>
    ({
      input,
      $: { continueOnError: false, timeoutMs: undefined },
      signal: new AbortController().signal,
      context: { devices: { phone1: { agent } } },
      onTeardown() {},
      report: { addTrace() {} },
      scope: 'case',
      case: {
        caseId: 'case-1',
        runId: 'run-1',
        projectName: 'multi-device',
        attemptIndex: 0,
        name: 'knowledge',
        sourcePath: 'cases/knowledge.md',
        caseIndex: 0,
        phase: 'steps',
        stepIndex: 0,
      },
    }) as never;

  it('DUT alias 的 aiAct 命中触发词时与单设备项目同等注入', async () => {
    await setupIndex();
    const { createMultiDeviceNodes } = await import('../../src/nodes/multi-device');
    const { TEST_MULTI_DEVICE_BINDINGS } = await import('../helpers/multi-device-fixtures');
    const nodes = createMultiDeviceNodes([...TEST_MULTI_DEVICE_BINDINGS], {
      knowledge: { enabled: true, root },
    });
    const aliasedAiAct = nodes.find((node) => node.name === 'phone1.aiAct');
    expect(aliasedAiAct).toBeDefined();

    const { agent, captured } = makeTraceAiActAgent();
    await aliasedAiAct!.execute(executionFor({ prompt: '打开控制中心' }, agent));
    expect(captured[0]?.prompt).toBe(
      '打开控制中心\n\n[knowledge:cc]\n本别名设备同样右侧下拉',
    );
  });

  it('knowledge 未配置时 alias 节点行为不变（不注入）', async () => {
    await setupIndex();
    const { createMultiDeviceNodes } = await import('../../src/nodes/multi-device');
    const { TEST_MULTI_DEVICE_BINDINGS } = await import('../helpers/multi-device-fixtures');
    const nodes = createMultiDeviceNodes([...TEST_MULTI_DEVICE_BINDINGS]);
    const aliasedAiAct = nodes.find((node) => node.name === 'phone1.aiAct');

    const { agent, captured } = makeTraceAiActAgent();
    await aliasedAiAct!.execute(executionFor({ prompt: '打开控制中心' }, agent));
    expect(captured[0]?.prompt).toBe('打开控制中心');
  });
});
