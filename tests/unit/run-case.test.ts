import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RunCaseError,
  buildCommandArgs,
  classifyProgressLine,
  collectSelfCheckIssues,
  parseAdbDevices,
  parseArgs,
  parseHdcTargets,
  reportPathFrom,
  resolvePlan,
  scaffoldProject,
} from '../../scripts/run-case.mjs';

const runCasePath = fileURLToPath(new URL('../../scripts/run-case.mjs', import.meta.url));

function createFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'mta-run-case-'));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

describe('run-case 参数解析（2.1 / 3.1）', () => {
  it('解析命名空间目标与入口自有参数，其余透传官方 CLI', () => {
    expect(
      parseArgs(['EV760/system', 'EV720', '--verbose', '--no-open', '--result-dir', 'out', '--watch']),
    ).toEqual({
      targets: ['EV760/system', 'EV720'],
      passthrough: ['--result-dir', 'out', '--watch'],
      flags: { verbose: true, noOpen: true, all: false, newProject: undefined, platform: undefined },
    });
  });

  it('无目标不再报错（菜单/清单模式由 main 决定）', () => {
    expect(parseArgs([]).targets).toEqual([]);
  });

  it.each([
    [['--project', 'android'], '--project 维度已退役'],
    [['--config', 'x.ts'], '--config 维度已退役'],
    [['--retired-suite', 'smoke'], 'test:cases:smoke（level/smoke 分级）已退役'],
  ])('退役维度显式报错 %s', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
    expect(() => parseArgs(argv)).toThrow('pnpm case');
  });

  it('--platform 取值校验', () => {
    expect(() => parseArgs(['--new-project', 'EV760', '--platform', 'ios'])).toThrow('未知执行平台');
    expect(parseArgs(['--new-project', 'EV760', '--platform', 'android']).flags.newProject).toBe('EV760');
  });
});

describe('命名空间目标解析与分组（2.1 + 1.4）', () => {
  const root = createFixture({
    'cases/EV760/project.yaml': 'platform: android\n',
    'cases/EV760/system/display/adjust-brightness.yaml': 'cases: []\n',
    'cases/EV760/system/display/repeat-screen-on-off.yaml': 'cases: []\n',
    'cases/EV750/project.yaml': 'platform: multi-device\ndevices: [DUT1, DUT2]\n',
    'cases/EV750/protocols/bluetooth/dual-device-pairing.yaml':
      '# devices: DUT1, DUT2\ncases: []\n',
    'examples/android/camera-gallery.yaml': 'cases: []\n',
    'examples/harmony-experience/x.yaml': 'cases: []\n',
  });
  const env = {
    MULTI_DEVICE_BINDINGS: 'DUT1:android:MULTI_DEVICE_DUT1_ID,DUT2:harmony:MULTI_DEVICE_DUT2_ID',
    MULTI_DEVICE_DUT1_ID: 'id-1',
    MULTI_DEVICE_DUT2_ID: 'id-2',
  };

  it('单条、模块、项目粒度解析为文件清单', () => {
    expect(
      resolvePlan({ targets: ['EV760/system/display/adjust-brightness'], repoRoot: root, env }).groups,
    ).toEqual([
      {
        root: 'cases',
        project: 'android',
        files: ['cases/EV760/system/display/adjust-brightness.yaml'],
      },
    ]);
    expect(
      resolvePlan({ targets: ['EV760/system'], repoRoot: root, env }).groups[0].files,
    ).toHaveLength(2);
    expect(resolvePlan({ targets: ['EV760'], repoRoot: root, env }).groups[0].files).toHaveLength(2);
  });

  it('多目标混根分组：按（根 × 执行项目）归组', () => {
    const plan = resolvePlan({
      targets: ['EV750', 'EV760/system/display/adjust-brightness', 'examples/android/camera-gallery.yaml'],
      repoRoot: root,
      env,
    });
    expect(plan.groups).toEqual([
      {
        root: 'cases',
        project: 'multi-device',
        files: ['cases/EV750/protocols/bluetooth/dual-device-pairing.yaml'],
      },
      {
        root: 'cases',
        project: 'android',
        files: ['cases/EV760/system/display/adjust-brightness.yaml'],
      },
      { root: 'examples', project: 'android', files: ['examples/android/camera-gallery.yaml'] },
    ]);
  });

  it('目标不存在或项目缺声明时显式报错', () => {
    expect(() => resolvePlan({ targets: ['EV999'], repoRoot: root, env })).toThrow('项目不存在');
    expect(() => resolvePlan({ targets: ['EV760/camera'], repoRoot: root, env })).toThrow('目标不存在');
  });

  it('设备需求未满足时在执行前失败（1.4）', () => {
    expect(() =>
      resolvePlan({
        targets: ['EV750'],
        repoRoot: root,
        env: { MULTI_DEVICE_BINDINGS: 'DUT9:android:ENV_A,DUT8:harmony:ENV_B' },
      }),
    ).toThrow('设备需求未满足');
    expect(() =>
      resolvePlan({
        targets: ['EV750'],
        repoRoot: root,
        env: {
          MULTI_DEVICE_BINDINGS: 'DUT1:android:MULTI_DEVICE_DUT1_ID,DUT2:harmony:MULTI_DEVICE_DUT2_ID',
        },
      }),
    ).not.toThrow();
  });

  it('演示文件沿用既有推断，根目录之外报错', () => {
    expect(() =>
      resolvePlan({ targets: ['examples/harmony-experience/x.yaml'], repoRoot: root, env }),
    ).toThrow('无法推断演示用例');
  });
});

