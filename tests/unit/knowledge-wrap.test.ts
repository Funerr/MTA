import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseRunner, NodeInputValidationError } from '@midscene/test';
import type { NodeDefinition } from '@midscene/test';
import type { AiActNodeInput } from '@midscene/test/midscene';
import {
  isKnowledgeAiActWrapped,
  wrapNodesWithKnowledge,
} from '../../src/knowledge/wrap';
import { KnowledgeIndexError } from '../../src/knowledge/loader';
import {
  aiActExecution,
  createOfficialAndroidNodes,
  IMAGE_PROMPT,
  makeTraceAiActAgent,
  nodeNamed,
} from '../helpers/experience-ai-act-fixtures';

describe('aiAct 知识注入包装（任务 2.1）', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-knowledge-wrap-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const setupIndex = async (
    entries: Array<{ id: string; triggers: string[]; body: string }>,
  ) => {
    await fs.mkdir(path.join(root, 'entries'), { recursive: true });
    const lines = ['entries:'];
    for (const item of entries) {
      const file = `entries/${item.id}.md`;
      await fs.writeFile(path.join(root, file), item.body, 'utf8');
      lines.push(
        `  - id: ${item.id}`,
        `    triggers: [${item.triggers.join(', ')}]`,
        `    file: ${file}`,
      );
    }
    await fs.writeFile(path.join(root, 'index.yaml'), lines.join('\n'), 'utf8');
  };

  const wrappedAiAct = (
    options: { enabled: boolean; root: string },
  ): NodeDefinition<any, any, any> =>
    nodeNamed(wrapNodesWithKnowledge(createOfficialAndroidNodes(), options), 'aiAct');

  it('关闭时返回原数组与原节点定义，不包装', () => {
    const official = createOfficialAndroidNodes();
    const disabled = wrapNodesWithKnowledge(official, { enabled: false, root });
    expect(disabled).toBe(official);
    expect(isKnowledgeAiActWrapped(nodeNamed(disabled, 'aiAct'))).toBe(false);
  });

  it('开启且未命中：原样透传，且不读取正文文件', async () => {
    await setupIndex([{ id: 'cc', triggers: ['控制中心'], body: '从顶部右侧下拉' }]);
    const { agent, captured, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await wrapped.execute(
      aiActExecution({ input: { prompt: '打开设置页' }, context: { agent } }),
    );
    expect(aiActCalls()).toBe(1);
    expect(captured[0]?.prompt).toBe('打开设置页');

    // 未命中步骤不读正文：删除正文后命中步骤才因读取失败暴露（证明此前未预读）。
    await fs.rm(path.join(root, 'entries', 'cc.md'));
    await expect(
      wrapped.execute(
        aiActExecution({ input: { prompt: '打开控制中心' }, context: { agent } }),
      ),
    ).rejects.toBeInstanceOf(KnowledgeIndexError);
  });

  it('命中注入：原 prompt + 固定标记 + 正文', async () => {
    await setupIndex([{ id: 'cc', triggers: ['控制中心'], body: '本机需从屏幕顶部右侧边缘下拉。\n' }]);
    const { agent, captured } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await wrapped.execute(
      aiActExecution({ input: { prompt: '打开控制中心' }, context: { agent } }),
    );
    expect(captured[0]?.prompt).toBe(
      '打开控制中心\n\n[knowledge:cc]\n本机需从屏幕顶部右侧边缘下拉。',
    );
  });

  it('多条命中按索引顺序注入且同一正文不重复；options 原样保留', async () => {
    await setupIndex([
      { id: 'first', triggers: ['控制中心'], body: '右侧下拉' },
      { id: 'second', triggers: ['通知', '控制中心'], body: '注意角标' },
    ]);
    const { agent, captured } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await wrapped.execute(
      aiActExecution({
        input: { prompt: '打开控制中心并查看通知', options: { cacheable: false } },
        context: { agent },
      }),
    );
    expect(captured[0]?.prompt).toBe(
      '打开控制中心并查看通知\n\n[knowledge:first]\n右侧下拉\n\n[knowledge:second]\n注意角标',
    );
    expect(captured[0]?.opt).toMatchObject({ cacheable: false });
  });

  it('重复命中走进程缓存：正文删除后仍可注入', async () => {
    await setupIndex([{ id: 'cc', triggers: ['控制中心'], body: '右侧下拉' }]);
    const { agent, captured } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await wrapped.execute(
      aiActExecution({ input: { prompt: '打开控制中心' }, context: { agent } }),
    );
    await fs.rm(path.join(root, 'entries', 'cc.md'));
    await wrapped.execute(
      aiActExecution({ input: { prompt: '再次打开控制中心' }, context: { agent } }),
    );
    expect(captured[1]?.prompt).toBe('再次打开控制中心\n\n[knowledge:cc]\n右侧下拉');
  });

  it('富媒体 prompt 不匹配不注入，原样透传', async () => {
    await setupIndex([{ id: 'cc', triggers: ['generic-replay-target'], body: '知识' }]);
    const { agent, captured } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await wrapped.execute(aiActExecution({ input: { ...IMAGE_PROMPT }, context: { agent } }));
    expect(captured[0]?.prompt).toEqual(IMAGE_PROMPT.prompt);
  });

  it('目录不存在视为未配置：不注入直接透传', async () => {
    const { agent, captured } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root: path.join(root, 'absent') });

    await wrapped.execute(
      aiActExecution({ input: { prompt: '打开控制中心' }, context: { agent } }),
    );
    expect(captured[0]?.prompt).toBe('打开控制中心');
  });

  it('索引非法：步骤显式失败并包含条目与原因', async () => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, 'index.yaml'),
      ['entries:', '  - id: broken', '    triggers: [t]', '    file: entries/absent.md'].join('\n'),
      'utf8',
    );
    const { agent, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });

    await expect(
      wrapped.execute(
        aiActExecution({ input: { prompt: '任意步骤' }, context: { agent } }),
      ),
    ).rejects.toThrow(/broken .*不存在/);
    expect(aiActCalls()).toBe(0);
  });

  it('非法字段保持官方 schema 失败，不由注入层改成可执行输入', async () => {
    await setupIndex([{ id: 'cc', triggers: ['控制中心'], body: '右侧下拉' }]);
    const { agent, aiActCalls } = makeTraceAiActAgent();
    const wrapped = wrappedAiAct({ enabled: true, root });
    const runner = new CaseRunner({ nodes: [wrapped], context: { agent } });

    await expect(
      runner.run({
        name: 'invalid-aiAct',
        steps: [{ aiAct: { instruction: '打开控制中心' } }],
      }),
    ).rejects.toBeInstanceOf(NodeInputValidationError);
    expect(aiActCalls()).toBe(0);
  });

  it('官方执行失败如实传播', async () => {
    await setupIndex([{ id: 'cc', triggers: ['控制中心'], body: '右侧下拉' }]);
    const failure = new Error('agent 失败');
    const { agent } = makeTraceAiActAgent({
      aiAct: async () => {
        throw failure;
      },
    });
    const wrapped = wrappedAiAct({ enabled: true, root });

    await expect(
      wrapped.execute(
        aiActExecution({
          input: { prompt: '打开控制中心' } as AiActNodeInput,
          context: { agent },
        }),
      ),
    ).rejects.toBe(failure);
  });

  it('已包装节点不重复包装', () => {
    const official = createOfficialAndroidNodes();
    const once = wrapNodesWithKnowledge(official, { enabled: true, root });
    const twice = wrapNodesWithKnowledge(once, { enabled: true, root });
    expect(nodeNamed(twice, 'aiAct')).toBe(nodeNamed(once, 'aiAct'));
  });
});
