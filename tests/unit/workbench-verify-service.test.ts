import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StepRunResult } from '@midscene/test';
import { Workspace } from '../../src/workbench/server/workspace';
import { DocumentStore } from '../../src/workbench/core/document-store';
import { ModelConfigStore } from '../../src/workbench/server/model-config';
import { TaskRegistry } from '../../src/workbench/server/tasks';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import { VerifyService } from '../../src/workbench/server/verify-service';
import { goalObservation } from '../../src/workbench/core/verify/runner';
import type { VerificationGoal } from '../../src/workbench/core/verify/goals';
import {
  createEmptyDocument,
  createVariant,
  type BusinessCase,
} from '../../src/workbench/core/document';
import { compileGenerationIntoVariant } from '../../src/workbench/core/generate/compile';
import type { ModelOutput } from '../../src/workbench/core/generate/schema';

let tempRoot: string;

// 导入真实适配器链路会经 @midscene 自动加载 .env；单测统一摘除，
// 避免“局部修改建议”在单测中发起真实模型调用。
const MIDSCENE_ENV_KEYS = [
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_NAME',
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-verify-svc-'));
  for (const key of MIDSCENE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of MIDSCENE_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

const sampleCase = (): BusinessCase => ({
  id: 'case1',
  sourceId: 'TC-S1',
  name: '打开设置',
  goal: '',
  level: 'level1',
  preconditions: [],
  noPreconditionsDeclared: true,
  actions: [{ id: 'act1', text: '打开设置' }],
  expectations: [
    { id: 'exp1', text: '设置页面显示', actionId: 'act1', evidenceKind: 'visual' },
  ],
  sourceRefs: [],
  status: 'ready',
});

const generatedOutput = (): ModelOutput => ({
  cases: [
    {
      caseId: 'case1',
      workflowYaml: [
        'cases:',
        '  - name: 打开设置',
        '    steps:',
        '      - aiAct: 打开系统设置',
        '      - aiAssert: 设置页面显示',
      ].join('\n'),
      actionMapping: [{ actionId: 'act1', stepIndices: [0] }],
      coverage: [
        { expectationId: 'exp1', covered: true, caseIndex: 0, stepIndex: 1, node: 'aiAssert' },
      ],
      rewrites: [],
      issues: [],
    },
  ],
});

interface Harness {
  verify: VerifyService;
  documents: DocumentStore;
  tasks: TaskRegistry;
  devices: DeviceService;
  workspace: Workspace;
  bind(): Promise<void>;
}

const makeHarness = (options?: {
  executeWorkflow?: Parameters<VerifyService['start']>[0] extends never ? never : never;
}): Harness => {
  const workspace = new Workspace(
    join(tempRoot, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  );
  const documents = new DocumentStore(workspace);
  const tasks = new TaskRegistry();
  const devices = new DeviceService(
    {
      listAndroid: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmony: async () => [{ deviceId: 'har-1' }],
    },
    workspace,
  );
  const verify = new VerifyService({
    devices,
    tasks,
    documents,
    workspace,
    modelConfig: new ModelConfigStore(workspace),
    config: { projectRoot: tempRoot },
    executeWorkflow: options?.executeWorkflow as never,
  });
  const bind = async () => {
    await devices.bind('android', 'emu-1');
  };
  return { verify, documents, tasks, devices, workspace, bind };
};

const createDoc = async (documents: DocumentStore) => {
  const created = await documents.create(`核查服务 ${Date.now()}`);
  const draft = {
    ...created,
    cases: [sampleCase()],
    variants: {
      android: createVariant('android', created.businessRevision),
    },
  };
  compileGenerationIntoVariant({
    document: draft,
    variant: draft.variants.android!,
    output: generatedOutput(),
  });
  return documents.save(draft, created.saveVersion);
};

const waitTask = async (tasks: TaskRegistry, taskId: string) => {
  for (let i = 0; i < 200; i += 1) {
    const task = tasks.get(taskId);
    if (task.status !== 'running') return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('任务未在时限内结束');
};

describe('VerifyService：注入执行适配的契约', () => {
  it('执行适配失败：任务以 failed 收尾并携带原因', async () => {
    const harness = makeHarness({
      executeWorkflow: (async () => {
        throw new Error('loadTestProject failed: config not found');
      }) as never,
    });
    await harness.bind();
    const document = await createDoc(harness.documents);

    const task = harness.verify.start(document.id, {
      platform: 'android',
      caseId: 'case1',
      baseSaveVersion: document.saveVersion,
    });
    const done = await waitTask(harness.tasks, task.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('loadTestProject failed');
    // 失败后槽位释放
    expect(harness.verify.status('android')[0]!.active).toBeNull();
  });

  it('注入成功执行：证据落盘、状态 observed-pass、文档保存', async () => {
    let executeCalls = 0;
    const harness = makeHarness({
      executeWorkflow: (async (input: {
        onScreenshot?: (index: number, png: Uint8Array) => Promise<void>;
        onStep?: (info: unknown, step: StepRunResult) => Promise<void>;
      }) => {
        executeCalls += 1;
        await input.onScreenshot?.(-1, Buffer.from('fresh'));
        const stepResult = (index: number, node: string) =>
          ({
            phase: 'steps',
            stepIndex: index,
            node,
            input: {},
            meta: { continueOnError: false },
            status: 'success',
            continuedAfterError: false,
            startedAt: '',
            endedAt: '',
            durationMs: 1,
          }) as unknown as StepRunResult;
        await input.onStep?.({ scope: 'case' }, stepResult(0, 'aiAct'));
        await input.onScreenshot?.(0, Buffer.from('png0'));
        await input.onStep?.({ scope: 'case' }, stepResult(1, 'aiAssert'));
        await input.onScreenshot?.(1, Buffer.from('png1'));
        return {
          document: { status: 'success' },
          cases: [{ status: 'success' }],
        };
      }) as never,
    });
    await harness.bind();
    const document = await createDoc(harness.documents);
    const task = harness.verify.start(document.id, {
      platform: 'android',
      caseId: 'case1',
      baseSaveVersion: document.saveVersion,
    });
    const done = await waitTask(harness.tasks, task.id);
    expect(done.status).toBe('completed');
    expect(executeCalls).toBe(1);
    const result = done.result as {
      stopped: boolean;
      conflict: boolean;
      evidenceSaved: boolean;
      evidence: { status: string; screenshotFile?: string; frameworkReport?: string }[];
    };
    expect(result.stopped).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.evidenceSaved).toBe(true);
    expect(result.evidence[0]!.status).toBe('observed-pass');
    expect(result.evidence[0]!.screenshotFile).toBeTruthy();
    expect(result.evidence[0]!.frameworkReport).toBeTruthy();

    const stored = await harness.documents.load(document.id);
    expect(stored.variants.android!.evidence).toHaveLength(1);
    // 截图文件确实写入工作区
    await expect(
      harness.workspace.readText(result.evidence[0]!.screenshotFile!),
    ).resolves.toBeTruthy();
  });

  it('互斥：同平台第二个任务被拒绝；停止进入 stopping 且不覆盖文档', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = makeHarness({
      executeWorkflow: (async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
          void gate.then(() => resolve());
        });
        throw new Error('已停止');
      }) as never,
    });
    await harness.bind();
    const document = await createDoc(harness.documents);

    const first = harness.verify.start(document.id, {
      platform: 'android',
      caseId: 'case1',
      baseSaveVersion: document.saveVersion,
    });
    expect(() =>
      harness.verify.start(document.id, {
        platform: 'android',
        caseId: 'case1',
        baseSaveVersion: document.saveVersion,
      }),
    ).toThrow(/只允许一个控制任务/);

    // Harmony 独立槽位（未绑定设备 → 400 而不是 409）
    expect(
      () =>
        harness.verify.start(document.id, {
          platform: 'harmony',
          caseId: 'case1',
          baseSaveVersion: document.saveVersion,
        }),
    ).toThrow(/尚未绑定 harmony/);

    // 停止：状态进入 stopping，任务以取消/失败收尾，证据不落盘
    harness.verify.stop('android');
    expect(harness.verify.status('android')[0]!.active?.runnerState).toBe('stopping');
    release();
    const done = await waitTask(harness.tasks, first.id);
    expect(['cancelled', 'failed']).toContain(done.status);
    const stored = await harness.documents.load(document.id);
    expect(stored.variants.android!.evidence).toHaveLength(0);
    // 任务结束后槽位释放，可再次启动
    expect(harness.verify.status('android')[0]!.active).toBeNull();
  });

  it('teardown 失败：状态进入 unknown，不宣称设备空闲', async () => {
    const harness = makeHarness({
      executeWorkflow: (async () => {
        throw new Error('框架会话释放失败，设备控制权未知');
      }) as never,
    });
    await harness.bind();
    const document = await createDoc(harness.documents);
    const task = harness.verify.start(document.id, {
      platform: 'android',
      caseId: 'case1',
      baseSaveVersion: document.saveVersion,
    });
    const done = await waitTask(harness.tasks, task.id);
    expect(done.status).toBe('failed');
    // 控制权未知：槽位保留（不显示可接管）
    const status = harness.verify.status('android')[0]!;
    expect(status.active?.runnerState).toBe('unknown');
    expect(status.canTakeover).toBe(false);
  });

  it('重启中断：登记文件在服务重启后被读取，不自动重放', async () => {
    const harness = makeHarness();
    await harness.bind();
    await harness.workspace.writeJson('verify-active.json', [
      {
        platform: 'android',
        documentId: 'd-gone',
        caseId: 'case1',
        at: '2026-01-01T00:00:00Z',
      },
    ]);
    // 新实例（模拟重启）
    const restarted = new VerifyService({
      devices: harness.devices,
      tasks: new TaskRegistry(),
      documents: harness.documents,
      workspace: harness.workspace,
      modelConfig: new ModelConfigStore(harness.workspace),
      config: { projectRoot: tempRoot },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(restarted.listInterrupted()).toHaveLength(1);
    expect(restarted.listInterrupted()[0]).toMatchObject({
      platform: 'android',
      documentId: 'd-gone',
    });
  });

  it('文档版本过期：启动被拒绝（固定核查内容修订）', async () => {
    const harness = makeHarness({
      executeWorkflow: (async () => ({
        document: { status: 'success' },
        cases: [{ status: 'success' }],
      })) as never,
    });
    await harness.bind();
    const document = await createDoc(harness.documents);
    const task = harness.verify.start(document.id, {
      platform: 'android',
      caseId: 'case1',
      baseSaveVersion: document.saveVersion - 1,
    });
    const done = await waitTask(harness.tasks, task.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('文档已修改');
  });
});

describe('无预期时不伪造断言', () => {
  const goal: VerificationGoal = {
    id: 'g-1',
    caseId: 'case1',
    actionId: 'act1',
    expectationIds: [],
    target: '打开设置',
    preconditionPath: [],
    observations: [],
    stepIndices: [0],
    assertionIndices: [],
    endStepIndex: 0,
  };

  it('没有断言节点时状态为 unknown 并说明证据不足，不产生通过状态', () => {
    const steps = new Map<number, StepRunResult>([
      [0, { phase: 'steps', stepIndex: 0, node: 'aiAct', input: {}, meta: { continueOnError: false }, status: 'success', continuedAfterError: false, startedAt: '', endedAt: '', durationMs: 1 } as unknown as StepRunResult],
    ]);
    const observation = goalObservation(goal, steps);
    expect(observation.status).toBe('unknown');
    expect(observation.observation).toContain('证据不足');
  });

  it('断言节点失败时不伪造通过', () => {
    const goalWithAssert: VerificationGoal = {
      ...goal,
      expectationIds: ['exp1'],
      observations: ['设置页面显示'],
      assertionIndices: [1],
    };
    const steps = new Map<number, StepRunResult>([
      [1, { phase: 'steps', stepIndex: 1, node: 'aiAssert', input: {}, meta: { continueOnError: false }, status: 'failed', continuedAfterError: false, startedAt: '', endedAt: '', durationMs: 1 } as unknown as StepRunResult],
    ]);
    const observation = goalObservation(goalWithAssert, steps);
    expect(observation.status).toBe('unknown');
    expect(observation.observation).toContain('证据不足');
  });

  it('目标步骤执行成功且断言全部通过才记录 observed-pass', () => {
    const goalWithAssert: VerificationGoal = {
      ...goal,
      expectationIds: ['exp1'],
      observations: ['设置页面显示'],
      assertionIndices: [1],
    };
    const steps = new Map<number, StepRunResult>([
      [1, { phase: 'steps', stepIndex: 1, node: 'aiAssert', input: {}, meta: { continueOnError: false }, status: 'success', continuedAfterError: false, startedAt: '', endedAt: '', durationMs: 1 } as unknown as StepRunResult],
    ]);
    const observation = goalObservation(goalWithAssert, steps);
    expect(observation.status).toBe('observed-pass');
    expect(observation.notes).toContain('不代表完整用例验收');
  });
});
