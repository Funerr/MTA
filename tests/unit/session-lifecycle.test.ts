import { describe, expect, it, vi } from 'vitest';
import {
  AndroidSessionHandle,
  bindAgentToDevice,
  createAndroidProjectSetup,
  type AndroidDeviceEntry,
} from '../../src/setup/android';

function makeStubAgent() {
  const calls: string[] = [];
  const agent = {
    home: async () => {
      calls.push('home');
    },
    destroy: async () => {
      calls.push('destroy');
    },
  };
  return { agent, calls };
}

function makeStubDevice(behavior: {
  connect?: () => Promise<unknown>;
  destroy?: () => Promise<void>;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    device: {
      async connect() {
        calls.push('connect');
        return behavior.connect?.();
      },
      async destroy() {
        calls.push('destroy');
        return behavior.destroy?.();
      },
    },
  };
}

describe('bindAgentToDevice：接管前部分初始化失败', () => {
  const wrap = (device: unknown) => ({ device }) as never;

  it('connect 成功后由 Agent 接管，不额外触发 destroy', async () => {
    const { device, calls } = makeStubDevice();
    const agent = await bindAgentToDevice('emu-1', () => device, wrap);
    expect((agent as unknown as { device: unknown }).device).toBe(device);
    expect(calls).toEqual(['connect']);
  });

  it('connect 失败时清理已取得的设备资源并保留原始错误', async () => {
    const connectFailure = new Error('device offline during connect');
    const { device, calls } = makeStubDevice({
      connect: () => Promise.reject(connectFailure),
    });
    await expect(
      bindAgentToDevice('emu-1', () => device, wrap),
    ).rejects.toBe(connectFailure);
    expect(calls).toEqual(['connect', 'destroy']);
  });

  it('Agent 构造失败时同样清理设备资源', async () => {
    const wrapFailure = new Error('agent construction failed');
    const { device, calls } = makeStubDevice();
    await expect(
      bindAgentToDevice('emu-1', () => device, () => {
        throw wrapFailure;
      }),
    ).rejects.toBe(wrapFailure);
    expect(calls).toEqual(['connect', 'destroy']);
  });

  it('清理本身失败时不覆盖原始错误', async () => {
    const connectFailure = new Error('connect failed');
    const { device } = makeStubDevice({
      connect: () => Promise.reject(connectFailure),
      destroy: () => Promise.reject(new Error('destroy also failed')),
    });
    await expect(
      bindAgentToDevice('emu-1', () => device, wrap),
    ).rejects.toBe(connectFailure);
  });
});

describe('AndroidSessionHandle：会话释放', () => {
  it('重复 release 只销毁底层 Agent 一次', async () => {
    const { agent, calls } = makeStubAgent();
    const handle = new AndroidSessionHandle({ udid: 'emu-1', agent } as never);
    await handle.release();
    await handle.release();
    expect(calls).toEqual(['destroy']);
  });

  it('destroy 的错误向调用方传播', async () => {
    const failure = new Error('destroy failed');
    const agent = {
      destroy: () => Promise.reject(failure),
    };
    const handle = new AndroidSessionHandle({ udid: 'emu-1', agent } as never);
    await expect(handle.release()).rejects.toBe(failure);
  });

  it('再次创建会话不复用已销毁对象', async () => {
    const first = makeStubAgent();
    const second = makeStubAgent();
    const firstHandle = new AndroidSessionHandle({
      udid: 'emu-1',
      agent: first.agent,
    } as never);
    await firstHandle.release();
    const secondHandle = new AndroidSessionHandle({
      udid: 'emu-1',
      agent: second.agent,
    } as never);
    expect(secondHandle.agent).not.toBe(firstHandle.agent);
    expect(first.calls).toEqual(['destroy']);
    expect(second.calls).toEqual([]);
    await secondHandle.release();
    expect(second.calls).toEqual(['destroy']);
  });
});

describe('createAndroidProjectSetup：项目 setup 与 teardown', () => {
  const devices: readonly AndroidDeviceEntry[] = [{ udid: 'emu-1', state: 'device' }];

  function collectTeardowns() {
    const teardowns: Array<() => Promise<void>> = [];
    return {
      teardowns,
      setupContext: {
        project: { name: 'android' },
        env: {} as NodeJS.ProcessEnv,
        signal: new AbortController().signal,
        onTeardown: (fn: () => Promise<void>) => {
          teardowns.push(fn);
        },
      },
    };
  }

  it('setup 返回绑定设备的 context，teardown 释放且只释放一次', async () => {
    const { agent, calls } = makeStubAgent();
    const setup = createAndroidProjectSetup({
      listDevices: async () => devices,
      createAgent: async () => agent as never,
    });
    const { teardowns, setupContext } = collectTeardowns();

    const context = await setup.setup(setupContext as never);
    expect(context).toEqual({ agent });
    expect(teardowns).toHaveLength(1);

    await teardowns[0]!();
    await teardowns[0]!();
    expect(calls).toEqual(['destroy']);
  });

  it('setup 输出所选设备标识', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const { agent } = makeStubAgent();
      const setup = createAndroidProjectSetup({
        listDevices: async () => devices,
        createAgent: async () => agent as never,
      });
      const { setupContext } = collectTeardowns();

      await setup.setup(setupContext as never);
      expect(info).toHaveBeenCalledTimes(1);
      expect(vi.mocked(info).mock.calls[0]![0]).toContain('emu-1');
    } finally {
      info.mockRestore();
    }
  });

  it('setup 失败时不注册 teardown（清理已由会话建立负责）', async () => {
    const setup = createAndroidProjectSetup({
      listDevices: async () => {
        throw new Error('adb not found');
      },
      createAgent: async () => {
        throw new Error('should not be called');
      },
    });
    const { teardowns, setupContext } = collectTeardowns();

    await expect(setup.setup(setupContext as never)).rejects.toThrow(
      /获取 Android 设备列表失败/,
    );
    expect(teardowns).toHaveLength(0);
  });
});
