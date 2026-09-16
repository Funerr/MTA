import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATCHER_CONFIG_VERSION } from '../../src/experience/matcher/constants';
import { CONTEXT_PAD_RATIO } from '../../src/experience/promotion/constants';
import type { BoundingBox } from '../../src/experience/schema/action';

export const EXPERIMENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_ROOT = path.join(EXPERIMENT_ROOT, 'fixtures');
export const OUTPUT_ROOT = path.join(EXPERIMENT_ROOT, 'outputs');

export const EVAL_CONFIG_VERSION = 'visual-assert-eval@1';
export const DATA_VERSION = 'visual-assert-fixtures@1';
export const PROTOCOL_VERSION = 'visual-assert-protocol@1';
export const MATCHER_VERSION = MATCHER_CONFIG_VERSION;
export const IMAGE_PIPELINE_VERSION = 'png-sharp@1';

export const FIXTURE_WIDTH = 360;
export const FIXTURE_HEIGHT = 640;
export const STATUS_BAR_MASK: BoundingBox = {
  x: 0,
  y: 0,
  width: FIXTURE_WIDTH,
  height: 40,
};
export const CONTEXT_PAD = CONTEXT_PAD_RATIO;

export const SUPPORTED_SEMANTIC_TYPES = ['binary-control', 'explicit-text'] as const;
export const OPEN_SEMANTIC_ASSERTIONS = ['页面正常', '布局合理', '无明显异常'] as const;

export const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export const REPRO_COMMAND = 'pnpm exec vitest run tests/unit/experience-visual-assert.test.ts';
