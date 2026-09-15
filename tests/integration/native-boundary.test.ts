import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectWorkflowDocument,
  runWorkflowDocument,
  CaseRunner,
  NodeInputValidationError,
  StepTimeoutError,
  type CaseRunOutcome,
  type WorkflowDocumentExecutionResult,
} from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';
import type { AndroidAgent } from '@midscene/android';
import {
  devicePrepareNode,
  deviceRecoverNode,
} from '../../src/nodes/device-lifecycle';

/**
 * 原生边界集成验证：加载实际锁定的 @midscene/test / @midscene/android 包与
 * 真实 midscene.config.ts 的官方 Node 定义，仅把设备/Agent 边界替换为受控替身。
 * 覆盖范围（替身层）：Node 注册、输入校验、生命周期、失败/超时/取消传播、
 * 结果与步骤的关联。未覆盖：真实硬件行为与模型调用（见 docs/acceptance.md）。
 */

const configPath = fileURLToPath(new URL('../../midscene.config.ts', import.meta.url));
const fixturePath = fileURLToPath(new URL('../fixtures/lifecycle-boundary.yaml', import.meta.url));

/** 受控 Agent 替身：按调用序决定 home 行为，并记录调用次数。 */
function makeAgentScript(homeBehaviors: Array<() => Promise<void>>) {
  let homeCalls = 0;
  const agent = {
    home: async () => {
      const behavior =
        homeBehaviors[homeCalls] ?? homeBehaviors[homeBehaviors.length - 1];
      if (!behavior) return;
      homeCalls += 1;
      await behavior();
    },
  };
  return {
    agent: agent as unknown as AndroidAgent,
    homeCallCount: () => homeCalls,
  };
}

const ok = () => Promise.resolve();
const fail = (message: string) => () => Promise.reject(new Error(message));

describe('真实配置加载与 Node 注册', () => {
  it('加载 midscene.config.ts：单 android 项目、串行并发、业务发现范围不含 tests/', async () => {
    const loaded = await loadTestProject(configPath);
    expect(loaded.projects).toHaveLength(1);
    const project = loaded.projects[0]!;
    expect(project.name).toBe('android');
    expect(loaded.test.maxConcurrency).toBe(1);
    expect(project.files?.include).toContain('cases/**/*.{yaml,yml}');
    expect(project.files?.exclude).toContain('tests/**/*.{yaml,yml}');
  });

  it('注册原生 AI/设备 Nodes 与框架生命周期 Nodes', async () => {
    const loaded = await loadTestProject(configPath);
    for (const name of [
      'aiAct',
      'aiAssert',
      'aiTap',
      'launch',
      'terminate',
      'runAdbShell',
      'back',
      'home',
      'recentApps',
      'device.prepare',
      'device.recover',
    ]) {
      expect(loaded.resolveNode(name), `node ${name}`).toBeDefined();
    }
    expect(loaded.resolveNode('device.unknown')).toBeUndefined();
  });

  it('aiAct / aiAssert 保留原生输入契约（prompt 必填、严格字段）', async () => {
    const loaded = await loadTestProject(configPath);
    const aiAct = loaded.resolveNode('aiAct')!;
    const aiAssert = loaded.resolveNode('aiAssert')!;

    expect(() => aiAct.inputSchema!.parse({ prompt: '打开设置' })).not.toThrow();
    expect(() => aiAct.inputSchema!.parse({ instruction: '打开设置' })).toThrow();
    expect(() => aiAct.inputSchema!.parse({})).toThrow();

    expect(() =>
      aiAssert.inputSchema!.parse({ prompt: '屏幕显示主屏' }),
    ).not.toThrow();
    expect(() =>
      aiAssert.inputSchema!.parse({ prompt: '屏幕显示主屏', message: '应在主屏' }),
    ).not.toThrow();
    expect(() => aiAssert.inputSchema!.parse({ assertion: '屏幕显示主屏' })).toThrow();
  });
});

async function runFixture(
  agent: AndroidAgent,
  options: { signal?: AbortSignal } = {},
): Promise<WorkflowDocumentExecutionResult> {
  const loaded = await loadTestProject(configPath);
  const document = collectWorkflowDocument(
    {
      projectId: 'android',
      projectName: 'android',
      sourcePath: 'tests/fixtures/lifecycle-boundary.yaml',
      absolutePath: fixturePath,
    },
    { resolveNode: loaded.resolveNode },
  );
  return runWorkflowDocument(document, {
    resolveNode: (name) => loaded.resolveNode(name)!,
    projectContext: { agent } as never,
    defaultTimeoutMs: 5_000,
    signal: options.signal,
  });
}

