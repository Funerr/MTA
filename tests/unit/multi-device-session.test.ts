import { describe, expect, it, vi } from 'vitest';
import { createProjectRuntime } from '@midscene/test';
import {
  createMultiDeviceProjectSetup,
  MultiDeviceSessionSetupError,
} from '../../src/setup/multi-device';
import { parseMultiDeviceBindings } from '../../src/setup/multi-device-config';

function makeStubAgent(label: string, destroyImpl?: () => Promise<void>) {
  const calls: string[] = [];
  const agent = {
    home: async () => {
      calls.push(`${label}:home`);
    },
    destroy: async () => {
      calls.push(`${label}:destroy`);
      await destroyImpl?.();
    },
  };
  return { agent, calls };
}

const bindings = parseMultiDeviceBindings(
  'phone1:android:A_ID,phone2:harmony:B_ID',
);

function project() {
  return {
    projectId: 'multi-device',
    name: 'multi-device',
    tags: { include: [], exclude: [] },
    retry: 0,
    variables: {},
  } as const;
}

describe('createMultiDeviceProjectSetup', () => {
  it('构造 setup 时不枚举、不连接设备', () => {
    const listAndroid = vi.fn(async () => [{ udid: 'emu-1', state: 'device' as const }]);
    const listHarmony = vi.fn(async () => [{ deviceId: 'har-1' }]);
    const createAndroid = vi.fn();
    const createHarmony = vi.fn();
    createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: listAndroid,
      listHarmonyDevices: listHarmony,
      createAndroidAgent: createAndroid,
      createHarmonyAgent: createHarmony,
    });
    expect(listAndroid).not.toHaveBeenCalled();
    expect(listHarmony).not.toHaveBeenCalled();
    expect(createAndroid).not.toHaveBeenCalled();
    expect(createHarmony).not.toHaveBeenCalled();
  });

  it('全部连接成功：上下文含别名与真实 ID，teardown 各释放一次', async () => {
    const android = makeStubAgent('android');
    const harmony = makeStubAgent('harmony');
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmonyDevices: async () => [{ deviceId: 'har-1' }],
      createAndroidAgent: async (udid, alias) => {
        expect(udid).toBe('emu-1');
        expect(alias).toBe('phone1');
        return android.agent as never;
      },
      createHarmonyAgent: async (deviceId, alias) => {
        expect(deviceId).toBe('har-1');
        expect(alias).toBe('phone2');
        return harmony.agent as never;
      },
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const runtime = createProjectRuntime({
      project: project(),
      setup,
    });
    vi.stubEnv('A_ID', 'emu-1');
    vi.stubEnv('B_ID', 'har-1');
    try {
      const started = await runtime.start();
      expect(started.status).toBe('success');
      expect(runtime.context).toEqual({
        devices: {
          phone1: { platform: 'android', id: 'emu-1', agent: android.agent },
          phone2: { platform: 'harmony', id: 'har-1', agent: harmony.agent },
        },
      });
      expect(info.mock.calls.flat().join('\n')).toContain('phone1');
      expect(info.mock.calls.flat().join('\n')).toContain('emu-1');

      const finished = await runtime.finish();
      expect(finished.status).toBe('success');
      expect(android.calls).toEqual(['android:destroy']);
      expect(harmony.calls).toEqual(['harmony:destroy']);
      await runtime.finish();
      expect(android.calls).toEqual(['android:destroy']);
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('后续设备失败：已取得会话被释放，原始错误与别名可见', async () => {
    const android = makeStubAgent('android');
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmonyDevices: async () => [{ deviceId: 'har-1' }],
      createAndroidAgent: async () => android.agent as never,
      createHarmonyAgent: async () => {
        throw new Error('hdc connect failed');
      },
    });
    vi.stubEnv('A_ID', 'emu-1');
    vi.stubEnv('B_ID', 'har-1');
    try {
      const runtime = createProjectRuntime({ project: project(), setup });
      const started = await runtime.start();
      expect(started.status).toBe('failed');
      expect(String(started.setupError)).toContain('phone2');
      expect(String(started.setupError)).toContain('har-1');
      expect(String(started.setupError)).toContain('hdc connect failed');
      expect(started.setupError).toBeInstanceOf(Error);

      const finished = await runtime.finish('failed');
      expect(android.calls).toEqual(['android:destroy']);
      expect(finished.setupError).toBe(started.setupError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('部分连接失败（第一台即失败）不注册 teardown，错误含别名', async () => {
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmonyDevices: async () => [{ deviceId: 'har-1' }],
      createAndroidAgent: async () => {
        throw new Error('adb connect failed');
      },
      createHarmonyAgent: async () => {
        throw new Error('should not connect harmony');
      },
    });
    vi.stubEnv('A_ID', 'emu-1');
    vi.stubEnv('B_ID', 'har-1');
    try {
      const runtime = createProjectRuntime({ project: project(), setup });
      const started = await runtime.start();
      expect(started.status).toBe('failed');
      expect(String(started.setupError)).toContain('phone1');
      expect(String(started.setupError)).toContain('adb connect failed');
      const finished = await runtime.finish('failed');
      expect(finished.teardownErrors ?? []).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('清理失败可见且不遮蔽原始连接错误', async () => {
    const destroyFailure = new Error('destroy failed');
    const android = makeStubAgent('android', () => Promise.reject(destroyFailure));
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmonyDevices: async () => [{ deviceId: 'har-1' }],
      createAndroidAgent: async () => android.agent as never,
      createHarmonyAgent: async () => {
        throw new Error('hdc connect failed');
      },
    });
    vi.stubEnv('A_ID', 'emu-1');
    vi.stubEnv('B_ID', 'har-1');
    try {
      const runtime = createProjectRuntime({ project: project(), setup });
      const started = await runtime.start();
      expect(String(started.setupError)).toContain('hdc connect failed');
      const finished = await runtime.finish('failed');
      expect(String(finished.setupError)).toContain('hdc connect failed');
      expect(finished.teardownErrors?.length).toBe(1);
      expect(String(finished.teardownErrors?.[0])).toContain('destroy failed');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('缺失设备 ID 时不连接任何设备', async () => {
    const createAndroid = vi.fn();
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => [{ udid: 'emu-1', state: 'device' }],
      listHarmonyDevices: async () => [{ deviceId: 'har-1' }],
      createAndroidAgent: createAndroid,
      createHarmonyAgent: vi.fn(),
    });
    const runtime = createProjectRuntime({ project: project(), setup });
    const started = await runtime.start();
    expect(started.status).toBe('failed');
    expect(createAndroid).not.toHaveBeenCalled();
    expect(String(started.setupError)).toMatch(/phone1|A_ID/);
  });
});

describe('MultiDeviceSessionSetupError', () => {
  it('可定位别名与设备标识', () => {
    const error = new MultiDeviceSessionSetupError(
      '设备别名 phone1（android / emu-1）不可用：offline',
    );
    expect(error.name).toBe('MultiDeviceSessionSetupError');
    expect(error.message).toContain('phone1');
    expect(error.message).toContain('emu-1');
  });
});

describe('createProjectRuntime env 注入', () => {
  it('setup 使用运行期 env 解析 ID，不静默改选', async () => {
    const android = makeStubAgent('android');
    const harmony = makeStubAgent('harmony');
    const listed: string[] = [];
    const setup = createMultiDeviceProjectSetup({
      bindings,
      listAndroidDevices: async () => {
        listed.push('android');
        return [
          { udid: 'emu-1', state: 'device' },
          { udid: 'emu-2', state: 'device' },
        ];
      },
      listHarmonyDevices: async () => {
        listed.push('harmony');
        return [{ deviceId: 'har-1' }, { deviceId: 'har-2' }];
      },
      createAndroidAgent: async (udid) => {
        expect(udid).toBe('emu-2');
        return android.agent as never;
      },
      createHarmonyAgent: async (deviceId) => {
        expect(deviceId).toBe('har-2');
        return harmony.agent as never;
      },
    });
    vi.stubEnv('A_ID', 'emu-2');
    vi.stubEnv('B_ID', 'har-2');
    try {
      const runtime = createProjectRuntime({ project: project(), setup });
      await runtime.start();
      expect(runtime.context?.devices.phone1.id).toBe('emu-2');
      expect(runtime.context?.devices.phone2.id).toBe('har-2');
      expect(listed).toEqual(['android', 'harmony']);
      await runtime.finish();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
