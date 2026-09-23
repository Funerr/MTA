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
import { createScopedAgentReportProvider } from './src/setup/agent-report-provider';
import {
  createMultiDeviceNodes,
  frameworkNodes,
  type DeviceLifecycleProjectContext,
} from './src/nodes';
import {
  loadExperienceIntegrationConfig,
  wrapMidsceneNodesWithExperience,
} from './src/experience/integration';
import { loadKnowledgeInjectionConfig, wrapNodesWithKnowledge } from './src/knowledge';

loadEnv({ path: fileURLToPath(new URL('.env', import.meta.url)) });

// 经官方 agentProvider 契约按作用域提供 Agent：共享设备、每作用域独立实例与
// 报告文件；releaseAgent 上报该作用域的报告来源（报告组装要求 sourcePath 归属
// 单一 scope，共享实例的单一报告文件会让多用例运行在组装期失败）。

// 两平台原生 Nodes 存在大量同名节点（aiAct/launch/home…），不能同时进全局
// nodes；各自在项目本地注册，按平台互不覆盖（项目本地节点按同名覆盖全局节点）。
// 原生 aiAct / aiAssert / launch / terminate / back / home / recentApps 等
// 参数与错误契约全部保留 Midscene 原生定义，android 侧另有 runAdbShell、
// harmony 侧另有 runHdcShell。
// experience.enabled 默认关闭：包装返回原始 aiAct 定义，不实例化 Runtime/Store。
// 知识注入同默认关闭（KNOWLEDGE_INDEX_ENABLED）：关闭时不读 knowledge/ 目录。
// 组装层次：knowledge 在内层（增强 instruction）、experience 在外层（经验匹配键
// 基于原始 instruction，不随知识索引编辑漂移；原生回退路径必得注入）。
const experienceIntegration = loadExperienceIntegrationConfig();
const knowledgeInjection = loadKnowledgeInjectionConfig();

const androidNodes = wrapMidsceneNodesWithExperience(
  wrapNodesWithKnowledge(
    createMidsceneNodes<AndroidProjectContext>({
      agentClass: AndroidAgent,
      agentProvider: createScopedAgentReportProvider(
        ({ context }: NodeExecutionContext<unknown, AndroidProjectContext>) =>
          context.agent,
      ),
    }),
    knowledgeInjection,
  ),
  experienceIntegration,
);

const harmonyNodes = wrapMidsceneNodesWithExperience(
  wrapNodesWithKnowledge(
    createMidsceneNodes<HarmonyProjectContext>({
      agentClass: HarmonyAgent,
      agentProvider: createScopedAgentReportProvider(
        ({ context }: NodeExecutionContext<unknown, HarmonyProjectContext>) =>
          context.agent,
      ),
    }),
    knowledgeInjection,
  ),
  experienceIntegration,
);

const multiDeviceBindings = loadMultiDeviceBindings();
// 协作项目内部自建原生 Nodes（不复用上方已包装节点），知识注入在其内部独立挂载。
const multiDeviceNodes = createMultiDeviceNodes(multiDeviceBindings, {
  knowledge: knowledgeInjection,
});
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
