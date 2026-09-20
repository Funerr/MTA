import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../../src/workbench/server/app';
import { Workspace } from '../../src/workbench/server/workspace';
import { DeviceService } from '../../src/workbench/core/devices/device-service';
import type {
  AndroidDeviceEntry,
  AndroidDeviceLister,
} from '../../src/setup/android';
import type { HarmonyDeviceLister } from '../../src/setup/harmony';

// 设备服务单测：注入假 lister / agent 工厂，不触碰真实 adb/hdc。
// 验证显式绑定语义：不存在、不可用、重复绑定都报错，绝不静默切换。

let tempRoot: string;
let destroyedAgents: string[];

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'mta-workbench-dev-'));
  destroyedAgents = [];
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const androidEntry = (udid: string, state = 'device'): AndroidDeviceEntry => ({
  udid,
  state,
});

const makeService = (options?: {
  androidDevices?: readonly AndroidDeviceEntry[];
  harmonyIds?: readonly string[];
}) => {
  const listAndroid: AndroidDeviceLister = async () =>
    options?.androidDevices ?? [];
  const listHarmony: HarmonyDeviceLister = async () =>
    (options?.harmonyIds ?? []).map((deviceId) => ({ deviceId }));
  const service = new DeviceService(
    {
      listAndroid,
      listHarmony,
      createAndroid: async (udid) =>
        ({
          udid,
          destroy: async () => {
            destroyedAgents.push(`android:${udid}`);
          },
        }) as never,
      createHarmony: async (deviceId) =>
        ({
          deviceId,
          destroy: async () => {
            destroyedAgents.push(`harmony:${deviceId}`);
          },
        }) as never,
    },
    new Workspace(join(tempRoot, `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)),
  );
  return service;
};

describe('设备枚举与会话（复用 setup 边界）', () => {
  it('枚举按平台返回，Android 标记可用状态', async () => {
    const service = makeService({
      androidDevices: [
        androidEntry('emu-1'),
        androidEntry('emu-2', 'unauthorized'),
      ],
      harmonyIds: ['hdc-1'],
    });
    expect(await service.list('android')).toEqual([
      { id: 'emu-1', state: 'device', available: true },
      { id: 'emu-2', state: 'unauthorized', available: false },
    ]);
    expect(await service.list('harmony')).toEqual([
      { id: 'hdc-1', available: true },
    ]);
  });

  it('显式绑定存在的设备；多台在线也不切换到其他设备', async () => {
    const service = makeService({
      androidDevices: [androidEntry('emu-1'), androidEntry('emu-2')],
    });
    const binding = await service.bind('android', 'emu-2');
    expect(binding.deviceId).toBe('emu-2');
    expect(service.bindingOf('android')?.deviceId).toBe('emu-2');
  });

  it('绑定不存在的设备报 422 且带定位信息', async () => {
    const service = makeService({ androidDevices: [androidEntry('emu-1')] });
    await expect(service.bind('android', 'emu-404')).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.bind('android', 'emu-404')).rejects.toThrow(/emu-404/);
    expect(service.bindingOf('android')).toBeNull();
  });

  it('绑定不可用（未授权）设备报错，不降级选择其他在线设备', async () => {
    const service = makeService({
      androidDevices: [androidEntry('emu-1', 'unauthorized'), androidEntry('emu-2')],
    });
    await expect(service.bind('android', 'emu-1')).rejects.toThrow(/unauthorized/);
    // 未静默切到 emu-2
    expect(service.bindingOf('android')).toBeNull();
  });

  it('缺少设备 ID 直接 400；重复绑定 409', async () => {
    const service = makeService({ androidDevices: [androidEntry('emu-1')] });
    await expect(service.bind('android', '')).rejects.toMatchObject({ status: 400 });
    await service.bind('android', 'emu-1');
    await expect(service.bind('android', 'emu-1')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('绑定仅登记选择，释放幂等且不创建旁路 Agent；两平台互不影响', async () => {
    const service = makeService({
      androidDevices: [androidEntry('emu-1')],
      harmonyIds: ['hdc-1'],
    });
    await service.bind('android', 'emu-1');
    await service.bind('harmony', 'hdc-1');

    await service.release('android');
    expect(service.bindingOf('android')).toBeNull();
    expect(service.bindingOf('harmony')?.deviceId).toBe('hdc-1');
    expect(destroyedAgents).toEqual([]);

    // 幂等释放
    await service.release('android');
    expect(destroyedAgents).toEqual([]);
  });

  it('绑定登记持久化；重启后报告中断而不自动重连', async () => {
    // 同一工作区：写入绑定的服务与“重启后”的新服务实例
    const sharedWorkspace = new Workspace(join(tempRoot, `ws-shared-${Date.now()}`));
    const writer = new DeviceService(
      {
        listAndroid: async () => [androidEntry('emu-1')],
        createAndroid: async (udid) =>
          ({ udid, destroy: async () => undefined }) as never,
      },
      sharedWorkspace,
    );
    await writer.bind('android', 'emu-1');

    const restarted = new DeviceService(
      {
        listAndroid: async () => [androidEntry('emu-1')],
        createAndroid: async (udid) =>
          ({ udid, destroy: async () => undefined }) as never,
      },
      sharedWorkspace,
    );
    const interrupted = await restarted.interruptedBindings();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ platform: 'android', deviceId: 'emu-1' });
    expect(restarted.bindingOf('android')).toBeNull();
  });
});
