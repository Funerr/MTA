/** 模型传入截图的缩放配置。模块导入不解析环境、不创建 Agent。 */

/** 环境变量名（本框架级约定，官方 @midscene/* 自身不读取该变量）。 */
export const SCREENSHOT_SHRINK_FACTOR_ENV = 'SCREENSHOT_SHRINK_FACTOR';

/** 截图缩放配置非法：非数字或小于 1。 */
export class ScreenshotConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScreenshotConfigError';
  }
}

/** 官方 `AgentOpt.screenshotShrinkFactor` 的最小结构片段，可合并进各平台 AgentOpt。 */
export interface ScreenshotShrinkAgentOptions {
  readonly screenshotShrinkFactor?: number;
}

/**
 * 解析截图缩放因子：缺省或空白视为未设置（用官方默认 1，不缩放）；
 * 其余值必须是有限数字且 >= 1。官方语义：物理分辨率除以该因子后传给模型，
 * 坐标由 Midscene 自动换算回逻辑分辨率。
 */
export function parseScreenshotShrinkFactor(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim();
  if (normalized.length === 0) return undefined;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 1) {
    throw new ScreenshotConfigError(
      `${SCREENSHOT_SHRINK_FACTOR_ENV} 无效：${normalized}。须为 >= 1 的数字（1 表示不缩放，2 表示边长减半）。`,
    );
  }
  return value;
}

/** 从环境读取截图缩放选项，供各平台 Agent 构造时合并。 */
export function screenshotShrinkAgentOptions(
  env: NodeJS.ProcessEnv = process.env,
): ScreenshotShrinkAgentOptions {
  const screenshotShrinkFactor = parseScreenshotShrinkFactor(
    env[SCREENSHOT_SHRINK_FACTOR_ENV],
  );
  return screenshotShrinkFactor === undefined ? {} : { screenshotShrinkFactor };
}
