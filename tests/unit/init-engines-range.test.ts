import { describe, expect, it } from 'vitest';
import { satisfiesEnginesNode } from '../../scripts/lib/engines-range.mjs';

// 仓库当前 engines.node 约束；用例覆盖合法版本、各分支边界与不可解析格式。
const REPO_ENGINES = '^20.19.0 || ^22.12.0 || >=24.0.0';

describe('satisfiesEnginesNode：仓库约束下的合法判定', () => {
  it.each([
    ['20.19.0', true], // caret 下界含边界
    ['20.19.1', true],
    ['22.12.1', true],
    ['22.12.0', true],
    ['24.0.0', true], // >= 含边界
    ['25.1.0', true],
    ['v22.12.1', true], // v 前缀容忍
  ])('%s → %s', (version, expected) => {
    expect(satisfiesEnginesNode(version, REPO_ENGINES)).toBe(expected);
  });
});

describe('satisfiesEnginesNode：各分支边界外不满足', () => {
  it.each([
    ['18.20.2', REPO_ENGINES], // 低于所有分支
    ['20.18.9', REPO_ENGINES], // ^20.19.0 下界之外
    ['21.0.0', REPO_ENGINES], // ^20 分支上界（不含）
    ['22.11.9', REPO_ENGINES], // ^22.12.0 下界之外
    ['23.999.999', REPO_ENGINES], // ^22 分支上界（不含），未达 >=24
    ['22.12.1', '^22.13.0'], // 单分支下界之外
  ])('%s 不满足 %s', (version, range) => {
    expect(satisfiesEnginesNode(version, range)).toBe(false);
  });
});

describe('satisfiesEnginesNode：caret 0.x 语义', () => {
  it.each([
    ['0.2.3', '^0.2.0', true],
    ['0.2.0', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false], // 0.x 上界是 minor
    ['0.0.5', '^0.0.5', true], // 0.0.x 等价精确匹配
    ['0.0.6', '^0.0.5', false],
  ])('%s vs %s → %s', (version, range, expected) => {
    expect(satisfiesEnginesNode(version, range)).toBe(expected);
  });
});

describe('satisfiesEnginesNode：不可解析输入返回 null（降级警告，不阻断）', () => {
  it.each([
    ['22.12.1', '~22.12.0'], // 不支持的比较符
    ['22.12.1', '>=24'], // 缺 patch 段
    ['22.12.1', '20.x'],
    ['22.12.1', 'latest'],
    ['22.12.1', ''],
    ['22.12', REPO_ENGINES], // 版本缺段
    ['22.12.1-beta.1', REPO_ENGINES], // 预发布号不支持
    ['', REPO_ENGINES],
  ])('%s vs %s → null', (version, range) => {
    expect(satisfiesEnginesNode(version, range)).toBeNull();
  });

  it('容忍范围与版本两侧的空白', () => {
    expect(satisfiesEnginesNode(' 22.12.1 ', ' ^22.12.0 ')).toBe(true);
  });
});
