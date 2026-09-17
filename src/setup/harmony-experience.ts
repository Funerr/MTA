import {
  HarmonyAgent,
  HarmonyDevice,
  getConnectedDevices,
} from '@midscene/harmony';
import { defineProjectSetup } from '@midscene/test/config';
import { bindAgentToDevice, SessionHandle } from './session';
import type { ExperienceEnvironment } from '../experience/schema/environment';
import type { ExperienceActionPolicy } from '../experience/runtime/types';
import type { HarmonyDeviceEntry, HarmonyDeviceLister, HarmonyAgentFactory } from './harmony';
import { selectHarmonyDevice, HarmonySessionSetupError } from './harmony';

/** 增强版 HarmonyProjectContext，支持经验学习配置 */
export interface HarmonyExperienceProjectContext {
  agent: HarmonyAgent;
  experienceEnvironment?: ExperienceEnvironment;
  experienceActionPolicy?: ExperienceActionPolicy;
  experienceStoreRoot?: string;
}

export interface CreateHarmonyExperienceSessionOptions {
  listDevices?: HarmonyDeviceLister;
  createAgent?: HarmonyAgentFactory;
  /** 经验学习环境配置 */
  experienceEnvironment?: ExperienceEnvironment;
  /** 经验动作策略 */
  experienceActionPolicy?: ExperienceActionPolicy;
  /** 经验存储根目录 */
  experienceStoreRoot?: string;
}

/**
 * 增强版 harmony setup：支持经验学习配置
 */
export function createHarmonyExperienceProjectSetup(
  options: CreateHarmonyExperienceSessionOptions = {},
) {
  return defineProjectSetup<HarmonyExperienceProjectContext>({
    name: 'harmony-experience',
    async setup({ env, onTeardown }) {
      const listDevices = options.listDevices ?? getConnectedDevices;
      const createAgent = options.createAgent ??
        ((deviceId: string) =>
          bindAgentToDevice(
            deviceId,
            () => new HarmonyDevice(deviceId),
            (device) => new HarmonyAgent(device),
          ));

      let devices: readonly HarmonyDeviceEntry[];
      try {
        devices = await listDevices();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new HarmonySessionSetupError(
          `获取 HarmonyOS 设备列表失败：${reason}`,
          { cause: error },
        );
      }

      const selected = selectHarmonyDevice(devices, env.HARMONY_DEVICE_ID);
      const agent = await createAgent(selected.deviceId);
      const session = new SessionHandle({ id: selected.deviceId, agent });

      console.info(`[mta] harmony-experience 会话已绑定设备：${selected.deviceId}`);
      onTeardown(() => session.release());

      return {
        agent,
        experienceEnvironment: options.experienceEnvironment,
        experienceActionPolicy: options.experienceActionPolicy,
        experienceStoreRoot: options.experienceStoreRoot,
      };
    },
  });
}