describe('前置自检（2.2）', () => {
  const modelEnv = {
    MIDSCENE_MODEL_BASE_URL: 'https://example.com',
    MIDSCENE_MODEL_API_KEY: 'key',
    MIDSCENE_MODEL_NAME: 'model',
    MIDSCENE_MODEL_FAMILY: 'qwen',
  };

  it('模型未配置时给单一修复动作并跳过设备检查', () => {
    const issues = collectSelfCheckIssues({
      platforms: ['android'],
      env: {},
      run: () => {
        throw new Error('不应执行设备命令');
      },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('模型未配置');
    expect(issues[0]).toContain('.env');
  });

  it('无可用安卓设备 / 未找到 adb 各自给出动作指引', () => {
    expect(
      collectSelfCheckIssues({
        platforms: ['android'],
        env: { ...modelEnv },
        run: () => ({ ok: true, output: 'List of devices attached\n\n' }),
      })[0],
    ).toContain('没有可用的安卓设备');
    expect(
      collectSelfCheckIssues({
        platforms: ['android'],
        env: { ...modelEnv },
        run: () => ({ ok: false, output: '' }),
      })[0],
    ).toContain('未找到 adb');
  });

  it('多台设备在线时要求显式指定；指定设备缺失时报错', () => {
    const twoDevices = 'List of devices attached\na\tdevice\nb\tdevice\n';
    expect(
      collectSelfCheckIssues({
        platforms: ['android'],
        env: { ...modelEnv },
        run: () => ({ ok: true, output: twoDevices }),
      })[0],
    ).toContain('ANDROID_DEVICE_ID');
    expect(
      collectSelfCheckIssues({
        platforms: ['android'],
        env: { ...modelEnv, ANDROID_DEVICE_ID: 'zzz' },
        run: () => ({ ok: true, output: twoDevices }),
      })[0],
    ).toContain('不在可用列表');
  });

  it('协作项目按设备需求检查绑定与 ID', () => {
    const issues = collectSelfCheckIssues({
      platforms: ['multi-device'],
      deviceRequirements: ['DUT3'],
      env: {
        ...modelEnv,
        MULTI_DEVICE_BINDINGS: 'DUT1:android:ENV_A,DUT2:harmony:ENV_B',
      },
    });
    expect(issues[0]).toContain('未绑定设备 DUT3');
  });

  it('全部就绪时无问题；设备输出解析正确', () => {
    expect(
      collectSelfCheckIssues({
        platforms: ['android'],
        env: { ...modelEnv, ANDROID_DEVICE_ID: 'a' },
        run: () => ({ ok: true, output: 'List of devices attached\na\tdevice\n' }),
      }),
    ).toEqual([]);
    expect(parseAdbDevices('List of devices attached\na\tdevice\nb\tunauthorized\n')).toEqual([
      { id: 'a', state: 'device' },
      { id: 'b', state: 'unauthorized' },
    ]);
    expect(parseHdcTargets('[Empty]\nabc123\tUSB\n')).toEqual([{ id: 'abc123' }]);
  });
});

describe('进度与摘要（2.4）', () => {
  it('进度行回显、失败详情缓存、其余默认隐藏', () => {
    expect(classifyProgressLine('✓ cases/EV760 > 打开蓝牙设置')).toBe('progress');
    expect(classifyProgressLine('Test Files 1 passed')).toBe('progress');
    expect(classifyProgressLine('AssertionError: expected 已连接')).toBe('detail');
    expect(classifyProgressLine('some internal noise')).toBe('quiet');
  });

  it('从输出中提取报告路径', () => {
    expect(
      reportPathFrom(['noise', 'report: midscene_run/report/2026-09-22/index.html']),
    ).toBe('midscene_run/report/2026-09-22/index.html');
    expect(reportPathFrom(['nothing here'])).toBeUndefined();
  });

  it('buildCommandArgs：演示根带 --config，业务根只带 --project', () => {
    expect(buildCommandArgs({ root: 'examples', project: 'android' })).toEqual([
      '--config',
      'midscene.examples.config.ts',
      '--project',
      'android',
    ]);
    expect(buildCommandArgs({ root: 'cases', project: 'harmony' }, ['--result-dir', 'out'])).toEqual([
      '--project',
      'harmony',
      '--result-dir',
      'out',
    ]);
  });
});

describe('新建项目骨架（2.5）', () => {
  it('生成 project.yaml 模板与四大模块目录，重复/坏名报错', () => {
    const root = mkdtempSync(join(tmpdir(), 'mta-scaffold-'));
    try {
      const created = scaffoldProject({ repoRoot: root, name: 'EV760', platform: 'android' });
      expect(created.modules).toEqual(['protocols', 'system', 'core', 'stability']);
      for (const dir of created.modules) {
        expect(existsSync(join(root, 'cases', 'EV760', dir))).toBe(true);
      }
      const template = readFileSync(join(root, 'cases', 'EV760', 'project.yaml'), 'utf8');
      expect(template).toContain('platform: android');
      expect(template).toContain('# devices:');
      expect(() => scaffoldProject({ repoRoot: root, name: 'EV760', platform: 'android' })).toThrow(
        '项目已存在',
      );
      expect(() => scaffoldProject({ repoRoot: root, name: '中文', platform: 'android' })).toThrow(
        '项目名不合规范',
      );
      expect(() => scaffoldProject({ repoRoot: root, name: 'EV770' })).toThrow('--platform');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('菜单与清单（2.3）', () => {
  const fixture = {
    'cases/EV760/project.yaml': 'platform: android\n',
    'cases/EV760/system/display/adjust-brightness.yaml': 'cases: []\n',
  };
  const modelKeys = [
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_API_KEY',
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_FAMILY',
  ];
  function childEnv(root: string) {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      MTA_REPO_ROOT: root,
    };
    for (const key of modelKeys) if (process.env[key]) env[key] = process.env[key];
    for (const key of modelKeys) delete env[key];
    return env;
  }

  it('非交互环境打印范围清单且不阻塞（退出非零）', () => {
    const root = createFixture(fixture);
    try {
      const result = spawnSync(process.execPath, [runCasePath], {
        env: childEnv(root),
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('可执行范围清单');
      expect(result.stdout).toContain('EV760');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    '伪终端菜单下钻执行被自检拦截（模型未配置），可随时退出',
    () => {
      const root = createFixture(fixture);
      try {
        // Python pty 提供真实伪终端；stdin 预喂「下钻三层 → 退出」。
        const ptyScript = 'import pty,sys; pty.spawn(sys.argv[1:])';
        const result = spawnSync(
          'python3',
          ['-c', ptyScript, process.execPath, runCasePath],
          {
            input: '1\n1\n1\nq\n',
            env: childEnv(root),
            encoding: 'utf8',
            timeout: 30000,
          },
        );
        const output = `${result.stdout}${result.stderr}`;
        expect(output).toContain('当前位置：cases / EV760 / system');
        expect(output).toContain('模型未配置');
        expect(output).toContain('已阻止执行');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('MTA_SUITE 环境变量在入口即报退役错误', () => {
    const root = createFixture(fixture);
    try {
      const result = spawnSync(process.execPath, [runCasePath, 'EV760'], {
        env: { ...childEnv(root), MTA_SUITE: 'level2' },
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain('MTA_SUITE（level/smoke 分级）已退役');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('RunCaseError 可识别', () => {
  it('抛出类型稳定', () => {
    expect(() => parseArgs(['--project', 'android'])).toThrow(RunCaseError);
  });
});
