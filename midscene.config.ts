import { caseFiles } from './cases.config';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type { NodeExecutionContext } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { AndroidAgent } from '@midscene/android';
import { HarmonyAgent } from '@midscene/harmony';
import {
  androidProjectSetup,
  type AndroidProjectContext,
} from './src/setup/android';
import {
  harmonyProjectSetup,
  type HarmonyProjectContext,
} from './src/setup/harmony';
import {
  createMultiDeviceProjectSetup,
  type MultiDeviceProjectContext,
} from './src/setup/multi-device';
import { loadMultiDeviceBindings } from './src/setup/multi-device-config';
import { createSharedAgentReportProvider } from './src/setup/agent-report-provider';
import {
  createMultiDeviceNodes,
  frameworkNodes,
  type DeviceLifecycleProjectContext,
} from './src/nodes';
import {
  loadExperienceIntegrationConfig,
  wrapMidsceneNodesWithExperience,
} from './src/experience/integration';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

// 经官方 agentProvider 契约提供共享 Agent：releaseAgent 上报报告文件路径，
// 由运行器按用例作用域登记为报告来源（否则报告组装器无法解析 AI 执行详情）。

// 两平台原生 Nodes 存在大量同名节点（aiAct/launch/home…），不能同时进全局
// nodes；各自在项目本地注册，按平台互不覆盖（项目本地节点按同名覆盖全局节点）。
// 原生 aiAct / aiAssert / launch / terminate / back / home / recentApps 等
// 参数与错误契约全部保留 Midscene 原生定义，android 侧另有 runAdbShell、
// harmony 侧另有 runHdcShell。
// experience.enabled 默认关闭：包装返回原始 aiAct 定义，不实例化 Runtime/Store。
const experienceIntegration = loadExperienceIntegrationConfig();

const androidNodes = wrapMidsceneNodesWithExperience(
  createMidsceneNodes<AndroidProjectContext>({
    agentClass: AndroidAgent,
    agentProvider: createSharedAgentReportProvider(
      ({ context }: NodeExecutionContext<unknown, AndroidProjectContext>) =>
        context.agent,
    ),
  }),
  experienceIntegration,
);

const harmonyNodes = wrapMidsceneNodesWithExperience(
  createMidsceneNodes<HarmonyProjectContext>({
    agentClass: HarmonyAgent,
    agentProvider: createSharedAgentReportProvider(
      ({ context }: NodeExecutionContext<unknown, HarmonyProjectContext>) =>
        context.agent,
    ),
  }),
  experienceIntegration,
);

const multiDeviceBindings = loadMultiDeviceBindings();
const multiDeviceNodes = createMultiDeviceNodes(multiDeviceBindings);
const multiDeviceProjectSetup = createMultiDeviceProjectSetup({
  bindings: multiDeviceBindings,
});

type MtaProjectContext =
  | DeviceLifecycleProjectContext
  | AndroidProjectContext
  | HarmonyProjectContext
  | MultiDeviceProjectContext;

export default defineTestProject<MtaProjectContext>({
  // 双执行项目与协作项目默认串行：独立项目只有在绑定互异设备时才应提高并发。
  test: { maxConcurrency: 1 },
  projects: [
    {
      name: 'android',
      setup: androidProjectSetup,
      files: caseFiles('android'),
      nodes: androidNodes,
    },
    {
      name: 'harmony',
      setup: harmonyProjectSetup,
      files: caseFiles('harmony'),
      nodes: harmonyNodes,
    },
    {
      name: 'multi-device',
      setup: multiDeviceProjectSetup,
      files: caseFiles('multi-device'),
      nodes: multiDeviceNodes,
    },
  ],
  // 全局保留两平台结构兼容的框架节点：生命周期 + 实验 experienceAct。
  nodes: [...frameworkNodes],
});
