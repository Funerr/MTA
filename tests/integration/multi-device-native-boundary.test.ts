import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CaseRunner,
  NodeInputValidationError,
  StepTimeoutError,
  collectWorkflowDocument,
  runWorkflowDocument,
  WorkflowParseError,
} from '@midscene/test';
import { discoverTestFiles, loadTestProject } from '@midscene/test/config';
import { createMultiDeviceNodes } from '../../src/nodes/multi-device';
import { DeviceParallelStepError } from '../../src/nodes/device-parallel-run';
import { loadMultiDeviceBindings } from '../../src/setup/multi-device-config';
import type { MultiDeviceProjectContext } from '../../src/setup/multi-device';
import {
  SAME_PLATFORM_BINDINGS,
  TEST_MULTI_DEVICE_BINDINGS,
  nodeNamed,
} from '../helpers/multi-device-fixtures';

const configPath = fileURLToPath(new URL('../../midscene.config.ts', import.meta.url));
const interleavePath = fileURLToPath(
  new URL('../fixtures/multi-device-interleave.yaml', import.meta.url),
);
const parallelPath = fileURLToPath(
  new URL('../fixtures/multi-device-parallel.yaml', import.meta.url),
);
const unknownPath = fileURLToPath(
  new URL('../fixtures/multi-device-unknown.yaml', import.meta.url),
);
const unsupportedPath = fileURLToPath(
  new URL('../fixtures/multi-device-unsupported.yaml', import.meta.url),
);
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAgent(label: string) {
  const events: string[] = [];
  let gate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;
  const agent = {
    home: async ({ signal }: { signal?: AbortSignal } = {}) => {
      events.push(`${label}:home:start`);
      const pending = gate;
      if (pending) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(signal?.reason ?? new Error('aborted'));
          if (signal?.aborted) return onAbort();
          signal?.addEventListener('abort', onAbort, { once: true });
          pending.then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      }
      events.push(`${label}:home:end`);
    },
    destroy: async () => {
      events.push(`${label}:destroy`);
    },
    runAdbShell: async (command: string) => {
      events.push(`${label}:adb:${command}`);
      return 'ok';
    },
    runHdcShell: async (command: string) => {
      events.push(`${label}:hdc:${command}`);
      return 'ok';
    },
    addDumpUpdateListener(
      listener: (dump: string, ref?: { id?: string }) => void,
    ) {
      listener('{}', { id: `exec-${label}-${events.length}` });
      return () => undefined;
    },
  };
  return {
    agent,
    events,
    hold() {
      gate = new Promise((resolve) => {
        releaseGate = resolve;
      });
    },
    release() {
      releaseGate?.();
    },
  };
}

function wrapHome(
  agent: ReturnType<typeof makeAgent>['agent'],
  impl: () => Promise<void>,
) {
  agent.home = async () => impl();
}

function contextOf(
  phone1: { agent: unknown },
  phone2: { agent: unknown },
  platforms: { phone1: 'android' | 'harmony'; phone2: 'android' | 'harmony' } = {
    phone1: 'android',
    phone2: 'harmony',
  },
): MultiDeviceProjectContext {
  return {
    devices: {
      phone1: { platform: platforms.phone1, id: 'emu-1', agent: phone1.agent as never },
      phone2: { platform: platforms.phone2, id: 'har-1', agent: phone2.agent as never },
    },
  };
}

function resolveFrom(
  nodes: readonly { name: string }[],
) {
  const map = new Map(nodes.map((node) => [node.name, node]));
  return (name: string) => map.get(name) as never;
}

