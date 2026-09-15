import type { BoundingBox } from '../../src/experience/schema/action';
import { ELIGIBILITY_POLICY_VERSION } from '../../src/experience/promotion/constants';
import type { RequestKeySource } from '../../src/experience/schema/request-key';
import { makeSolidPng, pngDataUrl } from './promotion-png';

export const DUMP_WIDTH = 200;
export const DUMP_HEIGHT = 160;

export function makeScreenshot(id: string, png: Uint8Array, capturedAt = 1_000) {
  return {
    id,
    capturedAt,
    base64: pngDataUrl(png),
  };
}

export function makeLocate(
  prompt: string,
  box: BoundingBox,
): {
  description: string;
  center: [number, number];
  rect: { left: number; top: number; width: number; height: number };
} {
  return {
    description: prompt,
    center: [box.x + Math.floor(box.width / 2), box.y + Math.floor(box.height / 2)],
    rect: { left: box.x, top: box.y, width: box.width, height: box.height },
  };
}

export function makeActionTask(options: {
  taskId: string;
  subType: string;
  status?: string;
  param?: unknown;
  before: unknown;
  after?: unknown;
}) {
  return {
    taskId: options.taskId,
    type: 'Action Space' as const,
    subType: options.subType,
    status: options.status ?? 'finished',
    param: options.param ?? {},
    uiContext: { screenshot: options.before },
    recorder: options.after
      ? [
          {
            type: 'screenshot',
            ts: 2_000,
            timing: 'after-calling',
            screenshot: options.after,
          },
        ]
      : [],
  };
}

export function makeLocateTask(options: {
  taskId: string;
  status?: string;
  before: unknown;
  prompt?: string;
}) {
  return {
    taskId: options.taskId,
    type: 'Planning' as const,
    subType: 'Locate',
    status: options.status ?? 'finished',
    param: { prompt: options.prompt ?? '目标' },
    uiContext: { screenshot: options.before },
    recorder: [],
  };
}

export function makeInsightTask(subType: string, before: unknown) {
  return {
    taskId: `insight-${subType}`,
    type: 'Insight' as const,
    subType,
    status: 'finished',
    param: { assertion: '屏幕显示主屏' },
    uiContext: { screenshot: before },
    recorder: [],
  };
}

export function makeExecution(
  id: string,
  tasks: unknown[],
  name = 'Act - 打开显示设置',
) {
  return { id, name, logTime: 1, tasks };
}

export function makeReportDump(
  executions: unknown[],
  sdkVersion = '1.12.7',
) {
  return { sdkVersion, groupName: 'probe', executions };
}

export function promoteRequest(
  overrides: Partial<RequestKeySource> = {},
): RequestKeySource {
  return {
    caseIdentity: { casePath: 'cases/settings.yaml', caseName: 'settings-display' },
    stepPath: 'steps[2]',
    node: 'aiAct',
    prompt: '打开显示设置',
    eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
    ...overrides,
  };
}

export const TAP_BOX: BoundingBox = { x: 40, y: 24, width: 40, height: 20 };
export const INPUT_BOX: BoundingBox = { x: 16, y: 80, width: 120, height: 28 };
export const SCROLL_BOX: BoundingBox = { x: 0, y: 110, width: 200, height: 40 };
export const LONG_BOX: BoundingBox = { x: 70, y: 40, width: 48, height: 36 };

/** 六类声明动作的完整手写轨迹（仅用于解析/发布测试，不证明原生接口可取数）。 */
export async function makeSupportedChainExecution(executionId = 'exec-complete'): Promise<{
  execution: ReturnType<typeof makeExecution>;
  frames: Record<string, Uint8Array>;
}> {
  const frames = {
    tapBefore: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 200, g: 40, b: 40 }),
    tapAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 40, g: 200, b: 40 }),
    inputAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 40, g: 40, b: 200 }),
    scrollAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 200, g: 200, b: 40 }),
    longAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 200, g: 40, b: 200 }),
    backAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 40, g: 200, b: 200 }),
    homeAfter: await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 120, g: 120, b: 120 }),
  };
  const s = {
    tapBefore: makeScreenshot('tap-before', frames.tapBefore, 1),
    tapAfter: makeScreenshot('tap-after', frames.tapAfter, 2),
    inputAfter: makeScreenshot('input-after', frames.inputAfter, 3),
    scrollAfter: makeScreenshot('scroll-after', frames.scrollAfter, 4),
    longAfter: makeScreenshot('long-after', frames.longAfter, 5),
    backAfter: makeScreenshot('back-after', frames.backAfter, 6),
    homeAfter: makeScreenshot('home-after', frames.homeAfter, 7),
  };
  const execution = makeExecution(executionId, [
    makeActionTask({
      taskId: 't-tap',
      subType: 'Tap',
      param: { locate: makeLocate('设置入口', TAP_BOX) },
      before: s.tapBefore,
      after: s.tapAfter,
    }),
    makeActionTask({
      taskId: 't-input',
      subType: 'Input',
      param: { locate: makeLocate('搜索框', INPUT_BOX), value: '显示', mode: 'replace' },
      before: s.tapAfter,
      after: s.inputAfter,
    }),
    makeActionTask({
      taskId: 't-scroll',
      subType: 'Scroll',
      param: {
        locate: makeLocate('列表', SCROLL_BOX),
        direction: 'down',
        distance: 64,
        scrollType: 'singleAction',
      },
      before: s.inputAfter,
      after: s.scrollAfter,
    }),
    makeActionTask({
      taskId: 't-long',
      subType: 'LongPress',
      param: { locate: makeLocate('图标', LONG_BOX), duration: 800 },
      before: s.scrollAfter,
      after: s.longAfter,
    }),
    makeActionTask({
      taskId: 't-back',
      subType: 'AndroidBackButton',
      before: s.longAfter,
      after: s.backAfter,
    }),
    makeActionTask({
      taskId: 't-home',
      subType: 'AndroidHomeButton',
      before: s.backAfter,
      after: s.homeAfter,
    }),
  ]);
  return { execution, frames };
}
