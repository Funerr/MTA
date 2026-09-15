import type { BoundingBox } from '../schema/action';
import {
  IGNORED_ACTION_SUBTYPES,
  LOCKED_MIDSCENE_VERSION,
  NATIVE_ACTION_TYPE_MAP,
  TRACE_ADAPTER_VERSION,
  UNMODELED_INSIGHT_SUBTYPES,
  type NativeActionSubType,
} from './constants';
import { defaultImagePipeline, type ImagePipeline } from './image';
import {
  extractScreenshotBytes,
  screenshotCapturedAt,
  screenshotIdOf,
} from './screenshot';
import type {
  AdaptResult,
  NormalizedAction,
  NormalizedLocateTarget,
  NormalizedScreenshot,
  NormalizedTrace,
  PromotionSkipKind,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTasks(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord);
}

export function isExecutionDump(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.tasks);
}

export function isReportDump(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.executions);
}

export function listExecutions(dump: unknown): Record<string, unknown>[] {
  if (isReportDump(dump) && isRecord(dump)) {
    return (dump.executions as unknown[]).filter(isRecord);
  }
  if (isExecutionDump(dump) && isRecord(dump)) return [dump];
  return [];
}

export function executionIdsOf(dump: unknown): string[] {
  return listExecutions(dump)
    .map((execution) => (typeof execution.id === 'string' ? execution.id : ''))
    .filter((id) => id.length > 0);
}

export function sdkVersionOf(dump: unknown): string {
  if (isRecord(dump) && typeof dump.sdkVersion === 'string' && dump.sdkVersion.length > 0) {
    return dump.sdkVersion;
  }
  return LOCKED_MIDSCENE_VERSION;
}

/**
 * 按 call 隔离执行记录：必须能唯一确定本次调用的 ExecutionDump。
 * 多个未过滤 execution 视为跨调用污染。
 */
export type IsolateResult =
  | { readonly ok: true; readonly execution: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string; readonly kind: PromotionSkipKind };

export function isolateExecution(
  dump: unknown,
  options: {
    readonly executionId?: string;
    readonly knownIds?: ReadonlySet<string>;
  } = {},
): IsolateResult {
  const executions = listExecutions(dump);
  if (executions.length === 0) {
    return { ok: false, kind: 'missing-evidence', reason: 'dump 中没有任何 execution 记录' };
  }
  if (options.executionId) {
    const matched = executions.filter((execution) => execution.id === options.executionId);
    if (matched.length !== 1) {
      return {
        ok: false,
        kind: 'cross-call-pollution',
        reason: `无法按 executionId=${options.executionId} 唯一隔离轨迹（匹配 ${matched.length} 条）`,
      };
    }
    return { ok: true, execution: matched[0]! };
  }
  if (options.knownIds) {
    const knownIds = options.knownIds;
    const fresh = executions.filter((execution) => {
      return typeof execution.id !== 'string' || !knownIds.has(execution.id);
    });
    if (fresh.length !== 1) {
      return {
        ok: false,
        kind: 'cross-call-pollution',
        reason: `同次调用结束后应恰好新增 1 条 execution，实际 ${fresh.length} 条`,
      };
    }
    return { ok: true, execution: fresh[0]! };
  }
  if (executions.length !== 1) {
    return {
      ok: false,
      kind: 'cross-call-pollution',
      reason: `dump 含 ${executions.length} 条 execution，未指定 call 隔离条件，拒绝混杂轨迹`,
    };
  }
  return { ok: true, execution: executions[0]! };
}

async function toNormalizedScreenshot(
  item: unknown,
  pipeline: ImagePipeline,
): Promise<NormalizedScreenshot | undefined> {
  const bytes = extractScreenshotBytes(item);
  if (!bytes) return undefined;
  try {
    const decoded = await pipeline.decode(bytes);
    return {
      id: screenshotIdOf(item, decoded.png),
      png: decoded.png,
      width: decoded.width,
      height: decoded.height,
      capturedAt: screenshotCapturedAt(item),
    };
  } catch {
    return undefined;
  }
}

function afterCallingItem(task: Record<string, unknown>): unknown {
  const recorder = Array.isArray(task.recorder) ? task.recorder : [];
  for (let i = recorder.length - 1; i >= 0; i -= 1) {
    const item = recorder[i];
    if (isRecord(item) && item.timing === 'after-calling') return item.screenshot;
  }
  return undefined;
}

function uiScreenshotOf(task: Record<string, unknown>): unknown {
  return isRecord(task.uiContext) ? task.uiContext.screenshot : undefined;
}

function roundInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(value);
}

