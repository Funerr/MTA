import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverTestFiles } from '@midscene/test/config';
import { caseFiles, type ExecutionProject } from '../../cases.config';

function writeFixture(root: string, files: string[], declarations: Record<string, string> = {}) {
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'cases: []\n');
  }
  for (const [name, platform] of Object.entries(declarations)) {
    mkdirSync(join(root, 'cases', name), { recursive: true });
    writeFileSync(join(root, 'cases', name, 'project.yaml'), `platform: ${platform}\n`);
  }
}

function discover(root: string, project: ExecutionProject) {
  return discoverTestFiles(root, caseFiles(project, { root }))
    .map((file) => relative(root, file))
    .sort();
}

describe('业务测试集按项目声明发现（1.3）', () => {
  it('仅收集声明为该平台的项目目录，排除 project.yaml、演示与夹具', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-suites-'));
    try {
      writeFixture(
        root,
        [
          'cases/EV760/system/display/adjust-brightness.yaml',
          'cases/EV760/system/display/nested/repeat-screen-on-off.yml',
          'cases/EV760/system/display/open.harmony.yaml',
          'cases/EV720/core/calls/mo-mt-call.yaml',
          'cases/EV750/protocols/bluetooth/dual-device-pairing.yaml',
          'examples/android/demo.yaml',
          'tests/fixtures/demo.yaml',
        ],
        { EV760: 'android', EV720: 'harmony', EV750: 'multi-device' },
      );
      expect(discover(root, 'android')).toEqual([
        'cases/EV760/system/display/adjust-brightness.yaml',
        'cases/EV760/system/display/nested/repeat-screen-on-off.yml',
        'cases/EV760/system/display/open.harmony.yaml',
      ]);
      expect(discover(root, 'harmony')).toEqual(['cases/EV720/core/calls/mo-mt-call.yaml']);
      expect(discover(root, 'multi-device')).toEqual([
        'cases/EV750/protocols/bluetooth/dual-device-pairing.yaml',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('文件名后缀不参与归属：open.harmony.yaml 归 android 项目声明', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-suites-'));
    try {
      writeFixture(root, ['cases/EV760/system/display/open.harmony.yaml'], { EV760: 'android' });
      expect(discover(root, 'android')).toEqual(['cases/EV760/system/display/open.harmony.yaml']);
      expect(discover(root, 'harmony')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('无声明项目时返回空集合哨兵，不报收集错误', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-suites-'));
    try {
      writeFixture(root, [], {});
      const selection = caseFiles('android', { root });
      expect(selection.include).toEqual(['__mta_no_matched_files__/*.yaml']);
      expect(discover(root, 'android')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('level/smoke 分级维度已退役：MTA_SUITE 显式给出时报错并指引统一入口', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-suites-'));
    const backup = process.env.MTA_SUITE;
    try {
      writeFixture(root, [], {});
      process.env.MTA_SUITE = 'level2';
      expect(() => caseFiles('android', { root })).toThrow('MTA_SUITE（level/smoke 分级）已退役');
      expect(() => caseFiles('android', { root })).toThrow('pnpm case');
    } finally {
      if (backup === undefined) delete process.env.MTA_SUITE;
      else process.env.MTA_SUITE = backup;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
