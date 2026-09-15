/** 内容寻址资产摘要 / 各类指纹 / 请求 Key 的统一格式：64 位小写十六进制 sha256。 */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** ISO 8601 日期时间（UTC 或带偏移），用于所有取证与修订时间戳。 */
export const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** 项目内相对路径：非绝对、不含 `..` 段（用例与步骤定位使用）。 */
export function isSafeRelativeLocator(value: string): boolean {
  if (value.length === 0 || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  return value.split(/[\\/]+/).every((segment) => segment !== '..');
}