describe('2.3 协作项目发现范围与配置加载', () => {
  it('loadTestProject 含 multi-device，且不把 android/harmony 用例目录算进协作项目', async () => {
    const loaded = await loadTestProject(configPath);
    const multi = loaded.projects.find((project) => project.name === 'multi-device');
    const android = loaded.projects.find((project) => project.name === 'android')!;
    const harmony = loaded.projects.find((project) => project.name === 'harmony')!;
    expect(multi).toBeDefined();
    // 发现范围由项目声明（project.yaml）推导：仅 cases/<项目>/** 形状或空集哨兵，
    // 平台归属与项目隔离由声明决定（细粒度断言见 tests/unit/case-suites.test.ts）；
    // level 分级与平台后缀 glob 已退役。
    for (const project of [android, harmony, multi!]) {
      for (const pattern of project.files?.include ?? []) {
        expect(pattern).toMatch(
          /^cases\/[A-Za-z0-9.-]+\/\*\*\/\*\.\{yaml,yml\}$|^__mta_no_matched_files__\//,
        );
        expect(pattern).not.toContain('level');
        expect(pattern).not.toMatch(/\.(android|harmony|multi-device)\./);
      }
      expect(project.files?.exclude).toContain('tests/**/*.{yaml,yml}');
    }

    const multiFiles = discoverTestFiles(projectRoot, multi!.files);
    const androidFiles = discoverTestFiles(projectRoot, android.files);
    // 框架夹具与演示永不进入业务发现范围。
    expect(multiFiles.every((file) => !file.includes(`${'tests'}/`))).toBe(true);
    expect(androidFiles.every((file) => !file.includes(`${'tests'}/`))).toBe(true);
  });

  it('协作项目 Node 参考名包含已配置别名与 device.parallel，wait 无前缀', async () => {
    const loaded = await loadTestProject(configPath);
    const multi = loaded.projects.find((project) => project.name === 'multi-device')!;
    const bindings = loadMultiDeviceBindings(process.env);
    for (const binding of bindings) {
      expect(multi.nodes.has(`${binding.alias}.aiAct`)).toBe(true);
      expect(multi.nodes.has(`${binding.alias}.device.prepare`)).toBe(true);
      expect(multi.nodes.has(`${binding.alias}.device.recover`)).toBe(true);
      if (binding.platform === 'android') {
        expect(multi.nodes.has(`${binding.alias}.runAdbShell`)).toBe(true);
        expect(multi.nodes.has(`${binding.alias}.runHdcShell`)).toBe(false);
      } else {
        expect(multi.nodes.has(`${binding.alias}.runHdcShell`)).toBe(true);
        expect(multi.nodes.has(`${binding.alias}.runAdbShell`)).toBe(false);
      }
    }
    expect(multi.nodes.has('wait')).toBe(true);
    expect(multi.nodes.has('device.parallel')).toBe(true);
    expect(multi.nodes.has('aiAct')).toBe(false);
  });
});

describe('3.1 / 3.2 别名化原生 Node 与生命周期适配', () => {
  it('两台同平台：交错步骤按顺序落到对应 Agent', async () => {
    const left = makeAgent('left');
    const right = makeAgent('right');
    const nodes = createMultiDeviceNodes(SAME_PLATFORM_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(left, right, { phone1: 'android', phone2: 'android' }) as never,
    });
    const result = await runner.run({
      name: 'same-platform',
      steps: [
        { 'phone1.home': {} },
        { 'phone2.home': {} },
        { 'phone1.device.prepare': { target: 'home' } },
      ],
    });
    expect(result.status).toBe('success');
    expect(result.steps.map((step) => step.node)).toEqual([
      'phone1.home',
      'phone2.home',
      'phone1.device.prepare',
    ]);
    expect(left.events.filter((event) => event.endsWith(':home:end'))).toHaveLength(2);
    expect(right.events.filter((event) => event.endsWith(':home:end'))).toHaveLength(1);
  });

  it('跨平台：平台特有 Node 只对对应别名可用，字符串简写保留', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });
    const result = await runner.run({
      name: 'cross-platform-shell',
      steps: [
        { 'phone1.runAdbShell': 'echo android' },
        { 'phone2.runHdcShell': 'echo harmony' },
      ],
    });
    expect(result.status).toBe('success');
    expect(phone1.events).toContain('phone1:adb:echo android');
    expect(phone2.events).toContain('phone2:hdc:echo harmony');
    expect(nodeNamed(nodes, 'phone1.runAdbShell').stringInputKey).toBe('command');
    expect(nodeNamed(nodes, 'phone2.runHdcShell').stringInputKey).toBe('command');
  });

  it('YAML 交错夹具按声明顺序执行，未知别名/不支持 Node 在派发前失败', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const resolveNode = resolveFrom(nodes);
    const document = collectWorkflowDocument(
      {
        projectId: 'multi-device',
        projectName: 'multi-device',
        sourcePath: 'tests/fixtures/multi-device-interleave.yaml',
        absolutePath: interleavePath,
      },
      { resolveNode },
    );
    const executed = await runWorkflowDocument(document, {
      resolveNode,
      projectContext: contextOf(phone1, phone2) as never,
    });
    expect(executed.cases[0]!.status).toBe('success');
    expect(executed.cases[0]!.run!.steps.map((step) => step.node)).toEqual([
      'phone1.home',
      'phone2.home',
      'phone1.device.prepare',
    ]);

    expect(() =>
      collectWorkflowDocument(
        {
          projectId: 'multi-device',
          projectName: 'multi-device',
          sourcePath: 'tests/fixtures/multi-device-unknown.yaml',
          absolutePath: unknownPath,
        },
        { resolveNode },
      ),
    ).toThrow(WorkflowParseError);

    expect(() =>
      collectWorkflowDocument(
        {
          projectId: 'multi-device',
          projectName: 'multi-device',
          sourcePath: 'tests/fixtures/multi-device-unsupported.yaml',
          absolutePath: unsupportedPath,
        },
        { resolveNode },
      ),
    ).toThrow(/phone2.runAdbShell/);
  });

  it('未加前缀的 device.prepare 在协作项目失败，不操作任何设备', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });
    await expect(
      runner.run({
        name: 'unprefixed',
        steps: [{ 'device.prepare': { target: 'home' } }],
      }),
    ).rejects.toThrow(/phone1\.device\.prepare/);
    expect(phone1.events).toEqual([]);
    expect(phone2.events).toEqual([]);
  });
});

