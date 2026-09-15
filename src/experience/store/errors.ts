/** Store 失败分类；降级决策由 Runtime 负责，Store 不调用 AI。 */
export type ExperienceStoreErrorKind =
  | 'not-found'
  | 'invalid-asset'
  | 'unsupported-version'
  | 'io-error'
  | 'revision-conflict';

export interface ExperienceStoreError {
  readonly kind: ExperienceStoreErrorKind;
  readonly message: string;
  /** 原始错误（io-error 时保留 cause 供诊断）。 */
  readonly cause?: unknown;
}

export type StoreOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExperienceStoreError };

export function storeError(
  kind: ExperienceStoreErrorKind,
  message: string,
  cause?: unknown,
): { ok: false; error: ExperienceStoreError } {
  return { ok: false, error: cause === undefined ? { kind, message } : { kind, message, cause } };
}

export function storeValue<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** 将意外 I/O 异常包装为可区分的 io-error（保留原始异常）。 */
export function asIoError(action: string, error: unknown): { ok: false; error: ExperienceStoreError } {
  const reason = error instanceof Error ? error.message : String(error);
  return storeError(
    'io-error',
    `${action} 时发生 I/O 错误：${reason}`,
    error,
  );
}
