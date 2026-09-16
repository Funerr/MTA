import { describe, expect, it } from 'vitest';
import { experienceActInputSchema, experienceActNode } from '../../src/nodes/experience-act';
import { ExperienceRuntime } from '../../src/experience/runtime';
import {
  GENERIC_REPLAY_PROMPT,
  GENERIC_TEST_ACTION_POLICY,
  runtimeIdentity,
  silentReplayTarget,
} from '../helpers/experience-runtime-fixtures';
import { makeEnvironment } from '../helpers/experience-fixtures';
import { makeSolidPng } from '../helpers/promotion-png';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import os from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs/promises';

function executionOf(
  context: unknown,
  input: { prompt: string },
) {
  return {
    input,
    $: { continueOnError: false },
    signal: new AbortController().signal,
    context,
    onTeardown() {},
    report: { addTrace() {} },
    scope: 'case',
    case: {
      caseId: 'case-1',
      runId: 'run-1',
      projectName: 'android',
      attemptIndex: 0,
      name: runtimeIdentity().caseName,
      sourcePath: runtimeIdentity().casePath,
      caseIndex: 0,
      phase: 'steps',
      stepIndex: 0,
    },
  } as never;
}

describe('experienceAct 输入契约（任务 1.5）', () => {
  const schema = experienceActNode.inputSchema!;

  it('接受且仅接受 { prompt: 非空字符串 }', () => {
    expect(schema.parse({ prompt: GENERIC_REPLAY_PROMPT })).toEqual({ prompt: GENERIC_REPLAY_PROMPT });
    expect(experienceActInputSchema.parse({ prompt: 'generic-replay-target' }).prompt).toBe(
      GENERIC_REPLAY_PROMPT,
    );
  });

  it('缺少 prompt 或使用 instruction/images 等未声明字段校验失败', () => {
    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ instruction: GENERIC_REPLAY_PROMPT })).toThrow();
    expect(() => schema.parse({ prompt: GENERIC_REPLAY_PROMPT, images: [] })).toThrow();
    expect(() => schema.parse({ prompt: '' })).toThrow();
  });
});

describe('experienceAct 执行接入（任务 1.5）', () => {
  it('注入 Runtime 后按 prompt 执行，不要求业务用例', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-act-node-'));
    const png = await makeSolidPng(8, 8, { r: 1, g: 2, b: 3 });
    let native = 0;
    const runtime = new ExperienceRuntime({
      store: openExperienceStore(root),
      environment: makeEnvironment(),
      policy: GENERIC_TEST_ACTION_POLICY,
      nativeExecute: async () => {
        native += 1;
        return { category: 'undefined', dump: { executions: [] } };
      },
      captureScreenshot: async () => png,
      replayTarget: silentReplayTarget(png),
    });
    const result = await experienceActNode.execute(
      executionOf(
        {
          agent: {
            home: async () => undefined,
            aiAct: async () => undefined,
            interface: { screenshotBase64: async () => '' },
            callActionInActionSpace: async () => undefined,
          },
          experienceRuntime: runtime,
        },
        { prompt: GENERIC_REPLAY_PROMPT },
      ),
    );
    expect(native).toBe(1);
    expect(result?.summary).toMatch(/原生执行成功/);
    expect(result?.data?.nativeCalled).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('context 缺少可用 Agent 且未注入 Runtime 时给出可定位错误', async () => {
    await expect(
      experienceActNode.execute(executionOf({ agent: { home: async () => undefined } }, { prompt: GENERIC_REPLAY_PROMPT })),
    ).rejects.toThrow(/experienceAct.*aiAct/s);
  });
});
