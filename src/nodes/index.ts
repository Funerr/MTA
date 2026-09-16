import type { NodeDefinition } from '@midscene/test';
import type { DeviceLifecycleProjectContext } from './device-lifecycle';
import { devicePrepareNode, deviceRecoverNode } from './device-lifecycle';

/** 框架提供的全局 Nodes（两平台结构兼容的生命周期节点）；平台原生 Nodes 由 midscene.config.ts 按项目本地注册。 */
export const frameworkNodes: readonly NodeDefinition<
  any,
  any,
  DeviceLifecycleProjectContext
>[] = [devicePrepareNode, deviceRecoverNode];

export {
  devicePrepareNode,
  deviceRecoverNode,
  type DeviceLifecycleProjectContext,
  type LifecycleAgent,
} from './device-lifecycle';
