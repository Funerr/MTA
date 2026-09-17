import { describe, expect, it } from 'vitest';
import {
  parseScreenshotShrinkFactor,
  screenshotShrinkAgentOptions,
  ScreenshotConfigError,
  SCREENSHOT_SHRINK_FACTOR_ENV,
} from '../../src/setup/agent-options';

describe('parseScreenshotShrinkFactor', () => {
  it('缺省与空白视为未设置，返回 undefined', () => {
    expect(parseScreenshotShrinkFactor(undefined)).toBeUndefined();
    expect(parseScreenshotShrinkFactor('')).toBeUndefined();
    expect(parseScreenshotShrinkFactor('   ')).toBeUndefined();
  });

  it('解析 >= 1 的有限数字，容忍首尾空白', () => {
    expect(parseScreenshotShrinkFactor('1')).toBe(1);
    expect(parseScreenshotShrinkFactor('2')).toBe(2);
    expect(parseScreenshotShrinkFactor(' 1.5 ')).toBe(1.5);
  });

  it('非数字或小于 1 抛 ScreenshotConfigError', () => {
    for (const raw of ['0', '-1', '0.5', 'abc', 'Infinity', 'NaN']) {
      expect(() => parseScreenshotShrinkFactor(raw)).toThrowError(
        ScreenshotConfigError,
      );
      expect(() => parseScreenshotShrinkFactor(raw)).toThrowError(
        SCREENSHOT_SHRINK_FACTOR_ENV,
      );
    }
  });
});

describe('screenshotShrinkAgentOptions', () => {
  it('未设置时返回空对象，不携带 screenshotShrinkFactor 键', () => {
    const options = screenshotShrinkAgentOptions({});
    expect(options).toEqual({});
    expect('screenshotShrinkFactor' in options).toBe(false);
  });

  it('设置时透传缩放因子', () => {
    expect(
      screenshotShrinkAgentOptions({ SCREENSHOT_SHRINK_FACTOR: '2' }),
    ).toEqual({ screenshotShrinkFactor: 2 });
  });

  it('非法值在 Agent 构造前抛错', () => {
    expect(() =>
      screenshotShrinkAgentOptions({ SCREENSHOT_SHRINK_FACTOR: '0.5' }),
    ).toThrowError(ScreenshotConfigError);
  });
});
