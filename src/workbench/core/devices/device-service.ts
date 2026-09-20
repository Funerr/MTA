import {
  AndroidSessionSetupError,
  selectAndroidDevice,
  listAdbDevices,
  type AndroidAgentFactory,
  type AndroidDeviceLister,
  type AndroidSession,
} from '../../../setup/android';
import {
  selectHarmonyDevice,
  HarmonySessionSetupError,
  listHdcDevices,
  type HarmonyAgentFactory,
  type HarmonyDeviceLister,
  type HarmonySession,
} from '../../../setup/harmony';
import { HttpError } from '../../server/app';
import type { Workspace } from '../../server/workspace';

/**
 * 编写核查的设备会话：复用 src/setup 的枚举、确定性选择与会话释放。
 * 绑定必须显式指定设备 ID——不存在、不可用或多台在线都不会静默
 * 切换；同一平台同一时刻至多一个会话。绑定仅登记选择，不创建旁路 Agent；会话由 MTA 执行项目管理。绑定登记持久化到工作区，
 * 服务重启后据此把旧任务标记为中断（不自动重连）。
 */

export type WorkbenchPlatform = 'android' | 'harmony';

export interface DeviceEntryView {
  readonly id: string;
  readonly state?: string;
  readonly available: boolean;
}

export interface BindingView {
  readonly platform: WorkbenchPlatform;
  readonly deviceId: string;
  readonly boundAt: string;
}

export interface DeviceServiceDeps {
  listAndroid?: AndroidDeviceLister;
  createAndroid?: AndroidAgentFactory;
  listHarmony?: HarmonyDeviceLister;
  createHarmony?: HarmonyAgentFactory;
}

interface AndroidBinding extends BindingView {
  readonly platform: 'android';

}
interface HarmonyBinding extends BindingView {
  readonly platform: 'harmony';

}

const REGISTRY_FILE = 'device-registry.json';

export class DeviceService {
  private readonly deps: DeviceServiceDeps;
  private readonly workspace: Workspace | null;
  private android: AndroidBinding | null = null;
  private harmony: HarmonyBinding | null = null;

  constructor(deps: DeviceServiceDeps = {}, workspace?: Workspace) {
    this.deps = deps;
    this.workspace = workspace ?? null;
  }

  async list(platform: WorkbenchPlatform): Promise<DeviceEntryView[]> {
    try {
      if (platform === 'android') {
        const devices = await (this.deps.listAndroid ?? listAdbDevices)();
        return devices.map((entry) => ({
          id: entry.udid,
          state: entry.state,
          available: entry.state === 'device',
        }));
      }
      const devices = await (this.deps.listHarmony ?? listHdcDevices)();
      return devices.map((entry) => ({ id: entry.deviceId, available: true }));
    } catch (error) {
      throw new HttpError(
        502,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  bindingOf(platform: WorkbenchPlatform): BindingView | null {
    const binding = platform === 'android' ? this.android : this.harmony;
    return binding
      ? {
          platform: binding.platform,
          deviceId: binding.deviceId,
          boundAt: binding.boundAt,
        }
      : null;
  }

  /** 显式绑定：设备 ID 必填；不存在/不可用直接报错，不自动换设备。 */
  async bind(
    platform: WorkbenchPlatform,
    deviceId: string,
  ): Promise<BindingView> {
    const id = deviceId.trim();
    if (!id) {
      throw new HttpError(400, `绑定 ${platform} 设备必须显式指定设备 ID`);
    }
    if (this.bindingOf(platform)) {
      throw new HttpError(
        409,
        `${platform} 已绑定设备 ${this.platformBindingId(platform)}；请先释放后再绑定`,
      );
    }

    try {
      if (platform === 'android') {
        const selected = selectAndroidDevice(await (this.deps.listAndroid ?? listAdbDevices)(), id);
        this.android = {
          platform,
          deviceId: selected.udid,
          boundAt: new Date().toISOString(),
        };
        await this.persistRegistry();
        return this.bindingOf(platform)!;
      }
      const selected = selectHarmonyDevice(await (this.deps.listHarmony ?? listHdcDevices)(), id);
      this.harmony = {
        platform,
        deviceId: selected.deviceId,
        boundAt: new Date().toISOString(),
      };
      await this.persistRegistry();
      return this.bindingOf(platform)!;
    } catch (error) {
      if (
        error instanceof AndroidSessionSetupError ||
        error instanceof HarmonySessionSetupError
      ) {
        throw new HttpError(422, error.message);
      }
      throw error;
    }
  }

  /** 释放当前绑定（幂等）。 */
  async release(platform: WorkbenchPlatform): Promise<void> {
    const binding = platform === 'android' ? this.android : this.harmony;
    if (!binding) return;
    if (platform === 'android') this.android = null;
    else this.harmony = null;
    await this.persistRegistry();
  }

  /**
   * 服务重启恢复：登记文件中的绑定在内存中已不存在，返回为
   * “中断”记录（deviceId + interrupted 标记），不自动重连。
   */
  async interruptedBindings(): Promise<
    { platform: WorkbenchPlatform; deviceId: string; boundAt: string }[]
  > {
    if (!this.workspace) return [];
    try {
      const raw = await this.workspace.readJson<
        Record<string, { deviceId: string; boundAt: string }>
      >(REGISTRY_FILE);
      const result: { platform: WorkbenchPlatform; deviceId: string; boundAt: string }[] =
        [];
      for (const [platform, record] of Object.entries(raw ?? {})) {
        if (
          (platform === 'android' || platform === 'harmony') &&
          record?.deviceId &&
          !this.bindingOf(platform)
        ) {
          result.push({
            platform,
            deviceId: record.deviceId,
            boundAt: record.boundAt,
          });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  private platformBindingId(platform: WorkbenchPlatform): string {
    const binding = platform === 'android' ? this.android : this.harmony;
    return binding?.deviceId ?? '';
  }

  private async persistRegistry(): Promise<void> {
    if (!this.workspace) return;
    const registry: Record<string, BindingView | null> = {
      android: this.bindingOf('android'),
      harmony: this.bindingOf('harmony'),
    };
    await this.workspace.writeJson(REGISTRY_FILE, registry);
  }
}
