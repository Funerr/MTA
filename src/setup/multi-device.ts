import {
  AndroidAgent,
  AndroidDevice,
  type AndroidAgentOpt,
} from '@midscene/android';
import {
  HarmonyAgent,
  HarmonyDevice,
  type HarmonyAgentOpt,
} from '@midscene/harmony';
import { defineProjectSetup } from '@midscene/test/config';
import { bindAgentToDevice, SessionHandle } from './session';
import {
  listAdbDevices,
  selectAndroidDevice,
  type AndroidDeviceLister,
} from './android';
import {
  listHdcDevices,
  selectHarmonyDevice,
  type HarmonyDeviceLister,
} from './harmony';
import {
  loadMultiDeviceBindings,
  resolveMultiDeviceTargets,
  type MultiDeviceBinding,
  type MultiDevicePlatform,
  type ResolvedMultiDeviceTarget,
} from './multi-device-config';

export class MultiDeviceSessionSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MultiDeviceSessionSetupError';
  }
}

export type MultiDeviceAgent = AndroidAgent | HarmonyAgent;

export interface BoundMultiDevice {
  readonly platform: MultiDevicePlatform;
  readonly id: string;
  readonly agent: MultiDeviceAgent;
}

/** 只读映射：别名 → 已绑定设备。不设置可变的“当前设备”。 */
export interface MultiDeviceProjectContext {
  readonly devices: Readonly<Record<string, BoundMultiDevice>>;
}

export type AliasedAndroidAgentFactory = (
  udid: string,
  alias: string,
) => Promise<AndroidAgent>;

export type AliasedHarmonyAgentFactory = (
  deviceId: string,
  alias: string,
) => Promise<HarmonyAgent>;

function agentOptions(alias: string, deviceId: string): AndroidAgentOpt & HarmonyAgentOpt {
  const stamp = Date.now();
  return {
    groupName: `multi-device:${alias}`,
    reportFileName: `multi-device-${alias}-${deviceId}-${stamp}`,
  };
}

export const createAliasedAndroidAgent: AliasedAndroidAgentFactory = (udid, alias) =>
  bindAgentToDevice(
    udid,
    () => new AndroidDevice(udid),
    (device) => new AndroidAgent(device, agentOptions(alias, udid)),
  );

export const createAliasedHarmonyAgent: AliasedHarmonyAgentFactory = (deviceId, alias) =>
  bindAgentToDevice(
    deviceId,
    () => new HarmonyDevice(deviceId),
    (device) => new HarmonyAgent(device, agentOptions(alias, deviceId)),
  );

export interface CreateMultiDeviceProjectSetupOptions {
  bindings?: readonly MultiDeviceBinding[];
  listAndroidDevices?: AndroidDeviceLister;
  listHarmonyDevices?: HarmonyDeviceLister;
  createAndroidAgent?: AliasedAndroidAgentFactory;
  createHarmonyAgent?: AliasedHarmonyAgentFactory;
}

function wrapSetupError(
  target: ResolvedMultiDeviceTarget,
  error: unknown,
): never {
  if (error instanceof MultiDeviceSessionSetupError) throw error;
  const reason = error instanceof Error ? error.message : String(error);
  throw new MultiDeviceSessionSetupError(
    `设备别名 ${target.alias}（${target.platform} / ${target.id}）不可用：${reason}`,
    { cause: error },
  );
}

async function connectTarget(
  target: ResolvedMultiDeviceTarget,
  options: {
    androidDevices?: Awaited<ReturnType<AndroidDeviceLister>>;
    harmonyDevices?: Awaited<ReturnType<HarmonyDeviceLister>>;
    listAndroidDevices: AndroidDeviceLister;
    listHarmonyDevices: HarmonyDeviceLister;
    createAndroidAgent: AliasedAndroidAgentFactory;
    createHarmonyAgent: AliasedHarmonyAgentFactory;
  },
): Promise<{ session: SessionHandle<MultiDeviceAgent>; bound: BoundMultiDevice }> {
  try {
    if (target.platform === 'android') {
      const devices = options.androidDevices ?? (await options.listAndroidDevices());
      const selected = selectAndroidDevice(devices, target.id);
      const agent = await options.createAndroidAgent(selected.udid, target.alias);
      const session = new SessionHandle<MultiDeviceAgent>({
        id: selected.udid,
        agent,
      });
      return {
        session,
        bound: { platform: 'android', id: selected.udid, agent },
      };
    }
    const devices = options.harmonyDevices ?? (await options.listHarmonyDevices());
    const selected = selectHarmonyDevice(devices, target.id);
    const agent = await options.createHarmonyAgent(selected.deviceId, target.alias);
    const session = new SessionHandle<MultiDeviceAgent>({
      id: selected.deviceId,
      agent,
    });
    return {
      session,
      bound: { platform: 'harmony', id: selected.deviceId, agent },
    };
  } catch (error) {
    wrapSetupError(target, error);
  }
}

export function createMultiDeviceProjectSetup(
  options: CreateMultiDeviceProjectSetupOptions = {},
) {
  return defineProjectSetup<MultiDeviceProjectContext>({
    name: 'multi-device',
    async setup({ env, onTeardown }) {
      const bindings = options.bindings ?? loadMultiDeviceBindings(env);
      const targets = resolveMultiDeviceTargets(bindings, env);
      const listAndroidDevices = options.listAndroidDevices ?? listAdbDevices;
      const listHarmonyDevices = options.listHarmonyDevices ?? listHdcDevices;
      const createAndroidAgent = options.createAndroidAgent ?? createAliasedAndroidAgent;
      const createHarmonyAgent = options.createHarmonyAgent ?? createAliasedHarmonyAgent;

      let androidDevices: Awaited<ReturnType<AndroidDeviceLister>> | undefined;
      let harmonyDevices: Awaited<ReturnType<HarmonyDeviceLister>> | undefined;
      const devices: Record<string, BoundMultiDevice> = {};

      for (const target of targets) {
        if (target.platform === 'android' && androidDevices === undefined) {
          try {
            androidDevices = await listAndroidDevices();
          } catch (error) {
            wrapSetupError(target, error);
          }
        }
        if (target.platform === 'harmony' && harmonyDevices === undefined) {
          try {
            harmonyDevices = await listHarmonyDevices();
          } catch (error) {
            wrapSetupError(target, error);
          }
        }

        const { session, bound } = await connectTarget(target, {
          androidDevices,
          harmonyDevices,
          listAndroidDevices,
          listHarmonyDevices,
          createAndroidAgent,
          createHarmonyAgent,
        });
        onTeardown(() => session.release());
        devices[target.alias] = bound;
        console.info(
          `[mta] multi-device 会话已绑定 ${target.alias} → ${bound.platform}:${bound.id}`,
        );
      }

      return { devices };
    },
  });
}

export const multiDeviceProjectSetup = createMultiDeviceProjectSetup();

export function requireAliasedAgent(
  context: MultiDeviceProjectContext | undefined,
  alias: string,
  nodeName: string,
): MultiDeviceAgent {
  const device = context?.devices?.[alias];
  if (!device?.agent) {
    throw new Error(
      `${nodeName} 需要协作项目已绑定的设备别名 ${alias}；请确认用例在 multi-device 执行项目中运行。`,
    );
  }
  return device.agent;
}