function readBbox(locate: Record<string, unknown>): BoundingBox | undefined {
  const rect = locate.rect;
  if (!isRecord(rect)) return undefined;
  const x = roundInt(rect.left);
  const y = roundInt(rect.top);
  const width = roundInt(rect.width);
  const height = roundInt(rect.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function readCenter(locate: Record<string, unknown>): { x: number; y: number } | undefined {
  const center = locate.center;
  if (!Array.isArray(center) || center.length !== 2) return undefined;
  const x = roundInt(center[0]);
  const y = roundInt(center[1]);
  if (x === undefined || y === undefined || x < 0 || y < 0) return undefined;
  return { x, y };
}

function readLocate(param: unknown): Record<string, unknown> | undefined {
  if (!isRecord(param)) return undefined;
  if (isRecord(param.locate)) return param.locate;
  return undefined;
}

function locateTarget(
  locate: Record<string, unknown>,
  before: NormalizedScreenshot,
): NormalizedLocateTarget | { error: string } {
  const bbox = readBbox(locate);
  const center = readCenter(locate);
  if (!bbox || !center) {
    return { error: '有目标动作缺少截图像素空间的 rect/center，拒绝用近似框补全' };
  }
  if (bbox.x + bbox.width > before.width || bbox.y + bbox.height > before.height) {
    return {
      error: `目标 bbox (${bbox.x},${bbox.y},${bbox.width}x${bbox.height}) 越出操作前截图 (${before.width}x${before.height})`,
    };
  }
  if (center.x >= before.width || center.y >= before.height) {
    return {
      error: `目标中心 (${center.x},${center.y}) 越出操作前截图 (${before.width}x${before.height})`,
    };
  }
  const description = locate.description;
  return {
    bbox,
    center,
    textHint:
      typeof description === 'string' && description.length > 0 ? description : undefined,
  };
}

function mapInputParams(
  param: Record<string, unknown>,
): { text: string; mode: 'append' | 'replace' } | { error: string } {
  const text = param.value;
  if (typeof text !== 'string' || text.length === 0) {
    return { error: 'Input 缺少非空文本参数' };
  }
  const mode = param.mode;
  // 1.12.7 原生默认 replace；typeOnly 表示不清空再输入，对应经验 append。
  if (mode === undefined || mode === 'replace') return { text, mode: 'replace' };
  if (mode === 'append' || mode === 'typeOnly') return { text, mode: 'append' };
  return { error: `Input 模式 "${String(mode)}" 不在声明支持范围（append/replace；原生 typeOnly 映射为 append）` };
}

function mapScrollParams(
  param: Record<string, unknown>,
  target: NormalizedLocateTarget,
):
  | {
      direction: 'up' | 'down' | 'left' | 'right';
      distancePx: number;
      anchor: { x: number; y: number };
    }
  | { error: string } {
  const scrollType = param.scrollType ?? 'singleAction';
  if (scrollType !== 'singleAction') {
    return { error: `Scroll.scrollType=${String(scrollType)} 无法映射为固定像素距离` };
  }
  const distance = param.distance;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
    return { error: 'Scroll 缺少正整数像素距离 distancePx（原生 distance 为空或非正）' };
  }
  const distancePx = Math.round(distance);
  if (distancePx <= 0) return { error: 'Scroll 距离四舍五入后不是正整数像素' };
  const direction = param.direction ?? 'down';
  if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
    return { error: `Scroll 方向 "${String(direction)}" 不受支持` };
  }
  return { direction, distancePx, anchor: target.center };
}

function mapLongPressParams(
  param: Record<string, unknown>,
): { durationMs: number } | { error: string } {
  const duration = param.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return { error: 'LongPress 缺少正整数毫秒 durationMs' };
  }
  const durationMs = Math.round(duration);
  if (durationMs <= 0) return { error: 'LongPress 时长四舍五入后不是正整数毫秒' };
  return { durationMs };
}

function skip(
  kind: 'ineligible-request' | 'dynamic-output' | 'unmodeled-check' | 'empty-chain' | 'unsupported-action' | 'failed-or-cancelled' | 'missing-evidence' | 'cross-call-pollution' | 'duplicate',
  reason: string,
): AdaptResult {
  return { ok: false, kind, reason };
}

/**
 * 将单次 ExecutionDump 转为按 call 隔离的规范化动作链。
 * 不从提示词猜测动作；缺帧、未知类型、失败/取消一律整链拒绝。
 */
