import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from '@midscene/android';
import { defineProjectSetup } from '@midscene/test/config';

/** `adb devices` 输出中表示设备已授权在线的状态值。 */
export const AUTHORIZED_DEVICE_STATE = 'device';

/** 已连接 Android 设备的最小描述，字段与 `adb devices` 输出对应。 */
export interface AndroidDeviceEntry {
  udid: string;
  state: string;
}

/** 设备枚举边界；框架测试用替身替换，生产使用官方 `getConnectedDevices`。 */
export type AndroidDeviceLister = () => Promise<readonly AndroidDeviceEntry[]>;

export const listAdbDevices: AndroidDeviceLister = () => getConnectedDevices();

/** 设备会话建立失败：选择歧义、目标不可用或 ADB 环境不可用。 */
export class AndroidSessionSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AndroidSessionSetupError';
  }
}

/** 参与会话建立的进程环境变量。 */
export interface AndroidSessionEnv {
  ANDROID_DEVICE_ID?: string | undefined;
}

function describeDevices(devices: readonly AndroidDeviceEntry[]): string {
  if (devices.length === 0) return '当前 adb 未列出任何设备';
  const list = devices.map((d) => `${d.udid}（${d.state}）`).join('、');
  return `当前 adb 设备列表：${list}`;
}

/**
 * 确定性设备选择：显式指定 ANDROID_DEVICE_ID 时必须精确命中且已授权在线；
 * 未指定时仅当恰有一台已授权在线设备时自动选择，其余情况全部报错，
 * 不静默切换设备。
 */
export function selectAndroidDevice(
  devices: readonly AndroidDeviceEntry[],
  requestedDeviceId: string | undefined,
): { udid: string } {
  const requested = requestedDeviceId?.trim();
  if (requested) {
    const target = devices.find((device) => device.udid === requested);
    if (!target) {
      throw new AndroidSessionSetupError(
        `ANDROID_DEVICE_ID 指定的设备 ${requested} 不存在。${describeDevices(devices)}；请运行 adb devices 核对。`,
      );
    }
    if (target.state !== AUTHORIZED_DEVICE_STATE) {
      throw new AndroidSessionSetupError(
        `ANDROID_DEVICE_ID 指定的设备 ${requested} 不可用（状态：${target.state}）；请确认设备在线并已授权 USB 调试。`,
      );
    }
    return { udid: target.udid };
  }

  const authorized = devices.filter(
    (device) => device.state === AUTHORIZED_DEVICE_STATE,
  );
  if (authorized.length === 0) {
    throw new AndroidSessionSetupError(
      devices.length > 0
        ? `没有已授权在线的 Android 设备。${describeDevices(devices)}；请授权 USB 调试后重试。`
        : '没有已连接的 Android 设备；请连接设备并确认 adb 可用（adb devices）。',
    );
  }
  if (authorized.length > 1) {
    const udids = authorized.map((device) => device.udid).join('、');
    throw new AndroidSessionSetupError(
      `检测到多台已授权在线设备：${udids}；无法自动选择，请通过 ANDROID_DEVICE_ID 指定目标设备。`,
    );
  }
  return { udid: authorized[0].udid };
}

/** Agent 创建边界；生产按官方路径 AndroidDevice → connect → AndroidAgent 组装。 */
export type AndroidAgentFactory = (udid: string) => Promise<AndroidAgent>;

/** 接管失败时清理已取得的设备资源；清理失败只记录，不覆盖原始错误。 */
export async function bindAgentToDevice<D extends DeviceLike>(
  udid: string,
  createDevice: () => D,
  wrapAgent: (device: D) => AndroidAgent,
): Promise<AndroidAgent> {
  const device = createDevice();
  try {
    await device.connect();
    return wrapAgent(device);
  } catch (error) {
    try {
      await device.destroy();
    } catch (cleanupError) {
      console.error(`[mta] 释放部分初始化的设备 ${udid} 失败：`, cleanupError);
    }
    throw error;
  }
}

export const createAdbAndroidAgent: AndroidAgentFactory = (udid) =>
  bindAgentToDevice(
    udid,
    () => new AndroidDevice(udid),
    (device) => new AndroidAgent(device),
  );

/** 一次执行项目绑定的设备会话。 */
export interface AndroidSession {
  /** 本次会话绑定的设备标识。 */
  readonly udid: string;
  /** 接管设备的原生 Agent；运行控制权由 Midscene 持有。 */
  readonly agent: AndroidAgent;
}

export interface CreateAndroidSessionOptions {
  /** 设备枚举边界，默认官方 `getConnectedDevices`。 */
  listDevices?: AndroidDeviceLister;
  /** Agent 创建边界，默认官方 `AndroidDevice`/`AndroidAgent` 路径。 */
  createAgent?: AndroidAgentFactory;
}

/**
 * 建立设备会话：枚举设备 → 确定性选择 → 创建原生 Agent。
 * 仅在执行期调用；模块导入不产生设备或模型调用。
 */
export async function createAndroidSession(
  env: AndroidSessionEnv,
  options: CreateAndroidSessionOptions = {},
): Promise<AndroidSession> {
  const listDevices = options.listDevices ?? listAdbDevices;
  const createAgent = options.createAgent ?? createAdbAndroidAgent;

  let devices: readonly AndroidDeviceEntry[];
  try {
    devices = await listDevices();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AndroidSessionSetupError(
      `获取 Android 设备列表失败，请检查 ADB 环境（adb devices）：${reason}`,
      { cause: error },
    );
  }

  const selected = selectAndroidDevice(devices, env.ANDROID_DEVICE_ID);
  const agent = await createAgent(selected.udid);
  return { udid: selected.udid, agent };
}

/**
 * 会话句柄：保证底层 Agent 至多释放一次。
 * Agent 接管设备后由原生 `destroy` 统一释放（幂等），此处再包一层
 * 显式标记，使重复 teardown 不会重复触发清理路径。
 */
export class AndroidSessionHandle implements AndroidSession {
  readonly udid: string;
  readonly agent: AndroidAgent;
  private released = false;

  constructor(session: AndroidSession) {
    this.udid = session.udid;
    this.agent = session.agent;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.agent.destroy();
  }
}

/** 执行项目共享的上下文：当前绑定的原生 AndroidAgent。 */
export interface AndroidProjectContext {
  agent: AndroidAgent;
}

/** 设备资源的生命周期子集，bindAgentToDevice 只依赖这两个能力。 */
export interface DeviceLike {
  connect(): Promise<unknown>;
  destroy(): Promise<void>;
}

/** android 执行项目的 setup：执行期建立设备会话，teardown 统一释放。 */
export function createAndroidProjectSetup(
  options: CreateAndroidSessionOptions = {},
) {
  return defineProjectSetup<AndroidProjectContext>({
    name: 'android',
    async setup({ env, onTeardown }) {
      const session = new AndroidSessionHandle(
        await createAndroidSession(env, options),
      );
      console.info(`[mta] android 会话已绑定设备：${session.udid}`);
      onTeardown(() => session.release());
      return { agent: session.agent };
    },
  });
}

/** 生产使用的 android 执行项目 setup（官方设备边界）。 */
export const androidProjectSetup = createAndroidProjectSetup();
