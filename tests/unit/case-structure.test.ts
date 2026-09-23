import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CaseStructureError,
  assertCasePathNaming,
  caseFileStem,
  executionProjectOf,
  inferExamplesProject,
  isCaseSegmentName,
  loadProjectDeclarations,
  parseBindingAliases,
  parseCaseDeviceRequirements,
  parseProjectDeclaration,
  resolveNamespaceTarget,
  validateDeviceRequirements,
  type DeviceBinding,
  type ProjectInfo,
} from '../../scripts/lib/case-structure.mjs';

describe('项目声明 schema（1.1）', () => {
  it('接受合法声明（platform + 可选 devices）', () => {
    expect(parseProjectDeclaration('platform: android\n')).toEqual({ platform: 'android', devices: [] });
    expect(
      parseProjectDeclaration('platform: multi-device\ndevices:\n  - DUT1\n  - DUT2\n'),
    ).toEqual({ platform: 'multi-device', devices: ['DUT1', 'DUT2'] });
  });

  it('拒绝缺失 platform 的声明', () => {
    expect(() => parseProjectDeclaration('devices: []\n', 'cases/EV760/project.yaml')).toThrow(
      'cases/EV760/project.yaml 声明非法',
    );
    expect(() => parseProjectDeclaration('', 'project.yaml')).toThrow('声明非法');
  });

  it('拒绝非法 platform 取值', () => {
    expect(() => parseProjectDeclaration('platform: ios\n')).toThrow('声明非法');
    expect(() => parseProjectDeclaration('platform: Android\n')).toThrow('声明非法');
  });

  it('拒绝非法 devices（坏别名 / 重复别名）', () => {
    expect(() => parseProjectDeclaration('platform: multi-device\ndevices: ["1bad"]\n')).toThrow('声明非法');
    expect(() => parseProjectDeclaration('platform: multi-device\ndevices: [DUT1, DUT1]\n')).toThrow('重复');
  });

  it('loadProjectDeclarations 拒绝缺 project.yaml 的项目目录并拒绝非英文目录名', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-case-structure-'));
    try {
      mkdirSync(join(root, 'cases', 'EV760'), { recursive: true });
      expect(() => loadProjectDeclarations(root)).toThrow('项目声明缺失：cases/EV760/project.yaml');
      writeFileSync(join(root, 'cases', 'EV760', 'project.yaml'), 'platform: android\n');
      mkdirSync(join(root, 'cases', '中文项目'), { recursive: true });
      expect(() => loadProjectDeclarations(root)).toThrow('命名不合规范');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('loadProjectDeclarations 读取多个项目并按名称排序', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-case-structure-'));
    try {
      for (const [name, platform] of [
        ['EV720', 'harmony'],
        ['EV760', 'android'],
      ] as const) {
        mkdirSync(join(root, 'cases', name), { recursive: true });
        writeFileSync(join(root, 'cases', name, 'project.yaml'), `platform: ${platform}\n`);
      }
      const declarations = loadProjectDeclarations(root);
      expect(declarations.map((entry) => [entry.name, entry.platform])).toEqual([
        ['EV720', 'harmony'],
        ['EV760', 'android'],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('英文命名规范（1.2）', () => {
  it('接受英文 kebab-case 与机型代号（允许大写）', () => {
    expect(isCaseSegmentName('EV760')).toBe(true);
    expect(isCaseSegmentName('adjust-brightness')).toBe(true);
    expect(isCaseSegmentName('adjust_brightness')).toBe(false);
    expect(caseFileStem('adjust-brightness.yaml')).toBe('adjust-brightness');
    expect(caseFileStem('open.android.yaml')).toBe('open.android');
    expect(() => assertCasePathNaming('EV760/system/display/adjust-brightness.yaml')).not.toThrow();
  });

  it('拒绝含中文（非 ASCII）的路径并提示改名', () => {
    expect(() => assertCasePathNaming('EV760/整机/亮度.yaml')).toThrow('非 ASCII');
    expect(() => assertCasePathNaming('EV760/system/亮度.yaml')).toThrow('英文 kebab-case');
  });

  it('范围扫描遇到命名不合规的 YAML 文件显式报错，不静默跳过', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-case-structure-'));
    try {
      mkdirSync(join(root, 'cases', 'EV760', 'system'), { recursive: true });
      writeFileSync(join(root, 'cases', 'EV760', 'project.yaml'), 'platform: android\n');
      writeFileSync(join(root, 'cases', 'EV760', 'system', '亮度.yaml'), 'cases: []\n');
      const declarations = loadProjectDeclarations(root);
      expect(() => resolveNamespaceTarget('EV760/system', root, declarations)).toThrow('非 ASCII');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝不合规范的目录名与文件名', () => {
    expect(() => assertCasePathNaming('EV760/system dir/x.yaml')).toThrow('命名不合规范');
    expect(() => assertCasePathNaming('EV760/system/x.YAML')).toThrow('命名不合规范');
  });
});

describe('用例头部设备需求（1.4）', () => {
  const bindings: DeviceBinding[] = parseBindingAliases(
    'DUT1:android:MULTI_DEVICE_DUT1_ID,DUT2:harmony:MULTI_DEVICE_DUT2_ID',
    '',
  );

  it('解析 # devices: 注释（可选声明，缺省 undefined）', () => {
    expect(parseCaseDeviceRequirements('# devices: DUT1, DUT2\ncases: []\n')).toEqual(['DUT1', 'DUT2']);
    expect(parseCaseDeviceRequirements('# devices: [DUT1, DUT2]\ncases: []\n')).toEqual(['DUT1', 'DUT2']);
    expect(parseCaseDeviceRequirements('cases: []\n')).toBeUndefined();
    expect(() => parseCaseDeviceRequirements('# devices: 9DUT\n')).toThrow('别名非法');
  });

  it('需求与绑定一致时无问题', () => {
    expect(
      validateDeviceRequirements({
        platform: 'multi-device',
        caseDevices: ['DUT1', 'DUT2'],
        projectDevices: ['DUT1', 'DUT2'],
        bindingAliases: bindings,
      }),
    ).toEqual([]);
  });

  it('缺失别名：用例需求未在项目声明中出现', () => {
    const problems = validateDeviceRequirements({
      platform: 'multi-device',
      caseDevices: ['DUT3'],
      projectDevices: ['DUT1', 'DUT2'],
      bindingAliases: parseBindingAliases(
        'DUT1:android:MULTI_DEVICE_DUT1_ID,DUT2:harmony:MULTI_DEVICE_DUT2_ID,DUT3:android:MULTI_DEVICE_DUT3_ID',
        '',
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('DUT3');
    expect(problems[0]).toContain('project.yaml');
  });

  it('未绑定设备：别名未出现在 MULTI_DEVICE_BINDINGS', () => {
    const problems = validateDeviceRequirements({
      platform: 'multi-device',
      caseDevices: ['DUT3'],
      projectDevices: ['DUT3'],
      bindingAliases: bindings,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('MULTI_DEVICE_BINDINGS 未绑定');
  });

  it('单设备项目拒绝设备需求声明', () => {
    const problems = validateDeviceRequirements({
      platform: 'android',
      caseDevices: ['DUT1'],
      projectDevices: ['DUT1'],
      bindingAliases: bindings,
    });
    expect(problems[0]).toContain('仅用于协作项目');
  });

  it('parseBindingAliases 校验格式', () => {
    expect(parseBindingAliases(undefined, 'phone1:android:ENV_A,phone2:harmony:ENV_B')).toHaveLength(2);
    expect(() => parseBindingAliases('DUT1:android', '')).toThrow('MULTI_DEVICE_BINDINGS 声明无效');
  });
});

describe('命名空间目标解析（结构层）', () => {
  const root = mkdtempSync(join(tmpdir(), 'mta-case-structure-'));
  const files = [
    'cases/EV760/project.yaml',
    'cases/EV760/system/display/adjust-brightness.yaml',
    'cases/EV760/system/display/repeat-screen-on-off.yaml',
    'cases/EV760/protocols/bluetooth/dual-device-pairing.yaml',
    'cases/EV720/project.yaml',
    'cases/EV720/core/calls/mo-mt-call.yaml',
  ];
  for (const file of files) {
    mkdirSync(join(root, file.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(root, file), file.endsWith('project.yaml') ? 'platform: android\n' : 'cases: []\n');
  }
  writeFileSync(join(root, 'cases/EV720/project.yaml'), 'platform: harmony\n');

  it('解析项目 / 模块 / 特性 / 用例各粒度', () => {
    const declarations = loadProjectDeclarations(root);
    expect(resolveNamespaceTarget('EV760', root, declarations).files).toEqual([
      'cases/EV760/protocols/bluetooth/dual-device-pairing.yaml',
      'cases/EV760/system/display/adjust-brightness.yaml',
      'cases/EV760/system/display/repeat-screen-on-off.yaml',
    ]);
    expect(resolveNamespaceTarget('EV760/system', root, declarations).files).toHaveLength(2);
    expect(resolveNamespaceTarget('cases/EV760/system/display', root, declarations).kind).toBe('scope');
    expect(
      resolveNamespaceTarget('EV760/system/display/adjust-brightness', root, declarations).files,
    ).toEqual(['cases/EV760/system/display/adjust-brightness.yaml']);
    expect(
      resolveNamespaceTarget('EV760/system/display/adjust-brightness.yaml', root, declarations).kind,
    ).toBe('case');
  });

  it('目标不存在时列出可选项', () => {
    const declarations = loadProjectDeclarations(root);
    expect(() => resolveNamespaceTarget('EV999', root, declarations)).toThrow('可用项目');
    expect(() => resolveNamespaceTarget('EV760/camera', root, declarations)).toThrow('下可用：protocols、system');
    expect(() => resolveNamespaceTarget('EV760/system/missing-case', root, declarations)).toThrow('目标不存在');
    expect(() => resolveNamespaceTarget('EV760/system/display/nope.yaml.yaml', root, declarations)).toThrow(
      '目标不存在',
    );
  });

  it('归属由项目声明决定，文件名后缀不参与；examples/ 沿用后缀或目录推断', () => {
    const declarations: ProjectInfo[] = loadProjectDeclarations(root);
    expect(executionProjectOf('cases/EV760/system/display/adjust-brightness.yaml', declarations)).toBe('android');
    expect(executionProjectOf('cases/EV720/core/calls/mo-mt-call.yaml', declarations)).toBe('harmony');
    expect(executionProjectOf('cases/EV760/system/display/open.harmony.yaml', declarations)).toBe('android');
    expect(inferExamplesProject('examples/android/camera-gallery.yaml')).toBe('android');
    expect(inferExamplesProject('examples/harmony/demo/basic.harmony.yaml')).toBe('harmony');
    expect(inferExamplesProject('examples/harmony-experience/experience-learn.yaml')).toBeUndefined();
  });

  it('CaseStructureError 可识别', () => {
    expect(() => assertCasePathNaming('中文.yaml')).toThrow(CaseStructureError);
  });
});
