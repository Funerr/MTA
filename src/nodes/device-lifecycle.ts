import { z } from 'zod/v4';
import { defineNode } from '@midscene/test';

/** 生命周期节点依赖的最小 Agent 契约：两平台原生 Agent 均具备 home。 */
export interface LifecycleAgent {
  home(): Promise<unknown>;
}

/** 执行项目共享的上下文结构：android/harmony 两平台 setup 输出结构兼容。 */
export interface DeviceLifecycleProjectContext {
  agent: LifecycleAgent;
}

/** 严格输入：仅接受 { target: home }，未声明业务字段一律校验失败。 */
export const devicePrepareInputSchema = z.strictObject({
  target: z
    .literal('home')
    .describe('准备目标，首期仅支持 home（返回当前平台主屏）。'),
});

/** 严格输入：仅接受空对象 {}，未声明业务字段一律校验失败。 */
export const deviceRecoverInputSchema = z.strictObject({});

/**
 * device.prepare：准备当前绑定设备（android 或 harmony 项目），首期唯一目标是
 * 返回该平台主屏。只提供原生导航基线；不处理解锁、网络重置、恢复出厂或业务初始状态。
 */
export const devicePrepareNode = defineNode<
  typeof devicePrepareInputSchema,
  unknown,
  DeviceLifecycleProjectContext
>({
  name: 'device.prepare',
  description:
    '准备当前绑定设备：返回当前平台主屏（Home）。仅是原生导航基线，不解锁设备、不重置网络、不准备业务初始状态。',
  inputSchema: devicePrepareInputSchema,
  async execute({ context }) {
    const agent = requireProjectAgent(context, 'device.prepare');
    await agent.home();
  },
});

/**
 * device.recover：结束恢复当前绑定设备（android 或 harmony 项目），唯一行为是
 * 返回该平台主屏。保留当前系统设置与使用方业务状态；恢复成功仅表示完成 Home 基线恢复。
 */
export const deviceRecoverNode = defineNode<
  typeof deviceRecoverInputSchema,
  unknown,
  DeviceLifecycleProjectContext
>({
  name: 'device.recover',
  description:
    '恢复当前绑定设备：返回当前平台主屏（Home）。保留系统设置与业务状态；可在准备或用例步骤部分完成后调用。',
  inputSchema: deviceRecoverInputSchema,
  async execute({ context }) {
    const agent = requireProjectAgent(context, 'device.recover');
    await agent.home();
  },
});

function requireProjectAgent(
  context: DeviceLifecycleProjectContext,
  nodeName: string,
): LifecycleAgent {
  if (!context?.agent) {
    throw new Error(
      `${nodeName} 需要执行项目 setup 提供的 Agent；请确认用例在 android/harmony 执行项目中运行。`,
    );
  }
  return context.agent;
}
