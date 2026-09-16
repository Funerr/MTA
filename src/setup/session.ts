/**
 * 会话公共层：Android 与 HarmonyOS 共用的接管前清理与单次释放语义。
 * 平台各自的设备选择逻辑与错误类型留在平台模块（语义不同，不强行统一）。
 */

/** 设备资源的生命周期子集，bindAgentToDevice 只依赖这两个能力。 */
export interface DeviceLike {
  connect(): Promise<unknown>;
  destroy(): Promise<void>;
}

/** 释放边界的最小 Agent 契约：原生 `destroy()` 幂等。 */
export interface DestroyableAgent {
  destroy(): Promise<void>;
}

/** 接管失败时清理已取得的设备资源；清理失败只记录，不覆盖原始错误。 */
export async function bindAgentToDevice<D extends DeviceLike, A>(
  deviceId: string,
  createDevice: () => D,
  wrapAgent: (device: D) => A,
): Promise<A> {
  const device = createDevice();
  try {
    await device.connect();
    return wrapAgent(device);
  } catch (error) {
    try {
      await device.destroy();
    } catch (cleanupError) {
      console.error(
        `[mta] 释放部分初始化的设备 ${deviceId} 失败：`,
        cleanupError,
      );
    }
    throw error;
  }
}

/**
 * 会话句柄基类：按会话对象持有 id 与 agent，release 至多一次。
 * Agent 接管设备后由原生 `destroy` 统一释放（幂等），此处再包一层
 * 显式标记，使重复 teardown 不会重复触发清理路径。
 */
export class SessionHandle<A extends DestroyableAgent> {
  private released = false;

  /** 本次会话绑定的设备标识（平台各自的公开命名为 udid / deviceId）。 */
  readonly id: string;
  readonly agent: A;

  constructor(session: { id: string; agent: A }) {
    this.id = session.id;
    this.agent = session.agent;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.agent.destroy();
  }
}
