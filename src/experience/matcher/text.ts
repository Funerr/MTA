import type { LocalOcrEngine, ScoreItem } from './types';
import { MatcherInputError } from './types';

export async function evaluateTextEvidence(input: {
  readonly enabled: boolean;
  readonly engine?: LocalOcrEngine;
  readonly textHint?: string;
  readonly gray?: Uint8Array;
  readonly width?: number;
  readonly height?: number;
}): Promise<ScoreItem> {
  if (!input.enabled) {
    return { value: 1, threshold: 1, passed: true, skipped: true };
  }
  const engine = input.engine;
  if (!engine) {
    throw new MatcherInputError(
      'ocr-unavailable',
      'OCR 已开启但未提供本地引擎；v1 默认关闭 OCR，不内置模型',
    );
  }
  if (engine.modelVersion.trim().length === 0 || engine.languagePackVersion.trim().length === 0) {
    throw new MatcherInputError(
      'invalid-config',
      '本地 OCR 必须固定 modelVersion 与 languagePackVersion',
    );
  }
  const hint = input.textHint?.trim();
  if (!hint) {
    return { value: 1, threshold: 1, passed: true, skipped: true };
  }
  if (!input.gray || input.width === undefined || input.height === undefined) {
    throw new MatcherInputError('invalid-image', 'OCR 缺少目标图像');
  }
  const recognized = await engine.recognize({
    gray: input.gray,
    width: input.width,
    height: input.height,
  });
  const normalizedHint = normalizeText(hint);
  const normalizedText = normalizeText(recognized.text);
  const passed = normalizedText.includes(normalizedHint);
  return { value: passed ? 1 : 0, threshold: 1, passed };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}
