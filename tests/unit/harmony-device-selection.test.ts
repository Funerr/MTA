import { describe, expect, it } from 'vitest';
import {
  HarmonySessionSetupError,
  createHarmonySession,
  selectHarmonyDevice,
  type HarmonyAgentFactory,
  type HarmonyDeviceEntry,
  type HarmonyDeviceLister,
} from '../../src/setup/harmony';

const device = (deviceId: string): HarmonyDeviceEntry => ({ deviceId });

const listerOf =
  (devices: readonly HarmonyDeviceEntry[]): HarmonyDeviceLister =>
  async () =>
    devices;

describe('selectHarmonyDevice：显式指定 HARMONY_DEVICE_ID', () => {
  it('目标存在时选择该设备', () => {
    const devices = [device('har-1'), device('har-2')];
    expect(selectHarmonyDevice(devices, 'har-2')).toEqual({
      deviceId: 'har-2',
    });
  });

  it('HARMONY_DEVICE_ID 前后空白被忽略', () => {
    expect(selectHarmonyDevice([device('har-1')], '  har-1 \t')).toEqual({
      deviceId: 'har-1',
    });
  });

  it('目标不存在时报错并列出当前目标，不静默切换', () => {
    const devices = [device('har-1'), device('har-2')];
    expect(() => selectHarmonyDevice(devices, 'har-404')).toThrow(
      HarmonySessionSetupError,
    );
    try {
      selectHarmonyDevice(devices, 'har-404');
    } catch (error) {
      const message = String(error);
      expect(message).toContain('har-404');
      expect(message).toContain('har-1');
      expect(message).toContain('har-2');
    }
  });
});

describe('selectHarmonyDevice：未指定目标（无授权状态字段，仅在线目标）', () => {
  it('恰有一台在线目标时自动选择', () => {
    expect(selectHarmonyDevice([device('har-1')], undefined)).toEqual({
      deviceId: 'har-1',
    });
  });

  it('多台在线目标时因歧义报错并列出目标', () => {
    const devices = [device('har-1'), device('har-2')];
    expect(() => selectHarmonyDevice(devices, undefined)).toThrow(
      HarmonySessionSetupError,
    );
    try {
      selectHarmonyDevice(devices, undefined);
    } catch (error) {
      const message = String(error);
      expect(message).toContain('har-1');
      expect(message).toContain('har-2');
      expect(message).toContain('HARMONY_DEVICE_ID');
    }
  });

  it('没有任何设备时报错并指向 hdc list targets', () => {
    expect(() => selectHarmonyDevice([], undefined)).toThrow(
      /没有已连接的 HarmonyOS 设备.*hdc list targets/s,
    );
  });
});

describe('createHarmonySession：边界替身下的会话建立', () => {
  const fakeAgent = { tag: 'agent' } as never;
  const factory: HarmonyAgentFactory = async () => fakeAgent;

  it('按所选设备调用 Agent 工厂并返回会话', async () => {
    const created: string[] = [];
    const session = await createHarmonySession(
      { HARMONY_DEVICE_ID: 'har-2' },
      {
        listDevices: listerOf([device('har-1'), device('har-2')]),
        createAgent: async (deviceId) => {
          created.push(deviceId);
          return fakeAgent;
        },
      },
    );
    expect(created).toEqual(['har-2']);
    expect(session.deviceId).toBe('har-2');
    expect(session.agent).toBe(fakeAgent);
  });

  it('未指定且唯一在线目标时自动选择', async () => {
    const session = await createHarmonySession(
      {},
      {
        listDevices: listerOf([device('har-1')]),
        createAgent: factory,
      },
    );
    expect(session.deviceId).toBe('har-1');
  });

  it('选择失败时不创建 Agent（不派发设备操作）', async () => {
    let created = 0;
    await expect(
      createHarmonySession(
        {},
        {
          listDevices: listerOf([device('har-1'), device('har-2')]),
          createAgent: async () => {
            created += 1;
            return fakeAgent;
          },
        },
      ),
    ).rejects.toBeInstanceOf(HarmonySessionSetupError);
    expect(created).toBe(0);
  });

  it('HDC 枚举失败时包装为可定位错误并保留原始 cause', async () => {
    const hdcFailure = new Error('hdc: command not found');
    const failingLister: HarmonyDeviceLister = async () => {
      throw hdcFailure;
    };
    await expect(
      createHarmonySession(
        {},
        { listDevices: failingLister, createAgent: factory },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HarmonySessionSetupError);
      expect(String(error)).toContain('hdc: command not found');
      expect((error as HarmonySessionSetupError).cause).toBe(hdcFailure);
      return true;
    });
  });

  it('连接失败（Agent 建立被拒）时错误原样传播', async () => {
    const connectFailure = new Error('connect rejected');
    await expect(
      createHarmonySession(
        {},
        {
          listDevices: listerOf([device('har-1')]),
          createAgent: () => Promise.reject(connectFailure),
        },
      ),
    ).rejects.toBe(connectFailure);
  });
});
