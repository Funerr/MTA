import {
  HarmonyAgent,
  HarmonyDevice,
  getConnectedDevices,
} from '@midscene/harmony';
import { defineProjectSetup } from '@midscene/test/config';
import { bindAgentToDevice, SessionHandle } from './session';
import { screenshotShrinkAgentOptions } from './agent-options';

/** 已连接 HarmonyOS 设备的最小描述，与官方 `getConnectedDevices` 返回一致（无授权状态字段）。 */
export interface HarmonyDeviceEntry {
  deviceId: string;
}

/** 设备枚举边界；框架测试用替身替换，生产使用官方 `getConnectedDevices`。 */
export type HarmonyDeviceLister = () => Promise<readonly HarmonyDeviceEntry[]>;

export const listHdcDevices: HarmonyDeviceLister = () => getConnectedDevices();

/** 设备会话建立失败：选择歧义、目标不存在或 HDC 环境不可用。 */
export class HarmonySessionSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HarmonySessionSetupError';
  }
}

/** 参与会话建立的进程环境变量（`HARMONY_DEVICE_ID` 为本框架级约定，官方包无此变量）。 */
export interface HarmonySessionEnv {
  HARMONY_DEVICE_ID?: string | undefined;
}

function describeDevices(devices: readonly HarmonyDeviceEntry[]): string {
  if (devices.length === 0) return '当前 hdc 未列出任何设备';
  const list = devices.map((d) => d.deviceId).join('、');
  return `当前 hdc 目标列表：${list}`;
}

/**
 * 确定性设备选择：显式指定 HARMONY_DEVICE_ID 时必须精确命中在线目标；
 * 未指定时仅当恰有一台在线目标时自动选择，其余情况全部报错，
 * 不静默切换设备（官方 agentFromHdcDevice 会静默选第一台，不予采用）。
 * HDC 枚举结果不携带授权状态，目标连接问题在会话建立阶段暴露。
 */
export function selectHarmonyDevice(
  devices: readonly HarmonyDeviceEntry[],
  requestedDeviceId: string | undefined,
): { deviceId: string } {
  const requested = requestedDeviceId?.trim();
  if (requested) {
    const target = devices.find((device) => device.deviceId === requested);
    if (!target) {
      throw new HarmonySessionSetupError(
        `HARMONY_DEVICE_ID 指定的设备 ${requested} 不存在。${describeDevices(devices)}；请运行 hdc list targets 核对。`,
      );
    }
    return { deviceId: target.deviceId };
  }

  if (devices.length === 0) {
    throw new HarmonySessionSetupError(
      '没有已连接的 HarmonyOS 设备；请连接设备并确认 hdc 可用（hdc list targets，可用 HDC_HOME 指定 hdc 所在目录）。',
    );
  }
  if (devices.length > 1) {
    const deviceIds = devices.map((device) => device.deviceId).join('、');
    throw new HarmonySessionSetupError(
      `检测到多台在线 HarmonyOS 设备：${deviceIds}；无法自动选择，请通过 HARMONY_DEVICE_ID 指定目标设备。`,
    );
  }
  return { deviceId: devices[0].deviceId };
}

/** Agent 创建边界；生产按官方路径 HarmonyDevice → connect → HarmonyAgent 组装。 */
export type HarmonyAgentFactory = (deviceId: string) => Promise<HarmonyAgent>;

export const createHdcHarmonyAgent: HarmonyAgentFactory = (deviceId) =>
  bindAgentToDevice(
    deviceId,
    () => new HarmonyDevice(deviceId),
    (device) => new HarmonyAgent(device, screenshotShrinkAgentOptions()),
  );

/** 一次执行项目绑定的设备会话。 */
export interface HarmonySession {
  /** 本次会话绑定的设备标识。 */
  readonly deviceId: string;
  /** 接管设备的原生 Agent；运行控制权由 Midscene 持有。 */
  readonly agent: HarmonyAgent;
}

export interface CreateHarmonySessionOptions {
  /** 设备枚举边界，默认官方 `getConnectedDevices`。 */
  listDevices?: HarmonyDeviceLister;
  /** Agent 创建边界，默认官方 `HarmonyDevice`/`HarmonyAgent` 路径。 */
  createAgent?: HarmonyAgentFactory;
}

/**
 * 建立设备会话：枚举设备 → 确定性选择 → 创建原生 Agent。
 * 仅在执行期调用；模块导入不产生设备或模型调用。
 */
export async function createHarmonySession(
  env: HarmonySessionEnv,
  options: CreateHarmonySessionOptions = {},
): Promise<HarmonySession> {
  const listDevices = options.listDevices ?? listHdcDevices;
  const createAgent = options.createAgent ?? createHdcHarmonyAgent;

  let devices: readonly HarmonyDeviceEntry[];
  try {
    devices = await listDevices();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HarmonySessionSetupError(
      `获取 HarmonyOS 设备列表失败，请检查 HDC 环境（hdc list targets，可用 HDC_HOME 指定 hdc 所在目录）：${reason}`,
      { cause: error },
    );
  }

  const selected = selectHarmonyDevice(devices, env.HARMONY_DEVICE_ID);
  const agent = await createAgent(selected.deviceId);
  return { deviceId: selected.deviceId, agent };
}

/**
 * 会话句柄：保证底层 Agent 至多释放一次（公共层 `SessionHandle` 的薄子类，
 * 保留 `deviceId` 命名与 Android 侧的 `udid` 对应）。
 */
export class HarmonySessionHandle
  extends SessionHandle<HarmonyAgent>
  implements HarmonySession
{
  readonly deviceId: string;

  constructor(session: HarmonySession) {
    super({ id: session.deviceId, agent: session.agent });
    this.deviceId = session.deviceId;
  }
}

/** 执行项目共享的上下文：当前绑定的原生 HarmonyAgent。 */
export interface HarmonyProjectContext {
  agent: HarmonyAgent;
}

/** harmony 执行项目的 setup：执行期建立设备会话，teardown 统一释放。 */
export function createHarmonyProjectSetup(
  options: CreateHarmonySessionOptions = {},
) {
  return defineProjectSetup<HarmonyProjectContext>({
    name: 'harmony',
    async setup({ env, onTeardown }) {
      const session = new HarmonySessionHandle(
        await createHarmonySession(env, options),
      );
      console.info(`[mta] harmony 会话已绑定设备：${session.deviceId}`);
      onTeardown(() => session.release());
      return { agent: session.agent };
    },
  });
}

/** 生产使用的 harmony 执行项目 setup（官方设备边界）。 */
export const harmonyProjectSetup = createHarmonyProjectSetup();
