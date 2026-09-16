import { describe, expect, it, vi } from 'vitest';
import {
  HarmonySessionHandle,
  createHarmonyProjectSetup,
  type HarmonyDeviceEntry,
} from '../../src/setup/harmony';

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

describe('HarmonySessionHandle：会话释放', () => {
  it('重复 release 只销毁底层 Agent 一次', async () => {
    const { agent, calls } = makeStubAgent();
    const handle = new HarmonySessionHandle({
      deviceId: 'har-1',
      agent,
    } as never);
    await handle.release();
    await handle.release();
    expect(calls).toEqual(['destroy']);
  });

  it('destroy 的错误向调用方传播', async () => {
    const failure = new Error('destroy failed');
    const agent = {
      destroy: () => Promise.reject(failure),
    };
    const handle = new HarmonySessionHandle({
      deviceId: 'har-1',
      agent,
    } as never);
    await expect(handle.release()).rejects.toBe(failure);
  });

  it('再次创建会话不复用已销毁对象', async () => {
    const first = makeStubAgent();
    const second = makeStubAgent();
    const firstHandle = new HarmonySessionHandle({
      deviceId: 'har-1',
      agent: first.agent,
    } as never);
    await firstHandle.release();
    const secondHandle = new HarmonySessionHandle({
      deviceId: 'har-1',
      agent: second.agent,
    } as never);
    expect(secondHandle.agent).not.toBe(firstHandle.agent);
    expect(first.calls).toEqual(['destroy']);
    expect(second.calls).toEqual([]);
    await secondHandle.release();
    expect(second.calls).toEqual(['destroy']);
  });
});

describe('createHarmonyProjectSetup：项目 setup 与 teardown', () => {
  const devices: readonly HarmonyDeviceEntry[] = [{ deviceId: 'har-1' }];

  function collectTeardowns() {
    const teardowns: Array<() => Promise<void>> = [];
    return {
      teardowns,
      setupContext: {
        project: { name: 'harmony' },
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
    const setup = createHarmonyProjectSetup({
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
      const setup = createHarmonyProjectSetup({
        listDevices: async () => devices,
        createAgent: async () => agent as never,
      });
      const { setupContext } = collectTeardowns();

      await setup.setup(setupContext as never);
      expect(info).toHaveBeenCalledTimes(1);
      expect(vi.mocked(info).mock.calls[0]![0]).toContain('har-1');
    } finally {
      info.mockRestore();
    }
  });

  it('setup 失败（枚举/连接）时不注册 teardown（无资源残留）', async () => {
    const setup = createHarmonyProjectSetup({
      listDevices: async () => {
        throw new Error('hdc not found');
      },
      createAgent: async () => {
        throw new Error('should not be called');
      },
    });
    const { teardowns, setupContext } = collectTeardowns();

    await expect(setup.setup(setupContext as never)).rejects.toThrow(
      /获取 HarmonyOS 设备列表失败/,
    );
    expect(teardowns).toHaveLength(0);
  });

  it('连接失败时 setup 失败且不注册 teardown', async () => {
    const connectFailure = new Error('device connect failed');
    const setup = createHarmonyProjectSetup({
      listDevices: async () => devices,
      createAgent: () => Promise.reject(connectFailure),
    });
    const { teardowns, setupContext } = collectTeardowns();

    await expect(setup.setup(setupContext as never)).rejects.toBe(
      connectFailure,
    );
    expect(teardowns).toHaveLength(0);
  });
});
