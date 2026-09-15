import { describe, expect, it } from 'vitest';
import {
  AndroidSessionSetupError,
  createAndroidSession,
  selectAndroidDevice,
  type AndroidAgentFactory,
  type AndroidDeviceEntry,
  type AndroidDeviceLister,
} from '../../src/setup/android';

const device = (udid: string, state = 'device'): AndroidDeviceEntry => ({
  udid,
  state,
});

const listerOf =
  (devices: readonly AndroidDeviceEntry[]): AndroidDeviceLister =>
  async () =>
    devices;

describe('selectAndroidDevice：显式指定 ANDROID_DEVICE_ID', () => {
  it('目标存在且已授权在线时选择该设备', () => {
    const devices = [device('emu-1'), device('emu-2')];
    expect(selectAndroidDevice(devices, 'emu-2')).toEqual({ udid: 'emu-2' });
  });

  it('目标不存在时报错并列出当前设备，不静默切换', () => {
    const devices = [device('emu-1'), device('emu-2')];
    expect(() => selectAndroidDevice(devices, 'emu-404')).toThrow(
      AndroidSessionSetupError,
    );
    try {
      selectAndroidDevice(devices, 'emu-404');
    } catch (error) {
      const message = String(error);
      expect(message).toContain('emu-404');
      expect(message).toContain('emu-1');
      expect(message).toContain('emu-2');
    }
  });

  it('目标离线时报错并说明状态', () => {
    expect(() =>
      selectAndroidDevice([device('emu-1', 'offline')], 'emu-1'),
    ).toThrow(/emu-1.*offline/s);
  });

  it('目标未授权时报错并说明状态', () => {
    expect(() =>
      selectAndroidDevice([device('emu-1', 'unauthorized')], 'emu-1'),
    ).toThrow(/emu-1.*unauthorized/s);
  });

  it('仅对目标设备做状态检查，其他设备离线不影响选择', () => {
    const devices = [device('emu-1', 'offline'), device('emu-2')];
    expect(selectAndroidDevice(devices, 'emu-2')).toEqual({ udid: 'emu-2' });
  });
});

describe('selectAndroidDevice：未指定目标', () => {
  it('恰有一台已授权在线设备时自动选择，忽略离线设备', () => {
    const devices = [device('emu-1', 'offline'), device('emu-2')];
    expect(selectAndroidDevice(devices, undefined)).toEqual({ udid: 'emu-2' });
  });

  it('多台已授权在线设备时因歧义报错并列出设备', () => {
    const devices = [device('emu-1'), device('emu-2')];
    expect(() => selectAndroidDevice(devices, undefined)).toThrow(
      AndroidSessionSetupError,
    );
    try {
      selectAndroidDevice(devices, undefined);
    } catch (error) {
      const message = String(error);
      expect(message).toContain('emu-1');
      expect(message).toContain('emu-2');
      expect(message).toContain('ANDROID_DEVICE_ID');
    }
  });

  it('没有任何设备时报错并指向 adb devices', () => {
    expect(() => selectAndroidDevice([], undefined)).toThrow(
      /没有已连接的 Android 设备.*adb devices/s,
    );
  });

  it('有设备但全部离线/未授权时报错并列出状态', () => {
    const devices = [device('emu-1', 'offline'), device('emu-2', 'unauthorized')];
    expect(() => selectAndroidDevice(devices, undefined)).toThrow(
      AndroidSessionSetupError,
    );
    try {
      selectAndroidDevice(devices, undefined);
    } catch (error) {
      const message = String(error);
      expect(message).toContain('offline');
      expect(message).toContain('unauthorized');
    }
  });
});

describe('createAndroidSession：边界替身下的会话建立', () => {
  const fakeAgent = { tag: 'agent' } as never;
  const factory: AndroidAgentFactory = async () => fakeAgent;

  it('ANDROID_DEVICE_ID 前后空白被忽略', () => {
    expect(
      selectAndroidDevice([device('emu-1')], '  emu-1 \t'),
    ).toEqual({ udid: 'emu-1' });
  });

  it('按所选设备调用 Agent 工厂并返回会话', async () => {
    const created: string[] = [];
    const session = await createAndroidSession(
      { ANDROID_DEVICE_ID: 'emu-2' },
      {
        listDevices: listerOf([device('emu-1'), device('emu-2')]),
        createAgent: async (udid) => {
          created.push(udid);
          return fakeAgent;
        },
      },
    );
    expect(created).toEqual(['emu-2']);
    expect(session.udid).toBe('emu-2');
    expect(session.agent).toBe(fakeAgent);
  });

  it('未指定且唯一授权设备时自动选择', async () => {
    const session = await createAndroidSession(
      {},
      {
        listDevices: listerOf([device('emu-1', 'offline'), device('emu-2')]),
        createAgent: factory,
      },
    );
    expect(session.udid).toBe('emu-2');
  });

  it('选择失败时不创建 Agent（不派发设备操作）', async () => {
    let created = 0;
    await expect(
      createAndroidSession(
        {},
        {
          listDevices: listerOf([device('emu-1'), device('emu-2')]),
          createAgent: async () => {
            created += 1;
            return fakeAgent;
          },
        },
      ),
    ).rejects.toBeInstanceOf(AndroidSessionSetupError);
    expect(created).toBe(0);
  });

  it('ADB 枚举失败时包装为可定位错误并保留原始 cause', async () => {
    const adbFailure = new Error('adb: command not found');
    const failingLister: AndroidDeviceLister = async () => {
      throw adbFailure;
    };
    await expect(
      createAndroidSession({}, { listDevices: failingLister, createAgent: factory }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AndroidSessionSetupError);
      expect(String(error)).toContain('adb: command not found');
      expect((error as AndroidSessionSetupError).cause).toBe(adbFailure);
      return true;
    });
  });
});
