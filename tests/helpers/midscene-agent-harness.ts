/**
 * 锁定 Midscene 1.12.7 的最小集成夹具：真实 Agent + 受控设备替身。
 * 不编写业务 YAML；模型配置为占位 VL family，动作用 locatedPixelResult 跳过真实模型调用。
 */
import { Agent } from '@midscene/core/agent';
import {
  createDefaultMobileActions,
  type AbstractInterface,
  type MobileInputPrimitives,
} from '@midscene/core/device';
import { LOCKED_MIDSCENE_VERSION } from '../../src/experience/promotion/constants';
import { makeSolidPng, pngDataUrl } from './promotion-png';

export const HARNESS_WIDTH = 120;
export const HARNESS_HEIGHT = 200;

export const NATIVE_FIXTURE_SOURCE = {
  packages: `@midscene/core@${LOCKED_MIDSCENE_VERSION} / @midscene/android@${LOCKED_MIDSCENE_VERSION}`,
  entry: 'tests/helpers/midscene-agent-harness.ts',
  method: 'Agent.callActionInActionSpace 与 TaskExecutor.runPlans',
  deviceBoundary: 'ScriptedAndroidDevice + createDefaultMobileActions',
  modelBoundary: 'locatedPixelResult 跳过定位模型；modelConfig 仅为通过非 Web VL 检查',
} as const;

export const DUMMY_MODEL_CONFIG = {
  MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
  MIDSCENE_MODEL_NAME: 'probe-model',
  MIDSCENE_MODEL_API_KEY: 'probe-key',
  MIDSCENE_MODEL_BASE_URL: 'http://127.0.0.1:9',
} as const;

export type ScriptedAction =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'typeText'; value: string; mode?: string }
  | { kind: 'scroll'; param: unknown }
  | { kind: 'longPress'; x: number; y: number; duration?: number }
  | { kind: 'back' }
  | { kind: 'home' };

export class ScriptedAndroidDevice {
  readonly interfaceType = 'android';
  readonly actions: ScriptedAction[] = [];
  screenshotCalls = 0;
  private frame = 0;
  private readonly pngs: Uint8Array[];

  constructor(pngs: Uint8Array[]) {
    this.pngs = pngs;
  }

  describe(): string {
    return 'scripted-android-harness';
  }

  async screenshotBase64(): Promise<string> {
    const png = this.pngs[Math.min(this.frame, this.pngs.length - 1)]!;
    this.frame += 1;
    this.screenshotCalls += 1;
    return pngDataUrl(png);
  }

  async size(): Promise<{ width: number; height: number }> {
    return { width: HARNESS_WIDTH, height: HARNESS_HEIGHT };
  }

  actionSpace() {
    return createDefaultMobileActions({
      input: this.inputPrimitives,
      size: () => this.size(),
      sleep: async () => undefined,
      systemActions: {
        backButton: { name: 'AndroidBackButton', description: 'back' },
        homeButton: { name: 'AndroidHomeButton', description: 'home' },
      },
    });
  }

  private readonly inputPrimitives: MobileInputPrimitives = {
    pointer: {
      tap: async (point) => {
        this.actions.push({ kind: 'tap', x: point.x, y: point.y });
      },
      longPress: async (point, opts) => {
        this.actions.push({
          kind: 'longPress',
          x: point.x,
          y: point.y,
          duration: opts?.duration,
        });
      },
      doubleClick: async () => undefined,
      dragAndDrop: async () => undefined,
    },
    keyboard: {
      keyboardPress: async () => undefined,
      typeText: async (value, opts) => {
        this.actions.push({
          kind: 'typeText',
          value,
          mode: opts?.replace ? 'replace' : undefined,
        });
      },
      clearInput: async () => undefined,
    },
    touch: {
      swipe: async () => undefined,
    },
    scroll: {
      scroll: async (param) => {
        this.actions.push({ kind: 'scroll', param });
      },
    },
    system: {
      backButton: async () => {
        this.actions.push({ kind: 'back' });
      },
      homeButton: async () => {
        this.actions.push({ kind: 'home' });
      },
    },
  };
}

export async function makeHarnessFrames(count: number): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    frames.push(
      await makeSolidPng(HARNESS_WIDTH, HARNESS_HEIGHT, {
        r: 30 + i * 17,
        g: 60 + i * 11,
        b: 90 + i * 7,
      }),
    );
  }
  return frames;
}

export function createHarnessAgent(device: ScriptedAndroidDevice): Agent {
  return new Agent(device as unknown as AbstractInterface, {
    generateReport: false,
    persistExecutionDump: false,
    autoPrintReportMsg: false,
    waitAfterAction: 0,
    groupName: 'experience-promotion-harness',
    modelConfig: { ...DUMMY_MODEL_CONFIG },
  });
}

type AgentInternals = {
  resolveModelRuntime: (intent: string) => unknown;
};

export async function runPlannedActions(
  agent: Agent,
  plans: Array<{ type: string; param: Record<string, unknown>; thought?: string }>,
  title = 'Act - harness',
): Promise<void> {
  const internals = agent as unknown as AgentInternals;
  const planningModel = internals.resolveModelRuntime('planning');
  const defaultModel = internals.resolveModelRuntime('default');
  await agent.taskExecutor.runPlans(
    title,
    plans as never,
    planningModel as never,
    defaultModel as never,
  );
}

export function locatedTarget(
  prompt: string,
  box: { x: number; y: number; width: number; height: number },
) {
  return {
    prompt,
    locatedPixelResult: {
      center: [box.x + Math.floor(box.width / 2), box.y + Math.floor(box.height / 2)],
      rect: { left: box.x, top: box.y, width: box.width, height: box.height },
    },
  };
}