describe('原生生命周期执行（Agent 替身）', () => {
  it('准备、步骤、恢复全部成功：home 被调用三次，用例成功', async () => {
    const { agent, homeCallCount } = makeAgentScript([ok]);
    const result = await runFixture(agent);
    const outcome = result.cases[0]!;

    expect(outcome.status).toBe('success');
    expect(homeCallCount()).toBe(3);
    const run = outcome.run!;
    expect(run.beforeEach.map((s) => s.status)).toEqual(['success']);
    expect(run.steps.map((s) => s.status)).toEqual(['success']);
    expect(run.afterEach.map((s) => s.status)).toEqual(['success']);
  });

  it('准备失败：步骤不执行，afterEach 恢复仍运行，最终失败可定位', async () => {
    const { agent, homeCallCount } = makeAgentScript([fail('home 不可用'), ok]);
    const result = await runFixture(agent);
    const outcome = result.cases[0]!;

    expect(outcome.status).toBe('failed');
    const run = outcome.run!;
    expect(run.beforeEach[0]!.status).toBe('failed');
    expect(String(run.beforeEach[0]!.error)).toContain('home 不可用');
    expect(run.steps).toEqual([]);
    expect(run.afterEach[0]!.status).toBe('success');
    expect(homeCallCount()).toBe(2);
  });

  it('步骤失败：准备已成功，恢复仍运行，原始失败保留', async () => {
    const { agent } = makeAgentScript([ok, fail('步骤中断'), ok]);
    const result = await runFixture(agent);
    const outcome = result.cases[0]!;

    expect(outcome.status).toBe('failed');
    const run = outcome.run!;
    expect(run.beforeEach[0]!.status).toBe('success');
    expect(run.steps[0]!.status).toBe('failed');
    expect(String(run.steps[0]!.error)).toContain('步骤中断');
    expect(run.afterEach[0]!.status).toBe('success');
  });

  it('步骤与恢复同时失败：两种失败都保留且不互相覆盖', async () => {
    const { agent } = makeAgentScript([ok, fail('步骤失败'), fail('恢复失败')]);
    const result = await runFixture(agent);
    const outcome = result.cases[0]!;

    expect(outcome.status).toBe('failed');
    const run = outcome.run!;
    expect(run.steps[0]!.status).toBe('failed');
    expect(String(run.steps[0]!.error)).toContain('步骤失败');
    expect(run.afterEach[0]!.status).toBe('failed');
    expect(String(run.afterEach[0]!.error)).toContain('恢复失败');
  });
});

describe('取消与超时传播（原生运行器行为）', () => {
  it('执行前已取消：用例不运行，不派发设备操作', async () => {
    const { agent, homeCallCount } = makeAgentScript([ok]);
    const controller = new AbortController();
    controller.abort();
    const result = await runFixture(agent, { signal: controller.signal });

    const outcome: CaseRunOutcome = result.cases[0]!;
    expect(outcome.status).toBe('not-run');
    expect(outcome.notRunReason).toBe('interrupted');
    expect(homeCallCount()).toBe(0);
  });

  it('步骤超时：原生 StepTimeout 语义生效，失败不被吞掉', async () => {
    const loaded = await loadTestProject(configPath);
    const { agent, homeCallCount } = makeAgentScript([
      ok,
      () => new Promise<void>(() => {}),
    ]);
    const runner = new CaseRunner({
      nodes: [devicePrepareNode, deviceRecoverNode, loaded.resolveNode('home')!],
      context: { agent } as never,
    });
    // 原生独立运行器把首个未 continue-on-error 的失败步骤错误向外抛出
    await expect(
      runner.run({
        name: 'timeout-check',
        steps: [
          { 'device.prepare': { target: 'home' } },
          { home: { $: { timeout: 50 } } },
          { 'device.recover': {} },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(StepTimeoutError);
      expect(String(error)).toMatch(/timeout/i);
      return true;
    });
    // home 恰好派发两次：prepare 成功一次、超时步骤挂起一次；
    // 超时失败后 recover 步骤不再执行
    expect(homeCallCount()).toBe(2);
  });
});

describe('运行器级输入校验（真实 NodeInputValidation 管线）', () => {
  it('非法输入在校验层失败，不执行设备动作', async () => {
    const { agent, homeCallCount } = makeAgentScript([ok]);
    const runner = new CaseRunner({
      nodes: [devicePrepareNode, deviceRecoverNode],
      context: { agent } as never,
    });
    await expect(
      runner.run({
        name: 'validation-check',
        steps: [{ 'device.prepare': { target: 'launcher' } }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NodeInputValidationError);
      expect(String(error)).toContain('device.prepare');
      return true;
    });
    expect(homeCallCount()).toBe(0);
  });

  it('device.recover 未声明字段同样在校验层失败', async () => {
    const { agent, homeCallCount } = makeAgentScript([ok]);
    const runner = new CaseRunner({
      nodes: [deviceRecoverNode],
      context: { agent } as never,
    });
    await expect(
      runner.run({
        name: 'recover-validation-check',
        steps: [{ 'device.recover': { reset: true } }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(NodeInputValidationError);
      expect(String(error)).toContain('device.recover');
      return true;
    });
    expect(homeCallCount()).toBe(0);
  });
});
