import type { NodeDefinition } from '@midscene/test';
import type { DeviceLifecycleProjectContext } from './device-lifecycle';
import { devicePrepareNode, deviceRecoverNode } from './device-lifecycle';
import { experienceActNode } from './experience-act';

/** 框架提供的全局 Nodes（两平台结构兼容的生命周期节点与实验 experienceAct）；平台原生 Nodes 由 midscene.config.ts 按项目本地注册。 */
export const frameworkNodes: readonly NodeDefinition<
  any,
  any,
  DeviceLifecycleProjectContext
>[] = [devicePrepareNode, deviceRecoverNode, experienceActNode];

export {
  devicePrepareNode,
  deviceRecoverNode,
  type DeviceLifecycleProjectContext,
  type LifecycleAgent,
} from './device-lifecycle';
export {
  experienceActNode,
  experienceActInputSchema,
  type ExperienceActInput,
  type ExperienceActProjectContext,
} from './experience-act';
export {
  createMultiDeviceNodes,
  createAliasedLifecycleNodes,
  DeviceInFlightGuard,
  DeviceInFlightError,
  DeviceParallelStepError,
  DEVICE_PARALLEL_NODE_NAME,
} from './multi-device';
export { aliasNativeNodes, renameNodeDefinition } from './alias-nodes';
