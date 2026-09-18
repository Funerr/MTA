import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverTestFiles } from '@midscene/test/config';
import { caseFiles, type ExecutionProject } from '../../cases.config';

describe('业务测试集使用官方文件发现', () => {
  it('冒烟是全量的子集，单级不累计，平台隔离且排除演示和夹具', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-suites-'));
    try {
      const projects: ExecutionProject[] = ['android', 'harmony', 'multi-device'];
      const files = projects.flatMap((project) => [
        `cases/level1/settings/open.${project}.yaml`,
        `cases/level2/settings/nested/edit.${project}.yml`,
        `cases/level3/settings/reset.${project}.yaml`,
        `examples/level1/demo.${project}.yaml`,
        `tests/fixtures/level1/demo.${project}.yaml`,
        `cases/android/legacy.${project}.yaml`,
        `cases/level4/future.${project}.yaml`,
      ]);
      files.push('cases/level1/unclassified.yaml');
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), 'cases: []\n');
      }
      for (const project of projects) {
        const discover = (suite: string) => discoverTestFiles(root, caseFiles(project, suite))
          .map((file) => relative(root, file)).sort();
        expect(discover('smoke')).toEqual([`cases/level1/settings/open.${project}.yaml`]);
        expect(discover('level1')).toEqual(discover('smoke'));
        expect(discover('level2')).toEqual([`cases/level2/settings/nested/edit.${project}.yml`]);
        expect(discover('level3')).toEqual([`cases/level3/settings/reset.${project}.yaml`]);
        expect(discover('full')).toEqual([
          ...discover('level1'), ...discover('level2'), ...discover('level3'),
        ].sort());
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['', 'typo', '../examples', 'toString'])('拒绝非法测试集 %s', (suite) => {
    expect(() => caseFiles('android', suite)).toThrow('未知 MTA_SUITE');
  });
});
