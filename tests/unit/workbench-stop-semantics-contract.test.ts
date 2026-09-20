import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectWorkflowDocument,
  defineNode,
  NodeRegistry,
  runWorkflowDocument,
  StepTimeoutError,
  z,
} from '@midscene/test';

// 编写工作台停止语义的契约测试：锁定 @midscene/test 1.12.7 的
// 超时/中止行为——步骤超时或 run 级中止会停止派发新动作并触发
// AbortSignal，但不会终止已在途的底层调用。工作台必须据此呈现
// “停止中/状态未知”，不能在在途调用未结束时宣称设备空闲。

let tempDir: string;
let executions: string[];
let registry: NodeRegistry;
let hangObservedAbort: boolean;
let hangSettled: boolean;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mta-workbench-stop-'));

  executions = [];
  hangObservedAbort = false;
  hangSettled = false;

  const gate = defineNode({
    name: 'gate.record',
    inputSchema: z.strictObject({}),
    execute: (execution) => {
      executions.push(`gate:${execution.case?.caseIndex ?? '?'}`);
      return { data: 'ok' };
    },
  });

  // 模拟超时后仍在途的底层设备调用：监听 abort 但永不 settle。
  const hang = defineNode({
    name: 'hang.block',
    inputSchema: z.strictObject({}),
    execute: (execution) =>
      new Promise<never>(() => {
        execution.signal.addEventListener(
          'abort',
          () => {
            hangObservedAbort = true;
          },
          { once: true },
        );
      }).finally(() => {
        hangSettled = true;
      }),
  });

  registry = new NodeRegistry([gate, hang]);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const runCase = async (yaml: string, options?: { defaultTimeoutMs?: number; signal?: AbortSignal; abortAfterSteps?: number }) => {
  const absolutePath = join(tempDir, `case-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(absolutePath, yaml, 'utf8');

  const document = collectWorkflowDocument(
    { projectId: 'workbench-stop', sourcePath: absolutePath, absolutePath },
    { resolveNode: (name) => registry.get(name), env: {} },
  );

  const controller = options?.signal ? undefined : new AbortController();
  let dispatched = 0;
  const result = await runWorkflowDocument(document, {
    resolveNode: (name) => registry.require(name),
    defaultTimeoutMs: options?.defaultTimeoutMs,
    signal: options?.signal ?? controller!.signal,
    onStepStart: () => {
      dispatched += 1;
    },
    onStepResult: () => {
      if (options?.abortAfterSteps !== undefined && dispatched >= options.abortAfterSteps) {
        controller?.abort(new Error('工作台请求停止'));
      }
    },
  });
  return { result, dispatched };
};

describe('停止与超时语义（锁定 @midscene/test 1.12.7）', () => {
  it('步骤超时：停止派发并中止 signal，但底层调用仍在途', async () => {
    const { result } = await runCase(
      ['cases:', '  - name: 超时用例', '    steps:', '      - hang.block: {}'].join('\n'),
      { defaultTimeoutMs: 50 },
    );

    expect(result.cases[0]!.status).toBe('failed');
    const steps = result.cases[0]!.run?.steps ?? [];
    expect(steps[0]!.error).toBeInstanceOf(StepTimeoutError);

    // 引擎已触发 AbortSignal，但 execute 的 Promise 从未 settle：
    // “停止”只保证不再派发，不保证底层设备调用已结束。
    expect(hangObservedAbort).toBe(true);
    expect(hangSettled).toBe(false);
  });

  it('run 级中止：当前步骤结束后不再派发新步骤', async () => {
    const yaml = [
      'cases:',
      '  - name: 中止用例',
      '    steps:',
      '      - gate.record: {}',
      '      - gate.record: {}',
      '      - gate.record: {}',
    ].join('\n');

    const { result } = await runCase(yaml, {
      defaultTimeoutMs: 5000,
      abortAfterSteps: 1,
    });

    // 引擎不会在步骤之间检查 signal：onStepStart 仍会为下一步触发，
    // 但 executeStep 在执行前拒绝，Node execute 不会被调用。
    // 工作台不能把 onStepStart 当作“设备动作已发生”的证据。
    expect(executions.filter((entry) => entry.startsWith('gate:'))).toHaveLength(1);
    const steps = result.cases[0]!.run?.steps ?? [];
    expect(steps[1]!.status).toBe('failed');
    expect(result.cases[0]!.status).not.toBe('success');
  });

  it('运行前已中止：不派发任何步骤', async () => {
    const controller = new AbortController();
    controller.abort(new Error('运行前取消'));

    const { dispatched } = await runCase(
      ['cases:', '  - name: 预中止用例', '    steps:', '      - gate.record: {}'].join('\n'),
      { defaultTimeoutMs: 5000, signal: controller.signal },
    );

    expect(dispatched).toBe(0);
  });
});
