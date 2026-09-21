/**
 * engines.node 约束的受限 semver 子集解析（纯函数，无副作用）。
 *
 * scripts/init.mjs 在 node_modules 安装之前运行，无法依赖第三方 semver
 * 实现；这里只支持仓库当前约束 `^20.19.0 || ^22.12.0 || >=24.0.0` 用到的
 * 两种比较符（`^x.y.z` 与 `>=x.y.z`，`||` 分支）及标准 caret 的 0.x 语义。
 * 解析不了的范围或版本返回 null，由调用方降级为警告并继续，交由
 * pnpm install 阶段的 engines 提示兜底（见 simplify-project-init design D2）。
 */

/** 解析 `x.y.z`（容忍 v 前缀与首尾空白）；非法返回 null。 */
function parseVersion(input) {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(input ?? '');
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 逐数值段比较，返回 -1 / 0 / 1。 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** 标准 caret 上界；0.0.x 无上界（caret 等价于精确匹配）。 */
function caretUpper(v) {
  if (v[0] > 0) return [v[0] + 1, 0, 0];
  if (v[1] > 0) return [0, v[1] + 1, 0];
  return null;
}

/** 单比较符判定；不支持写法返回 null。 */
function satisfiesComparator(version, token) {
  const gte = /^>=\s*(.+)$/.exec(token);
  if (gte) {
    const target = parseVersion(gte[1]);
    return target ? compareVersions(version, target) >= 0 : null;
  }
  const caret = /^\^\s*(.+)$/.exec(token);
  if (caret) {
    const target = parseVersion(caret[1]);
    if (!target) return null;
    if (compareVersions(version, target) < 0) return false;
    const upper = caretUpper(target);
    return upper
      ? compareVersions(version, upper) < 0
      : compareVersions(version, target) === 0;
  }
  return null;
}

/**
 * 判定 version 是否满足 range。
 * 返回 true / false；任一侧无法按受限子集解析时返回 null（未知，不阻断）。
 */
export function satisfiesEnginesNode(version, range) {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion || typeof range !== 'string' || range.trim() === '') {
    return null;
  }
  let sawAnyBranch = false;
  for (const branch of range.split('||')) {
    const tokens = branch.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const results = tokens.map((token) => satisfiesComparator(parsedVersion, token));
    if (results.some((r) => r === null)) return null; // 分支含不支持写法，整体未知
    if (results.every(Boolean)) return true;
    sawAnyBranch = true;
  }
  return sawAnyBranch ? false : null;
}
