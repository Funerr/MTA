import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promoteExperience } from '../../src/experience/promotion/promoter';
import {
  LOCKED_MIDSCENE_VERSION,
  TRACE_ADAPTER_VERSION,
} from '../../src/experience/promotion/constants';
import { executionIdsOf } from '../../src/experience/promotion/trace-adapter';
import { openExperienceStore } from '../../src/experience/store/experience-store';
import { deriveRequestKey } from '../../src/experience/schema/request-key';
import { makeEnvironment } from '../helpers/experience-fixtures';
import { promoteRequest } from '../helpers/promotion-dump';
import {
  HARNESS_HEIGHT,
  HARNESS_WIDTH,
  NATIVE_FIXTURE_SOURCE,
  ScriptedAndroidDevice,
  createHarnessAgent,
  locatedTarget,
  makeHarnessFrames,
  runPlannedActions,
} from '../helpers/midscene-agent-harness';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function screenshotId(item: unknown): string | undefined {
  return isRecord(item) && typeof item.id === 'string' ? item.id : undefined;
}

function summarizeTasks(execution: Record<string, unknown>) {
  const tasks = Array.isArray(execution.tasks) ? execution.tasks.filter(isRecord) : [];
  return tasks.map((task) => {
    const recorder = Array.isArray(task.recorder) ? task.recorder.filter(isRecord) : [];
    const after = recorder.find((item) => item.timing === 'after-calling');
    const uiContext = isRecord(task.uiContext) ? task.uiContext : {};
    return {
      type: task.type,
      subType: task.subType,
      status: task.status,
      before: screenshotId(uiContext.screenshot),
      after: after ? screenshotId(after.screenshot) : undefined,
      param: task.param,
    };
  });
}

const TAP_BOX = { x: 24, y: 40, width: 40, height: 24 };
const INPUT_BOX = { x: 16, y: 120, width: 80, height: 28 };

describe('原生取数契约（任务 1.1 / 1.2）', () => {
  let agent: ReturnType<typeof createHarnessAgent> | undefined;

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
      agent = undefined;
    }
  });

  it('锁定 1.12.7 Agent 在 Step 结束后即可提供按 execution 隔离的前后截图与目标', async () => {
    const device = new ScriptedAndroidDevice(await makeHarnessFrames(12));
    agent = createHarnessAgent(device);
    const dumpUpdates: string[] = [];
    const stop = agent.addDumpUpdateListener((_dump, execution) => {
      if (execution?.id) dumpUpdates.push(execution.id);
    });

    await agent.callActionInActionSpace('Tap', {
      locate: locatedTarget('设置入口', TAP_BOX),
    });

    expect(dumpUpdates.length).toBeGreaterThan(0);
    expect(agent.dump.sdkVersion).toBe(LOCKED_MIDSCENE_VERSION);
    expect(agent.dump.executions).toHaveLength(1);
    const first = agent.dump.executions[0] as unknown as Record<string, unknown>;
    const firstId = first.id;
    expect(typeof firstId).toBe('string');
    const table = summarizeTasks(first);
    expect(table.map((row) => `${row.type}/${row.subType}:${row.status}`)).toEqual([
      'Planning/Locate:finished',
      'Action Space/Tap:finished',
    ]);
    const tap = table[1]!;
    expect(tap.before).toBeTruthy();
    expect(tap.after).toBeTruthy();
    expect(tap.after).not.toBe(tap.before);
    expect(tap.param).toMatchObject({
      locate: {
        center: [44, 52],
        rect: { left: 24, top: 40, width: 40, height: 24 },
      },
    });
    expect(device.actions).toEqual([{ kind: 'tap', x: 44, y: 52 }]);

    await agent.callActionInActionSpace('AndroidHomeButton', {});
    stop();
    const ids = executionIdsOf(agent.dump);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(firstId);
    expect(ids[1]).not.toBe(firstId);
    const second = agent.dump.executions[1] as unknown as Record<string, unknown>;
    const homeTable = summarizeTasks(second);
    expect(homeTable).toEqual([
      expect.objectContaining({
        type: 'Action Space',
        subType: 'AndroidHomeButton',
        status: 'finished',
      }),
    ]);
    expect(homeTable[0]?.before).toBeTruthy();
    expect(homeTable[0]?.after).toBeTruthy();
    expect(device.actions.at(-1)).toEqual({ kind: 'home' });
    expect(NATIVE_FIXTURE_SOURCE.method).toMatch(/callActionInActionSpace/);
  });
});

