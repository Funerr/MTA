import { describe, expect, it } from 'vitest';
import { adaptDump, adaptExecution } from '../../src/experience/promotion/trace-adapter';
import { makeSolidPng } from '../helpers/promotion-png';
import {
  DUMP_HEIGHT,
  DUMP_WIDTH,
  TAP_BOX,
  makeActionTask,
  makeExecution,
  makeInsightTask,
  makeLocate,
  makeLocateTask,
  makeReportDump,
  makeScreenshot,
  makeSupportedChainExecution,
} from '../helpers/promotion-dump';

describe('轨迹适配（任务 2.1）', () => {
  it('完整受支持链按顺序归属 before/after 与目标框', async () => {
    const { execution } = await makeSupportedChainExecution();
    const adapted = await adaptExecution(execution);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.trace.executionId).toBe('exec-complete');
    expect(adapted.trace.actions.map((action) => action.type)).toEqual([
      'Tap',
      'Input',
      'Scroll',
      'LongPress',
      'Back',
      'Home',
    ]);
    const tap = adapted.trace.actions[0];
    expect(tap?.type).toBe('Tap');
    if (tap?.type !== 'Tap') return;
    expect(tap.target.bbox).toEqual(TAP_BOX);
    expect(tap.before.id).toBe('tap-before');
    expect(tap.after.id).toBe('tap-after');
    const input = adapted.trace.actions[1];
    if (input?.type !== 'Input') return;
    expect(input.params).toEqual({ text: '显示', mode: 'replace' });
    const scroll = adapted.trace.actions[2];
    if (scroll?.type !== 'Scroll') return;
    expect(scroll.params.distancePx).toBe(64);
    expect(scroll.params.direction).toBe('down');
    const longPress = adapted.trace.actions[3];
    if (longPress?.type !== 'LongPress') return;
    expect(longPress.params.durationMs).toBe(800);
  });

  it('原生 Input typeOnly 映射为经验 append', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 5, g: 6, b: 7 });
    const before = makeScreenshot('input-before', png, 1);
    const after = makeScreenshot('input-after', png, 2);
    const adapted = await adaptExecution(
      makeExecution('exec-typeonly', [
        makeActionTask({
          taskId: 'input',
          subType: 'Input',
          param: {
            locate: makeLocate('搜索框', TAP_BOX),
            value: '亮度',
            mode: 'typeOnly',
          },
          before,
          after,
        }),
      ]),
    );
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    const input = adapted.trace.actions[0];
    expect(input?.type).toBe('Input');
    if (input?.type !== 'Input') return;
    expect(input.params).toEqual({ text: '亮度', mode: 'append' });
  });

  it('失败任务整链拒绝，不发布剩余动作', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 10, g: 10, b: 10 });
    const before = makeScreenshot('b1', png, 1);
    const after = makeScreenshot('a1', png, 2);
    const adapted = await adaptExecution(
      makeExecution('exec-failed', [
        makeActionTask({
          taskId: 'ok',
          subType: 'Tap',
          param: { locate: makeLocate('a', TAP_BOX) },
          before,
          after,
        }),
        makeActionTask({
          taskId: 'bad',
          subType: 'Tap',
          status: 'failed',
          param: { locate: makeLocate('b', TAP_BOX) },
          before: after,
        }),
      ]),
    );
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.kind).toBe('failed-or-cancelled');
    expect(adapted.reason).toMatch(/failed/);
  });

  it('取消任务整链拒绝', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 11, g: 11, b: 11 });
    const before = makeScreenshot('b1', png, 1);
    const adapted = await adaptExecution(
      makeExecution('exec-cancelled', [
        makeActionTask({
          taskId: 'c1',
          subType: 'AndroidHomeButton',
          status: 'cancelled',
          before,
        }),
      ]),
    );
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.kind).toBe('failed-or-cancelled');
    expect(adapted.reason).toMatch(/cancelled/);
  });

  it('未过滤的多 execution 视为跨调用污染', async () => {
    const { execution } = await makeSupportedChainExecution('exec-a');
    const other = { ...execution, id: 'exec-b' };
    const adapted = await adaptDump(makeReportDump([execution, other]));
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.kind).toBe('cross-call-pollution');
  });

  it('可用 knownIds 隔离本次新增的 execution', async () => {
    const { execution } = await makeSupportedChainExecution('exec-new');
    const stale = { ...execution, id: 'exec-old' };
    const adapted = await adaptDump(makeReportDump([stale, execution]), {
      knownIds: new Set(['exec-old']),
    });
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.trace.executionId).toBe('exec-new');
  });

  it('缺 after 帧且没有后续不同截图时整链拒绝，不用末尾图填充', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 12, g: 12, b: 12 });
    const before = makeScreenshot('only-before', png, 1);
    const adapted = await adaptExecution(
      makeExecution('exec-missing-after', [
        makeActionTask({
          taskId: 'tap',
          subType: 'Tap',
          param: { locate: makeLocate('a', TAP_BOX) },
          before,
        }),
      ]),
    );
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.kind).toBe('missing-evidence');
    expect(adapted.reason).toMatch(/before\/after/);
  });

  it('批量 flush 时用下一任务 uiContext 作为前一动作 after', async () => {
    const first = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 1, g: 2, b: 3 });
    const second = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 4, g: 5, b: 6 });
    const third = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 7, g: 8, b: 9 });
    const s1 = makeScreenshot('frame-1', first, 1);
    const s2 = makeScreenshot('frame-2', second, 2);
    const s3 = makeScreenshot('frame-3', third, 3);
    const adapted = await adaptExecution(
      makeExecution('exec-batch', [
        makeLocateTask({ taskId: 'loc1', before: s1 }),
        makeActionTask({
          taskId: 'tap',
          subType: 'Tap',
          param: { locate: makeLocate('入口', TAP_BOX) },
          before: s1,
        }),
        makeLocateTask({ taskId: 'loc2', before: s2, prompt: '搜索框' }),
        makeActionTask({
          taskId: 'home',
          subType: 'AndroidHomeButton',
          before: s2,
          after: s3,
        }),
      ]),
    );
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.trace.actions).toHaveLength(2);
    expect(adapted.trace.actions[0]?.before.id).toBe('frame-1');
    expect(adapted.trace.actions[0]?.after.id).toBe('frame-2');
    expect(adapted.trace.actions[1]?.before.id).toBe('frame-2');
    expect(adapted.trace.actions[1]?.after.id).toBe('frame-3');
  });

  it('含 Insight 判断的轨迹视为未建模检查', async () => {
    const png = await makeSolidPng(DUMP_WIDTH, DUMP_HEIGHT, { r: 9, g: 9, b: 9 });
    const shot = makeScreenshot('assert', png, 1);
    const adapted = await adaptExecution(
      makeExecution('exec-assert', [
        makeActionTask({
          taskId: 'home',
          subType: 'AndroidHomeButton',
          before: shot,
          after: shot,
        }),
        makeInsightTask('Assert', shot),
      ]),
    );
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.kind).toBe('unmodeled-check');
  });
});
