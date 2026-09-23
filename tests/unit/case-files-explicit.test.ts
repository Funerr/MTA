import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  caseFiles,
  explicitCaseFileSelection,
  explicitCaseFiles,
} from '../../cases.config';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const backup: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    backup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('显式文件清单（内部契约）选择', () => {
  it('未设置时保持目录发现原行为', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-explicit-'));
    try {
      withEnv({ MTA_CASE_FILES: undefined }, () => {
        expect(explicitCaseFiles()).toBeUndefined();
        expect(explicitCaseFileSelection('android', process.env, { root })).toBeUndefined();
        expect(caseFiles('android', { root }).include).toEqual(['__mta_no_matched_files__/*.yaml']);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('caseFiles 尊重显式清单：执行范围收窄到给定用例（回归）', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-explicit-'));
    try {
      mkdirSync(join(root, 'cases', 'EV760', 'system', 'settings'), { recursive: true });
      mkdirSync(join(root, 'cases', 'EV760', 'system', 'bluetooth'), { recursive: true });
      writeFileSync(join(root, 'cases', 'EV760', 'project.yaml'), 'platform: android\n');
      writeFileSync(
        join(root, 'cases', 'EV760', 'system', 'settings', 'open-settings.yaml'),
        'cases: []\n',
      );
      writeFileSync(
        join(root, 'cases', 'EV760', 'system', 'bluetooth', 'open-bluetooth-page.yaml'),
        'cases: []\n',
      );
      withEnv(
        {
          MTA_CASE_FILES: JSON.stringify(['cases/EV760/system/settings/open-settings.yaml']),
        },
        () => {
          expect(caseFiles('android', { root })).toEqual({
            include: ['cases/EV760/system/settings/open-settings.yaml'],
            exclude: [],
          });
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('按项目声明归属拆分到执行项目，后缀不参与', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-explicit-'));
    try {
      for (const [name, platform] of [
        ['EV760', 'android'],
        ['EV720', 'harmony'],
      ] as const) {
        mkdirSync(join(root, 'cases', name), { recursive: true });
        writeFileSync(join(root, 'cases', name, 'project.yaml'), `platform: ${platform}\n`);
      }
      const files = [
        'cases/EV760/system/display/open.harmony.yaml',
        'cases/EV720/core/calls/mo-mt-call.yaml',
        'examples/android/camera-gallery.yaml',
      ];
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), 'cases: []\n');
      }
      withEnv({ MTA_CASE_FILES: JSON.stringify(files) }, () => {
        expect(explicitCaseFileSelection('android', process.env, { root })).toEqual({
          include: ['cases/EV760/system/display/open.harmony.yaml', 'examples/android/camera-gallery.yaml'],
          exclude: [],
        });
        expect(explicitCaseFileSelection('harmony', process.env, { root })).toEqual({
          include: ['cases/EV720/core/calls/mo-mt-call.yaml'],
          exclude: [],
        });
        expect(explicitCaseFileSelection('multi-device', process.env, { root })).toEqual({
          include: ['__mta_no_matched_files__/*.yaml'],
          exclude: [],
        });
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('归属无法确定、根目录之外或 JSON 非法均显式报错', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-explicit-'));
    try {
      mkdirSync(join(root, 'cases', 'EV760'), { recursive: true });
      writeFileSync(join(root, 'cases', 'EV760', 'project.yaml'), 'platform: android\n');
      const orphan = 'cases/EV999/system/display/x.yaml';
      mkdirSync(dirname(join(root, orphan)), { recursive: true });
      writeFileSync(join(root, orphan), 'cases: []\n');
      withEnv({ MTA_CASE_FILES: JSON.stringify([orphan]) }, () => {
        expect(() => explicitCaseFileSelection('android', process.env, { root })).toThrow('项目声明缺失');
      });
      rmSync(join(root, 'cases', 'EV999'), { recursive: true, force: true });
      withEnv({ MTA_CASE_FILES: JSON.stringify(['tests/fixtures/x.yaml']) }, () => {
        expect(() => explicitCaseFileSelection('android', process.env, { root })).toThrow('cases/ 或 examples/');
      });
      withEnv({ MTA_CASE_FILES: '{bad json' }, () => {
        expect(() => explicitCaseFileSelection('android', process.env, { root })).toThrow('不是合法 JSON');
      });
      withEnv({ MTA_CASE_FILES: '[]' }, () => {
        expect(() => explicitCaseFileSelection('android', process.env, { root })).toThrow('非空 JSON');
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