describe('3.3 在途操作防重叠', () => {
  it('超时后仍在运行的操作会阻止同设备下一步骤与下一用例', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    phone1.hold();
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });

    await expect(
      runner.run({
        name: 'timeout-first',
        steps: [{ 'phone1.home': { $: { timeout: 40 } } }],
      }),
    ).rejects.toBeInstanceOf(StepTimeoutError);

    await expect(
      runner.run({
        name: 'next-case',
        steps: [{ 'phone1.home': {} }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(String(error)).toMatch(/仍有未结束的操作/);
      expect(String(error)).toContain('phone1');
      return true;
    });

    phone1.release();
    await delay(20);
    const later = await runner.run({
      name: 'after-inflight',
      steps: [{ 'phone1.home': {} }, { 'phone2.home': {} }],
    });
    expect(later.status).toBe('success');
  });
});

describe('4.1 device.parallel 输入限制', () => {
  it('合法 YAML 可收集；非法输入在校验层失败', async () => {
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const resolveNode = resolveFrom(nodes);
    const document = collectWorkflowDocument(
      {
        projectId: 'multi-device',
        projectName: 'multi-device',
        sourcePath: 'tests/fixtures/multi-device-parallel.yaml',
        absolutePath: parallelPath,
      },
      { resolveNode },
    );
    expect(document.cases[0]!.definition.steps[0]!.node).toBe('device.parallel');

    const runner = new CaseRunner({ nodes: [...nodes], context: { devices: {} } as never });
    await expect(
      runner.run({
        name: 'one-step',
        steps: [{ 'device.parallel': { steps: [{ 'phone1.home': {} }] } }],
      }),
    ).rejects.toBeInstanceOf(NodeInputValidationError);

    await expect(
      runner.run({
        name: 'duplicate-alias',
        steps: [
          {
            'device.parallel': {
              steps: [{ 'phone1.home': {} }, { 'phone1.back': {} }],
            },
          },
        ],
      }),
    ).rejects.toThrow(/设备别名不能重复/);

    await expect(
      runner.run({
        name: 'nested',
        steps: [
          {
            'device.parallel': {
              steps: [
                { 'phone1.home': {} },
                { 'device.parallel': { steps: [] } },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow(/不允许嵌套/);

    await expect(
      runner.run({
        name: 'child-meta',
        steps: [
          {
            'device.parallel': {
              steps: [
                { 'phone1.home': { $: { timeout: 1 } } },
                { 'phone2.home': {} },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow(/子步骤级 \$/);

    await expect(
      runner.run({
        name: 'lifecycle-is-not-native',
        steps: [
          {
            'device.parallel': {
              steps: [
                { 'phone1.device.prepare': { target: 'home' } },
                { 'phone2.home': {} },
              ],
            },
          },
        ],
      }),
    ).rejects.toThrow(/目标平台没有 Node phone1\.device\.prepare/);
  });
});

describe('4.2 / 4.3 并行委托、取消与报告关联', () => {
  it('两台设备实际并发，成功结果含别名与轨迹', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    let overlap = false;
    wrapHome(phone1.agent, async () => {
      phone1.events.push('phone1:home:start');
      await delay(60);
      if (phone2.events.includes('phone2:home:start')) overlap = true;
      phone1.events.push('phone1:home:end');
    });
    wrapHome(phone2.agent, async () => {
      phone2.events.push('phone2:home:start');
      await delay(60);
      if (phone1.events.includes('phone1:home:start')) overlap = true;
      phone2.events.push('phone2:home:end');
    });
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });
    const result = await runner.run({
      name: 'parallel-success',
      steps: [
        {
          'device.parallel': {
            steps: [{ 'phone1.home': {} }, { 'phone2.home': {} }],
          },
        },
      ],
    });
    expect(result.status).toBe('success');
    expect(overlap).toBe(true);
    const output = result.steps[0]!.output?.data as {
      results: Array<{ alias: string; node: string; status: string; executionIds: string[] }>;
    };
    expect(output.results).toEqual([
      expect.objectContaining({ alias: 'phone1', node: 'home', status: 'success' }),
      expect.objectContaining({ alias: 'phone2', node: 'home', status: 'success' }),
    ]);
    expect(output.results[0]!.executionIds.length).toBeGreaterThan(0);
    expect(result.steps[0]!.report?.traces.length).toBeGreaterThan(0);
  });

  it('任一失败则父步骤失败，成功子结果不掩盖失败', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    wrapHome(phone1.agent, async () => {
      throw new Error('设备一失败');
    });
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });
    await expect(
      runner.run({
        name: 'parallel-mixed',
        steps: [
          {
            'device.parallel': {
              steps: [{ 'phone1.home': {} }, { 'phone2.home': {} }],
            },
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DeviceParallelStepError);
      const parallelError = error as DeviceParallelStepError;
      expect(parallelError.message).toContain('phone1.home=failed');
      expect(parallelError.message).toContain('设备一失败');
      expect(parallelError.message).toContain('phone2.home=success');
      expect(parallelError.results).toEqual([
        expect.objectContaining({ alias: 'phone1', status: 'failed' }),
        expect.objectContaining({ alias: 'phone2', status: 'success' }),
      ]);
      return true;
    });
  });

  it('并行超时向子调用传递取消，后续同设备步骤不重叠', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    phone1.hold();
    phone2.hold();
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const runner = new CaseRunner({
      nodes: [...nodes],
      context: contextOf(phone1, phone2) as never,
    });
    await expect(
      runner.run({
        name: 'parallel-timeout',
        steps: [
          {
            'device.parallel': {
              steps: [{ 'phone1.home': {} }, { 'phone2.home': {} }],
              $: { timeout: 40 },
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(StepTimeoutError);

    await expect(
      runner.run({
        name: 'after-timeout',
        steps: [{ 'phone1.home': {} }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(String(error)).toMatch(/仍有未结束/);
      return true;
    });
    phone1.release();
    phone2.release();
  });

  it('混合成功/失败的报告可逐设备定位轨迹与错误', async () => {
    const phone1 = makeAgent('phone1');
    const phone2 = makeAgent('phone2');
    wrapHome(phone2.agent, async () => {
      throw new Error('设备二断言失败');
    });
    const nodes = createMultiDeviceNodes(TEST_MULTI_DEVICE_BINDINGS);
    const resolveNode = resolveFrom(nodes);
    const document = collectWorkflowDocument(
      {
        projectId: 'multi-device',
        projectName: 'multi-device',
        sourcePath: 'tests/fixtures/multi-device-parallel.yaml',
        absolutePath: parallelPath,
      },
      { resolveNode },
    );
    const executed = await runWorkflowDocument(document, {
      resolveNode,
      projectContext: contextOf(phone1, phone2) as never,
    });
    const outcome = executed.cases[0]!;
    expect(outcome.status).toBe('failed');
    const step = outcome.run!.steps[0]!;
    expect(step.status).toBe('failed');
    expect(String(step.error)).toContain('phone1.home=success');
    expect(String(step.error)).toContain('phone2.home=failed');
    expect(String(step.error)).toContain('设备二断言失败');
    expect(step.report?.traces.some((trace) => trace.executionId.includes('phone1'))).toBe(
      true,
    );
  });
});
