import type { NodeDefinition } from '@midscene/test';
import type { AndroidProjectContext } from '../setup/android';
import { devicePrepareNode, deviceRecoverNode } from './device-lifecycle';

/** 框架提供的全部自定义 Nodes；原生 AI/设备 Nodes 由 midscene.config.ts 注册。 */
export const frameworkNodes: readonly NodeDefinition<
  any,
  any,
  AndroidProjectContext
>[] = [devicePrepareNode, deviceRecoverNode];

export { devicePrepareNode, deviceRecoverNode } from './device-lifecycle';