describe('原生轨迹自动发布（任务 3.1）', () => {
  it('runPlans 生成的完整轨迹可发布 candidate，重载后与原生动作一致', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-promotion-native-'));
    const device = new ScriptedAndroidDevice(await makeHarnessFrames(16));
    const nativeAgent = createHarnessAgent(device);
    const aiCallsBefore = device.actions.length;
    try {
      await runPlannedActions(nativeAgent, [
        { type: 'Tap', param: { locate: locatedTarget('设置入口', TAP_BOX) }, thought: '点入口' },
        {
          type: 'Input',
          param: {
            locate: locatedTarget('搜索框', INPUT_BOX),
            value: '显示',
            mode: 'replace',
          },
          thought: '输入',
        },
        { type: 'AndroidHomeButton', param: {}, thought: '回主屏' },
      ]);
      expect(nativeAgent.dump.executions).toHaveLength(1);
      const nativeActions = [...device.actions];
      expect(nativeActions.map((item) => item.kind)).toEqual(['tap', 'typeText', 'home']);

      const store = openExperienceStore(root);
      const request = promoteRequest();
      const environment = makeEnvironment({
        resolution: { width: HARNESS_WIDTH, height: HARNESS_HEIGHT },
      });
      const promoted = await promoteExperience({
        callId: 'call-native-3-1',
        dump: nativeAgent.dump,
        request,
        environment,
        source: {
          casePath: 'cases/settings.yaml',
          caseName: 'settings-display',
          stepPath: 'steps[2]',
          node: 'aiAct',
          prompt: '打开显示设置',
        },
        store,
        capturedAt: '2026-09-16T01:00:00.000Z',
      });
      expect(device.actions.length).toBe(nativeActions.length);
      expect(device.actions.length).toBeGreaterThan(aiCallsBefore);
      expect(promoted.result).toBe('promoted');
      if (promoted.result !== 'promoted') return;
      expect(promoted.duplicate).toBe(false);
      expect(promoted.snapshot.revision).toBe(1);

      const key = deriveRequestKey(request);
      expect(key.eligible).toBe(true);
      if (!key.eligible) return;
      const found = await store.findCandidates({
        requestKey: key.requestKey,
        environment,
      });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      const chain = found.value[0]!;
      expect(chain.actions.map((action) => action.type)).toEqual(['Tap', 'Input', 'Home']);
      expect(chain.source.callId).toBe('call-native-3-1');
      expect(chain.source.midsceneVersion).toBe(LOCKED_MIDSCENE_VERSION);
      expect(chain.source.adapterVersion).toBe(TRACE_ADAPTER_VERSION);
      const tap = chain.actions[0];
      const input = chain.actions[1];
      if (tap.type !== 'Tap' || input.type !== 'Input') return;
      expect(tap.target.bbox).toEqual({ x: 24, y: 40, width: 40, height: 24 });
      expect(input.params).toEqual({ text: '显示', mode: 'replace' });
      expect(input.target.bbox).toEqual({ x: 16, y: 120, width: 80, height: 28 });
      const reloadedTap = await store.readAssetImage(tap.target.image.asset);
      expect(reloadedTap.ok).toBe(true);
      expect(chain.entryEvidence.screenshot.width).toBe(HARNESS_WIDTH);
      expect(chain.terminalEvidence.screenshot.height).toBe(HARNESS_HEIGHT);
    } finally {
      await nativeAgent.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