export async function adaptExecution(
  execution: Record<string, unknown>,
  options: {
    readonly midsceneVersion?: string;
    readonly pipeline?: ImagePipeline;
  } = {},
): Promise<AdaptResult> {
  const pipeline = options.pipeline ?? defaultImagePipeline;
  const tasks = asTasks(execution.tasks);
  if (!tasks) return skip('missing-evidence', 'execution.tasks 不是数组');

  for (const task of tasks) {
    const status = task.status;
    if (status === 'failed' || status === 'cancelled') {
      return skip(
        'failed-or-cancelled',
        `轨迹含 ${String(status)} 任务 ${String(task.type)}/${String(task.subType)}，整链跳过`,
      );
    }
    if (task.type === 'Insight' && typeof task.subType === 'string') {
      if (UNMODELED_INSIGHT_SUBTYPES.has(task.subType)) {
        return skip(
          'unmodeled-check',
          `轨迹含未建模语义检查 ${task.subType}，不能生成可重放动作经验`,
        );
      }
    }
  }

  const screenshots = new Map<object, NormalizedScreenshot | undefined>();
  const screenshotOf = async (item: unknown) => {
    if (isRecord(item) && screenshots.has(item)) return screenshots.get(item);
    const normalized = await toNormalizedScreenshot(item, pipeline);
    if (isRecord(item)) screenshots.set(item, normalized);
    return normalized;
  };

  const befores: Array<NormalizedScreenshot | undefined> = [];
  const afters: Array<NormalizedScreenshot | undefined> = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]!;
    befores[i] = await screenshotOf(uiScreenshotOf(task));
    const afterItem = afterCallingItem(task);
    afters[i] = afterItem ? await screenshotOf(afterItem) : undefined;
  }

  const resolveAfter = (index: number): NormalizedScreenshot | undefined => {
    if (afters[index]) return afters[index];
    const beforeId = befores[index]?.id;
    for (let j = index + 1; j < tasks.length; j += 1) {
      const candidate = befores[j];
      if (candidate && candidate.id !== beforeId) return candidate;
      if (afters[j] && afters[j]!.id !== beforeId) return afters[j];
    }
    return undefined;
  };

  const actions: NormalizedAction[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]!;
    if (task.type !== 'Action Space') continue;
    const subType = typeof task.subType === 'string' ? task.subType : '';
    if (IGNORED_ACTION_SUBTYPES.has(subType)) continue;
    const mapped = NATIVE_ACTION_TYPE_MAP[subType as NativeActionSubType];
    if (!mapped) {
      return skip('unsupported-action', `链中包含未声明支持的操作 ${subType || '(missing)'}，整链跳过`);
    }
    const before = befores[i];
    const after = resolveAfter(i);
    if (!before || !after) {
      return skip(
        'missing-evidence',
        `动作 ${subType} 缺少可证明关联的 before/after 截图，拒绝用末尾图填充`,
      );
    }
    const taskId = typeof task.taskId === 'string' ? task.taskId : `task-${i}`;
    const param = isRecord(task.param) ? task.param : {};
    const base = { taskId, nativeSubType: subType, before, after };

    if (mapped === 'Back') {
      actions.push({ ...base, type: 'Back' });
      continue;
    }
    if (mapped === 'Home') {
      actions.push({ ...base, type: 'Home' });
      continue;
    }

    const locate = readLocate(param);
    if (!locate) {
      return skip('missing-evidence', `动作 ${subType} 缺少定位结果，不能仅保存坐标猜测`);
    }
    const target = locateTarget(locate, before);
    if ('error' in target) return skip('missing-evidence', `${subType}: ${target.error}`);

    if (mapped === 'Tap') {
      actions.push({ ...base, type: 'Tap', target });
      continue;
    }
    if (mapped === 'Input') {
      const params = mapInputParams(param);
      if ('error' in params) return skip('unsupported-action', params.error);
      actions.push({ ...base, type: 'Input', target, params });
      continue;
    }
    if (mapped === 'Scroll') {
      const params = mapScrollParams(param, target);
      if ('error' in params) return skip('unsupported-action', params.error);
      if (params.anchor.x >= before.width || params.anchor.y >= before.height) {
        return skip(
          'missing-evidence',
          `Scroll 锚点 (${params.anchor.x},${params.anchor.y}) 越出操作前截图`,
        );
      }
      actions.push({ ...base, type: 'Scroll', target, params });
      continue;
    }
    const params = mapLongPressParams(param);
    if ('error' in params) return skip('unsupported-action', params.error);
    actions.push({ ...base, type: 'LongPress', target, params });
  }

  if (actions.length === 0) {
    return skip('empty-chain', '动作链为空；经验必须至少包含一个实际动作');
  }

  const executionId = typeof execution.id === 'string' && execution.id.length > 0 ? execution.id : '';
  if (!executionId) {
    return skip('missing-evidence', 'execution 缺少 id，无法按本次调用隔离');
  }

  const trace: NormalizedTrace = {
    executionId,
    name: typeof execution.name === 'string' ? execution.name : '',
    midsceneVersion: options.midsceneVersion ?? LOCKED_MIDSCENE_VERSION,
    adapterVersion: TRACE_ADAPTER_VERSION,
    actions,
  };
  return { ok: true, trace };
}

/** 先隔离再适配；供学习入口一次处理 Agent.dump。 */
export async function adaptDump(
  dump: unknown,
  options: {
    readonly executionId?: string;
    readonly knownIds?: ReadonlySet<string>;
    readonly midsceneVersion?: string;
    readonly pipeline?: ImagePipeline;
  } = {},
): Promise<AdaptResult> {
  const isolated = isolateExecution(dump, {
    executionId: options.executionId,
    knownIds: options.knownIds,
  });
  if (!isolated.ok) return isolated;
  return adaptExecution(isolated.execution, {
    midsceneVersion: options.midsceneVersion ?? sdkVersionOf(dump),
    pipeline: options.pipeline,
  });
}
