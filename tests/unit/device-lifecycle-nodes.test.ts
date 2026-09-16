import { describe, expect, it } from 'vitest';
import type { AndroidAgent } from '@midscene/android';
import {
  devicePrepareNode,
  deviceRecoverNode,
} from '../../src/nodes/device-lifecycle';

function makeAgentStub(homeImpl?: () => Promise<void>) {
  const calls: Array<'home'> = [];
  const agent = {
    async home() {
      calls.push('home');
      await homeImpl?.();
    },
  };
  return { agent: agent as unknown as AndroidAgent, calls };
}

/** 以最小执行上下文直接驱动节点 execute，只注入 context。 */
function runNode(
  node: { execute(ctx: unknown): unknown },
  context: unknown,
) {
  return node.execute({ context } as never);
}

describe('device.prepare 输入契约（schema 层）', () => {
  const schema = devicePrepareNode.inputSchema!;

  it('接受且仅接受 { target: home }', () => {
    expect(schema.parse({ target: 'home' })).toEqual({ target: 'home' });
  });

  it('缺少 target 校验失败', () => {
    expect(() => schema.parse({})).toThrow();
  });

  it('target 不是 home 校验失败', () => {
    expect(() => schema.parse({ target: 'launcher' })).toThrow();
    expect(() => schema.parse({ target: 'HOME' })).toThrow();
  });

  it('未声明业务字段校验失败', () => {
    expect(() => schema.parse({ target: 'home', app: 'settings' })).toThrow();
  });
});

describe('device.recover 输入契约（schema 层）', () => {
  const schema = deviceRecoverNode.inputSchema!;

  it('接受空对象 {}', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('任意未声明业务字段校验失败', () => {
    expect(() => schema.parse({ target: 'home' })).toThrow();
    expect(() => schema.parse({ reset: true })).toThrow();
  });
});

describe('device.prepare / device.recover 执行行为', () => {
  it('prepare 合法输入调用一次原生 home', async () => {
    const { agent, calls } = makeAgentStub();
    await runNode(devicePrepareNode, { agent });
    expect(calls).toEqual(['home']);
  });

  it('recover 合法输入调用一次原生 home，重复调用可再次成功', async () => {
    const { agent, calls } = makeAgentStub();
    await runNode(deviceRecoverNode, { agent });
    await runNode(deviceRecoverNode, { agent });
    expect(calls).toEqual(['home', 'home']);
  });

  it('原生 home 失败直接传播，不吞异常、不重试', async () => {
    const failure = new Error('device disconnected during home');
    const { agent: failing, calls } = makeAgentStub(() => {
      throw failure;
    });
    await expect(runNode(devicePrepareNode, { agent: failing })).rejects.toBe(
      failure,
    );
    await expect(runNode(deviceRecoverNode, { agent: failing })).rejects.toBe(
      failure,
    );
    // 失败不重试：每个节点只尝试一次
    expect(calls).toEqual(['home', 'home']);
  });

  it('context 缺少 Agent 时给出可定位错误', async () => {
    await expect(runNode(devicePrepareNode, {})).rejects.toThrow(
      /device\.prepare.*android\/harmony/s,
    );
    await expect(runNode(deviceRecoverNode, {})).rejects.toThrow(
      /device\.recover.*android\/harmony/s,
    );
  });
});
